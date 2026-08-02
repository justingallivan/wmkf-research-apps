---
title: Reviewer Find Performance and State-Coherence Plan
domain: reviewer-workbench
kind: plan
status: active
summary: "Implementation plan to show useful Reviewer Find results quickly while preserving fail-closed identity, COI, contact, and roster contracts."
canonical: false
cataloged: 2026-08-01
owner: product-engineering
related:
  - docs/REVIEWER_ANALYZE_CONTRACT_SPEC.md
  - docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md
  - docs/REVIEWER_CONTACT_LEADS_SPEC.md
  - docs/REVIEWER_GATING_STRATEGY_REDESIGN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/atlas/postgres-reviewer-find-roster.md
---

# Reviewer Find Performance and State-Coherence Plan

> **Status:** Proposed implementation plan. No runtime or data changes are made by this document.
>
> **Objective:** make the first useful Reviewer Find result appear promptly, keep the page responsive while expensive checks continue, and ensure that incomplete, duplicated, or stale work can never become promotion authority.

## Decision summary

The primary problem is not one slow dependency. The current page treats a multi-stage, partially recoverable workflow as two whole-batch requests:

1. the main search waits for proposal analysis, discovery, verification, COI checks, contact enrichment, and reconciliation before it publishes candidates; and
2. applicant-recommended reviewer ingestion independently performs much of the same proposal, identity, COI, contact, Dataverse, and roster work before it publishes its batch.

Dataverse and PubMed latency amplify the problem, but reducing one query will not make the interaction reliable. The recommended design is a **progressive, versioned candidate pipeline**:

- show applicant-entered names immediately as read-only pending cards;
- stream grounded candidates as each becomes available;
- update each card by immutable candidate identity and monotonic revision;
- run contact richness and nonessential display work after the card is visible;
- make every promotion gate fail closed in both the UI and server services; and
- persist each candidate independently so partial success, retry, refresh, and stale runs have explicit outcomes.

This does not weaken identity or COI checks. It separates **visible** from **actionable**.

## Scope and contract trace

This plan was reviewed in `/contract-reconcile` Mode A.

| Layer | Current entry or authority | Consumers affected |
|---|---|---|
| Find orchestration | `shared/components/reviewers/ReviewerFindPanel.js`, `ReviewerSearchSection.js` | Candidate groups, progress, selection, promotion, reload |
| Applicant lane | `pages/api/workbench/applicant-reviewers.js`, `lib/services/workbench/applicant-reviewers-service.js`, `pages/api/workbench/enrich-recommended.js`, `lib/services/workbench/enrich-recommended-service.js` | Applicant-referred cards, roster, later searches |
| Search lane | `pages/api/reviewer-finder/analyze.js`, `discover.js`, `enrich-contacts.js` | Grounded/search candidates, COI and identity evidence |
| Proposal source | `pages/api/reviewer-finder/load-proposal.js`, `lib/services/workbench/load-proposal-service.js` | Both applicant and search analysis |
| Operational persistence | `lib/services/reviewer-roster-store.js`, Postgres `reviewer_find_roster` | Reload restoration, cross-run suppression, save authority |
| Canonical person/suggestion state | Dataverse `wmkf_appreviewersuggestion`, `wmkf_potentialreviewer`, person/contact records | Identity, referral lifecycle, Invite/Track |
| Promotion | `save-candidates-service.js`, `promote-applicant-reviewer-service.js` | Invite candidates and downstream reviewer lifecycle |

### Non-goals

- Replacing Dataverse, PubMed, Graph, or the shared LLM client.
- Moving canonical reviewer or suggestion ownership out of Dataverse.
- Treating name equality as person identity.
- Making unverified applicant names selectable.
- Building a durable background-job system in the first implementation slice.
- Enabling the broad paid contact-scouting design parked by `docs/REVIEWER_CONTACT_LEADS_SPEC.md`.

## Current-state evidence

### The page has two overlapping pipelines

- [VERIFIED via `ReviewerFindPanel.js`] opening Find independently starts applicant-reviewer ingestion and proposal loading. The applicant response is applied only after the full request returns.
- [VERIFIED via `ReviewerSearchSection.js`] the main search waits for analyze, discover, and all-tier contact enrichment before `setCandidates` publishes the batch.
- [VERIFIED via `ReviewerSearchSection.js`] applicant enrichment is a second request with its own analysis fallback, verification, COI, contact, Dataverse, and roster work. It publishes only the final `recommended` batch.
- [VERIFIED via `enrich-recommended-service.js`] when analysis is not supplied, the applicant lane analyzes the proposal itself. It then performs identity/Dataverse hydration, candidate verification, institution and coauthor COI, contact enrichment, reconciliation, and per-row roster persistence.
- [VERIFIED via recent production `api_usage_log` inspection for request 1003046] two reviewer-finder LLM calls overlapped with nearly identical input sizes. The timing and token shape are consistent with duplicate proposal work, but there is no durable cross-route run identifier; this is therefore an inference, not proof of identical semantic work.

