# OpenCode Kitty Agents

An OpenCode server plugin designed to present child agent sessions in managed
Kitty splits by attaching a second OpenCode TUI to each eligible immediate
child of the active orchestrator root.

## Status

Gate 0 and V1 Phases 1-4 are complete. The package validates public
configuration and implements the strict broker protocol, private Unix transport,
bounded Kitty subprocess boundary, capability broker, and broker-backed Kitty
`PresentationAdapter`. The default enabled plugin tracks reconciled immediate
children of the active orchestrator root and presents them through the
broker-backed adapter. `enabled: false`
returns no hooks and creates no tracker, controller, timer, adapter, or broker
client resources. A focused Phase 5 live test confirmed startup opens the
orchestrator alone, with no historical children; two simultaneous live agents
opened exactly two readable, correctly positioned child splits. Broader
lifecycle scenarios and release readiness remain incomplete; a local
single-shortcut setup is documented below. That live test also
exposed the old delayed-replacement behavior when both splits were manually
closed; the corrected policy is close means close.

The verified target environment is:

- OpenCode and `@opencode-ai/plugin` 1.18.4
- Kitty 0.47.4
- Bun 1.2 or newer

## Design

The plugin observes OpenCode child sessions, maintains reconciled lifecycle
state, and delegates visual presentation to a backend-neutral adapter. V1
implements only Kitty.

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
      Capability broker
              |
              v
       Kitty remote control
              |
              v
 opencode attach <url> --session <id>
