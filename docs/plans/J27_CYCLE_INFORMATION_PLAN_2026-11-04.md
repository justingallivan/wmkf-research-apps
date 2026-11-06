---
title: J27 cycle information plan
domain: workbench
kind: plan
status: draft
summary: Staged plan to gather, generate and deliver the information in the CSO's J27 review workbook — field contract, intake generation, packet generation, decision records and outputs — with owner-confirmed app editing, versioned Word reconciliation, packet snapshots and the Nov 15 first-slice target; status/workspace design remains open pending colleague input.
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

## J27 Phase I app implementation order

Justin owns the app. The first build is a single-proposal First Cut decision in
the Workbench Proposal tab. The lead PD or a superuser can save Yes (Scored,
`100000004`) or No (Not Scored, `100000005`) to `akoya_request.wmkf_phaseistatus`.
Blank, Pending Committee Review, Scored and Not Scored are editable starting
states. Other statuses are read-only. [VERIFIED via owner decision and
Production Dataverse choice metadata.] The server must reject stale row
versions and keep final invitation decisions with the Grants Manager.

Semi-finalist follows after verifying the J27 draft-email triggers and deciding
whether staff need to retain the original First Cut answer. A recommendation
replaces the same status field and makes First Cut read-only. Connor owns the
intake AI summary, fit flag, fit rationale and draft staff rationale. Initial
Assessment, disposition reason and staff rationale saves depend on the shared
field contract. Bulk changes, queues and packet exports are later work. The
November 15 scope below was set for the earlier slice and needs reconfirmation.

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
| Staff states, settable in bulk; my/all PD filter | Stage 4 | Status/workspace model reopened Nov 5 pending colleague input; earlier D41 is not a frozen build specification |
| Triage flags and decline-note drafts (J-1) | Stages 2 and 4 | Triage reason list proposed, not final (D50) |
| Sorting/columns, MR/S&E counts, First Cut spreadsheet (J-2) | Stages 3 and 5 | Not built |

**S1 resolved — owner decision, 2026-11-05:** keep November 15, 2026 as the
target for the thin first slice: D41 staff state and bulk setting, plus intake
fields visible in the Workbench list as they arrive. Later stages follow
separately. [VERIFIED via owner response: "Keep November 15" to the first-slice
scope question.] This confirms the target and scope, not implementation
completion or verified delivery feasibility. The later Nov 5 discussion left
the status/workspace design open, so the exact first-slice implementation
contract still needs colleague input.

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

## Stage map by the J27 calendar (unchanged; awaiting calendar revision)

Owner direction, 2026-11-05: leave the schedule unchanged; January 6 remains
in play. The CSO email discusses January 6/13 triage and moving toward First
Cut around January 20, but this is not authority to move the existing dates.
Use the calendar to anchor work once revisions are settled.

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
| AI concern / primary triage reason | Distinct advisory concern and staff reason concepts; exact fields/options open | Intake and staff meetings | Proposal and staff judgment | AI flags concerns; staff decide | Staff only | Status, attention fields and workspace views pending colleague input |
| Staff notes | Free text | Any | Staff | Staff | Staff only, never Chairs or Board | Single editable field; no entry history (D1) |
| Reviewer summary | Opens with the scores; agreement, concerns | After review | Reviews, synthesis, writeup | Generated draft, staff edit in app | Staff, Board | Stored and app-editable (F1) |
| Offramp justification | One or two sentences | After review | Staff judgment | Staff (D50) | Staff, records | Single editable field; no entry history (D1); exact field open (D36) |
| Presentation summary | Short paragraph | After presentation | Presentation material; exact draft inputs to settle | Generated draft, staff edit in app | Board | Stored and app-editable (F1) |
| Final rationale | Impact plus rationale after review and presentation | Before ranking | Review/presentation evidence and staff judgment; exact draft inputs to settle | Generated draft, staff edit in app | Board | Stored and app-editable (F1) |
| Rank | Program position and combined position | Ranking | Existing Dataverse Proposal Ranking records | Ranking meetings | Board | Read from ranking records; no request-level copy (F3) |
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
  Plan to show both within-program and combined ranks in leadership packets
  (owner, 2026-11-05); the owner may revise this presentation choice later.
  Exact source lists/revisions and derivation still need verification before
  implementation.
- **F3 amount:** defer amount overrides and "Do not approve" as later-cycle
  edge cases. Continue existing invited-amount/requested-amount fallback;
  neither new override controls nor amount write-back is approved here.
- **First Cut size:** "about 50" is a flexible planning target, not an
  app-enforced limit (owner, 2026-11-05).
- **O1:** plan both workbook delivery and a magic-link browser view for
  leadership packets, using the same frozen packet content (F2). Exact access,
  sharing and delivery mechanics remain to design.
- **D1:** staff notes and offramp justification are single editable fields,
  without a logged entry history. Staff notes remain internal. Exact Dataverse
  field names/provisioning still need verification; platform audit settings
  were not changed or decided here.
- **I1:** use editable app fields for intake. Decide later whether an Initial
  Assessment Word document assembled from them is needed. This decision does
  not retire or remove the existing D26 document workflow.

## CSO email and owner follow-up — received in chat 2026-11-05

[VERIFIED via email text supplied by Justin; no attachment was read this
session. This is product guidance, not implementation evidence.]

- Claude made the workbook mockup from current-cycle writeups. This broadly
  confirms the D26 source inference; it does not certify every field's exact
  lineage or settle the final document template.
- The discussed format removes the separate executive-summary impact bullet,
  embedding impact in the abstract and rationale. The hope is to generate the
  short content on the first intake pass, using an impact statement as the
  initial rationale, with PD editing as the cycle proceeds. Exact lengths,
  prompt/input contracts and generation timing remain to verify/design.
