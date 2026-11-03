---
name: project-test-residue-cleanup-is-for-data-mining
description: Owner rationale (2026-08-28) for cleaning production test residue — protect future data mining of structured writeup/request state; unrelated email and activity records can stay, as can SharePoint files tucked in clearly-new folders.
metadata:
  type: project
  status: active
  scope: production-smoke-hygiene
  last_verified: 2026-11-02 (S660) — owner declined junk-producing prompt smokes; 2026-08-28 (S467) Request 1002379 cleanup
---

## Recall Rule
Read before proposing or scoping cleanup of production smoke residue on a real Request.

Do: inventory read-only across every surface first; prioritise structured rows and pointers; present a line-by-line list for confirmation.
Do not: request delete privileges the runtime lacks; chase unrelated email or activity records, or files in clearly-new folders.
Ground truth: `docs/audits/request-1002379-test-mutation-inventory-2026-08-28.md`; Atlas page `docs/atlas/dataverse-wmkf-requestdocument.md`.

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

**2026-11-02 (Session 660): smoke tests that only create permanent junk.** The
owner declined Production smoke tests of the Admin prompt features (first
publish, Add prompt, groups) because each would leave a permanent row nobody
uses ("it will just create junk"). He also would not edit Connor's draft row or
go into Dataverse for a test. **How to apply:** when a feature is low-risk and
fully unit/CI-tested, offer a read-only check or a create-then-retire path
instead of a junk-producing smoke, and record skipped smokes as "skipped by
owner choice", never as passed.