### Slow stages are serial or whole-batch

- [VERIFIED via `lib/services/discovery/verification.js`] candidate verification is serial and can issue multiple PubMed queries per person.
- [VERIFIED via `lib/services/discovery/coauthor-coi.js`] candidate COI checks batch candidates but serialize proposal-author searches within each candidate.
- [VERIFIED via `lib/services/pubmed-service.js`] PubMed requests share a paced queue; retries and backoff extend the queue's wall time.
- [VERIFIED via `contact-enrichment-service.js`] candidates are enriched in a strict serial loop and the service returns only after all candidates finish.
- [VERIFIED via `enrich-contacts.js`] PI/institution resolution, institution COI recomputation, identity receipt minting, and Dataverse reconciliation occur after the whole contact-enrichment call.
- [VERIFIED via `reviewer-roster-store.js`] roster writes are per-candidate SQL operations, but the current write contract catches individual failures and returns only a count.

### Measured baseline

These figures describe available evidence, not complete end-to-end latency. There is no current durable stage telemetry for Dataverse, Graph, PubMed, render, or roster persistence.

| Evidence | Observation | Interpretation |
|---|---:|---|
| [VERIFIED via production `api_usage_log`, trailing 14 days as inspected 2026-08-01, LLM component only] reviewer-finder calls | n=70; p50 13.8s; p90 44.0s; max 90.3s | One important component is highly variable; it is not the full page time. |
| [VERIFIED via production `api_usage_log`, trailing 14 days as inspected 2026-08-01, LLM component only] contact-enrichment calls | n=106; p50 6.5s; p90 9.7s; max 19.7s | Paid/model contact work adds user-blocking time under the present ordering. |
| [VERIFIED via `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md`] historical local profile | 15 PubMed verification candidates ~42.8s; 12 candidates ~34.5s | The verifier is not the sole long pole, but waiting for all candidates materially delays the first card. |
| [VERIFIED via current observability access] route-level Vercel percentiles | unavailable without Observability Plus | Do not invent an end-to-end baseline; add first-party run telemetry before optimizing by anecdote. |

## Safety invariants

The implementation is acceptable only if these remain true under success, partial success, retry, refresh, timeout, disconnect, and overlapping runs.

| Invariant | Required enforcement |
|---|---|
| Visibility is not authority | Pending and grounded cards are read-only until all promotion gates are server-confirmed. |
| Identity is fail closed | No selection or promotion without an authoritative candidate key and a valid automated receipt or current staff confirmation. |
| Institution COI is fail closed | `pending`, `unavailable`, or conflict blocks selection; promotion services recompute or validate authoritative evidence. |
| Coauthor COI policy is explicit | `complete` and a justified `not_applicable` can pass. Missing/pending/error cannot. Justin must decide whether exhausted-provider `incomplete` is fail-closed or requires an explicit staff/policy waiver; UI and both promotion services enforce the same choice. |
| Eligibility is fail closed | Deceased/ineligible blocks; unknown remains non-actionable until the policy's required check completes. |
| Contact/address trust is fail closed | Existing projection and address-trust requirements remain authoritative. Displayed email text is not an attestation. |
| Roster is operational authority | Only the current active roster row and its receipts can support promotion. A streamed client object is never promotion authority. |
| Names are not identities | Normalized names may suppress redundant searches conservatively, but may not merge or overwrite people. |
| Newer work wins | An old request, stream event, roster write, retry, or `finally` block cannot replace state from a newer generation. |
| Partial success is explicit | Every candidate persistence attempt returns an outcome. A count is not sufficient. |
| Cancellation is not deletion | Aborting UI work stops future processing; already committed authoritative rows remain and are reconciled on reload. |

### Existing coauthor-completeness policy gap

[VERIFIED via `reviewer-search-logic.js`, `save-candidates-service.js`, and `promote-applicant-reviewer-service.js`] the UI warns about incomplete coauthor checks, but `isCandidateSelectable` does not require completion and neither server promotion path has an explicit coauthor-completeness gate.

