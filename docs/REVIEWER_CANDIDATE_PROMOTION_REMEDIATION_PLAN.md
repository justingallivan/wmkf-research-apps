---
title: "Reviewer Candidate Promotion Remediation Plan"
domain: reviewers
kind: plan
status: active
summary: "Prevent silent contact withholding, duplicate person creation, and cross-request identity downgrades when Find candidates are promoted to Invite."
canonical: false
cataloged: 2026-07-29
owner: product-engineering
related:
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/agent-wiki/topics/reviewer-identity.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/reviewer-candidate-attestation.js
  - lib/services/reviewer-merge.js
---

# Reviewer Candidate Promotion Remediation Plan

> **Status: IMPLEMENTED AND LOCALLY VERIFIED ON
> `codex/reviewer-promotion-remediation`; NOT DEPLOYED.** The forward-path
> implementation and read-only classifier are built. Migration 029 has not
> been applied and no production repair is authorized. Every production repair
> still requires an explicit reviewed allowlist and separate execute
> authorization.

## Evidence labels

- **[VERIFIED via source]** means the behavior is present in the current
  checkout.
- **[VERIFIED via production read-only probe 2026-07-29]** means the finding
  was observed in live Postgres/Dataverse without mutation.
- **[VERIFIED via local production read-only probe artifacts 2026-07-29]**
  means the finding was observed live, but the per-person output is deliberately
  gitignored and is not independently reproducible from the repository alone.
- **[IMPLEMENTED IN SOURCE; NOT DEPLOYED]** means the behavior is present on
  the remediation branch and covered by local tests, but is not yet a
  production-state claim.
- **[PLANNED]** now applies only to deployment, live classification, or
  separately authorized repair execution.
- **[ASSUMED]** means implementation must confirm the claim before relying on
  it.

## Decision

The Find roster and the Invite candidate pool must no longer share one
ambiguous "Save selected" transition.

**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]** A candidate may be retained in the
per-request Find roster while
still being ineligible for promotion. Promotion to Invite succeeds only when
the server can persist or reuse a specific person with an authoritative email,
or when a staff confirmation binds the exact identity and contact values.
Unresolved or email-less rows remain actionable in Find as **Needs identity
confirmation** or **Missing verified email**; they do not create a selected
Dataverse suggestion and are not marked `saved`.

This preserves recall without presenting a name-only row as ready for outreach.
Invite continues to read the linked canonical person; it must not fall back to
the roster's email for sending.

## Scope

This plan covers:

1. Find-card eligibility and action labels.
2. The `save-candidates` trust, identity, contact, person-reuse, and suggestion
   persistence boundary.
3. Per-row success/failure/withheld responses and roster status changes.
4. Shared-person identity writes across requests.
5. Exact, guarded repair of rows already affected.

It does not:

- merge people by name;
- change COI eligibility policy;
- loosen invitation email confidence or send gates;
- merge Dataverse contacts;
- replay the broad manual cleanup performed earlier on 2026-07-29;
- authorize a production repair.

## Incident evidence

| Case | Evidence | Consequence |
|---|---|---|
| Request `1002912`: Rotem Sorek and Brenda Schulman | **[VERIFIED via local production read-only probe artifacts 2026-07-29]** Find roster blobs retained email values with `emailPersistAllowed=true`; the selected Dataverse suggestions linked to email-empty person rows. Older same-name email-bearing person rows also existed. | The candidates appeared to have email before save and had none in Invite; new/reused name-only people contributed to duplicate identity rows. Phase 0 must re-derive a redacted durable manifest before repair. |
| Prashant Mali | **[VERIFIED via local production read-only probe artifacts 2026-07-29]** One shared person is referenced across requests. Request `1002903` carries an unresolved/email-null applicant-recommended representation; request `1002874` carries a literature-found selected/invited representation with an email and sent invitation. The `1002874` conflict is also recorded in `SESSION_PROMPT.md`; the `1002903` detail is local-artifact-only. | A weaker request-specific result can currently overwrite or clear stronger shared-person identity state. This is a cross-request state problem, not a duplicate-person repair. |
| W. Lee Kraus | **[VERIFIED via production read-only probe 2026-07-29 and `SESSION_PROMPT.md`]** Current state is one repaired person with an invited engagement; the earlier issue involved applicant promotion and roster splitting on request `1002852`. | This is a regression sentinel, not a current merge target. |
| Broad same-name/identifier clusters | **[VERIFIED via local production read-only probe artifacts 2026-07-29]** The database contains many normalized-name and ORCID clusters, while normalized-email duplication is rare. | A broad same-name cleanup would create false merges. Historical repair must use exact evidence and per-pair review. |

