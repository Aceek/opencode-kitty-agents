# 2026-07-24 - Feasibility Research

## Completed

- Inspected oh-my-openagent 4.19.0 to understand how it observes child sessions
  and attaches additional OpenCode clients through tmux.
- Verified that visualization is plugin infrastructure and does not require
  tmux instructions in agent prompts.
- Inspected installed OpenCode 1.18.4 plugin hooks, SDK session types, event
  delivery, attach CLI, and disposal behavior.
- Inspected Kitty 0.47.4 launch, targeting, focus, close, query, layout, and
  remote-control authorization capabilities.
- Ran a non-mutating Kitty query from the current plugin environment.

## Decisions

- Implement a fresh OpenCode plugin rather than extracting OmO internals.
- Use Kitty as the only V1 backend behind a narrow adapter.
- Keep the project separate from `opencode-harness-panel`.
- Keep global Kitty remote control disabled.
- Prefer an inherited ephemeral Kitty socketpair/FD capability.

## Verification

- OpenCode exposes the required session events and snapshots through public
  contracts.
- Kitty exposes exact-ID split creation and lifecycle commands.
- The current OpenCode process has no `/dev/tty`; direct terminal transport
  failed before sending a command to Kitty.
- The project remains feasible if Kitty's inherited capability reaches the
  server-plugin runtime, which is Gate 0 of implementation.

## Risks Or Blockers

- The inherited descriptor path is documented by Kitty but has not yet been
  proven end to end in this OpenCode launch path.
- OpenCode event hooks are concurrent and startup events can be missed.
- OpenCode's advertised server URL may not be externally reachable.

## Files

- `docs/research/feasibility.md`
- `docs/decisions/0001-separate-from-harness-panel.md`
- `docs/decisions/0002-kitty-v1-adapter-boundary.md`
- `docs/decisions/0003-ephemeral-kitty-capability.md`

## Next Step

Bootstrap the standalone repository and preserve the verified scope in project
instructions.
