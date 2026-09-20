# GraphService release preparation — 2026-09-19

Status: **BOUNDED REHEARSAL PASSED — OWNER APPROVED PRODUCTION RELEASE**.

Scope: prepare release of `codex/graph-service-decomposition`, reviewed candidate `7f59afbafdc9f7eb6687c679cfc13ac80fae71b6`, from `/private/tmp/wmkf-graph-decomposition`. The owner authorized release preparation after local implementation acceptance. The owner subsequently authorized pushing this reviewed refactor to production on 2026-09-20 UTC, after the bounded rehearsals and stated coverage limits. No additional test writes or sends are included. Release policy: `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`, Tier 2; prior verification: `docs/plans/GRAPH_SERVICE_DECOMPOSITION_EXECUTION_2026-09-19.md`.

## Verified candidate and production baseline

- **[VERIFIED via local Git]** Candidate tree was clean at `7f59afba` before the bounded rehearsal overlay. Runtime was last changed in the S11 checkpoint; subsequent changes are documentation and verification tooling. Full S11 Jest/build/gates and the subsequent focused verification remain recorded in the execution receipt.
- **[VERIFIED via Vercel project metadata, 2026-09-19T23:39:11Z]** Production target for project `wmkf_research_apps` is `dpl_Aui3x7NtH3MoKARNHZQB5YUyJLZS`, state `READY`, commit `f4d0a33f98c82a4356c8ba41dfb10130b0161fd7`.
- Deployment URL: `https://wmkfresearchapps-d5abdqntq-justin-gallivans-projects.vercel.app`. Production aliases include `applications.wmkeck.org`, `reviews.wmkeck.org`, `grantees.wmkeck.org`, and `submissions.wmkeck.org`.
- Sanitized metadata receipt: `/private/tmp/wmkf-graph-decomposition-logs/release-production-metadata.json`. This is a proposed rollback baseline, **not independently established application health**. A staff sign-in/read smoke and rollback-operator confirmation remain required. Recheck the production target immediately before release; do not use a stale deployment ID silently.

## Rehearsal contract and completed evidence

The owner authorized one bounded synthetic rehearsal against request `1003220` (`4bfb6e40-678f-f111-8076-7ced8d3d15a6`) in the dedicated Vercel custom environment `graph-rehearsal`. The isolated guard overlay was built on candidate `7f59afba`, with guarded source `06f9c5e1` and deployed checkout `c12935d1` on `codex/graph-rehearsal-guards`. That overlay must never be merged/promoted. The deployment was `dpl_B5N32yJxKpiVfo72c9b2uJuNngoT`, reached `READY`, and was then removed successfully. Production deployment `dpl_Aui3x7NtH3MoKARNHZQB5YUyJLZS` remained protected and was not promoted or changed. Fresh retirement/protection receipt: `/private/tmp/1003220-cloud-retirement-proof.json`.

**[VERIFIED via sanitized cloud receipts]** The external materials flow completed one authorized synthetic upload: upload-token `200`, finalize `200`, no application errors. The same SharePoint item retained identity `01G4GVMS22FWXXB5KDRBD3NT27JBE5GPFG`; it advanced to version `3.0`, size `917`, with SHA-256 `a75d11fdb0149ff17159457ee560154f7565c5fd2e43387cf2821a3dec1bca79`. The prior versions `1.0` and `2.0` remain present. The new Request Document row is `4dec19a5-acb4-f111-aaac-6045bd04539e`, `Ready`/`Draft`; predecessor `9079e179-a0b4-f111-aaac-000d3a361c1f` is `Superseded`. The staging row is `consumed`/`ok`, its candidate wrapper is retained, and the staged Blob is deleted. Receipt: `/private/tmp/1003220-cloud-after.json`; staging proof: `/private/tmp/1003220-cloud-staging-proof.json`.