The earlier 2026-07-29 cleanup removed known roster duplicates, repaired roster
anchors/gates, and upgraded email provenance. **[VERIFIED via local production
read-only probe and repair artifacts 2026-07-29]** That work addressed known
rows but does not prove that the forward promotion contract is safe.

## Pre-remediation contract trace (historical baseline)

This trace records the behavior that produced the incident and motivated this
work. It is not the contract implemented on the remediation branch.

| Layer | Current behavior | Risk |
|---|---|---|
| Find selection | `isCandidateSelectable` delegates identity grouping to `provenanceGroupOf`. Proposal/cited/referred provenance can be treated as selectable despite unresolved nested identity evidence. **[VERIFIED via source]** | The staff action looks like promotion eligibility even when only a name may safely persist. |
| Attestation | `reviewer-candidate-attestation.js` projection v2 binds request, candidate/roster keys, identity decision, identifiers, and metrics. It does not bind the exact effective email, email source, or contact persistence flags. **[VERIFIED via source]** | A valid identity receipt is not sufficient contact authority. |
| Save gate | `isUnresolvedIdentity` exempts proposal/cited/referred provenance. `contactBlockedForUnresolvedExempt` then force-nulls contact and identity-derived fields when nested identity is not `confirmed`/`probable`. **[VERIFIED via source]** | A candidate can pass the save gate only to lose the email that made the card appear invite-ready. |
| Person persistence | `potentialReviewerAdapter.upsertByEmail` reuses by exact email only when email exists. With null email it creates a person row. **[VERIFIED via source]** | Silent withholding can create a new same-name, email-empty person instead of reusing the intended person. |
| Suggestion persistence | `reviewerSuggestionAdapter.upsert` returns `{ skippedExcluded: true }` for an applicant-excluded collision. **[VERIFIED via source]** | The caller can mistake a guarded no-op for a successful promotion unless it checks the result. |
| Roster state | The save service best-effort stamps the suggestion/person anchor only. The browser separately calls `PATCH /api/workbench/reviewer-roster` with `action:'saved'`; `markSaved` is currently client-authoritative, and the fire-and-forget call does not check `res.ok`. **[VERIFIED via source]** | A browser or partial/no-op path can hide a row as `saved` without proving a successful Dataverse promotion. |
| Invite read | `my-candidates-service` projects email from the linked `wmkf_potentialreviewer` person. **[VERIFIED via source]** | The empty Invite email is an accurate read of an earlier bad promotion; roster fallback would hide the persistence error and weaken send safety. |
| Shared identity write | Automated `writeIdentityDecision` protects stored `confirmed`, but a later unresolved/ambiguous request may downgrade an existing `probable` decision. `clearIdentityFields` likewise protects only `confirmed`. **[VERIFIED via source]** | Request-specific uncertainty can erase stronger global person evidence. |
| Staff edits | `potentialReviewerAdapter.update` treats field presence as authority; `email: null` or `email: ""` becomes a clear, and a null email without an explicit source update can leave orphaned provenance. **[VERIFIED via source]** | An omitted UI value and an intentional destructive clear are not structurally distinct; concurrent shared-person edits are not ETag-bound at this adapter boundary. |

### Why the existing behavior was reasonable but is now wrong

