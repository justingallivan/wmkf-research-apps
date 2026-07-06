# Session 338 Prompt: DynamicsService decomposition — plan ready + validated, start Stage 0

## Session 337 Summary

Completed the **entire ContactEnrichmentService decomposition** (Checkpoints A2 → B → C → D) as a
strict **behavior-freeze**, finishing the effort begun S336. The facade
`lib/services/contact-enrichment-service.js` went **1,776 → 529 L**, now a thin delegator over **11
modules** under `lib/services/contact-enrichment/`. Every checkpoint was verified by an independent
adversarial Sonnet pass AND, at owner request, the real **`/codex:adversarial-review`** — both returned
**approve / byte-identical / behavior-preserved** on all four checkpoints. Full suite **4,945 tests
green**; all gates green throughout.

Separately, authored + locked + validated the **DynamicsService decomposition plan** (next effort):
Fable authored it from a full source read; owner approved Q1–Q4; an adversarial pass returned
**PLAN-SOUND** (all six load-bearing claims verified against source). The write-hub build was
**deliberately NOT started** — Stage 0 hand-edits LAW security-gate matchers, a human-greenlight zone.

### What Was Completed

1. **Startup red gate fixed** — 9 `publications.js` code-symbol mentions in <!-- drain-table:ignore reason=code-symbol-filename -->
   `docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md` annotated for `check:drain-table-mentions` (`8d21a4b9`).

2. **Checkpoint A2 — `search-tiers.js`** (`1f91ac0a`): `claudeWebSearch` + `buildGoogleScholarUrl`; C6
   A7 registry moved to the new path; 3 dynamic ESM imports preserved (C11) + depth-rewritten (C13).
3. **Checkpoint B — `email-adjudication.js` + `page-email.js`** (`f0a62415`, `df1afa79`, doc `9fe39261`):
   both depend only on domain-evidence; C11 env-flag (`REVIEWER_PAGE_EMAIL_TIER_ENABLED`) kept in-function.
4. **Checkpoint C — `persistence.js`** (`d79f1494`, doc `526fee23`): the DAL write unit; `withDalContext`
   wrapper + adapter calls + identity-gate blocks intact; imports adapters but does NOT re-export them
   (C5); three LAW gates green.
