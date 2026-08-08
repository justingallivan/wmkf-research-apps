---
title: Institution Resolution Offline Evaluation and Rollout Plan
domain: reviewer-identity
kind: plan
status: draft
summary: "Offline institution-resolution readiness plan using private cycle evidence, deterministic replay, live canaries, and bounded workload tests."
canonical: false
cataloged: 2026-08-07
owner: product-engineering
related:
  - docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
  - docs/REVIEWER_IDENTITY_CONTACT_HANDOFF.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - outputs/institution-resolution-handoff-to-codex-2026-08-07.md
---

# Institution Resolution Offline Evaluation and Rollout Plan

**Status:** Proposed for adversarial review  
**Decision date:** 2026-08-07  
**Reason for this plan:** Reviewer searching is complete for the current cycle, so
organic production shadow traffic will not provide a useful sample for roughly six
months. The rollout must therefore be evaluated with deliberately constructed tests
rather than by waiting for the next campaign.

## 1. Contract and scope

### Change surface

[PLANNED] Build a production-readiness evaluation harness for the API-backed ROR
institution resolver. It will combine a private completed-cycle corpus,
deterministic provider replay, an opt-in live-provider canary, and bounded workload
tests. Public-repository automation will use only public-registry and synthetic
fixtures; completed-cycle inputs and their per-case outputs remain outside Git.

### Entry points

[PLANNED]

- a read-only extraction script for completed-cycle institution evidence;
- an offline replay command used by developers against either the private corpus or
  public fixtures;
- a network-free public-fixture replay command used by CI;
- an opt-in live ROR/OpenAlex canary command;
- a bounded workload command with an explicit call cap and dry-run estimate; and
- Jest contract tests under `tests/unit/benchmarks/`.

### Persistence

- [VERIFIED] The production resolver branch adds no new application persistence,
  route, schema, or UI surface. See
  `lib/services/institution-resolution/ror-institution-identity-resolver.js` and
  `lib/services/reviewer-identity-runtime.js`.
- [PLANNED] The public repository will contain only schemas, validators, synthetic
  or public-registry fixtures, manifest hashes, and aggregate result summaries. It
  will not contain completed-cycle cases, completed-cycle cassettes, frequency
  weights, per-case cycle results, or reversible source mappings.
- [PLANNED] The private corpus and its cassettes/results remain in an
  access-controlled location selected before extraction. A gitignored local path is
  permitted only as temporary working storage with an approved private backup; it
  is never the sole retained copy.
- [PLANNED] The evaluation will not write to Dataverse, Postgres, Blob, or any
  application record. Every replay, canary, and workload runner injects explicit
  no-write `onShadowComparison`/`onShadowError` observers; offline CI also unsets all
  Postgres environment variables. Temporary raw extraction stays outside the
  repository and is deleted after private sanitization/adjudication. A later enabled
  production shadow uses the existing bounded comparison log, but that rollout is
  outside the harness's no-write execution boundary.

### Consumers

[PLANNED] The harness will be consumed by CI, the product owner, the resolver
implementer, and independent reviewers deciding whether `shadow` or `combined` may
be enabled. It will not be called by the live request path.

### Prior findings being carried forward

1. [VERIFIED] The frozen falsification asset contains 166 cases, of which 141 are
   institution cases. The v3 resolver passed all 141 with zero wrong automatic
   resolutions. See
   `benchmarks/fuzzy-matching-falsification/versions/v3/results/2026-08-07-api-decision-benchmark.md`.
2. [VERIFIED via the v2 loader] Those 141 institution cases contain 124 synthetic
   resolve cases and 17 pair-consistency cases; only 15 cases are marked real.
   Therefore the suite is a strong safety falsifier but not a representative traffic
   sample.
3. [VERIFIED] The benchmark README explicitly says the suite is insufficient for
   production threshold calibration, peak-burst capacity, and latency evidence.
4. [VERIFIED] Existing unit coverage exercises the production bridge and runtime
   failure contracts with injected providers, while the accepted live comparator
   exercises the shared decision core. No current suite combines representative
   completed-cycle inputs with the complete production ROR-to-OpenAlex bridge.
5. [OWNER INPUT, 2026-08-07] A normal search starts with about 15 recommended
   reviewers plus user-recommended additions; fewer than 1,000 review requests are
   processed per cycle. No more meaningful organic searches are expected for about
   six months.
6. [VERIFIED via `docs/audits/public-repository-pii-history-audit-2026-07-27.md`]
   This repository is public, and collections linking professional affiliations to
   internal role, selection, or cycle usage are confidential operational mappings.
   Removing a pushed fixture later would not remove it from reachable history.
7. [VERIFIED via `lib/services/discovery/verification.js`] The batch runtime seam is
   reached only by spine-routed Track-A verification (`searchPubmed === false` or a
   clearly non-biomedical proposal). It has two production entry points: reviewer
   discovery and Workbench applicant-recommended enrichment. Default PubMed-routed
   suggestions do not exercise this resolver.
