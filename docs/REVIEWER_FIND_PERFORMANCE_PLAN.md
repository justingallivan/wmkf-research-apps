---
title: Reviewer Find Warm-Revisit Performance and State-Coherence Plan
domain: reviewer-workbench
kind: history
status: superseded
summary: "Historical: superseded warm-revisit plan; implementation reverted to the pre-rollout baseline. Problem statement remains valid input for future work."
canonical: false
cataloged: 2026-08-02
owner: product-engineering
related:
  - docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md
  - docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md
  - docs/REVIEWER_ANALYZE_CONTRACT_SPEC.md
  - docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md
  - docs/REVIEWER_CONTACT_LEADS_SPEC.md
  - docs/REVIEWER_GATING_STRATEGY_REDESIGN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/atlas/postgres-reviewer-find-roster.md
---

# Reviewer Find Warm-Revisit Performance and State-Coherence Plan

> **INCIDENT STATUS (2026-08-03):** [VERIFIED via Git, deployment checks,
> signed-in no-send checks, user screenshots, and current source] the
> implementation described here is merged, pushed, and deployed through
> `7072d52a`. It remains **functionally incomplete in Production**: a
> deterministic staff-action condition can be emitted as retryable/queued, and
> the UI still offers a per-card **Refresh contact evidence** action that cannot
> resolve that condition. See
> `docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md`. Older
> branch-only and pre-release statements below are retained as historical
> design evidence and do not describe current deployment state.
>
> **Primary objective:** returning to a previously searched request should show its persisted candidates promptly and should not repeat proposal, model, publication, or contact work merely to reconstruct the screen.

## Decision summary

