# 2026-07-24 - Active Root Review Corrections

## Completed

- Corrected ADR 0005 status-candidate behavior so an unknown live
  `session.status` can select or switch scope only when a successful
  authoritative list resolves that exact session as a root with no `parentID`.
  Unknown child status no longer derives scope from its parent.
- Replaced immediate event-time root switching with ordered pending root
  intents. A successful list now atomically commits the chosen root and complete
  immediate-child membership; a failed or malformed list retains both the old
  active root and its published children.
- Preserved status reconciliation for existing membership while a candidate
  switch is pending after list failure. Active-root deletion still clears scope
  and children immediately from its authoritative complete event payload.
- Added regressions proving a listed foreign child status with 30 siblings
  neither switches scope nor publishes, root and child-first switches remain
  pending across list failure, successful recovery replaces membership, and the
  controller does not close the old handle before that successful replacement.
- Updated ADR 0005, architecture, implementation plan, and README with both
  review corrections.

## Decisions

- Only explicit `session.created` parent data may provide child-first scope
  selection. Unknown child status is never a root-selection signal.
- Root candidate events establish intent, not membership authority. The active
  root and replacement membership share one successful-list commit boundary.
- Root deletion remains the sole immediate scope-clear path because its public
  event contains authoritative root identity.

## Verification

- `bun run check` passed after implementation, tests, and documentation: all
  source, test, and Gate 0 TypeScript configurations; 146 tests with 411
  assertions; and the production declaration/JavaScript build.
- Phase 5 live execution was not resumed.

## Risks Or Blockers

- The corrected active-root behavior still awaits a separately authorized live
  Phase 5 rerun.

## Files

- `src/session/tracker.ts`
- `test/session-tracker.test.ts`
- `test/controller.test.ts`
- `docs/decisions/0005-active-orchestrator-root-scope.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `README.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-20-active-root-review-corrections.md`

## Next Step

Review the corrected pending-intent and root-only status-selection behavior. Do
not resume Phase 5 live testing until a separate run is explicitly authorized.
