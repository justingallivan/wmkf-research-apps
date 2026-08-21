---
title: Reviewer Email Conflict Self-Service Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Direct Workbench reviewer email choice is implemented in source; legacy alert compatibility remains during rollout."
canonical: false
cataloged: 2026-08-20
last_verified: 2026-08-20
owner: product-engineering
related:
  - docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md
  - docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - shared/components/reviewers/ReviewerSearchSection.js
  - shared/components/reviewers/CandidateEditModal.js
  - pages/api/workbench/reviewer-address-trust.js
  - lib/services/reviewer-address-trust-service.js
  - lib/services/alert-service.js
  - lib/utils/reviewer-address-trust.js
---

# Reviewer Email Conflict Self-Service Plan

## Decision and status

**IMPLEMENTED IN SOURCE 2026-08-20; NOT DEPLOYED.** On 2026-08-20, the owner
rejected the reviewer-address Admin round trip for ordinary staff work. Staff
already have broad authority over the underlying AkoyaGO data, and choosing
between the address already stored for a person and a different address found
during reviewer search is within their role. The safety gate is a deliberate,
audited choice after seeing both values—not escalation to a superuser.

Reader support landed first in `f59dcff`; the bounded writer/UI/retry/alert
implementation landed in `e8c90f5` on branch
`codex/reviewer-email-conflict-self-service`. [VERIFIED via source and 390
focused tests.] This plan supersedes the Admin-routing recommendation for
routine stored-versus-found reviewer email conflicts. Production retains its
prior behavior until this branch is deliberately promoted and smoke-tested.

## Contract-reconcile surface

- **Change surface:** replace the Find-card repair-alert loop with a staff-owned
  email-choice flow and reconcile any matching legacy alert after successful
  resolution.
- **Entry points:** `ReviewerSearchSection.CandidateCard`,
  `CandidateEditModal`, and `POST /api/workbench/reviewer-address-trust`.
- **Persistence:** the existing request-scoped `reviewer_find_roster` receipt,
  the existing Dataverse `wmkf_potentialreviewer.wmkf_addresstruststatejson`
  bundle and email fields, existing `system_alerts` rows during transition, and
  the operational-event recovery mirror touched by alert auto-resolution.
- **Consumers:** Find-card readiness/actions, ordinary and applicant promotion,
  Invite render/send gates, the Admin alert queue during transition, tests,
  route-security documentation, and reviewer lifecycle documentation.
- **Prior findings:** the current Find card can send any user with an open
  repair request to superuser-only Admin; Admin then sends the operator back to
  Workbench. The existing Workbench modal and service already implement most of
  the desired two-address decision.

## Pre-implementation baseline (historical)

| Claim | Producer / entry | Persistence | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| Find can disclose the current stored/found pair | `get_address_conflict` | current Dataverse person trust bundle | `CandidateEditModal` | `reviewer-address-trust-service.js:getAddressConflict`; `ReviewerSearchSection.js:reviewAddressConflict` | VERIFIED |
| The modal offers stored and found choices | `CandidateEditModal` | client draft until submit | staff dialog | `CandidateEditModal.js` “Use stored” / “Use found” controls | VERIFIED |
| The server accepts only one member of the current pair | `verify_person_and_address` | roster receipt + Dataverse trust bundle/email | promotion/render/send | exact-pair membership check in `reviewer-address-trust-service.js` | VERIFIED |
| Person update is stale-write protected | address verification service | Dataverse reviewer person | all later person reads | person `_etag` required and passed as `ifMatch` | VERIFIED |
| Current open-repair projection points to Admin | roster GET → CandidateCard | `system_alerts` | Find card | pre-implementation `repairRequests` projection and `Repair request pending · View in Admin` | HISTORICAL |
| Admin is required to complete a routine email choice | none | none | none | Admin detail only links back to Workbench; it performs no reviewer repair | STALE/CONFLICT |
| Successful address choice currently auto-resolves its repair alert | none | `system_alerts` | Find/Admin status | no pre-implementation `AlertService.autoResolve(repairKey(...))` call in the success path | HISTORICAL |
| `staff_verified` currently becomes invite-ready without a send-time low-confidence acknowledgment | address-trust write | person email source + valid trust bundle | `emailConfidence`, render/send | `reviewer-invite.js` ready branch and `send-emails-service.js` ready path | VERIFIED |
| A literal `set_aside` remediation currently renders a working control | remediation map | none | Find card | no `set_aside` handler; the real card affordance is `onExclude` / Not a fit | STALE/CONFLICT |
| Structural duplicate/inactive/linkage states can currently invoke `retry_check` | remediation/card | none | address-trust service | pre-implementation retry was gated to pending/unavailable conflict flags | HISTORICAL |
| `get_address_conflict` currently supports saved/Invite rows | route/service | current person bundle | Invite dialog | service requires an active Find roster row and route takes no suggestion target | STALE/CONFLICT |

