# Single-Shortcut Local Launcher

## Goal

Replace the temporary two-key Kitty verification flow with a local, explicit
launcher that starts an OpenCode orchestrator and presents its eligible child
sessions through the existing private broker.

## Preconditions

- Build and validate the package with `bun run check`.
- Register the local package's broker binary with `npm link`; this does not
  publish the package.
- Keep Kitty global remote control disabled.
- Start from a Kitty tab whose layout may be changed by the user-invoked
  launcher to `splits`.

## Implementation

1. Keep the broker command allowlist unchanged: `ls`, `launch`,
   `focus-window`, and `close-window` only.
2. Replace the temporary `Ctrl+Shift+F11` and `Ctrl+Shift+F12` mappings with
   one `Ctrl+Shift+F12` `combine` mapping. Use `|` as its delimiter because the
   broker's explicit `PATH` contains `:`. It selects `splits` and launches the
   package-owned broker as a Kitty background process.
3. Point the mapping to the locally linked `opencode-kitty-agents-broker`
   executable, rather than a repository `dist` file. Give that background
   process an explicit minimal `PATH` containing the Bun installation, because
   the linked entry uses `#!/usr/bin/env bun`.
4. Reload Kitty after its configuration parses successfully.
5. Document installation, the shortcut, limitations, rollback, and the fact
   that normal `opencode` startup does not acquire the broker capability.

## Validation

- `bun run check` and `git diff --check` must pass.
- Confirm the linked broker executable resolves and its package version is
  local; no package publication is performed.
- Reload the Kitty configuration. The desktop behavior test remains a separate
  Phase 5 gate: first validate close-means-close with a newly created child,
  then complete the remaining lifecycle scenarios before claiming release
  readiness.

## Rollback

Remove the one mapping from `~/.config/kitty/kitty.conf`, reload Kitty, and
start OpenCode normally. This removes presentation capability only; it never
deletes OpenCode sessions or changes the global Kitty remote-control setting.
