export const DEFAULT_PROCESS_TIMEOUT_MS = 10_000
export const DEFAULT_PROCESS_MAX_BUFFER = 1_048_576

export class ProcessExecutionError extends Error {
  readonly code: "failed" | "timeout"

  constructor(code: "failed" | "timeout") {
    super(code === "timeout" ? "subprocess timed out" : "subprocess failed")
    this.name = "ProcessExecutionError"
    this.code = code
  }
}

export type ProcessResult = Readonly<{ stdout: string }>

export function inheritedFDStdio(fd: number): ["ignore", "pipe", "pipe", ...Array<"ignore" | number>] {
  if (!Number.isSafeInteger(fd) || fd < 3) throw new ProcessExecutionError("failed")
  return ["ignore", "pipe", "pipe", ...Array.from({ length: fd - 3 }, () => "ignore" as const), fd]
}

export async function runBoundedProcess(input: {
  argv: readonly string[]
  env: Readonly<Record<string, string>>
  inheritedFD: number
  timeoutMs?: number
  maxBuffer?: number
}): Promise<ProcessResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS
  const maxBuffer = input.maxBuffer ?? DEFAULT_PROCESS_MAX_BUFFER
  if (
    input.argv.length === 0 ||
    input.argv.some((argument) => argument.includes("\0")) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxBuffer) ||
    maxBuffer < 1
  ) {
    throw new ProcessExecutionError("failed")
  }

  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn([...input.argv], {
      env: { ...input.env },
      stdio: inheritedFDStdio(input.inheritedFD),
      timeout: timeoutMs,
      maxBuffer,
    })
  } catch {
    throw new ProcessExecutionError("failed")
  }

  try {
    const stdoutStream = child.stdout
    if (!(stdoutStream instanceof ReadableStream)) throw new ProcessExecutionError("failed")
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(stdoutStream).text()])
    if (exitCode !== 0) throw new ProcessExecutionError(child.signalCode === "SIGTERM" ? "timeout" : "failed")
    return { stdout }
  } catch (error) {
    if (error instanceof ProcessExecutionError) throw error
    throw new ProcessExecutionError("failed")
  }
}
