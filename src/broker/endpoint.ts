import { lstatSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { BROKER_ENDPOINT_ENV } from "./protocol"

export class BrokerEndpointError extends Error {
  constructor() {
    super("broker endpoint unavailable")
    this.name = "BrokerEndpointError"
  }
}

function currentUID(): number {
  const uid = process.getuid?.()
  if (uid === undefined) throw new BrokerEndpointError()
  return uid
}

export function validateRuntimeDirectory(runtimeDirectory: string | undefined): string {
  if (!runtimeDirectory || !isAbsolute(runtimeDirectory)) throw new BrokerEndpointError()
  const normalized = resolve(runtimeDirectory)
  try {
    const info = statSync(normalized)
    if (!info.isDirectory() || info.uid !== currentUID() || (info.mode & 0o022) !== 0) throw new BrokerEndpointError()
  } catch {
    throw new BrokerEndpointError()
  }
  return normalized
}

export function validateBrokerEndpoint(endpoint: string | undefined, runtimeDirectory: string): string {
  if (!endpoint || !isAbsolute(endpoint)) throw new BrokerEndpointError()
  const runtime = resolve(runtimeDirectory)
  const normalized = resolve(endpoint)
  const child = relative(runtime, normalized)
  if (child.startsWith("..") || isAbsolute(child) || !/^opencode-kitty-agents-[A-Za-z0-9_-]+\/broker\.sock$/.test(child)) {
    throw new BrokerEndpointError()
  }
  try {
    const parent = statSync(resolve(normalized, ".."))
    const socket = lstatSync(normalized)
    if (
      !parent.isDirectory() ||
      parent.uid !== currentUID() ||
      (parent.mode & 0o077) !== 0 ||
      !socket.isSocket() ||
      socket.uid !== currentUID() ||
      (socket.mode & 0o077) !== 0
    ) {
      throw new BrokerEndpointError()
    }
  } catch {
    throw new BrokerEndpointError()
  }
  return normalized
}

export function endpointFromEnvironment(env: Record<string, string | undefined> = process.env): string {
  const runtime = validateRuntimeDirectory(env.XDG_RUNTIME_DIR)
  return validateBrokerEndpoint(env[BROKER_ENDPOINT_ENV], runtime)
}
