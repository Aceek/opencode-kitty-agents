export class StartupAbortedError extends Error {
  constructor() {
    super("broker startup aborted")
    this.name = "StartupAbortedError"
  }
}

/** Retains a shutdown request even when no startup resource exists to close yet. */
export class ShutdownLatch {
  #requested = false

  request(closeCurrentResource?: () => void): void {
    this.#requested = true
    closeCurrentResource?.()
  }

  throwIfRequested(): void {
    if (this.#requested) throw new StartupAbortedError()
  }

  get requested(): boolean {
    return this.#requested
  }
}
