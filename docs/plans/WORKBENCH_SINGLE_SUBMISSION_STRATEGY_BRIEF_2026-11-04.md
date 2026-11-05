---
title: Workbench single-submission strategy brief
domain: workbench
kind: plan
status: draft
summary: Historical planning inventory and owner direction to design the whole staff workflow before changing Workbench structure or automations.
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

## Findings from today's component review

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
