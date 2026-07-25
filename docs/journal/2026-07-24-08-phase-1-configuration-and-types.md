# 2026-07-24 - Phase 1 Configuration And Pure Types

## Completed

- Added strict public plugin-option parsing for enablement, split direction,
  child bias, reconciliation interval, focus policy, and an optional OpenCode
  executable override.
- Added normalized child-session, non-sensitive presentation handle, lifecycle
  state, and availability types.
- Added the complete V1 `PresentationAdapter` boundary with broker-owned
  transport details excluded from controller-visible values.
- Retained the default OpenCode plugin export and made initialization validate
  its options without adding runtime presentation behavior.
- Documented Phase 1 status, configuration defaults, accepted values, and the
  remaining unimplemented runtime in the README.
- Added runtime validation tests, compile-checked adapter contract tests, and a
  dedicated TypeScript test configuration.

## Decisions

- Default to a vertical split, 40 percent child bias, five-second
  reconciliation, and preserved orchestrator focus.
- Reject unknown options, non-finite bias, effectively hidden 0/100-percent
  splits, and reconciliation intervals below one second rather than silently
  normalizing invalid input.
- Keep the broker endpoint, inherited descriptor, authorization data, and all
  other Kitty capabilities out of public handles and availability failures.
- Keep Phase 1 pure: no Kitty process runner, tracker, controller, broker
  implementation, backend registry, or compatibility layer was added.

## Verification

- Rechecked the installed OpenCode 1.18.4 `Plugin`, `PluginOptions`, and hook
  declarations before preserving the export and tuple-option contract.
- Rechecked Kitty 0.47.4 background remote-control descriptor behavior and
  launch bias semantics against upstream implementation and help text.
- `bun run check` passed after implementation: all source, test, and Gate 0
  TypeScript configurations; 42 tests with 109 assertions; and the production
  declaration/JavaScript build.

## Risks Or Blockers

- Runtime behavior remains intentionally absent until Phase 2 and later phases.
- Multi-child placement and the production broker protocol remain unverified
  and are not public behavior guarantees.

## Files

- `README.md`
- `package.json`
- `src/config.ts`
- `src/index.ts`
- `src/session/types.ts`
- `src/presentation/adapter.ts`
- `src/presentation/types.ts`
- `test/config.test.ts`
- `test/plugin.test.ts`
- `test/presentation-contract.test.ts`
- `tsconfig.test.json`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-08-phase-1-configuration-and-types.md`

## Next Step

Begin V1 Phase 2 by implementing only the broker-backed Kitty client and
adapter process boundary, exact-ID argv/parsing behavior, bounded failures, and
focused tests described in `docs/plans/v1-implementation.md` and ADR 0004.
