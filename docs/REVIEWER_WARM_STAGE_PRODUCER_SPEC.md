---
title: Reviewer Find Authoritative Warm-Stage Producer Specification
domain: reviewer-workbench
kind: spec
status: active
summary: "Contracts for emitting and selectively refreshing authoritative Reviewer Find stage evidence and receipts."
canonical: false
cataloged: 2026-08-02
owner: product-engineering
related:
  - docs/REVIEWER_FIND_PERFORMANCE_PLAN.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/audits/reviewer-warm-stage-producer-fable-review-2026-08-02.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - lib/services/workbench/reviewer-stage-refresh-service.js
  - lib/services/workbench/reviewer-warm-validation-service.js
  - lib/services/reviewer-stage-freshness.js
  - lib/services/reviewer-roster-store.js
---

# Reviewer Find Authoritative Warm-Stage Producer Specification

> **Status (2026-08-02):** [VERIFIED via source/tests] the branch implements
> the authenticated manual producer path, cold applicant receipt emission, and
> provider-free warm validation described here. This is branch/source truth,
> not a claim that the feature is merged, deployed, or enabled in production.
> The generic explicit-cold-search attestation/coordinator route remains
> intentionally unwired; see **Implemented boundary and remaining work**.
>
> **Objective:** connected cold applicant enrichment emits reusable
> authoritative receipts for work it already performs; a later warm revisit reads those receipts
> without provider work; and a stale legacy or changed stage can be refreshed
> for exactly one canonical candidate without rerunning unrelated stages or a
> full applicant/search batch.

## Contract-reconcile scope

- **Change surface:** stage execution after a cold Reviewer Find search and
  explicit one-candidate warm repair.
- **Entry points:** existing cold analyze/discover/enrich flows; authenticated
  `POST /api/workbench/reviewer-stage-refresh`; existing address-trust action.
- **Persistence:** existing Postgres `reviewer_find_roster.candidate` JSONB only;
  no new table or migration in this specification.
- **Consumers:** warm planner, Find cards and action states, both promotion
  services, roster export/dedup, enforcement/Atlas docs, and tests.
- **Current implementation:** [VERIFIED via source/tests]
  `reviewer-stage-refresh-service` executes `applicant_anchor`, `identity`,
  `institution_domains`, `institution_coi`, `coauthor_coi`, `eligibility`,
  `contact`, and `roster_persistence`; `address_trust` remains the dedicated
  structured address action. The targeted contact producer is isolated from
  identity and eligibility work.

## Locked boundary

This specification does not change the previously settled product policy:

1. **[VERIFIED via source/tests] Cold emission is free of duplicate work.** The
   connected applicant cold-enrichment path emits the bounded stage receipts it
   has already produced, before publishing the candidate; it does not make a
   second provider call merely to create evidence.
2. **[VERIFIED via source/tests] Warm mount performs no evidence producers.** It may read
   Postgres, Dataverse, and Graph metadata and compute freshness. It never
   invokes Claude, proposal parsing, PubMed, OpenAlex, ORCID, Europe PMC, Serp,
   contact discovery, or uncertain identity resolution.
3. **[VERIFIED via source/tests] Expensive or uncertain refresh is staff-initiated.** Identity,
   institution COI, coauthor COI, eligibility, and contact refreshes require an
   explicit action. Cheap pure reconciliation may decide that an existing
   receipt is still current, but warm mount neither recomputes evidence nor
   renews its timestamp. Address trust requiring human evidence remains a
   deliberate address action.
4. **[VERIFIED via source/tests] One request means one candidate and one requested stage.** A
   producer may complete the requested stage and the cheap terminal
   `roster_persistence` receipt. It may not silently launch prerequisite or
   sibling evidence producers. The sole two-evidence-receipt exception is the
   dedicated structured address action, which must replace contact and exact
   address trust atomically as specified below; the generic stage route cannot
   invoke that exception.
5. **[VERIFIED via source/tests] Missing prerequisites fail closed.** The response identifies the
   stale prerequisite stages; the UI offers them in dependency order. No
   provider failure, absent result, or unknown value becomes a clean negative.
6. **[VERIFIED via source/tests] Promotion remains a fresh server decision.** Current receipts
   make a row eligible for promotion checks; they never replace the promotion
   services' current Dataverse engagement, identity, COI, eligibility, contact,
   or address enforcement.

The optional coauthor-provider-failure override, reviewer accept-time COI
attestation/hold flow, stage-specific age thresholds, and future autonomous
search trigger remain outside this specification. Their absence cannot weaken
the default fail-closed path.

## Invariants