```

The runtime does not create another agent. It opens another OpenCode
client for the child session that already exists.

## Configuration

OpenCode passes plugin options through a plugin tuple:

```json
{
  "plugin": [
    [
      "opencode-kitty-agents",
      {
        "enabled": true,
        "splitDirection": "vertical",
        "childBias": 40,
        "reconciliationIntervalMs": 5000,
        "focusPolicy": "preserve"
      }
    ]
  ]
}
```

All fields are optional. Unknown fields and invalid values are rejected.

| Option | Default | Valid values |
| --- | --- | --- |
| `enabled` | `true` | Boolean |
| `splitDirection` | `"vertical"` | `"vertical"` or `"horizontal"` |
| `childBias` | `40` | Finite percentage from `1` through `99`; first child-region share |
| `reconciliationIntervalMs` | `5000` | Safe integer of at least `1000` milliseconds |
| `focusPolicy` | `"preserve"` | `"preserve"` or `"child"` |

The OpenCode executable is fixed when the trusted broker process is constructed;
it is never accepted in an `open` request. The broker executable has a default
of `/usr/bin/opencode` and a construction-time `--opencode-executable=...`
override. No executable, Kitty command, match expression, or environment map
crosses the broker IPC boundary.

`childBias` applies only to the first live child in the orchestrator tab: it is
placed beside the exact orchestrator in the configured split orientation. Later
children use an opposite-orientation balanced (`50`) subdivision within the
managed child area, selected deterministically from currently co-tabbed managed
window dimensions. The focused two-child placement scenario is live-validated;
broader placement and lifecycle scenarios remain to be exercised.

Both the orchestrator and attached clients run through `/usr/bin/env -i` with a
construction-time allowlist: terminal color metadata, `HOME`, `PATH`, locale,
the standard XDG directory variables, and path-only `OPENCODE_CONFIG` settings.
The orchestrator uses the invoking Kitty source window's current working
directory. Server passwords, Kitty descriptors/passwords, arbitrary variables,
and the broker's complete environment are not forwarded. Consequently,
password-protected OpenCode attach flows are not supported by this Phase 2
environment path; a future verified credential mechanism must not place secrets
in argv or IPC.

## Security Direction

V1 keeps global Kitty remote control disabled. Gate 0 proved the accepted ADR
0004 background capability-broker path, and Phase 2 implements that production
boundary. The broker owns the inherited descriptor, preserves its FD explicitly
for bounded `kitten` subprocesses, and uses only `ls`, `launch`, `focus-window`,
and `close-window` with `--use-password=never`. The local V1 launch mapping and
user setup are documented below; end-to-end release readiness remains
incomplete.

Existence reconciliation uses a full non-mutating Kitty `ls` snapshot because a
managed window can be moved out of the origin tab and exact missing-window
matches fail as commands. Only numeric IDs are retained from that response;
raw Kitty state is never logged. Launch recovery also runs after runner
rejection or timeout, and shutdown uses one global deadline with at most one
active close subprocess.

IPC uses a shared 60-second client/server timeout derived from the worst-case
five-command Kitty operation budget: five bounded 10-second subprocesses plus
scheduling and transport margins. The controller issues one operation at a
time; the broker server also rejects overlapping requests rather than allowing
queue wait to consume that budget.

Adapter disposal stops accepting new operations, waits for already-started
requests within that shared bounded transport budget, and only then sends one
idempotent shutdown request. Thus an `open` that wins a disposal race is first
registered by the broker and is subsequently included in broker cleanup.

## Session Tracker

The Phase 3 tracker normalizes the public OpenCode 1.18.4
`session.created`, `session.deleted`, and `session.status` events. Per ADR 0005,
only immediate children whose `parentID` exactly equals the active orchestrator
root are eligible. Hook mutations use one serialized queue because OpenCode
does not await event hooks. Startup and periodic reconciliation call
`client.session.list()` and `client.session.status()`, but historical snapshots
publish no children until a live public event identifies the active root. The
tracker never guesses a root from list recency.

A live root creation selects its own ID, and a live child creation selects its
`parentID`. A creation below a known or pending immediate child is a nested
descendant, not a root-selection signal. An unknown live status candidate selects scope only when an
authoritative list resolves that exact session as a root with no `parentID`;
status from an unknown child never selects its parent or exposes its siblings.

Root selection remains pending until successful list and status snapshots
atomically commit the new active root and complete filtered membership.
Presentation eligibility adds a second gate within that root: the plugin must
either have observed the child's
explicit live creation during this runtime, or a successful authoritative status
snapshot must currently report that child as `busy` or `retry`. This prevents a
selected old root's historical idle children from mass-opening.

Once admitted, a child remains eligible through later idle or missing status
until deletion or committed root switch. Explicit child eligibility remains
pending by candidate root until reconciliation, preserving a child that is
created and completes before its first snapshot. Eligibility never crosses from
a foreign or prior root. Root, eligibility, membership, and status commit
atomically only after both list and status snapshots succeed. List/status
failure leaves valid current membership intact; a successful status snapshot
may still update current children when list fails. A successful switch removes
old-root children so the controller closes their splits. Active-root deletion
still clears scope immediately from its complete event payload.

An idle child whose creation and active lifetime both predate plugin startup is
intentionally not presented unless it later has a live creation event or an
authoritative non-idle status.

Reconciliation also carries a request-time scope generation. Deleting the
active or pending root, or a child whose exact `parentID` matches that root,
synchronously invalidates in-flight list/status results before the serialized
deletion mutation runs, so stale data cannot transiently open the child. Foreign
child deletion does not invalidate current scope. A different explicit root
creation invalidates stale scope work as well, while duplicate creation for the
already expected root does not repeatedly restart reconciliation. All actual
tracker map mutations remain serialized.

Valid status for an ID not currently tracked as an active child also
conservatively invalidates in-flight scope work before its serialized resolution
runs. The event does not select a root by itself: a later authoritative list
must still resolve that exact ID as a root. Status updates for known active
children do not invalidate reconciliation.

The plugin hook synchronously rejects every event type except those three before
calling the tracker. Unrelated high-volume events therefore allocate no tracker
queue work.

The backend-neutral tracker contract is `SessionTracker.snapshot()` plus
`SessionTracker.subscribe(listener)`. Snapshots contain a revision and a sorted,
immutable array of normalized `ChildSession` values. The tracker makes no
`PresentationAdapter` calls; the separate Phase 4 controller subscribes to this
contract. Hook and SDK failures are contained without logging SDK errors, and
disposal stops periodic work, rejects new mutations, and drains accepted work
under a fixed bound.

Reconciliation requests are coalesced: at most one reconciliation is queued or
active, so repeated timer ticks and duplicate event requests cannot accumulate
SDK work. Each list and status request has an independent 10-second deadline and
receives a real `AbortSignal` through the OpenCode SDK's top-level `{ signal }`
request option. Disposal aborts active requests immediately, and the tracker
also races its own deadline so a noncompliant client cannot block forever.
Subscriber callbacks are observational: synchronous throws and asynchronous
rejections are contained without delaying mutation or other subscribers.

## Presentation Controller

The controller serializes all adapter mutations and coalesces tracker snapshots
and periodic maintenance. Immediately before each launch it reads the live
`ctx.serverUrl` getter, rejects credential-bearing or non-HTTP URLs, and probes
`/global/health` with a credential-free GET and a two-second `AbortSignal`
deadline covering both fetch and JSON parsing. A successful probe requires the
OpenCode 1.18.4 shape `{ "healthy": true, "version": "<non-empty>" }`; a generic
2xx or malformed body is unavailable. The exact captured URL, child directory,
and child session ID then cross the existing strict broker protocol. Focus
remains on the orchestrator by default; `focusPolicy: "child"` is passed through
explicitly when configured.

Unavailable servers, layouts, brokers, and failed opens retry at most once per
configured reconciliation interval. Managed numeric window IDs are polled at
that interval; event snapshot traffic cannot accelerate existence checks. Once
a successful presentation is later absent, **close means close**: the controller
clears its handle, records `window-closed`, and does not reopen it for that child
membership lifetime. This intentionally treats manual closure and immediate
attach-client exit identically. Authoritative membership removal followed by a
later re-add creates a fresh lifetime that may open normally. An `exists()`
failure retains its handle and continues periodic probing. Controller snapshots
report `desired: "closed"` for this suppressed state and `desired: "open"`
otherwise. The deprecated `manualReopenAttempts` snapshot field remains at `0`
for source compatibility.

Disposal is idempotent and uses one absolute 65-second controller deadline
across queue drain, serial known-handle cleanup, and adapter disposal. Adapter
disposal is always invoked, but if the global deadline has expired the
controller returns while the already-contained adapter/broker cleanup continues
best effort under its own bounds. Session deletion and every cleanup path only
close presentation handles; they never delete an OpenCode session.

## Local Launcher (Current User Setup)

The package is not published. To use this checkout locally, install its broker
binary without publishing anything:

```bash
cd /home/aceek/projects/opencode-kitty-agents
bun install
bun run check
npm link
```

Add this one mapping to `~/.config/kitty/kitty.conf`, using the executable path
printed by `command -v opencode-kitty-agents-broker` after the local link:

```conf
map ctrl+shift+f12 combine | goto_layout splits | launch --type=background --env=PATH=/home/aceek/.bun/bin:/usr/local/bin:/usr/bin:/bin --allow-remote-control --remote-control-password '!' --remote-control-password '"" ls launch focus-window close-window' /home/aceek/.npm-global/bin/opencode-kitty-agents-broker @active-kitty-window-id
```

Reload Kitty after the edit:

```bash
kill -USR1 "$KITTY_PID"
```

From a Kitty tab in the project directory, press **Ctrl+Shift+F12**. The shortcut
deliberately changes that tab to `splits`, starts the OpenCode orchestrator,
then closes the source terminal after the orchestrator is validated and the
broker is ready. It permits the plugin to present eligible immediate child
sessions. A normal `opencode` command cannot acquire this private Kitty
capability after startup.

The mapping grants no global remote control. The background broker receives a
window-local capability restricted to `ls`, `launch`, `focus-window`, and
`close-window`; child agent windows never receive it. To roll back, remove the
mapping and reload Kitty. This affects presentation only and never deletes an
OpenCode session.

The explicit `PATH` is only for the background broker process: the linked entry
uses `#!/usr/bin/env bun`, and a desktop-started Kitty server may not otherwise
have Bun in its path. Keep the listed path minimal and adjust only the Bun
directory if your installation differs.

The focused two-child placement gate passed, but broader Phase 5 lifecycle
scenarios remain outstanding. Treat this as a local V1 setup, not a published
release guarantee.

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
