---
name: project-test-residue-cleanup-is-for-data-mining
description: Owner rationale (2026-08-28) for cleaning production test residue — protect future data mining of structured writeup/request state; unrelated email and activity records can stay, as can SharePoint files tucked in clearly-new folders.
metadata:
  type: project
  status: active
  scope: production-smoke-hygiene
  last_verified: 2026-08-28 (S467) — Request 1002379 cleanup
---

When production Requests are used as smoke vehicles (1002379 in Aug 2026),
the owner's cleanup goal is **future data mining**: structured state the app
writes (`wmkf_requestdocument` rows, request pointers, Postgres distribution
rows) must not survive as if it were real. Things a future analyst would
obviously recognise as test noise or never query are fine to leave: Dynamics
email/site-visit activities ("obviously unrelated to the proposal and we
generally don't revisit these"), files inside clearly-new folders (`AI
Materials/`, `Reviewer_*`), and the append-only `wmkf_ai_run` ledger.

**How to apply:** inventory first (read-only probe, all surfaces, back to the
start of testing), present a line-by-line list, and prioritise structured
rows and pointers; do not request delete privileges the runtime doesn't need
(the app principal has no Activity DeleteAccess by design). Precedent:
`docs/audits/request-1002379-test-mutation-inventory-2026-08-28.md`. See
[[feedback-list-and-confirm-before-bulk-deletes]].