| Invariant | Enforcing surface | Required verification |
|---|---|---|
| A browser selects a target but supplies no authority | route closed schema + server roster/Dataverse re-read | payloads containing evidence, stage/source/result/content versions, names, or authority fields reject; the opaque roster CAS token is permitted correlation only |
| One stale stage never triggers full-batch enrichment | stage executor allowlist | spies prove no batch/analyze/provider sibling calls |
| A targeted contact refresh does not rerun identity or eligibility | extracted contact-only producer | positive spies for contact tiers; negative spies for identity/eligibility |
| A producer cannot use stale prerequisites | server planner before lease acquisition | each missing/stale prerequisite returns `prerequisite_stale` and makes zero provider calls |
| A concurrent edit/navigation cannot overwrite a newer row | `expectedUpdatedAt` + refresh lease + final CAS | losing writer returns `skipped_stale`; prior evidence remains |
| An upstream invalidation strands an expired same-stage lease | server-derived request/candidate/stage recovery marker + owner/attempt/expiry CAS | recovery writes only an incomplete retryable receipt; live or foreign-stage leases remain non-mutating and normal planning must still run |
| Provider failure is not a clean result | producer result validator | incomplete/error receipt and bounded failure code; promotion stays blocked |
| Cold work and targeted work emit the same canonical stage projection | shared pure projector per stage | fixture parity tests over both call paths |
| Proposal-dependent evidence binds the exact content version | Graph metadata version before and after explicit proposal work | changed version discards output as stale |
| Only a complete upstream set can complete roster persistence | server terminal projector | every missing/incomplete/unknown upstream state blocks terminal receipt |
| Unknown stage, state, result, or failure code fails closed | allowlists with final reject branch | complement tests for unrecognized values |

### Expired-lease recovery boundary

`recover_expired_lease` is a server-planned, same-stage cleanup action, not a
normal producer retry. It is offered only when the candidate-wide owner has an
allowlisted stage, a bounded attempt ID, a canonical `refreshStartedAt`, and is
past the configured minimum lease age. Its reason is always canonicalized to
`prior_refresh_incomplete`, even if an earlier broad invalidation also affected
the stage. If normal source inputs are temporarily underivable, the server may
write only an **incomplete** receipt using the opaque
`reviewer-stage-expired-lease-recovery:v1` request/candidate/stage namespace;
that marker is never a normal input source and cannot make evidence current.

Malformed, missing, non-canonical, live, foreign-stage, or unrecognized leases
are never recovered. They return/plan `lease_repair_required` with the UI's
operator-repair-only state; the browser makes no retry POST and the row remains
blocked until an administrator repairs the durable lease.

## Common producer architecture

### 1. Target request

**[VERIFIED via source/tests]** The existing route accepts only the following
target-selection shape; the browser cannot supply evidence, authority, source,
proposal/version, provider, or plan fields:

```json
{
  "requestId": "guid",
  "candidateKey": "server-issued canonical key",
  "stage": "identity",
  "expectedUpdatedAt": "opaque roster token"
}
```

The route continues to authenticate with the Reviewer Finder app/role before
dispatch and continues to enter the trusted Dataverse DAL context. The body
must not accept `candidate`, `suggestionId`, name, email, affiliation, proposal
path, provider options, evidence, result, receipt, any stage/source/result/
content version, or a flag requesting automatic/full refresh. The sole allowed
version-like input is the opaque `expectedUpdatedAt` CAS token; it is
correlation, never authority.

The service loads the exact `active` row by `(requestId, candidateKey)`. For an
applicant-suggested row it re-reads and verifies the stored suggestion/person
anchor against the same request. For a non-applicant row, the canonical roster
key is target correlation only; stage prerequisites must still establish the
identity/contact authority required by that producer. Legacy opaque keys may
be displayed but cannot run identity-sensitive producers until a server-owned
canonical anchor or staff identity confirmation exists.

### 2. Execution modes

The shared projectors support two server-only modes; the client cannot choose
one:

- `cold_emit`: adapt evidence already computed by the explicit cold pipeline;
  no new provider call and no refresh lease.
- `manual_refresh`: run one allowlisted executor after an authenticated staff
  action using the stage lease/CAS protocol.

There is deliberately no `warm_auto_provider` mode. Cheap authoritative
revalidation belongs to the reconciled planner, not to an evidence producer.

### 3. Dependency snapshot

Before starting a manual stage, build a server-owned snapshot:

```js
{
  requestId,
  candidateKey,
  rosterUpdatedAt,
  applicantInputVersion,
  proposalContentVersion,
  requestCoiContextVersion,
  canonicalPersonVersion,
  stageInputVersions: {
    applicant_anchor,
    identity,
    institution_domains,
    institution_coi,
    coauthor_coi,
    eligibility,
    contact,
    address_trust
  }
}
```

