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
