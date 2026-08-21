# Atlas: `reviewer_find_roster` (Postgres — operational, source of truth)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** 2026-08-20 in source/tests and signed-in Production UI smoke
on Ready deployment `dpl_9yZ9xTHqfNgLcbZxJDekZkAjqpPS` for Neville's one-action
card and the exact stored/found choice projection through neutral Cancel; the live write was not
exercised. The broader roster lifecycle was
last verified 2026-08-03 in current `main` source/tests plus signed-in
production no-send behavior. The stage-evidence and request-level
reconciliation implementation is deployed through `7072d52a`, but Production
has an open outcome-classification incident: a deterministic contact/identity
staff action can remain `failed_retryable`/queued and render **Refresh contact
evidence** even though retry cannot make progress. See
`docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md`.

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
**Historical Slice A implementation status:** source and focused tests on
branch `codex/reviewer-find-stabilization-slice-a` projected authoritative
Dataverse engagement over every suggestion-anchored active roster row before
the GET response reaches Find. That wording records the historical pre-deploy
state; current deployment truth is in the incident notice above.
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
| candidate | jsonb | pruned render DTO (only card/render evidence fields, not raw enrichment internals). Applicant-suggested enrichment rows carry `enrichedProposalKey` (`library::folder::name`), `applicantEnrichmentCacheVersion`, and an explicit `identityStatus` gate result (`confirmed`, `probable`, or `unresolved`). The UI restores the cache only when every currently expected recommendation either has its exact canonical `suggestion:<suggestionId>` active/ineligible row for that proposal with the current `APPLICANT_ENRICHMENT_CACHE_VERSION` and a terminal gate result, or its canonical key is already terminal by staff action (`excluded`/`saved`/`blocked`). Legacy, unversioned, older-version, and unknown terminal rows cannot satisfy a missing expected row; a missing/partial non-terminal canonical batch re-enriches. Applicant institution contradictions route to `unresolved` only after the shared identity-consistency checker has ruled out direct or one-hop associated-institution compatibility. For that final coherence check, a current-run PubMed/ORCID verification institution outranks the applicant/stored institution; the latter is used only when the current verifier has no institution, so a stale prior affiliation cannot veto a coherent current identity or self-confirm a later namesake substitution. Direct eligibility evidence carries `eligibilityStatus`, reason, and a bounded fetched first-party page DTO (URL/title/evidence sentence/domain/check time). Institution-COI ledger and flagged active rows carry `hasInstitutionCOI` and `institutionCOIDetails` (`piInstitution`, reviewer affiliation, `dropDecision`, corroboration reason, drop stage/source where applicable). An authenticated `confirm_identity` action may add bounded `staffIdentityConfirmation` (opaque id, canonical manual contact, actor ids, timestamp, source), `manualContactFields`, and its UI marker. A resolved stored/found staff choice may add only `addressChoice: { decision, selectedEmail }`; readers require a matching `staff_address_choice` receipt and exact candidate email before presenting it as ready. The roster-only `update_contact_draft` action may merge bounded manual website/affiliation fields into the exact active row; it cannot accept email or write Dataverse. Browser-authored POST/exclude blobs have staff authority stripped; one bounded request/candidate-key roster read restores only an existing server confirmation and its canonical manual contact, while applicant mutations re-read the full canonical server blob. Automated candidates may carry a server-signed `automatedIdentityAttestation`; new receipts mint v4, while v3/v4 bind the request, immutable surfaced roster key, identity-bearing persistence bundle, eligibility evidence, and exact contact projection without storing raw provider payloads. V4 additionally binds `eligibilityCheckStatus`; a valid v3 receipt may restore its eligibility result/evidence but not overwrite the stored check status. A blocked row also stores its server-owned promotion decision/code/reason. |
| source_kind | text | Provenance kind: `cited_reference` \| `proposal_named` \| `applicant_suggested` \| `literature_retrieved` \| `grounded_seed` \| `barred_parametric`. Legacy rows may hold `claude_verified` or `database`; reads normalize those to a `provenance` DTO without rewriting the row. |
| first_seen_at | timestamptz | |
| updated_at | timestamptz | Roster mutation timestamp; `update_contact_draft` uses the server-read value as a compare-and-swap guard so a concurrent candidate refresh is not overwritten. |

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