`stageInputVersions` are deterministic hashes of server-owned dependencies—not
browser assertions or unsealed values copied from old evidence. Cheap inputs
are recomputed on warm revisit. A proposal/provider-derived sub-fingerprint is
not recomputed warm: it is usable only when it was sealed by the producer and
its outer authoritative version (for example `proposalContentVersion`) still
matches cheap current metadata. Missing or changed outer authority makes the
stage stale. Real-world drift not visible through a dependency version is
handled by the stage's age policy, never by silently renewing `completedAt`.

### 4. Result envelope

Every projector returns this internal closed union:

```js
{
  outcome: 'current' | 'not_applicable' | 'incomplete' | 'failed',
  evidencePatch: {},
  receipt: {
    state: 'current' | 'not_applicable' | 'incomplete' | 'failed',
    contractVersion: 1,
    sourceVersion: 'opaque dependency hash',
    resultVersion: 'opaque bounded-result hash',
    completedAt: 'ISO timestamp or null',
    reasonCode: null,
    failureCode: null
  }
}
```

Each stage owns an allowlist for `evidencePatch`. The store rejects unknown
keys, prototype-bearing values, oversized strings/arrays, noncanonical dates,
unknown receipt states, mismatched contract versions, and missing source/result
versions. Raw provider bodies, search snippets, proposal text, credentials,
and unbounded publication/page results never enter the roster.

`reasonCode` is required for `not_applicable` and may explain a completed
nonpositive result. `failureCode` is reserved for `incomplete`/`failed` attempts.
Both use stage-specific closed allowlists; neither accepts provider prose.

`receipt.state` represents a completed attempt and therefore uses only the
union above. The persisted `refreshing` state and its attempt/lease fields live
in separate stage-refresh metadata while an executor owns the row; `stale` is
derived by the planner from dependency/age mismatch. Neither is accepted as a
completed receipt state.

### 5. Manual execution state machine

1. Authenticate and validate the closed target.
2. Load exact active roster row and current authority/dependency snapshot.
3. Run the pure planner. Reject an unrequested/current stage as
   `refresh_not_required`; reject missing prerequisites as
   `prerequisite_stale` with an ordered stage list.
4. Acquire `startStageRefresh` with candidate key, roster token, stage, and a
   new attempt ID. A live attempt returns `refresh_in_progress`; an expired
   attempt is recovered before retry.
5. Execute only the requested producer with an AbortSignal/deadline.
6. Re-read every authoritative dependency that can change during the call.
   If any input version changed, record `failed`/`authority_changed` under the
   lease; never publish the now-stale result.
7. Validate/project bounded evidence, recompute freshness against the proposed
   merge, and atomically merge its allowlisted fields and receipt under the
   lease CAS. If the resulting upstream set is complete, the same CAS also
   writes `roster_persistence`; there is no second terminal-write race.
8. If upstream stages remain nonterminal, the same write leaves
   `roster_persistence` invalidated and returns the ordered next action.
9. Return the canonical key, requested stage, outcome, new roster token, and
   current refresh plan. Never return raw provider data.

If the provider succeeds but either CAS loses, the newer roster row wins and
the response is `skipped_stale`; the producer performs no compensating write.

### 6. Freshness is not promotion authority

A receipt answers whether the stage reached a complete, reproducible decision
for the exact inputs it records. It does not assert that the decision was
positive. For example, an identity check may be current with an `ambiguous`
result, contact may be current with `missing_email`, and a COI check may be
current with `conflict`. Those results remain stable warm-cache evidence while
the independent promotion gate blocks or requires staff action. Provider
failure, timeout, partial coverage, missing required inputs, and unknown result
shapes remain `incomplete`/`failed` because no complete decision exists.

Every dependent stage distinguishes these two predicates:

- `identityStageCurrent`: the identity attempt is complete for current inputs;
- `identityAuthoritySatisfied`: the current decision is `confirmed`,
  `probable`, or an exact valid staff confirmation.

When the first is true and the second is false, the planner does not call an
identity or downstream provider. It returns the existing structured staff
identity-confirmation action and may project dependent stages as server-issued
`not_applicable` with reason `identity_not_authoritative`. Those receipts let a
read-only row converge to a warm hit, but promotion still fails on identity.
An eventual staff confirmation changes the identity result version and
invalidates every dependent N/A receipt.

## Proposal and candidate version propagation

**[VERIFIED via source/tests]** Proposal identity is a cross-stage dependency,
not a separate refresh stage. The connected applicant cold-enrichment path and
the proposal-dependent manual `identity`/`coauthor_coi` producers use the
following Graph-bound authority sequence; the unwired generic explicit-cold
route does not claim this behavior.

- Before connected applicant cold enrichment or a proposal-dependent manual
  refresh, resolve the exact canonical/fallback Graph item and capture its
  opaque metadata content version.
- After downloading/parsing/analyzing proposal bytes, resolve the same item
  again. If the version changed, discard the analysis and return
  `authority_changed`.
