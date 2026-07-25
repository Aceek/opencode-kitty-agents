import type { ChildSession, ChildSessionStatus } from "./types"

type SdkResult = Readonly<{
  data?: unknown
  error?: unknown
}>

export type SessionTrackerClient = Readonly<{
  list(options: SessionTrackerRequestOptions): Promise<SdkResult>
  status(options: SessionTrackerRequestOptions): Promise<SdkResult>
}>

export type SessionTrackerRequestOptions = Readonly<{ signal: AbortSignal }>

export type SessionTrackerSnapshot = Readonly<{
  revision: number
  sessions: readonly ChildSession[]
}>

export type SessionTrackerListener = (snapshot: SessionTrackerSnapshot) => void | Promise<void>

export type SessionTrackerScheduler = Readonly<{
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}>

export type SessionTrackerOptions = Readonly<{
  client: SessionTrackerClient
  reconciliationIntervalMs: number
  sdkCallTimeoutMs?: number
  disposeTimeoutMs?: number
  scheduler?: SessionTrackerScheduler
}>

type SessionInfo = Readonly<{
  id: string
  parentID?: string
  directory: string
  title: string
}>

type ChildSessionInfo = SessionInfo & Readonly<{ parentID: string }>

type TrackedSession = Readonly<{
  info: ChildSessionInfo
  status?: ChildSessionStatus
}>

type RootIntent =
  | Readonly<{ kind: "created"; sourceSessionID: string; rootID: string }>
  | Readonly<{ kind: "status"; sourceSessionID: string }>

const DEFAULT_DISPOSE_TIMEOUT_MS = 1_000
const DEFAULT_SDK_CALL_TIMEOUT_MS = 10_000

const defaultScheduler: SessionTrackerScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function normalizeInfo(value: unknown): SessionInfo | undefined {
  if (!isRecord(value)) return undefined
  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.directory) ||
    typeof value.title !== "string"
  ) {
    return undefined
  }
  if (value.parentID !== undefined && !nonEmptyString(value.parentID)) return undefined
  return Object.freeze({
    id: value.id,
    ...(value.parentID === undefined ? {} : { parentID: value.parentID }),
    directory: value.directory,
    title: value.title,
  })
}

function normalizeStatus(value: unknown): ChildSessionStatus | undefined {
  if (!isRecord(value)) return undefined
  return value.type === "idle" || value.type === "busy" || value.type === "retry" ? value.type : undefined
}

