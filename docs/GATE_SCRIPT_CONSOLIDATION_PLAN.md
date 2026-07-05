---
title: Gate-Script Scaffold Consolidation Plan
domain: architecture
kind: plan
status: draft
summary: "Consolidate CI-gate scaffolds onto selftest-fixture.js (19 self-tests) and walk-files.js (6 markdown gates); byte-identical census bar. Draft."
canonical: true
cataloged: 2026-07-05
owner: product-engineering
related:
  - docs/CHUNK_CONSOLIDATION_PLAN.md
  - docs/CI_GATES_REFERENCE.md
  - docs/CLAUDE_REMEDIATION_PLAN.md
  - docs/SERVICE_AND_UTILITY_CATALOG.md
---

# Gate-Script Scaffold Consolidation Plan

**Execution status: DRAFT — not yet executed, not yet reviewed.** The docs-catalog frontmatter
`status` enum has no "completed" value; this stays `draft` until execution, then follows the
`CHUNK_CONSOLIDATION_PLAN` / `ODATA_ESCAPE_CONSOLIDATION_PLAN` precedent (a body line records
completion, frontmatter moves to a live enum value). See the Stage Log for probes/counts.

**Objective.** The CI gate scripts under `scripts/` (`check-*.js` and their `*-self-test.js`) duplicate
two mechanical scaffolds:

- **Class 1 — self-test fixture setup/teardown.** Self-tests scaffold a fixture directory (either in
  `os.tmpdir()` or *in-repo*), point the real gate at it, assert red-then-green, and tear it down.
  The same `cleanup()` (`fs.rmSync(dir, { recursive: true, force: true })`) + `try/finally` + mkdir
  pattern is copy-pasted across 19 self-tests. Consolidate the **lifecycle** (create + guaranteed
  cleanup + crash safety) onto `scripts/lib/selftest-fixture.js`.
- **Class 2 — hand-rolled recursive directory walks.** Gates each hand-roll a `readdirSync` walk to
  build their scanned-file census. One cohort of 6 markdown-doc gates shares a *byte-identical* walk
  skeleton differing only in already-externalized constants/callbacks. Consolidate that skeleton onto
  `scripts/lib/walk-files.js`.

**This is SAFETY INFRASTRUCTURE. The paramount invariant: no gate's scanned-file census or verdict may
change.** Characterization (Stage 0) captures, for every touched gate, its full content-census AND its
pass/fail verdict output BEFORE, and re-captures AFTER; **byte-identical is the acceptance bar**. Any
change that would alter a census or verdict means the site was misclassified — STOP.

**Executor profile.** Written to be executed by a cheaper model (Sonnet-class) with no prior context,
following this document plus each stage's checklist. Every judgment is pre-made here; anything not
pre-made is marked **STOP-AND-ASK**. The only deferred items are the Stage 3 OWNER-DECISION walk cohort
and two per-gate verifications flagged in Stage 0.

`scripts/lib/` is the established home for gate helpers (`ast-scan-core.js`, `canonical-facts.js`,
`docs-catalog.js`, `point-in-time-files.js`) `[VERIFIED via ls scripts/lib/ this session]`. **Neither
`scripts/lib/selftest-fixture.js` nor `scripts/lib/walk-files.js` exists today**
`[VERIFIED via ls scripts/lib/ → 8 files, neither present, this session]`. This is a motion refactor,
not a redesign: same fixtures, same env vars, same red/green assertions, same scanned census, same
verdicts.

---

## Baseline (probed, not assumed)

All counts below were derived independently from disconfirming greps (see Stage Log for the exact
commands and denominators). **They correct the drafting-input census in three material ways** (Class 1a
undercounted `harness-framing`; Class 1b undercounted 2→15; Class 2 "near-identical" is a different
cohort than the input assumed).

| Fact | Value | Evidence |
|---|---|---|
| `scripts/lib/selftest-fixture.js` exists? | **NO — created in Stage 1** | `[VERIFIED via ls scripts/lib/, this session]` |
| `scripts/lib/walk-files.js` exists? | **NO — created in Stage 2** | `[VERIFIED via ls scripts/lib/, this session]` |
| Any existing file-tree walk helper in `scripts/lib/`? | **NO** — `ast-scan-core.js:52` is an AST node visitor; `docs-catalog.js:108` is a *flat* readdir; `canonical-facts.js:66,164` are two *private* in-file `walkDir` copies (not exported as a reusable helper) | `[VERIFIED via Read + grep this session]` |
| Total `mkdtempSync` sites under `scripts/` | **10** (across 6 files) | `[VERIFIED via grep -rnE "mkdtempSync" scripts/ --include=*.js = 10 hits]` |
| Total in-repo `*_selftest_tmp` fixture dirs referenced | **15 self-test files** (16 dir tokens; `fact-consistency` uses 2) | `[VERIFIED via grep -rnE "selftest_tmp" scripts/ this session]` |
| Total files under `scripts/` doing `readdirSync` | **28 files** | `[VERIFIED via grep -rlE "readdirSync" scripts/ --include=*.js \| wc -l = 28]` |
| `.gitignore` entries for any `*_selftest_tmp` fixture dir | **NONE** | `[VERIFIED via grep -nE "selftest\|_tmp" .gitignore → no matches, this session]` — so an in-repo orphan is an **untracked working-tree file** a filesystem-walking gate can pick up (this is the danger class) |
| Gate npm scripts (`check:*` + `check:*:self-test`) | present per surface | `[VERIFIED via package.json scripts, this session]` |
| Full suite | `npm test` (`jest`) | `[VERIFIED via package.json test script]` |

