import type { ChildSession } from "../session/types"
import type { PresentationAvailability, PresentationHandle } from "./types"

/**
 * The complete terminal-presentation boundary required by V1. The Kitty
 * implementation owns broker transport details; callers exchange only
 * normalized sessions and non-sensitive window handles.
 */
export interface PresentationAdapter {
  availability(): Promise<PresentationAvailability>
  open(session: ChildSession, serverUrl: URL): Promise<PresentationHandle>
  exists(handle: PresentationHandle): Promise<boolean>
  focus(handle: PresentationHandle): Promise<void>
  /** Closing an already absent window must succeed. */
  close(handle: PresentationHandle): Promise<void>
  /** Disposal must be bounded and idempotent. */
  dispose(): Promise<void>
}
