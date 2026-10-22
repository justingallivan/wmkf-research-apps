# Atlas: `reviewer_find_roster` (Postgres — operational, source of truth)

<!-- drain-table:file-purpose=atlas-state-page -->

**Source review:** current checkout source, read 2026-10-22. The GET route
consumes a request ID, reads the Postgres roster, projects Dataverse suggestion
engagement in `workbench-reviewer-roster-get`, and adds matching open address
repair alerts. The read-only engagement projection introduced by Slice A is
current; it is separate from the later reverted stage-evidence/warm-validation
pipeline. No live Production probe was run in this review. The reverted
pipeline's hosted deployment state is **UNKNOWN** without a fresh probe.
Preserve the prior incident and owner-decision records as dated history; they do
not describe the current source contract.

**Historical verification checkpoints:** 2026-09-14 branch source/tests
covered the dormant exact-on institution-evidence projection and
request/candidate-bound receipt; 2026-08-21 feature-branch source/tests covered
bounded prior-request context; 2026-08-20 source/tests and signed-in Production
UI smoke on `dpl_9yZ9xTHqfNgLcbZxJDekZkAjqpPS` covered Neville's one-action card
and the stored/found choice projection through Cancel, without exercising its
live write. The broader roster lifecycle was checked 2026-08-03 in then-current
source/tests and signed-in Production no-send behavior. These are checkpoint-
scoped results, not a fresh verification of today's hosted state.

Migration 029 adds the
durable `blocked` status; migration 027 adds `ineligible`; migration 025 keeps
mutations keyed by `candidate_key`. The live row-count note below predates
migration 029 and is not a deployment claim. **Time-bounded incident supplement observed
2026-07-31 PT / 2026-08-01 UTC:** Request `1002912` contradicted the unqualified
claim that canonical roster terminal keys alone prevent every promoted or
engaged applicant recommendation from resurfacing; details are in Migration
disposition / gotchas and
`docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md`. Mutable row state and the
diagnosis built from it are not current proof. The Session 393 review pass was
complete and owner-accepted on 2026-08-01. Current incident handoff:
`SESSION_PROMPT.md`.
**Slice A implementation history:** the branch implementation added the
read-only Dataverse engagement projection over suggestion-anchored roster
rows. That projection remains in the current GET path. The later warm
validation/stage-refresh pipeline was a separate implementation and was
reverted from current source.
**Historical live row count:** 164 at the 2026-08-02 verification time; not
re-probed for this documentation handoff.

**Request 1003010 incident supplement (2026-08-01; fix now deployed):**
[VERIFIED via production read-only Dataverse/Postgres probes] one
active Ellen Zhong potential-reviewer person (`d9fd8a93-8845-f111-88b5-000d3a3065b8`)
was projected as two active proposal-named roster rows carrying the same exact
ORCID but different candidate keys and email evidence. The staff-attested row's
address edit correctly changed the contact projection, but that made its older
v3 automated token fail the contact digest before save could consume the new
address receipt; the other alias retained the newly found unverified address.
[VERIFIED via source + focused tests; `3c4bf5c9` is an ancestor of current
`main`] the deployed fix permits recovery only from the
current request-scoped active/saved roster row when its server-owned identity
digest still matches the submitted identity and its request/key-bound exact
address receipt matches the submitted email. Identity evidence alone remains
insufficient. The client collapses search-lane aliases only on an exact person
id or checksum-valid ORCID (never name alone), preferring the staff-attested
projection; successful finalization also retires remaining active aliases with
that ORCID on a best-effort basis.

## NOT a regression of the S219/migration-018 Dataverse cutover

Migration 018 dropped the **canonical reviewer-identity** Postgres tables (`researchers`, `researcher_keywords`, `publications`, `proposal_searches`, `reviewer_suggestions`), whose source of truth is now Dataverse (`wmkf_potentialreviewer` / `wmkf_appreviewersuggestion`). `reviewer_find_roster` is a different concern: **operational, pre-save, per-request working state** for the Workbench Reviewers→Find tab — un-vetted search discoveries plus their render blobs. It is the same class of object as `search_cache`, which migration 018 deliberately KEPT in Postgres. The canonical saved reviewer pool still lives in Dataverse, untouched. This table is candidate-keyed. `candidate_key` prefers real person anchors already present in the surfaced DTO and otherwise uses a name/email/ORCID/affiliation correlation fingerprint. It is not an identity-resolution claim; it exists to keep same-name rows and their mutations separate. `normalized_name` remains only a conservative cross-run search-exclusion field.