8. [VERIFIED via `lib/services/reviewer-identity-runtime.js`] The current shadow
   batch is sequential, permits up to 15 seconds per candidate, and inherits the
   parent discovery abort signal. Shadow therefore preserves legacy objects but is
   not yet proven request-neutral for the shared discovery deadline.
9. [VERIFIED via `evaluateWorksFirstSuggestion`] The production institution call
   passes only `suggestion.suggestedInstitution`; country and domain evidence are
   not transported to this seam.

## 2. Non-goals

This plan does **not** authorize:

- enabling `shadow` or `combined` before the applicable gate below passes;
- changing any reviewer result, COI decision, identity write, or CRM link;
- packaging the ROR dump or compact index into the application;
- creating a cross-request cache or new database table;
- training a learned model or changing scorer thresholds before a frozen holdout
  exists;
- using ROR rank, score, or `chosen:true` as decision authority;
- treating an LLM-generated label or the resolver's own answer as ground truth; or
- committing completed-cycle cases, frequency distributions, private cassettes, or
  per-case private results to this public repository;
- treating a hash, pseudonym, or removal of names as a privacy control for
  production-derived operational data; or
- weakening the existing 1,000-2,000 representative-case gate for authoritative
  automation.

S2AFF remains a separately scoped challenger. It is not a prerequisite for building
this evaluation harness and must not expand this slice.

## 3. Invariants

| Invariant | Likely surfaces | Verification |
|---|---|---|
| Shadow mode returns the exact legacy objects, even when the new resolver succeeds, fails, times out, or logging throws. | runtime replay + existing runtime tests | identity/reference equality plus failure/timeout cases |
| Shadow work cannot consume either parent caller's deadline or abort an otherwise successful legacy run. | runtime budget seam + caller replays | skip when insufficient budget or use an independent bounded budget; forced shadow exhaustion leaves the parent result and signal usable |
| Shadow observability cannot escape the total shadow budget. Harness runs inject no-write observers; production logging must be bounded inside the certified allocation and skipped when that allocation is exhausted. | runtime observer seam + timing replay | zero-delay and worst-case-delay observers; no Postgres writes; parent deadline remains usable |
| Gate S uses the exact production field set: affiliation string only. Country/domain-assisted runs are capability evidence and cannot satisfy a production gate until those fields are transported by shipped code. | runtime replay + bridge tests | assertion on resolver inputs and separate report denominators |
| The representative denominator is the spine-routed Track-A population, not all reviewer suggestions, and is reported separately for discovery and Workbench applicant-recommended enrichment. PubMed-routed traffic is not claimed as covered. | extractor + sampling manifest | entry-point/routing classification and denominator report |
| A case can resolve only to one independently labeled canonical ROR ID; ambiguity is `review`, never a guessed winner. | case schema + judge | schema validation and complement tests for zero/multiple selected IDs |
| Expected labels are resolver-blind on every sealed holdout and independently checked on the calibration set. | label manifest | sealed assignment before resolver run; blind double-adjudication sample and disagreement ledger |
| No tracked fixture or result contains a completed-cycle input or distribution, reviewer name, email, ORCID, proposal/request ID, candidate key, raw production record ID, or private per-case result. | extractor, validators, Git guard, result writer | seeded forbidden files/fields must fail; tracked-file guard and secret/privacy scan run in CI |
| Completed-cycle extraction is read-only and allowlisted to institution evidence. | extraction script | dry-run count first; source uses read operations only; no create/update/delete/action/batch calls |
| Deterministic CI replay uses no network and no credentials. | cassette adapter + Jest | network is disabled/throws; tests pass with provider env variables unset |
| Live-provider execution is explicit, bounded, and cannot run accidentally in normal CI. | live canary/load runners | required opt-in flag, call cap, dry-run estimate, immutable result slug, and missing-key failure |
| ROR selects candidates; local policy selects at most one; OpenAlex may only hydrate and echo that ROR. | production bridge replay | mismatched/missing/multiple hydration fixtures must abstain |
| Every replay creates the ROR adapter/resolver per batch exactly as Production does; the module-level default singleton is forbidden at this seam. | replay construction + contract test | factory spy and independent concurrent batches |
| A production-shaped replay must prove the ROR bridge was invoked; overriding works-first wholesale cannot satisfy the gate. | runtime injection seam + call ledger | ROR adapter/bridge invocation count is positive for every applicable case and a bridge-skipping fixture fails |
| Provider errors, malformed 2xx responses, 429/5xx exhaustion, and cancellation cannot poison a later request. | cassette chaos cases | fail-first/healthy-second and cancellation replay |
| Public metrics/results are aggregate-only and contain no private case IDs, raw queries, evidence URLs, or organization names. Private diagnostics stay inside the approved private boundary. | reporters | seeded sensitive/raw input and private case identifiers must be absent from public serialization |
| Evidence URLs are organization-level only. | case validator | allowlist ROR and institutional root/about hosts; reject person, faculty, staff, and directory URLs |
| ROR label evidence is release-pinned. | private/public manifests | record ROR v2.11 release/checksum or an explicitly reviewed successor; live drift is diffed against the pinned record set |
| Frozen v1/v2/v3 benchmark files remain byte-identical. | manifests + existing tests | pinned hashes and `git diff` |

