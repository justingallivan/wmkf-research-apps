# Institution resolution at runtime — deployment assessment (S406, 2026-08-07)

**Status: ASSESSMENT FOR REVIEW. Not a decision, not a plan of record.** Written
to answer two owner questions during S406: (1) can S2AFF run in our Vercel
setup, and (2) how would any of this work per candidate / per search / per
cycle. Seeking a challenge on the reasoning and, explicitly, **better
alternatives**.

Related: `benchmarks/fuzzy-matching-falsification/baseline/ror-chosen-2026-08-07.md`
(comparator #1, corrected after review), `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`
(comparator list, S2AFF description), `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md`
(the governing consensus).

## 1. The two questions, and why they're different

**S2AFF as a comparator does not deploy.** It runs once, offline, against the
166 frozen falsification cases to produce a results file and a report — exactly
as the ROR comparator did (`node run-comparator.js`, on a laptop, 40s, never
near Vercel). The env problem to solve is "a pinned Python 3.10/3.11 venv on a
dev machine or in CI", not "a Vercel runtime".

**The real question is what a shipped scorer looks like**, since the consensus
direction is to build one. That is question 2, and it is the one worth arguing
about.

## 2. Deployment reality [VERIFIED]

- The project is a Next.js/Node deployment on Vercel. **No Python functions, no
  `requirements.txt`, no `pyproject.toml`** anywhere in the tracked tree
  [VERIFIED via `find`]. `vercel.json` configures only Node function
  `maxDuration` values and crons.
- Adding a Python runtime would be a **new deployment surface** with its own
  auth-guard, Dataverse-interlock, and API-route-security-matrix implications —
  an architectural change, not a config tweak.

Vercel function limits [VERIFIED via https://vercel.com/docs/functions/limitations,
fetched 2026-08-07; page `last_updated: 2026-07-01`]:

| Constraint | Value |
|---|---|
| Bundle size (uncompressed) | 250 MB; **500 MB for Python**; **5 GB** via Large Functions (needs fluid compute + `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`) |
| Memory | 2 GB / 1 vCPU default; **max 4 GB / 2 vCPU** (Pro/Ent). No GPU. |
| Duration | 300s default; 800s max (Pro/Ent); 1800s extended beta |
| Storage | ephemeral only; no persistent disk |

S2AFF dependency facts [VERIFIED via PyPI, 2026-08-07]: `s2aff` 0.61 declares no
`requires_python` and pins `torch`, `simpletransformers`, `lightgbm`,
`pypi-kenlm`, `blingfire`, `nltk`, `hyperopt`, `cmake`, plus `awscli`/`boto3` —
the latter because it fetches model artifacts and a ROR dump from S3.
`pypi-kenlm` is **sdist-only** (no wheels), so it compiles C++ at install time.
Local Python is **3.14.6** with no `uv`/`pyenv`/`conda` [VERIFIED].

**Assessment:** the 5 GB Large Functions tier means bundle size is probably *not*
the blocker. The blockers are (a) multi-GB model artifacts fetched from S3 into
ephemeral storage on every cold start, and (b) whether the kenlm C++ build
succeeds inside Vercel's Python builder — for which I have **no evidence either
way** [ASSUMED risk, unverified]. Neither is worth discovering mid-deploy for a
benchmark that doesn't need to deploy.

## 3. Measured runtime shape [VERIFIED]

The current incumbent path, per unit of work:

| Level | Volume | Evidence |
|---|---|---|
| **Per candidate** | 1 claimed affiliation → **1 `resolve()`** = up to **2 OpenAlex calls** (`searchInstitutions` limit 10, then `getInstitution` hydration) | `lib/services/institution-identity-resolver.js:157,178` |
| | a consistency check resolves **both** sides | `lib/services/institution-affiliation-consistency.js:46-49` |
| **Per search** | `DEFAULT_REVIEWER_COUNT = 15` → **~15–45 resolutions ≈ 30–90 provider calls** | `shared/config/reviewerFinderPreferences.js:20` |
| **Per cycle** | N requests × several Find runs each × the above. **N not probed** | [ASSUMED — parameter, not a measured number] |

### Cache scoping is inconsistent [VERIFIED]

The resolver's cache is per-instance (`const cache = new Map()` inside the
factory, `institution-identity-resolver.js:143`), so *where it is constructed*
sets the hit rate:

- `lib/services/reviewer-finder/save-candidates-service.js:681` — constructed
  **once per request, before the candidate loop**. Cache spans all candidates. ✅
