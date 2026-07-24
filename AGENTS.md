# Repository Guide

## Purpose

This repository provides an OpenCode server plugin that presents child agent
sessions in managed Kitty splits. It is independent from any OpenCode TUI panel
and must remain useful without one.

## Sources Of Truth

- Treat the installed OpenCode public plugin and SDK types as authoritative.
- Treat Kitty's installed CLI help and upstream remote-control implementation as
  authoritative.
- Revalidate undocumented behavior with focused integration tests.
- Read `docs/handover/v1-implementation.md` before starting V1 implementation.
- Read all entries in `docs/journal/` before resuming interrupted work.

## Architecture Rules

- Keep OpenCode session tracking independent from terminal presentation.
- Access Kitty only through a `PresentationAdapter` boundary.
- Implement Kitty for V1; do not implement speculative Hyprland, tmux, or
  WezTerm backends.
- Use Kitty numeric window IDs for all lifecycle operations. Never target the
  active window, recent window, title, or tab index.
- Run child processes with argv arrays. Never build shell command strings.
- Serialize event mutations because OpenCode does not await plugin event hooks.
- Reconcile events against SDK snapshots; events alone are not lossless during
  plugin startup.
- Make cleanup idempotent, bounded, and safe when windows were closed manually.
- Never persist server passwords, public keys, socket capabilities, resolved
  credentials, complete environments, or sensitive command arguments.

## Security Boundary

- Keep global Kitty remote control disabled.
- V1 uses a Kitty-provided ephemeral socketpair/FD capability inherited from a
  trusted `launch --allow-remote-control` invocation.
- Restrict authorization to the minimum commands required by the final design.
- Do not copy the full parent environment into child windows.
- Do not expose destructive OpenCode session deletion as part of V1.

## Development Workflow

- Update the journal at every major completed step and before handing work off.
- Journal facts and verification results, not intentions.
- Add an ADR under `docs/decisions/` before reversing an accepted architectural
  decision.
- Add tests for state transitions, reconciliation, argv construction, adapter
  failures, manual closure, and cleanup.
- Run `bun run check` before considering a change complete.
- Do not publish to npm, create releases, or broaden compatibility claims
  without explicit approval.

## Documentation Map

- `docs/research/feasibility.md`: verified capabilities and remaining gate.
- `docs/architecture/v1.md`: target design and contracts.
- `docs/decisions/`: accepted architectural decisions.
- `docs/plans/v1-implementation.md`: ordered implementation plan.
- `docs/handover/v1-implementation.md`: implementation handover.
- `docs/journal/`: append-only development history.
