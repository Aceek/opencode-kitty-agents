import type { FocusPolicy, SplitDirection } from "../config"
import { BROKER_ENDPOINT_ENV } from "./protocol"
import { ProcessExecutionError, runBoundedProcess, type ProcessResult } from "./runner"

export const DEFAULT_KITTEN_EXECUTABLE = "/usr/bin/kitten"
export const ENV_EXECUTABLE = "/usr/bin/env"
const KITTY_COMMANDS = new Set(["ls", "launch", "focus-window", "close-window"] as const)
const RECOVERY_VARIABLE = "opencode_kitty_agents_launch"

export class KittyCapabilityError extends Error {
  constructor() {
    super("kitty capability unavailable")
    this.name = "KittyCapabilityError"
  }
}

export class KittyStateError extends Error {
  constructor(message = "invalid kitty state") {
    super(message)
    this.name = "KittyStateError"
  }
}

export type KittyRunner = (argv: readonly string[]) => Promise<ProcessResult>
export type OpenCodeEnvironment = readonly string[]

const SAFE_OPENCODE_ENVIRONMENT_KEYS = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
] as const

/**
 * Build the fixed, non-credential environment inherited by OpenCode windows.
 * Values come only from this construction-time allowlist, never from IPC.
 */
export function minimalOpenCodeEnvironment(env: Record<string, string | undefined>): OpenCodeEnvironment {
  const entries = ["TERM=xterm-kitty", "COLORTERM=truecolor"]
  for (const key of SAFE_OPENCODE_ENVIRONMENT_KEYS) {
    const value = env[key]
    if (value !== undefined && value.length > 0 && !value.includes("\0")) entries.push(`${key}=${value}`)
  }
  return entries
}

function explicitEnvironmentArgv(environment: OpenCodeEnvironment): string[] {
  if (environment.some((entry) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(entry) || entry.includes("\0"))) {
    throw new KittyStateError("invalid launch environment")
  }
  return [ENV_EXECUTABLE, "-i", ...environment]
}

export function parseInheritedKittyFD(value: string | undefined): number {
  const match = value?.match(/^fd:([1-9]\d*)$/)
  if (!match) throw new KittyCapabilityError()
  const fd = Number(match[1])
  if (!Number.isSafeInteger(fd) || fd < 3) throw new KittyCapabilityError()
  return fd
}

export function hasKittyCapability(env: Record<string, string | undefined>): boolean {
  try {
    parseInheritedKittyFD(env.KITTY_LISTEN_ON)
    return true
  } catch {
    return false
  }
}

export function minimalKittyEnvironment(
  env: Record<string, string | undefined>,
  listenOn: string,
): Record<string, string> {
  const result: Record<string, string> = { KITTY_LISTEN_ON: listenOn }
  for (const key of ["HOME", "PATH", "LANG", "LC_ALL", "XDG_RUNTIME_DIR"] as const) {
    const value = env[key]
    if (value) result[key] = value
  }
  return result
}

export function createKittyRunner(input: {
  inheritedFD: number
  env: Readonly<Record<string, string>>
  timeoutMs?: number
}): KittyRunner {
  return (argv) => runBoundedProcess({ argv, inheritedFD: input.inheritedFD, env: input.env, timeoutMs: input.timeoutMs })
}

function numericID(id: number): number {
  if (!Number.isSafeInteger(id) || id < 1) throw new KittyStateError("invalid numeric id")
  return id
}

function base(executable: string, command: "ls" | "launch" | "focus-window" | "close-window"): string[] {
  if (!KITTY_COMMANDS.has(command)) throw new KittyStateError()
  return [executable, "@", "--use-password=never", command]
}

export function originStateArgv(originWindowID: number, executable = DEFAULT_KITTEN_EXECUTABLE): string[] {
  return [...base(executable, "ls"), `--match-tab=window_id:${numericID(originWindowID)}`]
}

