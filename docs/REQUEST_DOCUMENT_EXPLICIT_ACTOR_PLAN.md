---
title: Request Document Explicit Actor Plan
domain: dataverse
kind: plan
status: active
summary: Keep Request Document writes under the service principal while recording authenticated staff actors on the business events that need attribution.
canonical: false
cataloged: 2026-08-31
owner: product-engineering
related:
  - docs/audits/request-document-explicit-actor-adversarial-review-reconciliation-2026-08-31.md
  - docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md
  - docs/REQUEST_DOCUMENT_ATTRIBUTION_ROLE_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - lib/dataverse/adapters/request-document.js
  - lib/services/initial-assessment/artifact-service.js
  - lib/services/initial-assessment/controls-service.js
  - lib/services/pre-site-visit/artifact-service.js
  - lib/services/pre-site-visit/reopen-service.js
  - lib/services/pre-site-visit/distribution-service.js
  - lib/services/pre-site-visit/site-visit-transition-service.js
  - lib/services/final-writeup/transition-service.js
---

# Request Document Explicit Actor Plan

## Decision and status

**[OWNER-APPROVED 2026-08-31; ADVERSARIAL REVIEWED, PLANNING COMPLETE,
NOT IMPLEMENTED.]** Keep
`wmkf_requestdocument` Create/Write/Append privileges off the broad staff role
and do not create a replacement writer role. Runtime writes continue under the
application service principal after the existing impersonated-write 403
fallback. Human attribution is stored in explicit, server-controlled actor/time
fields only for meaningful business events.

This plan authorizes no schema apply, Production write, role change, deployment,
or historical backfill. Implementation remains behind the September 4, 2026
Final Writeup/dashboard deadline unless the owner explicitly reprioritizes it.
The confirmation-only Connor question scheduled for September 7 is not a
blocking dependency unless it identifies a concrete consumer of built-in
`createdby`/`modifiedby`.

The read-only Claude adversarial review returned **APPROVE WITH CONDITIONS**.
Source verification accepted the Site Visit legacy-retry, missing-identity,
Board-snapshot display, immutability, create-bind-evidence, and DateTime
findings. The distribution finding was accepted only as a display-semantic
rule: a second user cannot resume the same operation because the actor is part
of the immutable draft hash and the send path checks exact actor ownership.
The owner approved the missing-identity availability policy described under
Readiness Boundary: preserve each flow's current availability posture while
recording an honest missing-attribution event.

## Why Option B

**[VERIFIED via source and the 2026-08-31 adversarial review.]** Attributed
Request Document creates under `MSCRMCallerID` require a much broader companion
privilege set than Request Document Create/Write/Append. Depending on the flow,
that includes relationship and write authority on the master request table,
Request Document self-relationships, AI Prompt/Run, and User. Granting those
rights would expose organization-wide write authority outside this app.

**[VERIFIED via owner-run 2026-08-27 census.]** All 13 Request Document rows in
the then-current 90-day census were created/modified by the service principal,
even though the authenticated actor was supplied to the write paths. The
fallback preserved availability but did not preserve human attribution.

**[VERIFIED via Wave 22 source and Production proof.]** Final Writeup group
review already demonstrates the preferred pattern: the application derives the
actor from the authenticated session, writes an explicit system-user lookup and
timestamp in the same lifecycle changeset, and treats built-in `modifiedby` as
informational only.

## Contract-reconcile frame

- **Change surface:** one additive Request Document schema wave, one literal-on
  schema-readiness boundary, Request Document projections, and the six current
  create paths plus the Site Visit lifecycle transition.
- **Entry points:** authenticated Workbench routes only. No actor identifier,
  display name, or action time is accepted from request input.
- **Persistence:** action-specific fields on the existing Request Document row.
  Existing Final transition fields and the existing Pre-Site distribution
  ledger remain authoritative for their events.
- **Consumers:** Initial Assessment and Pre-Site status/history, Site Visit
  stage display, Final Writeup status/dashboard, operational readback, Atlas,
  and focused tests.
- **Partial success:** actor fields are written in the same Request Document
  create or lifecycle changeset as the event they describe. A separate generic
  audit write is deliberately avoided because it would introduce a second
  persistence step and ambiguous partial-success states.
- **Prior finding:** guarded-reopen history currently projects `_createdby`
  as the reopen actor. Because the create fell back, that value is the service
  principal, not the authenticated staff member. This is a known attribution
  defect, not evidence that Option B is already complete.

## Event classification

The system should record business actions, not every low-level registry PATCH.
Claim renewal, failure recording, metadata refresh, cleanup bookkeeping,
supersession mechanics, and request-pointer maintenance remain service
operations and do not receive a human actor merely because a person initiated
the larger workflow.