The 2026-07-20 implementation deliberately distinguished an exhausted PubMed failure from a clean negative and surfaced a warning. I did not find a canonical decision stating whether promotion after that warning is intentional. Do not silently convert this ambiguity into new policy.

P0 must make the policy explicit before or in the same release as progressive candidates:

- always allowed: `coauthorCheckStatus === 'complete'` or an explicit server-issued `not_applicable` state;
- always blocked: absent, `pending`, `error`, or any unknown value;
- owner decision: either block `incomplete`, or require an explicit server-recorded `waived_by_policy`/staff acknowledgement with the failed-author evidence retained;
- conflict remains blocked under the existing COI policy; and
- both generic save and applicant promotion independently enforce the rule.

`not_applicable` must be produced only by a named server policy branch, such as a verified absence of proposal authors. `null` is never equivalent to not applicable. A client-supplied waiver is never authority.

## Target interaction model

### Candidate lifecycle

1. **Slot loaded:** an applicant-entered name is visible within the applicant lane. It has no identity authority and cannot be selected.
2. **Grounded:** the server has established a real-person/work evidence projection and an immutable client correlation ID. Promotion gates may still be pending.
3. **Checked:** identity, institution COI, coauthor COI, eligibility, contact/address trust, and roster stages update independently.
4. **Actionable:** all required gates are in allowed states and an active roster row carries the authoritative receipts.
5. **Terminal blocked or failed:** the card explains the blocking gate and offers only a safe stage-specific retry or staff repair path.

The UI should render each stage without moving the card between unrelated identities. A card becoming visible early does not imply that it is ready.

### Stable identifiers

Use two identifiers with different trust semantics:

- `clientCandidateId`: immutable UI/run correlation. It is never accepted as promotion authority.
- `candidateKey`: authoritative roster identity supplied by the server when materialization/identity policy permits it.

Suggested construction:

- applicant provisional card: `applicant:<requestId>:<potentialReviewerId>` when the source ID exists; otherwise a server-issued opaque slot ID. `candidateKey` remains `null` until authoritative materialization;
- search card: server-issued opaque ID tied to the route run, then the authoritative `candidateKey` when created;
- restored card: existing roster `candidateKey`.

High-trust cross-lane aliases may merge only when they share one of:

- `suggestionId`;
- `potentialReviewerId`;
- a validated ORCID bound to the same identity;
- an exact normalized email already bound to the same authoritative identity; or
- the exact authoritative `candidateKey`.

Normalized name alone is not a merge anchor. A same-name search result without an anchor is shown as a possible duplicate or suppressed from automatic discovery, not merged into the applicant card.

### Versioned stream contract

Preserve the existing JSON behavior where compatibility is useful, but add streaming to applicant and contact routes behind an explicit request version during migration. Every progressive route emits full candidate projections, not deep-merge patches:

```json
{
  "schemaVersion": 1,
  "correlationId": "client UUID used only for tracing",
  "routeRunId": "server UUID",
  "proposalInstanceKey": "opaque key for the proposal loaded in this browser generation",
  "lane": "applicant",
  "clientCandidateId": "applicant:1003046:<opaque-id>",
  "candidateKey": null,
  "revision": 3,
  "stage": "coauthor_coi",
  "status": "pending",
  "candidate": { "name": "Example Person", "source": "applicant_recommended" },
  "gates": {
    "identity": "ready",
    "institutionCoi": "clear",
    "coauthorCoi": "pending",
    "eligibility": "eligible",
    "addressTrust": "pending",
    "roster": "pending"
  },
  "retry": { "retryable": false, "stage": null },
  "error": null
}
```

Contract rules:

- `(routeRunId, clientCandidateId, revision)` is unique and revisions increase monotonically.
- The client replaces the candidate projection for a newer revision; it never deep-merges stale truthy flags.
- The client applies events only for the current request, proposal instance, UI generation, and route run. P1 replaces the load-instance key with the stable Graph-backed content-version key used for caching.
- A client-provided `correlationId` is validated as a UUID and used only for logging. It grants no authority.
- `complete` includes a terminal outcome for every candidate ID and stage counts.
- Stream close without `complete` is an unknown outcome. The client reloads the roster and retries only unresolved candidate IDs.
- Every async state write, including `catch` and `finally`, checks the current generation.

Recommended event types are `run_started`, `candidate`, `progress`, `complete`, and `error`. Existing route-specific stage messages may remain during migration, but the envelope and terminal semantics must be shared.

## Implementation slices

### P0 — progressive visibility and correctness

