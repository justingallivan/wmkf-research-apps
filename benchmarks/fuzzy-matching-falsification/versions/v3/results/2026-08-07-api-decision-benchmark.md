# ROR API decision benchmark — 2026-08-07

## Verdict

The benchmark-only claim-oriented resolver clears the frozen institution
falsification suite: **141/141 pass, 0 fail, 0 errors, and 0 wrong automatic
resolutions**. The remaining 25 cases concern people, contacts, or current
affiliation and are outside this comparator's institution-only contract.

This validates the architecture against the known/frozen hazards. It does not
authorize production wiring or prove performance on a representative traffic
sample.

## Evidence

- Artifact:
  `ror-claim-resolver-2026-08-07-v8.results.jsonl`
- SHA-256:
  `9604d59dee5b8d65b19e26a5ea8a7a2fe62346b0b50e05aa390a8af60c6026bb`
- Frozen substrate: all v2 case, label, canonical-entity, runner, candidate-
  contract, and relationship hashes in `../manifest.json`
- Focused tests: 24/24 green
- Live ROR API requests: 140
- Logical affiliation candidate sets: 160
- Request-local cache hits: 61
- Ordinary-query lookups: 36
- Successor hydrations: 5
- Retries/provider failures: 0/0
- Largest deduplicated candidate union: 30

The request count is lower than the candidate-set count because repeated
institution evidence reused the adapter's bounded in-memory cache. It is not a
cycle-volume forecast: production burst rate, fallback frequency, latency, and
provider policy still require shadow measurement.

## Safety behavior exercised

- sibling-campus acronym, city, domain, and mixed-evidence contradictions;
- parent/system granularity and office-to-parent product canonicalization;
- multi-organization atomic success and partial-result abstention;
- inactive predecessor to explicit successor canonicalization;
- type and country/domain vetoes;
- acronym collision disambiguation using compatible parent-family evidence;
- pair consistency for same, related, and distinct registry identities;
- provider failure and insufficient score/margin abstention.

ROR `chosen:true`, provider score, and result order never decide the outcome.
Candidate retrieval and local decision authority remain separate contracts.

## Boundary and next step

Nothing in this version is imported by the application, persisted to a
database, or exposed through a route or UI. Production remains
`legacy-default`. A later production slice must preserve request-scoped cache,
cancellation, bounded concurrency, PII-free aggregate telemetry, and fail-
closed fallback. Only a locally resolved ROR id may be hydrated through
OpenAlex, and that bridge may not choose among ROR candidates.
