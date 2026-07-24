# OpenCode Kitty Agents

An OpenCode server plugin that presents child agent sessions in managed Kitty
splits by attaching a second OpenCode TUI to each existing child session.

## Status

Architecture and feasibility phase complete. The repository currently exports a
no-op plugin scaffold. V1 implementation has not started.

The verified target environment is:

- OpenCode and `@opencode-ai/plugin` 1.18.4
- Kitty 0.47.4
- Bun 1.2 or newer

## Design

The plugin will observe OpenCode child sessions, maintain reconciled lifecycle
state, and delegate visual presentation to a backend-neutral adapter. V1 will
implement only Kitty.

```text
OpenCode events and SDK snapshots
              |
              v
       Session controller
              |
              v
    PresentationAdapter contract
              |
              v
       Kitty remote control
              |
              v
 opencode attach <url> --session <id>
```

The plugin does not create another agent. It opens another OpenCode client for
the child session that already exists.

## Security Direction

V1 will keep global Kitty remote control disabled. OpenCode must be launched
through a trusted Kitty window with a capability-scoped remote-control channel.
The exact launch configuration remains an integration-test gate and will be
documented only after it is proven end to end.

## Development

```bash
bun install
bun run check
```

Start with:

- [`docs/handover/v1-implementation.md`](docs/handover/v1-implementation.md)
- [`docs/plans/v1-implementation.md`](docs/plans/v1-implementation.md)
- [`docs/journal/README.md`](docs/journal/README.md)

## Scope Boundaries

- No OpenCode TUI panel in this repository.
- No Hyprland, tmux, or WezTerm backend in V1.
- No global Kitty control socket.
- No destructive OpenCode session management.
- No direct reuse of oh-my-openagent internals.

## License

MIT
