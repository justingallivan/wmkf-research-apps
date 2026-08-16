---
title: Workbench Read Coalescing Stage 2 — Implementation and Adversarial-Review Record
domain: architecture
kind: audit
status: active
summary: "Stage 2 read-coalescing implementation, Mode B invariants, builder assignments, and adversarial-review record; branch pending Codex review and owner merge decision."
canonical: false
cataloged: 2026-08-15
last_verified: 2026-08-15
owner: product-engineering
related:
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/audits/claude-workbench-observability-stage1-implementation-record-2026-08-15.md
  - docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md
---

# Workbench Read Coalescing Stage 2 — Implementation and Adversarial-Review Record

**Date:** 2026-08-15
**Branch:** `codex/claude-workbench-read-coalescing-stage2`, base `ab4a87b8` (post-Stage-1 `main`).
**Orchestrator:** Claude Fable; Sonnet builders A/B/C; two independent Opus adversarial reviewers.
**Authorization:** Stage 2 implementation only. Merge, deployment, and Production after-baseline
traffic are NOT authorized from this session; Codex performs the next independent read-only review.

## What was built

Per the plan's Stage 2 census, the three mergeable `fetchPotentialReviewers` +
`fetchResearchersByPerson` sibling pairs (same `wmkf_potentialreviewerses` entity, same 25-id
OR-chain filter, disjoint `$select`) were each replaced with ONE union-`$select` chunked read:

- `lib/services/review-manager/reviewers-service.js` — pair 1 (suggestion reviewer ids). The
  existing `fetchPotentialReviewers` select widened to the 8-field union; `fetchResearchersByPerson`
  deleted; the researcher lookup reads the same map with its original `|| null` fallback.
- `lib/services/reviewer-finder/my-candidates-service.js` — pair 2 (active-candidate ids, main
  `Promise.all` now 3 elements) and, separately, pair 3 (removed-candidate ids inside
  `projectRemovedCandidates`). The active and removed id sets remain independently queried — never
  unioned, proven by a same-person-in-both-sets fixture. 19-field union select;
  `fetchResearchersByPerson` deleted.
- `lib/services/workbench/decline-referrals-service.js` — UNCHANGED (byte-identical; explicit
  non-goal), characterized by a literal pin of its narrow select.

Preserved at every site: `if (!ids?.length) return {}` empty-set short-circuit (zero queries),
`CHUNK = 25` via `chunked(ids, 25)`, `top: 500`, map keyed by `wmkf_potentialreviewersid`,
`personById[id] || {}` vs researcher `|| null` fallback semantics, fail-hard propagation of person
read failures, the fail-soft `aggregateReviewHistory(...).catch(...)` (verbatim), and
`fetchApplicantAkas` (different entity, untouched). `_etag` on removed-candidate person rows comes
from the annotation normalizer (`lib/services/dynamics/annotations.js:23-27`), independent of
`$select` — nothing added to the select for it. No new helper, module, export, cache, memo, flag,
route, migration, or durable write. No edits to Stage 1 telemetry, routes, `dynamics-context.js`,
`lib/dataverse/core/context.js`, the interlock, mutation services, or `shared/components/**`.

## Chunk-aware acceptance

With `q(n) = ceil(n / 25)` and empty sets contributing zero:

```text
before = 2·q(reviewers) + 2·q(active) + 2·q(removed) + q(decline)
after  =   q(reviewers) +   q(active) +   q(removed) + q(decline)
```

`tests/unit/workbench-read-coalescing-stage2-callcounts.test.js` proves the `after` formula at the
service layer with exact `===` call counts (fails if duplicate reads return), in-order chunk
chains for >25-id sets, union proof (every call's select contains a former-person-only AND a
former-researcher-only field), active/removed independence, zero-call empty sets, the unchanged
literal decline select, and a whole-page composite computing the expected total from a literal
`ceil`-based `q()` in the test.

