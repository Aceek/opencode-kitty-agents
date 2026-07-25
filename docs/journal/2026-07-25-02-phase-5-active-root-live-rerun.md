# 2026-07-25 - Phase 5 Active-Root Live Rerun

## Completed

- Ran the focused Phase 5 desktop rerun after confirming the production check
  passed with 161 tests and 460 assertions and no production broker was active.
- Identified and stopped an initial invalid attempt launched from outside the
  repository working directory. Its OpenCode process did not load this
  repository's project plugin configuration, so it opened no child
  presentations. No code or configuration was changed.
- Reran from the repository working directory through the temporary trusted
  Kitty mappings.
- Confirmed that a newly launched orchestrator did not open historical child
  sessions at startup.
- Created exactly two harmless live child agents. Exactly two managed child
  presentations opened alongside the orchestrator, with no historical child
  presentations or duplicate child presentations observed.
- Manually closed managed child presentation(s) once and observed the intended
  bounded automatic replacement behavior. No historical session was opened as
  a consequence.
- Stopped only the exact production broker process with SIGTERM. The broker
  exited and no production broker remained active.

## Decisions

- ADR 0005's focused anti-mass-open behavior is live-validated: historical
  project children did not appear when the active orchestrator began, and only
  the two newly created immediate child agents were presented.
- The test must be launched from the repository working directory so OpenCode
  loads the project plugin configuration. Starting from a generic home
  directory is not a valid V1 presentation test.
- Multi-child layout readability is not yet accepted: the three-column
  orchestrator-plus-two-child arrangement was functionally correct but too
  narrow to be considered readable on the observed desktop.

## Verification

- `bun run check` passed before the rerun: 161 tests, 460 assertions, all
  configured TypeScript checks, and production build.
- The first valid desktop state contained the orchestrator only and no
  historical child strips.
- After two live child creations, the desktop contained the orchestrator and
  exactly two child presentations attached to the requested agents.
- The user observed no duplicated presentation and no opening of completed
  historical agents.
- Process presence check after SIGTERM returned no production broker process.

## Risks Or Blockers

- The placement policy needs a focused design and live verification before
  V1 can claim a readable multi-child arrangement.
- The tracker ingress-bounding and trailing reconciliation concerns identified
  during handover analysis remain to be corrected before broader Phase 5
  validation or release readiness.
- Manual-close behavior was observed for the first bounded replacement only;
  the explicit second-close/no-reopen-loop scenario remains to be run after
  the placement and tracker follow-up work is addressed.

## Files

- `docs/journal/README.md`
- `docs/journal/2026-07-25-02-phase-5-active-root-live-rerun.md`

## Next Step

Design and test a deterministic readable multi-child Kitty placement without
weakening exact-ID targeting or the active-root scope, then rerun the targeted
two-child desktop scenario before broader Phase 5 lifecycle scenarios.
