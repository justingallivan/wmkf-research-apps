---
name: project-merge-candidates-authorization-gap
description: "/api/reviewer-finder/merge-candidates accepts any two GUIDs with no requestId and only app-level auth, while the UI gate computeCanManage is documented cosmetic and fail-open — so any reviewer-finder user can execute a globally destructive reviewer merge. Found S414, pre-existing, owner decision pending."
metadata:
  type: project
  status: active
  scope: security
  last_verified: 2026-08-11 against source (S414)
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
hard-deletes colliding suggestion rows (`lib/services/reviewer-merge.js:428-437`)
and deactivates the loser person (`:499-500`), with no compensation for a failure
after the delete.

**So today, any user with reviewer-finder app access can POST two arbitrary GUIDs
and execute a global merge for records in requests they are not viewing.**

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
Not yet investigated: whether `docs/API_ROUTE_SECURITY_MATRIX.md` records this
posture deliberately, and whether the S207 org-open decision was ever meant to
cover a destructive merge.

## How to apply

- Do **not** cite this route's `requireAppAccess` as evidence that a new merge
  affordance is safely authorized — that mistake is exactly what hid the gap
  (the S414 scope doc offered it as reassurance).
- Any work making merge easier to reach should resolve this first, or state
  explicitly that it is knowingly deferred.
- Mirrors [[feedback-ui-gates-must-mirror-server-guards]]: the enable condition
  must mirror a real server guard, and here there is no server guard to mirror.

Related: [[project-reviewer-card-simplification-direction]].
