# CI Gates Reference

Mechanics, exemption rules, and operating contracts for the project's CI gates. CLAUDE.md keeps the rule ("red gates are P0") and the gate-name list; this doc holds the per-gate detail.

## P0 gates

A red gate in this set on `main` blocks new commits to the affected surface. Established 2026-05-08 after a two-session gap where a `wmkf_apprequestpersons` Atlas miss from S139 sat unfixed because each subsequent session classified it as out-of-scope.

| Gate | What it scans | What it blocks |
|---|---|---|
| `check:atlas` | Postgres tables + Dataverse entity sets referenced in source must appear in some Atlas page (`docs/atlas/*.md`, `docs/APPLICATION_STATE_ATLAS.md`). | New commits to data-layer surfaces (`pages/api/**`, `lib/dataverse/**`, `lib/db/**`, `lib/services/{dynamics,database,execute-prompt}*`, `scripts/audit-*`, `docs/atlas/**`, `docs/APPLICATION_STATE_ATLAS.md`) until green. |
| `check:atlas:self-test` | Every Atlas detection pattern from `docs/CLAUDE_COVERAGE_LESSONS.md` exercised against synthetic fixtures. | Same scope as `:atlas` — silent detector regressions would be invisible without it. |
| `check:api-routes` | API route files under `pages/api/**` must appear in `docs/API_ROUTE_SECURITY_MATRIX.md`. Hard-fails on missing-from-matrix; **warns** (non-fatal) on routes with no recognized guard token. Recognized guards include session guards (`requireAppAccess`, etc.), the cron/suggestion-token helpers, and (2026-06-11) HMAC helpers `verifyInternalCall`/`verifyBillWebhook` — the HMAC exemption applies only when the route's matrix row also documents a shared-secret/HMAC boundary, so an undocumented HMAC-token route still warns. Paths overridable via `API_ROUTE_GATE_API_ROOT`/`API_ROUTE_GATE_MATRIX_PATH` (used by the self-test). | PRs touching `pages/api/**` without a matrix update. |
| `check:api-routes:self-test` | Drives the gate against synthetic fixture routes + matrix: HMAC-documented → no warn; HMAC-undocumented → warn; known guard → no warn; intentional `None` → no warn; no-guard → warn; missing-from-matrix → hard-fail. | Silent regressions in guard recognition or the missing-route hard-fail. |

The fix is always to make the gate green. Adding to `ALLOWED_UNDOCUMENTED_*` requires a written justification and is a last resort, not a default. The rule applies regardless of which session caused the red state: "not my regression" is not a valid reason to proceed past it.

## Local build gate execution in Codex sandbox

When a Codex session is running with filesystem sandboxing, scoped checks such as `npx jest ...` and `npx eslint ...` should run normally in the sandbox first. The full Next.js build is different: `npm run build` uses Next 16/Turbopack and may fail inside the Codex sandbox with a Turbopack panic that includes `Operation not permitted` while creating a process or binding a local worker port. Treat that as an execution-environment failure, not as an app build failure.

If `npm run build` fails with that sandbox/port-binding signature, immediately retry the same command through Codex's escalation/approval mechanism so it runs outside the sandbox. If escalation is unavailable, run `npx next build --webpack` and report it explicitly as a fallback build signal, not as the canonical Turbopack build.

If a retry reports "Another next build process is already running" after an interrupted attempt, check for a live `next build` / `npm run build` process first. Do not delete `.next`, kill broad process patterns, or clean build artifacts unless the live process check proves the warning is stale and the operator approves the cleanup.

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

### `check:doc-symbol-refs` — dangling repo path references in memory/wiki (S281)

Live `.claude-memory/**` + `docs/agent-wiki/**` docs must not reference repo file paths that no longer exist. The failure mode is "rename the code, the doc lags" ([[feedback-rename-code-not-just-docs]]) — and because the breaking change is usually a CODE commit (not a doc edit), the **primary trigger is CI-on-push** (repo-wide); `/start` is a backstop. A doc-scoped pre-commit guard would miss it (the commit that breaks the reference never touches the doc). Origin: the 2026-06-23 memory/wiki audit, where renamed/removed-path drift was the single largest stale class.

