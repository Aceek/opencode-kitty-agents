# V1 Implementation Plan

Status: Ready after Gate 0

Owner: Future implementation orchestrator

## Definition Of Done

- OpenCode child sessions are detected and reconciled reliably.
- Each eligible child can be presented in a managed Kitty split attached to the
  same OpenCode session.
- Focus remains on the orchestrator by default.
- Manual closure, session deletion, Kitty restart, and plugin disposal are safe.
- Global Kitty remote control remains disabled.
- Unit tests and focused Kitty/OpenCode integration tests pass.
- User setup, limitations, and rollback are documented.
- Every major completed phase has a journal entry.

## Gate 0: Prove The Kitty Capability Path

1. Add a temporary or test-only plugin probe.
2. Add a Kitty launch mapping that grants window-local remote control through
   `launch --allow-remote-control` with a minimal command allowlist.
3. Start OpenCode through that mapping.
4. Confirm `KITTY_LISTEN_ON`, `KITTY_WINDOW_ID`, and `KITTY_PID` are visible in
   the server plugin without logging their values.
5. Query only the exact origin window.
6. Launch a harmless short-lived split, capture its numeric ID, query it, and
   close it with `--ignore-no-match`.
7. Confirm no unrelated Kitty window changed.
8. Journal exact results and remove temporary behavior.

Stop if this gate fails. Investigate descriptor inheritance and write an ADR
before introducing a helper or alternate transport.

## Phase 1: Configuration And Pure Types

1. Define a minimal validated configuration:
   - enabled flag;
   - split direction;
   - child bias;
   - reconciliation interval;
   - focus policy;
   - optional OpenCode executable override.
2. Define normalized child-session and presentation state.
3. Define the minimal `PresentationAdapter` interface demanded by V1.
4. Add validation and default tests.
5. Document public configuration and defaults.
6. Journal the phase.

## Phase 2: Kitty Client And Adapter

1. Implement a subprocess runner using argv arrays and bounded timeouts.
2. Implement capability availability checks without exposing capability values.
3. Parse `kitten @ ls` output into the minimum required state.
4. Build deterministic launch argv using exact origin IDs.
5. Capture and validate the returned child window ID.
6. Implement exact-ID `exists`, `focus`, and idempotent `close`.
7. Detect unsupported layouts without changing them.
8. Add unit tests for argv construction, parser errors, missing capability,
   timeouts, no-match behavior, and sanitization.
9. Journal the phase.

## Phase 3: OpenCode Session Tracker

1. Normalize `session.created`, `session.deleted`, and `session.status`.
2. Serialize state transitions through one queue.
3. Reconcile child membership through `session.list()` filtered by `parentID`.
4. Reconcile status through `session.status()`.
5. Infer idle only for known existing children absent from the status map.
6. Trigger reconciliation for unknown or out-of-order status events.
7. Add periodic reconciliation to close the plugin initialization gap.
8. Add tests for concurrent callbacks, duplicate events, deletion-before-open,
   missed startup events, and disposal races.
9. Journal the phase.

## Phase 4: Controller Integration

1. Connect tracker desired state to the adapter.
2. Probe `ctx.serverUrl` immediately before attachment.
3. Launch `opencode attach` with explicit URL, directory, and session ID.
4. Preserve focus by default.
5. Bound retries and avoid tight loops on unavailable server or Kitty.
6. Poll managed window existence at a modest interval.
7. Handle a child window that exits immediately or is closed manually.
8. Implement idempotent `dispose` with bounded cleanup.
9. Add controller tests with fake SDK and adapter implementations.
10. Journal the phase.

## Phase 5: End-To-End Verification

1. Start OpenCode through the trusted Kitty launch path.
2. Create one synchronous child session and one background child session.
3. Verify each split attaches to the correct child session.
4. Verify multiple children use deterministic placement.
5. Verify focus behavior.
6. Manually close one split and verify state reconciliation.
7. Delete or complete a child and verify cleanup.
8. Restart or close Kitty and verify graceful degradation.
9. Stop OpenCode and verify all managed windows close without touching unrelated
   windows.
10. Record exact commands and outcomes without credentials.
11. Journal the phase.

## Phase 6: Documentation And Release Readiness

1. Replace the README status with implemented behavior.
2. Document the Kitty launch mapping and its security implications.
3. Document configuration, troubleshooting, rollback, and limitations.
4. Verify the public package contents.
5. Run `bun run check` from a clean install.
6. Do not publish or tag a release without explicit approval.
7. Write the final implementation journal entry and a new handover if work
   remains.

## Explicitly Deferred

- Harness panel integration.
- Hyprland OS-window backend.
- tmux or WezTerm backend.
- Dynamic backend discovery.
- Automatic Kitty layout switching.
- Persisted cross-restart window recovery.
- Destructive session controls.
