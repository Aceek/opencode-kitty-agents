import { createConnection } from "node:net"
import type { Plugin } from "@opencode-ai/plugin"
import {
  assertPrivateEndpoint,
  ENDPOINT_ENV,
  GATE_OPERATION,
  GATE_VERSION,
  parseGateResponse,
} from "./contracts"

async function requestProbe(endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(endpoint)
    let response = ""
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      error ? reject(error) : resolve()
    }
    socket.setTimeout(30_000, () => finish(new Error("probe timed out")))
    socket.on("error", () => finish(new Error("probe IPC failed")))
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ version: GATE_VERSION, operation: GATE_OPERATION })}\n`)
    })
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8")
      if (response.length > 512) return finish(new Error("invalid probe response"))
      const newline = response.indexOf("\n")
      if (newline < 0) return
      try {
        parseGateResponse(response.slice(0, newline))
        finish()
      } catch {
        finish(new Error("invalid probe response"))
      }
    })
  })
}

const plugin = (async () => {
  const runtimeDirectory = process.env.XDG_RUNTIME_DIR
  const endpointValue = process.env[ENDPOINT_ENV]
  if (!runtimeDirectory || !endpointValue) throw new Error("Gate 0 endpoint is unavailable")
  const endpoint = assertPrivateEndpoint(endpointValue, runtimeDirectory)
  await requestProbe(endpoint)
  return {}
}) satisfies Plugin

export default plugin
