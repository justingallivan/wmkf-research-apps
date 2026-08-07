# Fuzzy-Matching Falsification Suite (consensus §1 step 0)

Built S405 (2026-08-06) per the owner's decision: **build the falsification
suite but don't execute.** Charter:
`outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` §1 step 0;
owner answers in `outputs/fuzzy-matching-owner-answers-2026-08-06.md`.

## Status — read before touching

- **BUILT S405; INCUMBENT BASELINE FROZEN same session** (owner authorized
  execution: "use sonnet to execute the suite", 2026-08-06). The incumbent
  production predicates were run against all cases via
  `adapters-incumbent.js` — results and analysis in
  `baseline/incumbent-2026-08-06.{results.jsonl,md}`. Headline: 89 pass /
  64 fail (60 real + 4 judge naming artifacts) / 12 skipped; zero
  wrong-entity resolutions — the incumbent is "safe but blind" (blanket
  abstention). No S400 drift.
- **COMPARATOR #1 RUN S406 (2026-08-07): ROR affiliation `chosen:true`** —
  `adapters-ror.js` via `run-comparator.js`; results and analysis in
  `baseline/ror-chosen-2026-08-07.{results.jsonl,md}`. 141 institution cases
  judged (25 person/contact/affiliation cases skipped — ROR is an org registry
  only). Headline: ROR is the incumbent's **mirror image** — 15% abstention vs
  85%, ~3× the institution recall, flips 8/11 of the S400 byline false
  mismatches — but produces **64 unsafe resolutions end-to-end (44 attributable
  to the affiliation string alone)** where the incumbent produced zero, resolving
  self-contradictory strings like "University of California, Berkeley (UCLA)" at
  score 1.0. **Neither system passes the falsification bar.** ROR is disqualified
  as a sole auto-resolver; it is an **unvalidated candidate signal** for a scorer
  (nothing in the run put it inside one).
  **The report was CORRECTED 2026-08-07 after Codex adversarial review** — safety
  is now derived from result semantics rather than exact-string VETO counts (the
  original "40" missed 6 UCSD resolutions to a comma-less name), three
  relationship cases are excluded from the identity aggregate as predetermined by
  the same-ROR-id-only pair rule, and the naming-artifact set is marked
  unadjudicated pending canonical ROR ids. Read the correction note at the top of
  the report before quoting any figure.
- **Comparator #2 (S2AFF) ON THE QUEUE, NOT YET RUN** — an earlier
  "skip it" recommendation was **withdrawn** in review: S2AFF is parse →
  high-recall ROR retrieval → LightGBM rerank → margin-based abstention, i.e. the
  closest existing analogue to the scorer we intend to build, not "the same
  class" as a chosen-only endpoint. Cost: heavy old Python stack (torch,
  simpletransformers, sdist-only kenlm) + multi-GB S3 model artifacts against
  local Python 3.14 with no uv/pyenv/conda, so it needs a pinned 3.10/3.11 venv
  and its own session. Threshold calibration remains out of scope for this suite
  entirely.
- **PINNED ROR v2.11 + COMPACT-INDEX SIZE EXPERIMENT COMPLETE 2026-08-07** —
  the immutable release/checksum, deterministic builder, and results live in
  `../compact-ror-index/`. The full retrieval-only JSON is 80.4 MB plain /
  24.7 MB Brotli and remains offline-only. No production asset was built by
  that measurement; the later v2/v3 overlays use the official ROR API and keep
  the dump only as frozen label/relationship evidence.
- **COMPARATORS #3–4 COMPLETE 2026-08-07** — `versions/v2/` pins canonical ROR
  ids and a verdict-free candidate contract; `versions/v3/` adds the bounded
  API candidate union, local veto/scoring decision contract, and relationship-
  aware pair policy without changing v1/v2. The accepted v3 live run passes all
  141 institution labels with **0 failures, 0 provider errors, and 0 wrong
  automatic resolutions**. It used 151 provider requests for 160 candidate
  sets after 44 benchmark-process cache hits. This clears the frozen
  falsification bar but
  is benchmark-only, not production threshold or deployment evidence. See
  `versions/v3/results/2026-08-07-api-decision-benchmark.md`.
- `run.js` has now executed once; three harness fixes were made during that
  run (see its inline comments and the baseline report). Known sharp edge:
  target-name judging is exact-string — compare normalized names or ROR ids
  in future runs. `validate-cases.js` (schema lint) passes.
- Executions hit live keyed OpenAlex: load env with
  `set -a; . .env.local; set +a` (grep/cut extraction glues quotes onto the
  key and silently breaks every call — see the baseline report's discarded
  runs).
- Jest does not pick this directory up (`testMatch` covers only `tests/`,
  `shared/**/__tests__`, `pages/**/__tests__`; verified via
  `npx jest --listTests`). Keep it that way — no `*.test.js` names here.

## What this suite is

The 150–300-case falsification/regression asset the Claude×Codex consensus
requires before any matching build: known real failures frozen as fixtures
plus a UC-system adversarial matrix. It **selects/rejects approaches**; it is
**explicitly not sufficient for production threshold calibration** (that
needs the representative benchmark, which the owner has parked — high-risk
automation stays review-only).

