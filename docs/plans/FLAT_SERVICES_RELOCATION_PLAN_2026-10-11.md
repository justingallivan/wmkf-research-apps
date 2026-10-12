---
title: Flat lib/services relocation — staged plan
domain: architecture
kind: plan
status: draft
summary: "Move the 176 flat lib/services/*.js files into domain directories (12 existing, 9 new) in four waves ordered by blast radius, driven by one tested codemod that rewrites every literal path (imports, jest.mock strings, gate recorded sets, tsconfig include, memory/wiki refs) and a census that proves zero stale references after each wave; no runtime behavior change; written for a cheaper model to execute."
canonical: false
owner: product-engineering
related:
  - docs/plans/LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md
  - docs/plans/data/FLAT_SERVICES_MOVE_LEDGER_2026-10-11.tsv
  - docs/plans/data/FLAT_SERVICES_MOVE_NOTES_2026-10-11.md
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/CI_GATES_REFERENCE.md
---

# Flat `lib/services` relocation — staged plan

Candidate **B** from `LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md`. Source baseline `origin/main`
`b3135037c`. Status: **tabled by the owner 2026-10-12 (§7) — not authorized.** Tier 0 (no runtime behavior change) but every wave
touches hundreds of files, so each wave is its own branch + PR with a deliberate merge window (§2 D4).

The move table is `docs/plans/data/FLAT_SERVICES_MOVE_LEDGER_2026-10-11.tsv` (176 rows; columns
`file, lines, purpose, importer_files_total, importer_dirs, test_file_refs, script_refs, doc_memory_refs,
proposed_target, confidence, hazard`) with its method and the exact gate-literal hit list in
`docs/plans/data/FLAT_SERVICES_MOVE_NOTES_2026-10-11.md`. Both were produced by a fresh-context agent
at `b3135037c` with reproducible stdlib scripts (method recorded in the notes §"Counting method").

## 0. Executor instructions (read first)

- You move files and rewrite path strings. You never change code semantics. If a move needs a code
  change to compile or to pass a test, **STOP-AND-ASK**.
- Never move a file by hand. Every move goes through `scripts/relocate-service.js` (Stage 0) so the
  rewrite is total and the census is run.
- Before each wave: §4 pre-stage re-probe, including the **concurrency check** — a flat file that an
  unmerged remote branch has touched is deferred to the next wave, never moved under someone.
- One commit per target directory inside a wave; one PR per wave; the next wave starts only after
  the previous PR is merged and its fresh-context review (§6) is clean.
- `npm ci` in your worktree first; never regenerate the lock.

## 1. Baseline (probed, not assumed) `[VERIFIED at b3135037c unless labeled]`

