import type { PresentationAdapter } from "./presentation/adapter"
import type { PresentationHandle, PresentationPhase, PresentationState } from "./presentation/types"
import type { ChildSession } from "./session/types"
import type { SessionTrackerSnapshot } from "./session/tracker"

export type ControllerTracker = Readonly<{
  snapshot(): SessionTrackerSnapshot
  subscribe(listener: (snapshot: SessionTrackerSnapshot) => void | Promise<void>): () => void
}>

export type ControllerScheduler = Readonly<{
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}>

export type ControllerFetch = (
  input: string | URL,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Pick<Response, "ok" | "json">>

export type ControllerOptions = Readonly<{
  tracker: ControllerTracker
  adapter: PresentationAdapter
  getServerUrl: () => string | URL
  reconciliationIntervalMs: number
  fetch?: ControllerFetch
  scheduler?: ControllerScheduler
  now?: () => number
  healthTimeoutMs?: number
  disposeTimeoutMs?: number
}>

export type ControllerChildState = Readonly<{
  session: ChildSession
  state: PresentationState
  manualReopenAttempts: number
}>

const DEFAULT_HEALTH_TIMEOUT_MS = 2_000
const DEFAULT_DISPOSE_TIMEOUT_MS = 65_000

const defaultScheduler: ControllerScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

type ManagedChild = {
  session: ChildSession
  phase: PresentationPhase
  handle?: PresentationHandle
  lastError?: string
  nextAttemptAt: number
  manualReopenAttempts: number
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function sameSession(left: ChildSession, right: ChildSession): boolean {
  return (
    left.id === right.id &&
    left.parentID === right.parentID &&
    left.directory === right.directory &&
    left.title === right.title &&
    left.status === right.status
  )
}

/**
 * Serializes desired child membership and presentation lifecycle operations.
 * The tracker remains the sole authority for membership; this class knows no
 * Kitty details and never mutates OpenCode sessions.
 */
export class PresentationController {
  readonly #tracker: ControllerTracker
  readonly #adapter: PresentationAdapter
  readonly #getServerUrl: () => string | URL
  readonly #fetch: ControllerFetch
  readonly #scheduler: ControllerScheduler
  readonly #now: () => number
  readonly #intervalMs: number
  readonly #healthTimeoutMs: number
  readonly #disposeTimeoutMs: number
  readonly #children = new Map<string, ManagedChild>()
  readonly #activeHealth = new Set<AbortController>()
  readonly #interval: unknown
  readonly #unsubscribe: () => void
  #tail: Promise<void> = Promise.resolve()
  #pendingSnapshot?: SessionTrackerSnapshot
  #snapshotQueued = false
  #maintenanceQueued = false
  #accepting = true
  #acceptedRevision = -1
  #disposePromise?: Promise<void>

  constructor(options: ControllerOptions) {
    this.#intervalMs = positiveSafeInteger(options.reconciliationIntervalMs, "reconciliation interval")
    this.#healthTimeoutMs = positiveSafeInteger(options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS, "health timeout")
    this.#disposeTimeoutMs = positiveSafeInteger(options.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS, "dispose timeout")
    this.#tracker = options.tracker
    this.#adapter = options.adapter
    this.#getServerUrl = options.getServerUrl
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init))
    this.#scheduler = options.scheduler ?? defaultScheduler
    this.#now = options.now ?? Date.now
    this.#unsubscribe = this.#tracker.subscribe((snapshot) => this.acceptSnapshot(snapshot))
    this.#interval = this.#scheduler.setInterval(() => this.#requestMaintenance(), this.#intervalMs)
    this.acceptSnapshot(this.#tracker.snapshot())
  }

  /** Non-blocking and rejection-contained for tracker subscriber use. */
  acceptSnapshot(snapshot: SessionTrackerSnapshot): void {
    if (!this.#accepting) return
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision <= this.#acceptedRevision) return
    this.#acceptedRevision = snapshot.revision
    this.#pendingSnapshot = snapshot
    if (this.#snapshotQueued) return
    this.#snapshotQueued = true
    this.#enqueue(async () => {
      while (this.#accepting && this.#pendingSnapshot) {
        const next = this.#pendingSnapshot
        this.#pendingSnapshot = undefined
        await this.#applySnapshot(next)
      }
      this.#snapshotQueued = false
      if (this.#accepting && this.#pendingSnapshot) this.acceptSnapshot(this.#pendingSnapshot)
    })
  }

  snapshot(): readonly ControllerChildState[] {
    return Object.freeze(
      [...this.#children.values()]
        .map((child) =>
          Object.freeze({
            session: child.session,
            state: Object.freeze({
              desired: "open" as const,
              phase: child.phase,
              ...(child.handle ? { handle: child.handle } : {}),
              ...(child.lastError ? { lastError: child.lastError } : {}),
            }),
            manualReopenAttempts: child.manualReopenAttempts,
          }),
        )
        .sort((left, right) => left.session.id.localeCompare(right.session.id)),
    )
  }

  /** Testable explicit reconciliation; periodic calls are coalesced. */
  reconcile(): Promise<void> {
    if (!this.#accepting) return Promise.resolve()
    return this.#enqueue(() => this.#maintain())
  }

  ready(): Promise<void> {
    return this.#tail
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#accepting = false
    this.#pendingSnapshot = undefined
    this.#scheduler.clearInterval(this.#interval)
    this.#unsubscribe()
    for (const controller of this.#activeHealth) controller.abort()
    const deadline = this.#now() + this.#disposeTimeoutMs
    this.#disposePromise = (async () => {
      await this.#withinDeadline(this.#tail, deadline)
      const handles = [...this.#children.values()].flatMap((child) => (child.handle ? [child.handle] : []))
      this.#children.clear()
      await this.#closeAll(handles, deadline)
      // Invocation is guaranteed even when the global deadline has expired.
      // The adapter/broker owns bounded best-effort continuation from here;
      // controller disposal does not extend its one absolute deadline.
      await this.#withinDeadline(Promise.resolve().then(() => this.#adapter.dispose()), deadline)
    })()
    return this.#disposePromise
  }

  #requestMaintenance(): void {
    if (!this.#accepting || this.#maintenanceQueued) return
    this.#maintenanceQueued = true
    this.#enqueue(async () => {
      this.#maintenanceQueued = false
      await this.#maintain()
    })
  }

  #enqueue(operation: () => void | Promise<void>): Promise<void> {
    if (!this.#accepting) return Promise.resolve()
    const run = this.#tail.then(async () => {
      try {
        await operation()
      } catch {
        // Presentation and health failures are represented only by bounded,
        // non-sensitive controller reason codes.
      }
    })
    this.#tail = run.then(() => undefined, () => undefined)
    return run
  }

  async #applySnapshot(snapshot: SessionTrackerSnapshot): Promise<void> {
    if (!this.#accepting) return
    const desired = new Map(snapshot.sessions.map((session) => [session.id, session]))
    for (const [id, child] of [...this.#children]) {
      if (!this.#accepting) return
      const session = desired.get(id)
      if (session) {
        if (!sameSession(child.session, session)) child.session = session
        desired.delete(id)
        continue
      }
      this.#children.delete(id)
      if (child.handle) {
        await this.#safeClose(child.handle)
        // Disposal may have timed out this snapshot operation and cleared the
        // map while close was pending. Never let stale work mutate it again.
        if (!this.#accepting) return
      }
    }
    for (const session of desired.values()) {
      if (!this.#accepting) return
      this.#children.set(session.id, {
        session,
        phase: "discovered",
        nextAttemptAt: 0,
        manualReopenAttempts: 0,
      })
    }
    if (!this.#accepting) return
    // Snapshot traffic can be much more frequent than the configured poll
    // interval. It may open newly desired children, but exact-ID existence
    // checks remain periodic rather than event-driven.
    await this.#maintain(false)
  }

  async #maintain(pollExisting = true): Promise<void> {
    for (const child of this.#children.values()) {
      if (!this.#accepting) return
      if (child.handle) {
        if (!pollExisting) continue
        let exists: boolean
        try {
          exists = await this.#adapter.exists(child.handle)
        } catch {
          child.phase = "unavailable"
          child.lastError = "exists-failed"
          continue
        }
        if (exists) {
          child.phase = "open"
          child.lastError = undefined
          continue
        }
        child.handle = undefined
        child.phase = "unavailable"
        child.lastError = "window-closed"
        if (child.manualReopenAttempts >= 1) {
          child.nextAttemptAt = Number.POSITIVE_INFINITY
          continue
        }
        child.manualReopenAttempts += 1
        // exists() can consume most of a broker timeout. Delay replacement
        // from actual detection completion, not from maintenance start.
        child.nextAttemptAt = this.#now() + this.#intervalMs
        continue
      }
      if (this.#now() < child.nextAttemptAt) continue
      await this.#tryOpen(child)
    }
  }

  async #tryOpen(child: ManagedChild): Promise<void> {
    child.phase = "opening"
    let availability
    try {
      availability = await this.#adapter.availability()
    } catch {
      this.#unavailable(child, "adapter-unavailable")
      return
    }
    if (!this.#accepting) return
    if (!availability.available) {
      this.#unavailable(child, availability.reason)
      return
    }

    const serverUrl = this.#readServerUrl()
    if (!serverUrl) {
      this.#unavailable(child, "server-unavailable")
      return
    }
    const healthy = await this.#health(serverUrl)
    if (!this.#accepting) return
    if (!healthy) {
      this.#unavailable(child, "server-unavailable")
      return
    }

    let handle: PresentationHandle
    try {
      handle = await this.#adapter.open(child.session, serverUrl)
    } catch {
      this.#unavailable(child, "open-failed")
      return
    }
    if (!this.#accepting || this.#children.get(child.session.id) !== child) {
      await this.#safeClose(handle)
      return
    }
    child.handle = handle
    child.phase = "open"
    child.lastError = undefined
  }

  #readServerUrl(): URL | undefined {
    try {
      const url = new URL(this.#getServerUrl())
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined
      return url
    } catch {
      return undefined
    }
  }

  async #health(serverUrl: URL): Promise<boolean> {
    const controller = new AbortController()
    this.#activeHealth.add(controller)
    let timeout: ReturnType<typeof setTimeout> | undefined
    let removeAbortListener: () => void = () => undefined
    try {
      const health = new URL("/global/health", serverUrl)
      const request = Promise.resolve().then(async () => {
        const response = await this.#fetch(health, {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        })
        if (!response.ok) return undefined
        return response.json()
      }).catch(() => undefined)
      const deadline = new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, this.#healthTimeoutMs)
      })
      const aborted = new Promise<undefined>((resolve) => {
        const onAbort = () => resolve(undefined)
        controller.signal.addEventListener("abort", onAbort, { once: true })
        removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort)
      })
      const body = await Promise.race([request, deadline, aborted])
      return (
        typeof body === "object" &&
        body !== null &&
        !Array.isArray(body) &&
        (body as Record<string, unknown>).healthy === true &&
        typeof (body as Record<string, unknown>).version === "string" &&
        ((body as Record<string, unknown>).version as string).trim().length > 0
      )
    } catch {
      return false
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      removeAbortListener()
      this.#activeHealth.delete(controller)
    }
  }

  #unavailable(child: ManagedChild, reason: string): void {
    child.phase = "unavailable"
    child.lastError = reason
    child.nextAttemptAt = this.#now() + this.#intervalMs
  }

  async #safeClose(handle: PresentationHandle): Promise<void> {
    try {
      await this.#adapter.close(handle)
    } catch {
      // A missing window and adapter failure are both terminal for this handle.
    }
  }

  async #closeAll(handles: readonly PresentationHandle[], deadline: number): Promise<void> {
    // The broker accepts one request at a time. Serial cleanup is therefore the
    // bounded concurrency policy; broker shutdown handles IDs left at deadline.
    for (const handle of handles) {
      if (this.#now() >= deadline) return
      await this.#withinDeadline(this.#safeClose(handle), deadline)
    }
  }

  async #withinDeadline(operation: Promise<unknown>, deadline: number): Promise<void> {
    const remaining = deadline - this.#now()
    if (remaining <= 0) {
      void operation.catch(() => undefined)
      return
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, remaining)
      }),
    ])
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
