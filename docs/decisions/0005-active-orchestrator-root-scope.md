# ADR 0005: Scope Presentation To The Active Orchestrator Root

Status: Accepted

Date: 2026-07-24

## Context

The original V1 discovery language treated every child returned by the
project-scoped `session.list()` snapshot as presentation membership. Phase 5
live testing showed that the list includes historical sessions for the project.
Startup reconciliation consequently opened dozens of historical child sessions
as Kitty splits.

The public plugin context does not identify the currently displayed root
session. Choosing the most recently updated root from a historical list would
be heuristic and could again present an unrelated orchestration tree. Live
public session events do identify a root candidate without coupling tracking to
Kitty or an OpenCode TUI panel.

## Decision

V1 presents only immediate children whose `parentID` exactly equals one active
orchestrator root ID.

Matching parentage alone is insufficient for presentation eligibility because a
selected historical root can itself have many historical idle children. Within
the committed active-root lifetime, a child becomes eligible only when either:

1. this plugin runtime observed its explicit live `session.created` event; or
2. a successful authoritative `session.status()` snapshot contains a valid
   `busy` or `retry` status for that listed immediate child.

Once admitted, a child remains eligible if later successful status snapshots
report it idle or omit it. Eligibility ends on child deletion or committed root
switch. Explicit child eligibility is retained as pending state keyed by its
candidate root until authoritative reconciliation commits that root, so a child
that is created and completes before the first snapshot is not lost. Pending or
committed eligibility from any foreign or prior root cannot cross a committed
root switch.

The tracker begins with no active root. Startup and periodic list snapshots may
reconcile data but publish no children until a live public event identifies the
scope. A live root `session.created` selects its own ID. A live child
`session.created` selects its `parentID`. An unknown live `session.status` is a
candidate that must first be found in a successful authoritative list response;
a candidate selects scope only when that exact listed session is a root with no
`parentID`. An unknown child status never derives scope from its parent. A
creation below a known or pending immediate child is a nested descendant, not
an orchestrator-root candidate; it cannot replace the active root or become
presented through a child-first scope transition.

Root candidates remain pending intent until `session.list()` and
`session.status()` both succeed with valid top-level shapes. The tracker then
atomically commits the selected root, eligible replacement membership, and
normalized status after filtering to that root's immediate children. A failed
or malformed list or status snapshot leaves the prior active root and its
published children intact. When list fails but status succeeds, status
reconciliation for existing eligible membership continues normally without
changing membership or consuming pending intent.
Children from the prior root leave the tracker snapshot only after successful
authoritative replacement, at which point the controller closes their managed
presentations. Deleting the active root is an exception because the complete
event payload is authoritative: it clears scope and child membership
immediately. Created, deleted, status, and reconciliation inputs cannot publish
sessions outside the selected immediate-child scope.

Because SDK reconciliation runs inside the serialized mutation queue, a root or
child deletion event can arrive while list or status I/O is in flight but before
its map mutation can execute. The tracker therefore increments a small scope
generation synchronously when deletion identifies the active or pending root,
either directly or through a deleted child's exact `parentID`. Foreign child
deletion does not invalidate current scope. Each reconciliation captures the
generation at request time and checks it after every SDK await and immediately
before any root, eligibility, membership, or status commit. Stale results
publish nothing; the deletion's actual map mutations remain serialized. A
different explicit root creation invalidates in-flight scope work under the same
rule, while duplicate creation for the already expected root does not repeatedly
invalidate and starve reconciliation. A valid status event for an ID not
currently tracked as an active child also invalidates synchronously because it
may identify a different root; the later authoritative list still decides
whether that exact ID is a root. Status for a known active child does not
invalidate current reconciliation.

The tracker must never select a root merely because a historical list entry is
recent. List and status snapshots remain authoritative for membership and
status only after live events establish the root candidate.

## Consequences

- Plugin startup is intentionally empty until relevant live session activity is
  observed.
- Historical project children no longer cause a mass-open at startup.
- Switching orchestrators closes presentations from the prior root through the
  existing tracker-to-controller membership contract.
- A transient list or status failure during a candidate switch does not close
  or replace the current orchestrator's presentations.
- Deleting an active or pending root cannot allow an in-flight stale snapshot to
  publish or open one of that root's children transiently.
- Deleting a child of the active or pending root has the same protection, while
  deletion under a foreign root leaves current reconciliation valid.
- Unknown root-status candidates cannot allow an older in-flight snapshot to
  admit or open old-root children before authoritative scope resolution.
- Status traffic from historical or foreign children cannot select their
  parent or expose any sibling sessions.
- Selecting a historical root does not present its idle historical children;
  only children observed live by this runtime or currently authoritative as
  non-idle are admitted.
- An idle child whose creation and non-idle lifetime both predate plugin startup
  remains intentionally unpresented until a future live creation event or
  authoritative non-idle status makes it eligible.
- The tracker remains independent from Kitty and from any OpenCode TUI panel.
- A root with no live public event after plugin startup remains unpresented;
  guessing from historical recency is explicitly rejected.
- This decision reverses and clarifies the broad project-scoped membership
  statement in the original V1 architecture and Phase 3 plan.
