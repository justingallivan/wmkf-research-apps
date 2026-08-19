# institution-pair-consistency benchmark fixtures

Gate fixtures for the shipped Stage 1 boolean comparator documented in
`docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. These are legacy
pair-consistency evaluation cases — `left` vs `right` institution strings and
the expected Stage 1 verdict — not the
`fuzzy-matching-falsification` single-operand resolve cases, and they are a
separate, independently frozen directory from that suite.

The 2026-08-19 plan rework preserves these fixtures as historical/current-
implementation regression evidence but does not reuse their verdict vocabulary
as the Stage 2 product contract. Stage 2 separately represents organization
relationship, source/time context, and per-consumer action under conditional
neutrality. New Stage 2 cases and results use a new versioned directory/slug;
these frozen Stage 1 files are not relabeled.

One frozen note requires an explicit historical boundary:
`named-rel-vumc-vanderbilt` still says the future Stage 2
`related-autoclear` classification should lean broad. That was the 2026-08-09
outlook when the fixture was frozen and is **superseded** by the 2026-08-19
plan. The relationship must now be classified independently of consumer action;
the row remains byte-stable only so prior Stage 1 artifacts stay reproducible.

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
  148 rows:
  - 126 cross-campus rows (`uc-cross-*`): every ordered distinct pair of the
    7 UC campuses in three operand forms (full/full, acronym/full,
    decorated-full/full) — all expected `distinct`.
  - 7 same-campus identity rows (`uc-identity-*`, acronym vs full name),
    expected `same`.
  - 7 parent-system rows (`uc-parent-*`): full campus name vs the bare
    `"University of California"` system string, expected `related-surface`.
  - 8 resolvable-system-name rows (`uc-system-*`), added after a
    live-verified miss survived four review rounds: 7 rows of full campus
    name vs the OpenAlex-resolvable `"University of California System"`
    string (OpenAlex I2803209242, live-verified 2026-08-08: resolves with 15
    associated institutions), expected `related-surface`, plus 1
    system-name-vs-itself identity row, expected `same`. The bare parent
    string used by `uc-parent-*` abstains on the live resolver (no unique
    match), so a checker bug that grants system↔campus auto-clear credit
    through associated-institution links never fires against it in a live
    gate run — only a resolvable system name exercises that hazard, which is
    why this is a separate family rather than a change to `uc-parent-*`.
- `cases/named-relationship-pairs.jsonl` — 3 rows, hand-authored (not
  generated), added S409 after Codex's final review found the plan's named
  relationship regressions were never actually live-gated: the runner passes
  whatever case files it's given, and none of the tracked files before this
  one exercised these specific pairs. Live OpenAlex resolutions verified
  2026-08-09. All three rows are expected `related-surface` at Stage 1
  (nothing auto-clears), but the mechanism and the Stage-2 outlook differ per
  row:
  - `named-rel-harvard-hms` — "Harvard Medical School" vs "Harvard
    University". Live mechanism is one-sided abstention: OpenAlex has no
    separate HMS institution entity (folded into Harvard University,
    I136199984), so there's no shared identity to match on either side.
  - `named-rel-vumc-vanderbilt` — "Vanderbilt University Medical Center" vs
    "Vanderbilt University". Distinct OpenAlex identities (I901861585 vs
    I200719446). It surfaces under the frozen Stage 1 boolean contract. The
    reworked Stage 2 contract will classify the typed relationship first and
    apply consumer policy separately; this fixture does not prescribe that
    future action.
  - `named-rel-danafarber-harvard` — "Dana-Farber Cancer Institute" vs
    "Harvard University". Distinct identities and expected to surface under
    the frozen Stage 1 contract. Future consumer action depends on the typed
    relationship plus source/time context.

The runner's `REQUIRED_CASE_FILES` (`run-pair-gates.js`) now names all three
tracked case files above by basename and fails fast — before any live
provider call — if a run's loaded case set is missing one of them or a
required file contributed zero rows, closing the "runner passes whatever
it's given" gap this family exists to fix.

## Row schema

Each JSONL row is one frozen Stage 1 pair-consistency case:

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

## Live replay CLI (`run-pair-gates.js`) and the `results/` artifacts

`run-pair-gates.js` replays these case files through the real
`createInstitutionConsistencyChecker()` (incumbent vs. staged
`segmentComparison`) and the real `createInstitutionIdentityResolver()`, and
writes a frozen artifact to `results/<slug>.json` for every run (never
edited or deleted after the fact — see the header comment in
`run-pair-gates.js` for the full contract and gate vocabulary).

**One shared resolver instance serves both checker configurations (incumbent
and staged) AND both fixture families for the whole run.** Its `metrics`
counters (cache hits, provider searches/hydrations, provider failures, etc.)
are cumulative over every row in the run, not scoped per-family or per-
checker — there is no way to attribute a given provider failure to one
fixture family from the artifact alone.

### `GATE: PASS` semantics (Wave 3 on)

As of Wave 3, `ok`/`GATE: PASS` in an artifact means **both**:

1. every case's staged verdict matched its `expected` gate rule (no
   forbidden verdict, no skip, no row-level error), **and**
2. the shared resolver's cumulative `metrics.providerFailures` is exactly
   zero for the whole run.

Before Wave 3, only (1) was checked, and the resolver defaulted to
`propagateProviderErrors: false` — a provider exception silently degraded to
a null resolution, which made every `distinct`/`related-surface` row pass
*vacuously* (the checker abstained to `false`, which happens to satisfy
those rows' gate rule) instead of surfacing the failure as an error. That
was Codex adversarial-review finding F2 against the live gate runner: a
probe with an always-throwing provider produced `ok=true`. The fix
(`7a1b6234`'s follow-up commit) sets `propagateProviderErrors: true` on the
shared resolver, so a provider exception now throws through
`checker.areConsistent` into the runner's existing per-row error handling
(row `status: 'error'`, gate fail) — and, as defense-in-depth, condition (2)
above fails the run even in the hypothetical case where every row's verdict
still happened to be correct despite a recorded provider failure elsewhere
in the run (e.g. a failure on one query that a different, unrelated query
later resolved successfully — the counter is monotonic and never reset
mid-run).

### Historical artifacts: `stage1-wave2-2026-08-08.json`, `stage1-wave2b-2026-08-08.json`

These two artifacts (`ok: false`, from before the F2 fix) are **historical,
non-revision-reproducible observations**, not a regression suite:
`run-pair-gates.js` itself, the failures they captured, and the fix all
landed in a single commit (`7a1b6234`). There is no earlier commit at which
the pre-fix runner and case fixtures can be replayed to reproduce them —
replaying today's runner against today's fixtures no longer exercises the
code path that produced them, and neither artifact carries a provenance
block (added in Wave 3; see below) to pin exactly what was replayed.

The durable falsification record going forward is
`tests/unit/benchmarks/run-pair-gates-offline.test.js`'s
`propagateProviderErrors` describe block, which encodes the same fail-open
scenario (a throwing OpenAlex-shaped stub adapter, real resolver, real
checker) as a deterministic, pinned jest regression. That is **stronger**
evidence than replaying an old commit: the scenario is pinned exactly
(no live-provider flakiness, no dependency on OpenAlex's current data), runs
offline in CI on every change, and directly asserts both the row-level error
propagation and the resolver-metrics gate rather than relying on a one-time
live capture.

`stage1-wave2c-2026-08-08.json` (`ok: true`, 145/145) remains the frozen
record of the last live run under the pre-Wave-3 runner and is unaffected by
this reclassification.

### Provenance block (Wave 3 on)

Every artifact from Wave 3 onward carries a `provenance` block: git HEAD
sha, working-tree dirty boolean, sha256 of `run-pair-gates.js` itself, sha256
of every case file consumed, the node version, and `openAlexApiKeyPresent` —
a boolean recording only whether `OPENALEX_API_KEY` was set after
`.env.local` was loaded, never the key value or any other env value. This is
what makes a future artifact revision-reproducible (Codex finding F4); the
three artifacts above predate it and are not.