### Class 1a — OS-tmp `mkdtempSync` fixtures with NO cleanup (cosmetic orphans in `os.tmpdir()`)

`[VERIFIED via grep + Read this session]`

| # | Self-test | mkdtemp roots | Has any cleanup / exit handler? |
|---|---|---|---|
| 1a-1 | `check-agent-wiki-self-test.js` | 1 (`:34`) | **NO** (`grep -cE "rmSync\|cleanup\|process.on" = 0`) |
| 1a-2 | `check-harness-framing-self-test.js` | **5** (`:33`, `:53`, `:62`, `:70`, `:79`) | **NO** (0) — **CENSUS CORRECTION vs input, which named only `:33`; this file has 5 independent mkdtemp roots** |
| 1a-3 | `check-memory-router-self-test.js` | **2** (`:23`, `:99`) | **NO** (0) — input suspected the 2nd; confirmed |
| 1a-4 | `check-model-registry-self-test.js` | 1 (`:19`) | **NO** (0) |

Totals: **4 self-test files / 9 mkdtemp roots**. All orphan into `os.tmpdir()`; the OS reclaims them, so
this is cosmetic — but drift-prone, and consolidation adds guaranteed cleanup at no census risk (no gate
ever scans `os.tmpdir()`).

**Adjacent, NOT in Class 1 scope:** `check-instruction-architecture.js:31` is a **gate** (not a
self-test) that `mkdtempSync`es into `os.tmpdir()` — but it already has `finally { fs.rmSync(tmp, …) }`
at `:49-50` `[VERIFIED via Read this session]`. It is a well-behaved optional `withTmpFixture` adopter,
recorded as future work, not part of the required slice.

### Class 1b — In-repo scaffold self-tests (the DANGEROUS class)

`[VERIFIED via grep -rnE "selftest_tmp|function cleanup|rmSync|process.on|mkdirSync|INCLUDE_|finally" over each file this session]`

Every one already has `cleanup()` = `if (fs.existsSync(x)) fs.rmSync(x, { recursive: true, force: true })`,
called **both** on entry (before mkdir) **and** in `try/finally`. **None registers a process-level exit
or signal handler** — see the SIGKILL note below.

| # | Self-test | In-repo fixture path(s) | Gate-side include/exclude coupling |
|---|---|---|---|
| 1b-1 | `check-secret-scan-self-test.js` (`:49-63`) | `docs/agent-wiki/_secret_scan_selftest_tmp` | env `SECRET_SCAN_INCLUDE_SELFTEST_TMP` (gate is git-ls-files census; opt-in scans the dir) |
| 1b-2 | `check-scaffolding-tokens-self-test.js` (`:45-59`) | `docs/agent-wiki/_scaffold_tokens_selftest_tmp` | env `SCAFFOLD_TOKENS_INCLUDE_SELFTEST_TMP` |
| 1b-3 | `check-doc-symbol-refs-self-test.js` (`:20`) | `docs/agent-wiki/_doc_symbol_refs_selftest_tmp` (+ gitignored subdir) | env `DOC_SYMBOL_REFS_INCLUDE_SELFTEST_TMP=1`; gate excludes the dir via `EXCLUDE_DIR` (`check-doc-symbol-refs.js:58`) |
| 1b-4 | `check-build-claim-freshness-self-test.js` (`:21`) | `docs/agent-wiki/_build_claim_freshness_selftest_tmp` (+ gitignored subdir `:88`) | env `BUILD_CLAIM_FRESHNESS_INCLUDE_SELFTEST_TMP=1`; gate excludes via `EXCLUDE_DIR` (`check-build-claim-freshness.js:56`) |
| 1b-5 | `check-canonical-pointers-self-test.js` (`:19`) | `docs/canonical_pointers_selftest_tmp` | gate scans `docs/` root; fixture lives under it (no env gate) |
| 1b-6 | `check-drain-table-mentions-self-test.js` (`:16`) | `docs/drain_table_selftest_tmp` (2× mkdir, same dir) | gate scans `docs/` |
| 1b-7 | `check-prompt-storage-mentions-self-test.js` (`:17`) | `docs/prompt_storage_selftest_tmp` (2× mkdir) | gate scans `docs/` |
| 1b-8 | `check-doc-currency-self-test.js` (`:30`) | `docs/doc_currency_selftest_tmp` | gate scans `docs/` |
| 1b-9 | `check-fact-consistency-self-test.js` (`:17-18`) | **TWO**: `docs/fact_consistency_selftest_tmp` + `scripts/fact_consistency_selftest_tmp`; `cleanup()` loops both | gate scans `docs/` + `.claude-memory` |
| 1b-10 | `check-route-service-boundary-self-test.js` (`:71`) | `.route_service_boundary_selftest_tmp` | **This is the dir tonight's SIGKILLed self-test orphaned** |
| 1b-11 | `check-dataverse-access-layer-self-test.js` (`:29`) | `.dataverse_access_layer_selftest_tmp` | gate root override |
| 1b-12 | `check-model-override-warming-self-test.js` (`:19`) | `.model_warm_selftest_tmp` | gate root override |
| 1b-13 | `check-trust-boundary-guid-self-test.js` (`:18`) | `.tbg_selftest_tmp` | gate root override |
| 1b-14 | `check-api-route-security-matrix-self-test.js` (`:26`) | `pages/_route_gate_selftest_tmp` **+ a fixture matrix FILE** (`cleanup()` rmSyncs both, `:30-32`) | route prefix `/_route_gate_selftest_tmp` |
| 1b-15 | `check-coverage-self-test.js` (`:39`) | `lib/services/atlas_selftest_tmp` | **DIVERGENT** — its own header (`:27-29`) documents a **race** with the `check-application-state-atlas` gate, which scans `lib/services` and can see this dir mid-run |

