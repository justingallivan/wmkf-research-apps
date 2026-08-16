# Session 442 Prompt: Close Track A and Reconcile Atlas Drift

## Current state

Workbench read coalescing Stage 2 is merged, Production-live, and controlled-verified.

Separately, the remaining small auth follow-ups are merged and Production-live. Main merge
`96d89c32` deployed as `dpl_9aLVHCXupik2CwXDgVrNzcFXXkaC` (READY 2026-08-15): production-mode
allowed-origin validation now fails closed on missing/invalid configuration, Preview derives its
trusted origin from `VERCEL_URL` when fixed `NEXTAUTH_URL` is absent, and both cron verifiers use
the shared constant-time comparison while retaining their distinct development-bypass policies.
Intake proxy/CSRF, raw-error cleanup, grantee policy, and tombstones were explicitly outside this
change.

- Runtime merge: `06a615fcc9301bbd31d5b0a603ef585d588b12f6`
- Promotion record: `897ac285`
- Current verification deployment: `dpl_3BU1Zstkn1ZhEhabfvNE5MFNpdpq`
- Recorded pre-Stage-2 rollback deployment: `dpl_9uZV2SZKizF5dwJFbGVWWD4V4s2Y`
- Production after-baseline:
  `docs/audits/workbench-read-coalescing-stage2-production-after-baseline-2026-08-15.md`

The signed-in GET-only after-baseline exercised empty, small, active+removed, and populated
decline-referral structural strata. All 44 target-route telemetry events succeeded. The
`wmkf_potentialreviewerses` counts were `0/0/0`, `1/1/0`, `1/2/0`, and `1/2/1` for
reviewers/my-candidates/decline-referrals, matching the Stage 2 chunk-aware formula. The combined
before/after count changed `2/4/1 → 1/2/1`; decline remained deliberately unchanged.

One initial unfiltered one-minute log export reached the 5,000-record ceiling and was rejected and
deleted. Five short complete slices were validated fail-closed: 181 telemetry occurrences merged
to 180 unique `eventId`s, with one duplicate occurrence and no conflicting payload. No raw log,
business identifier, response body, or Production record was retained or mutated.

Limits remain explicit: the original before-baseline intentionally retained no request identifiers,
so structural-stratum equivalence is verified but exact request identity is not. No safe >25-id
fixture exists. Controlled timing is descriptive only; no organic-user latency claim is authorized.

## Next actions

### In progress

1. **Close the Track A passive safety window after 2026-08-18 00:53:40Z.** Continue complete
   unfiltered exports within the one-day retention window, flatten `.logs[]`, validate v1
   fail-closed, and deduplicate only on `eventId`. Stop/re-scope at ~50,000 events/day, platform
   throttling/truncation, or visible log cost. Classify the unrelated Graph `drive-item` 4xx
   activity without attributing it to Stage 2.

### Recently closed

1. **Atlas row-count drift reconciled.** A fresh read-only Dataverse `/$count` request returned 793
   `wmkf_appreviewersuggestion` rows at `2026-08-16T04:47:14Z`; the canonical page and its two
   active Atlas summaries now carry that dated snapshot. The earlier Session 438 observation of
   791 remains historical evidence of normal table growth.
2. **Production auth route reached its same-origin validation path.** A signed-in empty PATCH to
   `/api/workbench/decline-referrals` returned the expected pre-write 400, confirming the request
   passed the new Origin guard before body validation. An authenticated Preview smoke was not
   pursued because its generated callback would require Azure redirect configuration; Preview is
   rarely used, and the owner accepted that testing limitation. No Azure/config change is planned.

### Residual, not blockers

1. Union-select protection rests on one projection-completeness test per service; preserve both.
2. `wmkf_areaofexpertise` remains selected but unconsumed to preserve response equivalence.
3. The shared-worktree Jest false-red cause remains unconfirmed; clear Jest cache before citable
   multi-agent verification if the symptom recurs.
4. Optional Stage 1 follow-ups remain owner decisions: `.next/static` marker-scan CI gate and a
   browser-bundle gate.

### Do not reopen without a new owner decision

1. Deferred Data Plane invalidation work remains latency-gated on genuine organic evidence.
2. Reviewer merge org-open access, grantee recipient override, and hard-delete without a tombstone
   remain accepted design/risk decisions.
3. Decline-referrals person reads stay unmerged because there is no duplicate sibling read.
4. Do not reopen authenticated Preview smoke coverage or Azure redirect configuration without a
   new owner decision.

## Key references

- `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`
- `docs/audits/workbench-read-coalescing-stage2-production-after-baseline-2026-08-15.md`
- `docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md`
- `docs/audits/claude-workbench-read-coalescing-stage2-implementation-record-2026-08-15.md`
- `tests/unit/workbench-read-coalescing-stage2-callcounts.test.js`