**Deployed stage-evidence overlay (2026-08-03):** [VERIFIED via
source/tests and production no-send observation] `candidate` also carries bounded `stageFreshness` evidence and
receipts for `applicant_anchor`, `identity`, `institution_domains`,
`institution_coi`, `coauthor_coi`, `eligibility`, `contact`, `address_trust`,
and `roster_persistence`. The terminal receipt is valid only for its exact
applicable upstream set. The stored stage state is render/cache eligibility,
not client authority or a replacement for current promotion enforcement. Cards
display the server-supplied per-stage “Evidence checked as of” time. The
standalone generic explicit-cold attestation/coordinator helpers are not route
connected; this row format must not be read as proof that generic explicit
cold search emitted the new authority envelope.

## Read paths

- `lib/services/reviewer-roster-store.js` `listForRequest(requestId)` reads the
  rendered roster and returns active/excluded/ineligible/blocked candidates,
  canonical saved applicant suggestion keys (`savedKeys`), and the all-status
  name union. `findCandidateBySuggestion(requestId, suggestionId)` reads only
  the canonical `(request_id, suggestion:<id>)` row, rechecks the embedded
  suggestion id, and returns its `updated_at` token; applicant promotion fails
  closed when it is absent. `findIdentityConfirmation` is the fail-closed
  save-boundary read for an exact actor-bound staff confirmation;
  `findEligibilityByCandidateKey` is the request/candidate-key save-boundary
  read for ineligible state. In the Workbench Find panel,
  `ReviewerFindPanel` owns the cached-then-reconciled roster GET and passes its
  snapshot to `ReviewerSearchSection` for active/excluded/ineligible/blocked
  rendering, exact saved keys, and the dedup name union; standalone section
  callers retain their internal roster read. On that embedded warm path, panel
  mount performs neither proposal preparation nor applicant-input
  materialization; staff explicitly prepare the canonical/manual proposal and
  explicitly load applicant suggestions. The superuser-only Admin repair-alert
  detail path may separately re-read one exact candidate from server-owned
  alert correlation keys to present current repair context and a Workbench deep
  link; that read performs no roster mutation. The embedded cold-search control
  fails closed until that materialization succeeds and its exclusion parse is
  available, so a search cannot silently omit applicant exclusions. A missing
  applicant-enrichment cache remains visible and idle until staff choose its verification action. The
  request/generation and AbortController guards prevent an explicit operation
  for the prior request from painting the next request. `coi_dropped` contributes only
  through `allNames`. Its temporary missing-mode compatibility GET performs
  the existing complete request-scoped
  `findByRequest(..., { selectedOnly:false, requireComplete:true })` read for
  every suggestion-anchored visible roster row. The additive `mode=cached`
  GET instead returns the Postgres projection only with an opaque deterministic
  snapshot token; it does not enter Dataverse. `mode=reconciled` requires that
  exact token and returns `409 roster_snapshot_changed` plus a fresh cached
  projection if the Postgres snapshot changes either before or after
  trusted-context Dataverse reconciliation. Rows with authoritative engagement are removed from their
  working-state bucket and returned as compact `handled` entries; a missing
  Dataverse anchor fails closed rather than becoming actionable. Reconciled
  `authorityState:'current'` requires both that engagement overlay and the
  read-only `reviewer-warm-validation-service` proposal/input generation to
  succeed; it is a bounded panel-read state, not candidate-stage evidence or
  promotion authority. Candidate plans intentionally invalidate any stage for
  which this request/metadata read did not obtain that stage's own
  person/institution/proposal-author dependency; no global placeholder version
  can make those stages current. An applicant anchor is candidate-specific only
  for an exact stored potential-reviewer id matching a current recommendation
  slot; general-search candidates receive a server-issued `not_applicable`
  anchor so another applicant-slot edit cannot invalidate them. A
  suggestion-keyed row missing an explicit lane fails closed instead of being
  guessed as a general-search row. Warm
  validation reads no proposal bytes: it uses only server-owned request
  context, Graph item metadata for exact canonical
  `Reviewer Materials/Proposal_{requestNumber}.pdf`, then the exact current
  cycle `Phase I/ProjectDescription.pdf` fallback, and derives opaque content
  and applicant-input versions plus bounded non-PII invalidation plans. A
  binding is current only with bounded Graph drive/item identifiers and at
  least one stable eTag/version/last-modified token. Missing, duplicate, or
  incomplete bindings stay stale/read-only. A historical manual file override
  is never guessed from query/navigation state; when its authoritative binding
  cannot be recovered, the roster stays stale. The final Postgres snapshot
  comparison happens after both engagement and metadata/input reads, so a
  concurrent roster change still returns `409` with a fresh cached projection.
  Promotion from `excluded` revalidates the stored suggestion anchor against
  Dataverse before changing the Postgres row. Unanchored search results retain
  their Postgres working-state behavior. **[VERIFIED via source +
  `reviewer-warm-validation-service.test.js` and
  `reviewer-roster-endpoint.test.js`; deployed source reverified 2026-08-03.
  The open retry/action classification defect is documented in the incident
  handoff above.]**