- By Dec 9 the hoped-for intake includes concern flags, keywords, lay abstract,
  short title, lead-PD expertise suggestions, Board experts and possible
  consultant needs. PDs check concerns first and can identify other proposals
  for triage; staff aim to touch every proposal in meetings. A separate primary
  triage reason list needs group discussion. Consultant tracking was suggested;
  its exact field/UI is not approved yet.
- First Cut recipients receive the First Cut sheet only, without the internal
  log, with a link to each full proposal. The email asks about up to 50 links;
  link access/content needs implementation verification. O1 still plans both
  workbook and browser delivery from the same packet snapshot.
- For the Chairs meeting, Sarah sends an updated tracking sheet with brief
  staff rationale and assembles the Diligent book. Cover sheets reuse the same
  information. Connor is mocking up the reduced Chairs proposal; omission of
  bios/support documents is tentative in the email. Exact cover-sheet shape,
  proposal contents and approvals remain open. The email's maybe 18–24
  shortlist is guidance, not a new enforced count or calendar change.

### Open workflow/status design — owner hold

[VERIFIED via owner follow-up, 2026-11-05.] Justin distinguished (1) making a
workspace of about 300 proposals tractable, with views limited to the current
work/discussion, from (2) recording the proposal's lifecycle standing. Leave
statuses, staff workflow markers and workspace views open pending colleague
input. The earlier Submitted / Flagged for concerns / Triaged / Under
consideration / Recommend to Program Chairs / Invited for Peer Review / Not
invited list remains an earlier proposal, not the accepted implementation
contract. Neither proposed/confirmed triage states nor the assistant's later
single-field simplification was adopted. Staff generally record the meeting's
result rather than process history; this does not settle the necessary queues,
attention fields or lifecycle representation. D1's simple notes/justification
editing decision remains separate.

## Part 2 — Intake generation

Split by owner, per D37 and D14.

- **Connor's on-submit flows:** short title, lay abstract, keywords, initial
  PD, clerical check, fitness flag, expertise. The app's part is the shared
  prompt, the target field and the format. Needed from Connor: target field for
  the lay abstract (none exists), confirmation that the short-title prompt is
  `grantee-title.generate` or its edit, and the keyword lists.
- **App jobs (pending the open D37 producer split):** methods, key personnel, First Cut rationale and the AI concern
  explanation; exact concern/reason split awaits colleague input. Proposed: one governed prompt over the AI Materials narrative plus
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

- **First Cut (sheet 2), ~50 (flexible target; no enforced limit):** intake
  fields plus program, keywords, region,
  institution type. Personalized by expertise for each Chair (J-2). Delivered
  with proposal access through magic links (D34; mechanism not designed).
  Also circulated to interested Board members (D50). Per the CSO email,
  exclude the internal log and include per-proposal links; access must be
  verified before delivery.
- **Semi-finalist (sheet 3):** same columns, ~25, after the Chairs meeting.
  The Grants Manager records the Chairs outcome in Dataverse (D35/D39); the
  app reads it.
- **One-page writeups (Feb 10):** reuse the Executive Summary machinery and the
  existing release-to-SharePoint path (D21). The email describes a cover sheet reusing tracking fields ahead of reduced
  proposal materials, with Connor preparing mockups. Exact shape and contents
  remain to settle; no new date is approved.
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
| Staff triage states, including First Cut (~50) and Recommend to Program Chairs (~25) | New `akoya_request` staff-state field (D41) | Earlier D41 proposal; status/workspace contract reopened pending colleague input |
| Triaged | Earlier D31 proposes Phase I `Recommended Do Not Invite` write | Not built per prior audit; revisit against accepted status model before build |
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
- **Leadership delivery (O1 resolved, owner 2026-11-05):** provide both a
  downloadable workbook and a magic-link browser view for leadership packets.
  Both represent the same frozen packet content, with linked proposal access
  in the browser. Exact sharing, access and delivery mechanics remain to
  design; this is PLANNED, not a deployed capability.

## Staging

| Stage | Contents | Depends on |
|---|---|---|
| 0 (thin D13 slice) | D41 staff-state field and bulk setting; intake fields visible in the Workbench list as they arrive | S1 target retained; colleague input on status/workspace model; Connor provisioning |
| 1 | Field contract accepted; prompt formats written | F1, F2, I1 resolved; exact field/schema contracts still to verify; F3 amount deferred |
| 2 | App intake job for methods, key personnel, First Cut rationale; Connor's flows for the rest | D37 split; test set review |
| 3a | First Cut and semi-finalist packets with workbook export and magic-link delivery | Stages 0–2; D34 design |
| 3b | After-review packet, offramp record | Part 4 field decisions |
| 3c | Finalist and Board packets from saved app fields; Word version tracking and reconciliation | F1 implementation design; D21 composition decision |
| 5 | Full workbook export and cycle/proposal views | Workbench design |

## Open owner questions

- Statuses, workflow markers and workspace views: owner awaiting colleague
  input; do not freeze the earlier list or add process history by assumption.
- Intake field formats/lengths, primary triage reasons and consultant tracking.
- Exact Chairs cover-sheet shape and reduced proposal contents (D21); Connor
  mockups remain to inspect. The email broadly confirms the workbook source.
- Revised calendar once settled; keep dates unchanged in the meantime.

## Deferred decisions

- Whether an Initial Assessment Word output is needed (I1).
- Recommended-amount overrides and "Do not approve" handling later in the
  cycle (F3); no request-level rank copy is required.

## Not in scope

Reviewer finding and invitations, Program Coordinator scheduling, Field Primer
redesign, package reprocessing (deferred in the strategy brief) and any
Production write. Each stage that touches routes, tables or durable state runs
`/contract-reconcile` before build.
