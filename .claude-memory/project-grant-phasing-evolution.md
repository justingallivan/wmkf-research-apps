---
name: Grant phasing — current vs next cycle
description: How proposal phasing works now and how it changes next cycle (one-package submission, internal-only Phase I/II labels)
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
status: active
scope: strategy
last_verified: 2026-09-06 via owner calendar correction (J27 proposals arrive early December 2026, date TBD; 2026-08-18 was the D26 Phase II due date); code claims last re-probed 2026-07-28
---

## Recall Rule

Read this when: writing document-loading or phase-gating logic, or planning for the J27 single-submission cycle. Every J27-sensitive site (retire / persist / change / build / scale) is registered in `docs/J27_TRANSITION_REGISTER.md` (built 2026-09-06 per `docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md`); add new sites there rather than here.

Do:
- Gate reviewer-finding on the internal Phase II label (`akoya_requeststatus = 'Phase II Pending'`) — stays correct across both dual-phase (D26) and single-submission (J27) cycles.
- Treat the Phase I→II flip as a first-class lifecycle event (a status flip, not a second submission). Owner decision 2026-09-06: J27 proposals arrive probably as `Phase I Pending` (confirm); staff review them with Initial Assessment elements; **only after staff decide to move a proposal forward** is `akoya_requeststatus` set to `Phase II Pending`. The advance is the status change, not a particular actor: PDs are expected to flip it from the Workbench in most cases, and Connor may change it behind the scenes via AkoyaGO or Power Automate (owner clarification 2026-09-06). The Workbench therefore needs a status write path and must trust the field whatever wrote it. Every J27 proposal gets a mostly AI-generated Initial Assessment (owner 2026-09-06). Staff review surface: every PD sees other PDs' requests to some degree but focuses on their own; **nothing should get lost**. OPEN (colleague discussion): confirming the PD front-end flip as the primary path and whether back-end changes write other fields (register rows J27-062, J27-064, Q8). Triage gains a third intermediate state, working name "save for now" (editable), settable by PDs and PCs (owner 2026-09-06; the manage gate is lead-PD/superuser only today). Default list = Advancing + Save for now + Untriaged; Set aside hidden by default but always counted and one click away. **Early Connor decision needed:** SharePoint location and filename of the J27 submitted proposal (TBD 2026-09-06); many downstream flows key on it (register Q5). J27 intake runs through **GOApply** until further notice; the custom intake portal stays parked for a future pilot (owner 2026-09-06, [[project-intake-portal-parked]]). D26 posture (owner 2026-09-06): the Phase I→II flip was June 22, 2026 and Phase II proposals were due 2026-08-18; every D26 request has gone forward, reviewer reminders stay manual, and the follow-up toolbar rebuild, three-state triage, and per-reminder audit trail are J27 work. After D26 closes, delete the concept-evaluator archive and the D26 allowlist patch cluster (owner 2026-09-06; register Q1; destructive-carryover checks still apply at execution).
- Plan an upstream per-PD triage/cycle dashboard for J27 (proposals arrive
  in early December 2026, exact date TBD (owner, 2026-09-06); up to ~300 full
  proposals, most never sent for outside review).

Do not:
- Hard-code "Phase II is a different file than Phase I" — next cycle they're the same relabeled document.
- Assume concepts persist — the concept stage is going away.

Ground truth: `lib/services/reviewer-finder/my-proposals-service.js`,
`lib/services/workbench/dashboard-service.js`, `docs/atlas/dataverse-akoya-request.md`,
and `docs/SYSTEM_MODEL.md`. The current `Phase II Pending` gate is source-verified;
the future J27 submission shape is an owner-confirmed plan, not code state.

**Reviewer-finding gate (today and going forward):** Only proposals that advance to **Phase II** get sent to outside reviewers. So the actionable filter for Reviewer Finder is `akoya_requeststatus = 'Phase II Pending'` (or whatever the live "in Phase II" status is in a given cycle). Concepts and Phase I never need outside reviewers.

**Current cycle (J26 / D26):**
- Concept stage → Phase I (separate shorter narrative document) → Phase II (longer document, new submission). Each stage is a distinct document the applicant submits.
- Reviewer finding happens at Phase II.

**Concepts are going away.** Future cycles will not have a concept stage. Already noted broadly in `project-strategy-direction.md` ("Grant cycle is being redesigned").

**Next cycle (J27 — single-submission begins; D26 is the current/last
dual-phase cycle):** Single-package submission, but internal phasing remains.
J27 proposals arrive in **early December 2026**, exact date TBD (owner,
2026-09-06), with up to ~300 full proposals and most never sent for outside
review. An earlier note here dated J27 intake at 2026-08-18; that date was the
D26 Phase II proposal due date, not J27 intake, and was recorded in error. J27 therefore
needs an upstream per-PD triage/cycle dashboard to winnow to the pursue-set
BEFORE the reviewer dashboard applies (see
[[project-reviewer-apps-redesign-direction]] — the tier-2 lens family:
reviewer / triage / editor).
- Applicants submit **once** — one document called "Phase I." No separate Phase II document.
- Staff still classifies proposals internally as Phase I or Phase II.
- "Phase II" becomes a **label change on the original document**, not a new submission.
- Reviewer-finding still gates on the internal Phase II label.

**Implication for our apps:**
- The filter `akoya_requeststatus = 'Phase II Pending'` should stay correct across both cycles since the internal label persists.
- We should NOT hard-code assumptions about "Phase II is a different file than Phase I" in any document-loading code — next cycle they're the same file, just relabeled.
- If we ever need to reload "the Phase II document" for an old request, the SharePoint folder still has both files; for new-cycle requests, there's only one file in the folder.
- **Document capture/storage is itself evolving (S258; framing corrected S265).** D26 resolves request docs by listing the SharePoint `Phase I` subfolder + matching consistent filenames — a **FRAGILE** interim bridge (depends on PDs naming files consistently). Do **not** assert "filename-match breaks in J27" — no evidence (it only breaks if names change). The durable case for **direct Dataverse-table doc references** (e.g. `wmkf_requestdocument`) is legibility + a structured home for machine-produced docs (auto-generated writeups), not a J27-will-break prediction. (The reviewer hold step was retired in S279 for reasons independent of J27; there is nothing left to un-scaffold.) Full picture + sequencing: [[project-j27-doc-capture-evolution]].

**Canonical phrasing (user-confirmed S197 2026-05-28):** "One submission, entered as Phase I; all materials arrive once; the internal downselect flips status to 'Phase II' = advanced into the working process (find reviewers, evaluate) — not a second submission, no Phase II uploads, just a status flip; staff work the Phase I materials for the whole lifecycle." This Phase I→II flip is a first-class lifecycle event. See [[project-system-model]] (`docs/SYSTEM_MODEL.md`).
