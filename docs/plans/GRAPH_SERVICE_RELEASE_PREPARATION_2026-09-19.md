# GraphService release preparation — 2026-09-19

Status: **REHEARSAL PACKET PREPARED — NOT APPROVED FOR PROMOTION**.

Scope: prepare release of `codex/graph-service-decomposition`, reviewed candidate `4349449f782ff1c164b6c865f8e2bd4a2fbd7a8c`, from `/private/tmp/wmkf-graph-decomposition`. The owner authorized release preparation after local implementation acceptance. This packet does not authorize live writes, sending email, pushing `main`, or deployment. Release policy: `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`, Tier 2; prior verification: `docs/plans/GRAPH_SERVICE_DECOMPOSITION_EXECUTION_2026-09-19.md`.

## Verified candidate and production baseline

- **[VERIFIED via local Git]** Candidate tree was clean at `4349449f`. Runtime was last changed in the S11 checkpoint; subsequent changes are documentation and verification tooling. Full S11 Jest/build/gates and the subsequent focused verification remain recorded in the execution receipt.
- **[VERIFIED via Vercel project metadata, 2026-09-19T23:39:11Z]** Production target for project `wmkf_research_apps` is `dpl_Aui3x7NtH3MoKARNHZQB5YUyJLZS`, state `READY`, commit `f4d0a33f98c82a4356c8ba41dfb10130b0161fd7`.
- Deployment URL: `https://wmkfresearchapps-d5abdqntq-justin-gallivans-projects.vercel.app`. Production aliases include `applications.wmkeck.org`, `reviews.wmkeck.org`, `grantees.wmkeck.org`, and `submissions.wmkeck.org`.
- Sanitized metadata receipt: `/private/tmp/wmkf-graph-decomposition-logs/release-production-metadata.json`. This is a proposed rollback baseline, **not independently established application health**. A staff sign-in/read smoke and rollback-operator confirmation remain required. Recheck the production target immediately before release; do not use a stale deployment ID silently.

## Rehearsal contract to approve

Use a local candidate deployment and dedicated synthetic records/files. Select a safe sandbox only after verifying that every affected backend, including SharePoint, is isolated. If the required integration can only be tested against production, use the policy's controlled production rehearsal mode with explicitly approved targets. Do not infer permission from previous ZZTEST rehearsals or reuse their artifacts without fresh approval and readback.

Required owner inputs: rehearsal mode; request GUID/number; tenant/site/library and folder; staff identity and staff-controlled external identity; cleanup owner; campaign window; rollback operator. These remain **UNKNOWN** until supplied. Credentials stay in existing server-side configuration and are never copied into this packet.

Before the first write, record the approved request's current registry rows, lifecycle pointers, and exact file item/version IDs. Use unique `graph-refactor-20260919-*` synthetic filenames where the flow accepts them. The external materials flow assigns canonical slot filenames, so select an empty synthetic slot and confirm its computed destination before upload; do not rely on the client filename to avoid replacement. Preserve any preexisting real files. Record expected deltas for each operation and reconcile them immediately after it. Stop on an unexplained delta, target mismatch, auth failure, or partial success; retain evidence and do not attempt broad cleanup.

| Journey | Exercise and acceptance | Expected durable effects |
|---|---|---|
| Staff history | Open document history, change request while loading, close/reopen. Confirm current/prior versions belong to the selected request and no stale response replaces it. | Reads only. |
| Staff download | Download current and prior versions; open the files and compare synthetic content/bytes. Check PDF conversion only on a supported synthetic document. | Reads/conversion; no registry or source-file writes expected. |
| External upload | Staff-controlled external user opens its authorized upload flow, uploads a small synthetic file, retries/returns, and staff verifies stable file/registry identity. Exercise the upload-session path with an allowed fixture only if the selected public flow's size cap permits it. | Named SharePoint file and the chosen flow's registry/receipt rows; enumerate exact row types and allowed transitions before execution. No blanket claim that retry creates no version or row. |
| Replace and restore | Replace a disposable synthetic item, inspect version history, then restore its prior content through the supported staff flow. Check metadata/registry readback and error handling. | New versions of the exact approved item and documented caller-owned registry updates. Never restore a preexisting real document as a test. |
| Search and recovery | Search for synthetic content from the actual UI; confirm usable results and empty-state behavior. Exercise throttle/incomplete/error handling through the existing mocked tests, not deliberate live rate-limit exhaustion. | Live read-only search; injected failures remain local/mock-only and must be labelled accordingly. |

