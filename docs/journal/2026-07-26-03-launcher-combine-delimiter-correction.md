# 2026-07-26 - Launcher Combine Delimiter Correction

## Completed

- Observed Kitty's runtime parse failure for the single-shortcut mapping.
- Identified that `combine : ...` treats every `:` as an action separator, so
  the explicit `PATH` value was split at `/usr/local/bin` and parsed as an
  invalid Kitty action.
- Changed the mapping to use `|` as the `combine` separator, preserving the
  colon-separated minimal `PATH` as one launch argument.

## Decisions

- Use `|` for this combined launcher mapping whenever an action argument can
  contain `:`.

## Verification

- Kitty upstream documents `|` as a supported `combine` separator.
- The corrected mapping will be parsed through Kitty's nested action resolver
  before it is reloaded.

## Risks Or Blockers

- The corrected shortcut still requires an explicit user desktop test.

## Files

- `README.md`
- `docs/plans/single-shortcut-launcher.md`
- `docs/handover/v1-implementation.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-26-03-launcher-combine-delimiter-correction.md`
- `~/.config/kitty/kitty.conf`

## Next Step

Parse and reload the corrected configuration, then test `Ctrl+Shift+O` from a
separate Kitty terminal in the repository directory.
