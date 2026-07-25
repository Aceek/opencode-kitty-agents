import { describe, expect, test } from "bun:test"
import { KittyPresentationAdapter } from "../src/presentation/kitty/adapter"
import type { BrokerTransport } from "../src/presentation/kitty/client"

const session = {
  id: "ses_child",
  parentID: "ses_parent",
  directory: "/repo",
  title: "Child",
  status: "busy",
} as const

function response(value: object): BrokerTransport {
  return { async exchange() { return JSON.stringify(value) } }
}

function options(transport?: BrokerTransport) {
  return {
    config: { splitDirection: "vertical" as const, childBias: 40, focusPolicy: "preserve" as const },
    ...(transport === undefined ? { env: {} } : { transport }),
    now: () => 123,
  }
}

describe("broker-backed Kitty presentation adapter", () => {
  test("degrades cleanly when endpoint metadata is absent", async () => {
    const adapter = new KittyPresentationAdapter(options())
    expect(await adapter.availability()).toEqual({ available: false, reason: "broker-unavailable" })
    await expect(adapter.open(session, new URL("http://127.0.0.1:4096"))).rejects.toMatchObject({ code: "broker-unavailable" })
  })

  test("maps availability and validates strict fake-transport responses", async () => {
    const available = new KittyPresentationAdapter(
      options(response({ version: 1, operation: "availability", ok: true, available: true })),
    )
    expect(await available.availability()).toEqual({ available: true })

    const unsupported = new KittyPresentationAdapter(
      options(
        response({
          version: 1,
          operation: "availability",
          ok: true,
          available: false,
          reason: "unsupported-layout",
        }),
      ),
    )
    expect(await unsupported.availability()).toEqual({ available: false, reason: "unsupported-layout" })

    const malformed = new KittyPresentationAdapter(options(response({ ok: true, endpoint: "/secret" })))
    expect(await malformed.availability()).toEqual({ available: false, reason: "broker-unavailable" })
  })

  test("sends only fixed protocol fields and returns a non-sensitive handle", async () => {
    const requests: unknown[] = []
    const transport: BrokerTransport = {
      async exchange(raw) {
        const request = JSON.parse(raw)
        requests.push(request)
        switch (request.operation) {
          case "open":
            return JSON.stringify({ version: 1, operation: "open", ok: true, windowID: 19 })
          case "exists":
            return JSON.stringify({ version: 1, operation: "exists", ok: true, exists: true })
          case "focus":
          case "close":
          case "shutdown":
            return JSON.stringify({ version: 1, operation: request.operation, ok: true })
          default:
            throw new Error("unexpected operation")
        }
      },
    }
    const adapter = new KittyPresentationAdapter(options(transport))
    const handle = await adapter.open(session, new URL("http://127.0.0.1:4096"))
    expect(handle).toEqual({ backend: "kitty", windowID: 19, openedAt: 123 })
    expect(await adapter.exists(handle)).toBe(true)
    await adapter.focus(handle)
    await adapter.close(handle)
    await adapter.dispose()
    await adapter.dispose()

    expect(requests).toEqual([
      {
        version: 1,
        operation: "open",
        serverUrl: "http://127.0.0.1:4096/",
        directory: "/repo",
        sessionID: "ses_child",
        splitDirection: "vertical",
        childBias: 40,
        focusPolicy: "preserve",
      },
      { version: 1, operation: "exists", windowID: 19 },
      { version: 1, operation: "focus", windowID: 19 },
      { version: 1, operation: "close", windowID: 19 },
      { version: 1, operation: "shutdown" },
    ])
    expect(JSON.stringify(requests)).not.toContain("executable")
    expect(JSON.stringify(requests)).not.toContain("env")
    expect(JSON.stringify(requests)).not.toContain("match")
  })

  test("passes the configured child focus policy to the broker", async () => {
    let request: Record<string, unknown> | undefined
    const transport: BrokerTransport = {
      async exchange(raw) {
        request = JSON.parse(raw)
        return JSON.stringify({ version: 1, operation: "open", ok: true, windowID: 20 })
      },
    }
    const adapter = new KittyPresentationAdapter({
      ...options(transport),
      config: { splitDirection: "vertical", childBias: 40, focusPolicy: "child" },
    })
    await adapter.open(session, new URL("http://127.0.0.1:4096"))
    expect(request?.focusPolicy).toBe("child")
  })

  test("does not expose malformed response content in adapter errors", async () => {
    const secret = "private-endpoint-and-capability"
    const adapter = new KittyPresentationAdapter(options(response({ secret })))
    await adapter.open(session, new URL("http://127.0.0.1:4096")).catch((error) => expect(String(error)).not.toContain(secret))
  })

  test("dispose waits for a racing open, then sends shutdown exactly once", async () => {
    const operations: string[] = []
    let resolveOpen!: (response: string) => void
    const deferredOpen = new Promise<string>((resolve) => {
      resolveOpen = resolve
    })
    const transport: BrokerTransport = {
      async exchange(raw) {
        const request = JSON.parse(raw) as { operation: string }
        operations.push(request.operation)
        if (request.operation === "open") return deferredOpen
        if (request.operation === "shutdown") {
          return JSON.stringify({ version: 1, operation: "shutdown", ok: true })
        }
        throw new Error("unexpected operation")
      },
    }
    const adapter = new KittyPresentationAdapter(options(transport))
    const opening = adapter.open(session, new URL("http://127.0.0.1:4096"))
    const disposing = adapter.dispose()

    expect(operations).toEqual(["open"])
    await expect(adapter.open(session, new URL("http://127.0.0.1:4096"))).rejects.toMatchObject({ code: "broker-unavailable" })
    resolveOpen(JSON.stringify({ version: 1, operation: "open", ok: true, windowID: 19 }))

    await expect(opening).resolves.toEqual({ backend: "kitty", windowID: 19, openedAt: 123 })
    await expect(disposing).resolves.toBeUndefined()
    await expect(adapter.dispose()).resolves.toBeUndefined()
    expect(operations).toEqual(["open", "shutdown"])
  })
})
