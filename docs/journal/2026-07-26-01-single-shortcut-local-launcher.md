# 2026-07-26 - Single-Shortcut Local Launcher

## Completed

- Added ADR 0006, allowing only an explicit user-invoked Kitty launcher mapping
  to prepare the current tab with `splits`; the plugin and broker retain their
  layout-mutation prohibition.
- Added the single-shortcut local-launcher plan and user setup/rollback
  documentation.
- Replaced the local temporary `Ctrl+Shift+F11` and `Ctrl+Shift+F12` mappings
  with `Ctrl+Shift+O`, which combines `goto_layout splits` with the restricted
  background broker launch.
- Built and globally linked the local package with `npm link`; the resolved
  broker command targets this checkout's built broker entry point.
- Parsed and reloaded the local Kitty configuration without enabling global
  remote control or changing the broker allowlist.

## Decisions

- Retain exactly `ls`, `launch`, `focus-window`, and `close-window` as the
  background broker's authorized Kitty commands.
- Treat the one-key mapping as local V1 setup only. It does not establish
  release readiness while broader Phase 5 lifecycle scenarios remain untested.

## Verification

- `bun run check` passed: all TypeScript checks, 169 tests with 493 assertions,
  and the production build.
- `git diff --check` passed.
- The installed `opencode-kitty-agents-broker` command resolved to the built
  local checkout.
- Kitty parsed the updated configuration successfully before reload.

## Risks Or Blockers

- The shortcut itself has not yet been used for a fresh desktop scenario after
  the configuration change.
- Close-means-close, moved-window, deletion, immediate-exit, shutdown, and
  Kitty-capability-loss scenarios remain outstanding Phase 5 gates.

## Files

- `README.md`
- `docs/decisions/0006-user-invoked-layout-preparation.md`
- `docs/plans/single-shortcut-launcher.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/handover/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-26-01-single-shortcut-local-launcher.md`
- `~/.config/kitty/kitty.conf`

## Next Step

With explicit approval for a visible desktop test, invoke `Ctrl+Shift+O` from
this repository in a separate Kitty terminal and first verify close-means-close
for one newly created child before broader lifecycle scenarios.