| Business event | Current durable attribution | Option B treatment |
|---|---|---|
| Initial Assessment generation started | Built-in `createdby`; currently service principal | Add row-origin actor/time on the created Request Document |
| Initial Assessment Board snapshot started | Built-in `createdby`; first Production write still deferred | Add row-origin actor/time before its first Production proof |
| Pre-Site generation started | Built-in `createdby`; currently service principal | Add row-origin actor/time on the created Request Document |
| Guarded reopen authorized | Reason/source are durable, but projected actor comes from service-principal `createdby` | Add row-origin actor/time; use it for correction history |
| Frozen distribution prepared | `pre_site_distribution_attempts.acting_user_system_id` plus Dynamics email sender/activity | Keep the existing ledger authoritative; also stamp row-origin actor/time on retained snapshot rows for direct registry interpretation |
| Site Visit handoff completed | Existing milestone version/hash/time; built-in `modifiedby` currently service principal | Add explicit milestone actor lookup paired with existing milestone time |
| Final group review started | Explicit `GroupReviewStartedBy/At` | Keep unchanged; it is already authoritative |
| Final leadership review started | Explicit schema fields exist; runtime not yet built | Use existing `LeadershipReviewStartedBy/At` when that transition is implemented |
| Personal Final review acknowledgement | Separate acknowledgement row with session-derived reviewer | Keep unchanged; do not merge its audience or role into Request Document writing |
| Initial Assessment native version restore | SharePoint owns version history; app-side repeatable human actor history is not modeled | Do not pretend a mutable “last restored by” field is an audit trail. Resolve separately before the first Production restore write if full app-side actor history is required |

## Additive schema: proposed Wave 24

Add these fields to `wmkf_requestdocument`:

| Field | Type | Meaning |
|---|---|---|
| `wmkf_InitiatedBy` | optional N:1 to `systemuser` | Authenticated staff member who caused this Request Document row to be created. Null means unattended, legacy, or not captured; it must never be inferred from `createdby`. |
| `wmkf_InitiatedAt` | DateTime, `UserLocal` behavior | Server UTC time when that row-creating business operation was accepted. Dataverse stores UTC and renders in the viewer's local zone. It is immutable after create. |
| `wmkf_MilestoneCreatedBy` | optional N:1 to `systemuser` | Authenticated staff member who completed the Pre-Site → Site Visit handoff represented by the existing `wmkf_milestone*` fields. |

The existing `wmkf_milestonecreatedat` remains the matching handoff time. The
existing Wave 22 Final fields remain action-specific and are not replaced by a
generic field.

The proposed names intentionally distinguish the actor who first initiated a
row from actors who later complete lifecycle transitions. For example, a
different staff member may recover a stale Final claim and then start group
review; `InitiatedBy` and `GroupReviewStartedBy` can legitimately differ.

### Readiness boundary

Introduce `REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY`, enabled only by the
literal value `on`. While off, the adapter must not select the new fields and
the writers must not include them. Existing writes continue without the new
fields; reads remain schema-compatible. Promotion order is schema preflight →
owner-approved additive apply → exact readback → environment flag → runtime.

**Owner-approved availability posture, 2026-08-31.** Preserve the current
per-flow identity policy rather than silently making every writer more
restrictive:

- Final transition, Final acknowledgement, distribution, and the ordinary
  profile-backed Board-snapshot/reopen routes already require a resolved actor;
  they continue to fail closed with their existing actionable 403 behavior.
- Initial Assessment generation, Pre-Site generation, and Site Visit handoff
  currently permit a missing mapped actor. The recommendation is to preserve
  availability: perform the business action, leave both explicit origin fields
  null, render “Not captured,” and write a bounded durable operational event
  `request_document_actor_not_captured`. Do not manufacture the service
  principal or current viewer as the actor.
- Before any explicit bind, freshly read the proposed `systemuser` and require
  the exact GUID with `isdisabled === false`. A missing/disabled/stale mapping
  follows that flow's policy above rather than sending a lookup bind that can
  fail after side effects begin.

This decision reflects the absence of a known compliance dependency and the
existing availability-first fallback. Universal fail-closed was considered and
not selected; changing to it later would require an actionable 403 plus Admin
“Reconcile identities” recovery and explicit acceptance of the
new-hire/relicensed-user availability edge.

The implemented runtime must add a Production health check named
`request_document_explicit_actor_readiness`: once Wave 24 code is deployed, a
non-`on` Production flag is unhealthy even though writes remain available.
Post-promotion read-only census verifies that new rows either have a complete
actor/time pair or a matching missing-attribution event carrying enough request,
document, generation, and operation identity to reconcile it to the attempted
write. Preview may remain off only when that limitation is named in the
deployment receipt.

