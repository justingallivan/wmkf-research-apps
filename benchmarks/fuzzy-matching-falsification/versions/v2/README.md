# Institution candidate benchmark v2

This is a deliberately versioned overlay on the frozen 166-case v1 suite. It
does not edit v1 `run.js`, `judge()`, cases, or result artifacts. The manifest
pins those files byte-for-byte.

## What v2 measures

The 141 institution cases gain canonical expected ROR IDs from the checksum-
pinned ROR v2.11 dump. Resolve cases measure candidate recall. Pair cases
measure candidate recall on both operands and whether returned ROR records
expose the expected `same`, `parent`, `child`, `related`, `successor`,
`predecessor`, or `distinct` relationship. Directional values describe the
right-hand institution relative to the left-hand institution.

The remaining 25 person/contact/affiliation cases are skipped because this
version only evaluates institution candidate generation.

This version does **not** measure final institution resolution accuracy. The
candidate contract forbids verdict fields. ROR `chosen:true`, matching score,
and rank are retained only as provider provenance. A forbidden sibling or
parent may legitimately appear in a high-recall candidate set; v2 records that
presence, while the planned local veto/scoring benchmark must decide whether it
can become authoritative.

Product-policy consistency is also separate from registry relationship. For
example, ROR marks both Dana-Farber↔Harvard and VUMC↔Vanderbilt as `related`,
while the frozen product cases require review for the first pair and treat the
second as COI-consistent. The adapter never receives those expected outcomes.

## Offline label source

`canonical-entities.json` contains only the 29 ROR records referenced by the
cases. It was generated from the ignored 290.7 MiB pinned dump; it is benchmark
evidence, not a production asset. Rebuild only after reproducing the compact-
index experiment:

```bash
node benchmarks/fuzzy-matching-falsification/versions/v2/generate-labels.js
node benchmarks/fuzzy-matching-falsification/versions/v2/validate-cases.js
```

## Candidate contract

An adapter exports `institutionCandidates(input)`. The versioned input allows
only `affiliation_string`, optional ISO-2 `country_code`, optional
`domain_evidence`, and an `AbortSignal`; person names, email/contact fields,
proposal text, and candidate keys are rejected at the boundary. It returns
`institution-candidate-set/v1`: a deduplicated set of ROR records with typed
names, domains, locations, organization types, relationships, and retrieval
provenance. Deduplication retains every retrieval source for the same ROR ID so
the planned affiliation+ordinary-query union does not erase how a candidate
entered the set. It returns no selected target, resolved/review outcome, consistency
decision, or other local verdict. The output intentionally omits the raw query
so future aggregate telemetry cannot accidentally copy affiliation text.

`adapters-ror-api.js` is benchmark-only. It calls ROR API v2's affiliation
endpoint with `single_search` explicitly and returns every item. It supports an
optional server-side `ROR_CLIENT_ID` header, paces below the documented public
limit, retries 429/5xx responses, and treats exhausted provider failures as
errors rather than empty candidate sets. It does not yet implement ordinary
query fallback, span parsing, vetoes, or scoring; those belong to the next
versioned comparator.

`adapters-incumbent.js` bridges the current single-winner OpenAlex resolver into
the same contract so v2 can rerun the prior system without pretending that it
already supplies a candidate union.

## Running comparators

Result files are immutable and the driver refuses overwrite. Live runs require
network access; the incumbent also requires a valid `OPENALEX_API_KEY` loaded
using the parent suite's documented environment procedure.

```bash
node benchmarks/fuzzy-matching-falsification/versions/v2/run-comparator.js \
  ./adapters-ror-api ror-api-single-search-YYYY-MM-DD

node benchmarks/fuzzy-matching-falsification/versions/v2/run-comparator.js \
  ./adapters-incumbent incumbent-YYYY-MM-DD
```

Do not compare v2 pass counts directly with v1: their claims differ. v1 judges
final outcomes and exact names; v2 judges candidate recall and registry
relationship evidence by canonical ID.