- `pages/api/reviewer-finder/discover.js:292` — same. ✅
- `lib/services/reviewer-identity-runtime.js:78` — constructed **inside
  `evaluateWorksFirstSuggestion`**, which is invoked per suggestion (loops at
  `:324`/`:337`). **Fresh empty cache per candidate; zero cross-candidate
  reuse.** ❌ Fifteen candidates from one university = fifteen duplicate
  resolution pairs.

No persistent (cross-request) institution cache exists anywhere [VERIFIED via
grep].

## 4. The load-bearing claim — and it is NOT verified

> **Distinct institutions ≪ candidates.** Across a cycle, thousands of
> resolutions draw on only a few hundred *distinct* institution strings, in a
> long-tailed distribution dominated by the same R1 universities.

**This is [ASSUMED]. I have not measured it, and the entire architecture
recommendation below rests on it.** It is cheaply falsifiable: count distinct
`wmkf_institution`-equivalent values against total saved candidate rows in
Dataverse, and plot the frequency distribution. If the tail is fat rather than
thin — many one-off institutions, heavy decoration variance making raw strings
near-unique — the caching argument weakens sharply and per-call scoring becomes
more attractive.

**A reviewer should attack this first.** If it falls, section 5 falls with it.

## 5. Proposed architecture (conditional on §4 holding)

A tiered resolver, where each tier only sees what the tier above couldn't settle:

| Tier | Mechanism | Expected share | Cost |
|---|---|---|---|
| 1 | Exact/alias lookup against a **pinned ROR dump** shipped as a static asset; plus a persistent cross-request cache | large majority | sub-ms, in-process, no network |
| 2 | **Scorer** on ambiguous/decorated strings — features are string-similarity primitives; a LightGBM-class ensemble exports to plain JS tree evaluation | the tail | ms, in-process |
| 3 | **Abstain → human review** | residue | already the product behavior |

Consequences if this holds:
- No Python in any request path; no 5 GB function; no separate inference service.
- Provider calls collapse from ~30–90 per search toward near-zero for the head.
- The pinned ROR dump stops being a benchmarking convenience (ROR-id judging)
  and becomes **the production substrate**. That is the strongest argument for
  doing it first.
- S2AFF stays purely a research input: it tells us *which features and which
  abstention rule*, and we implement that ourselves.

**Unverified in this proposal:** [ASSUMED] that a LightGBM model exports cleanly
to JS tree evaluation with acceptable fidelity; [ASSUMED] that a pinned ROR dump
is a tractable size to ship as a static asset (ROR is ~110k records — not
checked against Vercel's bundle budget); [ASSUMED] tier-1 hit rate, which is
§4 restated.

## 6. Alternatives I considered and did not recommend — challenge these

1. **Deploy S2AFF on Vercel Python + Large Functions.** Rejected: cold-start S3
   model fetch, unproven native build, new deployment surface, and it deploys a
   research baseline rather than the thing we want.
2. **Separate inference service** (Modal / Cloud Run / Replicate / SageMaker)
   called over HTTP from a Node route. Rejected as *premature*, not as wrong —
   it is the right answer **if §4 is false** or if tier 2 turns out to need a
   transformer rather than a feature-based model. Costs: another runtime to
   operate, secrets, network hop in a latency-sensitive path, another failure
   mode in a fail-closed flow.
3. **Keep calling OpenAlex live, just fix the caching.** Cheapest by far, and it
   is a genuine option: a persistent cache + fixing the per-candidate resolver
   construction might capture much of the win with none of the build. Not
   recommended *alone* because it does not address the recall failures the
   falsification suite documented (incumbent resolves 11/47 positives) — but it
   may be the correct **first** increment.
4. **Precompute at save time rather than search time** — resolve once when a
   candidate is persisted, store the ROR id on the row, never resolve again on
   read. Not explored in depth; possibly strictly better than caching for the
   saved-candidate path, and it changes the volume math entirely.

## 7. What I am least confident about

- §4's cardinality assumption (load-bearing, unmeasured).
- Whether tier 2 can be feature-based at all, or whether the sibling-contradiction
  failures that disqualified ROR `chosen:true` need something with more context.
  The falsification suite showed **neither** system detects self-contradictory
  strings; nothing here proves a feature-based scorer would.
- Whether "out-of-band domain evidence must be a first-class input" (a corrected
  finding from comparator #1) is satisfiable by tier 1/2 as drawn.
- Whether option 4 (resolve-at-save) dominates the whole design.

## 8. Explicit asks of the reviewer

1. Is the tiered design right, or is there a materially better architecture?
2. Does §4 need measuring before any of this is actionable, and is the proposed
   measurement the right one?
3. Is option 3 or 4 the correct first increment instead of the ROR dump?
4. Is the "S2AFF never deploys" framing correct, or is there a real scenario
   where shipping it beats reimplementing its approach?
