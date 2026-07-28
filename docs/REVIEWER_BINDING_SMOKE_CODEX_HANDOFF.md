---
title: Reviewer Binding Smoke — Production Execution Record
domain: reviewer-identity
kind: audit
status: active
summary: "Reviewer-binding smoke: PR #60 merged and the owner-authorized production run passed with verified cleanup; completed queue job 25 is retained."
canonical: false
cataloged: 2026-07-13
owner: product-engineering
related:
  - docs/REVIEWER_IDENTITY_BINDING_PRODUCTION_SMOKE_ADVERSARIAL_REVIEW_HANDOFF.md
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - scripts/smoke-reviewer-binding.js
  - scripts/lib/smoke-reviewer-binding-core.js
  - scripts/lib/smoke-reviewer-binding-fixtures.js
  - lib/services/reviewer-acceptance-drain.js
  - pages/api/cron/drain-reviewer-acceptances.js
  - tests/unit/smoke-reviewer-binding.test.js
---

# Wave 13 reviewer-binding production smoke: execution record

Sessions 362–363 design, review, implementation, and execution record. The
objective was a controlled positive control proving the **deployed** cron drain →
`capture-self-reported-orcid` → binding-writer chain produces the exact first
`self_reported` Wave 13 binding, because organic ORCID-bearing acceptance
throughput was too low to wait for. The objective is now satisfied.

## Implemented state

**Merged to `main` (deployed on merge):**

- PR #59 (`38640dd7`) — **F1 fix, live**: `capture-self-reported-orcid.js`
  truncates the self-report event identity (`boundAt`/`resolvedAt`) to
  Dataverse second precision, on the durable and typed-fallback paths.
  Rationale: Dataverse DateTime columns drop fractional seconds (proven by the
  samples in `docs/audits/reviewer-identity-binding-prod-preflight-2026-07-13.md`),
  so a millisecond event identity never round-trips and a job retry
  reclassified its own replay as a `rebind` (version inflation) or an
  out-of-order block (terminal job failure). Writer-side regression test:
  second-precision stored row + truncated replay event → `noop`
  (`tests/unit/reviewer-identity-binding-writer.test.js`).

**Merged to `main` in PR #60 (`5bb6a8b8`, production deployment
`dpl_BqCBSFWoRto2noQdrovHG7fBsA6X`):**

- `scripts/smoke-reviewer-binding.js` — the manual, owner-gated smoke runner.
- `scripts/lib/smoke-reviewer-binding-core.js` — pure safety logic (frozen
  repeat/opted-out/no-boardIdentity payload, whole-second timestamps,
  clean-init precondition, Wave 13 assertion set including exact evidence
  summary + anchors JSON + untouched-field checks, fail-closed cleanup
  evaluation, allowlist fixture authorization, deployment+job attribution
  matcher). 82 unit tests, no live writes.
- `scripts/lib/smoke-reviewer-binding-fixtures.js` — owner-reviewed fixture
  allowlist. Request `1002379` is authorized as
  `54e2b88b-04b9-f011-bbd3-6045bd02b4cc` (live Dataverse read verified on
  2026-07-13); the runner still requires the operator's matching
  `--approved-request-id` double entry.
- Cron telemetry (Tier-1 runtime, additive): the drain returns claimed
  `jobIds` plus per-outcome ids; `pages/api/cron/drain-reviewer-acceptances.js` records a
  deployment fingerprint (`VERCEL_GIT_COMMIT_SHA`/`VERCEL_DEPLOYMENT_ID`,
  absent on local runs by construction) in `maintenance_runs.details` on both
  the success and failure `completeRun` paths. Smoke attribution requires the
  exact job in `completedJobIds`, never merely in the claimed set.

The controlling Session 362 analysis is reconciled into this tracked execution
record; its byte-preserved private copy remains in the owner-only operational
archive after the redundant ignored source was disposed on 2026-07-27 under
`docs/audits/local-operational-data-retention-audit-2026-07-27.md`. Section 9
of that archived review is the smoke contract, §5 records the original
findings (F1 shipped there; F2 lease-loss and F3 blocked-retry classification
are now resolved on this branch), and §10 records the owner gates.

## Review history on PR #60 (four adversarial rounds)

1. Round 1 → fixed in `40d33555`: double-entry fixture flag, blocking
   attribution (then temporal), exact evidence/anchors/untouched-field
   assertions, artifact `pass` recomputed after cleanup.
2. Round 2 → fixed in `76391b1b` (implemented by Codex rescue session
   `019f5c30-30cf-7840-827a-e6b3f0b10ccd`, committed on its behalf):
   attribution bound to deployment fingerprint + `jobIds` (not temporal
   overlap), tracked fixture allowlist as an authorization source independent
   of the CLI, fail-closed cleanup (deactivation fails the run; exact-GUID
   readability re-checks; `--delete-job` only after full cleanup verification).
3. Round 3 (2026-07-13) → **two findings implemented on this branch; round 4
   required before merge.**