/** Full non-mutating state is required when a managed window may have moved tabs. */
export function allStateArgv(executable = DEFAULT_KITTEN_EXECUTABLE): string[] {
  return base(executable, "ls")
}

export function focusWindowArgv(windowID: number, executable = DEFAULT_KITTEN_EXECUTABLE): string[] {
  return [...base(executable, "focus-window"), `--match=id:${numericID(windowID)}`]
}

export function closeWindowArgv(windowID: number, executable = DEFAULT_KITTEN_EXECUTABLE): string[] {
  return [...base(executable, "close-window"), `--match=id:${numericID(windowID)}`, "--ignore-no-match"]
}

export function attachArgv(input: {
  opencodeExecutable: string
  serverUrl: string
  directory: string
  sessionID: string
}): string[] {
  return [
    input.opencodeExecutable,
    "attach",
    input.serverUrl,
    "--dir",
    input.directory,
    "--session",
    input.sessionID,
  ]
}

export function attachLaunchArgv(input: {
  originWindowID: number
  anchorWindowID: number
  location: KittySplitLocation
  bias: number
  opencodeExecutable: string
  serverUrl: string
  directory: string
  sessionID: string
  focusPolicy: FocusPolicy
  environment: OpenCodeEnvironment
  recoveryToken: string
  kittenExecutable?: string
}): string[] {
  numericID(input.originWindowID)
  const anchor = numericID(input.anchorWindowID)
  if ((input.location !== "vsplit" && input.location !== "hsplit") || !Number.isFinite(input.bias) || input.bias < 1 || input.bias > 99) {
    throw new KittyStateError()
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.recoveryToken)) throw new KittyStateError()
  const origin = input.originWindowID
  return [
    ...base(input.kittenExecutable ?? DEFAULT_KITTEN_EXECUTABLE, "launch"),
    `--match=window_id:${origin}`,
    `--source-window=id:${origin}`,
    `--next-to=id:${anchor}`,
    `--location=${input.location}`,
    `--bias=${input.bias}`,
    ...(input.focusPolicy === "preserve" ? ["--keep-focus"] : []),
    `--var=${RECOVERY_VARIABLE}=${input.recoveryToken}`,
    `--cwd=${input.directory}`,
    ...explicitEnvironmentArgv(input.environment),
    ...attachArgv(input),
  ]
}

export function orchestratorLaunchArgv(input: {
  mappingOriginWindowID: number
  opencodeExecutable: string
  endpoint: string
  environment: OpenCodeEnvironment
  recoveryToken: string
  kittenExecutable?: string
}): string[] {
  const origin = numericID(input.mappingOriginWindowID)
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.recoveryToken)) throw new KittyStateError()
  return [
    ...base(input.kittenExecutable ?? DEFAULT_KITTEN_EXECUTABLE, "launch"),
    `--match=window_id:${origin}`,
    `--source-window=id:${origin}`,
    `--next-to=id:${origin}`,
    "--location=vsplit",
    "--keep-focus",
    `--var=${RECOVERY_VARIABLE}=${input.recoveryToken}`,
    "--cwd=current",
    ...explicitEnvironmentArgv([...input.environment, `${BROKER_ENDPOINT_ENV}=${input.endpoint}`]),
    input.opencodeExecutable,
    "--port=0",
  ]
}

export function parseLaunchWindowID(stdout: string): number {
  const value = stdout.trim()
  if (!/^[1-9]\d*$/.test(value)) throw new KittyStateError("invalid launch response")
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw new KittyStateError("invalid launch response")
  return id
}