Read models must label absent legacy or deliberately uncaptured values as “Not
captured,” not “System,” “Administrator,” or the current viewer.

## Writer changes

1. Add a server-only actor resolver that accepts only the session-derived GUID,
   rereads the exact `systemuser`, and returns an enabled actor or the flow's
   defined missing-actor result. It must not read request bodies, client names,
   or client timestamps.
2. Make `requestDocumentAdapter.create` the single origin-stamping seam. When
   readiness is on and the resolver returned an actor, it adds the lookup and
   server time to the first create payload. The six current callers are:
   - Initial Assessment generation;
   - Initial Assessment Board snapshot;
   - Pre-Site generation;
   - guarded reopen successor creation;
   - frozen DOCX/PDF distribution snapshot creation; and
   - Final Writeup claim creation.
3. Never overwrite the origin fields when reclaiming or recovering an existing
   generation-key row. A later recovery actor remains visible only on a later
   action-specific transition field when one exists. The adapter update seam
   rejects either origin field in a PATCH, and a focused source gate rejects
   those fields in Request Document changeset PATCH bodies.
4. Add `wmkf_MilestoneCreatedBy@odata.bind` to the same ETag-conditional PATCH
   that writes the Site Visit milestone version/hash/time.
5. Replace both misleading `_createdby` consumers with the new explicit origin
   fields: guarded-reopen history and Initial Assessment Board-snapshot
   provenance/rendering. Remove the Board UI's manufactured “Administrator”
   fallback. Built-in actor columns may remain available as diagnostics but
   must not be labeled as the human reopen/snapshot actor.
6. Keep Final group/leadership fields and Final acknowledgement behavior
   unchanged.

The explicit system-user binds will be executed by the service principal after
the existing 403 fallback, so they do not grant the staff member new Dataverse
authority. **[VERIFIED for PATCH / DERIVED for create.]** Wave 22 proves the
application identity can write a system-user lookup bind inside the Final
activation PATCH changeset. It does not prove the same bind on create; Stage 4's
first natural row creation must close that evidence gap.

## Retry, concurrency, and partial-success rules

- The generation-key alternate key remains the row-creation fence. The first
  successful create owns `InitiatedBy/At`; duplicate-key recovery rereads it.
- A lost create response must never cause the retrying user to replace the
  original initiator.
- Site Visit handoff's existing already-Review entry path remains backward
  compatible: a complete legacy version/hash/time milestone returns reused even
  when its actor is null and displays “Not captured.” For a readiness-era
  attempt that entered as Draft, both the catch-path reread and ordinary
  post-write confirmation require a non-null milestone actor in addition to
  matching lifecycle/version/hash/time. Presence—not equality with the current
  caller—is the invariant, because a concurrent identical attempt may have
  committed atomically under a different authenticated actor.
- Actor fields travel inside the same Dataverse create/PATCH/changeset as the
  described event. No fire-and-forget audit write is permitted.
- Technical retries may update `modifiedon`/`modifiedby`; consumers ignore
  those built-in fields for human business attribution.
- Historical rows remain untouched. No actor is inferred from logs, approvals,
  document authors, current assignment, or the person running a later retry.
- `InitiatedBy` on a retained distribution snapshot means “created this
  retained registry row,” never “sent this distribution.” The actor-bound
  Postgres ledger plus Dynamics email activity remain sender authority. A later
  operation may legitimately reuse a snapshot created by someone else; the
  snapshot origin does not change.

## Initial Assessment restore boundary

Restore is repeatable and crosses SharePoint plus Dataverse. A single mutable
`LastRestoredBy` field would erase earlier actors, while a separate event write
could fail before or after Graph changes the document. Therefore this plan does
not add a misleading shortcut.

Before the first Production restore write, choose one of two explicit scopes:

1. accept SharePoint native version history as the restore record and make no
   app-side claim about the human actor; or
2. design an append-only restore-action ledger with operation identity,
   pending/completed/reconciliation states, actor, source/target/result version,
   and lost-response recovery.

That later decision is not needed for the September 4 Final Writeup deliverable
and must not expand Wave 24 by default.

## Delivery sequence

### Stage 0 — plan/reconciliation (this document)

- Record Option B and withdraw the role path.
- Record the owner-approved current-posture missing-identity policy.
- Correct current documentation that treats Request Document `createdby` as a
  reliable human actor.
- Keep the Connor question confirmation-only and non-blocking.

