import type { FocusPolicy, SplitDirection } from "../config"

export const BROKER_PROTOCOL_VERSION = 1 as const
export const BROKER_ENDPOINT_ENV = "OPENCODE_KITTY_AGENTS_BROKER_ENDPOINT"
export const MAX_BROKER_MESSAGE_BYTES = 16_384

export type BrokerOperation = "availability" | "open" | "exists" | "focus" | "close" | "shutdown"
export type BrokerErrorCode =
  | "invalid-request"
  | "broker-unavailable"
  | "unsupported-layout"
  | "unknown-window"
  | "kitty-failed"
  | "timeout"
  | "shutting-down"

export type BrokerRequest =
  | Readonly<{ version: 1; operation: "availability" }>
  | Readonly<{
      version: 1
      operation: "open"
      serverUrl: string
      directory: string
      sessionID: string
      splitDirection: SplitDirection
      childBias: number
      focusPolicy: FocusPolicy
    }>
  | Readonly<{ version: 1; operation: "exists" | "focus" | "close"; windowID: number }>
  | Readonly<{ version: 1; operation: "shutdown" }>

export type BrokerSuccess =
  | Readonly<{ version: 1; operation: "availability"; ok: true; available: true }>
  | Readonly<{
      version: 1
      operation: "availability"
      ok: true
      available: false
      reason: "broker-unavailable" | "unsupported-layout"
    }>
  | Readonly<{ version: 1; operation: "open"; ok: true; windowID: number }>
  | Readonly<{ version: 1; operation: "exists"; ok: true; exists: boolean }>
  | Readonly<{ version: 1; operation: "focus" | "close" | "shutdown"; ok: true }>

export type BrokerFailure = Readonly<{
  version: 1
  operation?: BrokerOperation
  ok: false
  error: BrokerErrorCode
}>

export type BrokerResponse = BrokerSuccess | BrokerFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function parseJSON(raw: string, kind: "request" | "response"): Record<string, unknown> {
  if (new TextEncoder().encode(raw).byteLength > MAX_BROKER_MESSAGE_BYTES) throw new Error(`invalid broker ${kind}`)
  try {
    const value: unknown = JSON.parse(raw)
    if (isRecord(value)) return value
  } catch {
    // Collapse syntax and shape failures into a non-sensitive protocol error.
  }
  throw new Error(`invalid broker ${kind}`)
}

function validID(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0")
}

function validServerURL(value: unknown): value is string {
  if (!validText(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
  } catch {
    return false
  }
}

export function parseBrokerRequest(raw: string): BrokerRequest {
  const value = parseJSON(raw, "request")
  if (value.version !== BROKER_PROTOCOL_VERSION || typeof value.operation !== "string") {
    throw new Error("invalid broker request")
  }
  switch (value.operation) {
    case "availability":
    case "shutdown":
      if (!hasExactKeys(value, ["version", "operation"])) throw new Error("invalid broker request")
      return value as BrokerRequest
    case "exists":
    case "focus":
    case "close":
      if (!hasExactKeys(value, ["version", "operation", "windowID"]) || !validID(value.windowID)) {
        throw new Error("invalid broker request")
      }
      return value as BrokerRequest
    case "open":
      if (
        !hasExactKeys(value, [
          "version",
          "operation",
          "serverUrl",
          "directory",
          "sessionID",
          "splitDirection",
          "childBias",
          "focusPolicy",
        ]) ||
        !validServerURL(value.serverUrl) ||
        !validText(value.directory) ||
        !validText(value.sessionID) ||
        (value.splitDirection !== "vertical" && value.splitDirection !== "horizontal") ||
        typeof value.childBias !== "number" ||
        !Number.isFinite(value.childBias) ||
        value.childBias < 1 ||
        value.childBias > 99 ||
        (value.focusPolicy !== "preserve" && value.focusPolicy !== "child")
      ) {
        throw new Error("invalid broker request")
      }
      return value as BrokerRequest
    default:
      throw new Error("invalid broker request")
  }
}

const operations = new Set<BrokerOperation>(["availability", "open", "exists", "focus", "close", "shutdown"])
const errors = new Set<BrokerErrorCode>([
  "invalid-request",
  "broker-unavailable",
  "unsupported-layout",
  "unknown-window",
  "kitty-failed",
  "timeout",
  "shutting-down",
])

export function parseBrokerResponse(raw: string): BrokerResponse {
  const value = parseJSON(raw, "response")
  if (value.version !== BROKER_PROTOCOL_VERSION || typeof value.ok !== "boolean") {
    throw new Error("invalid broker response")
  }
  if (value.ok === false) {
    const keys = value.operation === undefined ? ["version", "ok", "error"] : ["version", "operation", "ok", "error"]
    if (
      !hasExactKeys(value, keys) ||
      !errors.has(value.error as BrokerErrorCode) ||
      (value.operation !== undefined && !operations.has(value.operation as BrokerOperation))
    ) {
      throw new Error("invalid broker response")
    }
    return value as BrokerFailure
  }
  if (typeof value.operation !== "string" || !operations.has(value.operation as BrokerOperation)) {
    throw new Error("invalid broker response")
  }
  if (value.operation === "availability") {
    if (value.available === true && hasExactKeys(value, ["version", "operation", "ok", "available"])) {
      return value as BrokerSuccess
    }
    if (
      value.available === false &&
      (value.reason === "broker-unavailable" || value.reason === "unsupported-layout") &&
      hasExactKeys(value, ["version", "operation", "ok", "available", "reason"])
    ) {
      return value as BrokerSuccess
    }
    throw new Error("invalid broker response")
  }
  if (value.operation === "open") {
    if (!hasExactKeys(value, ["version", "operation", "ok", "windowID"]) || !validID(value.windowID)) {
      throw new Error("invalid broker response")
    }
    return value as BrokerSuccess
  }
  if (value.operation === "exists") {
    if (!hasExactKeys(value, ["version", "operation", "ok", "exists"]) || typeof value.exists !== "boolean") {
      throw new Error("invalid broker response")
    }
    return value as BrokerSuccess
  }
  if (!hasExactKeys(value, ["version", "operation", "ok"])) throw new Error("invalid broker response")
  return value as BrokerSuccess
}
