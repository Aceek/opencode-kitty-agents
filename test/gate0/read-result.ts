import { readFileSync } from "node:fs"
import { parseGateResult, resultPath } from "./contracts"

const runtimeDirectory = process.env.XDG_RUNTIME_DIR
if (!runtimeDirectory) throw new Error("XDG_RUNTIME_DIR is unavailable")

const raw = readFileSync(resultPath(runtimeDirectory), "utf8")
const result = parseGateResult(raw)

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
