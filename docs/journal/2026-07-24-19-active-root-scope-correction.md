# 2026-07-24 - Active Orchestrator Root Scope Correction

## Completed

- Recorded the Phase 5 live failure: startup reconciliation treated every
  historical project child as current membership and opened dozens of
  unreadable Kitty splits.
- Added accepted ADR 0005, reversing and clarifying the broad project-scoped
  membership statement. V1 now presents only immediate children of one active
  orchestrator root.
- Changed the tracker to publish no startup or periodic historical children
  until a live root creation, child creation, or list-resolved unknown status
  candidate selects scope.
- Added serialized root selection and switching, exact `parentID` filtering for
  event and snapshot paths, authoritative replacement of old-root membership,
  active-root deletion cleanup, and unresolved foreign-event containment.
- Added regressions for empty startup with many historical children, root and
  child-first selection, root- and child-shaped status candidates, root switch,
  foreign events, root deletion, and controller-level prevention of historical
  mass-open with old-root window cleanup.
- Updated the architecture, implementation plan, and README to describe the
  corrected scope and the halted live-test state.

## Decisions

- Live public events establish active-root scope; historical list recency never
  does.
- SDK list and status snapshots remain authoritative for membership and status
  only within the event-selected immediate-child scope.
- Root switching remains entirely inside `SessionTracker`; the controller sees
  only ordinary authoritative membership removal and therefore closes old-root
  presentations through its existing backend-neutral contract.
- Phase 5 live execution was not continued as part of this correction.

## Verification

- Rechecked installed OpenCode/plugin/SDK 1.18.4 contracts for optional
  `Session.parentID`, complete created/deleted session payloads, status event
  IDs, field-style list/status responses, top-level request options, unawaited
  event hooks, and awaited disposal.
- Rechecked current OpenCode upstream session creation, project list behavior,
  event delivery, and child lookup implementations.
- Rechecked installed Kitty 0.47.4 launch, exact numeric targeting, background
  capability, list, and idempotent close help plus the upstream FD-capability
  implementation. No Kitty command was executed against a live instance.
- `bun run check` passed after code, tests, and documentation: all source, test,
  and Gate 0 TypeScript configurations; 144 tests with 400 assertions; and the
  production declaration/JavaScript build.

## Risks Or Blockers

- The corrected scope has not been rerun live by requirement. Phase 5 remains
  halted pending separate authorization to resume focused live verification.

## Files

- `src/session/tracker.ts`
- `test/session-tracker.test.ts`
- `test/controller.test.ts`
- `docs/decisions/0005-active-orchestrator-root-scope.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `README.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-19-active-root-scope-correction.md`

## Next Step

Review the ADR 0005 implementation correction. Do not resume Phase 5 live
execution until that review is complete and a separate live-test run is
explicitly authorized.