## Contents and denominators

166 cases across six files (regenerate counts with `node validate-cases.js`):

| File | Cases | What it covers |
|---|---|---|
| `cases/institution-uc-matrix.jsonl` | 120 | Generated UC adversarial matrix (below) |
| `cases/institution-byline-normalization.jsonl` | 14 | The S400 probe + production capture: decorated-byline false mismatches (request 1002903), incl. the 4 false + 1 genuine production operands, + 2 positive controls the incumbent gets right |
| `cases/institution-hierarchy.jsonl` | 7 | Dana-Farber/HMS/Harvard (Shih shape), VUMC↔Vanderbilt, LBNL, UC San Diego Health, Broad, multi-org strings |
| `cases/person-identity.jsonl` | 11 | Tsai/Nakano, Noe/Clementi, Laederach forename veto, Zhou namesake bleed, Kwong re-discovery collapse + anchor-conflict veto, nickname one-to-many, diacritic class, common-name insufficiency |
| `cases/contact-attribution.jsonl` | 8 | Smirnova/Chen namesake contacts, Shih address conflict, the domain-abbreviation keep-biased hazard, verified-domain match/contradiction, evidence decay |
| `cases/affiliation-current.jsonl` | 6 | Historical-vs-current, joint appointment (Q5), stale-no-end-date, EKA contaminant, weak-source conflict, visiting role |

Origin split: 26 real (documented in repo sources, cited per-case) /
140 synthetic (policy-derived; the UC matrix and shape-from-real-case
fixtures). Every case carries `source` provenance and a `label_status`.

**UC matrix sampling (no silent caps):** the tracked file is the DEFAULT
emission — 2 siblings per campus (cyclic neighbors) for the three
substitution families. The full 9-sibling cross product is **335 cases**;
regenerate with `node generate-uc-matrix.js --full` when a run wants
exhaustive coverage. The generator is deterministic — same table, same bytes.

`ror_id` is null everywhere in this frozen revision by design. ROR v2.11 is now
pinned, but populating ids changes the benchmark contract and must happen in a
deliberately versioned revision with every prior comparator rerun; guessing ids
or editing these frozen cases in place would fabricate comparability.

## Case schema

One JSON object per line. Common fields: `id`, `decision`
(institution|person|affiliation|contact|authorship), `kind` (routes to an
adapter — see `ADAPTER_BY_KIND` in `run.js`), `family`, `origin`
(real|synthetic), `source` (provenance citation), `label_status`
(verified|assumed), `input` (decision-specific), `expected` (always has
`outcome`: resolved|review|unresolved; plus per-kind assertions —
`consistent`, `match`, `attach`, `current`, `must_not_resolve_to` as a hard
veto list), optional `documented_incumbent` (what the old code demonstrably
did, from cited docs — recorded provenance, NOT an executed baseline), and
`note`.

Labels follow the Codex Phase-0 discipline: per-decision labels, never one
collapsed "correct candidate"; abstention (`review`/`unresolved`) is a
first-class correct answer. PII discipline: no real email addresses in
tracked fixtures — structural `<placeholders>` or reserved example domains
only (`validate-cases.js` enforces this).

## Owner-adjudication list — CLEARED (owner decisions 2026-08-07)

No `assumed` labels remain (`validate-cases.js` reports none):

1. **person-005 (Yubin Zhou): settled as `review`** — correct regardless of
   the byline's biographical ground truth (a 50%-confidence match with a
   contradicting institution must reach a human either way). The
   biographical question itself stays open but gates nothing.
2. **affil-004 (EKA contaminant): quarantine-for-review is the decided
   product behavior** for provenance-less affiliations — shown labeled
   unverifiable, never silently dropped, never presented/COI-screened as
   fact; counts toward COI only in the widening direction (Q1). The
   untraced root cause remains a carried bug.

## Executing

`runSuite(adapters)` in `run.js` takes one adapter set per system under test and
refuses to run with none wired. `run.js`, `judge()`, and `cases/` are **frozen for
comparability** — every run to date has used byte-identical harness and cases, so
naming artifacts are reported per-run rather than normalized away. Changing the
judge (e.g. to ROR-id comparison) resets the comparison and requires re-running
every prior system.

```bash
node run-baseline.js                                  # frozen incumbent driver (2026-08-06)
node run-comparator.js ./adapters-ror <slug>          # any comparator; refuses to overwrite a slug
node validate-cases.js                                # schema lint
```

Done: incumbent baseline, ROR `chosen:true`, canonical-id candidate benchmark
v2, and claim-oriented decision benchmark v3. Remaining from the consensus §1
comparator list (`docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`):

1. **S2AFF** — needs a pinned Python 3.10/3.11 venv; own session. It remains a
   challenger/profile, not a dependency for the now-passing API decision
   comparator.

Production wiring remains a separate owner-gated slice behind
`legacy-default`/shadow. The v3 relationship-aware comparator is not imported
by the application.
