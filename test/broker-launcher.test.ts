import { describe, expect, test } from "bun:test"
import { closeLauncherWindow } from "../src/broker/launcher"
import type { KittyRunner } from "../src/broker/kitty"

describe("launcher source cleanup", () => {
  test("closes only the exact disposable launcher window", async () => {
    const calls: string[][] = []
    const runner: KittyRunner = async (argv) => {
      calls.push([...argv])
      return { stdout: "" }
    }

    await closeLauncherWindow(runner, 12)

    expect(calls).toEqual([
      ["/usr/bin/kitten", "@", "--use-password=never", "close-window", "--match=id:12", "--ignore-no-match"],
    ])
  })

  test("contains an exact launcher close failure", async () => {
    const runner: KittyRunner = async () => {
      throw new Error("unavailable")
    }

    await expect(closeLauncherWindow(runner, 12)).resolves.toBeUndefined()
  })
})
