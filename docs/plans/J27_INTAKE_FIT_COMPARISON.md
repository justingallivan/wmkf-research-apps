---
title: J27 intake fit comparison
domain: workbench
kind: plan
status: active
summary: Pair the independent ternary fit screen with P6 at intake while preserving their results and separating staff decisions.
---

# J27 intake fit comparison

## Decision

Keep both screens independent. Compare them on the same version of the intake
materials. Retain the ternary Fit Assessment and Fit Rationale on the request
and preserve their intake values in the comparison even if those fields later
change. P6 contributes six labeled concerns with its reasons and evidence.
Gray means missing evidence and counts separately from green.

## Implemented on the branch

- The governed `j27.fit-concerns.generate` prompt returns advisory concerns for
  Intake. The caller supplies Keck abstracts. Each award record has a title and
  year on its first line, then its abstract. Separate records with a blank
  line. Missing Keck abstracts or Other Support produce gray for the relevant
  concern. The P2 hint is optional and can point to proposal evidence.
- The trusted `recordJ27IntakeFitComparison` entry point takes a request GUID,
  a stable `materialsVersion`, a matching ternary receipt containing
  `materialsVersion`, `assessment`, `rationale` and `runId`, and the P6 inputs.
  The receipt must come from the independent intake run. The service checks
  the receipt against the request's current ternary fields, validates the six
  flags and their quotes, and conditionally saves a single versioned JSON
  snapshot to `wmkf_j27intakefitcomparison`. A repeat of the same pair reuses
  the saved snapshot. A concurrent update rejects the conditional save.
- The staff Workbench Proposal tab reads the snapshot and shows Overall Fit
  beside Six Fit Concerns. A missing comparison column leaves the current
  Overall Fit visible. Public reviewer and chair packet paths do not consume
  the snapshot.

## Sandbox handoff

- **Nov. 7 sandbox readback:** P1–P6 were bootstrapped as v1 and the Intake
  comparison column was applied. The prompt-only synthetic rehearsal checked
  all six published prompt contracts and ran them through Anthropic. P5 failed
  its paragraph validator on the first attempt and passed on a feedback retry
  at 86 words. P6 returned six flags with two source-matched quotations.
  Earlier stage text was passed in memory and request writes were disabled.
- **Open sandbox blocker:** The Factory request create returned Dataverse
  `0x80040265`. Exact readback confirmed no request, related email, payment,
  or document location was created. The independent ternary prompt or receipt
  remains unavailable, so the paired Dataverse run with the deployed flow is
  pending. The separate prompt-only D26 comparison ran on all 23 staff-invited
  Phase II proposals using their Phase I materials. The retired Check-in
  prompt served as the ternary proxy. Staff feedback is pending and the
  choice of fit screen remains open.
- **Connor:** Confirm the deployed ternary flow, the run identifier it can
  return, and the common intake materials version. Verify sandbox permissions
  and flow triggers for the comparison field and coordinate a trusted
  invocation path for the comparison service. No Power Automate caller is
  connected yet.
- **Justin:** Verify that the staff Workbench displays the captured ternary
  assessment and all six concerns, that missing sources show Cannot assess,
  and that review evidence stays out of chair and applicant surfaces. Keep
  PD-confirmed concerns, comments, and any staff overall-fit judgment separate
  from both AI outputs. That staff decision capture remains to be wired.
- **Rehearsal:** Use synthetic complete, missing-Other-Support, and known-Keck-
  overlap packets. Compare which material concerns each screen surfaces,
  misses, or raises without evidence. The paired Intake run has not yet been
  rehearsed with the actual flow and Dataverse.

First Cut P6 and any matched First Cut ternary run are later work. Preserve
the Intake snapshot when those stages are added.


## First Cut Field Analysis (P8)

**Resume status:** Justin parked the implementation follow-up for the next
session. Revisit the handoff responsibilities before starting provisioning,
source verification, the staff panel, or automation.

**Implemented on this branch:** The governed `j27.field-analysis.generate`
prompt drafts State of play, Novelty, and Claims checked in at most 600
words. It returns open questions and PD notes separately. The sandbox
catalog has current v1 and its definition matches the branch. The trusted
`searchJ27FieldAnalysisLiterature` service uses the existing OpenAlex and
PubMed adapters and distinguishes provider failure from zero results.
Search results are leads. The trusted `generateJ27FieldAnalysis` caller
must supply checked source records, a verified submission date, the
narrative, bibliography, Summary answers, and the intake question list.
The service validates reference order and identifiers against the checked
sources and fills the bibliography from those records.

**Planned storage and use:** A dedicated staff-only request memo,
`akoya_request.wmkf_ai_fieldanalysis`, holds the current brief and references
with materials version, run ID, and prompt version. Open questions and PD
notes are separate structured lists, with stage and run attribution when
combined with other review signals. Keep these lists out of the brief and
chair-facing read paths. Build the report header from the request's official
institution, request number, PI, and applicant title. Validate a replacement
before saving and condition the write on the request version. The Field Primer has its own prompt,
memo, readers, and exports. A checked P8 result can feed P9 and the First
Cut rationale, and can support a targeted P2 revision when a claim fails.
The P6 follow-on depends on the fit decision.

### Connor

- Confirm the authoritative applicant submission timestamp and whether it
  is stable when an applicant replaces a file. Verify the J27 Summary
  field mappings and their availability in sandbox.
- Agree on where the P2–P4 open questions are handed off with their prompt
  and materials version. Confirm how a completed First Cut decision can be
  detected for eventual automation without triggering duplicate runs.
- Coordinate sandbox provisioning and permissions for the planned
  `wmkf_ai_fieldanalysis` field. The P8 call is
  `j27.field-analysis.generate`, which turns checked literature and intake
  context into a staff-only brief. It expects evidence assembled by the
  app or trusted caller before invocation. Reuse the trusted P8 service
  for reference validation and bibliography assembly before saving.

### Justin

- Add a separate staff-only Field Analysis panel and manual generation
  entry point at First Cut. Reuse the proposal and bibliography loader
  and the Primer's display and export patterns. Show source links, open
  questions, and PD notes separately.
- Connect the literature lead search to a source-opening and verification
  step. Capture verified first-public dates and supporting passages and
  distinguish abstract-level evidence from full text. Test a preprint
  timing case and a claim that requires opening the paper.
- Wire validated save and readback for the dedicated memo and a separate
  read path for each review-signal list. Pass the saved brief to the
  approved downstream prompts. Confirm staff-only access and keep
  automation gated on the manual rehearsal.
