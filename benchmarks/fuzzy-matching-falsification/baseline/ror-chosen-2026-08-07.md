# Comparator #1 — ROR affiliation `chosen:true` (2026-08-07, S406)

Second authorized execution of the falsification suite (owner: comparator runs,
2026-08-07), against the **ROR affiliation-matching API taking only `chosen:true`**
via `adapters-ror.js`. Raw per-case results:
`ror-chosen-2026-08-07.results.jsonl`.

Frozen incumbent baseline for comparison: `incumbent-2026-08-06.md`.

## Environment (matters — live provider)

- Live ROR `GET /v2/organizations?affiliation=<string>`, **public and unkeyed**
  (no credential exists for this API). Node v26. Point-in-time snapshot of ROR
  registry + matcher behavior on **2026-08-07**; re-runs may drift as ROR
  updates records.
- ROR documents "a maximum of 2000 requests in a 5-minute period per IP address"
  (`ror.readme.io/v2/docs/rest-api`, read 2026-08-07) = 6.67 rps. This run paced
  at 250ms (4 rps, ~60% of ceiling) with an in-run cache for repeated strings and
  429/5xx exponential backoff honoring `Retry-After`. **0 errors, 40s elapsed**
  (retry attempts are not instrumented; zero errors means no case exhausted its
  retries, not that no retry occurred).
- `run.js`, `judge()`, and every file under `cases/` are **byte-identical** to the
  2026-08-06 baseline run — including the exact-string target-name comparison.
  Naming artifacts are separated in this report rather than normalized in the
  harness; changing the judge would break comparability with the frozen baseline.
- **`chosen:true`-only is ROR's own recommended usage, not a weakened
  strawman.** ROR: "we do not recommend using the confidence score to select
  matches; use the `chosen:true` indicator instead" and "don't automatically
  select the first result in the list" (`ror.readme.io/v2/docs/api-affiliation`,
  read 2026-08-07). At most one item per query is chosen; when none is, ROR's
  documented advice is human review — which maps exactly onto this suite's
  treatment of abstention as a first-class correct answer.

## Headline

ROR is an **organization registry only** — no person, contact, or dated-affiliation
semantics — so those adapters are deliberately absent and their 25 cases are
skipped. The judged denominator is the **141 institution cases**.

| | ROR chosen:true | incumbent |
|---|---|---|
| institution cases judged | 141 | 141 |
| pass (as judged) | **46** | **84** |
| pass (naming-artifact corrected) | **53** | **88** |
| fail (as judged) | **95** | **57** |
| error | 0 | 0 |
| skipped (person/contact/affiliation) | 25 | 12 |
| **`must_not_resolve_to` vetoes fired** | **58 raw / 40 attributable** | **0** |
| abstained on a resolve case (124 total) | **19 (15%)** | **106 (85%)** |

> The incumbent's 84/57 here differs from its published 89/64 headline because
> that headline includes the 9 person + 4 contact cases the incumbent could run
> and ROR cannot. 84/57 is the like-for-like institution-only restatement of the
> same frozen results file — not a re-run and not a correction.

## The one-line profile

**The incumbent's mirror image.** Where the incumbent was "safe but blind"
(85% abstention, zero wrong entities), ROR `chosen:true` is **confident and
occasionally wrong**: it abstains on only 15% of resolve cases and resolves
nearly 3× as many true positives — but it fires 40 attributable wrong-entity
vetoes where the incumbent fired none.

**Neither system passes the falsification bar.** Bar item 1 demands recall AND
zero vetoes; the incumbent fails the recall half, ROR fails the safety half. The
raw pass counts invert the real story and should not be read as a ranking: the
incumbent's higher score is largely earned by abstaining on contradiction cases,
which the baseline already warned "abstaining on everything trivially aces."

## Vetoes — the number this run turns on

58 raw, of which **40 are attributable to ROR** and 18 are not:

| family | vetoes | attributable? |
|---|---|---|
| uc-sibling-acronym | 18 | **yes** — contradiction is in the string ROR saw |
| uc-sibling-city | 18 | **yes** — contradiction is in the string ROR saw |
| uc-parent-mixed | 4 | **yes** |
| uc-sibling-domain | 18 | **no** — see below |

