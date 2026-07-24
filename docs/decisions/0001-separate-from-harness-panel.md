# ADR 0001: Keep Presentation Separate From The Harness Panel

Status: Accepted

Date: 2026-07-24

## Context

`opencode-harness-panel` is a TUI observer for session and harness metadata.
This project launches and manages external terminal presentations, requiring
process control, platform checks, and cleanup.

## Decision

Maintain two independent repositories and packages. Neither package depends on
the other in V1.

If optional integration is justified later, use a small versioned and
non-sensitive state contract. The panel must continue to work when this plugin
is absent, and this plugin must continue to work without the panel.

## Consequences

- The panel remains terminal-agnostic and low privilege.
- This plugin can evolve presentation backends independently.
- Session metadata may be discovered independently by both plugins.
- Cross-project focus or close actions are deferred until a concrete need
  justifies an integration protocol.