## Product invariants

| Invariant | Likely files | Verification |
|---|---|---|
| Routine stored-versus-found differences are resolved by the Workbench user, without Admin. | `ReviewerSearchSection.js`, `CandidateEditModal.js`, remediation mapping | component test starts with two distinct addresses and exposes no Admin action |
| The dialog names the person and shows both exact addresses before either can be committed. | `CandidateEditModal.js` | both values must be present in the test fixture and rendered |
| `keep_stored` performs the same ETag-conditional person write as `use_found`: the email value stays the same, while source/trust/resolution are updated and exact blocks clear. | address-trust service + trust utility | assert `ifMatch`, `resolution.decision`, `resolution.selectedEmail`, source/bundle, and cleared blocks |
| Choosing the found address conditionally replaces the current person email and records `use_found`. | address-trust service + adapter | service test asserts `ifMatch`, selected email, source, bundle resolution, and cleared blocks |
| A user must make an explicit choice; opening, closing, or submitting an unchanged default grants no authority. | modal + route/service | negative tests with both addresses present and no selected side |
| If identity also needs confirmation, one dialog collects both “this is the person” and the address choice; neither requirement silently satisfies the other. | Find card + modal + roster confirmation/address service | complement tests for identity-only, address-only, both, and neither |
| The server re-reads the person, pair, roster row, and ETag; client labels and stale values grant no authority. | route + service | tampered third address and stale-ETag tests return retryable conflict |
| A successful canonical resolution is not undone if alert closeout fails. | address service + `AlertService` | test resolves address while mocked auto-resolve fails; response preserves domain success and reports closeout warning |
| A legacy open repair alert cannot replace or hide the direct Workbench remedy; after Slice 3 it also exposes no Admin link. | roster projection + CandidateCard | Slice-1 fixture preserves the email-choice action; Slice-3 fixture removes the Admin anchor |
| Duplicate-owner, inactive-person, and Contact-linkage states do not fall through to a routine two-address overwrite. | remediation/service branches | each exceptional code remains blocked and gets an AkoyaGO/retry remedy, not `use_found` |
| Unknown states fail closed with Retry/Not a fit; they never default to Admin or ready. | remediation mapping + UI | unknown-code complement test |
| A staff address choice is the final safety gate and becomes invite-ready; copy says staff selected between current values, not that independent evidence was recorded. | trust utility + reviewer invite/readiness + dialog | readiness and send tests for `staff_address_choice`; reason-copy assertion |
| The dialog states that the person email is shared across requests, not local to the current request. | modal | component test asserts the rendered warning copy |
| Minting `staff_address_choice` requires a fresh pending stored/found conflict and a non-null exact resolution; later promotion may replay the receipt only against the same exact resolved person bundle. | address-trust service, promotion writers, trust utility | mint/replay complement tests across Find, Invite, ordinary promotion, and applicant promotion |
| No durable `staff_address_choice` receipt is minted before that fresh pending-conflict check passes. | address-trust service before `reviewer-roster-store.js:attestAddress` | direct non-conflict Find calls leave roster and person state unchanged; Invite rejects before its person write |
| A request-generation change after a committed server response never closes the dialog silently. | `ReviewerSearchSection.js`, modal callbacks | generation-race tests assert explicit reload/recheck feedback |

## Target staff experience

