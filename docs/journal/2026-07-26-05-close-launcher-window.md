# 2026-07-26 - Close Launcher Window

## Completed

- Changed successful broker startup to close the exact Kitty source terminal
  that invoked the trusted launcher mapping.
- Kept the source terminal open when its exact-ID close operation fails, rather
  than failing or rolling back the validated orchestrator.
- Kept source closure after returned-orchestrator validation and private broker
  readiness, so startup failure never removes the user's launcher terminal.

## Decisions

- Treat the mapping source as disposable launcher UI, not as a persistent
  presentation window. The orchestrator becomes the sole root view in the tab.
- Use the existing idempotent, exact numeric-ID `close-window` argv and retain
  the existing Kitty command allowlist.

## Verification

- Added focused cleanup tests for the idempotent exact-ID source close and its
  contained failure path.
- Full project verification remains required after the source change.

## Risks Or Blockers

- A focused desktop run must confirm the source terminal closes only after the
  OpenCode orchestrator is visible and that child-agent placement still works.

## Files

- `src/broker/main.ts`
- `src/broker/launcher.ts`
- `test/broker-launcher.test.ts`
- `README.md`
- `docs/decisions/0006-user-invoked-layout-preparation.md`
- `docs/handover/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-26-05-close-launcher-window.md`

## Next Step

Build and run the focused desktop launcher test from a separate Kitty terminal:
verify that the source terminal closes after the orchestrator appears, then
create one child agent to confirm presentation placement.
