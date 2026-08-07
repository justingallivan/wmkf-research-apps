# Institution decision benchmark v3

This version evaluates a benchmark-only, claim-oriented institution resolver
against the hash-pinned v2 cases and canonical ROR labels. It does not modify
v1 or v2, and no production module imports this directory.

## What v3 measures

The resolver parses independent organization spans, retrieves and deduplicates
a candidate union from ROR API v2, applies non-overridable vetoes, scores the
surviving evidence, and returns `resolved`, `review`, or `unresolved` with
canonical ROR ids only when resolved. Pair cases compare the locally selected
records using pinned ROR relationships plus the product's name-compatibility
policy.

The decision contract emits only ROR ids, numeric scores, boolean/numeric
features, reason codes, veto codes, and a one-way input hash. Raw affiliation
strings and organization names are forbidden in decision output. The outer
benchmark artifact contains frozen inputs and expected labels only for the 141
in-scope institution cases. Skipped person/contact cases retain identifiers and
the skip reason only.

## Retrieval policy

`adapters-ror-api.js` is benchmark-only and server-side:

- ROR affiliation `single_search` is primary.
- Ordinary `query` with `all_status` is a bounded fallback when the primary
  result lacks reliable exact/chosen lexical evidence.
- An unmatched explicit acronym can trigger a narrow contradiction probe even
  after a strong primary result. The combined ordinary-query union is capped at
  three. One hard provider-request budget and deadline cover the entire public
  resolution, including every organization span or both comparison operands.
- Explicit predecessor/successor and office-to-parent records are hydrated by
  ROR id when needed.
- Requests have per-fetch and whole-resolution deadlines, abort-aware queue/
  pacing/backoff waits, a capped `Retry-After`, adapter-instance caching,
  same-public-resolution single-flight, and transient-only 429/5xx retries.
- Provider failure and ambiguity fail closed to review. ROR rank, score, and
  `chosen:true` remain retrieval provenance, never decision authority.

Locality aliases are decision evidence rather than query rewrites. Each is
scoped to a ROR id and carries an authoritative source in
`location-evidence.js`; the current UC San Diego/La Jolla entry points to UC San
Diego's [official address directory](https://blink.ucsd.edu/technology/help-desk/directory/address.html).

Aggregate metrics contain counts only. They never contain raw queries or
organization names. The adapter accepts an optional server-side
`ROR_CLIENT_ID` and sends it as `Client-Id`.

## Frozen result

The accepted live run is
`results/ror-claim-resolver-2026-08-07-v14.results.jsonl` (SHA-256
`9e2f031e6a5f8f72e84c74138f8e213ffb24881f6573f3ab6d7e2992b50128ed`).
The machine-readable counts and hash are persisted beside it in
`results/ror-claim-resolver-2026-08-07-v14.summary.json`; accepted summaries
also pin API and adapter versions, retrieval strategies, observation date, and
the source commit used for the run.

- 166 total cases
- 141/141 labeled institution cases passed
- 0 failed, 0 errored, 0 wrong automatic resolutions
- 25 non-institution cases intentionally skipped
- 160 candidate sets used 151 provider requests because 44 logical lookups
  were served from the benchmark process's adapter-instance cache
- 30 bounded ordinary-query lookups, 5 successor hydrations, 0 retries, and 0
  provider failures
- maximum returned union: 30 candidates

This clears the frozen falsification bar. It does **not** establish a
representative production precision/recall threshold, peak-burst capacity,
latency SLO, or deployment readiness.

## Running

Result slugs are immutable; the runner refuses overwrite.

```bash
node benchmarks/fuzzy-matching-falsification/versions/v3/run-comparator.js \
  ./adapters-ror-api ror-claim-resolver-YYYY-MM-DD

npm test -- --runInBand tests/unit/benchmarks/fuzzy-matching-v3.test.js
```

The next production slice, if separately authorized, is to move these
contracts into a request-scoped server adapter behind the existing
`legacy-default`/shadow seam, preserve aggregate PII-free telemetry, and add a
post-resolution ROR→OpenAlex identifier bridge that may validate but never
select a candidate.
