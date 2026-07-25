import type { PluginOptions } from "@opencode-ai/plugin"

export type SplitDirection = "vertical" | "horizontal"
export type FocusPolicy = "preserve" | "child"

export type PluginConfig = Readonly<{
  enabled: boolean
  splitDirection: SplitDirection
  childBias: number
  reconciliationIntervalMs: number
  focusPolicy: FocusPolicy
}>

export const DEFAULT_CONFIG: PluginConfig = Object.freeze({
  enabled: true,
  splitDirection: "vertical",
  childBias: 40,
  reconciliationIntervalMs: 5_000,
  focusPolicy: "preserve",
})

const CONFIG_KEYS = new Set<keyof PluginConfig>([
  "enabled",
  "splitDirection",
  "childBias",
  "reconciliationIntervalMs",
  "focusPolicy",
])

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid opencode-kitty-agents configuration: ${message}`)
    this.name = "ConfigurationError"
  }
}

function invalid(field: keyof PluginConfig, expectation: string): never {
  throw new ConfigurationError(`"${field}" ${expectation}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseConfig(options?: PluginOptions): PluginConfig {
  if (options === undefined) return { ...DEFAULT_CONFIG }
  if (!isRecord(options)) throw new ConfigurationError("options must be an object")

  for (const key of Object.keys(options)) {
    if (!CONFIG_KEYS.has(key as keyof PluginConfig)) {
      throw new ConfigurationError(`unknown option "${key}"`)
    }
  }

  const enabled = options.enabled === undefined ? DEFAULT_CONFIG.enabled : options.enabled
  if (typeof enabled !== "boolean") invalid("enabled", "must be a boolean")

  const splitDirection =
    options.splitDirection === undefined ? DEFAULT_CONFIG.splitDirection : options.splitDirection
  if (splitDirection !== "vertical" && splitDirection !== "horizontal") {
    invalid("splitDirection", 'must be "vertical" or "horizontal"')
  }

  const childBias = options.childBias === undefined ? DEFAULT_CONFIG.childBias : options.childBias
  if (typeof childBias !== "number" || !Number.isFinite(childBias) || childBias < 1 || childBias > 99) {
    invalid("childBias", "must be a finite number from 1 through 99")
  }

  const reconciliationIntervalMs =
    options.reconciliationIntervalMs === undefined
      ? DEFAULT_CONFIG.reconciliationIntervalMs
      : options.reconciliationIntervalMs
  if (
    typeof reconciliationIntervalMs !== "number" ||
    !Number.isSafeInteger(reconciliationIntervalMs) ||
    reconciliationIntervalMs < 1_000
  ) {
    invalid("reconciliationIntervalMs", "must be a safe integer of at least 1000")
  }

  const focusPolicy = options.focusPolicy === undefined ? DEFAULT_CONFIG.focusPolicy : options.focusPolicy
  if (focusPolicy !== "preserve" && focusPolicy !== "child") {
    invalid("focusPolicy", 'must be "preserve" or "child"')
  }

  return {
    enabled,
    splitDirection,
    childBias,
    reconciliationIntervalMs,
    focusPolicy,
  }
}