For a current `email_mismatch` / `address_conflict_pending` state, the Find card
shows **Review email choice** as the primary action. An existing repair alert
does not replace this action.

The dialog says, using the current server-read values:

> Neville Sanjana is already in AkoyaGO with **stored@example.edu**. Reviewer
> search found **found@example.edu**. Which address should we use?

Actions:

1. **Keep stored@example.edu** — retain the current person email and record that
   staff reviewed and rejected the newly found value.
2. **Replace with found@example.edu** — update the person to the found value and
   record the reviewed replacement.
3. **Cancel and investigate** — make no change and leave the candidate blocked.

The choice itself is the required and final safety acknowledgment. Routine email
choice must not require a fabricated publication URL or an “other evidence”
note. Add the bounded evidence type `staff_address_choice`; it records actor,
request, candidate, timestamp, old/found tuple, and
`keep_stored`/`use_found`. An optional note may be retained, but it is not
required for this evidence type.

**Owner-decided readiness semantics:** a valid `staff_address_choice` makes the
selected exact address invite-ready without a second send-time confirmation.
The readiness explanation must say that staff selected the address after
reviewing the stored and found values. It must not reuse “verified against
recorded evidence.” The dialog must warn that the Dataverse person is shared
across requests and that the decision affects future use of that person.

If the candidate also has `needs_identity_confirmation`, the same dialog first
requires **This is the person I intend to add**. The address buttons do not
implicitly confirm identity, and identity confirmation does not silently pick
an address.

## Server contract

The first implementation is explicitly scoped to the **Find** surface. Invite
already has a separate saved-suggestion repair flow; do not claim parity or
retire its alert consumers until that surface is independently traced. Reuse the
existing route and actions; do not add a new API route or persistence surface.

1. The client requests `get_address_conflict` with request/candidate identity.
2. The server re-resolves the authoritative roster/person and returns the
   bounded current pair.
3. The client submits `verify_person_and_address` with exactly one selected
   address and `evidenceType: staff_address_choice`.
4. If identity confirmation is also required, the existing authenticated
   `confirm_identity` roster action must complete first. The dialog remains open
   if address resolution then fails, and the UI reports the exact partial state.
5. The address-trust service—not `attestAddress`, which has no Dataverse
   access—must re-read and validate the exact pending conflict before it calls
   `reviewer-roster-store.js:attestAddress`. For
   `evidenceType === 'staff_address_choice'`, receipt minting is forbidden
   unless the current server state contains two distinct stored/found values
   and the requested selection is one of them. A third, stale, malformed,
   now-equal, or non-conflict Find request must leave both roster and person
   state unchanged. The suggestion/Invite branch does not call `attestAddress`;
   it must enforce the same fresh-conflict rule immediately before its own
   `createStaffVerifiedState`/person write.
6. The existing receipt and ETag-conditional update records `keep_stored` or
   `use_found`, then clears only the exact request/candidate conflict blocks.
   The suggestion and Find mint branches in
   `reviewer-address-trust-service.js` must reject
   `staff_address_choice` unless fresh server state contains the pending pair
   and the bundle being written contains a non-null exact resolution.

   `retryAddressCheck` is a third conflict-completion mint: it starts from a
   still-`conflict_pending` fresh person bundle plus a qualifying existing
   receipt, revalidates the pair and receipt timestamp, and writes the non-null
   resolution. It is governed by the fresh-pending-pair rule, not the promotion
   replay rule.

   Promotion is a distinct **replay**, not another mint. Ordinary
   `lib/services/reviewer-finder/save-candidates-service.js` and both
   applicant-promotion write paths may accept a roster receipt—which carries
   the attestation but no resolution field—only after a fresh person read proves a valid
   `staff_verified` bundle whose `attestation.evidenceType` is
   `staff_address_choice`, whose resolution is non-null, whose request and
   candidate binding match the receipt, and whose `selectedEmail` equals the
   exact receipt/current person email. The writer must preserve that valid
   resolved bundle (or reconstruct it from the parsed resolution); it must
   never overwrite it with a null-resolution bundle. A missing, mismatched, or
   stale person bundle rejects promotion before any write.

   The new readiness reason is emitted only for the conjunction
   `evidenceType === 'staff_address_choice' && resolution != null`; a resolution
   on publication/institution evidence must retain its evidence-backed wording,
   and an evidence type without a resolution must remain blocked.
