# Comparator #1 — ROR affiliation `chosen:true` (2026-08-07, S406)

> **CORRECTED 2026-08-07 after Codex adversarial review** (`--base 28ba935f`,
> verdict needs-attention). The raw run is unchanged and reproducible; the
> **interpretation layer was wrong in four places** and is corrected in place
> below. What changed:
> 1. **Safety was understated.** Counting exact-string VETO messages missed 6
>    unsafe resolutions (the comma in "University of California, San Diego").
>    Safety is now derived from result semantics — expected `review`, got
>    `resolved`. **64 end-to-end / 44 matcher-attributable**, was "40".
> 2. **The artifact set is no longer presented as adjudicated.** inst-uc-109 is
>    a *distinct ROR record*, not a rendering variant; the "uc-parent 3/3" and
>    "53/88" claims built on it are withdrawn.
> 3. **Three relationship cases are excluded from the headline aggregate.**
>    Documenting their circularity in prose did not make the aggregate
>    like-for-like.
> 4. **"Viable as a signal inside a scorer" is downgraded to *unvalidated
>    candidate signal*, and the S2AFF skip recommendation is WITHDRAWN** — the
>    research doc describes S2AFF as parse → high-recall ROR retrieval →
>    LightGBM rerank → margin-based abstention, i.e. the closest existing
>    analogue to the architecture we intend to build, not "the same class" as a
>    chosen-only endpoint.
>
> The original figures are retained inline as explicitly withdrawn claims where
> they were published, so the record shows what was corrected rather than quietly
> restating it.

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
| pass / fail (as judged) | **46 / 95** | **84 / 57** |
| **unsafe resolutions, end-to-end** | **64** | **0** |
| **unsafe resolutions, matcher-attributable** | **44** | **0** |
| abstained on a resolve case (124 total) | **19 (15%)** | **106 (85%)** |
| error | 0 | 0 |
| skipped (person/contact/affiliation) | 25 | 12 |

**Identity-only aggregate** — the 3 relationship cases (byline-013, byline-014,
hier-007) removed, because the same-ROR-id-only pair rule predetermines their
failure before any ROR behavior is observed:

| | ROR | incumbent |
|---|---|---|
| denominator | 138 | 138 |
| pass / fail (as judged) | **46 / 92** | **82 / 56** |
| + 4 proven same-entity rendering artifacts | 50 | — |
| + 2 unadjudicated artifacts, if credited | 52 | — |

> **Safety is now measured semantically** (expected `review`, actual `resolved`),
> not by counting VETO strings. The earlier "58 raw / 40 attributable" figure was
> **understated**: 6 unsafe UCSD resolutions evaded the banned-name comparison
> because ROR returns "University of California San Diego" without the comma. The
> exact-string weakness this report already documented for *positive* cases was
> not applied to the *safety* count — a one-directional artifact correction, and
> the most consequential error in the original analysis.

> The incumbent's 84/57 differs from its published 89/64 headline because that
> headline includes the 9 person + 4 contact cases the incumbent can run and ROR
> cannot. Same frozen results file, not a re-run. (Confirmed legitimate in review.)

> The incumbent's 84/57 here differs from its published 89/64 headline because
> that headline includes the 9 person + 4 contact cases the incumbent could run
> and ROR cannot. 84/57 is the like-for-like institution-only restatement of the
> same frozen results file — not a re-run and not a correction.

## The one-line profile

**The incumbent's mirror image.** Where the incumbent was "safe but blind"
(85% abstention, zero unsafe resolutions), ROR `chosen:true` is **confident and
often wrong on contradictory input**: it abstains on only 15% of resolve cases
and resolves nearly 3× as many true positives — but it produces **64 unsafe
resolutions end-to-end (44 attributable to the affiliation string alone)** where
the incumbent produced none.

**Neither system passes the falsification bar.** Bar item 1 demands recall AND
zero vetoes; the incumbent fails the recall half, ROR fails the safety half. The
raw pass counts invert the real story and should not be read as a ranking: the
incumbent's higher score is largely earned by abstaining on contradiction cases,
which the baseline already warned "abstaining on everything trivially aces."

## Unsafe resolutions — the number this run turns on

**Measured semantically: cases whose expected outcome is `review` where ROR
returned `resolved`.** This supersedes the original VETO-string count, which
missed 6 (see the correction note in the headline).

| family | unsafe | VETO fired | attributable to the matcher? |
|---|---|---|---|
| uc-sibling-acronym | 20 | 18 | **yes** — contradiction is in the string ROR saw |
| uc-sibling-city | 20 | 18 | **yes** — contradiction is in the string ROR saw |
| uc-parent-mixed | 4 | 4 | **yes** |
| uc-sibling-domain | 20 | 18 | **no as a matcher fault — yes as a resolver fault**; see below |
| **total** | **64** | **58** | **44 matcher-attributable** |

