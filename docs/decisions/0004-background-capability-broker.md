# ADR 0004: Launch Through A Background Capability Broker

Status: Accepted

Date: 2026-07-24

## Context

ADR 0003 assumed that Kitty would give an interactive window launched with
`launch --allow-remote-control` a dedicated socketpair descriptor. Kitty 0.47.4
only creates that descriptor for `launch --type=background`. Interactive
windows receive window-local remote control through their controlling terminal,
which is unavailable from the OpenCode server-plugin runtime.

The current runtime confirms the distinction: it has numeric Kitty process and
window metadata but no `KITTY_LISTEN_ON`, and an exact-window remote-control
query fails while opening `/dev/tty`.

Global remote control, a TCP listener, and an unconditional filesystem socket
remain outside the accepted security boundary.

## Decision

Add a small package-owned broker executable and start it from a trusted Kitty
mapping as a background process with window-local remote control:

```text
launch --type=background --allow-remote-control <restricted-policy> \
  opencode-kitty-agents-broker @active-kitty-window-id
```

The broker will:

1. Own the inherited `KITTY_LISTEN_ON` descriptor and never disclose its value.
2. Create a private, randomly named Unix socket under `XDG_RUNTIME_DIR` with
   same-user permissions and no persistent credentials.
3. Use exact-ID Kitty remote control to launch an interactive OpenCode window
   in the originating tab, passing only the broker endpoint in that window's
   environment.
4. Accept a narrow versioned protocol for availability, open, exists, focus,
   close, and shutdown operations.
5. Restrict all requests to the captured origin ID and numeric child IDs that
   the broker created.
6. Remove the endpoint and close managed windows on bounded shutdown. A missing
   window remains a successful cleanup result.

The Kitty `PresentationAdapter` will communicate with this broker rather than
invoking Kitty directly. Session tracking and controller policy remain
unchanged.

The initial Kitty command allowlist would contain only `ls`, `launch`,
`focus-window`, and `close-window`, with global password fallthrough disabled.
The exact mapping and protocol must be proven in a focused integration test
before documentation presents them as production setup.

## Security Requirements

- Keep global `allow_remote_control` disabled.
- Never place the inherited descriptor, Kitty public key, or resolved
  credentials in argv, IPC messages, logs, or persisted state.
- Do not accept arbitrary Kitty commands, match expressions, executables, or
  environment maps over IPC.
- Authenticate the local peer at least by same UID and an unguessable endpoint;
  bind the endpoint with owner-only permissions.
- Launch all processes with argv arrays and a minimal explicit environment.
- Treat broker disappearance as presentation unavailability, never as a reason
  to delete an OpenCode session.

## Alternatives Rejected

- Interactive `launch --allow-remote-control opencode`: no descriptor is
  created, and the server plugin has no controlling terminal.
- Global Unix or TCP remote control: broadens authority beyond the launched
  OpenCode instance.
- Running the OpenCode TUI as Kitty's background process: provides no terminal
  for the interactive client.
- Persisting or forwarding the Kitty descriptor through a named capability:
  unnecessarily exposes Kitty authority and does not solve descriptor transfer
  into a separately created window.

## Consequences

- V1 gains one small helper process and a private local protocol.
- Startup must use the trusted Kitty mapping; an existing OpenCode process
  cannot acquire presentation capability retroactively.
- Broker lifecycle, peer validation, protocol validation, and stale endpoint
  cleanup require focused tests.
- ADR 0003 remains valid in its security goal, while broker ownership supersedes
  its direct descriptor path.
