---
title: Array-Chunk Consolidation Plan
domain: architecture
kind: plan
status: draft
summary: "Consolidate hand-rolled array-chunking loops onto lib/utils/chunk.js: 17 mechanical swaps, 4 index-using left with comment, 1 sibling leave. Draft."
canonical: true
cataloged: 2026-07-05
owner: product-engineering
related:
  - docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md
  - docs/SERVICE_AND_UTILITY_CATALOG.md
  - docs/CI_GATES_REFERENCE.md
  - docs/CLAUDE_REMEDIATION_PLAN.md
---

# Array-Chunk Consolidation Plan

**Execution status: DRAFT — not yet executed, not yet reviewed.** The docs-catalog frontmatter
`status` enum has no "completed" value; this stays `draft` until execution, then follows the
`ODATA_ESCAPE_CONSOLIDATION_PLAN` precedent (a body line records completion, frontmatter moves to a
live enum value). See the Stage Log for probes/counts.

**Objective.** Many files hand-roll the same array-chunking idiom —
`for (let i = 0; i < arr.length; i += N) { const chunk = arr.slice(i, i + N); … }` — to bound
OData OR-chain URL length, cap concurrency, or page an external API. This is copy-pasted drift: the
same three-line scaffold appears at 20+ sites with only the collection, the size constant, and the
body differing. This plan consolidates the **scaffold** onto one canonical helper,
`chunk(array, size)` in `lib/utils/chunk.js` (new file), leaving every loop **body** byte-identical.
`lib/utils/` is the established home for single-purpose helpers (`guid.js`, `date-ymd.js`,
`name-normalization.js`, `orcid-normalize.js`) `[VERIFIED via ls lib/utils/ this session]`. This is a
motion refactor, not a redesign: same batches, same size, same order, same downstream calls.

**No name collision.** At drafting time `lib/utils/chunk.js` did not exist
`[VERIFIED via ls lib/utils/chunk.js → "No such file or directory", at drafting]`.
[RECHECKED after lib/utils/chunk.js change: Stage 0 execution has now created the helper per The-canonical-semantics (771 bytes, ls this session); the executing agent appends its Stage Log entry at close]
Nothing under
`lib/`/`pages/`/`shared/`/`modules/` exports a `chunk` helper today; the 20+ occurrences of the token
`chunk` are all **local loop-slice variables**, not an importable helper `[VERIFIED via the
disconfirming grep in the Stage Log]`.

**Executor profile.** Written to be executed by a cheaper model (Sonnet-class) with no prior context,
following this document plus each stage's checklist. Every judgment is pre-made here; anything not
pre-made is marked **STOP-AND-ASK**. There are no open behavioral STOP-AND-ASK sites in this plan
(see Classification); the only deferred item is the optional Stage 3 gate, framed as an OWNER
DECISION.

---

## Baseline (probed, not assumed)

| Fact | Value | Evidence |
|---|---|---|
| Canonical helper | `chunk(array, size)` in `lib/utils/chunk.js` — **to be created in Stage 0** | file does not yet exist `[VERIFIED via ls, this session]` |
| Total `for (let i = 0; i < X.length; i += …)` scaffolds under `lib/ pages/ shared/ modules/` | **23** | `[VERIFIED via grep -rnE "for \(let i = 0; i < [A-Za-z_.]+\.length; i \+= " lib/ pages/ shared/ modules/ --include=*.js \| wc -l = 23]` |
| — of those, `i += 1` plain-iteration loops (NOT chunk sites) | **2** | `role-apply.js:76` (`ops.length; i += 1`), `discovery-service.js:1015` (`candidates.length; i += 1`) — no `slice`, step 1 `[VERIFIED via grep this session]` |
| Chunk scaffolds whose counter is NOT named `i` (missed by the grep above; found by review round 1) | **1** — `discovery-service.js:2269` (`batchStart += BATCH_SIZE`) | `[VERIFIED via Read :2265-2305 this session]` — the census grep must ALSO run the any-identifier variant `grep -rnE "for \(let [A-Za-z_]+ = 0; [A-Za-z_]+ < [A-Za-z_.]+\.length; [A-Za-z_]+ \+= " …` |
| **In-scope chunk sites** (counter `+= <sizeVar/const>` with a `slice(counter, counter+size)` body) | **22** (across 14 files) | derived independently: 23 − 2 plain loops + 1 non-`i` counter = 22 |
| — MECHANICAL (body never reads the counter) → swap | **17 sites / 12 files** | see Classification |
| — INDEX-USING (body reads the counter) → leave-with-comment | **4 sites / 4 files** | see Classification |
| — EXEMPT/LEAVE (sibling-cohesion) | **1 site / 1 file** | `chat.js:2166`, see Classification |
| Decoys that must NOT be conflated | 8+ `decoder.decode(value,{stream:true})` streaming `chunk` vars in `pages/*.js`; 3 `scripts/` named `chunked/chunks` helpers | `[VERIFIED via grep, listed in Decoys]` |
| Module format of `lib/utils/` single-purpose helpers | **ESM** (`export function …`) | `guid.js:22`, `date-ymd.js:14`, `orcid-normalize.js:14`, `name-normalization.js:14` all `export function` `[VERIFIED via grep this session]` |
| CJS→ESM interop already exercised in-repo | **YES** | `openalex-service.js:9` (CJS) `require('../utils/orcid-normalize')` (ESM); `deduplication-service.js:12` (CJS) `require('../utils/name-normalization')` (ESM); ESM importers use `import { … } from '…/utils/guid.js'` `[VERIFIED via grep this session]` |
| DAL gate | `npm run check:dataverse-access-layer` (+ `:self-test`) | `[VERIFIED via package.json:70-71]` |
| Route/service boundary gate | `npm run check:route-service-boundary` (+ `:self-test`) | `[VERIFIED via package.json:74-75]` |
| Full suite | `npm test` (`jest`) | `[VERIFIED via package.json test script]` |
| Helper unit-test home | `tests/unit/utils/chunk.test.js` (there is a `test:utils` script) | `[VERIFIED via package.json test:utils]` |

