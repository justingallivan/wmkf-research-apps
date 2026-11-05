---
title: Workbench single-submission strategy brief
domain: workbench
kind: plan
status: draft
summary: Historical planning inventory and D26 workbook source analysis, with Nov 5 J27 direction for app-editable short fields, versioned Word reconciliation and frozen shared packets.
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/J27_TRANSITION_REGISTER.md
  - docs/REQUEST_WORKBENCH_SCOPING.md
  - docs/audits/product-backlog-reconciliation-2026-10-31.md
---

# Workbench: single-submission strategy and discussion handoff

## Owner direction — 2026-11-04

[VERIFIED via owner discussion] Justin wants a holistic rethink of Workbench
function and form. Future choices should support the complete grant process,
rather than add separate applets incrementally. Existing capabilities are
foundations; their current tabs, names and layout are not fixed requirements.

The Field Primer and Initial Assessment will be overhauled. Settle the flows
before building the requested Admin package-reprocessing feature. That feature
remains wanted; it is deferred, not dropped.

[PLANNED discussion approach, not a frozen architecture] Begin with the staff
journey, roles, decisions, required information, outputs and handoffs, including
proposals that stop. Decide what information carries forward before choosing
tabs or screens. Design cycle-wide queues and the per-proposal workspace
together. Test connected screen concepts against realistic staff scenarios
before committing to implementation.

## Historical planning inventory

This is a discussion summary, not a fresh Production audit or a build checklist.
The October alignment log contains later decisions than several memories and
the original May/July Workbench plans. A dated decision establishes intent,
not implementation. Existing release records remain checkpoint-specific.

| Topic | Recorded direction and evidence | Boundary at this handoff |
|---|---|---|
| One submission | J27 applicants submit one full package; concepts disappear. Internal Phase I/II labels remain, but advancement is not a second proposal submission. Phasing memory and October alignment log. | Owner-decided process. Do not treat old D26 document stages as the permanent J27 UI. |
| Whole-process structure | Original Workbench scoping proposed cycle-wide triage, reviewer and editor lenses over the same requests, feeding a per-request workspace. Standalone tools remain useful for occasional work. | Historical design to draw on, not an obligation to make each capability a tab. |
| Staff visibility | PDs focus on their assignments while retaining visibility into colleagues' proposals; nothing should get lost. | Preserve this principle when designing defaults and filters. |
| Triage | D17/D19/D38–D41: Submitted, Flagged for concerns, Triaged, Under consideration, Recommend to Program Chairs, Invited for Peer Review, terminal Not invited. Compact list, filters, bulk actions, hidden-but-counted terminal rows, deadline markers. | The old Advancing/Set aside implementation is not this workflow. New staff-state field and full experience remain incomplete per the October 31 backlog audit. |
| Decision ownership | D31/D32/D35/D39: staff recommend in the app; Grants Manager records Chairs outcomes in Dataverse. Marking Triaged writes Phase I Recommended Do Not Invite; app does not write request status. | Later decisions supersede earlier suggestions that PDs advance request status directly from Workbench. Program Chairs do not operate the database. |
| Intake preparation | D37: Connor's on-submit flows produce short title, keywords, lay abstract, tentative PD, clerical check, fitness flag and expertise. D14: prompts are shared and editable in Admin. | Expertise mechanics and which remaining outputs are app jobs need decisions. Current readiness predicate reads wmkf_readyforreview; that flag is not a whole-app automation orchestrator. |
| Initial Assessment | Every complete proposal should receive an assessment before downselection, using the D26 governed-document foundations. | Existing format is a starting point. Owner now expects overhaul, not automatic replication of the pilot at scale. |
| Human triage | AI flags concerns with reasons; people decide. Decline-note drafts were discussed for staff rescue/revision/finalization. | Flag criteria/prompts require staff/CSO discussion. Neutral assessment and evaluative flags are different outputs. |
| Expertise and programs | D15/D16/D18/D30: shared editable expertise roster; automatic PD assignment corrected in AkoyaGO; immutable program-at-submission classification alongside later working MR/S&E classification. | Shared roster mechanics, assignment policy and provisioning must be rechecked before build. |
| First Cut / Chairs | Personalized First Cut spreadsheet, around 50 summaries; concise Chairs writeups using existing machinery; magic-link proposal access. | Content, review burden/timing and sharing delivery remain distinct design/build questions. Existing Board release tools are foundations, not proof of a Chairs workflow. |
| Documents | Staff proposal first; component files collapsed. SharePoint Word is canonical editable narrative; Dataverse holds identity, relationships, structured state and provenance. Same artifacts open from cycle and request views. | Version history, milestone snapshots and document-body search were discussed. Do not create another independently editable copy of the prose. |
| Reviewer discovery | D23: bibliography-aware discovery. Separate October 21 proposal: reviewers contribute supported expertise to consequential scientific judgments, with useful independent overlap. | Bibliography packaging remains to settle; complementary panel-coverage pilot is explicitly parked. No pilot has run. |
| Later lifecycle | Peer review, oral presentations over Zoom, staff evaluation, ranking and Board decision. October timeline anticipates no J27 site visits. | Revisit Site Visit / Pre-Site naming and assumptions, including which reviewed proposals proceed to presentations. |
| Cycle operations | Central dates, overlapping cycles, minimal repeated setup. Calendar, linked-cycle reads, landing default and materials-on-acceptance have implementation/release records. | Consolidated readiness panel/digest remains planned. Reviewer reminders remain manual for J27. |
| Package reprocessing | App analyses/generated documents only; preserve staff edits/history and show preview/progress. | Deferred until workflows settle. No retention period, initial stage list or lifecycle eligibility was finally accepted. |

