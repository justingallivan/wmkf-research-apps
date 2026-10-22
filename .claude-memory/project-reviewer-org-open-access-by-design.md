---
name: project-reviewer-org-open-access-by-design
description: "Owner principle for global reviewer merge and staff-wide document reads: org-open by design. Request-bound Reviewer Follow-up has a lead-PD/superuser owner decision; current source evidence is bounded to terminal withdraw/release, close, and due-date extension, with hosted status not freshly probed."
metadata:
  type: project
  status: active
  scope: security
  last_verified: 2026-10-22 source review — T1/D4 decisions remain settled; request-bound mutation source is verified, while current hosted state is UNKNOWN (2026-09-02 merge and read-only smoke are historical evidence)
---

## Recall Rule

Read this before flagging an app-level guard on reviewer or document surfaces.
The org-open decision remains settled for the global reviewer-person merge and
staff-wide document reads. Do not generalize it to request-bound Reviewer
Follow-up mutations: the owner selected a lead-PD/superuser server boundary for
those actions on 2026-09-02. Current source implements this boundary in the
three audited request-bound routes: authorization runs before mutation side
effects, derives the actor from `actorRefFromSession` plus the authenticated
profile, and uses `reviewer-request-authorization.js:42-133` to freshly read
`getUserRole`, resolve suggestion → request on the server, and fail closed for
non-superusers unless the actor matches the request's lead PD. The 2026-09-02
merge `acf40fb8` and read-only Production smoke are dated historical evidence;
the smoke did not exercise a write, and current hosted state has not been
re-probed. See `docs/audits/pi-identity-request-mutation-audit-2026-10-22.md`
for the bounded source audit.

## The principle

The 2026-08-15 decision established app-level access (`requireAppAccess`) as the
correct boundary for operations without a meaningful single-request owner: the
global reviewer-person merge and staff-wide document reads. The merge's
per-record data-eligibility predicate is a safety mechanism, not authorization.

That rationale is not universal. An `akoya_request` has a lead Program Director
lookup (`_wmkf_programdirector_value`) that can authorize request-bound follow-up
mutations. On 2026-09-02 the owner selected that boundary: lead PD or superuser
may mutate; other authorized staff retain read access only. The source-reviewed
scope is terminal withdraw/release and close, plus due-date extension. This is
not a claim that every Reviewer Follow-up route or hosted environment has been
checked. Historical implementation and verification details are in
`docs/REVIEWER_FOLLOW_UP_ORG_CYCLE_VISIBILITY_PLAN.md`.

## Settled instances

- **T1 — reviewer merge** (`pages/api/reviewer-finder/merge-candidates.js`):
  org-open app-level auth, no `requestId`; accepted by-design. Detail:
  [[project-merge-candidates-authorization-gap]].
- **D4 — staff-wide cross-request document reads**
  (`pages/api/review-manager/download-review.js`,
  `pages/api/workbench/download-proposal-document.js`,
  `pages/api/dynamics-explorer/download-document.js`): app grant + client-supplied
  record id, GUID-validated, no per-record membership check — including another
  reviewer's submitted review file. Accepted by-design; `blob-proxy.js:11` already
  documents staff-wide read as intended. Recorded in
  `docs/audits/fable-security-audit-2026-08-14.md` (finding D4).
- **Request-bound Reviewer Follow-up mutations — owner decision (2026-09-02):**
  the selected boundary remains lead-PD/superuser writes; other authorized staff
  remain organization-wide readers. Current source enforces this for the scoped
  terminal withdraw/release, close, and due-date extension actions. The
  `acf40fb8` merge and read-only smoke are historical; current hosted status is
  UNKNOWN. This does not alter T1 or D4.

## How to apply

- Do NOT re-open T1/D4-shaped findings as gaps; cite this decision instead.
- Do not use the older general "reviewer APIs stay org-open" wording to block or
  weaken the request-bound mutation hardening.
- The boundary that DOES matter is `requireAppAccess` itself and `is_active`
  session revocation — audit those, not the absence of a per-record fence.
- For request-bound Reviewer Follow-up mutations, audit the server-resolved
  target request, lead-PD/superuser gate, and fail-closed actor identity in each
  route. The current source evidence summarized here is bounded to terminal
  withdraw/release, close, and due-date extension; do not generalize it to every
  route.
- This principle is NOT license to accept identity-from-request-input, fail-open
  guards, or missing app access — those remain real findings. See
  [[project-app-access-control]].
