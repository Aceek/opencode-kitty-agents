import type { BrokerErrorCode, BrokerRequest, BrokerResponse } from "./protocol"
import { BROKER_PROTOCOL_VERSION } from "./protocol"
import {
  allStateArgv,
  attachLaunchArgv,
  closeWindowArgv,
  focusWindowArgv,
  kittyFailureCode,
  originStateArgv,
  launchWithRecovery,
  requireOriginTab,
  validateLaunchedWindow,
  windowExists,
  type OpenCodeEnvironment,
  type KittyRunner,
} from "./kitty"

export type KittyBrokerOptions = Readonly<{
  originWindowID: number
  opencodeExecutable: string
  openCodeEnvironment: OpenCodeEnvironment
  recoveryToken?: () => string
  shutdownTimeoutMs?: number
  kittenExecutable?: string
}>

export class KittyBroker {
  readonly #originWindowID: number
  readonly #opencodeExecutable: string
  readonly #openCodeEnvironment: OpenCodeEnvironment
  readonly #kittenExecutable?: string
  readonly #runner: KittyRunner
  readonly #recoveryToken: () => string
  readonly #shutdownTimeoutMs: number
  readonly #knownWindowIDs = new Set<number>()
  readonly #openWindowIDs = new Set<number>()
  #disposed = false
  #tail: Promise<void> = Promise.resolve()

  constructor(options: KittyBrokerOptions, runner: KittyRunner) {
    if (!Number.isSafeInteger(options.originWindowID) || options.originWindowID < 1) throw new Error("invalid origin")
    if (!options.opencodeExecutable || options.opencodeExecutable.includes("\0")) throw new Error("invalid executable")
    this.#originWindowID = options.originWindowID
    this.#opencodeExecutable = options.opencodeExecutable
    this.#openCodeEnvironment = [...options.openCodeEnvironment]
    this.#kittenExecutable = options.kittenExecutable
    this.#runner = runner
    this.#recoveryToken = options.recoveryToken ?? randomUUID
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000
    if (!Number.isSafeInteger(this.#shutdownTimeoutMs) || this.#shutdownTimeoutMs < 1) {
      throw new Error("invalid shutdown timeout")
    }
  }

  request(request: BrokerRequest): Promise<BrokerResponse> {
    const operation = async (): Promise<BrokerResponse> => this.#handle(request)
    const result = this.#tail.then(operation, operation)
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #handle(request: BrokerRequest): Promise<BrokerResponse> {
    if (this.#disposed && request.operation !== "shutdown") return this.#failure(request.operation, "shutting-down")
    try {
      switch (request.operation) {
        case "availability": {
          const tab = requireOriginTab(
            (await this.#runner(originStateArgv(this.#originWindowID, this.#kittenExecutable))).stdout,
            this.#originWindowID,
          )
          return tab.layout === "splits"
            ? { version: BROKER_PROTOCOL_VERSION, operation: "availability", ok: true, available: true }
            : {
                version: BROKER_PROTOCOL_VERSION,
                operation: "availability",
                ok: true,
                available: false,
                reason: "unsupported-layout",
              }
        }
        case "open": {
          const tab = requireOriginTab(
            (await this.#runner(originStateArgv(this.#originWindowID, this.#kittenExecutable))).stdout,
            this.#originWindowID,
          )
          if (tab.layout !== "splits") return this.#failure("open", "unsupported-layout")
          let windowID: number | undefined
          const recoveryToken = this.#recoveryToken()
          try {
            const launchArgv = attachLaunchArgv({
              originWindowID: this.#originWindowID,
              opencodeExecutable: this.#opencodeExecutable,
              serverUrl: request.serverUrl,
              directory: request.directory,
              sessionID: request.sessionID,
              splitDirection: request.splitDirection,
              childBias: request.childBias,
              focusPolicy: request.focusPolicy,
              environment: this.#openCodeEnvironment,
              recoveryToken,
              ...(this.#kittenExecutable === undefined ? {} : { kittenExecutable: this.#kittenExecutable }),
            })
            windowID = await launchWithRecovery({
              runner: this.#runner,
              launchArgv,
              before: tab,
              originWindowID: this.#originWindowID,
              recoveryToken,
              ...(this.#kittenExecutable === undefined ? {} : { kittenExecutable: this.#kittenExecutable }),
            })
            validateLaunchedWindow(
              (await this.#runner(originStateArgv(this.#originWindowID, this.#kittenExecutable))).stdout,
              this.#originWindowID,
              windowID,
            )
            if (request.focusPolicy === "preserve") {
              await this.#runner(focusWindowArgv(this.#originWindowID, this.#kittenExecutable))
            }
          } catch (error) {
            if (windowID !== undefined) {
              await this.#runner(closeWindowArgv(windowID, this.#kittenExecutable)).catch(() => undefined)
            }
            throw error
          }
          this.#knownWindowIDs.add(windowID)
          this.#openWindowIDs.add(windowID)
          return { version: BROKER_PROTOCOL_VERSION, operation: "open", ok: true, windowID }
        }
        case "exists": {
          if (!this.#knownWindowIDs.has(request.windowID)) return this.#failure("exists", "unknown-window")
          const exists = windowExists(
            (await this.#runner(allStateArgv(this.#kittenExecutable))).stdout,
            request.windowID,
          )
          if (!exists) this.#openWindowIDs.delete(request.windowID)
          return { version: BROKER_PROTOCOL_VERSION, operation: "exists", ok: true, exists }
        }
        case "focus":
          if (!this.#knownWindowIDs.has(request.windowID)) return this.#failure("focus", "unknown-window")
          await this.#runner(focusWindowArgv(request.windowID, this.#kittenExecutable))
          return { version: BROKER_PROTOCOL_VERSION, operation: "focus", ok: true }
        case "close":
          if (!this.#knownWindowIDs.has(request.windowID)) return this.#failure("close", "unknown-window")
          await this.#runner(closeWindowArgv(request.windowID, this.#kittenExecutable))
          this.#openWindowIDs.delete(request.windowID)
          return { version: BROKER_PROTOCOL_VERSION, operation: "close", ok: true }
        case "shutdown":
          if (!this.#disposed) {
            this.#disposed = true
            await this.#closeManagedWindowsBounded([...this.#openWindowIDs])
            this.#openWindowIDs.clear()
          }
          return { version: BROKER_PROTOCOL_VERSION, operation: "shutdown", ok: true }
      }
    } catch (error) {
      const code = request.operation === "availability" ? "broker-unavailable" : kittyFailureCode(error)
      return this.#failure(request.operation, code)
    }
  }

  #failure(operation: BrokerRequest["operation"], error: BrokerErrorCode): BrokerResponse {
    return { version: BROKER_PROTOCOL_VERSION, operation, ok: false, error }
  }

  async #closeManagedWindowsBounded(ids: readonly number[]): Promise<void> {
    let expired = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (async () => {
      for (const id of ids) {
        if (expired) break
        await this.#runner(closeWindowArgv(id, this.#kittenExecutable)).catch(() => undefined)
      }
    })()
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        expired = true
        resolve()
      }, this.#shutdownTimeoutMs)
    })
    try {
      await Promise.race([cleanup, timeout])
    } finally {
      if (timer) clearTimeout(timer)
      void cleanup.catch(() => undefined)
    }
  }
}
import { randomUUID } from "node:crypto"