## 4. Evidence layers

The test program has four distinct layers. Passing one layer does not imply the
others passed.

### Layer A — existing adversarial falsification suite

[VERIFIED] Continue running the existing 141 institution labels unchanged. This is
the veto and abstention safety net, especially for sibling campuses, parent/campus
conflicts, multi-organization strings, hierarchy, domain, and country contradictions.

Do not edit its frozen runner, judge, cases, or accepted results. Any new readiness
corpus lives in a separate directory and has its own versioned contract.

### Layer B — private representative completed-cycle corpus

[PLANNED] Build a new corpus from completed-cycle institution evidence. The corpus,
its frequency weights, its cassettes, and its per-case results are private
operational data and never enter Git. The public repository retains only their
schema, validator, corpus-manifest hash, aggregate denominators/slice metrics, and
safe public/synthetic examples. A hash supports integrity and run correlation; it
does not make the underlying data anonymous.

#### Extraction boundary

Before extraction, the owner must select the private storage location, access list,
backup/retention owner, and deletion rule. The extractor will then:

1. Probe and document the exact Dataverse read fields and cycle boundary before
   extracting anything. Field availability is [ASSUMED] until that probe is run.
   A local/Preview read of Production requires `DATAVERSE_ALLOW_PROD_READS=yes`, a
   trusted DAL context, and the Dataverse target interlock. Dry-run must print the
   redacted deployment x target-host classification x `read` policy decision before
   querying. No ad hoc bypass is permitted. The request-time `searchPubmed` toggle is
   not persisted; retrospective routing may use the stored primary research area but
   must mark the toggle leg unknown rather than infer it.
2. Read only institution/affiliation evidence and the minimum non-identifying fields
   needed to stratify source and frequency.
3. Discard reviewer names, emails, ORCIDs, proposal text, request IDs, suggestion
   IDs, contact IDs, and all other person- or record-identifying fields before any
   file is written.
4. Remove embedded email addresses, URLs containing user identifiers, phone numbers,
   and other contact fragments from affiliation text. A case that cannot be safely
   separated from person data is excluded rather than redacted heuristically.
5. Deduplicate sanitized institution inputs while retaining a private frequency
   weight and source class. Neither value is published at case level.
6. Emit a dry-run summary by stratum before emitting candidate cases.

No completed-cycle corpus is tracked, even if sanitization removes direct
identifiers. The extractor refuses an output path inside the repository other than
an explicitly gitignored private working directory, and a repository gate rejects
any tracked file under that directory.

#### Sampling

The first representative release contains **at least 250 adjudicated cases**. For
each batch entry point seeking Gate S, at least 100 cases are sealed holdout groups
and at least 50 (50%) of that caller's holdout must be cycle-derived and spine-routed.
If both callers are gated, the release therefore contains at least 200 sealed holdout
groups and 100 cycle-derived holdout groups. Entry-point shares are fixed before
adjudication, so neither gate can pass on a mostly synthetic holdout. There is no
exception below those floors; with zero observed errors, 100 cases gives only an
approximate one-sided 95% upper error bound of 3% (the rule of three), which is
already the minimum acceptable shadow evidence. If fewer eligible cycle-derived
groups exist, use all of them and supplement with public-registry/synthetic cases
while reporting the exact historical denominator and share. If a caller supplies
fewer than 50 eligible cycle-derived holdout groups, the harness may still be built
and reported but Gate S cannot pass for that entry point. Only cycle-derived cases
contribute to frequency-weighted traffic metrics.

The representative populations are the completed-cycle Track-A cohorts from both
production callers that would route through
`suggestionVerifierRouting(...).verifier === 'spine'` under recorded production
options: reviewer discovery and Workbench applicant-recommended enrichment.
PubMed-routed suggestions and contact-enrichment `evaluateExistingResult` calls are
reported separately; they cannot be used to claim Gate S coverage for the batch
seam. Sampling is frequency-aware but must retain difficult minority strata:

- clean institution names and common abbreviations;
- department/lab/address-decorated affiliations;
- acronyms and punctuation variants;
- parent systems, campuses, hospitals, laboratories, foundations, and institutes;
- multi-organization strings;
- domestic and international institutions;
- strings with compatible and contradictory country/domain evidence;
- high-frequency repeated inputs and one-off long-tail inputs; and
- expected resolved, review, and unresolved outcomes.

Synthetic or public-registry cases may fill a missing stratum, but their origin must
be explicit and they do not count toward the completed-cycle denominator or its
frequency-weighted measurements.

#### Independent labels

Each private case receives:

- expected outcome: `resolved`, `review`, or `unresolved`;
- exactly one expected canonical ROR ID when resolved;
- forbidden ROR IDs for known severe alternatives;
- an error-severity class for any wrong resolution;
- label status and adjudicator;
- official evidence links, limited to the ROR record and institutional root/about
  pages where necessary; person, faculty, staff, and directory URLs are forbidden;
- the pinned ROR release/checksum used as canonical evidence; and
- a grouping key plus first-split-assignment provenance used to keep related
  variants out of different tuning/holdout sets.