The unresolved-provenance exemption was designed to preserve recall: a person
named in a proposal or referral should not disappear merely because automated
resolution abstained. Force-nulling contact was also a sound anti-namesake
safeguard. The regression is the combination: the system preserved the row by
creating a selected canonical candidate, while the UI and roster treated that
result as a successful promotion.

The remedy is not to persist the uncertain email. It is to stop conflating
**retain for staff resolution** with **promote to Invite**.

## Required invariants

| Invariant | Enforcement point |
|---|---|
| A selected Invite candidate never results from silent email withholding. | Server promotion decision before any durable write. |
| A browser cannot upgrade identity/contact authority by changing payload fields. | Attestation v3 or exact server-side staff-confirmation record. |
| Same-name equality is never reuse or merge authority. | Person projection/reuse service and repair classifier. |
| Existing exact email ownership and trusted IDs win over creation. | Pre-write person projection and duplicate-key race recovery. |
| A request-specific weaker identity result cannot downgrade stronger shared-person state. | Monotonic identity writer with ETag/lineage checks. |
| Empty/omitted email is not an implicit destructive clear. | Explicit clear command carrying address, source, reason, and ETag. |
| Applicant-excluded collision is a per-row failure, never success. | Save orchestration immediately after suggestion upsert. |
| Only successfully promoted candidate keys become roster `saved`. | Server-owned roster transition after canonical suggestion success; client reconciliation is display-only. |
| Invite and send use canonical person contact only. | Existing Invite DTO/render/send gates; no roster fallback. |
| Historical repair is exact, dry-run-first, drift-checked, and reversible where practical. | Dedicated classifier/manifest/executor, separate authorization. |

## Target promotion contract

### 1. One server-authoritative decision

**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]** The pure
`projectReviewerContact` helper computes a complete persistence
projection before any write:

```text
ready
needs_identity_confirmation
missing_email
blocked_coi
blocked_applicant_excluded
ineligible
```

The projection includes:

- exact request and immutable roster candidate key;
- effective nested identity decision;
- exact normalized email and source;
- email/website/affiliation persistence authority;
- existing trusted `suggestionId`/`potentialReviewerId` anchors;
- exact-email owner, if any;
- applicant-excluded collision state;
- the reason and staff action required when not `ready`.

The browser may render this decision but may not supply it as authority.

### 2. Behavior matrix

| Server decision | Find behavior | Dataverse person/suggestion write | Roster status |
|---|---|---|---|
| `ready` | **Promote to Invite** | Reuse/create exact person, then select/upsert suggestion | `saved` only after confirmed suggestion success |
| `needs_identity_confirmation` | **Keep for identity review** + exact confirmation action | None | remains `active` with reason |
| `missing_email` | **Add/verify email** | None until exact contact becomes authoritative | remains `active` with reason |
| `blocked_coi` | Read-only conflict explanation | None | existing COI-ledger behavior |
| `blocked_applicant_excluded` | Read-only applicant-exclusion explanation; no retry loop | None | terminal blocked state until the authoritative applicant disposition is changed |
| `ineligible` | Read-only eligibility explanation | None | `ineligible` |

Proposal/cited/referred provenance may influence what remains visible, but it
does not bypass this promotion matrix.

### 3. Attestation v3 binds contact authority

**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]** Projection v3 binds:

- exact normalized effective email;
- exact email source;
- `emailPersistAllowed`, `websitePersistAllowed`, and
  `affiliationPersistAllowed`;
- nested identity decision and resolver version;
- request ID and immutable roster candidate key;
- eligibility evidence already bound by v2.

The receipt binds the server-computed contact projection at mint time. Mint and
save must share the same pure derivation, including affiliation-email rescue,
address/source coherence, and anti-scrape rejection. Save may not introduce a
different address after verification; a later server rescue must mint a fresh
v3 receipt or route through staff confirmation.

Any mismatch returns `identity_attestation_required` or `claim_mismatch` before
writes. Verification becomes explicitly per-version: v1, v2, and v3 tokens are
accepted against their own projection functions. V1/v2 receipts may continue
to prove the exact legacy identity claims they originally bound, but they are
never contact-authoritative. This avoids invalidating in-flight v2 receipts
during their 14-day TTL. To promote contact from a legacy receipt, the server
must re-enrich/re-attest or use an exact staff confirmation.

