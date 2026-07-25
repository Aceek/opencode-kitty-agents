/**
 * Non-sensitive identity for a broker-managed Kitty window. Broker endpoints and
 * Kitty remote-control capabilities must never be included in this handle.
 */
export type PresentationHandle = Readonly<{
  backend: "kitty"
  windowID: number
  openedAt: number
}>

export type PresentationAvailability =
  | Readonly<{ available: true }>
  | Readonly<{ available: false; reason: "broker-unavailable" | "unsupported-layout" }>

export type PresentationDesiredState = "open" | "closed"
export type PresentationPhase = "discovered" | "opening" | "open" | "closing" | "unavailable"

/** Controller-owned presentation state; it contains no broker control data. */
export type PresentationState = Readonly<{
  desired: PresentationDesiredState
  phase: PresentationPhase
  handle?: PresentationHandle
  /** Sanitized diagnostic text only; never a broker endpoint or capability. */
  lastError?: string
}>