The sealed holdout is labeled without exposing any resolver output to adjudicators.
The calibration corpus is also labeled independently; at least 20% is blindly
double-adjudicated before resolver results are revealed. Record disagreement rate
and resolve every disagreement through review. The primary and tie-breaking
adjudicators are named before Phase 2. A resolver proposal may be shown only after a
calibration label is sealed for error investigation; it is never copied into
`expected`.

The corpus is grouped by institution and variant family before splitting. Split
assignment is monotonic across releases: a group first assigned to calibration can
never appear in a later holdout. Threshold tuning may use the calibration portion;
Gate C's final holdout contains only new, previously unseen groups and remains sealed
until a candidate configuration is frozen.

### Layer C — deterministic production-path replay

[PLANNED] Capture and normalize the public provider evidence needed to replay the
actual production path without network access:

- ROR v2 affiliation, ordinary-query, successor, and parent responses;
- OpenAlex ROR hydration responses; and
- provider error, malformed-body, timeout, retry, and mismatch responses.

Public-fixture cassettes are tracked and contain only public organization evidence.
Completed-cycle cassettes are private and remain beside the private corpus. Both may
use one-way request hashes for deterministic lookup and integrity, but hashes provide
no privacy guarantee. A small raw-response parser contract remains separate from the
larger normalized replay corpus so parser drift cannot be hidden by hand-normalized
data.

The replay must exercise:

1. `createRorCandidateUnionAdapter` request construction and response parsing;
2. `createInstitutionDecisionResolver` veto/scoring/abstention;
3. `createRorInstitutionIdentityResolver` exact-one-ROR OpenAlex hydration;
4. `prepareShadowRunDependencies` and `ReviewerIdentityRuntime` with production
   factories/default pace, request budget, and timeout values;
5. the public batch entry point `ReviewerIdentityRuntime.evaluateSuggestions` using
   its hooks seam, and the internal
   `_internals.evaluateExistingResultWithRuntimeSeam` for dependency-injected
   combined replay (plus a wrapper contract proving the public
   `evaluateExistingResult` delegates to that implementation);
6. explicit injected OpenAlex works-search, author-profile, ROR-hydration, and
   ORCID-profile dependencies. Phase 0 adds the missing works/author injection seam;
   replacing `evaluateWorksFirst` wholesale is forbidden because it suppresses
   institution-resolver construction;
7. a positive per-case call ledger proving the ROR adapter and exact-one-ROR bridge
   were actually invoked whenever an affiliation was present;
8. explicit no-write `onShadowComparison` and `onShadowError` observers for every
   harness run; and
9. shadow deadline isolation/skip behavior, including forced exhaustion that cannot
   abort the parent legacy operation; and
10. PII-free metrics/result serialization.

Gate reports distinguish two replay profiles:

- **production-shape:** affiliation string only, through the actual runtime seam;
  this is the only profile that counts toward Gate S or Gate C today; and
- **capability-only:** optional country/domain evidence supplied directly to the
  bridge; this is reported separately and cannot satisfy a production gate until a
  shipped caller transports those fields.

Network access is replaced by an injected fetch implementation that throws on an
unrecorded request. That makes a new provider call, query variant, or accidental
network dependency an explicit test failure. Injection is through the explicit
provider seams above, not a wholesale works-first stub; a seeded bridge-skipping
configuration must fail the replay.

### Layer D — opt-in live API canary and workload probe

[PLANNED] The live canary runs a small, frozen cross-section against current ROR and
OpenAlex. It is a drift detector, not the source of expected labels.

Requirements:

- explicit `ALLOW_LIVE_INSTITUTION_EVAL=1` opt-in;
- required OpenAlex key presence without printing it;
- explicit no-write shadow observers and a fail-loud assertion that no Postgres
  environment variable is available to the harness process;
- `ROR_CLIENT_ID` configured status recorded as present/absent without printing its
  value, plus a dated re-verification of current ROR client-ID and rate-limit policy;
- a dated OpenAlex API quota/rate-policy check and remaining-budget preflight that
  records no key value;
- immutable result slug and observation timestamp;
- API/adapter versions, request strategies, counts, retries, failures, and latency;
- no raw affiliation strings or organization names in the result summary;
- immediate failure on missing credentials rather than uniform abstention; and
- no automatic fixture rewrites when a provider result changes; and
- comparison of current ROR records with the pinned label release; drift is
  adjudicated rather than silently accepted.

The workload probe models these batches:

| Scenario | Candidate count | Purpose |
|---|---:|---|
| Default, each batch entry point | 15 | owner-reported normal discovery plus a matched Workbench batch |
| Default plus additions, each entry point | 25 | common user-added headroom |
| Stress | 50 | bounded outlier, not a normal forecast |
| Concurrent requests | 1, 3, then 5 independent resolver batches | detect aggregate pacing/rate-limit behavior |