## Write paths

- `lib/services/reviewer-roster-store.js` is the only roster JSONB mutation
  surface. [VERIFIED via source/tests] Its cold path is
  `recordSurfacedWithStageEvidence`, which validates bounded projected stage
  evidence and returns per-candidate `recorded`, `partial`, or `skipped`
  outcomes rather than a count. Its manual path is
  `startStageRefresh`/`completeStageRefreshWithEvidence`/
  `failStageRefresh`/`recoverExpiredStageRefresh`; it also has the provider-free
  `finalizeCachedRosterEvidence` terminal repair and
  `completeStructuredAddressVerification` for the paired staff action.
  Every stage write is an exact `(request_id, candidate_key, updated_at)` CAS
  under a **candidate-wide** refresh lease, not a per-stage lease. A second
  active stage reports `refresh_in_progress`; an expired owner is persisted as
  an incomplete retryable outcome before a retry can start. If upstream
  invalidation temporarily leaves that exact owner's normal source hash
  underivable, recovery uses only the opaque
  `reviewer-stage-expired-lease-recovery:v1` server-derived
  request/candidate/stage marker and still writes an incomplete receipt. The
  planner exposes it only as `recover_expired_lease` with canonical reason
  `prior_refresh_incomplete`. A missing/non-canonical attempt or start time,
  non-allowlisted stage, live owner, or foreign-stage owner is never recovered:
  it is `lease_repair_required` and the UI provides an operator-repair-only
  state. Neither branch can make evidence current or authorize promotion. JSONB projectors
  retain prior display evidence on failure and reject arbitrary browser patches.
  Successful cold/manual writes apply the requested projected stage and
  `roster_persistence` atomically when the upstream set is complete; a lost CAS
  records neither as successful. `warmCacheVersion` denotes only the current
  cache envelope, never that every stage or promotion condition is current.
- `pages/api/workbench/reviewer-roster.js` handles record-on-results, Exclude,
  Promote, authenticated identity confirmation, roster-only website/affiliation
  draft edits, and scoped removal. The contact-draft action re-reads the exact
  active row and merges only those bounded fields; email remains exclusive to
  the structured address/identity actions, and no Dataverse person write occurs. Browser
  `action:'saved'` returns 409 `server_owned_transition`; clients cannot create
  saved/blocked authority. Browser-authored blobs have staff authority stripped
  and eligibility reconstructed only from a valid bound receipt.
- `pages/api/workbench/enrich-recommended.js` is the connected cold applicant
  producer. [VERIFIED via source/tests] it obtains Graph proposal binding
  metadata before and after proposal-dependent analysis, discards a changed
  authority/version, builds bounded applicant cold-stage evidence, and passes
  it to `recordSurfacedWithStageEvidence` for per-candidate outcome accounting.
  A display-only public-Blob fallback cannot authorize proposal-dependent
  identity/coauthor evidence.
