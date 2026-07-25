import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import plugin, { createPlugin } from "../src/index"
import type { PresentationAdapter } from "../src/presentation/adapter"
import type { SessionTrackerSnapshot } from "../src/session/tracker"

function fakeAdapter(): PresentationAdapter {
  return {
    async availability() { return { available: true } },
    async open() { return { backend: "kitty", windowID: 1, openedAt: 1 } },
    async exists() { return true },
    async focus() {},
    async close() {},
    async dispose() {},
  }
}

describe("plugin contract", () => {
  test("exports an OpenCode plugin function", () => {
    expect(plugin).toMatchObject({ id: "opencode-kitty-agents" })
    expect(plugin.server).toBeFunction()
  })

  test("creates no runtime resources or reads context when disabled", async () => {
    const input = new Proxy({} as PluginInput, {
      get() { throw new Error("disabled plugin read runtime context") },
    })
    await expect(plugin.server(input, { enabled: false })).resolves.toEqual({})
  })

  test("keeps the plugin callable while validating its options", async () => {
    const input = {} as PluginInput
    await expect(plugin.server(input, { enabled: "yes" })).rejects.toThrow('"enabled" must be a boolean')
  })

  test("installs integrated event and awaited disposal hooks when enabled", async () => {
    let listSignal: AbortSignal | undefined
    let statusSignal: AbortSignal | undefined
    const input = {
      client: {
        session: {
          list: async ({ signal }: { signal: AbortSignal }) => {
            listSignal = signal
            return { data: [], request: {}, response: {} }
          },
          status: async ({ signal }: { signal: AbortSignal }) => {
            statusSignal = signal
            return { data: {}, request: {}, response: {} }
          },
        },
      },
      serverUrl: new URL("http://127.0.0.1:4096"),
    } as unknown as PluginInput

    // This injected adapter makes endpoint discovery impossible in the test,
    // regardless of the developer's live process environment.
    const isolatedPlugin = createPlugin({
      createAdapter: () => fakeAdapter(),
      fetch: async () => ({
        ok: true,
        async json() { return { healthy: true, version: "1.18.4" } },
      }),
    })
    const hooks = await isolatedPlugin(input, { enabled: true, reconciliationIntervalMs: 1_000 })

    expect(hooks.event).toBeFunction()
    expect(hooks.dispose).toBeFunction()
    expect(Object.keys(hooks).sort()).toEqual(["dispose", "event"])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listSignal).toBeInstanceOf(AbortSignal)
    expect(statusSignal).toBeInstanceOf(AbortSignal)
    await hooks.dispose?.()
  })

  test("filters unrelated event floods before allocating tracker queue work", async () => {
    let handled = 0
    let listener: ((snapshot: SessionTrackerSnapshot) => void | Promise<void>) | undefined
    const snapshot: SessionTrackerSnapshot = Object.freeze({ revision: 0, sessions: Object.freeze([]) })
    const isolatedPlugin = createPlugin({
      createTracker: () => ({
        snapshot: () => snapshot,
        subscribe: (next) => { listener = next; return () => { listener = undefined } },
        async handleEvent() { handled += 1; return true },
        async dispose() {},
      }),
      createAdapter: () => fakeAdapter(),
      fetch: async () => ({
        ok: true,
        async json() { return { healthy: true, version: "1.18.4" } },
      }),
    })
    const input = { serverUrl: new URL("http://127.0.0.1:4096") } as PluginInput
    const hooks = await isolatedPlugin(input, { reconciliationIntervalMs: 1_000 })

    await Promise.all(Array.from({ length: 10_000 }, (_, index) =>
      hooks.event?.({ event: { type: "message.updated", properties: { index } } as never }),
    ))
    expect(handled).toBe(0)
    await hooks.event?.({ event: { type: "session.status", properties: {} } as never })
    expect(handled).toBe(1)
    expect(listener).toBeDefined()
    await hooks.dispose?.()
    expect(listener).toBeUndefined()
  })
})
