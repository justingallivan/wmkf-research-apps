---
title: Reviewer Page-First Email Experiment Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Completed staged page-first email experiment: safe but only +1/20 on the fresh cohort, so the cascade was not promoted."
canonical: false
cataloged: 2026-07-18
owner: product-engineering
related:
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/audits/reviewer-serpapi-contact-strategy-adversarial-2026-07-18.md
  - outputs/reviewer-holistic-m1/reviewer-email-serp-lab-query-variants-v1.json
  - scripts/evaluate-serp-lab-query-variants.mjs
  - lib/services/contact-enrichment-service.js
  - lib/services/contact-enrichment/page-email.js
  - lib/utils/reviewer-invite.js
---

# Reviewer Page-First Email Experiment Plan

## Outcome — complete, do not promote (2026-07-18)

The experiment ran through all three predeclared stages. It remained read-only:
every enrichment prepass used `persist:false`, provider output never became
sendable without fetching and grounding a first-party institutional page, and
the only writes were ignored local JSON artifacts. `[VERIFIED via evaluator
artifacts and script contract]`

- **Stage 1:** after correcting a resolved-page attribution bug and replaying
  the saved searches without new SerpAPI calls, the current-query arm produced
  1/13 ready primary subjects and page-first produced 3/13, meeting the +2
  screen. Five deduplicated outcomes, including the two controls, were manually
  adjudicated correct; none was `wrong_person`.
- **Stage 2:** both virtual orderings produced 5/13 correct-ready subjects.
  Claude-first required 22 measured provider calls versus 27 for Serp-first;
  its median was 8.3 seconds and p90 was 19.5 seconds. Claude-first was selected
  for the fresh validation because it saved five calls with equal yield and a
  slightly better p90.
- **Stage 3:** a deterministic, fresh cohort was frozen from the M1 source:
  20 new-to-WMKF thin-footprint subjects, exactly 10 US and 10 non-US, excluding
  all people in the prior 40-case artifact and the David Liu/Feng Zhang
  controls. The current arm produced 1/20 correct-ready subjects; the selected
  Claude-first cascade produced 2/20, a gain of only **+1** versus the required
  **+3**. It produced no non-US ready subjects, used 70 provider calls, and had
  p90 latency of 23.7 seconds. All three deduplicated review rows were manually
  adjudicated correct; none was `wrong_person`.

**Decision:** do not promote or reorder the production paid tiers. Preserve
first-party page links as staff research leads, keep raw Claude/Serp emails
`research_only`, and retain the already-live NCBI + Europe PMC core-record
structured tier. A subsequent W3.1 `fullTextXML` fallback trial added 0/40
addresses and was also not promoted. No production behavior or environment
configuration changed. `[VERIFIED via Stage 3
promotionDecision.status='do_not_promote' and
outputs/reviewer-holistic-m1/reviewer-email-scholarly-fulltext-40-v2.json]`

The experiment used an owner-approved evaluation-only fallback from an absent
identity-anchored domain to a strongly matched claimed-institution domain. That
authorization existed only inside cloned evaluator state; the production
anchored-domain fetch policy was not weakened.

Authoritative local evidence:

- `scripts/evaluate-reviewer-page-first-email.mjs`
- `scripts/select-reviewer-page-first-stage3-cohort.mjs`
- `outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-replay-v1.json`
- `outputs/reviewer-holistic-m1/reviewer-email-page-first-stage2-v1.json`
- `outputs/reviewer-holistic-m1/reviewer-email-page-first-stage3-cohort-v1.json`
- `outputs/reviewer-holistic-m1/reviewer-email-page-first-stage3-v1.json`

The remaining sections preserve the pre-execution protocol. Their `[PLANNED]`
labels describe the historical design state; this outcome section is
authoritative for what actually ran.

## Decision this experiment must support

Should the reviewer resolver use SerpAPI/Google to find candidate-specific
first-party pages, then run the existing page-grounding tier, for new reviewers
whose structured scholarly sources did not produce a usable address?