- Every cold candidate carries that `proposalContentVersion` into the roster.
  Identity and coauthor receipts bind it directly. Identity-dependent stages
  bind the identity result version and are transitively invalidated when the
  proposal changes; stages that consume no proposal-derived input do not hash
  Graph metadata independently.
- Existing rows missing the value remain readable but cannot achieve a warm
  hit until an explicit proposal-dependent refresh stamps it.

Applicant input versions follow the existing exact slot/person fingerprint.
General-search candidates use a server-issued `applicant_anchor` receipt with
`not_applicable`; they are not invalidated by unrelated applicant-slot edits.

## Stage producer contracts

### A. `applicant_anchor` — existing producer, reference implementation

- **Mode:** cheap manual refresh; cold emission when applicant materialization
  already has the exact slot.
- **Prerequisites:** exact applicant suggestion/person/request anchor.
- **Existing seam:** `buildApplicantAnchorRefreshReceipt` and
  `refreshReviewerCandidateStage`.
- **Patch:** `applicantInputVersion` plus the bounded anchor receipt only.
- **Failure:** missing/mismatched/handled anchor is terminal for this attempt;
  no identity/contact/provider call.
- **Required change:** accept the common `candidateKey` target while retaining
  the exact Dataverse suggestion validation for applicant rows.

### B. `identity`

- **Mode:** explicit manual refresh; cold emission from the existing verifier.
- **Prerequisites:** current applicant anchor or server-issued non-applicant
  N/A anchor; canonical name and claimed institution; no unresolved legacy key.
- **Existing seam:** `ReviewerIdentityRuntime.evaluateSuggestion` for one
  candidate. It remains the only runtime-mode selector; a refresh route cannot
  choose legacy/shadow/combined behavior.
- **Execution:** pass the server roster projection and bounded proposal field
  context to the runtime. Do not call `ContactEnrichmentService.enrichCandidate`
  and do not discover contact or eligibility evidence.
- **Patch allowlist:** bounded identity decision/anchors, canonical ORCID or
  OpenAlex author ID only when the resolver permits persistence, resolver
  version, resolved time, and the existing server identity-decision receipt.
- **Input version:** canonical candidate/anchor + applicant input version +
  normalized claimed identity inputs + proposal content version + configured
  resolver contract/mode. Because the existing verifier consumes bounded
  proposal-field context, identity is proposal-dependent; targeted execution
  must use context derived from that exact content version.
- **Result:** a complete resolver decision (`confirmed`, `probable`,
  `ambiguous`, `unresolved`, or `abstain`) produces `current` with its bounded
  decision. Only `confirmed`/`probable`, or an exact valid staff confirmation,
  can satisfy promotion identity authority. Provider outage, timeout, partial
  response, or missing stable anchor produces `incomplete`/`failed` and clears
  no prior display evidence.
- **Staff confirmation:** the existing structured exact-person action emits the
  same identity receipt through the shared projector, binding the confirmation
  version, canonical person ID/ETag, actor, and time. The generic stage route
  never accepts a client assertion that a person is confirmed.
- **Downstream:** invalidates institution domains, institution COI, coauthor
  COI, eligibility, contact, address trust, and roster persistence exactly as
  the planner does.

### C. `institution_domains`

- **Mode:** cold emission from the domains already built by contact enrichment;
  explicit manual refresh for exactly one candidate. Warm mount validates the
  receipt only and makes no OpenAlex call.
- **Prerequisites:** `identityStageCurrent`. If
  `identityAuthoritySatisfied` is false, emit `not_applicable` with reason
  `identity_not_authoritative` and make no provider call.
- **Existing seam:** extract/reuse
  `contact-enrichment/domain-evidence.buildInstitutionDomainEvidence` as the
  single-candidate producer. It may resolve current identity-anchored ORCID/ROR
  institution references and bounded plausible affiliations through OpenAlex;
  it must not discover email, attach eligibility, or persist a person.
- **Required extraction:** unlike the current helper, the producer records the
  bounded outcome of every required OpenAlex institution lookup. It cannot
  swallow a lookup error and then classify an empty domain set as complete.
- **Patch allowlist:** at most four normalized anchored institution domains,
  at most four plausible domains, bounded institution references/display names,
  completeness, and a bounded reason code. Raw OpenAlex responses are excluded.
- **Input version:** identity result version + bounded current-affiliation and
  current ORCID/ROR institution fingerprint + domain-resolution contract/source
  version.
- **Result:** a complete resolution, including `no_trusted_domains`, is
  `current`; identity-not-authoritative is server-issued `not_applicable`;
  provider error, timeout, or partial institution coverage is
  `incomplete`/`failed`. `no_trusted_domains` is not invite authority and may
  force eligibility N/A and staff contact confirmation downstream.
- **Downstream:** invalidates eligibility, contact, address trust, and roster
  persistence.

### D. `institution_coi`