- `lib/services/`: **176 flat `.js` files** next to **34 subdirectories** (`find -maxdepth 1`;
  `ls -d lib/services/*/`). Flat files import one another through **265** resolved `./x` edges (full
  import-resolver pass; the TSV's top-3 `lib/services(flat)` tokens alone sum to 244).
- Literal path references that must follow a move (a reference is any text match, so comments
  count). Per-file ledger sums (a file importing three flat services counts three times): **1,565**
  test-file refs, **1,609** source/script importer refs, **1,266** docs/memory refs. Distinct files:
  **652** under `tests/`, **795** under `lib/ pages/ shared/ scripts/`, **434** under `docs/` +
  `.claude-memory/` (the last includes this plan's own documents).
- Heaviest files by test references: `dynamics-service` 207, `dynamics-context` 113,
  `service-http-error` 75, `graph-service` 62, `notification-service` 38, `settings-service` 37,
  `model-override-loader` 35, `llm-client` 30.
- **Gate and config literals** (exact file:line in the notes §"Gate-literal hits"): 23 flat files are
  named (20 in functional literals; `grantee-abstract-service`, `grantee-title-service` and
  `settings-service` appear only in comments and need a comment edit, nothing more) in `scripts/check-*.js`, their self-tests, `tests/unit/*recorded-set*.test.js`,
  `tsconfig.check.json` (`:42` `dynamics-service.js`, `:47` `reviewer-rollup.js`), or `jest.setup.js:53`
  (global `jest.mock('./lib/services/app-access-service')`). Notable: `check-dataverse-access-layer.js:69,73`
  `EXEMPT_FILES` names `dynamics-service.js` and `dynamics-explorer-taxonomy.js` by path;
  `check-reviewer-engagement-boundary.js:172` and `tests/unit/reviewer-engagement-boundary-recorded-set.test.js:27`
  record `lib/services/review-upload.js`; `check-request-document-writers.js:40,57,160` record two
  paths; `check-status-enum-parity.js:108,124,143` read `reviewer-rollup.js` by path;
  `check-model-registry.js:242-243` read `model-resolver.js`/`model-capabilities.js` by path;
  `check-dynamics-context-boundary.js:78` names `dynamics-context.js` as the definition file;
  `check-prompt-injection-tagging.js` lists `execute-prompt.js` as `callSiteFiles` 13 times and
  `claude-reviewer-service.js`, `integrity-service.js` once each; `check-cycle-dossier-rollout.js:16,19,196,231,232`
  imports five flat files by relative path (`model-review-validation`, `cycle-dossier-rollout`,
  `dynamics-context`, `cycle-dossier-generation`, `cycle-dossier-sharepoint`); this script has **no**
  `package.json` entry (nor do `check-mtd-spend.js`, `check-secret-scan-allowlist.js`,
  `check-transcription-preview-storage.js`), so `npm run check:*` never exercises it.
  `check-route-service-boundary.js:66` matches `dynamics-service` by **basename** regex, so that gate is
  path-independent.
- Config path mappings: `jest.config.js:43-47` `moduleNameMapper` has only `@/`, `@shared/`, `@pages/`
  aliases — no `lib/services` literal; `next.config.js:95,111,129` trace a subdir file (unaffected);
  no `jsconfig.json`; no `package.json` `imports`; zero `lib/services` literals in `.github/workflows`.
- Dynamic import with a path **string**: `lib/services/prompt-resolver.js:50,126` builds
  `../../shared/config/prompts/phase-i-dynamics.js` and `await import(fallbackModule)` — the string
  changes meaning when the file moves one level deeper.
- Doc gates: `check:doc-symbol-refs` and `check:build-claim-freshness` scan **only**
  `.claude-memory/**` and `docs/agent-wiki/**` (`ROOTS` at `check-doc-symbol-refs.js:57`,
  `check-build-claim-freshness.js:56`); other `docs/` path mentions are not gated.
- Filename collisions: one — flat `integrity-service.js` vs `lib/services/workbench/integrity-service.js`;
  the ledger therefore targets `NEW:integrity-screener`. No flat basename equals an existing dir name;
  no proposed NEW name equals a flat basename; no collision inside any proposed target (asserted by
  the generator).
- Prior decisions: Route→Service plan Decision 2 and Non-goals fenced this work off as out of scope,
  not as undesirable `[docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:76-78,113]`. No memory entry forbids it
  (`rg -i 'flat services|relocat' .claude-memory` → none relevant `[ASSUMED — re-run at Stage 0]`).
- Concurrency: 22 non-main worktrees existed on the owner's machine on 2026-10-11 (21 excluding the
  one this plan was written in), most dormant; a move under an active branch forces a rebase across
  renames.

## 2. Decisions required (proposals; owner answers recorded in §7)

| # | Decision | Proposed default |
|---|---|---|
| D1 | **Target map.** Accept the ledger's `proposed_target` for the 99 `high`-confidence rows as-is; owner reviews the 76 `med` + 1 `low` rows (mostly `NEW:platform` 23 and `NEW:executor` 13 membership, and the `dynamics`-vs-`platform` choice for `dynamics-service`/`dynamics-context`/`graph-service`). | Accept `high`; review `med/low` in Stage 0 |
| D2 | **New directories** (9): `platform`, `executor`, `reviewer-identity`, `institution-identity`, `review-panel`, `cycle-dossier`, `uploads`, `intake`, `integrity-screener`. | Accept |
| D3 | **End state.** Zero flat files: the one `KEEP-FLAT` row (`irs-bmf-service.js`) goes to `lib/services/irs/`. Stage 0 rewrites that TSV row's `proposed_target` from its free-text `KEEP-FLAT:…` value to `NEW:irs` so the codemod can read the ledger mechanically. | Zero flat files |
| D4 | **Merge windows.** Each wave merges in a window the owner names (no active feature PR touching the wave's files); files touched by an unmerged remote branch are deferred, not moved. | Owner names windows |
| D5 | **No compatibility re-exports.** Moves are clean; nothing is left at the old path. (A shim layer would defeat the goal and need its own removal campaign.) | No shims |
| D6 | **Historical docs.** Path mentions outside memory/wiki (dated plans, audits) are rewritten by the codemod too (mechanical, keeps `rg` useful) — not left as history. | Rewrite everywhere |

## 3. Pre-made design

1. **One codemod:** `scripts/relocate-service.js <from> <to> [--dry-run]` does, atomically per file:
   `git mv`; rewrite every import/require/`import()`/`jest.mock`/`jest.requireActual`/`require.resolve`
   specifier in `lib/ pages/ shared/ scripts/ tests/ jest.setup.js` that resolves to the old path
   (both `lib/services/<name>` forms and the relative `./`, `../` forms, with and without `.js`);
   rewrite the moved file's **own** relative imports for the depth change (`../utils` → `../../utils`,
   `./x` → `../x` or `./x` if `x` moved to the same target); rewrite path **strings** in
   `tsconfig.check.json`, `jest.setup.js`, `scripts/check-*.js`, `tests/unit/*recorded-set*.test.js`
   (the gate-literal ledger) and `lib/services/<name>.js` mentions under `docs/` and `.claude-memory/`;
   then run the census. It refuses to run if the working tree is dirty.
2. **One census:** `scripts/census-flat-services.js` prints: flat-file count; stale-literal count
   (any text match of `lib/services/<moved-name>(\.js)?` not followed by `/` across the repo minus
   `.git`, `node_modules`, `.next`, `DEVELOPMENT_LOG.md`, `SESSION_PROMPT.md`); per-moved-file importer
   count before/after (must be equal). Exit 1 on any stale literal.
3. **Order:** the ledger's waves (notes §(c)): **Wave 1** 95 files (≤5 test refs, no hazard) →
   **Wave 2** 55 (6–29 refs or cross-domain hub) → **Wave 3** 3 (`llm-client`, `graph-service`,
   `service-http-error`) → **Wave 4** 23 (gate-literal / tsconfig-include). Inside a wave, commits are
   grouped by target directory, lowest `importer_files_total` first. New directories are created by
   their first move.
4. **Gate recorded sets are edited by path only.** No entry is added or removed; the self-tests'
   fixture paths move with them. A gate whose matcher is path-independent (`check-route-service-boundary.js:66`)
   needs no edit — verify, don't assume.
5. **`prompt-resolver.js:50`:** the codemod cannot infer this string; Wave 1 (where the ledger places
   `prompt-resolver`: 1 test ref, no hazard) hand-edits it to the new relative depth. **No test covers
   the fallback import today** (`grep -rn fallbackModule tests/` → nothing); Stage 0 adds one that
   forces the Dataverse-unreachable branch and asserts the fallback module loads.
6. **Documentation sweep is part of each wave,** not a trailing stage: memory/wiki rewrites happen in
   the codemod; `check:doc-symbol-refs` is in every wave's gate.

## 4. Verification protocol

**Pre-stage re-probe** (log it):
```bash
find lib/services -maxdepth 1 -name '*.js' | wc -l                 # 176 at baseline
node scripts/census-flat-services.js                               # 0 stale at baseline
git fetch origin && for f in <wave files>; do git log --oneline origin/main..origin/<each unmerged branch> -- "$f"; done   # concurrency check (D4)
git diff --stat origin/main...HEAD | tail -1                       # must be empty before the wave
```

**Per-wave green gate** (all exit 0):
```bash
node scripts/census-flat-services.js
npm run check:types                       # tsconfig.check.json includes moved files (Wave 4)
npm run lint
npx jest --testPathPatterns '<target-dir names|moved basenames>' --silent
npm test                                  # full suite — jest.mock string specifiers only fail at runtime
npm run build
# every gate with a path literal or a recorded set, each followed by its self-test, sequentially:
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
npm run check:reviewer-engagement-boundary && npm run check:reviewer-engagement-boundary:self-test
npm run check:script-suggestion-writers && npm run check:script-suggestion-writers:self-test
npm run check:request-document-writers && npm run check:request-document-writers:self-test
npm run check:route-service-boundary && npm run check:route-service-boundary:self-test
npm run check:dynamics-context-boundary && npm run check:dynamics-context-boundary:self-test
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npm run check:model-registry && npm run check:model-registry:self-test
npm run check:model-override-warming && npm run check:model-override-warming:self-test
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npm run check:prompt-storage-mentions && npm run check:prompt-storage-mentions:self-test
npm run check:agent-wiki && npm run check:agent-wiki:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npm run check:memory-drift:no-write
```
Wave 4 additionally runs **every** `check:*` script in `package.json` (70 entries, 40 without
self-tests) **plus** the four `scripts/check-*.js` files that have no `package.json` entry — in
particular `node scripts/check-cycle-dossier-rollout.js`, which Wave 4 edits — because that wave is the
one that edits gate sources. A red gate is a P0 stop.

**Behavioral proof:** none is needed beyond the full suite and build — the invariant is "no file's
content changed except import lines and path strings", checked by the reviewer with
`git diff -M --stat` (every moved file shows as a rename with a small similarity delta) and
`git diff -M --color-moved=zebra`.

## 5. Stages

### Stage 0 — Tooling, decisions, baseline (no moves)
1. Owner answers D1–D6; the ledger's `med`/`low` rows are confirmed or re-targeted (edit the TSV; it is
   the plan's source of truth from here on).
2. Write `scripts/relocate-service.js` and `scripts/census-flat-services.js` with unit tests under
   `tests/unit/relocate-service.test.js` using a fixture tree that covers: ESM import with/without
   `.js`, CJS `require`, `jest.mock('…')`, `await import('…')`, relative imports inside the moved file at
   depth 1→2, a flat→flat import where both files move, a gate recorded-set string, a `tsconfig.check.json`
   include, a memory `.md` mention, and the dirty-tree refusal.
3. Dry-run the codemod over all 176 rows (`--dry-run`) and attach the rewrite counts per file to the
   Stage Log; compare with the ledger's `importer_files_total` + `test_file_refs` (they should bracket
   the dry-run count).
