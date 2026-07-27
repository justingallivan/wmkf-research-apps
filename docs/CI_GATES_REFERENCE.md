---
title: CI Gates Reference
domain: docs-governance
kind: runbook
status: canonical
summary: Mechanics, enforcement locations, exemption rules, and operating contracts for repository checks and their self-tests.
canonical: true
cataloged: 2026-07-02
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/atlas/
  - docs/APPLICATION_STATE_ATLAS.md
  - pages/api/
  - lib/dataverse/
---

# CI Gates Reference

Mechanics, exemption rules, and operating contracts for repository checks. A
`check:*` package script is not automatically a GitHub CI check: enforcement can
live in GitHub Actions, a blocking commit hook, the changed-surface session-stop
hook, `/start`, or a manual release procedure.

## Enforcement locations

| Location | Current contract |
|---|---|
| GitHub Actions | `.github/workflows/test.yml` is authoritative. It runs lint; API-route, Atlas, doc-currency, docs-catalog, migration-manifest, agent-invariant, instruction-architecture, memory-router, doc-symbol, build-claim, model-warming, DAL/OData/context/route-service/route-lifecycle, secret, scaffolding, harness, and type checks; most listed gate self-tests; build; and `test:ci`. |
| Blocking commit hooks | `check:docs-catalog` runs for catalog-relevant staged/command paths. `check:status-enum-parity` and `check:trust-boundary-guid` run on every recognized `git commit`. These hooks fail open on hook-internal errors, so `/start` remains their backstop. |
| Session-stop changed-surface hook | `check:api-routes`, `check:atlas`, `check:migrations-manifest`, `check:prompt-injection-tagging`, `check:agent-wiki`, and `check:fact-consistency` are selected by changed paths. `CLAUDE_STOP_GATE_MODE` defaults to `advisory`; only an explicit `block` value makes failures blocking. |
| Session start / manual | `.claude/skills/start/SKILL.md` owns the broader startup battery. Advisory checks such as `check:memory-drift:no-write` and `check:memory-health` do not become blocking merely because they have package scripts. |

Do not describe a check as “in CI,” “blocking,” or “session-stop enforced” from
its name alone. Verify the applicable workflow or hook. The repository policy
still requires relevant red gates to be resolved before completion even when a
particular enforcement layer is advisory.

## P0 gates

A red gate in this set blocks completion on the affected surface as repository
policy. Automation varies by the enforcement table above. Established 2026-05-08
after a two-session gap where a `wmkf_apprequestpersons` Atlas miss from S139 sat
unfixed because each subsequent session classified it as out-of-scope.

