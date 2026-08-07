# Handoff — institution resolution architecture → Codex lead (S406, 2026-08-07)

**Owner:** Codex (design lead, from this point)
**Branch:** PR #113 merged; compact-index measurement continued on
`codex/compact-ror-index-experiment`
**Status:** Architecture direction set by Codex's adversarial review; Claude's
assessment superseded. The first reversible measurement increment is
implemented and merged in PR #113; production resolver authority was live-verified as
`legacy-default` on 2026-08-07, so promotion does not enable `shadow` or
`combined`. The pinned ROR v2.11 compact-index experiment is complete and
measurement-only. Owner decision 2026-08-07: the live candidate-retrieval plan
uses ROR's official API, not a bundled local index; the claim-oriented
resolver/scorer remains planned. The versioned candidate benchmark is also
complete: canonical ROR-id and relationship labels are pinned without changing
v1, and ROR API plus incumbent were both rerun under the new candidate-
retrieval claim.
**Changed surfaces:** the request-batch W2 resolver scope, cancellation-safe
single-flight, aggregate runtime metrics, an offline compact-index
builder/measurement, and benchmark-only candidate adapters/contracts. No
production index asset or resolver/scorer was wired.
**Verification:** 47 affected resolver/runtime tests and 159 broader
reviewer-identity tests green; full suite 580/580 suites and 7,087/7,087 tests
green; type check and all
relevant source/Atlas/wiki/doc gates plus paired self-tests green. The compact
index build is deterministic across two runs; its targeted tests and lint pass.
The candidate overlay validates all 141 institution labels against seven frozen
base hashes and 29 pinned ROR records; eight focused contract/adapter tests pass,
and both 166-case v2 comparator runs completed with zero provider errors.
**Next owner/action:** keep production authority on `legacy-default` unless the
owner separately authorizes shadow observation. Build the next benchmark-only
slice: organization-span parsing, controlled ordinary-query fallback, and
non-overridable veto/scoring behavior over the frozen candidate contract. Do
not use ROR's chosen flag or rank as the verdict. Only after that comparator
passes should a production request-scoped adapter be wired behind the existing
legacy/shadow seam. Keep pinned ROR v2.11 only as the offline label and
relationship substrate. Claude remains off this surface.

Owner decision, 2026-08-07: **Codex takes the lead on the institution-resolution
model.** Claude's assessment
(`outputs/institution-resolution-runtime-architecture-2026-08-07.md`) went to
adversarial review and came back `needs-attention` with five findings, all
accepted. The architecture of record is now **Codex's claim-oriented pipeline**,
not Claude's tiered design.

## What Codex's review established (the model to build from)

Parse organization spans and evidence → retrieve a **candidate union** from
ROR's server-side API → apply explicit **non-overridable vetoes** (multi-org,
sibling, domain, country, type, granularity) → score survivors with
provenance-aware features → abstain.

Governing principle: **ROR `chosen:true`, search rank, and exact aliases are
retrieval evidence, not decision authority.** Vetoes run *before* scoring.

## Owner decision: ROR API for live retrieval (2026-08-07)

[BENCHMARK CONTRACT IMPLEMENTED; PRODUCTION ADAPTER PLANNED] The live app will
query ROR from the server instead of packaging or loading the raw/compact
dataset. The current compact-index artifacts remain offline-only and untracked.

Minimum live contract:

1. Use ROR's affiliation endpoint for messy affiliation text and the ordinary
   query endpoint only as a candidate-recall fallback for structured names or
   explicit acronyms. The affiliation request must explicitly select API v2's
   `single_search` strategy rather than inherit a changeable default. Union and
   deduplicate returned ROR ids. Neither endpoint's rank, score, nor
   `chosen:true` flag may resolve an institution by itself.
2. Send only institution-affiliation evidence required for retrieval. Do not
   send reviewer names, email/contact fields, proposal text, or candidate keys.
   Carry domain, country, type, and hierarchy evidence separately into local
   vetoes/scoring because the affiliation endpoint cannot consume all of it.
3. Add a candidate-set interface that returns ROR records plus retrieval
   provenance and **no institution verdict**. The current
   `createInstitutionIdentityResolver` is not this interface: it chooses one
   OpenAlex-backed identity and the works-first adapter wraps it in a singleton.
   Reuse or extract only its request-scoped cache/single-flight/cancellation/
   metrics pattern so normalized duplicate candidate lookups share work inside
   the same safe cancellation scope. Keep existing W1 callers on their current
   resolver until separately migrated. Start without a cross-request database
   cache; add one only if measured peak traffic or latency establishes a need.
