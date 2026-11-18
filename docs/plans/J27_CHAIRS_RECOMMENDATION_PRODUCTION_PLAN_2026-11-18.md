---
title: J27 Recommendation to Chairs and automatic Integrity Screen in Production
domain: workbench
kind: plan
status: active
summary: "Plan to release the sandbox-only Recommendation to Chairs step, its automatic Integrity Screen, and a test-request shortcut to Invited in Production. Not built."
canonical: false
cataloged: 2026-11-18
last_verified: 2026-11-18
owner: product-engineering
related:
  - lib/services/workbench/scoring-service.js
  - lib/utils/j27-integrity-readiness.js
  - lib/services/workbench/j27-integrity-jobs.js
  - docs/atlas/postgres-j27-integrity-jobs.md
  - docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md
---

# J27 Recommendation to Chairs in Production

**Status: plan only, nothing built.** Owner direction 2026-11-18: move the remaining
sandbox-only J27 Workbench work to Production and test there with Factory test
requests.

## Owner decisions (2026-11-18)

1. Ship Recommendation to Chairs and the automatic Integrity Screen together.
2. On a Factory test request, Recommended Invite moves straight on to Invited and
   Phase II Pending Committee Review, so reviewer invitations open. Real requests stay
   at Recommended Invite until the Grants Manager sets Invited in Dynamics (D35, D39);
   colleagues want a human in that step.
3. The lead PD or a superuser may trigger the shortcut, whoever created the run.

## What is sandbox-only today

Scope of the search: a grep for sandbox-only gates (`classifyDeployment() !== 'production'`,
`=== 'sandbox'`, `isJ27SandboxFactoryRequest`) across `lib/utils`, `lib/services/workbench`,
`pages/api/workbench`, `pages/workbench` and `shared/components/workbench`, 2026-11-18. It
found six files; the meeting-roster, field-readiness and phase-release ones already have
Production branches from the Nov 13 release. The rest:

- [VERIFIED via `lib/utils/j27-integrity-readiness.js:6-8` and
  `lib/utils/initial-assessment-rationale-readiness.js:3-7`] The Recommendation to Chairs
  step requires `j27ChairsRecommendationEnabled()`, which requires
  `initialAssessmentRationaleEnabled()`, which is false on every Production deployment. The
  Nov 13 release moved the rationale field to `rationaleFieldReady()` but left this step on
  the sandbox helper (rollout plan: "Out of this release (owner)").
- [VERIFIED via `lib/services/workbench/scoring-service.js:64-71` and
  `pages/workbench/[requestId].js:153-154`] The save accepts only a ready **sandbox**
  Factory request; the page shows the step only on a rehearsal or test request.
- [VERIFIED via `lib/services/workbench/j27-integrity-jobs.js:18-26, 113-124`] The automatic
  screen queue and eligibility check accept only sandbox Factory runs and query the app's
  Postgres. Production Factory runs are recorded in the separate ledger
  (`TEST_REQUEST_LEDGER_URL`, per `docs/CREDENTIALS_RUNBOOK.md`).
- [ASSUMED unknown] Migration 096 (`j27_integrity_jobs`) is in the manifest; whether it is
  applied to the Production app database has not been checked.

## Stages

### Stage 1: Recommendation to Chairs in Production

- Gate the step on the same Production admission as the Nov 13 release (fields ready plus
  `workbench.phase_rollout`), not on the sandbox rationale helper. Keep the sandbox
  rehearsal paths working.
- Real J27 requests: save Recommended Invite / Recommended Do Not Invite as today (D53).
- Production test requests: identify them by `wmkf_istestrequest`, `wmkf_testcreationrunid`
  and a ready Production run in the Factory ledger (read-only ledger connection, new).

### Stage 2: test-request shortcut to Invited

- After a Recommended Invite save on a Production Factory test request, run the Factory's
  guarded status steps: Phase I Invited, then Phase II Pending Committee Review.
- Each step waits for Dynamics background jobs, up to 10 minutes
  (`lib/services/test-requests/status-change-runner.js:38`), so this runs as a durable
  background workflow (as the Integrity Screen does), not inside the save. Reuse the status
  journal so a resumed workflow never sends a change twice.
- Lift the Factory's run-owner rule for this path only: lead PD or superuser (decision 3).
- Invited can create a draft email and a GoApply tracking row; that is expected and is
  observed by the existing status runner.
- The Workbench shows progress and a failure state; the admin page's More options remain
  the manual fallback.

### Stage 3: automatic Integrity Screen in Production

- Confirm migration 096 on the Production app database (owner-run).
- Make the queue and eligibility check accept Production requests: real J27 requests
  recommended Invite, and Production Factory test requests.
- Turn on `AUTOMATIC_INTEGRITY_SCREENING=on` in Production only after the owner authorizes
  the paid provider calls (search and model, per recommended request).

## Before building

- Run `/contract-reconcile` on this plan (migration, background work, cross-layer writes).
- Each stage: branch, characterization tests, Codex review, owner go before deploy
  (Tier 2, `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`).
- Open: whether the Grants Manager also sets Phase II Status on Feb 24 or only Request
  Status (D39 vs the comment at `lib/services/workbench/j27-read-model.js:239-241`). The
  shortcut sets Phase II Pending Committee Review either way, because invitations need
  Request Status Phase II Pending (`j27-read-model.js:242`).
- Deadline: PDs record recommendations Dec 9 to Feb 3.
