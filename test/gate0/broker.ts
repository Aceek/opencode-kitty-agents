import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createServer, type Socket } from "node:net"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  assertWindowsShareTab,
  type GateFailureCode,
  type GateResult,
  type GateResponse,
  GATE_VERSION,
  parseGateRequest,
  parseInheritedFD,
  parseNumericID,
  resultPath,
} from "./contracts"
import {
  closeWindowArgv,
  opencodeLaunchArgv,
  originQueryArgv,
  parseLaunchID,
  runKitten,
  sleepLaunchArgv,
  tabQueryArgv,
} from "./kitty"

const repositoryRoot = resolve(import.meta.dir, "../..")
const pluginURL = pathToFileURL(join(import.meta.dir, "probe-plugin.ts")).href

function currentUID(): number {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error("UID unavailable")
  return uid
}

function runtimeDirectory(): string {
  const value = process.env.XDG_RUNTIME_DIR
  if (!value || !value.startsWith("/")) throw new Error("invalid runtime")
  const info = statSync(value)
  if (!info.isDirectory() || info.uid !== currentUID()) throw new Error("invalid runtime")
  return resolve(value)
}

function writeResult(runtime: string, result: GateResult): void {
  const destination = resultPath(runtime)
  const temporary = `${destination}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(result)}\n`, { mode: 0o600 })
  renameSync(temporary, destination)
  chmodSync(destination, 0o600)
}