### Existing chunk-boundary coverage of target files (Stage 0 completes this)

`[VERIFIED via grep + Read of each named test this session]`

| Module / site | Test file | Pins the chunk boundary? |
|---|---|---|
| `review-answer.js:80` | `tests/unit/review-answer-adapter.test.js:115-117` | **YES** — 21 ids → asserts split into 20+1 (OR-chain length bound) |
| `reviewer-rollup.js:35` | `tests/unit/reviewer-rollup.test.js:52-53` | **PARTIAL** — 30 ids → asserts only `toHaveBeenCalledTimes(2)`, NOT batch contents/order `[VERIFIED via Read :52-57 this session; review round 1 finding 2]` — strengthen in Stage 0 |
| `reviewer-suggestion.js:351` (`aggregateReviewHistory`) | `tests/unit/reviewer-suggestion-review-history.test.js` | **VERIFY in Stage 0** — header says "batched"; confirm it feeds >25 ids and asserts the split, else add |
| `reviewer-suggestion.js:1000/:1071` (`findByPD`/`findAcceptedByPD`) | `tests/unit/adapter-characterization-stage2.test.js` pins the *filter string*, not the >25 split | **GAP** on the chunk boundary |
| `reviewer-suggestion-sweep.js:61` | none found | **GAP** |
| `synthesize-reviews-service.js:73/:143` | none found for the chunk split | **GAP** |
| `reviewers-service.js:386/:431` | none found for the chunk split | **GAP** |
| `discovery-service.js:451` | none found for the concurrency batching | **GAP** |
| `contact-history-service.js:136` | `tests/unit/contact-history-service.test.js` exists | **VERIFY in Stage 0** — confirm it feeds >50 request ids and asserts the split, else add |
| `my-candidates-service.js:349/:366/:388` | `tests/unit/my-candidates-service.test.js` (no length>25 fixtures) | **GAP** |
| `my-proposals-service.js:212` | `tests/unit/my-proposals-service.test.js:136` | **PARTIAL** — 30 request rows → asserts `queryAllSuggestions` called twice `[VERIFIED via Read :136-146 this session; review round 1 finding 3 corrected the earlier GAP claim]` — strengthen to contents/order in Stage 0 |
| `evaluate-multi-perspective.js:233` (`processWithConcurrency`) | none found | **GAP** — generic helper, trivially unit-testable |

---

## The canonical semantics (pin before touching anything)

`lib/utils/chunk.js` will export (ESM — matching every other `lib/utils/` single-purpose helper):

```js
/**
 * Split `array` into consecutive sub-arrays of at most `size` elements, in order.
 * Fail-closed on bad input (matches the guarded-swap precedent in
 * docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md): a hand-rolled loop with a non-array or
 * a size <= 0 either throws on `.length`/`.slice` or (size 0) spins forever, so a
 * loud throw is a strictly safer superset, never a behavior regression for a real caller.
 */
export function chunk(array, size) {
  if (!Array.isArray(array)) throw new TypeError('chunk: array must be an array');
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('chunk: size must be a positive integer');
  }
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}
```

Exact behavior (this is the contract the executor must NOT drift from):