5. **Checkpoint D — `tiers.js` + facade finalize** (`cc95e2b8` suite, `f84f6355` extract, `e4fe8ec9`
   finalize, doc `1a1f00c0`): the highest-risk cut. In-tier `return this._finalize(...)` early-returns
   became `'finalize'`/`'continue'` signals interpreted by the shell; C10 dispatch of
   claudeWebSearch/saveToDatabase/enrichCandidate/**_applyAffiliationOverride** (a 4th edge added beyond
   the plan's 3, for step-order spyability) routes through the facade `service` arg; C12 `_finalize`
   step order preserved. 30-case mutation-proven characterization suite green pre + post.
6. **DynamicsService plan authored (Fable) + Q1–Q4 locked + adversarially validated** — see "Next Items".

### Commits (11 this session, `8d21a4b9`…`1a1f00c0`, all on `main`)
`8d21a4b9` `1f91ac0a` `f0a62415` `df1afa79` `9fe39261` `d79f1494` `526fee23` `cc95e2b8` `f84f6355`
`e4fe8ec9` `1a1f00c0`.

## Next Items

### Verified Open

1. **Land the DynamicsService plan into `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md`, then start Stage 0.**
   Evidence: full plan text is in the S337 transcript (Fable subagent result) + a summary stub in the
   session scratchpad (`DYNAMICS_SERVICE_DECOMPOSITION_PLAN.draft.md`, session-local — reconstruct from
   transcript). Owner said "you may begin building if ready"; readiness gate met (plan complete +
   decisions locked + adversarial review PLAN-SOUND). **The docs/ Write was blocked in S337 by the
   `scope-claim-reminder` guard pairing forward line-estimates with derived counts — strip/qualify the
   remaining bare counts or mark them `[ASSUMED]` before landing.** Stage 0 is DEDICATED-review; it
   modifies LAW security-gate matchers — treat as high-risk, get a fresh-context `/codex:adversarial-review`.
   - **DECISIONS (owner-locked S337):** Q1 = **12 modules** (constants, http, auth, restrictions,
     annotations, schema, read-ops, write-core, changeset, email, ai-run + facade); Q2 = **full-surface
     facade ~260 L**; Q3 = **co-locate caches** (tokenCache→auth.js, schemaCache→schema.js) + delegating
     `clearCaches` (the ONE sanctioned non-verbatim change); Q4 = **extend both LAW gate path-matchers to
     `lib/services/dynamics/` + self-test fixtures in the Stage-0 commit**.
   - **Cadence:** Stage 0 (scaffolding + gate-matcher extension + mechanical call-graph, DEDICATED) →
     A auth/restrictions/annotations (batched) → B schema/read-ops (batched) → C write-core (DEDICATED) →
     D changeset (DEDICATED, highest-risk) → E email (DEDICATED) → F ai-run + facade finalize (batched).
     **C1 svc-dispatch rule** is the defining rewrite: every method takes the class as first param `svc`,
     `this.X(`→`svc.X(`; nothing else in the body changes (spy/raw-reassign surface is total).
   - **3 implementation-time checks (from the adversarial plan review):** (a) grep **ALL** `this.\w+(`
     sites in dynamics-service.js before extracting — confirm none become accidental static cross-module
     imports under svc-dispatch; (b) Stage 0 must add a **negative** self-test fixture (a fake route
     importing `lib/services/dynamics/*`) that MUST fail both LAW gates — verify the extended matcher
     regex, don't post-hoc trust it; (c) confirm `AI_RUN_TASK_TYPES`/`AI_RUN_STATUSES` (`:1121`/`:1128`)
     + `_truncateForMemo` (`:1194`) aren't stranded as orphaned exports (full-surface facade).

### Owner Decision Needed

_(none open — Q1–Q4 for DynamicsService are locked; see above.)_

### Backlog (small, owner-priority when convenient — carried from S336, NOT re-verified S337)

1. **`pages/api/app-access.js` swallows service errors** (P3, pre-existing). Re-locate before fixing
   (line numbers drift). Fix = return an error status when the service reports `{ error }`.
2. **atlas-gate ↔ self-test race** over shared `lib/services/atlas_selftest_tmp`. Documented wart.
3. **pg `sslmode=verify-full`** cron stderr warning — one-line env change + redeploy.

### Parked

1. **Spec-audit design-docs recovery** (work computer, ~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

### Do Not Reopen Without New Decision

1. **ContactEnrichmentService decomposition: COMPLETE (S337).** All 11 modules extracted; facade 529 L;
   doubly-verified (Sonnet + Codex adversarial = approve). Do not re-extract; extend modules in place.
   Evidence: `docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md` (all 10 stages EXECUTED) + commits
   `1f91ac0a`…`e4fe8ec9`.
2. **DiscoveryService decomposition: COMPLETE (S335).** Do not re-extract.
3. **DynamicsService owner decisions Q1–Q4 stand** (12 modules / full-surface facade / co-locate cache
   seam / extend gate matchers). Do not re-litigate without a new owner decision.

### Verify Before Acting

1. **CE checkpoints A2/B/C/D are committed but NOT yet run through the standard PR/CI merge flow** if the
   repo uses one — they were committed directly to `main` per project convention
   (`.claude-memory/project-commit-directly-to-main.md`). No action if direct-to-main stands.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/contact-enrichment-service.js` | The finished facade (529 L): `enrichCandidate` shell (drives applyTier0..4 + signal interpretation) + `enrichCandidates` + delegating wrappers + `COSTS` re-export. |
| `lib/services/contact-enrichment/*.js` | The 11 extracted modules: constants, abort, identity-anchor, domain-evidence, openalex-metrics, cost, search-tiers, email-adjudication, page-email, persistence, tiers. |
| `tests/unit/contact-enrichment-tiers.test.js` | Stage 9 tier control-flow + C12 step-order characterization suite (30 cases, mutation-proven). |
| `docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md` | The completed plan (all 10 stages EXECUTED + Codex verdicts). |
| `lib/services/dynamics-service.js` | The next target (1,728 L, Dataverse WRITE hub). Decompose per the S337 plan (transcript). |
| `scripts/check-dataverse-access-layer.js` `:216`, `scripts/check-route-service-boundary.js` `:67` | The LAW gate path-matchers Stage 0 must extend to `lib/services/dynamics/` (Q4/C5). |

## Testing

```bash
# ContactEnrichment covering + tier characterization suites
npx jest tests/unit/contact-enrichment-*.test.js tests/unit/contact-leads-slice2a.test.js \
  tests/unit/save-to-database-identity-gate.test.js tests/unit/resolved-page-email-*.test.js \
  tests/unit/reviewer-enrich-contacts-route.test.js tests/unit/reviewer-identity-guard.test.js \
  tests/unit/reviewer-route-identity-gate.test.js tests/integration/enrich-recommended-route.test.js

# DynamicsService covering suites (baseline before/after each stage) + the five LAW gates
npx jest tests/unit/dal-enforcement.test.js tests/unit/dynamics-service-count.test.js \
  tests/unit/dynamics-service-caller-id.test.js tests/unit/adapters-caller-id.test.js \
  tests/unit/reviewer-adapters-writeback.test.js
npm run check:dataverse-access-layer && npm run check:route-service-boundary \
  && npm run check:dynamics-context-boundary && npm run check:odata-escape \
  && npm run check:trust-boundary-guid

# Full suite
npm test
```