4. Bound concurrency and time, honor `Retry-After`, and retry only transient
   429/5xx failures. Provider timeout, exhaustion, malformed response, no
   candidate, ambiguity, or any veto returns no new resolution; it must not
   weaken the legacy/review result or manufacture a COI clearance.
5. Keep telemetry aggregate and PII-free. Record provider calls, reuse,
   latency, response class, candidate counts, and abstention/failure counts;
   never log raw queries or returned organization names.
6. Treat ROR API behavior as a drifting external dependency. Pin API v2 plus
   explicit `single_search` request construction and response parsing in tests;
   record API version, strategy, and observation date in comparator artifacts.
   Before rollout, re-verify the published rate/client-identification policy and
   ensure the adapter can send the `Client-Id` header when registration/policy
   requires it. Preserve the pinned dump for stable expected ids and
   relationship assertions.
7. The works-first path currently requires one OpenAlex institution id. Only
   after local vetoes/scoring produce one `resolved` ROR id may a separate
   hydration step look that ROR up in OpenAlex, verify the returned ROR, and pass
   its OpenAlex id onward. That hydration is an identifier bridge, never a
   candidate selector. Missing/mismatched hydration returns review/no bind.

Capacity basis: the owner reports fewer than 1,000 review requests per cycle,
with about 15 default candidates per search plus user-recommended reviewers.
That is fewer than roughly 15,000 primary affiliation calls per cycle before
user additions, selective ordinary-query fallbacks, retries, and duplicate
reuse. A fallback for every default candidate would raise the primary-plus-
fallback bound toward 30,000 calls before user additions. ROR currently
documents 2,000 requests per five minutes per IP; depending on fallback rate,
roughly 66–133 fifteen-candidate searches in one five-minute window would reach
that ceiling before retries. Therefore peak burst rate is the operational gate;
total cycle volume does not justify a production local index or persistent
cache by itself.

Superseded from Claude's assessment, do not build from these:
- the three-tier design (exact-alias lookup as a *decisive* tier);
- "~110k ROR records" (live count is **132,706 active**, verified 2026-08-07);
- treating the raw or compact JSON as an already-approved bundled static asset.
  The 304.9 MB raw JSON exceeds Vercel's 250 MB standard path. Vercel offers a
  Large Functions/Fluid Compute path up to 5 GB, but this project's eligibility
  and configuration were not verified. The v2.11 measurement also found that
  the 80.4 MB compact JSON reached about 0.61 GB immediate post-parse process RSS
  while its input buffer remained referenced. Runtime packaging, steady-state
  memory, concurrency, and cold-start behavior remain unproven together;
- measuring cardinality from saved Dataverse candidates (survivorship-biased);
- "resolve-at-save may dominate the design" (withdrawn — resolution already
  happens at discovery *and* the save-time COI gate);
- "S2AFF never deploys" (reopened — profile before deciding).

## Claude's refinements to the model

Additive to Codex's five findings, not disagreements. Nothing here contradicts
the review.

1. **The falsification suite is the acceptance test for the veto set — wire it
   in first.** The 166 frozen cases already encode exactly the failures the
   vetoes must catch (sibling substitution, parent-mixed, multi-org, hierarchy,
   granularity). Add `adapters-scorer.js` and run it through the existing
   `run-comparator.js` against the same cases. That gives the new design a
   ready-made red/green target and makes it directly comparable to both prior
   systems. **Bar to beat:** ROR's 64 unsafe / 44 matcher-attributable, while
   exceeding the incumbent's 11/47 positive resolutions.

2. **Domain evidence has no transport today — this is a concrete API change.**
   `createInstitutionIdentityResolver().resolve(affiliation, { countryCode,
   signal })` has **no parameter for domain evidence**
   (`lib/services/institution-identity-resolver.js:217`). The cases carry it as
   `input.domain_evidence`, and the harness's `institutionResolve` adapter is
   handed the whole `input` object — so the suite can exercise a new signature
   the moment the resolver accepts one. Changing this boundary is a prerequisite
   for the domain veto, not a later refinement.

3. **`uc-sibling-domain` is a built-in progress metric.** That 20-case family
   currently discriminates *neither* system — both discard the evidence, one
   resolving unsafely (ROR 20/20 unsafe) and one abstaining blindly (incumbent
   20/20 "safe"). The moment domain evidence is consumable it becomes a real
   scoreboard. Treat movement there as the signal that the domain veto works.

