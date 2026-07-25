# 2026-07-24 - Phase 2 Review Corrections

## Completed

- Replaced child-specific `ls --match=id:<child>` existence probes with one
  non-mutating exact origin-tab snapshot, because Kitty treats a missing match
  as an error rather than returning an empty JSON tree.
- Wrapped both orchestrator and attached OpenCode launches in `/usr/bin/env -i`
  with a fixed construction-time allowlist for terminal metadata, `HOME`,
  `PATH`, locale, standard XDG directories, and path-only OpenCode configuration
  variables. Credentials, Kitty capabilities, arbitrary variables, and complete
  environments are excluded.
- Added malformed/lost launch-output recovery using pre/post exact origin-tab
  numeric ID snapshots and a broker-generated per-launch Kitty user-variable
  marker. Recovery closes only one marked addition when every pre-existing ID
  remains; ambiguous state is untouched.
- Changed orchestrator launch to use `--cwd=current` with the exact invoking
  source window.
- Added a retained startup shutdown latch so SIGINT/SIGTERM received before a
  resource exists still aborts later startup; signals during launch lead to
  bounded finally-path cleanup rather than continued startup.
- Changed managed-window shutdown cleanup from unbounded `Promise.all` to
  sequential closes.
- Initialized the broker server close callback before listening, kept request
  sockets writable until their response, and prevented shutdown from truncating
  its response before closing the server.

## Decisions

- Real manual-closure detection uses `ls --match-tab=window_id:<origin>` and
  parsed numeric membership. No no-match stderr is interpreted and no active,
  recent, title, or child match is used.
- Environment values are selected only by broker construction code. The IPC
  protocol still has no environment or executable field. Password-authenticated
  attach is explicitly unsupported until a mechanism avoids secrets in argv and
  IPC.
- Numeric ID difference alone is insufficient to distinguish a short-lived
  launch from an unrelated concurrent window. Recovery therefore additionally
  requires the broker-owned per-launch marker, but all lifecycle commands still
  target only the recovered numeric ID.

## Verification

- Rechecked Kitty 0.47.4 `windows_for_payload`: an empty window match raises
  `MatchError`, confirming that `ls --match=id:<closed-id>` cannot represent
  normal manual closure as `[]`.
- Added realistic regressions for origin-tab manual closure, explicit minimal
  environments, source cwd, credential/capability exclusion, unique and
  ambiguous launch recovery, retained startup signals, sequential cleanup, and
  immediate server shutdown response handling.
- `bun run check` passed: all source, test, and Gate 0 TypeScript
  configurations; 88 tests with 208 assertions; and the production build.

## Risks Or Blockers

- The minimal environment deliberately does not forward OpenCode server
  credentials. Authenticated attach remains unavailable until a secure
  non-argv, non-IPC path is verified.
- Final production mapping and end-to-end runtime verification remain deferred;
  Phase 3 has not started.

## Files

- `README.md`
- `docs/architecture/v1.md`
- `docs/plans/v1-implementation.md`
- `docs/research/feasibility.md`
- `docs/journal/README.md`
- `docs/journal/2026-07-24-10-phase-2-review-corrections.md`
- `src/broker/core.ts`
- `src/broker/kitty.ts`
- `src/broker/main.ts`
- `src/broker/server.ts`
- `src/broker/shutdown.ts`
- `src/presentation/kitty/client.ts`
- `test/broker-core.test.ts`
- `test/broker-server.test.ts`
- `test/broker-shutdown.test.ts`
- `test/kitty-client.test.ts`

## Next Step

Keep Phase 2 at review-complete status and wait for explicit approval before
starting Phase 3 session tracking. Do not add controller integration or final
user setup as part of this correction.