4. Fresh-context planning review of this document (§6). Commit tooling; no moves.

### Stage 1 — Wave 1 (95 files, ≤5 test refs, no hazards)
Targets present in Wave 1 (from the ledger; derive the exact row list with the §4 census script's
`--wave 1` listing, never from memory), in order of growing fan-in: the `NEW:*` domains with zero
existing-subdir importers first (`cycle-dossier`, `review-panel`, `uploads`, `integrity-screener`,
`institution-identity`, `reviewer-identity`), the low-fan-in `NEW:executor` members (`prompt-resolver`
— see §3.5 — `anthropic-admin`, `multi-llm-service`, `openai-client`, `prompt-seed`) and the four
low-fan-in `NEW:platform` rows, then existing dirs (`review-manager`, `workbench`,
`reviewer-engagement`, `discovery`, `reviewer-finder`, `cron`, `dynamics-explorer`, `meeting-tracker`,
`graph`, `field-primer`), then `irs` (D3). (`intake`, `contact-enrichment` and `review-documents` rows
are all Wave 2 or later.) One commit per target. Expected end:
`find lib/services -maxdepth 1 -name '*.js' | wc -l` = 81. Census 0.

### Stage 2 — Wave 2 (55 files, 6–29 refs or cross-domain hubs)
Same mechanics. Includes `database-service`, `alert-service`, `external-token`, `email-defaults`,
`email-signature`, `scheduled-email-service`, `scheduled-email-store`, `discovery-service`, and the
`NEW:executor` hubs `prompt-store` and `executor-budget-service` (ledger: 6–29 test refs or
cross-domain-hub). Expected end: 26 flat files.

