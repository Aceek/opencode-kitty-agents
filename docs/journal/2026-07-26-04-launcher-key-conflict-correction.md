# 2026-07-26 - Launcher Key Conflict Correction

## Completed

- Found that Kitty already binds `Ctrl+Shift+O` to `pass_selection_to_program`.
- Reassigned the one-key launcher to `Ctrl+Shift+F12`, retaining the familiar
  existing verification key while removing the separate F11 layout step.
- Preserved the corrected `|` `combine` delimiter and restricted broker launch.

## Decisions

- Use `Ctrl+Shift+F12` as the single local V1 launcher shortcut. It avoids the
  default Kitty key collision and does not require an additional layout key.

## Verification

- The final mapping will be resolved through Kitty's nested action parser before
  reload, including its `combine` actions.

## Risks Or Blockers

- A visible launch remains required to validate the full desktop path.

## Files

- `README.md`
- `docs/decisions/0006-user-invoked-layout-preparation.md`
- `docs/plans/single-shortcut-launcher.md`
- `docs/handover/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-26-04-launcher-key-conflict-correction.md`
- `~/.config/kitty/kitty.conf`

## Next Step

Parse and reload the `Ctrl+Shift+F12` mapping, then test it in a separate Kitty
terminal from the repository directory.