- **Empty array → `[]`** (zero sub-arrays). A hand-rolled `for (i=0; i<0; …)` runs zero times, so
  `for (const c of chunk([], N))` is byte-equivalent (zero iterations). All in-scope sites also guard
  `if (!ids?.length) return …` *before* the loop, so an empty array never even reaches it.
- **Last sub-array is a partial** (e.g. `chunk([1..21], 20)` → `[[1..20], [21]]`). Byte-identical to
  the current `slice(i, i + N)` tail.
- **Order preserved**; no element dropped or duplicated; `array` is NOT mutated.
- **Non-array input → `TypeError`** (fail-closed). A hand-rolled loop reading `.length`/`.slice` of a
  non-array also throws a `TypeError` — equivalent, but the message is now explicit.
- **`size` not a positive integer → `RangeError`** (fail-closed). A hand-rolled loop with `size <= 0`
  either never advances (`i += 0` → infinite loop) or under-chunks; the throw is safe hardening. No
  in-scope caller passes a non-positive or non-integer size — all sizes are positive-integer literals
  or constants (20, 25, 50, 200) or a positive concurrency/limit config value `[VERIFIED per-site in
  Classification]`.

**The one thing that must never change:** the loop **body** (the code inside the braces) is preserved
verbatim at every mechanical site — including any `throw` on a 5000-row cap, any rate-limit
`setTimeout` delay, any `signal?.aborted` abort check, and any `Promise.all`/`Promise.allSettled`.
Those quirks live in the BODY; the swap only replaces the three-line **scaffold**
(`for (let i …; i += N) { const chunk = arr.slice(i, i+N);`) with `for (const chunk of chunked(arr, N)) {`.

---

## Classification (every in-scope site, with evidence)

`[VERIFIED via Read of each file's loop scaffold + body this session]`

**Classification rule.** (a) MECHANICAL = the loop body reads only the slice variable, never the
counter `i`. (b) INDEX-USING = the body reads `i` (for a batch number, a stored `startIndex`, or a
"not the last chunk" guard). (c) EXEMPT/LEAVE = a justified skip.

### (a) MECHANICAL → swap scaffold, body byte-preserved (17 sites / 12 files)

Recipe at every site: replace the `for (let i = 0; i < COLL.length; i += SIZE) { const VAR = COLL.slice(i, i + SIZE);`
scaffold with `for (const VAR of chunked(COLL, SIZE)) {`, preserving the existing per-iteration
variable name `VAR` (see Architecture Decision 3 for the `chunked` import alias). Everything after
that opening line is untouched.

| # | Site | Size | Slice var (`VAR`) | Body quirk preserved verbatim | Module |
|---|---|---|---|---|---|
| 1 | `lib/dataverse/adapters/review-answer.js:79-80` | `CHUNK=20` | `chunk` | 5000-row-cap `throw` at `:89` (reads `chunk.length`, NOT `i`) — confirmed **inside the body**, not the scaffold | ESM |
| 2 | `lib/dataverse/adapters/reviewer-suggestion.js:350-351` (`aggregateReviewHistory`) | `CHUNK=25` | `chunk` | none | ESM |
| 3 | `lib/dataverse/adapters/reviewer-suggestion.js:999-1000` (`findByPD`) | `CHUNK=25` | `chunk` | none | ESM |
| 4 | `lib/dataverse/adapters/reviewer-suggestion.js:1070-1071` (`findAcceptedByPD`) | `CHUNK=25` | `chunk` | none | ESM |
| 5 | `lib/services/reviewer-rollup.js:34-35` | `CHUNK=25` | `chunk` | none | ESM |
| 6 | `lib/services/reviewer-suggestion-sweep.js:60-61` | `CHUNK=25` | `chunk` | `top: chunk.length` at `:66` (reads `chunk.length`, NOT `i`). The separate `eligible.slice(0, maxBatch)` at `:79` is **NOT a chunk loop** — do not touch it | ESM |
| 7 | `lib/services/review-manager/synthesize-reviews-service.js:72-73` | `CHUNK=20` | `chunk` | 5000-row-cap `throw` at `:80` (reads `chunk.length`) | ESM |
| 8 | `lib/services/review-manager/synthesize-reviews-service.js:142-143` | `CHUNK=25` | `chunk` | none | ESM |
| 9 | `lib/services/review-manager/reviewers-service.js:385-386` | `CHUNK=25` | `chunk` | none | ESM |
| 10 | `lib/services/review-manager/reviewers-service.js:430-431` | `CHUNK=25` | `chunk` | none | ESM |
| 11 | `lib/services/discovery-service.js:449-451` | `concurrency` (config) | `batch` | `if (signal?.aborted) return;` at `:450` (BEFORE the slice, reads `signal`, NOT `i`); `Promise.all(batch.map(…))` at `:452` | **CJS** |
| 12 | `lib/services/reviewer-finder/contact-history-service.js:135-136` | `CHUNK_SIZE=50` | `chunk` | `top: CHUNK_SIZE` at `:141` (constant, NOT `i`) | ESM |
| 13 | `lib/services/reviewer-finder/my-candidates-service.js:348-349` | `CHUNK=25` | `chunk` | none | ESM |
| 14 | `lib/services/reviewer-finder/my-candidates-service.js:365-366` | `CHUNK=25` | `chunk` | none | ESM |
| 15 | `lib/services/reviewer-finder/my-candidates-service.js:387-388` | `CHUNK=25` | `chunk` | none | ESM |
| 16 | `lib/services/reviewer-finder/my-proposals-service.js:211-212` | `CHUNK=25` | `chunk` | none | ESM |
| 17 | `pages/api/evaluate-multi-perspective.js:232-233` (`processWithConcurrency`) | `limit` (arg) | `chunk` | `Promise.all(chunk.map(processorFn))` at `:234` | ESM |

