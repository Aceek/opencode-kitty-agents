import { describe, expect, test } from "bun:test"
import { KittyBroker } from "../src/broker/core"
import { parseBrokerRequest } from "../src/broker/protocol"
import {
  BROKER_OPERATION_BUDGET_MS,
  DEFAULT_BROKER_IPC_TIMEOUT_MS,
  MAX_KITTY_SUBPROCESSES_PER_BROKER_OPERATION,
} from "../src/broker/timeouts"
import { DEFAULT_PROCESS_TIMEOUT_MS } from "../src/broker/runner"
import { BrokerClient, type BrokerTransport } from "../src/presentation/kitty/client"

describe("broker timeout budget", () => {
  test("keeps the shared IPC timeout beyond the worst serialized operation budget", () => {
    expect(BROKER_OPERATION_BUDGET_MS).toBeGreaterThanOrEqual(
      DEFAULT_PROCESS_TIMEOUT_MS * MAX_KITTY_SUBPROCESSES_PER_BROKER_OPERATION,
    )
    expect(DEFAULT_BROKER_IPC_TIMEOUT_MS).toBeGreaterThan(BROKER_OPERATION_BUDGET_MS)
    expect(DEFAULT_BROKER_IPC_TIMEOUT_MS).toBeGreaterThan(10_000)
  })

  test("returns one handle after a serialized open whose simulated work exceeds the old 10s timeout", async () => {
    let simulatedElapsedMs = 0
    let launched = false
    const runner = async (argv: readonly string[]) => {
      simulatedElapsedMs += 3_000
      if (argv[3] === "launch") {
        launched = true
        return { stdout: "19" }
      }
      return {
        stdout: JSON.stringify([
          {
            tabs: [
              {
                layout: "splits",
                windows: launched
                  ? [
                      { id: 12, lines: 40, columns: 60 },
                      { id: 19, lines: 40, columns: 40 },
                    ]
                  : [{ id: 12, lines: 40, columns: 100 }],
              },
            ],
          },
        ]),
      }
    }
    const broker = new KittyBroker(
      {
        originWindowID: 12,
        opencodeExecutable: "/trusted/opencode",
        openCodeEnvironment: ["HOME=/home/test"],
        recoveryToken: () => "test-recovery-token-123",
      },
      runner,
    )
    const transport: BrokerTransport = {
      async exchange(raw) {
        return JSON.stringify(await broker.request(parseBrokerRequest(raw)))
      },
    }
    const response = await new BrokerClient(transport).request({
      version: 1,
      operation: "open",
      serverUrl: "http://localhost:4096/",
      directory: "/repo",
      sessionID: "child",
      splitDirection: "vertical",
      childBias: 40,
      focusPolicy: "preserve",
    })
    expect(response).toEqual({ version: 1, operation: "open", ok: true, windowID: 19 })
    expect(simulatedElapsedMs).toBe(12_000)
    expect(simulatedElapsedMs).toBeGreaterThan(10_000)
    expect(simulatedElapsedMs).toBeLessThan(BROKER_OPERATION_BUDGET_MS)
  })
})
