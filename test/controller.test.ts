import { describe, expect, test } from "bun:test"
import {
  PresentationController,
  type ControllerScheduler,
  type ControllerTracker,
} from "../src/controller"
import type { PresentationAdapter } from "../src/presentation/adapter"
import type { PresentationHandle } from "../src/presentation/types"
import type { ChildSession } from "../src/session/types"
import { SessionTracker, type SessionTrackerSnapshot } from "../src/session/tracker"

const child = (id: string, directory = `/repo/${id}`): ChildSession => ({
  id,
  parentID: "parent",
  directory,
  title: id,
  status: "busy",
})

class FakeTracker implements ControllerTracker {
  current: SessionTrackerSnapshot = Object.freeze({ revision: 0, sessions: Object.freeze([]) })
  readonly listeners = new Set<(snapshot: SessionTrackerSnapshot) => void | Promise<void>>()

  snapshot() { return this.current }
  subscribe(listener: (snapshot: SessionTrackerSnapshot) => void | Promise<void>) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(sessions: readonly ChildSession[], revision = this.current.revision + 1) {
    this.current = Object.freeze({ revision, sessions: Object.freeze([...sessions]) })
    for (const listener of this.listeners) void listener(this.current)
  }
}

class FakeScheduler implements ControllerScheduler {
  callback?: () => void
  cleared = false
  setInterval(callback: () => void) { this.callback = callback; return 1 }
  clearInterval() { this.cleared = true }
  tick(count = 1) { for (let index = 0; index < count; index += 1) this.callback?.() }
}

class FakeAdapter implements PresentationAdapter {
  available = true
  existsValue = true
  failAvailability = false
  failOpen = false
  failExists = false
  failClose = false
  nextID = 10
  disposed = 0
  readonly calls: string[] = []
  readonly opens: Array<{ session: ChildSession; url: string }> = []
  readonly closed: PresentationHandle[] = []
  openImpl?: (session: ChildSession, serverUrl: URL) => Promise<PresentationHandle>
  existsImpl?: (handle: PresentationHandle) => Promise<boolean>
  closeImpl?: (handle: PresentationHandle) => Promise<void>
  disposeImpl?: () => Promise<void>

