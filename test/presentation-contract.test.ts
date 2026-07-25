import { describe, expect, test } from "bun:test"
import type { PresentationAdapter } from "../src/presentation/adapter"
import type { PresentationHandle, PresentationState } from "../src/presentation/types"
import type { ChildSession } from "../src/session/types"

const session = {
  id: "child-1",
  parentID: "parent-1",
  directory: "/worktree",
  title: "Investigate",
  status: "busy",
} as const satisfies ChildSession

const handle = {
  backend: "kitty",
  windowID: 42,
  openedAt: 1_721_824_000_000,
} as const satisfies PresentationHandle

describe("presentation contracts", () => {
  test("an adapter can implement the complete broker-backed boundary", async () => {
    const calls: string[] = []
    const adapter = {
      async availability() {
        calls.push("availability")
        return { available: true } as const
      },
      async open(input, serverUrl) {
        expect(input).toBe(session)
        expect(serverUrl.href).toBe("http://127.0.0.1:4096/")
        calls.push("open")
        return handle
      },
      async exists(input) {
        expect(input).toBe(handle)
        calls.push("exists")
        return true
      },
      async focus(input) {
        expect(input).toBe(handle)
        calls.push("focus")
      },
      async close(input) {
        expect(input).toBe(handle)
        calls.push("close")
      },
      async dispose() {
        calls.push("dispose")
      },
    } satisfies PresentationAdapter

    expect(await adapter.availability()).toEqual({ available: true })
    const opened = await adapter.open(session, new URL("http://127.0.0.1:4096"))
    expect(await adapter.exists(opened)).toBe(true)
    await adapter.focus(opened)
    await adapter.close(opened)
    await adapter.dispose()

    expect(calls).toEqual(["availability", "open", "exists", "focus", "close", "dispose"])
    expect(Object.keys(opened).sort()).toEqual(["backend", "openedAt", "windowID"])
  })

  test("presentation state composes desired lifecycle and a non-sensitive handle", () => {
    const state = {
      desired: "open",
      phase: "open",
      handle,
    } as const satisfies PresentationState

    expect(state.handle).toBe(handle)
    expect("endpoint" in state.handle).toBe(false)
    expect("capability" in state.handle).toBe(false)
  })

  test("availability failure is a bounded, non-sensitive reason", async () => {
    const adapter: Pick<PresentationAdapter, "availability"> = {
      async availability() {
        return { available: false, reason: "broker-unavailable" }
      },
    }

    const availability = await adapter.availability()
    expect(availability.available).toBe(false)
    if (!availability.available) expect(availability.reason).toBe("broker-unavailable")
  })
})
