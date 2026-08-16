# Session 441 Prompt: Workbench Stage 2 Production After-Baseline

## Current state

Workbench read coalescing Stage 2 is merged and Production-live. The owner authorized the merge
after Claude Fable's implementation/adversarial-review cycle and Codex's independent review.

- `main` merge: `06a615fcc9301bbd31d5b0a603ef585d588b12f6`
- First Stage 2 Production deployment: `dpl_8wHbRErjdbaaqLtKNSfqHo8TUV3B`
  (READY 2026-08-16 03:01:20Z)
- Recorded pre-Stage-2 rollback deployment: `dpl_9uZV2SZKizF5dwJFbGVWWD4V4s2Y`
- Stage 2 implementation branch: `codex/claude-workbench-read-coalescing-stage2`
  (implementation `1b64a0da`; final reviewed branch commit `614f05be`)

The merged runtime replaces three duplicate sibling reads with one union-`$select` chunked read per
independent reviewer/active/removed id set. Active and removed sets remain separate. The decline
referrals read remains unchanged. There is no new cache, flag, migration, durable write, mutation
path, auth change, or Stage 1 telemetry change.

Merged-main verification before push: seven focused suites 115/115; Dataverse access-layer gate
and self-test PASS; type check PASS; `git diff --check` PASS; clean-output Production build PASS.

## Next actions

### Verified open

1. **Run the controlled Stage 2 Production after-baseline.** Repeat only the same safely available
   signed-in GET/read Track B strata from
   `docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md`. Compare
   `wmkf_potentialreviewerses` event counts against:

   ```text
   after = q(reviewers) + q(active) + q(removed) + q(decline)
   q(n) = ceil(n / 25), with empty sets contributing zero
   ```

   Do not PATCH, DELETE, dismiss, merge, send, select, or change Production state. Record a missing
   >25-id stratum as unavailable. Do not claim organic p50/p95 improvement from controlled traffic.
2. **Reconcile Atlas row-count drift** for
   `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` (790 documented versus 791 observed by the
   Session 438 reconcile probe). Re-probe before editing; this is a small main-side documentation
   correction, separate from Stage 2 acceptance.

### In progress

1. **Track A passive safety watch** remains open through 2026-08-18 00:53:40Z. Continue complete
   unfiltered exports within the one-day retention window, flatten `.logs[]`, validate v1
   fail-closed, and deduplicate only on `eventId`. Stop/re-scope at ~50,000 events/day, platform
   throttling/truncation, or visible log cost. The unrelated Graph `drive-item` 4xx activity remains
   a classification watch item.

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
- `docs/audits/claude-workbench-read-coalescing-stage2-implementation-record-2026-08-15.md`
- `docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md`
- `tests/unit/workbench-read-coalescing-stage2-callcounts.test.js`
- `tests/unit/workbench-read-coalescing-stage2-characterization.test.js`
