# Session 439 Prompt: Codex Read-Only Review of Workbench Read Coalescing Stage 2

## Session 438 Summary

Claude Fable orchestrated the authorized Stage 2 read-coalescing build to completion on
`codex/claude-workbench-read-coalescing-stage2` (worktree
`WMKF_Apps-claude-workbench-read-coalescing-stage2`, exact base `ab4a87b8`). The branch is pushed
and the worktree is clean and synchronized. **Not performed, per authorization: merge, deployment,
Production probes/after-baseline traffic, organic-latency claims, Stage 1 telemetry changes, or
unrelated work.** Codex performs the next independent read-only review; merge remains an explicit
owner decision.

### What Was Completed

1. **The three authorized read merges.** Each concurrent
   `fetchPotentialReviewers` + `fetchResearchersByPerson` pair (same `wmkf_potentialreviewerses`
   entity, same 25-id OR-chain, disjoint `$select`) became one union-`$select` chunked read:
   reviewer-manager pair in `lib/services/review-manager/reviewers-service.js` (8-field union),
   and separate active and removed merges in
   `lib/services/reviewer-finder/my-candidates-service.js` (19-field union; active/removed id
   sets never unioned — proven by a shared-person-id fixture). `fetchResearchersByPerson`
   deleted in both. Preserved: chunk 25, `top:500`, empty-set short-circuits, `|| {}` / `|| null`
   fallbacks, fail-soft `aggregateReviewHistory`, `fetchApplicantAkas`, fail-hard person-read
   errors, `_etag`-derived `personEtag`. `decline-referrals-service.js` byte-identical
   (characterized, its narrow select pinned literally). No new helper/cache/flag/route/durable
   write; no DAL/auth/interlock/telemetry/mutation-path change.
2. **Two-phase test evidence.** A select-agnostic characterization suite (10 tests) was committed
   green against the PRISTINE services first (`32030b50`), then passed unchanged against the
   merged services. New acceptance suite
   `tests/unit/workbench-read-coalescing-stage2-callcounts.test.js` proves
   `after = q(reviewers)+q(active)+q(removed)+q(decline)`, `q(n)=ceil(n/25)`, with exact `===`
   counts, >25-id two-chunk fixtures, union-content proof per call, and the unchanged decline
   select. Existing suites' select-dispatch mocks replaced with exact-count + union assertions.
3. **Adversarial convergence.** Two independent Opus reviewers (behavior/contract; test
   teeth/docs) + Sonnet remediation + Opus delta re-review: **zero blocking or high findings at
   any point; zero findings open.** Mutation testing confirmed teeth (duplicate-read revival →
   13 failures; select narrowing, set unioning, fail-soft removal, fail-hard softening all
   caught). Full findings/disposition tables:
   `docs/audits/claude-workbench-read-coalescing-stage2-implementation-record-2026-08-15.md`.
4. **Verification.** Focused suites 264/264 (20 files); Stage 1 observability suites 124/124 with
   zero edits; production build PASS; full `tests/unit`+`tests/integration` 8206/8208 with only
   the two known baseline failures (`reconcile-probe-entity-set-count`,
   `notification-trust-model-pushup`), both re-reproduced on pristine `ab4a87b8` in the main
   checkout; all doc/code gates + self-tests sequential PASS; lint 0 errors/65 baseline warnings;
   `git diff --check` clean. Full 33-gate battery was green on the clean base at session start.
5. **Docs + sweep.** Plan Stage 2 status header (implemented-on-branch, pre-merge-anchor
   re-frame with verified post-merge anchors), `docs/SECURITY_OPERATING_PLAN.md` watch sentence,
   the new implementation record, and a Mode A /sweep (one live stale present-tense sentence
   fixed; `CHUNK_CONSOLIDATION_PLAN.md` / `REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md`
   classified HISTORICAL under their `status: historical` frontmatter; Atlas/wiki never described
   the pair count — nothing stale there).

### Commits (base `ab4a87b8`)

- `32030b50` — Pin pre-merge characterization for Stage 2 read coalescing
- `1b64a0da` — Coalesce Workbench duplicate person reads (Stage 2) [implementation]
- `2e704797` — Close Stage 2 Opus findings and record verification
- `14a5185b` — Record Stage 2 delta re-review closure
- `96fa1566` — Sweep the last live pre-merge read-path restatement
- (+ the Session 438 closeout commit carrying this file and the memory write)

