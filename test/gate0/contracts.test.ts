import { describe, expect, test } from "bun:test"
import {
  assertPrivateEndpoint,
  assertWindowsShareTab,
  parseGateRequest,
  parseGateResult,
  parseGateResponse,
  parseInheritedFD,
  parseNumericID,
} from "./contracts"

describe("Gate 0 contracts", () => {
  test("accepts only the exact versioned request", () => {
    expect(parseGateRequest('{"version":1,"operation":"probe"}')).toEqual({ version: 1, operation: "probe" })
    expect(() => parseGateRequest('{"version":1,"operation":"probe","argv":[]}')).toThrow("invalid request")
    expect(() => parseGateRequest('{"version":2,"operation":"probe"}')).toThrow("invalid request")
  })

  test("accepts only a fully sanitized success response", () => {
    const response = {
      version: 1,
      ok: true,
      pluginRuntime: true,
      capabilityInherited: true,
      originQueried: true,
      splitLaunched: true,
      sameTab: true,
      splitClosed: true,
    } as const
    expect(parseGateResponse(JSON.stringify(response))).toEqual(response)
    expect(parseGateResult(JSON.stringify(response))).toEqual(response)
    expect(parseGateResult('{"version":1,"ok":false,"failure":"plugin_timeout"}')).toEqual({
      version: 1,
      ok: false,
      failure: "plugin_timeout",
    })
    expect(() => parseGateResponse(JSON.stringify({ ...response, windowID: 42 }))).toThrow("invalid response")
    expect(() => parseGateResult('{"version":1,"ok":false,"failure":"plugin_timeout","secret":"x"}')).toThrow()
  })

  test("validates numeric IDs and inherited fd metadata", () => {
    expect(parseNumericID("42\n")).toBe(42)
    expect(parseInheritedFD("fd:9")).toBe(9)
    for (const value of ["0", "-1", "1.5", "active"]) expect(() => parseNumericID(value)).toThrow()
    for (const value of [undefined, "unix:/tmp/socket", "fd:2", "fd:03"]) {
      expect(() => parseInheritedFD(value)).toThrow()
    }
  })

  test("requires a private endpoint directly below the runtime directory", () => {
    expect(assertPrivateEndpoint("/run/user/1000/opencode-kitty-gate0-Ab_12/broker.sock", "/run/user/1000")).toBe(
      "/run/user/1000/opencode-kitty-gate0-Ab_12/broker.sock",
    )
    expect(() => assertPrivateEndpoint("/tmp/broker.sock", "/run/user/1000")).toThrow()
  })

  test("parses only the minimum Kitty tree and proves same-tab membership", () => {
    const tree = JSON.stringify([
      { id: 8, tabs: [{ id: 9, layout: "splits", windows: [{ id: 11 }, { id: 12 }] }] },
    ])
    expect(() => assertWindowsShareTab(tree, [11, 12])).not.toThrow()
    expect(() => assertWindowsShareTab(tree, [11, 12], "splits")).not.toThrow()
    expect(() => assertWindowsShareTab(tree, [11, 12], "tall")).toThrow()
    expect(() => assertWindowsShareTab(tree, [11, 13])).toThrow()
    expect(() => assertWindowsShareTab('{"environment":"must not be accepted"}', [11])).toThrow()
  })
})