4. **The versioned envelope needs explicit API provenance. IMPLEMENTED for the
   candidate benchmark.** The API-backed result records input/evidence hash +
   adapter version + API v2 + explicit
   `single_search` + observation date.
   Because no cross-request persistent cache is planned initially,
   release-wide invalidation is not yet a live storage problem. If durable
   caching is later justified, specify which fields trigger lazy recomputation
   before adding the schema.

5. **Two comparator-#1 review findings are now complete in benchmark v2**, not
   deferred cleanup:
   - **canonical expected ROR ids in the cases** now adjudicate the old naming
     artifacts without changing either frozen v1 run;
   - **relationship-aware pair evaluation** now measures ROR `same`,
     parent/child, `related`, successor, and distinct evidence independently of
     the still-planned WMKF consistency policy.

6. **Treat the first increment as a measurement vehicle, not a perf fix.**
   **BUILT in PR #113; production authority remains `legacy-default`:**
   `evaluateSuggestionsWithRuntimeSeam` now creates one resolver for the W2
   batch (`lib/services/reviewer-identity-runtime.js:364,384`), while the
   single-suggestion entry point retains a per-call default. The resolver
   single-flights only identical normalized institution/country keys sharing
   the same `AbortSignal`, caches only settled resolutions/definitive misses,
   and exposes aggregate counters (`institution-identity-resolver.js:217,261`).
   One data-minimized batch log reports calls, provider searches/hydrations,
   cache/single-flight hits, outcomes, cache size, and elapsed batch time; it
   changes no comparison row or reviewer response. This measures reuse; it does
   not establish a performance improvement. The
   `feedback-latency-plan-scope-accretion-postmortem` (S395) still applies.

## Harness constraints Codex should not trip over

- `run.js`, `judge()`, and everything under `cases/` are **frozen for
  comparability**. Both prior runs used byte-identical harness and cases;
  changing the judge (e.g. to ROR-id comparison) **resets the comparison and
  requires re-running every prior system**. That may well be worth doing — but
  it is a deliberate reset, not a tweak.
- `run-comparator.js` **refuses to overwrite an existing results slug**. New
  runs need new slugs; the frozen files are the record.
- The suite must stay **jest-invisible** — no `*.test.js` names under
  `benchmarks/`. Verify with `npx jest --listTests`.
- Comparator runs hit live providers. Per the incumbent baseline's hard-won
  lesson: **a uniformly abstaining resolver is a broken credential, not a
  result.**
- The deliberate ROR-id reset lives under `versions/v2/`; its manifest pins the
  v1 runner/cases, and both incumbent and ROR were rerun. v2 judges candidate
  recall/relationship evidence, not v1 final outcomes, so their pass counts are
  not interchangeable.

## Evidence trail

| Artifact | What it holds |
|---|---|
| `benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md` | Frozen incumbent baseline (+ 2026-08-07 addendum marking its artifact classification unadjudicated) |
| `benchmarks/fuzzy-matching-falsification/baseline/ror-chosen-2026-08-07.md` | Comparator #1, **corrected after review** — read the correction banner before quoting any figure |
| `outputs/institution-resolution-runtime-architecture-2026-08-07.md` | Claude's assessment — **superseded**, retained for the reasoning trail |
| `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` | Comparator list; S2AFF architecture description |
| `outputs/fuzzy-matching-owner-answers-2026-08-06.md` | The six owner answers this all serves (Q1: ambiguity must WIDEN checks) |
| `benchmarks/compact-ror-index/results/v2.11-2026-08-03.md` | Pinned release, deterministic compact-index sizes, component costs, and fresh-process load/memory evidence |
| `benchmarks/fuzzy-matching-falsification/versions/v2/results/2026-08-07-api-candidate-benchmark.md` | 128/141 ROR API vs 84/141 incumbent candidate/relationship run; 71/124 ROR resolve cases also contained a vetoed final-resolution candidate |
| [ROR REST API documentation](https://ror.readme.io/docs/rest-api) | Official endpoints, per-IP rate limit, client-identification policy, heartbeat/status guidance |
| [ROR affiliation documentation](https://ror.readme.io/docs/api-affiliation) | Affiliation matching contract and explicit warning that automatic matching can be wrong |

## Standing constraint

High-risk automation stays **review-only** until the representative 1–2k
benchmark exists (owner-parked, consequence accepted). Nothing in this model
changes that: the abstention path is a product requirement, not a fallback.
