import { describe, expect, test } from "bun:test"
import {
  attachArgv,
  attachLaunchArgv,
  allStateArgv,
  closeWindowArgv,
  focusWindowArgv,
  hasKittyCapability,
  launchWithRecovery,
  minimalOpenCodeEnvironment,
  originStateArgv,
  parseInheritedKittyFD,
  parseKittyTabs,
  parseLaunchWindowID,
  orchestratorLaunchArgv,
  recoverableAddedWindowID,
  requireOriginTab,
  selectChildPlacement,
  validateLaunchedWindow,
  windowExists,
} from "../src/broker/kitty"
import { ProcessExecutionError } from "../src/broker/runner"

const kittyTree = JSON.stringify([
  {
    ignored: "value",
    tabs: [
      {
        layout: "splits",
        windows: [
          { id: 12, lines: 40, columns: 100, title: "origin" },
          { id: 19, lines: 40, columns: 100, env: { OMIT: "secret" } },
        ],
      },
    ],
  },
])

describe("Kitty command boundary", () => {
  test("builds deterministic exact-ID argv with password lookup disabled", () => {
    expect(allStateArgv()).toEqual(["/usr/bin/kitten", "@", "--use-password=never", "ls"])
    expect(originStateArgv(12)).toEqual([
      "/usr/bin/kitten",
      "@",
      "--use-password=never",
      "ls",
      "--match-tab=window_id:12",
    ])
    expect(focusWindowArgv(19)).toEqual([
      "/usr/bin/kitten",
      "@",
      "--use-password=never",
      "focus-window",
      "--match=id:19",
    ])
    expect(closeWindowArgv(19)).toEqual([
      "/usr/bin/kitten",
      "@",
      "--use-password=never",
      "close-window",
      "--match=id:19",
      "--ignore-no-match",
    ])
  })

  test("uses the exact required attach argv and fixed construction-time executable", () => {
    expect(
      attachArgv({
        opencodeExecutable: "/opt/opencode",
        serverUrl: "http://127.0.0.1:4096/",
        directory: "/repo with spaces",
        sessionID: "ses_1",
      }),
    ).toEqual([
      "/opt/opencode",
      "attach",
      "http://127.0.0.1:4096/",
      "--dir",
      "/repo with spaces",
      "--session",
      "ses_1",
    ])
    expect(
      attachLaunchArgv({
        originWindowID: 12,
        anchorWindowID: 19,
        location: "vsplit",
        bias: 50,
        opencodeExecutable: "/opt/opencode",
        serverUrl: "http://127.0.0.1:4096/",
        directory: "/repo with spaces",
        sessionID: "ses_1",
        focusPolicy: "preserve",
        environment: ["HOME=/home/test", "XDG_RUNTIME_DIR=/run/user/1000"],
        recoveryToken: "test-recovery-token-123",
      }),
    ).toEqual([
      "/usr/bin/kitten",
      "@",
      "--use-password=never",
      "launch",
      "--match=window_id:12",
      "--source-window=id:12",
      "--next-to=id:19",
      "--location=vsplit",
      "--bias=50",
      "--keep-focus",
      "--var=opencode_kitty_agents_launch=test-recovery-token-123",
      "--cwd=/repo with spaces",
      "/usr/bin/env",
      "-i",
      "HOME=/home/test",
      "XDG_RUNTIME_DIR=/run/user/1000",
      "/opt/opencode",
      "attach",
      "http://127.0.0.1:4096/",
      "--dir",
      "/repo with spaces",
      "--session",
      "ses_1",
    ])
  })

  test("launches the orchestrator with only the private endpoint and strips Kitty capabilities", () => {
    expect(
      orchestratorLaunchArgv({
        mappingOriginWindowID: 12,
        opencodeExecutable: "/trusted/opencode",
        endpoint: "/run/user/1000/opencode-kitty-agents-random/broker.sock",
        environment: ["HOME=/home/test", "TERM=xterm-kitty"],
        recoveryToken: "test-recovery-token-123",
      }),
    ).toEqual([
      "/usr/bin/kitten",
      "@",
      "--use-password=never",
      "launch",
      "--match=window_id:12",
      "--source-window=id:12",
      "--next-to=id:12",
      "--location=vsplit",
      "--keep-focus",
      "--var=opencode_kitty_agents_launch=test-recovery-token-123",
      "--cwd=current",
      "/usr/bin/env",
      "-i",
      "HOME=/home/test",
      "TERM=xterm-kitty",
      "OPENCODE_KITTY_AGENTS_BROKER_ENDPOINT=/run/user/1000/opencode-kitty-agents-random/broker.sock",
      "/trusted/opencode",
      "--port=0",
    ])
  })

  test("constructs a minimal safe OpenCode environment without credentials or Kitty capabilities", () => {
    expect(
      minimalOpenCodeEnvironment({
        HOME: "/home/test",
        PATH: "/usr/bin",
        XDG_CONFIG_HOME: "/home/test/.config",
        XDG_RUNTIME_DIR: "/run/user/1000",
        OPENCODE_CONFIG: "/home/test/opencode.json",
        OPENCODE_SERVER_PASSWORD: "credential",
        KITTY_LISTEN_ON: "fd:9",
        KITTY_RC_PASSWORD: "kitty-secret",
        RANDOM_SECRET: "other-secret",
      }),
    ).toEqual([
      "TERM=xterm-kitty",
      "COLORTERM=truecolor",
      "HOME=/home/test",
      "PATH=/usr/bin",
      "XDG_CONFIG_HOME=/home/test/.config",
      "XDG_RUNTIME_DIR=/run/user/1000",
      "OPENCODE_CONFIG=/home/test/opencode.json",
    ])
  })

  test("parses only layout, numeric IDs, and positive dimensions", () => {
    expect(parseKittyTabs(kittyTree)).toEqual([
      {
        layout: "splits",
        windowIDs: [12, 19],
        windows: [
          { id: 12, lines: 40, columns: 100 },
          { id: 19, lines: 40, columns: 100 },
        ],
      },
    ])
    expect(requireOriginTab(kittyTree, 12).layout).toBe("splits")
    expect(windowExists(kittyTree, 19)).toBe(true)
    expect(windowExists("[]", 19)).toBe(false)
    expect(() =>
      windowExists(
        JSON.stringify([
          {
            tabs: [
              { layout: "splits", windows: [{ id: 19, lines: 40, columns: 100 }] },
              { layout: "splits", windows: [{ id: 19, lines: 40, columns: 100 }] },
            ],
          },
        ]),
        19,
      ),
    ).toThrow("ambiguous window state")
    expect(() => validateLaunchedWindow(kittyTree, 12, 19)).not.toThrow()
  })

  test.each([
    "not json",
    "{}",
    '[{"tabs":{}}]',
    '[{"tabs":[{"layout":"splits","windows":[{"id":"12"}]}]}]',
    '[{"tabs":[{"layout":"splits","windows":[{"id":12},{"id":12}]}]}]',
    '[{"tabs":[{"layout":"splits","windows":[{"id":12,"lines":0,"columns":100}]}]}]',
    '[{"tabs":[{"layout":"splits","windows":[{"id":12,"lines":40,"columns":1.5}]}]}]',
  ])("rejects malformed or ambiguous Kitty state %#", (raw) => {
    expect(() => parseKittyTabs(raw)).toThrow("invalid kitty state")
  })

  test("requires one exact origin and validates returned IDs", () => {
    expect(parseLaunchWindowID("19\n")).toBe(19)
    expect(() => parseLaunchWindowID("id=19")).toThrow("invalid launch response")
    expect(() => parseLaunchWindowID("0")).toThrow("invalid launch response")
    expect(() => requireOriginTab("[]", 12)).toThrow("origin unavailable")
    expect(() => validateLaunchedWindow(kittyTree, 12, 12)).toThrow("launched window unavailable")
  })

  test("selects readable managed child anchors with deterministic directional tie-breakers", () => {
    const originTab = requireOriginTab(
      JSON.stringify([
        {
          tabs: [
            {
              layout: "splits",
              windows: [
                { id: 12, lines: 50, columns: 100 },
                { id: 19, lines: 30, columns: 120 },
                { id: 20, lines: 40, columns: 80 },
                { id: 21, lines: 40, columns: 90 },
                { id: 22, lines: 20, columns: 200 },
                { id: 23, lines: 40, columns: 90 },
                { id: 24, lines: 35, columns: 120 },
                { id: 25, lines: 35, columns: 120 },
              ],
            },
          ],
        },
      ]),
      12,
    )
    const placementAnchors = new Set([19, 20, 21, 23, 24, 25])
    expect(selectChildPlacement({ originWindowID: 12, splitDirection: "vertical", childBias: 40, placementAnchorWindowIDs: placementAnchors, originTab })).toEqual({
      anchorWindowID: 21,
      location: "hsplit",
      bias: 50,
    })
    expect(selectChildPlacement({ originWindowID: 12, splitDirection: "horizontal", childBias: 40, placementAnchorWindowIDs: placementAnchors, originTab })).toEqual({
      anchorWindowID: 24,
      location: "vsplit",
      bias: 50,
    })
    expect(selectChildPlacement({ originWindowID: 12, splitDirection: "vertical", childBias: 37, placementAnchorWindowIDs: new Set(), originTab })).toEqual({
      anchorWindowID: 12,
      location: "vsplit",
      bias: 37,
    })
    expect(selectChildPlacement({ originWindowID: 12, splitDirection: "horizontal", childBias: 37, placementAnchorWindowIDs: new Set(), originTab })).toEqual({
      anchorWindowID: 12,
      location: "hsplit",
      bias: 37,
    })
  })

  test("recovers only one unambiguous numeric addition with no pre-existing removal", () => {
    const before = requireOriginTab(kittyTree, 12)
    expect(
      recoverableAddedWindowID(
        before,
        JSON.stringify([
          {
            tabs: [
              {
                layout: "splits",
                windows: [
                  { id: 12, lines: 40, columns: 100 },
                  { id: 19, lines: 40, columns: 100 },
                  { id: 20, lines: 40, columns: 100, user_vars: { opencode_kitty_agents_launch: "test-recovery-token-123" } },
                ],
              },
            ],
          },
        ]),
        12,
        "test-recovery-token-123",
      ),
    ).toBe(20)
    expect(
      recoverableAddedWindowID(
        before,
        JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12, lines: 40, columns: 100 }, { id: 20, lines: 40, columns: 100 }, { id: 21, lines: 40, columns: 100 }] }] }]),
        12,
        "test-recovery-token-123",
      ),
    ).toBeUndefined()
    expect(
      recoverableAddedWindowID(
        before,
        JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12, lines: 40, columns: 100 }, { id: 20, lines: 40, columns: 100 }] }] }]),
        12,
        "test-recovery-token-123",
      ),
    ).toBeUndefined()
  })

  test("the shared orchestrator launch path recovers after runner timeout", async () => {
    const before = requireOriginTab(JSON.stringify([{ tabs: [{ layout: "splits", windows: [{ id: 12, lines: 40, columns: 100 }] }] }]), 12)
    const launchArgv = orchestratorLaunchArgv({
      mappingOriginWindowID: 12,
      opencodeExecutable: "/trusted/opencode",
      endpoint: "/run/user/1000/opencode-kitty-agents-random/broker.sock",
      environment: ["HOME=/home/test"],
      recoveryToken: "test-recovery-token-123",
    })
    const calls: string[][] = []
    let attempted = false
    let recoveredWindowID: number | undefined
    const runner = async (argv: readonly string[]) => {
      calls.push([...argv])
      if (!attempted) {
        attempted = true
        throw new ProcessExecutionError("timeout")
      }
      if (argv[3] === "ls") {
        return {
          stdout: JSON.stringify([
            {
              tabs: [
                {
                  layout: "splits",
                  windows: [
                    { id: 12, lines: 40, columns: 100 },
                    { id: 22, lines: 40, columns: 100, user_vars: { opencode_kitty_agents_launch: "test-recovery-token-123" } },
                  ],
                },
              ],
            },
          ]),
        }
      }
      if (argv[3] === "close-window") expect(recoveredWindowID).toBe(22)
      return { stdout: "" }
    }
    await expect(
      launchWithRecovery({
        runner,
        launchArgv,
        before,
        originWindowID: 12,
        recoveryToken: "test-recovery-token-123",
        onRecoveredWindowID: (windowID) => {
          recoveredWindowID = windowID
        },
      }),
    ).rejects.toMatchObject({ code: "timeout" })
    expect(calls.filter((argv) => argv[3] === "close-window")).toHaveLength(1)
    expect(recoveredWindowID).toBe(22)
  })

  test("checks descriptor metadata without returning or exposing its value", () => {
    expect(hasKittyCapability({ KITTY_LISTEN_ON: "fd:9" })).toBe(true)
    expect(hasKittyCapability({})).toBe(false)
    expect(() => parseInheritedKittyFD(undefined)).toThrow("kitty capability unavailable")
    try {
      parseInheritedKittyFD("unix:/sensitive/capability")
    } catch (error) {
      expect(String(error)).not.toContain("sensitive")
    }
  })
})