7. After canonical success from either `verifyPersonAndAddress` or
   `retryAddressCheck`'s `address_conflict_resolved` return, invoke the same
   row-level closeout helper. Derive the server-owned correlation set from the
   current roster key plus any current suggestion/person identifiers. Look up
   open repair alerts for the request, including each row's persisted
   `auto_resolve_key`, and match their persisted candidate metadata. The
   closeout denominator is the raw matched alert rows, not the deduplicated
   per-candidate projection used for card display: two open rows with the same
   candidate key but different stored keys count as two. Resolve each matched
   row with its stored `auto_resolve_key`; do not recompute a key from metadata
   that may be legacy or divergent. Do not assume a Find key and an Invite
   `suggestion:<guid>` key are identical, and do not expose auto-resolve keys to
   the browser. Never substitute
   `AlertService.resolveAlert(id)`: it records a different terminal state and
   bypasses the operational-event recovery mirror.
8. Because `AlertService.autoResolve` returns `0` for both no match and an
   internal failure, capture the expected open-alert rows first. Return an alert
   closeout object with `expectedCount`, `resolvedCount`, and status
   `not_applicable | resolved | incomplete`. `resolved` means
   `resolvedCount >= expectedCount`, because resolving one stored key may also
   close a legacy row sharing that key but excluded from the correlation set;
   a greater count is successful cleanup, not an impossible state.
   `incomplete` is observable cleanup work but cannot roll back or misreport the
   successful address decision.
9. The response returns the authoritative candidate, selected decision,
   `personUpdated`, `rosterCleared`, and the closeout object so the client changes
   only the exact card and reports partial cleanup accurately.

## Implemented reason-to-remedy routing

| Current state | Primary remedy | Admin role |
|---|---|---|
| `email_mismatch` / `address_conflict_pending` | Review email choice | None |
| identity confirmation plus current address pair | Combined person confirmation + email choice | None |
| ordinary address verification without a stored/found conflict | Verify the displayed address | None |
| duplicate active owner / ambiguous owner | Fix the identified record in AkoyaGO, then **Retry record check**; never permit a third-address overwrite under the pending tuple | None |
| inactive person | Reactivate/correct the identified record in AkoyaGO, then **Retry record check** | None |
| Contact linked elsewhere | Correct the linkage in AkoyaGO, then **Retry record check** | None |
| transient person/conflict read or write failure | Retry; Not a fit remains available where the card's existing `onExclude` control is wired | None |
| unknown code | Keep the current terminal fallback until Retry and Not a fit are both real controls; then remove Admin dependency and fail closed | Transitional only |

No supported AkoyaGO record deep-link helper or configured URL shape exists in
the repository. [VERIFIED 2026-08-20 via CodeGraph/source search.] The
implementation therefore does not invent a record URL: it shows the bounded
record name/identifier and explicit “Fix in AkoyaGO, then Retry record check”
guidance.

## Alert transition and destructive preflight

`reviewer_address_repair_requested` is currently a live alert type. Do not drop
the alert type, Admin detail component, route mode, or `system_alerts` data as
part of the first implementation slice.

1. Stop offering/creating new reviewer repair alerts only after every currently
   emitted remediation code has a Workbench or AkoyaGO/retry destination.
2. Successful self-service resolution auto-resolves only server-looked-up open
   alerts matching the current request plus the bounded candidate correlation
   set; it never guesses one recomputed key.
3. Before removing roster `repairRequests` projection or Admin repair-detail
   code, grep all live producers/consumers and run a read-only Postgres count by
   alert status/type.
4. Existing open rows require classification against current reviewer state.
   Do not bulk-resolve them merely because this plan exists.
5. Removal is a later slice and is unverified-until-checked under the repository
   destructive-carryover rule.

## Partial success and stale async state

- Identity confirmation may succeed before address resolution fails. Preserve
  the authoritative identity-confirmed candidate, keep the modal open, and
  retry only the address step.
