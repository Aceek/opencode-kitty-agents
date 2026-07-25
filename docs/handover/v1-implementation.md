# V1 Implementation Handover

Date: 2026-07-25

## Resume This Orchestration

- OpenCode session: `ses_06c8943b6ffe6IyyU43H5vr3nY`
- Session title: `V1 Implementation Handover`
- Workspace: `/home/aceek/projects/opencode-kitty-agents`
- Resume command:

```bash
opencode "/home/aceek/projects/opencode-kitty-agents" --session "ses_06c8943b6ffe6IyyU43H5vr3nY"
```

The central machine-level handover is also recorded in
`/home/aceek/projects/OPENCODE_HANDOVER.md` under the same session ID.

## Mission And Product Vision

Implement the first production-quality version of `opencode-kitty-agents`.
The plugin observes relevant OpenCode child sessions and presents them in
managed Kitty splits by running:

```text
opencode attach <server-url> --dir <directory> --session <session-id>
```

The plugin must remain independent from `opencode-harness-panel`. It does not
create agents, inject instructions, orchestrate tasks, or delete OpenCode
sessions. OpenCode session tracking stays backend-neutral; Kitty access remains
behind `PresentationAdapter` and the accepted capability broker.

The intended user experience is:

1. launch an orchestrator through a trusted Kitty mapping;
2. keep focus on that orchestrator by default;
3. automatically show only its relevant live child agents in readable splits;
4. reconcile missed events and manually closed windows safely;
5. close only plugin-managed windows during session removal or shutdown.

## Mandatory Reading Order

Before changing code:

1. `AGENTS.md`
2. `docs/journal/README.md`
3. every dated file in `docs/journal/`, including the 2026-07-24 corrections and
   `2026-07-25-01-orchestration-handover.md`
4. `docs/research/feasibility.md`
5. all files in `docs/decisions/`, especially ADR 0004 and ADR 0005
6. `docs/architecture/v1.md`
7. `docs/plans/v1-implementation.md`
8. this handover again

Treat installed OpenCode/plugin/SDK 1.18.4 types and Kitty 0.47.4 behavior as
authoritative. Revalidate undocumented assumptions with focused tests.

## Non-Negotiable Constraints

- Keep global Kitty remote control disabled.
- Do not add a TCP capability listener or unconditional global Unix socket.
- Use only public OpenCode plugin and SDK contracts.
- Run processes with argv arrays, never shell command strings.
- Use exact positive numeric Kitty window IDs for lifecycle operations.
- Never target active/recent windows, titles, tab indexes, or negative IDs.
- Serialize event/controller mutations; OpenCode does not await event hooks.
- Reconcile events against SDK snapshots; startup events are not lossless.
- Keep cleanup bounded, idempotent, and safe after manual closure.
- Never persist or log the Kitty FD address, broker endpoint, public keys,
  passwords, credentials, raw environments, raw Kitty JSON, or sensitive argv.
- Never delete an OpenCode session as presentation cleanup.
- Do not couple this project to the harness panel.
- Do not publish, tag, release, or broaden compatibility claims without explicit
  approval.

## Current Repository And Git State

- Branch: `main`
- Core V1 implementation checkpoint: `3b04844`
  (`feat: implement secure Kitty agent presentation`)
- The subsequent journal and handover checkpoint records the verified Phase 5
  active-root rerun and nested-child scope correction.
- No commit has been pushed. Do not discard, reset, clean, or overwrite later
  worktree changes.

Use `git status --short` immediately after resuming and preserve every existing
change. The repository guide requires a full diff review before any future
commit. Commit/push only if explicitly requested.

## Verified Environment

- OpenCode and `@opencode-ai/plugin`: 1.18.4
- Kitty: 0.47.4
- Bun observed during tests: 1.3.14; package minimum remains 1.2
- Latest completed check: 158 tests, 455 assertions, all source/test/Gate 0
  TypeScript checks, and production build passed.
- Latest `git diff --check`: passed.
- No production broker process was active at the 2026-07-25 handoff.

## Architecture Now Implemented

### OpenCode Plugin Module

`src/index.ts` uses the OpenCode 1.18.4 public `PluginModule` form:

```ts
export default {
  id: "opencode-kitty-agents",
  server: plugin,
}
```

Do not revert this to a legacy default function while named runtime exports
remain. A live run proved that the legacy form caused OpenCode to inspect every
named export and fail with `Plugin export is not a function`.

The disabled configuration path constructs no tracker, controller, timer,
adapter, endpoint, or broker resource. Tests inject fake adapters so unit tests
cannot discover and shut down a real inherited broker.

### Session Tracker

`src/session/tracker.ts`:

- normalizes `session.created`, `session.deleted`, and `session.status`;
- uses `client.session.list({ signal })` for membership authority;
- uses `client.session.status({ signal })` for status authority;
- coalesces reconciliation so timer/event floods cannot grow an unbounded queue;
- applies SDK deadlines and `AbortSignal` despite SDK requests having no default
  timeout;
- contains synchronous and asynchronous subscriber failures;
- stops timers, aborts SDK calls, prevents late commits, and disposes boundedly.

ADR 0005 changed the membership policy after live testing exposed a severe
historical mass-open bug. V1 now uses one active orchestrator root:

- historical list recency never selects a root;
- an explicit root `session.created`, child `session.created` parent, or
  authoritative root-shaped unknown status may establish pending root intent;
- a creation below a known or pending immediate child is not a root candidate;
- unknown child status never derives a parent root;
- root replacement waits for successful list/status authority;
- only immediate children with exact `parentID === activeRootID` qualify;
- a child is presentation-eligible only if its live `session.created` was seen
  during this runtime or a successful status snapshot reports `busy`/`retry`;
- admitted eligibility remains sticky when the child later becomes idle, until
  deletion or root switch;
- wholly historical idle children remain intentionally excluded;
- root/child deletion, different root creation, and unknown status switch signals
  synchronously advance a scalar generation so stale SDK results cannot briefly
  publish obsolete children;
- actual maps remain owned by the serialized mutation queue.

Do not simplify this back to “all sessions with parentID”. That exact behavior
opened dozens of historical child splits in the live desktop test.

### Presentation Controller

`src/controller.ts` subscribes to immutable tracker snapshots and owns desired
presentation state. It:

- serializes opens, existence checks, closes, retries, and snapshot application;
- coalesces duplicate revisions and periodic maintenance;
- reads the live `ctx.serverUrl` for every open attempt;
- rejects credential-bearing URLs;
- probes `/global/health` immediately before opening;
- requires HTTP success and the OpenCode JSON shape containing
  `healthy: true` plus a non-empty version;
- omits credentials, rejects redirects, and bounds fetch/body parsing with one
  abort deadline;
- retries ordinary unavailability at the configured interval;
- polls exact managed IDs for manual closure;
- permits one delayed automatic replacement after manual closure/immediate exit,
  then stops to avoid reopen loops;
- handles deletion while open is pending and closes stale returned handles;
- uses one global disposal deadline, stops new work, aborts health requests,
  clears state, best-effort closes known handles, and invokes adapter shutdown;
- prevents late timed-out snapshot work from repopulating state.

### Presentation Adapter And Broker Client

`src/presentation/kitty/adapter.ts` and `client.ts` communicate with the broker
through a strict newline-delimited JSON protocol. Allowed operations are only:

```text
availability open exists focus close shutdown
```

The protocol accepts normalized session/URL/config values, never arbitrary
Kitty commands, match expressions, executable argv, or environment maps.
Endpoint path and permissions are validated under the owning user's
`XDG_RUNTIME_DIR`.

The adapter tracks in-flight requests. Disposal rejects new work, waits for
already-started bounded requests, then sends exactly one shutdown request so a
racing successful open is still broker-managed before cleanup.

### Capability Broker

ADR 0004 superseded direct plugin ownership of the Kitty capability. Kitty
0.47.4 creates the private socketpair only for
`launch --type=background --allow-remote-control`, not an interactive window.

`src/broker/` implements:

- private random owner-only Unix endpoint under `XDG_RUNTIME_DIR`;
- inherited `KITTY_LISTEN_ON=fd:N` validation;
- explicit same-number FD propagation to every `kitten` subprocess;
- minimal Kitty subprocess environment;
- bounded timeout/buffer process runner;
- strict one-request-in-flight server;
- exact-ID Kitty commands with `--use-password=never`;
- `splits` layout validation without automatic layout mutation;
- exact returned-window-ID parsing and same-tab verification;
- broker-owned recovery markers and conservative pre/post snapshots for launch
  failures, malformed output, and timeouts;
- full non-mutating `ls` only when required to find a managed window moved to
  another tab; raw output is parsed minimally and discarded;
- exact-ID focus and idempotent `close-window --ignore-no-match`;
- globally bounded shutdown with contained leftover operations;
- signal-safe startup abort and orchestrator cleanup.

OpenCode processes run through `/usr/bin/env -i` with a fixed construction-time
allowlist. IPC cannot supply environment values or executable commands.

The broker starts the interactive orchestrator with explicit `--port=0`.
This is essential: OpenCode 1.18.4 otherwise uses
`http://opencode.internal` and worker fetch, which an external
`opencode attach` process cannot reach. Explicit port zero opens a random
loopback listener while avoiding a persistent fixed port.

## Completed Gates And Phases

### Gate 0: Passed

The test-only implementation under `test/gate0/` proved live:

- background broker inherited the Kitty FD capability;
- an actual OpenCode server plugin reached it through private IPC;
- the broker queried the exact origin;
- launched a harmless split;
- captured and verified its positive numeric ID in the same tab;
- closed the split and test OpenCode window idempotently;
- left unrelated windows untouched;
- exposed only sanitized boolean result fields.

### Phase 1: Complete

- validated public configuration;
- normalized session/presentation types;
- minimal `PresentationAdapter` contract;
- defaults and validation tests.

### Phase 2: Complete In Code And Unit Tests

- broker protocol, runner, endpoint, server, Kitty argv/parser/core;
- broker client and Kitty adapter;
- capability checks, layout detection, launch recovery, manual closure/move,
  cleanup and timeout coverage;
- multiple independent review/fix cycles.

### Phase 3: Complete In Code And Unit Tests

- event normalization, serialized/coalesced tracker, SDK authority, status idle
  inference, periodic reconciliation, deadlines, disposal;
- ADR 0005 active-root/live-child eligibility corrections and generation races;
- extensive tracker/controller regressions.

### Phase 4: Complete In Code And Unit Tests

- tracker/controller/adapter/plugin integration;
- health/retry/existence/manual-close/disposal behavior;
- event flood filtering before tracker queue allocation;
- plugin dependency injection for safe tests;
- independent review finished with no unresolved high/medium finding before the
  later ADR 0005 live-scope correction sequence.

### Phase 5: In Progress, Active-Root Scope Verified

The production broker successfully opened a real OpenCode TUI in a separate
Kitty terminal. A real prompt launched two agents, and their attached views were
visible. However, startup reconciliation also opened many historical project
children, creating dozens of narrow unreadable splits. The screenshot showed
two readable current agent views plus historical strips; these were not duplicate
windows for the two agents.

That failure produced ADR 0005 and journals 19–24. A focused rerun from the
repository working directory then opened exactly two newly created child
presentations and no historical children. A first manual closure received the
intended bounded replacement. The three-column arrangement was too narrow to
accept as a readable multi-child layout, so Phase 5 remains in progress at the
placement-design follow-up. See journal `2026-07-25-02-phase-5-active-root-live-rerun.md`.

## Temporary Kitty Test Configuration

The following temporary mappings still exist in
`/home/aceek/.config/kitty/kitty.conf`:

```conf
map ctrl+shift+f11 goto_layout splits
map ctrl+shift+f12 launch --type=background --allow-remote-control --remote-control-password '!' --remote-control-password '"" ls launch focus-window close-window' /home/aceek/.bun/bin/bun /home/aceek/projects/opencode-kitty-agents/dist/broker/main.js @active-kitty-window-id
```

They are test setup, not final documented production configuration. Global
remote control remains disabled. Do not broaden the allowlist. Keep the `!`
policy that disables global password fallthrough.

The user explicitly used a separate Kitty terminal/window for live testing.
Coordinate before causing visible desktop changes. Remove both mappings and
reload Kitty after Phase 5 is complete, then record the removal.

At handoff, no process matching the production broker path was active. Do not
kill OpenCode processes in bulk; several unrelated instances may exist. For test
cleanup, identify only broker processes by the exact repository broker path and
send SIGTERM so their `finally` cleanup targets broker-owned numeric IDs.

## Exact Next Action

Do not continue broad desktop scenarios first. Design and test a deterministic,
readable multi-child placement policy without weakening exact-ID targeting or
the active-root scope. Then rerun this focused sequence:

1. Resume the recorded session and complete the mandatory reading order.
2. Run:

   ```bash
   git status --short
   git diff --check
   bun run check
   ```

   Confirm the expected 161 tests/460 assertions or investigate any drift.
3. Confirm no broker is active:

   ```bash
   pgrep -a -f '/home/aceek/projects/opencode-kitty-agents/dist/broker/main.js'
   ```

   Be aware that `pgrep -f` may match its own command shell; inspect output.
4. In a user-approved separate Kitty terminal whose current directory is
   `/home/aceek/projects/opencode-kitty-agents`, select the `splits` layout with
   `Ctrl+Shift+F11`, then launch the production broker with `Ctrl+Shift+F12`.
5. Before creating agents, confirm that the orchestrator opens alone with **no
   historical narrow strips**.
6. Ask the new orchestrator to launch exactly two fresh sub-agents that perform
   harmless no-file work.
7. Confirm exactly two readable child splits appear, both attached to the
   correct sessions, and focus remains on the orchestrator.
8. If historical children reappear or placement is not readable, stop only the
   exact broker process, preserve non-sensitive evidence, journal it, and fix
   scope or placement before any other Phase 5 scenario.

Only after the focused two-child placement rerun passes should broader Phase 5
continue.

## Remaining Phase 5 Scenarios