P0 changes ordering and contracts, not the underlying reviewer sources. It should not require a new table.

#### 0.1 Encode the coauthor-completeness policy at every gate

Touch:

- `shared/components/reviewers/reviewer-search-logic.js`
- `shared/components/reviewers/ReviewerSearchSection.js`
- `lib/services/workbench/save-candidates-service.js`
- `lib/services/workbench/promote-applicant-reviewer-service.js`
- focused tests for all four paths

Acceptance:

- pending/unknown/error checks are visibly non-selectable;
- the owner-selected `incomplete` behavior is identical in UI and both server services;
- crafted client input cannot bypass either server service or manufacture a waiver;
- `not_applicable` and any approved waiver require an explicit server-produced policy reason; and
- partial COI failure cannot be summarized as a clean result.

#### 0.2 Publish applicant slots before enrichment

Touch:

- `pages/api/workbench/applicant-reviewers.js`
- `lib/services/workbench/applicant-reviewers-service.js`
- `ReviewerFindPanel.js`
- `ReviewerSearchSection.js`

Add an optional `onEvent` callback to the service. Immediately after the request/slot read, emit the populated slots as provisional read-only cards. Continue materialization, known-person hydration, and excluded-text parsing as later events.

The client adds raw applicant names to the main search's conservative exclusion set as soon as slots arrive. This prevents the main lane from rediscovering the same names while applicant verification is still running. It does not assert identity equivalence.

Preserve a final JSON mode temporarily for callers/tests that have not moved to the streaming version. The sole product client should migrate in the same slice; delete compatibility only after caller search confirms no remaining use.

#### 0.3 Stream candidates at safe boundaries

Touch:

- `pages/api/reviewer-finder/discover.js`
- `pages/api/reviewer-finder/enrich-contacts.js`
- `lib/services/contact-enrichment-service.js`
- `pages/api/workbench/enrich-recommended.js`
- `lib/services/workbench/enrich-recommended-service.js`
- `ReviewerSearchSection.js`

Add callbacks/events at these boundaries:

- verified/grounded candidate produced;
- identity decision produced;
- institution COI complete;
- coauthor COI complete or explicitly incomplete;
- free contact evidence complete;
- paid contact evidence complete when requested;
- roster persistence complete.

Candidate events before identity receipts and roster persistence are display-only. The server must send the full pruned projection at each revision.

For `ContactEnrichmentService.enrichCandidates`, add `onCandidateComplete(candidate, index)` after each serial candidate result is finalized. This yields immediate improvement without changing provider concurrency or rate limits. Concurrency tuning is P1/P2 because shared queues and provider limits require measurement.

#### 0.4 Make roster persistence result-aware and stale-safe

Touch:

- `pages/api/workbench/reviewer-roster.js`
- `lib/services/reviewer-roster-store.js`
- all callers/tests that currently consume `{ recorded }`

Return:

```json
{
  "results": [
    {
      "clientCandidateId": "...",
      "candidateKey": "...",
      "outcome": "recorded",
      "rosterUpdatedAt": "2026-08-01T00:00:00.000Z",
      "error": null
    }
  ],
  "counts": { "recorded": 1, "skippedStale": 0, "failed": 0 }
}
```

Allowed outcomes: `recorded`, `skipped_stale`, `rejected`, `failed_retryable`, and `failed_terminal`.

- New candidate rows use insert-only semantics.
- Refresh/update requires the exact `expectedUpdatedAt` returned by the prior authoritative read.
- A conflict never silently overwrites a newer row. The client reloads and reconciles.
- The client incorporates only `recorded` rows into promotion-ready state.
- The route retains partial-success behavior and reports every candidate; it does not convert one row failure into an ambiguous whole-batch failure.
- `persistRecommendedRoster` accumulates these row outcomes and includes them in the applicant stream's terminal frame instead of reducing them to `count/skipped`.

#### 0.5 Add cancellation and generation ownership

Touch `ReviewerFindPanel.js`, `ReviewerSearchSection.js`, progressive routes, and signal-aware leaf services.

- Create one `AbortController` per request/proposal-load/search generation.
- Abort on request change, proposal load-instance change, new search, manual retry that supersedes a run, and unmount.
- Combine client disconnect and configured reviewer deadline signals at the route.
- Pass the signal only into dependencies that support it; check before and after unsupported calls.
- Treat abort as a terminal telemetry outcome, not a generic error toast.
- Never roll back rows committed before abort. Reload roster authority after reconnect.

#### 0.6 Add first-party structured run telemetry