> Site 11 (`discovery-service.js`) is the **only CJS mechanical site** — it uses `const { chunk: chunked } = require('../utils/chunk.js')`. Interop is proven (Baseline row: `orcid-normalize`/`name-normalization` ESM helpers are already `require`d from CJS services and run green under jest/babel). All other mechanical sites are ESM and use `import { chunk as chunked } from '…/utils/chunk.js'`.

### (b) INDEX-USING → leave the scaffold, add a one-line comment citing this plan (4 sites / 4 files)

**Ruling (pre-made, do not relitigate):** these sites read the counter `i` in the loop body. The
canonical `chunk(array, size)` intentionally does NOT expose an index — adding an index-bearing
variant would expand the helper's surface past the simplest thing that works (CLAUDE.md rule 8).
Therefore these sites are **left exactly as-is**, with a single added comment:
`// Index-bearing batch loop; not consolidated onto lib/utils/chunk.js (needs i). See docs/CHUNK_CONSOLIDATION_PLAN.md.`

| # | Site | Why it needs `i` | Evidence |
|---|---|---|---|
| B1 | `lib/services/pubmed-service.js:166-167` (`fetchArticles`) | rate-limit "not the last chunk" guard `if (i + chunkSize < pmids.length)` at `:172` before a `setTimeout` delay | `[VERIFIED via Read :166-176]` — **census correction vs the input list, which flagged the delays but not that `i` is load-bearing** |
| B2 | `lib/services/claude-reviewer-service.js:425-432` (`scoreCandidates` batch loop) | `const batchNum = Math.floor(i / BATCH_SIZE) + 1;` at `:433` for the progress message | `[VERIFIED via Read :425-434]` — **census correction: the input list described this only as an "abort check between batches"; the abort check at `:429` is body-preserved, but `batchNum` reads `i`, making the site INDEX-USING, not a mechanical swap** |
| B3 | `pages/api/dynamics-explorer/chat.js:2150-2151` (export batch build) | `batches.push({ records: records.slice(i, i + BATCH_SIZE), startIndex: i })` — `startIndex` is stored and later read at `:2205` `records[batch.startIndex + j]` to merge AI results back | `[VERIFIED via Read :2150-2151, :2202-2207]` |
| B4 | `lib/services/discovery-service.js:2269-2305` (`checkCoauthorshipsForCandidates` COI batch loop; counter named `batchStart`, not `i`) | `batchEnd = Math.min(batchStart + BATCH_SIZE, candidates.length)` at `:2270` feeds the progress message `Checking COI for candidates ${batchStart + 1}-${batchEnd} of ${candidates.length}` at `:2276` and the not-last-batch rate-limit guard `if (batchEnd < candidates.length)` at `:2301` | `[VERIFIED via Read :2265-2305 this session]` — found by review round 1; missed by the `i`-only census grep |

### (c) EXEMPT/LEAVE (1 site / 1 file)

| # | Site | Ruling |
|---|---|---|
| C1 | `pages/api/dynamics-explorer/chat.js:2165-2166` (export concurrency loop) | **LEAVE.** Structurally this loop body reads only `chunk`/`chunkIdx`, not `i` `[VERIFIED via Read :2165-2224]`, so in isolation it is mechanically swappable. But it is the tightly-coupled sibling of the index-using B3 loop in the SAME function: B3 builds the indexed `batches`, this loop consumes them, and `:2205` depends on `startIndex`. Consolidating only this half while B3 stays hand-rolled leaves a half-refactored function for marginal benefit. Leave both chat.js loops together. |