- Dataverse address resolution may succeed before roster block clearing fails.
  Return `personUpdated:true`, reload server state, and never invite from stale
  client state.
- Address and roster resolution may succeed before legacy alert auto-resolution
  fails. The candidate is resolved; alert cleanup is retryable operational work.
- Every post-await client update retains the existing request generation and
  exact candidate-key guards.
- When the generation changes after an identity or address server call has
  returned, the callback must not return success to `CandidateEditModal` and
  allow its unconditional close. Keep the dialog open or emit an explicit
  “request reloaded; re-check this reviewer” status before closing.
- A request/person/ETag change returns a fresh-review instruction; the UI never
  silently reapplies the earlier choice.

## Implementation slices

### Slice 1 — Contract and self-service dialog

- Ship reader support for `staff_address_choice` before any writer can emit it,
  then ship the writer/readiness UI in a second deployment. A rollback must land
  no earlier than the reader-support deployment; an older reader rejects the
  unknown evidence type and can re-open the adjudicated pair.
- Add the new evidence type to the bounded address-attestation writer and update
  the shared reader plus every `createStaffVerifiedState` call site: the
  suggestion mint branch, the Find mint branch, the
  `retryAddressCheck` conflict-completion branch, ordinary save, and both
  applicant-promotion paths. All three conflict-completion sites enforce the
  fresh pending-conflict/non-null-resolution rule; retry additionally requires
  the qualifying existing receipt. Only the three promotion sites use the
  exact receipt-to-resolved-person-bundle replay contract and preserve that
  bundle rather than replacing it with a null-resolution state.
- Add the mint precondition in the address-trust service before its Find call to
  `reviewer-roster-store.js:attestAddress`. Prove that direct non-conflict Find
  calls cannot mint a receipt and that the separately implemented
  suggestion/Invite branch rejects the same evidence type before its person
  write. Include active and saved roster rows.
- Update every current readiness/reason producer—not only
  `lib/utils/reviewer-invite.js:emailConfidence`—so the valid resolved staff
  choice becomes `ready` for the stated reason, not “independent evidence.” The
  enumerated producers are `lib/utils/reviewer-invite.js`,
  `lib/services/reviewer-roster-store.js:clearAddressTrustBlocks`,
  `lib/utils/applicant-known-reviewer.js`, and
  `shared/components/reviewers/reviewer-search-logic.js:getCandidateEmailReadiness`,
  and `shared/components/reviewers/ReviewerSearchSection.js`. Update the
  associated `reviewer-candidate-email-readiness` copy assertions. The
  save-candidate and `workbench-promote-applicant-reviewer-service` suites cover
  the separate bundle-preserving replay contract.
- After the Dataverse resolution succeeds in the initial Find flow or
  `retryAddressCheck`, pass the parsed server-validated resolution through
  every roster-recovery seam and persist one bounded client capability
  projection, `addressChoice: { decision, selectedEmail }`, on the roster
  candidate. This includes both `clearAddressTrustBlocks` and the
  already-`staff_verified` `projectResolved`/`recordSurfaced` fall-through used
  after a roster-clear failure. `getCandidateEmailReadiness` and
  `ReviewerSearchSection` may use staff-choice wording only when the receipt
  has `evidenceType: staff_address_choice`, that projection exists, and its
  selected email equals the candidate email. The applicant-known-reviewer
  server projection must make the same decision from the freshly parsed person
  bundle. Do not infer a choice merely from `emailSource: staff_verified`.
- Standardize the user-facing action label as **Review email choice**. Rename
  every current **Review address conflict** button, aria-label, Admin guidance,
  and assertion, including `ReviewerSearchSection`,
  `ReviewerRepairAlertDetails`, `reviewer-card-warning-badges-clickable`, and
  `reviewer-repair-alert-guidance`. Also rename the duplicated
  `resolve_address_conflict` labels in `lib/utils/reviewer-remediation.js` and
  `lib/utils/reviewer-invite.js`, plus the “Review both addresses” prose in
  `lib/services/reviewer-finder/save-candidates-service.js` and
  `lib/services/workbench/promote-applicant-reviewer-service.js`, so
  `addressTrustFailureMessage` can never instruct staff to click a control that
  no longer exists. The distinct Invite-only guidance in
  `lib/services/reviewer-finder/my-candidates-service.js` remains in this
  Find-scoped slice.
