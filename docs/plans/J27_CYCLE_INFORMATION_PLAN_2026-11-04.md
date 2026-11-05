---
title: J27 cycle information plan
domain: workbench
kind: plan
status: draft
summary: Staged plan to gather, generate and deliver the information in the CSO's J27 review workbook — field contract, intake generation, packet generation, decision records and outputs — with owner-confirmed app editing, versioned Word reconciliation, packet snapshots and the Nov 15 first-slice target.
canonical: false
owner: product-engineering
related:
  - docs/plans/WORKBENCH_SINGLE_SUBMISSION_STRATEGY_BRIEF_2026-11-04.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/audits/product-backlog-reconciliation-2026-10-31.md
---

# J27 cycle information plan

Owner direction, 2026-11-04: plan all five parts now and implement in stages.
The CSO's review workbook is the specification of what the cycle must produce
(D50); the apps gather the information and deliver it as a workbook or as
better views. Present-state evidence lives in the strategy brief section
"Workbook field inventory and source analysis" and is not restated here.

This is a draft plan. Nothing here is built by being written down, and items
marked as owner questions are not decided.

## November 15 first-slice target (D13 / S1)

D13 commits December readiness by Nov 15, 2026. The Oct 31 backlog audit
records the J27 staff-state workflow as partial: the old Advancing/Set aside
field is not the J27 state, and bulk changes, flags and First Cut output were
not found (`docs/audits/product-backlog-reconciliation-2026-10-31.md`, J27
intake row). This plan's stages overlap D13 as follows.

| D13 scope item | Covered by | Status at this plan |
|---|---|---|
| J27 proposals visible in the Workbench list (R-1) | Outside this plan | See `docs/plans/J27_READY_FOR_REVIEW_VISIBILITY_PLAN_2026-11-02.md` |
| Per-proposal AI summary / Initial Assessment, suggested PD, expertise (R-3) | Stage 2 | Intake outputs split between Connor's flows (D37) and app jobs; format now defined by the CSO workbook; Initial Assessment overhaul pending |
| Staff states, settable in bulk; my/all PD filter | Stage 4 | D41 field not built |
| Triage flags and decline-note drafts (J-1) | Stages 2 and 4 | Triage reason list proposed, not final (D50) |
| Sorting/columns, MR/S&E counts, First Cut spreadsheet (J-2) | Stages 3 and 5 | Not built |

**S1 resolved — owner decision, 2026-11-05:** keep November 15, 2026 as the
target for the thin first slice: D41 staff state and bulk setting, plus intake
fields visible in the Workbench list as they arrive. Later stages follow
separately. [VERIFIED via owner response: "Keep November 15" to the first-slice
scope question.] This confirms the target and scope, not implementation
completion or verified delivery feasibility.

## Principles

1. **App editing for short fields.** Staff edit the short fields in the app,
   backed by Dataverse. Later document composition remains to be decided.
2. **Versioned agreement with Word.** Generated Word sections agree with the
   saved field values used to build that version. Later Word edits may diverge;
   flag them for human or machine-assisted reconciliation rather than let
   edits remain silently isolated in Word (F1).
3. **One recorded fact per decision.** Decisions live where Connor's flows and
   AkoyaGO users can see them (D41, D31, D35/D39); the app does not keep a
   shadow copy.
4. **People decide; AI drafts and flags.** No AI output changes a state.
5. **Shared prompts.** Every generation prompt lives once in `wmkf_ai_prompt`
   and is editable from Admin, whoever runs it (D14; Executor contract).
6. **Pinned sources.** Every generated field and packet records which source
   and version it came from, so staleness is visible.

## Stage map by the J27 calendar

Inputs follow the calendar, not the audience. Intake drafts use submitted
materials. Staff edit the resulting app fields; later summaries use the
relevant reviews and presentation material. Document assembly is a separate
decision, not a prerequisite for editing these fields.

| When | Step | Packet (CSO sheet) | Source of its prose |
|---|---|---|---|
| Dec 7–8 | Submission and intake AI pass | — | Proposal and applicant's lay abstract |
| Jan 13–14 | PD triage to ~50 | First Cut (sheet 2), to Chairs and interested Board members | Intake fields |
| Feb 10–24 | Staff narrow to ~25; Chairs decide | Semi-finalist (sheet 3) plus one-page writeups (D21) | Intake fields; writeups for the ~25 |
| Mar 10–25 | Reviews in; staff offramp | After review (sheet 3b) | Reviews, review synthesis, writeup |
| Apr 19 – May 7 | Research presentations | — | Presentation material and staff-edited app summary; document assembly later |
| May 12–13 | Ranking | Finalist (sheet 4) | Saved app fields, Proposal Ranking |
| May 27 | Board books | Board cover pages | Saved app fields; document composition to be decided |

## Part 1 — Field contract

