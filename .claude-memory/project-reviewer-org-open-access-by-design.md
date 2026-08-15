---
name: project-reviewer-org-open-access-by-design
description: "Owner principle (2026-08-15): reviewer and document operations are org-open by design — app-level access is the correct and only meaningful boundary because Dataverse has no technical ownership of requests or data to scope against. Covers reviewer merge (T1) and staff-wide cross-request document reads (D4). Do not re-flag app-level-auth-on-a-record-scoped-op as a security gap for these surfaces."
metadata:
  type: project
  status: active
  scope: security
  last_verified: 2026-08-15 (S428) — owner decisions on T1 (merge) and D4 (document reads)
---

## Recall Rule

Read this before flagging "app-level guard on a request-scoped / record-scoped
operation" as a security finding on **reviewer or document** surfaces (merge,
review-file/proposal/document download, and similar). The owner has settled the
question: it is **by design**, not a gap.

## The principle

**There is no technical ownership of requests or data in Dataverse** (no
"this PD owns this request" field to authorize against). Therefore a
request-scoped or PD-scoped fence has nothing real to key on, and **app-level
access (`requireAppAccess`) is the correct and only meaningful boundary** for
reviewer and document operations. Any per-record data-eligibility predicate that
exists (e.g. the merge block predicate) is a *safety* mechanism, not an
authorization gate — and that is intended.

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

## How to apply

- Do NOT re-open T1/D4-shaped findings as gaps; cite this decision instead.
- The boundary that DOES matter is `requireAppAccess` itself and `is_active`
  session revocation — audit those, not the absence of a per-record fence.
- This principle is scoped to reviewer/document reads under trusted staff access.
  It is NOT license to accept identity-from-request-input, fail-open guards, or
  missing app-access — those remain real findings. See
  [[project-app-access-control]].