### 4. Staff confirmation reuses the existing exact-value contract

**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]** The save boundary uses the existing
server-stored, actor-bound confirmation shape
from `reviewer-manual-confirmation.js`. Confirmation binds the canonical name,
email, website, and affiliation values actually approved by staff. It does not
bless resolver metrics, ORCID, Scholar data, or COI evidence.

If the candidate changes after confirmation, the exact-value comparison fails
closed and staff must reconfirm.

### 5. Sibling persistence envelopes

**[VERIFIED via source]** Applicant promotion is not the source of the
null-email person-creation shape: it operates on an existing suggestion/person
behind server-read identity gates and does not call `upsertByEmail`. It still
shares the client-authoritative roster-`saved` seam and a legacy successful
no-roster-row path. **[IMPLEMENTED IN SOURCE; NOT DEPLOYED]** It now uses the
same server-owned finalization and fails closed when the canonical roster row
is absent.

`pickVettedEmail`, applicant B1 backfill, and the email reconciler currently
implement related but divergent persistence envelopes.
**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]**

- make `pickVettedEmail` a thin caller of the canonical contact projection
  instead of claiming an informal mirror of `save-candidates`;
- use the same identity/contact authority predicate in applicant B1;
- treat the reconciler as an explicit legacy-repair mode: it never creates or
  selects a suggestion and requires an exact server-stored suggestion anchor;
- keep SQL/JSON prefilters as performance filters only—the canonical projection
  makes the authoritative decision.

### 6. Deterministic person reuse

For a `ready` projection, resolve the person in this order:

1. trusted server-read person/suggestion anchor, after verifying it belongs to
   the request/candidate;
2. unique active exact normalized-email owner;
3. create a new person only when neither exists and the exact email is
   authoritative.

Never reuse by normalized name. Use the uniqueness-aware
`findByEmailCandidates`, not the current unordered `getByEmail(top:1)`.
Inactive exact-email owners are excluded from reuse and reported as a repair
signal because a completed merge should have moved the address to the active
keeper. If two active exact-email owners exist, return an explicit conflict for
manual repair. If a person or `(person, request)` suggestion create loses an
alternate-key race, re-read the exact owner/junction and converge instead of
failing or creating another record.

No new person is created merely because the server withheld the submitted
email.

### 7. Suggestion and roster success semantics

**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]**

- Check `skippedExcluded` and return `applicant_excluded`; do not count or stamp
  the row as saved. Persist/render the terminal
  `blocked_applicant_excluded` decision so the card does not offer an action
  that can only fail.
- Extend the existing per-candidate key/error response into explicit
  `saved`, `withheld`, or `failed` results, plus exact reason/code and persisted
  IDs when applicable. Catch-all errors must also carry a stable code.
- The server performs the roster `saved` transition after confirmed suggestion
  success. The client removes/graduates only server-confirmed `saved` keys and
  no longer has authority to create that status.
- On a non-2xx response, the client still reconciles any returned `savedKeys`.
  On a transport failure after a possible commit, it treats the outcome as
  unknown and refetches roster/Invite state before permitting retry.
- Retire normalized-name fallback in `candidateWasSaved`; immutable keys are
  required so one namesake cannot graduate another.
- Best-effort roster anchor stamping remains non-fatal only after a real
  suggestion success; a failed stamp emits an alert/counter so reconciliation
  can restore the operational pointer.
- If a newly created person is followed by suggestion failure, run bounded
  compensation against that exact person ID only when a fresh read proves it
  has no suggestion, contact, applicant-slot, or engagement reference. If
  compensation is unsafe or fails, alert with the exact orphan ID. Never
  compensate a reused person.

## Shared-person identity and contact policy

Request-specific resolver evidence belongs in the roster. Global person state
may strengthen only when the new evidence is at least as authoritative and
refers to the same binding.

### Identity transitions

**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]**