P0 emits bounded structured JSON logs and returns stage timing summaries in terminal SSE/JSON responses. Do not log proposal text, reviewer email, search snippets, or raw provider responses.

Every route stage records:

- `correlationId`, `routeRunId`, request hash/ID according to existing logging policy, lane, and the current proposal instance key (P1 upgrades this to the stable content-version key);
- stage start/end/duration and outcome;
- candidate input/completed/blocked/failed counts;
- Graph list/download counts;
- Dataverse read/write counts;
- PubMed `esearch`/`efetch`/retry counts;
- OpenAlex, ORCID, Europe PMC counts;
- Claude/Serp/eligibility-evidence paid call counts;
- cache hit/miss and single-flight leader/waiter counts; and
- abort/deadline reason.

Because current Vercel access does not provide route percentiles, logs alone may be insufficient for product SLO reporting. The telemetry-storage decision is in P1 and requires owner approval before adding schema.

### P1 — remove optional work from the blocking path

P1 begins only after P0 telemetry establishes the actual stage distribution.

#### 1.1 Split proposal context from search-specific analysis

[VERIFIED via `load-proposal-service.js`] the loader currently returns file path/last-modified information but not a stable Graph item/version identity, and it re-downloads/re-uploads on load. [VERIFIED via `GraphService.getFileMetadataByPath`] Graph metadata already exposes item ID, drive ID, eTag/version, and last modified. Until P1, the client uses an opaque load-instance key derived from the returned blob/file selection only to reject stale in-memory events; it is not a reusable cache identity.

Create two caches/single-flight keys:

1. **Proposal context** — proposal facts needed by both lanes: authors, PI/institution context, and stable content identity.
2. **Search analysis** — reviewer-query output specific to count, exclusions, notes, and prompt configuration.

Key proposal context by a server-generated opaque hash of:

- request ID;
- Graph drive ID and item ID;
- eTag or version ID, with last-modified only as a fallback;
- analysis contract version;
- resolved prompt version; and
- model ID.

Key search analysis by the proposal-context key plus:

- reviewer count;
- normalized exclusion set;
- normalized additional notes; and
- user prompt override version, if any.

Path alone is not a content version. A file replaced under the same SharePoint name must miss the cache. Failed, incomplete, timeout, or malformed results are never cached as successful analysis.

Use exact-key single-flight. A process-local `Map` is not sufficient across Vercel instances; use the existing Postgres cache contract or introduce a reviewed durable mechanism. Recheck `search_cache` TTL and cleanup before reuse. Its existing six-month result TTL is not automatically appropriate for proposal analysis.

#### 1.2 Defer optional contact richness

Make free/authoritative identity sources the default background continuation after a candidate is grounded. Invoke paid Claude/Serp contact scouting only when:

- staff explicitly opens verify/edit;
- staff selects a candidate and required contact/address gates remain unresolved; or
- a separately approved top-N policy requests it.

Do not promote a lead from a paid source into an authoritative email without the existing contact/address trust workflow. This preserves `docs/REVIEWER_CONTACT_LEADS_SPEC.md`.

Target: reduce paid contact calls per accepted search run by at least 50% against a candidate-count-matched baseline without lowering actionable-candidate attainment.

#### 1.3 Add durable run metrics only if product reporting requires them

Owner decision required. If structured logs cannot support the rollout SLOs, add an append-only `reviewer_find_run_events` table with:

- UUID run/route IDs;
- request/proposal identifiers according to existing data policy;
- run kind, stage, event, start/end/duration;
- bounded numeric counts JSON;
- outcome/error code; and
- created/expiry timestamps.

It must not store proposal text, names, emails, or provider response bodies. A new table requires migration + manifest, fresh-install shape, Atlas page/update, indexes, cleanup/retention ownership, route-security review for any client beacon, and migration self-tests. Do not create the table merely because the design is convenient.

### P2 — measured provider and query experiments

These are experiments, not approved optimizations.

#### 2.1 PubMed query consolidation

Compare per-author COI queries with OR-union or batched alternatives on a curated and recent no-write corpus.

Ship only if:

- candidate/author attribution and recall match the per-author gold set;
- there are zero false clean negatives in the corpus;
- incomplete provider responses remain incomplete, never clean;
- PubMed requests fall by at least 50% or stage wall time falls by at least 30%; and
- rate-limit/retry behavior does not worsen.

Otherwise retain the current queries and rely on progressive delivery.

#### 2.2 Dataverse batching

Instrument current point reads/writes, then compare supported batch operations in a no-write or test-target workflow.