| Gate | What it scans | What it blocks |
|---|---|---|
| `check:atlas` | Postgres tables + Dataverse entity sets referenced in source must appear in some Atlas page (`docs/atlas/*.md`, `docs/APPLICATION_STATE_ATLAS.md`). | New commits to data-layer surfaces (`pages/api/**`, `lib/dataverse/**`, `lib/db/**`, `lib/services/{dynamics,database,execute-prompt}*`, `scripts/audit-*`, `docs/atlas/**`, `docs/APPLICATION_STATE_ATLAS.md`) until green. |
| `check:atlas:self-test` | Every Atlas detection pattern from `docs/CLAUDE_COVERAGE_LESSONS.md` exercised against synthetic fixtures. | Same scope as `:atlas` — silent detector regressions would be invisible without it. |
| `check:api-routes` | API route files under `pages/api/**` must appear in `docs/API_ROUTE_SECURITY_MATRIX.md`. Hard-fails on missing-from-matrix; **warns** (non-fatal) on routes with no recognized guard token. Recognized guards include session guards (`requireAppAccess`, etc.), the cron/suggestion-token helpers, and (2026-06-11) HMAC helpers `verifyInternalCall`/`verifyBillWebhook` — the HMAC exemption applies only when the route's matrix row also documents a shared-secret/HMAC boundary, so an undocumented HMAC-token route still warns. Paths overridable via `API_ROUTE_GATE_API_ROOT`/`API_ROUTE_GATE_MATRIX_PATH` (used by the self-test). | PRs touching `pages/api/**` without a matrix update. |
| `check:api-routes:self-test` | Drives the gate against synthetic fixture routes + matrix: HMAC-documented → no warn; HMAC-undocumented → warn; known guard → no warn; intentional `None` → no warn; no-guard → warn; missing-from-matrix → hard-fail. | Silent regressions in guard recognition or the missing-route hard-fail. |
| `check:dataverse-access-layer` | Babel-AST census of raw `DynamicsService` calls in application code (import/require aliases, namespaces, defaulted dependency aliases, `executeChangeset` operation URLs, source-expression indirection). LAW MODE since Stage 8: fails on ANY identity whose entity is not `non-entity-transport` — no allowlist, no ratchet. | Any raw entity-attributed, unresolved, changeset-unresolved, unknown-method, or `unattributable-use:*` Dataverse transport use outside the DAL (`lib/dataverse/`) and exempt power tools. |
| `check:dataverse-access-layer:self-test` | Synthetic fixture tree proving direct calls, constants, aliases, changesets, exemptions, exported/re-exported aliases, method extraction/binding, client pass-through, computed methods, inline source expressions, dynamic import, plus clean transport-only greens. | Silent regressions in the law gate or its census classification. |
| `check:route-service-boundary` | Babel-AST census of `pages/api` route files that reach the Dataverse layer directly — importing `lib/dataverse/adapters/*` or `lib/services/dynamics-service` (static import, ESM re-export, dynamic `import()`, inline `require()`, or a thin re-export wrapper), outside exempt dirs `pages/api/dynamics-explorer/` + `pages/api/dataverse-export/`. Shares the hardened scanner core (`scripts/lib/ast-scan-core.js`) with the dataverse gate. LAW MODE since Stage 7 of `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`: fails on ANY in-scope boundary-importing route — no allowlist, no baseline, no ratchet. | Any `pages/api` route importing adapters or `dynamics-service` directly instead of going through a `lib/services/<domain>/` service. |
| `check:route-service-boundary:self-test` | Temp-root fixture tree proving adapter-source detection inherits the hardened classes (direct import, in-file alias, wrapper re-export incl. ESM import-then-export and CJS binding re-export, dynamic import, inline require, dynamics-service, root-level route) plus greens (clean shell, service-only route, service exporting its own adapter-calling functions, exempt dirs), the fail-closed hard error on non-literal `require()`/`import()` sources in routes or re-export positions, and law mode failing closed on every red class (each offending route named) while a green-only tree exits 0. | Silent regressions in boundary detection, fail-closed handling, or the law gate. |

The fix is always to make the gate green. Adding to `ALLOWED_UNDOCUMENTED_*` requires a written justification and is a last resort, not a default. The rule applies regardless of which session caused the red state: "not my regression" is not a valid reason to proceed past it.

## Local build gate execution in Codex sandbox

When a Codex session is running with filesystem sandboxing, scoped checks such as `npx jest ...` and `npx eslint ...` should run normally in the sandbox first. The full Next.js build is different: `npm run build` uses Next 16/Turbopack and may fail inside the Codex sandbox with a Turbopack panic that includes `Operation not permitted` while creating a process or binding a local worker port. Treat that as an execution-environment failure, not as an app build failure.

If `npm run build` fails with that sandbox/port-binding signature, immediately retry the same command through Codex's escalation/approval mechanism so it runs outside the sandbox. If escalation is unavailable, run `npx next build --webpack` and report it explicitly as a fallback build signal, not as the canonical Turbopack build.

If a retry reports "Another next build process is already running" after an interrupted attempt, check for a live `next build` / `npm run build` process first. Do not delete `.next`, kill broad process patterns, or clean build artifacts unless the live process check proves the warning is stale and the operator approves the cleanup.

## Gate details

### `check:dataverse-access-layer` — Dataverse data-access LAW (S329, Stage 8)

The migration's permanent gate. Scans `pages/`, `lib/`, `shared/`, and
`modules/` (minus the entity-generic power tools, the transport itself, and DAL
internals listed in `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`) and fails on
ANY raw `DynamicsService` call identity that does not classify as
`non-entity-transport` — the closed permanent surface (`createAndSendEmail`,
`addEmailAttachment`, `createEmailActivity`, `logAiRun`). No allowlist file,
no ratchet: Stage 8 deleted both.

