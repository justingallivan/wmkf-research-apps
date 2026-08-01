---
title: Reviewer Address Trust and Actionable Conflict Resolution Plan
domain: reviewer-identity
kind: plan
status: active
summary: "Exact-address attestation, person trust/conflicts, and actionable remedies are built; Wave 17 deployment and a production pilot remain."
canonical: false
cataloged: 2026-07-31
last_verified: 2026-07-31
owner: product-engineering
related:
  - docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - lib/services/reviewer-finder/save-candidates-service.js
  - lib/services/workbench/promote-applicant-reviewer-service.js
  - lib/services/reviewer-contact-reconciliation.js
  - lib/services/review-manager/render-emails-service.js
  - lib/services/review-manager/send-emails-service.js
  - shared/components/reviewers/ReviewerSearchSection.js
  - shared/components/reviewers/CandidateEditModal.js
  - shared/components/reviewers/InviteEmailModal.js
---

# Reviewer Address Trust and Actionable Conflict Resolution Plan

## Status

**IMPLEMENTED ON `codex/reviewer-address-trust-plan`; NOT YET DEPLOYED.** The
owner approved P1–P4 on 2026-07-31. Source, tests, Wave 17 schema-as-code, and the
read-only preflight are implemented. Production still requires schema-first
deployment, runtime promotion, and a controlled signed-in pilot.

The first Claude Opus 5 adversarial implementation review returned **NO-SHIP**.
Its confirmed findings have now been remediated in source: resolved tuples are
not reopened, a new third address supersedes an older pending tuple, an
attestation must postdate the conflict it resolves, conflict cards fetch a
fresh bounded two-address disclosure and can adjudicate either side, failed
conflict writes have a real retry, inactive/duplicate records route to durable
repair instead of an impossible identity-confirmation loop, raw trust bundles
no longer enter browser DTOs, and stale async responses cannot mutate a new
request.

The second Claude Opus 5 review of `f1b85e78` also returned **NO-SHIP**. It
confirmed all nine first-review findings as fixed, then found one new release
blocker and five medium contract gaps. Those findings were remediated in source
and confirmed fixed by the third adversarial review:
ordinary retry uses the same anchor-grounded ORCID rule as normal
reconciliation; retry is restricted to active, already-flagged roster rows and
replays an existing receipt instead of reopening it; resolved applicant A/B
pairs project only the canonical address; roster-receipt partial success is
explicit and applied by the client; stale ETags return retryable
`candidate_stale`; applicant-promotion typed errors have remediation; and the
security matrix classifies retry's writes.

The third Claude Opus 5 review of `21b44680` confirmed all six second-review
high/medium findings as fixed, but returned **NO-SHIP** on two newly exposed
workflow failures plus two medium and two low findings. The follow-up source now:
lets a receipt clear a failed conflict-write flag when no person bundle exists to
replay; persists and revalidates a server-bound identity-decision receipt before
an ordinary roster row can authorize a durable person lookup; renders both
conflict addresses and their evidence form directly in the invitation modal for
already-promoted rows; rejects raw manual-email edits while a conflict is pending
and routes the editor to that invitation adjudication surface; reports inactive
ordinary people precisely; and reconciles the stale test count. A fourth
read-only adversarial review is pending. Wave 17 and runtime promotion remain
prohibited until it passes.

This document replaces the rejected Session 390 design from
`codex/claude-ui-followup`. It incorporates the subsequent Codex whole-flow
review and the owner's additional requirement:

> Anything that flags an error must give the user an accessible way to fix it.

The replacement is not merely a different badge design. It defines the stable
person anchor, the exact-address attestation, its durable home, both promotion
paths, the send boundary, and a total reason-to-remedy contract.

## Change surface (`/contract-reconcile` Step 0)

- **Change surface [IMPLEMENTED IN SOURCE / NOT DEPLOYED]:** verify an exact reviewer address while its
  supporting evidence is visible, persist person-scoped trust until contradicted,
  and ensure every reviewer warning or block has an actionable remedy.
- **Entry points [VERIFIED]:** Find cards and `CandidateEditModal`; ordinary
  promotion through `/api/reviewer-finder/save-candidates`; applicant-recommended
  promotion through `/api/workbench/promote-applicant-reviewer`; Invite rendering
  and sending.
