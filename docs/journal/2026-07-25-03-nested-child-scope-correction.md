# 2026-07-25 - Nested Child Scope Correction

## Completed

- Found and corrected a scope escape during pre-commit review: a child created
  beneath an already known or pending immediate child could previously be
  treated as a child-first root candidate.
- Added a separate known-immediate-child set populated only from authoritative
  active-root membership and live direct-child creation.
- Prevented nested creation events from adding root intent, pending eligibility,
  or presentation state.
- Removed the public `opencodeExecutable` plugin option because the trusted
  broker selects its executable at startup and the plugin option had no effect.
- Added a concurrent direct-child/grandchild regression proving the immediate
  child remains the only published session.

## Decisions

- A session created beneath a known or pending immediate child is a nested
  descendant, not a new orchestrator-root signal.
- The broker startup option remains the only executable override. The strict IPC
  protocol still accepts no executable value.

## Verification

- Focused tracker and configuration tests passed: 64 tests and 179 assertions.
- All configured TypeScript checks passed.

## Risks Or Blockers

- Multi-child placement remains functionally verified but visually too narrow;
  it is the next V1 follow-up.

## Files

- `src/session/tracker.ts`
- `src/config.ts`
- `test/session-tracker.test.ts`
- `test/config.test.ts`
- `README.md`
- `docs/decisions/0005-active-orchestrator-root-scope.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/handover/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-25-03-nested-child-scope-correction.md`

## Next Step

Run the complete check, then create the requested clean V1 checkpoint commits
before beginning multi-child placement work.
