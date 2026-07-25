import { describe, expect, test } from "bun:test"
import {
  BROKER_PROTOCOL_VERSION,
  parseBrokerRequest,
  parseBrokerResponse,
} from "../src/broker/protocol"

const openRequest = {
  version: BROKER_PROTOCOL_VERSION,
  operation: "open",
  serverUrl: "http://127.0.0.1:4096/",
  directory: "/work/tree",
  sessionID: "ses_child",
  splitDirection: "vertical",
  childBias: 40,
  focusPolicy: "preserve",
} as const

describe("broker protocol", () => {
  test("accepts only the narrow versioned operation shapes", () => {
    expect(parseBrokerRequest(JSON.stringify({ version: 1, operation: "availability" }))).toEqual({
      version: 1,
      operation: "availability",
    })
    expect(parseBrokerRequest(JSON.stringify(openRequest))).toEqual(openRequest)
    expect(parseBrokerRequest('{"version":1,"operation":"close","windowID":42}')).toEqual({
      version: 1,
      operation: "close",
      windowID: 42,
    })
  })

  const invalidRequests: unknown[] = [
    {},
    { version: 2, operation: "availability" },
    { version: 1, operation: "launch", argv: ["sh", "-c", "id"] },
    { version: 1, operation: "focus", windowID: "42" },
    { version: 1, operation: "close", windowID: -1 },
    { ...openRequest, executable: "/tmp/program" },
    { ...openRequest, match: "all" },
    { ...openRequest, env: { SECRET: "value" } },
    { ...openRequest, serverUrl: "http://user:password@127.0.0.1/" },
    { ...openRequest, splitDirection: "diagonal" },
  ]

  test.each(invalidRequests)("rejects arbitrary commands, matches, executables, env, and malformed input %#", (value) => {
    expect(() => parseBrokerRequest(JSON.stringify(value))).toThrow("invalid broker request")
  })

  test("strictly validates operation-specific responses", () => {
    expect(parseBrokerResponse('{"version":1,"operation":"open","ok":true,"windowID":9}')).toEqual({
      version: 1,
      operation: "open",
      ok: true,
      windowID: 9,
    })
    expect(() =>
      parseBrokerResponse('{"version":1,"operation":"open","ok":true,"windowID":9,"endpoint":"secret"}'),
    ).toThrow("invalid broker response")
    expect(() => parseBrokerResponse('{"version":1,"operation":"exists","ok":true,"exists":1}')).toThrow(
      "invalid broker response",
    )
  })

  test("protocol errors never reproduce input content", () => {
    const sensitive = "super-secret-value"
    try {
      parseBrokerRequest(`not-json-${sensitive}`)
      throw new Error("expected failure")
    } catch (error) {
      expect(String(error)).not.toContain(sensitive)
    }
  })
})