- Failure classes: entity-attributed raw call; unresolved alias; unresolved
  changeset operation; unrecognized method name (`unknown-method:*` — a new
  DynamicsService method fails closed until the census is taught its name);
  unattributable alias/namespace/source-expression reference
  (`unattributable-use:*`).
- Alias-aware (import/require/dynamic-import aliases, namespaces, defaulted
  dependency injection) and changeset-aware (per-operation URL attribution);
  exported/re-exported aliases, method extraction/binding, pass-through
  clients, and computed method strings are outlawed rather than traced.
- The fix is never "exempt it": route the call through
  `lib/dataverse/adapters/` (or `lib/dataverse/core/changeset.js` for batches).
- Self-test: `npm run check:dataverse-access-layer:self-test`.

### `check:odata-escape` — OData escape LAW (S332, Stage 3)

Owner-approved regression gate for `docs/ODATA_ESCAPE_CONSOLIDATION_PLAN.md`
(Stages 0-2 consolidated every in-scope hand-rolled OData single-quote escape
onto `odata.escape` from `lib/dataverse/core/odata.js`; Stage 3 keeps it that
way). Fails on any hand-rolled `<receiver>.replace(/'/g, "''")` escape (or the
single-quoted-replacement variant, flexible whitespace, any receiver including
`String(x)` wrappers) found under `lib/`, `pages/`, `shared/`, or `modules/`
(`.js`/`.mjs`).