This was a read-only evaluation plan, not an authorization to change production
ordering or send policy. The completed experiment did not authorize a change.
`[VERIFIED outcome above]`

For execution design, this document supersedes only the companion audit's
large-cohort “Next Experiment” section; the audit's findings and evidence remain
the rationale. `[PLANNED]`

The experiment is intentionally staged. It stops after a 13-person hard-case
screen unless page-first discovery creates enough invitation-ready addresses to
justify more work. The owner manually reviews only deduplicated, would-be-ready
outcomes—not every query result, snippet email, candidate-by-arm cell, or
first-party page. `[PLANNED]`

## What the adversarial review changed

1. A raw email in a Google or Claude search result is not the endpoint. Current
   `emailConfidence` classifies `serp_search`, `claude_search`, and
   `search_contested` as `research_only`; they cannot be used for a first
   invitation. `[VERIFIED via lib/utils/reviewer-invite.js and the send-path trace
   in the companion audit]`
2. The useful Google output is a candidate-specific first-party **page URL**.
   The existing page tier fetches a URL only under an anchored institution
   domain and promotes an address to `institution_page` only when the page
   grounds the address to the candidate. `[VERIFIED via
   lib/services/contact-enrichment/page-email.js]`
3. The current paid-tier order cannot use the OpenAlex-resolved institution
   domain: Claude and SerpAPI run before `_finalize`, while OpenAlex metrics,
   identity resolution, domain evidence, and page grounding run inside
   `_finalize`. `[VERIFIED via lib/services/contact-enrichment-service.js and
   lib/services/contact-enrichment/tiers.js]`
4. The previous 40-person query-variant experiment measured raw search evidence,
   not page-grounded sendable yield, and it did not compare Claude with SerpAPI.
   `[VERIFIED via
   outputs/reviewer-holistic-m1/reviewer-email-serp-lab-query-variants-v1.json
   and the companion audit]`

Therefore this plan tests a small identity/domain prepass followed by
page-oriented Google queries. It does not relax any name, domain, grounding, or
send gate.

## Scope

### In scope

- The 13 frozen candidates for whom the 40-person scholarly reference artifact
  contained no structured address evidence.
- David Liu and Feng Zhang as named multi-affiliation stress controls, each
  evaluated once under the university affiliation and once under Broad. Their
  outcomes are reported separately and never added to the primary numerator or
  denominator.
- A read-only identity/domain prepass.
- Current-query versus page-first SerpAPI page discovery.
- Existing safe page fetch, address grounding, and `emailConfidence` grading.
- A second-stage Claude-versus-Serp ordering comparison only if Stage 1 passes.

### Out of scope

- Sending email, writing Dataverse/Postgres/Blob state, or changing resolver
  production behavior.
- Treating snippet emails as sendable evidence.
- Adding `lab`, `site:.edu`, Google Scholar, guessed email patterns, or
  hand-maintained Broad/MIT/Harvard equivalence rules.
- Testing Europe PMC `<corresp>` parsing. That was a separate W3.1
  structured-source experiment and did not confound this web-page test; it
  subsequently produced 0 incremental addresses and was not promoted.
- Population-level claims from 13 primary cases.

## Frozen primary cohort

The primary screen is the exact no-reference subset of the existing 40-person
SerpAPI artifact. `[VERIFIED via local artifact filter:
results[].references.length === 0]`