Ship only if p90 stage time improves by at least 30%, returned identities/ETags and restriction/interlock semantics are identical, per-row failures remain attributable, and throttling does not increase.

#### 2.3 Evidence cache

If provider telemetry shows repeated identical work, add a versioned cache for successful evidence only. The key must include provider, normalized query, policy/contract version, and source version where available. TTL is source-specific and reviewed; do not inherit the generic six-month TTL without evidence. Never cache an error/incomplete response as a clean negative.

#### 2.4 Durable jobs, only if progressive requests still cannot finish reliably

Do not begin with a queue. Consider a resumable job only if, after P1 canary:

- at least 5% of accepted runs fail to reach `background_complete` because of disconnect/deadline; or
- p90 background completion remains beyond the owner-approved time budget; or
- users need cross-device/background continuation rather than merely fast first results.

That design would require job ownership, leases, idempotency, cancellation, retention, migration/Atlas updates, and a separate contract review.

## Client state and merge rules

Replace the current broad `dedupeByName` union with an identity-aware projection store:

```text
Map<clientCandidateId, {
  routeRunId,
  revision,
  candidateKey,
  lane,
  projection,
  gates,
  terminalOutcome
}>
```

Rules:

- Ignore a lower/equal revision for the same route run and client ID.
- Ignore every event from a superseded request/proposal/generation.
- Replace the projection on a higher revision.
- Alias two client IDs only after a high-trust anchor match.
- On alias, retain both provenance lanes and the newest authoritative roster version; never discard a blocking gate.
- Before any promote action, reload or validate current roster authority and let the server re-enforce every gate.
- Applicant names may enter `effectiveExcluded` before identity materialization, but that is search suppression only.

## Error, retry, and partial-success semantics

| Failure | UI state | Retry rule | Persistence rule |
|---|---|---|---|
| One candidate provider lookup fails | That card shows stage-specific incomplete/failed state; other cards continue | Retry that candidate/stage | Never mark missing COI/identity as clean |
| One roster row fails | Candidate remains non-actionable; batch completes with partial failure | Retry by candidate ID with expected version | Other successful rows remain committed |
| Stale roster write | Reloaded/newer card wins | Reload, then explicit retry if still needed | No overwrite |
| Stream disconnect before terminal frame | Run outcome unknown | Reload roster, retry unresolved IDs only | Keep committed rows |
| New search/request/proposal | Old generation is canceled | New run owns UI | Old late writes must use version guards |
| Proposal load instance changes (P0) or content version changes (P1) | P0 changes UI generation; P1 also misses context/search cache | Re-run against the current proposal | Old results cannot become active for the new instance/version |
| Deadline | Partial cards stay visible with terminal/retry state | User can resume unresolved stages | No clean status synthesized from timeout |
| Duplicate name without identity anchor | Possible duplicate/read-only | Staff resolves identity | Never merge automatically |

Retry endpoints must be idempotent by authoritative candidate/stage key. A retry must not repeat completed paid work unless its evidence version expired or the user explicitly requests refresh.

## Metrics and acceptance thresholds

Use both `performance.now()` for browser elapsed time and wall-clock timestamps for correlation.

### Product milestones

- `find_panel_mounted`
- `applicant_names_visible` — recorded after React commits at least one provisional applicant card
- `search_clicked`
- `first_grounded_visible` — first grounded card is committed to the DOM
- `first_actionable_visible` — first card meeting the full gate contract is committed
- `background_complete` — every candidate in the accepted run is terminal (`ready`, `blocked`, or explicit retryable/terminal failure) and planned persistence has settled

### Initial rollout objectives

There is no trustworthy current browser-to-card baseline. Run P0 telemetry in shadow for 48 hours before enabling progressive UI and call that same-metric p90 **B**. The relative P0 gate prevents an arbitrary target from masking a regression; the absolute P1 targets state the intended user experience.

| Metric | Objective | Denominator/reporting rule |
|---|---:|---|
| Applicant names visible | P0 p90 ≤ 5s | Authorized Find opens with ≥1 populated applicant slot. Report navigation cancels and errors separately; do not silently exclude failures. |
| First grounded result | P0 p90 ≤ 0.75 × B; P1 p90 ≤ 15s | All accepted searches; report attainment rate, and latency percentile conditional on a grounded result. No-result/error runs are separate outcomes. |
| First actionable result | No P0 regression versus B; P1 p90 ≤ 45s | Accepted searches where at least one candidate eventually becomes actionable; report attainment rate separately. |
| Duplicate rendered identities | 0 high-trust duplicates | Every rendered snapshot/event merge/reload with candidates. Same-name unanchored people are not counted as identity duplicates. |
| Stale event regression | 0 | Every automated overlap/cancel/reload test and canary incident review. |
| Paid contact calls | ≥50% reduction | Calls per accepted run, matched by candidate count, without lower actionable attainment. |
| Terminal telemetry coverage | ≥95% | Accepted server runs; success, error, timeout, and cancel all count as terminal telemetry. |

