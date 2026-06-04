---
name: Grant phasing — current vs next cycle
description: How proposal phasing works now and how it changes next cycle (one-package submission, internal-only Phase I/II labels)
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
status: active
scope: strategy
last_verified: S197 (2026-05-28) via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: writing document-loading or phase-gating logic, or planning for the J27 single-submission cycle.

Do:
- Gate reviewer-finding on the internal Phase II label (`akoya_requeststatus = 'Phase II Pending'`) — stays correct across both dual-phase (D26) and single-submission (J27) cycles.
- Treat the Phase I→II flip as a first-class lifecycle event (a status flip, not a second submission).
- Plan an upstream per-PD triage/cycle dashboard for J27 (~300 full proposals arrive ~Dec 2026, most never sent for outside review).

Do not:
- Hard-code "Phase II is a different file than Phase I" — next cycle they're the same relabeled document.
- Assume concepts persist — the concept stage is going away.

Ground truth: `docs/SYSTEM_MODEL.md`, [[project-system-model]], [[project-reviewer-apps-redesign-direction]], `project-strategy-direction.md`.

**Reviewer-finding gate (today and going forward):** Only proposals that advance to **Phase II** get sent to outside reviewers. So the actionable filter for Reviewer Finder is `akoya_requeststatus = 'Phase II Pending'` (or whatever the live "in Phase II" status is in a given cycle). Concepts and Phase I never need outside reviewers.

**Current cycle (J26 / D26):**
- Concept stage → Phase I (separate shorter narrative document) → Phase II (longer document, new submission). Each stage is a distinct document the applicant submits.
- Reviewer finding happens at Phase II.

**Concepts are going away.** Future cycles will not have a concept stage. Already noted broadly in `project-strategy-direction.md` ("Grant cycle is being redesigned").

**Next cycle (J27 — single-submission begins; D26 is the current/last dual-phase cycle):** Single-package submission, but internal phasing remains. Full proposals arrive **~Dec 2026, up to ~300, and most are never sent for outside review** (user, 2026-05-31) — so J27 needs an upstream per-PD triage/cycle dashboard to winnow to the pursue-set BEFORE the reviewer dashboard applies (see [[project-reviewer-apps-redesign-direction]] — the tier-2 lens family: reviewer / triage / editor).
- Applicants submit **once** — one document called "Phase I." No separate Phase II document.
- Staff still classifies proposals internally as Phase I or Phase II.
- "Phase II" becomes a **label change on the original document**, not a new submission.
- Reviewer-finding still gates on the internal Phase II label.

**Implication for our apps:**
- The filter `akoya_requeststatus = 'Phase II Pending'` should stay correct across both cycles since the internal label persists.
- We should NOT hard-code assumptions about "Phase II is a different file than Phase I" in any document-loading code — next cycle they're the same file, just relabeled.
- If we ever need to reload "the Phase II document" for an old request, the SharePoint folder still has both files; for new-cycle requests, there's only one file in the folder.

**Canonical phrasing (user-confirmed S197 2026-05-28):** "One submission, entered as Phase I; all materials arrive once; the internal downselect flips status to 'Phase II' = advanced into the working process (find reviewers, evaluate) — not a second submission, no Phase II uploads, just a status flip; staff work the Phase I materials for the whole lifecycle." This Phase I→II flip is a first-class lifecycle event. See [[project-system-model]] (`docs/SYSTEM_MODEL.md`).
