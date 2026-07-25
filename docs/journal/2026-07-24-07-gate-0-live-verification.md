# 2026-07-24 - Gate 0 Live Verification

## Completed

- Installed and reloaded a temporary Kitty mapping that launched the Gate 0
  broker as an authorized background process.
- Ran the broker-to-OpenCode-plugin integration probe in a Kitty `splits` tab.
- Removed both temporary Kitty mappings and reloaded the original configuration.
- Updated the accepted ADRs, feasibility record, and implementation plan with
  the successful gate result.

## Decisions

- Use the ADR 0004 background broker as the V1 Kitty capability owner.
- Preserve the explicit inherited-FD mapping for each broker `kitten`
  subprocess.
- Proceed to Phase 1 without enabling global Kitty remote control or retaining
  test mappings in user configuration.

## Verification

- The first invocation safely returned `unsupported_layout` and created no
  window because the source tab was not using Kitty's `splits` layout.
- After explicitly selecting `splits`, the sanitized result confirmed the
  actual OpenCode server-plugin runtime connected to the broker.
- The broker queried the exact OpenCode window, launched a harmless split,
  verified both numeric IDs in the same tab, and closed the split.
- The broker also closed the test-created OpenCode window. The pre-existing
  source window and unrelated Kitty windows remained open.
- The result contained only the version, success flag, and boolean proof fields;
  it contained no IDs, endpoint, descriptor, environment, argv, Kitty JSON, or
  credentials.
- `bun run check` passed after the live probe and mapping removal: both
  TypeScript configurations, nine tests, and the production build.

## Risks Or Blockers

- The probe is test-only; the production broker protocol and lifecycle still
  need implementation and focused tests.
- Multi-child placement remains unverified and cannot yet be promised.

## Files

- `~/.config/kitty/kitty.conf` (temporary mappings added, then removed)
- `docs/decisions/0003-ephemeral-kitty-capability.md`
- `docs/decisions/0004-background-capability-broker.md`
- `docs/research/feasibility.md`
- `docs/plans/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-07-gate-0-live-verification.md`

## Next Step

Begin Phase 1 with the smallest validated configuration, pure lifecycle types,
and broker-backed `PresentationAdapter` contract required by V1.
