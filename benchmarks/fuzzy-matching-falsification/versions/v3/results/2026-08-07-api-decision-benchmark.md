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
  `ror-claim-resolver-2026-08-07-v11.results.jsonl`
- SHA-256:
  `9f7acc4ead71adaaddde8b32089a0b5a5000bcfdc48bb8c103b0bb8442e757df`
- Machine-readable summary:
  `ror-claim-resolver-2026-08-07-v11.summary.json`
- Frozen substrate: all v2 case, label, canonical-entity, runner, candidate-
  contract, and relationship hashes in `../manifest.json`
- Focused tests: 33/33 green
- Live ROR API requests: 151
- Logical affiliation candidate sets: 160
- Benchmark-process adapter cache hits: 44
- Ordinary-query lookups: 30
- Successor hydrations: 5
- Retries/provider failures: 0/0
- Largest deduplicated candidate union: 30

The request count is lower than the candidate-set count because repeated
institution evidence reused the benchmark process's bounded in-memory cache.
That reuse is not evidence for a production request-scoped hit rate. It is not a
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
- exact-request cache separation, bounded fallback/request budgets, whole-run
  deadlines, and queued/backoff cancellation.

ROR `chosen:true`, provider score, and result order never decide the outcome.
Candidate retrieval and local decision authority remain separate contracts.

## Boundary and next step

Nothing in this version is imported by the application, persisted to a
database, or exposed through a route or UI. Production remains
`legacy-default`. A later production slice must preserve request-scoped cache,
cancellation, bounded concurrency, PII-free aggregate telemetry, and fail-
closed fallback. Only a locally resolved ROR id may be hydrated through
OpenAlex, and that bridge may not choose among ROR candidates.
