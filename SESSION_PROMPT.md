# Session 408 Prompt: Production smoke for the Dynamics lookup validator, then resume institution resolution

> **Handoff, 2026-08-08 (Session 407).** Dynamics Explorer reliability and
> feedback-retention fixes landed first, followed by a production incident
> investigation and a six-commit lookup-validator correction. The final branch
> received an independent adversarial **READY** verdict, merged to `main` as
> `c3606377`, and deployed successfully as Vercel production deployment
> `dpl_3TksP4PZ8dBrCUvscDw24nYfdg3g`. Run `/start` first.

## Session 407 Summary

### What Was Completed

1. **Dynamics Explorer reliability and retention shipped (`8873118f`).**
   - Streaming artifact queues are request-local and terminal events cancel the
     old reader, preventing a late stream from contaminating the next turn.
   - Feedback retention is 20 days after immutable first acknowledgment;
     existing stale acknowledged entries can be removed by the maintenance cron.
   - Lookup misses log `record_count = 0` only for genuine name/number not-found
     results; direct GUID lookup failures remain errors.
   - LLM fallback resolves aliases before comparing concrete models, so a
     same-model alias does not trigger a pseudo-fallback or strip thinking.

2. **The failed production Explorer request was traced to lookup spelling.**
   - Production request `tq9j6-1786197256337-e64473f8bbd5` repeatedly rejected
     the valid `_akoya_applicantid_value eq <unquoted-guid>` form, while the bare
     `akoya_applicantid` spelling passed preflight and then received a Dataverse
     400.
   - Root cause: AttributeMetadata reports the bare lookup logical name; the
     Dataverse Web API exposes its queryable value as a computed
     `_<logicalname>_value` Edm.Guid property that is not a metadata row.

3. **The lookup validator was rebuilt and adversarially hardened.**
   - Synthesizes `_value` aliases only for Lookup/Customer/Owner metadata.
   - Expands restrictions across bare and computed spellings and catches
     navigation-path reads of restricted lookups.
   - Validates Edm.Guid comparisons symmetrically, including grouped/reversed
     operands, and rejects quoted/non-GUID literals.
   - Rejects provably invalid `$expand` roots, including path-shaped roots, while
     preserving unknown plausible relationship names when unrestricted.
   - Fails every `$expand` closed while any field-level restriction exists,
     because relationship metadata is not available to apply target-table
     restrictions safely.

4. **Durable documentation was reconciled.**
   - The service catalog now states the shipped validator contract.
   - The May design document is structurally marked historical/non-canonical.
   - The generated docs catalog was refreshed.

5. **Reviewed, promoted, and deployed.**
   - Independent adversarial review returned **READY** with no actionable
     findings at exact feature head `391e5023`.
   - `main` merge commit: `c3606377`.
   - Production deployment: `dpl_3TksP4PZ8dBrCUvscDw24nYfdg3g`, Ready and
     aliased to `reviews.wmkeck.org` plus the other production domains.
   - The immediate post-deploy error scan found no request logs yet; no
     authenticated production query was executed after deployment.

### Commits

- `8873118f` — Fix Dynamics Explorer reliability and feedback retention
- `79a27d13` — Fix Dynamics Explorer lookup spelling: synthesize `_value` aliases
- `f765e4ac` — Stop the request-number guard from rejecting digit-leading GUIDs
- `ab788794` — Close lookup-validator restriction bypass and type GUID literals
- `1e7a4238` — Close the `$expand` leak and type GUID comparisons symmetrically
- `822253dd` — Judge the root of a path-shaped `$expand`
- `391e5023` — Reconcile the OData validator's current documentation
- `c3606377` — Merge Dynamics Explorer lookup validator fix

## Next Items

### Verified Open

1. **Run one authenticated, read-only production Dynamics Explorer smoke.**
   Evidence: deployment `dpl_3TksP4PZ8dBrCUvscDw24nYfdg3g` is Ready, but its
   immediate error scan had no request traffic. Use a known lookup query with
   `_akoya_applicantid_value eq <unquoted-guid>` and confirm the preflight reaches
   Dataverse without the old bare-lookup retry storm. Do not perform writes.