### Session gotchas for continuity

- **Jest transform-cache false reds** in the shared worktree (Opus R1-1): after multi-agent
  edits, `npx jest --clearCache` before citable verification runs; the hazard produced false
  REDS only. New memory: `feedback-clear-jest-cache-in-shared-worktrees.md`. One failure
  signature remains unexplained (cause recorded as unconfirmed in the implementation record).
- The `/start` gate battery's reconcile probe rewrote `docs/RECONCILIATION_REPORT.json` with a
  live drift observation (`wmkf_appreviewersuggestion` Atlas claim 790 vs live 791, plus
  sibling-entity rows); the rewrite was reverted to keep the branch scoped. **The Atlas
  row-count staleness itself is a real observation** — see Verified Open item 3.

## Next Items

### Verified Open

1. **Codex independent read-only review of `codex/claude-workbench-read-coalescing-stage2`.**
   Evidence: this branch at `96fa1566`+; work order in Session 438 prompt; implementation record.
   Review the five commits, the invariant table, and the acceptance suites; do not merge.
2. **Owner merge decision, then deployment and the Stage 2 Production after-baseline** (repeat
   the Track B safe strata; compare `wmkf_potentialreviewerses` counts against the `after`
   formula; no manufactured >25-id fixture; no organic-latency claims).
   Evidence: plan §Stage 2 acceptance/Track B; baseline audit doc. Owner-gated.
3. **Atlas row-count drift** on `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` (claim 790,
   live 791 as of 2026-08-16 probe). Evidence: reconcile-probe output observed this session (file
   reverted); `reconcile-probe-entity-set-count` is also one of the two known-failing baseline
   suites. Small doc reconcile on `main`, outside Stage 2 scope.

### In Progress (concurrent watch)

1. **Track A passive operational safety** — open through 2026-08-18 00:53:40Z; daily unfiltered
   slice exports (one-day Pro retention), `.logs[]` flatten + v1 validation, `eventId` dedup;
   stop conditions: ~50,000 events/day, throttling/truncation, visible log cost. The unrelated
   Graph drive-item 4xx activity remains a Track A classification item.

### Residual (named, not blockers)

1. Union-select protection rests on exactly ONE projection-completeness test per service
   (Opus R2-3) — deleting either silently removes it.
2. `wmkf_areaofexpertise` selected but unconsumed in my-candidates (pre-existing; narrowing
   would breach this stage's response-equivalence mandate).
3. Jest cache hazard cause unconfirmed (one unexplained signature; false-reds only).
4. Stage-1-inherited owner options: `.next/static` marker-scan CI gate; browser-bundle gate.

### Do Not Reopen Without New Decision

1. Deferred Data Plane work (latency-gated on genuine organic evidence).
2. Reviewer merge org-open access; grantee recipient override; hard-delete without tombstone —
   accepted by design/risk (see Session 437 prompt and memory archive).
3. Decline-referrals person read stays unmerged (nothing to merge — explicit non-goal).

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/audits/claude-workbench-read-coalescing-stage2-implementation-record-2026-08-15.md` | Full Stage 2 record: invariants, builders, all Opus findings/dispositions, verification |
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Plan with Stage 2 implemented-on-branch status + pre-merge-anchor boundary |
| `tests/unit/workbench-read-coalescing-stage2-characterization.test.js` | Pre-merge response pins (committed before the merge; unchanged since) |
| `tests/unit/workbench-read-coalescing-stage2-callcounts.test.js` | Chunk-aware acceptance-formula suite |
| `docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md` | Track B before-baseline + Track A status |

## Testing

```bash
# From the Stage 2 worktree:
npx jest --clearCache   # shared-worktree hygiene before citable runs
npx jest tests/unit/workbench-read-coalescing-stage2-characterization.test.js \
        tests/unit/workbench-read-coalescing-stage2-callcounts.test.js \
        tests/unit/reviewers-service.test.js tests/unit/my-candidates-service.test.js
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
npm run check:types && npm run build
```