The 6-case gap between "unsafe" and "VETO fired" is entirely the UCSD comma:
inst-uc-060/061/062/063/064/065 resolve to `"University of California San Diego"`
while the banned list holds `"University of California, San Diego"`.

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

### The `uc-sibling-domain` family — two true readings, both worth keeping

The original report claimed this family "discriminates neither system." That was
**wrong as stated**, and the correction matters because the two readings answer
different questions:

- **As a matcher-quality question:** ROR is not at fault. The contradiction lives
  entirely in `domain_evidence` (`"UC Berkeley"` + `domain_evidence: "ucla.edu"`).
  ROR's endpoint accepts only a string, so the adapter discards it and ROR is
  shown a clean `"UC Berkeley"` it *should* resolve. Fixing ROR's matcher would
  not help; only a different input contract would. Hence 44, not 64, as the
  matcher-attributable figure.
- **As a sole-auto-resolver question — the one this suite exists to answer:**
  ROR fails 20/20 and the incumbent is safe 20/20. A system that resolves
  confidently while structurally unable to consume the disambiguating evidence
  *is* unsafe in production, whatever the reason. This is the reading that should
  lead, and 64 is the headline number.

One caveat on the incumbent's 20/20, which the corrected framing should not
overstate: it discarded `domain_evidence` too (its `resolve()` has no such
parameter) and abstained because it cannot resolve `"UC Berkeley"` **at all** —
that is credit for blindness, not for detecting the contradiction. The successor
consequence is concrete: **any successor with real recall will fail these 20 too
unless it consumes domain evidence.** Out-of-band evidence is a required scorer
input, not a score to beat.

## Against the four "what a successor must beat" items

**1. Resolve ≥ 11 positives + the 36 abstained variants, zero vetoes — FAILED
(both halves move in opposite directions).**
uc-positive: ROR **27/47 as judged, 30/47 corrected on proven artifacts** vs the
incumbent's 11/47. ROR gained 18 cases the incumbent abstained on — short forms
("UC Berkeley"), punctuation variants, and decorated bylines all resolve. It
**lost exactly 2**: `UCSB` and `UCR`, the two bare acronyms the incumbent
curiously did resolve. The recall half is a clear win; the safety half is a clear
loss (**64 unsafe end-to-end / 44 matcher-attributable**).

**2. Flip the 11 byline false mismatches, keep inst-byline-012 flagged — PARTIAL,
8 of 11.** ROR flips 8 (001, 002, 004, 007, 008, 009, 010, 011) and **correctly
keeps 012** (the one genuine Texas A&M/Northwestern mismatch) flagged. This is
real movement on the live request-1002903 defect that the incumbent fails 11/11.
- The 3 not flipped are **short-form recall misses, not consistency errors**:
  ROR cannot resolve `"Texas A&M"` (005, 006) or `"NC State University"` (003),
  so one side of the pair abstains.
- 013/014 are **excluded from the identity aggregate as unsupported**, not
  counted as ROR regressions. Both sides resolve correctly to genuinely different
  ROR records (VUMC `05dq2gs74` vs Vanderbilt `02vm5rt34`; Columbia `00hj8s172`
  vs CUIMC `01esghr10`), so the same-ROR-id-only rule guarantees their failure
  before any ROR behavior is observed. This was predicted in advance in
  `adapters-ror.js` → MAPPING DECISIONS, but **predicting a circular result does
  not license leaving it in the aggregate** — a fair point from review. They are
  relationship-consistency cases and need a relationship-aware adapter to be
  measured at all.

**3. Graded-evidence person cases — NOT TESTED.** ROR has no person semantics;
all 11 person cases skipped. The incumbent remains the only measured system here
(3/9 run, per baseline).

**4. Hierarchy pairs handled symmetrically — NOT TESTED as designed.** ROR scores
4/7 as judged vs the incumbent's 1/7, but the family decomposes into three
different things and the aggregate should not be quoted:
- **hier-007** (Vanderbilt ↔ VUMC) is **excluded as unsupported** — the
  same-id-only rule predetermines it.
- **hier-002** (Harvard ↔ HMS) is a genuine **ROR recall failure**, not
  predetermined. Verified: HMS has **no distinct ROR record** — a name query
  returns Harvard University (`03vek6s52`) — so had ROR's affiliation matcher
  resolved `"Harvard Medical School, Boston, MA, USA"` at all, the same-id rule
  would have *passed* it. ROR instead returns unrelated medical schools.
- **hier-005** is the unadjudicated granularity case above, left as a fail.