- Change the remaining conflict copy and controls to the explicit stored/found
  decision.
- Update `CandidateEditModal.js` itself: conflict mode must set and submit
  `evidenceType: staff_address_choice`, must not inherit the
  `publication_corresponding_author` default, must bypass the evidence-URL/note
  requirement for this bounded type, and must not render the publication-
  evidence selector for a stored/found choice. Component tests submit **Keep
  stored** and **Replace with found** with no URL and assert the exact POST
  payload.
- Require an explicit selected side; choosing that side is the acknowledgment,
  with no second checkbox. Keep Cancel neutral.
- Preserve existing fresh pair, exact-tuple, and ETag checks.
- Reconcile the changed readiness contract in the same slice in
  `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` and
  `docs/agent-wiki/topics/reviewer-identity.md`, and reconcile the renamed
  remediation labels in the active
  `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md`; these are
  current contract consumers, not alert-retirement cleanup.
- Reconcile the behavior-specific
  `docs/API_ROUTE_SECURITY_MATRIX.md` row for
  `/api/workbench/reviewer-address-trust` in this slice and run the route gate
  plus self-test; do not defer the content edit to alert retirement.

### Slice 2 — Identity-plus-address composition

- Reuse the already-built `confirmIdentityContact` two-step flow and
  `CandidateEditModal` independent identity/address acknowledgments.
- Before opening the confirm dialog for a pending conflict, fetch
  `get_address_conflict` and pass that server-read pair as `addressConflict`.
- Preserve the existing authoritative identity partial-success projection when
  the following address write fails. `onResolveAddressConflict` is live on the
  Invite surface and test-covered; preserve it. Slice 2 may add only the needed
  Find-side pass-through and must not remove or repurpose the Invite callback.

### Slice 3 — Remove the Admin detour from Find

- Preserve and regression-test the existing property that an open alert does
  not hide **Review email choice**; the actual edit is removal of the
  **View in Admin** anchor and repair-queue destination copy.
- Auto-resolve matching legacy alerts after successful canonical resolution
  from both `verifyPersonAndAddress` and `retryAddressCheck`; neither success
  path may leave a repair alert standing for the resolved pair.
- Extend `AlertService.getOpenAlertsByTypeAndRequestId` to select
  `auto_resolve_key`. Add a server-only row-level closeout helper in
  `reviewer-address-trust-service.js` that preserves every matched alert row;
  do not use the existing deduplicated `listOpenAddressRepairRequests` display
  projection as `expectedCount`. Match by request/candidate correlation, call
  `autoResolve` with every matched row's stored key, and omit the key from every
  browser response. The display projection may remain deduplicated and must not
  gain a browser-visible key.
- Remove `create_repair_request` from routine mismatch/identity codes only.
  Do not remove the terminal fallback for structural/unknown codes until Slice 4
  proves their replacement controls are executable.
- Replace stale `set_aside` terminology with the existing **Not a fit** action
  only on surfaces where `onExclude` already renders that real control. Update
  `addressTrustFailureMessage` plus modal/Admin prose; the generic remediation
  array has no CandidateCard render seam, so changing the map alone only changes
  prose and must not claim to wire a new control.

### Slice 4 — Exceptional-state routing

- Verify whether stable AkoyaGO record deep links exist.
- Make Retry genuinely reachable for duplicate-owner, inactive-person, and
  Contact-linkage states by updating all three layers: remediation entries,
  CandidateCard render gates, and the server-side retry/reconciliation
  precondition. Update `getFindCandidateRepairGuidanceAction` consistently.
- Route those states to the exact supported AkoyaGO record context plus the
  working Retry; keep fail-closed server checks. A third replacement address
  remains invalid while an exact pending pair exists.
- Do not give a user a generic Admin destination or an action they cannot
  execute.

### Slice 5 — Legacy alert retirement assessment

