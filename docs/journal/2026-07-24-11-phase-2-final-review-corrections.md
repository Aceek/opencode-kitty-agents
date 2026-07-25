# 2026-07-24 - Phase 2 Final Review Corrections

## Completed

- Unified child and orchestrator launch through one recovery primitive that
  performs marked pre/post origin-tab recovery after subprocess rejection,
  timeout, or malformed stdout.
- Changed managed-window existence to a full non-mutating Kitty `ls` snapshot
  so a child moved to another tab remains existing and eligible for exact-ID
  cleanup. Parsing retains only layouts, numeric IDs, and the one recovery
  marker; raw Kitty state is never logged.
- Added broker socket error containment for clients that disconnect while an
  asynchronous response is pending. Response writes and handler rejection use
  bounded protocol results without exposing exception details.
- Added one global managed-window shutdown deadline. Close subprocesses remain
  sequential, no new close begins after expiry, and the one possible leftover
  bounded operation has a contained rejection path.

## Decisions

- Exact child `ls --match` remains unsuitable because Kitty raises on a missing
  match, while origin-tab-only state is insufficient after a user moves a
  managed child. Full `ls` is read only for numeric membership and discarded.
- Recovery after a rejected runner uses the same conservative requirements as
  malformed-output recovery: exactly one added numeric ID, no removed prior ID,
  and the exact broker-generated marker. Ambiguous or unrelated windows remain
  untouched.
- Shutdown's global timeout is independent of managed-window count. Sequential
  execution limits active close subprocesses to one.

## Verification

- Added regressions for rejected/timed-out child and orchestrator launch
  recovery, moved-tab existence and cleanup, disconnected async clients, full
  non-mutating state argv, sequential close concurrency, and a globally bounded
  shutdown with contained leftover work.
- `bun run check` passed: all source, test, and Gate 0 TypeScript
  configurations; 93 tests with 219 assertions; and the production build.
- `git diff --check` is required immediately after this journal update.

## Risks Or Blockers

- Full Kitty `ls` contains fields V1 does not need. The parser discards them and
  logging remains prohibited; no raw response is persisted or returned over
  broker IPC.
- Phase 3 has not started. Final user setup and end-to-end integration remain
  deferred.

## Files

- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/research/feasibility.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-11-phase-2-final-review-corrections.md`
- `src/broker/core.ts`
- `src/broker/kitty.ts`
- `src/broker/main.ts`
- `src/broker/server.ts`
- `src/presentation/kitty/client.ts`
- `test/broker-core.test.ts`
- `test/broker-server.test.ts`
- `test/kitty-client.test.ts`

## Next Step

Hold at Phase 2. Do not begin session tracking or controller integration without
an explicit Phase 3 request.
