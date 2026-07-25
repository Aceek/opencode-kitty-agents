import { isAbsolute, join, relative, resolve } from "node:path"

export const GATE_VERSION = 1 as const
export const GATE_OPERATION = "probe" as const
export const ENDPOINT_ENV = "OPENCODE_KITTY_GATE0_ENDPOINT"
export const RESULT_FILENAME = "opencode-kitty-agents-gate0-result.json"

export type GateRequest = {
  version: typeof GATE_VERSION
  operation: typeof GATE_OPERATION
}

export type GateResponse = {
  version: typeof GATE_VERSION
  ok: true
  pluginRuntime: true
  capabilityInherited: true
  originQueried: true
  splitLaunched: true
  sameTab: true
  splitClosed: true
}

export type GateFailureCode =
  | "invalid_runtime"
  | "invalid_origin"
  | "unsupported_layout"
  | "missing_capability"
  | "ipc_failed"
  | "opencode_launch_failed"
  | "plugin_timeout"
  | "kitty_probe_failed"

export type GateResult =
  | GateResponse
  | { version: typeof GATE_VERSION; ok: false; failure: GateFailureCode }
  | { version: typeof GATE_VERSION; ok: false; failure: "running" }

const failureCodes = new Set<GateFailureCode | "running">([
  "invalid_runtime",
  "invalid_origin",
  "unsupported_layout",
  "missing_capability",
  "ipc_failed",
  "opencode_launch_failed",
  "plugin_timeout",
  "kitty_probe_failed",
  "running",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

export function parseGateRequest(raw: string): GateRequest {
  if (raw.length > 128) throw new Error("invalid request")
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("invalid request")
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "operation"]) ||
    value.version !== GATE_VERSION ||
    value.operation !== GATE_OPERATION
  ) {
    throw new Error("invalid request")
  }
  return { version: GATE_VERSION, operation: GATE_OPERATION }
}

export function parseGateResponse(raw: string): GateResponse {
  if (raw.length > 512) throw new Error("invalid response")
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("invalid response")
  }
  const keys = [
    "version",
    "ok",
    "pluginRuntime",
    "capabilityInherited",
    "originQueried",
    "splitLaunched",
    "sameTab",
    "splitClosed",
  ] as const
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.version !== GATE_VERSION ||
    value.ok !== true ||
    keys.slice(2).some((key) => value[key] !== true)
  ) {
    throw new Error("invalid response")
  }
  return value as GateResponse
}

export function parseGateResult(raw: string): GateResult {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("invalid result")
  }
  if (!isRecord(value)) throw new Error("invalid result")
  if (value.ok === true) return parseGateResponse(raw)
  if (
    !hasExactKeys(value, ["version", "ok", "failure"]) ||
    value.version !== GATE_VERSION ||
    value.ok !== false ||
    typeof value.failure !== "string" ||
    !failureCodes.has(value.failure as never)
  ) {
    throw new Error("invalid result")
  }
  return value as GateResult
}

export function parseNumericID(raw: string): number {
  const value = raw.trim()
  if (!/^[1-9]\d*$/.test(value)) throw new Error("invalid numeric id")
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw new Error("invalid numeric id")
  return id
}

export function parseInheritedFD(value: string | undefined): number {
  const match = value?.match(/^fd:([1-9]\d*)$/)
  if (!match) throw new Error("missing inherited descriptor")
  const fd = Number(match[1])
  if (!Number.isSafeInteger(fd) || fd < 3) throw new Error("invalid inherited descriptor")
  return fd
}

export function assertPrivateEndpoint(endpoint: string, runtimeDirectory: string): string {
  if (!isAbsolute(endpoint) || !isAbsolute(runtimeDirectory)) throw new Error("invalid endpoint")
  const normalizedRuntime = resolve(runtimeDirectory)
  const normalizedEndpoint = resolve(endpoint)
  const child = relative(normalizedRuntime, normalizedEndpoint)
  if (
    child.startsWith("..") ||
    isAbsolute(child) ||
    !/^opencode-kitty-gate0-[A-Za-z0-9_-]+\/broker\.sock$/.test(child)
  ) {
    throw new Error("invalid endpoint")
  }
  return normalizedEndpoint
}

export function resultPath(runtimeDirectory: string): string {
  return join(runtimeDirectory, RESULT_FILENAME)
}

type KittyWindow = { id: number }
type KittyTab = { layout: string; windows: KittyWindow[] }
type KittyOSWindow = { tabs: KittyTab[] }

function parseKittyTree(raw: string): KittyOSWindow[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("invalid kitty response")
  }
  if (!Array.isArray(value)) throw new Error("invalid kitty response")
  return value.map((osWindow) => {
    if (!isRecord(osWindow) || !Array.isArray(osWindow.tabs)) throw new Error("invalid kitty response")
    return {
      tabs: osWindow.tabs.map((tab) => {
        if (!isRecord(tab) || typeof tab.layout !== "string" || !Array.isArray(tab.windows)) {
          throw new Error("invalid kitty response")
        }
        return {
          layout: tab.layout,
          windows: tab.windows.map((window) => {
            if (!isRecord(window) || !Number.isSafeInteger(window.id) || (window.id as number) < 1) {
              throw new Error("invalid kitty response")
            }
            return { id: window.id as number }
          }),
        }
      }),
    }
  })
}

export function assertWindowsShareTab(
  raw: string,
  expectedIDs: readonly number[],
  requiredLayout?: string,
): void {
  if (expectedIDs.length === 0 || new Set(expectedIDs).size !== expectedIDs.length) {
    throw new Error("invalid expected ids")
  }
  const tree = parseKittyTree(raw)
  const matchingTabs = tree.flatMap((osWindow) => osWindow.tabs).filter((tab) => {
    const ids = new Set(tab.windows.map((window) => window.id))
    return expectedIDs.every((id) => ids.has(id)) && (requiredLayout === undefined || tab.layout === requiredLayout)
  })
  if (matchingTabs.length !== 1) throw new Error("windows do not share exactly one tab")
}