- `confirmed` is sticky against every automated write.
- `probable` is not downgraded by `unresolved` or `ambiguous` evidence from a
  different request.
- A same-binding stronger result may refresh/strengthen the shared person.
- A different-anchor conflict does not overwrite; it emits a review alert and
  keeps request-specific evidence in the roster.
- Blanket `clearIdentityFields` is not allowed for cross-request abstention.
  A field may be cleared automatically only when stored lineage proves that
  the same automated binding wrote it and the replacement event is authorized.

The deployed Wave 13 binding fields and
`reviewer-identity-binding-writer.js` are the intended concurrency/lineage
primitive. **[VERIFIED via source and Atlas]** They are not yet broadly
authoritative. Implementation must either:

1. migrate the relevant save/enrichment callers through that writer with an
   explicit legacy-row classification step; or
2. add a narrow ETag-guarded compatibility writer that enforces the monotonic
   rules above and deliberately abstains from destructive clears until lineage
   is available.

The second option is the safer first slice; adopting the full binding writer
without classifying populated legacy rows would fail closed on those rows.

### Contact edits

**[IMPLEMENTED IN SOURCE; NOT DEPLOYED]**

- Normal updates omit absent fields; they do not translate empty UI values into
  clears.
- Email and source remain one atomic PATCH.
- A destructive email clear is a distinct server command that includes the
  expected current address/source, reason, and person ETag.
- Staff email verification remains request-scoped and lifecycle-gated.
- A stale person ETag returns a conflict and forces refresh; last-writer-wins is
  not acceptable for a person shared by multiple requests.

## Implementation status and evidence

| Surface | Branch state | Verification |
|---|---|---|
| Canonical contact projection + v3 receipt | Implemented | Attestation, readiness, contradictory-envelope, and tamper tests |
| Save/applicant promotion + server roster finalization | Implemented | Service, endpoint, roster-store, partial-result, and blocked-state tests |
| Find/Invite UI reconciliation | Implemented | Search logic, stale/partial save, blocked promotion, and Invite diagnostic tests |
| Exact-email reuse/race/compensation | Implemented | Potential-reviewer, suggestion-race, save compensation, and alert tests |
| Shared-person monotonicity + explicit contact clear | Implemented | Identity sticky/conflict and my-candidates clear/ETag tests |
| Merge repair ETag prerequisite | Implemented | Person, suggestion, and applicant-slot missing/stale ETag tests |
| Read-only repair classifier | Implemented; not run against production in this change | Pure classifier/manifest tests and script syntax check |
| Migration 029 / production deployment / repair execution | Not performed | Requires deliberate release and separate repair authorization |

The final focused local regression run on 2026-07-29 passed 20 suites and 497
tests. Lint (zero errors), production build, types, and the relevant migration,
API-security, Atlas, docs, fact-consistency, Dataverse-layer, OData,
route-boundary, lifecycle-auth, enum, secret, instruction, and canonical-pointer
gates passed; gate self-tests passed where defined.

## Implementation sequence

### Phase 0 — Freeze the contract with tests and a read-only classifier

**Source status:** complete except for the intentionally deferred live
production manifest and baseline counters.

1. Add complement tests for the contradictory envelope seen in request
   `1002912`: top-level verified/selectable signals plus nested unresolved
   identity and a roster email.
2. Extend the committed read-only probes
   `scripts/probe-roster-dump.mjs` and
   `scripts/probe-roster-has-dataverse-empty.mjs` to emit the promotion
   decision inputs without changing live state.
3. Record the exact read-only commands and commit a redacted, hash-stable
   classifier manifest containing request/suggestion/person IDs, status, and
   classifications without personal email values. This becomes the durable,
   independently re-runnable evidence for the local-only incident findings.
4. Capture baseline counters by decision/reason and verify that known sent or
   accepted engagements never enter an auto-repair class.

### Phase 1 — Server projection, v3 receipt, and response contract

**Source status:** complete.

1. Add the pure promotion projection helper.
2. Add v3 contact binding while retaining per-version v1/v2 verification and
   identity-only authority for legacy receipts.
