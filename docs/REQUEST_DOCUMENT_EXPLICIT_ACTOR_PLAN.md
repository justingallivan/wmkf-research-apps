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

**[OWNER-SELECTED 2026-08-31; PLANNING COMPLETE, NOT IMPLEMENTED.]** Keep
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
| `wmkf_InitiatedAt` | DateTime | Server UTC time when that row-creating business operation was accepted. It is immutable after create. |
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
the writers must not include them. Promotion order is schema preflight →
owner-approved additive apply → exact readback → environment flag → runtime.

After Production promotion, authenticated business actions in scope require a
valid session-derived Dynamics system-user ID. The runtime must not substitute
the service principal into the explicit lookup or manufacture a display name.
Read models must label absent legacy values as “Not captured,” not “System” and
not the current viewer.

## Writer changes

1. Add a small server-only payload helper that accepts a validated
   `actingUserSystemId` and server time and returns the two row-origin fields.
   It must not read request bodies or client timestamps.
2. Apply that payload at the first create attempt in:
   - Initial Assessment generation;
   - Initial Assessment Board snapshot;
   - Pre-Site generation;
   - guarded reopen successor creation;
   - frozen DOCX/PDF distribution snapshot creation; and
   - Final Writeup claim creation.
3. Never overwrite the origin fields when reclaiming or recovering an existing
   generation-key row. A later recovery actor remains visible only on a later
   action-specific transition field when one exists.
4. Add `wmkf_MilestoneCreatedBy@odata.bind` to the same ETag-conditional PATCH
   that writes the Site Visit milestone version/hash/time.
5. Replace guarded-reopen projection of `_createdby`/`createdon` with the new
   explicit origin fields. Built-in actor columns may remain available as
   diagnostics but must not be labeled as the human reopen actor.
6. Keep Final group/leadership fields and Final acknowledgement behavior
   unchanged.

The explicit system-user binds will be executed by the service principal after
the existing 403 fallback, so they do not grant the staff member new Dataverse
authority. Wave 22's proved group-review bind establishes that the application
identity can write this relationship shape.

## Retry, concurrency, and partial-success rules

- The generation-key alternate key remains the row-creation fence. The first
  successful create owns `InitiatedBy/At`; duplicate-key recovery rereads it.
- A lost create response must never cause the retrying user to replace the
  original initiator.
- Site Visit handoff success requires lifecycle, milestone version/hash/time,
  and milestone actor to match on post-write reread. A matching lifecycle
  without the explicit actor is incomplete, not a reconciled success.
- Actor fields travel inside the same Dataverse create/PATCH/changeset as the
  described event. No fire-and-forget audit write is permitted.
- Technical retries may update `modifiedon`/`modifiedby`; consumers ignore
  those built-in fields for human business attribution.
- Historical rows remain untouched. No actor is inferred from logs, approvals,
  document authors, current assignment, or the person running a later retry.

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
- Correct current documentation that treats Request Document `createdby` as a
  reliable human actor.
- Keep the Connor question confirmation-only and non-blocking.

### Stage 1 — schema and focused implementation (after the deadline)

- Add Wave 24 schema-as-code and exact read-only preflight.
- Add the readiness helper, adapter projection, writer fields, and guarded-
  reopen/Site Visit read-model changes.
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
- Duplicate-key/lost-response recovery by a different actor; origin fields must
  remain the first actor/time.
- Site Visit response-loss reconciliation with lifecycle/time present but
  milestone actor absent; it must not report success.
- Legacy rows with all new fields null; reads remain successful and honest.
- Unauthenticated or unmapped write actor; no client value can fill the field.
- Readiness off against a schema without Wave 24; no new field is selected or
  written.

## Acceptance criteria

- No Request Document privilege is added to a broad or dedicated staff role.
- Every current row-create path stamps immutable, session-derived origin actor
  and server time when the feature is ready.
- Guarded-reopen history no longer presents service-principal `createdby` as
  the staff actor.
- Site Visit handoff stores its actor with the existing milestone evidence.
- Final transition and acknowledgement contracts are unchanged.
- Distribution continues to use its existing actor-bound ledger as the send
  authority.
- Historical unknowns remain explicit unknowns; no backfill is invented.
- Exact schema/readiness/runtime status is reconciled across the Atlas, queue,
  session handoff, and API matrix after each promotion stage.

## Residual risks

1. Dataverse built-in `createdby`/`modifiedby` and native audit history will
   still name the application for fallback Request Document writes. This is
   intentional unless Connor identifies a concrete built-in-field consumer.
2. The explicit actor proves which authenticated identity initiated the app
   action, not that the person authored every later Word edit. SharePoint
   version history remains authoritative for document editing.
3. A future Request Document producer can omit the fields unless a writer-
   inventory gate or focused source test is maintained.
4. Repeatable cross-system actions such as native version restore require an
   append-only operation ledger if WMKF later needs complete app-side actor
   history.