- **Mode:** cold emission; explicit manual refresh. Warm reconciliation may
  validate the existing receipt against cheap hashes but does not execute the
  matcher or write evidence.
- **Prerequisites:** `identityStageCurrent`. If identity authority is false,
  short-circuit to the reason-coded N/A below. Otherwise require a complete
  `loadCoiContext` result with applicant/PI institution aliases and a current
  candidate-affiliation fingerprint.
- **Existing seams:** `loadCoiContext`,
  `canonicalizeInstitutionCoiContext`/`hashInstitutionCoiContext`, and
  `DeduplicationService.institutionCOIDecision`. The resolved/network variant
  is explicit, never a mount-time automatic action.
- **Patch allowlist:** `hasInstitutionCOI` and sanitized current-institution
  details (`dropDecision`, matched signals, PI/reviewer institution display
  fields, rule version). Historical affiliation remains COI-inert.
- **Input version:** identity result version + effective affiliation fingerprint
  + canonical request COI-context hash + institution-COI rule version.
- **Result:** a complete clean evaluation or complete conflict evaluation is
  `current`; incomplete request context, resolver/provider error, or unknown
  decision is `incomplete`, never clean. A conflict stays visible/read-only and
  promotion remains blocked. Current-but-nonauthoritative identity produces
  server-issued `not_applicable`/`identity_not_authoritative` without running
  the matcher.
- **Downstream:** invalidates roster persistence only.

### E. `coauthor_coi`

- **Mode:** explicit manual refresh; cold emission from work already performed.
- **Prerequisites:** `identityStageCurrent`. If identity authority is false,
  short-circuit to the reason-coded N/A below. Otherwise require the exact
  proposal content version and bounded proposal-author context produced from
  that exact proposal analysis.
- **Existing seam:** `checkCoauthorHistory` for exactly one candidate. Do not
  call `checkCoauthorshipsForCandidates` from the targeted route.
- **Execution:** an explicit refresh may download/analyze the proposal to
  reconstruct authors only after the pre-call Graph version is captured. It
  runs the single-candidate check and re-verifies the Graph version afterward.
- **Patch allowlist:** binary COI flag, graded strength, bounded totals, at most
  three bounded cited papers per author, completeness status, and bounded failed
  author/reason entries. No raw PubMed response.
- **Input version:** identity result version + proposal content version +
  proposal-author fingerprint + PubMed/coauthor contract version.
- **Result:** zero shared papers is clean only when every author query completed;
  shared papers is a complete conflict result; no proposal authors may be
  server-issued `not_applicable` with reason `no_proposal_authors`;
  current-but-nonauthoritative identity is `not_applicable` with reason
  `identity_not_authoritative`; any failed author query is `incomplete` even
  when other queries found no conflict.
- **Retry:** retries only failed author queries for this candidate. Successful
  author results remain display evidence but cannot make the stage current
  until the complete author set is reconciled. They may be reused only when
  their author fingerprint, proposal content version, source contract, and
  result version still match; otherwise they are discarded and queried again.
- **Downstream:** invalidates roster persistence only. The deferred override is
  not an outcome of this producer.

### F. `eligibility`

- **Mode:** explicit manual refresh; cold emission from existing eligibility
  work.
- **Prerequisites:** `identityStageCurrent`. If identity authority is false,
  short-circuit to server-issued `not_applicable`/
  `identity_not_authoritative`. Otherwise require a current
  `institution_domains` receipt. No bare-name eligibility search is permitted.
- **Existing seam:** extract/reuse `attachEligibilityEvidence` as a
  side-effect-free one-candidate producer. It must not be reached through the
  composite contact finalizer in targeted mode.
- **Patch allowlist:** `eligibilityCheckStatus`, `eligibilityStatus`, bounded
  reason/reason code, and bounded first-party evidence
  URL/title/sentence/domain/check time.
- **Input version:** identity result version + institution-domain result
  version and trusted-domain fingerprint +
  eligibility contract/provider-query version.
- **Result:** fetched, classified first-party evidence (including a complete
  `unknown`) is `current`; a complete domain result with no trusted domains is
  deterministically `not_applicable` with reason `no_trusted_domains`; missing
  credentials, provider failure, unreadable candidate pages, timeout, or
  incomplete identity/domain evidence is `incomplete`/`failed`, not unknown.
- **Policy:** complete `unknown` may pass other gates; deceased or authoritative
  ineligible blocks; emeritus remains informational; missing/incomplete/error
  blocks.
- **Downstream:** invalidates roster persistence only.

### G. `contact`

- **Mode:** explicit manual refresh; cold emission from contact work already
  performed.
- **Prerequisites:** `identityStageCurrent`. If identity authority is false,
  short-circuit to server-issued `not_applicable`/
  `identity_not_authoritative`. Otherwise require a current
  `institution_domains` receipt and current canonical-person anchor/ETag when
  one exists.
