# 2026-07-24 - Child Deletion Generation Correction

## Completed

- Extended request-time reconciliation invalidation to a deleted child whose
  exact `parentID` matches the active or pending orchestrator root.
- Preserved the scope boundary for foreign child deletion: it does not advance
  generation or invalidate valid current-root reconciliation.
- Added a deferred-list tracker regression proving pending-root child deletion
  prevents stale publication, a deferred-status controller regression proving
  no transient child window opens, and a foreign-child regression proving valid
  current-root reconciliation still commits.
- Updated ADR 0005, architecture, implementation plan, and README with the child
  deletion generation rule and foreign-root exclusion.

## Decisions

- Root identity for deletion invalidation is the deleted root ID or, for a
  child, its exact event `parentID`.
- Only active/pending-root matches advance scope generation. Foreign child
  deletion remains an ordinary serialized no-op for current scope.
- Actual child deletion map mutations remain serialized; only scalar generation
  invalidation occurs synchronously.

## Verification

- `bun run check` passed after implementation, tests, and documentation: all
  source, test, and Gate 0 TypeScript configurations; 158 tests with 451
  assertions; and the production declaration/JavaScript build.
- Phase 5 live execution was not resumed.

## Risks Or Blockers

- The corrected scope behavior still awaits a separately authorized Phase 5
  live rerun.

## Files

- `src/session/tracker.ts`
- `test/session-tracker.test.ts`
- `test/controller.test.ts`
- `docs/decisions/0005-active-orchestrator-root-scope.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `README.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-23-child-deletion-generation-correction.md`

## Next Step

Review the child-deletion generation correction. Do not resume Phase 5 live
testing until a separate run is explicitly authorized.