- Exemptions: `lib/dataverse/core/odata.js` itself (the primitive necessarily
  contains the pattern it forbids elsewhere); the `pages/api/dynamics-explorer/`
  exempt dir (mirrors `check:dataverse-access-layer`'s `EXEMPT_DIRS`);
  comment-only mentions — `//` and `/* */` comments are stripped (comment
  characters replaced with whitespace, preserving line numbers) before pattern
  matching.
- Does NOT flag HTML (`&#39;`) / XML (`&apos;`) entity escapes — different
  replacement string, not the doubled-quote form. Never scans `scripts/`
  (one-off tooling, out of scope per the plan).
- The fix is always to swap to `odata.escape(value)` (or `odata.eq`/`eqGuid`
  for a raw lookup position); never add a new receiver-shape exemption.
- `--root <dir>` override for the self-test's fixture tree.
- Self-test: `npm run check:odata-escape:self-test` — fixture-based, proves
  red (mechanical + `String(x)`/single-quoted-replacement variants), green
  (after removal), and that the HTML/XML/comment-only/canonical-file/exempt-dir
  shapes are never flagged.

### `check:dynamics-context-boundary` — bypass import-boundary LAW (S333, Stage 3)

Owner-approved regression gate for `docs/BYPASS_STRIP_PLAN.md` (Stages 1-2
converted every direct `bypassDynamicsRestrictions` call site to
`withDalContext`; Stage 3 keeps it that way). Babel-AST scan of `pages/`,
`lib/`, `shared/`, `modules/` failing on any of three shapes:

1. Any import/require/dynamic-import/re-export/inline-member-access of
   `bypassDynamicsRestrictions`, outside `lib/dataverse/core/context.js` (the
   one sanctioned `withDalContext` wrapper). Detection keys on the imported/
   destructured NAME rather than a resolved module source, so a non-literal
   `require()`/`import()` source fails closed for free.
2. Any `withDynamicsContext(...)` call whose `restrictions` is a literal
   empty array (`[]` — functionally identical bypass) or any other
   non-literal-array expression this gate cannot prove is non-empty (fail
   CLOSED), except the Explorer's loaded-restrictions caller under
   `pages/api/dynamics-explorer/` and `lib/services/dynamics-context.js`
   itself (the primitive necessarily contains the shape it implements).
3. Any `enterDynamicsBypassForScript` reference (its SCRIPT-ONLY contract)
   appearing in a scanned dir — these dirs are never `scripts/`, so any
   occurrence at all is a violation.

- `withDalContext` calls are always allowed. LAW mode from the start — the
  S333 mechanical strip already reduced the live census to 0 before this gate
  shipped, so there was no ratchet/ `--report` period.
- Shares the hardened scanner core (`scripts/lib/ast-scan-core.js`) with the
  dataverse and route-service gates.
- `--root <dir>` override for the self-test's fixture tree; `--json` prints
  the raw violation list.
- Self-test: `npm run check:dynamics-context-boundary:self-test` — fixture-based,
  proves all twelve required RED shapes (the plan's original ten — static
  import, aliased import, namespace/member access, dynamic import, inline
  require, re-export, non-literal source fail-closed, literal
  empty-restrictions, non-literal restrictions fail-closed,
  script-only-outside-scripts — plus two more a fresh-context Codex
  adversarial review found missing: an aliased-import and a namespace/
  member-form `withDynamicsContext` call, both with empty restrictions)
  each name their fixture file, and that the sanctioned importer, the
  definition file, the Explorer carve-out, ordinary `withDalContext` usage,
  and a legitimate
  non-empty-restrictions caller are never flagged.

### `check:fact-consistency` — registered scalar drift

The mandatory fan-in for code-derived scalars that get denormalized across docs (the recurring "fix in one place, stale restatement rots elsewhere" failure mode; S166 produced it ≥3× in one session).

- Registry: `scripts/lib/canonical-facts.js`. Each entry derives a scalar from the live repo (e.g., `app-definition-count`, `requireappaccess-endpoint-count`, `api-route-file-count`).
- Generated doc: `docs/CANONICAL_COUNTS.md` is the single source of truth for the live values; `npm run check:fact-consistency -- --write` regenerates it.
- Live doc/memory scan: registered stale-restatement patterns trigger fail-loud. Point-in-time audit docs are excluded by design.
- Exemption: same-line, fact-bound structured marker only. Example: `<!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-19 -->`. Session tags or loose words like "prior" are NOT exemptions. Multiple markers may appear on one line (one per fact id).
- **Operating rule:** run before claiming any fact-level doc/memory fix "done." Do not emit "DONE"/"✅" markers for such work until green.
- Bounded slice by design — only crisply derivable, drift-prone scalars. Not a complete semantic-drift solution.

### `check:docs-catalog` — top-level docs inventory

Requires every top-level `docs/*.md` file to carry catalog frontmatter and requires `docs/DOCS_CATALOG.md` to match the generated inventory from `npm run generate:docs-catalog`.

- Required frontmatter: `title`, `domain`, `kind`, `status`, and `summary`.
- Controlled values: `kind` must be one of the script-defined document types; `status` must be one of the script-defined lifecycle states; `domain` must be a lowercase slug.
- Optional relationships: `related`, `supersedes`, and `superseded_by` must be lists of existing repo paths when present.
- The `cataloged` date means the inventory metadata was generated or refreshed. It is not a claim that every factual assertion inside the doc was re-verified.
- Scope is intentionally top-level `docs/*.md`; topic subdirectories continue to use their own gates, especially `check:agent-wiki`.
- Hook assist: `.claude/hooks/docs-catalog-format-guard.js` blocks new top-level docs written without valid catalog frontmatter and advises on edits that remove or change catalog metadata.
- Commit control: `.claude/hooks/docs-catalog-commit-guard.js` runs `check:docs-catalog` on `git commit` only when staged paths touch top-level docs or the catalog tooling/config. If it blocks, fix frontmatter and run `npm run generate:docs-catalog`.

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

The registry covers six legacy reviewer-domain Postgres names. Five historical
tables were **dropped** by migration 018 on 2026-06-04:
historical/dropped `researchers`, historical/dropped `publications`,
historical/dropped `researcher_keywords`, historical/dropped
`reviewer_suggestions`, and historical/dropped `proposal_searches`.
Only `grant_cycles` remains as a drain-only Postgres snapshot after the W3
cutover. Current reviewer person, bibliometric, engagement, and grant-cycle
authority is Dataverse (`wmkf_potentialreviewer`, which carries the
bibliometric fields after the S213 sidecar collapse;
`wmkf_appreviewersuggestion`; and `wmkf_appgrantcycle`).

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

The report's top-level `summary` describes current live drift only. The dated 2026-05-14 S154 classifications remain under `historical_claim_audit` for provenance and are explicitly excluded from the current summary and gate result.

- Historical hazard: the Set D label collision that previously kept this gate red was resolved 2026-05-26 (Connor walkthrough — fit-assessment fields relabeled to Set E). Current state is whatever `npm run check:memory-drift` shows — verify before assuming.
- The Codex-flagged `incompatible_shape` drift bucket is a planned addition (not yet built).
- Promotion to the P0 set above is reasonable once the bucket lands AND the gate has been green continuously for a stretch of sessions.
- For routine memory audits that must not dirty the tracked report, use `npm run check:memory-drift:no-write` (read-only; never regenerates `docs/RECONCILIATION_REPORT.json`).

### `check:memory-health` (advisory) — active-memory hygiene worklist (S348)

Added S348 (audit Slice 5 from `docs/audits/memory-hygiene-control-audit-2026-07-02.md`). Runs `scripts/check-memory-health.js`. **Read-only, never fails** — complements `check:memory-router` (structure) with semantic-freshness signals. Reports per active leaf memory: `shadow-atlas` (structural claim, no Atlas/source/probe pointer), `weak-basis` (structural claim + stale/absent `last_verified`), `no-recall-rule`, `oversize-routed`, `stale-routed`. Parses both frontmatter conventions (top-level and `metadata:`-block `status:`). `--json` emits a machine-readable triage worklist; `--quiet` prints summary only. It is the intended starting point for future memory-triage passes (see `docs/audits/memory-triage-2026-07-08.md`). Wired into the `/start` advisory gate list.

### `check:model-override-warming` — LLM 404-on-tier-alias prevention (S230)

AST gate (`@babel/parser`). Every `pages/api/**` route that reaches a `getModelForApp` / `getFallbackModelForApp` call — directly or transitively through an imported module — must call an **awaited** `loadModelOverrides()` first (and within a single function, the warm must lexically precede a direct resolver call). Without warming, the synchronous resolver returns the raw tier alias (e.g. `sonnet`) and Anthropic 404s in prod; unit tests never catch it (they mock the LLM). This class recurred 3× (web-suggestions S229; applicant-reviewers + integrity-screener/screen S230) before the gate.

- Comment/string-proof (AST CallExpression detection, not text); resolves import-binding aliases (`import { getModelForApp as g }`); treats `await Promise.all([loadModelOverrides()])` as warmed.
- `shared/config/baseConfig.js` (the definition site) is excluded from the resolver set.
- Exemption marker for a route that imports a MIXED module but never reaches its model path: `// model-override-warming:ignore reason=<id>` — exempts TRANSITIVE reachability only; a direct resolver call in the route still requires warming.
- Self-test: `scripts/check-model-override-warming-self-test.js` (17 cases over isolated fixture trees). Codex-reviewed twice (S230).

### `check:model-registry` — Anthropic model capability/pricing parity (S287)

Offline/static gate for future Anthropic model changes. Scans `shared/config/baseConfig.js` (`APP_MODELS` + Claude defaults), `lib/services/model-resolver.js` (`TIER_FALLBACK_IDS`), `lib/services/model-capabilities.js` (`MODEL_CAPABILITIES`), and `lib/utils/model-pricing.js` (`MODEL_PRICING`) without importing app modules or touching Anthropic. Tier keys (`opus`/`sonnet`/`haiku`) are allowed in config; concrete Claude ids reachable from static config or tier fallback ids must match both a reviewed capability entry and a pricing entry. Capability entries must carry required request/response metadata (`supportsTemperature`, `supportsEffort`, `supportsStructuredOutput`, `thinkingMode`, max tokens, refusal semantics, retention class, `reviewedAt`, `source`).

- Blocks static model drift before runtime: a new concrete id in base config or tier fallback cannot ship until both request-shaping capabilities and pricing are reviewed.
- Deliberate boundary: v1 is still an offline/static gate and does not inspect live Dataverse rows or env values. Runtime/write-time guards now cover prompt execution, admin prompt publish, and admin model override writes; env overrides remain a pre-deploy checklist item in `docs/CREDENTIALS_RUNBOOK.md` / `docs/MODEL_CHANGE_STRATEGY.md`.
- Self-test: `scripts/check-model-registry-self-test.js` (six cases: clean fixture, missing capability, missing pricing, tier-fallback drift, missing review date, and missing structured-output review).

### `check:agent-wiki` — agent retrieval-layer structure

Validates `docs/agent-wiki/` as a subordinate retrieval layer rather than a parallel source of truth. The gate checks required files, frontmatter, stale `last_verified` dates, source/canonical path existence, topic routing from the index, and local markdown links. Semantic truth still belongs to source files, Atlas pages, probes, and `/sweep`.

- Scope: `docs/agent-wiki/**`, `scripts/check-agent-wiki*.js`, `.claude/hooks/agent-wiki-reminder.js`, and `.claude/rules/agent-wiki.md`.
- Reminder: `.claude/hooks/agent-wiki-reminder.js` is advisory; it nudges when edits match a topic's `watch_paths`.
- Self-test: `scripts/check-agent-wiki-self-test.js`.

### `check:harness-framing` — active harness wording

Scans active agent-facing harness surfaces for self-focused failure framing while allowing technical safety language such as `fail-open`, failure paths, and hazards.

- Scope: root/session instructions, `.claude/skills/**/SKILL.md`, `.claude/rules/*.md`, emitted hook source, `.claude-memory/MEMORY.md`, active feedback memories, `docs/agent-wiki/index.md`, and `docs/agent-wiki/topics/*.md`.
- Rationale sidecars and `.harness-backups/` are excluded so incident history remains available to maintainers without entering normal execution prompts.
- Self-test: `npm run check:harness-framing:self-test`.

### `check:status-enum-parity` — producer↔consumer key parity (S257)

Guards the "producer-without-consumer-sweep" defect class: a value added to a producer set (an enum / status / `workRemaining` stage) but NOT to a consumer that maps/labels/buckets it, so the new value falls through unstyled / uncounted / unhandled. Enforces four registered contracts: `deriveWorkRemaining` stages against both `STAGE_META` chips and `WORK_REMAINING_LABEL`; `STATUS_CLASS` against Status-tab `CLASS_META`; and discovery `VERIFICATION_STATUSES` against the save-candidate identity allowlist. **Extend the registry** when adding a producer set whose values must be mirrored by a consumer (label map / filter bucket / count rollup); runtime- or test-enforced pairs (derived inverses, throwing merges) need no entry.

- Scope: `scripts/check-status-enum-parity.js`, `.claude/hooks/enum-parity-commit-guard.js`.
- **Commit control:** a PreToolUse(Bash) hook runs the gate on `git commit` and BLOCKS (exit 2) on drift — the deterministic enforcement behind the contract-reconcile "complement & fan-out" rule (`feedback-scrutinize-exemptions-and-fallthrough`).
- Self-test: `node scripts/check-status-enum-parity.js --self-test`.

### `check:trust-boundary-guid` — client id → Dataverse selector must be GUID-validated (S259)

Guards the trust-boundary fan-out defect class: a client-supplied id (`req.query`/`req.body`) reaching a Dataverse record-id selector (`getRecord`/`updateRecord`/`deleteRecord`, or adapter `findById`/`updateLifecycle`/`softDelete`/`findByRequest`/`bulkUpdateByRequest`) with only a presence check. `getRecord`/`updateRecord` interpolate the id raw into the request URL and `findByRequest` into an OData `$filter` → over-fetch / IDOR / filter injection. AST taint analysis (`@babel/parser`) over `pages/api/**`: a tainted id must be validated by a recognized GUID guard (`isGuid`/`allGuids`/`GUID_RE.test`/`.every(isGuid)`/`guidToFolderSuffix`). Canonical edge guard: `lib/utils/guid.js`. Intra-file taint (interprocedural not modeled — documented boundary); escape hatch `// trust-boundary-guid:ignore reason=<id>`.

- Scope: `scripts/check-trust-boundary-guid.js`, `.claude/hooks/trust-boundary-guid-commit-guard.js`. Detail: `docs/agent-wiki/topics/security-auth.md` → "Trust-Boundary GUID Validation".
- **Commit control:** a PreToolUse(Bash) hook runs the gate on `git commit` and BLOCKS (exit 2) on a missing guard.
- Self-test: `npm run check:trust-boundary-guid:self-test` (FAIL fixtures prove it catches violations + live-baseline-clean assertion).

### `check:secret-scan` — tracked-tree real secret push protection

Scans `git ls-files` text content (current tree only, not history) and skips `package-lock.json` / `*.lock`. It fails closed on real secret/key-shaped literals: long Anthropic `sk-ant-apiNN-*` values, AWS `AKIA...`, GitHub `ghp_` / `github_pat_`, Slack `xoxb-`, Google `AIza...`, real `vercel_blob_rw_<store>_<secret>` tokens, private-key headers / JSON `private_key`, and high-entropy assignments to env names derived from `lib/utils/tracked-secrets.js`.

- Precision guard: short/low-entropy values and obvious placeholders (`test`, `stub`, `fixture`, `example`, `placeholder`, `your`, `xxx`, `redact`, `fake`, `dummy`, `sample`, `mock`, `throwaway`, `rehearsal`, `TESTSTORE`, literal ellipses) are ignored so synthetic fixtures and `.env.example` do not require broad exemptions.
- Allowlist: `scripts/check-secret-scan-allowlist.js`; entries must be file/line or substring-narrow and carry a reason comment. The current allowlist is empty.
- Self-test: `npm run check:secret-scan:self-test` writes temporary fixtures, proves a real-looking secret is flagged, proves fake/test-marked values pass, and asserts the live baseline is clean.

### `check:route-lifecycle-auth` — lifecycle auth claims match routes

Compares every `ROUTE_NAMESPACE_LIFECYCLE` entry in
`shared/config/appRegistry.js` with the actual `requireAppAccess(...)` keys in
the resolved route files. It fails closed on missing handlers, unparseable
guards, a missing `guardAppKeys`, a supposedly uniform namespace whose keys
differ, or a `guardAppKeys: null` namespace that is not actually heterogeneous.
GitHub CI runs the gate and `check:route-lifecycle-auth:self-test`.

### `check:prompt-injection-tagging` — A7 registry coverage

Checks the registered untrusted-input LLM surfaces for the required
`wrapUntrustedContent` and `buildUntrustedContentPreamble` controls, including
multimodal and per-builder exceptions declared in the registry. The gate and
self-test are in the `/start` battery; the changed-surface session hook runs the
gate for prompt paths in advisory mode by default. They are **not currently in
`.github/workflows/test.yml`**.

### `check:scaffolding-tokens` — leaked tool-call markup

Scans tracked text files for bare-line tool scaffolding tags outside fenced code
blocks. GitHub CI runs both the gate and
`check:scaffolding-tokens:self-test`.

### Repository and instruction integrity checks

- `check:migrations-manifest` verifies that the sorted manifest exactly matches
  `lib/db/migrations/*.sql`; GitHub CI also checks the build did not regenerate
  an uncommitted manifest.
- `check:agent-invariants:ci` verifies the tracked `AGENTS.md` symlink in CI.
  Local `check:agent-invariants` additionally checks `.agents/skills` and the
  Claude memory-store symlink.
- `check:instruction-architecture` verifies required rules/hook wiring,
  instruction size/shape, protected-path behavior, and the fresh-install
  database guard.

## Coverage tool self-tests (binding contract)

When modifying any `scripts/check-*.js` gate (or building a new one), the matching self-test must pass:

| Gate | Self-test |
|---|---|
| `check:atlas` | `check:atlas:self-test` — exercises every Atlas pattern from `docs/CLAUDE_COVERAGE_LESSONS.md`. |
| `check:doc-currency` | `check:doc-currency:self-test` — exercises every `DRIFT_PATTERNS` entry (positive + negation-guard fixtures). |
| `check:fact-consistency` | `check:fact-consistency:self-test` — exercises every `CANONICAL_FACTS` entry (known-miss positives + negation + structured-exemption fixtures + independent derive cross-check). |
| `check:drain-table-mentions` | `check:drain-table-mentions:self-test` |
| `check:prompt-storage-mentions` | `check:prompt-storage-mentions:self-test` |
| `check:doc-symbol-refs` | `check:doc-symbol-refs:self-test` — positive (dangling), negative (existing/annotated/marker/glob/ellipsis/relative/URL/gitignored), and live-baseline-clean fixtures. |
| `check:build-claim-freshness` | `check:build-claim-freshness:self-test` — positive (pending construction on an existing path: before/after/colon/to-be-created), negative (pending on absent path, plain ref, done-marker, "now lives at", bare-planned label, multi-path, ignore-marker, gitignored), and live-baseline-clean fixtures. |
| `check:canonical-pointers` | `check:canonical-pointers:self-test` |
| `check:model-registry` | `check:model-registry:self-test` |
| `check:agent-wiki` | `check:agent-wiki:self-test` |
| `check:harness-framing` | `check:harness-framing:self-test` |
| `check:status-enum-parity` | `check:status-enum-parity:self-test` |
| `check:trust-boundary-guid` | `check:trust-boundary-guid:self-test` |
| `check:dataverse-access-layer` | `check:dataverse-access-layer:self-test` — law-mode greens plus red fixtures for entity calls, unresolved aliases/changesets, unknown methods, exported/re-exported aliases, method extraction/binding, client pass-through, computed methods, inline source expressions, and dynamic import. |
| `check:route-service-boundary` | `check:route-service-boundary:self-test` — law-mode red fixtures (direct/alias/wrapper-reexport incl. import-then-export + CJS binding re-export/dynamic-import/inline-require adapter imports, dynamics-service import, root-level route, non-literal-source hard-fails), each asserting a named law failure with no baseline, + greens (clean shell, service-only route, own-function-exporting service, exempt dirs, green-only tree exits 0). |
| `check:route-lifecycle-auth` | `check:route-lifecycle-auth:self-test` |
| `check:secret-scan` | `check:secret-scan:self-test` |
| `check:scaffolding-tokens` | `check:scaffolding-tokens:self-test` |
| `check:prompt-injection-tagging` | `check:prompt-injection-tagging:self-test` |

**When external review catches a structural pattern an existing gate missed, the order is mandatory:**

1. Update `docs/CLAUDE_COVERAGE_LESSONS.md` (or the matching pattern catalog) with the new pattern + parallels.
2. Add a fixture to the relevant self-test that exercises it.
3. Patch the gate.
4. Commit all four changes (lesson, fixture, fix, atlas page if needed) together.

Skip step 1 and you'll forget the lesson; skip step 2 and the gate can regress silently.

## Fixture-path race hazard

Several self-tests write synthetic fixtures into paths that multiple
documentation gates scan (e.g., `docs/` or `docs/agent-wiki/`). Running only
each gate/self-test pair sequentially is insufficient if different pairs run in
parallel: one pair can read or delete another pair's fixtures. This was
reproduced during the 2026-07-26 full documentation audit.

**Run the entire fixture-writing gate battery serially. Within it, run each gate
before its self-test:**
- `check:atlas` then `check:atlas:self-test` (never in parallel)
- `check:fact-consistency` then `check:fact-consistency:self-test` (same hazard)
- `check:canonical-pointers` then `check:canonical-pointers:self-test` (same hazard)
- `check:drain-table-mentions` then `check:drain-table-mentions:self-test` (same hazard)
- `check:prompt-storage-mentions` then `check:prompt-storage-mentions:self-test` (same hazard)
- `check:doc-symbol-refs` then `check:doc-symbol-refs:self-test` (self-test writes fixtures into `docs/agent-wiki/`, which the gate scans)
- `check:build-claim-freshness` then `check:build-claim-freshness:self-test` (self-test writes fixtures into `docs/agent-wiki/`, which the gate scans)
- `check:model-registry` then `check:model-registry:self-test`
- `check:agent-wiki` then `check:agent-wiki:self-test`
- `check:dataverse-access-layer` then `check:dataverse-access-layer:self-test`
- `check:route-service-boundary` then `check:route-service-boundary:self-test` (self-test is `--root`-isolated to a temp dir like the dataverse pair, so no shared-path race; run sequentially per the universal gate convention)
- `check:secret-scan` then `check:secret-scan:self-test`