- **Required extraction:** create a side-effect-free
  `produceReviewerContactEvidence` from the existing contact tiers. It may run
  contact discovery and domain adjudication, but it must not resolve identity,
  attach eligibility evidence, write Dataverse/Postgres, or attach unrelated
  bibliometrics. The existing composite `enrichCandidate` remains for the cold
  pipeline until its call sites migrate to the same projectors.
- **Patch allowlist:** exact projected email/source/action, persistence flags,
  bounded email evidence, website/faculty page, current affiliation/source, and
  bounded quarantined contact leads. It never writes a canonical person.
- **Input version:** identity result version + institution-domain result version
  + normalized candidate contact
  inputs + canonical person ID/ETag + contact-source policy/contract version.
- **Result:** `projectReviewerContact(...).decision === 'ready'` or a complete
  server conclusion requiring staff address action is `current`; exhausted
  provider work with no authoritative address may be a complete
  `missing_email` result for display but remains non-promotable. Provider error,
  identity contradiction, contested address, or partial tier completion is
  `incomplete`/`failed` and never grants persistence authority.
- **Downstream:** invalidates address trust and roster persistence.

### H. `address_trust`

- **Mode:** cold emission for deterministically trusted sources; explicit staff
  action for research-only, contested, or corrected addresses. It is not a
  provider-search stage.
- **Prerequisites:** `identityStageCurrent`. If identity authority is false,
  short-circuit to server-issued `not_applicable`/
  `identity_not_authoritative`. Otherwise require a current contact stage,
  exact normalized address/source, and current person/ETag when linked. A
  current contact N/A caused by identity produces the matching address N/A.
- **Existing seams:** `addressTrustDecision`, `emailConfidence`, and
  `verifyPersonAndAddress`/existing address-trust route. The target stage route
  does not accept human evidence; it redirects the UI to the existing structured
  verification action when evidence is required.
- **Patch allowlist:** server address-trust receipt/bundle, normalized decision,
  exact address/source fingerprint, staff actor/time/evidence reference when
  applicable, and conflict/repair identifier when applicable.
- **Input version:** identity result version + contact result version + exact
  address/source + canonical person ID/ETag + address-trust contract version.
- **Result:** ready/quick-check policy or a valid exact-address staff receipt is
  `current`; a complete contact decision of `missing_email` produces a
  server-issued `not_applicable` address-trust receipt so the warm cache can
  converge while the contact promotion gate remains blocked. `conflict_pending`,
  research-only without staff evidence, stale ETag, and invalid evidence remain
  incomplete/blocked. Unknown sources use the existing conservative quick-check
  policy and never become invite-ready merely because a stage receipt exists.
- **Downstream:** invalidates roster persistence only.

- **Structured repair integration:** when staff verify or correct an address,
  the dedicated address action re-projects the exact contact email/source and
  address-trust evidence through the shared projectors in one CAS write. It
  replaces any prior contact `missing_email` result and address
  `not_applicable` receipt together, then recomputes terminal persistence. The
  generic stage route never accepts human evidence and never creates this
  two-stage write.

### I. `roster_persistence`

- **Mode:** cheap server-only terminal projector with exactly three writers:
  (1) the cold candidate upsert when its proposed upstream set is complete;
  (2) the same evidence CAS that completes a manual stage; and (3) an explicit
  provider-free `Finalize cached evidence` repair for a legacy/current upstream
  set missing only the terminal receipt. Warm GET/mount never writes it.
- **Prerequisites:** every applicable upstream receipt is current or a
  server-issued `not_applicable`, and the roster row still matches the expected
  token. Current Dataverse engagement is deliberately not persisted in this
  receipt; it remains panel-generation state and is re-read at promotion.
- **Execution:** prune the bounded render DTO, verify all server authority
  markers survived, compute an upstream receipt-set digest, then write the
  terminal receipt under CAS. It performs no Dataverse or provider write.
- **Input version:** canonical candidate key + ordered upstream contract/source/
  result versions + roster-pruning projection version.
- **Result:** only `current`. Any absent, refreshing, incomplete, failed,
  unknown, expired, or dependency-mismatched upstream stage leaves this stage
  stale and promotion blocked.
- **Atomicity:** cold emission validates and writes upstream receipts plus the
  terminal receipt in one candidate upsert. Manual completion validates and
  writes the requested receipt plus the terminal receipt in one CAS. The
  explicit terminal repair performs one CAS and no evidence/provider call.
  There is no independently failing second terminal write after a successful
  stage write.
- **Mutation rule:** `recordSurfaced` must not preserve a terminal receipt when
  replacing evidence it described. It either proves the upstream-set digest is
  unchanged or invalidates `roster_persistence` in the same write.

## Persistence changes

**[VERIFIED via source/tests]** The roster store exposes the following internal
operation and applies its stage-specific projector/allowlist before its exact
candidate-key + roster-token + candidate-wide-lease CAS:

```js
completeStageRefreshWithEvidence(
  requestId,
  candidateKey,
  expectedUpdatedAt,
  stage,
  refreshAttemptId,
  { evidencePatch, receipt }
)
```

The operation uses a stage-specific projector/allowlist before SQL and performs
one JSONB merge under the existing candidate-key + roster-token + attempt lease
CAS. It never accepts an arbitrary JSON patch. Start/failure/recovery retain
prior evidence and cannot stamp a current receipt. A successful completion
enters the current warm-cache envelope but does not imply sibling stages are
current.

Cold emission uses a sibling `recordSurfacedWithStageEvidence` path that
validates the same projectors and writes the candidate plus all actually
completed receipts and, when the proposed upstream set is complete, the
terminal receipt in one candidate upsert. It must return per-candidate stage
outcomes rather than only a count. Its merge is monotonic: cold evidence cannot
replace a newer staff-confirmed field, a newer canonical-person version, or a
newer manual receipt. It preserves those values only after proving dependency
compatibility; otherwise it invalidates the affected stages and reports the
candidate as partial rather than silently choosing a winner.

## API response and UI behavior

**[VERIFIED via source/tests]** Successful or failed manual refresh responses
use a closed shape. The manual route accepts target fields only, and the UI
renders server-returned freshness with its current-as-of timestamp rather than
accepting a client assertion of freshness:

```json
{
  "candidateKey": "suggestion:…",
  "requestedStage": "coauthor_coi",
  "outcome": "recorded",
  "stageState": "current",
  "reasonCode": null,
  "retryable": false,
  "rosterVersion": "new token",
  "candidatePlan": {
    "cacheOutcome": "partial_hit",
    "currentStages": ["applicant_anchor", "identity"],
    "pendingStages": [],
    "refreshes": [{ "stage": "coauthor_coi", "reason": "stage_incomplete" }],
    "promotionAuthority": "blocked_refresh_required"
  }
}
```

Closed outcomes are `recorded`, `not_required`, `skipped_stale`, `rejected`,
`refresh_in_progress`, `failed_retryable`, and `failed_terminal`:

- `200 recorded|not_required` — a current/N/A receipt was durably recorded, or
  no refresh was required; bounded current plan returned;
- `409 skipped_stale|refresh_in_progress` — reload current row/plan; an input
  change during execution is `skipped_stale` with reason `authority_changed`;
- `422 rejected` — reason is `prerequisite_stale`,
  `prerequisite_action_required`, `stage_not_executable`, or
  `canonical_candidate_unavailable`; show its exact safe next action;
- `503 failed_retryable` — a bounded failed/incomplete receipt was durably
  recorded when possible; response states whether a new roster token exists
  and offers only the named targeted retry;
- `422 failed_terminal` — a bounded nonretryable stage failure was durably
  recorded when possible; no automatic retry; and
- unknown outcome or missing required `stageState`/reason fields — client treats
  as error/read-only.

The response never uses `success:true` for an incomplete/failed stage. A losing
failure CAS returns `skipped_stale`, not a false claim that failure state was
recorded.

The UI uses one in-flight key `(requestId,candidateKey,stage,generation)` and an
AbortController. Every success, error, and `finally` state update checks the
current request generation. Navigation cannot attach a late result to another
request.

## Implemented boundary and remaining work

| Surface | Branch state |
|---|---|
| Manual repair | [VERIFIED via source/tests] The stage route exposes the eight executable stages named above. It uses a candidate-wide lease and exact CAS; another live stage lease returns `refresh_in_progress`, while an expired owner is durably recovered to the retryable outcome before a new attempt. |
| Cold applicant persistence | [VERIFIED via source/tests] `enrich-recommended-service` binds proposal-dependent work to Graph metadata before and after analysis, emits projected receipts through `recordSurfacedWithStageEvidence`, and returns per-candidate recorded/partial/skipped accounting. An authority/version change is not recorded as current evidence. |
| Identity and address actions | [VERIFIED via source/tests] `confirm_identity` derives canonical identity server-side from the exact row; the structured address route re-reads identity/person ETags and atomically projects `contact` plus `address_trust`. Neither action accepts client authority. |
| Terminal receipt | [VERIFIED via source/tests] Cold upsert, manual stage completion, and provider-free terminal repair use the terminal projector in the same candidate write. A successful stage write cannot separately fail to claim its matching `roster_persistence` receipt. |
| Promotion | [VERIFIED via source/tests] Both reviewer-promotion callers derive a server promotion-authority snapshot immediately before the fresh promotion gate. Receipts inform eligibility but do not replace current server authority. |
| Warm rendering | [VERIFIED via source/tests] The cached/reconciled read path performs zero evidence-provider or proposal-byte work. Cards show each stage's server-supplied “Evidence checked as of” time. |
| Intentionally unwired | [VERIFIED via source/tests] Standalone generic explicit-cold attestation/coordinator helpers and tests exist, but no route adapter reaches them. Wiring them would require retaining or redesigning the existing `load-proposal` public-Blob behavior; that work was not authorized, so this branch makes no generic explicit-cold attestation claim. |