4. Round 4 (2026-07-13) → found a signal/main-exit race, requeueable
   failed/cancelled cleanup fence, stale retry comment, and a nested
   delete→deactivation write-after-signal edge. All were fixed. The final
   independent focused re-review returned **NO FINDINGS**.

## Round 3 findings — implemented

1. **[RESOLVED] Completed-only deployed-cron attribution.** The drain exposes
   `completedJobIds`, `cancelledJobIds`, `failedJobIds`, `retriedJobIds`, and
   `leaseLostJobIds`; the matcher requires the exact smoke job in
   `completedJobIds` for the fingerprint-matching run. The
   `completed:0, retried:1` shape is a negative regression. Lease-guarded
   email-step claims, cancellations, completion, and failure recording all
   fail closed on a null row, closing review-artifact F2 as well.
2. **[RESOLVED] Incremental recovery artifact.** The runner persists before
   and immediately after person creation, suggestion creation, accepted-state
   stamping, and job staging. Timeout, unexpected errors, SIGINT, and SIGTERM
   record known GUIDs, the latest exact job row/status, the pending write, and
   the failure in the same artifact. Error-path cleanup remains owner-opted-in
   and is allowed only when no job could have been staged or the exact job was
   re-read `completed`; failed/cancelled jobs are not cleanup fences because
   enqueue can reopen them. Signal handling never auto-cleans, stamps the
   artifact synchronously before its first await, and prevents the main flow
   from outrunning the single fatal shutdown.

Review-artifact F3 is also resolved in this slice: deterministic typed binding
failures are terminal, while bounded optimistic-concurrency exhaustion and
untyped transport failures remain retryable.

All fixes merged in PR #60. Round 4 and its post-fix focused re-review are
complete; the clean verdict is independent rather than a self-certification.

## Constraints (unchanged, binding)

- Do not run `scripts/smoke-reviewer-binding.js`, the drain, or another
  production-writing command from a routine dev session. The smoke is manual,
  owner-authorized, and deployment-attested; any new execution requires a new
  explicit authorization. Unit tests + gates are the default.
- **Never run** `scripts/pr4-e2e*.js` for this purpose.
- `scripts/pr4-e2e.js` is quarantined for this purpose (seven confirmed
  defects + two hazards — review artifact Part B). Do not repair it as part
  of this effort.
- Tier-1 runtime changes (drain/cron files) ride the branch + PR, per
  `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.
- The 14-day attestation TTL and the Wave 13 gating posture are owner
  decisions; out of scope.

## Owner gates and execution outcome

1. **Satisfied:** owner approved request `1002379`; its live-resolved GUID
   `54e2b88b-04b9-f011-bbd3-6045bd02b4cc` is committed to
   `scripts/lib/smoke-reviewer-binding-fixtures.js`.
2. **Satisfied:** owner authorized the production run with cleanup against
   deployment `dpl_BqCBSFWoRto2noQdrovHG7fBsA6X` after PR #60 merged.
3. **Satisfied:** smoke `smoke-reviewer-binding-20260713232414` passed. Job
   `25` completed with `attempts=0`; maintenance run `15060` attributed that
   exact completed job to the expected deployment. The exact Wave 13
   `self_reported` binding assertions passed; no contact link or system alert
   was created.
4. **Satisfied:** cleanup deleted and absence-verified synthetic suggestion
   `27fe48f5-117f-f111-ab0e-000d3a32b07f` and person
   `4be225f1-117f-f111-ab0e-7ced8d3c39fd`; the population returned to the
   pre-smoke baseline (person `1`, suggestion `0`).
5. **Owner decision preserved:** queue job `25` remains as the completed audit
   row (`jobDeleted:false`). Do not delete it without a new explicit decision.
6. Review-artifact findings F2 and F3 are implemented on `main`; no owner
   decision remains for their retry/lease semantics.

## Resolved repo irritant

The `scope-claim-reminder.js` false positive is fixed: Markdown ordered-list
ordinals are stripped before numeric-coverage detection, with a regression in
`.claude/hooks/hook-enforcement.test.js`. The implementation plan now describes
the shipped F1 normalization at the self-report capture boundary.

## Verification completed

- Full Jest: 483 suites / 5,600 tests passed.
- Affected four-suite run: 145 tests passed; smoke contract alone: 82 passed.
- `node --check`, `npm run check:types`, and `npm run lint` passed (lint retains
  the repository's pre-existing warning baseline, with zero errors).
- Required code/security/Atlas/wiki/doc/instruction/harness gates and their
  self-tests passed sequentially; `docs/DOCS_CATALOG.md` was regenerated.
- Round-4 post-fix independent focused review: **NO FINDINGS**.
- Production smoke passed on 2026-07-13 against the exact expected deployment;
  cleanup passed and retained job `25`. The recovery receipt remains
  byte-preserved in the owner-only operational archive; its redundant ignored
  source copy was disposed in the 2026-07-27 source-only cleanup.
- A post-smoke Vercel error-level scan found no smoke failure. It did surface
  one unrelated PostgreSQL SSL-mode deprecation warning on
  `/api/cron/drain-submissions`; that request returned HTTP 200.
