---
title: Initial Assessment Controlled Production Pilot — 2026-07-30
domain: architecture
kind: audit
status: active
summary: Request 1002788 pilot evidence and deployed recovery/run-linkage fixes; interrupted-finalization and new-run production re-proof remain open.
canonical: false
cataloged: 2026-07-30
last_verified: 2026-07-30
owner: product-engineering
related:
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/atlas/dataverse-wmkf-ai-run-and-prompt.md
---

# Initial Assessment controlled production pilot — 2026-07-30

## Verdict

**PARTIAL PASS.** The controlled production rehearsal on Request `1002788`
proved the primary producer → persistence → consumer flow and exact-input
idempotency. It did not close the full pilot acceptance contract.

Two defects were found during the rehearsal:

1. post-upload recovery compares downloaded SharePoint bytes with the
   producer's pre-upload DOCX hash, but SharePoint rewrites the Office package
   during ingestion; and
2. the Initial Assessment Executor call did not pass `requestId`, so the exact
   AI run has prompt lineage but a null `wmkf_ai_request` lookup.

**[VERIFIED DEPLOYED 2026-07-30; NOT YET PRODUCTION RE-PROVED]** Production
commit `9c88a1fa` stores a `gdc1:`-tagged SHA-256 of normalized
governed `word/` package content while canonicalizing only
SharePoint-injected `customXml` relationships, and passes `requestId` to the
Executor with a fail-closed no-persistence requirement. Synthetic complement
tests passed, and a one-off check against the actual pilot packages produced
the same normalized hash for the producer and SharePoint v1 files while
distinguishing the later v2 file. Legacy untagged hashes are recoverable only
when the downloaded package bytes still match exactly; otherwise retry blocks
for operator reconciliation without another model call or upload. Production
deployment `dpl_EVPb3vTWBYSUSABJYdKAPohruyQ1` reached Ready with a clean
initial error scan.

Human opening, AutoSave, and SharePoint version creation were observed. A
substantive human content edit was not verified: visible document text remained
semantically unchanged and Foundation Opportunity still contained its required
staff-input marker.

## Evidence matrix

| Contract | Producer/source | Persistence | Consumer/readback | Result |
| --- | --- | --- | --- | --- |
| Generate canonical artifact | Signed-in Workbench generation for Request `1002788` (`feabe26f-dc1b-f111-8341-000d3a306da2`) | Registry row `fb995f0f-628c-f111-ab0f-6045bd018a07`; request pointer set to that row; SharePoint item `01G4GVMS77A2SBVPGA4VFINZFWAFIZGVFG` | Workbench showed `Ready · Draft` and opened the canonical item | PASS |
| Prompt/run/template lineage | `initial-assessment.generate` v1; template `initial-assessment-standard-business-brief` v1.0.0 | Prompt `fc8a4c3b-5e8c-f111-ab0f-7ced8d3d15a6`; run `b7ae9b17-628c-f111-ab0f-000d3a31c468`; generation key and input fingerprint persisted | Registry readback matched the generating prompt, run, template, and request | PARTIAL — historical pilot run lookup is null; future-run fix is deployed, not production-proved |
| Shared discovery contract | Same canonical registry row | Stable drive/item identity and request pointer | Per-request Workbench and `/workbench/artifacts` both listed the same artifact and Open link | PASS |
| Exact-input retry | `Refresh from current inputs` on the Ready artifact | Still one registry row; same row, run, SharePoint item, timestamps, and attempt count | UI returned the existing Ready artifact | PASS — no model call, upload, overwrite, or duplicate |
| Editable SharePoint lifecycle | Opened canonical Word file | SharePoint created version `2.0`, modified by Justin Gallivan | Current file remained reachable from both application consumers | PARTIAL — open/AutoSave proven; substantive edit not proven |
| Post-upload recovery | Pilot code compared whole-package bytes; deployed code stores a `gdc1:`-tagged normalized governed Word digest | The historical row retains an untagged legacy digest; future rows are scheme-tagged | Actual producer and SharePoint v1 packages normalize equally; later v2 differs | DEPLOYED — interrupted-finalization rehearsal pending |

## Exact persisted lineage

- Request: `1002788`, cycle `D26`
- Registry row: `fb995f0f-628c-f111-ab0f-6045bd018a07`
- Generation key:
  `39b8d76afee2d691d58372c440752b191405afb0d10c03ec3ea69e65bb8fb623`
- Input fingerprint:
  `ae7081370021beabb27655ef2edb9183b83f1bb92bc672b272b2535119424e7c`
- AI run: `b7ae9b17-628c-f111-ab0f-000d3a31c468`
  (`2026-30-07-1359`, completed, `claude-sonnet-5`)
- SharePoint drive:
  `b!GQ6TSC-650adweD3-K3oUiroCicDaexCmdFAeYY_AC0LfwP99I31QY_tw5hNNRkY`
- SharePoint item: `01G4GVMS77A2SBVPGA4VFINZFWAFIZGVFG`
- Request-relative folder:
  `1002788_FEABE26FDC1BF1118341000D3A306DA2/Artifacts/Initial Assessment`
- Initial filename:
  `1002788 Initial Assessment 39b8d76a-aeaa41e1.docx`

The upload-time registry hash was
`66d665daf8f7e2102986b90823312405d2e02875ecd5c162cd381fc08a2b6933`.
It is an untagged legacy whole-package digest; the historical Ready row does
not enter recovery, and the candidate does not misinterpret that value as a
`gdc1:` digest.
The canonical SharePoint version `1.0` download hashed to
`41717302c77229923cfdf688955720e6a5944e869f72bbec5ccaaea7ed563b34`.
Inspection of the DOCX packages showed SharePoint-added/repacked Office parts,
not an intervening staff edit. Version `2.0` later hashed to
`38cfd72648110df93629f3f6ddbe7e172dedbaa12bb0868b82925f2bb10661c1`.

## Required follow-up

1. The runtime fix is deployed. The schema-as-code field description is
   corrected on `main`, but the
   creation-only schema applicator does not update an existing Dataverse
   attribute description; that optional live metadata cleanup is separate and
   does not block the runtime fix.
2. Exercise the post-upload/final-registry-failure recovery branch and verify
   it reuses the canonical SharePoint item without another model call/upload.
3. Generate a new controlled artifact and verify the resulting
   `wmkf_ai_run.wmkf_ai_request` lookup.
4. Complete a substantive authorized staff review/edit, including Foundation
   Opportunity, and verify the saved version through both consumers.
5. Complete the broader target-library restore, recycle-bin, retention,
   permission, and milestone-snapshot checks before calling the artifact system
   production-ready.

No source proposal text or applicant-sensitive content is reproduced in this
report.