export type KittyWindow = Readonly<{ id: number; lines: number; columns: number }>
export type KittyTab = Readonly<{ layout: string; windowIDs: readonly number[]; windows: readonly KittyWindow[] }>
export type KittySplitLocation = "vsplit" | "hsplit"
export type ChildPlacement = Readonly<{ anchorWindowID: number; location: KittySplitLocation; bias: number }>
type ParsedKittyWindow = Readonly<{ id: number; lines: number; columns: number; recoveryToken?: string }>
type ParsedKittyTab = Readonly<{ layout: string; windows: readonly ParsedKittyWindow[] }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseKittyState(raw: string): readonly ParsedKittyTab[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new KittyStateError()
  }
  if (!Array.isArray(value)) throw new KittyStateError()
  const tabs: ParsedKittyTab[] = []
  for (const osWindow of value) {
    if (!isRecord(osWindow) || !Array.isArray(osWindow.tabs)) throw new KittyStateError()
    for (const tab of osWindow.tabs) {
      if (!isRecord(tab) || typeof tab.layout !== "string" || !Array.isArray(tab.windows)) throw new KittyStateError()
      const windows = tab.windows.map((window): ParsedKittyWindow => {
        if (
          !isRecord(window) ||
          !Number.isSafeInteger(window.id) ||
          (window.id as number) < 1 ||
          !Number.isSafeInteger(window.lines) ||
          (window.lines as number) < 1 ||
          !Number.isSafeInteger(window.columns) ||
          (window.columns as number) < 1
        ) {
          throw new KittyStateError()
        }
        const userVars = window.user_vars
        if (userVars !== undefined && !isRecord(userVars)) throw new KittyStateError()
        const recoveryToken = userVars?.[RECOVERY_VARIABLE]
        if (recoveryToken !== undefined && typeof recoveryToken !== "string") throw new KittyStateError()
        return {
          id: window.id as number,
          lines: window.lines as number,
          columns: window.columns as number,
          ...(recoveryToken === undefined ? {} : { recoveryToken }),
        }
      })
      const windowIDs = windows.map((window) => window.id)
      if (new Set(windowIDs).size !== windowIDs.length) throw new KittyStateError()
      tabs.push({ layout: tab.layout, windows })
    }
  }
  return tabs
}

export function parseKittyTabs(raw: string): readonly KittyTab[] {
  return parseKittyState(raw).map((tab) => ({
    layout: tab.layout,
    windowIDs: tab.windows.map((window) => window.id),
    windows: tab.windows.map(({ id, lines, columns }) => ({ id, lines, columns })),
  }))
}

/** Select an anchor from successfully presented children in a sanitized origin snapshot. */
export function selectChildPlacement(input: {
  originWindowID: number
  splitDirection: SplitDirection
  childBias: number
  placementAnchorWindowIDs: ReadonlySet<number>
  originTab: KittyTab
}): ChildPlacement {
  const origin = numericID(input.originWindowID)
  if (!Number.isFinite(input.childBias) || input.childBias < 1 || input.childBias > 99) throw new KittyStateError()
  if (input.splitDirection !== "vertical" && input.splitDirection !== "horizontal") throw new KittyStateError()

  const candidates = input.originTab.windows.filter(
    (window) => window.id !== origin && input.placementAnchorWindowIDs.has(window.id),
  )
  if (candidates.length === 0) {
    return {
      anchorWindowID: origin,
      location: input.splitDirection === "vertical" ? "vsplit" : "hsplit",
      bias: input.childBias,
    }
  }

  const selected = candidates.reduce((best, candidate) => {
    const primary = input.splitDirection === "vertical" ? candidate.lines : candidate.columns
    const bestPrimary = input.splitDirection === "vertical" ? best.lines : best.columns
    const secondary = input.splitDirection === "vertical" ? candidate.columns : candidate.lines
    const bestSecondary = input.splitDirection === "vertical" ? best.columns : best.lines
    if (primary > bestPrimary || (primary === bestPrimary && (secondary > bestSecondary || (secondary === bestSecondary && candidate.id < best.id)))) {
      return candidate
    }
    return best
  })
  return {
    anchorWindowID: selected.id,
    location: input.splitDirection === "vertical" ? "hsplit" : "vsplit",
    bias: 50,
  }
}

export function requireOriginTab(raw: string, originWindowID: number): KittyTab {
  numericID(originWindowID)
  const matches = parseKittyTabs(raw).filter((tab) => tab.windowIDs.includes(originWindowID))
  if (matches.length !== 1) throw new KittyStateError("origin unavailable")
  return matches[0] as KittyTab
}

