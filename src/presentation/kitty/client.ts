import { createConnection, type Socket } from "node:net"
import {
  BROKER_PROTOCOL_VERSION,
  MAX_BROKER_MESSAGE_BYTES,
  parseBrokerResponse,
  type BrokerRequest,
  type BrokerResponse,
} from "../../broker/protocol"
import { DEFAULT_BROKER_IPC_TIMEOUT_MS } from "../../broker/timeouts"

export interface BrokerTransport {
  exchange(request: string): Promise<string>
}

export class BrokerClientError extends Error {
  readonly code:
    | "broker-unavailable"
    | "unsupported-layout"
    | "unknown-window"
    | "kitty-failed"
    | "timeout"
    | "shutting-down"
    | "protocol-error"

  constructor(code: BrokerClientError["code"]) {
    super(`broker request failed: ${code}`)
    this.name = "BrokerClientError"
    this.code = code
  }
}

export function createUnixBrokerTransport(endpoint: string, timeoutMs = DEFAULT_BROKER_IPC_TIMEOUT_MS): BrokerTransport {
  return {
    exchange(request) {
      return new Promise<string>((resolve, reject) => {
        let settled = false
        let response = Buffer.alloc(0)
        const socket: Socket = createConnection(endpoint)
        const finish = (error?: Error, value?: string) => {
          if (settled) return
          settled = true
          socket.destroy()
          if (error) reject(error)
          else resolve(value as string)
        }
        socket.setTimeout(timeoutMs, () => finish(new BrokerClientError("timeout")))
        socket.once("connect", () => socket.write(`${request}\n`))
        socket.on("data", (chunk: Buffer) => {
          response = Buffer.concat([response, chunk])
          if (response.byteLength > MAX_BROKER_MESSAGE_BYTES + 1) finish(new BrokerClientError("protocol-error"))
        })
        socket.once("end", () => {
          if (response.length < 2 || response[response.length - 1] !== 10 || response.subarray(0, -1).includes(10)) {
            finish(new BrokerClientError("protocol-error"))
            return
          }
          finish(undefined, response.subarray(0, -1).toString("utf8"))
        })
        socket.once("error", () => finish(new BrokerClientError("broker-unavailable")))
      })
    },
  }
}

export class BrokerClient {
  readonly #transport: BrokerTransport

  constructor(transport: BrokerTransport) {
    this.#transport = transport
  }

  async request(request: BrokerRequest): Promise<BrokerResponse> {
    let response: BrokerResponse
    try {
      response = parseBrokerResponse(await this.#transport.exchange(JSON.stringify(request)))
    } catch (error) {
      if (error instanceof BrokerClientError) throw error
      throw new BrokerClientError("protocol-error")
    }
    if (response.ok === false) {
      if (response.error === "invalid-request") throw new BrokerClientError("protocol-error")
      throw new BrokerClientError(response.error)
    }
    if (response.operation !== request.operation) throw new BrokerClientError("protocol-error")
    return response
  }

  availability() {
    return this.request({ version: BROKER_PROTOCOL_VERSION, operation: "availability" })
  }
}