## Builder assignments (disjoint ownership, shared worktree, no git ops by builders)

| Builder | Files |
|---|---|
| Sonnet C (phase 1) | `tests/unit/workbench-read-coalescing-stage2-characterization.test.js` (committed green against the PRISTINE services as `32030b50` before any service edit — plan Stage 2 precondition 2) |
| Sonnet A | `lib/services/review-manager/reviewers-service.js`; `tests/unit/reviewers-service.test.js` |
| Sonnet B | `lib/services/reviewer-finder/my-candidates-service.js`; `tests/unit/my-candidates-service.test.js`; `tests/integration/my-candidates-route.test.js` |
| Sonnet C (phase 2) | `tests/unit/workbench-read-coalescing-stage2-callcounts.test.js` |
| Fable | integration, documentation, all git operations |

The characterization suite uses a select-agnostic fixture DB (mock filters by parsed id only,
serving merged person+researcher records), so the identical pins run green against both the
pristine (`32030b50`) and merged (`1b64a0da`) services — Reviewer 2 re-verified this directly by
temporarily restoring the `ab4a87b8` service files and re-running the unedited pins. **Evidence
precision (Opus R1-2):** because the mocks ignore `$select`, the pins alone cannot detect the
merge or a select regression — they prove DTO-shape equivalence given identical row data. The
select/count discrimination comes from the callcounts suite and the two per-service
projection-completeness tests, and the no-cross-read premise (no pre-merge code path read a
researcher field off the person record or vice versa) was closed by Reviewer 1's exhaustive
enumeration of every `person.X` / `researcher?.X` consumer against the two former select lists
(zero cross-reads in either direction). The suites that formerly disambiguated the pair by
`$select` content (`select.includes('wmkf_name')` vs `('wmkf_primaryaffiliation')`) were updated
by the owning builders to exact-total-count + union-content assertions.

## Invariant table (Mode B contract-reconcile, pre-implementation)

| # | Invariant | Verification |
|---|---|---|
| 1 | Response DTOs equivalent across active/removed/combined/empty fixtures | pre-committed characterization pins pass unchanged post-merge |
| 2 | Merged `$select` ⊇ union of both former projections (8-field / 19-field, incl. `wmkf_areaofexpertise`) | projection-completeness tests pin the FORMER lists as literals |
| 3 | Chunk 25 preserved; >25 ids ⇒ ceil(n/25) in-order queries | 26-id fixtures, exact chains |
| 4 | Empty id set ⇒ zero person-read queries | never-called assertions |
| 5 | Call counts match the `after` formula exactly; duplicate-read regression fails tests | `===` count assertions per fixture |
| 6 | Active and removed id sets independently queried (no union) | shared-person-id fixture ⇒ 2 calls with per-set filters |
| 7 | `\|\| {}` / `\|\| null` missing-row fallbacks preserved | missing-row fixtures (name/affiliation/hIndex null) |
| 8 | `aggregateReviewHistory` stays separate fail-soft | rejection fixture ⇒ list returns |
| 9 | `fetchApplicantAkas` untouched | diff scope + existing account-chunk test |
| 10 | Decline service byte-identical | `git diff` (untouched) + literal narrow-select pin |
| 11 | Person-read failure stays fail-hard untyped | rejection tests |
| 12 | `personEtag` preserved for removed candidates | annotation-normalizer evidence + removed-candidate pin |
| 13 | DAL/auth/interlock/correlation untouched | diff surface limited to the two services + tests |
| 14 | Mutation paths untouched | PATCH/DELETE suites unchanged and green |
| 15 | `top: 500` / one-page adapter semantics preserved | args assertions |
| 16 | No new shared helper/module/flag/cache | diff review (no new lib files, no new exports) |
| 17 | Stage 1 telemetry unmodified | observability suites 124/124 with zero edits |