- **Persistence [VERIFIED current / IMPLEMENTED target]:** the Find roster is
  request-scoped Postgres working state; the reviewer person is the Dataverse
  source of truth. The target adds one server-owned current-state bundle to the
  Dataverse person and keeps only pending, pre-promotion evidence in the roster.
- **Consumers [IMPLEMENTED IN SOURCE]:** Find-card badges/actions, both promotion services,
  Invite rendering, first-contact sending, later outbound-email policy, merge and
  repair affordances, Atlas/docs/tests/gates.
- **Prior findings:** the ordinary save path does not necessarily resolve the old
  person before comparing addresses; applicant recommendations bypass
  `save-candidates`; changed/unchanged is not verification; no durable trust state
  exists; the send gate reads only `wmkf_emailsource`; conflict actions and
  already-promoted behavior were undefined.

## Product decisions already made

| # | Decision | Status |
|---|---|---|
| D1 | Staff trust is **person-scoped** and may benefit later requests. | Owner-decided |
| D2 | Staff trust has **no calendar expiry**. New contradictory evidence, not age alone, triggers review. | Owner-decided |
| D3 | An unresolved address or identity contradiction cannot silently advance to Invite. | Owner-decided |
| D4 | The Find card is the primary verification surface because it already carries the papers, website, affiliation, and identity evidence. | Owner-decided |
| D5 | A linked paper is valid independent evidence when staff open it and find the corresponding author's address. | Owner-decided |
| D6 | **No dead ends:** every warning/block names the problem and provides a primary remedy; a state that staff cannot safely repair themselves provides retry plus a one-click durable repair request. | Owner-decided |
| D7 | Invitation sending never creates or links a CRM Contact; identity-bearing acceptance remains the Contact-promotion event. | Implemented current contract |

## Approved implementation decisions

| # | Recommendation | Why it is the smallest safe choice |
|---|---|---|
| P1 | Store the current exact-address trust/conflict bundle in one new Dataverse Memo field on the reviewer person. | **Approved and implemented; Wave 17 not yet applied.** |
| P2 | Treat `staff_verified` as `ready` **only** when the current person carries a valid versioned trust bundle for the exact stored email. | **Approved and implemented.** Legacy source-only rows remain `quick_check`. |
| P3 | A detected high-confidence contradiction is persisted automatically against the stable person during search reconciliation. | **Approved and implemented** for exact applicant-linked people and ordinary candidates resolved by a trusted ORCID; provisional/name-only matches never write. Failure remains visible/retryable with a repair action. |
| P4 | A pending contradiction blocks all new outbound reviewer email using that exact address, not only the initial invitation. | **Approved and implemented** in render and send for invitation, materials, follow-up, and thank-you. |

If P1 or P3 is rejected, this plan must be redesigned before the
`staff_verified` tier changes. Postgres roster state alone is request-scoped,
evictable, and insufficient for a person-scoped send gate.

## Invariants

| Invariant | Likely surfaces | Verification required |
|---|---|---|
| Verification binds one normalized address to one stable person; it is not inferred from whether the text changed. | modal, roster receipt, address-trust service | changed-but-verified and unchanged-but-unverified complement tests |
| A newly typed address remains `manual` unless staff explicitly verify that exact address against evidence. | editor, both promotion paths | type-only ⇒ quick/block; type+attest ⇒ valid trust bundle |
| A linked corresponding-author paper can support an explicit address attestation. | paper disclosure, modal | evidence URL/type survives server re-read and durable write |
| No client-supplied person ID, trust label, resolution, or “unchanged” flag grants authority. | action route, promotion services | tampered IDs/labels/values rejected before writes |
| Ordinary and applicant-recommended candidates reach the same server trust contract despite using different promotion endpoints. | both services, shared helper | parity tests for every decision code |
| A legacy `staff_verified` row without a valid exact-address bundle remains `quick_check`. | `emailConfidence`, render, send | legacy complement test |
| A pending conflict blocks promotion and outbound email server-side. | both promotion services, render/send | stale UI and direct-route bypass tests |
| A resolved conflict stays resolved only for the exact `(person, stored email, found email, reason)` tuple; new evidence reopens review. | trust parser/writer | replay and changed-tuple tests |
| Every visible warning/block has at least one rendered action whose server endpoint can complete or advance the remedy. | decision DTO, card/modal | total reason/action table test; unknown-code fallback test |
| A system or permission failure leaves the candidate retryable and never masquerades as a domain conflict. | routes/services/client | retry state, generation guard, and partial-success tests |
| Address adjudication never creates or links a CRM Contact. | address-trust service | contact adapter not called in positive and negative tests |

