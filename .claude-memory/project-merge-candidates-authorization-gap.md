---
name: project-merge-candidates-authorization-gap
description: "/api/reviewer-finder/merge-candidates uses org-open app-level auth (no requestId/caller scope) for a globally destructive reviewer merge. RESOLVED 2026-08-15: owner accepts as by-design — no technical ownership of requests/data exists in Dataverse, so there is no meaningful tighter boundary. Kept as-is; data-only block predicate remains the safety mechanism."
metadata:
  type: project
  status: closed
  scope: security
  last_verified: 2026-08-15 (S428) — owner decision: keep as-is (org-open), accepted by-design; rationale = no technical request/data ownership in Dataverse to scope against
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
hard-deletes colliding suggestion rows (`lib/services/reviewer-merge.js:448` as of
2026-08-14) and deactivates the loser person (`:541`), with no compensation for a
failure after the delete (a `merge_retryable_replan` 409 tells the client to replan).
Since `fa62db30` (2026-06-29) the merge ALSO writes `akoya_request` applicant slots
(repoint/disassociate, `:466-486`) — request records the caller may not manage — so
the unauthorized write reach is wider than the original suggestion+person scope.

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

**RESOLVED — accepted as by-design, keep as-is (owner, 2026-08-15 / S428).** Org-open
app-level auth on merge is the intended and only meaningful model. **Rationale (owner):
there is no technical ownership of requests or data in Dataverse**, so a request-scoped
or PD-scoped merge fence has nothing real to key on — "you can only merge reviewers on
your own requests" is not an enforceable concept here. App-level access is therefore the
correct boundary, and the data-only block predicate (pre-engagement/non-promoted/
non-confirmed) remains the safety mechanism. This is accepted risk, not an open gap.

Historical context (kept for provenance): surfaced S414 while scoping an Invite-tab merge
affordance (scope killed; `outputs/reviewer-email-merge-surfacing-scope.md`); the S289
design chose app-level auth deliberately; the older S207 org-open rationale predated the
route. The 2026-08-15 owner decision settles the question the earlier framing left open —
the absence of any ownership model means there is no tighter boundary to adopt.

## How to apply

- The decision is settled: **org-open merge is intended.** Do not reopen it as a
  security gap or propose a request/PD scope — there is no ownership model in
  Dataverse to scope against. New merge affordances may rely on app-level access.
- The data-only block predicate (`reviewer-merge.js:242-265`: pre-engagement,
  non-promoted, non-confirmed-identity) is the real safety mechanism — preserve it.
- Recall rule now: read this to confirm the merge posture is **accepted by-design**
  (not a pending gap) before treating org-open merge auth as a finding.

Related: [[project-reviewer-card-simplification-direction]].
