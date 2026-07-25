# 2026-07-24 - Gate 0 Background Broker Probe

## Completed

- Marked ADR 0004 Accepted and implemented only its test-only Gate 0 path.
- Added a background broker that owns Kitty's inherited FD capability, creates
  an owner-only random Unix endpoint under `XDG_RUNTIME_DIR`, launches an
  OpenCode window with a separate server-plugin probe, and accepts one strict
  versioned request.
- Added exact-ID Kitty probes that query the OpenCode origin, launch
  `/usr/bin/sleep 30` in the same tab, verify both numeric IDs in that tab, and
  close the split with `--ignore-no-match` from a `finally` path.
- Added owner-only, sanitized result output and a command that reads it without
  exposing endpoints, descriptors, IDs, raw Kitty JSON, environments, argv, or
  credentials.
- Documented the exact test mapping and manual live-test procedure without
  modifying global Kitty configuration.

## Decisions

- Gate 0 allows only `ls`, `launch`, and `close-window`; focus is not required
  for this feasibility proof.
- Every `kitten` invocation uses an argv array, `--use-password=never`, and
  numeric ID match expressions.
- The OpenCode window receives the private endpoint and test plugin config
  additions; Kitty descriptor and password variables are removed.
- Bun subprocesses explicitly map the inherited FD to the same descriptor
  number through the extended `stdio` tuple instead of relying on default FD
  inheritance.
- The production plugin in `src/` remains unchanged; no tracker, adapter, daemon,
  panel, or compatibility layer was added.

## Verification

- `bun run check` passed: both TypeScript configurations, nine tests with 35
  assertions, and the production build.
- A focused Bun test opened a high descriptor and proved it remained readable
  at the same `/proc/self/fd/<n>` path in a spawned process.
- Kitty 0.47.4 parsed the documented mapping into a background launch with the
  exact blank-password restriction `ls launch close-window` and the active
  numeric window-ID placeholder.
- Pure tests cover strict request/result validation, numeric IDs, FD metadata,
  private endpoint shape, minimal Kitty tree parsing, same-tab membership,
  exact argv, idempotent close argv, and capability removal from the OpenCode
  launch environment.

## Risks Or Blockers

- The live mapping has not yet been invoked. The actual Kitty-to-broker-to-
  OpenCode-plugin path therefore still needs the documented live run.
- No Bun FD propagation blocker was found; the explicit `stdio` mapping is
  required and is covered by a focused test.

## Files

- `docs/decisions/0004-background-capability-broker.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-06-gate-0-background-broker-probe.md`
- `package.json`
- `tsconfig.gate0.json`
- `test/gate0/README.md`
- `test/gate0/broker.ts`
- `test/gate0/contracts.ts`
- `test/gate0/contracts.test.ts`
- `test/gate0/kitty.ts`
- `test/gate0/kitty.test.ts`
- `test/gate0/probe-plugin.ts`
- `test/gate0/read-result.ts`

## Next Step

Install the exact mapping from `test/gate0/README.md`, run the manual live probe
once in a Kitty `splits` tab, inspect `bun run gate0:result`, and journal the
sanitized outcome before beginning any production tracker or adapter work.
