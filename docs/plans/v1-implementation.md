# V1 Implementation Plan

Status: Gate 0 and Phases 1-4 complete; Phase 5 active-root scope validated,
multi-child placement follow-up required

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

Completed 2026-07-24 through the background capability broker accepted in ADR
0004. The sanitized live result confirmed all required operations and cleanup.

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
    - focus policy.
2. Define normalized child-session and presentation state.
3. Define the minimal `PresentationAdapter` interface demanded by V1.
4. Add validation and default tests.
5. Document public configuration and defaults.
6. Journal the phase.

## Phase 2: Kitty Client And Adapter

Completed 2026-07-24 through the strict ADR 0004 broker boundary. The broker
fixes the OpenCode executable at trusted construction time and never accepts an
executable, environment, Kitty command, or match expression over IPC.
Review corrections use full minimal-ID snapshots for missing-window detection
and exact origin-tab snapshots for launch recovery, run OpenCode through a construction-time
`/usr/bin/env -i` allowlist, retain startup shutdown signals, use source cwd for
the orchestrator, and perform sequential bounded cleanup.
The final Phase 2 review uses full minimal-ID snapshots for moved-window
existence, runs marked recovery after runner rejection/timeout as well as bad
stdout, contains disconnected socket responses, and applies one global cleanup
deadline without increasing active close concurrency.
The IPC timeout review derives a shared 60-second client/server default from the
five-command bounded Kitty operation budget and rejects overlapping requests so
queue wait cannot outlive the valid operation's transport.
The disposal review drains already-started adapter requests before sending its
single shutdown request, while rejecting any new work once disposal begins.

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

Completed 2026-07-24. The default plugin installs a backend-neutral tracker with
serialized event handling, authoritative SDK membership/status reconciliation,
startup and periodic gap recovery, immutable snapshot subscriptions, contained
failures, and bounded idempotent disposal. It does not construct or call a
`PresentationAdapter`. Review corrections coalesce all reconciliation requests,
bound and abort each SDK call through the verified top-level `{ signal }`
option, prevent disposal-time late commits, and contain asynchronous subscriber
rejections without blocking tracker mutation. ADR 0005 corrects the Phase 5
scope failure: startup and periodic history publish no children until a live
event selects an active orchestrator root, after which reconciliation retains
only that root's immediate children. Root switches remove old membership and
root deletion clears scope. Review corrections additionally restrict unknown
status selection to exact listed roots and commit candidate root plus replacement
membership/status atomically only after successful list and status snapshots.
The same-root eligibility correction admits only children observed through live
creation during this runtime or currently reported busy/retry by status
authority, retaining admitted children through later idle/missing status and
clearing eligibility on deletion or root switch. Historical list recency,
unknown child status, and historical idle parentage alone are never selectors or
presentation admission signals. A creation beneath a known or pending immediate
child is a nested descendant, not a new root candidate. The final race correction uses a request-time
scope generation so active/pending root deletion, or a different explicit root
creation, invalidates in-flight SDK results before any serialized state commit
or publication. Child deletion extends the same invalidation only when its exact
`parentID` matches the active or pending root; foreign child deletion does not
invalidate current reconciliation. Valid status for an ID not tracked as an
active child conservatively invalidates in-flight work before authoritative
root resolution, while known active-child status does not.

1. Normalize `session.created`, `session.deleted`, and `session.status`.
2. Serialize state transitions through one queue.
3. Reconcile child membership through `session.list()` filtered to the exact
   live-event-selected active-root `parentID`; publish nothing before selection.
4. Reconcile status through `session.status()`.
5. Admit only live-created or authoritative busy/retry immediate children, then
   retain their eligibility and infer idle when admitted children are absent
   from the status map.
6. Trigger reconciliation for unknown or out-of-order status events.
7. Add periodic reconciliation to close the plugin initialization gap.
8. Add tests for concurrent callbacks, duplicate events, deletion-before-open,
   missed startup events, and disposal races.
9. Journal the phase.

## Phase 4: Controller Integration

Completed 2026-07-24. The backend-neutral controller serializes desired
membership and adapter operations, uses the live server URL for a credential-
free bounded health probe immediately before each exact attach request,
coalesces periodic retries and exact-ID existence polling, and performs bounded
idempotent cleanup before adapter/broker disposal. Once a successfully opened
presentation is absent, close means close for that child membership lifetime:
manual closure and immediate client exit never reopen it. A later authoritative
removal and re-add creates a fresh record. Pre-handle availability, health, and
open failures retain bounded interval retries; `exists` failures retain the
handle and periodic probing. The default disabled plugin creates no runtime
resources. Review corrections synchronously filter unrelated plugin events,
validate the complete OpenCode health JSON inside the probe deadline, isolate
plugin tests from real broker discovery, and apply one absolute controller
disposal deadline with contained best-effort continuation.

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

The first live run opened historical project children. ADR 0005 and its
tracker/controller regressions corrected that scope failure. A later focused
live rerun from the repository working directory opened the orchestrator alone,
with no historical children. Two simultaneous newly created child sessions
opened exactly two readable, correctly positioned splits. Closing both once
exposed the obsolete delayed replacement policy: both reappeared; closing them a
second time left them closed. The user rejected any reopening after manual
closure, so the controller now implements close-means-close behavior. Broader
lifecycle scenarios remain required.

The approved implementation policy treats `childBias` as the first child-region
share only: the first child uses the configured orientation beside the exact
orchestrator, while later children use the opposite orientation at bias `50`
inside a deterministic successfully presented-child area. Provisional recovery
and rollback IDs remain exact-ID cleanup-managed but are never placement
anchors. See
`docs/plans/readable-multi-child-placement.md`; the focused two-child placement
gate is live-validated, while broader placement scenarios remain pending.

1. Start OpenCode through the trusted Kitty launch path.
2. Create one synchronous child session and one background child session.
3. Verify each split attaches to the correct child session.
4. Verify multiple children use deterministic placement.
5. Verify focus behavior.
6. Manually close one or more splits and verify they remain closed without any
   replacement while membership remains present.
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
