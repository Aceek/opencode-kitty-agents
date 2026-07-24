import { describe, expect, test } from "bun:test"
import plugin from "../src/index"

describe("plugin contract", () => {
  test("exports an OpenCode plugin function", () => {
    expect(plugin).toBeFunction()
  })
})