Totals: **15 in-repo-scaffold self-tests** — a **CENSUS CORRECTION vs the input's claim of 2**
(the input named only 1b-1 and 1b-2). The `.route_service_boundary_selftest_tmp` incident tonight is
1b-10, confirming these in-repo dirs are the dangerous class. Combined Class 1 = **19 self-tests**
(4 OS-tmp + 15 in-repo).

**SIGKILL note (load-bearing, do not skip).** A `process.on('exit'|'SIGINT'|'SIGTERM'|'uncaughtException')`
handler is catchable-crash insurance only; **`SIGKILL` (kill -9) is uncatchable by any Node handler**, so
a process-exit handler would NOT have prevented tonight's `.route_service_boundary_selftest_tmp` orphan.
The genuine mitigations are (a) **cleanup-on-entry** (every 1b self-test already `cleanup()`s before
`mkdir`, so the next run self-heals) and (b) **gate-side exclusion/scope** so a stray fixture never
changes a census. This plan's helper preserves (a) and adds best-effort catchable-crash handlers; it does
**not** claim SIGKILL-proofing, and it does **not** change any gate's exclude/scope logic (b) — that is a
Non-goal. Whether each 1b fixture dir is actually invisible to *every* gate's census when orphaned is a
per-gate **Stage 0 verification** (see Stage 0 step 4), not an assumption.

### Class 2 — recursive directory walks in gates

`[VERIFIED via Read of every walk region this session + a fresh-context classification pass this session]`

The disconfirming denominator: **28 files under `scripts/` call `readdirSync`**. Filtering to *recursive
repo-census walks inside `check-*.js` gates* (excluding flat readdirs, migration/build utilities, `lib/`
helpers, and self-tests) yields the classification below. **The input's "~17 near-identical walks" list
does not survive: most are either flat readdirs, git-ls-files gates, generators, no-skip walks, or the
highest-stakes security gates whose skip semantics diverge.** The provably census-neutral slice is a
different, tighter cohort (Family B below).

#### NEAR-IDENTICAL cohort selected for Stage 2 — Family B (6 markdown-doc gates)

These six share a **byte-identical** walk skeleton — the only per-gate differences (`ROOTS`,
`SINGLE_FILES`, the `EXCLUDE_DIR` regex / `shouldExcludeRelPath` predicate, and the `addIfLive*` file
handler) are **already externalized to constants and callbacks in each gate**. The skeleton is:

```js
(function walkDir(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(repoRoot, full);
    if (ent.isDirectory()) { if (!EXCLUDE(rel)) walkDir(full); }
    else addIfLive(full);
  }
})(root);
```

