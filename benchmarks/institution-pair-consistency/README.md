# institution-pair-consistency benchmark fixtures

Gate fixtures for `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`
(Wave 1A of Stage 1). These are pair-consistency evaluation cases — `left`
vs `right` institution strings and the expected verdict — not the
`fuzzy-matching-falsification` single-operand resolve cases, and they are a
separate, independently frozen directory from that suite.

## Contents

- `cases/request-1002903-pairs.jsonl` — 5 rows, hand-transcribed and
  sanitized from a real production capture (request 1002903, S400,
  2026-08-04). Institution strings only; no reviewer/person names. Rows 1–4
  are decorated-byline "same" cases the Stage 1 institution-core extraction
  targets; row 5 is the one pair from that batch that should stay flagged
  for human review, not auto-cleared.
- `generate-sibling-pairs.js` — deterministic generator for the UC
  sibling-campus pair matrix (safety invariant 1: sibling campuses never
  auto-clear). No `Date.now()`/`Math.random()`; running it regenerates its
  output byte-identically every time.
- `cases/uc-sibling-pairs.jsonl` — generated output of the script above.
  140 rows: every ordered distinct pair of the 7 UC campuses in three
  operand forms (full/full, acronym/full, decorated-full/full) — all
  expected `distinct` — plus one same-campus identity pair (acronym vs full
  name) expected `same`, and one full-campus-vs-"University of California"
  system pair expected `related-surface` for each of the 7 campuses.

## Row schema

Each JSONL row is one pair-consistency case:

```json
{
  "caseId": "stable, human-legible id",
  "source": "provenance string — capture reference or generator name",
  "left": "institution string, evidence side",
  "right": "institution string, listed/comparison side",
  "expected": "same | distinct | related-surface",
  "notes": "why this pair is labeled the way it is"
}
```

`request-1002903-pairs.jsonl` only ever uses `same`/`distinct` (its five
real pairs don't include a relationship case).
`uc-sibling-pairs.jsonl` also uses `related-surface` for the parent-system
rows, per the plan's decision 2: parent/system evidence must be surfaced,
never auto-cleared.

## Frozen semantics

These files are **append-only**: once checked in, existing rows and
`caseId`s are not edited, renumbered, or reordered, and the generator's
campus table, operand forms, and iteration order are not changed in a way
that would shift already-emitted `caseId`s. New case families or additional
coverage are added as **new files**, never by mutating these.

This mirrors the frozen-artifact convention used by
`benchmarks/fuzzy-matching-falsification/` (`run.js`, `cases/`, `baseline/`,
`versions/`) — that suite is untouched by this directory; the two are
siblings, not layers of one another.

## Regeneration test

`tests/unit/benchmarks/institution-pair-consistency-fixtures.test.js` is the
red gate:

- asserts `generate-sibling-pairs.js`'s exported `buildJsonl()` reproduces
  `cases/uc-sibling-pairs.jsonl` byte-identically;
- asserts `cases/request-1002903-pairs.jsonl` parses as JSONL, has exactly 5
  rows, uses only `same`/`distinct`, and carries no person-name fields;
- asserts every generated sibling-pair row's `expected` is one of
  `same`/`distinct`/`related-surface`, and that every cross-campus pair is
  `distinct`.

Run it directly (this directory is not itself test-discoverable — `jest`'s
`testMatch` only looks under `tests/`, `shared/`, and `pages/`):

```
npx jest tests/unit/benchmarks/institution-pair-consistency-fixtures.test.js --runTestsByPath
```
