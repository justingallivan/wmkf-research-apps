# Session 337 Prompt: ContactEnrichmentService decomposition — Checkpoint A done, resume at A2 (search-tiers)

## Session 336 Summary

Planned and began executing the **ContactEnrichmentService decomposition** (the next
service-decomposition candidate carried from S335, reusing the DiscoveryService playbook). Authored a
full plan, hardened it through **3 Codex adversarial review rounds**, then executed **Stage 0 +
Checkpoint A (Stages 1, 2, 4, 7)** as a strict **behavior-freeze** — pure code motion, zero semantic
change — driving `lib/services/contact-enrichment-service.js` (1,776 L) toward a thin facade over
`lib/services/contact-enrichment/*.js` modules.

The through-line matched the proven cadence: mechanical call-graph BEFORE extraction (caught false
dependency edges three LLM review rounds kept missing), per-cluster characterization coverage
(baselined green pre-extraction, **mutation-proven** to discriminate) BEFORE the code moved, batched
Codex review at the checkpoint. **6 modules extracted (22 methods + constants/helpers); 232 tests green
(+51 new characterization cases); eslint + all touched gates green throughout.**

### What Was Completed

1. **Plan + 3 Codex review rounds** (`767ff13b`, `6e9f5c0b`, `cd4496f0`, `5d827607`, `668b6814`) —
   `docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md`. R1 (3 BLOCKER/3 MAJOR/1 MINOR): C10 spyable
   `this`-dispatch trap, incomplete C9 tier early-returns, wrong dep edges, stale caller inventory. R2:
   more C9 branches, false dep edges (SerpContactService/resolveIdentity), a nonexistent script in the
   inventory, C12 `_finalize` step-order, C6 A7-registry hard-coding. R3 (final, on the overall plan):
   1 BLOCKER — `search-tiers` mis-classified as a low-risk leaf → pulled into its own Checkpoint A2;
   added C13 relative-import path rewrites. Owner decided **Q1-B** (extract the tiers) + **10 modules**.

2. **Stage 0 executed** (`3f5c0fb8`, `14bb81a4`, `b3b448ce`) — `constants.js` + `abort.js` extracted;
   ran the mechanical call-graph and replaced the by-eye dep table with a **verified acyclic DAG**.

3. **Checkpoint A executed** (Stages 1, 2, 4, 7) — all Codex-reviewed **SATISFIED** (static body
   comparator: all 22 moved bodies byte-identical after only the permitted `this._x → sibling` rewrite):
   - S1 `identity-anchor.js` — 8 helpers (`19dacedf`)
   - S2 `domain-evidence.js` — 11 helpers, a true leaf (`91618142`)
   - S4 `openalex-metrics.js` — 2 methods + dead-import cleanup (`efeadc97`)
   - S7 `cost.js` — `estimateCost` (`c9939dc9`)
   - Executed-state notes reconciled into the plan (`60861865`).

### Commits (14 total, `767ff13b`…`60861865`, all on `main`)
Plan/reviews: `767ff13b` `6e9f5c0b` `cd4496f0` `5d827607` `668b6814` `66f874e3`. Stage 0: `3f5c0fb8`
`14bb81a4` `b3b448ce`. Checkpoint A: `19dacedf` `91618142` `efeadc97` `c9939dc9` `60861865`.

## Next Items

### Verified Open

1. **Resume the decomposition at Checkpoint A2 — `search-tiers.js` (Stage 6).**
   Evidence: `docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md` "Execution cadence" + Stage 6 bullet;
   `grep -n claudeWebSearch lib/services/contact-enrichment-service.js`. This is a **dedicated-review**
   stage (NOT batched) — it moves `claudeWebSearch` + `buildGoogleScholarUrl`, and MUST (a) update the
   `check-prompt-injection-tagging.js` registry `callSiteFiles` to the new path **in the same commit**
   (C6 — the gate hard-codes the path), (b) preserve all **3 dynamic ESM `import()` string paths**
   rewritten for the deeper dir (C11+C13: `ai-payload-boundary`, `llm-client`, `ai-output-schema`).

2. **Then Checkpoint B (Stages 3, 5), C (8), D (9, 10).** Evidence: plan "Execution cadence."
   B = `email-adjudication` + `page-email` (batched review). C = `persistence.js` (the DAL write unit;
   C5 — dedicated review + the 3 LAW gates). D = `tiers.js` (the Q1-B tier extraction, highest-risk:
   C9 early-returns, C10 spyable dispatch, C12 `_finalize` order) + facade finalize; dedicated review.

3. **`dynamics-service.js` (1,728 L) decomposition** — the other oversized service, higher-risk
   (Dataverse write hub). Evidence: `wc -l lib/services/dynamics-service.js`. Its own plan + heavy
   contract-reconcile before touching. Do AFTER contact-enrichment is finished.

### Backlog (small, owner-priority when convenient — carried from S336, NOT re-verified S337)

1. **`pages/api/app-access.js` swallows service errors** (P3, pre-existing). Re-locate before fixing
   (line numbers drift). Fix = return an error status when the service reports `{ error }`.
2. **atlas-gate ↔ self-test race** over shared `lib/services/atlas_selftest_tmp`. Documented wart.
3. **pg `sslmode=verify-full`** cron stderr warning — one-line env change + redeploy.

### Parked

1. **Spec-audit design-docs recovery** (work computer, ~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

### Do Not Reopen Without New Decision

1. **DiscoveryService decomposition: COMPLETE (S335).** Do not re-extract.
2. **Contact-enrichment owner decisions stand:** Q1-B (extract tiers, facade ~350 L) + 10 modules; no
   coarser fold. Evidence: `CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md` Q1/Q2.
3. **Checkpoint A (Stages 0,1,2,4,7): COMPLETE + Codex SATISFIED.** Do not re-extract those clusters;
   extend the modules in place. Evidence: plan stage notes + commits `3f5c0fb8`…`c9939dc9`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md` | The live plan — strategy, VERIFIED mechanical DAG, constraints C1–C13, execution cadence (checkpoints A/A2/B/C/D), per-stage executed notes + Codex verdicts. Read the cadence section first. |
| `lib/services/contact-enrichment-service.js` | The facade (shrinking): delegating wrappers + the not-yet-extracted tier orchestrator, batch, finalize, persistence, page-email, email-adjudication, search-tiers. |
| `lib/services/contact-enrichment/*.js` | Extracted modules: `constants`, `abort`, `identity-anchor`, `domain-evidence`, `openalex-metrics`, `cost` (6 of 11 target). |
| `tests/unit/contact-enrichment-{identity-anchor,domain-evidence,openalex-metrics,cost}.test.js` | New characterization suites (51 cases; mutation-proven). |

## Testing

```bash
# Contact-enrichment covering + new characterization suites (baseline before/after each stage)
npx jest tests/unit/contact-enrichment-*.test.js tests/unit/contact-leads-slice2a.test.js \
  tests/unit/save-to-database-identity-gate.test.js tests/unit/resolved-page-email-*.test.js \
  tests/unit/reviewer-enrich-contacts-route.test.js tests/unit/reviewer-identity-guard.test.js \
  tests/unit/reviewer-route-identity-gate.test.js tests/integration/enrich-recommended-route.test.js

# LAW-mode gates (mandatory at Checkpoint C / persistence stage)
npm run check:dataverse-access-layer && npm run check:route-service-boundary \
  && npm run check:dynamics-context-boundary && npm run check:prompt-injection-tagging

# Full suite
npm test
```
