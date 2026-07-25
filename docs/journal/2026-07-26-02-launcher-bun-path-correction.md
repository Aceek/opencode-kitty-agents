# 2026-07-26 - Launcher Bun Path Correction

## Completed

- Identified that the locally linked broker entry uses `#!/usr/bin/env bun`.
- Confirmed that a minimal desktop-like path without Bun fails before broker
  startup, so an otherwise valid Kitty mapping can appear to do nothing.
- Added an explicit minimal `PATH` only to the background broker launch. It
  contains the local Bun directory plus standard executable directories.
- Parsed and reloaded the updated Kitty configuration.

## Decisions

- Keep the mapping pointed at the locally linked package executable rather than
  a repository `dist` path.
- Scope the Bun path override to the background broker process. The broker's
  existing explicit environment allowlist remains responsible for OpenCode
  child-process environments.

## Verification

- The Kitty parser accepted the revised mapping.
- Invoking the linked broker with the configured minimal path reached broker
  argument validation, rather than failing to locate Bun.

## Risks Or Blockers

- This validates process startup prerequisites, not a visible desktop launch.
- Broader Phase 5 lifecycle validation remains outstanding.

## Files

- `README.md`
- `docs/plans/single-shortcut-launcher.md`
- `docs/handover/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-26-02-launcher-bun-path-correction.md`
- `~/.config/kitty/kitty.conf`

## Next Step

Use `Ctrl+Shift+O` in a separate Kitty terminal from the repository directory.
If the orchestrator does not appear, collect only the broker process exit code
and non-sensitive Kitty configuration errors before changing permissions.
