---
title: J27 cycle information plan
domain: workbench
kind: plan
status: draft
summary: Staged plan to gather, generate and deliver the information in the CSO's J27 review workbook — field contract, intake generation, packet generation, decision records and outputs — with the owner-confirmed Nov 15 first-slice target.
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

1. **One home for staff prose.** Staff write in the Word writeup. Short fields
   for packets are derived from it, not maintained as a second editable copy.
2. **Derived by default, stored by exception.** A short field is regenerated
   from its current source unless it has no other home (owner question F1).
3. **One recorded fact per decision.** Decisions live where Connor's flows and
   AkoyaGO users can see them (D41, D31, D35/D39); the app does not keep a
   shadow copy.
4. **People decide; AI drafts and flags.** No AI output changes a state.
5. **Shared prompts.** Every generation prompt lives once in `wmkf_ai_prompt`
   and is editable from Admin, whoever runs it (D14; Executor contract).
6. **Pinned sources.** Every generated field and packet records which source
   and version it came from, so staleness is visible.

## Stage map by the J27 calendar

Sources follow the calendar, not the audience. Before Feb 10 there is no
writeup, so the First Cut and semi-finalist packets are intake-sourced.

| When | Step | Packet (CSO sheet) | Source of its prose |
|---|---|---|---|
| Dec 7–8 | Submission and intake AI pass | — | Proposal and applicant's lay abstract |
| Jan 13–14 | PD triage to ~50 | First Cut (sheet 2), to Chairs and interested Board members | Intake fields |
| Feb 10–24 | Staff narrow to ~25; Chairs decide | Semi-finalist (sheet 3) plus one-page writeups (D21) | Intake fields; writeups for the ~25 |
| Mar 10–25 | Reviews in; staff offramp | After review (sheet 3b) | Reviews, review synthesis, writeup |
| Apr 19 – May 7 | Research presentations | — | Staff write the presentation section in Word |
| May 12–13 | Ranking | Finalist (sheet 4) | Final Word writeup, Proposal Ranking |
| May 27 | Board books | Board cover pages | Final Word writeup |

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
| First Cut rationale | 1–3 sentences on key impact | Intake | Proposal | App job (open in D37) | Chairs, Board | Stored; frozen until the final rationale replaces it |
| Field / methods keywords | From controlled lists | Intake | Proposal | Connor's flow (D37) | Staff, packets | Stored; full lists pending |
| Triage flag and reason | One list value plus one sentence | Intake | Proposal | AI flags; staff decide (D17/D38) | Staff only | Stored |
| Staff notes | Free text | Any | Staff | Staff | Staff only, never Chairs or Board | Stored |
| Reviewer summary | Opens with the scores; agreement, concerns | After review | Reviews, synthesis, writeup | Generated, staff edit | Staff, Board | Owner question F1 |
| Offramp justification | One or two sentences | After review | Staff judgment | Staff (D50) | Staff, records | Stored; field open (D36) |
| Presentation summary | Short paragraph | After presentation | Writeup's presentation section | Derived | Board | Owner question F1 |
| Final rationale | Impact plus rationale after review and presentation | Before ranking | Final writeup | Derived | Board | Owner question F1 |
| Rank / Recommend for | Number; dollars or "Do not approve" | Ranking | Proposal Ranking | Ranking meetings | Board | Owner question F3 |

**Owner question F1 — edit model for writeup-derived fields.** Recommended:
(a) derived views, regenerated from the current Word writeup and never edited
directly; staff fix the writeup instead. Alternative: (b) stored and editable,
with a freshness check against the writeup version they came from. The plan
assumes (a) for reviewer summary, presentation summary and final rationale,
and (b)-style stored fields only where there is no Word home (offramp
justification, staff notes, intake fields).

**Owner question F2:** do intake fields stay editable after the First Cut, or
freeze at the First Cut packet like the rationale?

**Owner question F3:** write rank and "Recommend for" back to the request, or
keep reading them from Proposal Ranking when a packet is built. "Recommend
for" also needs an editable amount; ranking uses the invited amount, falling
back to the requested amount (`lib/dataverse/adapters/proposal-ranking-source.js:196-199`).

## Part 2 — Intake generation

Split by owner, per D37 and D14.

- **Connor's on-submit flows:** short title, lay abstract, keywords, initial
  PD, clerical check, fitness flag, expertise. The app's part is the shared
  prompt, the target field and the format. Needed from Connor: target field for
  the lay abstract (none exists), confirmation that the short-title prompt is
  `grantee-title.generate` or its edit, and the keyword lists.
- **App jobs (pending the open D37 question and the Initial Assessment
  overhaul):** methods, key personnel, First Cut rationale and the triage flag
  sentence. Proposed: one governed prompt over the AI Materials narrative plus
  request context, the same input shape as the existing Draft generator
  (`lib/services/pre-site-visit/proposal-core-service.js:188-215`), returning
  the CSO's formats as structured output. It runs for every complete proposal,
  not only finalists, so cost and batch behavior need sizing for ~300.
- **Test set:** the 23 D26 rows in the CSO's workbook give worked examples.
  They contain applicant data and stay outside this public repo. A prompt is
  accepted when staff judge its output against those rows, not by text
  similarity alone.
- **Initial Assessment:** the CSO's four intake fields are a candidate
  replacement for the current four-section Word assessment. Owner question I1:
  replace it, keep both, or fold the fields into it.

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
- **Finalist and Board (sheet 4):** presentation summary and final rationale
  generated from the current Word writeup. Reading Word text server-side can
  reuse the existing DOCX text path (`lib/utils/file-loader.js`, mammoth). Each
  packet records the writeup item and revision it read. Board cover pages
  follow the existing Board release path (D21).
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
| Staff notes | New request-level field or table | Not designed |

The offramp justification and staff notes are the only staff prose that needs
a home outside Word. Owner question D1: store them on the request, or in an
app table with audit history.

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
| 1 | Field contract accepted; prompt formats written | F1–F3, I1 |
| 2 | App intake job for methods, key personnel, First Cut rationale; Connor's flows for the rest | D37 split; test set review |
| 3a | First Cut and semi-finalist packets with workbook export and magic-link delivery | Stages 0–2; D34 design |
| 3b | After-review packet, offramp record | Part 4 field decisions |
| 3c | Finalist and Board packets from Word writeups | F1; D21 path |
| 5 | Full workbook export and cycle/proposal views | Workbench design |

## Open owner questions

- F1 — derived versus stored writeup fields.
- F2 — intake field freeze at First Cut.
- F3 — rank and "Recommend for" write-back and amount editing.
- I1 — Initial Assessment: replace, keep or merge.
- D1 — home for offramp justification and staff notes.
- O1 — leadership delivery form per packet.
- Carried from earlier discussion: rank per program; whether "about 50" is a
  target; the CSO's confirmation of the workbook source inference and of the
  one-page writeup shape (D21).

## Not in scope

Reviewer finding and invitations, Program Coordinator scheduling, Field Primer
redesign, package reprocessing (deferred in the strategy brief) and any
Production write. Each stage that touches routes, tables or durable state runs
`/contract-reconcile` before build.