## Terms and state separation

Three decisions must remain separate:

1. **Person confirmation** — staff judged that the displayed papers and identity
   evidence belong to the intended scientist.
2. **Address attestation** — staff explicitly judged that one exact normalized
   address belongs to that person, using a paper, institutional page, direct
   correspondence, or other named evidence.
3. **CRM Contact linkage** — Dataverse records consistently identify a Contact
   for that person. Address attestation may allow reviewer promotion while the
   Contact remains unlinked for repair; it must never silently decide the Contact
   relationship.

Editing is not attestation. String equality is not attestation. A user may verify
an unchanged address, or may type a different address found in a linked paper and
verify that new value. The explicit evidence-backed action is the distinction.

## Current runtime facts that constrain the design

### The two promotion paths are real and must remain explicit

`ReviewerSearchSection.saveSelected` partitions applicant-recommended candidates
from other candidates. Ordinary candidates call `save-candidates`; applicant
candidates call `promote-applicant-reviewer`. The applicant service starts from
an existing suggestion and exact person ID. The ordinary service generally
creates/reuses a person by the incoming email unless it has a validated seed
anchor.

Therefore, a helper that runs only inside `save-candidates` is incomplete, and
the existing `researcher.sameStoredEmail` comparison is not a general stable-
person contradiction detector. The helper introduced by this plan must receive a
server-resolved person context; it must not choose the person by the very changed
email it is trying to compare.

### The roster is pending workflow state, not the trust ledger

`reviewer_find_roster` is per request and caps active/saved rows at 300. It may
hold an authenticated, request-bound **pending attestation receipt** before a
candidate has a canonical person or selected suggestion. It cannot be the
person-scoped authority after promotion.

### The existing source field is insufficient by itself

`wmkf_emailsource` records one label and currently drives `emailConfidence`.
It does not record the attested value, actor, evidence, conflict tuple, or
resolution. `staff_verified` cannot safely become `ready` merely by moving it
between two JavaScript sets.

## Stable-person resolution contract

Before comparing, attesting, or resolving an address, the server produces one of
these outcomes:

| Outcome | Meaning | Allowed next step |
|---|---|---|
| `existing_stable_person` | Exactly one active reviewer person is anchored by the applicant suggestion, validated seed, trusted ORCID, or consistent exact-email lookup. | Compare/read/write trust state on that exact person. |
| `new_person` | No existing reviewer/contact owns a trusted anchor and the candidate identity is otherwise resolved. | Hold the attestation in the roster; create the person during ordinary promotion, then commit trust. |
| `identity_choice_required` | More than one person/contact is plausible, keys split, or the name is inconsistent. | Show choices/actions; do not create, update, or promote until staff decide. |
| `identity_unavailable` | The authoritative lookup failed. | Retry; no irreversible write. |

The resolver is server-only. The browser may carry an opaque receipt or conflict
token, but promotion re-runs or re-reads the authoritative resolution. The
ordinary path may reuse `lookupReviewerIdentity.match.reviewerId` only after its
match key, name consistency, active state, and competing email/ORCID results pass
the shared policy. An email match to one person and ORCID match to another is
`identity_choice_required`, never “prefer one.”

## Durable model

### Recommended schema

Add one nullable Memo field to `wmkf_potentialreviewers`, logical name
`wmkf_addresstruststatejson`, in the Wave 17 extension manifest. Null means
legacy/unbound and grants no new authority.

The bounded server-owned payload is current state, not an event log:

```json
{
  "version": 1,
  "email": "reviewer@example.edu",
  "status": "staff_verified",
  "attestation": {
    "actorProfileId": "...",
    "actorSystemUserId": "...",
    "requestId": "...",
    "candidateKey": "...",
    "evidenceType": "publication_corresponding_author",
    "evidenceUrl": "https://...",
    "note": null,
    "attestedAt": "2026-07-31T...Z"
  },
  "conflict": null,
  "resolution": null
}
```

When contradictory evidence arrives, the same bundle becomes
`status: "conflict_pending"` and records a bounded conflict:

```json
{
  "reason": "email_mismatch",
  "storedEmail": "old@example.edu",
  "foundEmail": "new@example.edu",
  "source": "scholarly_single",
  "requestId": "...",
  "candidateKey": "...",
  "detectedAt": "..."
}
```

A resolution records the exact tuple, decision, actor, evidence, and timestamp.
If the person email no longer equals the bundle's normalized `email`, or the
bundle is malformed/unknown-version, it grants no ready status. A new conflict
tuple replaces the prior resolved tuple and reopens review.

Dataverse native audit remains useful, but the explicit actor IDs are required
because some writes may use the service-principal fallback. The payload stores
no direct-correspondence body and no raw provider response. `evidenceUrl` is
required for publication/institution-page evidence; a short note is required for
`other` evidence.

### Why not a new child entity in v1

The runtime needs the current exact-address decision on every promotion/render/
send, and those paths already read the person. A single versioned bundle is the
smallest additive surface. If compliance later requires immutable event history,
querying attestations across people, or multiple simultaneous addresses, replace
the bundle with a child entity under a separate reviewed migration. Do not build
that flexibility speculatively.

## Pending Find-card attestation

The Find action records a server-owned pending receipt in the request roster:

- exact canonical candidate key and request;
- exact normalized displayed email;
- person-confirmation result;
- evidence type, bounded URL/note;
- authenticated actor IDs and timestamp;
- server-issued receipt ID.

The client sends the value it displayed, but the server re-reads the canonical
roster candidate and rejects a mismatch. A pending receipt neither changes
`wmkf_emailsource` nor grants cross-request trust. It becomes authoritative only
when a promotion service binds it to a stable/new person and commits the exact
email and trust bundle together.

This preserves the useful pre-save UI without creating Dataverse people merely
because someone opened or edited a search result.

## No-dead-end decision and remediation contract

### Classification rules

- **Information** is neutral and requires no action. Do not render it with error
  styling.
- **Actionable warning** permits continuation but offers a remedy that improves
  the record.
- **Blocking error** prevents an operation and must include at least one primary
  action that is available on the same card/modal or through a direct deep link.
- **Policy prohibition** (for example confirmed COI or deceased evidence) is not
  described as a fixable system error. It shows the governing evidence, offers
  “Set aside,” and offers “Report incorrect evidence” when the evidence may be
  wrong.
- **System/permission failure** offers Retry. If retry cannot repair it, the UI
  offers a one-click durable repair request with a visible reference and leaves
  the candidate retryable.

“Contact an administrator” as unlinked prose is not a remedy. The application
must create/route the repair request or deep-link to the exact repair surface.
Before rendering a deep-linked repair/merge/reactivation action, the server
checks that the current user may use it. If not, the response substitutes
`create_repair_request`; the UI never displays a button the user cannot execute.

### Server response shape

Every promotion, trust action, render skip, or send skip in this domain returns a
stable code plus server-approved remediation descriptors:

```json
{
  "decision": "blocked",
  "code": "email_mismatch",
  "message": "The stored and newly found addresses differ.",
  "remediation": [
    { "action": "resolve_address_conflict", "label": "Review both addresses" },
    { "action": "set_aside", "label": "Set reviewer aside" }
  ]
}
```

The descriptors control presentation only. Action endpoints reauthorize and
revalidate; a client cannot obtain permission by posting an action label. The UI
has a total mapping for known actions and a safe unknown-code fallback:
**Retry check** plus **Create repair request**. An unknown code never disappears,
falls through to “ready,” or renders as a dead badge.

The mutation seam is one authenticated route,
`POST /api/workbench/reviewer-address-trust`, dispatching an allowlisted action:
`get_address_conflict`, `verify_person_and_address`, `retry_check`, or
`create_repair_request`.
`get_address_conflict` resolves the person again and returns only the fresh
stored/found pair, reason, and detection timestamp. The subsequent verification
action repeats that person/tuple/ETag validation; the browser never carries the
person trust bundle or authority-bearing conflict state.
Stored-versus-found resolution uses the verification action with the selected
exact address; promotion records `keep_stored` or `use_found` in the durable
bundle. “Different person” routes to existing identity/merge repair rather than
granting this route authority to create or merge people.
`open_merge` deep-links to the existing candidate-merge flow and
`set_aside` uses the existing roster exclusion action. The shared route returns
the exact candidate key and resulting decision after every action; it never
accepts a client-authored remediation array.

