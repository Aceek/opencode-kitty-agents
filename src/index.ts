import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { parseConfig, type PluginConfig } from "./config"
import {
  PresentationController,
  type ControllerFetch,
  type ControllerTracker,
} from "./controller"
import type { PresentationAdapter } from "./presentation/adapter"
import { KittyPresentationAdapter } from "./presentation/kitty/adapter"
import { SessionTracker, type SessionTrackerOptions } from "./session/tracker"

type PluginTracker = ControllerTracker & Readonly<{
  handleEvent(event: unknown): Promise<boolean>
  dispose(): Promise<void>
}>

export type PluginDependencies = Readonly<{
  createTracker?: (options: SessionTrackerOptions) => PluginTracker
  createAdapter?: (config: PluginConfig) => PresentationAdapter
  fetch?: ControllerFetch
}>

const SESSION_EVENT_TYPES = new Set(["session.created", "session.deleted", "session.status"])

function isSessionEvent(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof event.type === "string" &&
    SESSION_EVENT_TYPES.has(event.type)
  )
}

export function createPlugin(dependencies: PluginDependencies = {}): Plugin {
  return async (_input, options) => {
    const config = parseConfig(options)
    if (!config.enabled) return {}

    const tracker = (dependencies.createTracker ?? ((trackerOptions) => new SessionTracker(trackerOptions)))({
      client: {
        list: ({ signal }) => _input.client.session.list({ signal }),
        status: ({ signal }) => _input.client.session.status({ signal }),
      },
      reconciliationIntervalMs: config.reconciliationIntervalMs,
    })
    const adapter = (dependencies.createAdapter ?? ((adapterConfig) => new KittyPresentationAdapter({
      config: adapterConfig,
    })))(config)
    const controller = new PresentationController({
      tracker,
      adapter,
      getServerUrl: () => _input.serverUrl,
      reconciliationIntervalMs: config.reconciliationIntervalMs,
      fetch: dependencies.fetch,
    })
    return {
      event: async ({ event }) => {
        // Filter synchronously before the tracker can allocate serialized queue
        // work. OpenCode does not await this hook, so accepted work remains
        // rejection-contained and is not awaited here.
        if (!isSessionEvent(event)) return
        void tracker.handleEvent(event).catch(() => undefined)
      },
      dispose: async () => {
        await controller.dispose()
        await tracker.dispose()
      },
    }
  }
}

const plugin = createPlugin()
const pluginModule = {
  id: "opencode-kitty-agents",
  server: plugin,
} satisfies PluginModule

export default pluginModule

export {
  ConfigurationError,
  DEFAULT_CONFIG,
  parseConfig,
  type FocusPolicy,
  type PluginConfig,
  type SplitDirection,
} from "./config"
export type { PresentationAdapter } from "./presentation/adapter"
export { KittyPresentationAdapter, type KittyPresentationAdapterOptions } from "./presentation/kitty/adapter"
export {
  BrokerClient,
  BrokerClientError,
  createUnixBrokerTransport,
  type BrokerTransport,
} from "./presentation/kitty/client"
export type {
  PresentationAvailability,
  PresentationDesiredState,
  PresentationHandle,
  PresentationPhase,
  PresentationState,
} from "./presentation/types"
export type { ChildSession, ChildSessionStatus } from "./session/types"
export {
  PresentationController,
  type ControllerChildState,
  type ControllerFetch,
  type ControllerOptions,
  type ControllerScheduler,
  type ControllerTracker,
} from "./controller"
export {
  SessionTracker,
  type SessionTrackerClient,
  type SessionTrackerListener,
  type SessionTrackerOptions,
  type SessionTrackerRequestOptions,
  type SessionTrackerScheduler,
  type SessionTrackerSnapshot,
} from "./session/tracker"
