import { chmodSync, mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  BrokerEndpointError,
  endpointFromEnvironment,
  validateBrokerEndpoint,
  validateRuntimeDirectory,
} from "../src/broker/endpoint"

const cleanup: string[] = []
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("private broker endpoint", () => {
  test("requires endpoint and runtime metadata without exposing missing values", () => {
    expect(() => endpointFromEnvironment({})).toThrow(BrokerEndpointError)
    expect(() => validateRuntimeDirectory("relative/path")).toThrow("broker endpoint unavailable")
  })

  test("accepts only an owner-private socket under the runtime directory", async () => {
    const runtime = mkdtempSync("/tmp/opencode-kitty-runtime-")
    cleanup.push(runtime)
    chmodSync(runtime, 0o700)
    const directory = join(runtime, "opencode-kitty-agents-random_123")
    mkdirSync(directory, { mode: 0o700 })
    const endpoint = join(directory, "broker.sock")
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(endpoint, resolve)
    })
    chmodSync(endpoint, 0o600)
    try {
      expect(validateRuntimeDirectory(runtime)).toBe(runtime)
      expect(validateBrokerEndpoint(endpoint, runtime)).toBe(endpoint)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  test("rejects a public socket and paths outside the private naming boundary", async () => {
    const runtime = mkdtempSync("/tmp/opencode-kitty-runtime-")
    cleanup.push(runtime)
    chmodSync(runtime, 0o700)
    const directory = join(runtime, "opencode-kitty-agents-random")
    mkdirSync(directory, { mode: 0o700 })
    const endpoint = join(directory, "broker.sock")
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(endpoint, resolve))
    chmodSync(endpoint, 0o666)
    try {
      expect(() => validateBrokerEndpoint(endpoint, runtime)).toThrow("broker endpoint unavailable")
      expect(() => validateBrokerEndpoint(join(runtime, "other.sock"), runtime)).toThrow("broker endpoint unavailable")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
