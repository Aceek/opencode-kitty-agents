import { endpointFromEnvironment } from "../../broker/endpoint"
import { BROKER_PROTOCOL_VERSION } from "../../broker/protocol"
import type { PluginConfig } from "../../config"
import type { ChildSession } from "../../session/types"
import type { PresentationAdapter } from "../adapter"
import type { PresentationAvailability, PresentationHandle } from "../types"
import { BrokerClient, BrokerClientError, createUnixBrokerTransport, type BrokerTransport } from "./client"

export type KittyPresentationAdapterOptions = Readonly<{
  config: Pick<PluginConfig, "splitDirection" | "childBias" | "focusPolicy">
  transport?: BrokerTransport
  env?: Record<string, string | undefined>
  now?: () => number
}>

export class KittyPresentationAdapter implements PresentationAdapter {
  readonly #config: KittyPresentationAdapterOptions["config"]
  readonly #client?: BrokerClient
  readonly #now: () => number
  readonly #inFlight = new Set<Promise<unknown>>()
  #accepting = true
  #disposePromise?: Promise<void>

  constructor(options: KittyPresentationAdapterOptions) {
    this.#config = options.config
    this.#now = options.now ?? Date.now
    try {
      this.#client = new BrokerClient(
        options.transport ?? createUnixBrokerTransport(endpointFromEnvironment(options.env ?? process.env)),
      )
    } catch {
      this.#client = undefined
    }
  }

  async availability(): Promise<PresentationAvailability> {
    if (!this.#accepting || !this.#client) return { available: false, reason: "broker-unavailable" }
    try {
      const response = await this.#track(this.#client.availability())
      if (!response.ok || response.operation !== "availability") return { available: false, reason: "broker-unavailable" }
      return response.available ? { available: true } : { available: false, reason: response.reason }
    } catch {
      return { available: false, reason: "broker-unavailable" }
    }
  }

  async open(session: ChildSession, serverUrl: URL): Promise<PresentationHandle> {
    const url = new URL(serverUrl.href)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("invalid server URL")
    }
    const client = this.#requireClient()
    const response = await this.#track(client.request({
      version: BROKER_PROTOCOL_VERSION,
      operation: "open",
      serverUrl: url.href,
      directory: session.directory,
      sessionID: session.id,
      splitDirection: this.#config.splitDirection,
      childBias: this.#config.childBias,
      focusPolicy: this.#config.focusPolicy,
    }))
    if (!response.ok || response.operation !== "open") throw new BrokerClientError("protocol-error")
    return { backend: "kitty", windowID: response.windowID, openedAt: this.#now() }
  }

  async exists(handle: PresentationHandle): Promise<boolean> {
    const response = await this.#track(this.#requireClient().request({
      version: BROKER_PROTOCOL_VERSION,
      operation: "exists",
      windowID: this.#windowID(handle),
    }))
    if (!response.ok || response.operation !== "exists") throw new BrokerClientError("protocol-error")
    return response.exists
  }

  async focus(handle: PresentationHandle): Promise<void> {
    await this.#track(this.#requireClient().request({
      version: BROKER_PROTOCOL_VERSION,
      operation: "focus",
      windowID: this.#windowID(handle),
    }))
  }

  async close(handle: PresentationHandle): Promise<void> {
    await this.#track(this.#requireClient().request({
      version: BROKER_PROTOCOL_VERSION,
      operation: "close",
      windowID: this.#windowID(handle),
    }))
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    this.#accepting = false
    this.#disposePromise = (async () => {
      await Promise.allSettled([...this.#inFlight])
      if (!this.#client) return
      await this.#client
        .request({ version: BROKER_PROTOCOL_VERSION, operation: "shutdown" })
        .then(() => undefined, () => undefined)
    })()
    return this.#disposePromise
  }

  #requireClient(): BrokerClient {
    if (!this.#accepting || !this.#client) throw new BrokerClientError("broker-unavailable")
    return this.#client
  }

  async #track<T>(operation: Promise<T>): Promise<T> {
    if (!this.#accepting) throw new BrokerClientError("broker-unavailable")
    const tracked = operation.then(
      (value) => value,
      (error: unknown) => {
        throw error
      },
    )
    this.#inFlight.add(tracked)
    try {
      return await tracked
    } finally {
      this.#inFlight.delete(tracked)
    }
  }

  #windowID(handle: PresentationHandle): number {
    if (handle.backend !== "kitty" || !Number.isSafeInteger(handle.windowID) || handle.windowID < 1) {
      throw new BrokerClientError("protocol-error")
    }
    return handle.windowID
  }
}