- Probe open/acknowledged/resolved reviewer repair alert counts read-only.
- Reconcile live producers/consumers, including `pages/admin.js`,
  `pages/api/admin/alerts.js`, `ReviewerRepairAlertDetails`, roster projection,
  `admin-alerts-repair-context`, `alert-service-open-keys`, and
  `reviewer-repair-alert-guidance` tests.
- Reconcile the remaining affected docs/memory through `/sweep`; the behavior-
  specific API matrix row is already required in Slice 1.
- Remove obsolete alert projection/detail code only if the live-caller and
  open-row preconditions pass; otherwise leave bounded compatibility readers.

## Verification plan

Focused tests must cover:

- stored and found addresses both present in the fixture;
- keep stored and use found positive paths;
- `keep_stored` must assert that the POST fired and that
  `resolution.decision === 'keep_stored'` plus the exact person `ifMatch`
  reached the adapter; rendering the button or closing the modal is not proof;
- no selection, identity-only, address-only, and both-required complements;
- same-domain aliases such as `person@email.school.edu` versus
  `person@school.edu` remain a deliberate choice, not an automatic heuristic;
- institution-move case updates the person with ETag protection;
- third-address tampering, stale pair, stale ETag, duplicate owner, inactive
  person, Contact-linkage, and transient write failure;
- identity success followed by address failure;
- canonical success followed by roster-clear failure;
- alert closeout three-way result: no matching alert, all expected alerts
  resolved, and expected alerts unresolved after a swallowed auto-resolve error;
- after Slice 1, an active legacy alert is present while the direct Workbench
  remedy remains visible; after Slice 3, the same fixture has no Admin link;
- after Slice 3, no reviewer-card Admin link exists for any tested conflict
  state;
- promotion, render, and send remain blocked until authoritative resolution and
  become ready afterward with the truthful staff-choice reason;
- the staff-choice reason requires both `evidenceType: staff_address_choice`
  and a non-null exact resolution, either parsed from the person bundle on the
  server or represented by the exact-email-matched bounded `addressChoice`
  roster projection on the client; publication/institution evidence with a
  resolution keeps evidence-backed wording, while staff-choice-without-
  resolution remains blocked;
- non-conflict active/saved Find calls cannot mint a `staff_address_choice`
  roster receipt, and the suggestion/Invite branch cannot mutate the person;
- a staff-choice mint whose person write returns 412 leaves a recoverable
  receipt; `retryAddressCheck` validates the fresh pending pair, completes the
  resolved person bundle, projects the same truthful `addressChoice` state, and
  returns the same three-way legacy-alert closeout object using the stored key;
- when the person write succeeded but roster block clearing failed,
  `retryAddressCheck` re-reads the resolved person bundle and the
  `projectResolved`/`recordSurfaced` recovery path projects the same truthful
  `addressChoice` state;
- ordinary and applicant promotion replay a valid same-request/candidate/email
  staff-choice receipt only when the current person has the matching resolved
  bundle; absence/mismatch blocks, while success preserves the non-null
  resolution through the person write;
- alert closeout selects and uses each matched row's persisted
  `auto_resolve_key`; a fixture whose metadata would recompute differently still
  closes with the stored key;
- two open alert rows with the same candidate metadata and different stored
  keys produce `expectedCount: 2` and both are closed; the card's display list
  may still show one deduplicated repair request. This is a defensive legacy-
  divergence fixture; the current deterministic `repairKey` producer normally
  prevents it;
- when a matched key also closes a legacy row outside the correlation set,
  `resolvedCount > expectedCount` still reports `status: resolved`;
- a pre-writer deployment can read `staff_address_choice`, and the chosen
  rollback boundary cannot invalidate or re-open the bundle.

Run each gate and its self-test sequentially:

1. focused reviewer address/card/modal/service/route suites;
2. `npm run check:api-routes` then `npm run check:api-routes:self-test` if the
   route contract or matrix changes;
3. `npm run check:status-enum-parity` then its self-test if remediation/status
   mappings change;
4. `npm run check:route-service-boundary` then its self-test;
5. `npm run check:dataverse-access-layer` then its self-test;
6. `npm run check:doc-currency` then its self-test;
7. `npm run check:fact-consistency` then its self-test;
8. `npm run check:docs-catalog`;
9. `npm run check:types`;
10. production build and a signed-in Preview smoke using a safe natural conflict.

