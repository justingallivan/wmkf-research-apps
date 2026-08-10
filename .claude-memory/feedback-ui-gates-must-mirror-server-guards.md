---
name: feedback-ui-gates-must-mirror-server-guards
description: When adding or changing an action affordance (button, confirm modal), read the service's own status/precondition guard first and mirror it in the enable condition — twice in one session an ungated button walked the PD into a guaranteed 409, and a second one exposed a silent data-loss path the server never guarded at all.
metadata:
  type: feedback
  status: active
  scope: workbench-ui
  last_verified: 2026-08-09 (S411) — both found by owner production testing, not by unit tests
---

## Recall Rule

Before shipping or modifying any action button, confirm dialog, or enable
condition, open the service it calls and read its precondition guard. Mirror
that guard in the UI's enable condition, as the SAME shape (range vs list) so
the two cannot drift. If the service has NO guard, that is the finding — add
one rather than relying on the button being hidden.

## What happened (S411, 2026-08-09)

Two instances in one evening, both surfaced by Justin testing in production
after unit-green merges:

1. **Send invitation.** `send-invite-service.js:85` refuses
   `status >= SUBMITTED`. `canSend` in `AwardeeTab.js` never consulted status
   at all. Having just moved the send behind a confirm modal, the result was
   *worse* than before: the PD got a full confirmation dialog and then a
   guaranteed 409. Fixed by mirroring the server's range guard.

2. **Regenerate abstract.** The button showed on a submitted package — and the
   regenerate path in `generate-service.js` had **no status guard whatsoever**.
   Clicking it would burn a paid LLM call and overwrite
   `wmkf_abstractformatted` (the historical draft — what was actually sent to
   the grantee) while the published text is `wmkf_abstractapproved`, which that
   path never touches. Nothing visible would change: silent loss of the
   "what we sent vs what they approved" record. Fixed at BOTH layers.

## How to apply

- Mirror the guard as the same **range**, not a re-derived list of values, so a
  newly appended option value cannot land on the two sides differently.
- Hiding a button is not a safety surface. If the destructive path is reachable
  by an API call, the guard belongs in the service — see
  [[feedback-latency-plan-scope-accretion-postmortem]], whose inverse lesson is
  that client-side gating adds risk without adding safety when the server is
  already authoritative. Here the server was NOT authoritative, which is the
  case that actually needs fixing.
- A disabled control must say why it is disabled. A dead grey button with no
  explanation reads as a bug.
- Unit tests with every dependency mocked cannot find these — both were found
  by an owner clicking through production. Budget for that loop on any workbench
  surface with outbound side effects.

## The shape that already works — copy it

Fan-out over the sibling affordances on the same tab found the counter-instance:
**Save edits gets this right.** `abstract-service.js` computes
`editable: isEditable(target.which, status)` server-side and returns it in the
GET body; `AwardeeTab.js` stores it as `abstractEditable` and disables the
button from it. The client never re-derives the rule, so the two cannot drift at
all. Prefer this — a server-computed capability flag in the response — over
re-implementing the predicate client-side, which is only the second-best fix and
the one the two failures above needed.

The other affordances on that tab (Preview email, Copy website HTML, Cycle
export) are read-only and need no gate — checked, not assumed.
