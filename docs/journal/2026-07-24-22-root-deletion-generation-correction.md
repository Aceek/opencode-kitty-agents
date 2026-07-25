# 2026-07-24 - Root Deletion Generation Correction

## Completed

- Closed the final root-deletion race where reconciliation held the serialized
  queue during SDK I/O and could publish a child before a queued root deletion
  mutation executed.
- Added a request-time scope generation. Receipt of deletion for the active or
  pending root now synchronously invalidates in-flight reconciliation before
  enqueueing the deletion mutation, while all root, eligibility, membership,
  and status map mutations remain serialized.
- Added stale-generation checks before SDK work, after every SDK await, before
  current-status reconciliation, and immediately before the atomic scope commit.
  Stale results publish nothing.
- Applied the same invalidation to a different explicit root creation so stale
  same-root admission cannot publish during a switch. Duplicate creation for the
  already expected root does not repeatedly invalidate reconciliation.
- Added tracker coverage with a deferred list and controller coverage with a
  deferred status response proving root status followed by root deletion never
  publishes or opens the child. Added a separate deferred-status regression for
  root-switch creation invalidation.
- Updated ADR 0005, architecture, implementation plan, and README with the
  generation boundary and serialized-map ownership.

## Decisions

- Scope generation is the only synchronous invalidation state. Actual tracker
  maps remain owned by the serialized mutation queue.
- Reconciliation captures generation when requested, not when queue execution
  begins, so deletion also invalidates reconciliation already queued ahead of
  its mutation.
- Different explicit root creation invalidates stale work; duplicate creation
  for the same expected root does not, avoiding unnecessary restart loops.

## Verification

- `bun run check` passed after implementation, tests, and documentation: all
  source, test, and Gate 0 TypeScript configurations; 155 tests with 440
  assertions; and the production declaration/JavaScript build.
- Phase 5 live execution was not resumed.

## Risks Or Blockers

- The complete corrected scope behavior still awaits a separately authorized
  Phase 5 live rerun.

## Files

- `src/session/tracker.ts`
- `test/session-tracker.test.ts`
- `test/controller.test.ts`
- `docs/decisions/0005-active-orchestrator-root-scope.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `README.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-22-root-deletion-generation-correction.md`

## Next Step

Review the generation invalidation correction. Do not resume Phase 5 live
testing until a separate run is explicitly authorized.