## Source of truth

**Postgres-primary for working state; Dataverse-authoritative for engagement.**
This table IS the source of truth for the Find-tab
per-request candidate roster (which candidates a request's searches or
applicant-suggested enrichment have surfaced, and their
active/excluded/ineligible/saved/blocked disposition for that request). It also
stores the discovery-time institution-COI hard-drop ledger
(`status='coi_dropped'`) for observability only. `status='ineligible'` is a
visible, non-selectable deceased-evidence ledger: it requires a resolved
identity, a trusted institution domain, and a successfully fetched first-party
page whose title/sole H1 identifies the candidate and whose page text directly
binds the death statement to that person. Browser-posted direct-search rows may
enter this state only when a request/candidate-bound server receipt also binds
the eligibility evidence; applicant-recommended enrichment writes through the
trusted server-internal path. Phase-C flagged institution-COI rows are normal
`active` rows with `candidate.hasInstitutionCOI=true` and
`candidate.institutionCOIDetails.dropDecision='flagged'`, which the UI renders
read-only and the save route rejects. The canonical reviewer pool remains
Dataverse `wmkf_appreviewersuggestion`. Only the server that confirmed the
Dataverse outcome may finalize an exact roster key as `saved`; an
applicant-excluded collision is finalized as `blocked` instead of being hidden
or retried indefinitely. A row's active Postgres status never overrules a
Dataverse suggestion that is already selected, invited, responded, declined,
accepted, review-received, or completed.

## Schema (10 columns)

| Column | Type | Notes |
|---|---|---|
| id | bigint (IDENTITY PK) | |
| request_id | uuid | akoya_request GUID (per-request scope) |
| candidate_key | text | Stable surfaced-row correlation key; unique within a request. Not an identity-resolution decision. |
| normalized_name | text | `normalizeReviewerName(candidate.name)` — conservative cross-run search exclusion only |
| display_name | text | surface-time `candidate.name` for re-render |
| status | text | `active` \| `excluded` \| `ineligible` \| `saved` \| `blocked` \| `coi_dropped` (CHECK-constrained) |
| candidate | jsonb | pruned render DTO (only card/render evidence fields, not raw enrichment internals). Applicant-suggested enrichment rows carry `enrichedProposalKey` (`library::folder::name`), `applicantEnrichmentCacheVersion`, and an explicit `identityStatus` gate result (`confirmed`, `probable`, or `unresolved`). The UI restores the cache only when every currently expected recommendation either has its exact canonical `suggestion:<suggestionId>` active/ineligible row for that proposal with the current `APPLICANT_ENRICHMENT_CACHE_VERSION` and a terminal gate result, or its canonical key is already terminal by staff action (`excluded`/`saved`/`blocked`). Legacy, unversioned, older-version, and unknown terminal rows cannot satisfy a missing expected row; a missing/partial non-terminal canonical batch re-enriches. Applicant institution contradictions route to `unresolved` only after the shared identity-consistency checker has ruled out direct or one-hop associated-institution compatibility. For that final coherence check, a current-run PubMed/ORCID verification institution outranks the applicant/stored institution; the latter is used only when the current verifier has no institution, so a stale prior affiliation cannot veto a coherent current identity or self-confirm a later namesake substitution. Direct eligibility evidence carries `eligibilityStatus`, reason, and a bounded fetched first-party page DTO (URL/title/evidence sentence/domain/check time). Institution-COI ledger and flagged active rows carry `hasInstitutionCOI` and `institutionCOIDetails` (`piInstitution`, reviewer affiliation, `dropDecision`, corroboration reason, drop stage/source where applicable). An authenticated `confirm_identity` action may add bounded `staffIdentityConfirmation` (opaque id, canonical manual contact, actor ids, timestamp, source), `manualContactFields`, and its UI marker. A resolved stored/found staff choice may add only `addressChoice: { decision, selectedEmail }`; readers require a matching `staff_address_choice` receipt and exact candidate email before presenting it as ready. The roster-only `update_contact_draft` action may merge bounded manual website/affiliation fields into the exact active row; it cannot accept email or write Dataverse. Browser-authored POST/exclude payloads have staff and institution evidence authority stripped; their bounded request/candidate-key roster read restores only an existing server confirmation and its canonical manual contact. Applicant confirmation re-reads the exact stored request/candidate row and suggestion anchor; non-applicant confirmation starts from the submitted pruned candidate and may separately read stored state for proposal-author checks. Automated candidates may carry a server-signed `automatedIdentityAttestation`. Current mint is projection v3; verification accepts v1/v2/v3. V3 binds the request, derived candidate key, optional roster candidate key when supplied, identity digests, exact contact-projection digest, and eligibility status/evidence digest; V3 does not bind `eligibilityCheckStatus`. V2 can bind the full identity decision; v1/v2 have no contact binding and retain their historical 14-day TTL. `contactAuthorityBound` is true only when the v3 contact digest matches and the projected contact decision is `ready`; the save boundary still applies separate address-trust checks. Behind exact-on `REVIEWER_INSTITUTION_PHASE2`, the DTO may also carry a validated `independentIdentity`, bounded typed `affiliationAssertions`, signed `affiliationAssertionsComplete`, and `serverInstitutionEvidenceReceipt`; the POST route strips browser claims unless its separate JWT binds the request, final server-derived candidate key, exact projection, completeness, and expiry. Save paths re-read and verify the stored receipt, screen every author-specific current additional affiliation, and hold missing, stale, conflicting, truncated, or otherwise incomplete evidence before Dataverse writes. Exact-off omits these fields and keeps the incumbent call/response shape, including COI-drop ledger writes. A blocked row also stores its server-owned promotion decision/code/reason. |
| source_kind | text | Provenance kind: `cited_reference` \| `proposal_named` \| `applicant_suggested` \| `literature_retrieved` \| `grounded_seed` \| `referred` \| `barred_parametric`. Legacy rows may hold `claude_verified` or `database`; reads normalize those to a `provenance` DTO without rewriting the row. |
| first_seen_at | timestamptz | |
| updated_at | timestamptz | Roster mutation timestamp; `update_contact_draft` uses the server-read value as a compare-and-swap guard so a concurrent candidate refresh is not overwritten. |

