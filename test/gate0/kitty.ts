import { parseNumericID } from "./contracts"

export const KITTEN = "/usr/bin/kitten"
export const OPENCODE = "/usr/bin/opencode"
export const SLEEP = "/usr/bin/sleep"

export function kittyStdio(inheritedFD: number): ["ignore", "pipe", "pipe", ...Array<"ignore" | number>] {
  if (!Number.isSafeInteger(inheritedFD) || inheritedFD < 3) throw new Error("invalid inherited descriptor")
  const extra: Array<"ignore" | number> = Array.from({ length: inheritedFD - 3 }, () => "ignore")
  extra.push(inheritedFD)
  return ["ignore", "pipe", "pipe", ...extra]
}

function base(command: "ls" | "launch" | "close-window"): string[] {
  return [KITTEN, "@", "--use-password=never", command]
}

export function originQueryArgv(windowID: number): string[] {
  return [...base("ls"), `--match=id:${windowID}`]
}

export function tabQueryArgv(originWindowID: number): string[] {
  return [...base("ls"), `--match-tab=window_id:${originWindowID}`]
}

export function sleepLaunchArgv(originWindowID: number): string[] {
  return [
    ...base("launch"),
    `--match=window_id:${originWindowID}`,
    `--source-window=id:${originWindowID}`,
    `--next-to=id:${originWindowID}`,
    "--location=vsplit",
    "--keep-focus",
    SLEEP,
    "30",
  ]
}

export function closeWindowArgv(windowID: number): string[] {
  return [...base("close-window"), `--match=id:${windowID}`, "--ignore-no-match"]
}

export function opencodeLaunchArgv(input: {
  mappingOriginID: number
  repositoryRoot: string
  endpoint: string
  pluginURL: string
}): string[] {
  const config = JSON.stringify({ plugin: [input.pluginURL] })
  return [
    ...base("launch"),
    `--match=window_id:${input.mappingOriginID}`,
    `--source-window=id:${input.mappingOriginID}`,
    `--next-to=id:${input.mappingOriginID}`,
    "--location=vsplit",
    `--cwd=${input.repositoryRoot}`,
    "--env=KITTY_LISTEN_ON",
    "--env=KITTY_RC_PASSWORD",
    `--env=OPENCODE_KITTY_GATE0_ENDPOINT=${input.endpoint}`,
    `--env=OPENCODE_CONFIG_CONTENT=${config}`,
    OPENCODE,
    input.repositoryRoot,
  ]
}

export async function runKitten(
  argv: string[],
  inheritedFD: number,
  env: Record<string, string>,
): Promise<string> {
  const process = Bun.spawn(argv, {
    env,
    stdio: kittyStdio(inheritedFD),
    timeout: 15_000,
    maxBuffer: 1_048_576,
  })
  const [exitCode, stdout] = await Promise.all([process.exited, new Response(process.stdout).text()])
  if (exitCode !== 0) throw new Error("kitty command failed")
  return stdout
}

export function parseLaunchID(stdout: string): number {
  return parseNumericID(stdout)
}
