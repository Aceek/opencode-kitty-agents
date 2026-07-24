# ADR 0002: Kitty V1 Behind A Presentation Adapter

Status: Accepted

Date: 2026-07-24

## Context

The initial environment uses Kitty under Hyprland. Kitty has stronger and more
deterministic split lifecycle APIs than compositor-level OS-window management.
Future environments may require other presentation mechanisms.

## Decision

Implement Kitty as the only V1 backend behind a narrow
`PresentationAdapter`. Do not implement a generic backend registry or any
additional backend until a concrete requirement exists.

## Consequences

- V1 remains small and testable.
- Session tracking does not depend on Kitty commands.
- Future backends can reuse lifecycle policy without copying it.
- The first adapter contract may be refined by real Kitty implementation needs.
