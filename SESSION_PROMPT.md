# Session 442 Prompt: Close Track A and Reconcile Atlas Drift

## Current state

Workbench read coalescing Stage 2 is merged, Production-live, and controlled-verified.

Separately, the owner authorized the remaining small auth follow-ups. Branch
`codex/security-origin-cron-hardening` (base `715ab060`) implements production-mode
allowed-origin fail-closed behavior plus shared constant-time cron-secret comparison. It is
regression-tested and independently adversarially reviewed, but remains unmerged and not
Production-live pending an owner promotion decision. Intake proxy/CSRF, raw-error cleanup, grantee
policy, and tombstones are explicitly outside that branch.

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

### Verified open

1. **Reconcile Atlas row-count drift** for
   `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` (790 documented versus 791 observed by the
   Session 438 reconcile probe). Re-probe before editing; this is a small main-side documentation
   correction, separate from Stage 2 acceptance.
2. **Review and deliberately promote `codex/security-origin-cron-hardening`.** Confirm the
   implementation record and verification evidence first; do not treat branch completion as a
   Production activation. After promotion, run the branded-host signed-in write/mismatched-Origin
   smoke and a separate Preview write smoke with fixed `NEXTAUTH_URL` absent.

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

## Key references

- `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`
- `docs/audits/workbench-read-coalescing-stage2-production-after-baseline-2026-08-15.md`
- `docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md`
- `docs/audits/claude-workbench-read-coalescing-stage2-implementation-record-2026-08-15.md`
- `tests/unit/workbench-read-coalescing-stage2-callcounts.test.js`
