---
title: Pre-Site Visit proposal-core controlled implementation record
domain: request-workbench
kind: audit
status: current
summary: Guarded proposal-core producer, governed prompt v2, controlled Request 1002379 generation, accepted Word render, and an unpromoted direct-download slice.
owner: product-engineering
---

# Pre-Site Visit proposal-core controlled implementation record

## Scope

Sweep mode: Mode A (changed implementation and live prompt facts). The
proposal-derived core, Word renderer, authenticated API route, and Workbench
direct-download tab are implemented locally. The governed prompt is live and
a controlled Request `1002379` model/render run passed acceptance. This record
does not claim that the branch, signed-in route, or full Pre-Site document
lifecycle is production-live.

## Evidence matrix

| Claim | Producer/entry point | Persistence/source | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|
| Exact proposal input | `loadPreSiteVisitInputs` | SharePoint `akoya_request/AI Materials/ProposalNarrative_{Request#}.pdf` | prompt override | shared exact-file helper plus read-only Request `1002379` probe (33,011 extracted characters) | VERIFIED |
| Authoritative metadata and roster | `loadPreSiteVisitInputs` | `akoya_request`, applicant `account`, Co-PI junction | prompt context and DOCX fields | source, focused tests, live read-only Request `1002379` (Christoph Gorgulla; Daniel Blair) | VERIFIED |
| Eight-field governed call | `generatePreSiteVisitProposalCore` | sole-current prompt v2 plus append-only `wmkf_ai_run` | returned `proposalCore` | exact live prompt readback; controlled completed run `5bd65180-ed99-f111-b8db-7ced8d6e2f44`; source/tests assert prompt name, security substrings, and `requireNoPersistence:true` | VERIFIED |
| Versioned Word render | `renderPreSiteVisitDocx` | tracked retained DOCX template; returned Buffer only | direct browser download | 30-part package inventory, focused tests, canonical four-page render, placeholder scan | VERIFIED locally |
| Manual sections preserved | DOCX renderer | retained template placeholders | PD in Word | rendered pages retain graphical abstract/caption, recommendation, referee, presentation, and funding-history slots | VERIFIED |
| Interim staff download | `PreSiteVisitTab` → `POST /api/workbench/pre-site-visit` | returned DOCX bytes; normal Executor AI-run audit attempt only | browser download | route/component focused tests cover access, strict input, binary response, errors, and request-switch cancellation | VERIFIED locally |
| Full lifecycle | direct download only | no writeup registry row/upload/pointer | no shared artifact consumer | source inventory, negative contract tests, and controlled-run write inventory | PARTIAL |

## Probe result

On 2026-08-16, `scripts/probe-pre-site-visit-source.mjs --request 1002379`
resolved one active request and the exact file
`ProposalNarrative_1002379.pdf`. It extracted 33,011 characters, returned
`Memphis, TN`, found one PI and one Co-PI in order, and found every Word
metadata field populated. The probe is read-only and does not call a model.

The create-only seed then published v1
`cbf1bc38-ec99-f111-b8db-6045bd008868` with reviewed
`claude-sonnet-4-6`. Controlled run
`aa3f53cb-ec99-f111-b8db-70a8a59cded0` completed at the model boundary, but
the generated overview overflowed the intended first-page region and displaced
later page starts. The document was rejected during canonical render QA; the
append-only AI run remains as historical evidence.

Version-preserving publication created sole-current v2
`1d276948-ed99-f111-b8db-70a8a59cded0` with tighter overview limits and exact
tracked body/system/variables/schema/model/settings readback. Controlled run
`5bd65180-ed99-f111-b8db-7ced8d6e2f44` then generated the final Request
`1002379` DOCX. Canonical rendering produced four Letter pages with the
summary contained on page 1, graphical-abstract placeholders on page 2, and
detailed content beginning on page 3. The package retained all 30 OOXML parts,
and only the intentionally manual/future placeholders remained.

## Deliberately not performed

- No Dataverse business field, request-document registry row, request pointer,
  or SharePoint output was created.
- The branch was not promoted and the signed-in Workbench route was not
  production-smoked.
- No review-layer merge or distribution workflow was added. The new Workbench
  control downloads the generated DOCX locally and is not a durable artifact.

The accepted controlled output is
`outputs/pre-site-visit-1002379/Phase II Pre-Site Visit Writeup CONTROLLED v2
1002379.docx` (SHA-256
`41937e2aaefc035797b7e1736894a2497ff60009c403392d37e45be191be3840`).
It is a local controlled draft, not a registered or distributed artifact.