### Stage 1 — schema and focused implementation (after the deadline)

- Add Wave 24 schema-as-code and exact read-only preflight.
- Add the readiness helper, adapter projection, writer fields, and guarded-
  reopen/Site Visit/Initial Assessment read-model changes.
- Add the Production readiness health check and bounded durable
  missing-attribution event before allowing fail-open actor gaps.
- Add a focused writer-inventory/immutability gate: no raw Request Document
  create may bypass the adapter, and no update/changeset PATCH may carry the
  immutable origin fields.
- Update the API security matrix and Atlas with planned—not live—status.
- Do not apply schema or set any environment flag in this stage.

### Stage 2 — adversarial review and local verification

- Run a fresh OAuth-authenticated Claude adversarial review of the schema,
  every writer, duplicate/recovery semantics, projection migration, and
  historical-null handling.
- Reconcile accepted findings before any target apply.
- Run focused tests and the applicable schema/route/doc gates sequentially
  with their self-tests.

### Stage 3 — target promotion

- Preflight the named target and require every Wave 24 artifact absent or exact.
- Obtain separate owner approval for the additive schema apply.
- Apply, rerun exact readback, set the literal-on readiness flag, and deliberately
  promote runtime following the campaign release strategy.
- Do not change any staff role or the Final Writeup Reviewer role.

### Stage 4 — controlled proof

- Use the next naturally needed, separately approved business action; do not
  manufacture a document merely to test attribution.
- Read back the exact row and require explicit actor/time plus the ordinary
  lineage/state invariants.
- For Site Visit handoff, require the actor in the same milestone proof.
- Verify that `createdby`/`modifiedby` may still name the service principal and
  that the UI/report uses only the explicit field for the person.

## Tests that must discriminate

- A create fixture in which built-in `createdby` is the service principal but
  `InitiatedBy` is the staff actor; the projection must show the staff actor.
- A guarded-reopen fixture with a service-principal `createdby`; deleting the
  new explicit field must make actor display “Not captured,” not fall back.
- An Initial Assessment Board-snapshot fixture with service-principal
  `createdby` and no explicit actor; the UI must show “Not captured,” never
  “Administrator.”
- Duplicate-key/lost-response recovery by a different actor; origin fields must
  remain the first actor/time.
- Every reclaim/failure/metadata PATCH across the six writers is captured and
  asserted not to contain either immutable origin field. A source gate fails if
  a seventh create bypasses the adapter or a raw Request Document create is
  introduced.
- A legacy already-Review Site Visit row with version/hash/time and no actor
  remains an idempotent success. A readiness-era response-loss reread with
  matching lifecycle/version/hash/time but no actor is unconfirmed; the same
  row with a non-null different actor is accepted as a concurrent commit.
- Legacy rows with all new fields null; reads remain successful and honest.
- Missing, disabled, and stale mapped actors exercise each flow's chosen policy;
  no client value can fill the field, and an allowed null-actor write emits the
  durable missing-attribution event.
- Readiness off against a schema without Wave 24; no new field is selected or
  written, existing writes remain available, and Production health is red.
- A later distribution operation reuses a snapshot created by another actor;
  the snapshot keeps its origin while the new ledger/email retain sender truth.

## Acceptance criteria

- No Request Document privilege is added to a broad or dedicated staff role.
- Every current row-create path passes through the enforced origin-stamping
  seam. A valid actor produces an immutable actor/time pair; an allowed missing
  actor produces two nulls plus durable operational evidence.
- Guarded-reopen history no longer presents service-principal `createdby` as
  the staff actor.
- Site Visit handoff stores its actor with the existing milestone evidence.
- Final transition and acknowledgement contracts are unchanged.
- Distribution continues to use its existing actor-bound ledger as the send
  authority.
- Historical unknowns remain explicit unknowns; no backfill is invented.
- Exact schema/readiness/runtime status is reconciled across the Atlas, queue,
  session handoff, and API matrix after each promotion stage.
- The owner-approved current-posture availability policy is implemented and
  discriminated from universal fail-closed behavior in focused tests.

## Residual risks

1. Dataverse built-in `createdby`/`modifiedby` and native audit history will
   still name the application for fallback Request Document writes. This is
   intentional unless Connor identifies a concrete built-in-field consumer.
2. The explicit actor proves which authenticated identity initiated the app
   action, not that the person authored every later Word edit. SharePoint
   version history remains authoritative for document editing.
3. A future raw writer could bypass the fields; the adapter-only writer gate
   and immutable-field PATCH gate are required permanent controls.
4. Repeatable cross-system actions such as native version restore require an
   append-only operation ledger if WMKF later needs complete app-side actor
   history.
