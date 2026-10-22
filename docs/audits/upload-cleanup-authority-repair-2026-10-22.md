---
title: "Portal Upload Cleanup Authority Repair"
domain: "portal-upload-staging"
kind: "bounded-audit"
status: "documentation-reconciliation"
summary: "Reconciles upload-staging cleanup scope proofs and dated applicant-materials release receipts with source and recorded evidence."
last_verified: 2026-10-22
owner: "product-engineering"
---

# Portal Upload Cleanup Authority Repair — 2026-10-22

## Scope and status

This is a bounded documentation repair for the Portal Upload Staging and
applicant Site Visit materials background-upload claims in
`docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/postgres-infra-tables.md`, and
`docs/SERVICE_AND_UTILITY_CATALOG.md`. CodeGraph located the relevant source
symbols and dependencies; the detailed scope behavior was independently
source-checked by the parent. The linked October 2 release records were read as
dated evidence. No live
Production configuration or storage probe was run for this repair, so the
release receipts below do not establish current environment values.

**Audit status: bounded repair verified by parent; broader upload audit incomplete.**
This report covers the named claims and owned documents; it does not claim a
whole-repository zero-hit sweep or current Production state. Two search hits in
an out-of-scope planning document are identified below.

## Evidence and reconciled claims

| Claim | Authoritative evidence | Reconciliation |
|---|---|---|
| Migration 060 and applicant background admission are deployed | `docs/plans/MATERIALS_BACKGROUND_PROCESSING_PLAN_2026-10-01.md` §18 records the October 2 activation; its production section records the first job `33630e07-4311-41b3-8aef-737a2962ce03` completing on attempt 1. `docs/atlas/postgres-infra-tables.md` records the migration readback, deployment ancestry, and first-job receipt. | Atlas and infra wording now presents the 2026-10-02 state as a dated Production receipt and explicitly avoids claiming a fresh environment probe. The earlier schema-readiness observation that admission was still off is retained as an earlier point in the activation sequence. |
| Infected-scan diagnostics are deployed and distinguish rejection from attention hold | Source: `lib/services/portal-upload-staging.js`; dated release evidence: infra table `materials_upload_jobs` entry and PR #407/#410 release receipt, 2026-10-02. The entry distinguishes terminal failed rejection/replay (staging rejected) from `needs_attention` (staging remains pending), and records separate applicant/staff projections. | The staging section no longer labels the diagnostic source-built/not deployed. It records the dated release and the different staging outcomes without implying a current environment probe. |
| Cleanup authority is scope-specific and only deletes proven unbound candidates | `lib/services/portal-upload-staging.js`: `DEFAULT_CLEANUP_DEPENDENCIES` (lines 603–665), `safeDiscard` (line 667 onward), and `cleanupExpiredPortalUploads` (lines 883–986). These implement the image-reference, feedback-binding, Site Visit registry/reference, and typed transcript proofs; cleanup is fenced around row claims/leases and uses persisted exact paths. | Infra and catalog describe the proof for each scope. Binding in any relevant lifecycle protects an item; uncertain or failed evidence retains bytes. Site Visit exact ETag deletion handles changed/missing versions without deleting changed bytes. Only a proven Consultant Feedback candidate row may be superseded in this cleanup path. No wording authorizes broad removal of projected Request Document history or uploader-selected cleanup paths. |
| Existing database and Blob/auth boundaries remain intact | `CLAUDE.md` safety invariants; the source header and paths above; infra table’s existing migration and staging contracts. | No change to runtime code, environment, migration instructions, token separation, mint/finalize reauthorization, or cleanup configuration. |

## Historical evidence and owner constraints preserved

The October 2 activation, production deployment, first-job lifecycle, and
read-only operator result remain dated evidence in the canonical materials plan
and infra page. The exact 500 MB live transfer and additional simultaneous-large
stress run remain parked per the owner decision in that plan; this repair does
not revive them as release work. Existing synchronous workflows for other upload
scopes remain distinct. SharePoint bytes and `wmkf_requestdocument` receipts
remain content authority; the Postgres background job is coordination state.

Repository search also found older cleanup-planning language in
`docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md` (lines 525 and 548). The
first row records the original scope-specific proof decision; the later row
records that grantee proof and slot-ownership corrections were implemented.
The plan is outside this batch's ownership; these entries remain dated design
history and were not used as evidence for current behavior.

## Verification boundary

The delegated editor ran no tests, gates, live probes, environment reads or
deployment actions. The implementation was not changed. Search hits outside
the three owned documents were not edited; parent verification follows.


## Parent verification

Parent independently read the scope-specific reconciliation and expiry-cleanup
source, including consumed-row handling, generation/reference protections,
exact-ETag deletion and persisted Blob pathname deletion. The review preserved
the difference between deleting candidate bytes and clearing a receipt while
retaining changed or referenced bytes. Sanitized staging rejection/replay and
the separate job diagnostic were checked against source.

Atlas coverage and self-test, API route coverage and self-test, fact consistency,
document-symbol references, build-claim freshness, agent wiki and docs catalog
passed in the parent verification round (applicable self-tests sequentially).
No cleanup, schema apply, live probe, deployment or configuration change was
performed. Dated release receipts remain dated evidence.
