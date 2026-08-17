---
title: Pre-Site Visit proposal-core controlled implementation record
domain: request-workbench
kind: audit
status: current
summary: Guarded proposal-core producer, governed prompt v3, controlled Request 1002379 generation and render evidence, and an unpromoted direct-download slice.
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
| Eight-field governed call | `generatePreSiteVisitProposalCore` | sole-current prompt v3 plus append-only `wmkf_ai_run` on Executor calls | returned `proposalCore` | exact live v3 prompt readback; latest controlled completed Executor run `5bd65180-ed99-f111-b8db-7ced8d6e2f44` used v2; source/tests assert prompt name, security substrings, and `requireNoPersistence:true` | VERIFIED |
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
and only the intentionally manual/future placeholders remained. A subsequent
formatting correction set explicit 6 pt after-spacing on all four first-page
list paragraphs and removed the empty paragraph immediately before the first
manual page break; package comparison showed only `word/document.xml` changed
and the four-page render remained stable.

## Prompt v3 publication and controlled render result

On 2026-08-16, a further local prompt/renderer revision was implemented,
verified, and published through the signed-in Admin versioning path as
sole-current v3 `f2c9ce97-f499-f111-b8db-7ced8d6e2f44`. The exact live v3
system prompt and body matched the tracked recovery source; the publisher
cloned v2's variables, output schema, model (`claude-sonnet-4-6`), temperature,
and token budget. The prompt asks
`backgroundAndImpact` and `detailedMethodology` to aim for 500-600 words
combined so they normally fit together on one Word page, while preserving
scientific clarity as the higher priority. It limits `personnelDetails` to
approximately 140-180 words, prohibits academic degree credentials, and
requires the role abbreviations `PI` and `co-PI`.

The renderer now receives the authoritative Dataverse roster separately from
the model output. It underlines exact roster names in both the first-page
Personnel overview and the detailed Personnel paragraph, fails if either
section omits a roster member, and leaves surrounding prose and role
abbreviations un-underlined. Focused tests, prompt/API gates, TypeScript, and
the production build passed. A read-only Request `1002379` fixture rendered three clean pages
and structurally showed underlines only on Christoph Gorgulla and Daniel Blair.

The version-preserving publication dry run first resolved the next Dataverse
prompt version as v3. A local-to-production seed write was denied by the
Dataverse target interlock (`local deployment must not write production`), as
designed, and the signed-in Admin publisher then created v3. A direct exact-v3
Request `1002379` model/render QA used the live prompt fields and the same
untrusted-content boundaries as the Executor without attempting a prohibited
local Dataverse audit write. It produced 574 words across Background & Impact
and Methodology and 145 words for Personnel. The personnel output contained
both authoritative names in order, used PI/co-PI, and contained no degrees or
spelled-out role names. OOXML and rendered-page inspection confirmed that only
Christoph Gorgulla and Daniel Blair were underlined in both the first-page
Personnel overview and the detailed Personnel paragraph.

The v3 DOCX otherwise rendered cleanly on four Letter pages, but the final
Methodology sentence spilled from page 3 onto page 4. The one-page
Background/Methodology instruction therefore improved the layout but did not
fully meet its soft target on this test. The v3 file is retained for owner
inspection and is not yet marked as the accepted canonical render. Because the
direct QA did not use `executePrompt`, it created no `wmkf_ai_run`; accepted v2
run `5bd65180-ed99-f111-b8db-7ced8d6e2f44` remains the latest governed Executor
evidence.

## Deliberately not performed

- No Dataverse business field, request-document registry row, request pointer,
  or SharePoint output was created.
- No v3 `wmkf_ai_run` was created by the direct transport/render QA.
- The branch was not promoted and the signed-in Workbench route was not
  production-smoked.
- No review-layer merge or distribution workflow was added. The new Workbench
  control downloads the generated DOCX locally and is not a durable artifact.

The accepted controlled output is
`outputs/pre-site-visit-1002379/Phase II Pre-Site Visit Writeup CONTROLLED v2
1002379.docx` (SHA-256
`0ff05a0304ca69d9fb3a4789911dedc26354120a3af007819db9ff96da1205d3`).
It is a local controlled draft, not a registered or distributed artifact.

The owner-inspection v3 output is
`outputs/pre-site-visit-1002379/Phase II Pre-Site Visit Writeup CONTROLLED v3
1002379.docx` (SHA-256
`dab712ba62f75ba244354a5bd92b2dc6813bf3d2c603611c975ec47d835f7d64`).
It is likewise local and non-durable, and its observed Methodology spill is
recorded above rather than hidden as an accepted result.
