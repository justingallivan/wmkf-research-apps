# Session 359 Prompt: adversarial review of the reviewer holistic redesign

## Session 358 Summary

Session 358 converted the reviewer holistic review into an owner-approved hybrid
incremental plan, then implemented the evaluation foundation and the first
fail-closed containment/binding slices. Runtime changes were promoted one
invariant at a time; additive identity-binding work remains legacy-default and
the final writer has no production caller.

### What Was Completed

1. **Plan reconciliation and hybrid delivery model**
   - Reworked `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` around
     containment-first execution, independently labeled evaluation, server-owned
     cohort activation, and post-observation cleanup.
   - Recorded the active direction in
     `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.

2. **B0 evaluation foundation**
   - Added the tracked evaluation manifest and structural/frozen-state validator.
   - The manifest remains intentionally non-runnable until the post-containment
     baseline and owner-supplied evaluation inputs are frozen.

3. **C0.1 candidate-save containment — promoted**
   - Added per-row validation, stable save/error keys, server-signed automated
     identity receipts, request-scoped staff confirmation, partial-success
     honesty, same-name protection, and generation-scoped client updates.
   - Promoted at `c5b0593a`; promotion record at `f47f923c`.

4. **C0.2 attestation-origin enforcement — promoted**
   - Made identity origin server-only at the adapter boundary, restricted durable
     `confirmed` writes to self-report, downgraded automated `confirmed`, and
     preserved sticky/fail-closed reads across direct callers.
   - Promoted at `e5ed38db`; promotion record at `199e1e1a`.

5. **Wave 13 identity-binding foundation**
   - Added two additive Dataverse solution artifacts, exact/divergent preflight,
     schema/Atlas contracts, pure identity-binding and institution-COI contracts,
     and focused negative tests.
   - The owner-approved production-only schema apply was recorded at `91b98232`:
     10 fields verified exact and all values initially null. Deployment does not
     make the fields authoritative.

6. **Inert atomic identity-binding writer**
   - Added a complete ETag-protected read/PATCH seam, explicit-null bundle writes,
     typed-412 reread/recompute, source precedence, monotonic event ordering,
     pair-atomic anchors/lineage, manual-lineage protection, and fail-closed legacy
     handling.
   - Commit `75d26a22` is on
     `codex/reviewer-holistic-i1-binding-writer`. No production caller imports the
     writer; suggestion COI fields remain unused by application readers/writers.
   - Final verification passed 482/482 suites, 5,478/5,478 tests, typecheck,
     ESLint, production build, DAL/route boundaries, documentation gates, and
     contract reconciliation.

### Commits

- `3d764121` — add holistic evaluation manifest gate
- `d57af618` — validate partial candidate saves
- `c5b0593a` — complete candidate save containment
- `f47f923c` — record C0.1 promotion
- `e5ed38db` — enforce identity attestation origin
- `199e1e1a` — record C0.2 promotion
- `319321df` — add identity binding schema wave
- `3bd1b857` — define identity binding contracts
- `91b98232` — record Wave 13 schema deployment
- `75d26a22` — add inert identity binding writer

## Next Items

### Verified Open

1. **Perform the requested read-only adversarial review.**
   Evidence: `docs/REVIEWER_HOLISTIC_REDESIGN_ADVERSARIAL_REVIEW_PROMPT.md` and
   commit range `43220961..75d26a22`.
   Follow that prompt literally. Review the full redesign and implementation,
   invoke `/contract-reconcile`, and write only
   `outputs/reviewer-holistic-redesign-adversarial-review-2026-07-13.md`.

2. **Merge/promotion decision for the inert writer branch.**
   Evidence: branch `codex/reviewer-holistic-i1-binding-writer`, head
   `75d26a22`.
   This is an owner decision after the adversarial review. Do not merge during
   the review session.

3. **Operational carryovers outside the requested review.**
   - Interlock observation before the deliberate `warn` → `on` flip remains
     open. Evidence: `CLAUDE.md` and
     `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` §5 Stage 3.
   - Confirm the first clean Daily Maintenance run after `bd5df78e`; this needs
     email or cron-log evidence, not another code change.
   - Live spot-check the already-tested `label_conflict` publish guidance.
     Evidence: `tests/unit/policies-section-label-guidance.test.js`.
   These are not part of the Session 359 adversarial review and should not be
   mixed into its artifact.

### Owner Decision Needed

1. **First production caller and legacy transition strategy.**
   Evidence: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` I1/I2 and
   `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.
   Dirty legacy rows intentionally fail closed; revocation, durable automated
   refresh ordering over human bindings, and conservative legacy classification
   remain unresolved gates. No caller migration is authorized by the schema or
   inert writer commits.

2. **Reviewer-institution → CRM linking brief.**
   The Connor/Sarah handoff remains an owner coordination item; do not infer an
   implementation request from the reviewer identity work.

3. **Address-based reviewer onboarding scope.**
   Evidence: `.claude-memory/project-honorarium-payment-landscape.md` and
   `.claude-memory/project-reviewer-address-collection-provisional.md`.
   Address and phone remain required; any additional repository flow awaits an
   owner-defined scope.

### Parked

1. **Runtime reader/writer migration, suggestion COI currency, and action-policy
   activation.**
   Evidence: implementation plan I2 and the no-production-caller census recorded
   with `75d26a22`.
   Re-open only after review findings are resolved and the relevant owner gate is
   explicit.

2. **Track-B/heuristic cleanup.**
   Evidence: implementation plan D1.
   Cleanup waits for frozen evaluation, controlled pilot promotion, and one full
   campaign of observation.

### Verify Before Acting

1. Re-run the production-caller census before claiming the writer or Wave 13
   suggestion fields are still inert; branch state may change after Session 358.
2. Re-probe live Wave 13 metadata/value state before any backfill or caller
   activation. Never infer legacy provenance from `wmkf_identitystatus`.
3. Re-read the adversarial output and verify every finding against the then-current
   tree before implementing a fix.

### Do Not Reopen Without New Decision

1. Do not activate runtime behavior merely because Wave 13 schema is deployed.
2. Do not infer self-report or staff attestation from legacy `confirmed` rows.
3. Do not delete Track B or old readers/writers before the plan's evaluation,
   pilot, promotion, and observation gates.
4. Do not change the established “surface, do not gate” COI policy as part of
   identity-binding work.
5. BILL API integration remains tabled by owner decision; do not extend or
   re-enable it without a new decision.
6. Wave-1 temporary elevations remain intentionally retained; do not carry a
   revert forward as an open task.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_HOLISTIC_REDESIGN_ADVERSARIAL_REVIEW_PROMPT.md` | Exact read-only Claude review brief |
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Active hybrid plan and phase gates |
| `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md` | Durable active direction and safety boundaries |
| `lib/services/reviewer-finder/save-candidates-service.js` | C0.1 per-row containment and trusted decision reconstruction |
| `lib/dataverse/adapters/researcher.js` | Transitional C0.2 enforcement and narrow atomic binding adapter |
| `lib/services/reviewer-identity-binding-contract.js` | Pure binding tuple/lineage contract |
| `lib/services/reviewer-identity-binding-writer.js` | Inert ETag-protected transition planner/writer |
| `lib/services/institution-coi-context.js` | Pure proposal institution-context currency contract |
| `scripts/preflight-reviewer-identity-binding-fields.mjs` | Wave 13 ABSENT/EXACT/DIVERGENT preflight |

## Testing

The next session is a review, not an implementation session. Run focused tests or
gates only to test a concrete hypothesis. Useful anchors include:

```bash
npx jest tests/unit/reviewer-identity-binding-contract.test.js \
  tests/unit/reviewer-identity-binding-adapter.test.js \
  tests/unit/reviewer-identity-binding-writer.test.js

npx jest tests/unit/save-candidates-service.test.js \
  tests/integration/save-candidates-route.test.js \
  tests/unit/reviewer-search-section-save-stale.test.js
```