**Does the dynamics-explorer exempt-dir precedent apply here?** **No** — and the executor must not
cite it. `scripts/check-dataverse-access-layer.js:75` lists `dynamics-explorer` in `EXEMPT_DIRS`
`[VERIFIED via check-dataverse-access-layer.js EXEMPT_DIRS, referenced in
docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md:57,200]`, but that exemption is scoped to the **Dataverse
access-layer boundary gate** — it exempts the dir from DAL-enforcement checks, nothing more. Array
chunking is not a Dataverse-boundary concern, so that precedent is irrelevant to this refactor. C1 is
left on the sibling-cohesion ground above, NOT on any exempt-dir basis.

### Decoys — MUST NOT be touched (verified NOT array-chunk loops)

`[VERIFIED via grep + spot Read this session]`

| Decoy | Why it is not in scope |
|---|---|
| The 8+ `decoder.decode(value, { stream: true })` streaming `chunk` variables in `pages/*.js` | These name a **stream/byte chunk from a `ReadableStream` reader**, not an `array.slice(i, i+N)` sub-array. No `for (i += N)` scaffold, nothing to consolidate. |
| `scripts/backfill-reviewer-suggestions-parity.js:232`, `scripts/probe-reviewer-duplicates.js:47`, `scripts/find-orphan-reviewers.mjs:51` (names containing `chunked`/`chunks`) | `scripts/` are one-off probes/backfills, not shipped runtime — **out of scope**, recorded as future work (mirrors how `ODATA_ESCAPE_CONSOLIDATION_PLAN` treated its `scripts/` matches). |
| `lib/dataverse/role-apply.js:76`, `lib/services/discovery-service.js:1015` | `i += 1` plain-iteration loops with no `slice` — not chunking. |

---

## Architecture decisions (pre-made — executors do not relitigate)

1. **Body-byte preservation.** At every MECHANICAL site the emitted downstream calls (same number of
   batches, same batch sizes, same order) must be identical before and after. Characterization pins
   (Stage 0) prove this for an input of `SIZE + 1` elements (→ two batches of `SIZE` then `1`).
2. **Minimal swap shape.** Replace ONLY the three-line scaffold's opening
   (`for (let i = 0; i < COLL.length; i += SIZE) { const VAR = COLL.slice(i, i + SIZE);`) with
   `for (const VAR of chunked(COLL, SIZE)) {`. Do not reflow, rename, or re-indent the body. Do not
   promote the loop to `.map`/`.flatMap` — that would change the body.
3. **Import alias `chunked` (avoids shadowing).** The canonical export is named `chunk`, but nearly
   every site already has a local per-iteration variable named `chunk`. To keep the body
   byte-identical AND avoid shadowing the helper, import it under the alias `chunked` at every call
   site: ESM `import { chunk as chunked } from '<rel>/utils/chunk.js';`; CJS
   `const { chunk: chunked } = require('<rel>/utils/chunk.js');`. Then write
   `for (const chunk of chunked(arr, N))` (or `for (const batch of chunked(arr, N))` where the
   existing var is `batch`). This is a uniform rule — apply it even where the local var is not named
   `chunk`, so every site reads the same way.
4. **Match the file's existing module system; never convert it.** Add the import in the form the file
   already uses (`import` for the ESM sites, `require` for `discovery-service.js`). `chunk.js` is ESM
   with a named export; CJS→ESM `require` interop is proven in-repo (Baseline).
5. **INDEX-USING and EXEMPT sites are never swapped.** B1–B3 get only a comment; C1 is untouched. If
   an executor reaches one of these in Stage 1, STOP.
6. **Decoys are off-limits.** Stream `chunk` variables and `scripts/` are never touched.
7. **One commit per cluster, gates between.** Cluster by directory/domain; each cluster leaves the
   build green.

## Non-goals

Changing batch sizes or query semantics; adding an index-bearing helper variant; consolidating the
INDEX-USING or EXEMPT loops; rewriting `scripts/` probes/backfills; touching stream-decode `chunk`
variables; converting any file's module system; introducing a `lodash`-style dependency (the helper
is a local single-purpose module, matching `guid.js`/`date-ymd.js`).

---

## Self-checking method (the interval rule)

**Pre-stage re-probe.** Before each stage, re-run the disconfirming census grep (Stage Log) and diff
the site list against this plan's Classification. Drift (a site added/removed/moved since drafting) →
update the stage's list BEFORE starting and log the delta. Never execute against a stale list.

**Post-execution fresh-context review.** After the mechanical swaps land, a FRESH-context agent
(Codex preferred; else a new-session agent that has read only this plan + the diff) verifies:
identical batching at every swapped site (same batch count/sizes/order), no decoy touched, no
INDEX-USING or EXEMPT site swapped, and the helper's edge-case semantics match Stage 0's unit test.
High findings block.