The future autonomous-search trigger, approval level, durable job model, and
stage-specific six-month/six-year evidence-age thresholds remain deferred
product-policy decisions. They are not inferred from a manual repair, receipt,
or warm display hit.

## Required tests

### Common contract

- auth/app-role failure before mode/stage dispatch;
- closed-body rejection with positive controls for client evidence/version
  injection;
- exact candidate/request binding for applicant and non-applicant rows;
- legacy/unknown candidate key fail-closed behavior;
- live/expired lease, stale start, stale completion, and authority-changed
  complements;
- unknown stage/state/result/failure code rejection;
- evidence allowlist/size/prototype rejection for every stage;
- failure preserves prior display evidence and never renews `completedAt`;
- cold/manual projector parity for identical evidence.

### Stage behavior

- every prerequisite missing/stale/refreshing/failed/unknown complement;
- identity unresolved/ambiguous is current but non-promotable; dependent
  identity-sensitive stages become reason-coded N/A without provider calls;
  provider outage or partial response cannot become current;
- institution-domain resolution owns and bounds anchored/plausible domains;
  provider failure cannot become `no_trusted_domains`;
- institution context incomplete cannot become clean;
- coauthor zero papers plus one failed author remains incomplete;
- eligibility complete unknown versus provider error/missing credentials;
- contact refresh spies prove identity, eligibility, persistence, and unrelated
  metrics were not called;
- address trust cannot be created from client acknowledgement or an unmatched
  address/ETag;
- roster persistence rejects every noncurrent upstream state and invalidates
  when evidence is replaced;
- proposal Graph version changing during analysis discards output;
- one complete cold candidate reaches `cacheOutcome:'hit'`; one changed input
  invalidates only the dependency-matrix stages;
- unchanged warm revisit makes exactly zero expensive-provider/proposal-byte
  calls.

### Partial success and stale UI

- one candidate/stage failure leaves other candidates and stages current;
- responses name the candidate and stage, never only a count;
- no `success:true` when every requested durable write failed;
- request switch during every await branch prevents success/error/finally state
  from mutating the new request;
- retry runs only the named stage/candidate and never a full batch.

## Complement and fall-through disposition

| Input outside the happy path | Required behavior |
|---|---|
| unknown stage or execution mode | reject; no provider or write |
| current stage explicitly refreshed | `refresh_not_required`; no timestamp churn |
| stale prerequisite | return ordered prerequisites; do not auto-run them |
| missing proposal content version for coauthor | explicit proposal-dependent action required |
| provider returns partial data without explicit completeness | incomplete; never clean/current |
| complete negative or staff-review result | current evidence; promotion gate independently blocks or requests action |
| candidate changes during provider work | discard result; newer row wins |
| atomic stage+terminal CAS loses | neither proposed write claims success; newer row wins |
| legacy row has current upstream receipts but no terminal receipt | explicit provider-free terminal repair performs one CAS; warm GET does not write |
| manual address evidence sent to generic stage route | reject; use structured address-trust route |
| old receipt lacks a newly required dependency | compatibility mapper proves equivalence or marks it missing |
| all upstream receipts are current but panel authority is stale | cache may remain a display hit; promotion stays blocked by current panel/server authority |

## Explicitly deferred decisions

These do not block implementation of the normal fail-closed producer path:

1. Stage-specific six-month/six-year age thresholds and canary SLOs.
2. Coauthor provider-failure override persistence and reviewer accept-time
   attestation/possible-conflict hold.
3. The future autonomous-search trigger, approval level, and durable job model.
4. Any schema extraction/indexing of JSONB receipt fields; this specification
   uses the existing bounded roster JSONB until measurements justify a
   separately reviewed migration.

## Release boundary

[VERIFIED via source/tests] implementation and focused tests do not authorize
a merge, deployment, promotion enablement, send, or production mutation. Any
future enablement still requires an authorized authenticated dummy-request flow
that proves:

1. connected cold applicant enrichment emits a fully current candidate without duplicate
   provider work;
2. reload renders cached evidence before Dataverse reconciliation;
3. unchanged revisit makes zero expensive calls and reaches a real warm hit;
4. changing one controlled dependency invalidates only its documented stages;
5. one targeted refresh repairs only that candidate/stage; and
6. promotion remains blocked on every incomplete/failed/unknown complement.

Use request `1002788` for the authenticated no-send pilot. Do not use the
existence of this specification as authorization to merge, deploy, send email,
or mutate production data.