function isChildInfo(info: SessionInfo): info is ChildSessionInfo {
  return info.parentID !== undefined
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

function sameSessions(left: readonly ChildSession[], right: readonly ChildSession[]): boolean {
  return left.length === right.length && left.every((session, index) => sameSession(session, right[index]!))
}

/**
 * Tracks immediate children of the active orchestrator root without knowing
 * how they are presented. Live events select scope; list/status snapshots are
 * authoritative only within that selected scope.
 */
export class SessionTracker {
  readonly #client: SessionTrackerClient
  readonly #scheduler: SessionTrackerScheduler
  readonly #disposeTimeoutMs: number
  readonly #sdkCallTimeoutMs: number
  readonly #listeners = new Set<SessionTrackerListener>()
  readonly #activeRequests = new Set<AbortController>()
  readonly #eventReconcileSessionIDs = new Set<string>()
  readonly #rootIntents = new Map<string, RootIntent>()
  readonly #pendingEligibilityByRoot = new Map<string, Set<string>>()
  readonly #knownActiveChildIDs = new Set<string>()
  readonly #eligibleChildIDs = new Set<string>()
  readonly #sessions = new Map<string, TrackedSession>()
  readonly #interval: unknown
  readonly #startup: Promise<boolean>
  #tail: Promise<void> = Promise.resolve()
  #snapshot: SessionTrackerSnapshot = Object.freeze({ revision: 0, sessions: Object.freeze([]) })
  #accepting = true
  #commitsAllowed = true
  #activeRootID?: string
  #scopeGeneration = 0
  #reconcilePromise?: Promise<boolean>
  #disposePromise?: Promise<void>

  constructor(options: SessionTrackerOptions) {
    if (!Number.isSafeInteger(options.reconciliationIntervalMs) || options.reconciliationIntervalMs <= 0) {
      throw new Error("reconciliation interval must be a positive safe integer")
    }
    const disposeTimeoutMs = options.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS
    if (!Number.isSafeInteger(disposeTimeoutMs) || disposeTimeoutMs <= 0) {
      throw new Error("dispose timeout must be a positive safe integer")
    }
    const sdkCallTimeoutMs = options.sdkCallTimeoutMs ?? DEFAULT_SDK_CALL_TIMEOUT_MS
    if (!Number.isSafeInteger(sdkCallTimeoutMs) || sdkCallTimeoutMs <= 0) {
      throw new Error("SDK call timeout must be a positive safe integer")
    }

    this.#client = options.client
    this.#scheduler = options.scheduler ?? defaultScheduler
    this.#disposeTimeoutMs = disposeTimeoutMs
    this.#sdkCallTimeoutMs = sdkCallTimeoutMs
    this.#interval = this.#scheduler.setInterval(() => {
      void this.reconcile()
    }, options.reconciliationIntervalMs)
    this.#startup = this.reconcile()
  }

  snapshot(): SessionTrackerSnapshot {
    return this.#snapshot
  }

  subscribe(listener: SessionTrackerListener): () => void {
    if (!this.#accepting) return () => undefined
    this.#listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#listeners.delete(listener)
    }
  }

  async ready(): Promise<void> {
    await this.#startup
  }

  handleEvent(event: unknown): Promise<boolean> {
    this.#invalidateStaleReconciliation(event)
    let reconciliationRequested = false
    const mutation = this.#enqueue(() => {
      if (!isRecord(event) || typeof event.type !== "string" || !isRecord(event.properties)) return

      if (event.type === "session.created") {
        const info = normalizeInfo(event.properties.info)
        if (!info) return
        // A direct child may itself create children. Those descendants must not
        // be mistaken for another orchestrator tree or replace the active root.
        if (isChildInfo(info) && this.#isKnownImmediateChild(info.parentID)) return
        const candidateRootID = info.parentID ?? info.id
        this.#addRootIntent({ kind: "created", sourceSessionID: info.id, rootID: candidateRootID })
        if (isChildInfo(info)) this.#addPendingEligibility(info.parentID, info.id)
        this.#eventReconcileSessionIDs.add(info.id)
        reconciliationRequested = true
        if (!isChildInfo(info)) {
          return
        }
        // A creation event can still reduce latency within the already-active
        // scope. A candidate switch cannot mutate published membership until a
        // successful authoritative list commits it atomically.
        if (info.parentID !== this.#activeRootID) return
        this.#knownActiveChildIDs.add(info.id)
        this.#eligibleChildIDs.add(info.id)
        const current = this.#sessions.get(info.id)
        this.#sessions.set(info.id, { info, ...(current?.status === undefined ? {} : { status: current.status }) })
        return
      }

      if (event.type === "session.deleted") {
        const info = normalizeInfo(event.properties.info)
        if (!info) return
        this.#removeRootIntentsForSource(info.id)
        this.#eventReconcileSessionIDs.delete(info.id)
        if (!isChildInfo(info)) {
          this.#removeRootIntentsForRoot(info.id)
          this.#pendingEligibilityByRoot.delete(info.id)
          if (info.id !== this.#activeRootID) return
          this.#activeRootID = undefined
          this.#knownActiveChildIDs.clear()
          this.#eligibleChildIDs.clear()
          this.#sessions.clear()
          this.#publishIfChanged()
          return
        }
        this.#removePendingEligibility(info.parentID, info.id)
        if (info.parentID !== this.#activeRootID) return
        this.#knownActiveChildIDs.delete(info.id)
        this.#eligibleChildIDs.delete(info.id)
        this.#sessions.delete(info.id)
        this.#publishIfChanged()
        return
      }

      if (event.type === "session.status") {
        const sessionID = event.properties.sessionID
        const status = normalizeStatus(event.properties.status)
        if (!nonEmptyString(sessionID) || !status) return
        const current = this.#sessions.get(sessionID)
        if (!current) {
          if (sessionID === this.#activeRootID) return
          this.#addRootIntent({ kind: "status", sourceSessionID: sessionID })
          this.#eventReconcileSessionIDs.add(sessionID)
          reconciliationRequested = true
          return
        }
        this.#sessions.set(sessionID, { info: current.info, status })
        this.#publishIfChanged()
      }
    })
    return mutation.then((accepted) => {
      if (!accepted || !reconciliationRequested) return accepted
      // This runs only after the serialized event mutation has left the queue,
      // avoiding recursive queue waits while still coalescing duplicate events.
      return this.#requestReconcile(true)
    })
  }

  reconcile(): Promise<boolean> {
    return this.#requestReconcile()
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#accepting = false
    this.#commitsAllowed = false
    this.#scheduler.clearInterval(this.#interval)
    this.#listeners.clear()
    for (const controller of this.#activeRequests) controller.abort()
    const pending = this.#tail
    this.#disposePromise = new Promise<void>((resolve) => {
      let settled = false
      const finish = (timedOut: boolean) => {
        if (settled) return
        settled = true
        if (timedOut) this.#commitsAllowed = false
        clearTimeout(timeout)
        resolve()
      }
      const timeout = setTimeout(() => finish(true), this.#disposeTimeoutMs)
      void pending.then(
        () => finish(false),
        () => finish(false),
      )
    })
    return this.#disposePromise
  }

  #enqueue(operation: () => void | Promise<void>): Promise<boolean> {
    if (!this.#accepting) return Promise.resolve(false)
    const run = this.#tail.then(async () => {
      if (!this.#commitsAllowed) return
      try {
        await operation()
      } catch {
        // Hook and SDK failures are intentionally contained and not logged. SDK
        // error objects may include request or authentication details.
      }
    })
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run.then(() => true)
  }

  #requestReconcile(eventOnly = false): Promise<boolean> {
    if (!this.#accepting) return Promise.resolve(false)
    if (this.#reconcilePromise) return this.#reconcilePromise

    // Capture at request time rather than queue execution time. A root deletion
    // can invalidate work synchronously even when its serialized mutation is
    // queued behind that reconciliation.
    const generation = this.#scopeGeneration
    const queued = this.#enqueue(() => {
      const hasEventReason = this.#eventReconcileSessionIDs.size > 0
      this.#eventReconcileSessionIDs.clear()
      if (eventOnly && !hasEventReason) return
      return this.#reconcileInternal(generation)
    })
    let shared!: Promise<boolean>
    shared = queued.then((accepted) => {
      if (this.#reconcilePromise === shared) this.#reconcilePromise = undefined
      return accepted
    })
    this.#reconcilePromise = shared
    return shared
  }

  async #reconcileInternal(generation: number): Promise<void> {
    if (!this.#reconciliationCanCommit(generation)) return
    const list = await this.#readSdk((signal) => this.#client.list({ signal }))
    if (!this.#reconciliationCanCommit(generation)) return
    const statuses = await this.#readSdk((signal) => this.#client.status({ signal }))
    if (!this.#reconciliationCanCommit(generation)) return
    const statusSucceeded = isRecord(statuses)

    if (!Array.isArray(list)) {
      // List failure cannot alter membership or consume pending root/eligibility
      // intent. A successful status snapshot can still update current eligible
      // children, including the established missing-implies-idle behavior.
      if (statusSucceeded) {
        if (!this.#reconciliationCanCommit(generation)) return
        this.#applyStatusesToCurrent(statuses)
        this.#publishIfChanged()
      }
      return
    }
    // A successful list without a successful status snapshot cannot safely
    // admit non-idle historical children or assign status to new explicit
    // children. Keep the entire current root/membership transaction intact.
    if (!statusSucceeded) return

    const listed = new Map<string, SessionInfo>()
    for (const value of list) {
      const info = normalizeInfo(value)
      if (info) listed.set(info.id, info)
    }

    let nextRootID = this.#activeRootID
    for (const intent of this.#rootIntents.values()) {
      if (intent.kind === "created") {
        nextRootID = intent.rootID
        continue
      }
      const candidate = listed.get(intent.sourceSessionID)
      // Unknown status is only a scope signal when the exact authoritative
      // session is itself a root. A child status never derives its parent as
      // an orchestrator candidate.
      if (candidate && !isChildInfo(candidate)) nextRootID = candidate.id
    }

    const nextEligible = nextRootID === this.#activeRootID
      ? new Set(this.#eligibleChildIDs)
      : new Set<string>()
    for (const id of this.#pendingEligibilityByRoot.get(nextRootID ?? "") ?? []) nextEligible.add(id)

    const next = new Map<string, TrackedSession>()
    const nextKnownActiveChildIDs = new Set<string>()
    for (const info of listed.values()) {
      if (!isChildInfo(info) || info.parentID !== nextRootID) continue
      nextKnownActiveChildIDs.add(info.id)
      const hasStatus = Object.hasOwn(statuses, info.id)
      const status = hasStatus ? normalizeStatus(statuses[info.id]) : "idle"
      if (status === "busy" || status === "retry") nextEligible.add(info.id)
      if (!nextEligible.has(info.id)) continue

      const current = this.#sessions.get(info.id)
      const retainedStatus = current?.info.parentID === info.parentID ? current.status : undefined
      next.set(info.id, {
        info,
        ...(status === undefined
          ? (retainedStatus === undefined ? {} : { status: retainedStatus })
          : { status }),
      })
    }

    // Commit scope, eligibility, membership, and status together only after
    // both authoritative snapshots succeed. Pending eligibility for every
    // foreign or superseded root is discarded at this root-lifetime boundary.
    if (!this.#reconciliationCanCommit(generation)) return
    this.#activeRootID = nextRootID
    this.#knownActiveChildIDs.clear()
    for (const id of nextKnownActiveChildIDs) this.#knownActiveChildIDs.add(id)
    this.#eligibleChildIDs.clear()
    for (const id of nextEligible) this.#eligibleChildIDs.add(id)
    this.#sessions.clear()
    for (const [id, session] of next) this.#sessions.set(id, session)
    this.#rootIntents.clear()
    this.#pendingEligibilityByRoot.clear()
    this.#publishIfChanged()
  }

  #isKnownImmediateChild(sessionID: string): boolean {
    if (this.#knownActiveChildIDs.has(sessionID)) return true
    for (const children of this.#pendingEligibilityByRoot.values()) {
      if (children.has(sessionID)) return true
    }
    return false
  }

  async #readSdk(call: (signal: AbortSignal) => Promise<SdkResult>): Promise<unknown> {
    if (!this.#commitsAllowed) return undefined
    const controller = new AbortController()
    this.#activeRequests.add(controller)
    let timeout: ReturnType<typeof setTimeout> | undefined
    let removeAbortListener: () => void = () => undefined
    try {
      const request = Promise.resolve()
        .then(() => call(controller.signal))
        .catch(() => undefined)
      const deadline = new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, this.#sdkCallTimeoutMs)
      })
      const aborted = new Promise<undefined>((resolve) => {
        const onAbort = () => resolve(undefined)
        controller.signal.addEventListener("abort", onAbort, { once: true })
        removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort)
      })
      const result = await Promise.race([request, deadline, aborted])
      if (!isRecord(result) || result.error !== undefined || result.data === undefined) return undefined
      return result.data
    } catch {
      return undefined
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      removeAbortListener()
      this.#activeRequests.delete(controller)
    }
  }

  #publishIfChanged(): void {
    if (!this.#commitsAllowed) return
    const sessions = [...this.#sessions.values()]
      .filter(
        (session): session is TrackedSession & { status: ChildSessionStatus } =>
          session.info.parentID === this.#activeRootID &&
          this.#eligibleChildIDs.has(session.info.id) &&
          session.status !== undefined,
      )
      .map(({ info, status }) => Object.freeze({ ...info, status }))
      .sort((left, right) => left.id.localeCompare(right.id))
    if (sameSessions(this.#snapshot.sessions, sessions)) return

    this.#snapshot = Object.freeze({
      revision: this.#snapshot.revision + 1,
      sessions: Object.freeze(sessions),
    })
    for (const listener of [...this.#listeners]) {
      try {
        const result = listener(this.#snapshot)
        void Promise.resolve(result).catch(() => undefined)
      } catch {
        // A consumer cannot break tracker mutation or another subscriber.
      }
    }
  }

  #addRootIntent(intent: RootIntent): void {
    const key = `${intent.kind}:${intent.sourceSessionID}`
    // Reinsert duplicates to retain live event order while bounding repeated
    // candidates to one pending record per kind and session ID.
    this.#rootIntents.delete(key)
    this.#rootIntents.set(key, intent)
  }

  #removeRootIntentsForSource(sessionID: string): void {
    this.#rootIntents.delete(`created:${sessionID}`)
    this.#rootIntents.delete(`status:${sessionID}`)
  }

  #removeRootIntentsForRoot(rootID: string): void {
    for (const [key, intent] of this.#rootIntents) {
      if (intent.kind === "created" && intent.rootID === rootID) this.#rootIntents.delete(key)
    }
  }

  #addPendingEligibility(rootID: string, childID: string): void {
    const pending = this.#pendingEligibilityByRoot.get(rootID) ?? new Set<string>()
    pending.add(childID)
    this.#pendingEligibilityByRoot.set(rootID, pending)
  }

  #removePendingEligibility(rootID: string, childID: string): void {
    const pending = this.#pendingEligibilityByRoot.get(rootID)
    if (!pending) return
    pending.delete(childID)
    if (pending.size === 0) this.#pendingEligibilityByRoot.delete(rootID)
  }

  #applyStatusesToCurrent(statuses: Record<string, unknown>): void {
    for (const [id, session] of this.#sessions) {
      if (!Object.hasOwn(statuses, id)) {
        this.#sessions.set(id, { info: session.info, status: "idle" })
        continue
      }
      const status = normalizeStatus(statuses[id])
      if (status !== undefined) this.#sessions.set(id, { info: session.info, status })
    }
  }

  #reconciliationCanCommit(generation: number): boolean {
    return this.#commitsAllowed && generation === this.#scopeGeneration
  }

  #invalidateStaleReconciliation(event: unknown): void {
    if (!this.#accepting || !isRecord(event) || !isRecord(event.properties)) return

    if (event.type === "session.deleted") {
      const info = normalizeInfo(event.properties.info)
      if (!info) return
      const rootID = info.parentID ?? info.id
      const isPendingRoot = [...this.#rootIntents.values()].some((intent) =>
        intent.kind === "created" ? intent.rootID === rootID : intent.sourceSessionID === rootID)
      if (
        rootID === this.#activeRootID ||
        isPendingRoot ||
        this.#pendingEligibilityByRoot.has(rootID)
      ) {
        this.#scopeGeneration++
      }
      return
    }

    if (event.type === "session.status") {
      const sessionID = event.properties.sessionID
      const status = normalizeStatus(event.properties.status)
      if (!nonEmptyString(sessionID) || status === undefined) return
      const current = this.#sessions.get(sessionID)
      if (current?.info.parentID === this.#activeRootID) return
      // The public event has no parent information. Conservatively invalidate
      // in-flight scope work now; serialized resolution still requires a later
      // authoritative list to prove that this exact ID is a root.
      this.#scopeGeneration++
      return
    }

    if (event.type !== "session.created") return
    const info = normalizeInfo(event.properties.info)
    if (!info) return
    const candidateRootID = info.parentID ?? info.id
    let latestIntent: RootIntent | undefined
    for (const intent of this.#rootIntents.values()) latestIntent = intent
    // A different explicit root candidate supersedes in-flight scope work. A
    // duplicate candidate does not invalidate repeatedly, avoiding starvation
    // while the same switch is already reconciling.
    if (latestIntent?.kind === "status") {
      this.#scopeGeneration++
      return
    }
    const expectedRootID = latestIntent?.rootID ?? this.#activeRootID
    if (candidateRootID !== expectedRootID) this.#scopeGeneration++
  }
}
