# Incumbent Baseline — Frozen 2026-08-06 (S405)

First authorized execution of the falsification suite (owner: "use sonnet to
execute the suite", 2026-08-06), run against the INCUMBENT production matching
code via `adapters-incumbent.js`. Raw per-case results:
`incumbent-2026-08-06.results.jsonl`.

## Environment (matters — live provider)

- Live OpenAlex, **keyed** (`OPENALEX_API_KEY` from `.env.local` — matches
  production, which runs keyed). Node v26. Results are a point-in-time
  snapshot of provider behavior; re-runs may drift with OpenAlex data.
- Two earlier runs were discarded as invalid, not incumbent behavior:
  (1) a keyless run crawled under 429 backoff (~40/166 in 22 min);
  (2) a run whose key value had shell quotes glued on — every provider call
  failed, producing uniform abstention (73/80/12). Neither is the baseline.
  Lesson recorded: load env via `set -a; . .env.local; set +a`, and treat a
  *uniformly* abstaining resolver as a broken credential, not a result.

## Headline

| | count |
|---|---|
| total cases | 166 |
| **pass** (settled labels) | **89** |
| **fail** (settled labels) | **64** |
| error | 0 |
| skipped | 12 |
| assumed-label (reported separately) | 1 ran (person-005: FAIL) |

Of the 64 fails, **4 are judge string-strictness artifacts, not wrong
entities** — the resolver returned the correct institution with a different
name rendering ("University of California San Diego" without the comma;
"…Office of the President"/"…System" for the system; CSULA without the
comma). Real incumbent failures: **60**.

## The incumbent's profile in one line

**Safe but blind.** Zero wrong-entity resolutions anywhere (no
`must_not_resolve_to` veto ever fired) — but it achieves that safety by
blanket abstention, failing 36/47 positive resolution cases. It cannot
resolve short forms ("UC Berkeley"), most acronyms, punctuation variants
("U.C. San Diego"), or decorated bylines — only exact official names (11/11)
plus, curiously, the UCSB/UCR acronyms. This is the recall problem the owner
prioritized (Q1: "It's important to find the correct person"), in
institution form.

## Per-family findings

- **uc-positive 11/47:** only exact official names resolve (all 10 campuses)
  + UCSB/UCR acronyms. Every short/punctuation/byline variant abstains —
  reproduces both S400 failure classes (decorated → zero provider results;
  short forms → containment tie → null).
- **uc-sibling-{acronym,city,domain} 60/60 "pass" — read with care:** every
  pass is `{outcome: review, target: null}`, i.e. abstention. The incumbent
  never contradicts actively; it simply can't resolve these strings at all.
  A candidate scorer must beat this by resolving the resolvable while STILL
  never auto-resolving a contradiction — abstaining on everything trivially
  aces this family.
- **uc-parent 1/3:** bare "University of California" correctly goes to
  review (never a campus). The two fails are naming artifacts (correct
  system-level entities returned).
- **uc-parent-mixed 5/5:** all abstain (same blanket-abstention mechanism).
- **uc-distractor 3/5:** clean Touro / USC / SDSU resolve to their correct
  non-UC entities (real ROR ids returned) — the ROR-search Touro/UC
  confusion does NOT reproduce through OpenAlex-backed resolution on clean
  names. Fails: decorated Touro byline abstains; CSULA is a naming artifact.
- **byline-normalization 3/14 — NO drift from S400:** all 11
  false-mismatch cases still return `consistent:false` (the documented
  byline-vs-clean defect, request 1002903), and the 3 passes are exactly the
  cases the incumbent was documented to get right (the genuine Texas
  A&M/Northwestern flag + the two clean-name hierarchy positive controls).
- **hierarchy 1/7:** Dana-Farber vs Harvard correctly lands in review (by
  abstention). HMS↔Harvard and Vanderbilt↔VUMC (listed/evidence REVERSED
  from the S400 direction) return `consistent:false` — the
  associated-institution linkage is direction-sensitive. LBNL, UC San Diego
  Health, Broad, and the multi-org string all abstain.
- **person-identity 3/9 run:** the shipped S214 guards hold (Tsai/Nakano
  same-institution namesake rejected; Noe/Clementi wrong profile rejected;
  Laederach forename contradiction rejected). Everything needing GRADED
  evidence fails: nickname equivalence (both directions), diacritic
  transliteration class (Müller/Mueller treated as mismatch), initials
  compatibility, common-name insufficiency (name-only "Wei Wang" matches),
  namesake byline bleed. Exactly the missing-Fellegi–Sunter diagnosis.
- **contact-attribution 2/4 run:** verified-domain match AND contradiction
  both correct (the S234/S235 fixes hold). No time-aware evidence handling
  (8-year-old byline email attaches as if current) and no ownership
  semantics (corresponding-author/shared-inbox attaches).
- **affiliation-current 0 run:** no incumbent implements a dated evidence
  ledger at all — all 6 skipped. The owner's Q5 policy has no existing
  machinery.

## Assumed-label cases at run time (both settled 2026-08-07, next day)

- **person-005 (Yubin Zhou): FAIL** — the incumbent RESOLVED the
  50%-confidence Northwestern-byline candidate as a match; the design label
  says a 50%-confidence match with a contradicting institution must reach a
  human. This is the live namesake-bleed hazard, now demonstrated, not just
  suspected. *(Label settled `verified`/`review` by owner 2026-08-07 — the
  run's headline therefore effectively reads 89 pass / 65 fail on settled
  labels; this report keeps the as-run numbers.)*
- **affil-004 (EKA contaminant): skipped** (no affiliation adapter).
  *(Product behavior settled 2026-08-07: quarantine-for-review.)*

## Skips (12, denominator honesty)

- 6 × affiliation-current: no incumbent evidence-ledger implementation.
- 4 × contact cases with structural `<placeholders>`: no comparable literal
  for `_validateEmailAgainstVerifiedDomain`.
- 2 × person anchor-collapse cases: the incumbent seam
  (`shared/utils/reviewer-rediscovery.js`) is an ES module not
  `require()`-able from the CommonJS harness without adding a transpile
  step (constraint: no new dependencies).

## Harness changes made during this first execution

`run.js` (see inline comments): (1) `judge()` now compares the resolved
target NAME for resolve-kind cases — previously a wrong-but-unbanned entity
scored a silent pass; (2) the no-adapter skip path now fires `onResult`;
(3) adapters may return `{skipped, reason}` to decline a case. Known
sharp edge kept as-is: target-name comparison is exact-string, which caused
the 4 artifact fails above — a future run should compare normalized names
or ROR ids (available once the pinned dump exists).

## What a successor must beat (falsification bar)

1. Resolve ≥ the incumbent's 11 positives AND the 36 abstained variants,
   with ZERO `must_not_resolve_to` vetoes fired across the 65
   sibling/mixed/distractor contradiction cases.
2. Flip the 11 byline-normalization false mismatches while keeping
   inst-byline-012 (genuine mismatch) flagged.
3. Pass the graded-evidence person cases without breaking the 3 hard-guard
   passes.
4. Handle hierarchy pairs symmetrically (both directions of VUMC↔Vanderbilt).