`create_repair_request` uses `NotificationService.notify` to create a durable
`system_alerts` row with a tuple-derived `autoResolveKey`, and returns the alert
ID as the visible repair reference. Add a `system-alerts` anchor to the existing
System Alerts section of `/admin`; a superuser receives a direct link to that
section. Other staff still see the reference and can
continue with any safe unlinked-reviewer remedy the server offered. Creating an
alert alone never changes a blocked decision to ready.

### Total reason-to-remedy matrix

| Code/state | Class / blocks? | What staff see | Primary remedy | Safe completion |
|---|---|---|---|---|
| `missing_email` | Blocking | No usable address is stored/found. | **Add and verify an address**; paper and institution links remain visible. | Pending receipt validates exact address; promotion commits it. |
| `research_only` | Blocking for Find→Invite target | Address came only from search evidence. | **Verify this address** against a linked paper/page, or **Use a different address**. | Explicit attestation or replacement; no checkbox-only bypass. |
| `quick_check` | Blocking for new Find promotion; legacy Invite rows retain current send acknowledgment | Address has limited evidence. | **Verify now** or **Replace address**. | Valid trust bundle makes exact address ready. |
| `identity_confirmation_required` | Blocking | System cannot establish that the evidence belongs to the intended person. | **Review papers and confirm person + address**, **Choose a different person**, or **Set aside**. | Server-bound identity/address receipt. |
| `provisional_orcid_match` | Blocking until person/address judgment | ORCID match is not a trusted anchor. | **Confirm from papers**, **Reject this match**, or **Choose another record**. | Stable person resolution plus exact-address attestation. |
| `ambiguous_or_name_mismatch` | Blocking | Multiple records or a name disagreement exist. | **Choose the correct person**, **Create as a different person**, or **Set aside**. | Server re-runs identity resolution and records the chosen branch. |
| `email_mismatch` | Blocking | Stored and newly found addresses differ. | **Use found address**, **Keep stored address**, or **These are different people**. | One ETag-guarded exact-tuple resolution; address/source/trust update is atomic when changed. |
| `orcid_email_split` | Blocking until exact person/address attestation; CRM repair itself need not block afterward | ORCID and email resolve to different records. | **Review records and choose**, or **Verify this person/address and continue unlinked**; automatically **Create repair request**. | Candidate may proceed only with explicit attestation; Contact stays unlinked pending repair. |
| `contact_linked_elsewhere` | Same policy as split | The matching Contact is already linked to another reviewer. | **Open merge/repair**, or **Verify and continue unlinked**; automatically **Create repair request**. | No Contact relink by this workflow. |
| `email_conflict` / duplicate owner | Blocking | Another active reviewer owns the exact address. | **Create repair request** from the card; saved-candidate surfaces that already have a safe merge plan may still use that existing flow. | An administrator repairs/merges the records; promotion retries afterward. The Find card never presents a fake merge action. |
| `person_inactive` | Blocking | The resolved reviewer record is inactive. | **Create repair request** from the card. | An administrator reactivates or repairs the stable person; the user reloads and retries. Identity confirmation cannot bypass inactivity. |
| `conflict_record_unavailable` | Blocking for this request | Contradiction was detected but could not be recorded durably. | **Retry recording/check**; if repeated, **Create repair request**. | Durable person state must succeed before promotion. |
| `identity_unavailable` / service timeout | Blocking, retryable | Authoritative identity check is temporarily unavailable. | **Retry check**; repeated failures expose **Create repair request**. | Fresh successful server check; no cached fail-open. |
| unknown/unrecognized code | Blocking by default | A safe generic explanation plus reference. | **Retry check** and **Create repair request**. | Only a subsequently recognized server decision can proceed. |
| confirmed institution COI | Policy prohibition | Why the reviewer is ineligible and the matching institution evidence. | **Correct affiliation and recheck** when evidence is wrong, **Report incorrect evidence**, or **Set aside**. | Policy re-evaluation, never a client override. |
| direct deceased evidence | Policy prohibition | Official source and evidence sentence. | **View source**, **Report incorrect evidence**, or **Set aside**. | Server evidence review; no ordinary promotion bypass. |

