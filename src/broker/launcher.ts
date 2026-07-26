import { closeWindowArgv, type KittyRunner } from "./kitty"

/** Close the disposable mapping source without invalidating a ready broker. */
export async function closeLauncherWindow(runner: KittyRunner, windowID: number): Promise<void> {
  await runner(closeWindowArgv(windowID)).catch(() => undefined)
}