- `pages/api/workbench/reviewer-stage-refresh.js` is the explicit manual
  targeted-refresh surface. [VERIFIED via source/tests] its closed body accepts
  only `{ requestId, candidateKey, stage, expectedUpdatedAt }`; it rejects
  client evidence, authority, source/provider, proposal/version, and plan
  fields. It dispatches the eight executable stages (`applicant_anchor`,
  `identity`, `institution_domains`, `institution_coi`, `coauthor_coi`,
  `eligibility`, `contact`, and `roster_persistence`). `address_trust` is
  deliberately rejected here and routed only through the structured action.
  The server re-reads the exact canonical row and derives all authority; it
  never selects by name or launches a batch repair.
- `pages/api/workbench/reviewer-reconcile.js` is the private request-level
  legacy-recovery surface. [VERIFIED via source/tests] the browser submits the
  exact active keys from its server-owned roster and accepts only a one-for-one
  result before reloading the parent snapshot. When a legacy row has a verified
  ORCID but lacks persisted person authority, the server may bind exactly one
  active, name-consistent Dataverse reviewer using the freshly read person ID
  and ETag. Only deterministic ready, quick-check, staff-verified, or
  not-applicable address results can project matching `contact` and
  `address_trust` receipts; ambiguity, conflict, research-only evidence,
  inactive people, or an ETag change remains a dedicated staff action. An
  applicant suggestion with no linked reviewer person is also terminal staff
  action and never receives a fabricated person anchor. The route never runs a
  cold search, promotes, invites, or sends email.
- `pages/api/workbench/reviewer-roster.js` `confirm_identity` re-resolves the
  authoritative roster/Dataverse identity and derives the canonical candidate
  key server-side before persistence. The dedicated structured address route
  accepts target/action input only; its server service
  re-reads identity/person ETags, then atomically projects matching `contact`
  and `address_trust` receipts in one roster CAS. For a fresh pending
  stored/found conflict, the address-trust service also records the bounded
  `addressChoice` projection only after the ETag-guarded person resolution;
  promotion replay preserves the matching non-null person resolution.
- `pages/api/reviewer-finder/discover.js` records institution-COI candidates hard-dropped by Track A verified discovery and referred-seed discovery as `status='coi_dropped'`. `lib/services/discovery-service.js` returns Track B institution-COI hard drops to the route for the same request-scoped write. Phase-C flag-not-drop candidates flow through the existing `recordSurfaced` active-row path instead.

## Cross-system

No Dataverse equivalent for the operational roster itself. Crossing points:
`save-candidates-service.js` creates/reuses the canonical person and suggestion,
then finalizes the exact roster key as `saved` and best-effort retires active
same-ORCID aliases; applicant promotion selects the existing suggestion, then
performs the same server-owned finalization.
[VERIFIED via source/tests] both callers first derive a server-side
promotion-authority snapshot from the authoritative roster candidate and pass
it to the shared fail-closed gate immediately before mutation. A warm-plan
state, browser payload, or existing receipt cannot replace that current check.
Dataverse and Postgres are not one transaction, so a finalization failure or
lost roster CAS is explicit partial success: it emits an operational alert, the
canonical Dataverse row remains authoritative, and the current promotion path
does not recreate the changed/evicted roster row from its stale snapshot.
Applicant-excluded no-ops become `blocked`; the roster never governs the
Dataverse `wmkf_applicantdisposition` picklist. The branch roster GET also
projects suggestion engagement from Dataverse as a read-only terminal overlay;
it does not rewrite Postgres or Dataverse.

## Migration disposition / gotchas

