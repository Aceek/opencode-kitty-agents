import { describe, expect, test } from "bun:test"
import { ShutdownLatch, StartupAbortedError } from "../src/broker/shutdown"

describe("broker shutdown latch", () => {
  test("retains a signal received before startup has a resource to close", () => {
    const latch = new ShutdownLatch()
    latch.request()
    expect(latch.requested).toBe(true)
    expect(() => latch.throwIfRequested()).toThrow(StartupAbortedError)
  })

  test("marks shutdown before invoking current-resource cleanup", () => {
    const latch = new ShutdownLatch()
    let observed = false
    latch.request(() => {
      observed = latch.requested
    })
    expect(observed).toBe(true)
  })
})