**[VERIFIED via conditional PUT receipt]** A separate disposable file probe in the same request folder established `before=404`, create `201`, current conditional PUT `200`, stale-ETag PUT `412`, unchanged-content proof, and cleanup `204`. Receipt: `/private/tmp/1003220-conditional-put-proof.json`. This verifies the exact stale-ETag behavior for the tested path and item operation; it does not establish behavior for every Graph upload API or chunked upload session.

**[VERIFIED via IA restore receipt]** The staff Initial Assessment restore path returned to the original governed content. Pointer and item identity remained stable; current version `3.0` matched the registry, the governed hash remained stable, the test marker was gone, and versions `1.0` and `2.0` remain available. Receipt: `/private/tmp/1003220-ia-restored-proof.json`.

One Cloudmersive scan was explicitly authorized for this rehearsal and the flow enforced a clean outcome. This is evidence of the exercised scan path, not an independent billing or quota receipt. The sanitized runtime evidence records the rehearsal route fence rejecting `/api/cron/maintenance` and `/api/auth/session`; it does not prove every possible UI, route, or chunked upload journey. Receipt: `/private/tmp/1003220-cloud-runtime-sanitized.jsonl`.

The synthetic current file and restored IA evidence remain retained for Justin's later restore decision. The owner now authorizes the deliberate production push; no additional test upload, email send, or provider generation is included. The production baseline remains the previously recorded deployment and must be refreshed before any future release action.

The rehearsal covered these bounded journeys:

| Journey | Result and limits | Durable effects |
|---|---|---|
| Conditional Graph write | Passed on a disposable file: stale ETag returned `412`; content remained unchanged; cleanup succeeded. | Disposable item cleaned up. |
| External upload | Passed once through the authorized small-PDF path with upload-token issuance and finalize; the existing contributor invitation was reused. | SharePoint version `3.0`, new Ready/Draft registry row, predecessor superseded, staging consumed, Blob deleted. |
| Staff restore | Passed for the governed Initial Assessment path; original content and pointer were restored. | IA version history retained; registry pointer remained stable. |
| Scan and route fence | One explicitly authorized clean scan; runtime route fence rejected cron/auth paths. | No additional durable effect. |

The evidence does not claim that all possible UIs, chunked uploads, or production promotion paths were tested. Credentials and token values remain outside this document.

## Promotion and rollback procedure

1. Complete the integration comparison below and resolve any new main changes in the isolated candidate. Rerun affected tests/build/gates for any integration change and obtain fresh review.
2. Complete approved staff/external rehearsals and reconcile expected writes. Keep failures visible; a waiver requires explicit owner risk acceptance, not an inferred pass.
3. Confirm campaign timing, final candidate SHA, clean tree, current production baseline health, rollback operator, and exact release action. Obtain the owner's explicit merge/push approval on this concrete packet.
4. Integrate through the established Git workflow, then deliberately push `main` only with that approval. Record the actual production deployment and SHA. No database migration or configuration change is part of this extraction.
5. Check staff sign-in and a read-only critical path on the deployed revision. Review bounded errors for the exercised paths. If checks fail, the approved operator restores the recorded previous deployment and reconciles any intervening remote writes.

Verified installed CLI syntax for rollback is `vercel rollback <deployment-id>`. Proposed command for the current baseline, **not executed**:

```bash
vercel rollback dpl_Aui3x7NtH3MoKARNHZQB5YUyJLZS
```

Run from the linked project checkout and confirm the project/team and refreshed baseline first. Code rollback does not undo uploads, versions, registry rows, or emails; preserve evidence and reconcile individually. No automatic deletion of files/version history is authorized.

## Integration and review evidence

**Historical integration snapshot (2026-09-19, preparation at `4349449f`):** Remote
`main` was `f4d0a33f98c82a4356c8ba41dfb10130b0161fd7`, local `main` was
`710892ac4d84b29de15a789de3c9c44c5a2d3fae`, both ancestors of that candidate.
The then-recorded counts were `0 14` against local main and `0 16` against remote
main, with 35 changed files. These counts are not a fresh integration check of
`7f59afba` or of current remote main; repeat comparison before release.


