import { chmodSync, mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createConnection } from "node:net"
import { afterEach, describe, expect, test } from "bun:test"
import { createUnixBrokerTransport } from "../src/presentation/kitty/client"
import { listenBroker } from "../src/broker/server"

const cleanup: string[] = []
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("broker server shutdown", () => {
  test("an immediate shutdown response closes the initialized server callback safely", async () => {
    const runtime = mkdtempSync("/tmp/opencode-kitty-server-")
    cleanup.push(runtime)
    chmodSync(runtime, 0o700)
    const directory = join(runtime, "opencode-kitty-agents-random")
    mkdirSync(directory, { mode: 0o700 })
    const endpoint = join(directory, "broker.sock")
    const server = await listenBroker(endpoint, {
      async request(request) {
        expect(request.operation).toBe("shutdown")
        return { version: 1, operation: "shutdown", ok: true }
      },
    })
    const raw = await createUnixBrokerTransport(endpoint).exchange('{"version":1,"operation":"shutdown"}')
    expect(JSON.parse(raw)).toEqual({ version: 1, operation: "shutdown", ok: true })
    await server.closed
    await expect(server.close()).resolves.toBeUndefined()
  })

  test("contains a client disconnect while an asynchronous response is pending", async () => {
    const runtime = mkdtempSync("/tmp/opencode-kitty-server-")
    cleanup.push(runtime)
    chmodSync(runtime, 0o700)
    const directory = join(runtime, "opencode-kitty-agents-random")
    mkdirSync(directory, { mode: 0o700 })
    const endpoint = join(directory, "broker.sock")
    let resolveRequest!: () => void
    const pending = new Promise<void>((resolve) => {
      resolveRequest = resolve
    })
    const server = await listenBroker(endpoint, {
      async request() {
        await pending
        return { version: 1, operation: "availability", ok: true, available: true }
      },
    })
    const client = createConnection(endpoint)
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => {
        client.write('{"version":1,"operation":"availability"}\n')
        client.destroy()
        resolve()
      })
      client.once("error", reject)
    })
    resolveRequest()
    await Bun.sleep(20)
    await expect(server.close()).resolves.toBeUndefined()
  })

  test("rejects a concurrent request instead of adding unbounded queue wait", async () => {
    const runtime = mkdtempSync("/tmp/opencode-kitty-server-")
    cleanup.push(runtime)
    chmodSync(runtime, 0o700)
    const directory = join(runtime, "opencode-kitty-agents-random")
    mkdirSync(directory, { mode: 0o700 })
    const endpoint = join(directory, "broker.sock")
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = await listenBroker(endpoint, {
      async request() {
        started()
        await pending
        return { version: 1, operation: "availability", ok: true, available: true }
      },
    }, 100)
    const first = createUnixBrokerTransport(endpoint, 100).exchange('{"version":1,"operation":"availability"}')
    await requestStarted
    const second = await createUnixBrokerTransport(endpoint, 100).exchange(
      '{"version":1,"operation":"availability"}',
    )
    expect(JSON.parse(second)).toMatchObject({ ok: false, error: "broker-unavailable" })
    release()
    expect(JSON.parse(await first)).toMatchObject({ ok: true, available: true })
    await server.close()
  })
})
