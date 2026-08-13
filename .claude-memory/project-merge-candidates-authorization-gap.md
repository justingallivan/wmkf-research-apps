---
name: project-merge-candidates-authorization-gap
description: "/api/reviewer-finder/merge-candidates accepts any two GUIDs with no requestId and only app-level auth, while the UI gate computeCanManage is documented cosmetic and fail-open — so any reviewer-finder user can execute a globally destructive reviewer merge. Found S414, pre-existing, owner decision pending."
metadata:
  type: project
  status: active
  scope: security
  last_verified: 2026-08-12 (S422) against route/service source, API route matrix, S207 rationale, and S289 design — re-checked, STILL UNADDRESSED
---

## Recall Rule

Read this before touching reviewer merge, `pages/api/reviewer-finder/merge-candidates.js`,
or any UI that makes merge easier to reach. Also read it when reasoning about
whether the S207 "reviewer APIs stay org-open" decision extends to destructive
operations — this is the case that tests it.

## The gap

`pages/api/reviewer-finder/merge-candidates.js:22-36` takes only
`{keeperId, loserId, fieldChoices, confirm}`. It **never receives a `requestId`**.
Auth is app-level only: `requireAppAccess(req, res, 'reviewer-finder', 'reviewers')`.
Ids are GUID-validated (trust-boundary), but **membership is never checked** —
nothing verifies either person belongs to a request the caller may manage.

The UI gate does not compensate. `computeCanManage`
(`shared/components/reviewers/reviewer-modes.js:86-96`) is documented in its own
docblock as *"Cosmetic only — the reused server APIs stay org-open — so it FAILS
OPEN"*, staying permissive for superusers, unresolved viewer ids, and unresolved
request PDs.

What the endpoint can do is destructive and not transactional: `executeMerge`
hard-deletes colliding suggestion rows (`lib/services/reviewer-merge.js:432`) and
deactivates the loser person (`:501`), with no compensation for a failure after the
delete.

**So today, any user with reviewer-finder app access can POST two GUIDs and execute a
global merge for records in requests they are not viewing.**

**Scope the claim precisely — the block predicate does narrow the blast radius**
(`reviewer-merge.js:227-249`). It refuses a loser that is promoted to a CRM contact
(`_wmkf_contact_value` set), engaged (invited / responded / review or honorarium
activity on any request), or holding a `confirmed` identity the keeper lacks. So the
reachable damage is limited to **pre-engagement, non-promoted, non-confirmed-identity**
duplicate rows — real, but not "any two records". Do not overstate it as arbitrary; the
gap is that eligibility is a *data* predicate and no *caller* check exists anywhere.

**Disconfirming check run (S414):** grepped both the route and
`lib/services/reviewer-merge.js` for any membership/authorization guard. None
exists. The one construct that *looks* like authorization is not:
`actingUserSystemId` (route `:38`, service `:325`) is threaded only into Dataverse
write calls as **attribution** alongside `ifMatch` ETags — it is never compared
against the record, the request, or a permission. `requestId` appears in the
service only as a value read *off the records themselves*, never as a
caller-supplied scope to authorize against. Do not mistake either for a guard.

## Status

**Pre-existing — not introduced by any S414 proposal.** Surfaced while scoping an
Invite-tab merge affordance (that scope was killed; see
`outputs/reviewer-email-merge-surfacing-scope.md`). **Owner decision pending.**

The documentation trail is now investigated. The API route matrix explicitly
records app-level auth and attributes safety to the merge block predicate. The
S289 merge design made the same explicit choice: merge auth matches
`my-candidates`, while the loser predicate limits data eligibility. The older
S207 rationale kept the then-reused reviewer write APIs org-open for a small,
trusted staff, but it predates the merge route and names field/file/email/token
operations—not arbitrary-pair suggestion deletion plus person deactivation.
Therefore the current route posture is deliberate in S289, but the evidence does
not establish that the owner intended S207's trust decision to cover this later
destructive primitive. The predicate is not caller or request authorization.

## How to apply

- Do **not** cite this route's `requireAppAccess` as evidence that a new merge
  affordance is safely authorized — that mistake is exactly what hid the gap
  (the S414 scope doc offered it as reassurance).
- Any work making merge easier to reach should resolve this first, or state
  explicitly that it is knowingly deferred.
- Mirrors [[feedback-ui-gates-must-mirror-server-guards]]: the enable condition
  must mirror a real server guard, and here there is no server guard to mirror.

Related: [[project-reviewer-card-simplification-direction]].