2. **Deliberately promote the verified ROR institution-resolution integration
   branch without changing legacy authority.**
   Evidence: branch `codex/ror-production-shadow-adapter` now contains a
   request-scoped ROR API candidate adapter, local veto-before-scoring decision
   layer, and exact-ROR OpenAlex bridge behind
   `lib/services/reviewer-identity-runtime.js` [VERIFIED 2026-08-08 via source
   and focused contract tests]. The frozen v3 benchmark remains unimported and
   benchmark-only. Production remains `legacy-default`; the branch is not
   deployed, ROR rank/`chosen:true` remain retrieval evidence only, and provider
   failure preserves legacy/review behavior. Full Jest (589 suites / 7,280
   tests), the production build, focused ESLint, TypeScript, and durable-doc
   gates are green on the branch [VERIFIED 2026-08-08]. Obtain owner approval
   before promotion.

3. **Normalizer consolidation, seam by seam.**
   Evidence: `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md`; 158 characterization
   tests were green at the last verified handoff. Start with the two
   byte-identical `normalizeName` copies, then
   `ContactParser.normalizeNameForMatch`.

4. **Token-lifecycle redesign.**
   Evidence: `outputs/plan-manage-panel-preview-retry-2026-08-06.md`. Still
   unscheduled; needs its own plan/review for per-suggestion lease/generation or
   multiple concurrently valid tokens.

5. **S399 finding 4 — silent no-op invite button.**
   Evidence: `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md:404` still says
   `OPEN — not addressed on this branch` as of this stop.

6. **Dependabot advisory 62 (`postcss`, moderate).**
   Evidence: GitHub reported one moderate default-branch vulnerability on every
   push this session. Treat separately from the completed Explorer fix.

### Owner Decision Needed

_None created by this session._

### Parked

1. **Representative 1–2k identity benchmark.** Owner-parked; high-risk
   automation remains review-only until representative evidence exists.
2. **Reviewer card redesign build.** Follows the institution scorer decision.
3. **Excluded-reviewers intake Phases A/B.** Awaiting Justin × Connor.
4. **Worktree cleanup.** Several historical agent worktrees remain; the clean
   `WMKF_Apps-dynamics-lookup-validator` worktree and its pushed feature branch
   were deliberately retained for recovery after the production merge.

### Verify Before Acting

1. **Any production Explorer smoke must remain read-only.** Verify the active
   Vercel deployment and use an authenticated staff session; do not infer success
   from deployment Ready alone.
2. **Before any identity comparator run, read the “Executing” section in
   `benchmarks/fuzzy-matching-falsification/README.md`.** The frozen cases/judge
   contract and environment-loading hazards still apply.
3. **Before normalizer changes, re-read the authoritative inventory and keep the
   characterization suite green or name every intentional caller-level change.**

### Do Not Reopen Without New Decision

1. **Claude's tiered institution-resolution design.** Superseded by the
   claim-oriented, veto-before-scoring pipeline; exact alias/ROR rank is not
   decision authority.
2. **A bundled production ROR dump/index.** Owner selected the official ROR API
   for live retrieval; compact indexes remain offline benchmark evidence.
3. **The Dynamics lookup-validator findings closed in `c3606377`.** Reopen only
   with a new production failure or a failing complement test.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/dynamics-odata-validator.js` | Current Explorer OData preflight contract |
| `pages/api/dynamics-explorer/chat.js` | Validator call seam and tool execution |
| `tests/unit/dynamics-odata-validator.test.js` | Token, lookup, GUID, restriction, and `$expand` complements |
| `tests/integration/dynamics-explorer-tool-serialization.test.js` | Handler-to-Dataverse non-call/forwarding proof |
| `docs/SERVICE_AND_UTILITY_CATALOG.md` | Canonical service summary |
| `docs/DYNAMICS_EXPLORER_ODATA_VALIDATOR_DESIGN.md` | Historical May design, not current authority |
| `outputs/institution-resolution-handoff-to-codex-2026-08-07.md` | Starting point for production ROR integration |
| `lib/services/reviewer-identity-runtime.js` | Legacy/shadow/combined production seam |
| `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` | Open silent-invite finding |

## Testing

```bash
npx jest tests/unit/dynamics-odata-validator.test.js tests/integration/dynamics-explorer-tool-serialization.test.js --runInBand
npm run check:types
npm run check:docs-catalog
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run build
npx jest
```

Session 407 final feature verification: 588 suites / 7,265 tests; exact merged
tree recheck: 101 focused tests, types, docs catalog, and production build passed.

## Stop-Flow Note

`npm run report:claim-evidence-pilot -- --current` returned “local state could
not be read,” so no current-session observation row was added.
