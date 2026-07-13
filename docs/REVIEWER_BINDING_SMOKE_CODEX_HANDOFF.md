---
title: Reviewer Binding Smoke — Codex Takeover Handoff
domain: reviewer-identity
kind: audit
status: active
summary: "Closing handoff for the Wave 13 binding production smoke: shipped F1 fix, PR #60 state, two open adversarial-review findings, and residual owner gates."
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

# Codex takeover handoff: Wave 13 reviewer-binding production smoke

Session 362 closing document. Codex takes over from here. The objective is
unchanged: a controlled positive control proving the **deployed** cron drain →
`capture-self-reported-orcid` → binding-writer chain produces the exact first
`self_reported` Wave 13 binding, because organic ORCID-bearing acceptance
throughput is too low to wait for.

## State at handoff

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

**Open on branch `claude/reviewer-binding-smoke` (PR #60, head `76391b1b`):**

- `scripts/smoke-reviewer-binding.js` — the manual, owner-gated smoke runner.
- `scripts/lib/smoke-reviewer-binding-core.js` — pure safety logic (frozen
  repeat/opted-out/no-boardIdentity payload, whole-second timestamps,
  clean-init precondition, Wave 13 assertion set including exact evidence
  summary + anchors JSON + untouched-field checks, fail-closed cleanup
  evaluation, allowlist fixture authorization, deployment+job attribution
  matcher). 64 unit tests, no live writes.
- `scripts/lib/smoke-reviewer-binding-fixtures.js` — owner-reviewed fixture
  allowlist, **deliberately empty**; the runner aborts until a GUID is
  committed.
- Cron telemetry (Tier-1 runtime, additive): the drain returns claimed
  `jobIds`; `pages/api/cron/drain-reviewer-acceptances.js` records a
  deployment fingerprint (`VERCEL_GIT_COMMIT_SHA`/`VERCEL_DEPLOYMENT_ID`,
  absent on local runs by construction) in `maintenance_runs.details` on both
  the success and failure `completeRun` paths.

The controlling analysis is the Session 362 review artifact
`outputs/reviewer-identity-binding-production-smoke-adversarial-review-2026-07-13.md`
(gitignored, local): §9 is the smoke contract, §5 the findings (F1 shipped;
F2 lease-loss and F3 blocked-retry classification remain open, non-blocking),
§10 the owner gates.

## Review history on PR #60 (three adversarial rounds)

1. Round 1 → fixed in `40d33555`: double-entry fixture flag, blocking
   attribution (then temporal), exact evidence/anchors/untouched-field
   assertions, artifact `pass` recomputed after cleanup.
2. Round 2 → fixed in `76391b1b` (implemented by Codex rescue session
   `019f5c30-30cf-7840-827a-e6b3f0b10ccd`, committed on its behalf):
   attribution bound to deployment fingerprint + `jobIds` (not temporal
   overlap), tracked fixture allowlist as an authorization source independent
   of the CLI, fail-closed cleanup (deactivation fails the run; exact-GUID
   readability re-checks; `--delete-job` only after full cleanup verification).
3. Round 3 (2026-07-13, latest) → **two findings OPEN. This is the next work.**

## Open findings to fix (round 3, verbatim substance)

1. **[high] A failed claim is accepted as proof that the expected deployment
   completed the job** (`scripts/lib/smoke-reviewer-binding-core.js:124-129`).
   The drain fills `jobIds` from every CLAIMED job before processing, so the
   expected deployment can claim the smoke job, fail, and a different worker
   can complete it later — attribution still matches. Codex's read-only probe
   confirmed the matcher accepts details with `completed: 0, retried: 1`.
   Fix direction: record per-outcome ids (e.g. `completedJobIds`) in the drain
   result → cron details, and require the smoke job in the COMPLETED set of
   the fingerprint-matching run; regression test for `retried:1, completed:0`.
   The reviewer also suggested verifying the lease-guarded
   `completeReviewerAcceptanceJob` returned a row before reporting completion
   (this is the same ignored-stale-lease gap as review-artifact finding F2 —
   fixing it in `processReviewerAcceptanceJob` closes both).
2. **[medium] Post-write failures can strand production state without a
   durable recovery artifact** (`scripts/smoke-reviewer-binding.js:275-306`).
   The artifact is only written after polling + assertions; any abort or
   rejected await between person creation and that point exits with created
   IDs only in stdout. Fix direction: persist an incremental recovery artifact
   immediately after EACH production write boundary (person, suggestion,
   accepted-state stamp, job staged), wrap the write sequence in an outer
   error/signal handler that records IDs + job status before exiting, and
   auto-clean only when no job was staged or the job is confirmed terminal.

Both fixes belong on the same branch/PR. After fixing, re-run
`/codex:adversarial-review` (round 4) before merge — each round has found
real issues; do not self-certify convergence.

## Constraints (unchanged, binding)

- **Never run** `scripts/smoke-reviewer-binding.js`, `scripts/pr4-e2e*.js`,
  the drain, or any production-writing command from a dev session. The smoke
  is manual and owner-executed. Unit tests + gates only.
- `scripts/pr4-e2e.js` is quarantined for this purpose (seven confirmed
  defects + two hazards — review artifact Part B). Do not repair it as part
  of this effort.
- Tier-1 runtime changes (drain/cron files) ride the branch + PR, per
  `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.
- The 14-day attestation TTL and the Wave 13 gating posture are owner
  decisions; out of scope.

## Residual owner gates (unchanged from the review artifact §10)

1. Fixture request GUID committed to
   `scripts/lib/smoke-reviewer-binding-fixtures.js` (recommend a closed cycle's
   request; the suggestion is transient but staff-visible during the window).
2. Authorization to run; `--expect-deployment` from `vercel inspect`, and the
   deployment must **contain the cron telemetry** (post-PR #60 merge).
3. Queue-row retention: default keep; `--delete-job` only by explicit choice.
4. Whether to also fix review-artifact findings F2 (drain ignores stale-lease
   null results → possible duplicate acceptance email) and F3 (deterministic
   blocked outcomes retried 8×) — F2 partially overlaps open finding 1 above.

## Known repo irritant

The `scope-claim-reminder.js` hook blocks **every** edit to
`docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` on an apparent false
positive (it flags prose list items at lines 75–77/95 as count claims). The
plan's timestamp-normalization sentence (~line 294) is one sentence behind the
shipped F1 fix as a result. Fix the hook or annotate per its instructions
before reconciling that doc; do not silently work around it.

## Verification checklist for the next slice

`npx jest tests/unit/smoke-reviewer-binding.test.js tests/unit/reviewer-acceptance-drain.test.js`,
full `npm test`, `node --check` on the scripts, `npm run check:types`, then
gates + self-tests sequentially: `check:api-routes`, `check:atlas`,
`check:agent-wiki`, `check:doc-symbol-refs`, `check:dataverse-access-layer`,
`check:dynamics-context-boundary`, `check:secret-scan`,
`check:scaffolding-tokens`. Update the smoke bullet in
`docs/agent-wiki/topics/reviewer-identity.md` if attribution/cleanup semantics
change again.