3. Apply the same projection in `save-candidates-service.js`; do not duplicate
   the decision in route code.
4. Route `pickVettedEmail`/applicant B1 through the same authority predicate;
   retain a documented, stricter exact-anchor legacy-repair mode for the
   reconciler.
5. Make `skippedExcluded` a named failure and make suggestion create races
   converge like the existing `ensure*` paths.
6. Return exact per-key results and make both ordinary and applicant promotion
   stamp roster `saved` server-side only after success.

### Phase 2 — Find UX and Invite readback

**Source status:** complete.

1. Render server decision/reason on each Find card.
2. Split **Keep for identity review** / **Add or verify email** from
   **Promote to Invite**.
3. Render applicant-excluded collisions as terminal/read-only rather than an
   indefinitely failing promote action.
4. Reuse the exact staff-confirmation workflow and re-submit only after the
   server returns `ready`.
5. Reconcile returned saved keys even on non-2xx responses; on unknown
   transport outcome, refetch before retry. Remove normalized-name saved
   fallback.
6. In Invite, show an explicit `contact withheld`/`identity review required`
   diagnostic if a legacy selected row has no canonical email. Do not offer
   roster-email send fallback.

### Phase 3 — Shared-person monotonicity and concurrency

**Source status:** complete using the narrow ETag-guarded compatibility writer;
full legacy binding-writer adoption remains a separate classification task.

1. Add the ETag-guarded compatibility identity writer.
2. Prevent probable→unresolved/ambiguous downgrades and unrelated automated
   clears.
3. Add explicit contact-clear semantics and ETag-bind person edits.
4. Add exact-email create-race recovery.
5. Evaluate legacy binding classification separately before routing automated
   resolver writes through the full Wave 13 writer.

### Phase 4 — Production repair after forward fix

**Operational status:** not started. The merge ETag prerequisite is complete in
source; Preview/production deployment, live classification, review, and any
execution remain separately authorized work.

1. Deploy and smoke the forward fix in Preview with email capture/no live send.
2. Run the production classifier read-only and save its hash-stable manifest.
3. Verify the implemented `reviewer-merge` hardening in the deployed build:
   every planned person, suggestion, applicant-slot, email-move, and deactivate
   operation requires a non-null ETag and passes `ifMatch`; missing ETags force
   a re-plan. Raw one-off PATCH scripts are not an approved Phase 4 mechanism.
4. Have a human review every proposed person merge/repoint/update.
5. Execute only an explicitly approved manifest, aborting on ETag, lifecycle,
   email-owner, or reference drift.
6. Re-run the classifier and verify zero unexplained selected/email-empty
   promotions in the approved scope.

## Test matrix

Required focused tests:

- contradictory top-level/nested identity envelope;
- v3 exact email/source/persist-flag binding and tamper rejection;
- v2 receipt minted before deployment still verifies after deployment as
  identity-only evidence; v1/v2 never confer contact authority;
- mint/save contact projection parity for affiliation rescue and anti-scrape
  rejection;
- exact staff confirmation and stale-value mismatch;
- unresolved cited/proposal/referred candidate remains in Find but is not
  promoted;
- resolved candidate with no authoritative email returns `missing_email`;
- exact-email reuse and same-name/different-person non-reuse;
- inactive exact-email owner is not reused and produces a repair signal;
- alternate-key create race converges to the exact email owner;
- `(person, request)` suggestion create race converges to the existing junction;
- applicant-excluded collision returns failure and does not stamp roster saved;
- applicant-excluded collision renders a terminal read-only Find state;
- mixed batch returns exact `saved`/`withheld`/`failed` keys;
- partial non-2xx body still graduates its returned saved keys;
- transport failure after server commit refetches before retry;
- person-created/suggestion-failed compensation and alert fallthrough;
- request A `probable` followed by request B `unresolved` does not downgrade or
  clear shared state;
- different-anchor probable conflict alerts and preserves the prior binding;
- omitted email is a no-op; explicit ETag-bound clear succeeds; stale clear
  fails;