[VERIFIED via Justin's 2026-08-01 clarification] the primary complaint is the **warm revisit**, not the expected duration of an explicitly initiated new Claude search.

| Contract | User intent | Target behavior |
|---|---|---|
| **Warm/revisit** | Open a request that already has Reviewer Find history | Render the Postgres roster first as cached/read-only; reconcile current Dataverse authority in the background; refresh only stale candidate stages; make zero expensive-provider calls on an unchanged revisit. |
| **Cold/new search** | Explicitly ask the system to find new reviewers | Load the selected proposal, run Claude and evidence providers, show honest stage progress, publish partial candidates progressively, and persist each candidate independently. The user expects this to take time. |
| **Future autonomous search** | A request advances into a future configured reviewer-search stage | **DEFERRED:** design a durable, auditable run only after staff settle the authoritative lifecycle event and approval level. Its result is roster candidates, never an automatic invitation or reviewer promotion unless separately authorized. |

Settled operating decisions from Justin and the primary agent on 2026-08-01:

- **[VERIFIED via Justin and the primary agent's 2026-08-01 decision] Coauthor completeness:** fail closed by default and retry the failed candidate/author queries first. After retries are exhausted, a narrow audited staff override may permit an invitation only through a **[PLANNED]** reviewer COI-attestation-before-acceptance and possible-conflict hold flow; provider failure never becomes a clean negative.
- **[VERIFIED via Justin and the primary agent's 2026-08-01 decision] Eligibility:** `eligibilityCheckStatus=complete` with `eligibilityStatus=unknown` may proceed subject to every other gate. Incomplete/error/missing blocks; deceased or authoritative ineligible blocks; emeritus is informational under current policy.
- **[VERIFIED via Justin and the primary agent's 2026-08-01 decision] Warm refresh:** automatic background work is limited to inexpensive authoritative roster/Dataverse/Graph/canonical-version revalidation. Proposal download/parse, Claude, publication/coauthor discovery, uncertain external identity resolution, and contact discovery require explicit staff action in the warm UI.
- **[VERIFIED via Justin's 2026-08-03 correction] Staff action is not a retry loop:** an actual identity/institution judgment may require staff, but a deterministic unmet-input condition must render that decision directly. Staff must not be asked to repeat a request-level or per-card refresh that cannot change the result.
- **[VERIFIED via Justin and the primary agent's 2026-08-01 decision] Legacy evidence:** use a reviewed compatibility mapper. Promote only evidence demonstrably equivalent to the new receipt contract; ambiguous/missing evidence becomes `stage_missing`/`incomplete` and receives targeted refresh, never blanket grandfathering or mass recompute.
- **[VERIFIED via the primary agent's 2026-08-01 decision] Warm measurement ownership:** the primary agent owns the measurement decision. Zero expensive calls, unsafe actions, stale overwrite, and full-batch refresh from one stale stage remain hard contracts; latency values remain hypotheses until shadow data supports SLOs.
- **[VERIFIED via Justin, the primary agent, and current planning sources on 2026-08-01] Autonomous trigger:** `wmkf_triagestatus=Advancing` is a current-cycle visibility/routing patch, not the future trigger. Prior direction points to an authoritative internal Phase I→II/phase-advanced Dataverse event, but the exact event and autonomy level remain open.

P0 is therefore a **warm-bootstrap and cache-correctness release**:

1. read `reviewer_find_roster` without waiting for Dataverse;
2. render that snapshot immediately with a visible `Cached — refreshing` state and promotion disabled;
3. perform lightweight, authoritative revalidation without downloading/analyzing the proposal;
4. enable only actions whose authority and required stage receipts are current;
5. refresh one candidate/stage when one candidate/stage is stale; and
6. attach a reason code to every miss, invalidation, or refresh.

Cold-search progressive delivery remains important, but it follows the warm-path fix. Paid-provider usage is an operational cost metric, not the headline user-experience metric.

## Implementation snapshot — 2026-08-03

[VERIFIED via source/tests] Current deployed source behavior is:

| Contract surface | Implemented branch behavior |
|---|---|
| Manual producers | The authenticated target-only stage route accepts `{ requestId, candidateKey, stage, expectedUpdatedAt }` and executes `applicant_anchor`, `identity`, `institution_domains`, `institution_coi`, `coauthor_coi`, `eligibility`, `contact`, and `roster_persistence`. Browser authority, evidence, provider, source, proposal/version, and plan fields are rejected. |
| Proposal-dependent authority | Connected applicant cold enrichment and manual `identity`/`coauthor_coi` bind their work to exact Graph metadata before and after proposal analysis. A changed binding/content version discards the result as `authority_changed`; legacy/public-Blob display fallback does not grant proposal-dependent authority. |
| Candidate concurrency | Stage start and completion use an exact roster-token CAS plus a **candidate-wide** lease. A competing live stage returns `refresh_in_progress`; a valid expired owner is persisted as a retryable recovery outcome before a new attempt. `recover_expired_lease` always carries reason `prior_refresh_incomplete`; if normal inputs are temporarily underivable, its incomplete receipt uses the opaque server-derived `reviewer-stage-expired-lease-recovery:v1` request/candidate/stage marker, so normal planning is still required. Malformed, foreign, or live leases return `lease_repair_required` and are operator-repair-only. |
| Cold applicant receipt accounting | `enrich-recommended-service` projects the evidence it already performed through `recordSurfacedWithStageEvidence` and returns per-candidate recorded, partial, or skipped outcomes. It does not treat an incomplete/changed authority result as current evidence. |
| Structured staff actions | `confirm_identity` derives the canonical identity from the authoritative roster/Dataverse row. The separate address action re-reads server identity/person ETags and atomically writes the matching `contact` and `address_trust` projections; neither trusts a client authority assertion. |
| Terminal persistence | Cold upsert, manual stage completion, and provider-free terminal repair all apply `roster_persistence` within the same candidate write. A losing CAS claims neither requested-stage nor terminal success. |
| Warm reads and display | Cached/reconciled warm reads perform zero evidence-provider and proposal-byte work. The client uses only returned target/stage state and displays each receipt's server-supplied “Evidence checked as of” value. |
| Legacy selection bridge | Receipt-less pre-stage rows can receive a selection-only marker only from a signature-verified, request/key/digest-bound v2+ automated attestation issued within 180 days (or an independently server-owned structured staff receipt), positive stored identity, and ready server-projected contact. The card says “Selection evidence current as of <date>”; ordinary promotion authority remains `blocked_refresh_required` and promotion rechecks current contact/conflict state. |
| Explicit reconciliation | `POST /api/workbench/reviewer-reconcile` accepts only a request ID and an optional exact roster-key subset bounded by the stored active-roster cap (300). The browser submits the exact active server-rendered keys, requires a one-for-one response, and keeps the action in a reloading state until the parent commits a terminal cached-to-reconciled snapshot. Active-producing roster writes await cap enforcement before reporting success. Reconciliation re-plans and refreshes sequentially through existing per-candidate stage primitives, never cold-searches, promotes, or sends mail. Legacy rows with a verified ORCID but no saved person authority may be rebound only to one exact active name-consistent Dataverse reviewer and receive deterministic ready/quick-check/not-applicable contact/address evidence under current person ETags; ambiguity, conflict, inactive or changed authority remains staff action. Applicant suggestions without a linked reviewer person return `action_required` and remain unselectable rather than being rejected or assigned a fabricated anchor. Only retryable and work-budget-exhausted rows return exact `continuationCandidateKeys`; terminal action-required, blocked, rejected, and policy/COI outcomes deliberately require staff action or a fresh request-level pass. All outcomes, including rejections, are counted in bounded non-PII diagnostics. A stored over-cap roster is an integrity fault, not a continuation: the UI tells staff to reload/contact an administrator and not rerun discovery. |
| Promotion | Generic save performs one bounded reconciliation preflight per multi-select batch using unique server roster keys, then re-reads each canonical roster candidate and derives a fresh promotion-authority snapshot immediately before the fail-closed gate. Applicant promotion likewise derives a fresh server snapshot; a cached receipt does not replace either current decision. |

**Intentionally unwired boundary.** [VERIFIED via source/tests] standalone
generic explicit-cold attestation/coordinator helpers and their tests exist,
but no HTTP route adapter invokes them. Connecting that path would retain or
redesign existing public-Blob behavior in `load-proposal`; that retention or
redesign was not authorized. This branch therefore makes no claim that generic
explicit cold search has the new attestation/coordinator contract.

This source was subsequently merged and deployed. Authenticated no-send checks
found the production incident recorded above. No reviewer email was sent and no
reviewer was selected, promoted, or invited during those checks.

## Historical baseline — Contract-reconcile Mode A: Step 0

The following baseline trace and planning findings were recorded before the
branch implementation summarized above. They explain the original scope, but
are not assertions of current branch behavior; current status is the
**Implementation snapshot — 2026-08-03** and the source/tests it cites.

- **Change surface:** Reviewer Workbench Find behavior from panel mount through cached roster display, authoritative revalidation, targeted refresh, explicit new search, and promotion.
- **Entry points:** `ReviewerFindPanel`, `ReviewerSearchSection`, `reviewer-roster`, `applicant-reviewers`, `enrich-recommended`, proposal-load, analyze/discover/enrich routes, and both promotion services.
- **Persistence:** Postgres `reviewer_find_roster`; Dataverse reviewer suggestion/person/request entities; SharePoint/Graph proposal metadata; existing Blob proposal copy; optional future run telemetry/job persistence.
- **Consumers:** Find grouping/counts/cards/actions, Invite and Track after promotion, later searches' exclusion/dedup inputs, reload restoration, tests, Atlas/docs, and operational telemetry.
- **Prior findings verified:** mount-time proposal and applicant work; roster reconciliation blocking cached display; all-or-nothing applicant cache; serial/whole-batch cold stages; count-only roster writes; name-based display dedup; missing explicit coauthor and eligibility-completeness promotion gates.

## Historical warm-path evidence

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
6. automatically run only inexpensive authoritative revalidation; present explicit staff actions for every expensive or uncertain stale stage.

An unchanged warm open must not:

- call `load-proposal`, download the proposal, or create a new Blob copy;
- call proposal analysis or any Claude reviewer-search prompt;
- call PubMed/OpenAlex/ORCID/Europe PMC/Serp contact or COI discovery merely to render cards;
- run full applicant enrichment; or
- rewrite current roster rows just to renew timestamps.

It may perform bounded metadata/authority reads: Postgres roster, Dataverse engagement/request inputs, and Graph file metadata without content download.

Automatic warm work is allowlisted to Postgres roster reads, Dataverse engagement/input/version reads, Graph metadata/content-version reads without download, and canonical record/version comparisons. Proposal download/parse, Claude, publication or coauthor discovery, uncertain external identity resolution, and contact discovery require an explicit staff action in the warm UI. Future authorized autonomous runs are a separate contract and cannot widen this warm allowlist.

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
- institution-domain evidence;
- institution COI;
- coauthor COI;
- eligibility check;
- contact projection;
- address trust; and
- roster persistence.

A completed persisted receipt `state` is allowlisted to `current`,
`incomplete`, `failed`, or `not_applicable`. A separate persisted
`stageRefresh` object holds `refreshing` attempt/lease metadata while retaining
the last completed receipt. `stale` is planner-derived from missing,
dependency-mismatched, expired, or unknown receipt data and is never persisted
as a completed receipt state. The planner/UI cache-state view may therefore use
the six-value vocabulary `current`, `stale`, `refreshing`, `incomplete`,
`failed`, or `not_applicable`; unknown values fail closed as stale.

### Stage dependency and invalidation matrix

The planner derives this graph server-side. The client may request a candidate/stage refresh but cannot declare inputs current, omit prerequisites, or broaden/narrow invalidation. “Invalidate” means mark the named stage non-authoritative and schedule it according to policy; it does not erase its last display evidence.

| Stage | Input/version dependencies | Stages invalidated when this stage/input changes |
|---|---|---|
| Applicant materialization / anchor | Request ID; canonical Dataverse suggestion ID; normalized recommended-slot fingerprint (name, institution, supplied contact/identifier); applicant-materialization contract version | Identity, institution-domain evidence, institution COI, coauthor COI, eligibility check, contact projection, address trust, roster persistence |
| Identity | Current applicant/candidate input fingerprint; canonical anchor/candidate key; proposal content version used by bounded proposal-field context; identity evidence/receipt source version; identity contract version | Institution-domain evidence, institution COI, coauthor COI, eligibility check, contact projection, address trust, roster persistence |
| Institution-domain evidence | Current identity result version (identity authority is required to execute provider resolution; nonauthoritative identity yields server-issued `not_applicable`); current-affiliation and ORCID/ROR institution fingerprint; domain-resolution source/contract version | Eligibility check, contact projection, address trust, roster persistence |
| Institution COI | Current identity and reviewer-institution fingerprint; request PI/applicant-organization fingerprint; institution-COI contract/source version | Roster persistence only |
| Coauthor COI | Current identity/researcher identifiers and name variants; proposal-author fingerprint; proposal content version; publication-source and coauthor-COI contract versions | Roster persistence only |
| Eligibility check | Current authoritative identity/canonical-person anchor; current institution-domain result/trusted-domain fingerprint; eligibility evidence source/version or expiry; eligibility contract version | Roster persistence only |
| Contact projection | Current authoritative identity; current institution-domain result; canonical Dataverse reviewer/person ID and ETag/version; allowed contact-source versions; contact-projection contract version | Address trust, roster persistence |
| Address trust | Current identity and contact/address fingerprint; canonical person ID and ETag/version; staff confirmation/receipt version; address-trust contract version | Roster persistence only |
| Roster persistence | Candidate key; current upstream stage receipt versions; pruning/projection contract version; expected roster snapshot/`updatedAt` | None; it is the terminal persisted projection |

Identity stage freshness and identity authority are separate. A complete
`ambiguous`/`unresolved`/`abstain` decision may remain current cache evidence,
but only `confirmed`, `probable`, or an exact valid staff confirmation satisfies
identity-sensitive producer and promotion prerequisites. While identity is
current but nonauthoritative, dependent stages may be server-issued
`not_applicable` with reason `identity_not_authoritative`; no downstream
provider runs, promotion remains blocked, and a later staff confirmation
invalidates those N/A receipts.

`roster_persistence` has three server-owned writers only: the atomic cold
candidate upsert, the same CAS that completes a manual upstream stage, and an
explicit provider-free terminal repair for a legacy row whose upstream set is
already complete. Warm GET/mount never writes or renews it.

Invalidation is dependency-specific:

- a proposal path/eTag/content change invalidates identity (because the existing verifier consumes bounded proposal-field context), all identity-dependent stages, coauthor COI, and any separately tracked proposal-relevance evidence; it does **not** invalidate applicant materialization;
- a recommended-slot identity/input change starts at applicant materialization and therefore invalidates all candidate-dependent stages;
- a request PI/applicant-organization change invalidates institution COI, not unrelated identity/contact/eligibility stages;
- a canonical person/contact ETag change invalidates contact projection and address trust without repeating proposal or publication work;
- an institution-domain result change invalidates eligibility, contact, address trust, and roster persistence; and
- a stage contract/source-version change invalidates that stage plus only the downstream stages named in the matrix.

Planner tests must exercise every matrix row, proposal-driven identity invalidation, transitive invalidation from applicant/identity/domain changes, and unknown dependency versions failing closed as `stage_contract_changed` or `unclassified_miss`.

### Legacy evidence compatibility and age review

Legacy rows pass through a reviewed, versioned compatibility mapper; they are neither blanket-grandfathered nor mass-recomputed. The mapper may mint a new stage receipt only when the stored evidence is demonstrably equivalent to the new stage's identity, dependency, completeness, and source contract. Ambiguous, missing, or non-equivalent evidence becomes `stage_missing` or `incomplete`, remains visible/read-only, and is queued for targeted staff-initiated refresh when the stage is expensive.

The UI says **`Evidence checked as of <date>`**, with per-stage checked dates in details. It must not say the stronger `information current as of`, because a receipt records when and against which dependencies evidence was checked, not that every real-world fact remains current.

Freshness combines hard dependency/version invalidation with age-based review:

- candidate/identity anchors do not expire solely because time passed when their stable identifiers and dependencies are unchanged;
- affiliation, contact, address trust, and eligibility are time-sensitive and use stage-specific review thresholds;
- identity proposal context, proposal relevance, and coauthor COI bind to the current request and proposal content version regardless of age; coauthor COI additionally binds the proposal-author fingerprint; and
- thresholds are configurable/versioned per stage and are not hard-coded to one global TTL.

[VERIFIED via Justin's 2026-08-01 operating principle] roughly six-month-old evidence is probably acceptable when its dependencies are unchanged, while six-year-old evidence requires more validation. This is a review principle, not a locked TTL. Arbitrary intermediate thresholds remain **[PLANNED]** until stage-specific measurements and operational review justify them.

Dataverse engagement authority is deliberately **not** a persisted reusable stage receipt: it is reconciled for the current panel generation and represented by response/client `authorityState`. Promotion services still re-read/enforce engagement at mutation time.

### Eligibility completeness is separate from result

Current `eligibilityStatus` conflates result with whether the check completed. Target fields:

- `eligibilityCheckStatus`: `complete`, `not_applicable`, `pending`, `incomplete`, or `error`;
- `eligibilityStatus`: existing result semantics (`deceased`, `emeritus`, or `unknown`; add `eligible` only if the evidence contract can actually prove it).

Locked P0 policy:

- promotion requires `eligibilityCheckStatus === 'complete'` or a documented server-issued `not_applicable`;
- `eligibilityCheckStatus === 'complete'` with `eligibilityStatus === 'unknown'` may proceed subject to every other gate;
- `eligibilityStatus === 'deceased'` or an authoritative ineligible disposition blocks;
- `emeritus` is informational under the current policy; and
- pending/incomplete/error/missing check status blocks even when the result is not `deceased`.

### Refresh persistence

Starting a refresh atomically updates only that candidate/stage metadata using `expectedUpdatedAt`:

- set the separate `stageRefresh` metadata to `refreshing` with
  `refreshAttemptId`, `refreshStartedAt`, and reason;
- retain the last completed receipt and display result/evidence, while the
  planner marks it cached and non-authoritative for promotion;
- never erase a prior complete result merely because a refresh began.

Success atomically replaces only the stage result/receipt, writes `current`, and
clears its lease metadata. Failure preserves prior display evidence, writes a
completed `incomplete` or `failed` receipt plus a bounded error code, and clears
the live lease. A process death leaves only `stageRefresh.state=refreshing`;
after the configured lease window, the next revisit maps it to
`prior_refresh_incomplete` and retries only that candidate/stage.

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

## Promotion authority matrix — branch source state

[VERIFIED via source/tests] both promotion entry points derive
`deriveReviewerPromotionAuthoritySnapshot(...)` from the authoritative roster
candidate immediately before calling the shared, fail-closed promotion gate.
The UI's `authorityState` and any cached receipt remain display/eligibility
inputs; neither is client-granted mutation authority.

| Gate | Generic save (`lib/services/reviewer-finder/save-candidates-service.js`) | Applicant promotion (`lib/services/workbench/promote-applicant-reviewer-service.js`) | Shared branch rule |
|---|---|---|---|
| Candidate and current inputs | Derives the server snapshot from the authoritative roster candidate. | Derives the same class of server snapshot from the authoritative applicant roster candidate. | Missing, stale, refreshing, incomplete, failed, or unknown required receipt/input fails closed. |
| Dataverse engagement | Uses its server-side create/reuse path. | Re-reads the suggestion, rejects handled state, and retains `selectIfUnengaged` concurrency enforcement. | Cached engagement never overrides a current server/Dataverse decision. |
| Identity, institution COI, coauthor COI, and eligibility | Passes the current snapshot through the shared gate before mutation. | Passes the current snapshot through the shared gate before mutation. | A clean result requires the relevant current server-authoritative stage outcome; provider/error/unknown complements do not become clean negatives. |
| Contact and address trust | Performs its canonical server contact/address enforcement. | Re-reads canonical reviewer/person and address state before promotion. | A receipt can avoid recomputation but cannot skip the canonical server contact/address check. |
| Persistence outcome | Consumes an exact candidate outcome rather than treating a count as authority. | Consumes the same current candidate state before selection/promotion. | `roster_persistence` is projected atomically with the completed stage or cold write; a pending/failed terminal state blocks authority. |

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
- tests for complete, not-applicable, incomplete, provider error, missing, unknown, retries exhausted, override pending attestation, attested clear, and possible-conflict hold values.

The narrow coauthor override audit record must include staff actor, timestamp, reason, failed proposal authors/queries, proposal and candidate versions, and the evidence successfully checked. It preserves the provider-failure state; it does not rewrite it as a clean negative. **[PLANNED]** The reviewer acceptance flow must require a structured COI attestation before acceptance and route any possible conflict to a staff hold/disposition state. Until that end-to-end dependency and its persistence/security/fan-out are implemented and verified, the override path remains disabled and provider failure stays fail-closed.

Minimum `stageFreshness` fan-out:

- every stage producer and dependency planner;
- `pruneCandidateForRoster` and any candidate DTO validator/sanitizer;
- roster write/read/refresh helpers;
- warm revalidation response projection;
- card badges, selectability, save payload construction, and both promotion services; and
- export/other candidate-JSON consumers found by raw-field grep, plus tests for every complement/fall-through value.

Minimum legacy-compatibility/evidence-date fan-out:

- versioned mapper input/output and equivalence-reason allowlist;
- roster sanitizer/persistence and per-stage `completedAt`/checked-date projection;
- card summary (`Evidence checked as of`) and per-stage detail dates;
- selection/promotion gates for mapped-current versus missing/incomplete evidence; and
- fixtures spanning equivalent legacy evidence, ambiguous evidence, missing provenance, recent unchanged dependencies, old time-sensitive evidence, and current-request/content mismatch.

`authorityState` is response/client state, not persisted candidate authority. `current` requires all bounded authority/input reads for that panel generation to succeed; partial or failed reads must produce `stale`/`error`, never a partial `current`. Its fan-out is roster route → panel bootstrap → search section → select/save/promote controls → tests. Unknown values render cached/read-only and block promotion. Miss reason codes fan out through planner, response, retry UI, telemetry aggregation, and fixtures; an unknown reason remains `unclassified_miss`, never a hit.

## Historical implementation slices

The slices below are the original delivery plan. They are retained for decision
rationale; implemented branch state is recorded in the snapshot above, and the
only intentionally unwired portion is generic explicit-cold
attestation/coordinator routing.

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
- full per-row outcomes (`recorded`, `not_required`, `skipped_stale`, `refresh_in_progress`, `rejected`, `failed_retryable`, `failed_terminal`); and
- detailed applicant terminal frames rather than `count/skipped`.

P0 uses the existing JSONB candidate column and requires no schema migration. If query/index needs later justify extracted columns, that is a separately reviewed migration.

#### 0.5 Align promotion authority

Implement the matrix across `isCandidateSelectable`, `lib/services/reviewer-finder/save-candidates-service.js`, and `lib/services/workbench/promote-applicant-reviewer-service.js`.

Locked P0 behavior: fail closed on incomplete/error/missing coauthor and eligibility checks and run targeted retries first. A coauthor provider-failure override is a separate, default-off path: it requires the complete audit record above and cannot ship until the **[PLANNED]** reviewer attestation-before-acceptance and possible-conflict hold flow is implemented across persistence, external acceptance, staff disposition, security, UI, and tests. Eligibility does not use this override.

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

Cold progress is honest: proposal loading, analysis, database discovery,
identity, institution-domain evidence, institution COI, coauthor COI,
eligibility, contact, and roster persistence each have visible state. Stream
close without a terminal event is unknown, not success.

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
- `warm_first_candidate_interactive` — the first candidate whose panel authority and required stage receipts permit an eligible action
- `warm_full_reconciliation_complete` — all bounded authority reads and permitted warm revalidation/refresh work reached a terminal state

These are separate distributions. Cached-visible must not be reported as interaction-ready, and first-candidate-interactive must not be reported as full reconciliation complete.

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

[VERIFIED via the primary agent's 2026-08-01 ownership decision] the primary agent owns the sample size, observation window, baseline, canary threshold, and decision to promote a hypothesis to an SLO.

1. Shadow-measure the three milestone distributions separately and retain errors, stale conflicts, navigation cancels, and zero-row requests as named cohorts rather than removing them to improve percentiles.
2. Keep cached roster visible ≤2s and first qualified interaction ≤5s as provisional product hypotheses—not release promises. Full reconciliation complete has no invented latency target.
3. Promote either hypothesis to an SLO only after the primary agent reviews sufficient shadow/canary data and Dataverse availability. This plan does not lock a sample count, observation window, or percentile gate.
4. Regardless of latency, zero expensive calls on an unchanged revisit, zero unsafe actions, zero stale overwrite, and zero full-batch applicant refresh caused by one stale candidate/stage remain hard release contracts.

### Cold metrics

Retain search-click → first grounded, first actionable, and background-complete timing plus attainment rates. Do not impose an unsupported absolute cold SLO in P0. Paid calls per explicit search are reported as an operational metric, not the warm UX success criterion.

## Partial success, retry, and stale semantics

| Condition | Visible state | Authority/action | Retry/persistence |
|---|---|---|---|
| Cached roster returned; Dataverse pending | Cards visible as refreshing | Display-only | Reconcile same snapshot version |
| Dataverse unavailable | Cached cards remain with explicit error | Promotion disabled | Retry authority only; no evidence providers |
| One candidate stage stale | That card/stage marked stale | Only dependent actions blocked | Refresh that ID/stage |
| One stage refresh fails | Prior evidence remains visible as stale | Stage stays non-authoritative | Store failure/reason; targeted retry |
| Coauthor provider retries exhausted | Successfully checked evidence remains visible; provider failure remains explicit | Default fail-closed; optional invitation override stays disabled unless the audited attestation/hold dependency is live | Record actor/time/reason, failed authors/queries, proposal/candidate versions, and checked evidence; possible conflict is held for staff disposition |
| Refresh process dies | Separate `stageRefresh` metadata persists as `refreshing` until lease expiry while prior completed evidence remains visible | Non-authoritative | Map to `prior_refresh_incomplete`; resume one stage |
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
- automatic warm revalidation invokes only the bounded Postgres/Dataverse/Graph/canonical-version allowlist; proposal download/parse, Claude, publication/coauthor discovery, uncertain external identity resolution, and contact discovery require an explicit staff action.
- one stale candidate/stage calls only its targeted service.
- refresh start/success/failure/lease-expiry preserves prior evidence and CAS semantics.
- no-history panel remains idle/read-only and makes no proposal/applicant/model/provider calls until explicit `Run search`.
- proposal-content change invalidates identity, every identity-dependent stage,
  and coauthor/proposal-relevance evidence because the current verifier consumes
  bounded proposal-field context.
- the legacy compatibility mapper promotes only fixtures demonstrably equivalent to the new receipt contract; ambiguous/missing fixtures become `stage_missing`/`incomplete` without full-batch recompute.
- age review is stage-specific: unchanged identity anchors do not expire from age alone; time-sensitive stages use configurable/versioned thresholds; request/proposal-bound stages reject mismatched content even when recent.

### Gate and fan-out

- Both promotion services exercise every matrix row with current, pending, incomplete, error, missing, unknown, stale, and not-applicable inputs.
- Negative tests contain evidence that would pass if the guard were deleted.
- `eligibilityCheckStatus=complete` with `eligibilityStatus=unknown` is distinct from missing/pending/incomplete.
- completed eligibility `unknown` can proceed subject to other gates; deceased/authoritative-ineligible and incomplete/error/missing block; emeritus alone does not block under current policy.
- Unknown enum/status values fail closed in UI, sanitizer, attestation, roster, and promotion.
- Applicant institution COI is recomputed/validated server-side.
- Incomplete/error/missing coauthor check blocks both promotion paths by default and triggers targeted retries, never a clean-negative projection.
- **[PLANNED]** Dependency tests prove an exhausted-provider staff override cannot be used without the complete audit fields; reviewer acceptance is blocked until structured COI attestation; an attested possible conflict enters staff hold/disposition instead of acceptance.

### React and end to end

- Prior request cards render before delayed Dataverse reconciliation.
- Cards use `Evidence checked as of <date>` plus per-stage dates and never claim `information current as of`.
- Cached cards cannot be selected/promoted.
- Authority-current response enables only candidates whose stage receipts are current.
- Request/proposal switch ignores every old success/error/finally update.
- Request 1003046-like history revisits without proposal download, model call, PubMed, contact discovery, or full applicant enrichment.
- Same-name distinct anchored candidates remain separate.
- A changed proposal under the same path produces `proposal_content_changed` through eTag/version comparison.
- telemetry distinguishes cached visible, first candidate interactive, and full reconciliation complete; no event substitutes for a later milestone.

## Rollout and rollback

Use independent flags for:

- Postgres-first cached roster response/UI;
- reason-coded warm revalidation;
- targeted applicant stage refresh;
- suppression of legacy mount-time cold work, with a hard dependency on targeted refresh/persistence;
- explicit promotion-gate alignment; and
- the audited coauthor provider-failure override, default off and dependent on the **[PLANNED]** external attestation/hold flow; and
- later cold progressive events.

“Independent” means each behavior can be rolled back separately; it does not remove safety dependencies. The suppression flag must refuse to enable unless targeted refresh/persistence is enabled, and reconciled authority-dependent controls must refuse to enable unless promotion-gate alignment and stage freshness are enabled.

Rollout order:

1. Add shadow telemetry, authenticated `mode=cached|reconciled`, snapshot handling, and reason classification without changing UI behavior.
2. Align server promotion gates, including applicant institution COI, separate eligibility completeness, and default fail-closed coauthor completeness with targeted retries. Keep the provider-failure override off until its audited accept-time attestation/hold dependency is live.
3. Enable cached roster first paint for staff canary in the safe intermediate **display-only** state: all authority-dependent controls stay disabled, regardless of a reconciled response.
4. Deploy per-candidate/stage dependency planning, stage receipts, the reviewed legacy compatibility mapper, evidence-checked dates, stale-safe persistence, and manual targeted refresh/retry. Keep the legacy automatic enrichment path available while it remains the only stale-row repair path.
5. Suppress warm mount proposal/applicant cold work only under a dependent flag that requires step 4. Verify legacy/stale rows can be repaired through the targeted path and that no-history panels remain idle until explicit search.
6. Enable reconciled selection/add/save/promotion controls only after steps 2 and 4 are live and every candidate's required authority/stage receipts are current. Automatic warm work remains limited to the locked inexpensive authoritative allowlist; all expensive/uncertain stages stay explicit staff actions.
7. Expand warm P0 after 1003046-like revisit, security-mode, invalidation-matrix, and zero-expensive-call telemetry review.
8. Implement cold progressive delivery separately.

Rollback cached UI without restoring automatic expensive work: fall back to the reconciled roster response, keep reason telemetry and corrected server gates, and retain targeted-refresh persistence. Never roll back only one side of a promotion gate.

Stop canary for any unsafe action, unreasoned miss, expensive call on unchanged revisit, stale overwrite, identity name-merge, or full-batch applicant refresh caused by a single stale candidate.

## Next-cycle autonomous-search extension

[ASSUMED from Justin's 2026-08-01 future-cycle intent] full proposals will be available on day one, Reviewer Finder may run autonomously after requests advance, recommended/excluded inputs should be better curated, and longer proposals with references should provide better evidence. [ASSUMED] model quality may improve. None of these assumptions may be a safety dependency.

This is a staged future extension, not P0.

### Trigger and approval boundary — DEFERRED

[VERIFIED via `.claude-memory/project-reviewer-apps-redesign-direction.md`] `wmkf_triagestatus=Advancing` was introduced as the D26 dashboard visibility/routing patch while leaving `akoya_requeststatus` untouched. It must not be assumed to be the future autonomous Reviewer Find trigger.

[VERIFIED via `.claude-memory/project-grant-phasing-evolution.md`] prior planning direction treats an authoritative internal Phase I→II/phase-advanced Dataverse transition—current notes mention `akoya_requeststatus='Phase II Pending'` or a live successor—as the conceptual handoff to reviewer finding. This is planning context, not a bound implementation field.

**DEFERRED for deeper staff discussion.** The exact field/value, group-versus-row transition, writer authority, existing Power Automate consumers, separation between search and proposal-release consumers, and shadow/approval/unattended level remain open. Do not bind implementation, idempotency keys, or subscriptions to a field until those questions are source- and live-state-verified.

Whatever is later approved, autonomous search may write/find roster candidates only. It does not select, invite, email, or promote reviewers without a separately approved contract.

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

## Historical Contract-reconcile Mode A review

This review is the pre-implementation finding record. Its “current,” “planned,”
and verdict labels are historical and must not override the verified branch
state above.

### Findings

1. **VERIFIED — Warm display is unnecessarily coupled to authoritative reconciliation.** Evidence: roster GET awaits Postgres then Dataverse before returning; the client already renders roster independently of search phase. Residual risk: cached rows may briefly be engagement-stale, so the target keeps them read-only.
2. **VERIFIED — Mount effects initiate cold work without a search action.** Evidence: panel mount effects call applicant ingestion and proposal load; applicant cache miss auto-calls full enrichment. Residual risk: splitting read/materialize changes service contracts and needs focused tests.
3. **VERIFIED — Applicant freshness is batch-global.** Evidence: `hasValidApplicantEnrichmentCache` returns one boolean only after every expected row passes; caller refreshes all actionable recommendations. Residual risk: stage dependency graph must be explicit so a narrow refresh does not omit prerequisites.
4. **VERIFIED — Promotion authority is asymmetric.** Evidence: generic save recomputes institution COI; applicant promotion has no institution/coauthor symbol checks; neither path distinguishes eligibility check completeness. Residual risk: P0 gate alignment exposes legacy rows needing compatibility mapping or targeted refresh, and the optional coauthor override depends on a not-yet-built attestation/hold flow.
5. **READY WITH NAMED CHANGES — Postgres-first rendering is safe only as display state.** Required changes: cached authority label, disabled promotion, snapshot/version reconciliation, per-stage freshness, server rechecks, and unknown-status fail-closed behavior.
6. **READY WITH NAMED CHANGES — Cold-work suppression must follow targeted stale-row repair.** Required changes: explicit flag dependency, legacy/stale repair coverage, and an idle/no-history contract; cached first paint may ship earlier only with all authority-dependent controls disabled.
7. **READY WITH NAMED CHANGES — Roster modes must preserve the route's security boundary.** Required changes: shared authentication/request validation, reconciled DAL context, existing interlock behavior where applicable, a server mode allowlist, and negative tests proving mode cannot weaken authorization.
8. **READY WITH NAMED CHANGES — Settled freshness decisions narrow automatic work.** Required changes: an allowlist for inexpensive authoritative warm revalidation, explicit staff actions for expensive/uncertain stages, a reviewed legacy compatibility mapper, per-stage evidence-checked dates, and configurable/versioned stage age review.
9. **DEFERRED — Autonomous trigger identity is not settled.** `wmkf_triagestatus=Advancing` is a current-cycle visibility/routing patch; Phase I→II/phase-advanced status is direction only. No field subscription or trigger implementation is ready for review.

### New issues

- **HIGH — Applicant promotion lacks an explicit server institution-COI gate.** Required change: add the same trusted-context screening semantics as generic save before mutation.
- **HIGH — Eligibility result does not prove eligibility check completion.** Required change: add and enforce separate completeness state across all fan-out consumers.
- **HIGH — Coauthor incomplete/missing state is not enforced by either promotion service.** Required change: default fail closed with targeted retries. A provider-failure override remains disabled until its complete audit record and **[PLANNED]** reviewer attestation-before-acceptance/possible-conflict hold dependency exist; provider failure must remain distinct from a clean negative.
- **MEDIUM — Legacy roster rows will lack new stage receipts.** Required change: run a reviewed compatibility mapper, promote only demonstrably equivalent evidence, show ambiguous/missing evidence cached/read-only as `stage_missing`/`incomplete`, and target only required refreshes; do not blanket-grandfather, discard, or mass-recompute.
- **HIGH — Suppressing legacy automatic enrichment before targeted refresh exists removes the only repair path for stale rows.** Required change: gate suppression on deployed per-stage planning/persistence/retry, and keep the interim cached UI display-only.
- **MEDIUM — A client-selectable roster mode could become an authorization bypass if auth/context handling diverges.** Required change: authenticate before mode dispatch, allowlist mode, preserve DAL/restriction/interlock seams, and test both positive and negative complements.

### Recommendation evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Render Postgres roster before Dataverse | `listForRequest` returns render DTO | Yes, inside roster GET before reconciliation | Source trace; not performance-tested | Shadow measure may show Postgres itself is slow | VERIFIED |
| Preserve auth/restriction boundary in both modes | Existing route authenticates before dispatch; reconciliation enters DAL context | Yes, at the common handler and reconciled service boundary | Source trace; new modes NOT TESTED | A future early mode return placed before `requireAppAccess` would violate it | VERIFIED |
| Skip proposal/applicant cold work on unchanged revisit | Persisted roster + metadata fingerprints | Roster exists; stable content/input fingerprints are planned | NOT TESTED | Content/input may change between opens | ASSUMED |
| Suppress legacy automatic enrichment | Targeted stage planner, stale-safe persistence, and a working repair/retry path | Only after PR/rollout step 4; not available today | NOT TESTED | Legacy stage-missing row cannot be repaired without the old path | ASSUMED |
| Map legacy evidence without mass recompute | Stored evidence contains enough dependency/source/completeness provenance to prove equivalence | Per row/stage; mapper and fixtures are planned | NOT TESTED | Ambiguous evidence must become missing/incomplete, not current | ASSUMED |
| Limit automatic warm refresh to authoritative cheap reads | Server-side stage/action allowlist | Planned in reconciled response/planner | NOT TESTED | A hidden effect could still call an expensive provider | ASSUMED |
| Allow audited coauthor provider-failure exception | Retries exhausted; complete override audit; accept-time attestation and hold are implemented | Not available today; attestation/hold is PLANNED | NOT TESTED | Provider failure or possible conflict is accidentally projected as clear | ASSUMED |
| Refresh one candidate/stage | Canonical key + stage receipt/dependencies | Candidate key exists; stage receipt/planner is planned | NOT TESTED | Shared proposal-context invalidation may legitimately affect many candidates | ASSUMED |
| Zero expensive calls on unchanged revisit | Cache hit proven by authority/content/input versions | Planned at reconciled warm response | NOT TESTED | Hidden mount effect/provider call remains | ASSUMED |
| Future autonomous search | Authoritative trigger and durable run/idempotency contract | Trigger field/event and autonomy level are deferred | NOT TESTED | `wmkf_triagestatus=Advancing` is incorrectly reused as the trigger | ASSUMED |

### Seven-audit disposition

1. **Whole flow:** caller → common route authentication/validation → cached client state → roster cached/reconciled modes → Postgres/Dataverse/Graph metadata → response → display-only intermediate state → freshness/gate-qualified actions → promotion is traced. No-history remains idle until explicit search.
2. **Partial success:** unit is candidate/stage; identifiers and outcomes replace counts; failed stages remain retryable.
3. **Async/stale:** request generation, roster snapshot version, AbortController, monotonic stage attempts, and CAS protect every post-await path.
4. **Helper semantics:** search suppression, display dedup, identity aliasing, dependency-scoped freshness, and persistence sanitization remain distinct. Proposal changes do not invalidate unrelated identity/contact/eligibility stages.
5. **Durable surface:** P0 reuses roster JSONB. The optional override's audit/attestation/hold state and any autonomous job/metrics table are **[PLANNED]** durable surfaces requiring migration/manifest/Atlas/security/cleanup review before implementation claims.
6. **Doc reconcile:** this document replaces the cold-first priority throughout summary, slices, metrics, rollout, decisions, and PR order; the generated catalog summary is current and must remain synchronized. [VERIFIED via scoped 2026-08-01 durable-restatement search] the settled coauthor/eligibility/evidence-date/latency/autonomous-trigger phrases occur only in this plan; the cited triage and phase-planning memories agree with the recorded historical/current distinction.
7. **Fan-out:** new status/read surfaces are enumerated above; compatibility provenance, per-stage checked dates, override/attestation/hold states, route mode/auth tests, and every dependency-matrix complement are required; implementation must raw-symbol grep before completion.

**Final verdict:** READY WITH NAMED CHANGES. Warm two-phase bootstrap is the correct P0. Required named changes are the authority matrix alignment; locked eligibility semantics; default fail-closed coauthor completeness with targeted retries; a separately gated **[PLANNED]** audited attestation/hold override; explicit dependency- and age-scoped freshness; reviewed legacy compatibility mapping; per-stage `Evidence checked as of` dates; reason-coded misses; stale-safe refresh persistence; authenticated/fail-closed mode handling; an idle no-history state; the inexpensive-authoritative automatic-work allowlist; and suppression of legacy automatic enrichment only after targeted repair is available. Cached first paint is safe before the full stack only as display-only UI with every authority-dependent control disabled. Autonomous trigger implementation is explicitly deferred.

## Locked decisions and remaining open work

### Locked

1. Coauthor provider failures default fail-closed with targeted retries; an exhausted-provider exception is narrow, audited, and conditional on the **[PLANNED]** reviewer attestation-before-acceptance/possible-conflict hold flow.
2. Completed eligibility `unknown` may proceed subject to other gates; incomplete/error/missing and deceased/authoritative-ineligible block; emeritus is informational under current policy.
3. Automatic warm work is limited to inexpensive authoritative Postgres/Dataverse/Graph/canonical-version revalidation. Expensive or uncertain stages require explicit staff action.
4. Legacy evidence uses a reviewed compatibility mapper plus per-stage `Evidence checked as of` dates. No blanket grandfathering or mass recompute.
5. Hard warm contracts remain zero expensive calls on unchanged revisit, zero unsafe actions/stale overwrite, and zero full-batch refresh caused by one stale candidate/stage. The ≤2s cached-visible and ≤5s first-qualified-interaction values remain hypotheses.

### Genuinely open

1. **[PLANNED]** Specify and implement the coauthor override audit persistence, reviewer COI attestation, accept-time block, possible-conflict staff hold/disposition, security, retention, and fan-out before enabling the override.
2. **[PLANNED]** The primary agent chooses the shadow sample, observation window, percentile/canary method, stage-specific age thresholds, and whether latency hypotheses become SLOs. No arbitrary intermediate TTL is locked.
3. **DEFERRED for staff discussion.** Resolve the future autonomous trigger's exact field/value, group-versus-row transition, writer authority, existing Power Automate consumers, search-versus-proposal-release consumers, and shadow/approval/unattended level. Do not bind code to `wmkf_triagestatus` or `akoya_requeststatus` yet.

## Historical recommended PR sequence

This is retained as the original sequencing rationale, not a statement that
the listed completed branch work remains pending.

1. **Warm telemetry + secure route split:** authenticated `mode=cached|reconciled`, mode allowlist, unchanged DAL/restriction/interlock boundaries, snapshot token, no UI behavior change.
2. **Authority alignment:** applicant institution COI, default fail-closed coauthor completeness with targeted retries, locked eligibility semantics, UI state model, and both promotion services; keep the optional provider-failure override off and current UI behavior until gates are ready.
3. **Display-only cached first paint:** parent-owned bootstrap, cached cards, delayed authority state, no duplicate roster fetch, and every selection/add/save/promotion control disabled.
4. **Freshness planner + stale-safe persistence:** dependency matrix, per-candidate/stage receipts and checked dates, versioned compatibility mapper, reason codes, stage-specific configurable age review, stage attempt/lease/CAS, detailed per-row outcomes, and manual targeted refresh/retry APIs.
5. **Suppress warm cold-work behind the step-4 dependency flag:** metadata-only
   proposal/input validation; automatically reconcile only the inexpensive
   authoritative read allowlist and do not execute/write evidence producers on
   mount; keep proposal download/parse, Claude, publication/coauthor discovery,
   uncertain identity resolution, institution-domain resolution, and contact
   discovery behind explicit staff actions; no-history panels remain idle. Do
   not enable this flag until legacy/stale repair succeeds through the targeted
   path.
6. **Enable reconciled actions:** only after #2 and #4, enable controls candidate-by-candidate when current panel authority and every required stage receipt are current; automatic work stays within the locked inexpensive authoritative allowlist.
7. **Optional audited coauthor override:** separate reviewed change only after audit persistence and the reviewer attestation/possible-conflict hold dependency are designed, built, and verified end to end.
8. **Cold progressive search:** candidate events and partial persistence after warm P0 is stable.
9. **Autonomous-search design/build:** deferred separate future plan only after trigger authority and autonomy level are settled with staff.

This order produces the warm-user benefit before changing cold-search provider behavior and keeps future autonomy from expanding P0 scope.