| # | Gate | Walk site | Dir-exclude | File handler (keeps ext + frontmatter/allowlist logic) |
|---|---|---|---|---|
| B1 | `check-canonical-pointers.js` | `:60-75` | `EXCLUDE_DIR` regex `:30` + lstat symlink skip in `addIfLive` `:43` | `addIfLive` (`.md`, `CANONICAL_COUNTS_REL` exclusion) |
| B2 | `check-doc-symbol-refs.js` | `:122-138` | `shouldExcludeRelPath` `:155` (regex `:58` + env-hatch) | `addIfLive` (`.md` `:104`) |
| B3 | `check-drain-table-mentions.js` | `:229-244` | `EXCLUDE_DIR` regex `:75` | `addIfLive` (`.md` + point-in-time filter) |
| B4 | `check-prompt-storage-mentions.js` | `:168-182` | `EXCLUDE_DIR` regex `:61` | `addIfLive` (`.md` + marker allowlist) |
| B5 | `check-fact-consistency.js` | `:82-96` | `EXCLUDE_DIR` regex `:42` | `addIfLiveMarkdown` (`.md`, `CANONICAL_COUNTS.md` special-case) |
| B6 | `check-build-claim-freshness.js` | `:167-182` | `shouldExcludeRelPath` `:140` (regex `:56` + env-hatch) | `addIfLive` (`.md`, lstat symlink skip `:151`) |

**Why this cohort is provably census-neutral:** a helper `walkTree(root, { repoRoot, shouldExcludeRel, onFile })`
runs the *exact* readdir/recurse/exclude sequence above and delegates every gate-specific decision back
to the gate's own predicate and handler. Nothing that determines the census (the `EXCLUDE_DIR` regex,
the `.md`/frontmatter filtering, the symlink lstat, the special-cased files) moves or changes — it stays
in the gate, passed by reference. Per-gate before/after census diff (Stage 0 mechanism) proves it.

#### DIVERGENT / LEAVE — recorded, NOT touched in Stages 1–2

`[VERIFIED via Read this session]`

| Gate:site | Why LEAVE |
|---|---|
| `check-dataverse-access-layer.js:192`, `check-route-service-boundary.js:125` | Identical *pair* to each other (symlink skip, `node_modules`+`.next` skip, `JS_EXT_RE`, **sorted** result), but dataverse adds an `isExemptRel` post-filter inside the walk. **Crown-jewel security gates** (DAL enforcement + route/service boundary, both named in CLAUDE.md invariants). Highest blast radius → **Stage 3 OWNER DECISION** |
| `check-model-override-warming.js:102`, `check-trust-boundary-guid.js:110` | Identical *pair* to each other (symlink skip, `node_modules`-only skip, `.js`-only ext), but this pair differs from the DAL pair in **both** `.next` skip and ext set. Security-adjacent AST gates → **Stage 3 OWNER DECISION**. A single helper covering all four requires *value*-parameterization across two divergent pairs; the input's own rule ("any walk whose skip list would change is DIVERGENT") disqualifies a naive merge |
| `check-doc-currency.js:158` | **Generator** (`function*`/`yield*`) + absolute-prefix `SKIP_DIRS` match (`['docs/archive','docs/security-audit']`), no `node_modules`/`.git` skip. Different protocol → LEAVE |
| `check-secret-scan.js:134`, `check-scaffolding-tokens.js:73` | Census is **`git ls-files`**, not a tree walk; the `readdirSync` is only the env-gated self-test fixture-inclusion path → LEAVE |
| `check-application-state-atlas.js:79` (+ flat `:105`, `:177`) | Walk has **no ext filter** (returns all files) + dotfile-dir skip (`name.startsWith('.')`); `:105`/`:177` are flat readdirs → LEAVE |
| `check-api-route-security-matrix.js:34` | **Zero skip list**, post-hoc `.js` filter; security route gate → LEAVE |
| `check-route-lifecycle-auth.js:165` | **NOT** a repo census and **NOT** an AST walk (input suspected AST) — it is a per-route handler-file *resolver* over one resolved dir, no skip list → LEAVE (decoy confirmed) |
| `check-harness-framing.js:70` | Fallback-only (primary census is `git ls-files`); name-based `.git`/`node_modules` skip, no ext filter → LEAVE |
| `check-agent-wiki.js:72` | No skip list at all; accumulator-arg shape; single `.md` filter → LEAVE (marginal value, differs from Family B externalization) |
| `check-prompt-injection-tagging.js:581`, `check-memory-router.js:109`/`:151` | **Flat** single-dir readdirs, not recursive walks → LEAVE (decoys) |
| `check-fact-consistency-self-test.js:150` (`walkJs`) | A **self-test** internal helper (endpoint counting), not a gate census → LEAVE |
| `scripts/lib/canonical-facts.js:66`,`:164` | Private in-file `walkDir` copies feeding canonical counts; not `check-*.js` gates → LEAVE, record as future work |

**Class 2 tally:** near-identical adopted slice = **6 gates (Family B)**; divergent/leave = the 4 code-tree
security-gate walks (Stage 3 OWNER DECISION) + ~12 other divergent/flat/decoy sites (permanent leave).

---

## Architecture decisions (pre-made — executors do not relitigate)

### Class 1 — `scripts/lib/selftest-fixture.js` (CJS; every self-test is `require`-based CJS)