**Green gates between stages.** Targeted `jest`, then `npm run check:dataverse-access-layer`
(+ `:self-test`), `npm run check:route-service-boundary` (+ `:self-test`), and `npm test` at close.
A gate and its self-test run **sequentially, never in parallel**. A red gate is a P0 stop.

---

## Stages

### Stage 0 — Helper + edge-case unit test + characterization pins (no production behavior change)

1. Re-run BOTH disconfirming census greps — the `i`-counter form AND the any-identifier form
   (Baseline rows 2 and 4); confirm the 22-site / 14-file list still matches (log any drift).
2. Create `lib/utils/chunk.js` exactly as in "The canonical semantics" (ESM `export function chunk`).
3. Add `tests/unit/utils/chunk.test.js` covering EVERY edge case:
   - `chunk([1,2,3,4,5], 2)` → `[[1,2],[3,4],[5]]` (partial tail).
   - `chunk([], 5)` → `[]`.
   - `chunk([1,2], 5)` → `[[1,2]]` (size larger than array).
   - `chunk([1,2,3,4], 2)` → two full batches, order preserved, input not mutated.
   - non-array (`null`, `undefined`, `{}`, `'str'`) → `TypeError`.
   - `size` = `0`, `-1`, `2.5`, `NaN`, `'2'` → `RangeError`.
   - **Interop pin:** a CJS test that does `const { chunk } = require('../../../lib/utils/chunk.js')`
     AND an ESM import both resolve and run green under jest/babel — mirrors the exercise-1 Stage Log
     step that recorded `require('…/core/odata.js')` (CJS) and `import * as odata` (ESM) both green.
     (The `require`-from-CJS path is the one that matters for site 11; prove it here before Stage 1.)
   - **Raw-node interop probe (review round 1 finding 5):** jest/babel green is NOT sufficient for
     `discovery-service.js` — raw Node scripts load it outside any transpiler
     (`scripts/test-all-candidates.js:2`, `scripts/probe-scoring-delta.mjs:216`,
     `scripts/smoke-discover-dispositions.mjs:106` `[VERIFIED via sed of those three lines this
     session — CJS require + two dynamic imports]`). Run `node -e "require('./lib/services/discovery-service.js')"` (and a
     `node --input-type=module` import of `lib/utils/chunk.js`) after the Stage 1 Cluster B swap; both
     must load clean, mirroring the direct-load checks the exercise-1 closing review ran.
4. For each **GAP / PARTIAL / VERIFY** row in the coverage table, add or extend a focused unit test
   that mocks the downstream client/query, feeds an input of `SIZE + 1` elements, and asserts —
   **for every mechanical site, not just call count (review round 1 finding 4)** — (i) the downstream
   is called exactly twice, (ii) the FIRST call received exactly elements `0..SIZE-1` in order, and
   (iii) the SECOND call received exactly element `SIZE` (assert the actual ids/contents passed, e.g.
   via `mock.calls[0]` argument inspection, the model of `review-answer-adapter.test.js:115`). A
   call-count-only pin cannot distinguish reordered or misassigned batches. For `VERIFY` rows
   (`reviewer-suggestion-review-history.test.js`, `contact-history-service.test.js`) first read the
   test; if it already feeds `> SIZE` and asserts the split, record "already pinned"; else extend it.
   - `evaluate-multi-perspective.js` `processWithConcurrency`: call it directly with 3 items and
     `limit = 2`, a processor that records call order; assert two batches `[2, 1]`.
   - `discovery-service.js:451`: feed `concurrency + 1` trusted candidates; assert two `Promise.all`
     rounds (mock `OpenAlexService.getWorksByAuthor` call count/args).
5. **Done means:** helper + full edge-case unit test green; every MECHANICAL site has a chunk-boundary
   pin (new or confirmed); full suite green at the prior count or better; commit.

**Verification:** `npm run test:utils` + the targeted new/changed suites; `npm test`.

### Stage 1 — Mechanical swaps (the 17 MECHANICAL sites)

**Tests that must exist first:** the Stage 0 pin for every site in the cluster.

Cluster by directory, gates between:

- **Cluster A — `lib/dataverse/adapters/`** (sites 1–4): `review-answer.js` (1), `reviewer-suggestion.js` (3). ESM.
- **Cluster B — `lib/services/` top-level + review-manager** (sites 5–11): `reviewer-rollup.js`,
  `reviewer-suggestion-sweep.js`, `synthesize-reviews-service.js` (2), `reviewers-service.js` (2),
  `discovery-service.js` (**CJS** — `require` form). ESM except `discovery-service.js`.
