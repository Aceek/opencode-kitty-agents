# ADR 0006: Prepare `splits` in the Explicit User Launcher

Status: Accepted

Date: 2026-07-26

## Context

The V1 broker intentionally refuses to modify a Kitty tab layout. It requires
the source tab to already use `splits`, which made the temporary verification
flow require two shortcuts: one to select `splits`, then another to start the
broker.

The user requested one deliberate, easy-to-use launcher. Requiring global
Kitty remote control or an external terminal command would violate ADR 0004:
only a trusted Kitty `launch --type=background --allow-remote-control`
invocation can grant the private capability needed by the broker.

## Decision

Provide one **user-invoked Kitty mapping** which first runs
`goto_layout splits` and then launches the existing restricted background
broker. This is launcher configuration, not a broker or plugin operation.

The broker retains its existing check and still fails safely if the layout is
not `splits`. It never gains permission to mutate layouts. The mapping keeps
the exact existing command allowlist (`ls`, `launch`, `focus-window`, and
`close-window`) and global remote control remains disabled.

## Consequences

- The user deliberately accepts that invoking the launcher changes the current
  tab to `splits`.
- The two temporary F11/F12 mappings are replaced by one documented
  `Ctrl+Shift+F12` shortcut.
- After it validates the orchestrator and readies the private broker, the
  launcher closes the exact source terminal. A failed close leaves that terminal
  intact rather than failing the orchestrator startup.
- Starting a normal, already-running `opencode` process remains unsupported:
  it cannot acquire the private Kitty capability retroactively.
- No new broker protocol operation, Kitty authorization, persisted capability,
  or broker-owned/background layout mutation is introduced.