Before any live workload run, dry-run prints the case count and separate worst-case
ROR and OpenAlex request bounds. The runner requires separate explicit call caps and
aborts before exceeding it. Every concurrent batch constructs its own
resolver/adapter, matching the production per-request factory. A test forbids use of
the module-level default adapter. Concurrency steps advance only after the prior
step's failures are recorded and adjudicated; a failed observation is never erased
by rerunning until green.

The dry-run bounds are derived before network access as:

- `ROR per-resolution-scope cap x candidate count x concurrent batch count`; and
- `OpenAlex per-resolution-scope cap x candidate count x concurrent batch count`.

Phase 0 adds and tests a unified per-resolution OpenAlex budget covering works
searches, ROR hydration, every author-profile/anchor-matcher lookup, and combined-mode
OpenAlex author-by-ORCID hydration; the currently uncapped author loop must consume
that budget and stop safely. Retries and subrequests are inside their provider's
scope cap and are never silently omitted. The runner refuses a scenario whose
arithmetic bound exceeds its explicit provider cap, the dated ROR ceiling, or the
available OpenAlex quota; observation is not used as the first line of rate-limit
enforcement.

Measure per case and per batch:

- ROR requests, fallbacks, hydrations, retries, cache/single-flight reuse;
- resolved/review/unresolved counts;
- provider failures and deadline abstentions;
- p50, p95, and maximum latency;
- batch wall time; and
- requests per candidate and per completed batch.

## 5. Case and result contracts

### Private case schema

The exact private schema will be versioned and validated. The example below describes
the access-controlled corpus contract; it is not a tracked fixture. Public fixtures
use the same decision fields but omit cycle origin, frequency, and source linkage.
Its minimum shape is:

```json
{
  "schema_version": 1,
  "id": "cycle-inst-0001",
  "origin": "completed_cycle",
  "source_class": "saved_candidate_affiliation",
  "frequency_weight": 4,
  "group": "institution-and-variant-family",
  "first_split_assignment": {
    "split": "calibration",
    "release": "readiness-v1"
  },
  "split": "calibration",
  "input": {
    "affiliation_string": "Sanitized institution-only text",
    "country_code": "US",
    "domain_evidence": "example.edu"
  },
  "expected": {
    "outcome": "resolved",
    "ror_ids": ["https://ror.org/000000000"],
    "must_not_ror_ids": []
  },
  "label": {
    "status": "verified",
    "adjudicator": "owner",
    "evidence": ["https://ror.org/000000000"],
    "ror_release": "v2.11-2026-08-03",
    "ror_release_sha256": "pinned-manifest-value"
  }
}
```

The illustrative ROR ID above is not a real label and must not appear in the final
corpus.

### Result schema and publication boundary

Private result files may contain case IDs, expected/actual decisions, and selected
ROR IDs for adjudication. They stay with the private corpus. Public aggregate
summaries contain:

- aggregate failure reason/severity counts and aggregate slice metrics;
- provider and latency counts;
- source commit, case/cassette/manifest hashes, and observation date; and
- the completed-cycle denominator and broad pre-approved strata, without per-case
  frequency or a small-cell breakdown that could reconstruct operational mappings;
- no raw input, per-case cycle output, names, emails, organization names, evidence
  URLs, or provider credentials.

Detailed diagnostic output may be generated only in the private workspace for
adjudication. Hashes in either result class establish integrity/correlation only and
must never be described as anonymization.

## 6. Metrics and decision gates

### Correctness metrics

Report both unweighted and frequency-weighted values:

- resolved-only precision and recall;
- coverage;
- correct abstention rate;
- wrong automatic resolution count and rate;
- review-band capture of unsafe cases;
- ROR-to-OpenAlex hydration success/mismatch rate; and
- slice results by source class, institution family, input shape, country, and
  difficulty.

For Gate C, also report candidate-level legacy-to-combined transitions:
`bind -> review`, `review -> bind`, `abstain -> bind`, and their reverse transitions.
The owner must select a maximum net recall-loss rate before the final holdout opens;
a gate cannot pass while that ceiling is unset.

Any aggregate score is subordinate to the wrong-resolution ledger. A model cannot
average away one severe sibling-campus, unrelated-organization, or parent/campus
error.

### Gate S — permit non-authoritative `shadow`

All of the following are required:

1. The deterministic frozen 141-case institution comparator remains 141/141 with
   zero wrong automatic resolutions. A live v3 rerun is separate drift evidence:
   use a new immutable slug, record its request cap/count, adjudicate every delta,
   and permit at most one confirmation rerun after a diagnosed correction. Never
   rerun until green.
2. At least 250 independently adjudicated cases exist. Each entry point seeking the
   gate has at least 100 sealed holdout groups and at least 50 cycle-derived spine-
   routed holdout groups; gating both therefore requires at least 200/100 across
   those two categories. Floors have no exception. Report each entry point's exact
   cycle-derived denominator/share and supplement count. One caller cannot borrow the
   other's evidence.
3. The production-shape, string-only sealed holdout has zero wrong automatic
   resolutions. Country/domain-assisted results are capability-only.
4. Deterministic production-path replay is fully green, including seeded failures
   that would pass if fallback, privacy, per-request-factory, or hydration guards were
   absent. The ROR adapter and exact-one-ROR bridge have positive invocation counts;
   a wholesale works-first override or bridge-skipping replay fails.
