# 2026-07-24 - Phase 4 Stale Snapshot Disposal Correction

## Completed

- Added accepting/disposal checks at snapshot reconciliation entry, before each
  child-map mutation path, after every awaited presentation close, before each
  child addition, and before follow-up maintenance.
- Prevented an already-running snapshot replacement from adding children after
  controller disposal times out, clears state, and returns.
- Added a regression where replacing two existing children with two new
  children stalls the first close beyond the global disposal deadline. After
  the late close resolves, controller state remains empty and no replacement
  window is opened.

## Decisions

- Treat the controller accepting flag as the commit boundary for all snapshot
  state, not only for queue admission. Any await can cross disposal and must be
  followed by a fresh commit check.
- Leave late close and broker cleanup behavior unchanged; only stale controller
  state commits are rejected.

## Verification

- `bun run check` passed: all source, test, and Gate 0 TypeScript
  configurations; 137 tests with 377 assertions; and the production
  declaration/JavaScript build.
- `git diff --check` passed.

## Risks Or Blockers

- Phase 5 live testing remains intentionally unperformed.

## Files

- `src/controller.ts`
- `test/controller.test.ts`
- `docs/architecture/v1.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-18-phase-4-stale-snapshot-disposal.md`

## Next Step

Hold at corrected Phase 4 for acceptance. Do not perform Phase 5 live tests or
write final user setup documentation without explicit authorization.
