---
title: Reviewer Find Warm-Revisit Performance and State-Coherence Plan
domain: reviewer-workbench
kind: plan
status: active
summary: "Implementation plan for instant cached Reviewer Find revisits, narrow authoritative revalidation, and explicit cold-search behavior."
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

# Reviewer Find Warm-Revisit Performance and State-Coherence Plan

> **Status:** Proposed implementation plan. No runtime or data changes are made by this document.
>
> **Primary objective:** returning to a previously searched request should show its persisted candidates promptly and should not repeat proposal, model, publication, or contact work merely to reconstruct the screen.

## Decision summary

[VERIFIED via Justin's 2026-08-01 clarification] the primary complaint is the **warm revisit**, not the expected duration of an explicitly initiated new Claude search.

| Contract | User intent | Target behavior |
|---|---|---|
| **Warm/revisit** | Open a request that already has Reviewer Find history | Render the Postgres roster first as cached/read-only; reconcile current Dataverse authority in the background; refresh only stale candidate stages; make zero expensive-provider calls on an unchanged revisit. |
| **Cold/new search** | Explicitly ask the system to find new reviewers | Load the selected proposal, run Claude and evidence providers, show honest stage progress, publish partial candidates progressively, and persist each candidate independently. The user expects this to take time. |
| **Future autonomous search** | A request advances into a configured reviewer-search stage | A durable, auditable run starts only inside an approved trigger boundary; its result is roster candidates, never an automatic invitation or reviewer promotion unless separately authorized. |

P0 is therefore a **warm-bootstrap and cache-correctness release**:

1. read `reviewer_find_roster` without waiting for Dataverse;
2. render that snapshot immediately with a visible `Cached — refreshing` state and promotion disabled;
3. perform lightweight, authoritative revalidation without downloading/analyzing the proposal;
4. enable only actions whose authority and required stage receipts are current;
5. refresh one candidate/stage when one candidate/stage is stale; and
6. attach a reason code to every miss, invalidation, or refresh.

Cold-search progressive delivery remains important, but it follows the warm-path fix. Paid-provider usage is an operational cost metric, not the headline user-experience metric.

## Contract-reconcile Mode A: Step 0

- **Change surface:** Reviewer Workbench Find behavior from panel mount through cached roster display, authoritative revalidation, targeted refresh, explicit new search, and promotion.
- **Entry points:** `ReviewerFindPanel`, `ReviewerSearchSection`, `reviewer-roster`, `applicant-reviewers`, `enrich-recommended`, proposal-load, analyze/discover/enrich routes, and both promotion services.
- **Persistence:** Postgres `reviewer_find_roster`; Dataverse reviewer suggestion/person/request entities; SharePoint/Graph proposal metadata; existing Blob proposal copy; optional future run telemetry/job persistence.
- **Consumers:** Find grouping/counts/cards/actions, Invite and Track after promotion, later searches' exclusion/dedup inputs, reload restoration, tests, Atlas/docs, and operational telemetry.
- **Prior findings verified:** mount-time proposal and applicant work; roster reconciliation blocking cached display; all-or-nothing applicant cache; serial/whole-batch cold stages; count-only roster writes; name-based display dedup; missing explicit coauthor and eligibility-completeness promotion gates.

## Current warm-path evidence

### Mount work happens before the user asks for a search

- [VERIFIED via `shared/components/reviewers/ReviewerFindPanel.js`] every mount starts `/api/workbench/applicant-reviewers` and `/api/reviewer-finder/load-proposal` after proposal binding is ready.
- [VERIFIED via `lib/services/reviewer-finder/load-proposal-service.js`] proposal load lists request SharePoint buckets, downloads the chosen PDF, and uploads another Blob copy.
- [VERIFIED via `shared/components/reviewers/ReviewerSearchSection.js`] every request/blob generation clears roster state and calls `/api/workbench/reviewer-roster`.
- [VERIFIED via `pages/api/workbench/reviewer-roster.js`] roster GET reads Postgres and then awaits `reconcileRosterEngagement` before returning any JSON.
- [VERIFIED via `lib/services/workbench/reviewer-roster-projection-service.js`] reconciliation performs a request-scoped Dataverse suggestion read for suggestion-anchored rows and removes already-handled rows from active display buckets.

The persisted roster is already capable of rendering the prior cards, but the client cannot see it until Dataverse reconciliation finishes.

### One stale applicant row invalidates the whole batch

- [VERIFIED via `shared/components/reviewers/reviewer-search-logic.js`] `hasValidApplicantEnrichmentCache` returns one boolean for the entire expected recommendation set. Every expected canonical suggestion row must match the proposal key, cache version, known-reviewer availability, and identity-result requirements.
- [VERIFIED via `ReviewerSearchSection.js`] when that boolean is false, the mount effect calls `enrichRecommended()` for the complete actionable recommendation set.
- [VERIFIED via `lib/services/workbench/enrich-recommended-service.js`] that request can analyze proposal context, verify candidates, run institution and coauthor COI, enrich contacts, reconcile Dataverse state, and persist roster rows.

Thus one missing, partial, stale, or failed candidate can trigger expensive full-batch work on revisit.

### Cold search is explicitly initiated

- [VERIFIED via `ReviewerSearchSection.js`] `runSearch` is invoked by the search action and then performs analyze → discover → contact enrichment → roster persistence.
- [VERIFIED via production `api_usage_log`, trailing 14 days as inspected 2026-08-01, LLM component only] reviewer-finder calls were n=70, p50 13.8s, p90 44.0s, max 90.3s; contact-enrichment calls were n=106, p50 6.5s, p90 9.7s, max 19.7s.
- [VERIFIED via `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md`] one historical local profile measured ~42.8s for 15 PubMed verification candidates and ~34.5s for 12.

Those measurements explain cold-search duration but do not establish the warm-path baseline. Route, browser render, Graph, Dataverse, and provider-stage percentiles are not currently available. Do not infer warm SLOs from the LLM-only data.

### Secondary cold-path evidence retained

- [VERIFIED via `lib/services/discovery/verification.js`] candidate verification is serial and can issue multiple PubMed queries per person.
- [VERIFIED via `lib/services/discovery/coauthor-coi.js`] candidate COI checks batch candidates but serialize proposal-author searches within each candidate.
- [VERIFIED via `lib/services/pubmed-service.js`] PubMed requests share a paced queue; retries/backoff extend wall time.
- [VERIFIED via `lib/services/contact-enrichment-service.js`] contact enrichment processes candidates serially and publishes the result after the batch.
- [VERIFIED via `pages/api/reviewer-finder/enrich-contacts.js`] PI/institution resolution, institution COI recomputation, receipt minting, and Dataverse reconciliation occur after contact enrichment returns.
- [VERIFIED via `lib/services/reviewer-roster-store.js`] roster persistence loops per candidate, catches row failures, and returns a count rather than identifiers/outcomes.
- [VERIFIED via `lib/services/reviewer-finder/load-proposal-service.js`] the returned file projection includes path/last-modified information but not a stable Graph drive/item/eTag content identity.
- [VERIFIED via `lib/services/graph-service.js` `getFileMetadataByPath`] Graph can return drive ID, item ID, eTag/version ID, and last modified without downloading the file.
- [VERIFIED via production `api_usage_log` inspection for request 1003046] two reviewer-finder LLM calls overlapped with nearly identical input sizes. [ASSUMED] their timing/token shape is consistent with duplicate proposal work, but there is no durable cross-route run ID proving semantic identity.

These remain relevant to P1/P2 cold-search optimization. They do not justify making cold latency the P0 problem.

## Cold and warm contracts

### Warm/revisit classification

A panel open is warm when the Postgres roster has any request-scoped history (`active`, `excluded`, `ineligible`, `blocked`, canonical `savedKeys`, or other retained names), and the user has not explicitly requested a new search.

Warm does **not** mean authoritative. It means there is useful persisted display state.

A panel with **no roster history** is neither permission nor an implicit request to perform cold work. It renders an empty, idle, read-only Find state with an explicit `Run search` action. Proposal download, applicant materialization/enrichment, model calls, publication/COI discovery, and contact discovery begin only after that action (or a future separately authorized autonomous trigger).

On a warm open:

1. fetch Postgres-only roster state;
2. render it as `cached` with all promotion/selection actions disabled;
3. start Dataverse engagement/identity authority reconciliation and lightweight proposal/input metadata comparison;
4. classify every candidate/stage as current, stale, refreshing, failed, or not applicable;
5. enable only actions whose target candidate has current required authority; and
6. schedule only the stale stage/candidate work permitted by the refresh policy.

An unchanged warm open must not:

- call `load-proposal`, download the proposal, or create a new Blob copy;
- call proposal analysis or any Claude reviewer-search prompt;
- call PubMed/OpenAlex/ORCID/Europe PMC/Serp contact or COI discovery merely to render cards;
- run full applicant enrichment; or
- rewrite current roster rows just to renew timestamps.

It may perform bounded metadata/authority reads: Postgres roster, Dataverse engagement/request inputs, and Graph file metadata without content download.

### Cold/new-search classification

A cold search begins only after:

- an authenticated user explicitly selects `Run search`/`Run another search`; or
- a future autonomous trigger satisfies its separately approved policy.

The search may load/download the bound proposal, call Claude, query publication/contact providers, and persist new evidence. The UI must show stage progress and partial candidates without representing pending evidence as promotion authority.

No background mount effect may silently convert a warm revisit into a cold search.

## P0 target architecture: two-phase warm bootstrap

### Phase A — cached render

Extend the existing roster GET rather than adding a new route:

```http
GET /api/workbench/reviewer-roster?requestId=<guid>&mode=cached
```

`mode=cached` performs only `listForRequest(requestId)` and returns:

```json
{
  "success": true,
  "authorityState": "cached",
  "rosterVersion": "opaque snapshot token",
  "active": [],
  "excluded": [],
  "ineligible": [],
  "blocked": [],
  "savedKeys": [],
  "allNames": []
}
```

The client renders the snapshot after React commit and labels it `Cached — checking current reviewer status`. It may allow display-only interactions such as expanding evidence. It disables selection, promotion, applicant add-to-Invite, and any action that assumes current Dataverse engagement.

The snapshot token is correlation/version data, not authorization.

### Phase B — authoritative revalidation

After the cached snapshot is committed, call:

```http
GET /api/workbench/reviewer-roster?requestId=<guid>&mode=reconciled&rosterVersion=<token>
```

This preserves the current Dataverse engagement reconciliation and adds a read-only warm validation summary:

```json
{
  "success": true,
  "authorityState": "current",
  "rosterVersion": "new opaque token",
  "active": [],
  "handled": [],
  "warmValidation": {
    "proposalContentVersion": "opaque Graph-backed hash",
    "applicantInputVersion": "opaque request-input hash",
    "candidatePlans": [
      {
        "candidateKey": "suggestion:<guid>",
        "authority": "current",
        "refreshes": [
          { "stage": "eligibility", "reason": "stage_contract_changed" }
        ]
      }
    ]
  }
}
```

`mode=reconciled` fails closed if the supplied roster version no longer matches: return `409 roster_snapshot_changed` plus a fresh cached snapshot, and let the client restart Phase A/B. A slower response from an older request/generation is ignored.

`authorityState: "current"` means only that the current panel generation completed every required Dataverse engagement, proposal-binding metadata, and applicant-input read successfully. If any required read fails or is partial, return `stale` or `error` with a reason code and keep all authority-dependent controls disabled. It does not certify candidate-stage evidence and it is never sufficient by itself for promotion; stage freshness and the promotion service's fresh authoritative re-reads still apply.

Proposal validation uses Graph metadata (`driveId`, item ID, eTag/version ID, last modified) and the exact canonical or persisted override binding. It does not download file bytes. The server returns only an opaque content-version hash.

Applicant input validation reads the current request's five recommended slots and exclusion text without materializing rows or invoking a model. It returns an opaque set/slot fingerprint and a normalized read projection needed for the refresh planner.

### Route security and restriction invariants

[VERIFIED via `pages/api/workbench/reviewer-roster.js`] the current route calls `requireAppAccess(req, res, 'reviewer-finder', 'reviewers')` before method dispatch, validates the request GUID, and establishes `withDalContext(...)` around Dataverse reconciliation. Both new GET modes must preserve that boundary:

- `mode=cached` is still authenticated by the same app-key tuple before its Postgres-only read;
- `mode=reconciled` uses the same authentication and executes every Dataverse read/write through the existing DAL/restriction context;
- Dataverse target/write interlock enforcement remains at the existing service/HTTP seams wherever an operation can write; a mode branch cannot bypass or weaken it;
- the server allowlists `cached` and `reconciled`; missing mode follows the temporary compatibility contract, and unknown/repeated/conflicting mode input returns `400`; and
- mode, snapshot token, or client-supplied authority fields never grant broader request, record, app, or mutation authorization.

Tests must prove unauthenticated/unauthorized requests fail identically in both modes, request-scope validation cannot be bypassed by mode, reconciled Dataverse access enters the trusted DAL context, cached mode makes no Dataverse call, and an unknown mode fails closed.

### Panel ownership change

P0 moves warm bootstrap ownership into `ReviewerFindPanel` (or one request-scoped hook owned by it) because the panel must decide whether to suppress proposal load and applicant ingestion before `ReviewerSearchSection` mounts its expensive effects.

`ReviewerSearchSection` receives:

- the cached roster snapshot;
- `authorityState` (`cached`, `refreshing`, `current`, `stale`, `error`);
- per-candidate stage freshness;
- the warm-validation plan; and
- explicit callbacks for refresh/new search.

It must not independently repeat the roster mount fetch.

## Per-candidate, per-stage freshness

Replace the single `hasValidApplicantEnrichmentCache(...)` boolean with a pure planner that returns one result for each expected candidate and stage.

### Persisted receipt shape

Store this bounded metadata inside the existing pruned roster candidate JSON; P0 requires no column/table migration:

```json
{
  "warmCacheVersion": 1,
  "proposalContentVersion": "opaque hash",
  "applicantInputVersion": "opaque hash",
  "stageFreshness": {
    "identity": {
      "contractVersion": 4,
      "state": "current",
      "completedAt": "2026-08-01T00:00:00.000Z",
      "sourceVersion": "opaque hash"
    },
    "eligibility": {
      "contractVersion": 1,
      "state": "current",
      "completedAt": "2026-08-01T00:00:00.000Z",
      "result": "unknown"
    }
  }
}
```

Stages are independently versioned:

- applicant materialization/anchor;
- identity;
- institution COI;
- coauthor COI;
- eligibility check;
- contact projection;
- address trust; and
- roster persistence.

`state` is an allowlisted cache state: `current`, `stale`, `refreshing`, `incomplete`, `failed`, or `not_applicable`. Unknown/missing values are stale and non-authoritative.

### Stage dependency and invalidation matrix

The planner derives this graph server-side. The client may request a candidate/stage refresh but cannot declare inputs current, omit prerequisites, or broaden/narrow invalidation. “Invalidate” means mark the named stage non-authoritative and schedule it according to policy; it does not erase its last display evidence.

| Stage | Input/version dependencies | Stages invalidated when this stage/input changes |
|---|---|---|
| Applicant materialization / anchor | Request ID; canonical Dataverse suggestion ID; normalized recommended-slot fingerprint (name, institution, supplied contact/identifier); applicant-materialization contract version | Identity, institution COI, coauthor COI, eligibility check, contact projection, address trust, roster persistence |
| Identity | Current applicant/candidate input fingerprint; canonical anchor/candidate key; identity evidence/receipt source version; identity contract version | Institution COI, coauthor COI, eligibility check, contact projection, address trust, roster persistence |
| Institution COI | Current identity and reviewer-institution fingerprint; request PI/applicant-organization fingerprint; institution-COI contract/source version | Roster persistence only |
| Coauthor COI | Current identity/researcher identifiers and name variants; proposal-author fingerprint; proposal content version; publication-source and coauthor-COI contract versions | Roster persistence only |
| Eligibility check | Current identity/canonical-person anchor; eligibility evidence source/version or expiry; eligibility contract version | Roster persistence only |
| Contact projection | Current identity; canonical Dataverse reviewer/person ID and ETag/version; allowed contact-source versions; contact-projection contract version | Address trust, roster persistence |
| Address trust | Current identity and contact/address fingerprint; canonical person ID and ETag/version; staff confirmation/receipt version; address-trust contract version | Roster persistence only |
| Roster persistence | Candidate key; current upstream stage receipt versions; pruning/projection contract version; expected roster snapshot/`updatedAt` | None; it is the terminal persisted projection |

Invalidation is dependency-specific:

- a proposal path/eTag/content change invalidates coauthor COI and any separately tracked proposal-relevance evidence, **not** applicant materialization, identity, eligibility, contact, or address trust;
- a recommended-slot identity/input change starts at applicant materialization and therefore invalidates all candidate-dependent stages;
- a request PI/applicant-organization change invalidates institution COI, not unrelated identity/contact/eligibility stages;
- a canonical person/contact ETag change invalidates contact projection and address trust without repeating proposal or publication work; and
- a stage contract/source-version change invalidates that stage plus only the downstream stages named in the matrix.

Planner tests must exercise every matrix row, the proposal-change non-invalidation complement, transitive invalidation from applicant/identity changes, and unknown dependency versions failing closed as `stage_contract_changed` or `unclassified_miss`.

Dataverse engagement authority is deliberately **not** a persisted reusable stage receipt: it is reconciled for the current panel generation and represented by response/client `authorityState`. Promotion services still re-read/enforce engagement at mutation time.

### Eligibility completeness is separate from result

Current `eligibilityStatus` conflates result with whether the check completed. Target fields:

- `eligibilityCheckStatus`: `complete`, `not_applicable`, `pending`, `incomplete`, or `error`;
- `eligibilityStatus`: existing result semantics (`deceased`, `emeritus`, or `unknown`; add `eligible` only if the evidence contract can actually prove it).

P0 recommendation:

- promotion requires `eligibilityCheckStatus === 'complete'` or a documented server-issued `not_applicable`;
- `eligibilityStatus === 'deceased'` blocks;
- `emeritus` and a completed `unknown` retain the existing product policy unless Justin changes it; and
- pending/incomplete/error/missing check status blocks even when `eligibilityStatus` is not `deceased`.

### Refresh persistence

Starting a refresh atomically updates only that candidate/stage metadata using `expectedUpdatedAt`:

- set stage state to `refreshing` with `refreshAttemptId`, `refreshStartedAt`, and reason;
- retain the last completed display result/evidence, but mark it cached and non-authoritative for promotion;
- never erase a prior complete result merely because a refresh began.

Success atomically replaces only the stage result/receipt and marks it `current`. Failure preserves prior evidence and writes `incomplete` or `failed` plus a bounded error code. A process death leaves `refreshing`; after the configured lease window, the next revisit maps it to `prior_refresh_incomplete` and retries only that candidate/stage.

All writes use candidate key + expected roster version. A stale writer returns `skipped_stale`; it does not overwrite a newer projection.

### Refresh planner output

The planner returns:

```json
{
  "candidateKey": "suggestion:<guid>",
  "cacheOutcome": "partial_hit",
  "currentStages": ["identity", "contact"],
  "refreshes": [
    { "stage": "coauthor_coi", "reason": "proposal_content_changed" }
  ],
  "promotionAuthority": "blocked_refresh_required"
}
```

One stale candidate never sends the full recommendation set to `enrich-recommended`. One stale stage never repeats already-current identity/contact/provider work.

## Warm miss and refresh reason codes

Every non-hit has at least one allowlisted reason. Required initial codes:

- `no_roster_history`
- `candidate_added`
- `candidate_missing`
- `candidate_input_changed`
- `applicant_set_changed`
- `proposal_binding_changed`
- `proposal_content_changed`
- `warm_cache_version_changed`
- `stage_contract_changed`
- `stage_missing`
- `stage_incomplete`
- `prior_write_incomplete`
- `prior_refresh_incomplete`
- `authority_stale`
- `engagement_changed`
- `roster_snapshot_changed`
- `manual_refresh`

Failures add bounded provider/infrastructure codes but do not replace the invalidation reason. An unknown reason fails closed as `unclassified_miss`, blocks automatic expensive work, and is counted as a telemetry defect.

Content or input changes do not automatically launch a full cold search. They keep cached cards visible/read-only, identify affected candidates/stages, and require the explicit targeted refresh or new-search action defined by policy.

## Current → target promotion authority matrix

The target server checks are required even when the UI reports `authorityState: current`. The client never grants authority.

| Gate | Current generic save (`lib/services/reviewer-finder/save-candidates-service.js`) | Current applicant promotion (`lib/services/workbench/promote-applicant-reviewer-service.js`) | P0 target for both paths |
|---|---|---|---|
| Current roster row | Re-reads roster-managed candidates and validates server/staff receipts; missing/unavailable blocks. | Requires canonical suggestion-anchored roster candidate. | Require current candidate key, expected roster version, and allowed roster status. Cached-only/stale/refreshing blocks. |
| Dataverse engagement | Creates/reuses the candidate/suggestion under generic save's current contract. | Reads suggestion, rejects handled, and finishes with `selectIfUnengaged` concurrency enforcement. | Applicant path retains both checks. Generic path retains its create/reuse contract. Neither trusts cached engagement. |
| Identity | Valid automated attestation or matching request-scoped staff confirmation; unresolved blocks. | `requiresIdentityConfirmation` + stored server confirmation. | Preserve. Stage receipt must also be current for the candidate/input contract version. |
| Institution COI | Recomputes from trusted request/PI context and fails closed on screening failure/conflict. | [VERIFIED via symbol search] no explicit institution-COI gate in the promotion service. | Add equivalent authoritative institution screening to applicant promotion; pending/unavailable/conflict blocks both. |
| Coauthor COI | [VERIFIED via symbol search] no explicit completeness gate. | [VERIFIED via symbol search] no explicit completeness gate. | P0 recommendation: allow only `complete` or justified `not_applicable`; block `incomplete`, error, pending, missing, and conflict. No waiver in P0 unless Justin explicitly chooses one. |
| Eligibility check completeness | No separate field; roster lookup failure logs fail-open, and non-deceased/unknown can proceed. | Roster read failure blocks, but completed-vs-unchecked `unknown` is not distinguished. | Require `eligibilityCheckStatus` complete/not-applicable, then apply result policy. Provider/read failure blocks. |
| Eligibility result | Direct or stored `deceased` blocks. | Roster ineligible/deceased blocks. | Preserve deceased block; keep emeritus/completed-unknown policy explicit and identical. |
| Contact/email | Computes authoritative contact projection; missing/ambiguous/conflicting contact blocks. | Re-reads known reviewer/person, resolves writes, then requires canonical contact `ready`. | Preserve; a current contact stage may avoid provider work but never skips the server's canonical person/email check. |
| Address trust | Requires current server roster/address receipt where applicable. | Re-reads address trust/conflict, requires matching receipt, uses ETag on person write. | Preserve; stale/missing address receipt blocks. |
| Persistence completion | Per-candidate save results exist, but roster write helper can collapse failures to counts. | Dataverse selection may succeed while roster finalization is non-fatal partial success. | Return/persist exact per-candidate outcomes. A pending/failed roster finalization is reason-coded and repaired without redoing evidence stages. |

## New-status fan-out requirements

Before adding `eligibilityCheckStatus`, `stageFreshness.*.state`, `authorityState`, `not_applicable`, or any coauthor terminal state, implementation must grep the raw field/status and update every producer, projection, sanitizer, persistence path, consumer, and test.

Minimum `eligibilityCheckStatus` fan-out:

- producer: `lib/services/contact-enrichment/eligibility-evidence.js` and tier orchestration;
- merge/prune: `shared/components/reviewers/reviewer-search-logic.js`;
- attestation: `lib/services/reviewer-candidate-attestation.js` encode/verify contract;
- applicant projection: `lib/services/workbench/enrich-recommended-service.js`;
- roster route/store: `pages/api/workbench/reviewer-roster.js`, `lib/services/reviewer-roster-store.js`;
- UI/selectability: `ReviewerSearchSection.js`, `isCandidateSelectable`;
- promotion: both services in the matrix; and
- all unit/integration fixtures that currently set only `eligibilityStatus`.

Minimum coauthor-status fan-out:

- producer/summarizer: `lib/services/discovery/coauthor-coi.js`;
- discover and applicant enrichment projections;
- merge/prune and roster JSON;
- cached refresh planner;
- card/selectability UI;
- both promotion services; and
- tests for complete, not-applicable, incomplete, provider error, missing, and unknown values.

Minimum `stageFreshness` fan-out:

- every stage producer and dependency planner;
- `pruneCandidateForRoster` and any candidate DTO validator/sanitizer;
- roster write/read/refresh helpers;
- warm revalidation response projection;
- card badges, selectability, save payload construction, and both promotion services; and
- export/other candidate-JSON consumers found by raw-field grep, plus tests for every complement/fall-through value.

`authorityState` is response/client state, not persisted candidate authority. `current` requires all bounded authority/input reads for that panel generation to succeed; partial or failed reads must produce `stale`/`error`, never a partial `current`. Its fan-out is roster route → panel bootstrap → search section → select/save/promote controls → tests. Unknown values render cached/read-only and block promotion. Miss reason codes fan out through planner, response, retry UI, telemetry aggregation, and fixtures; an unknown reason remains `unclassified_miss`, never a hit.

## Implementation slices

### P0 — warm revisit first

#### 0.1 Two-phase roster bootstrap

Touch:

- `ReviewerFindPanel.js`
- `ReviewerSearchSection.js`
- `pages/api/workbench/reviewer-roster.js`
- `lib/services/reviewer-roster-store.js`
- `lib/services/workbench/reviewer-roster-projection-service.js`

Add `mode=cached|reconciled`, snapshot-version conflict handling, parent-owned bootstrap state, and cached/read-only rendering. Keep the current default response temporarily for compatibility; caller search must precede removing it. The first shippable UI state is deliberately **display-only**: all selection, add, save, and promotion controls remain disabled even after reconciliation until 0.3–0.5 are complete and enabled.

#### 0.2 Stop mount-time cold work

Change `ReviewerFindPanel` so `runIngestion` and `loadProposal` do not auto-run merely to render a warm roster. Split applicant input **read** from materialization/write/model parsing. Add a metadata-only proposal resolver that returns the exact binding and opaque Graph content version without downloading bytes.

Cold proposal load occurs only after explicit new search, targeted proposal-dependent refresh, or deliberate file selection.

This slice has a hard flag dependency on 0.3 and 0.4. Do not disable the existing automatic enrichment path where it is still the only repair mechanism for legacy/stale roster rows until the targeted planner, per-stage persistence, and retry path are deployed and verified. Before that dependency is satisfied, cached first paint may ship display-only, but the old background behavior remains behind its existing flag and authority-dependent actions remain disabled.

#### 0.3 Per-candidate/stage refresh planner

Replace `hasValidApplicantEnrichmentCache` with a planner. Refactor `applicant-reviewers-service` and `enrich-recommended-service` so callers can materialize/refresh one suggestion and one stage. Preserve canonical suggestion IDs; never use name as refresh identity.

The server accepts an allowlisted stage and authoritative candidate/suggestion ID. It derives dependencies and reason codes server-side; a client cannot claim that a stage is current or skip prerequisites.

#### 0.4 Versioned refresh persistence and per-row outcomes

Extend roster store operations with:

- candidate-key + `expectedUpdatedAt` compare-and-swap;
- stage-level `refreshing/current/incomplete/failed` metadata;
- `refreshAttemptId`/lease recovery;
- full per-row outcomes (`recorded`, `skipped_stale`, `rejected`, `failed_retryable`, `failed_terminal`); and
- detailed applicant terminal frames rather than `count/skipped`.

P0 uses the existing JSONB candidate column and requires no schema migration. If query/index needs later justify extracted columns, that is a separately reviewed migration.

#### 0.5 Align promotion authority

Implement the matrix across `isCandidateSelectable`, `lib/services/reviewer-finder/save-candidates-service.js`, and `lib/services/workbench/promote-applicant-reviewer-service.js`.

Recommendation for P0: fail closed on incomplete coauthor and eligibility checks, with no waiver. Justin may choose a waiver later, but it must be server-recorded, actor-bound, reasoned, and added in a separate fan-out review.

#### 0.6 Warm telemetry

Emit bounded structured logs/response timings with run/request correlation but no proposal text, names, emails, search snippets, or provider bodies.

Record:

- panel mount → cached roster React commit;
- cached commit → reconciled authority/current interactions;
- cache outcome and every reason code;
- candidate/stage refresh counts;
- full-batch refresh attempts;
- Graph metadata versus download counts;
- Dataverse reads/writes;
- expensive-provider calls by route/stage; and
- stale snapshot/write/stream outcomes.

### P1 — explicit cold-search progressive delivery

After warm P0 is stable:

- emit versioned candidate events during discover/contact/applicant work;
- use immutable `clientCandidateId`, authoritative `candidateKey`, server `routeRunId`, and monotonic revisions;
- replace candidate projections rather than deep-merging stale flags;
- use AbortController + generation guards on every success/error/finally state write;
- persist each candidate independently with detailed outcomes; and
- show grounded/read-only candidates before all contact stages finish.

Cold progress is honest: proposal loading, analysis, database discovery, identity, institution COI, coauthor COI, eligibility, contact, and roster persistence each have visible state. Stream close without a terminal event is unknown, not success.

### P2 — measured operational optimization

Paid-call reduction, PubMed query consolidation, Dataverse batching, and evidence caching are experiments after warm/cold telemetry exists.

- Paid/provider calls per explicit search remain a cost metric; do not trade away actionable-candidate attainment.
- PubMed batching ships only with equivalent candidate/author attribution, zero false clean negatives in the evaluation corpus, and material request/wall-time reduction.
- Dataverse batching ships only with identical ETag/restriction/interlock and per-row failure semantics.
- Evidence caches include provider/query/contract/source versions; incomplete/error responses are never clean negatives.

## Metrics and evidence-based targets

There is no reliable warm browser baseline. Run telemetry in shadow before enforcing latency targets.

### Warm milestones

- `warm_panel_mounted`
- `warm_cached_roster_visible` — after React commits the Postgres snapshot
- `warm_authority_reconciled`
- `warm_candidate_interactive` — required authority current for at least one eligible action
- `warm_refresh_complete`

### Warm correctness and cost metrics

| Metric | Initial contract |
|---|---|
| Expensive-provider calls on an unchanged revisit | **Exactly 0** for proposal download/Blob copy, Claude, PubMed, OpenAlex, ORCID, Europe PMC, Serp/contact discovery |
| Full-batch applicant reenrichment caused by one stale candidate/stage | **Exactly 0** |
| Miss/refresh reason-code coverage | **100%**; unknown becomes `unclassified_miss` and blocks automatic expensive work |
| Stale roster/event overwrite | **0** |
| Unsafe action while authority cached/stale | **0** |
| Warm cache-hit rate | Measure by request/candidate/stage; no invented target until input-change frequency is observed |

### Warm latency target process

1. Collect at least 30 qualifying warm opens over at least 48 hours with the feature disabled/shadowed; call p50/p90 baselines `B_cached` and `B_authority`.
2. Canary must improve cached-visible p90 materially without regressing reconciliation or safety. Initial evidence-based gate: p90 ≤ 0.5 × `B_cached`; revise after the sample is reviewed.
3. Provisional product hypotheses—not release promises—are cached roster visible ≤2s and authoritative interaction ≤5s on an unchanged healthy revisit. Promote them to SLOs only if the shadow/canary distribution and Dataverse availability support them.
4. Report errors, stale conflicts, navigation cancels, and zero-row requests separately; do not remove them to improve percentiles.

### Cold metrics

Retain search-click → first grounded, first actionable, and background-complete timing plus attainment rates. Do not impose an unsupported absolute cold SLO in P0. Paid calls per explicit search are reported as an operational metric, not the warm UX success criterion.

## Partial success, retry, and stale semantics

| Condition | Visible state | Authority/action | Retry/persistence |
|---|---|---|---|
| Cached roster returned; Dataverse pending | Cards visible as refreshing | Display-only | Reconcile same snapshot version |
| Dataverse unavailable | Cached cards remain with explicit error | Promotion disabled | Retry authority only; no evidence providers |
| One candidate stage stale | That card/stage marked stale | Only dependent actions blocked | Refresh that ID/stage |
| One stage refresh fails | Prior evidence remains visible as stale | Stage stays non-authoritative | Store failure/reason; targeted retry |
| Refresh process dies | `refreshing` persists until lease expiry | Non-authoritative | Map to `prior_refresh_incomplete`; resume one stage |
| Roster CAS loses | Newer row wins | Reload current authority | Return `skipped_stale`; never overwrite |
| Proposal metadata changed | Prior cards visible/read-only | Proposal-dependent promotion gates block | Explicit targeted refresh or new search; no automatic cold run |
| Applicant slot changed | Unchanged candidates remain current | Changed slot blocks/refreshes only | Materialize/refresh that slot |
| Dataverse engagement changed | Handled reviewer leaves active bucket | No stale promotion | Reconciled response supplies handled stage |
| New explicit search supersedes old | New generation owns UI | Old events ignored | Abort where possible; committed rows remain |

## Tests

### Warm route/service

- both `mode=cached` and `mode=reconciled` retain `requireAppAccess` and request GUID validation; neither mode accepts client authority or weakens record/app scope.
- reconciled Dataverse work enters `withDalContext` and preserves restriction/interlock behavior at the existing seams; cached mode performs no Dataverse work.
- unknown/repeated/conflicting mode input fails closed; the temporary missing-mode compatibility behavior is explicit and tested.
- `mode=cached` makes no Dataverse/Graph/provider calls.
- `mode=reconciled` returns cached rows plus current engagement and reason-coded validation.
- roster snapshot conflict returns 409 + fresh snapshot.
- metadata-only proposal resolution never downloads or uploads content.
- unchanged revisit invokes no expensive providers.
- one stale candidate/stage calls only its targeted service.
- refresh start/success/failure/lease-expiry preserves prior evidence and CAS semantics.
- no-history panel remains idle/read-only and makes no proposal/applicant/model/provider calls until explicit `Run search`.
- proposal-content change invalidates coauthor/proposal-relevance evidence but leaves identity, eligibility, contact, and address stages current when their own dependencies are unchanged.

### Gate and fan-out

- Both promotion services exercise every matrix row with current, pending, incomplete, error, missing, unknown, stale, and not-applicable inputs.
- Negative tests contain evidence that would pass if the guard were deleted.
- `eligibilityCheckStatus=complete` with `eligibilityStatus=unknown` is distinct from missing/pending/incomplete.
- Unknown enum/status values fail closed in UI, sanitizer, attestation, roster, and promotion.
- Applicant institution COI is recomputed/validated server-side.
- Incomplete coauthor check blocks both promotion paths under the recommended P0 policy.

### React and end to end

- Prior request cards render before delayed Dataverse reconciliation.
- Cached cards cannot be selected/promoted.
- Authority-current response enables only candidates whose stage receipts are current.
- Request/proposal switch ignores every old success/error/finally update.
- Request 1003046-like history revisits without proposal download, model call, PubMed, contact discovery, or full applicant enrichment.
- Same-name distinct anchored candidates remain separate.
- A changed proposal under the same path produces `proposal_content_changed` through eTag/version comparison.

## Rollout and rollback

Use independent flags for:

- Postgres-first cached roster response/UI;
- reason-coded warm revalidation;
- targeted applicant stage refresh;
- suppression of legacy mount-time cold work, with a hard dependency on targeted refresh/persistence;
- explicit promotion-gate alignment; and
- later cold progressive events.

“Independent” means each behavior can be rolled back separately; it does not remove safety dependencies. The suppression flag must refuse to enable unless targeted refresh/persistence is enabled, and reconciled authority-dependent controls must refuse to enable unless promotion-gate alignment and stage freshness are enabled.

Rollout order:

1. Add shadow telemetry, authenticated `mode=cached|reconciled`, snapshot handling, and reason classification without changing UI behavior.
2. Align server promotion gates, including applicant institution COI and separate eligibility completeness; recommended coauthor policy is fail closed/no waiver.
3. Enable cached roster first paint for staff canary in the safe intermediate **display-only** state: all authority-dependent controls stay disabled, regardless of a reconciled response.
4. Deploy per-candidate/stage dependency planning, stage receipts, stale-safe persistence, and manual targeted refresh/retry. Keep the legacy automatic enrichment path available while it remains the only stale-row repair path.
5. Suppress warm mount proposal/applicant cold work only under a dependent flag that requires step 4. Verify legacy/stale rows can be repaired through the targeted path and that no-history panels remain idle until explicit search.
6. Enable reconciled selection/add/save/promotion controls only after steps 2 and 4 are live and every candidate's required authority/stage receipts are current. Then allow automatic refresh only for separately approved cheap stages.
7. Expand warm P0 after 1003046-like revisit, security-mode, invalidation-matrix, and zero-expensive-call telemetry review.
8. Implement cold progressive delivery separately.

Rollback cached UI without restoring automatic expensive work: fall back to the reconciled roster response, keep reason telemetry and corrected server gates, and retain targeted-refresh persistence. Never roll back only one side of a promotion gate.

Stop canary for any unsafe action, unreasoned miss, expensive call on unchanged revisit, stale overwrite, identity name-merge, or full-batch applicant refresh caused by a single stale candidate.

## Next-cycle autonomous-search extension

[ASSUMED from Justin's 2026-08-01 future-cycle intent] full proposals will be available on day one, Reviewer Finder may run autonomously after requests advance, recommended/excluded inputs should be better curated, and longer proposals with references should provide better evidence. [ASSUMED] model quality may improve. None of these assumptions may be a safety dependency.

This is a staged future extension, not P0.

### Trigger and approval boundary

- A named request lifecycle transition and feature policy creates an eligible run.
- Initial rollout is shadow-only, then staff approval-to-start; unattended start requires separate authorization.
- Autonomous search may write/find roster candidates. It does not select, invite, email, or promote reviewers without a separately approved contract.

### Durable run ownership

Use a durable run record/job only for autonomous work, with:

- request ID, proposal content-version key, curated input version, search contract version, prompt version, and model ID;
- owner/lease token, heartbeat, attempt, deadline, cancellation, and terminal outcome;
- per-stage/per-candidate checkpoints and detailed partial outcomes;
- one active run per exact idempotency key; and
- retention/cleanup, migration, manifest, Atlas, route-security, and operational ownership.

An exact idempotency key is derived from request + content version + curated include/exclude version + search contract + prompt + model + requested policy. Duplicate triggers join or return the existing run; they do not start another search.

### Curated inputs and content versioning

- Included/applicant-recommended and excluded lists are stored/versioned inputs, not mutable text read midway through a run.
- Proposal identity uses Graph drive/item/eTag or version ID, not path alone.
- A changed proposal/input set creates a new run key and reason-coded invalidation; it never mutates the meaning of an existing run.

### Retry and auditability

- Retry only failed/retryable candidate stages; completed stages remain checkpointed.
- Every provider/model call records stage, prompt/model/contract version, duration, outcome, and bounded counts without proposal/person PII in general logs.
- Staff can see why a candidate was included, excluded, blocked, retried, or refreshed.
- Model output is never identity, COI, eligibility, address, or promotion authority by itself.

Improved models, references, and curation may improve recall/reasoning, but deterministic identity/COI/contact gates, authoritative Dataverse checks, versioned inputs, and idempotent persistence must remain correct if model quality does not improve—or regresses.

## Contract-reconcile Mode A review

### Findings

1. **VERIFIED — Warm display is unnecessarily coupled to authoritative reconciliation.** Evidence: roster GET awaits Postgres then Dataverse before returning; the client already renders roster independently of search phase. Residual risk: cached rows may briefly be engagement-stale, so the target keeps them read-only.
2. **VERIFIED — Mount effects initiate cold work without a search action.** Evidence: panel mount effects call applicant ingestion and proposal load; applicant cache miss auto-calls full enrichment. Residual risk: splitting read/materialize changes service contracts and needs focused tests.
3. **VERIFIED — Applicant freshness is batch-global.** Evidence: `hasValidApplicantEnrichmentCache` returns one boolean only after every expected row passes; caller refreshes all actionable recommendations. Residual risk: stage dependency graph must be explicit so a narrow refresh does not omit prerequisites.
4. **VERIFIED — Promotion authority is asymmetric.** Evidence: generic save recomputes institution COI; applicant promotion has no institution/coauthor symbol checks; neither path distinguishes eligibility check completeness. Residual risk: P0 gate alignment can expose legacy rows needing targeted refresh.
5. **READY WITH NAMED CHANGES — Postgres-first rendering is safe only as display state.** Required changes: cached authority label, disabled promotion, snapshot/version reconciliation, per-stage freshness, server rechecks, and unknown-status fail-closed behavior.
6. **READY WITH NAMED CHANGES — Cold-work suppression must follow targeted stale-row repair.** Required changes: explicit flag dependency, legacy/stale repair coverage, and an idle/no-history contract; cached first paint may ship earlier only with all authority-dependent controls disabled.
7. **READY WITH NAMED CHANGES — Roster modes must preserve the route's security boundary.** Required changes: shared authentication/request validation, reconciled DAL context, existing interlock behavior where applicable, a server mode allowlist, and negative tests proving mode cannot weaken authorization.

### New issues

- **HIGH — Applicant promotion lacks an explicit server institution-COI gate.** Required change: add the same trusted-context screening semantics as generic save before mutation.
- **HIGH — Eligibility result does not prove eligibility check completion.** Required change: add and enforce separate completeness state across all fan-out consumers.
- **HIGH — Coauthor incomplete/missing state is not enforced by either promotion service.** Required change: P0 fail closed/no waiver unless Justin chooses and separately specifies a server-recorded exception.
- **MEDIUM — Legacy roster rows will lack new stage receipts.** Required change: show them cached/read-only, assign `stage_missing`/`warm_cache_version_changed`, and refresh only missing stages; do not silently grandfather or discard them.
- **HIGH — Suppressing legacy automatic enrichment before targeted refresh exists removes the only repair path for stale rows.** Required change: gate suppression on deployed per-stage planning/persistence/retry, and keep the interim cached UI display-only.
- **MEDIUM — A client-selectable roster mode could become an authorization bypass if auth/context handling diverges.** Required change: authenticate before mode dispatch, allowlist mode, preserve DAL/restriction/interlock seams, and test both positive and negative complements.

### Recommendation evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Render Postgres roster before Dataverse | `listForRequest` returns render DTO | Yes, inside roster GET before reconciliation | Source trace; not performance-tested | Shadow measure may show Postgres itself is slow | VERIFIED |
| Preserve auth/restriction boundary in both modes | Existing route authenticates before dispatch; reconciliation enters DAL context | Yes, at the common handler and reconciled service boundary | Source trace; new modes NOT TESTED | A future early mode return placed before `requireAppAccess` would violate it | VERIFIED |
| Skip proposal/applicant cold work on unchanged revisit | Persisted roster + metadata fingerprints | Roster exists; stable content/input fingerprints are planned | NOT TESTED | Content/input may change between opens | ASSUMED |
| Suppress legacy automatic enrichment | Targeted stage planner, stale-safe persistence, and a working repair/retry path | Only after PR/rollout step 4; not available today | NOT TESTED | Legacy stage-missing row cannot be repaired without the old path | ASSUMED |
| Refresh one candidate/stage | Canonical key + stage receipt/dependencies | Candidate key exists; stage receipt/planner is planned | NOT TESTED | Shared proposal-context invalidation may legitimately affect many candidates | ASSUMED |
| Zero expensive calls on unchanged revisit | Cache hit proven by authority/content/input versions | Planned at reconciled warm response | NOT TESTED | Hidden mount effect/provider call remains | ASSUMED |
| Future autonomous search | Durable trigger/run/idempotency contract | Not present today | NOT TESTED | Duplicate lifecycle events/restarts | ASSUMED |

### Seven-audit disposition

1. **Whole flow:** caller → common route authentication/validation → cached client state → roster cached/reconciled modes → Postgres/Dataverse/Graph metadata → response → display-only intermediate state → freshness/gate-qualified actions → promotion is traced. No-history remains idle until explicit search.
2. **Partial success:** unit is candidate/stage; identifiers and outcomes replace counts; failed stages remain retryable.
3. **Async/stale:** request generation, roster snapshot version, AbortController, monotonic stage attempts, and CAS protect every post-await path.
4. **Helper semantics:** search suppression, display dedup, identity aliasing, dependency-scoped freshness, and persistence sanitization remain distinct. Proposal changes do not invalidate unrelated identity/contact/eligibility stages.
5. **Durable surface:** P0 reuses roster JSONB; any autonomous job/metrics table requires migration/manifest/Atlas/security/cleanup review.
6. **Doc reconcile:** this document replaces the cold-first priority throughout summary, slices, metrics, rollout, decisions, and PR order; the generated catalog summary is current and must remain synchronized.
7. **Fan-out:** new status/read surfaces are enumerated above; route mode/auth tests and every dependency-matrix complement are required; implementation must raw-symbol grep before completion.

**Final verdict:** READY WITH NAMED CHANGES. Warm two-phase bootstrap is the correct P0. Required named changes are the authority matrix alignment, separate eligibility completeness, fail-closed coauthor completeness, explicit dependency-scoped invalidation, per-candidate/stage freshness, reason-coded misses, stale-safe refresh persistence, authenticated/fail-closed mode handling, an idle no-history state, and suppression of legacy automatic enrichment only after targeted repair is available. Cached first paint is safe before the full stack only as display-only UI with every authority-dependent control disabled.

## Decisions required from Justin

1. Confirm P0 coauthor policy: recommendation is fail closed on incomplete/missing/error with no waiver. A waiver is deferred unless operations demonstrate a need.
2. Confirm completed `eligibilityStatus: unknown` remains promotable when `eligibilityCheckStatus: complete`; recommendation is yes, preserving current result policy while fixing completeness.
3. Confirm which targeted refresh stages may auto-run after warm reconciliation. Recommendation: auto-run cheap authoritative reads; require explicit action for proposal download, Claude, publication/COI search, or paid contact work.
4. Confirm legacy stage-missing rows remain visible/read-only until targeted refresh rather than being grandfathered. Recommendation: yes.
5. After shadow measurement, approve or revise the provisional ≤2s cached-visible / ≤5s authoritative-interaction hypotheses.
6. For next cycle, define the lifecycle trigger and whether autonomous runs are shadow-only, approval-to-start, or unattended. Recommendation: shadow → approval-to-start before any unattended operation.

## Recommended PR sequence

1. **Warm telemetry + secure route split:** authenticated `mode=cached|reconciled`, mode allowlist, unchanged DAL/restriction/interlock boundaries, snapshot token, no UI behavior change.
2. **Authority alignment:** applicant institution COI, coauthor completeness, eligibility completeness, UI state model, and both promotion services; keep current UI behavior until gates are ready.
3. **Display-only cached first paint:** parent-owned bootstrap, cached cards, delayed authority state, no duplicate roster fetch, and every selection/add/save/promotion control disabled.
4. **Freshness planner + stale-safe persistence:** dependency matrix, per-candidate/stage receipts, reason codes, legacy handling, stage attempt/lease/CAS, detailed per-row outcomes, and manual targeted refresh/retry APIs.
5. **Suppress warm cold-work behind the step-4 dependency flag:** metadata-only proposal/input validation; no mount-time download/analyze/provider/full enrichment; no-history panels remain idle. Do not enable this flag until legacy/stale repair succeeds through the targeted path.
6. **Enable reconciled actions:** only after #2 and #4, enable controls candidate-by-candidate when current panel authority and every required stage receipt are current; add approved cheap automatic targeted refreshes separately.
7. **Cold progressive search:** candidate events and partial persistence after warm P0 is stable.
8. **Autonomous-search design/build:** separate future plan after trigger authority is chosen.

This order produces the warm-user benefit before changing cold-search provider behavior and keeps future autonomy from expanding P0 scope.