5. Shadow replay returns the exact legacy objects for every success and failure case,
   and a forced shadow timeout/exhaustion cannot abort, shorten, or consume either
   caller's otherwise successful parent operation. Workbench applicant-recommended
   verification must forward its existing deadline signal before its gate can pass.
6. For both 15- and 25-candidate batches, measured added shadow wall time fits inside
   the configured parent budget with an owner-approved safety margin, measured
   separately for reviewer discovery and Workbench applicant-recommended enrichment.
   The shipped runtime must either skip shadow when remaining budget is insufficient
   or use a genuinely independent bounded budget; measurement alone cannot waive
   this requirement. The certified allocation includes the observer path: replay
   covers zero-delay and worst-case observer latency, and production logging is
   inside the allocation with a best-effort skip when no observer budget remains.
7. Case/publication-boundary validators (including the [PLANNED] privacy validator),
   the private-path tracked-file guard, the existing secret scan, and relevant
   repository gates pass.
8. Live ROR policy is reverified on the observation date. The report records the
   applicable request ceiling and whether `ROR_CLIENT_ID` is configured, without its
   value. OpenAlex rate/quota policy and available keyed budget are also reverified
   without recording the key.
9. The live canary has three scheduled observations within one week; at least two are
   free of provider failure and decision drift. Every failed observation is retained
   and adjudicated, and all observations have zero wrong automatic resolutions and
   zero unexplained ROR/OpenAlex hydration mismatch.
10. The 15- and 25-candidate workload observations use independent per-batch
    adapters for both entry points, pass separate ROR and OpenAlex pre-run
    `(provider scope cap x candidates x batches)` ceiling checks, remain within both
    recorded provider limits, and have no unaccounted deadline exhaustion.
11. The owner reviews the latency/request baseline and records an explicit operational
    threshold and safety margin. Until those thresholds are selected, shadow remains
    off.

Shadow remains comparison-only. Passing Gate S does not authorize `combined`.

### Gate C — permit authoritative `combined`

All Gate S requirements remain in force, plus:

Gate C authorizes combined mode separately for the two spine-routed Track-A batch
entry points: reviewer discovery and Workbench applicant-recommended enrichment.
Because the current environment variable is global, Phase 0 must first add
entry-point-scoped modes and keep contact-enrichment `evaluateExistingResult` in
`legacy`. Contract tests prove enabling one batch caller cannot change either the
other caller or contact enrichment. Contact-enrichment combined rollout requires its
own representative corpus, sealed holdout, transition ledger, and owner gate; it is
not authorized by this plan.

1. The representative benchmark reaches **1,000-2,000 adjudicated cases**. The final
   sealed holdout contains at least **500 new, previously unseen groups**, with at
   least 100 for each batch entry point. With zero observed errors, 500 cases yields
   an approximate one-sided 95% upper error bound of 0.6%; the per-entry-point
   100-case slices have only an approximate 3% bound. These floors have no exception.
2. Thresholds, decision policy, and the owner-approved maximum net recall-loss rate
   are frozen before opening the final grouped holdout.
3. The production-shape final holdout has zero wrong automatic resolutions, including
   zero sibling-campus, unrelated-organization, or parent/campus errors.
4. Leave-one-campus-out and leave-one-variant-family-out evaluations meet the same
   zero-wrong-resolution rule.
5. Every provider-error, ambiguity, malformed-response, cancellation, and hydration-
   mismatch case returns the exact legacy row for that candidate.
6. Direct dependency-injected `evaluateExistingResultWithRuntimeSeam` replay covers
   the combined algorithm and fallback contract, while the public enrichment wrapper
   remains legacy under the new entry-point-scoped modes. Separate discovery and
   Workbench candidate-transition ledgers stay within the approved net recall-loss
   ceiling.
7. Live canaries on at least three separate observation dates show no unexplained
   decision drift. Provider drift is adjudicated; expected labels are never updated
   merely to match the provider.
8. The modeled concurrent workload, using one production-shaped resolver per batch,
   remains inside the recorded operational limit.
9. A fresh adversarial review, owner sign-off, rollback target, and post-deploy smoke
   plan are recorded.

If the benchmark cannot reach this denominator or gate, `combined` remains disabled;
that is an acceptable outcome.

## 7. Implementation sequence

### Phase 0 — isolate buildable layers and prerequisites

1. Build public schemas, validators, safe fixtures, decision-core replay, and bridge
   replay independently of PR #116's merge state.
2. Treat runtime replay and any production-mode observation as dependent on the
   reviewed runtime slice landing; do not couple the evaluation plan's merge to that
   PR.
3. Before Gate S, implement and characterize the shadow-budget isolation/skip seam so
   shadow cannot consume either parent deadline. Forward
   `deadlineController.signal` from Workbench applicant-recommended enrichment into
   `verifyClaudeSuggestions`; add a regression proving timeout/cancellation reaches
   that runtime batch.
4. Put shadow comparison/error observation inside the same total budget and skip the
   best-effort write when no observer allocation remains; characterize zero-delay and
   worst-case observer behavior.