One definition per field: format, stage produced, source, producer, audience,
edit model and freeze rule. Formats come from the CSO's row-3 notes and cell
comments.

| Field | Format | Produced | Source | Producer | Audience | Edit model |
|---|---|---|---|---|---|---|
| Short title | "To …" phrase | Intake | Proposal | Connor's flow, `grantee-title.generate` (D37/T13) | All | Stored (`wmkf_wmkfprojectdescription`) |
| Lay abstract | Plain-language paragraph | Intake | Applicant's lay abstract, proposal | Connor's flow (D37) | All | Stored; field not yet identified |
| Methods | Short paragraph replacing the old page-1 Methodology bullet (CSO note; length not specified) | Intake | Proposal | App job (open in D37) | All | Stored |
| Key personnel | Name (role), rank and department; institution only if different; short expertise; at most one closing team sentence | Intake | Proposal, personnel records | App job (open in D37) | All | Stored |
| First Cut rationale | 1–3 sentences on key impact | Intake | Proposal | App job (open in D37) | Chairs, Board | Stored and app-editable; shared packet snapshot frozen (F2) |
| Field / methods keywords | From controlled lists | Intake | Proposal | Connor's flow (D37) | Staff, packets | Stored; full lists pending |
| Triage flag and reason | One list value plus one sentence | Intake | Proposal | AI flags; staff decide (D17/D38) | Staff only | Stored |
| Staff notes | Free text | Any | Staff | Staff | Staff only, never Chairs or Board | Single editable field; no entry history (D1) |
| Reviewer summary | Opens with the scores; agreement, concerns | After review | Reviews, synthesis, writeup | Generated draft, staff edit in app | Staff, Board | Stored and app-editable (F1) |
| Offramp justification | One or two sentences | After review | Staff judgment | Staff (D50) | Staff, records | Single editable field; no entry history (D1); exact field open (D36) |
| Presentation summary | Short paragraph | After presentation | Presentation material; exact draft inputs to settle | Generated draft, staff edit in app | Board | Stored and app-editable (F1) |
| Final rationale | Impact plus rationale after review and presentation | Before ranking | Review/presentation evidence and staff judgment; exact draft inputs to settle | Generated draft, staff edit in app | Board | Stored and app-editable (F1) |
| Rank | Ordered position | Ranking | Existing Dataverse Proposal Ranking records | Ranking meetings | Board | Read from ranking records; no request-level copy (F3) |
| Recommend for | Existing invited/requested amount for now | Ranking | Existing ranking amount behavior | Ranking meetings | Board | Overrides and "Do not approve" deferred to later-cycle discussion (F3) |

### Owner decisions — 2026-11-05

[VERIFIED via owner discussion; implementation remains PLANNED.]

- **F1:** short fields are stored in Dataverse and edited in the app. Word
  documents can be assembled from them later; document composition is not
  settled. Retain the field-value baseline and corresponding generated Word
  version. Detect later Word edits and flag possible divergence for human or
  machine-assisted reconciliation. Owner expects few edits at this phase;
  that is a workload assumption, not a correctness guarantee. Exact section
  mapping, check timing, conflict handling and automation remain to design.
- **F2:** freeze the shared First Cut packet, not the editable app fields.
  Later packets use updated values; an already shared packet stays historical.
- **F3 rank:** no final rank field on the request. Read rank from existing
  Dataverse Proposal Ranking records (ordered request IDs within a round/list).
- **F3 amount:** defer amount overrides and "Do not approve" as later-cycle
  edge cases. Continue existing invited-amount/requested-amount fallback;
  neither new override controls nor amount write-back is approved here.
- **D1:** staff notes and offramp justification are single editable fields,
  without a logged entry history. Staff notes remain internal. Exact Dataverse
  field names/provisioning still need verification; platform audit settings
  were not changed or decided here.
- **I1:** use editable app fields for intake. Decide later whether an Initial
  Assessment Word document assembled from them is needed. This decision does
  not retire or remove the existing D26 document workflow.

## Part 2 — Intake generation

Split by owner, per D37 and D14.

- **Connor's on-submit flows:** short title, lay abstract, keywords, initial
  PD, clerical check, fitness flag, expertise. The app's part is the shared
  prompt, the target field and the format. Needed from Connor: target field for
  the lay abstract (none exists), confirmation that the short-title prompt is
  `grantee-title.generate` or its edit, and the keyword lists.
- **App jobs (pending the open D37 producer split):** methods, key personnel, First Cut rationale and the triage flag
  sentence. Proposed: one governed prompt over the AI Materials narrative plus
  request context, the same input shape as the existing Draft generator
  (`lib/services/pre-site-visit/proposal-core-service.js:188-215`), returning
  the CSO's formats as structured output. It runs for every complete proposal,
  not only finalists, so cost and batch behavior need sizing for ~300.
