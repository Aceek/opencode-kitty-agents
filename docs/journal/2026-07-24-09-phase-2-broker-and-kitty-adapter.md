# 2026-07-24 - Phase 2 Broker And Kitty Adapter

## Completed

- Implemented the version 1 owner-private Unix broker protocol for only
  availability, open, exists, focus, close, and shutdown operations, with exact
  message keys, bounded sizes, bounded error codes, and one request per
  connection.
- Implemented a production background broker executable that owns Kitty's
  inherited FD capability, creates an owner-only random runtime endpoint,
  launches the OpenCode orchestrator without forwarding Kitty capability
  variables, and fixes the OpenCode executable at broker construction time.
- Implemented bounded argv-array Kitty subprocess execution with explicit
  same-number FD preservation and the command allowlist `ls`, `launch`,
  `focus-window`, and `close-window`, always using `--use-password=never`.
- Implemented minimum Kitty state parsing, exact numeric origin/child targeting,
  `splits` layout enforcement, deterministic attach launch argv, returned-ID and
  same-tab validation, explicit origin focus restoration, exact-ID existence and
  focus, and idempotent close/manual-closure behavior.
- Implemented the strict plugin-side broker client and Kitty
  `PresentationAdapter`, including private endpoint validation and sanitized
  unavailable/error behavior.
- Added focused tests for argv, attach ordering, parser failures, missing
  capability and endpoint metadata, private endpoint modes, protocol strictness,
  arbitrary-field rejection, subprocess timeout/FD mapping, manual closure,
  sanitization, serialized broker mutations, and adapter behavior through a
  fake transport.

## Decisions

- The trusted broker construction fixes one OpenCode executable, defaulting to
  `/usr/bin/opencode`; an optional `--opencode-executable=...` startup argument
  changes it for both orchestrator and attach launches. No executable selector,
  environment map, Kitty command, match expression, or argv is accepted over
  IPC.
- Child launch is exactly `opencode attach <url> --dir <directory> --session
  <id>` after deterministic Kitty launch options. Server URLs containing user
  info are rejected.
- Broker requests are serialized even though local session events and clients
  can be concurrent. Created IDs remain broker-known after closure so repeated
  cleanup is safe, while unrelated numeric IDs are rejected.
- Phase 2 exports the implemented broker client and Kitty adapter, but does not
  connect them to the default plugin. Session tracking and controller policy
  remain reserved for Phases 3-4, and final Kitty setup remains undocumented.

## Verification

- Rechecked installed Kitty 0.47.4 help and upstream implementations for
  `--use-password`, `ls`, launch returned IDs and placement, focus-window,
  close-window `--ignore-no-match`, and background FD capability behavior.
- Rechecked installed OpenCode plugin 1.18.4 input/hooks and the upstream attach
  CLI ordering and options before implementing attach argv.
- `bun run check` passed after implementation: all source, test, and Gate 0
  TypeScript configurations; 80 tests with 194 assertions; and the production
  declaration/JavaScript build.

## Risks Or Blockers

- The production Phase 2 broker boundary has unit coverage but has not yet been
  exercised through final session/controller integration; that belongs to
  Phases 3-5.
- The public `opencodeExecutable` plugin option is validation-only until later
  startup/controller wiring. The secure runtime authority is the broker's
  construction-time executable, never a per-request value.
- Final user mapping syntax, credential reachability, and multi-child placement
  remain outside Phase 2 and are not public setup guarantees.

## Files

- `package.json`
- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-09-phase-2-broker-and-kitty-adapter.md`
- `src/index.ts`
- `src/broker/core.ts`
- `src/broker/endpoint.ts`
- `src/broker/kitty.ts`
- `src/broker/main.ts`
- `src/broker/protocol.ts`
- `src/broker/runner.ts`
- `src/broker/server.ts`
- `src/presentation/kitty/adapter.ts`
- `src/presentation/kitty/client.ts`
- `test/broker-core.test.ts`
- `test/broker-endpoint.test.ts`
- `test/broker-protocol.test.ts`
- `test/broker-runner.test.ts`
- `test/kitty-adapter.test.ts`
- `test/kitty-client.test.ts`

## Next Step

Begin V1 Phase 3 by implementing only the OpenCode child-session tracker,
serialized event mutation queue, SDK snapshot reconciliation, periodic startup
gap recovery, disposal races, and focused fake-SDK tests; do not connect the
tracker to Kitty until Phase 4.
