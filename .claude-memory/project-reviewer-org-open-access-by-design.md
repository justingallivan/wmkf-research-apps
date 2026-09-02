---
name: project-reviewer-org-open-access-by-design
description: "Owner principle for global reviewer merge and staff-wide document reads: org-open by design. Narrow exception decided and branch-built 2026-09-02: request-bound Reviewer Follow-up mutations are lead-PD/superuser-only at the server boundary."
metadata:
  type: project
  status: active
  scope: security
  last_verified: 2026-09-02 — T1 merge and D4 reads remain org-open; request-bound mutation exception built and test-verified on implementation branch
---

## Recall Rule

Read this before flagging an app-level guard on reviewer or document surfaces.
The org-open decision remains settled for the global reviewer-person merge and
staff-wide document reads. Do not generalize it to request-bound Reviewer
Follow-up mutations: the owner selected a lead-PD/superuser server boundary for
those actions on 2026-09-02. That boundary is implemented on
`codex/workbench-reviewer-follow-up`; Production remains unchanged until
deliberate promotion.

## The principle

The 2026-08-15 decision established app-level access (`requireAppAccess`) as the
correct boundary for operations without a meaningful single-request owner: the
global reviewer-person merge and staff-wide document reads. The merge's
per-record data-eligibility predicate is a safety mechanism, not authorization.

That rationale is not universal. An `akoya_request` has a lead Program Director
lookup (`_wmkf_programdirector_value`) that can authorize request-bound follow-up
mutations. On 2026-09-02 the owner selected that boundary: lead PD or superuser
may mutate; other authorized staff retain read access only. The server hardening
is implemented and automated-test verified on the branch documented by
`docs/REVIEWER_FOLLOW_UP_ORG_CYCLE_VISIBILITY_PLAN.md`. It is not Production-live
until deliberate promotion.

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
- **Request-bound Reviewer Follow-up mutations — implemented exception (owner,
  2026-09-02):** server-authoritative lead-PD/superuser writes are built and
  test-verified on the implementation branch; other authorized staff remain
  organization-wide readers. This does not alter T1 or D4.

## How to apply

- Do NOT re-open T1/D4-shaped findings as gaps; cite this decision instead.
- Do not use the older general "reviewer APIs stay org-open" wording to block or
  weaken the request-bound mutation hardening.
- The boundary that DOES matter is `requireAppAccess` itself and `is_active`
  session revocation — audit those, not the absence of a per-record fence.
- For request-bound Reviewer Follow-up mutations, also audit the server-resolved
  target request, lead-PD/superuser gate, and fail-closed actor identity.
- This principle is NOT license to accept identity-from-request-input, fail-open
  guards, or missing app access — those remain real findings. See
  [[project-app-access-control]].
