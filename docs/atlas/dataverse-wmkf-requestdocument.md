---
title: Dataverse wmkf_requestdocument
domain: application-state
kind: atlas
status: planned-live
summary: Governed request-artifact registry schema and pilot data flow; not yet provisioned in a named Dataverse environment.
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

**[NOT YET VERIFIED LIVE]** The entity, relationships, alternate key, prompt
row, SharePoint write, and pilot artifact have not been provisioned or exercised
in a named environment. Do not infer a live entity-set count or production
read/write capability from the source implementation.

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
content hash and deterministic target; retry downloads the item, verifies the
hash, and finalizes the stable item identity without rerunning AI.

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
registry JSON. Ordinary post-upload registry failures retain their item for
hash-verified recovery.

The governed writer requires positive resolution of the Dynamics-tracked
`akoya_request` parent library; it does not inherit the shared read helper's
best-effort library fallback. The route never returns success until a registry
read-back confirms `Ready`, stable drive/item IDs, and the atomic lineage
transition.

## Deployment/probe sequence

1. Name the pilot Dataverse target and proposal/testers.
2. Run `node scripts/preflight-request-document-table.mjs --target=<target>`.
3. If every artifact is absent or exact, run
   `node scripts/apply-dataverse-schema.js --target=<target> --wave=16-request-document-registry --execute`.
4. Re-run the preflight and verify the expected entity-set name
   `wmkf_requestdocuments` and request lookup
   `akoya_request.wmkf_CurrentInitialAssessment`.
5. Seed `initial-assessment.generate` with
   `node scripts/seed-initial-assessment-prompt.js --execute`.
6. Exercise one authorized end-to-end pilot, including an intentional retry.

No live command in this sequence is authorized merely by this page.
