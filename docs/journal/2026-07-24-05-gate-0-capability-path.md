# 2026-07-24 - Gate 0 Capability Path

## Completed

- Revalidated Kitty 0.47.4 launch and remote-control descriptor behavior against
  the installed implementation and CLI help.
- Inspected the actual OpenCode server-plugin runtime without logging Kitty
  environment values.
- Ran a non-mutating exact-origin Kitty query from that runtime.
- Documented a proposed minimal background capability broker in ADR 0004.

## Decisions

- Stopped V1 implementation at Gate 0 because the accepted direct descriptor
  path cannot reach an interactive OpenCode server-plugin runtime.
- Did not enable global remote control, add a listener, modify Kitty
  configuration, or add temporary plugin behavior.
- Kept the broker design proposed rather than silently changing the accepted
  architecture.

## Verification

- Kitty's `launch.py` delegates `--type=background` to
  `run_background_process`; that path creates and inherits the socketpair and
  sets `KITTY_LISTEN_ON`.
- Kitty's ordinary window launch path does not supply a remote-control
  descriptor. Installed `kitten @ launch --help` documents the dedicated
  socketpair only for `--type=background`.
- The server-plugin runtime had `KITTY_PID` and `KITTY_WINDOW_ID` metadata but no
  `KITTY_LISTEN_ON`.
- `kitten @ --use-password=never ls` restricted to the exact origin ID failed
  before reaching Kitty with `open /dev/tty: no such device or address`.
- No Kitty window was launched, focused, closed, or otherwise changed.
- `bun run check` passed: TypeScript typecheck, one unit test, and production
  build.

## Risks Or Blockers

- ADR 0004 requires acceptance before a helper or alternate transport is
  implemented.
- The proposed broker's descriptor inheritance, private IPC, exact-ID launch,
  and cleanup still require a live end-to-end proof.
- The minimal OpenCode environment and executable launch flow need validation
  after the transport design is accepted.

## Files

- `docs/decisions/0004-background-capability-broker.md`
- `docs/journal/2026-07-24-05-gate-0-capability-path.md`
- `docs/journal/README.md`

## Next Step

Accept, revise, or reject ADR 0004. If accepted, implement only the smallest
test-only broker and mapping needed to rerun Gate 0 before starting Phase 1.
