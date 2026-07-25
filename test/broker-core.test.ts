import { describe, expect, test } from "bun:test"
import { KittyBroker } from "../src/broker/core"
import { ProcessExecutionError } from "../src/broker/runner"
import type { KittyRunner } from "../src/broker/kitty"

const windowState = (id: number, lines = 40, columns = 100) => ({ id, lines, columns })
const originOnly = JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12)] }] }])
const withChild = JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12), windowState(19)] }] }])
const recoveryToken = "test-recovery-token-123"
const withRecoveryChild = JSON.stringify([
  {
    tabs: [
      {
        layout: "splits",
        windows: [windowState(12), { ...windowState(19), user_vars: { opencode_kitty_agents_launch: recoveryToken } }],
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
            { tabs: [{ layout: "splits", windows: [windowState(12)] }, { layout: "splits", windows: [windowState(19)] }] },
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

  test("uses sequential vertical split geometry to select four readable child-area anchors", async () => {
    const calls: string[][] = []
    const snapshots = [
      [windowState(12, 50, 100)],
      [windowState(12, 50, 60), windowState(19, 50, 40)],
      [windowState(12, 50, 60), windowState(19, 50, 40)],
      [windowState(12, 50, 60), windowState(19, 25, 40), windowState(20, 25, 40)],
      [windowState(12, 50, 60), windowState(19, 25, 40), windowState(20, 25, 40)],
      [windowState(12, 50, 60), windowState(19, 12, 40), windowState(21, 13, 40), windowState(20, 25, 40)],
      [windowState(12, 50, 60), windowState(19, 12, 40), windowState(21, 13, 40), windowState(20, 25, 40)],
      [windowState(12, 50, 60), windowState(19, 12, 40), windowState(21, 13, 40), windowState(20, 12, 40), windowState(22, 13, 40)],
    ]
    let launchIndex = 0
    let snapshotIndex = 0
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") return { stdout: String([19, 20, 21, 22][launchIndex++]) }
      if (argv[3] !== "ls") return { stdout: "" }
      return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: snapshots[snapshotIndex++] }] }]) }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    for (const sessionID of ["one", "two", "three", "four"]) {
      expect(await broker.request({ version: 1, operation: "open", serverUrl: "http://localhost:4096/", directory: "/repo", sessionID, splitDirection: "vertical", childBias: 40, focusPolicy: "preserve" })).toMatchObject({ ok: true })
    }
    const launches = calls.filter((argv) => argv[3] === "launch")
    expect(launches.map((argv) => [argv.find((value) => value.startsWith("--next-to=")), argv.find((value) => value.startsWith("--location=")), argv.find((value) => value.startsWith("--bias="))])).toEqual([
      ["--next-to=id:12", "--location=vsplit", "--bias=40"],
      ["--next-to=id:19", "--location=hsplit", "--bias=50"],
      ["--next-to=id:19", "--location=hsplit", "--bias=50"],
      ["--next-to=id:20", "--location=hsplit", "--bias=50"],
    ])
    expect(calls.filter((argv) => argv[3] === "focus-window")).toHaveLength(4)
  })

  test("uses sequential horizontal split geometry to select four readable child-area anchors", async () => {
    const calls: string[][] = []
    const snapshots = [
      [windowState(12, 50, 100)],
      [windowState(12, 30, 100), windowState(19, 20, 100)],
      [windowState(12, 30, 100), windowState(19, 20, 100)],
      [windowState(12, 30, 100), windowState(19, 20, 50), windowState(20, 20, 50)],
      [windowState(12, 30, 100), windowState(19, 20, 50), windowState(20, 20, 50)],
      [windowState(12, 30, 100), windowState(19, 20, 25), windowState(21, 20, 25), windowState(20, 20, 50)],
      [windowState(12, 30, 100), windowState(19, 20, 25), windowState(21, 20, 25), windowState(20, 20, 50)],
      [windowState(12, 30, 100), windowState(19, 20, 25), windowState(21, 20, 25), windowState(20, 20, 25), windowState(22, 20, 25)],
    ]
    let launchIndex = 0
    let snapshotIndex = 0
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") return { stdout: String([19, 20, 21, 22][launchIndex++]) }
      return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: snapshots[snapshotIndex++] }] }]) }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    for (const sessionID of ["one", "two", "three", "four"]) {
      expect(await broker.request({ version: 1, operation: "open", serverUrl: "http://localhost:4096/", directory: "/repo", sessionID, splitDirection: "horizontal", childBias: 40, focusPolicy: "child" })).toMatchObject({ ok: true })
    }
    const launches = calls.filter((argv) => argv[3] === "launch")
    expect(launches.map((argv) => [argv.find((value) => value.startsWith("--next-to=")), argv.find((value) => value.startsWith("--location=")), argv.find((value) => value.startsWith("--bias="))])).toEqual([
      ["--next-to=id:12", "--location=hsplit", "--bias=40"],
      ["--next-to=id:19", "--location=vsplit", "--bias=50"],
      ["--next-to=id:19", "--location=vsplit", "--bias=50"],
      ["--next-to=id:20", "--location=vsplit", "--bias=50"],
    ])
  })

  test("excludes closed or moved managed children from placement anchors while retaining lifecycle tracking", async () => {
    const calls: string[][] = []
    let launchCount = 0
    let originSnapshots = 0
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") return { stdout: String([19, 20][launchCount++]) }
      if (argv[3] === "ls" && argv.length === 4) {
        return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12)] }, { layout: "splits", windows: [windowState(19)] }] }]) }
      }
      originSnapshots += 1
      return {
        stdout:
          originSnapshots === 1
            ? originOnly
            : originSnapshots === 2
              ? withChild
              : originSnapshots === 3
                ? originOnly
                : JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12), windowState(20)] }] }]),
      }
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
    expect(calls.filter((argv) => argv[3] === "launch").at(-1)).toContain("--next-to=id:12")
    expect(await broker.request({ version: 1, operation: "exists", windowID: 19 })).toMatchObject({ exists: true })
  })

  test("falls back to the exact orchestrator when a known child is closed before the next placement", async () => {
    const calls: string[][] = []
    let launchCount = 0
    let originSnapshots = 0
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") return { stdout: String([19, 20][launchCount++]) }
      if (argv[3] === "ls" && argv.length === 4) return { stdout: originOnly }
      originSnapshots += 1
      return {
        stdout:
          originSnapshots === 1
            ? originOnly
            : originSnapshots === 2
              ? withChild
              : originSnapshots === 3
                ? originOnly
                : JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12), windowState(20)] }] }]),
      }
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
    expect(calls.filter((argv) => argv[3] === "launch").at(-1)).toContain("--next-to=id:12")
    expect(await broker.request({ version: 1, operation: "exists", windowID: 19 })).toMatchObject({ exists: false })
  })

  test("rolls back a launch whose selected anchor disappeared and retains its exact ID for shutdown after rollback failure", async () => {
    const closes: string[][] = []
    let launchCount = 0
    const runner: KittyRunner = async (argv) => {
      if (argv[3] === "launch") return { stdout: String([19, 20][launchCount++]) }
      if (argv[3] === "close-window") {
        closes.push([...argv])
        if (argv.includes("--match=id:20") && closes.length === 1) throw new ProcessExecutionError("failed")
        return { stdout: "" }
      }
      if (launchCount === 0) return { stdout: originOnly }
      if (launchCount === 1) return { stdout: withChild }
      return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12), windowState(20)] }] }]) }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    const open = (sessionID: string) =>
      broker.request({
        version: 1,
        operation: "open",
        serverUrl: "http://localhost:4096/",
        directory: "/repo",
        sessionID,
        splitDirection: "vertical",
        childBias: 40,
        focusPolicy: "child",
      })
    expect(await open("one")).toMatchObject({ ok: true, windowID: 19 })
    expect(await open("two")).toMatchObject({ ok: false, error: "kitty-failed" })
    expect(closes[0]).toContain("--match=id:20")
    await broker.request(request("shutdown"))
    expect(closes.map((argv) => argv.find((value) => value.startsWith("--match=id:")))).toEqual([
      "--match=id:20",
      "--match=id:19",
      "--match=id:20",
    ])
  })

  test("keeps a recovered orphan cleanup-managed but never makes it a placement anchor", async () => {
    const calls: string[][] = []
    let launchCount = 0
    let originSnapshots = 0
    const recoveredState = JSON.stringify([
      {
        tabs: [
          {
            layout: "splits",
            windows: [
              windowState(12, 40, 60),
              { ...windowState(19, 40, 40), user_vars: { opencode_kitty_agents_launch: recoveryToken } },
            ],
          },
        ],
      },
    ])
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      if (argv[3] === "launch") {
        launchCount += 1
        if (launchCount === 1) throw new ProcessExecutionError("timeout")
        return { stdout: "20" }
      }
      if (argv[3] === "close-window" && argv.includes("--match=id:19") && calls.filter((call) => call[3] === "close-window").length === 1) {
        throw new ProcessExecutionError("failed")
      }
      if (argv[3] === "ls") {
        originSnapshots += 1
        if (originSnapshots === 1) return { stdout: originOnly }
        if (originSnapshots === 2 || originSnapshots === 3) return { stdout: recoveredState }
        return {
          stdout: JSON.stringify([
            { tabs: [{ layout: "splits", windows: [windowState(12, 40, 60), windowState(19, 40, 40), windowState(20, 40, 20)] }] },
          ]),
        }
      }
      return { stdout: "" }
    }
    const broker = new KittyBroker(brokerOptions, runner)
    const open = (sessionID: string) =>
      broker.request({
        version: 1,
        operation: "open",
        serverUrl: "http://localhost:4096/",
        directory: "/repo",
        sessionID,
        splitDirection: "vertical",
        childBias: 40,
        focusPolicy: "child",
      })
    expect(await open("recovered")).toMatchObject({ ok: false, error: "timeout" })
    expect(await open("presented")).toMatchObject({ ok: true, windowID: 20 })
    expect(calls.filter((argv) => argv[3] === "launch").at(-1)).toEqual(expect.arrayContaining(["--next-to=id:12", "--location=vsplit", "--bias=40"]))
    await broker.request(request("shutdown"))
    expect(calls.filter((argv) => argv[3] === "close-window").map((argv) => argv.find((value) => value.startsWith("--match=id:")))).toEqual([
      "--match=id:19",
      "--match=id:19",
      "--match=id:20",
    ])
  })

  test("rejects unknown IDs and reports unsupported origin layout without changing it", async () => {
    const runner: KittyRunner = async () => ({
      stdout: JSON.stringify([{ tabs: [{ layout: "tall", windows: [windowState(12)] }] }]),
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
          ? JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12), windowState(19), windowState(20)] }] }])
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
      return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12), ...current.map((id) => windowState(id))] }] }]) }
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
      return { stdout: JSON.stringify([{ tabs: [{ layout: "splits", windows: [windowState(12), ...current.map((id) => windowState(id))] }] }]) }
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