The owner should revise objectives after two weeks of P0 telemetry. Do not lower a threshold by dropping errors, canceled-after-acceptance runs, or no-result runs from the outcome report. If the 48-hour shadow window has fewer than 30 qualifying runs for a metric, extend it rather than treating an unstable percentile as a release gate.

## Test plan

### Unit and service tests

- Candidate state reducer: revision ordering, run/generation isolation, full replacement, alias rules, and name-only non-merge.
- Selectability: every gate state, especially missing/incomplete coauthor COI.
- Both promotion services: crafted payloads cannot bypass coauthor, identity, institution, eligibility, address, or roster gates.
- Applicant service events: slots before enrichment, stable IDs, terminal outcomes for each slot.
- Contact callback: each completed candidate emits once; candidate failure does not suppress later candidates.
- Roster write contract: insert-only, expected-version update, stale skip, per-row partial failure, idempotent retry.
- Cache key: same path/new eTag misses; identical exact key single-flights; failed/incomplete output is not a hit.
- Abort: before request, mid-provider, after one persisted candidate, and during client unmount.

### Route/contract tests

- SSE event schema version, monotonic revision, pruned projection, terminal completeness.
- JSON compatibility during migration.
- Disconnect propagates cancellation where supported and does not manufacture success.
- Correlation IDs have no authorization effect.
- Each route retains existing auth, Dynamics restriction context, Dataverse interlock, and rate limiting.
- Complete frame counts reconcile exactly to candidate terminal outcomes.

### React tests

- Applicant slot cards appear before enrichment finishes and remain unselectable.
- Grounded cards render while later candidates continue.
- Gate transitions do not reorder or merge unrelated people.
- Old route events, catches, and finalizers cannot mutate a newer request/search.
- Refresh restores authoritative roster state and does not restart already-terminal work unnecessarily.
- Per-card retry affects only the unresolved stage/candidate.

### End-to-end scenarios

1. Request 1003046-like set: multiple applicant names, slow COI, address conflict, and overlapping main search.
2. One PubMed failure amid otherwise successful candidates.
3. Dataverse slow response and one row write failure.
4. Refresh while enrichment is active.
5. Start a second search before the first completes.
6. Replace proposal content under the same SharePoint path.
7. Same normalized name, two different anchored identities.
8. Stream disconnect after one authoritative roster commit.

Use test-target/no-write fixtures for live dependency probes. Production canary must not create invitations or canonical reviewer writes beyond the normal user-authorized flow.

## Rollout, canary, and rollback

Use separate server/client flags so safety and delivery changes can be controlled independently:

- `REVIEWER_FIND_EXPLICIT_COAUTHOR_POLICY` — ship first and keep on after validation;
- `REVIEWER_FIND_PROGRESSIVE_EVENTS` — server emits the versioned contract;
- `NEXT_PUBLIC_REVIEWER_FIND_PROGRESSIVE_UI` — client consumes it;
- later flags for proposal cache and deferred paid contact work.

Rollout order:

1. Add telemetry and the explicit coauthor-policy gate selected by Justin.
2. Deploy server events while the old final result remains available.
3. Enable progressive UI for staff canary requests.
4. Validate stale/duplicate/error dashboards and manually exercise request 1003046 or an equivalent test-target fixture.
5. Expand to all staff.
6. Only then enable P1 proposal caching and paid-contact deferral as separate canaries.

Rollback:

- Disable progressive client consumption first; server retains final response compatibility.
- Disable event production if it causes load or contract failures.
- Keep the explicit server/UI coauthor policy aligned during rollback; never roll back only one enforcement point.
- Cache rollback bypasses reads and stops new writes; it does not delete evidence during incident response.
- Roster contract rollback must preserve newer-row wins; do not restore blind overwrites.

Canary stop conditions:

- any unsafe promotion or missing required gate;
- any stale run replacing newer UI or roster state;
- any identity merge based only on name;
- duplicate authoritative candidate rate above zero;
- increased Dataverse throttling or error rate;
- terminal telemetry below 95%, because performance conclusions would be unreliable.

