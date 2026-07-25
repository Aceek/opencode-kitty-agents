import { describe, expect, test } from "bun:test"
import { KittyBroker } from "../src/broker/core"
import { ProcessExecutionError } from "../src/broker/runner"
import type { KittyRunner } from "../src/broker/kitty"

const originOnly = JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12 }] }] }])
const withChild = JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12 }, { id: 19 }] }] }])
const recoveryToken = "test-recovery-token-123"
const withRecoveryChild = JSON.stringify([
  {
    tabs: [
      {
        layout: "splits",
        windows: [{ id: 12 }, { id: 19, user_vars: { opencode_kitty_agents_launch: recoveryToken } }],
      },
    ],
  },
])
const brokerOptions = {
  originWindowID: 12,
  opencodeExecutable: "/trusted/opencode",
  openCodeEnvironment: ["HOME=/home/test"],
  recoveryToken: () => recoveryToken,
}

function request(operation: "availability" | "shutdown") {
  return { version: 1 as const, operation }
}

describe("Kitty broker core", () => {
  test("opens, validates, queries, focuses, and idempotently closes only a broker-created ID", async () => {
    const calls: string[][] = []
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      const command = argv[3]
      if (command === "launch") return { stdout: "19\n" }
      if (command === "ls") {
        return { stdout: calls.filter((call) => call[3] === "launch").length === 0 ? originOnly : withChild }
      }
      return { stdout: "" }
    }
    const broker = new KittyBroker(brokerOptions, runner)

    expect(await broker.request(request("availability"))).toMatchObject({ available: true })
    const opened = await broker.request({
      version: 1,
      operation: "open",
      serverUrl: "http://127.0.0.1:4096/",
      directory: "/repo",
      sessionID: "child",
      splitDirection: "vertical",
      childBias: 40,
      focusPolicy: "preserve",
    })
    expect(opened).toEqual({ version: 1, operation: "open", ok: true, windowID: 19 })
    expect(await broker.request({ version: 1, operation: "exists", windowID: 19 })).toMatchObject({ exists: true })
    expect(await broker.request({ version: 1, operation: "focus", windowID: 19 })).toMatchObject({ ok: true })
    expect(await broker.request({ version: 1, operation: "close", windowID: 19 })).toMatchObject({ ok: true })
    expect(await broker.request({ version: 1, operation: "close", windowID: 19 })).toMatchObject({ ok: true })

    expect(calls.filter((argv) => argv[3] === "close-window")).toHaveLength(2)
    expect(calls.every((argv) => argv[2] === "--use-password=never")).toBe(true)
    expect(calls.find((argv) => argv[3] === "launch")).toContain("/trusted/opencode")
  })

  test("manual closure becomes exists false and cleanup remains successful", async () => {
    let launched = false
    let originQueriesAfterLaunch = 0
    const calls: string[][] = []
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") {
        launched = true
        return { stdout: "19" }
      }
      if (!launched) return { stdout: originOnly }
      originQueriesAfterLaunch += 1
      return { stdout: originQueriesAfterLaunch === 1 ? withChild : originOnly }
    }
    const broker = new KittyBroker({ ...brokerOptions, opencodeExecutable: "opencode" }, runner)
    await broker.request({
      version: 1,
      operation: "open",
      serverUrl: "http://localhost:4096/",
      directory: "/repo",
      sessionID: "child",
      splitDirection: "vertical",
      childBias: 40,
      focusPolicy: "child",
    })
    expect(await broker.request({ version: 1, operation: "exists", windowID: 19 })).toMatchObject({ exists: false })
    expect(calls.filter((argv) => argv[3] === "ls").at(-1)).toEqual([
      "/usr/bin/kitten",
      "@",
      "--use-password=never",
      "ls",
    ])
    expect(await broker.request({ version: 1, operation: "close", windowID: 19 })).toMatchObject({ ok: true })
  })

  test("a managed child moved to another tab remains existing and cleanup eligible", async () => {
    let launched = false
    const runner: KittyRunner = async (argv) => {
      if (argv[3] === "launch") {
        launched = true
        return { stdout: "19" }
      }
      if (argv[3] === "ls" && argv.length === 4) {
        return {
          stdout: JSON.stringify([
            { tabs: [{ layout: "splits", windows: [{ id: 12 }] }, { layout: "splits", windows: [{ id: 19 }] }] },
          ]),
        }
      }
      return { stdout: launched ? withChild : originOnly }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    await broker.request({
      version: 1,
      operation: "open",
      serverUrl: "http://localhost:4096/",
      directory: "/repo",
      sessionID: "child",
      splitDirection: "vertical",
      childBias: 40,
      focusPolicy: "child",
    })
    expect(await broker.request({ version: 1, operation: "exists", windowID: 19 })).toMatchObject({ exists: true })
    expect(await broker.request({ version: 1, operation: "close", windowID: 19 })).toMatchObject({ ok: true })
  })

  test("rejects unknown IDs and reports unsupported origin layout without changing it", async () => {
    const runner: KittyRunner = async () => ({
      stdout: JSON.stringify([{ tabs: [{ layout: "tall", windows: [{ id: 12 }] }] }]),
    })
    const broker = new KittyBroker({ ...brokerOptions, opencodeExecutable: "opencode" }, runner)
    expect(await broker.request(request("availability"))).toEqual({
      version: 1,
      operation: "availability",
      ok: true,
      available: false,
      reason: "unsupported-layout",
    })
    expect(await broker.request({ version: 1, operation: "focus", windowID: 999 })).toMatchObject({
      ok: false,
      error: "unknown-window",
    })
  })

  test("serializes concurrent state mutations and makes shutdown idempotent", async () => {
    let active = 0
    let maximum = 0
    const runner: KittyRunner = async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await Bun.sleep(5)
      active -= 1
      return { stdout: originOnly }
    }
    const broker = new KittyBroker({ ...brokerOptions, opencodeExecutable: "opencode" }, runner)
    await Promise.all([broker.request(request("availability")), broker.request(request("availability"))])
    expect(maximum).toBe(1)
    expect(await broker.request(request("shutdown"))).toMatchObject({ ok: true })
    expect(await broker.request(request("shutdown"))).toMatchObject({ ok: true })
  })

  test("recovers one unambiguous added window when successful launch output is malformed", async () => {
    const calls: string[][] = []
    let launched = false
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") {
        launched = true
        return { stdout: "response was lost" }
      }
      return { stdout: launched ? withRecoveryChild : originOnly }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    const result = await broker.request({
      version: 1,
      operation: "open",
      serverUrl: "http://localhost:4096/",
      directory: "/repo",
      sessionID: "child",
      splitDirection: "vertical",
      childBias: 40,
      focusPolicy: "preserve",
    })
    expect(result).toMatchObject({ ok: false, error: "kitty-failed" })
    expect(calls.filter((argv) => argv[3] === "close-window")).toEqual([
      ["/usr/bin/kitten", "@", "--use-password=never", "close-window", "--match=id:19", "--ignore-no-match"],
    ])
  })

  test("never closes a candidate when malformed-launch recovery is ambiguous", async () => {
    const calls: string[][] = []
    let launched = false
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") {
        launched = true
        return { stdout: "" }
      }
      return {
        stdout: launched
          ? JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12 }, { id: 19 }, { id: 20 }] }] }])
          : originOnly,
      }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    await broker.request({
      version: 1,
      operation: "open",
      serverUrl: "http://localhost:4096/",
      directory: "/repo",
      sessionID: "child",
      splitDirection: "vertical",
      childBias: 40,
      focusPolicy: "preserve",
    })
    expect(calls.some((argv) => argv[3] === "close-window")).toBe(false)
  })

  test("recovers a uniquely marked child when the launch runner rejects after creating it", async () => {
    const calls: string[][] = []
    let launched = false
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") {
        launched = true
        throw new ProcessExecutionError("timeout")
      }
      return { stdout: launched ? withRecoveryChild : originOnly }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    const result = await broker.request({
      version: 1,
      operation: "open",
      serverUrl: "http://localhost:4096/",
      directory: "/repo",
      sessionID: "child",
      splitDirection: "vertical",
      childBias: 40,
      focusPolicy: "preserve",
    })
    expect(result).toMatchObject({ ok: false, error: "timeout" })
    expect(calls.filter((argv) => argv[3] === "close-window")).toHaveLength(1)
  })

  test("closes multiple managed windows sequentially during shutdown", async () => {
    const childIDs = [19, 20]
    let launchIndex = 0
    let activeCloses = 0
    let maximumCloses = 0
    const runner: KittyRunner = async (argv) => {
      if (argv[3] === "launch") return { stdout: String(childIDs[launchIndex++]) }
      if (argv[3] === "close-window") {
        activeCloses += 1
        maximumCloses = Math.max(maximumCloses, activeCloses)
        await Bun.sleep(5)
        activeCloses -= 1
        return { stdout: "" }
      }
      const current = childIDs.slice(0, launchIndex)
      return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12 }, ...current.map((id) => ({ id }))] }] }]) }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    for (const sessionID of ["one", "two"]) {
      await broker.request({
        version: 1,
        operation: "open",
        serverUrl: "http://localhost:4096/",
        directory: "/repo",
        sessionID,
        splitDirection: "vertical",
        childBias: 40,
        focusPolicy: "child",
      })
    }
    await broker.request(request("shutdown"))
    expect(maximumCloses).toBe(1)
  })

  test("applies one global shutdown deadline and contains the leftover close", async () => {
    const childIDs = [19, 20]
    let launchIndex = 0
    let closeStarts = 0
    let releaseClose!: () => void
    const runner: KittyRunner = async (argv) => {
      if (argv[3] === "launch") return { stdout: String(childIDs[launchIndex++]) }
      if (argv[3] === "close-window") {
        closeStarts += 1
        await new Promise<void>((resolve) => {
          releaseClose = resolve
        })
        return { stdout: "" }
      }
      const current = childIDs.slice(0, launchIndex)
      return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12 }, ...current.map((id) => ({ id }))] }] }]) }
    }
    const broker = new KittyBroker({ ...brokerOptions, shutdownTimeoutMs: 20 }, runner)
    for (const sessionID of ["one", "two"]) {
      await broker.request({
        version: 1,
        operation: "open",
        serverUrl: "http://localhost:4096/",
        directory: "/repo",
        sessionID,
        splitDirection: "vertical",
        childBias: 40,
        focusPolicy: "child",
      })
    }
    const started = performance.now()
    await broker.request(request("shutdown"))
    expect(performance.now() - started).toBeLessThan(200)
    expect(closeStarts).toBe(1)
    releaseClose()
    await Bun.sleep(10)
    expect(closeStarts).toBe(1)
  })
})