**What this run does establish
is that ROR holds the identifiers hierarchy reasoning needs** — VUMC, Vanderbilt,
CUIMC, Columbia, HMS-adjacent records all carry distinct stable ROR ids, and ROR
records carry a `relationships` graph this comparator deliberately did not
consult. Hierarchy is a *resolvable* problem with a pinned ROR dump; it was not
resolved here.

## Naming artifacts (judge is exact-string in both runs)

Neither normalized. The original report called all 7 ROR cases
"correct-entity/wrong-rendering" and credited them as passes. **That
classification was name-based and is not adjudicable without canonical expected
ROR ids, which the cases carry as `null` by design.** Corrected into three
classes:

| class | cases | expected → got | status |
|---|---|---|---|
| **Proven same entity** (punctuation only) | inst-uc-010/011/014 | `University of California, San Diego` → `University of California San Diego` (all `0168r3w48`) | artifact — creditable |
| | inst-uc-118 | `California State University, Los Angeles` → `California State University Los Angeles` | artifact — creditable |
| **Unadjudicated** (plausibly same entity, unproven) | inst-uc-110 | `University of California` → `University of California System` (`00pjdza24`) | left as FAIL |
| | inst-hier-005 | `UC San Diego Health` → `UC San Diego Health System` (`01kbfgm16`) | left as FAIL |
| **Not an artifact — distinct record** | inst-uc-109 | `University of California` → `University of California Office of the President` (`00dmfq477`) | reclassified |

**inst-uc-109 is a granularity-policy mismatch, not a rendering variant.**
`00dmfq477` (Office of the President) and `00pjdza24` (UC System) are two
*separate* ROR records — verified by direct query, both exist and both are
`chosen:true` for their own name. Given the input
`"University of California, Office of the President"`, ROR arguably returned the
*more precise* answer; the case expects admin units to roll up to the system,
which is a product policy the case encodes and ROR does not know. It belongs in
neither the artifact bucket nor the error bucket.

**Withdrawn:** the previous "uc-parent 3/3" and "53/88 artifact-corrected"
figures, both of which depended on crediting inst-uc-109. Corrected
artifact-adjusted totals are in the headline table as a range (50 proven / 52 if
the two unadjudicated cases are credited).

Family scores that survive on proven artifacts alone: **uc-positive 30/47** (20
fails = 17 true abstentions + 3 proven artifacts) and **uc-distractor 5/5**. The
uc-distractor result stands and matters: ROR resolves Touro, USC, and SDSU to
their own entities, so the ROR-search Touro/UC confusion documented in the
research memo does **not** reproduce through the affiliation endpoint.