## Files expected by slice

This is an implementation routing list, not permission to edit unrelated code.

| Slice | Primary files |
|---|---|
| P0 state/stream | `ReviewerFindPanel.js`, `ReviewerSearchSection.js`, `reviewer-search-logic.js`, applicant/discover/enrich routes and services |
| P0 persistence | `reviewer-roster.js`, `reviewer-roster-store.js`, save/promote services |
| P0 telemetry | route/service structured logging helpers and focused tests; no schema by default |
| P1 proposal context | `load-proposal-service.js`, Graph metadata caller, analyze/applicant callers, reviewed cache leaf |
| P1 contact deferral | contact enrichment service/routes, Verify/Edit UI, existing address/contact trust services |
| Optional metrics table | migration + manifest + setup shape + Atlas + cleanup + security matrix if a new route is added |

## Contract-reconcile review

### Audit 1 — Contract propagation

Required fields are traced from route event through the client reducer, roster write result, reload, and promotion. `clientCandidateId` is correlation only; `candidateKey`, receipts, and current roster state retain authority.

### Audit 2 — Partial success

Whole-batch counts are replaced with per-candidate outcomes at the persistence seam. Streams terminate with reconciled candidate outcomes. Missing terminal events remain unknown, never success.

### Audit 3 — Async ordering and stale state

Abort controllers reduce wasted work, but correctness comes from request/proposal generation, server route run IDs, monotonic revisions, and expected roster versions. Cancellation alone is not treated as a stale-write guarantee.

### Audit 4 — Helper semantics

Existing generic `dedupeByName` and count-only `recordSurfaced` semantics are insufficient for the target contract. Proposed replacements distinguish search suppression from identity and success counts from row outcomes.

### Audit 5 — Persistence and consumer alignment

Postgres remains the operational pre-save roster and Dataverse remains canonical person/suggestion state. Progressive UI objects do not create a new source of truth. Invite/Track continue to consume saved/canonical state, not pending cards.

### Audit 6 — Durable surfaces

P0 adds no schema. If P1 adds durable metrics, the migration, fresh-install shape, Atlas, cleanup, security, and catalog updates are one inseparable slice. Proposal cache semantics must document key/version/TTL and invalidation.

### Audit 7 — Tests and operations

The plan includes failure-in-the-middle, stale overlap, reload, same-name identities, proposal replacement, and live-dependency slowdown. Canary stop conditions are safety-first and rollback keeps the corrected concurrency semantics.

**Mode A verdict:** implementable with one blocking prerequisite: Justin must choose the exhausted-provider `incomplete` policy, and that explicit policy must ship in the UI and both promotion services before or with progressive selection. P0 should proceed without a durable job queue or provider-concurrency increase. P1/P2 optimizations require P0 measurements.

## Decisions required from Justin

1. Approve the rollout objectives: applicant names P0 p90 ≤5s, first-grounded P0 p90 at least 25% below the 48-hour shadow baseline, and the P1 absolute goals of first-grounded p90 ≤15s / first-actionable p90 ≤45s.
2. Choose whether pending applicant slots display only name/source or also the raw institution/email entered by the applicant. Recommendation: show available source text but label it unverified and never use it as authority.
3. Approve paid contact enrichment on explicit verify/select only, or choose a small automatic top-N. Recommendation: explicit demand first; measure whether it harms actionable attainment.
4. Decide whether Vercel/log-drain telemetry is sufficient after P0. Recommendation: do not add a metrics table until the canary proves logs cannot answer the SLOs.
5. Decide exhausted-provider coauthor behavior: fail closed, or require an explicit server-recorded staff/policy waiver. Recommendation: fail closed initially; allow a waiver only if operations show a material availability problem. In either case, reserve `not_applicable` for a documented server branch such as no proposal authors.

## Recommended first implementation PRs

Keep changes reviewable and independently reversible:

1. **Safety + reducer:** explicit coauthor-policy gate, candidate event schema/reducer, stale-run tests.
2. **Applicant first paint:** slot event, provisional read-only cards, immediate conservative search suppression.
3. **Search/contact streaming:** grounded and per-candidate contact events, abort/generation ownership.
4. **Roster outcomes:** detailed persistence results and expected-version updates.
5. **Telemetry + canary:** product milestones, stage counters, dashboards/queries, flag rollout.
6. **P1 proposal single-flight/contact deferral:** only after P0 measurements and separate approval.

This sequence improves perceived speed after PR 2, preserves safety, and avoids tying the first benefit to a database migration or complete pipeline rewrite.