Complement/fall-through audit (build side): the helpers' only branch is the empty-set
short-circuit; nonempty complements chunk at 25. Ids with no returned row land on the existing
`\|\| {}` / `\|\| null` defaults; the two former queries had identical filters on the same entity, so
the single merged map serves both lookups (the merge removes two-snapshot read-skew — strictly more
consistent; the plan's different-row-set stop condition verified false against source). Duplicate
ids are deduped by callers (`new Set`) before the helpers. Query failure propagates fail-hard
untyped as before. Sibling-shape sweep: decline `fetchReviewerPeople` (single read — deliberately
unchanged), `fetchApplicantAkas` (different entity), and — added by Opus R2-19 —
`synthesize-reviews-service.js:123-136` `fetchPersonNames` (same entity/OR-chain/chunk shape but a
single read with nothing to merge; census conclusion unaffected). Reviewer 2 also cleared
`reviewer-rollup.js`, `reviewer-suggestion-sweep.js`, and `my-proposals-service.js` (none read
`wmkf_potentialreviewerses`).

## Verification (2026-08-15, integration pass on `1b64a0da`)

- 14 focused suites, **135/135** (exact file list, per Opus R2-15): `tests/unit/`
  `reviewers-service`, `my-candidates-service`, `workbench-read-coalescing-stage2-characterization`,
  `decline-referrals-service`, `decline-referrals-endpoint`, `reviewer-manage-decline-referrals`,
  `my-candidates-faculty-page-url-gate`, `my-candidates-partial-save-on-email-conflict`,
  `my-candidates-verify-address`, `review-manager-reviewers-outstanding-dto`,
  `review-manager-reviewers-synthesis-dto`, `workbench-route-correlation` (all `.test.js`), plus
  `tests/integration/my-candidates-route.test.js` and
  `tests/integration/review-manager-reviewers-live-questions.test.js`. (The callcounts suite landed
  after this pass; final-tree totals below.)
- Stage 2 acceptance + characterization suites: 20/20.
- Six Stage 1 observability suites: **124/124**, zero edits.
- `check:types`: PASS. Repo-wide `npm run lint`: 0 errors, 65 warnings (matches the Stage 1
  closeout baseline; warnings all in unrelated files). `git diff --check`: clean.
- Full gate battery (all 33 `check:*` gates + self-tests, sequential pairing): PASS on the clean
  base at session start; the final-tree gate re-run is recorded in the closeout section below
  (Opus R2-16 closed).

### Jest transform-cache hazard (Opus R1-1, resolved)

During review, intermittent non-reproducible failures (13–16 false reds concentrated in
call-count/select assertions) appeared in parallel cold-cache runs; Reviewer 1 proved the executed
module could not be HEAD source (single call site cannot yield two calls; `clearAllMocks` rules
out carryover). **Cause: consistent with stale jest transform-cache entries from mid-build states
in this shared worktree, but UNCONFIRMED** — one signature (the fail-soft test rejecting with
`'history query failed'`) would require an executed module lacking the S308-era `.catch`, which no
committed version lacks, and remains unexplained. The load-bearing conclusions hold regardless:
the hazard produces false REDS only, never false greens, so committed-green claims are not
silently corrupted. Warm/serial baselines were fully green across repeated runs (Reviewer 1:
`-w 1` ×3 and 12 warm parallel runs, all green). Resolution: `npx jest --clearCache`, then three
consecutive parallel runs of the six affected suites (the five changed test files plus
`decline-referrals-service.test.js`) — **111/111 each**; Reviewer 1's delta pass re-ran a
seven-suite superset three times at 115/115 with zero recurrence. Tooling hazard only; no defect
in the diff.

## Opus adversarial review (2026-08-15, two independent reviewers over `1b64a0da`)

**Neither reviewer raised a BLOCKING finding.** Reviewer 1 (behavior/contract) verified row-set
identity (character-identical pre-merge filters; the plan's different-row-set stop condition
genuinely false), the adapter path's two select-dependent seams (`checkRestriction` symmetric
across the merge; `processAnnotations` per-key/additive so the merged record is exactly the key
union), exact projection unions by programmatic set-diff (8/8 and 19/19, no extras/dupes),
exhaustive consumer enumeration (zero cross-reads), chunk boundary behavior, empty sets,
active/removed independence, fail-soft/fail-hard preservation, DAL/auth/interlock/telemetry
absence from the diff, and mutation-path isolation. Reviewer 2 (test teeth) mutation-tested the
suite: duplicate-read revival → 13 failures across 3 suites; select narrowing → the 2
projection-completeness tests fail; active/removed unioning → the 2 independence tests fail;
fail-soft removal → 3 failures (the 2 fail-soft tests plus a collateral mock-carryover failure of
the fail-hard test under the mutant; pristine code unaffected — the `.catch` neutralizes the
carryover); fail-hard softening → 2 failures; and re-ran the unedited
characterization pins against the restored pristine services (10/10 both sides, pin file diff
between the two commits empty). Scope containment, observability suites (124/124, telemetry
untouched), and gate spot-runs were all clean; the worktree was left byte-identical
(sha256-verified restorations).