5. Add explicit dependency injection for OpenAlex works search and author lookup so
   runtime replay can use cassettes without replacing works-first or skipping the ROR
   bridge. Preserve production defaults when hooks are omitted.
6. Add a unified per-resolution OpenAlex provider budget covering works, institution,
   author/anchor, and OpenAlex author-by-ORCID calls; the author loop must fail safe
   when its budget is exhausted.
7. Before any mode change, add entry-point-scoped controls for reviewer discovery,
   Workbench applicant-recommended verification, and contact enrichment. Each
   defaults independently to legacy; Gate S/C can promote only the caller whose
   evidence passed.
8. Verify every deployed resolver mode normalization before any live observation.

### Phase 1 — schema, validators, and read-only inventory

1. Create `benchmarks/institution-resolution-readiness/README.md`.
2. Define the versioned case, cassette, and result schemas.
3. Build validators first, including seeded tests proving forbidden PII and invalid
   labels are rejected.
4. Select the private storage/access/backup/retention owners and name the primary and
   tie-breaking adjudicators. No extraction occurs before these decisions.
5. Add a fail-closed Git guard parameterized by the selected private working path and
   private artifact patterns.
6. Probe the completed-cycle source fields and counts without writing an extract,
   using the trusted DAL context and target-interlock policy described above.
7. Publish only an approved aggregate stratum/count inventory, applying the same
   minimum-cell-size/suppression rule as public results, and confirm the sampling
   design.

### Phase 2 — extraction and adjudication

1. Implement the read-only extractor with dry-run as its default.
2. Produce a candidate file in the approved private location; temporary raw files
   remain outside the repository.
3. Sanitize, deduplicate, and stratify.
4. Adjudicate labels resolver-blind, double-adjudicate the required calibration
   sample, and group related variants before monotonic split assignment.
5. Freeze at least 250 cases plus, for every entry point seeking Gate S, at least 100
   holdout groups with 50 cycle-derived groups. Commit only schema-valid public
   fixtures, the private manifest hash, and approved aggregate denominators.

### Phase 3 — deterministic replay

1. Capture the minimal public-fixture ROR/OpenAlex cassette set and store any
   completed-cycle cassettes privately.
2. Capture public ROR cassettes for all 141 frozen institution cases and implement a
   deterministic adapter module for the existing immutable v3 runner contract; this
   is distinct from the capped live v3 adapter/run.
3. Add the fail-closed cassette fetcher.
4. Run the actual adapter, resolver bridge, and runtime seams with explicit provider
   injection and no-write observers.
5. Add chaos/cancellation/cache-poison/fallback/privacy/bridge-invocation cases.
6. Add only the public-fixture offline replay to CI after proving it needs no network,
   provider credentials, or Postgres configuration.

### Phase 4 — live canary and capacity calibration

1. Reverify ROR API/client-ID and OpenAlex keyed quota/rate policy; record separate
   applicable ceilings without credential values.
2. Run the frozen canary on the three scheduled observations, preserving every
   failed observation.
3. Run 15- and 25-candidate batches for both production entry points with their
   production defaults, field set, and propagated parent signals.
4. Advance through 1, 3, and 5 concurrent independent resolver batches only after
   adjudicating the prior step.
5. Record latency, separate ROR/OpenAlex call counts, fallback, drift, and failure
   baselines by entry point.
6. Select and document each entry point's operational threshold and parent-budget
   safety margin required by Gate S.

### Phase 5 — review and rollout decision

1. Run all relevant tests and paired repository gates.
2. Obtain a fresh adversarial review of the code, fixtures, labels, and reports.
3. Reconcile durable state claims with `/sweep`.
4. Present Gate S evidence to the owner.
5. Treat a shadow enablement as Tier 2 runtime work: complete a Mode B Preview/local
   production-read rehearsal, record the last-known-good deployment, rehearse the
   mode rollback, and obtain an explicit owner decision. The harness's legacy,
   shadow-preservation, timeout, and observer tests provide the required current-
   behavior characterization; record that evidence in the rollout receipt.
6. If Gate S and the Tier 2 controls pass, enable only `shadow`, redeploy, and run a
   bounded staff rehearsal and production smoke.
7. Continue expanding toward Gate C offline; do not wait for organic traffic to build
   the authoritative benchmark.

## 8. Planned file surface

Exact names may change during implementation review, but the intended boundary is:

```text
benchmarks/institution-resolution-readiness/
  README.md
  public-cases/
  public-cassettes/
  manifests/
  results/
  schema.js
  validate-cases.js
  validate-publication-boundary.js
  adapters-ror-cassette-v3.js
  run-replay.js
  run-live-canary.js
  run-load-probe.js

scripts/
  extract-institution-resolution-cycle-cases.mjs

tests/unit/benchmarks/
  institution-resolution-readiness.test.js

# gitignored or external; never tracked
<approved-private-location>/institution-resolution-readiness/
  cycle-cases/
  cycle-cassettes/
  case-results/
```