## Older options worth reconsidering, not approved architecture

1. **Intelligence brief.** The historical staged pipeline proposed fit screening,
   then field landscape/prior art/novelty/team-capability research and questions
   for the applicant, followed by a virtual panel for shortlisted proposals.
   That end-to-end pipeline was never implemented. The successor Review Panel
   is a separate capability, not proof that this pipeline exists.
2. **Reusable scientific extracts.** The April plan proposed aims, hypotheses,
   methods, innovation claims, expertise requirements and key passages for
   selected downstream reuse. The expanded schema and universal reuse were
   never settled. The existing wmkf_ai_dataextract field is narrower; the current
   Review Panel uses its own frozen narrative-centered input.
3. **Document search.** Combine structured lifecycle/request filters with
   SharePoint body search, with explicit completeness, permission and freshness
   handling. Basic Graph search is not the complete proposed experience.

## Historical component review — 2026-11-04

[VERIFIED via source investigation in this session]

- Field Primer supplies neutral field orientation, not a recommendation or a
  live literature review. It is stored on the request and generated manually.
- Initial Assessment generates a governed Word document with Summary and three
  rationale sections; staff edits live in that Word document.
- Current Draft generation does not consume Initial Assessment prose, staff
  edits or its Board snapshot. Similar content is independently generated from
  the proposal narrative and request context.
- Create Board snapshot retains a separate source-version-bound document; it
  does not call AI, send materials or record a funding approval.
- Status tab duplicates Overview status. Removal is committed as d0329dd1c on
  codex/remove-workbench-status-tab, pushed but unmerged at this handoff. Shared
  status-badge code remains; old tab links fall back to Overview. No deployment
  of the removal is claimed.

## CSO review workbook — 2026-11-04 discussion

[VERIFIED via reading the workbook in this session] The CSO's
`J27_Review_Workbook_Mockup_v9.xlsx` (owner's copy; holds applicant data, so it
is not stored in this repo) models the cycle's information. Sheet 1 is a master
with one row per application (199 D26 rows reshaped to the J27 flow), columns
grouped Intake → Decisions → After review → Finalist → Status, and a row naming
each field's source (Portal, Claude draft, Staff, a named meeting, Records).
Sheets 2, 3, 3b and 4 are audience packets: a typed Request # looks up a column
subset from the master. Sheet 4 rows become the Board writeup cover page, and
it totals recommended count and dollars by program and East/West. A Lists sheet
holds a proposed triage-reason list and placeholder D26 keyword lists.

