# 2026-07-24 - Phase 4 Controller Integration

## Completed

- Added a backend-neutral presentation controller that subscribes to immutable
  tracker snapshots, serializes adapter mutations, coalesces revisions and
  periodic work, and reconciles authoritative child membership to managed
  presentation handles.
- Wired the enabled default plugin to the existing broker-backed Kitty adapter.
  The disabled path returns before constructing any tracker, controller, timer,
  adapter, or broker client resource; the event hook schedules contained work
  without depending on OpenCode awaiting it, while disposal awaits controller
  and tracker cleanup.
- Changed adapter opening to receive the launch-time server URL. The controller
  reads the live `ctx.serverUrl` getter for every attempt, rejects credentials,
  probes `/global/health` immediately before open with a credential-free GET and
  a two-second abort/deadline race, then passes that exact URL and normalized
  child session through the existing strict broker protocol.
- Added interval-bounded unavailable retries and periodic exact-ID existence
  polling. Snapshot traffic cannot accelerate existence calls. Manual closure
  or immediate exit receives one delayed replacement per tracked child
  lifetime, after which it remains unavailable to avoid reopening loops.
- Added idempotent disposal that stops subscriptions, timers, health requests,
  and new queue work; bounds queue drain and serial managed-handle cleanup; and
  then awaits adapter/broker disposal. No cleanup path deletes an OpenCode
  session.
- Added fake tracker, adapter, scheduler, clock, and fetch tests covering state
  transitions, concurrent/duplicate snapshots, deletion during open, health
  failure and retry, live URL capture, credential rejection, abort deadlines,
  manual closure, immediate exit, adapter/open/exists/close failures, focus
  policy, and disposal races without a desktop.

## Decisions

- Preserve the Phase 2 broker's one-request-in-flight invariant by serializing
  all normal operations and using serial controller close concurrency.
- Treat ordinary unavailability as indefinitely recoverable at a bounded rate
  of one attempt per reconciliation interval, but cap manual-close replacement
  at one per child membership lifetime.
- Keep focus implementation in the adapter/broker launch request. The controller
  never invokes Kitty or performs a compensating focus operation.
- Use separate fixed disposal bounds for queue drain, controller closes, and
  final adapter disposal so broker shutdown is still invoked after earlier
  cleanup consumes its own bound.

## Verification

- Rechecked current OpenCode plugin contracts and implementation: `serverUrl` is
  a live getter, event-hook promises are not awaited, and dispose hooks are
  awaited.
- Rechecked the current OpenCode attach command ordering and retained the Phase
  2 protocol's exact URL, directory, and session fields.
- Rechecked Kitty's exact numeric-ID, inherited-capability, and split placement
  contracts; the controller adds no direct Kitty invocation.
- `bun run check` passed after code, tests, and documentation: all source, test,
  and Gate 0 TypeScript configurations; 131 tests with 347 assertions; and the production
  declaration/JavaScript build.

## Risks Or Blockers

- Phase 5 live end-to-end verification has not been run by requirement.
- Final Kitty mapping and user setup documentation remain deferred.
- Multi-child placement remains a broker behavior requiring Phase 5 live
  verification before it becomes a public guarantee.

## Files

- `src/controller.ts`
- `src/index.ts`
- `src/presentation/adapter.ts`
- `src/presentation/kitty/adapter.ts`
- `test/controller.test.ts`
- `test/kitty-adapter.test.ts`
- `test/presentation-contract.test.ts`
- `test/plugin.test.ts`
- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-16-phase-4-controller-integration.md`

## Next Step

Hold after Phase 4. When explicitly authorized, execute the focused Phase 5
live tests against only broker-created numeric Kitty IDs; do not write final user
setup documentation until those results are verified.
