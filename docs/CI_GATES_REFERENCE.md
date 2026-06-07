# CI Gates Reference

Mechanics, exemption rules, and operating contracts for the project's CI gates. CLAUDE.md keeps the rule ("red gates are P0") and the gate-name list; this doc holds the per-gate detail.

## P0 gates

A red gate in this set on `main` blocks new commits to the affected surface. Established 2026-05-08 after a two-session gap where a `wmkf_apprequestpersons` Atlas miss from S139 sat unfixed because each subsequent session classified it as out-of-scope.

| Gate | What it scans | What it blocks |
|---|---|---|
| `check:atlas` | Postgres tables + Dataverse entity sets referenced in source must appear in some Atlas page (`docs/atlas/*.md`, `docs/APPLICATION_STATE_ATLAS.md`). | New commits to data-layer surfaces (`pages/api/**`, `lib/dataverse/**`, `lib/db/**`, `lib/services/{dynamics,database,execute-prompt}*`, `scripts/audit-*`, `docs/atlas/**`, `docs/APPLICATION_STATE_ATLAS.md`) until green. |
| `check:atlas:self-test` | Every Atlas detection pattern from `docs/CLAUDE_COVERAGE_LESSONS.md` exercised against synthetic fixtures. | Same scope as `:atlas` — silent detector regressions would be invisible without it. |
| `check:api-routes` | API route files under `pages/api/**` must appear in `docs/API_ROUTE_SECURITY_MATRIX.md`. | PRs touching `pages/api/**` without a matrix update. |

The fix is always to make the gate green. Adding to `ALLOWED_UNDOCUMENTED_*` requires a written justification and is a last resort, not a default. The rule applies regardless of which session caused the red state: "not my regression" is not a valid reason to proceed past it.

## Drift gates (also fail-loud, not in the P0 set above)

### `check:fact-consistency` — registered scalar drift

The mandatory fan-in for code-derived scalars that get denormalized across docs (the recurring "fix in one place, stale restatement rots elsewhere" failure mode; S166 produced it ≥3× in one session).

- Registry: `scripts/lib/canonical-facts.js`. Each entry derives a scalar from the live repo (e.g., `app-definition-count`, `requireappaccess-endpoint-count`, `api-route-file-count`).
- Generated doc: `docs/CANONICAL_COUNTS.md` is the single source of truth for the live values; `npm run check:fact-consistency -- --write` regenerates it.
- Live doc/memory scan: registered stale-restatement patterns trigger fail-loud. Point-in-time audit docs are excluded by design.
- Exemption: same-line, fact-bound structured marker only. Example: `<!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-19 -->`. Session tags or loose words like "prior" are NOT exemptions. Multiple markers may appear on one line (one per fact id).
- **Operating rule:** run before claiming any fact-level doc/memory fix "done." Do not emit "DONE"/"✅" markers for such work until green.
- Bounded slice by design — only crisply derivable, drift-prone scalars. Not a complete semantic-drift solution.

### `check:prompt-storage-mentions` — stale `wmkf_prompt_template` claims (S167) <!-- prompt-storage:ignore reason=self-referential-gate-description -->

The live Dataverse prompt-storage entity is `wmkf_ai_prompt` (entity set `wmkf_ai_prompts`); `wmkf_prompt_template` was a 2025-era proposal that never shipped. The Executor (`lib/services/execute-prompt.js`) reads from `wmkf_ai_prompts` and writes audit rows to `wmkf_ai_runs`.

- Same 7-shape detection + tightened-keyword exemption + constrained file-purpose marker as the drain-table gate (see below).
- New `wmkf_prompt_template` references without a historical/renamed/superseded annotation signal a ground-truth claim change — confirm with code before adding an exemption.

### `check:drain-table-mentions` — stale "data lives in PG" claims (S167)

Reviewer-domain Postgres tables (`researchers`, `publications`, `researcher_keywords`, `reviewer_suggestions`, `grant_cycles`, `proposal_searches`) are drain-only post-W3-W6 cutover (2026-05-12); live source of truth is Dataverse (`wmkf_potentialreviewer` — which since the S213 collapse carries the bibliometric fields directly; the `wmkf_appresearcher` sidecar was dropped — `wmkf_appreviewersuggestion`, `wmkf_appgrantcycle`).

**Detection (7-shape, per Codex review):**
1. Backticked identifier (` `X` `)
2. Single-quoted (`'X'`)
3. Double-quoted (`"X"`)
4. `Postgres X` prefix
5. Dotted column ref (`X.email`)
6. Bare identifier + db-noun (`X schema` / `X row` / `X table` / etc.)
7. SQL shape (`reads from X` / `writes to X` / `from X` / `into X` / etc.)

**Exemption — any ONE of:**
- Same-line directional/historical keyword: `drain` / `drained` / `drain-only` / `historical` / `RETIRED` / `formerly` / `legacy` / `superseded` / `post-W[3-6]` / `pre-cutover` / "cutover complete|shipped|done" / `migrated` / `Migrates` / `Replaced` / `deleted` / `dropped` / `removed` / `reaped` / `backfilled` / `snapshot` / strikethrough `~~`.
- Same-line structured marker: `<!-- drain-table:ignore reason=<short> -->`.
- File path in `ALLOWLIST_FILES` (script-side, for migration plans + lessons-learned + migration-memory).
- Visible top-of-file marker `<!-- drain-table:file-purpose=<tag> -->` where the tag is in `FILE_MARKER_TAG_PATHS` AND the file path matches one of that tag's allowed patterns (currently only `atlas-state-page` scoped to atlas pages).