export function windowExists(raw: string, windowID: number): boolean {
  numericID(windowID)
  const matches = parseKittyTabs(raw).filter((tab) => tab.windowIDs.includes(windowID))
  if (matches.length > 1) throw new KittyStateError("ambiguous window state")
  return matches.length === 1
}

/**
 * Identify one conservatively recoverable window added to the same origin tab.
 * Any removal, duplicate, or multiple addition is ambiguous and returns no ID.
 */
export function recoverableAddedWindowID(
  before: KittyTab,
  afterRaw: string,
  originWindowID: number,
  expectedRecoveryToken: string,
): number | undefined {
  const matchingTabs = parseKittyState(afterRaw).filter((tab) => tab.windows.some((window) => window.id === originWindowID))
  if (matchingTabs.length !== 1) return undefined
  const after = matchingTabs[0] as ParsedKittyTab
  const afterIDs = after.windows.map((window) => window.id)
  if (before.layout !== after.layout || before.windowIDs.some((id) => !afterIDs.includes(id))) return undefined
  const added = after.windows.filter((window) => !before.windowIDs.includes(window.id))
  return added.length === 1 && added[0]?.recoveryToken === expectedRecoveryToken ? added[0].id : undefined
}

/**
 * Run launch and recover a uniquely marked window when the subprocess rejects,
 * times out, or returns malformed stdout. Recovery errors are always contained.
 */
export async function launchWithRecovery(input: {
  runner: KittyRunner
  launchArgv: readonly string[]
  before: KittyTab
  originWindowID: number
  recoveryToken: string
  onRecoveredWindowID?: (windowID: number) => void
  kittenExecutable?: string
}): Promise<number> {
  let result: ProcessResult
  try {
    result = await input.runner(input.launchArgv)
  } catch (error) {
    await recoverFailedLaunch(input)
    throw error
  }
  try {
    return parseLaunchWindowID(result.stdout)
  } catch (error) {
    await recoverFailedLaunch(input)
    throw error
  }
}

async function recoverFailedLaunch(input: {
  runner: KittyRunner
  before: KittyTab
  originWindowID: number
  recoveryToken: string
  onRecoveredWindowID?: (windowID: number) => void
  kittenExecutable?: string
}): Promise<void> {
  try {
    const after = (await input.runner(originStateArgv(input.originWindowID, input.kittenExecutable))).stdout
    const candidate = recoverableAddedWindowID(
      input.before,
      after,
      input.originWindowID,
      input.recoveryToken,
    )
    if (candidate !== undefined) {
      try {
        input.onRecoveredWindowID?.(candidate)
      } catch {
        // Recovery reporting cannot replace the original launch failure or suppress exact-ID close.
      }
      await input.runner(closeWindowArgv(candidate, input.kittenExecutable))
    }
  } catch {
    // Best effort only: never act on missing or ambiguous state.
  }
}

export function validateLaunchedWindow(raw: string, originWindowID: number, childWindowID: number): void {
  const tab = requireOriginTab(raw, originWindowID)
  validateLaunchedWindowInTab(tab, originWindowID, childWindowID)
}

export function validateLaunchedWindowInTab(tab: KittyTab, originWindowID: number, childWindowID: number): void {
  numericID(originWindowID)
  numericID(childWindowID)
  if (!tab.windowIDs.includes(childWindowID) || childWindowID === originWindowID) {
    throw new KittyStateError("launched window unavailable")
  }
}

export function validatePlacementAnchorInTab(tab: KittyTab, anchorWindowID: number): void {
  numericID(anchorWindowID)
  if (!tab.windowIDs.includes(anchorWindowID)) throw new KittyStateError("placement anchor unavailable")
}

export function kittyFailureCode(error: unknown): "timeout" | "kitty-failed" {
  return error instanceof ProcessExecutionError && error.code === "timeout" ? "timeout" : "kitty-failed"
}