Run each against IDs created by the test, with best-effort cleanup:

1. one synchronous and one background child attach to their exact sessions;
2. multiple children use a deterministic readable arrangement;
3. focus remains on the orchestrator under the default policy;
4. manually close one child and verify one delayed replacement only;
5. close it again and verify no reopen loop;
6. move a managed child to another tab and verify existence/cleanup tracking;
7. delete a child session through a test action outside the plugin and verify
   its window closes without deleting any other OpenCode session;
8. exercise an attached TUI that exits immediately;
9. stop the orchestrator and verify broker shutdown closes all managed child
   windows and the orchestrator, leaving unrelated Kitty windows unchanged;
10. exercise Kitty close/restart or capability loss and verify graceful
    degradation;
11. record exact sanitized outcomes and failures in a new journal entry.

Do not promise multi-child placement publicly until these tests pass.

## Phase 6 After Live Success

1. Replace provisional README status with verified implemented behavior.
2. Document the exact production Kitty mapping, security boundary, requirement
   for `splits`, startup flow, rollback, and troubleshooting.
3. Clearly document ADR 0005's intentional limitation for wholly historical idle
   children.
4. Document minimal-environment authentication limitations if live testing
   confirms any.
5. Remove temporary F11/F12 mappings, reload Kitty, and verify removal.
6. Inspect package contents and isolated consumer import.
7. Run a clean-install/check/tarball verification.
8. Perform a final independent security/lifecycle review of the complete diff.
9. Update handover/journal if anything remains.
10. Do not publish or tag without explicit approval.

## Important Files

- `src/index.ts` — PluginModule and runtime wiring.
- `src/config.ts` — public options/defaults/validation.
- `src/session/tracker.ts` — active-root scoped SDK/event authority.
- `src/controller.ts` — presentation lifecycle policy.
- `src/presentation/adapter.ts` — backend-neutral boundary.
- `src/presentation/kitty/adapter.ts` — broker-backed adapter.
- `src/presentation/kitty/client.ts` — bounded Unix IPC client.
- `src/broker/main.ts` — background capability owner/startup/cleanup.
- `src/broker/core.ts` — exact-ID broker lifecycle.
- `src/broker/kitty.ts` — argv, minimal env, Kitty parser and launch recovery.
- `src/broker/protocol.ts` — strict versioned IPC schema.
- `src/broker/runner.ts` — bounded process execution and FD mapping.
- `src/broker/server.ts` — private one-request server.
- `docs/decisions/0004-background-capability-broker.md` — transport decision.
- `docs/decisions/0005-active-orchestrator-root-scope.md` — relevance/scope
  decision after live mass-open.
- `test/gate0/` — test-only capability proof.
- `test/session-tracker.test.ts` and `test/controller.test.ts` — critical scope
  and race regressions.

## Known Risks And Intentional Limitations

- ADR 0005's active-root and live-child scope is validated by the focused live
  rerun; readable multi-child placement is not yet validated.
- An idle child created and completed before plugin startup is intentionally not
  presented unless it later emits live creation or appears non-idle. This avoids
  historical mass-open and must remain explicit.
- OpenCode's minimal environment relies primarily on config/auth files. Provider
  setups that require credential environment variables have not been broadly
  validated and must not be solved by copying the complete parent environment.
- Controller disposal is globally bounded; operations already beyond the
  deadline continue contained and best-effort while broker shutdown owns final
  cleanup.
- The broker allows one IPC operation at a time. Tracker/controller/adapter
  serialization and timeout budgets rely on that invariant.
- Multiple ordinary OpenCode processes may coexist. Process cleanup must target
  only the broker path and broker-owned window IDs.

## Useful Resume Commands

```bash
opencode "/home/aceek/projects/opencode-kitty-agents" --session "ses_06c8943b6ffe6IyyU43H5vr3nY"
git status --short
git diff --check
bun run check
pgrep -a -f '/home/aceek/projects/opencode-kitty-agents/dist/broker/main.js'
ss -ltnp
```

After an intentional Kitty configuration edit:

```bash
kill -USR1 "$KITTY_PID"
```

Do not print or persist endpoint/FD values while diagnosing. Presence checks are
acceptable; raw values are not.

## Stop And Escalate If

- the corrected scope still opens historical children;
- satisfying behavior appears to require global Kitty remote control;
- `--port=0` does not expose a reachable loopback attach server;
- broker capability or endpoint values would need to be persisted or logged;
- a required lifecycle cannot be implemented through public OpenCode/Kitty APIs;
- cleanup cannot be kept exact-ID, bounded, and safe for unrelated windows;
- unrelated concurrent changes overlap this dirty worktree.

Preserve exact non-sensitive evidence in a new journal entry before changing the
security or architecture model. Add a new ADR before reversing ADR 0004 or ADR
0005.
