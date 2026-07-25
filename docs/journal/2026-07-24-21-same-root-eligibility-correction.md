# 2026-07-24 - Same Root Eligibility Correction

## Completed

- Closed the remaining same-root historical mass-open path by separating exact
  active-root parentage from presentation eligibility.
- Added active-root eligibility for only children whose explicit live
  `session.created` event was observed during this plugin runtime or whose
  successful authoritative status snapshot currently reports `busy` or
  `retry`.
- Retained admitted eligibility through later idle or missing status until
  deletion or committed root switch. Added pending eligibility keyed by root so
  child creation and completion before the first snapshot remains observable.
- Made successful list and status handling one atomic commit for root,
  eligibility, membership, and normalized status. List/status failure retains
  valid current membership and pending intent; successful status can still
  update current eligible children when list fails.
- Cleared old and foreign eligibility at committed root switches and relevant
  deletion events, with an additional publication invariant requiring active
  eligibility.
- Added regressions for 30 idle historical children under a status-selected old
  root, exactly two authoritative non-idle admissions, observed-child idle and
  missing transitions, creation/completion before first snapshot, eligibility
  isolation across root switch, and status-failure switch retention.
- Updated ADR 0005, architecture, implementation plan, and README, including the
  limitation that wholly historical idle children remain intentionally
  unpresented.

## Decisions

- Exact `parentID` scope is necessary but not sufficient for presentation.
  Eligibility additionally requires live creation observed by this runtime or
  current authoritative non-idle status.
- Eligibility is sticky only for the committed active-root lifetime and never
  transfers across roots.
- Root/membership replacement waits for both list and status authority so a
  status failure cannot close valid current presentations or admit history.

## Verification

- `bun run check` passed after implementation, tests, and documentation: all
  source, test, and Gate 0 TypeScript configurations; 152 tests with 429
  assertions; and the production declaration/JavaScript build.
- Phase 5 live execution was not resumed.

## Risks Or Blockers

- A child that was created, ran, and became idle before plugin startup remains
  unpresented unless it later emits a live creation event or appears busy/retry
  in a successful status snapshot. This is the intentional safety tradeoff that
  prevents historical same-root mass-open.
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
- `docs/journal/2026-07-24-21-same-root-eligibility-correction.md`

## Next Step

Review the active-root eligibility and atomic list/status commit correction. Do
not resume Phase 5 live testing until a separate run is explicitly authorized.
