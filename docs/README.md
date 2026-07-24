# Documentation

## Structure

- `architecture/`: current technical design and runtime contracts.
- `decisions/`: append-only Architecture Decision Records.
- `research/`: verified external behavior and feasibility evidence.
- `plans/`: ordered implementation plans with acceptance gates.
- `handover/`: concise entry points for a future orchestrator.
- `journal/`: chronological, append-only record of completed work.

## Update Rules

- Update architecture documents when the current design changes.
- Add a new ADR instead of rewriting the rationale of an accepted decision.
- Preserve research evidence and mark superseded findings explicitly.
- Update plans as execution discovers new work, but retain completed history in
  the journal.
- Replace a handover only when responsibility changes; journal the replacement.
- Never rewrite old journal entries except to correct an objective error, and
  annotate any correction.