The pruned `candidate.contactEnrichment.dataverseContactEvidence` may also
carry `priorRequestContext` for an exact receipt-bound reviewer match. It keeps
only `complete`, an authoritative `totalCount` when complete, and at most three
request `{requestId, requestNumber, title, fiscalYear, meetingDate}` summaries.
Raw suggestion rows, reviewer-slot numbers, ETags, and the Potential Reviewer
person GUID are stripped. This display context is not consumed by roster
status, selectability, promotion, address readiness, or invitation policy.

`update_contact_draft` accepts only website/affiliation and rejects unsafe schemes,
documents, directories, and candidate-inconsistent profile URLs. For ordinary
non-applicant rows it clears stale automated/staff contact authority and stamps
`serverIdentityReviewReason=manual_contact_changed`, making the explicit confirmation
remedy visible before promotion. Applicant-recommended rows continue through their
separate server-owned promotion contract. The action never writes Dataverse.

Indexes: `uq_reviewer_find_roster_req_candidate` UNIQUE `(request_id, candidate_key)` + `idx_reviewer_find_roster_req_name (request_id, normalized_name)` + `idx_reviewer_find_roster_req_status (request_id, status)`.

**Status semantics:** `active` = surfaced list row; canonical contact projection
still determines whether it is promotion-selectable · `excluded` = staff
set-aside (collapsed recoverable section) · `ineligible` = direct official
evidence reports the person is deceased (visible source link, never
selectable/promotable/savable) · `saved` = server-confirmed graduation to the
Dataverse pool (not rendered on Find, kept for dedup) · `blocked` = an exact
promotion attempt hit an authoritative terminal collision such as applicant
exclusion (rendered read-only with its stored decision/reason) · `coi_dropped`
= discovery-time institution-COI hard-drop ledger (not rendered as selectable,
not recoverable/promotable). The cross-run search-exclusion union = **all roster
names for the request, every status**; that name union may suppress a later
same-name result, but it never merges two candidates or authorizes a mutation.
`recordSurfaced` may move `active` → `ineligible` on new direct deceased
evidence and refresh `ineligible` only with another direct deceased result; a
later unknown result cannot reactivate it. It never downgrades
`excluded`/`saved`/`blocked`/`coi_dropped` to active/ineligible, and enforces a
per-request row cap (oldest `active`/`saved` evicted; never `excluded`,
`ineligible`, `blocked`, or `coi_dropped`).

