---
title: Pre-Site Visit proposal-core local implementation record
domain: request-workbench
kind: audit
status: current
summary: Guarded local proposal-core producer, retained-template renderer, authenticated direct download, and read-only live evidence; no prompt seed or model call.
owner: product-engineering
---

# Pre-Site Visit proposal-core local implementation record

## Scope

Sweep mode: Mode A (changed implementation fact). The proposal-derived core,
Word renderer, authenticated API route, and Workbench direct-download tab are
now implemented locally. This record does not claim that the full Pre-Site
document lifecycle is production-live.

## Evidence matrix

| Claim | Producer/entry point | Persistence/source | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|
| Exact proposal input | `loadPreSiteVisitInputs` | SharePoint `akoya_request/AI Materials/ProposalNarrative_{Request#}.pdf` | prompt override | shared exact-file helper plus read-only Request `1002379` probe (33,011 extracted characters) | VERIFIED |
| Authoritative metadata and roster | `loadPreSiteVisitInputs` | `akoya_request`, applicant `account`, Co-PI junction | prompt context and DOCX fields | source, focused tests, live read-only Request `1002379` (Christoph Gorgulla; Daniel Blair) | VERIFIED |
| Eight-field governed call | `generatePreSiteVisitProposalCore` | current prompt row when later provisioned; normal `wmkf_ai_run` attempt | returned `proposalCore` | source/tests assert prompt name, security substrings, and `requireNoPersistence:true` | VERIFIED in source/test; prompt row PLANNED |
| Version-1 Word render | `renderPreSiteVisitDocx` | tracked retained DOCX template; returned Buffer only | future artifact producer | original/final 30-part package inventory, focused tests, three-page LibreOffice render | VERIFIED locally |
| Manual sections preserved | DOCX renderer | retained template placeholders | PD in Word | rendered pages retain graphical abstract/caption, recommendation, referee, presentation, and funding-history slots | VERIFIED |
| Interim staff download | `PreSiteVisitTab` → `POST /api/workbench/pre-site-visit` | returned DOCX bytes; normal Executor AI-run audit attempt only | browser download | route/component focused tests cover access, strict input, binary response, errors, and request-switch cancellation | VERIFIED locally |
| Full lifecycle | direct download only | no writeup registry row/upload/pointer | no shared artifact consumer | source inventory and negative contract tests | PARTIAL |

## Probe result

On 2026-08-16, `scripts/probe-pre-site-visit-source.mjs --request 1002379`
resolved one active request and the exact file
`ProposalNarrative_1002379.pdf`. It extracted 33,011 characters, returned
`Memphis, TN`, found one PI and one Co-PI in order, and found every Word
metadata field populated. The probe is read-only and does not call a model.

On the same date, the create-only prompt seed's live `--dry-run` returned
`action=create version=1`. This verifies that Dataverse has no existing row for
`pre-site-visit.proposal-core.generate`; it made no write and called no model.

## Deliberately not performed

- The create-only prompt seed was not executed.
- Claude was not called.
- No Dataverse business field, request-document registry row, request pointer,
  or SharePoint output was created.
- No review-layer merge or distribution workflow was added. The new Workbench
  control downloads the generated DOCX locally and is not a durable artifact.

The local file `outputs/pre-site-visit-1002379/Phase II Pre-Site Visit Writeup
TEST 1002379.docx` is a layout fixture whose generated sections explicitly say
that Claude was not run; it is not a proposal analysis or distributable draft.
