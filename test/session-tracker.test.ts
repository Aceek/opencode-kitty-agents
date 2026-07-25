import { describe, expect, test } from "bun:test"
import {
  SessionTracker,
  type SessionTrackerClient,
  type SessionTrackerScheduler,
} from "../src/session/tracker"
import type { ChildSessionStatus } from "../src/session/types"

type FakeSession = Readonly<{
  id: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  version: string
  time: { created: number; updated: number }
}>

function session(id: string, parentID: string | null = "parent"): FakeSession {
  return {
    id,
    projectID: "project",
    directory: `/work/${id}`,
    ...(parentID === null ? {} : { parentID }),
    title: `Session ${id}`,
    version: "1.18.4",
    time: { created: 1, updated: 1 },
  }
}

function created(info: unknown): unknown {
  return { type: "session.created", properties: { info } }
}

function deleted(info: unknown): unknown {
  return { type: "session.deleted", properties: { info } }
}

function status(sessionID: unknown, type: unknown): unknown {
  return { type: "session.status", properties: { sessionID, status: { type } } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class ManualScheduler implements SessionTrackerScheduler {
  callback?: () => void
  cleared = 0

  setInterval(callback: () => void): unknown {
    this.callback = callback
    return 42
  }

  clearInterval(handle: unknown): void {
    expect(handle).toBe(42)
    this.cleared++
    this.callback = undefined
  }

  tick(): void {
    this.callback?.()
  }
}

function fakeClient(
  getSessions: () => unknown = () => [],
  getStatuses: () => unknown = () => ({}),
): SessionTrackerClient {
  return {
    list: async () => ({ data: getSessions() }),
    status: async () => ({ data: getStatuses() }),
  }
}

function makeTracker(
  client: SessionTrackerClient,
  scheduler = new ManualScheduler(),
  disposeTimeoutMs = 100,
  sdkCallTimeoutMs = 100,
): SessionTracker {
  return new SessionTracker({
    client,
    scheduler,
    reconciliationIntervalMs: 1_000,
    disposeTimeoutMs,
    sdkCallTimeoutMs,
  })
}

async function selectRoot(tracker: SessionTracker, rootID = "parent"): Promise<void> {
  await tracker.handleEvent(created(session(rootID, null)))
}

describe("SessionTracker", () => {
  test("startup reconciliation publishes no historical children before a live root signal", async () => {
    let historical = Array.from({ length: 50 }, (_, index) =>
      session(`old-child-${index}`, `old-root-${index % 5}`))
    const scheduler = new ManualScheduler()
    const tracker = makeTracker(
      fakeClient(() => historical, () => Object.fromEntries(
        historical.map((item) => [item.id, { type: "busy" }]),
      )),
      scheduler,
    )

    await tracker.ready()

    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    historical = [...historical, session("newly-listed-history", "old-root-0")]
    scheduler.tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    await tracker.dispose()
  })

  test("a live root creation selects only that root's immediate children", async () => {
    const tracker = makeTracker(fakeClient(
      () => [
        session("current-child", "current-root"),
        session("current-grandchild", "current-child"),
        session("historical-child", "historical-root"),
      ],
      () => ({
        "current-child": { type: "busy" },
        "current-grandchild": { type: "busy" },
        "historical-child": { type: "busy" },
      }),
    ))
    await tracker.ready()

    await tracker.handleEvent(created(session("current-root", null)))

    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["current-child"])
    await tracker.dispose()
  })

  test("a child creation can select its parent when it is the first live scope signal", async () => {
    const current = session("current-child", "current-root")
    const tracker = makeTracker(fakeClient(
      () => [current, session("historical-child", "historical-root")],
      () => ({ "current-child": { type: "retry" }, "historical-child": { type: "busy" } }),
    ))
    await tracker.ready()

    await tracker.handleEvent(created(current))

    expect(tracker.snapshot().sessions).toEqual([
      {
        id: "current-child",
        parentID: "current-root",
        directory: "/work/current-child",
        title: "Session current-child",
        status: "retry",
      },
    ])
    await tracker.dispose()
  })

  test("an unknown live status selects a listed root candidate", async () => {
    const tracker = makeTracker(fakeClient(
      () => [session("current-root", null), session("current-child", "current-root"), session("old", "old-root")],
      () => ({ "current-child": { type: "busy" }, old: { type: "busy" } }),
    ))
    await tracker.ready()

    await tracker.handleEvent(status("current-root", "busy"))

    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["current-child"])
    await tracker.dispose()
  })

  test("unknown root status invalidates an in-flight list before stale old-root admission", async () => {
    const oldChild = session("old-child", "old-root")
    const newRoot = session("new-root", null)
    const newChild = session("new-child", "new-root")
    const blockedList = deferred<Readonly<{ data: unknown }>>()
    let blockList = false
    let statuses: unknown = {
      "old-child": { type: "idle" },
      "new-child": { type: "idle" },
    }
    const listed = [oldChild, newRoot, newChild]
    const tracker = makeTracker({
      list: async () => {
        if (blockList) {
          blockList = false
          return blockedList.promise
        }
        return { data: listed }
      },
      status: async () => ({ data: statuses }),
    })
    await tracker.ready()
    await tracker.handleEvent(created(session("old-root", null)))
    expect(tracker.snapshot().sessions).toEqual([])
    const observed: string[][] = []
    tracker.subscribe((snapshot) => { observed.push(snapshot.sessions.map((item) => item.id)) })

    blockList = true
    const stale = tracker.reconcile()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const switching = tracker.handleEvent(status("new-root", "busy"))
    statuses = {
      "old-child": { type: "idle" },
      "new-child": { type: "busy" },
    }
    blockedList.resolve({ data: listed })
    await Promise.all([stale, switching])

    expect(observed).toEqual([["new-child"]])
    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["new-child"])
    await tracker.dispose()
  })

  test("known active-child status does not invalidate in-flight reconciliation", async () => {
    const current = session("current-child", "current-root")
    const blockedStatus = deferred<Readonly<{ data: unknown }>>()
    let blockStatus = false
    const tracker = makeTracker({
      list: async () => ({ data: [current] }),
      status: async () => {
        if (blockStatus) {
          blockStatus = false
          return blockedStatus.promise
        }
        return { data: { "current-child": { type: "idle" } } }
      },
    })
    await tracker.ready()
    await tracker.handleEvent(created(current))
    const observed: ChildSessionStatus[] = []
    tracker.subscribe((snapshot) => {
      const childStatus = snapshot.sessions[0]?.status
      if (childStatus) observed.push(childStatus)
    })

    blockStatus = true
    const reconciling = tracker.reconcile()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const event = tracker.handleEvent(status("current-child", "idle"))
    blockedStatus.resolve({ data: { "current-child": { type: "busy" } } })
    await Promise.all([reconciling, event])

    expect(observed).toEqual(["busy", "idle"])
    await tracker.dispose()
  })

  test("active or pending root deletion invalidates an in-flight list before it can publish", async () => {
    const blockedList = deferred<Readonly<{ data: unknown }>>()
    let listCalls = 0
    let statusCalls = 0
    const tracker = makeTracker({
      list: async () => {
        listCalls++
        return listCalls === 1 ? { data: [] } : blockedList.promise
      },
      status: async () => {
        statusCalls++
        return { data: {} }
      },
    })
    await tracker.ready()
    let publications = 0
    tracker.subscribe(() => { publications++ })

    const selecting = tracker.handleEvent(status("pending-root", "busy"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listCalls).toBe(2)

    const deleting = tracker.handleEvent(deleted(session("pending-root", null)))
    blockedList.resolve({
      data: [session("pending-root", null), session("would-open", "pending-root")],
    })
    await Promise.all([selecting, deleting])

    expect(statusCalls).toBe(1)
    expect(publications).toBe(0)
    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    await tracker.dispose()
  })

  test("pending-root child deletion invalidates an in-flight list before it can publish that child", async () => {
    const blockedList = deferred<Readonly<{ data: unknown }>>()
    let listCalls = 0
    let statusCalls = 0
    const tracker = makeTracker({
      list: async () => {
        listCalls++
        return listCalls === 1 ? { data: [] } : blockedList.promise
      },
      status: async () => {
        statusCalls++
        return { data: {} }
      },
    })
    await tracker.ready()
    let publications = 0
    tracker.subscribe(() => { publications++ })

    const selecting = tracker.handleEvent(status("pending-root", "busy"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listCalls).toBe(2)

    const deleting = tracker.handleEvent(deleted(session("deleted-child", "pending-root")))
    blockedList.resolve({
      data: [session("pending-root", null), session("deleted-child", "pending-root")],
    })
    await Promise.all([selecting, deleting])

    expect(statusCalls).toBe(1)
    expect(publications).toBe(0)
    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    await tracker.dispose()
  })

  test("foreign child deletion does not invalidate in-flight current-root reconciliation", async () => {
    const current = session("current-child", "current-root")
    const blockedStatus = deferred<Readonly<{ data: unknown }>>()
    let blockStatus = false
    const tracker = makeTracker({
      list: async () => ({ data: [current] }),
      status: async () => blockStatus ? blockedStatus.promise : { data: {} },
    })
    await tracker.ready()
    await tracker.handleEvent(created(session("current-root", null)))
    let publications = 0
    tracker.subscribe(() => { publications++ })

    blockStatus = true
    const reconciling = tracker.reconcile()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const deleting = tracker.handleEvent(deleted(session("foreign-child", "foreign-root")))
    blockedStatus.resolve({ data: { "current-child": { type: "busy" } } })
    await Promise.all([reconciling, deleting])

    expect(publications).toBe(1)
    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["current-child", "busy"],
    ])
    await tracker.dispose()
  })

  test("old-root status with 30 idle historical children publishes none", async () => {
    const historical = Array.from({ length: 30 }, (_, index) => session(`historical-${index}`, "old-root"))
    const tracker = makeTracker(fakeClient(
      () => [session("old-root", null), ...historical],
      () => ({
        "old-root": { type: "busy" },
        ...Object.fromEntries(historical.map((item) => [item.id, { type: "idle" }])),
      }),
    ))
    await tracker.ready()

    await tracker.handleEvent(status("old-root", "busy"))

    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    await tracker.dispose()
  })

  test("old-root status admits exactly the two non-idle children in the authoritative snapshot", async () => {
    const historical = Array.from({ length: 30 }, (_, index) => session(`historical-${index}`, "old-root"))
    const tracker = makeTracker(fakeClient(
      () => [session("old-root", null), ...historical],
      () => ({
        "old-root": { type: "busy" },
        ...Object.fromEntries(historical.map((item, index) => [
          item.id,
          { type: index === 4 ? "busy" : index === 19 ? "retry" : "idle" },
        ])),
      }),
    ))
    await tracker.ready()

    await tracker.handleEvent(status("old-root", "busy"))

    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["historical-19", "retry"],
      ["historical-4", "busy"],
    ])
    await tracker.dispose()
  })

  test("a listed foreign child status with 30 siblings cannot select or switch scope", async () => {
    const foreign = Array.from({ length: 31 }, (_, index) => session(`foreign-${index}`, "foreign-root"))
    const tracker = makeTracker(fakeClient(
      () => [session("current-child", "current-root"), ...foreign],
      () => ({
        "current-child": { type: "busy" },
        ...Object.fromEntries(foreign.map((item) => [item.id, { type: "busy" }])),
      }),
    ))
    await tracker.ready()
    await tracker.handleEvent(created(session("current-root", null)))
    const revision = tracker.snapshot().revision
    let publications = 0
    tracker.subscribe(() => { publications++ })

    await tracker.handleEvent(status("foreign-0", "retry"))

    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["current-child"])
    expect(tracker.snapshot().revision).toBe(revision)
    expect(publications).toBe(0)
    await tracker.dispose()
  })

  test("a live root switch replaces old-root membership with the authoritative snapshot", async () => {
    const tracker = makeTracker(fakeClient(
      () => [session("old-child", "old-root"), session("new-child", "new-root")],
      () => ({ "old-child": { type: "busy" }, "new-child": { type: "busy" } }),
    ))
    await tracker.ready()
    await tracker.handleEvent(created(session("old-root", null)))
    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["old-child"])

    await tracker.handleEvent(created(session("new-root", null)))

    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["new-child"])
    await tracker.dispose()
  })

  test("a nested child creation cannot replace the active root or publish a grandchild", async () => {
    const directChild = session("direct-child", "orchestrator")
    const grandchild = session("grandchild", "direct-child")
    const tracker = makeTracker(fakeClient(
      () => [directChild, grandchild],
      () => ({ "direct-child": { type: "busy" }, grandchild: { type: "busy" } }),
    ))
    await tracker.ready()

    await Promise.all([
      tracker.handleEvent(created(directChild)),
      tracker.handleEvent(created(grandchild)),
    ])

    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["direct-child"])
    await tracker.dispose()
  })

  test("a root switch remains pending when list fails and commits atomically after recovery", async () => {
    let listFails = false
    let statuses: unknown = { "old-child": { type: "busy" }, "new-child": { type: "idle" } }
    const client: SessionTrackerClient = {
      list: async () => listFails
        ? { error: { authorization: "not retained" } }
        : { data: [session("old-child", "old-root"), session("new-child", "new-root")] },
      status: async () => ({ data: statuses }),
    }
    const tracker = makeTracker(client)
    await tracker.ready()
    await tracker.handleEvent(created(session("old-root", null)))
    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["old-child", "busy"],
    ])

    listFails = true
    statuses = { "old-child": { type: "retry" }, "new-child": { type: "idle" } }
    await tracker.handleEvent(created(session("new-root", null)))

    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["old-child", "retry"],
    ])

    listFails = false
    statuses = { "old-child": { type: "idle" }, "new-child": { type: "busy" } }
    await tracker.reconcile()
    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["new-child", "busy"],
    ])
    await tracker.dispose()
  })

  test("child-first root intent publishes nothing until a successful list commits membership", async () => {
    let listFails = false
    const current = session("current-child", "current-root")
    const client: SessionTrackerClient = {
      list: async () => listFails ? { error: { code: "unavailable" } } : { data: [current] },
      status: async () => ({ data: { "current-child": { type: "busy" } } }),
    }
    const tracker = makeTracker(client)
    await tracker.ready()
    listFails = true

    await tracker.handleEvent(created(current))

    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    listFails = false
    await tracker.reconcile()
    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["current-child"])
    await tracker.dispose()
  })

  test("an observed child remains eligible after becoming idle and missing from status", async () => {
    const observed = session("observed", "current-root")
    let statuses: unknown = { observed: { type: "busy" } }
    const tracker = makeTracker(fakeClient(() => [observed], () => statuses))
    await tracker.ready()

    await tracker.handleEvent(created(observed))
    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["observed", "busy"],
    ])

    statuses = { observed: { type: "idle" } }
    await tracker.reconcile()
    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["observed", "idle"],
    ])

    statuses = {}
    await tracker.reconcile()
    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["observed", "idle"],
    ])
    await tracker.dispose()
  })

  test("a child created and completed before its first authoritative snapshot remains eligible", async () => {
    const observed = session("completed", "current-root")
    let listCalls = 0
    const tracker = makeTracker({
      list: async () => ({ data: ++listCalls === 1 ? [] : [observed] }),
      status: async () => ({ data: {} }),
    })
    await tracker.ready()

    await Promise.all([
      tracker.handleEvent(created(observed)),
      tracker.handleEvent(status("completed", "idle")),
    ])

    expect(tracker.snapshot().sessions.map((item) => [item.id, item.status])).toEqual([
      ["completed", "idle"],
    ])
    await tracker.dispose()
  })

  test("committed root switch clears old eligibility and does not admit new-root idle history", async () => {
    const oldObserved = session("old-observed", "old-root")
    const newHistorical = session("new-historical", "new-root")
    const tracker = makeTracker(fakeClient(
      () => [oldObserved, newHistorical],
      () => ({ "old-observed": { type: "idle" }, "new-historical": { type: "idle" } }),
    ))
    await tracker.ready()
    await tracker.handleEvent(created(oldObserved))
    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["old-observed"])

    await tracker.handleEvent(created(session("new-root", null)))

    expect(tracker.snapshot().sessions).toEqual([])
    await tracker.reconcile()
    expect(tracker.snapshot().sessions).toEqual([])
    await tracker.dispose()
  })

  test("a different live root creation invalidates stale in-flight same-root admission", async () => {
    const oldObserved = session("old-observed", "old-root")
    const oldHistorical = session("old-historical", "old-root")
    const newChild = session("new-child", "new-root")
    const blockedStatus = deferred<Readonly<{ data: unknown }>>()
    let blockStatus = false
    let statuses: unknown = {
      "old-observed": { type: "idle" },
      "old-historical": { type: "idle" },
      "new-child": { type: "idle" },
    }
    const tracker = makeTracker({
      list: async () => ({ data: [oldObserved, oldHistorical, newChild] }),
      status: async () => {
        if (blockStatus) {
          blockStatus = false
          return blockedStatus.promise
        }
        return { data: statuses }
      },
    })
    await tracker.ready()
    await tracker.handleEvent(created(oldObserved))
    const observed: string[][] = []
    tracker.subscribe((snapshot) => { observed.push(snapshot.sessions.map((item) => item.id)) })

    blockStatus = true
    const stale = tracker.reconcile()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const switching = tracker.handleEvent(created(session("new-root", null)))
    statuses = {
      "old-observed": { type: "idle" },
      "old-historical": { type: "busy" },
      "new-child": { type: "busy" },
    }
    blockedStatus.resolve({ data: statuses })
    await Promise.all([stale, switching])

    expect(observed).toEqual([["new-child"]])
    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["new-child"])
    await tracker.dispose()
  })

  test("status failure during a pending root switch retains valid current membership", async () => {
    let statusFails = false
    const client: SessionTrackerClient = {
      list: async () => ({ data: [session("old-child", "old-root"), session("new-child", "new-root")] }),
      status: async () => statusFails
        ? { error: { code: "status-unavailable" } }
        : { data: { "old-child": { type: "busy" }, "new-child": { type: "busy" } } },
    }
    const tracker = makeTracker(client)
    await tracker.ready()
    await tracker.handleEvent(created(session("old-root", null)))
    const revision = tracker.snapshot().revision

    statusFails = true
    await tracker.handleEvent(created(session("new-root", null)))
    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["old-child"])
    expect(tracker.snapshot().revision).toBe(revision)

    statusFails = false
    await tracker.reconcile()
    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["new-child"])
    await tracker.dispose()
  })

  test("foreign deletion and unresolved status events do not alter active-root children", async () => {
    const tracker = makeTracker(fakeClient(
      () => [session("current-child", "current-root"), session("foreign-child", "foreign-root")],
      () => ({ "current-child": { type: "busy" }, "foreign-child": { type: "retry" } }),
    ))
    await tracker.ready()
    await tracker.handleEvent(created(session("current-root", null)))
    const revision = tracker.snapshot().revision

    await tracker.handleEvent(deleted(session("foreign-child", "foreign-root")))
    await tracker.handleEvent(deleted(session("foreign-root", null)))
    await tracker.handleEvent(status("missing-foreign-session", "busy"))

    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["current-child"])
    expect(tracker.snapshot().revision).toBe(revision)
    await tracker.dispose()
  })

  test("deleting the active root clears scope and all published children", async () => {
    const tracker = makeTracker(fakeClient(
      () => [session("current-child", "current-root")],
      () => ({ "current-child": { type: "busy" } }),
    ))
    await tracker.ready()
    await tracker.handleEvent(created(session("current-root", null)))
    expect(tracker.snapshot().sessions).toHaveLength(1)

    await tracker.handleEvent(deleted(session("current-root", null)))

    expect(tracker.snapshot().sessions).toEqual([])
    await tracker.reconcile()
    expect(tracker.snapshot().sessions).toEqual([])
    await tracker.dispose()
  })

  test("authoritative membership filters roots and malformed or empty-parent sessions", async () => {
    const tracker = makeTracker(
      fakeClient(
        () => [session("child"), session("root", null), session("empty", ""), { id: "broken", parentID: "p" }],
        () => ({}),
      ),
    )

    await tracker.ready()
    await selectRoot(tracker)
    await tracker.handleEvent(created(session("child")))

    expect(tracker.snapshot().sessions.map((item) => item.id)).toEqual(["child"])
    expect(tracker.snapshot().sessions[0]?.status).toBe("idle")
    await tracker.dispose()
  })

  test("serializes concurrent callbacks in arrival order", async () => {
    const tracker = makeTracker(fakeClient(() => [session("child")], () => ({ child: { type: "idle" } })))
    await tracker.ready()
    await selectRoot(tracker)
    await tracker.handleEvent(created(session("child")))
    const observed: string[] = []
    tracker.subscribe((snapshot) => {
      observed.push(snapshot.sessions[0]?.status ?? "missing")
    })

    await Promise.all([
      tracker.handleEvent(status("child", "busy")),
      tracker.handleEvent(status("child", "retry")),
      tracker.handleEvent(status("child", "idle")),
    ])

    expect(observed).toEqual(["busy", "retry", "idle"])
    expect(tracker.snapshot().sessions[0]?.status).toBe("idle")
    await tracker.dispose()
  })

  test("makes duplicate events idempotent", async () => {
    const child = session("child")
    const tracker = makeTracker(fakeClient(() => [child], () => ({ child: { type: "busy" } })))
    await tracker.ready()
    await selectRoot(tracker)
    const initialRevision = tracker.snapshot().revision

    await tracker.handleEvent(created(child))
    await tracker.handleEvent(created(child))
    await tracker.handleEvent(status("child", "busy"))

    expect(tracker.snapshot().revision).toBe(initialRevision)
    await tracker.handleEvent(deleted(child))
    await tracker.handleEvent(deleted(child))
    expect(tracker.snapshot().sessions).toEqual([])
    expect(tracker.snapshot().revision).toBe(initialRevision + 1)
    await tracker.dispose()
  })

  test("ignores malformed and non-child events", async () => {
    const tracker = makeTracker(fakeClient())
    await tracker.ready()

    await Promise.all([
      tracker.handleEvent(undefined),
      tracker.handleEvent({ type: "session.created" }),
      tracker.handleEvent(created(session("root", null))),
      tracker.handleEvent(created(session("blank", "   "))),
      tracker.handleEvent(status("", "busy")),
      tracker.handleEvent(status("unknown", "invalid")),
    ])

    expect(tracker.snapshot()).toEqual({ revision: 0, sessions: [] })
    await tracker.dispose()
  })

  test("a deletion queued behind creation leaves no equivalent open membership", async () => {
    const child = session("child")
    const tracker = makeTracker(fakeClient(() => [child], () => ({ child: { type: "busy" } })))
    await tracker.ready()
    await selectRoot(tracker)

    await Promise.all([tracker.handleEvent(created(child)), tracker.handleEvent(deleted(child))])

    expect(tracker.snapshot().sessions).toEqual([])
    await tracker.dispose()
  })

  test("unknown or out-of-order status reconciles membership and status", async () => {
    let listCalls = 0
    const client: SessionTrackerClient = {
      list: async () => {
        listCalls++
        return { data: listCalls < 3 ? [] : [session("late")] }
      },
      status: async () => ({ data: { late: { type: "retry", attempt: 2, message: "retry", next: 2 } } }),
    }
    const tracker = makeTracker(client)
    await tracker.ready()
    await selectRoot(tracker)

    await expect(tracker.handleEvent(status("late", "busy"))).resolves.toBe(true)

    expect(listCalls).toBe(3)
    expect(tracker.snapshot().sessions[0]).toMatchObject({ id: "late", status: "retry" })
    await tracker.dispose()
  })

  test("infers idle only for known listed children absent from a successful status map", async () => {
    let statuses: unknown = { child: { type: "busy" }, unrelated: { type: "busy" } }
    const tracker = makeTracker(fakeClient(() => [session("child")], () => statuses))
    await tracker.ready()
    await selectRoot(tracker)
    expect(tracker.snapshot().sessions[0]?.status).toBe("busy")

    statuses = {}
    await tracker.reconcile()

    expect(tracker.snapshot().sessions[0]?.status).toBe("idle")
    expect(tracker.snapshot().sessions).toHaveLength(1)
    await tracker.dispose()
  })

  test("periodic reconciliation replaces stale event membership with snapshots", async () => {
    const scheduler = new ManualScheduler()
    let sessions: FakeSession[] = []
    let statuses: Record<string, { type: "busy" }> = {}
    let listCalls = 0
    const tracker = makeTracker(
      fakeClient(() => {
        listCalls++
        return sessions
      }, () => statuses),
      scheduler,
    )
    await tracker.ready()
    await selectRoot(tracker)
    sessions = [session("periodic")]
    statuses = { periodic: { type: "busy" } }

    scheduler.tick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(listCalls).toBe(3)
    expect(tracker.snapshot().sessions[0]).toMatchObject({ id: "periodic", status: "busy" })
    await tracker.dispose()
    expect(scheduler.cleared).toBe(1)
  })

  test("coalesces many periodic ticks while SDK calls are permanently stalled", async () => {
    const scheduler = new ManualScheduler()
    let listCalls = 0
    let statusCalls = 0
    const never = new Promise<Readonly<{ data: unknown }>>(() => undefined)
    const tracker = makeTracker(
      {
        list: () => {
          listCalls++
          return never
        },
        status: () => {
          statusCalls++
          return never
        },
      },
      scheduler,
      100,
      10,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (let index = 0; index < 100; index++) scheduler.tick()
    await tracker.ready()

    expect(listCalls).toBe(1)
    expect(statusCalls).toBe(1)
    expect(tracker.snapshot().sessions).toEqual([])
    await tracker.dispose()
  })

  test("coalesces reconciliation requested by duplicate events", async () => {
    const child = session("duplicate")
    const blockedList = deferred<Readonly<{ data: unknown }>>()
    let listCalls = 0
    const tracker = makeTracker({
      list: async () => {
        listCalls++
        if (listCalls === 1) return { data: [] }
        return blockedList.promise
      },
      status: async () => ({ data: { duplicate: { type: "busy" } } }),
    })
    await tracker.ready()

    const callbacks = Array.from({ length: 50 }, () => tracker.handleEvent(created(child)))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listCalls).toBe(2)
    blockedList.resolve({ data: [child] })
    await Promise.all(callbacks)

    expect(listCalls).toBe(2)
    expect(tracker.snapshot().sessions[0]).toMatchObject({ id: "duplicate", status: "busy" })
    await tracker.dispose()
  })

  test("contains thrown and response SDK failures without erasing known state or rejecting hooks", async () => {
    let fail = false
    const client: SessionTrackerClient = {
      list: async () => {
        if (fail) throw new Error("request included secret material")
        return { data: [session("child")] }
      },
      status: async () => (fail ? { error: { authorization: "secret" } } : { data: { child: { type: "busy" } } }),
    }
    const tracker = makeTracker(client)
    await tracker.ready()
    await selectRoot(tracker)
    fail = true

    await expect(tracker.reconcile()).resolves.toBe(true)
    await expect(tracker.handleEvent(status("missing", "busy"))).resolves.toBe(true)

    expect(tracker.snapshot().sessions[0]).toMatchObject({ id: "child", status: "busy" })
    await tracker.dispose()
  })

  test("contains subscriber failures and continues notifying other subscribers", async () => {
    const tracker = makeTracker(fakeClient(() => [session("child")], () => ({ child: { type: "idle" } })))
    await tracker.ready()
    await selectRoot(tracker)
    await tracker.handleEvent(created(session("child")))
    let calls = 0
    tracker.subscribe(() => {
      throw new Error("consumer failure")
    })
    tracker.subscribe(() => {
      calls++
    })

    await tracker.handleEvent(status("child", "busy"))

    expect(calls).toBe(1)
    await tracker.dispose()
  })

  test("contains rejecting async subscribers without blocking mutation or other listeners", async () => {
    const tracker = makeTracker(fakeClient(() => [session("child")], () => ({ child: { type: "idle" } })))
    await tracker.ready()
    await selectRoot(tracker)
    await tracker.handleEvent(created(session("child")))
    let calls = 0
    tracker.subscribe(async () => {
      await Promise.resolve()
      throw new Error("asynchronous consumer failure")
    })
    tracker.subscribe(async () => {
      calls++
    })

    await expect(tracker.handleEvent(status("child", "busy"))).resolves.toBe(true)
    expect(calls).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await tracker.dispose()
  })

  test("aborts active SDK requests on disposal and ignores their late completion", async () => {
    const scheduler = new ManualScheduler()
    const blocked = deferred<Readonly<{ data: unknown }>>()
    let signal: AbortSignal | undefined
    let statusCalls = 0
    const tracker = makeTracker(
      {
        list: ({ signal: requestSignal }) => {
          signal = requestSignal
          return blocked.promise
        },
        status: async () => {
          statusCalls++
          return { data: {} }
        },
      },
      scheduler,
      100,
      10_000,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signal?.aborted).toBe(false)

    await tracker.dispose()

    expect(signal?.aborted).toBe(true)
    expect(statusCalls).toBe(0)
    blocked.resolve({ data: [session("late")] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tracker.snapshot().sessions).toEqual([])
  })

  test("does not commit a noncompliant SDK result that completes after its deadline", async () => {
    const blocked = deferred<Readonly<{ data: unknown }>>()
    const tracker = makeTracker(
      {
        list: () => blocked.promise,
        status: async () => ({ data: {} }),
      },
      new ManualScheduler(),
      100,
      5,
    )

    await tracker.ready()
    blocked.resolve({ data: [session("too-late")] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(tracker.snapshot().sessions).toEqual([])
    await tracker.dispose()
  })

  test("disposal is bounded, idempotent, rejects new mutations, and blocks late commits", async () => {
    const scheduler = new ManualScheduler()
    const blocked = deferred<Readonly<{ data: unknown }>>()
    const client: SessionTrackerClient = {
      list: () => blocked.promise,
      status: async () => ({ data: {} }),
    }
    const tracker = makeTracker(client, scheduler, 10)
    const firstDispose = tracker.dispose()

    expect(tracker.dispose()).toBe(firstDispose)
    await expect(tracker.handleEvent(created(session("late")))).resolves.toBe(false)
    await expect(tracker.reconcile()).resolves.toBe(false)
    await firstDispose
    expect(scheduler.cleared).toBe(1)

    blocked.resolve({ data: [session("late")] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tracker.snapshot().sessions).toEqual([])
  })
})