- Active/saved growth is bounded by a per-request row cap (v1). Durable excluded/ineligible/COI-ledger rows are not cap-evicted and therefore remain unbounded until the tracked TTL cleanup for closed requests is implemented (mirror `DatabaseService.cleanupExpiredCache`).
- PATCH handlers are eviction-tolerant (upsert from the submitted blob / no-op) so a row evicted by the cap while still on screen can't 404 a card action.
- Stores a pruned render DTO, never raw provider payloads or `tierResults`. Eligibility retains only the bounded fetched first-party page evidence needed for staff verification.
- Staff confirmation authority is not the client boolean. `save-candidates` must retrieve the opaque confirmation id under the same request and match the canonical name/email/website/affiliation; missing, mismatched, cross-request, or failed reads stop before writes.
- Automated `confirmed` / `probable` fields are deny-only without a valid signed
  receipt. New projection v4 receipts use `NEXTAUTH_SECRET`, expire after 14 days, and
  binds request, immutable roster key, identity bundle, eligibility evidence,
  exact normalized effective email/source, contact persistence flags, and
  `eligibilityCheckStatus`. Mint and save use the same
  `projectReviewerContact` derivation. Valid v3 receipts retain the same contact
  authority but cannot overwrite the stored eligibility check status. V1/v2 tokens remain
  verifiable against their own historical projections during the TTL but are
  identity-only evidence and never authorize contact promotion. New
  roster-managed candidates fail closed unless the receipt carries the verified
  immutable roster key; only bare pre-roster compatibility payloads retain the
  old mutable-correlation path.
- An exact-address edit can deliberately invalidate a v3/v4 token's contact digest.
  Save may recover only by re-reading the submitted immutable key under the same
  request, requiring an active/saved row whose valid server identity-decision
  receipt matches the submitted identity digest and whose exact address receipt
  is bound to that request, key, and email. The server identity receipt excludes
  contact by design and cannot authorize promotion without that address receipt.
