# 2026-07-25 - Readable Multi-Child Placement

## Completed

- Recorded the approved deterministic placement design in
  `docs/plans/readable-multi-child-placement.md`.
- Changed vertical placement to create one child region beside the exact
  orchestrator, then subdivide that region vertically at bias 50. Horizontal
  placement applies the symmetric policy.
- Extended sanitized Kitty state with positive `lines` and `columns` and added a
  pure selector that chooses only successfully presented, same-tab managed
  children by largest relevant dimension and deterministic numeric-ID ties.
- Added post-launch anchor validation so Kitty's silent missing-`--next-to`
  fallback cannot be accepted as intended placement.
- Separated cleanup-managed IDs from successful placement anchors. Returned and
  uniquely recovered IDs become cleanup-managed before rollback, while failed
  launches can never become future placement anchors.
- Extended launch recovery reporting so a failed recovery close remains known
  to child-broker shutdown or orchestrator startup cleanup.
- Added non-desktop regressions for vertical and horizontal one-to-four-child
  geometry, parser validation, exact argv, moved and closed children, anchor
  disappearance, failed rollback, recovery cleanup, focus, and timeout fixtures.

## Decisions

- `childBias` is the first child-region share only. Later subdivisions use bias
  50 and the opposite orientation.
- Readable layout is constructed during exact-ID launch. V1 does not broaden the
  Kitty command allowlist or add post-launch layout mutation.
- Children moved outside the orchestrator tab remain lifecycle-managed but are
  excluded as placement anchors.
- The implementation remains a unit-tested policy, not a live readability
  guarantee, until the separately approved focused Kitty scenario passes.

## Verification

- Independent review found and then verified corrections for recovery-orphan
  cleanup, cleanup-only versus placement-anchor state, timeout fixtures, and
  realistic split geometry.
- `bun run check` passed: all source, test, and Gate 0 TypeScript checks; 167
  tests with 486 assertions; and the production build.
- `git diff --check` passed after the complete implementation and documentation
  update.
- No Kitty remote-control command, visible desktop test, or Kitty configuration
  change was performed.

## Risks Or Blockers

- The focused orchestrator-plus-two-child desktop scenario still requires
  explicit user confirmation and must start from this repository directory.
- Readability and focus behavior remain unclaimed as live behavior until that
  scenario passes.

## Files

- `src/broker/core.ts`
- `src/broker/kitty.ts`
- `src/broker/main.ts`
- `test/broker-core.test.ts`
- `test/broker-timeouts.test.ts`
- `test/kitty-client.test.ts`
- `docs/plans/readable-multi-child-placement.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `README.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-25-05-readable-multi-child-placement.md`

## Next Step

After explicit user confirmation, run only the focused two-child live Kitty
scenario from `/home/aceek/projects/opencode-kitty-agents`, verify the
orchestrator remains readable beside two stacked children, and stop before the
broader Phase 5 lifecycle scenarios if placement or scope regresses.
