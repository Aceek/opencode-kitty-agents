# 2026-07-24 - Root Status Generation Correction

## Completed

- Extended request-time scope invalidation to every valid `session.status` ID
  not currently tracked as an active child. The invalidation occurs
  synchronously before serialized status resolution is queued.
- Preserved authoritative root selection: conservative invalidation alone does
  not select scope, and a later successful list must still resolve the exact
  status ID as a root with no `parentID`.
- Kept known active-child status as an ordinary serialized update that does not
  invalidate in-flight reconciliation.
- Added deferred-list tracker and deferred-status controller regressions proving
  an unknown root-status switch cannot transiently publish or open old-root
  history. Added a known-active-child regression proving valid current
  reconciliation is not invalidated.
- Updated ADR 0005, architecture, implementation plan, and README with the
  conservative root-status generation boundary.

## Decisions

- Unknown valid status is conservatively scope-invalidating because the event
  lacks parent information, but remains non-authoritative for root identity.
- Current tracked child status does not advance generation, avoiding needless
  cancellation of ordinary child lifecycle updates.
- Root identity and replacement membership continue to commit only through the
  existing successful authoritative list/status transaction.

## Verification

- `bun run check` passed after implementation, tests, and documentation: all
  source, test, and Gate 0 TypeScript configurations; 161 tests with 460
  assertions; and the production declaration/JavaScript build.
- Phase 5 live execution was not resumed.

## Risks Or Blockers

- Unknown child status also invalidates conservatively until the authoritative
  list rejects it as a root candidate. Reconciliation remains coalesced and
  bounded.
- The corrected behavior still awaits a separately authorized Phase 5 live
  rerun.

## Files

- `src/session/tracker.ts`
- `test/session-tracker.test.ts`
- `test/controller.test.ts`
- `docs/decisions/0005-active-orchestrator-root-scope.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `README.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-24-root-status-generation-correction.md`

## Next Step

Review the root-status generation correction. Do not resume Phase 5 live testing
until a separate run is explicitly authorized.