- Detects repo-root paths shaped `<prefix>/<...>.<ext>` or `./<prefix>/<...>.<ext>`, where prefix is one of `lib`, `pages`, `shared`, `scripts`, `modules`, `tests`, or `docs`, and extension is one of `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.sql`, `.json`, `.md`, or `.sh`. A trailing `:line` is ignored; globs/brace patterns (`*`, `{`) and `...`/`../` segments never match; Next.js `[token]` segments are literal and ARE checked; a `(?<![\w./-])` lookbehind excludes URLs and relative sub-paths.
- Does not protect extensionless directory refs such as `pages/admin/`, `.github/**`, repo-root files such as `package.json`, `.yaml`/`.yml`/`.mdx` files, or paths split across lines. Add a detector and binding self-test before treating any of those shapes as covered.
- Exemption: a removal/planned/historical keyword near the missing ref on the same line (removed · renamed · retired · superseded · abandoned · unused · historical · unbuilt · "name it" · "to live at" · planned · `~~strike~~`), a line-wide `<!-- doc-symbol-refs:ignore [reason=…] -->` marker, a **`.gitignored` path** (a generated/output artifact is never committed, so it legitimately won't exist in a clean checkout — `git check-ignore` matches it even when absent; fails closed on git error), or a point-in-time / allowlisted file.
- A new dangling path without one of those signals is a stale claim — fix the path to the current location; don't blanket-exempt.

### `check:build-claim-freshness` — stale "planned/not-built" claims whose path now exists (S282)

The exact COMPLEMENT of `check:doc-symbol-refs`: a live `.claude-memory/**` + `docs/agent-wiki/**` line that describes a repo path as **planned / not built yet**, where that path **now EXISTS**, is a stale build claim — the work shipped and the prose lagged. Like its sibling, the breaking change is usually a CODE commit (a planned file gets created), so the **primary trigger is CI-on-push**; `/start` is a backstop. Origin: the 2026-06-23 audit's second-largest stale class ("design-only / not built / future TODO" notes for work that had since shipped, e.g. `project-awardee-onboarding` vs. the live `AwardeeTab.js` + grantee-deliverables routes).

- The two gates close the lifecycle of a planned-path reference: planned + absent = fine; planned + present = **this gate** (flip the claim); no-keyword + absent = `doc-symbol-refs` (dangling); no-keyword + present = a normal live reference.
- PRECISION over recall (a noisy gate gets ignored). The pending keyword must be the **direct construction on the path**, not merely nearby: a verb phrase immediately before it (`to live at` · `will/would live` · `to be built/created/…` · `name it` · `recreate` · `scaffold` · `new file/helper/… at` · `planned:`) or a tag immediately after it (`` `PATH` (planned) `` · `(not built)` · `(unbuilt)` · `(design-only)` · `(stub)` · `(TODO)`). Anchoring kills the false-positive classes a proximity window hits: bare "planned" topic labels, design-doc references near a path, and multi-path lines where the keyword governs a DIFFERENT path. Bare "future"/"not yet"/standalone "planned" are intentionally NOT triggers.
- Exemption: a completion marker anywhere on the line (`now built/exists/lives/…` · `is/are built` · `already exists` · `built/lives/shipped at` · `shipped` · `landed` · `implemented` · `in place` · `VERIFIED` · ✅), a `<!-- build-claim-freshness:ignore [reason=…] -->` marker, a `.gitignored` path (presence non-deterministic across checkouts), or a point-in-time / allowlisted file.
- Recall is limited to claims that NAME a path (same as `doc-symbol-refs`); prose-only "not built" notes with no path are out of scope.

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

### `check:model-registry` — Anthropic model capability/pricing parity (S287)

Offline/static gate for future Anthropic model changes. Scans `shared/config/baseConfig.js` (`APP_MODELS` + Claude defaults), `lib/services/model-resolver.js` (`TIER_FALLBACK_IDS`), `lib/services/model-capabilities.js` (`MODEL_CAPABILITIES`), and `lib/utils/model-pricing.js` (`MODEL_PRICING`) without importing app modules or touching Anthropic. Tier keys (`opus`/`sonnet`/`haiku`) are allowed in config; concrete Claude ids reachable from static config or tier fallback ids must match both a reviewed capability entry and a pricing entry. Capability entries must carry required request/response metadata (`supportsTemperature`, `supportsEffort`, `thinkingMode`, max tokens, refusal semantics, retention class, `reviewedAt`, `source`).

- Blocks static model drift before runtime: a new concrete id in base config or tier fallback cannot ship until both request-shaping capabilities and pricing are reviewed.
- Deliberate boundary: v1 does NOT inspect Dataverse admin overrides, env overrides, or prompt-row model values at write time. Those are tracked in `docs/MODEL_CHANGE_STRATEGY.md` as the next hardening phase.
- Self-test: `scripts/check-model-registry-self-test.js` (clean fixture + missing capability + missing pricing + tier-fallback drift + malformed capability metadata).

### `check:agent-wiki` — agent retrieval-layer structure

Validates `docs/agent-wiki/` as a subordinate retrieval layer rather than a parallel source of truth. The gate checks required files, frontmatter, stale `last_verified` dates, source/canonical path existence, topic routing from the index, and local markdown links. Semantic truth still belongs to source files, Atlas pages, probes, and `/sweep`.

- Scope: `docs/agent-wiki/**`, `scripts/check-agent-wiki*.js`, `.claude/hooks/agent-wiki-reminder.js`, and `.claude/rules/agent-wiki.md`.
- Reminder: `.claude/hooks/agent-wiki-reminder.js` is advisory; it nudges when edits match a topic's `watch_paths`.
- Self-test: `scripts/check-agent-wiki-self-test.js`.

### `check:status-enum-parity` — producer↔consumer key parity (S257)

Guards the "producer-without-consumer-sweep" defect class: a value added to a producer set (an enum / status / `workRemaining` stage) but NOT to a consumer that maps/labels/buckets it, so the new value falls through unstyled / uncounted / unhandled. Enforces a registry of producer↔consumer key-parity invariants (currently `deriveWorkRemaining` stages ⊆ `STAGE_META` chips). **Extend the registry** when adding a producer set whose values must be mirrored by a consumer (label map / filter bucket / count rollup); runtime- or test-enforced pairs (derived inverses, throwing merges) need no entry.

- Scope: `scripts/check-status-enum-parity.js`, `.claude/hooks/enum-parity-commit-guard.js`.
- **Commit control:** a PreToolUse(Bash) hook runs the gate on `git commit` and BLOCKS (exit 2) on drift — the deterministic enforcement behind the contract-reconcile "complement & fan-out" rule (`feedback-scrutinize-exemptions-and-fallthrough`).
- Self-test: `node scripts/check-status-enum-parity.js --self-test`.

### `check:trust-boundary-guid` — client id → Dataverse selector must be GUID-validated (S259)

Guards the trust-boundary fan-out defect class: a client-supplied id (`req.query`/`req.body`) reaching a Dataverse record-id selector (`getRecord`/`updateRecord`/`deleteRecord`, or adapter `findById`/`updateLifecycle`/`softDelete`/`findByRequest`/`bulkUpdateByRequest`) with only a presence check. `getRecord`/`updateRecord` interpolate the id raw into the request URL and `findByRequest` into an OData `$filter` → over-fetch / IDOR / filter injection. AST taint analysis (`@babel/parser`) over `pages/api/**`: a tainted id must be validated by a recognized GUID guard (`isGuid`/`allGuids`/`GUID_RE.test`/`.every(isGuid)`/`guidToFolderSuffix`). Canonical edge guard: `lib/utils/guid.js`. Intra-file taint (interprocedural not modeled — documented boundary); escape hatch `// trust-boundary-guid:ignore reason=<id>`.

- Scope: `scripts/check-trust-boundary-guid.js`, `.claude/hooks/trust-boundary-guid-commit-guard.js`. Detail: `docs/agent-wiki/topics/security-auth.md` → "Trust-Boundary GUID Validation".
- **Commit control:** a PreToolUse(Bash) hook runs the gate on `git commit` and BLOCKS (exit 2) on a missing guard.
- Self-test: `npm run check:trust-boundary-guid:self-test` (FAIL fixtures prove it catches violations + live-baseline-clean assertion).

## Coverage tool self-tests (binding contract)

When modifying any `scripts/check-*.js` gate (or building a new one), the matching self-test must pass:

| Gate | Self-test |
|---|---|
| `check:atlas` | `check:atlas:self-test` — exercises every Atlas pattern from `docs/CLAUDE_COVERAGE_LESSONS.md`. |
| `check:doc-currency` | `check:doc-currency:self-test` — exercises every `DRIFT_PATTERNS` entry (positive + negation-guard fixtures). |
| `check:fact-consistency` | `check:fact-consistency:self-test` — exercises every `CANONICAL_FACTS` entry (known-miss positives + negation + structured-exemption fixtures + independent derive cross-check). |
| `check:drain-table-mentions` | `check:drain-table-mentions-self-test` |
| `check:prompt-storage-mentions` | `check:prompt-storage-mentions-self-test` |
| `check:doc-symbol-refs` | `check:doc-symbol-refs:self-test` — positive (dangling), negative (existing/annotated/marker/glob/ellipsis/relative/URL/gitignored), and live-baseline-clean fixtures. |
| `check:build-claim-freshness` | `check:build-claim-freshness:self-test` — positive (pending construction on an existing path: before/after/colon/to-be-created), negative (pending on absent path, plain ref, done-marker, "now lives at", bare-planned label, multi-path, ignore-marker, gitignored), and live-baseline-clean fixtures. |
| `check:canonical-pointers` | `check:canonical-pointers-self-test` |
| `check:model-registry` | `check:model-registry:self-test` |
| `check:agent-wiki` | `check:agent-wiki:self-test` |
| `check:status-enum-parity` | `check:status-enum-parity:self-test` |
| `check:trust-boundary-guid` | `check:trust-boundary-guid:self-test` |

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
- `check:doc-symbol-refs` then `check:doc-symbol-refs:self-test` (self-test writes fixtures into `docs/agent-wiki/`, which the gate scans)
- `check:build-claim-freshness` then `check:build-claim-freshness:self-test` (self-test writes fixtures into `docs/agent-wiki/`, which the gate scans)
- `check:model-registry` then `check:model-registry:self-test`
- `check:agent-wiki` then `check:agent-wiki:self-test`