Primary API is the **register-and-return** form, because it maps onto the existing code as a minimal,
low-drift diff (replace one `mkdtempSync(...)` call, or one `cleanup()`+`mkdir` pair, in place) rather
than forcing every self-test body to be re-nested inside a callback closure:

```js
// scripts/lib/selftest-fixture.js
const repoRoot = path.resolve(__dirname, '..', '..'); // scripts/lib → repo root

// OS-tmp fixture: mkdtemp under os.tmpdir(), register a catchable-crash + normal-exit cleanup,
// return the absolute dir. Replaces `fs.mkdtempSync(path.join(os.tmpdir(), prefix))`.
function registerTmpFixture(prefix) { /* mkdtempSync + register cleanup on exit/SIGINT/SIGTERM/uncaughtException; return dir */ }

// In-repo fixture: cleanup-on-entry (self-heal a prior orphan), mkdir recursive, register cleanup,
// return absolute path(s). Accepts a string or an array (fact-consistency needs 2; the api-route
// matrix needs a dir + a file — rmSync{recursive,force} handles both).
function registerRepoFixture(relPathOrArray) { /* per path: rmSync if exists; mkdirSync recursive; register cleanup; return abs */ }

// Thin callback sugar for the few self-tests already shaped around a single fixture + try/finally
// (1b-1 secret-scan, 1b-2 scaffolding-tokens). Optional; register form is always acceptable.
function withTmpFixture(prefix, fn) { /* registerTmpFixture + finally cleanup */ }
function withRepoFixture(relPathOrArray, fn) { /* registerRepoFixture + finally cleanup */ }
```

1. **The helper owns lifecycle ONLY.** create + cleanup-on-entry + cleanup-on-exit + best-effort
   catchable-crash handlers. It does **NOT** touch: the `env: { …INCLUDE_SELFTEST_TMP… }` passed to each
   `runGate()`, the fixture file *contents*, the gate invocation, or the red/green assertions. Those stay
   verbatim in each self-test. **The env-var include mechanic is gate-specific and is NEVER moved into
   the helper** — it remains where it is.
2. **Cleanup semantics are byte-identical to today's `cleanup()`:** `fs.rmSync(path, { recursive: true, force: true })`
   guarded by an existence check, applied to each registered path. No new deletion scope.
3. **SIGKILL is out of scope** (uncatchable). The helper does not claim to prevent kill -9 orphans; it
   preserves cleanup-on-entry (self-heal) and adds catchable-crash cleanup. Do not add SIGKILL machinery.
4. **`registerRepoFixture` does not create or modify any `.gitignore` entry, `EXCLUDE_DIR` regex, or gate
   scope.** Fixture visibility to gates is governed exactly as today.
5. **Behavior invariant (the one thing that must never change):** each self-test still writes the same
   fixtures, passes the same env vars to the same gate invocation, and makes the same red-then-green
   assertions, producing the same pass/fail. Adoption changes *only* how the fixture dir is created and
   destroyed.
6. **`check-coverage-self-test.js` (1b-15) adopts last and carefully.** Its documented race with the
   `check-application-state-atlas` gate over the shared `lib/services/atlas_selftest_tmp` dir means it is
   the one 1b site whose cleanup timing is semantically load-bearing. If adoption would change *when*
   cleanup runs relative to that gate, **STOP-AND-ASK**; otherwise adopt with the register form (which
   preserves the existing finally-timed cleanup).

### Class 2 — `scripts/lib/walk-files.js` (CJS)

```js
// scripts/lib/walk-files.js
// Recursion skeleton ONLY. Every census-determining decision stays in the caller's callbacks.
function walkTree(root, { repoRoot, shouldExcludeRel, onFile }) {
  (function walkDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(repoRoot, full);
      if (ent.isDirectory()) { if (!shouldExcludeRel(rel)) walkDir(full); }
      else onFile(full);
    }
  })(root);
}
```

7. **`walkTree` reproduces the Family B skeleton verbatim.** Same `readdirSync(dir, { withFileTypes: true })`,
   same iteration order, same `path.join` / `path.relative(repoRoot, …)`, same `isDirectory` branch, same
   "recurse unless excluded, else handle file". The gate passes its **own** `shouldExcludeRel`
   (wrapping its existing `EXCLUDE_DIR.test` / `shouldExcludeRelPath`) and its **own** `onFile`
   (its existing `addIfLive`/`addIfLiveMarkdown`). No `ROOTS`, `SINGLE_FILES`, `EXCLUDE_DIR`, ext filter,
   symlink lstat, or special-cased-file logic moves or changes.
8. **`SINGLE_FILES` pre-passes stay in the gate**, unchanged — `walkTree` replaces only the `ROOTS` walk
   loop body's inner IIFE, not the surrounding `for (const rootRel of ROOTS)` / `SINGLE_FILES` handling.
   (Gates that `throw` on a missing root — B2, B6 — keep that throw in the surrounding loop.)