Fields and their stated sources: short title, lay abstract, methods, key
personnel, First Cut rationale, triage flag and reason, field and methods
keywords (Claude drafts; staff edit); staff notes (never shown to Chairs or
Board); First Cut Y/N (Research Meeting); Semi-finalist Y/N (Program Chairs
meeting); reviewer summary opening with the scores; Finalist or Offramp;
research presentation summary; final rationale (replaces the First Cut
rationale, which is frozen until then); rank and Recommend for (dollars or
"Do not approve", from the Ranking Meetings).

[VERIFIED via owner discussion] Decisions recorded as D50 in the alignment log:
the workbook is a spec of what the apps must gather, not the staff workspace;
its packets can be regenerated as workbooks or replaced by better views. Staff
approve the post-review offramp with a written justification and no reason
list; the proposed list is for triage only; presentations follow reviews.
Chairs and interested Board members weigh in on the ~50 in advance; staff
narrow to ~25; the Chairs decide.

The Nov 5 owner decision uses editable app fields for intake; whether to
assemble an Initial Assessment Word output from them is deferred. The Field
Primer does not appear in the workbook. The workbook omits reviewer
finding, Program Coordinator work and documents, which the Workbench still
covers. The field inventory and source analysis follow.

## Workbook field inventory and source analysis — 2026-11-04

### Where each column lives today

[Delegated read-only source inventory with file:line evidence. Re-verified by
grep in this session: no lib/pages/shared/scripts reads or writes of the four
`wmkf_ai_*` fields named below, `wmkf_institutiontype` or a program-at-submission
field, and "Recommended Do Not Invite" appears only in test-request tooling.
Other rows are as reported, not independently re-checked.]
Built and producing data: request number, PD, organization, applicant title and
abstract, request amount, working program, East/West (`account.wmkf_eastwest`,
read only by Proposal Ranking), review scores and the AI review synthesis
(`akoya_request.wmkf_reviewsynthesisjson`), and rank (Proposal Ranking tables
only; never written back to the request). Dataverse field exists but no app
writer: short title (`wmkf_wmkfprojectdescription`; today only the grantee-title
cron writes it), methods/keywords/team/fit fields (`wmkf_ai_methodologies`,
`wmkf_ai_keywords`, `wmkf_ai_teaminfo`, `wmkf_ai_fitassessment`; no reads or
writes in lib/pages/shared/scripts), institution type
(`account.wmkf_institutiontype`; unread). Decided, not built: the D41 staff
state, the D31 Triaged write, the triage reason list, the offramp outcome and
justification (D36/D50) and program at submission (D30). None found by the
inventory: a lay-abstract field, request-level staff-only notes and a frozen
First Cut rationale.

### How the D26 writeup text is produced

[VERIFIED via source] One generation run, started by a staff member, executes
`pre-site-visit.proposal-core.generate` with two inputs only: the AI Materials
proposal narrative and a request-context JSON
(`lib/services/pre-site-visit/proposal-core-service.js:188-215`). It writes
eight sections to `wmkf_requestdocument` columns
(`lib/services/pre-site-visit/artifact-model.js:54-63`) plus the whole output
in `wmkf_presiteproposalcorejson`, and renders the Word template
(`lib/services/pre-site-visit/docx-renderer.js`). The template also takes
Dataverse fields, a deterministic funding-history sentence and, when reviews
exist, a deterministic referee section (`proposal-core-service.js:305-336`).
Recommendation, Scientific Presentation and graphical abstract stay as staff
placeholders. The Final Writeup row copies the Draft's section columns
(`lib/services/final-writeup/transition-model.js:21-26`) and points to the same
SharePoint file. [VERIFIED via owner-approved Production read, 1002874] the
Draft and Final Writeup rows reference one file (same SharePoint item; recorded
eTag revisions 1 and 97). Staff edits live only in Word; the Dataverse section columns keep the
first AI draft.

### Which source the CSO's fields come from