The benchmark directory stays Jest-invisible; executable Jest coverage lives under
`tests/unit/benchmarks/`. The public `results/` directory contains aggregate private-
corpus receipts or per-case public-fixture results only.

## 9. Verification matrix

| Surface | Required verification |
|---|---|
| Source inventory | trusted-DAL read-only probe, interlock classification, explicit spine-routed cycle denominator, no writes |
| Case schema | valid resolved/review/unresolved cases plus seeded invalid/PII cases |
| Privacy boundary | private path excluded from Git, seeded tracked-private-artifact rejection, aggregate-only public receipt |
| Frozen assets | pinned ROR release/checksum, manifest hashes, immutable result slugs, diff check |
| Decision core | existing v2/v3 tests, deterministic 141-case comparator, capped separately reported live rerun |
| Production bridge | exact-one-ROR hydration, mismatch/null/error/cancel/cache cases |
| Runtime | independent legacy defaults by entry point, production string-only field assertion, explicit works/author injection, positive ROR-bridge invocation, exact shadow preservation, discovery and Workbench parent-signal propagation, parent/observer-budget isolation, scoped combined modes, combined per-row fallback, direct existing-result replay |
| Offline replay | network-disabled run with provider and Postgres env variables unset, plus explicit no-write observers |
| Live canary | explicit opt-in, OpenAlex key present, ROR client-ID status, 2-of-3 clean rule, pinned-release drift diff, versioned reports |
| Workload | separate ROR/OpenAlex dry-run estimates and caps, bounded author loop, 15/25/50 batches for both entry points, independent per-batch adapters, staged concurrency, per-entry-point parent-budget margin |
| Privacy | evidence-host allowlist, fixture/result allowlists, seeded forbidden data, existing secret scan, and [PLANNED] publication-boundary privacy validator |
| Docs | docs catalog, symbol references, build-claim freshness, fact consistency |

## 10. Contract-reconciliation audit

1. **Whole-flow:** [PLANNED] trusted-DAL completed-cycle read -> private sanitizer ->
   resolver-blind adjudicated case -> private cassette/live provider -> production
   per-request adapter -> decision -> OpenAlex hydration -> runtime budget boundary ->
   comparison/fallback -> private per-case result -> public aggregate receipt -> Gate
   S/C decision.
2. **Partial success:** [PLANNED] private results are per-case, not count-only. Every
   failed, errored, skipped, and abstained private case retains its ID and reason; a
   run cannot report success when all cases failed or skipped. Public receipts remain
   aggregate-only.
3. **Async/stale state:** [PLANNED] CLI-only runners carry one abort signal and hard
   deadline per case/batch. No UI state exists. Harness observers are explicit
   no-writes. Cancellation, observer delay, and post-timeout activity are tested;
   result artifacts are written only after the run settles.
4. **Helper extraction:** [PLANNED] shared schemas/judges may normalize ROR IDs and
   compare outcomes, but must not collapse `review` into `unresolved`, candidate
   retrieval into resolution, or relationship compatibility into same-entity
   identity.
5. **Durable surface:** [PLANNED] tracked public benchmark assets require schema
   validators, private-path guards, manifest hashes, cap/retention rules, tests, docs
   catalog coverage, and immutable result slugs. Private corpus/cassettes/results
   require access, backup, retention, and deletion owners. No migration, Atlas entity,
   or API route change is expected.
6. **Doc reconciliation:** [PLANNED] implementation completion requires `/sweep` over
   this plan, the active handoffs, research memo, session prompt, and roadmap wiki.
7. **Symbol fan-out:** N/A for this plan: it introduces no application enum, status,
   persisted column, or route. If implementation changes one, this audit must be
   reopened.

## 11. Owner decisions still required

Public schemas, validators, and synthetic/public replay can be implemented without a
new owner decision. Before any completed-cycle extraction, the owner must approve:

1. the private storage location, access list, backup/retention owner, and deletion
   rule; and
2. the primary and tie-breaking human adjudicators.

Before Gate S can pass, the owner must approve:

1. the final representative sampling strata (there is no exception below 250 total
   or, for each gated batch entry point, 100 sealed holdout and 50 cycle-derived
   holdout cases);
2. each entry point's operational latency/request thresholds and parent-budget safety
   margin;
3. the production shadow observation period and which independently gated entry
   point(s) to enable; each cohort is the complete spine-routed population for that
   caller during the window, with Workbench applicant-recommended runs included; and
4. the Tier 2 Preview rehearsal, rollback evidence, and production mode change.

Before Gate C can pass, the owner must separately approve the authoritative-mode
precision/coverage policy, maximum net recall-loss rate, and production cutover.
Silence never enables a mode.

## 12. Rollback and cleanup

The harness itself has no production rollback because it performs no production
writes. Cleanup consists of deleting temporary raw extracts under the approved
retention rule and quarantining any private result that fails validation. A privacy
failure blocks publication; hashing or redacting the failed file is not a remedy.

For a later shadow enablement, rollback is the resolver-mode change back to `legacy`
followed by a redeploy. For a later combined enablement, the plan must record the
last-known-good deployment and verify that mode rollback restores exact legacy
behavior without requiring data repair.