| Subject key | Candidate | Claimed affiliation |
|---|---|---|
| `447c3e850f38a5ed` | Andrea Cavalleri | Max Planck Institute for the Structure and Dynamics of Matter |
| `ff7cf17f75549975` | Ataç Imamoğlu | ETH Zürich |
| `af89e2798f36c1d5` | Dmitry Abanin | Princeton University |
| `cc0934436ded625e` | E. John Wherry | University of Pennsylvania |
| `4c78e4ac2e1ecce2` | Jie Shan | Cornell University |
| `e34c103f67d73eed` | Jonathan Berg | University of North Carolina at Chapel Hill |
| `f7a9e2139dca4961` | Monika Aidelsburger | Ludwig Maximilian University of Munich |
| `5438881790cc27bb` | Pawel Keblinski | Rensselaer Polytechnic Institute |
| `5aa9e04ab2486f4b` | Robert Coyne (Robert H. Singer) | Albert Einstein College of Medicine |
| `6b6b78e191fd91b7` | Rudolf Schäfer | Leibniz Institute for Solid State and Materials Research (IFW Dresden) |
| `76f132fb756f39f4` | Sara Haravifard | Duke University |
| `99c6c4c1d927e2d3` | Suchitra Sebastian | University of Cambridge |
| `ddc0f8e4413de19c` | Timothée Masquelier | CNRS / Université de Toulouse |

The two stress-control people produce four claimed-affiliation views:

- David Liu — Harvard Chemistry
- David Liu — Broad Institute
- Feng Zhang — MIT
- Feng Zhang — Broad Institute

These controls answer “does the method find a correct person-specific page and
address under each claimed institution?” The paired views share a `personKey`
but have distinct `subjectViewKey` values. They do not yet test automatic
co-affiliate expansion, because the inert W0 institution substrate is not a
production paid-search caller and W1.4 remains unimplemented. `[VERIFIED current
limitation; co-affiliate expansion remains PLANNED under W1.4]`

## Stage 0 — read-only identity/domain prepass

For each subject, call:

```js
ContactEnrichmentService.enrichCandidate(candidate, {
  persist: false,
  usePubmed: false,
  useOrcid: false,
  useClaudeSearch: false,
  useSerpSearch: false,
})
```

This deliberately pays the current `_finalize` latency once to obtain OpenAlex
metrics, the identity verdict, effective institution, and anchored/plausible
institution domains before Google search. `[PLANNED evaluator behavior;
VERIFIED current option and finalize contracts]`

Rules:

- No external record writes: `persist:false` is mandatory and asserted in the
  output contract.
- A subject enters the domain-constrained arm only with a non-contradictory
  identity verdict and at least one anchored institution domain.
- An unresolved or contradictory identity is an **abstain**, not a reason to run
  a bare-name or guessed-domain search.
- Record prepass latency separately. It is real production overhead if the
  pipeline is later reordered.

## Stage 1 — 13-person page-first screen

### Paired arms

Run both arms for the 13 primary subjects and the four stress-control views.
The controls remain outside primary statistics.

**Arm A — current Serp contact query**

```text
"<candidate name>" <claimed institution> email
```

Use the current organic-result parsing to collect candidate page URLs. Ignore
snippet emails as an endpoint. Feed the top two eligible first-party URLs into
the existing page-grounding tier.

**Arm B — page-first Serp queries**

Run these two calls in parallel:

```text
"<candidate name>" <resolved institution>
"<candidate name>" site:<top anchored institution domain>
```

Aggregate and deduplicate URLs, keep pages only on anchored institution domains,
rank candidate-specific faculty/profile/lab pages ahead of generic directories
or publications, and feed at most the top two URLs into the existing
page-grounding tier.

The broad query is retained because an institution may expose the best page
under an unexpected first-party subdomain or URL structure. The `site:` query
tests the program-director pattern directly without making `.edu` a proxy for
identity.

### Search and fetch budget

- 13 primary subjects + 4 control views (2 people × 2 affiliations).
- Arm A: 1 SerpAPI call per subject.
- Arm B: 2 SerpAPI calls per subject, in parallel.
- Maximum: 51 SerpAPI calls.
- Allocated quota value at `$75 / 5,000 = $0.015` per call: `$0.765`.
- Expected marginal dollar charge while the prepaid quota remains: `$0`.
- Fetch at most two first-party pages per arm.
- Concurrency cap: 3 subjects; query concurrency cap: 2 within Arm B.