The attributable failures are unambiguous. Given
`"University of California, Berkeley (UCLA)"` — a campus name carrying a
sibling's acronym, which the case labels "contradictory; never auto-resolve
either sibling" — ROR returns Berkeley with `score: 1.0` and `chosen: true`. Same
for `"Department of Physics, UC Berkeley, Los Angeles, California, USA"` (campus
name + sibling's city). **ROR's matcher keys on the strongest name signal and
does not detect that the string contradicts itself.** For a system whose output
would drive automated COI screening, that is disqualifying as a sole
auto-resolver — exactly the failure mode this suite exists to surface before a
build, and the reason the owner's Q1 answer requires ambiguity to *widen* checks.

**The 18 `uc-sibling-domain` vetoes are not attributable to either system, and
the incumbent's 20/20 "pass" on that family is equally an artifact.** The
contradiction in those cases lives entirely in `domain_evidence` (`"UC Berkeley"`
+ `domain_evidence: "ucla.edu"`). ROR's affiliation endpoint accepts only a
string and has no parameter for out-of-band evidence, so the adapter discards it
— ROR is shown a clean `"UC Berkeley"` it *should* resolve, and is vetoed for
doing so. The incumbent resolver discarded the same field (its `resolve()` has no
such parameter either) and "passed" only by blanket abstention. **As run, this
family discriminates neither system**; it measures that no affiliation-string API
consumes out-of-band domain evidence. Any real scorer must accept that evidence
as an input — a requirement, not a score.

## Against the four "what a successor must beat" items

**1. Resolve ≥ 11 positives + the 36 abstained variants, zero vetoes — FAILED
(both halves move in opposite directions).**
uc-positive: ROR **27/47 as judged, 30/47 artifact-corrected** vs the incumbent's
11/47. ROR gained 18 cases the incumbent abstained on — short forms
("UC Berkeley"), punctuation variants, and decorated bylines all resolve. It
**lost exactly 2**: `UCSB` and `UCR`, the two bare acronyms the incumbent
curiously did resolve — ROR returns `number_of_results: 0` for a bare campus
acronym. The recall half is a clear win; the zero-veto half is a clear loss (40).

**2. Flip the 11 byline false mismatches, keep inst-byline-012 flagged — PARTIAL,
8 of 11.** ROR flips 8 (001, 002, 004, 007, 008, 009, 010, 011) and **correctly
keeps 012** (the one genuine Texas A&M/Northwestern mismatch) flagged. This is
real movement on the live request-1002903 defect that the incumbent fails 11/11.
- The 3 not flipped are **short-form recall misses, not consistency errors**:
  ROR cannot resolve `"Texas A&M"` (005, 006) or `"NC State University"` (003),
  so one side of the pair abstains.
- 013/014 **regress** relative to the incumbent (both were incumbent passes).
  These are *not* ROR matching failures: both sides resolve correctly to
  genuinely different ROR records (VUMC `05dq2gs74` vs Vanderbilt `02vm5rt34`;
  Columbia `00hj8s172` vs CUIMC `01esghr10`). This is the **predicted
  consequence** of the same-ROR-id-only pair rule, documented in advance in
  `adapters-ror.js` → MAPPING DECISIONS → `institutionPairConsistent`.

**3. Graded-evidence person cases — NOT TESTED.** ROR has no person semantics;
all 11 person cases skipped. The incumbent remains the only measured system here
(3/9 run, per baseline).

**4. Hierarchy pairs handled symmetrically — NOT TESTED as designed.** ROR scores
4/7 as judged, **5/7 artifact-corrected** (hier-005 is a rendering artifact: "UC
San Diego Health System" for "UC San Diego Health"), vs the incumbent's 1/7. Its
two real fails have *different* causes and should not be collapsed:
- **hier-007** (Vanderbilt ↔ VUMC) is the same-id-only consequence — both sides
  resolve to distinct valid records.
- **hier-002** (Harvard ↔ HMS) is a **ROR recall failure**: ROR cannot resolve
  `"Harvard Medical School, Boston, MA, USA"` at all (see per-string behaviors
  below), so the pair rule never gets a second id to compare.

**What this run does establish
is that ROR holds the identifiers hierarchy reasoning needs** — VUMC, Vanderbilt,
CUIMC, Columbia, HMS-adjacent records all carry distinct stable ROR ids, and ROR
records carry a `relationships` graph this comparator deliberately did not
consult. Hierarchy is a *resolvable* problem with a pinned ROR dump; it was not
resolved here.

## Naming artifacts (judge is exact-string in both runs)

Neither normalized. **ROR: 7. Incumbent: 4.** Critically, they are the *same
classes* — punctuation and system/health suffixes — which makes the artifact class
a property of the exact-string judge, not of either system. Both runs return the
correct entity in every one of these:

| # | case | expected | got |
|---|---|---|---|
| 1–3 | inst-uc-010/011/014 | `University of California, San Diego` | `University of California San Diego` |
| 4 | inst-uc-109-system-uop | `University of California` | `University of California Office of the President` |
| 5 | inst-uc-110-system-word | `University of California` | `University of California System` |
| 6 | inst-uc-118-distractor-california-state-univers | `California State University, Los Angeles` | `California State University Los Angeles` |
| 7 | inst-hier-005 | `UC San Diego Health` | `UC San Diego Health System` |

Artifact-corrected family scores: **uc-positive 30/47** (20 fails = 17 true
abstentions + 3 artifacts), **uc-parent 3/3**, **uc-distractor 5/5**,
**hierarchy 5/7**. That uc-parent and uc-distractor go clean matters: ROR
correctly refuses to send bare `"University of California"` to a campus, and
correctly resolves the non-UC distractors (Touro, USC, SDSU) to their own
entities — the ROR-search Touro/UC confusion documented in the research memo does
**not** reproduce through the affiliation endpoint.

This is the strongest argument for the pinned-ROR-dump work: **judging on ROR ids
instead of display strings would retire all 11 artifacts across both runs.**

## Notable per-string ROR behaviors (verified individually, not inferred)

- **Exact-name ties withhold `chosen`.** `"Northwestern University"` returns two
  distinct ROR records both scoring 1.0 and ROR chooses neither. Safe, but a
  recall failure on a string no human would find ambiguous.
- **`"Harvard Medical School"` is not in the top 10 results at all** — ROR returns
  Saba University School of Medicine, B.J. Medical College, and other unrelated
  medical schools. A striking miss for a major institution, and the direct cause
  of the hier-002 failure above.
- **Bare acronyms return zero results** (`UCSB`, `UCR`), where the incumbent's
  OpenAlex-backed path resolved them. The two systems fail on *different* inputs,
  which is the argument for combining signals rather than choosing one.
- **Decorated bylines resolve cleanly** — the full S400 failure shape
  (`"Department of Chemistry, University of California, Berkeley, Berkeley, CA
  94720, USA"`) returns Berkeley at score 1.0. This is the single most
  operationally relevant win.

## What this comparator settles

1. **ROR `chosen:true` is disqualified as a sole auto-resolver** for anything
   feeding automated COI screening — 40 confident wrong-entity resolutions on
   self-contradictory strings, on its own recommended usage.
2. **ROR is strong as a *signal inside* a scorer** — ~3× the incumbent's
   institution recall, it fixes the decorated-byline defect, and it supplies
   stable ROR ids plus a relationships graph. This is the consensus direction
   (a scorer that combines evidence, human-reviewed) now supported by measurement
   rather than assumption.
3. **Out-of-band domain evidence must be a first-class scorer input.** No
   affiliation-string API consumes it; the suite's domain family cannot
   discriminate systems until something does.
4. **Self-contradiction detection is a distinct required capability.** Neither
   system has it. Both a blind resolver and a confident one fail these cases —
   one by abstaining on everything, one by resolving wrongly.

## Comparator #2 — S2AFF: scoped, NOT run (owner decision needed)

Per SESSION_PROMPT ("S2AFF may need a Python env — scope that before promising
it"). Scoped 2026-08-07, **not installed**:

- `s2aff` 0.61 (PyPI) declares no `requires_python` and pins an older scientific
  stack: `torch`, `simpletransformers`, `lightgbm`, `pypi-kenlm`, `blingfire`,
  `nltk`, `hyperopt`, plus `awscli`/`boto3` — the latter because it **downloads
  model artifacts and a ROR dump from S3** (multi-GB class).
- This machine has Python **3.14.6** and no `uv`, `pyenv`, or `conda`. Two
  concrete risks, stated as risks because neither is verified: `torch` declares
  `requires_python >=3.10`, which does **not** establish that cp314 wheels exist
  (**unverified wheel availability on 3.14**); and `pypi-kenlm` ships
  **sdist-only**, so it must compile C++ locally.
- Feasible path: install pinned-Python tooling (uv or pyenv), build a 3.10/3.11
  venv, accept the multi-GB downloads and a real native-build risk. That is new
  machine-level tooling plus meaningful time — an owner cost decision, not a
  default.

**Recommendation:** skip S2AFF for now. This run already produced the decisive
finding (off-the-shelf affiliation matchers resolve well and contradict
dangerously), and S2AFF is the same *class* of system — an affiliation string
linker — so it is unlikely to change the conclusion that a scorer must combine
signals and stay review-only. The higher-value next comparator is the **pinned
ROR dump + local exact-alias baseline** (consensus step 2), which is offline,
dependency-free, has no rate limit, and unlocks both hierarchy relationships and
ROR-id-based judging — which would retire the exact-string artifact class
entirely. If the owner wants S2AFF regardless, it should be its own scoped
session with the env build budgeted.

## Reproducing

```bash
node run-comparator.js ./adapters-ror <new-slug>   # refuses to overwrite a frozen slug
node validate-cases.js                             # schema lint (unchanged)
```