9. **Walk consolidation changes NO gate's `ROOTS`/`SCAN_DIRS`/`SINGLE_FILES` and NO skip semantics.**
   Byte-identical census is the acceptance bar. Any walk whose exclude set or ordering would change by
   adoption is DIVERGENT by definition and is not in this slice.
10. **The 4 code-tree security-gate walks are NOT touched in Stages 1–2** (Stage 3 OWNER DECISION only).

## Non-goals

Changing any gate's scanned census or verdict; changing any `EXCLUDE_DIR` regex, `ROOTS`, `SCAN_DIRS`,
`SINGLE_FILES`, or env-var include mechanic; moving the env-include logic into a helper; adding
`.gitignore` entries for fixture dirs; SIGKILL-proofing; touching the 4 code-tree security-gate walks
(DAL / route-service-boundary / trust-boundary-guid / model-override-warming); touching git-ls-files
census gates, generators, flat readdirs, no-skip walks, or the route-lifecycle resolver; converting any
file's module system (all gates + self-tests are CJS; both helpers are CJS); introducing a dependency.

---

## Self-checking method

**Characterization mechanism (chosen): an fs-layer census trace, external to every gate.**
Stage 0 adds `scripts/lib/__gate-census-trace.js` — a **preload shim** (a Stage-0 artifact, NOT part of
any gate's logic; may be removed after the refactor). It monkeypatches `fs.readFileSync` and
`fs.readdirSync` to append each resolved path to the file named by `GATE_CENSUS_OUT`. Each touched gate
is run as:

```bash
GATE_CENSUS_OUT=/tmp/census/<gate>.before node -r ./scripts/lib/__gate-census-trace.js scripts/<gate>.js
node scripts/<gate>.js > /tmp/census/<gate>.verdict.before 2>&1; echo "exit=$?" >> …   # verdict capture
```

- **Why this is verdict-safe:** the shim wraps `fs` at the Node layer; it cannot alter what the gate
  decides. It works identically before and after the refactor and is agnostic to whether the gate uses
  its own walk or `walkTree` — it records the actual files opened.
- **Why the diff is clean:** Node's own module-load `readFileSync` noise is identical before and after,
  so `diff <(sort -u before) <(sort -u after)` cancels it and isolates exactly the census delta. The bar
  is **empty diff** for the file census AND **byte-identical** verdict output + exit code.
- **git-ls-files gates** (`secret-scan`, `scaffolding-tokens`) are NOT touched, so no trace is required
  for them; they appear only in the green-baseline run.
- For the Family B `.md` census specifically, the census-relevant reads are the files opened by
  `addIfLive → readFileSync`; the trace captures exactly those.

**Green baseline of all gate self-tests (Stage 0).** Run every `check:*` gate and every `check:*:self-test`
**sequentially, never in parallel** (self-tests scaffold fixtures into paths gates scan; a parallel gate
would see a half-built fixture and false-fail — this is exactly the 1b-15 race). Record the pass/fail
table; it must be all-green before any change and re-green at each stage close.

**Post-execution fresh-context review.** After each stage, a FRESH-context agent (Codex preferred; else a
new-session agent that has read only this plan + the diff + the before/after census artifacts) verifies:
every touched gate's census diff is empty, every verdict is byte-identical, no divergent/leave site was
touched, and the helper adds no deletion scope. High findings block.

**Gates and self-tests never run in parallel.** A gate and its self-test run sequentially. A red gate is
a P0 stop.

---

## Stages

### Stage 0 — Characterization harness (no behavior change)

1. Re-run the disconfirming census greps (Stage Log commands) for Class 1a, 1b, and Class 2; diff the
   site lists against this plan's Baseline. Any drift → update the affected stage's list BEFORE starting
   and log the delta. Never execute against a stale list.
2. Create `scripts/lib/__gate-census-trace.js` (preload shim above). Do **not** modify any gate.
3. Capture the **BEFORE** census + verdict for **every gate touched in Stages 1–2**: the 6 Family B gates
   (Class 2) and every gate exercised by a Class 1 self-test (i.e. the gate behind each 1a/1b self-test).
   Store under a scratch dir. These are the parity baselines.
4. **Per-gate orphan-visibility verification (the SIGKILL-mitigation-(b) check).** For each 1b fixture
   dir, confirm whether a stray (orphaned) copy would change any gate's census — i.e. is it excluded
   (`EXCLUDE_DIR`) or out of every gate's scan scope? Record the answer per dir. Where a fixture is
   **not** excluded and **is** under a gate's scan root (e.g. the `docs/…_selftest_tmp` family under
   `docs/`), note it: those rely on cleanup-on-entry alone. This is documentation of the existing risk,
   **not** a change — do not add exclusions here (Non-goal). If any dir is found to already false-fail a
   gate when orphaned, **STOP-AND-ASK** (it is a latent bug beyond this refactor's scope).
5. Run the full green baseline: every `check:*` + `check:*:self-test`, sequentially; record the table;
   confirm all-green. Run `npm test`.
6. **Done means:** trace shim exists; BEFORE census+verdict captured for every touched gate; orphan-
   visibility table recorded; green baseline all-green; `npm test` green; commit.

### Stage 1 — Class 1 fixture helper + adoption

**Tests that must exist first:** Stage 0 BEFORE artifacts for every gate behind an adopted self-test.

1. Create `scripts/lib/selftest-fixture.js` (Architecture, Class 1). Add a focused unit test
   `tests/unit/selftest-fixture.test.js`: `registerTmpFixture` creates + cleans; `registerRepoFixture`
   self-heals a pre-existing dir, creates, and cleans; array form handles multiple paths and a file;
   cleanup is `rmSync{recursive,force}`; a thrown error inside `withRepoFixture` still cleans.
2. Adopt in clusters, gates between; **each cluster: run the adopted self-tests, then re-capture the
   gate census+verdict and diff against Stage 0 BEFORE (must be empty/byte-identical), then commit.**
   - **Cluster 1A — OS-tmp (safest, zero census interaction):** 1a-1…1a-4. Note `harness-framing` has
     **5** roots and `memory-router` has **2** — adopt every root. No gate scans `os.tmpdir()`, so the
     census diff is trivially empty; the change is purely orphan cleanup.
   - **Cluster 1B-env — env-gated in-repo:** 1b-1, 1b-2, 1b-3, 1b-4. Keep each `env: {…INCLUDE_…}` and
     each gate-side `EXCLUDE_DIR` verbatim.
   - **Cluster 1B-docs — `docs/`-scanned in-repo:** 1b-5…1b-9 (fact-consistency has 2 dirs).
   - **Cluster 1B-root — dotdir/root-override in-repo:** 1b-10…1b-14 (api-route matrix: dir + file).
   - **Cluster 1B-race — LAST:** 1b-15 `check-coverage-self-test.js`. Adopt only if cleanup timing is
     preserved; else STOP-AND-ASK (Architecture decision 6).
3. **Done means:** helper + unit test green; all adopted self-tests green; **every touched gate's
   census+verdict byte-identical to Stage 0 BEFORE**; full suite green.

**STOP-AND-ASK markers:** any gate census/verdict diff is non-empty (site misclassified); the coverage
self-test race would change cleanup timing.

### Stage 2 — Class 2 walk helper + Family B adoption (6 gates)

**Tests that must exist first:** Stage 0 BEFORE census for B1–B6.

1. Create `scripts/lib/walk-files.js` (`walkTree`, Architecture decision 7). Add
   `tests/unit/walk-files.test.js`: a synthetic tree proves `walkTree` yields the same files in the same
   order as a hand-rolled `readdirSync` recurse, honors `shouldExcludeRel`, and calls `onFile` on every
   non-dir entry.
2. Adopt one gate at a time (B1→B6). For each: replace only the inner `ROOTS`-loop IIFE with a
   `walkTree(root, { repoRoot, shouldExcludeRel: <existing predicate>, onFile: <existing addIfLive> })`
   call, leaving `SINGLE_FILES`, `ROOTS`, `EXCLUDE_DIR`, the file handler, and any missing-root `throw`
   untouched. **Re-capture census+verdict and diff against Stage 0 BEFORE — must be empty/byte-identical.**
   Run the gate's self-test. Commit per gate (or per small batch) with the census diff recorded.
3. **Done means:** `walkTree` + unit test green; B1–B6 iterate `walkTree`; **all six census diffs empty,
   all six verdicts byte-identical**; every B self-test green; full suite green.

**STOP-AND-ASK markers:** any B gate's census diff is non-empty; a gate's `shouldExcludeRel` cannot be
expressed without changing the exclude set (then it is DIVERGENT — do not adopt it).

### Stage 3 — Code-tree security-gate walks (OPTIONAL — OWNER DECISION)

The 4 code-tree walks — `check-dataverse-access-layer.js:192`, `check-route-service-boundary.js:125`
(identical pair), `check-model-override-warming.js:102`, `check-trust-boundary-guid.js:110` (identical
pair) — are the highest-blast-radius security gates and diverge across the two pairs (`.next` skip, sort,
ext set, `isExemptRel` post-filter). **Owner decides whether to consolidate them**, and if so whether to
merge only the identical pairs (2 helpers) or one value-parameterized helper
(`walkFiles(root, { skipDirNames, extRe, skipSymlinks, sort })`). Same acceptance bar: per-gate
byte-identical census + verdict via the Stage 0 trace, fresh-context review, gates green.

**STOP-AND-ASK** on whether to build this and which shape. Recommendation: the two identical pairs are the
only defensible merge; a single four-way helper risks census drift on the crown-jewel DAL/route gates for
marginal benefit — likely not worth it. **Done means:** if built — census/verdict byte-identical for all
touched gates, self-tests green, no new npm scripts needed; if declined — record the decision here and skip.

---

## Stage Log

*(append-only; every entry records: date/session, commits, sites touched, test totals, review verdict)*

- 2026-07-05: Plan drafted (`status: draft`). **Not executed, not reviewed.** Censuses probed this
  session via disconfirming greps with independent denominators:
  - Class 1a: `grep -rnE "mkdtempSync" scripts/ --include=*.js` → **10 hits / 6 files**; of the
    self-tests: `check-agent-wiki-self-test` (1), `check-harness-framing-self-test` (**5**:
    `:33,:53,:62,:70,:79`), `check-memory-router-self-test` (**2**: `:23,:99`),
    `check-model-registry-self-test` (1). `grep -cE "rmSync|cleanup|process.on"` = **0** in all four →
    confirmed NO cleanup. `check-instruction-architecture.js:31` is a *gate* (not a self-test) with
    `finally` cleanup at `:49-50` → adjacent, out of Class 1 scope.
  - Class 1b: `grep -rnE "selftest_tmp" scripts/` → **15 self-test files** with in-repo fixture dirs
    (16 dir tokens; `check-fact-consistency-self-test` uses 2: `docs/` + `scripts/`). All have
    `cleanup()` = `rmSync{recursive,force}` on entry + in `finally`; none registers an exit/signal
    handler. Combined Class 1 = 19 self-tests.
  - Class 2: `grep -rlE "readdirSync" scripts/ --include=*.js | wc -l` = **28 files**. Read of every
    recursive gate walk → **Family B = 6 gates** share a byte-identical skeleton (differences already in
    constants/callbacks) = the census-neutral slice; the 4 code-tree walks + ~12 flat/generator/
    git-census/no-skip/decoy sites are DIVERGENT/LEAVE.
  - `.gitignore` has **no** `*_selftest_tmp` entry (`grep -nE "selftest|_tmp" .gitignore` → none), so
    in-repo orphans are untracked working-tree files a filesystem-walking gate can pick up — the danger
    class, confirmed by tonight's `.route_service_boundary_selftest_tmp` (1b-10) incident.
  - **Census corrections vs the drafting input:**
    (1) **Class 1a `harness-framing`**: input named 1 mkdtemp root (`:33`); the file has **5**
    (`:33,:53,:62,:70,:79`). All 5 must be adopted.
    (2) **Class 1b count**: input claimed **2** in-repo scaffolds (secret-scan, scaffolding-tokens);
    the corrected census is **15** (see 1b-1…1b-15). +13.
    (3) **Class 2 near-identical cohort**: input's mental model (nested `readdirSync` + `node_modules/.git`
    skip + ext filter) actually describes the 4 code-tree walks — which internally DIVERGE (two pairs;
    `.next` skip; sort; `isExemptRel`) and are the crown-jewel security gates. The provably
    census-neutral slice is instead **Family B** (6 markdown-doc gates, predicate-parameterized
    skeleton). The code-tree walks move to **Stage 3 OWNER DECISION**.
    (4) **`check-route-lifecycle-auth.js:165`** is NOT an AST walk (input's guess) and NOT a repo census
    — it is a per-route handler-file resolver. LEAVE (decoy confirmed).
  - **Helper APIs chosen:** `scripts/lib/selftest-fixture.js` (CJS) exposing
    `registerTmpFixture(prefix)` + `registerRepoFixture(relPathOrArray)` (primary, minimal-diff) plus
    `withTmpFixture`/`withRepoFixture` callback sugar; `scripts/lib/walk-files.js` (CJS) exposing
    `walkTree(root, { repoRoot, shouldExcludeRel, onFile })`. Register form preferred over the input's
    callback-only proposal because it is a smaller, lower-drift diff against self-tests whose fixtures
    are used at module top level (`harness-framing`'s 5 roots) or across a long try/finally body
    (`route-service-boundary`).
  - **Characterization mechanism chosen:** an fs-layer census-trace preload shim
    (`scripts/lib/__gate-census-trace.js`, `-r` at run time) capturing per-gate file census + verdict
    BEFORE/AFTER; empty census diff + byte-identical verdict is the acceptance bar. It never modifies
    gate verdict logic.
  - **SIGKILL honesty:** a process-exit handler does NOT prevent kill -9 orphans (uncatchable); the real
    mitigations are cleanup-on-entry (preserved) + gate-side exclusion (unchanged; a Non-goal to alter).
  - Deferred / STOP-AND-ASK: Stage 3 code-tree walk cohort (OWNER DECISION); `check-coverage-self-test`
    (1b-15) adoption vs its documented atlas-gate race; per-gate orphan-visibility outcomes (Stage 0
    step 4). No other open behavioral STOP-AND-ASK sites.

<!-- end of plan -->
