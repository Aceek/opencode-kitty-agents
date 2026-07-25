import { afterEach, describe, expect, test } from "bun:test"
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  closeWindowArgv,
  KITTEN,
  kittyStdio,
  opencodeLaunchArgv,
  originQueryArgv,
  sleepLaunchArgv,
  tabQueryArgv,
} from "./kitty"

const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Gate 0 Kitty argv", () => {
  test("uses only passwordless exact-ID ls, launch, and close-window commands", () => {
    expect(originQueryArgv(41)).toEqual([KITTEN, "@", "--use-password=never", "ls", "--match=id:41"])
    expect(tabQueryArgv(41)).toEqual([
      KITTEN,
      "@",
      "--use-password=never",
      "ls",
      "--match-tab=window_id:41",
    ])
    expect(sleepLaunchArgv(41)).toContain("--source-window=id:41")
    expect(sleepLaunchArgv(41)).toContain("--next-to=id:41")
    expect(closeWindowArgv(57)).toEqual([
      KITTEN,
      "@",
      "--use-password=never",
      "close-window",
      "--match=id:57",
      "--ignore-no-match",
    ])
  })

  test("launches OpenCode without forwarding Kitty capabilities", () => {
    const argv = opencodeLaunchArgv({
      mappingOriginID: 41,
      repositoryRoot: "/repo",
      endpoint: "/run/user/1000/opencode-kitty-gate0-random/broker.sock",
      pluginURL: "file:///repo/test/gate0/probe-plugin.ts",
    })
    expect(argv).toContain("--env=KITTY_LISTEN_ON")
    expect(argv).toContain("--match=window_id:41")
    expect(argv).not.toContain("--copy-env")
  })

  test("preserves a high inherited descriptor at the same child fd in Bun", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gate0-fd-"))
    temporaryDirectories.push(directory)
    const marker = join(directory, "marker")
    writeFileSync(marker, "descriptor-preserved")
    const opened: number[] = []
    try {
      let fd = openSync(marker, "r")
      opened.push(fd)
      while (fd < 5) {
        fd = openSync("/dev/null", "r")
        opened.push(fd)
      }
      const process = Bun.spawn(["/usr/bin/cat", `/proc/self/fd/${fd}`], { stdio: kittyStdio(fd) })
      const output = await new Response(process.stdout).text()
      expect(await process.exited).toBe(0)
      expect(output).toBe("descriptor-preserved")
    } finally {
      for (const fd of opened) closeSync(fd)
    }
  })
})
