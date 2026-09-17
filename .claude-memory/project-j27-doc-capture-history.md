---
name: project-j27-doc-capture-history
description: Closed history split from project-j27-doc-capture-evolution on 2026-09-17 — the Initial Assessment governed-artifact pilot record (schema, Request 1002788/1003109 rehearsals, recovery and run-linkage fixes, deployments), the 2026-07-29 pilot-environment decision, and the retired reviewer hold step.
metadata:
  type: project
  status: closed
  scope: strategy
  last_verified: 2026-09-17 via split from project-j27-doc-capture-evolution (content moved verbatim, not re-probed)
---

## Recall Rule

Read when you need the dated record of how the Initial Assessment governed-artifact pilot was proved in Production (which request, which deployment, which fix), or why the reviewer hold step was retired. Live invariants and J27 direction stay in [[project-j27-doc-capture-evolution]]; do not treat the deployment ids below as current.

## Moved verbatim 2026-09-17

**Initial governed-artifact implementation (source-backed 2026-07-29;
production-provisioned and deployed 2026-07-30): associate documents with the typed
`wmkf_requestdocument` Dataverse table on the request** so the apps point at
each registered artifact **directly** instead of filename joins. The schema
includes request/cycle, artifact and lifecycle/status option sets, stable
SharePoint/Graph identity, version/eTag, prompt/run/input/template provenance,
lineage/milestone fields, and a deterministic generation alternate key.
This makes document identity, relationships, workflow, and structured
decisions legible to the apps while the file bytes and editable Word narrative
remain in SharePoint. Production Wave 16 and governed
`initial-assessment.generate` v1 are live; PR #102 deployed Ready as
`dpl_AxxroabhpXLX1pz75MW6486fB4ci`. Precedent for a document reference on a row already
exists in `wmkf_apprequestperson.wmkf_biosketchurl`. The first producer is the
request-bound Initial Assessment service; broader applicant-capture producers
remain future work. The controlled Request `1002788` rehearsal generated the
canonical artifact, populated the registry/pointer, exposed the same item in
both consumers, and proved exact-input retry without another run or upload.
That request's loaded proposal was later identified as an old Phase I
document, so the rehearsal proves artifact mechanics but not semantic
correctness on the approved Phase II input. It also showed that SharePoint
repacks the DOCX so whole-package hashing cannot
support interrupted-finalization recovery, and that the deployed producer
omitted the Executor `requestId`, leaving the run lookup null. Production
commit `9c88a1fa` now hashes normalized governed Word parts and
passes the request GUID; focused tests and the actual pilot packages verify the
hash complement. Request `1003109` production-proved canonical-input
generation, exact-input reuse, and a new AI run with the correct request
lookup. A controlled retry then production-proved interrupted-finalization
recovery using the same registry row, AI run, SharePoint item, and version.

**Pilot environment decision (owner, 2026-07-29):** do not build the reachable
but incompletely provisioned Dataverse sandbox organization into an integrated
application/file test environment for this pilot. Use a controlled production
rehearsal after colleagues create representative dummy `akoya_request` records.
Request `1002788` became the authorized target. Production schema apply, prompt
seeding, application promotion, generation, shared discovery, and exact retry
completed on 2026-07-30. Recovery/run-linkage fixes are deployed; production
run-linkage and interrupted-finalization recovery proof later passed on
Request `1003109`. An attributed substantive edit then passed on the same
stable item through both consumers. Production deployment
`dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2` (`68bcb4e8`) now refreshes response-only
Graph-current version/last-modified metadata, and both signed-in consumers
displayed the same current version `2.0`. The remaining target-library controls
are controlled follow-up work. A disposable production-library audit subsequently
proved native previous-version inspection/restore and signed-in first-stage
recycle recovery. Administrator evidence closed configured version limits and
second-stage recovery (2026-08-10 / 2026-08-20); Purview retention and the
Members Edit level's Delete flags remain owner-accepted-open. Workbench history
is Production-live; administrator restore and the owner-decided exact byte-copy
Board snapshot are Production-deployed through PR #138 (`c519daf6`). Signed-in
Request `1003109` passed the artifact/control/version-history read smoke. The
restore and first-snapshot writes remain unexercised and require separate
explicit owner authorization. The owner deferred that proof on 2026-08-30 to
a pre-J27-scale checkpoint rather than manufacturing Production evidence now.

**Hold step already RETIRED (S279) — this contingency resolved early, for a different reason.** The reviewer "hold step" ([[project-reviewer-hold-step-decouple]]) was removed in S279 (commit `a8676af1`) when the direction shifted to onboarding at a single final Accept — independent of J27. So the earlier "single-submission may un-scaffold the hold step" note is now moot: there is no hold step left to un-scaffold. (Kept here only so the J27 doc-capture planning doesn't re-raise it.)
