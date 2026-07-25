import { closeSync, openSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { inheritedFDStdio, ProcessExecutionError, runBoundedProcess } from "../src/broker/runner"

describe("bounded subprocess runner", () => {
  test("constructs an explicit same-number inherited descriptor mapping", () => {
    expect(inheritedFDStdio(3)).toEqual(["ignore", "pipe", "pipe", 3])
    expect(inheritedFDStdio(6)).toEqual(["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", 6])
    expect(() => inheritedFDStdio(2)).toThrow(ProcessExecutionError)
  })

  test("bounds subprocess duration and returns a sanitized timeout", async () => {
    const fd = openSync("/dev/null", "r")
    try {
      const result = runBoundedProcess({
        argv: ["/usr/bin/sleep", "2"],
        env: {},
        inheritedFD: fd,
        timeoutMs: 20,
      })
      await expect(result).rejects.toMatchObject({ code: "timeout", message: "subprocess timed out" })
    } finally {
      closeSync(fd)
    }
  })

  test("does not include stderr, argv, environment, or descriptor in failures", async () => {
    const fd = openSync("/dev/null", "r")
    const secret = "do-not-report-this"
    try {
      const result = runBoundedProcess({
        argv: [process.execPath, "-e", `process.stderr.write('${secret}'); process.exit(7)`],
        env: { SECRET_VALUE: secret },
        inheritedFD: fd,
      })
      await expect(result).rejects.toEqual(new ProcessExecutionError("failed"))
      await result.catch((error) => {
        const text = String(error)
        expect(text).not.toContain(secret)
        expect(text).not.toContain(String(fd))
      })
    } finally {
      closeSync(fd)
    }
  })
})