**Provenance semantics:** `candidate.provenance` is the durable render DTO for origin/grounding (`kind`, ordered `sources[]`, `seedRole`, `groundingWorkIds[]`). `source_kind` is a queryable copy of `provenance.kind`, not a Claude-vs-database flag. During the migration window, candidate JSON also keeps legacy `source`, `sources`, and `isClaudeSuggestion` fields for downstream compatibility.

**Historical stage-evidence overlay (2026-08-03; not in current source):**
The then-deployed implementation carried bounded `stageFreshness` evidence and
receipts for `applicant_anchor`, `identity`, `institution_domains`,
`institution_coi`, `coauthor_coi`, `eligibility`, `contact`, `address_trust`,
and `roster_persistence`. The terminal receipt was valid only for its exact
applicable upstream set. Cards displayed per-stage “Evidence checked as of”
times. Current source has no `stageFreshness` overlay or matching targeted-
refresh/reconcile routes; treat the former overlay and its worker details below
as historical implementation evidence, not current operations.

## Read paths

- `lib/services/reviewer-roster-store.js` `listForRequest(requestId)` reads the
  rendered roster and returns active/excluded/ineligible/blocked candidates,
  canonical saved applicant suggestion keys (`savedKeys`), and the all-status
  name union. `pages/api/workbench/reviewer-roster.js` GET consumes `requestId`; it has no
  `mode` or snapshot-token contract (other query fields are not a roster mode API). The route delegates
  to `lib/services/workbench/reviewer-roster-service.js`, which lists the
  Postgres roster, reconciles suggestion engagement in the narrow
  `workbench-reviewer-roster-get` DAL context, then reads matching open address
  repair requests. Engagement is returned as compact `handled` entries and is
  not written back to Postgres. A reconciliation failure remains a route error;
  failure of the supplemental repair lookup degrades to an empty list with
  `repairRequestsUnavailable: true`. `useReviewerRoster` applies the returned
  buckets, handled rows, saved keys, names, and repair state; its request and
  generation guards prevent an operation for the prior request from replacing
  the current roster. After a discovery POST settles, the browser reloads this
  snapshot before treating results as durable or excluding their names from a
  later search. Indexed POST acknowledgments map submitted results to server
  keys; current-run cards adopt authoritative active rows instead of shadowing
  restored fields or protected curation. Unknown acknowledgments or a failed
  reload clear uncertain current-run cards. A failed reload exposes the existing
  read-retry control in the results view and blocks another search until recovery;
  it never automatically replays the write. Standalone `ReviewerSearchSection` callers retain their
  internal roster read. The superuser-only Admin repair-alert detail path may
  separately re-read one exact candidate from server-owned alert correlation
  keys to present current repair context and a Workbench deep link; that read
  performs no roster mutation. `coi_dropped` contributes only through
  `allNames`. Promotion from `excluded` revalidates the stored suggestion
  anchor against Dataverse before changing the Postgres row. Unanchored search
  results retain their Postgres working-state behavior. **[VERIFIED via route,
  service, store, `useReviewerRoster`, and focused tests; no live production
  probe is claimed here.]**

## Write paths

- `lib/services/reviewer-roster-store.js` owns roster JSONB writes. Current
  surfaced-candidate writes use `recordSurfaced`; its default return is a
  numeric changed-row count, while the roster service requests indexed
  per-input outcomes. Server callers may supply an expected `updated_at` value
  to guard a write. Exclude, promote, identity confirmation, and contact-draft
  edits operate on the request/candidate row.
- `lib/services/workbench/reviewer-roster-service.js` owns record-on-results,
  Exclude, Promote, identity confirmation, roster-only website/affiliation
  draft edits, scoped removal, and GET reconciliation. `pages/api/workbench/reviewer-roster.js` supplies actor IDs from authenticated access. Browser
  `action:'saved'` returns 409 `server_owned_transition`; clients cannot create
  saved/blocked authority. Browser-authored candidate blobs have staff authority
  stripped and eligibility reconstructed only from a valid bound receipt on the
  applicable POST/exclude paths. Applicant confirmation resolves the exact stored
  request/candidate row and suggestion anchor and requires known person
  hydration. Non-applicant confirmation starts with the submitted pruned
  candidate; the stored row is separately consulted for proposal-author checks
  where needed. The contact-draft action re-reads the exact active row and merges
  only bounded website/affiliation fields; email remains exclusive to structured
  address/identity actions, and no Dataverse person write occurs. The POST
  service uses `recordSurfaced`'s opt-in detailed mode and returns one outcome
  per original input index, including the server-bound candidate key:
  `recorded`, `unchanged`, `invalid`, or `failed`. Other store callers retain
  the numeric result. A processed batch returns HTTP 200; `success` is false if
  any input is invalid or failed, while protected no-ops are legitimate
  `unchanged` outcomes. Neither a count nor a recorded outcome proves retention
  after cap enforcement or concurrent changes. Discovery uses GET for saved
  state; known failed new rows can remain ephemeral only without a protected-key
  or conservative `allNames` collision, and unsaved deceased results are counted
  in the warning rather than rendered as durable. A fresh search may rediscover
  unsaved names but is not an exact-candidate retry. Unverified-contact rescue
  requires an exact recorded singleton acknowledgment and carries its canonical
  key into identity confirmation. These partial-save mechanics are current in
  checkout source; the October 1 plan is their historical rationale, not proof
  of current hosted deployment.
