import { describe, expect, test } from "bun:test"
import { ConfigurationError, DEFAULT_CONFIG, parseConfig } from "../src/config"

describe("configuration", () => {
  test("uses documented defaults for absent and empty options", () => {
    expect(parseConfig()).toEqual(DEFAULT_CONFIG)
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG)
    expect(parseConfig()).not.toBe(DEFAULT_CONFIG)
  })

  test("accepts and preserves every supported override", () => {
    expect(
      parseConfig({
        enabled: false,
        splitDirection: "horizontal",
        childBias: 55.5,
        reconciliationIntervalMs: 12_000,
        focusPolicy: "child",
      }),
    ).toEqual({
      enabled: false,
      splitDirection: "horizontal",
      childBias: 55.5,
      reconciliationIntervalMs: 12_000,
      focusPolicy: "child",
    })
  })

  test("accepts child-bias and reconciliation boundaries", () => {
    expect(parseConfig({ childBias: 1 }).childBias).toBe(1)
    expect(parseConfig({ childBias: 99 }).childBias).toBe(99)
    expect(parseConfig({ reconciliationIntervalMs: 1_000 }).reconciliationIntervalMs).toBe(1_000)
  })

  test.each([
    [null, "options must be an object"],
    [[], "options must be an object"],
    ["enabled", "options must be an object"],
    [{ typo: true }, 'unknown option "typo"'],
    [{ enabled: 1 }, '"enabled" must be a boolean'],
    [{ enabled: null }, '"enabled" must be a boolean'],
    [{ splitDirection: "diagonal" }, '"splitDirection" must be "vertical" or "horizontal"'],
    [{ splitDirection: null }, '"splitDirection" must be "vertical" or "horizontal"'],
    [{ childBias: 0 }, '"childBias" must be a finite number from 1 through 99'],
    [{ childBias: 100 }, '"childBias" must be a finite number from 1 through 99'],
    [{ childBias: "40" }, '"childBias" must be a finite number from 1 through 99'],
    [{ childBias: null }, '"childBias" must be a finite number from 1 through 99'],
    [{ childBias: Number.NaN }, '"childBias" must be a finite number from 1 through 99'],
    [{ childBias: Number.POSITIVE_INFINITY }, '"childBias" must be a finite number from 1 through 99'],
    [{ reconciliationIntervalMs: 999 }, '"reconciliationIntervalMs" must be a safe integer of at least 1000'],
    [{ reconciliationIntervalMs: 1_000.5 }, '"reconciliationIntervalMs" must be a safe integer of at least 1000'],
    [{ reconciliationIntervalMs: null }, '"reconciliationIntervalMs" must be a safe integer of at least 1000'],
    [{ reconciliationIntervalMs: Number.NaN }, '"reconciliationIntervalMs" must be a safe integer of at least 1000'],
    [{ reconciliationIntervalMs: Number.MAX_SAFE_INTEGER + 1 }, '"reconciliationIntervalMs" must be a safe integer of at least 1000'],
    [{ focusPolicy: "active" }, '"focusPolicy" must be "preserve" or "child"'],
    [{ focusPolicy: null }, '"focusPolicy" must be "preserve" or "child"'],
    [{ opencodeExecutable: "opencode" }, 'unknown option "opencodeExecutable"'],
  ] as const)("rejects invalid options %#", (options, message) => {
    expect(() => parseConfig(options as never)).toThrow(ConfigurationError)
    expect(() => parseConfig(options as never)).toThrow(message)
  })
})