Findings and dispositions:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| R1-1 | HIGH (tooling) | Intermittent false-red jest failures in this worktree not producible from HEAD source — stale parallel cold-cache transform entries from mid-build states; warm/serial runs 100% green. | RESOLVED: `npx jest --clearCache` + three consecutive parallel runs of the six affected suites, 111/111 each (recorded above). No code change. |
| R1-2 | MEDIUM | Select-agnostic characterization pins alone cannot detect the merge or a select regression; equivalence rests on the callcounts/projection tests + the zero-cross-read source proof. | FIXED (doc): builder-assignments section now states exactly what the pins prove and where discrimination lives. |
| R1-3 | LOW | Integration route mock flattened to one merged record — that suite no longer distinguishes projections. | RECORDED: inherent to the merge (one call, one select); projection protection lives in the two unit-level completeness tests (see R2-3). |
| R1-4 | INFO | `wmkf_areaofexpertise` selected but unconsumed — pre-existing, unchanged. | RECORDED; removing it would be a select-narrowing outside this stage's response-equivalence mandate. |
| R1-5 | INFO | Two-snapshot read-skew eliminated (strictly more consistent); no consumer relied on skew. | RECORDED (also in the complement audit above). |
| R2-1/2/4/6/7 | INFO | Mutation tests confirm teeth: duplicate reads, select narrowing, set unioning, fail-soft removal, fail-hard softening all caught by the specific tests claiming to guard them. | Evidence retained in review transcript; no action. |
| R2-3 | LOW | Union select protected by exactly ONE literal test per service (hydration/characterization are select-blind by design). | RECORDED as a named carry-forward: deleting either projection-completeness test silently removes all union protection. |
| R2-5 | LOW | Two empty-set tests were vacuous w.r.t. the helper guard (they pin the envelope early return). | FIXED: tests retitled/re-commented to claim what they prove; builder B additionally established that plain deletion of the `!ids?.length` guard is an EQUIVALENT mutant (`chunked([],25)` yields zero chunks) — the guard's value is null/undefined safety; fixtures 4/8 prove zero-calls-on-empty against any query-issuing mutant. |
| R2-15 | MEDIUM | "14 suites / 135 tests" not reproducible from prose. | FIXED (doc): exact file list enumerated above. |
| R2-16 | MEDIUM | Dangling forward reference — final-tree gate re-run promised but absent. | FIXED (doc): closeout section below records the final-tree runs. |
| R2-17 | LOW | Repo-wide 65-warning lint figure unverified by reviewer. | VERIFIED by orchestrator's own repo-wide `npm run lint` on the merged tree: 0 errors, 65 warnings. |
| R2-18 | LOW | Plan doc carried stale pre-merge line refs outside the re-framed census column. | FIXED (doc): status header now declares ALL Stage 2 `file:line` refs pre-merge anchors and lists the verified post-merge anchors (`reviewers-service.js:510`, `my-candidates-service.js:392,408,175-178,426`, `decline-referrals-service.js:45`). |
| R2-19 | LOW | Sibling-shape sweep sentence overstated completeness (`fetchPersonNames` in synthesize-reviews-service is same-shape, single read). | FIXED (doc): sweep list corrected above; census conclusion unaffected. |
| R2-20 | INFO | Invariant table spot-check: all 17 rows hold (rows 2 and 4 with the nuances of R2-3/R2-5). | RECORDED. |

