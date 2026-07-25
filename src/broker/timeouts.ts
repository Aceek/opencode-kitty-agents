import { DEFAULT_PROCESS_TIMEOUT_MS } from "./runner"

/**
 * An open uses at most five serialized Kitty subprocesses, including validation,
 * focus restoration, and the worst-case exact-ID rollback close.
 */
export const MAX_KITTY_SUBPROCESSES_PER_BROKER_OPERATION = 5
export const BROKER_OPERATION_SCHEDULING_MARGIN_MS = 5_000
export const BROKER_OPERATION_BUDGET_MS =
  DEFAULT_PROCESS_TIMEOUT_MS * MAX_KITTY_SUBPROCESSES_PER_BROKER_OPERATION +
  BROKER_OPERATION_SCHEDULING_MARGIN_MS

/** Both IPC peers use this larger budget; valid work must finish first. */
export const BROKER_IPC_TIMEOUT_MARGIN_MS = 5_000
export const DEFAULT_BROKER_IPC_TIMEOUT_MS = BROKER_OPERATION_BUDGET_MS + BROKER_IPC_TIMEOUT_MARGIN_MS