- Applicant-suggested restore is keyed on the complete expected canonical suggestion-key set plus `candidate.enrichedProposalKey` and the current `candidate.applicantEnrichmentCacheVersion`, not the proposal Blob URL. Canonical excluded/saved suggestion keys are subtracted as terminal staff actions; unrelated/non-canonical keys cannot hide a missing expected row. Unversioned and older-version rows refresh once; the successful refresh persists the current version. `load-proposal` uses `addRandomSuffix:true`, so `blobUrl` changes across reloads and is not a stable cache key. A completed batch exposes **Update applicant suggestions** even when its cache is valid, allowing a staff-requested rerun after source data or resolver behavior changes; reruns preserve actor-bound staff confirmations and manual contact. **CONFIRMED Production defect, owner-accepted 2026-08-01 (was an open hypothesis):** the deployed roster-only terminal calculation does not cover an older `saved` row stored under a noncanonical `candidate:` key while a later applicant-enrichment run writes a canonical `active` twin, and it does not consult Dataverse invitation/response lifecycle. Re-probed 2026-08-01 and still true: Isberg (`selected=true, invited=true`) and Sorek (`selected=false, invited=true`) each hold a `saved` twin alongside an active applicant row and render as unresolved prospects; 3 of that request's 5 applicant recommendations are correctly actionable. **Two distinct causes:** Sorek-shaped resurfacing is a regression from `ad8e0299` (which replaced a `selectedOnly:true` read with a disposition-only one), while Isberg-shaped resurfacing is this roster-twin gap. **Owner decision:** Dataverse engagement becomes an independent terminal input for **every roster row carrying a suggestion anchor**, not applicant rows only — note `save-candidates` catches a roster-finalization failure, logs it non-fatally and raises an alert while the Dataverse write stands [VERIFIED via `lib/services/reviewer-finder/save-candidates-service.js:1517-1531`], so a search-origin row can strand as `active` while its suggestion is live. **Branch status:** Slice A implements that read overlay and the server/client applicant projection, with focused tests green; deployment and the signed-in no-send pilot remain open. Evidence: `SESSION_PROMPT.md`, `outputs/reviewer-workflow-stabilization-fable-assessment.md` §0/§3, and `tests/unit/workbench-reviewer-roster-projection-service.test.js`.
- **CONFIRMED missing-suggestion defect (Request `1002912`; re-probed 2026-08-01):** active roster key `suggestion:bb81d1f6-fc68-f111-a826-000d3a306da2` embeds a Dataverse suggestion id that 404s after the earlier Sorek merge. Sorek consequently holds two `active` applicant rows and renders twice. Restricting restore to the current server-derived expected suggestion set is an ACCEPTED remedy scheduled in Slice B (`SESSION_PROMPT.md`); the dry-run data cleanup remains post-fix hygiene requiring explicit Production-write authorization.
- Migration 025 backfills pre-existing rows with their stored `candidate.candidateKey` when present, otherwise an opaque `legacy-row:<id>` key, and writes that key into the candidate JSON so subsequent client actions remain exact.
- **Anchor-stamped placeholder keys split one person across two rows (S387).** `stampSuggestionAnchor` writes `suggestionId` into a blob but never re-keys the row [VERIFIED via `lib/services/reviewer-roster-store.js:368-384`], so a migration-025 `legacy-row:<id>` row can carry a suggestion anchor while the canonical `suggestion:<id>` row is written separately by applicant enrichment. The unique index is `(request_id, candidate_key)` [VERIFIED via `lib/db/migrations/025_reviewer_find_roster_candidate_key.sql:22-23`], so both rows persist; the client keys cards off the stored `candidate.candidateKey` [VERIFIED via `lib/utils/reviewer-candidate-key.js:18-21`], so the person renders twice — once selectable from the placeholder row (pre-identity-spine flags, so it looks clean) and once read-only from the canonical row carrying the real verdict. `findCandidateBySuggestion` resolves a suggestion ONLY to the canonical key, so promoting the selectable copy always 422s. Live counts [VERIFIED 2026-07-29 via production read-only probe]: 184 `legacy-row:` rows carry a suggestion anchor; 26 of those had a canonical twin (deleted by `scripts/dedupe-reviewer-roster-suggestion-twins.mjs`, dry-run by default, backup written before any delete). The other 158 had NO canonical twin. Codex adversarial review established the impact is wider than promotion: `authoritativeApplicantCandidate` (`pages/api/workbench/reviewer-roster.js`) resolved applicant rows through the canonical-key lookup too, so `exclude`, `saved`, AND `confirm_identity` also 409'd — staff could see an applicant card they could neither action nor set aside. Two-part remediation:
  - **Runtime:** the roster route now resolves applicant rows via `findCandidateBySuggestionAnchor` (matches the blob's `suggestionId`, prefers the canonical row when both shapes exist). The `stored.candidateKey === candidate.candidateKey` binding is unchanged, so this widens WHICH row is findable, never WHOSE claim is trusted. `promote-applicant-reviewer` deliberately keeps the canonical-key-only lookup: resolving a pre-spine blob there would be fail-OPEN, since its gate inputs are null and `requiresStaffIdentityConfirmation` would wave it through.
  - **Data:** `scripts/recanonicalize-reviewer-roster-anchors.mjs` (dry-run default) re-keys a placeholder row to `suggestion:<id>` only after Dataverse confirms the suggestion exists and its `_wmkf_request_value` matches the roster row's request, and stamps `needsIdentification:true` on the narrow subset that is `active` + applicant-provenance + has no spine verdict — so canonicalization is fail-CLOSED (the row routes to needs-identity-review and promotion requires an explicit staff attestation) rather than silently promotable. The stamp deliberately excludes `saved`/`excluded` rows (no card rendered) and non-applicant provenance (stamping those would make them unsavable: `save-candidates` hard-rejects `needsIdentification:true` for non-exempt kinds). EXECUTED 2026-07-29 [VERIFIED via post-run probe]: 156 rows re-keyed (50 stamped, 0 skipped, 0 failed; all 156 confirmed canonical afterward). The dry run had planned 158 — two rows (both `Justin*` test records, first seen 2026-06-24) acquired a canonical twin at 20:00:38-39, between scan and execute, so the `NOT EXISTS` guard correctly skipped them and they are now placeholder/canonical duplicate pairs for `dedupe-reviewer-roster-suggestion-twins.mjs` to clear.
  **The recurrence path was PASSIVE, not a staff action** [VERIFIED via `first_seen_at`/`updated_at` on both pairs plus the new rows' `applicantEnrichmentCacheVersion=2` + `needsIdentification=true` + `identityStatus='unresolved'`, i.e. the then-current `enrich-recommended-service` needs-review branch]. A placeholder row carried `applicantEnrichmentCacheVersion=null`, so `hasValidApplicantEnrichmentCache` failed and the former `ReviewerSearchSection` effect fired `enrichRecommended()` **on load** — writing canonical rows while nothing re-keyed or deleted the placeholder, minting a twin. The performance feature branch removes that automatic call: an invalid cache remains read-only until staff select **Verify applicant suggestions**, so merely loading a proposal or revisiting Find no longer recreates this historical condition. The earlier sweep was still required because it removed the already-existing fuel; final state [VERIFIED 2026-07-29 via production read-only probe]: **0** placeholder-keyed rows carrying a suggestion anchor, **0** duplicate `(request_id, suggestionId)` pairs, **0** rows failing the ungated-promotable invariant. 390 `legacy-row:` keys remain on rows with NO anchor. Those are correct as-is, and the disconfirming case is empty: `isServerManagedApplicantCandidate` also fires on `isApplicantRecommended` / `provenance.kind` / `enrichedProposalKey`, so an applicant-classified row lacking a `suggestionId` would still reach `authoritativeApplicantCandidate` and 409 there (it requires the anchor) — a probe for that shape returns **0 rows at any status** [VERIFIED 2026-07-29 via production read-only probe of the complement set], so no anchorless row is stuck in that path. `stampSuggestionAnchor` still stamps anchors without re-keying, so the twin mechanism is dormant rather than closed: it needs a row that gains an anchor after the fact, which now only happens to search-origin (`candidate:`-keyed) rows via save-candidates, and those are not promote-routed. Re-keying the saved rows also makes `savedKeys` finally count them, since that check requires the canonical key (`reviewer-roster-store.js` `rosterFromRows`).
- **OPEN (found while verifying the above, 2026-07-29): 35 pre-existing ungated applicant rows.** Using the client's own promote-routing predicate (`provenanceKindOf === 'applicant_suggested'`), there are 39 `active` canonical rows that `requiresStaffIdentityConfirmation` does NOT stop; 4 hold a real `confirmed`/`probable` verdict and **35 hold none** — they can be promoted today with no identity check whatsoever. [VERIFIED via production read-only probe cross-referenced against the migration's own backup file: **0** of these 35 are rows the migration touched, so they are pre-existing, not introduced.] They are canonical-keyed and carry neither a spine verdict nor `needsIdentification`, which the current `enrich-recommended-service` cannot produce (its two output branches set one or the other) — most likely written by a pre-identity-spine enrichment version whose key was already canonical. Remediated by `scripts/stamp-ungated-applicant-roster-rows.mjs` (dry-run default), which enforces the invariant "an active applicant-promote-routed row holds a spine verdict OR is flagged for identity review — never neither" using the client's own routing predicate, so it cannot touch a literature/proposal-named row (stamping those would make them unsavable). Dry run [VERIFIED 2026-07-29]: 35 rows across 7 requests, 5 per request, all `identityStatus=null`. **Historical exposure was narrower than it looked:** all 35 carried `applicantEnrichmentCacheVersion=null` and 0/35 satisfied `hasValidApplicantEnrichmentCache`'s per-row test, so the former Find mount behavior auto-ran applicant enrichment and rewrote the rows with real verdicts. The performance feature branch changes that automatic recovery into an explicit staff verification action; the existing fail-closed stamp remains the protection for stale rows until staff deliberately refresh them.
- `coi_dropped` is observability-only. Do not expose it as a recover/promote UI bucket without a separate policy decision; Contract 5 still hard-drops current-institution COI by default and save still fail-closes. The only visible discovery exception is the Phase-C contradicted low-trust flag, which remains read-only and unsaveable.
- Restored active generated-search rows are labeled `Previously found` in the Find tab. The removal action is scoped to the exact candidate keys carrying that label and their server-issued row timestamps, then rechecks `status='active'`, no active COI flag, and an explicit generated-provenance allowlist in Postgres; it is not a request-wide roster reset.