[VERIFIED via owner-approved, read-only Production reads of six requests:
1002874, 1002835, 1003074, 1003024, 1002988, 1002963; nothing written] Each
workbook sentence was compared, by word overlap, with the request's Dataverse
fields, request-document rows and SharePoint file text. Best-matching source:

| Column | Result across the six |
|---|---|
| Short title | Exact match to `wmkf_wmkfprojectdescription` in all six |
| Lay abstract | Applicant text (Phase I lay abstract or `wmkf_abstract`), sometimes with the Pre-Research Presentation Brief, in four; edited Word writeup in two |
| Methods, key personnel, First Cut rationale | Edited Word writeup in most cases; 1002874's methods and rationale were closer to the unedited Dataverse columns |
| Reviewer summary, presentation summary, final rationale | Edited Word writeup in every case; the Dataverse columns hold no review or presentation text |

[INFERRED, pending the CSO's confirmation] The workbook's prose columns are
short condensations, by staff or AI, of each request's final edited writeup,
plus the applicant's lay abstract and the short title. Where the writeup had
been edited heavily, the Dataverse section columns matched poorly
(0.06–0.30 overlap), so they cannot stand in for final text.

### J27 planning decisions — 2026-11-05

[VERIFIED via owner discussion; new workflow remains PLANNED.]

1. Short fields are stored in Dataverse and edited in the app. Later Word
   composition remains to decide. Generated documents retain their field-value
   baseline and Word version; later Word edits are flagged for human or
   machine-assisted reconciliation. The D26 source analysis above describes
   the older Word-centered process, not the J27 editing contract.
2. Intake fields use submitted materials and the CSO formats. Editable app
   fields are the intake working surface (I1); whether an Initial Assessment
   Word output is needed is deferred.
3. Freeze the First Cut packet that was shared, while keeping app fields
   editable; later packets use updated values (F2).
4. Rank remains in existing Dataverse Proposal Ranking records; no final rank
   is needed on each request. Recommended-amount overrides and "Do not approve"
   are deferred to later in the cycle; use existing amount behavior for now.
5. November 15 remains the first-slice target for staff state/bulk setting and
   intake fields visible as they arrive (S1). Delivery feasibility is unverified.

The staged plan and remaining questions are in
`docs/plans/J27_CYCLE_INFORMATION_PLAN_2026-11-04.md` (draft).

## Next discussion

Start with a process map and short design principles. Walk a new proposal,
dismissed AI concern, held proposal, Chairs recommendation, peer-review case
and presentation-stage case through it. Include PD, Program Coordinator,
Grants Manager and leadership roles.

Resolve the purpose of each analysis/document, which staff edits carry forward,
and who owns each transition. Then choose the cycle/proposal navigation and
produce a few connected screen concepts. Do not begin by adding more tabs.

## Source map

- `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` — later meeting decisions.
- `.claude-memory/project-grant-phasing-evolution.md` — phasing history; contains
  older statements explicitly superseded by October decisions.
- `docs/REQUEST_WORKBENCH_SCOPING.md` — historical three-tier/lens design.
- `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` — document/lifecycle
  foundations; older advancement language must be read against October decisions.
- `docs/audits/product-backlog-reconciliation-2026-10-31.md` — bounded status audit.
- `docs/agent-wiki/topics/strategy-roadmap.md` — retrieval hub, not build authority.
- `docs/STAGED_REVIEW_PIPELINE.md` and `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`
  — explicitly historical designs.
- `.claude-memory/project-reviewer-panel-coverage-pilot.md` — parked boundary.
- `DEVELOPMENT_LOG.md` — dated implementation/release milestones.
- `shared/config/requestReadiness.js` — current discovery readiness predicate.

Deferred reprocessing plan is preserved on the pushed branch
`codex/proposal-package-reprocessing-plan` at e5cc38eb3, file
`docs/plans/ADMIN_PROPOSAL_PACKAGE_REPROCESSING_PLAN_2026-11-04.md`.
It is not present on main at this handoff; retrieve that branch before editing it.