- **Test set:** the 23 D26 rows in the CSO's workbook give worked examples.
  They contain applicant data and stay outside this public repo. A prompt is
  accepted when staff judge its output against those rows, not by text
  similarity alone.
- **Initial Assessment (I1 resolved):** editable app fields are the intake
  working surface. A Word assessment assembled from them is deferred for a
  later decision; it is not a dependency for this intake work.

## Part 3 — Packet generation

A packet is a generated, version-pinned selection of fields for one audience.

- **First Cut (sheet 2), ~50:** intake fields plus program, keywords, region,
  institution type. Personalized by expertise for each Chair (J-2). Delivered
  with proposal access through magic links (D34; mechanism not designed).
  Also circulated to interested Board members (D50).
- **Semi-finalist (sheet 3):** same columns, ~25, after the Chairs meeting.
  The Grants Manager records the Chairs outcome in Dataverse (D35/D39); the
  app reads it.
- **One-page writeups (Feb 10):** reuse the Executive Summary machinery and the
  existing release-to-SharePoint path (D21). The CSO is to confirm its shape.
- **After review (sheet 3b):** reviewer summary built from the deterministic
  score sentence (`composeScoreSentence`,
  `shared/utils/review-writeup-paragraphs.js:588`), the AI review synthesis and
  staff edits; staff recommendation and offramp justification from Part 4.
- **Finalist and Board (sheet 4):** use saved, staff-edited app summaries and
  rationale. Exact Word composition remains to be decided. For generated Word
  sections, retain the field baseline, section mapping and document version;
  later edits trigger comparison/reconciliation (F1). Existing Board release
  machinery is a foundation, not proof that this new workflow exists.
- **Staleness:** when the source changes after a packet was built, the packet
  shows it as out of date; it is never silently regenerated after delivery.

## Part 4 — Decision records

| Decision | Recorded where | Status |
|---|---|---|
| Staff triage states, including First Cut (~50) and Recommend to Program Chairs (~25) | New `akoya_request` staff-state field (D41) | Not built; name and options to settle |
| Triaged | Also writes Phase I `Recommended Do Not Invite` (D31) | Not built |
| Chairs outcome | Grants Manager sets `wmkf_phaseistatus` and request status (D35/D39) | Process decided; app reads |
| Offramp after reviews | Staff decide (D50); app displays; formal status in AkoyaGO (D36) | AkoyaGO field open; justification field open |
| Invited to presentation | Possibly `wmkf_phaseiistatus` | Open (alignment log) |
| Staff notes | Single editable field associated with the request | D1 edit model decided; exact field/provisioning to verify |

D1 resolved by owner, 2026-11-05: staff notes and offramp justification are
single editable fields without a logged entry history. The exact Dataverse
fields/provisioning remain to verify. This does not authorize changing
platform-level auditing.

## Part 5 — Outputs

- **Workbook export:** a generated XLSX matching the CSO's sheets, built from
  the field contract, for any stage and filter. The existing ranking export
  (`lib/services/proposal-ranking/workbook.js`) is a pattern to follow.
- **In-app views:** the cycle list carries the same columns as sheet 1 with
  stage filters; the per-proposal workspace shows the same fields with their
  source and freshness. This is the Workbench design question in the strategy
  brief; this plan supplies its data contract.
- **Leadership delivery:** owner question O1: workbook attachments, magic-link
  views, or both, for each packet.

## Staging

| Stage | Contents | Depends on |
|---|---|---|
| 0 (thin D13 slice) | D41 staff-state field and bulk setting; intake fields visible in the Workbench list as they arrive | S1 resolved; Connor for field provisioning |
| 1 | Field contract accepted; prompt formats written | F1, F2, I1 resolved; exact field/schema contracts still to verify; F3 amount deferred |
| 2 | App intake job for methods, key personnel, First Cut rationale; Connor's flows for the rest | D37 split; test set review |
| 3a | First Cut and semi-finalist packets with workbook export and magic-link delivery | Stages 0–2; D34 design |
| 3b | After-review packet, offramp record | Part 4 field decisions |
| 3c | Finalist and Board packets from saved app fields; Word version tracking and reconciliation | F1 implementation design; D21 composition decision |
| 5 | Full workbook export and cycle/proposal views | Workbench design |

## Open owner questions

- O1 — leadership delivery form per packet.
- Carried from earlier discussion: rank per program; whether "about 50" is a
  target; the CSO's confirmation of the workbook source inference and of the
  one-page writeup shape (D21).

## Deferred decisions

- Whether an Initial Assessment Word output is needed (I1).
- Recommended-amount overrides and "Do not approve" handling later in the
  cycle (F3); no request-level rank copy is required.

## Not in scope

Reviewer finding and invitations, Program Coordinator scheduling, Field Primer
redesign, package reprocessing (deferred in the strategy brief) and any
Production write. Each stage that touches routes, tables or durable state runs
`/contract-reconcile` before build.