The binding costs are latency and manual attention, not marginal SerpAPI spend.
`[PLANNED limits; VERIFIED quota arithmetic from the companion audit]`

### Machine endpoint

An arm succeeds for a subject only when all of the following are true:

1. a fetched page is under an anchored institution domain;
2. the existing page parser uniquely associates an email with the candidate;
3. the resulting source is `institution_page`; and
4. the existing `emailConfidence` returns `action:'ready'`.

A snippet-only email, generic contact address, ungrounded page address, or page
on a non-anchored host is not a success.

### Manual endpoint

Manual review is applied **after** machine processing and deduplication.

Deduplication key:

```text
personKey + normalized email + normalized final page URL
```

The owner sees only:

- unique would-be-ready outcomes;
- arm disagreements that produce different ready addresses or source pages; and
- any machine outcome explicitly flagged as identity-ambiguous.

The owner does **not** review snippet emails, failed queries, duplicate
candidate/arm outcomes, or pages that produced no grounded address. Arm labels
remain hidden during adjudication.

Each review row asks only:

1. Is this first-party page about the intended person?
2. Does the page present this address as belonging to that person?
3. Verdict: `correct`, `wrong_person`, or `unclear`.

The evaluator must stop and report before generating more than 25 manual-review
rows. Target review burden is 30–45 minutes, not the prior 4–5 hour design.
`[PLANNED]`

### Stage 1 decision gate

Proceed to Stage 2 only if all are true:

- Arm B produces at least **2 more manually confirmed ready subjects** than
  Arm A among the 13 primary cases (15.4 percentage points);
- neither arm produces a `wrong_person` would-be-ready result;
- median added end-to-end latency for Arm B is no more than 5 seconds; and
- manual-review rows do not exceed 25.

If any condition fails, stop. Do not change production. Preserve useful
first-party page links as staff research leads and continue the independent
structured-source work.

The two-subject threshold is a screen for practical value, not a significance
claim. `[ASSUMED product threshold; owner may change before execution]`

## Stage 2 — settle Claude-versus-Serp ordering only after a positive screen

The current evidence does not establish whether Claude or page-first SerpAPI
should run first. `[VERIFIED gap]`

Do not run two full sequential cascades. Instead:

1. Reuse the Stage 1 Arm B result for every primary subject.
2. Run one independent Claude page-discovery attempt for each primary subject,
   with the same identity/domain inputs, page-fetch cap, page-grounded endpoint,
   and no persistence.
3. Deduplicate would-be-ready outcomes across providers before owner review.
4. Simulate the two orderings from the independently measured outputs:
   - Serp page-first → Claude fallback
   - Claude → Serp page-first fallback
5. For each virtual ordering, report correct-ready yield, wrong-person count,
   paid calls avoided after an early success, and measured latency.

This adds at most 13 Claude calls and does not double the manual review. If both
orders have the same correct-ready yield, prefer the lower-latency/fewer-call
order. Any wrong-person would-be-ready result blocks promotion.

## Stage 3 — fresh validation only after Stages 1 and 2 pass

Before a production change, run the selected cascade on a fresh, frozen cohort
of 20 new-to-WMKF thin-footprint reviewers, stratified before the run:

- 10 US-based;
- 10 non-US;
- no person used in the 40-case artifact or stress controls.

Cap manual review at 30 unique would-be-ready outcomes. Report exact
numerators/denominators and abstentions; make no population claim.

Production promotion requires:

- zero manually confirmed wrong-person ready results;
- at least 3 additional correct-ready subjects versus the current cascade;
- p90 latency and paid-call counts within an owner-approved operational budget;
  and
- an explicit owner decision on W3.4.

The “3 of 20” yield threshold and latency budget remain `[ASSUMED]` until the
owner sees Stage 1 and Stage 2 results.

## Evaluator artifact contract

Planned script:

```text
scripts/evaluate-reviewer-page-first-email.mjs
```

Planned local output:

```text
outputs/reviewer-holistic-m1/reviewer-email-page-first-stage1-v1.json
```