function minimalKittenEnvironment(runtime: string, listenOn: string): Record<string, string> {
  const env: Record<string, string> = {
    KITTY_LISTEN_ON: listenOn,
    XDG_RUNTIME_DIR: runtime,
  }
  for (const key of ["HOME", "PATH", "LANG", "LC_ALL"] as const) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

async function runProbe(input: {
  opencodeWindowID: number
  inheritedFD: number
  kittenEnv: Record<string, string>
}): Promise<GateResponse> {
  const originJSON = await runKitten(originQueryArgv(input.opencodeWindowID), input.inheritedFD, input.kittenEnv)
  assertWindowsShareTab(originJSON, [input.opencodeWindowID])

  let splitWindowID: number | undefined
  let probeError: unknown
  let closeError: unknown
  try {
    splitWindowID = parseLaunchID(
      await runKitten(sleepLaunchArgv(input.opencodeWindowID), input.inheritedFD, input.kittenEnv),
    )
    const sameTabJSON = await runKitten(tabQueryArgv(input.opencodeWindowID), input.inheritedFD, input.kittenEnv)
    assertWindowsShareTab(sameTabJSON, [input.opencodeWindowID, splitWindowID])
  } catch (error) {
    probeError = error
  } finally {
    if (splitWindowID !== undefined) {
      try {
        await runKitten(closeWindowArgv(splitWindowID), input.inheritedFD, input.kittenEnv)
      } catch (error) {
        closeError = error
      }
    }
  }
  if (probeError || closeError || splitWindowID === undefined) throw new Error("kitty probe failed")
  return {
    version: GATE_VERSION,
    ok: true,
    pluginRuntime: true,
    capabilityInherited: true,
    originQueried: true,
    splitLaunched: true,
    sameTab: true,
    splitClosed: true,
  }
}

function waitForPlugin(
  endpoint: string,
  run: () => Promise<GateResponse>,
): { ready: Promise<void>; result: Promise<GateResponse>; close: () => Promise<void> } {
  let accepted = false
  let activeSocket: Socket | undefined
  let resolveResult!: (result: GateResponse) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<GateResponse>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  const server = createServer((socket: Socket) => {
    if (accepted) {
      socket.destroy()
      return
    }
    accepted = true
    activeSocket = socket
    socket.once("close", () => {
      if (activeSocket === socket) activeSocket = undefined
    })
    let request = ""
    socket.setTimeout(30_000, () => socket.destroy(new Error("request timeout")))
    socket.on("error", () => rejectResult(new Error("IPC failed")))
    socket.on("data", (chunk) => {
      request += chunk.toString("utf8")
      if (request.length > 128) {
        socket.destroy(new Error("invalid request"))
        return
      }
      const newline = request.indexOf("\n")
      if (newline < 0) return
      if (newline !== request.length - 1) {
        socket.destroy(new Error("invalid request"))
        rejectResult(new Error("invalid request"))
        return
      }
      try {
        parseGateRequest(request.slice(0, newline))
      } catch {
        socket.destroy(new Error("invalid request"))
        rejectResult(new Error("invalid request"))
        return
      }
      socket.pause()
      void run().then(
        (response) => {
          socket.end(`${JSON.stringify(response)}\n`, () => resolveResult(response))
        },
        () => {
          socket.destroy()
          rejectResult(new Error("kitty probe failed"))
        },
      )
    })
  })
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    server.once("error", () => rejectReady(new Error("IPC failed")))
    server.listen(endpoint, () => {
      chmodSync(endpoint, 0o600)
      const info = lstatSync(endpoint)
      if (!info.isSocket() || info.uid !== currentUID()) {
        rejectReady(new Error("IPC failed"))
        return
      }
      resolveReady()
    })
  })
  return {
    ready,
    result,
    close: () =>
      new Promise<void>((resolveClose) => {
        activeSocket?.destroy()
        server.close(() => resolveClose())
      }),
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("plugin timeout")), milliseconds)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  let runtime = ""
  let endpointDirectory = ""
  let server: ReturnType<typeof waitForPlugin> | undefined
  let opencodeWindowID: number | undefined
  let inheritedFD: number | undefined
  let kittenEnv: Record<string, string> | undefined
  let failure: GateFailureCode = "ipc_failed"
  try {
    runtime = runtimeDirectory()
    writeResult(runtime, { version: GATE_VERSION, ok: false, failure: "running" })
    failure = "invalid_origin"
    const mappingOriginID = parseNumericID(process.argv[2] ?? "")
    failure = "missing_capability"
    const listenOn = process.env.KITTY_LISTEN_ON
    const capabilityFD = parseInheritedFD(listenOn)
    inheritedFD = capabilityFD
    endpointDirectory = mkdtempSync(join(runtime, "opencode-kitty-gate0-"))
    chmodSync(endpointDirectory, 0o700)
    const endpoint = join(endpointDirectory, "broker.sock")
    const commandEnv = minimalKittenEnvironment(runtime, listenOn as string)
    kittenEnv = commandEnv
    server = waitForPlugin(endpoint, () => {
      if (opencodeWindowID === undefined) throw new Error("OpenCode window is unavailable")
      return runProbe({ opencodeWindowID, inheritedFD: capabilityFD, kittenEnv: commandEnv })
    })
    failure = "ipc_failed"
    await server.ready
    failure = "invalid_origin"
    const mappingOriginJSON = await runKitten(originQueryArgv(mappingOriginID), capabilityFD, commandEnv)
    assertWindowsShareTab(mappingOriginJSON, [mappingOriginID])
    failure = "unsupported_layout"
    assertWindowsShareTab(mappingOriginJSON, [mappingOriginID], "splits")
    failure = "opencode_launch_failed"
    opencodeWindowID = parseLaunchID(
      await runKitten(
        opencodeLaunchArgv({ mappingOriginID, repositoryRoot, endpoint, pluginURL }),
        capabilityFD,
        commandEnv,
      ),
    )
    failure = "kitty_probe_failed"
    let result: GateResponse
    try {
      result = await withTimeout(server.result, 45_000)
    } catch (error) {
      if (error instanceof Error && error.message === "plugin timeout") failure = "plugin_timeout"
      throw error
    }
    await runKitten(closeWindowArgv(opencodeWindowID), capabilityFD, commandEnv)
    opencodeWindowID = undefined
    writeResult(runtime, result)
  } catch {
    if (!runtime) return
    writeResult(runtime, { version: GATE_VERSION, ok: false, failure })
  } finally {
    await server?.close().catch(() => undefined)
    if (opencodeWindowID !== undefined && inheritedFD !== undefined && kittenEnv !== undefined) {
      await runKitten(closeWindowArgv(opencodeWindowID), inheritedFD, kittenEnv).catch(() => undefined)
    }
    if (endpointDirectory) rmSync(endpointDirectory, { recursive: true, force: true })
  }
}

await main()