The implementation is incomplete if any emitted code is absent from this table,
if a rendered action has no working server path, or if a server block returns
only prose.

## Adjudication actions

### Verify person and exact address

The modal states: “I verified that this is the correct person and that
`address@example.edu` is their address.” Staff select an evidence type. For a
paper, the card's complete paper list remains visible and each paper link can be
used as the evidence URL.

This action may verify an unchanged or edited value. It creates a pending receipt
and does not itself link a Contact.

### Use the newly found address

Server prerequisites:

1. the server resolves the request-scoped roster candidate to the exact person;
2. a fresh read still contains the displayed stored/found tuple and person ETag;
3. the found address has an explicit staff attestation;
4. no different active person owns the found address;
5. identity/COI gates still pass.

One ETag-guarded update writes the new address, `staff_verified`, and the new
trust bundle. A duplicate owner returns `email_conflict` with the merge remedy;
it never partially relabels the old address.

### Keep the stored address

Staff explicitly verify the stored address and reject the specific found value.
The resolution is keyed to that exact conflict tuple. The same evidence does not
prompt again; a different found address or reason does.

### These are different people

The server preserves the old person untouched. It creates or selects a distinct
person only after the new candidate passes identity and duplicate-owner checks.
The roster candidate is rebound to the new server-issued identity context. This
action cannot use a client-supplied replacement person ID without server
validation.

### Continue unlinked and create repair request

For Contact-link conflicts, staff may finish the reviewer workflow only after
explicitly verifying the person and address. The system records a durable repair
request containing bounded person/contact identifiers and the conflict reason.
The reviewer person remains unlinked; acceptance promotion later retains its
independent fail-closed Contact identity checks.

## Whole-flow contract

### 1. Search and reconciliation

1. Enrichment derives candidate identity/contact evidence.
2. The server resolves stable-person context independently of the candidate's
   changed email.
3. When a stable person and a new contradictory exact address are both present,
   the server ETag-writes `conflict_pending` to the person trust bundle.
4. The browser receives bounded display evidence, a stable reason code, and
   remediation descriptors. Raw Dataverse IDs remain server-side.
5. A failed conflict write returns `conflict_record_unavailable`; the card stays
   retryable and promotion is blocked.

### 2. Find-card action

1. Staff opens the evidence disclosure and selects a remedy.
2. The action route uses `requireAppAccess(..., 'reviewers')`, validates request/
   candidate identity, enters trusted DAL context, and re-reads the roster/person.
3. Safe pre-save attestations are stored as server-owned roster receipts.
4. Existing-person conflict resolutions are ETag-conditional Dataverse writes.
5. The response returns the exact candidate key, resulting decision, and current
   actions so the client updates only that card.

### 3A. Ordinary promotion

1. `save-candidates` re-reads the roster receipt and re-resolves stable/new person
   context.
2. It does not use the incoming changed email alone to select an existing person.
3. It validates address ownership, conflict state, identity, eligibility, and
   institution COI before writes.
4. It creates/reuses the person, then atomically pairs the exact address with its
   source/trust bundle using ETag when updating an existing row.
5. Only after trust succeeds does it create/select the request suggestion and
   finalize the exact roster key.

### 3B. Applicant-recommended promotion

1. `promote-applicant-reviewer` starts from the exact request suggestion and its
   person ID.
2. It re-reads the same pending receipt and runs the same address-trust helper.
3. A manually corrected address is not automatically `manual` if staff explicitly
   attested it; type-only remains `manual` and cannot satisfy the Find→Invite
   ready requirement.
4. Only after trust succeeds does it set `wmkf_selected=true` and finalize the
   roster.

### 4. Render and send

1. Render reads the person address, source, and trust bundle together.
2. `staff_verified` is `ready` only when the bundle is valid, exact-email bound,
   and not conflicted. Legacy/malformed/mismatched bundles stay `quick_check` or
   blocked, never ready.
3. A pending conflict returns a skip/block code plus a deep-linked remedy; it does
   not render a sendable draft.
4. Send independently re-reads and recomputes the same decision. Client preview,
   acknowledgement IDs, and action labels confer no authority.
5. A successful send never creates or links a Contact.

### 5. Acceptance

This plan does not add Contact promotion doors. Acceptance retains its current
identity-aware promotion. Reviewer-confirmed email writeback remains a separate
future decision; it can later write the same trust bundle under a distinct
`reviewer_confirmed` source without changing this staff-attestation contract.

