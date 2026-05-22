---
name: decision-module-typeless-warning-accept
description: "Decision (S164, 2026-05-18, Codex-reviewed): the Node MODULE_TYPELESS_PACKAGE_JSON reparse warning is ACCEPTED (Option E), not fixed by mass .js→.mjs rename (Option D). Do not re-litigate."
metadata: 
  node_type: memory
  type: project
  originSessionId: 5782a015-a329-4b5a-8ea7-6a44489bae62
---

**Decision:** the `MODULE_TYPELESS_PACKAGE_JSON` reparse warning emitted by ESM `scripts/*.js` files is **ACCEPTED as-is (Option E)**. Root cause: root `package.json` has no `"type"`, so Node tries CJS first, fails, reparses as ESM (cosmetic, one-time per-process, zero runtime impact). 37 of 174 `scripts/*.js` are ESM and emit it; 136 are CJS (silent).

**Why D (rename the 37 `.js`→`.mjs`) was rejected** — Codex S164 review surfaced two concrete costs that outweigh a cosmetic warning:
1. The Atlas P0 gate (`scripts/check-application-state-atlas.js`) scanned `.js` only — a `.mjs` rename would have silently dropped entity-coverage detection. **This blind spot was independently FIXED S164** (CLAUDE_COVERAGE_LESSONS.md pattern E + `check:atlas:self-test` `.mjs` fixture + gate widened to `.js|.mjs|.cjs`, committed together per the coverage-lessons protocol). The fix stands regardless of the warning decision.
2. `scripts/acceptance-w4.js` spawns ESM scripts by filename (`reconcile-reviewer-migration.js`, `backfill-reviewer-suggestions-to-dataverse.js`, `backfill-request-person-junction.js`); a blind bulk rename breaks W4 acceptance. Broad churn for zero functional gain.

**How to apply:** if a future session proposes "fix the MODULE_TYPELESS warning," the answer is **E (accept)** — or, only if genuinely warranted, **F (gradual CJS conversion of a high-use script when it's already being edited**: `require()` + async `main()`, keeps the `.js` path, no Atlas-scanner interaction). **Never do a broad Option D rename.** Do not re-investigate from scratch — this was Codex-reviewed S164. Related: [[reviewer-identity-fragmentation]] (same S164 arc); the gate fix is recorded as pattern E in `docs/CLAUDE_COVERAGE_LESSONS.md`.