The incumbent's 4 artifacts were classified the same name-based way by the
baseline report and carry the same caveat — its UC-system pair ("Office of the
President"/"System") is very likely the identical granularity question. **Neither
run's artifact set should be treated as settled until the cases carry canonical
ROR ids.** That is now the strongest argument for the pinned-ROR-dump work: it
would let the judge compare ids and make this adjudicable instead of arguable.

## Notable per-string ROR behaviors (verified individually, not inferred)

- **Exact-name ties withhold `chosen`.** `"Northwestern University"` returns two
  distinct ROR records both scoring 1.0 and ROR chooses neither. Safe, but a
  recall failure on a string no human would find ambiguous.
- **`"Harvard Medical School"` is not in the top 10 results at all** — ROR returns
  Saba University School of Medicine, B.J. Medical College, and other unrelated
  medical schools. A striking miss for a major institution, and the direct cause
  of the hier-002 failure above.
- **Every bare campus acronym abstains** — all seven in the suite (UCLA, UCSD,
  UCSF, UCI, UCSB, UCSC, UCR) return no chosen record; `UCSB` was verified to
  return literally `number_of_results: 0`. The incumbent's OpenAlex-backed path
  resolved UCSB and UCR. This confirms and widens the 2026-08-04 research probe
  (`docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`, which observed
  it for UCSD alone) from n=1 to n=7. The two systems fail on *different* inputs —
  the argument for combining signals rather than choosing one.
- **Decorated bylines resolve cleanly** — the full S400 failure shape
  (`"Department of Chemistry, University of California, Berkeley, Berkeley, CA
  94720, USA"`) returns Berkeley at score 1.0. This is the single most
  operationally relevant win.

## What this comparator settles

1. **ROR `chosen:true` is disqualified as a sole auto-resolver** for anything
   feeding automated COI screening — 64 unsafe resolutions end-to-end (44 from
   the affiliation string alone) on its own recommended usage. This is the one
   conclusion the run fully supports.
2. **Out-of-band domain evidence must be a first-class scorer input.** No
   affiliation-string API consumes it; 20 of the 64 unsafe resolutions exist
   purely because the evidence could not be passed.
3. **Self-contradiction detection is a distinct required capability.** Neither
   system has it. Both a blind resolver and a confident one fail these cases —
   one by abstaining on everything, one by resolving wrongly.
4. **ROR is an *unvalidated candidate signal* for a scorer — not a validated
   one.** It has ~3× the incumbent's institution recall, fixes the
   decorated-byline defect, and supplies stable ids plus a relationships graph.
   But **nothing in this run put ROR output into a scorer or measured its
   incremental value**, so "viable as a signal inside a scorer" (the original
   wording) outran the experiment and is withdrawn.

### Limits of this evidence — read before quoting the numbers

- **The institution slice is 15 real cases and 126 synthetic**, and **all 64
  unsafe resolutions are synthetic.** The counts therefore carry no real-world
  frequency information; do not read "64" as an expected production error rate.
  What does transfer is the **mechanism** — resolving a decorated,
  internally-contradictory affiliation string at score 1.0 — which is precisely
  the shape production produces (the S400 defect, request 1002903). The
  disqualification rests on the mechanism, not the magnitude.
- **The artifact set is unadjudicated** in both runs pending canonical ROR ids.
- **Relationship consistency was not measured at all** — the pair rule cannot
  express it.

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

**Recommendation (REVISED 2026-08-07 after review — the original "skip S2AFF"
is withdrawn):** **keep S2AFF on the queue and run it.** The original reasoning
was that S2AFF is "the same class of system" as ROR `chosen:true` and so unlikely
to change the conclusion. That was wrong on the facts. The research doc
(`docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` §"S2AFF:
strongest directly testable baseline") describes S2AFF as **affiliation parsing →
high-recall ROR candidate retrieval → feature-based LightGBM reranking →
margin-based abstention** (leading score *and* margin over the second candidate).
That is not a chosen-only endpoint — it is the closest existing analogue to the
scorer architecture the consensus proposes to build. It is therefore the **most**
informative remaining comparator, not the least: it is the only available way to
test whether a margin-based abstention scorer over ROR candidates avoids the
sibling-contradiction failures that disqualified `chosen:true`, before we build
one ourselves.

Sequencing note: the **pinned ROR dump + local exact-alias baseline** (consensus
step 2) remains valuable and is cheap — offline, dependency-free, no rate limit —
and it additionally unlocks ROR-id judging (which would make the artifact set
adjudicable) and the relationships graph (which would let the pair rule express
hierarchy). Running it *first* would make the S2AFF run cleaner to score. Both
belong on the queue; neither is waived.

## Review record — Codex adversarial review, 2026-08-07

Run against `--base 28ba935f`. Verdict **needs-attention**: "Do not ship the
interpretation layer yet." All four findings were verified against the raw
results and **all four were accepted**. The raw run was confirmed reproducible
and the 84/57 institution-only restatement confirmed legitimate; every correction
lands in the interpretation layer.

| # | Finding | Disposition |
|---|---|---|
| high | Safety understated — 64 unsafe, not 58 vetoes / 40 attributable | **Accepted.** Verified: 6 UCSD cases evaded the banned-name comparison on a comma. Metric switched to result semantics. |
| high | Scorer viability + S2AFF skip outrun the experiment | **Accepted.** "Viable signal" → "unvalidated candidate signal"; S2AFF skip withdrawn (it is architecturally the closest analogue to the target scorer, per the research doc). |
| medium | Pair rule predetermines 3 real-case failures | **Accepted.** byline-013/014 + hier-007 removed from the identity aggregate; documenting circularity in prose did not make the aggregate like-for-like. |
| medium | "Naming artifacts" unproven without canonical ids | **Accepted.** inst-uc-109 reclassified (distinct record); artifact set marked unadjudicated; "uc-parent 3/3" and "53/88" withdrawn. |

Two refinements added during verification, beyond the review:

- **hier-002 is NOT predetermined** (the review listed three predetermined cases;
  a fourth was hypothesized and disproved). Verified by direct ROR name query:
  **Harvard Medical School has no distinct ROR record** — it maps to Harvard
  University `03vek6s52` — so the same-id rule would have *passed* hier-002 had
  ROR's affiliation matcher resolved the string. It is a genuine recall failure.
- **The incumbent's institution-slice zero survives semantic re-measurement.** It
  resolved 3 expected-`review` cases overall, but all 3 are person/contact cases
  with null targets (contact-007, person-004, person-005), already recorded as
  fails in its baseline. The 64-vs-0 comparison is apples-to-apples.

## Reproducing

```bash
node run-comparator.js ./adapters-ror <new-slug>   # refuses to overwrite a frozen slug
node validate-cases.js                             # schema lint (unchanged)
```