Luna's sandboxed fetch could not write `FETCH_HEAD`; live `ls-remote` established the remote head without that write. Root independently repeated the remote comparison. No fetch update, merge, push, or production promotion was performed; the bounded rehearsal evidence is recorded above.

Concrete caller paths identified by Luna's source reconnaissance:

- Staff listing: `pages/api/workbench/proposal-documents.js` → `lib/services/workbench/proposal-documents-service.js`.
- Staff history: `pages/api/workbench/initial-assessment/versions.js` → `lib/services/initial-assessment/artifact-service.js` re-export → `lib/services/initial-assessment/artifact-reader.js` (`listInitialAssessmentArtifactVersions`). Staff restore: `pages/api/workbench/initial-assessment/restore-version.js` → `lib/services/initial-assessment/controls-service.js` (`restoreInitialAssessmentVersion`). The synthetic request must have an eligible document/lifecycle state; a raw upload alone does not establish those prerequisites. Confirm them before selecting this route.
- External materials finalization: `pages/api/external/materials/[token]/finalize.js` → `lib/services/site-visit-materials/contributor-service.js` → `GraphService.uploadFileLarge`. Use the supported complete upload flow, including authorization and staging, rather than calling finalize on a fabricated item. Token issuance and staging/Blob/registry side effects must be enumerated for the approved fixture before execution. Tokens must not appear in this document or logs. Source review confirms finalization acquires/releases a collection slot lease, creates missing folders, uploads with `conflictBehavior: replace`, records the upload candidate on staging, creates a Request Document row, may supersede the previous slot row, and marks staging consumed. The approved fixture must have no real predecessor. Byte validation and configured malware scanning remain enforced; scanner calls are an expected external dependency to include in authorization. A small fixture takes the simple-upload branch; actual chunk transfer requires more than 60 MiB and must also fit the configured public-flow cap. Record chunk coverage as mocked if no such fixture is approved.

Initial packet review and its seven documentation gates are historical evidence in
`/private/tmp/wmkf-graph-decomposition-logs/release-preparation-doc-gates.log`.
Sol (`sol_s11`) separately accepted the completed external journey from the live
before/after, staging and sanitized log receipts; the earlier staff restore was
reviewed independently. Root verified retirement and unchanged production.
Original candidate runtime is unchanged; the temporary guard overlay was isolated.
No production promotion occurred.

Remaining coverage limits: these receipts do not independently establish rapid
request switching in history, every search/empty-state UI, supported PDF conversion,
live chunked transfer, or injected recovery failures. Existing automated evidence
covers its stated cases; no unperformed scenario is silently treated as a pass or
waived. Reconcile required coverage and release timing before promotion approval.

## Owner-authorized release operation — 2026-09-20 UTC

Owner instruction: “Great. Proceed with pushing this to prod.” Timing: now, as
requested. Operator: Codex acting for Justin; Codex will restore the recorded
baseline if immediate post-release checks reveal a regression. This authorizes the
original Graph branch only, never the rehearsal-only overlay.

Fresh checks at 04:47 UTC: candidate `669d4eff` is clean; remote main is still
`f4d0a33f98c82a4356c8ba41dfb10130b0161fd7`; local main is its two-planning-commit
descendant and an ancestor of the candidate. Tested runtime is unchanged since
`7f59afba`; subsequent edits are documentation only. Sol independently accepted
this exact scope. Production baseline remains READY at
`dpl_Aui3x7NtH3MoKARNHZQB5YUyJLZS`, with protection unchanged. The signed-in
staff visit/read path passed during the preceding rehearsal verification.

Action: fast-forward local main to this approved branch, push main without force,
wait for the exact new production SHA, then verify authenticated staff access,
proposal-document read/download, external link context without another upload, and
bounded runtime errors. Retain the baseline for rollback. No migrations or production
environment changes are required. Deployment results are retained in the local
release receipt `/private/tmp/graph-production-release-receipt.json` and reported
in the release task. An approved push is not itself evidence of successful deployment.
