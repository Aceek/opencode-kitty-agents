# Readable multi-child Kitty placement

## Approved policy

Keep managed child windows in `splits`. For a vertical configured direction,
the first live child is a `vsplit` beside the exact orchestrator using
`childBias`; later children are `hsplit`s at bias `50` inside the child area.
For a horizontal configured direction, swap `vsplit` and `hsplit`. Later
children choose the readable child-area anchor with the largest relevant
dimension, deterministic secondary dimension, then lowest numeric ID.

## Invariants

- Exact positive numeric window IDs remain the only lifecycle targets.
- A placement anchor must be successfully presented by the broker and remain in
  the exact orchestrator tab. Cleanup-only IDs from recovery, rollback, closure,
  or moved children remain lifecycle-managed but are not anchors.
- The broker retains every successful launch ID before validation or focus.
- A uniquely recovered ID is synchronously recorded for exact-ID cleanup before
  its recovery close attempt, so a failed close remains eligible for shutdown.
- A vanished selected anchor causes exact-ID rollback and a bounded sanitized
  failure, while retaining the launch ID for later idempotent cleanup.
- No additional Kitty authority, command allowlist entries, subprocesses on
  the successful path, raw state retention, or changes to timeout/focus/root
  tracking are introduced.

## Implementation seams

- Extend the sanitized Kitty `ls` snapshot only with validated positive
  `lines` and `columns`.
- Add a pure placement selector over managed IDs and the origin-tab snapshot.
- Pass selected anchor, split location, and bias explicitly to attach argv;
  keep source-window and target-tab rooted at the exact orchestrator.
- Validate the selected anchor in the existing post-launch origin-tab snapshot
  before focus.

## Non-live tests

Use fake runner/state tests for dimensions parsing, selector tie-breaks and
direction symmetry, exact argv, one through four child launch sequences,
closed/moved anchors, rollback (including failed close), focus, and exact-ID
cleanup.

## Focused live validation

The approved focused desktop gate passed: startup opened the orchestrator alone
with no historical children, and two simultaneous live agents opened exactly
two readable, correctly positioned child splits. This validates the two-child
placement policy. Broader placement and lifecycle scenarios remain outside that
focused result. The same live test exposed the prior delayed-replacement policy
after manual closure; controller policy is separately corrected so close means
close for the remainder of a child membership lifetime.