  async availability() {
    this.calls.push("availability")
    if (this.failAvailability) throw new Error("secret adapter failure")
    return this.available
      ? ({ available: true } as const)
      : ({ available: false, reason: "broker-unavailable" } as const)
  }
  async open(session: ChildSession, serverUrl: URL) {
    this.calls.push("open")
    this.opens.push({ session, url: serverUrl.href })
    if (this.failOpen) throw new Error("secret open failure")
    if (this.openImpl) return this.openImpl(session, serverUrl)
    return { backend: "kitty", windowID: this.nextID++, openedAt: 1 } as const
  }
  async exists(handle: PresentationHandle) {
    this.calls.push("exists")
    if (this.failExists) throw new Error("secret exists failure")
    if (this.existsImpl) return this.existsImpl(handle)
    return this.existsValue
  }
  async focus() { this.calls.push("focus") }
  async close(handle: PresentationHandle) {
    this.calls.push("close")
    this.closed.push(handle)
    if (this.failClose) throw new Error("secret close failure")
    if (this.closeImpl) await this.closeImpl(handle)
  }
  async dispose() {
    this.calls.push("dispose")
    this.disposed += 1
    if (this.disposeImpl) await this.disposeImpl()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function healthResponse(body: unknown = { healthy: true, version: "1.18.4" }, ok = true) {
  return { ok, async json() { return body } }
}

function setup(options: {
  tracker?: FakeTracker
  adapter?: FakeAdapter
  scheduler?: FakeScheduler
  now?: () => number
  getServerUrl?: () => string | URL
  fetch?: ConstructorParameters<typeof PresentationController>[0]["fetch"]
  healthTimeoutMs?: number
  disposeTimeoutMs?: number
} = {}) {
  const tracker = options.tracker ?? new FakeTracker()
  const adapter = options.adapter ?? new FakeAdapter()
  const scheduler = options.scheduler ?? new FakeScheduler()
  const controller = new PresentationController({
    tracker,
    adapter,
    scheduler,
    now: options.now,
    getServerUrl: options.getServerUrl ?? (() => "http://127.0.0.1:4096"),
    fetch: options.fetch ?? (async () => healthResponse()),
    reconciliationIntervalMs: 1_000,
    healthTimeoutMs: options.healthTimeoutMs,
    disposeTimeoutMs: options.disposeTimeoutMs,
  })
  return { tracker, adapter, scheduler, controller }
}

describe("presentation controller", () => {
  test("does not mass-open historical children and closes old scope on a live root switch", async () => {
    const trackerScheduler = new FakeScheduler()
    let listFails = false
    const historical = Array.from({ length: 30 }, (_, index) => ({
      id: `historical-${index}`,
      parentID: `old-root-${index % 3}`,
      directory: `/history/${index}`,
      title: `Historical ${index}`,
    }))
    const tracker = new SessionTracker({
      client: {
        async list() {
          if (listFails) return { error: { code: "list-unavailable" } }
          return {
            data: [
              ...historical,
              { id: "current-child", parentID: "current-root", directory: "/current", title: "Current" },
              { id: "next-child", parentID: "next-root", directory: "/next", title: "Next" },
            ],
          }
        },
        async status() {
          return {
            data: {
              ...Object.fromEntries(historical.map((item) => [item.id, { type: "busy" }])),
              "current-child": { type: "busy" },
              "next-child": { type: "busy" },
            },
          }
        },
      },
      reconciliationIntervalMs: 1_000,
      scheduler: trackerScheduler,
    })
    const adapter = new FakeAdapter()
    const controller = new PresentationController({
      tracker,
      adapter,
      scheduler: new FakeScheduler(),
      getServerUrl: () => "http://127.0.0.1:4096",
      fetch: async () => healthResponse(),
      reconciliationIntervalMs: 1_000,
    })
    await tracker.ready()
    await controller.ready()
    expect(adapter.opens).toEqual([])

    await tracker.handleEvent({
      type: "session.created",
      properties: {
        info: { id: "current-root", directory: "/current", title: "Current root" },
      },
    })
    await controller.ready()
    expect(adapter.opens.map((item) => item.session.id)).toEqual(["current-child"])
    expect(adapter.opens[0]?.session.directory).toBe("/current")

    listFails = true
    await tracker.handleEvent({
      type: "session.created",
      properties: {
        info: { id: "next-root", directory: "/next", title: "Next root" },
      },
    })
    await controller.ready()
    expect(adapter.opens.map((item) => item.session.id)).toEqual(["current-child"])
    expect(adapter.closed).toEqual([])

    listFails = false
    await tracker.reconcile()
    await controller.ready()
    expect(adapter.opens.map((item) => item.session.id)).toEqual(["current-child", "next-child"])
    expect(adapter.closed.map((handle) => handle.windowID)).toEqual([10])
    await controller.dispose()
    await tracker.dispose()
  })

  test("root deletion during deferred status reconciliation never transiently opens a child", async () => {
    const blockedStatus = deferred<Readonly<{ data: unknown }>>()
    let listCalls = 0
    let statusCalls = 0
    const tracker = new SessionTracker({
      client: {
        async list() {
          listCalls++
          return {
            data: listCalls === 1
              ? []
              : [
                  { id: "pending-root", directory: "/root", title: "Pending root" },
                  { id: "pending-child", parentID: "pending-root", directory: "/child", title: "Pending child" },
                ],
          }
        },
        async status() {
          statusCalls++
          return statusCalls === 1 ? { data: {} } : blockedStatus.promise
        },
      },
      reconciliationIntervalMs: 1_000,
      scheduler: new FakeScheduler(),
    })
    const adapter = new FakeAdapter()
    const controller = new PresentationController({
      tracker,
      adapter,
      scheduler: new FakeScheduler(),
      getServerUrl: () => "http://127.0.0.1:4096",
      fetch: async () => healthResponse(),
      reconciliationIntervalMs: 1_000,
    })
    await tracker.ready()
    await controller.ready()

    const selecting = tracker.handleEvent({
      type: "session.status",
      properties: { sessionID: "pending-root", status: { type: "busy" } },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(statusCalls).toBe(2)

    const deleting = tracker.handleEvent({
      type: "session.deleted",
      properties: { info: { id: "pending-root", directory: "/root", title: "Pending root" } },
    })
    blockedStatus.resolve({
      data: {
        "pending-root": { type: "busy" },
        "pending-child": { type: "busy" },
      },
    })
    await Promise.all([selecting, deleting])
    await controller.ready()

    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    expect(adapter.opens).toEqual([])
    await controller.dispose()
    await tracker.dispose()
  })

  test("child deletion during deferred pending-root status never transiently opens that child", async () => {
    const blockedStatus = deferred<Readonly<{ data: unknown }>>()
    let listCalls = 0
    let statusCalls = 0
    const tracker = new SessionTracker({
      client: {
        async list() {
          listCalls++
          return {
            data: listCalls === 1
              ? []
              : [
                  { id: "pending-root", directory: "/root", title: "Pending root" },
                  { id: "pending-child", parentID: "pending-root", directory: "/child", title: "Pending child" },
                ],
          }
        },
        async status() {
          statusCalls++
          return statusCalls === 1 ? { data: {} } : blockedStatus.promise
        },
      },
      reconciliationIntervalMs: 1_000,
      scheduler: new FakeScheduler(),
    })
    const adapter = new FakeAdapter()
    const controller = new PresentationController({
      tracker,
      adapter,
      scheduler: new FakeScheduler(),
      getServerUrl: () => "http://127.0.0.1:4096",
      fetch: async () => healthResponse(),
      reconciliationIntervalMs: 1_000,
    })
    await tracker.ready()
    await controller.ready()

    const selecting = tracker.handleEvent({
      type: "session.status",
      properties: { sessionID: "pending-root", status: { type: "busy" } },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(statusCalls).toBe(2)

    const deleting = tracker.handleEvent({
      type: "session.deleted",
      properties: {
        info: {
          id: "pending-child",
          parentID: "pending-root",
          directory: "/child",
          title: "Pending child",
        },
      },
    })
    blockedStatus.resolve({
      data: {
        "pending-root": { type: "busy" },
        "pending-child": { type: "busy" },
      },
    })
    await Promise.all([selecting, deleting])
    await controller.ready()

    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    expect(adapter.opens).toEqual([])
    await controller.dispose()
    await tracker.dispose()
  })

  test("unknown root status during deferred reconciliation never transiently opens old-root history", async () => {
    const blockedStatus = deferred<Readonly<{ data: unknown }>>()
    let blockStatus = false
    let statuses: unknown = {
      "old-child": { type: "idle" },
      "new-child": { type: "idle" },
    }
    const tracker = new SessionTracker({
      client: {
        async list() {
          return {
            data: [
              { id: "old-child", parentID: "old-root", directory: "/old", title: "Old child" },
              { id: "new-root", directory: "/new", title: "New root" },
              { id: "new-child", parentID: "new-root", directory: "/new-child", title: "New child" },
            ],
          }
        },
        async status() {
          if (blockStatus) {
            blockStatus = false
            return blockedStatus.promise
          }
          return { data: statuses }
        },
      },
      reconciliationIntervalMs: 1_000,
      scheduler: new FakeScheduler(),
    })
    const adapter = new FakeAdapter()
    const controller = new PresentationController({
      tracker,
      adapter,
      scheduler: new FakeScheduler(),
      getServerUrl: () => "http://127.0.0.1:4096",
      fetch: async () => healthResponse(),
      reconciliationIntervalMs: 1_000,
    })
    await tracker.ready()
    await tracker.handleEvent({
      type: "session.created",
      properties: { info: { id: "old-root", directory: "/old-root", title: "Old root" } },
    })
    await controller.ready()
    expect(adapter.opens).toEqual([])

    blockStatus = true
    const stale = tracker.reconcile()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const switching = tracker.handleEvent({
      type: "session.status",
      properties: { sessionID: "new-root", status: { type: "busy" } },
    })
    statuses = {
      "old-child": { type: "idle" },
      "new-child": { type: "busy" },
    }
    blockedStatus.resolve({
      data: {
        "old-child": { type: "busy" },
        "new-child": { type: "idle" },
      },
    })
    await Promise.all([stale, switching])
    await controller.ready()

    expect(adapter.opens.map((item) => item.session.id)).toEqual(["new-child"])
    expect(adapter.opens.map((item) => item.session.id)).not.toContain("old-child")
    await controller.dispose()
    await tracker.dispose()
  })

  test("reconciles desired membership through serialized open and deletion transitions", async () => {
    const { tracker, adapter, controller } = setup()
    tracker.emit([child("a"), child("b")])
    await controller.ready()
    expect(controller.snapshot().map((item) => [item.session.id, item.state.phase])).toEqual([
      ["a", "open"], ["b", "open"],
    ])
    expect(adapter.opens.map((item) => item.session.id)).toEqual(["a", "b"])

    tracker.emit([child("b", "/updated")])
    await controller.ready()
    expect(controller.snapshot()).toHaveLength(1)
    expect(controller.snapshot()[0]?.session.directory).toBe("/updated")
    expect(adapter.closed).toHaveLength(1)
    await controller.dispose()
  })

  test("coalesces duplicate and concurrent snapshots without duplicate windows", async () => {
    const { tracker, adapter, scheduler, controller } = setup()
    tracker.emit([child("a")], 1)
    tracker.emit([child("a")], 1)
    tracker.emit([child("a")], 2)
    await controller.ready()
    expect(adapter.opens).toHaveLength(1)
    expect(controller.snapshot()).toHaveLength(1)
    tracker.emit([{ ...child("a"), status: "idle" }], 3)
    await controller.ready()
    expect(adapter.calls.filter((call) => call === "exists")).toHaveLength(0)
    scheduler.tick()
    await controller.ready()
    expect(adapter.calls.filter((call) => call === "exists")).toHaveLength(1)
    await controller.dispose()
  })

  test("closes a window when deletion arrives while open is pending", async () => {
    const opening = deferred<PresentationHandle>()
    const adapter = new FakeAdapter()
    adapter.openImpl = () => opening.promise
    const { tracker, controller } = setup({ adapter })
    tracker.emit([child("a")])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.snapshot()[0]?.state.phase).toBe("opening")
    tracker.emit([])
    opening.resolve({ backend: "kitty", windowID: 77, openedAt: 1 })
    await controller.ready()
    expect(controller.snapshot()).toEqual([])
    expect(adapter.closed.map((handle) => handle.windowID)).toEqual([77])
    await controller.dispose()
  })

  test("probes health immediately before each open and periodically retries failure", async () => {
    let now = 0
    let healthy = false
    const requests: Array<{ url: string; init: RequestInit }> = []
    const { tracker, adapter, scheduler, controller } = setup({
      now: () => now,
      fetch: async (url, init) => {
        requests.push({ url: url.toString(), init })
        return healthResponse(healthy ? { healthy: true, version: "1.18.4" } : { healthy: false })
      },
    })
    tracker.emit([child("a")])
    await controller.ready()
    expect(adapter.opens).toHaveLength(0)
    expect(controller.snapshot()[0]?.state).toMatchObject({ phase: "unavailable", lastError: "server-unavailable" })
    scheduler.tick(20)
    await controller.ready()
    expect(requests).toHaveLength(1)
    now = 1_000
    healthy = true
    scheduler.tick()
    await controller.ready()
    expect(adapter.opens).toHaveLength(1)
    expect(requests[1]).toMatchObject({ url: "http://127.0.0.1:4096/global/health" })
    expect(requests[1]?.init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" })
    expect(requests[1]?.init.signal).toBeInstanceOf(AbortSignal)
    await controller.dispose()
  })

  test("reads a live server URL once per launch and opens with that exact URL", async () => {
    let value = "http://127.0.0.1:4096/base"
    const healthUrls: string[] = []
    const { tracker, adapter, controller } = setup({
      getServerUrl: () => value,
      fetch: async (url) => { healthUrls.push(url.toString()); return healthResponse() },
    })
    value = "http://127.0.0.1:5000/current"
    tracker.emit([child("a")])
    await controller.ready()
    expect(healthUrls).toEqual(["http://127.0.0.1:5000/global/health"])
    expect(adapter.opens[0]?.url).toBe("http://127.0.0.1:5000/current")
    await controller.dispose()
  })

  test("health deadline aborts without opening or exposing credentials", async () => {
    let signal: AbortSignal | undefined
    const { tracker, adapter, controller } = setup({
      healthTimeoutMs: 5,
      getServerUrl: () => "http://user:password@127.0.0.1:4096",
      fetch: async (_url, init) => { signal = init.signal; return new Promise(() => undefined) },
    })
    tracker.emit([child("a")])
    await controller.ready()
    expect(signal).toBeUndefined()
    expect(adapter.opens).toHaveLength(0)
    expect(controller.snapshot()[0]?.state.lastError).toBe("server-unavailable")
    await controller.dispose()
  })

  test("bounds a stalled credential-free health probe with AbortSignal", async () => {
    let aborted = false
    const { tracker, adapter, controller } = setup({
      healthTimeoutMs: 5,
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")) }, { once: true })
      }),
    })
    tracker.emit([child("a")])
    await controller.ready()
    expect(aborted).toBe(true)
    expect(adapter.opens).toHaveLength(0)
    await controller.dispose()
  })

  test("requires the OpenCode health JSON shape instead of accepting generic 2xx responses", async () => {
    const invalid = [
      null,
      {},
      { healthy: true },
      { healthy: true, version: "" },
      { healthy: true, version: "   " },
      { healthy: false, version: "1.18.4" },
      { healthy: true, version: 1184 },
    ]
    for (const body of invalid) {
      const { tracker, adapter, controller } = setup({ fetch: async () => healthResponse(body) })
      tracker.emit([child("a")])
      await controller.ready()
      expect(adapter.opens).toHaveLength(0)
      await controller.dispose()
    }

    const { tracker, adapter, controller } = setup({
      fetch: async () => healthResponse({ healthy: true, version: "1.18.4" }, false),
    })
    tracker.emit([child("a")])
    await controller.ready()
    expect(adapter.opens).toHaveLength(0)
    await controller.dispose()
  })

  test("includes response body parsing inside the health deadline", async () => {
    const parsing = deferred<unknown>()
    let aborted = false
    const { tracker, adapter, controller } = setup({
      healthTimeoutMs: 5,
      fetch: async (_url, init) => {
        init.signal.addEventListener("abort", () => { aborted = true }, { once: true })
        return { ok: true, json: () => parsing.promise }
      },
    })
    tracker.emit([child("a")])
    await controller.ready()
    expect(aborted).toBe(true)
    expect(adapter.opens).toHaveLength(0)
    parsing.resolve({ healthy: true, version: "late" })
    await controller.dispose()
  })

  test("manual closure gets exactly one delayed automatic replacement", async () => {
    let now = 0
    const adapter = new FakeAdapter()
    const { tracker, scheduler, controller } = setup({ adapter, now: () => now })
    tracker.emit([child("a")])
    await controller.ready()
    adapter.existsValue = false
    scheduler.tick()
    await controller.ready()
    expect(adapter.opens).toHaveLength(1)
    expect(controller.snapshot()[0]).toMatchObject({ manualReopenAttempts: 1, state: { phase: "unavailable" } })
    now = 1_000
    adapter.existsValue = true
    scheduler.tick()
    await controller.ready()
    expect(adapter.opens).toHaveLength(2)
    adapter.existsValue = false
    now = 2_000
    scheduler.tick(10)
    await controller.ready()
    expect(adapter.opens).toHaveLength(2)
    expect(controller.snapshot()[0]?.state.lastError).toBe("window-closed")
    await controller.dispose()
  })

  test("schedules manual-close replacement from slow exists completion and coalesces timer ticks", async () => {
    let now = 0
    const existence = deferred<boolean>()
    const adapter = new FakeAdapter()
    adapter.existsImpl = () => existence.promise
    const { tracker, scheduler, controller } = setup({ adapter, now: () => now })
    tracker.emit([child("a")])
    await controller.ready()

    scheduler.tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(adapter.calls.filter((call) => call === "exists")).toHaveLength(1)
    scheduler.tick(100)
    now = 500
    existence.resolve(false)
    await controller.ready()
    expect(adapter.opens).toHaveLength(1)
    expect(controller.snapshot()[0]?.manualReopenAttempts).toBe(1)

    now = 1_499
    scheduler.tick()
    await controller.ready()
    expect(adapter.opens).toHaveLength(1)
    now = 1_500
    scheduler.tick()
    await controller.ready()
    expect(adapter.opens).toHaveLength(2)
    await controller.dispose()
  })

  test("handles immediate child exit with the same one-replacement policy", async () => {
    let now = 0
    const adapter = new FakeAdapter()
    adapter.existsValue = false
    const { tracker, scheduler, controller } = setup({ adapter, now: () => now })
    tracker.emit([child("a")])
    await controller.ready()
    scheduler.tick()
    await controller.ready()
    now = 1_000
    scheduler.tick()
    await controller.ready()
    now = 2_000
    scheduler.tick(5)
    await controller.ready()
    expect(adapter.opens).toHaveLength(2)
    await controller.dispose()
  })

  test("contains availability, open, exists, and close failures", async () => {
    let now = 0
    const adapter = new FakeAdapter()
    adapter.failAvailability = true
    const { tracker, scheduler, controller } = setup({ adapter, now: () => now })
    tracker.emit([child("a")])
    await controller.ready()
    expect(controller.snapshot()[0]?.state.lastError).toBe("adapter-unavailable")
    adapter.failAvailability = false
    adapter.failOpen = true
    now = 1_000
    scheduler.tick()
    await controller.ready()
    expect(controller.snapshot()[0]?.state.lastError).toBe("open-failed")
    adapter.failOpen = false
    now = 2_000
    scheduler.tick()
    await controller.ready()
    adapter.failExists = true
    scheduler.tick()
    await controller.ready()
    expect(controller.snapshot()[0]?.state.lastError).toBe("exists-failed")
    adapter.failClose = true
    tracker.emit([])
    await controller.ready()
    expect(controller.snapshot()).toEqual([])
    await controller.dispose()
  })

  test("does not call focus because focus policy is carried by the adapter open", async () => {
    const { tracker, adapter, controller } = setup()
    tracker.emit([child("a")])
    await controller.ready()
    expect(adapter.calls).not.toContain("focus")
    await controller.dispose()
  })

  test("dispose stops timers and subscriptions, closes with bounded concurrency, then disposes adapter", async () => {
    const { tracker, adapter, scheduler, controller } = setup()
    tracker.emit([child("a"), child("b")])
    await controller.ready()
    await controller.dispose()
    await controller.dispose()
    expect(scheduler.cleared).toBe(true)
    expect(tracker.listeners.size).toBe(0)
    expect(adapter.closed.map((handle) => handle.windowID).sort()).toEqual([10, 11])
    expect(adapter.disposed).toBe(1)
    expect(adapter.calls.at(-1)).toBe("dispose")
    tracker.emit([child("c")])
    scheduler.tick()
    await controller.ready()
    expect(adapter.opens).toHaveLength(2)
  })

  test("dispose racing a pending open closes the returned handle and starts no new work", async () => {
    const opening = deferred<PresentationHandle>()
    const adapter = new FakeAdapter()
    adapter.openImpl = () => opening.promise
    const { tracker, controller } = setup({ adapter, disposeTimeoutMs: 1_000 })
    tracker.emit([child("a")])
    await new Promise((resolve) => setTimeout(resolve, 0))
    const disposing = controller.dispose()
    tracker.emit([child("b")])
    opening.resolve({ backend: "kitty", windowID: 88, openedAt: 1 })
    await disposing
    expect(adapter.opens.map((item) => item.session.id)).toEqual(["a"])
    expect(adapter.closed.map((handle) => handle.windowID)).toContain(88)
    expect(adapter.disposed).toBe(1)
  })

  test("uses one global disposal deadline and leaves stalled close/shutdown as contained best effort", async () => {
    const lateClose = deferred<void>()
    let shutdownFinished = false
    let disposeStartedAt = 0
    const adapter = new FakeAdapter()
    adapter.closeImpl = () => lateClose.promise
    adapter.disposeImpl = async () => {
      disposeStartedAt = Date.now()
      await lateClose.promise
      shutdownFinished = true
    }
    const { tracker, controller } = setup({ adapter, disposeTimeoutMs: 10 })
    tracker.emit([child("a"), child("b")])
    await controller.ready()

    const startedAt = Date.now()
    await controller.dispose()
    expect(Date.now() - startedAt).toBeLessThan(100)
    expect(Date.now() - disposeStartedAt).toBeLessThan(10)
    expect(adapter.closed).toHaveLength(1)
    expect(adapter.disposed).toBe(1)
    expect(shutdownFinished).toBe(false)

    lateClose.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(shutdownFinished).toBe(true)
  })

  test("a snapshot close that outlives disposal cannot repopulate cleared children", async () => {
    const staleClose = deferred<void>()
    const adapter = new FakeAdapter()
    const { tracker, controller } = setup({ adapter, disposeTimeoutMs: 10 })
    tracker.emit([child("old-a"), child("old-b")])
    await controller.ready()
    expect(adapter.opens.map((item) => item.session.id)).toEqual(["old-a", "old-b"])

    adapter.closeImpl = () => staleClose.promise
    tracker.emit([child("new-a"), child("new-b")])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(adapter.closed.map((handle) => handle.windowID)).toEqual([10])

    await controller.dispose()
    expect(controller.snapshot()).toEqual([])
    staleClose.resolve()
    await controller.ready()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(controller.snapshot()).toEqual([])
    expect(adapter.opens.map((item) => item.session.id)).toEqual(["old-a", "old-b"])
  })
})