- Invite reads canonical email and renders a legacy-withheld diagnostic without
  send fallback;
- normalized-name fallback cannot graduate a same-name roster row;
- retrying the same ready candidate does not create another person or
  suggestion.

For every allow branch, add the complement: missing receipt, wrong request,
wrong roster key, changed email, changed source, stale ETag, excluded collision,
and partial dependency failure.

## Repair classifier

The implemented classifier is read-only, refuses `--execute`, and emits one
redacted, hash-stable row per affected selected suggestion:

```text
request
suggestion ID + ETag
current person ID + ETag
roster candidate key + updated_at
exact asserted email/source/gate evidence
exact-email owner candidates
person/suggestion/contact/applicant-slot/engagement references
classification + reasons
proposed action
```

### Classes

| Class | Criteria | Proposed action |
|---|---|---|
| `D` exact duplicate | Selected suggestion points to an email-empty person; coherent roster has an authoritative email; exactly one active email-bearing counterpart is independently confirmed to be the same person; merge safety plan is unblocked. | Human-approved `reviewer-merge` keeper/loser execution. |
| `C` coherent, no counterpart | Same starting state, but no existing exact-email owner. Identity/contact authority is coherent. | Route through the product confirmation/promotion path; do not hand-patch. |
| `U` unresolved/incoherent | Nested identity unresolved, conflicting address/source pair, invalid receipt, multiple owners, or contradictory anchors. | Leave unchanged; queue staff review. |
| `E` engaged/unsafe | Loser/candidate has invitation, response, review, contact, honorarium, applicant-slot collision, or other merge block. | Manual case-specific remediation only. |
| `N` no action | Canonical person/contact and lifecycle already agree. | Report only. |

Expected initial classification:

- Rotem Sorek and Brenda Schulman: **[ASSUMED pending durable Phase 0
  re-derivation]** likely `D`, with the older
  email-bearing person as keeper and the new email-empty person as loser. The
  executor must independently re-prove same-person evidence, absence of
  engagement, collision handling, and merge-plan safety.
- Prashant Mali: **[VERIFIED via local production read-only probe artifacts
  2026-07-29 and `SESSION_PROMPT.md`]** not a duplicate-person merge case;
  inspect only for shared-state downgrade/field clearing.
- W. Lee Kraus: **[VERIFIED via production read-only probe 2026-07-29 and
  `SESSION_PROMPT.md`]** expected `N`; any proposed mutation is a classifier
  failure that must abort the batch.

The existing `reviewer-merge.js` `planMerge`/`executeMerge` service is the only
approved person-merge mechanism. **[IMPLEMENTED IN SOURCE; NOT DEPLOYED]** It
re-evaluates pre-engagement, contact, collision, applicant-slot, and
confirmed-identity guards; requires non-null keeper, loser, suggestion, and
applicant-slot ETags; and passes `ifMatch` through every guarded mutation.
Missing or stale ETags force a fresh plan. The classifier supplies exact
evidence to that planner; it does not duplicate or weaken merge logic, and this
change adds no repair executor.

The previously identified ungated applicant-roster rows remain owned by their
separate stamping workflow. Phase 4 must report them as a separate ownership
class; it must not silently absorb or mutate them under the duplicate/contact
repair manifest.

## Observability and rollback

The implementation emits the existing structured alerts/errors at the named
failure seams. The following dedicated aggregate counters remain rollout
follow-up rather than a prerequisite for the fail-closed contract:

- `promotion_ready`
- `promotion_withheld_identity`
- `promotion_withheld_missing_email`
- `identity_attestation_required`
- `identity_claim_mismatch`
- `applicant_excluded_collision`
- `exact_email_reuse`
- `exact_email_create_race_recovered`
- `person_compensation_failed`
- `cross_request_identity_conflict`
- `stale_person_row`
- `roster_anchor_stamp_failed`