## Completion status

- **VERIFIED in source/tests:** a staff user can resolve a routine stored/found
  email conflict without Admin through an explicit audited choice against a
  fresh exact tuple.
- **VERIFIED in source/tests:** combined identity/address cases use one dialog
  and preserve truthful partial success.
- **VERIFIED in source/tests:** an open repair alert does not hide the direct
  Workbench remedy and no Find-card Admin link remains.
- **VERIFIED in source/tests:** structural states stay fail-closed and point to
  AkoyaGO plus a working **Retry record check** action.
- **VERIFIED in source/tests:** matching legacy alerts auto-resolve after
  canonical success without becoming success authority.
- **VERIFIED by read-only Postgres probe 2026-08-20:** one active and three
  resolved `reviewer_address_repair_requested` rows remain; all four have
  persisted auto-resolve keys and request/candidate correlation. Alert
  projection/detail infrastructure is therefore retained as bounded
  compatibility. No rows were mutated.
- **OPEN:** signed-in Preview smoke on a safe natural conflict and deliberate
  production promotion.

## `/sweep` reconciliation report (Mode A — changed fact)

| Claim | Producer / entry point | Persistence / source of truth | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|
| Staff choose stored or found email directly | Find card → `CandidateEditModal` → address-trust route | ETag-guarded person trust bundle plus roster receipt/projection | Find readiness, promotion, Invite render/send | `e8c90f5`; modal/service/promotion tests | VERIFIED |
| A choice is valid only for the fresh exact pending pair | `verifyPersonAndAddress` | current Dataverse person bundle and ETag | person writer / roster clear | third-address, non-conflict, stale-pair, and 412 tests | VERIFIED |
| Staff-choice readiness is truthful and survives replay | trust parser + promotion services | non-null person `resolution` plus bounded roster `addressChoice` | roster/applicant projection and Invite gate | parser, roster, applicant, ordinary/applicant promotion tests | VERIFIED |
| Structural fixes can be rechecked without Admin | Find card **Retry record check** | fresh person, ownership, and linkage reads; CAS roster refresh | candidate card | inactive/duplicate/linkage service and UI tests | VERIFIED |
| Canonical success closes matching legacy alerts best-effort | address-trust service closeout helper | persisted open alert rows and their stored keys | Admin/pending projection plus operational recovery mirror | row/key/overcount/failure tests; live count probe | VERIFIED |
| Alert infrastructure can be retired now | N/A | one active live row remains | Admin compatibility readers | read-only Postgres probe | PARTIAL — retain |

Durable restatements reconciled in the enforcement contract, address-trust
plan, API security matrix, reviewer identity/workbench wiki pages, Postgres and
Dataverse Atlas pages, docs catalog, memory router, and session handoff. The
disconfirming checks were direct non-conflict `staff_address_choice` calls,
third-address submissions, stale ETags, unresolved duplicate ownership, failed
alert closeout, CodeGraph search for a supported AkoyaGO deep-link helper, and
the live alert count. All remained fail-closed or preserved canonical success
as specified. **Remaining live stale claims in the in-scope current guidance:
0. Remaining unknown: signed-in Preview behavior. Verdict: RECONCILED IN
SOURCE; DEPLOYMENT NOT VERIFIED.**

## Adversarial review

Claude Opus completed a draft review with **READY WITH NAMED CHANGES** and made
no repository file changes. Accepted corrections include explicit send-readiness
semantics, multi-key alert correlation, observable three-way alert closeout,
real control reachability for Retry/Not a fit, writer-after-reader rollout for
the new evidence type, Find-only initial scope, discriminating `keep_stored`
tests, narrowed Slices 2–3, and the full legacy-consumer denominator.

Artifact acceptance requires a fresh lifecycle-recorded fingerprint review whose
prompt carries the exact path receipt and again challenges partial success,
stale tuples/ETags, duplicate ownership, unknown-code fall-through, rollback,
and destructive retirement. The lifecycle receipt and task handoff hold the
current final verdict; editing this artifact afterward requires another review.