**Intentionally NOT exempted** (broad signals that can co-occur with stale current-state claims):
- `Dataverse` alone, `planned`, `future-work`, "from Postgres", bare `W[3-6]`, `wmkf_app*` prefix, `spec'd`.

New PG-table references without an annotation signal the ground-truth claim has changed — confirm with code-level evidence before adding an exemption.

### `check:canonical-pointers` — anchor rot (S167)

Normalization pattern: live docs reference canonical scalars as markdown pointers of the form `[N](docs/CANONICAL_COUNTS.md#<fact-id>)`. The literal `N` is gated by `check:fact-consistency`; the anchor is gated here.

Fails on:
1. Link to a fact id not in the `CANONICAL_FACTS` registry (typo / renamed / retired).
2. Link whose anchor isn't present in `docs/CANONICAL_COUNTS.md` (drift between registry and generated doc).

Together with `:fact-consistency`, scalar values + the generated doc + cross-document pointers are now machine-verified end-to-end.

### `check:memory-drift` (advisory) — memory↔code drift

Added S154. Runs `scripts/reconcile-memory-claims.js`. Fails on `spec_without_entity`, large `stale_row_count`, `doc_label_collision`, or any `probe_errors`.

- Historical hazard: the Set D label collision that previously kept this gate red was resolved 2026-05-26 (Connor walkthrough — fit-assessment fields relabeled to Set E). Current state is whatever `npm run check:memory-drift` shows — verify before assuming.
- The Codex-flagged `incompatible_shape` drift bucket is a planned addition (not yet built).
- Promotion to the P0 set above is reasonable once the bucket lands AND the gate has been green continuously for a stretch of sessions.
- For routine memory audits that must not dirty the tracked report, use `npm run check:memory-drift:no-write` (read-only; never regenerates `docs/RECONCILIATION_REPORT.json`).

### `check:model-override-warming` — LLM 404-on-tier-alias prevention (S230)

AST gate (`@babel/parser`). Every `pages/api/**` route that reaches a `getModelForApp` / `getFallbackModelForApp` call — directly or transitively through an imported module — must call an **awaited** `loadModelOverrides()` first (and within a single function, the warm must lexically precede a direct resolver call). Without warming, the synchronous resolver returns the raw tier alias (e.g. `sonnet`) and Anthropic 404s in prod; unit tests never catch it (they mock the LLM). This class recurred 3× (web-suggestions S229; applicant-reviewers + integrity-screener/screen S230) before the gate.

- Comment/string-proof (AST CallExpression detection, not text); resolves import-binding aliases (`import { getModelForApp as g }`); treats `await Promise.all([loadModelOverrides()])` as warmed.
- `shared/config/baseConfig.js` (the definition site) is excluded from the resolver set.
- Exemption marker for a route that imports a MIXED module but never reaches its model path: `// model-override-warming:ignore reason=<id>` — exempts TRANSITIVE reachability only; a direct resolver call in the route still requires warming.
- Self-test: `scripts/check-model-override-warming-self-test.js` (17 cases over isolated fixture trees). Codex-reviewed twice (S230).

## Coverage tool self-tests (binding contract)

When modifying any `scripts/check-*.js` gate (or building a new one), the matching self-test must pass:

| Gate | Self-test |
|---|---|
| `check:atlas` | `check:atlas:self-test` — exercises every Atlas pattern from `docs/CLAUDE_COVERAGE_LESSONS.md`. |
| `check:doc-currency` | `check:doc-currency:self-test` — exercises every `DRIFT_PATTERNS` entry (positive + negation-guard fixtures). |
| `check:fact-consistency` | `check:fact-consistency:self-test` — exercises every `CANONICAL_FACTS` entry (known-miss positives + negation + structured-exemption fixtures + independent derive cross-check). |
| `check:drain-table-mentions` | `check:drain-table-mentions-self-test` |
| `check:prompt-storage-mentions` | `check:prompt-storage-mentions-self-test` |
| `check:canonical-pointers` | `check:canonical-pointers-self-test` |

**When external review catches a structural pattern an existing gate missed, the order is mandatory:**

1. Update `docs/CLAUDE_COVERAGE_LESSONS.md` (or the matching pattern catalog) with the new pattern + parallels.
2. Add a fixture to the relevant self-test that exercises it.
3. Patch the gate.
4. Commit all four changes (lesson, fixture, fix, atlas page if needed) together.

Skip step 1 and you'll forget the lesson; skip step 2 and the gate can regress silently.

## Fixture-path race hazard

Several self-tests write synthetic fixtures into paths that the main gate also scans (e.g., `check:atlas:self-test` writes into `lib/services/atlas_selftest_tmp/`, which `check:atlas` scans). Running the pair concurrently causes the main gate to false-fail on the synthetic fixtures and race the self-test's cleanup.

**Always run a gate and its self-test sequentially:**
- `check:atlas` then `check:atlas:self-test` (never in parallel)
- `check:fact-consistency` then `check:fact-consistency:self-test` (same hazard)
- `check:canonical-pointers` then `check:canonical-pointers:self-test` (same hazard)
- `check:drain-table-mentions` then `check:drain-table-mentions-self-test` (same hazard)
- `check:prompt-storage-mentions` then `check:prompt-storage-mentions-self-test` (same hazard)
