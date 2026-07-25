# 2026-07-24 - Phase 2 IPC Timeout Budget

## Completed

- Replaced independent 10-second IPC defaults with one named client/server
  timeout derived from the bounded Kitty operation budget.
- Defined the longest broker operation as at most five serialized 10-second
  Kitty subprocesses, plus a five-second scheduling margin and a five-second IPC
  margin, producing a shared 60-second transport timeout.
- Preserved explicit client and server timeout overrides for focused tests.
- Prevented queue wait from consuming the operation budget by rejecting an
  overlapping IPC request while one serialized request is active.
- Added a regression that simulates a valid serialized `open` taking 12 seconds
  of Kitty work without delaying the test and confirms it returns exactly one
  window handle under the new budget.

## Decisions

- The Phase 3 controller is expected to keep one broker request in flight. The
  Phase 2 server enforces that assumption instead of permitting an unbounded
  request queue that could outlast the transport timeout.
- The timeout budget includes validation, focus restoration, and rollback close
  paths, ensuring a client cannot expire a valid operation while it still owns
  an unreported managed window.

## Verification

- Added constant relationship tests proving the IPC default exceeds both the
  previous 10-second value and the derived worst-case operation budget.
- Added a real socket regression proving concurrent work is rejected rather
  than queued while the first request still receives its response.
- `bun run check` passed: all source, test, and Gate 0 TypeScript
  configurations; 96 tests with 228 assertions; and the production build.

## Risks Or Blockers

- Multiple concurrent controller requests remain unsupported by design. Phase 3
  must preserve serialized adapter use.
- Phase 3 has not started.

## Files

- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-12-phase-2-ipc-timeout-budget.md`
- `src/broker/server.ts`
- `src/broker/timeouts.ts`
- `src/presentation/kitty/client.ts`
- `test/broker-server.test.ts`
- `test/broker-timeouts.test.ts`

## Next Step

Hold at Phase 2. If Phase 3 is later authorized, its serialized controller must
maintain the documented one-in-flight broker request invariant.