**Reviewer-conflict reconciliation (R2 mutation vs. builder B's re-check):** Reviewer 2's
empty-set mutation made the helper ISSUE a query on empty input (caught by fixtures 4/8);
builder B's plain guard-line deletion is behaviorally equivalent code (`chunked([])` iterates
zero times) and is correctly undetectable. Both results are accurate for their respective
mutants; the callcounts fixture-7 comment now states this precisely.

## Final-tree verification (2026-08-15, remediated tree)

- Combined focused run (the 14 suites above + the callcounts suite + the five other Stage 1
  observability suites): 20 suites, **264/264**.
- Gate re-run, sequential pairing (Opus R2-16 closed): `check:dataverse-access-layer` + self-test,
  `check:types`, `check:doc-currency` + self-test, `check:fact-consistency` + self-test,
  `check:build-claim-freshness` + self-test, `check:docs-catalog`, `check:doc-symbol-refs` +
  self-test, `check:canonical-pointers` + self-test — ALL PASS.
- `npm run build` (production): PASS.
- Full `tests/unit` + `tests/integration`: **8206/8208 — the only 2 failures are the two known
  baseline failures** (`reconcile-probe-entity-set-count`, `notification-trust-model-pushup`),
  re-reproduced this session on the pristine base `ab4a87b8` in the main checkout with identical
  results; neither references the changed files.
- Repo-wide lint: 0 errors, 65 warnings (baseline). `git diff --check`: clean.

## Delta re-review (2026-08-15, both reviewers over `2e704797`, diff `1b64a0da..2e704797`)

Both reviewers independently confirmed: the delta is comment/doc-only (zero source files; zero
assertion lines changed — Reviewer 2 grep-verified no `expect` line in the diff and re-planted the
duplicate-read mutation post-delta with a byte-identical 13-failure outcome); every original
finding RESOLVED, RECORDED, or VERIFIED as dispositioned; all post-merge plan anchors verified
against live source (Reviewer 1 additionally corrected its own first-pass `:425` to the record's
`:426`); the equivalent-mutant claim in the retitled tests independently re-verified by both
(plain guard deletion → 97/97 green, correctly undetectable; query-issuing empty-set mutant →
caught by fixtures 4/8); the 14-suite enumeration reproduces 135/135 exactly; the final-tree
numbers (264/264, 8206/8208 with the two pre-existing base failures, gates, lint 0/65) all
independently reproduced. Reviewer 2's final `git status` was completely clean with sha256-matched
service files. Delta findings — all LOW/INFO documentation-precision items, closed in the closeout
commit: the R1-1 cause is now recorded as unconfirmed-with-one-unexplained-signature (false-reds
only); the six-suite list is enumerated; the fail-soft mutation count corrected to 3 (collateral
mock-carryover explained); the plan/security docs now cite implementation vs. closeout commits
distinctly. **Zero findings remain open; no blocking or high finding was raised at any point
across all passes.**

## Not performed (per authorization)

Merge, deployment, Production probes or after-baseline traffic, organic-latency claims, mutation
of any production state, Stage 1 telemetry changes, unrelated work. The observed unrelated Graph
drive-item 4xx activity remains a Track A watch item.
