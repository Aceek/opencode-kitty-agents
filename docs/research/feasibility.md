# V1 Feasibility Research

Date: 2026-07-24

## Verdict

The project is feasible and has a clean public-API implementation path. No
oh-my-openagent source needs to be copied.

The integration gate passed through the background capability broker accepted
in ADR 0004. The current OpenCode process has Kitty environment metadata but no
controlling `/dev/tty`, so direct terminal transport remains unavailable.

## Verified OpenCode Contract

Verified against locally installed OpenCode, SDK, and plugin version 1.18.4.

- A server plugin receives `client`, `directory`, `worktree`, and a live
  `serverUrl` getter through `PluginInput`.
- The `event` hook receives `session.created`, `session.deleted`, and
  `session.status` events.
- Child sessions are identified by `event.properties.info.parentID`.
- Creation and deletion carry the complete session under
  `event.properties.info`.
- Status carries `sessionID` and `idle`, `busy`, or `retry` state.
- `client.session.children({ path: { id } })` returns immediate children for a
  known parent.
- `client.session.list()` supports broad reconciliation by `parentID`.
- `client.session.status()` returns non-idle statuses keyed by session ID; a
  known existing child absent from that map is idle.
- `opencode attach <server-url> --dir <directory> --session <id>` opens a client
  attached to an existing session.
- `dispose` is awaited and is the cleanup boundary.

### Concurrency And Startup Caveats

- OpenCode invokes plugin event hooks without awaiting them. Event mutations
  must be serialized and errors must be contained by the plugin.
- The host installs the event listener after plugin initialization. A child can
  be created between an initial snapshot and listener installation.
- V1 must combine event handling with startup and periodic reconciliation.
- `ctx.serverUrl` can be a fallback URL when no network listener exists. Probe
  reachability immediately before launching an attached TUI.

## Verified Kitty Contract

Verified against Kitty 0.47.4 CLI help and upstream documentation.

- `kitten @ launch` can create a window in the originating tab and prints the
  new numeric Kitty window ID.
- `--match=window_id:<origin>` selects the tab containing the exact origin.
- `--source-window=id:<origin>` and `--next-to=id:<origin>` remove dependence on
  active-window state.
- `--location=vsplit` and `--location=hsplit` provide split placement when the
  tab uses Kitty's `splits` layout.
- `--bias` controls the new split proportion.
- `focus-window`, `close-window`, and `ls` operate on exact numeric IDs.
- `close-window --ignore-no-match` supports idempotent cleanup.
- A missing `ls --match=id:<child>` raises Kitty's no-match error rather than
  returning `[]`. Because a managed child can move tabs, manual-closure
  reconciliation uses a full non-mutating `ls` snapshot and retains only the
  minimal numeric IDs needed for membership.
- Process arguments, cwd, and environment can be supplied as distinct argv
  entries without a shell.
- A Kitty `launch --allow-remote-control` window receives a dedicated
  `KITTY_LISTEN_ON` socketpair/FD capability. This avoids a global listener and
  is the preferred V1 transport candidate.

## Runtime Probe

The current OpenCode plugin environment contains `KITTY_PID`,
`KITTY_WINDOW_ID`, and `KITTY_PUBLIC_KEY`, but not a usable controlling TTY.

The non-mutating command below failed before reaching Kitty:

```text
kitten @ --use-password=never ls --self
Error: open /dev/tty: no such device or address
```

This disproves direct controlling-terminal transport for the current launch
path. It does not disprove Kitty remote control through an inherited
`KITTY_LISTEN_ON` descriptor.

## Security Requirements

- Keep global `allow_remote_control` disabled.
- Use an ephemeral inherited capability rather than a filesystem or TCP socket.
- Restrict allowed Kitty commands to the final minimum set.
- Do not grant child agent windows remote-control capability.
- Do not use `--copy-env`.
- Pass only required environment variables.
- Never write control descriptors, public keys, passwords, or server
  credentials to state files or logs.
- Never invoke commands through a shell.

## Capability Gate Result

The background broker integration probe launched OpenCode from a Kitty mapping
configured with window-local remote control and confirmed from the server
plugin runtime that it could:

1. query the exact origin window;
2. launch a harmless short-lived split next to it;
3. receive the numeric child window ID;
4. query that ID;
5. close it idempotently;
6. leave all unrelated Kitty windows unchanged.

Kitty preserved the descriptor into the background broker, Bun preserved it for
`kitten` subprocesses through explicit same-number FD mapping, and the plugin
reached the broker through a private runtime socket. Both test-created windows
closed automatically, and unrelated windows remained unchanged.

## Feasibility Risks

| Risk | V1 mitigation |
| --- | --- |
| Event loss during plugin initialization | Snapshot plus periodic reconciliation |
| Concurrent event callbacks | Serialized non-throwing queue |
| Unreachable OpenCode server URL | Health probe and explicit unavailable state |
| Manual child-window closure | Exact-ID polling and idempotent map cleanup |
| Kitty restart | Treat all stored IDs as invalid and reconcile |
| Non-splits Kitty layout | Detect and report; do not rearrange automatically |
| Attached TUI exits immediately | Verify returned ID, then reconcile existence |
| Plugin disposal races with events | Disposed flag, queue drain, bounded cleanup |
| Future terminal backends | Stable adapter boundary, no speculative code |