A staff rehearsal and an external-user rehearsal are separate evidence. Record actor, candidate SHA, environment, scenario, result, and before/after IDs. A scripted Graph transport probe alone cannot replace either rehearsal. `scripts/probe-sharepoint-write.js` uses raw fetch for its write/delete; `scripts/probe-graph-write-access.mjs` covers only sentinel upload/delete. Neither proves the complete release contract. Neither was run for this preparation.

No AI generation or real email send is part of the proposed rehearsal. If a selected flow requires either to reach the file path, stop and select another synthetic entry point or explicitly revise the approved scope.

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

**[VERIFIED via `git ls-remote origin refs/heads/main` and local Git, 2026-09-19]** Remote `main` is `f4d0a33f98c82a4356c8ba41dfb10130b0161fd7`, matching production metadata. Local `main` is `710892ac4d84b29de15a789de3c9c44c5a2d3fae`, containing the two planning commits. Both are ancestors of candidate `4349449f`; `git rev-list --left-right --count main...HEAD` returned `0 14`, and `origin/main...HEAD` returned `0 16`. The candidate changes 35 tracked files against remote main. Integration at these heads can fast-forward without conflict resolution. These counts exclude this subsequent preparation document commit.

Luna's sandboxed fetch could not write `FETCH_HEAD`; live `ls-remote` established the remote head without that write. Root independently repeated the remote comparison. No fetch update, merge, push, or application rehearsal was required or performed.

Concrete caller paths identified by Luna's source reconnaissance:

- Staff listing: `pages/api/workbench/proposal-documents.js` → `lib/services/workbench/proposal-documents-service.js`.
- Staff history: `pages/api/workbench/initial-assessment/versions.js` → `lib/services/initial-assessment/artifact-service.js` re-export → `lib/services/initial-assessment/artifact-reader.js` (`listInitialAssessmentArtifactVersions`). Staff restore: `pages/api/workbench/initial-assessment/restore-version.js` → `lib/services/initial-assessment/controls-service.js` (`restoreInitialAssessmentVersion`). The synthetic request must have an eligible document/lifecycle state; a raw upload alone does not establish those prerequisites. Confirm them before selecting this route.
- External materials finalization: `pages/api/external/materials/[token]/finalize.js` → `lib/services/site-visit-materials/contributor-service.js` → `GraphService.uploadFileLarge`. Use the supported complete upload flow, including authorization and staging, rather than calling finalize on a fabricated item. Token issuance and staging/Blob/registry side effects must be enumerated for the approved fixture before execution. Tokens must not appear in this document or logs. Source review confirms finalization acquires/releases a collection slot lease, creates missing folders, uploads with `conflictBehavior: replace`, records the upload candidate on staging, creates a Request Document row, may supersede the previous slot row, and marks staging consumed. The approved fixture must have no real predecessor. Byte validation and configured malware scanning remain enforced; scanner calls are an expected external dependency to include in authorization. A small fixture takes the simple-upload branch; actual chunk transfer requires more than 60 MiB and must also fit the configured public-flow cap. Record chunk coverage as mocked if no such fixture is approved.

Fresh Sol `sol_release_review` accepted this preparation packet after correction of the history caller chain. Root independently verified the chain and external finalize side effects. Seven sequential document gates/self-tests passed; log: `/private/tmp/wmkf-graph-decomposition-logs/release-preparation-doc-gates.log`. `git diff --check` passed. No code integration change occurred, so the existing runtime build/test evidence was not rerun. No application rehearsal or promotion has run.