### Stage 3 — Wave 3 (3 files: `llm-client`, `graph-service`, `service-http-error`)
Pure fan-in: 30 / 62 / 75 test files. One commit each; run the **full** suite after each commit, not
only at the end. Expected end: 23 flat files.

### Stage 4 — Wave 4 (23 gate-literal / tsconfig files)
For each file, the codemod rewrites the exact lines in the notes' hit list; the executor then opens
each edited gate script and confirms the string is in a recorded set / fixture / `EXEMPT_FILES`
entry, not in a matcher that must stay path-independent. Special cases:
- `dynamics-service.js` and `dynamics-context.js`: `tsconfig.check.json:42`, `check-dataverse-access-layer.js:69`,
  `check-dynamics-context-boundary.js:78`, ~40 self-test fixture lines (notes list). Run both gates + self-tests
  immediately after each move.
- `reviewer-rollup.js`: `tsconfig.check.json:47` + `check-status-enum-parity.js:108,124,143`.
- `review-upload.js`: recorded set in `check-reviewer-engagement-boundary.js:172` **and** the pin test
  `tests/unit/reviewer-engagement-boundary-recorded-set.test.js:27` (both must change in the same commit — the
  pin test exists precisely to make growth deliberate; a path rename is not growth, say so in the commit).
- `app-access-service.js`: `jest.setup.js:53` global mock path.
- `execute-prompt.js`: 13 `callSiteFiles` entries in `check-prompt-injection-tagging.js` + two self-test fixtures.
- `cycle-dossier-*`, `model-review-validation.js`: `scripts/check-cycle-dossier-rollout.js` relative imports.
Expected end: **0 flat files**; all 68 `scripts/check-*.js` green (64 via `npm run`, 4 run directly); `DEVELOPMENT_LOG.md` entry; the Route→Service
plan's Decision 2 gets a one-line "superseded by FLAT_SERVICES_RELOCATION_PLAN" note; `docs/SERVICE_AND_UTILITY_CATALOG.md`
and `CLAUDE.md` Source-Of-Truth pointers re-checked (`rg 'lib/services/[a-z-]+\.js' CLAUDE.md docs/SERVICE_AND_UTILITY_CATALOG.md`).

