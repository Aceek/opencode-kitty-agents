# Development Journal

This directory is the append-only operational history for development,
handoffs, and recovery after interruption.

## Rules

- Create one file per major completed step.
- Name files `YYYY-MM-DD-NN-short-title.md`.
- Never store intentions as completed work.
- Never store credentials, environment values, socket addresses, Kitty public
  keys, passwords, OAuth data, or other capabilities.
- Link commits and issues when they exist.
- Preserve failed experiments when they affect future decisions.
- End each entry with the exact next recommended step.
- Before handing work off, add an entry summarizing the current verified state.

## Required Entry Shape

```markdown
# YYYY-MM-DD - Title

## Completed

- ...

## Decisions

- ...

## Verification

- ...

## Risks Or Blockers

- ...

## Files

- `path`

## Next Step

...
```

## Index

- `2026-07-24-01-feasibility.md`
- `2026-07-24-02-repository-bootstrap.md`
- `2026-07-24-03-architecture-and-handover.md`
- `2026-07-24-04-validation-and-publication.md`
- `2026-07-24-05-gate-0-capability-path.md`
- `2026-07-24-06-gate-0-background-broker-probe.md`
- `2026-07-24-07-gate-0-live-verification.md`
- `2026-07-24-08-phase-1-configuration-and-types.md`
- `2026-07-24-09-phase-2-broker-and-kitty-adapter.md`
- `2026-07-24-10-phase-2-review-corrections.md`
- `2026-07-24-11-phase-2-final-review-corrections.md`
- `2026-07-24-12-phase-2-ipc-timeout-budget.md`
- `2026-07-24-13-phase-2-disposal-drain.md`
- `2026-07-24-14-phase-3-session-tracker.md`
- `2026-07-24-15-phase-3-review-corrections.md`
- `2026-07-24-16-phase-4-controller-integration.md`
- `2026-07-24-17-phase-4-review-corrections.md`
- `2026-07-24-18-phase-4-stale-snapshot-disposal.md`
- `2026-07-24-19-active-root-scope-correction.md`
- `2026-07-24-20-active-root-review-corrections.md`
- `2026-07-24-21-same-root-eligibility-correction.md`
- `2026-07-24-22-root-deletion-generation-correction.md`
- `2026-07-24-23-child-deletion-generation-correction.md`
- `2026-07-24-24-root-status-generation-correction.md`
- `2026-07-25-01-orchestration-handover.md`
- `2026-07-25-02-phase-5-active-root-live-rerun.md`
- `2026-07-25-03-nested-child-scope-correction.md`
- `2026-07-25-04-clean-checkpoint-handover.md`
- `2026-07-25-05-readable-multi-child-placement.md`
- `2026-07-25-06-live-placement-and-close-policy.md`
