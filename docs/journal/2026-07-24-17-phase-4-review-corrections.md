# 2026-07-24 - Phase 4 Review Corrections

## Completed

- Added synchronous plugin-hook filtering for `session.created`,
  `session.deleted`, and `session.status`; unrelated events now return before
  invoking the tracker or allocating serialized tracker work.
- Added a production plugin factory with narrow tracker, adapter, and fetch test
  seams. Enabled plugin tests inject a fake adapter and therefore cannot inspect,
  connect to, or shut down a real endpoint regardless of process environment.
- Moved manual-close retry scheduling to the completion time of the exact-ID
  existence query and retained one coalesced maintenance request while a slow
  operation is active.
- Replaced per-phase controller disposal bounds with one absolute global
  deadline across queue drain, serial close attempts, and adapter disposal.
  Adapter disposal is always invoked; after deadline expiry its contained
  adapter/broker cleanup continues best effort while controller disposal returns.
- Strengthened `/global/health` validation to require an OK response whose JSON
  body has `healthy: true` and a non-empty string `version`. Fetch and body
  parsing share the same two-second abort/deadline race, with credential omission
  and redirect rejection preserved.
- Added regressions for a 10,000-event unrelated flood, fake-only plugin
  construction, malformed/generic-2xx health responses, stalled JSON parsing,
  timer floods during a slow existence query, completion-relative replacement,
  and stalled late close/shutdown disposal behavior.

## Decisions

- Keep production construction broker-backed by default while exposing only
  narrow dependency injection for deterministic tests.
- Treat OpenCode's installed health schema and handler as authoritative rather
  than using HTTP status alone.
- Use a single controller deadline without extending it for later cleanup
  phases. Work already started at expiry remains rejection-contained and bounded
  by the adapter/broker layer.

## Verification

- Rechecked the installed OpenCode 1.18.4 SDK declaration and server schema and
  handler: `/global/health` returns `{ healthy: true, version:
  InstallationVersion }`.
- `bun run check` passed after production changes and tests: all source, test,
  and Gate 0 TypeScript configurations; 136 tests with 372 assertions; and the
  production declaration/JavaScript build.
- `git diff --check` passed.

## Risks Or Blockers

- Phase 5 live testing remains intentionally unperformed.
- A controller disposal deadline can expire before adapter shutdown completes;
  the already-invoked operation continues best effort under Phase 2's bounded
  adapter/broker contracts.

## Files

- `src/controller.ts`
- `src/index.ts`
- `test/controller.test.ts`
- `test/plugin.test.ts`
- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-17-phase-4-review-corrections.md`

## Next Step

Hold at corrected Phase 4 for acceptance. Do not perform Phase 5 live tests or
write final user setup documentation without explicit authorization.