- `pages/api/workbench/enrich-recommended.js` sends applicant recommendations
  through current enrichment and `recordSurfaced`. It may reuse an existing
  analysis result or analyze the proposal blob, and records per-suggestion
  attempted/recorded/skipped counts with optional stored-row `updated_at` guards
  and institution measurements. The former Graph pre/post-binding and cold-stage
  receipt behavior belonged to the reverted stage pipeline, not this current
  producer contract.
- `save-candidates-service.js` and applicant promotion are separate
  Dataverse-side mutation paths. They finalize roster state after their
  Dataverse operation; a Postgres finalization failure can leave Dataverse as
  the canonical committed state and is surfaced through error/alert handling.
  The current code does not expose a single shared promotion-authority
  snapshot/gate used by both callers immediately before mutation.
- `pages/api/reviewer-finder/discover.js` records institution-COI candidates
  hard-dropped by verified discovery and referred-seed discovery as
  `status='coi_dropped'`. Track B drops are returned by
  `lib/services/discovery-service.js` for the same request-scoped write.
  Phase-C flag-not-drop candidates use the active-row path.

### Historical rolled-back stage and warm-validation implementation

The following describes the former pipeline, not current source or a current
operational instruction. The exact hosted deployment state is unknown without a
fresh probe. Its background and resolution are retained in
`docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md` and the dated
plan records.

The former cold path was `recordSurfacedWithStageEvidence`; its manual path used
`startStageRefresh`/`completeStageRefreshWithEvidence`/
`failStageRefresh`/`recoverExpiredStageRefresh`, plus
`finalizeCachedRosterEvidence` and `completeStructuredAddressVerification`.
Writes used exact `(request_id, candidate_key, updated_at)` CAS under a
candidate-wide refresh lease. A live owner returned `refresh_in_progress`; an
expired owner was persisted as an incomplete retryable outcome. When the
normal source hash was no longer derivable after upstream invalidation, recovery
used the opaque `reviewer-stage-expired-lease-recovery:v1` marker and wrote an
incomplete receipt. The planner exposed `recover_expired_lease` with reason
`prior_refresh_incomplete`. A non-canonical attempt/start time, non-allowlisted
stage, live owner, or foreign-stage owner was held for operator repair as
`lease_repair_required`. Neither recovery branch made evidence current or
authorized promotion. Failed JSONB projections retained prior display evidence;
successful cold/manual writes applied the requested stage and
`roster_persistence` atomically only when upstream evidence was complete.

The former `/api/workbench/reviewer-stage-refresh` body accepted
`{requestId,candidateKey,stage,expectedUpdatedAt}` and dispatched
`applicant_anchor`, `identity`, `institution_domains`, `institution_coi`,
`coauthor_coi`, `eligibility`, `contact`, or `roster_persistence`; address trust
remained on its structured action. The former
`/api/workbench/reviewer-reconcile` was a request-level legacy-recovery path:
it could bind one exact active/name-consistent Dataverse person for a verified
ORCID, then project deterministic contact/address receipts, while leaving
ambiguous, conflicting, inactive, research-only, and changed records for staff
action. It did not run cold search, promote, invite, or email. Current source
contains neither route or its named helper path.


## Cross-system

