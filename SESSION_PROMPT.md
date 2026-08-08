# Session 409 Prompt: Fable strategic reset for ROR and reviewer finding

> **Handoff, 2026-08-08 (Session 408).** The production ROR adapter and two
> superuser diagnostics shipped successfully, but the resulting comparison did
> not measure a single coherent capability. Fable owns a read-only strategic
> reset before any more resolver work. Run `/start`, then read
> `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md` first.

## Session 408 Summary

### What Was Completed

1. **The ROR institution resolver was integrated and deployed (`444bd781`).**
   - Production carries a request-scoped ROR API candidate adapter, local
     veto-before-scoring institution decision, and exact-ROR OpenAlex bridge
     behind the existing Works-first runtime seam.
   - The frozen benchmark code is not imported by the application.
   - Production resolver authority remains `legacy-default`; ROR/Works-first is
     not authoritative.

2. **Two superuser-only comparison diagnostics shipped.**
   - `ffab03c6` added the Legacy / Works-first / Combined comparison panel.
   - `6935b299` added exact PubMed-result pass-through so PubMed and Works-first
     could be compared without another provider decision or W2 durable
     telemetry.
   - Focused tests, lint, types, API-route gates, documentation gates, and the
     production build passed. An independent adversarial review returned
     **READY**.

3. **Production deployment completed.**
   - `6935b299` was pushed to `main`.
   - Vercel deployment `dpl_8J167uKtsFi5ej5uS9pgmXTxLjKu` reached Ready.
   - The immediate post-deploy error scan found no errors.

4. **The existing diagnostic payload was recovered without another paid
   Claude search.**
   - The first page view used JavaScript loaded before the diagnostic UI
     deployment, so it rendered the new server payload as Legacy/Combined
     `Unknown`.
   - Safari React state contained the 15-row diagnostic payload: four consensus
     outcomes and 11 differences.
   - Row-level reviewer names remain in local observations and are intentionally
     absent from tracked documentation.

5. **A three-case read-only audit exposed the experiment's limitation.**
   - No Claude calls were made.
   - Two common-name people were real at their claimed institutions, but the
     bounded OpenAlex work window did not surface institution-corroborated
     bylines, so Works-first abstained.
   - A distinctive-name person was correctly ORCID-bound by Works-first while
     PubMed abstained.
   - This identified a retrieval mechanism, but not a justified patch.

6. **The owner stopped query-level patching and requested a strategic reset.**
   - PubMed reviewer relevance, Works-first person identity, and ROR institution
     normalization are separate contracts.
   - Mapping all three into `bind` / `review` / `abstain` made the 15-row
     comparison unsuitable as an ROR promotion test.
   - The current assignment is documented in
     `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md`.

### Commits

- `444bd781` — Build ROR institution shadow resolver
- `ffab03c6` — Add admin reviewer identity comparison panel
- `6935b299` — Add superuser PubMed identity diagnostics

## Next Items

### Verified Open

1. **Fable: produce a read-only strategic assessment and evaluation plan.**
   Evidence: `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md`. Separate the
   contracts for reviewer relevance, person identity, and institution
   normalization; propose reusable benchmarks from existing/historical labeled
   evidence; define go/no-go criteria; and recommend what to keep, reshape, or
   stop. Do not implement.

### Owner Decision Needed

1. **Choose the next promotion target only after reviewing Fable's assessment.**
   Justin must decide whether the next objective is institution normalization,
   person identity, reviewer relevance, or no further resolver work. That
   decision also determines whether S2AFF profiling, Works-first changes, or
   ROR promotion should continue.

### Parked

1. **All further resolver implementation and query tuning.** This includes
   OpenAlex cap changes, per-name heuristics, provider fallbacks, combined-
   outcome patches, S2AFF profiling, and production-authority changes.
2. **Normalizer consolidation and reviewer-card redesign.** These remain behind
   the matching-contract decision.
3. **Representative 1–2k identity benchmark.** The earlier broad benchmark is
   still owner-parked; Fable should first identify the smallest reusable
   evidence set that can change a decision.
4. **Token-lifecycle redesign and the S399 silent no-op invite finding.** They
   were not advanced in Session 408 and are outside Fable's assignment.
5. **Dependabot advisory 62 (`postcss`, moderate).** Treat separately.
6. **Authenticated Dynamics Explorer production smoke from Session 408's
   incoming prompt.** It was not advanced during the ROR work; keep it read-only
   and outside Fable's assignment.

### Verify Before Acting

1. **Production resolver authority.** Verify live configuration before claiming
   any mode other than `legacy-default`; deployment Ready does not change the
   configured authority.
2. **Any future comparator cohort.** Use fixed existing/historical records and
   explicit labels; do not make a fresh Claude search the benchmark generator.
3. **Contract scope.** Every proposed metric must state whether it judges
   reviewer relevance, person identity, institution normalization, current
   affiliation, or contact attribution.

### Do Not Reopen Without New Decision

1. **Promotion based on the current 15-row diagnostic.** It compares different
   contracts and is not an ROR promotion gate.
2. **Per-name or provider-specific retrieval patches.** The common-name failure
   mechanism is evidence for strategy, not authorization to tune the window.
3. **A single combined reviewer-resolution score.** PubMed, Works-first, and ROR
   do not answer the same question.
4. **A bundled production ROR dump/index.** The owner selected the official ROR
   API for live retrieval; compact indexes remain offline evidence.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md` | Fable's assignment, evidence, and boundaries |
| `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` | Four-decision research foundation |
| `outputs/institution-resolution-handoff-to-codex-2026-08-07.md` | Historical implementation and benchmark trail |
| `lib/services/reviewer-works-first.js` | Person resolution and institution corroboration |
| `lib/services/openalex-service.js` | Bounded raw-author-name work retrieval |
| `lib/services/reviewer-identity-runtime.js` | Legacy/Works-first/Combined runtime seam |
| `lib/services/ror-institution-identity-resolver.js` | Production ROR institution decision |
| `benchmarks/fuzzy-matching-falsification/` | Frozen institution falsification evidence |

## Testing

No runtime code changed in the stop commit. For durable-document changes, run:

```bash
npm run check:docs-catalog
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
git diff --check
```

Session 408 runtime verification before deployment: four focused suites / 66
tests, focused lint, TypeScript, API-route gates, durable-doc gates, and the
production webpack build passed. Vercel's production build also succeeded.

## Stop-Flow Note

`npm run report:claim-evidence-pilot -- --current` returned “local state could
not be read,” so no current-session observation row was added.