The artifact records:

- immutable source-artifact path and cohort fingerprint;
- person key, subject-view key, normalized name, and claimed affiliation;
- prepass identity verdict, effective institution, anchored/plausible domains,
  and latency;
- exact arm/query strings and provider status;
- organic result ranks, titles, URLs, hosts, and snippets;
- URL eligibility/ranking decisions;
- per-page fetch status, final URL, grounding result, and latency;
- resulting email source and `emailConfidence` action;
- a stable manual-review outcome ID;
- per-subject/per-arm errors, attempts, and retryability;
- summary numerators, denominators, abstentions, latency percentiles, and call
  counts.

It never stores API keys or writes external application state. Partial failures
remain visible as individual subject/arm records; a summary count alone cannot
hide them. A retry accepts explicit subject keys and reruns only failed
subject/arm pairs. `[PLANNED]`

## Whole-flow contract

| Layer | Experiment contract |
|---|---|
| Entry point | CLI evaluator with explicit stage, limit, subject, dry-run, and output arguments. `[PLANNED]` |
| Identity | Current OpenAlex/identity/domain finalize path, invoked read-only before paid search. `[PLANNED reuse; VERIFIED current path]` |
| Search | Exact logged Serp/Claude queries; no snippet email promotion. `[PLANNED]` |
| Page fetch | Existing SSRF-safe first-party fetch and candidate-associated unique-address grounding. `[PLANNED reuse; VERIFIED current path]` |
| Confidence | Current `emailConfidence`; only `institution_page` may become ready in this web experiment. `[VERIFIED]` |
| Persistence | `persist:false`; local JSON is the only write. `[PLANNED and mechanically asserted]` |
| Consumer | Owner decision on W3.4; no UI, resolver, database, or send-path consumer changes. `[PLANNED]` |
| Invitation | No send is invoked. Existing `research_only` and ready-source gates remain authoritative. `[VERIFIED boundary]` |

### Contract-reconcile audits

- **Whole flow:** candidate → prepass identity/domain → paid page discovery →
  safe page fetch → grounding → confidence → local artifact → owner decision.
- **Partial success:** every subject/arm has a durable local outcome; failures
  are retryable by stable key and excluded from denominators only when reported
  explicitly.
- **Async/stale state:** CLI only; deadlines and latency are recorded per call;
  there is no UI state or background write to go stale.
- **Shared helpers:** production identity, domain, safe-fetch, grounding, and
  confidence helpers are reused; the evaluator must not fork their semantics.
- **Durable state:** no migration, route, database write, or Atlas change.
- **Documentation:** this plan and W3.4 are reconciled; the generated docs
  catalog and fact-consistency gates must pass.
- **Fan-out:** no production symbol is changed in the experiment-plan slice.

## Build and run sequence

1. Implement only the Stage 0/1 evaluator.
2. Add unit fixtures for query construction, anchored-domain filtering, URL
   deduplication/ranking, manual-outcome deduplication, and the 25-row stop.
3. Assert that the page tier is enabled for the evaluator process, then dry-run
   two primary subjects to verify exact queries and zero paid calls.
4. Live-run two primary subjects; inspect the JSON contract and page-fetch
   behavior before spending the remaining 45 calls.
5. Run all 13 primary subjects plus the four control views.
6. Generate the blinded, deduplicated review sheet.
7. Stop for owner adjudication and the Stage 1 gate.
8. Implement/run Stage 2 only after the owner confirms Stage 1 passed.
9. Define and freeze Stage 3 only after the ordering decision.

## Stop conditions

Stop immediately and report if:

- `persist:false` cannot be proven on every enrichment call;
- the evaluator would need to weaken an identity, domain, page-grounding, or
  send gate;
- a provider result is promoted without fetching its source page;
- the first two live subjects produce an unbounded or misleading page set;
- any wrong-person address reaches would-be-ready;
- the manual-review queue would exceed its cap; or
- the source cohort/fingerprint differs from this plan.