No Dataverse equivalent exists for the operational roster itself.
`save-candidates-service.js` creates or reuses the canonical person and
suggestion; applicant promotion selects an existing suggestion. Both use the
current roster finalizer. That finalizer inserts a missing row and upserts its
active/saved status; it does not use `updated_at` compare-and-swap. A preexisting
non-active/non-saved row is not overwritten. Save-candidate finalization errors
raise a best-effort alert; applicant promotion reports partial success when
finalization fails. Dataverse and Postgres are not one transaction, so the
Dataverse outcome can remain committed if roster finalization fails. Applicant-
excluded no-ops become `blocked`; the roster does not govern the Dataverse
`wmkf_applicantdisposition` picklist. The current roster GET projects suggestion
engagement from Dataverse as a read-only overlay and does not rewrite either
store.

## Migration disposition / gotchas

- Active/saved growth is bounded by a per-request row cap (v1). Durable excluded/ineligible/COI-ledger rows are not cap-evicted and therefore remain unbounded until the tracked TTL cleanup for closed requests is implemented (mirror `DatabaseService.cleanupExpiredCache`).
- PATCH handlers are eviction-tolerant (upsert from the submitted blob / no-op) so a row evicted by the cap while still on screen can't 404 a card action.
- Stores a pruned render DTO, never raw provider payloads or `tierResults`. Eligibility retains only the bounded fetched first-party page evidence needed for staff verification.
- Staff confirmation authority is not the client boolean. `save-candidates` must retrieve the opaque confirmation id under the same request and match the canonical name/email/website/affiliation; missing, mismatched, cross-request, or failed reads stop before writes.
- Automated `confirmed` / `probable` fields are deny-only without a valid signed
  receipt. Current projection v3 receipts use `NEXTAUTH_SECRET` and expire after 14 days.
  V3 binds request, derived candidate key, optional roster candidate key when
  supplied, identity digests, exact contact-projection digest, and eligibility
  status/evidence digest. The verifier permits an absent `rosterCandidateKey`;
  when present, it must match the candidate's current key. V2 can bind the full
  identity decision; v1/v2 have no contact binding and remain verifiable within
  their historical 14-day TTL. V3 does not bind `eligibilityCheckStatus`. Save
  binds roster-managed candidates through a
  valid automated roster key, request-scoped staff confirmation, or (after an
  exact-address change) the current row's matching server identity and address
  receipts. Bare pre-roster payloads with neither an explicit roster key nor an
  automated receipt retain the compatibility correlation path.
- An exact-address edit can deliberately invalidate a v3 token's contact digest.
  Save may recover only by re-reading the submitted immutable key under the same
  request, requiring an active/saved row whose valid server identity-decision
  receipt matches the submitted identity digest and whose exact address receipt
  is bound to that request, key, and email. The server identity receipt excludes
  contact by design and cannot authorize promotion without that address receipt.
- Applicant-suggested restore is keyed on the complete expected canonical suggestion-key set plus `candidate.enrichedProposalKey` and the current `candidate.applicantEnrichmentCacheVersion`, not the proposal Blob URL. Canonical excluded/saved suggestion keys are subtracted as terminal staff actions; unrelated/non-canonical keys cannot hide a missing expected row. Unversioned and older-version rows refresh once; the successful refresh persists the current version. When reliable version metadata is available and the cached object passes its size check, a cache hit reuses the existing blob; a normal cache miss deterministically overwrites the public key. `addRandomSuffix:true` is only the size-mismatch fallback, so a `blobUrl` change in that case does not describe normal cache behavior. A completed batch exposes **Update applicant suggestions** even when its cache is valid, allowing a staff-requested rerun after source data or resolver behavior changes; reruns preserve actor-bound staff confirmations and manual contact.

  **Historical incident and branch snapshot (2026-08-01; not current deployment status):** the owner-accepted Production defect was that the deployed roster-only terminal calculation did not cover an older `saved` row stored under a noncanonical `candidate:` key while a later applicant-enrichment run wrote a canonical `active` twin, and it did not consult Dataverse invitation/response lifecycle. Re-probed on 2026-08-01: Isberg (`selected=true, invited=true`) and Sorek (`selected=false, invited=true`) each held a `saved` twin alongside an active applicant row and rendered as unresolved prospects; 3 of that request's 5 applicant recommendations were actionable. **Two distinct causes:** Sorek-shaped resurfacing was a regression from `ad8e0299` (which replaced a `selectedOnly:true` read with a disposition-only one), while Isberg-shaped resurfacing was this roster-twin gap. **Owner decision:** Dataverse engagement becomes an independent terminal input for **every roster row carrying a suggestion anchor**, not applicant rows only — note `save-candidates` catches a roster-finalization failure, logs it non-fatally and raises an alert while the Dataverse write stands [VERIFIED via `lib/services/reviewer-finder/save-candidates-service.js:1517-1531`], so a search-origin row can strand as `active` while its suggestion is live. **Branch snapshot:** Slice A implemented that read overlay and the server/client applicant projection; deployment and the signed-in no-send pilot were open at that snapshot. Evidence: `SESSION_PROMPT.md`, `outputs/reviewer-workflow-stabilization-fable-assessment.md` §0/§3, and `tests/unit/workbench-reviewer-roster-projection-service.test.js`.
