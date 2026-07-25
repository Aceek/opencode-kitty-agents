#!/usr/bin/env bun
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { KittyBroker } from "./core"
import { validateRuntimeDirectory } from "./endpoint"
import {
  closeWindowArgv,
  createKittyRunner,
  minimalKittyEnvironment,
  minimalOpenCodeEnvironment,
  launchWithRecovery,
  orchestratorLaunchArgv,
  parseInheritedKittyFD,
  requireOriginTab,
  originStateArgv,
  validateLaunchedWindow,
} from "./kitty"
import { BROKER_ENDPOINT_ENV, type BrokerRequest, type BrokerResponse } from "./protocol"
import { listenBroker, type BrokerRequestHandler } from "./server"
import { ShutdownLatch } from "./shutdown"

function parseNumericID(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new Error("invalid startup")
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw new Error("invalid startup")
  return id
}

function parseStartup(argv: readonly string[]): { mappingOriginWindowID: number; opencodeExecutable: string } {
  if (argv.length < 1 || argv.length > 2) throw new Error("invalid startup")
  const mappingOriginWindowID = parseNumericID(argv[0])
  const option = argv[1]
  if (option !== undefined && !option.startsWith("--opencode-executable=")) throw new Error("invalid startup")
  const opencodeExecutable = option?.slice("--opencode-executable=".length) ?? "/usr/bin/opencode"
  if (!opencodeExecutable || opencodeExecutable.trim() !== opencodeExecutable || opencodeExecutable.includes("\0")) {
    throw new Error("invalid startup")
  }
  return { mappingOriginWindowID, opencodeExecutable }
}

async function main(): Promise<void> {
  let endpointDirectory = ""
  let orchestratorWindowID: number | undefined
  let server: Awaited<ReturnType<typeof listenBroker>> | undefined
  let broker: KittyBroker | undefined
  let runner: ReturnType<typeof createKittyRunner> | undefined
  const shutdown = new ShutdownLatch()
  const stop = () => {
    shutdown.request(() => {
      void server?.close()
    })
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    const startup = parseStartup(process.argv.slice(2))
    shutdown.throwIfRequested()
    const runtime = validateRuntimeDirectory(process.env.XDG_RUNTIME_DIR)
    const listenOn = process.env.KITTY_LISTEN_ON
    const inheritedFD = parseInheritedKittyFD(listenOn)
    const kittyEnvironment = minimalKittyEnvironment(process.env, listenOn as string)
    runner = createKittyRunner({ inheritedFD, env: kittyEnvironment })
    const openCodeEnvironment = minimalOpenCodeEnvironment(process.env)
    shutdown.throwIfRequested()

    const originTab = requireOriginTab(
      (await runner(originStateArgv(startup.mappingOriginWindowID))).stdout,
      startup.mappingOriginWindowID,
    )
    if (originTab.layout !== "splits") throw new Error("unsupported layout")
    shutdown.throwIfRequested()

    endpointDirectory = mkdtempSync(join(runtime, "opencode-kitty-agents-"))
    chmodSync(endpointDirectory, 0o700)
    const endpoint = join(endpointDirectory, "broker.sock")
    let resolveBroker!: (value: KittyBroker) => void
    const readyBroker = new Promise<KittyBroker>((resolve) => {
      resolveBroker = resolve
    })
    const deferred: BrokerRequestHandler = {
      async request(request: BrokerRequest): Promise<BrokerResponse> {
        return (await readyBroker).request(request)
      },
    }
    server = await listenBroker(endpoint, deferred)
    shutdown.throwIfRequested()
    const recoveryToken = randomUUID()
    const launchArgv = orchestratorLaunchArgv({
      mappingOriginWindowID: startup.mappingOriginWindowID,
      opencodeExecutable: startup.opencodeExecutable,
      endpoint,
      environment: openCodeEnvironment,
      recoveryToken,
    })
    orchestratorWindowID = await launchWithRecovery({
      runner,
      launchArgv,
      before: originTab,
      originWindowID: startup.mappingOriginWindowID,
      recoveryToken,
    })
    shutdown.throwIfRequested()
    validateLaunchedWindow(
      (await runner(originStateArgv(startup.mappingOriginWindowID))).stdout,
      startup.mappingOriginWindowID,
      orchestratorWindowID,
    )
    broker = new KittyBroker(
      {
        originWindowID: orchestratorWindowID,
        opencodeExecutable: startup.opencodeExecutable,
        openCodeEnvironment,
      },
      runner,
    )
    resolveBroker(broker)
    await server.closed
  } finally {
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
    if (broker) await broker.request({ version: 1, operation: "shutdown" }).catch(() => undefined)
    await server?.close().catch(() => undefined)
    if (orchestratorWindowID !== undefined && runner) {
      await runner(closeWindowArgv(orchestratorWindowID)).catch(() => undefined)
    }
    if (endpointDirectory) rmSync(endpointDirectory, { recursive: true, force: true })
    delete process.env[BROKER_ENDPOINT_ENV]
  }
}

await main().catch(() => {
  process.exitCode = 1
})
