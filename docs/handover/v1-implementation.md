# V1 Implementation Handover

Date: 2026-07-24

## Mission

Implement the first production-quality version of `opencode-kitty-agents`.
The plugin must observe existing OpenCode child sessions and present them in
managed Kitty splits by running `opencode attach`. It must not create agents,
inject agent instructions, or depend on `opencode-harness-panel`.

## Current State

- Repository architecture and scope are documented.
- The package exports a no-op OpenCode plugin and has one contract test.
- No Kitty commands or session lifecycle behavior are implemented.
- OpenCode public hooks and Kitty CLI capabilities were researched.
- The project targets the locally verified OpenCode/plugin version 1.18.4 and
  Kitty 0.47.4.
- The current OpenCode process lacks `/dev/tty`; direct Kitty terminal control
  is therefore not viable from this plugin launch path.
- An inherited Kitty socketpair/FD capability is the accepted V1 direction but
  still requires an end-to-end probe.

## Mandatory Reading Order

1. `AGENTS.md`
2. `docs/journal/README.md`
3. Every dated file in `docs/journal/`
4. `docs/research/feasibility.md`
5. `docs/decisions/0001-separate-from-harness-panel.md`
6. `docs/decisions/0002-kitty-v1-adapter-boundary.md`
7. `docs/decisions/0003-ephemeral-kitty-capability.md`
8. `docs/architecture/v1.md`
9. `docs/plans/v1-implementation.md`

## First Action

Execute Gate 0 from the implementation plan. Do not start the session tracker
or adapter implementation until the capability path is proven from the actual
OpenCode server-plugin runtime.

The expected setup uses a trusted Kitty mapping or wrapper based on:

```text
launch --allow-remote-control --remote-control-password <restricted-policy> opencode
```

Do not paste an unverified production configuration into the README. Derive and
test the exact Kitty syntax first, then document it.

## Non-Negotiable Constraints

- Keep this repository independent from `opencode-harness-panel`.
- Keep global Kitty remote control disabled.
- Do not use a TCP listener or unconditional global Unix socket.
- Do not copy oh-my-openagent's internal tmux code; it is unnecessary and has a
  restrictive SUL-1.0 license.
- Use only public OpenCode plugin/SDK contracts.
- Use argv arrays, never shell command strings.
- Use numeric Kitty IDs, never active-window or title matching.
- Serialize event mutations because OpenCode does not await event hooks.
- Reconcile against SDK snapshots because startup events can be missed.
- Never persist or log Kitty capabilities or OpenCode credentials.
- Never delete OpenCode sessions as part of presentation cleanup.

## Important OpenCode Findings

- Child creation: `session.created` with
  `event.properties.info.parentID` and `info.id`.
- Child deletion: `session.deleted` with the complete session in `info`.
- Status: `session.status` with `sessionID` and status union.
- Snapshot: `client.session.list()` filtered by `parentID`.
- Status snapshot: `client.session.status()`; missing means idle only for a
  known existing child.
- Attachment command:
  `opencode attach <url> --dir <directory> --session <id>`.
- `ctx.serverUrl` must be read and probed at launch time.
- `dispose` is the awaited cleanup boundary.

## Important Kitty Findings

- `kitten @ launch` returns the numeric child window ID.
- Target the origin tab with `window_id:<origin-id>`.
- Anchor source and placement with the exact origin ID.
- Use `ls`, `focus-window`, and `close-window` with exact child IDs.
- Use `close-window --ignore-no-match` for idempotent cleanup.
- Split placement requires the Kitty `splits` layout.
- The accepted transport candidate is the inherited `KITTY_LISTEN_ON`
  socketpair/FD created for an authorized Kitty-launched window.

## Verification Expectations

- Unit tests use fake SDK and Kitty runners; they must not require a live
  desktop.
- Live tests must target only IDs created by the test.
- Every live test must have best-effort cleanup in a `finally` path.
- `bun run check` must pass before each completed phase is journaled.
- Record exact non-sensitive failures and decisions in a new journal file.

## Stop Conditions

Stop and request a design decision if:

- Kitty does not preserve the capability descriptor into the plugin runtime;
- satisfying the design appears to require global remote control;
- OpenCode cannot expose a reachable attach server in the intended launch mode;
- a public API cannot support a required lifecycle operation;
- implementation would require coupling to the harness panel;
- unrelated concurrent changes conflict with this repository.

If Gate 0 fails, document the evidence and propose a minimal helper design in a
new ADR. Do not silently weaken the security model.
