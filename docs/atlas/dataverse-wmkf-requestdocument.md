---
title: Dataverse wmkf_requestdocument
domain: application-state
kind: atlas
status: active
summary: Governed request-artifact registry and Initial Assessment pilot data flow; the controlled Request 1002788 rehearsal proved generation, consumers, and exact retry while exposing a recovery-hash defect.
canonical: false
owner: product-engineering
related:
  - lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json
  - lib/dataverse/adapters/request-document.js
  - lib/services/initial-assessment/artifact-service.js
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
---

# `wmkf_requestdocument`

## Status

**[VERIFIED 2026-07-29 via repository source]** Schema-as-code, adapter, producer,
read API, Workbench panel, and cycle-wide pilot locator are implemented on the
Initial Assessment pilot branch. The full Editor Dashboard remains planned.

**[VERIFIED 2026-07-30 via production Wave 16 apply and idempotent read-only
rerun]** The entity, attributes, five relationships, generation-key alternate
key, and `akoya_request.wmkf_CurrentInitialAssessment` pointer are live in
Production.

**[VERIFIED 2026-07-30 via controlled production generation and exact
readback]** Request `1002788` now has one Ready/Draft registry row
`fb995f0f-628c-f111-ab0f-6045bd018a07`; its
`wmkf_CurrentInitialAssessment` pointer resolves to that row. The row preserves
the prompt, template, AI-run, input, cycle, and stable Graph item lineage and is
visible from both the request Workbench and cycle-wide locator.

**[VERIFIED 2026-07-30 via GitHub merge status, Vercel inspection, production
alias probes, and error-log scan]** PR #102 merged as `1e958ee0`; production
deployment `dpl_AxxroabhpXLX1pz75MW6486fB4ci` is Ready on the expected aliases.
The new route fails closed to sign-in when unauthenticated, and the initial
post-deploy error scan was clean.

**[PARTIAL PILOT 2026-07-30]** A same-input UI retry returned the existing
Ready row without another run, upload, overwrite, or duplicate. Opening the
canonical Word file created a native SharePoint version. The broader pilot is
not complete: no substantive staff content edit was verified, and the
post-upload recovery hash contract is invalid for this library because
SharePoint rewrites the DOCX package during ingestion. Exact evidence:
`docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md`.

## Ownership

- SharePoint owns editable Word bytes and native version history.
- `wmkf_requestdocument` owns the request/cycle relationship, typed artifact and
  lifecycle state, producer operation state, stable Graph site/drive/item
  identity, current eTag/version metadata, and prompt/run/input/template/content
  provenance.
- `akoya_request.wmkf_CurrentInitialAssessment` is the request-level canonical
  pointer and shared concurrency fence for Initial Assessment activation.
- Workbench and the pilot locator consume the same registry row; neither joins
  by filename. The planned full Editor Dashboard will reuse this identity
  contract.

## Initial Assessment pilot contract

- Artifact type: `Initial Assessment`.
- SharePoint library: the request's single Dynamics-tracked active
  `akoya_request` drive.
- Request-relative destination: `Artifacts/Initial Assessment/`.
- Prompt: `initial-assessment.generate`, version 1.
- Template: `initial-assessment-standard-business-brief`, version `1.0.0`.
- AI-authored fields: Summary, Significance & Impact, Research Plan, Team
  Expertise.
- Staff-owned field: Foundation Opportunity. It is absent from the prompt
  output schema and visibly marked `STAFF INPUT REQUIRED` by the DOCX template.

## Retry and partial-success behavior

`wmkf_generationkey` is a SHA-256 alternate key over request, artifact type,
authoritative input fingerprint, prompt identity/version, and template
identity/version. A Ready row returns without another model call or SharePoint
upload. A failed/stale operation can reclaim by ETag. If SharePoint upload
succeeded but the final registry PATCH failed, the row retains the expected
producer content hash and deterministic target. The intended retry downloads
the item, verifies the hash, and finalizes stable identity without rerunning
AI. **That recovery branch is not currently safe in Production:** SharePoint
rewrites Office package bytes during upload, so its canonical version `1.0`
already differs from the pre-upload producer hash. Until a canonical
post-upload hash (or explicit dual-hash contract) is persisted, recovery will
misclassify an untouched upload as changed. If the
existing item's bytes no longer match, the producer retains its exact
drive/item identity for operator cleanup and generates to a fresh
claim-specific filename instead of overwriting the changed file or dead-ending
every retry.

Changed authoritative inputs or cycle create a distinct generation row. Its
Ready transition, the supersession of prior Ready rows, and the
`akoya_request.wmkf_CurrentInitialAssessment` pointer commit atomically in one
ETag-guarded Dataverse changeset. The request ETag is the shared fence across
different generation rows, so concurrent first-time activations cannot both
become canonical. If authoritative inputs revert, the exact earlier Ready
artifact is atomically reactivated rather than returned as Superseded.
Workbench/pilot-locator reads resolve the current Ready artifact through that
pointer
while exposing a newer pending/failed replacement separately. A claimant that
loses ownership after uploading deletes its exact claim-specific item; if
Graph deletion fails, exact drive/item cleanup work is retained in bounded
registry JSON and surfaced by the read model. The queue has no automated drain
yet. If its primary field reaches capacity, the exact new identity is written
to a dedicated overflow field and further generation for that deterministic
artifact is blocked until an operator resolves the cleanup; unresolved
identifiers are never silently evicted. Ordinary post-upload registry failures
retain their item for recovery after the canonical SharePoint hash contract is
corrected.

The governed writer requires positive resolution of the Dynamics-tracked
`akoya_request` parent library; it does not inherit the shared read helper's
best-effort library fallback. The route never returns success until a registry
read-back confirms `Ready`, stable drive/item IDs, and the atomic lineage
transition.

## Deployment/probe sequence

1. **Completed 2026-07-30:** name Production as the schema/prompt target.
2. **Completed 2026-07-30:** run
   `node scripts/preflight-request-document-table.mjs --target=prod`.
3. **Completed 2026-07-30:** with every artifact absent, run
   `node scripts/apply-dataverse-schema.js --target=<target> --wave=16-request-document-registry --execute`.
4. **Completed 2026-07-30:** re-run the preflight and verify the expected entity-set name
   `wmkf_requestdocuments` and request lookup
   `akoya_request.wmkf_CurrentInitialAssessment`.
5. **Completed 2026-07-30:** seed `initial-assessment.generate` with
   `node scripts/seed-initial-assessment-prompt.js --execute`.
6. **Completed 2026-07-30:** merge PR #102 and verify production deployment
   `dpl_AxxroabhpXLX1pz75MW6486fB4ci` Ready.
7. **Partially completed 2026-07-30:** Request `1002788` generation, lineage,
   both consumers, Word opening/version creation, and exact-input retry passed.
   Recovery-hash correction, request-linked AI-run proof, substantive human
   editing, and target-library protection checks remain open.

No live command in this sequence is authorized merely by this page.
