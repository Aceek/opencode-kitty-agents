import { chmodSync, lstatSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { parseBrokerRequest, BROKER_PROTOCOL_VERSION, MAX_BROKER_MESSAGE_BYTES, type BrokerResponse } from "./protocol"
import type { BrokerRequest } from "./protocol"
import { DEFAULT_BROKER_IPC_TIMEOUT_MS } from "./timeouts"

function invalidResponse(): BrokerResponse {
  return { version: BROKER_PROTOCOL_VERSION, ok: false, error: "invalid-request" }
}

export type BrokerRequestHandler = Readonly<{ request(request: BrokerRequest): Promise<BrokerResponse> }>
export type BrokerServer = Readonly<{ close(): Promise<void>; closed: Promise<void> }>

export async function listenBroker(
  endpoint: string,
  broker: BrokerRequestHandler,
  requestTimeoutMs = DEFAULT_BROKER_IPC_TIMEOUT_MS,
): Promise<BrokerServer> {
  let active = new Set<Socket>()
  let requestActive = false
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  let didClose = false
  const close = async () => {
    if (didClose) return
    didClose = true
    await closeServer(server, active)
    active = new Set()
    rmSync(endpoint, { force: true })
    resolveClosed()
  }
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    let closeAfterResponse = false
    active.add(socket)
    socket.once("close", () => active.delete(socket))
    socket.on("error", () => {
      socket.destroy()
      if (closeAfterResponse) void close()
    })
    socket.setTimeout(requestTimeoutMs, () => socket.destroy())
    let request = Buffer.alloc(0)
    socket.on("data", (chunk: Buffer) => {
      request = Buffer.concat([request, chunk])
      if (request.byteLength > MAX_BROKER_MESSAGE_BYTES + 1) {
        safeEnd(socket, invalidResponse())
        return
      }
      const newline = request.indexOf(10)
      if (newline < 0) return
      if (newline !== request.length - 1) {
        safeEnd(socket, invalidResponse())
        return
      }
      socket.pause()
      let parsed
      try {
        parsed = parseBrokerRequest(request.subarray(0, newline).toString("utf8"))
      } catch {
        safeEnd(socket, invalidResponse())
        return
      }
      if (requestActive) {
        safeEnd(socket, {
          version: BROKER_PROTOCOL_VERSION,
          operation: parsed.operation,
          ok: false,
          error: "broker-unavailable",
        })
        return
      }
      requestActive = true
      void broker.request(parsed).then(
        (response) => {
          requestActive = false
          closeAfterResponse = parsed.operation === "shutdown"
          if (socket.destroyed || !socket.writable) {
            if (closeAfterResponse) void close()
            return
          }
          safeEnd(socket, response, () => {
            if (!closeAfterResponse) return
            active.delete(socket)
            socket.destroy()
            void close()
          })
        },
        () => {
          requestActive = false
          safeEnd(socket, {
            version: BROKER_PROTOCOL_VERSION,
            operation: parsed.operation,
            ok: false,
            error: "broker-unavailable",
          })
        },
      )
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(endpoint, () => resolve())
  })
  chmodSync(endpoint, 0o600)
  const info = lstatSync(endpoint)
  if (!info.isSocket() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
    await closeServer(server, active)
    throw new Error("broker endpoint unavailable")
  }

  return {
    close,
    closed,
  }
}

function safeEnd(socket: Socket, response: BrokerResponse, callback?: () => void): void {
  if (socket.destroyed || !socket.writable) {
    callback?.()
    return
  }
  try {
    socket.end(`${JSON.stringify(response)}\n`, callback)
  } catch {
    socket.destroy()
    callback?.()
  }
}

function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy()
  return new Promise((resolve) => server.close(() => resolve()))
}