- **Cluster C — `lib/services/reviewer-finder/`** (sites 12–16): `contact-history-service.js`,
  `my-candidates-service.js` (3), `my-proposals-service.js`. ESM.
- **Cluster D — `pages/api/`** (site 17): `evaluate-multi-perspective.js`. ESM. This route touches the
  route/service boundary gate — run `check:route-service-boundary` for this cluster.

Per-cluster loop: add the `chunked` import (Decision 3, matching the file's module system) → swap
each scaffold (body untouched) → run the Stage 0 pins for the cluster (must stay green, proving
identical batching) → `check:dataverse-access-layer` (+ self-test) and, for Cluster D,
`check:route-service-boundary` (+ self-test) → commit.

**Done means:** all 17 MECHANICAL sites iterate `chunked(…)`; no hand-rolled `for (i += SIZE) { slice }`
chunk scaffold remains in those 12 files; Stage 0 pins unchanged-green; full suite green.

**STOP-AND-ASK markers:** if any swap changes a Stage 0 pin's batching, STOP — the site was
misclassified. If CJS↔ESM interop for `chunk.js` is uncertain in `discovery-service.js`, re-run the
Stage 0 interop pin before guessing.

### Stage 2 — INDEX-USING comments (B1–B4) + EXEMPT comment (C1)

- Add the one-line "index-bearing; not consolidated" comment (Classification (b) wording)
  at B1 (`pubmed-service.js:166`), B2 (`claude-reviewer-service.js:425`), B3 (`chat.js:2150`), and
  B4 (`discovery-service.js:2269`). No code behavior change; no test change (existing tests must
  stay green).
- C1 (`chat.js:2165`) — **add an in-code comment too** (review round 1 finding 6):
  `// Mechanically swappable, but left hand-rolled for cohesion with the index-bearing sibling loop above (startIndex merge). See docs/CHUNK_CONSOLIDATION_PLAN.md C1.`
  An uncommented exception invites a future "cleanup" that half-refactors the function; if Stage 3 is
  built, C1 joins the allowlist.

**Done means:** B1–B4 and C1 carry their citing comments; gates green; full suite green.

### Stage 3 — Chunk-loop lint/gate law (OPTIONAL — OWNER DECISION)

Prevent NEW hand-rolled `for (let i = 0; i < X.length; i += N) { … slice(i, i + N) … }` chunk loops
from reappearing. **Owner decides whether to build this.**

Proposed shape (pick one):
- **Grep gate** `scripts/check-array-chunk.js`: fail if the chunk scaffold appears under
  `lib/`/`pages/`/`shared/`/`modules/` — matching ANY counter identifier, not just `i`
  (review round 1 finding 1: `batchStart += BATCH_SIZE` at `discovery-service.js:2269` evaded the
  `i`-only pattern) — EXCEPT `lib/utils/chunk.js` itself and the recorded INDEX-USING allowlist
  (B1–B4) + EXEMPT (C1). Must NOT flag `+= 1` plain loops or the stream-decode decoys. Register in `package.json`, `docs/CI_GATES_REFERENCE.md`, the `/start` gate
  list, and `.github/workflows/test.yml`; ship a self-test proving it catches a new hand-rolled site
  and passes on `chunked(…)` usage, on the allowlisted index loops, and on the decoys.
- **ESLint `no-restricted-syntax`** targeting the `slice(i, i + N)`-inside-`for`-with-`i += N` shape.

Recommend the grep gate (mirrors the DAL/route gates' ratchet-then-law playbook, independent of the
lint config). **STOP-AND-ASK** on whether to build it and which shape. The INDEX-USING sites make a
naive `i += N` gate noisy, so any gate MUST allowlist B1–B3/C1 — a point in favor of a targeted grep
over a blunt lint rule.

**Done means:** if built — gate + self-test green, decoys + `i += 1` loops + allowlist provably not
flagged, registered everywhere the other gates are; if declined — record the decision here and skip.

---

## Stage Log

*(append-only; every entry records: date/session, commits, sites touched, test totals, review verdict)*

- 2026-07-05: Plan drafted (`status: draft`). **Not executed, not reviewed.** Census probed this
  session via disconfirming grep
  `grep -rnE "for \(let i = 0; i < [A-Za-z_.]+\.length; i \+= " lib/ pages/ shared/ modules/ --include=*.js`
  → **23 scaffolds**: 2 are `i += 1` plain loops (`role-apply.js:76`, `discovery-service.js:1015` —
  NOT chunk sites), leaving **21 in-scope chunk sites / 14 files**. Classified from a Read of each
  scaffold + body: **17 MECHANICAL** (body never reads `i`), **3 INDEX-USING** (leave-with-comment),
  **1 EXEMPT/LEAVE** (`chat.js:2166`, sibling of an index-using loop). `[all VERIFIED via grep/Read
  this session]`.
  - **Census corrections vs the drafting input list:**
    (1) `claude-reviewer-service.js:432` — input framed it as an abort-check-between-batches
    (mechanical-adjacent); re-Read shows `batchNum = Math.floor(i / BATCH_SIZE) + 1` at `:433`, so it
    is INDEX-USING → leave-with-comment, not a swap.
    (2) `pubmed-service.js:167` — input flagged the rate-limit delays; the load-bearing detail is that
    `i + chunkSize < pmids.length` at `:172` reads `i`, making it INDEX-USING.
    (3) `chat.js` — the dynamics-explorer DAL exempt-dir precedent does NOT apply to an array-chunk
    refactor (it scopes only the Dataverse-boundary gate); `:2151` is INDEX-USING on its own merits
    (`startIndex: i`, consumed at `:2205`), `:2166` is left for sibling cohesion, not exemption.
    (4) `reviewer-suggestion-sweep.js:61` confirmed MECHANICAL; its `eligible.slice(0, maxBatch)` at
    `:79` is correctly NOT a chunk site (confirmed, not touched).
  - **Helper semantics chosen:** `chunk(array, size)` → array of in-order slices; empty array → `[]`;
    non-array → `TypeError`; `size` not a positive integer → `RangeError` (fail-closed, matching the
    exercise-1 guarded-swap precedent; a strictly safer superset of the hand-rolled loops).
  - **Module format chosen:** ESM `export function chunk` (matches `guid.js`/`date-ymd.js`/
    `orcid-normalize.js`/`name-normalization.js`). Interop for the one CJS mechanical site
    (`discovery-service.js`) is proven by existing CJS `require` of ESM `lib/utils` helpers
    (`openalex-service.js:9` → `orcid-normalize`; `deduplication-service.js:12` → `name-normalization`)
    `[VERIFIED via grep this session]`; a Stage 0 interop pin re-confirms it before Stage 1.
  - No behavioral STOP-AND-ASK sites. Deferred: Stage 3 gate (OWNER DECISION); two coverage rows
    (`reviewer-suggestion-review-history.test.js`, `contact-history-service.test.js`) to VERIFY in
    Stage 0 before claiming existing chunk-boundary coverage.
- 2026-07-05: **Adversarial plan review round 1 (Codex, fresh-context): NOT SATISFIED — 6 findings,
  all verified against source this session and folded in.** Verbatim severities/titles:
  (1) *P0 — Census is incomplete* — `checkCoauthorshipsForCandidates` chunk loop at
  `discovery-service.js:2269` uses counter `batchStart`, evading the `i`-only census grep; added as
  **B4 INDEX-USING** (reads `batchStart`/`batchEnd`/`candidates.length` in the progress message and
  the not-last-batch delay guard). Census corrected **21→22 sites / 14 files; index-using 3→4**; the
  any-identifier census grep added to Baseline and Stage 0 (disconfirming re-run this session found
  exactly this one non-`i` scaffold repo-wide).
  (2) *HIGH — coverage table overclaims `reviewer-rollup`* — `reviewer-rollup.test.js:52` pins call
  count only; row downgraded YES→PARTIAL, strengthen in Stage 0.
  (3) *HIGH — false GAP for `my-proposals-service`* — `my-proposals-service.test.js:136` already pins
  the 25+5 split (call count); row corrected GAP→PARTIAL.
  (4) *MEDIUM — Stage 0 pins under-specified* — pins now must assert exact batch CONTENTS and ORDER
  via `mock.calls` inspection at every mechanical site, not call counts.
  (5) *MEDIUM — raw-Node interop matters for `discovery-service`* — it is loaded by raw node scripts
  (`test-all-candidates.js:2` require; `probe-scoring-delta.mjs:216` and
  `smoke-discover-dispositions.mjs:106` dynamic import `[VERIFIED via sed this session]`); Stage 0/1
  gain a `node -e` direct-load probe.
  (6) *LOW — C1 uncommented exception* — Stage 2 now adds an in-code sibling-cohesion comment at C1
  and puts it on the Stage 3 allowlist.
  Reviewer also independently confirmed: no `while`+`splice` / `Array.from(Math.ceil())` / reduce /
  `i = i + N` / generator chunkers in scope; the 2 excluded `+= 1` loops are not chunk sites; the 17
  MECHANICAL bodies are clean of indirect counter reads and source mutation; all live size inputs are
  positive constants (discovery `4`, evaluate route `2`, COI loop `5` or `2`); the dynamics-explorer
  exempt-dir rejection is correct (DAL-gate scoped). Amendments committed; execution may start.

<!-- end of plan -->
