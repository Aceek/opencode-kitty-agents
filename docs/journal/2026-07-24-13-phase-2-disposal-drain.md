# 2026-07-24 - Phase 2 Disposal Drain

## Completed

- Added adapter in-flight request tracking and an atomic disposal boundary.
- Disposal now rejects new adapter work, awaits all already-started operations
  under their existing bounded transport timeout, and then sends one shutdown
  request.
- Repeated disposal calls share the same promise and cannot send duplicate
  shutdown operations.
- Added a deferred-open regression proving a concurrent dispose does not send
  shutdown until the successful open response arrives, rejects later opens, and
  sends shutdown exactly once.

## Decisions

- Disposal does not add a second timeout around in-flight requests; each request
  already owns the coherent bounded IPC budget established in the preceding
  review.
- A racing successful open is allowed to finish and become broker-managed before
  shutdown, ensuring broker cleanup includes its numeric window ID.
- Server overlap rejection remains unchanged for ordinary concurrent requests.

## Verification

- `bun run check` passed: all source, test, and Gate 0 TypeScript
  configurations; 97 tests with 234 assertions; and the production build.
- `git diff --check` is required immediately after this journal update.

## Risks Or Blockers

- Phase 3 has not started.

## Files

- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-13-phase-2-disposal-drain.md`
- `src/presentation/kitty/adapter.ts`
- `test/kitty-adapter.test.ts`

## Next Step

Hold at Phase 2. Do not begin tracker or controller work without explicit Phase
3 authorization.
