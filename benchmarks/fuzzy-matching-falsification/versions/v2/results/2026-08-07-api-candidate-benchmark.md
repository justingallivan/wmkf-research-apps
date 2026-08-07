# ROR API candidate benchmark — 2026-08-07

## Verdict

The ROR API is a materially stronger candidate source than the incumbent's
single-winner OpenAlex resolver, but this run does **not** authorize either one
as final decision authority. It validates the API direction and the need for a
separate local veto/scoring layer.

## Frozen inputs and claim

- v1's 166 cases, runner, and judge stayed byte-identical; `manifest.json` pins
  all seven base files by SHA-256, and the focused Jest suite enforces those
  hashes in CI.
- v2 overlays canonical ROR IDs on the same 141 institution cases using 29
  selected records from checksum-pinned ROR v2.11 (`2026-08-03`).
- Resolve cases judge candidate recall by ROR ID. Pair cases additionally judge
  registry relationship evidence. The 25 non-institution cases are skipped.
- Candidate adapters cannot return a selected target, final outcome,
  consistency decision, or verdict. ROR rank, score, and `chosen:true` are
  recorded as provider provenance only.

This is therefore not comparable to v1's final-outcome pass count. It is a new,
deliberately narrower candidate-retrieval claim.

## Results

| System | Institution pass | Resolve recall | Pair + relationship | Errors |
|---|---:|---:|---:|---:|
| ROR API v2 affiliation `single_search` | 128/141 (90.8%) | 116/124 (93.5%) | 12/17 (70.6%) | 0 |
| Incumbent OpenAlex single-winner bridge | 84/141 (59.6%) | 82/124 (66.1%) | 2/17 (11.8%) | 0 |

The ROR run made 127 actual HTTP attempts after exact-query reuse and needed no
retries. The full immutable artifacts are
`ror-api-single-search-2026-08-07.results.jsonl` and
`incumbent-2026-08-07.results.jsonl`. Their SHA-256 hashes are respectively
`a0c931493848aab7f38bcf10612a4b2461a03313d29064d67a11e6dd1b24d2be`
and `508c3f32a5b7d638669a6211f71e196f52d933fd0c645583357d2785e9833455`.

## What failed

ROR's 13 misses are concentrated and useful:

- seven bare UC campus acronyms: UCLA, UCSD, UCSF, UCI, UCSB, UCSC, and UCR;
- three Texas A&M listed-name operands and one NC State evidence operand;
- the Harvard Medical School successor-history operand; and
- one multi-organization string, where Dana-Farber was retrieved but the
  active Harvard successor for Harvard Medical School was not.

These are the planned ordinary-query fallback, successor lookup, and
organization-span parsing problems. They are not a reason to put the local ROR
dump in the app.

## The safety result

In 71 of 124 resolve cases, the ROR candidate set contained at least one ROR ID
that the case explicitly forbids as the final resolution. This is not a
candidate-recall failure: sibling, parent, and similarly named organizations
belong in a high-recall set. It is direct evidence that candidate presence,
search rank, confidence score, exact alias, and `chosen:true` cannot be final
authority.

The pair labels also keep registry relationship separate from WMKF policy. ROR
describes Dana-Farber↔Harvard and VUMC↔Vanderbilt as `related`; the product
requires review for the former but accepts the latter as COI-consistent. The
retrieval adapter never sees those product labels.

## API operating check

The current official ROR documentation says the affiliation endpoint switched
to single search by default on 2026-05-26; the adapter still requests it
explicitly for reproducibility. ROR currently documents 2,000 requests per five
minutes. Its client-ID page says registration is temporarily paused and no
client-ID-based rate distinction is currently enforced, while still describing
a future lower unidentified limit. The adapter already supports a server-side
`Client-Id` header and counts primary attempts plus retries separately. Recheck
this policy immediately before any rollout.

- [ROR affiliation parameter](https://ror.readme.io/docs/api-affiliation)
- [ROR REST API and rate limits](https://ror.readme.io/docs/rest-api)
- [ROR client ID status](https://ror.readme.io/docs/client-id)

## Next build gate

Build the next comparator behind the same non-authoritative contract:

1. Parse organization spans so multi-organization text becomes multiple
   candidate queries instead of one opaque string.
2. Add a controlled ordinary-query fallback for parser-identified structured
   names/acronyms; record every fallback and retry in capacity metrics.
3. Apply non-overridable local vetoes for sibling, domain, country, type,
   multi-org, and granularity contradictions before scoring.
4. Benchmark final `resolved` / `review` / `unresolved` behavior by canonical
   ROR ID. Only then build a production request-scoped adapter behind the
   existing legacy default/shadow boundary.

No production caller, storage schema, environment setting, or deployment was
changed by this benchmark.
