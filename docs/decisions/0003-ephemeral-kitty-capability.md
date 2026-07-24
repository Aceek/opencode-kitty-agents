# ADR 0003: Use An Ephemeral Kitty Capability

Status: Accepted with implementation gate

Date: 2026-07-24

## Context

Global Kitty remote control broadens the attack surface. Direct
controlling-terminal transport is unavailable from the observed OpenCode plugin
runtime because it has no `/dev/tty`.

Kitty can provide a dedicated socketpair/FD through a trusted
`launch --allow-remote-control` window. This capability can be inherited by
OpenCode without creating a global filesystem or TCP listener.

## Decision

Use the inherited ephemeral Kitty capability for V1. Keep global remote control
disabled. Restrict authorized commands to the final minimum required by the
adapter.

Before implementation proceeds beyond a probe, verify that the descriptor is
preserved into the real OpenCode server-plugin runtime.

## Consequences

- Users need a documented trusted Kitty launch mapping or wrapper.
- An ordinary already-running OpenCode process cannot retroactively gain the
  capability.
- Plugin availability must degrade cleanly when capability metadata is absent.
- If descriptor inheritance fails, a minimal capability-owning helper may be
  considered through a new ADR.
- Global `allow_remote_control yes`, TCP listeners, and unconditional Unix
  sockets are explicitly rejected.