- **CONFIRMED missing-suggestion defect (Request `1002912`; re-probed 2026-08-01):** active roster key `suggestion:bb81d1f6-fc68-f111-a826-000d3a306da2` embeds a Dataverse suggestion id that 404s after the earlier Sorek merge. Sorek consequently holds two `active` applicant rows and renders twice. Restricting restore to the current server-derived expected suggestion set is an ACCEPTED remedy scheduled in Slice B (`SESSION_PROMPT.md`); the dry-run data cleanup remains post-fix hygiene requiring explicit Production-write authorization.
- Migration 025 backfills pre-existing rows with their stored `candidate.candidateKey` when present, otherwise an opaque `legacy-row:<id>` key, and writes that key into the candidate JSON so subsequent client actions remain exact.
- **Anchor-stamped placeholder keys split one person across two rows (S387).** `stampSuggestionAnchor` writes `suggestionId` into a blob but never re-keys the row [VERIFIED via `lib/services/reviewer-roster-store.js:368-384`], so a migration-025 `legacy-row:<id>` row can carry a suggestion anchor while the canonical `suggestion:<id>` row is written separately by applicant enrichment. The unique index is `(request_id, candidate_key)` [VERIFIED via `lib/db/migrations/025_reviewer_find_roster_candidate_key.sql:22-23`], so both rows persist; the client keys cards off the stored `candidate.candidateKey` [VERIFIED via `lib/utils/reviewer-candidate-key.js:18-21`], so the person renders twice — once selectable from the placeholder row (pre-identity-spine flags, so it looks clean) and once read-only from the canonical row carrying the real verdict. `findCandidateBySuggestion` resolves a suggestion ONLY to the canonical key, so promoting the selectable copy always 422s. Live counts [VERIFIED 2026-07-29 via production read-only probe]: 184 `legacy-row:` rows carry a suggestion anchor; 26 of those had a canonical twin (deleted by `scripts/dedupe-reviewer-roster-suggestion-twins.mjs`, dry-run by default, backup written before any delete). The other 158 had NO canonical twin. Codex adversarial review established the impact is wider than promotion: `authoritativeApplicantCandidate` (`pages/api/workbench/reviewer-roster.js`) resolved applicant rows through the canonical-key lookup too, so `exclude`, `saved`, AND `confirm_identity` also 409'd — staff could see an applicant card they could neither action nor set aside. Two-part remediation:
  - **Runtime:** the roster route now resolves applicant rows via `findCandidateBySuggestionAnchor` (matches the blob's `suggestionId`, prefers the canonical row when both shapes exist). The `stored.candidateKey === candidate.candidateKey` binding is unchanged, so this widens WHICH row is findable, never WHOSE claim is trusted. `promote-applicant-reviewer` deliberately keeps the canonical-key-only lookup: resolving a pre-spine blob there would be fail-OPEN, since its gate inputs are null and `requiresStaffIdentityConfirmation` would wave it through.
  - **Data:** `scripts/recanonicalize-reviewer-roster-anchors.mjs` (dry-run default) re-keys a placeholder row to `suggestion:<id>` only after Dataverse confirms the suggestion exists and its `_wmkf_request_value` matches the roster row's request, and stamps `needsIdentification:true` on the narrow subset that is `active` + applicant-provenance + has no spine verdict — so canonicalization is fail-CLOSED (the row routes to needs-identity-review and promotion requires an explicit staff attestation) rather than silently promotable. The stamp deliberately excludes `saved`/`excluded` rows (no card rendered) and non-applicant provenance (stamping those would make them unsavable: `save-candidates` hard-rejects `needsIdentification:true` for non-exempt kinds). EXECUTED 2026-07-29 [VERIFIED via post-run probe]: 156 rows re-keyed (50 stamped, 0 skipped, 0 failed; all 156 confirmed canonical afterward). The dry run had planned 158 — two rows (both `Justin*` test records, first seen 2026-06-24) acquired a canonical twin at 20:00:38-39, between scan and execute, so the `NOT EXISTS` guard correctly skipped them and they are now placeholder/canonical duplicate pairs for `dedupe-reviewer-roster-suggestion-twins.mjs` to clear.
  **The recurrence path was PASSIVE, not a staff action** [VERIFIED via `first_seen_at`/`updated_at` on both pairs plus the new rows' `applicantEnrichmentCacheVersion=2` + `needsIdentification=true` + `identityStatus='unresolved'`, i.e. the then-current `enrich-recommended-service` needs-review branch]. A placeholder row carried `applicantEnrichmentCacheVersion=null`, so `hasValidApplicantEnrichmentCache` failed and the former `ReviewerSearchSection` effect fired `enrichRecommended()` **on load** — writing canonical rows while nothing re-keyed or deleted the placeholder, minting a twin. The performance feature branch removes that automatic call: an invalid cache remains read-only until staff select **Verify applicant suggestions**, so merely loading a proposal or revisiting Find no longer recreates this historical condition. The earlier sweep was still required because it removed the already-existing fuel; final state [VERIFIED 2026-07-29 via production read-only probe]: **0** placeholder-keyed rows carrying a suggestion anchor, **0** duplicate `(request_id, suggestionId)` pairs, **0** rows failing the ungated-promotable invariant. 390 `legacy-row:` keys remain on rows with NO anchor. Those are correct as-is, and the disconfirming case is empty: `isServerManagedApplicantCandidate` also fires on `isApplicantRecommended` / `provenance.kind` / `enrichedProposalKey`, so an applicant-classified row lacking a `suggestionId` would still reach `authoritativeApplicantCandidate` and 409 there (it requires the anchor) — a probe for that shape returns **0 rows at any status** [VERIFIED 2026-07-29 via production read-only probe of the complement set], so no anchorless row is stuck in that path. `stampSuggestionAnchor` still stamps anchors without re-keying, so the twin mechanism is dormant rather than closed: it needs a row that gains an anchor after the fact, which now only happens to search-origin (`candidate:`-keyed) rows via save-candidates, and those are not promote-routed. Re-keying the saved rows also makes `savedKeys` finally count them, since that check requires the canonical key (`reviewer-roster-store.js` `rosterFromRows`).
- **OPEN (found while verifying the above, 2026-07-29): 35 pre-existing ungated applicant rows.** Using the client's own promote-routing predicate (`provenanceKindOf === 'applicant_suggested'`), there are 39 `active` canonical rows that `requiresStaffIdentityConfirmation` does NOT stop; 4 hold a real `confirmed`/`probable` verdict and **35 hold none** — they can be promoted today with no identity check whatsoever. [VERIFIED via production read-only probe cross-referenced against the migration's own backup file: **0** of these 35 are rows the migration touched, so they are pre-existing, not introduced.] They are canonical-keyed and carry neither a spine verdict nor `needsIdentification`, which the current `enrich-recommended-service` cannot produce (its two output branches set one or the other) — most likely written by a pre-identity-spine enrichment version whose key was already canonical. Remediated by `scripts/stamp-ungated-applicant-roster-rows.mjs` (dry-run default), which enforces the invariant "an active applicant-promote-routed row holds a spine verdict OR is flagged for identity review — never neither" using the client's own routing predicate, so it cannot touch a literature/proposal-named row (stamping those would make them unsavable). Dry run [VERIFIED 2026-07-29]: 35 rows across 7 requests, 5 per request, all `identityStatus=null`. **Historical exposure was narrower than it looked:** all 35 carried `applicantEnrichmentCacheVersion=null` and 0/35 satisfied `hasValidApplicantEnrichmentCache`'s per-row test, so the former Find mount behavior auto-ran applicant enrichment and rewrote the rows with real verdicts. The performance feature branch changes that automatic recovery into an explicit staff verification action; the existing fail-closed stamp remains the protection for stale rows until staff deliberately refresh them.
- `coi_dropped` is observability-only. Do not expose it as a recover/promote UI bucket without a separate policy decision; Contract 5 still hard-drops current-institution COI by default and save still fail-closes. The only visible discovery exception is the Phase-C contradicted low-trust flag, which remains read-only and unsaveable.
- Restored active generated-search rows are labeled `Previously found` in the Find tab. The removal action is scoped to the exact candidate keys carrying that label and their server-issued row timestamps, then rechecks `status='active'`, no active COI flag, and an explicit generated-provenance allowlist in Postgres; it is not a request-wide roster reset.