## Partial success, retries, and stale client state

- Batch promotion retains one result per candidate with `candidateKey`, outcome,
  code, remediation, and which durable steps succeeded. Counts alone are
  insufficient.
- The client removes only exact successful keys. Failed and blocked cards remain
  visible and actionable.
- A trust write that succeeds before suggestion creation fails is an explicit
  partial success: the person-scoped attestation remains valid, the candidate
  remains retryable, and retry treats the identical write as a no-op.
- A selected suggestion whose roster finalization fails remains authoritative in
  Dataverse; the response identifies `rosterFinalized:false`, reloads server
  state, and emits the existing operational alert.
- Unknown-outcome network failures force server reload/reconciliation before
  retry. No retry creates another person merely because the browser missed the
  response.
- Every post-`await` card update uses the current request/proposal generation and
  exact candidate key. A response from an old request cannot open a modal, clear
  a warning, or mark a candidate verified in the new request.
- Repair-request creation returns its durable reference. Repeating the same
  person/reason/tuple is idempotent through an auto-resolve/dedup key.

## Security and disclosure

- All action and promotion routes require authenticated reviewer-app access and
  trusted DAL context.
- The server derives actor identity from the authenticated session.
- Client fields are display assertions only. Person IDs, Contact IDs, trust
  statuses, resolution authority, and ETags are server-derived.
- The browser receives no conflict token or raw trust bundle. The review action
  fetches a bounded fresh pair, and the mutation independently re-resolves the
  request/candidate/person and ETag. Replaying a stale displayed value returns
  409 with **Refresh and review again**.
- The existing bounded evidence DTO remains the default. Stored/found addresses
  may be disclosed to authorized staff only inside the conflict action, from a
  fresh server read; raw lookup details and unrelated record IDs remain hidden.
- Evidence URLs are restricted to HTTP(S), length-bounded, and stored without
  fetched page contents. Notes are bounded and escaped on render.
- Address trust never grants Contact-link authority and never bypasses COI,
  deceased, lifecycle, or duplicate-owner gates.

## Build and rollout order

Each stage preserves current send safety. The ready-tier change is last.

1. **Additive schema and readers, no behavior change.**
   - Wave 17 `wmkf_addresstruststatejson` manifest and production preflight/apply.
   - Parser/validator treats null, malformed, unknown-version, and email mismatch
     as no new authority.
   - Add field to every person select/projection that renders or sends.
   - Update Atlas and schema documentation.
2. **Shared stable-person and remedy contracts, still no tier change.**
   - Server decision/action vocabulary and total mapping.
   - Pending roster receipt and authenticated action route.
   - Shared helper used by ordinary and applicant promotion.
   - Existing `staff_verified` remains `quick_check`.
3. **Actionable UI and repair paths.**
   - Replace dead badges with reason, evidence, and working actions.
   - Preserve complete paper list and name-search Scholar link.
   - Add deep links to merge/repair and durable repair-request feedback.
   - Do not emit a new blocking code before its remedy works end to end.
4. **Durable contradiction and enforcement.**
   - Persist high-confidence conflicts against stable people.
   - Enforce at both promotion services and render/send.
   - Define exact behavior for existing Invite rows; already-sent messages remain
     historical and future sends are gated.
5. **Activate exact-bundle `staff_verified` readiness.**
   - Only new/valid bundle-backed attestations become ready.
   - Legacy source-only rows remain quick-check; no bulk migration.
   - Reconcile all `staff_verified`, `wmkf_emailsource`, and send-tier consumers
     atomically.
6. **Controlled production pilot.**
   - Use a request with ordinary and applicant-recommended candidates.
   - Exercise unchanged verification, changed-paper-address verification,
     ambiguous identity, mismatch resolution, duplicate owner/merge, retryable
     outage, promotion parity, render, and capture-mode send before a real send.
   - Probe Dataverse person state, native audit, explicit actor fields, suggestion
   lifecycle, and absence of Contact promotion.

## Second-review remediation status (2026-07-31)

**[IMPLEMENTED IN SOURCE / THIRD REVIEW PENDING]** The follow-up remediation
closes the second Opus review's H1 and M2–M6 findings plus its active-state and
Invite-remedy low findings. The relevant enforced complements are:

