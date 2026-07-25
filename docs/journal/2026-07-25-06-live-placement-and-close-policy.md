# 2026-07-25 - Live Placement And Close Policy

## Completed

- Ran the user-approved focused Kitty scenario from this repository with the
  production broker and temporary restricted mappings.
- Confirmed startup showed only the orchestrator and no historical child
  presentations.
- Launched two agents simultaneously and confirmed exactly two readable,
  correctly positioned child splits appeared.
- Closed both child windows once. Both reappeared under the prior one-delayed-
  replacement policy; closing them a second time confirmed the old anti-loop
  bound by leaving both closed.
- Accepted the user's rejection of any automatic reopening after a manual
  closure and changed controller policy to close means close for the current
  child membership lifetime.
- Preserved bounded retries only for failures before a valid presentation handle
  exists. A later missing handle, including immediate attach-client exit, now
  remains closed until authoritative removal and a later fresh membership.
- Preserved revision coalescing while retaining bounded removal edges so a
  deletion and same-ID re-add can reset a closed lifetime even when snapshots
  arrive during a slow existence check.
- Stopped only the exact production broker process with SIGTERM and confirmed no
  production broker remained active.

## Decisions

- A successfully opened presentation that later disappears has desired state
  `closed`, phase `unavailable`, and reason `window-closed`; timer and snapshot
  traffic cannot reopen it while membership remains continuous.
- V1 does not guess whether disappearance was manual or an immediate client
  exit. Both honor close means close.
- The exported `manualReopenAttempts` snapshot field remains deprecated at the
  constant value zero for source compatibility; it no longer controls behavior.
- The focused two-child placement is live-validated. Broader Phase 5 lifecycle
  behavior remains unclaimed.

## Verification

- User observation confirmed the orchestrator-only startup, absence of history,
  exact two-child presentation, readable placement, and old one-replacement
  behavior.
- Controller tests cover no reopening across timer/snapshot floods, slow
  existence completion, immediate exit, ordinary pre-handle retries, ordinary
  removal/re-add, and coalesced removal/re-add during pending existence work.
- Independent review verified the close policy, bounded removal-edge handling,
  desired-state semantics, compatibility field, and tests with no remaining
  code finding.
- `bun run check` passed: all source, test, and Gate 0 TypeScript checks; 169
  tests with 493 assertions; and the production build.
- `git diff --check` passed.
- No production broker remained active after exact-process cleanup.

## Risks Or Blockers

- Close means close is unit-tested but has not yet received a fresh live rerun
  after the correction.
- Moved-window, authoritative deletion, immediate-exit, shutdown, and Kitty
  capability-loss scenarios remain in Phase 5.

## Files

- `src/controller.ts`
- `test/controller.test.ts`
- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/plans/readable-multi-child-placement.md`
- `docs/handover/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-25-06-live-placement-and-close-policy.md`

## Next Step

After explicit user confirmation, run a fresh focused close-means-close scenario
with one newly created child, close its presentation once, wait beyond multiple
reconciliation intervals, and confirm it never reopens before proceeding to the
remaining Phase 5 lifecycle scenarios.
