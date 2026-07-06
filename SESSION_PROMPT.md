# Session 336 Prompt: DiscoveryService decomposed — next up, contact-enrichment / dynamics-service

## Session 335 Summary

Executed the **DiscoveryService decomposition** end-to-end (carried service-decomposition item from
S331–334). Drove `lib/services/discovery-service.js` from a **2,348-line static god-class → a 668-line
thin delegating facade** (~72% smaller) over **13 cohesive `lib/services/discovery/*.js` modules**, as a
strict **behavior-freeze** (pure code motion, zero semantic change). Plan authored and approved via two
Codex adversarial-review rounds; all 6 execution stages independently Codex-reviewed **SATISFIED**.

The through-line: strategy chosen up front (facade + extracted modules, so every `DiscoveryService.method()`
call site — 2 routes, 12 scripts, 8 test files — keeps working unchanged), then each cluster got
characterization coverage (baselined green pre-extraction, **mutation-proven** to discriminate) BEFORE the
code moved. Full suite **436 suites / 4849 tests green** (+79 new characterization tests over the 428/4770
S334 baseline); eslint clean; all touched gates pass.

### What Was Completed

1. **Plan + 2 review rounds** (`a9ba8ca3`, `84d9eb43`, `949a61c8`) — `docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md`.
   Round 1 CHANGES-REQUIRED: 2 verified BLOCKERs (missed 2 static props → 10 not 8; incomplete dependency
   column → added the `DEBUG`/`NCBI_API_KEY`/`PUBMED_DELAY` env consts, constraint **C7**). Round 2 SATISFIED.

2. **Stages 0–6 executed** (all SATISFIED):
   - S0 `constants.js` (`f688dce7`) · S1 `name-matching.js` (`649c9d33`) · S2 `affiliation.js` (`4dea718a`)
   - S3 `research-area`+`pubmed-query` (`de20589e`), `match-signals`+`provenance`+`publications` (`5e112eb9`)
   - S4 `track-b-identity`+`coauthor-coi`+`literature-search`+`ranking` (`4c7b83cc`)
   - S5 `verification.js` — the 272-line `verifyClaudeSuggestions` hub (`15b9cebd`)
   - S6 facade finalization / dead-import cleanup (`a552480e`)

3. **One real bug caught by review + fixed** (`1228ebef`): a Stage-5 `minPublications = MIN_PUBLICATIONS`
   *default param* masked an explicit-`undefined` override (diverging from the pre-extraction
   `this.MIN_PUBLICATIONS` read under C1). Removed the default so the param mirrors the facade static
   exactly. **Lesson recorded:** `.claude-memory/feedback-behavior-freeze-passthrough-no-default.md`.

4. **Doc-count reconciliation** (`00313e52`) — Codex final review flagged the plan's facade counts (12→10
   static props, 50→53 wrappers, 12→11 removed imports) and the underscore-methods deviation (kept as thin
   wrappers to preserve the exact surface, not made private). Reconciled every restatement.

### Commits (21 total, `a9ba8ca3`…`00313e52`, all on `main`)
Plan: `a9ba8ca3` `84d9eb43` `949a61c8`. Stages: `f688dce7` `649c9d33` `4dea718a` `de20589e` `5e112eb9`
`4c7b83cc` `15b9cebd` `a552480e`. Fix: `1228ebef`. Review/doc records: `da9c19d4` `b7fb6be1` `dcfb8483`
`2bf03915` `859a8bad` + hook-ack fixes `c404d490` `70b92f33` `1d66361e` + `00313e52`.

## Next Items

### Verified Open

1. **`contact-enrichment-service.js` decomposition** (next service-decomposition candidate).
   Evidence: `wc -l lib/services/contact-enrichment-service.js` = **1,776 L** (S335, still oversized;
   discovery-service is now done). Same cadence proven this session: plan → 2 review rounds → leaf-first
   staged extraction behind a facade, characterization + mutation-proof per cluster, per-stage Codex review.
   The reusable playbook is `docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md`.

2. **`dynamics-service.js` (1,728 L)** — the other oversized service, but it is the Dataverse write hub
   (LAW-mode gates: `check:dataverse-access-layer`, `check:route-service-boundary`, trust-boundary,
   context-boundary). Evidence: `wc -l` = 1,728 L. HIGHER RISK than discovery (not a pure static-method
   class; carries auth/restriction context). Would need its own plan + heavy contract-reconcile before touching.

3. **The flat `lib/services` domain-fold** (carried S331). Evidence: `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`.
   Needs a CodeGraph pass first to group the ~50 flat service files into domain subdirs; larger and cross-cutting.

### Backlog (small, owner-priority when convenient)

1. **`pages/api/app-access.js` swallows service errors** (P3, pre-existing). Evidence: still returns
   `res.json({ success: true })` at `:25` (and the grant path) regardless of a service `{ error }`
   [VERIFIED via grep, S335 — line numbers shifted again; re-locate before fixing]. Fix = return an error
   status when the service reports one.
2. **1b-15 atlas-gate ↔ `check-coverage-self-test.js` race** over shared `lib/services/atlas_selftest_tmp`.
   Documented wart; real fix needs a dedicated fixture path. Not re-verified S335.
3. **pg `sslmode=verify-full`** — cron stderr `(node:4)` warning wants explicit `sslmode=verify-full`
   before pg v9. One-line env change + redeploy. Not re-verified S335.

### Parked

1. **Spec-audit design-docs recovery** (work computer, ~2026-07-08). Evidence:
   `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

### Do Not Reopen Without New Decision

1. **DiscoveryService decomposition: COMPLETE.** All 6 stages executed + Codex-reviewed SATISFIED; facade
   668 L; behavior-freeze held (full suite 436/4849 green). Evidence: `DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md`
   status line + stage notes; commits `f688dce7`…`00313e52`. Do not re-extract; extend the modules in place.
2. **Notification site-33 (`NOTIFICATION_TRUST_MODEL_PLAN.md`): CLOSED** (S334). `BYPASS_STRIP_PLAN.md`
   Stages 0-4: CLOSED. Chunk-loop/security-gate consolidation: DECLINED (S332). No CodeQL re-add. Do not
   delete `lib/services/anthropic-admin.js`. Client-side export decision stands.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md` | COMPLETE record — strategy, verified dep graph, C1–C7 constraints, per-stage notes + all Codex verdicts. The reusable decomposition playbook. |
| `lib/services/discovery-service.js` | 668-line facade: `discover` orchestrator + 10 static props + 53 delegating wrappers. |
| `lib/services/discovery/*.js` | 13 cluster modules (constants, name-matching, affiliation, research-area, pubmed-query, match-signals, provenance, publications, track-b-identity, coauthor-coi, literature-search, ranking, verification). |
| `tests/unit/discovery-*.test.js` | Characterization suites (8 new this session; mutation-proven). |
| `.claude-memory/feedback-behavior-freeze-passthrough-no-default.md` | The C1 default-param trap caught by Codex. |

## Testing

```bash
# All discovery characterization + covering suites
npx jest tests/unit/discovery-*.test.js tests/unit/track-b-honorific-and-cross-field.test.js \
  tests/unit/reviewer-suggestion-data-quality.test.js tests/integration/enrich-recommended-route.test.js

# Boundary gates the decomposition touched
npm run check:dataverse-access-layer && npm run check:route-service-boundary && npm run check:doc-symbol-refs

# Full suite (436 suites / 4849 tests green end of S335)
npm test
```