- a provisional/provider-only ORCID cannot resolve a durable person write
  target; an ordinary candidate requires a persist-worthy identity decision
  with an ORCID-specific anchor, a confident name-consistent ORCID lookup, and
  an active person;
- `retry_check` rejects unflagged, saved, excluded, and ineligible roster rows;
- a current roster receipt is replayed as the exact prior adjudication and is
  never reinterpreted as a new contradiction;
- a roster receipt committed before a Dataverse failure returns
  `partialSuccess`, `receiptRecorded`, the exact receipt/candidate, and working
  remediation; the client applies that authoritative partial candidate after
  its request-generation guard;
- non-duplicate ETag 412s return `candidate_stale`, while alternate-key 412s
  remain `email_conflict`;
- inactive people cannot be disclosed through the conflict action or relabeled
  `staff_verified`; and
- the Invite conflict card adjudicates either current address in place for an
  already-promoted suggestion while still offering durable repair;
- ordinary durable person lookup requires a server-bound identity-decision
  receipt whose exact projection still matches the roster row; and
- manual saved-candidate edits cannot invalidate a pending bundle and silently
  downgrade the send block.

Verification after the third-review remediation: focused affected-surface tests
135/135; full suite 550/550 suites and 6,650/6,650 tests; `check:types`; lint with zero errors
and 51 pre-existing warnings; production build; API route matrix + self-test;
Dataverse DAL gate + self-test; doc-currency gate + self-test. This evidence is
local only and does not satisfy the schema-first deployment or signed-in pilot
exit criteria.

## Verification matrix

### Unit and integration tests

- unchanged address + no explicit attestation ⇒ not `staff_verified`;
- unchanged address + explicit attestation ⇒ bundle-backed ready;
- changed address + explicit paper evidence ⇒ bundle-backed ready;
- changed address + typed only ⇒ `manual`, not ready;
- legacy `staff_verified` + null/malformed/mismatched bundle ⇒ quick-check;
- stronger ready source is not downgraded by staff attestation;
- ordinary stable returning person compares against the old person, not a new
  email-keyed row;
- ordinary new person and applicant exact person produce equivalent trust
  decisions;
- each reason code renders at least one working action;
- each action revalidates its prerequisite and fails safely on stale token/ETag;
- unknown reason defaults to retry/repair and blocks;
- conflict-persist failure is visible, retryable, and blocks promotion;
- conflict blocks direct API promotion and send despite stale client state;
- partial batch success leaves failed exact keys selected/retryable;
- address adjudication never calls Contact create/link;
- accepted Contact promotion remains independent and fail-closed.

### Gates and durable reconciliation

- `/contract-reconcile` Mode B for the implementation.
- Dataverse schema preflight/apply verification and Atlas reconciliation.
- API route security matrix and self-test if a route is added.
- `check:doc-symbol-refs`, `check:doc-currency`, `check:fact-consistency`,
  `check:canonical-pointers`, `check:docs-catalog`, and applicable self-tests,
  sequentially.
- Symbol-consumer fan-out over `wmkf_addresstruststatejson`,
  `wmkf_emailsource`, `staff_verified`, every new decision code, and every new
  remediation action. Every select list, reverse map, filter bucket, render
  branch, and default branch must be total.
- Fresh adversarial review after implementation and before tier activation.

## Explicitly out of scope

- Creating/linking a Contact during send or address adjudication.
- Automatically merging reviewer people or Contacts.
- Inferring verification from string equality, a click, or a client boolean.
- Bulk-promoting legacy `staff_verified` rows.
- Calendar expiry, deliverability/bounce scoring, and non-response reliability.
- Reviewer-confirmed address writeback during acceptance; it can reuse this
  contract later under a separate owner-approved plan.
- Revoking already-sent invitation tokens solely because a later conflict was
  discovered.

## Runtime/deployment exit criteria

1. **Complete:** owner approved P1–P4.
2. Every emitted reason code is in the remedy matrix and every action has a
   named server path.
3. The stable-person resolver contract is accepted for ordinary and applicant
   candidates.
4. The exact JSON schema, maximum size, evidence types, and invalid-state
   behavior are fixed before the schema manifest is written.
5. Existing Invite, later outbound-email, and already-sent-token behavior are
   explicitly accepted.
6. A fresh adversarial implementation review returns no unresolved high-severity finding.