Rollout order is forward fix → Preview smoke → production deploy → observation
window → dry-run repair → reviewed execute. If withheld rates or failures
regress, roll back the application change; roster rows remain intact and can be
reprocessed. Repair execution has no broad rollback button, so each manifest
row must record before-state, merge plan, IDs, ETags, and result. A drifted row
is skipped, never force-applied.

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Persist the roster email whenever it is displayed | The displayed address can belong to a namesake; it bypasses the identity/contact authority boundary. |
| Let unresolved proposal/cited/referred rows promote name-only | This is the current ambiguity: it preserves recall but falsely signals Invite readiness and can create duplicates. Keep the row in Find instead. |
| Make Invite fall back to roster email | Hides a failed canonical write, creates two contact authorities, and weakens render/send gates. |
| Reuse/merge by normalized name | Production contains many legitimate same-name clusters; name is discovery evidence, never identity authority. |
| Treat all duplicate-looking clusters as a cleanup queue | Normalized-name and ORCID clusters are not equivalent to confirmed duplicate people. |
| Route every current write immediately through the Wave 13 binding writer | Populated legacy rows require explicit classification; an unplanned cutover would fail closed or misclassify lineage. |
| Patch known production rows before the forward fix | Recurrence remains possible and repair results can be overwritten by the same path. |

## Contract and documentation reconciliation

The implementation branch updates the maintained contracts below in the same
change. These are source-state claims, not deployment-state claims:

- `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` Contract 2 and receipt details;
- the receipt contract in
  `docs/atlas/postgres-reviewer-find-roster.md` and the relevant enforcement
  contract sections;
- `docs/atlas/postgres-reviewer-find-roster.md` status/action semantics;
- `docs/atlas/dataverse-wmkf-potentialreviewers.md` shared identity/contact
  monotonicity;
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` promotion/no-op semantics;
- `docs/agent-wiki/topics/reviewer-identity.md`;
- `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`;
- `lib/utils/reviewer-vetted-email.js` header/semantics and
  `lib/services/reviewer-identity-binding-writer.js` runtime-caller header;
- relevant active reviewer memories only after the behavior is shipped and
  verified.

The historical `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` remains historical. It
correctly says a fresh production gap requires a fresh scoped plan; this
document is that plan.

## Independent review

Claude Fable reviewed this document independently on 2026-07-29 in a clean,
read-only worktree using contract-reconciliation Plan Mode. Verdict:
**READY WITH CHANGES**; no P0 findings.

The review confirmed the root mechanism, retain-vs-promote decision, canonical
Invite read, Wave 13 sequencing, staff-confirmation reuse, and guarded repair
posture. The following named changes are folded into this revision:

| Review finding | Resolution in this plan |
|---|---|
| Production case evidence was local-only and over-labeled | Added the local-artifact label and a required redacted, re-runnable Phase 0 manifest. |
| Roster `saved` is client-authoritative today | Corrected the trace and made server-owned finalization an explicit invariant/Phase 1 requirement for ordinary and applicant promotion. |
| A naïve v3 bump invalidates in-flight v2 receipts | Required per-version `{1,2,3}` verification and a pre-deploy-v2 compatibility test. |
| Contact projection ordering was underspecified | Required one pure mint/save projection including rescue/coherence/anti-scrape behavior. |
| Inactive email owners and suggestion races were missing complements | Added uniqueness-aware active-owner handling and both person/suggestion race convergence. |
| Applicant B1/reconciler contact gates can drift | Brought sibling envelopes into scope with a documented stricter legacy-repair mode. |
| Merge ETag coverage was overstated | Corrected the claim and made full non-null-ETag/`ifMatch` hardening a repair prerequisite. |
| Client discards partial success on non-2xx/unknown transport outcomes | Required saved-key reconciliation and refetch-before-retry. |
| Applicant-excluded and name-fallback fallthrough remained | Added a terminal blocked decision and retirement of normalized-name saved fallback. |

Fable could not independently run live probes because its shell harness failed
with `EPERM`; it therefore classified the Sorek/Schulman/`1002903` instance
details as not reproducible from the committed repository. That limitation is
why Phase 0 now requires durable redacted re-derivation before any repair.