### Stage 5 — Close-out
Delete `scripts/relocate-service.js`? **No** — keep it and the census; add `census-flat-services`
as `check:flat-services` (law: zero flat files) so the layout rule cannot regress silently. Update
`docs/CI_GATES_REFERENCE.md` and the `/start` gate list.

## 6. Self-checking method (interval rule)

- **Planning checkpoint (Stage 0):** fresh-context agent re-verifies §1 counts and the ledger's
  `proposed_target` for every `med`/`low` row (does the file's importer set really favor that dir?)
  and lists disagreements; owner settles them before Wave 1.
- **Per-wave review:** fresh-context agent, given only this plan, the ledger, and `git diff -M` for the
  wave, checks: (a) every hunk in a moved file is an import line or a path string; (b) census is 0;
  (c) no file outside the wave's rows moved; (d) every gate self-test still exercises the gate (a
  fixture path rewritten to a non-existent dir would silently pass — open each edited self-test and
  confirm the fixture still trips the gate); (e) `git diff -M --stat` similarity ≥ 95 % per moved file.
  Any failure blocks the next wave.
- **Concurrency guard** runs in both the pre-stage probe and the review: list unmerged remote branches
  that touch wave files; if any, the owner either merges/abandons them or the file is deferred.
- **Scope guard:** any temptation to "fix while moving" (a duplicated helper, a dead export) goes in
  the Stage Log, not in the diff (CLAUDE.md rule 9).

## 7. Decision and Stage Log (append-only)

- 2026-10-11: Plan drafted at `b3135037c` from the fresh-context move table (176 rows; targets 12
  existing + 9 new + 1 keep; hazards: 21 gate-literal, 2 tsconfig-include, 3 jest-mock-heavy, 21
  cross-domain-hub, 0 cycle-risk; waves 95/55/3/23). D1–D6 **open**.
- 2026-10-11: **Planning checkpoint — fresh-context verifier (Explore agent, read-only, no history)**:
  33 claims checked; 10 mismatches folded in — reference counts restated as ledger sums + distinct
  files; flat-to-flat edges 97→265; Stage 1 target list and Stage 2 membership corrected from the TSV;
  no test exists for `prompt-resolver`'s fallback import (Stage 0 adds one); 3 of the 23 gate-literal
  files are comment-only; 4 gate scripts are not wired into `package.json`; D3 needs a TSV edit;
  worktree count 22. Ledger integrity (176 rows, targets, hazards, waves, 10 spot-checked rows) and
  all gate-literal line citations confirmed. Verdict after corrections: ready for owner review; not
  authorized.
- 2026-10-12: **Tabled by the owner (Session 598)** after a decision walk-through. Reason: navigation-only
  benefit against ~2,000 path edits and a rebase across renames for every live branch. Carry forward
  if revived:
  - **Gate hazard the ledger missed:** `check:reviewer-engagement-boundary` exempts every file under
    `lib/services/reviewer-engagement/` (`EXEMPT_ENGAGEMENT_DIR`,
    `scripts/check-reviewer-engagement-boundary.js:154`). The 9 `med` rows targeting that directory
    would silently gain permission to bind reviewer-suggestion writers; each needs individual review,
    and non-engagement files belong in `review-manager/`.
  - **Baseline drift:** 179 flat files on 2026-10-12 (Plan A added `tool-prompt-resolver.js`,
    `tool-prompt-composer.js`, `prompt-model-resolution.js` — natural home `executor/`). Re-run the
    ledger generator before any wave.
  - **Recommendations given (not decisions):** accept the high-confidence rows and the 9 new
    directories; keep the four heaviest hubs (`dynamics-service`, `dynamics-context`,
    `service-http-error`, `graph-service`) flat instead of D3's zero-flat end state; no shims (D5);
    rewrite live docs/memory/wiki only, not dated records (D6, per `.claude/rules/durable-docs.md`);
    prune dormant worktrees before naming merge windows (D4); if revived, authorize Wave 1 only and
    reassess.
