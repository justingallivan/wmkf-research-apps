---
title: Request Document Attribution Role Plan — Superseded
domain: dataverse
kind: plan
status: superseded
summary: "Rejected Option A role plan retained for review provenance; the owner selected service-principal writes with explicit actor tracking on 2026-08-31."
canonical: false
cataloged: 2026-08-31
owner: product-engineering
related:
  - docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - lib/dataverse/schema/roles/wave1-staff.json
  - lib/dataverse/schema/roles/wave23-final-writeup-reviewer.json
  - scripts/apply-security-role.js
  - scripts/probe-write-attribution-census.js
---

# Request Document Attribution Role Plan

## Status and authority

**SUPERSEDED 2026-08-31 — DO NOT EXECUTE.** The OAuth-authenticated Claude
adversarial review returned `NEEDS REWORK`: the proposed three-privilege role
could not support the real relationship binds and request-pointer changes, and
the in-flight broad staff-role grant would have invalidated the containment
proof. The owner selected **Option B**: retain service-principal Request
Document writes and design explicit, server-controlled actor tracking.

The earlier Connor brief was created on 2026-08-27 but never sent. It is
withdrawn. No Request Document Create/Write/Append grant is requested for the
staff role, no replacement writer role is authorized, and the existing Final
Writeup Reviewer role remains unchanged.

## Accepted direction

The replacement design will keep Request Document CRUD off staff roles and
persist the authenticated actor and action time explicitly in app-controlled
state. Before implementation, a confirmation-only question asks Connor whether
any compliance, audit, report, view, flow, business rule, or plug-in requires
the built-in Dataverse `createdby`/`modifiedby` values on Request Documents to
name the individual staff member. A "yes" requires the exact consumer and
requirement before architecture is reconsidered; a "no" requires no Connor
action.

The replacement implementation plan is now tracked in
`docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md`. It traces every Request
Document writer, distinguishes business events from registry mechanics,
derives identity only from authenticated server context, and preserves the
existing availability and Final Writeup acknowledgement behavior. It is a
plan, not an authorization to apply schema or deploy runtime changes.

## Historical rejected Option A design

Everything below this heading preserves the rejected role proposal and its
review inputs for provenance only. Its stages, gates, commands, privileges, and
acceptance criteria are not current instructions or authorized work.

## Deadline posture and time-box

This is attribution hardening, not a current availability blocker: the shipped
403 fallback keeps ordinary writes working as the service principal. With the
September 4, 2026 product deadline, do not let this work displace Final Writeup
or dashboard functionality. Time-box review and preflight to one focused work
block and no more than two commits before an owner check-in. If Option A remains
uncertain, the companion matrix expands materially, or a safe pilot cannot be
identified, defer the privilege change and retain current service-principal
attribution rather than forcing a risky rollout before the deadline.

## Contract-reconcile frame

- **Change surface:** a dedicated Dataverse security role, read-only role
  preflight/verifier, reversible user assignment, and a contained attribution
  proof.
- **Entry points:** tracked CLI scripts only during provisioning and proof;
  existing authenticated Workbench routes remain unchanged.
- **Persistence:** a Dataverse role, role privileges, user-role associations,
  and—only during an approved Production rehearsal—one temporary sentinel
  `wmkf_requestdocument` row that must be removed by exact identity.
- **Consumers:** every existing Initial Assessment, Pre-Site Visit,
  distribution, guarded-reopen, Site Visit transition, and Final Writeup
  service that writes `wmkf_requestdocument` with `MSCRMCallerID`.
- **Prior finding:** Request Document writes consistently fell back to the
  service principal because impersonated users lacked required table
  privileges. A 2026-08-31 read-only Production inspection directly confirmed
  the staff role lacks Request Document Create/Read/Write/Append and that only
  2 of the 11 inspected Final Writeup audience users receive those rights from
  other roles. That inspection was ad hoc; Stage 0 must make it reproducible
  before execution.

Partial-batch UI, client stale-state, helper extraction, schema migration, and
new persisted status fan-out are **N/A**: this plan adds no UI, route, table,
column, or enum. Role reconciliation, companion privileges, exact cleanup, and
durable documentation are in scope.

## Verified baseline

1. **[VERIFIED 2026-08-31 via schema-as-code and Production metadata]**
   `wmkf_requestdocument` is organization-owned. Dataverse table privileges
   therefore cover every row in the environment; a dedicated role can narrow
   *who* receives the authority, but not which Request Document rows they can
   create or update.
2. **[VERIFIED via `lib/services/dynamics/write-core.js`]** Dataverse reads are
   intentionally performed as the service principal. Only writes carry
   `MSCRMCallerID`, and an impersonated 403 is retried once without that header
   unless `noFallback:true` is used.
3. **[VERIFIED via `lib/dataverse/schema/roles/wave1-staff.json`]** the existing
   `WMKF Research Review App Suite - Staff` specification has no Request
   Document privileges.
4. **[VERIFIED 2026-08-31 via Production role readback]** the dedicated
   `WMKF Final Writeup Reviewer` role grants Request Document `AppendTo` and
   User `AppendTo`, but no Request Document Create, Read, Write, Append, Delete,
   Assign, or Share. All 11 intended Final Writeup reviewers have its six
   specified privileges; Dataverse also attached nine standard App Opener
   baseline privileges.
5. **[VERIFIED via existing source and Atlas]** Request Document rows carry
   workflow state, stable SharePoint identity, provenance, recovery fencing,
   and proposal-derived Pre-Site content. Granting Write is meaningful business
   authority, not a cosmetic audit setting.
6. **[VERIFIED via `scripts/apply-security-role.js` and
   `lib/dataverse/role-apply.js`]** the current role applier only adds
   privileges. It does not remove unexpected privileges from an existing role,
   and it has no role-unassignment command. Exact verification and a rollback
   mechanism are prerequisites, not follow-up polish.
7. **[VERIFIED via the campaign release strategy]** the Dataverse sandbox did
   not contain the Workbench schema at its 2026-07-26 re-probe. Unless a new
   read-only preflight proves that changed, a conclusive Request Document
   permission proof requires a controlled Production rehearsal against a named
   test request.

## Decision before implementation

There are two legitimate attribution designs:

### Option A — dedicated Dataverse writer role (this plan's proposed path)

Give a narrowly selected staff cohort native Request Document Create, Write,
and Append so `MSCRMCallerID` succeeds and Dataverse's built-in actor columns
name the person.

- **Benefit:** smallest code change; uses the shipped identity architecture;
  built-in actor and audit behavior work normally.
- **Cost:** every assignee receives organization-wide Request Document write
  authority through other Dataverse clients and APIs, not only through this
  application.

### Option B — retain service-principal writes and persist an explicit actor

Keep Request Document CRUD off staff roles and add an app-controlled actor/event
field or child audit record for each write that requires human attribution.

- **Benefit:** staff never receive direct organization-wide Request Document
  write authority.
- **Cost:** additive schema, service changes across multiple writers, new audit
  semantics, and broader testing/documentation. `createdby`/`modifiedby` would
  still show the app.

**Owner gate A:** after adversarial review, explicitly choose Option A or B. Do
not implement the writer role merely because it is simpler. The remaining
stages apply only if Option A is accepted.

## Proposed least-privilege role

Tracked specification:

- **Role name:** `WMKF Request Document Writer`
- **Business unit:** root
- **Solution:** `wmkfResearchReviewAppSuite`
- **Request Document privileges:** Global `Create`, `Write`, and `Append`
- **Deliberately absent from this role:** `Read`, `Delete`, `AppendTo`, `Assign`,
  and `Share`

`Read` is omitted because application reads do not impersonate staff. If a
pilot operation fails and the Dataverse error specifically establishes that
Read is required, stop and return to the owner decision; do not add it
automatically. `AppendTo` already exists for the current Final Writeup reviewer
audience, but the Stage 0 companion matrix must verify the actual writer cohort
rather than assume the two audiences are identical.

The existing staff role and Final Writeup reviewer role must not be modified by
this work.

## Invariants

| Invariant | Enforcement planned | Verification |
|---|---|---|
| No existing broad role is widened | New standalone role specification | Diff plus live role-name/privilege readback |
| The role grants only Request Document Create/Write/Append beyond known platform baselines | Exact privilege verifier; additive apply is never treated as reconciliation | Fail on any unexpected non-baseline privilege |
| Read/Delete/Assign/Share are never silently added | Omitted from spec and asserted by verifier | Role-local privilege readback, not only effective-user rights |
| Final Writeup reviewers are not assumed to be writers | Source-derived writer-audience matrix | Each assignee maps to an authorized write entry point |
| A pilot cannot pass because of an older role | Choose a user whose preflight shows no preexisting Request Document Create/Write/Append | Before-assignment effective privilege snapshot |
| A missing privilege cannot be masked by the service principal | Pilot create and update use `noFallback:true` | 403 is failure; no retry without `MSCRMCallerID` |
| The Production probe cannot touch SharePoint, AI, email, pointers, or real workflow rows | Dataverse-only sentinel with a dedicated producer/key on one approved test request | Expected-write manifest and pre/post readback |
| Cleanup cannot delete by a broad query | Delete only the exact returned sentinel ID; alternate key is recovery identity, never a multi-row delete selector | Exact-ID absence plus generation-key absence |
| Lost create response cannot strand an undiscoverable row | Deterministic unique generation key recorded before POST; recovery query requires zero or one exact match | Alternate-key uniqueness and bounded reread |
| Cleanup failure blocks rollout | Expansion stop rule and durable cleanup receipt | Zero sentinel rows before pilot is considered complete |
| Rollback is available before assignment | Tracked dry-run-by-default exact unassignment command | Assign/unassign sandbox fixture or mocked contract test; Production command printed before use |
| Historical app-attributed rows are not rewritten | No backfill | Census continues to report historical service-principal rows |

## Stage 0 — reproducible read-only preflight

Build and run a read-only preflight before writing the role specification to
Production. It must:

1. Confirm the Production target hostname and `wmkf_requestdocument`
   organization ownership.
2. Resolve the exact Dataverse privilege IDs for Request Document Create,
   Read, Write, Delete, Append, AppendTo, Assign, and Share.
3. Read the current staff and Final Writeup reviewer role privilege sets,
   including Dataverse-added baseline privileges.
4. Enumerate every existing Request Document create/update/batch writer and
   derive its server-side authorization audience from route and service source.
5. Build a per-flow companion-privilege matrix from actual payloads and
   changesets. At minimum consider Request, source Request Document, AI Prompt,
   AI Run, and User relationships plus request-pointer updates; do not treat
   this provisional list as complete.
6. Enumerate proposed assignees from the authorized writer audience—not from
   the 11-person acknowledgement audience—and report their effective privileges
   before assignment.
7. Identify at least one intended writer with no preexisting effective Request
   Document Create/Write/Append to serve as a valid pilot. An administrator or
   either of the two already-privileged users is not a valid least-privilege
   pilot.
8. Verify that the service principal has Request Document Delete and can remove
   a row by exact ID under the target interlock. If exact cleanup authority is
   absent, the sentinel design is prohibited.
9. Emit no tokens, secrets, confidential proposal content, or broad user-role
   dump. Names/emails belong only in local operational output, not the tracked
   plan.

**Stop conditions:** unknown target, divergent table ownership, ambiguous role
name, no valid pilot, an unexplained existing privilege, or an untraceable
writer/relationship.

## Stage 1 — tracked implementation artifacts

Create on a short Tier-2 branch:

1. `lib/dataverse/schema/roles/request-document-writer.json` with the exact
   role contract above.
2. A read-only role/effective-privilege preflight and exact verifier.
3. A dry-run-by-default pilot probe that requires explicit target, pilot
   systemuser, approved test request, and execute confirmation.
4. A dry-run-by-default exact role-unassignment command. It must resolve the
   role and user independently, print the intended association, and delete only
   that `$ref` after explicit Production execution approval.
5. Focused tests for argument validation, target classification, privilege
   allowlists, `noFallback:true`, deterministic sentinel identity, exact-ID
   cleanup, lost-response recovery, zero/multiple alternate-key matches, and
   unassignment target construction.
6. Accepted documentation updates only after the adversarial findings are
   reconciled. Until then, this document remains draft and does not supersede
   `DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`.

Do not change runtime Workbench routes or disable the existing 403 fallback in
this slice.

## Stage 2 — review and non-writing validation

1. Run the fresh Claude adversarial review supplied with this plan.
2. Reconcile every accepted finding into the plan before implementation.
3. Run focused tests and the relevant gate plus its self-test sequentially.
4. Run the Production role applier in dry-run mode with no assignees.
5. Run the read-only preflight/verifier and retain a redacted local receipt.
6. Record the exact branch/commit, Production target classification,
   last-known-good deployment, expected writes, cleanup owner, and rollback
   command.

**Owner gate B:** separately approve creating the inert Production role. A dry
run or approval of this plan is not execution approval.

## Stage 3 — create an inert Production role

1. Create the role and apply only Request Document Create/Write/Append.
2. Add it to the named solution.
3. Assign it to nobody.
4. Read back the role and compare its complete privilege set with the three
   specified privileges plus an explicit allowlist of platform-added App
   Opener baselines.
5. If any other non-baseline privilege exists, stop. Because the current role
   applier only adds, rerunning it cannot remove an accidental privilege.

**Owner gate C:** approve assignment to the one named pilot only.

## Stage 4 — pilot assignment and contained no-fallback proof

### Assignment

1. Capture the pilot's effective privilege snapshot immediately before
   assignment.
2. Assign only the dedicated role.
3. Wait for effective privilege propagation using bounded read-only polling;
   timeout is a stop, not permission to continue on assumed eventual state.
4. Read back the association and effective privilege delta.
5. Prove rollback before the data test: unassign the role through the exact
   rollback command, verify the association and effective delta are absent,
   then reassign and re-verify. Every assignment/unassignment remains separately
   owner-approved Production state change.
6. If the pilot gained anything beyond the intended role plus known platform
   behavior, unassign and stop.

### Sentinel proof

The probe must use a separately approved Production test request. Before
implementation, verify that the selected artifact type and exact
`permission-probe` producer cannot be consumed as a current artifact or shown
as legitimate workflow output. If that isolation cannot be proven from every
consumer, do not use a synthetic row; wait for an approved real workflow.

For an approved sentinel:

1. Record the pre-test Request Document count for the test request and all
   current request pointers.
2. Generate a unique deterministic key and exact expected-write manifest.
3. Create one minimally populated, deliberately non-current Failed/Draft
   Request Document bound only to the approved test request, using the pilot's
   `actingUserSystemId` and `noFallback:true`.
4. Read it back as the service principal and require `createdby` to equal the
   pilot.
5. Update one probe-owned, non-authoritative diagnostic field using the row's
   ETag, the same pilot, and `noFallback:true`.
6. Read it back and require `modifiedby` to equal the pilot.
7. Delete only the exact returned row ID as the service principal under the
   named Production-rehearsal context.
8. Require absence by both exact ID and exact generation key, restore the
   original count, and prove every request pointer is unchanged.
9. If create response is lost, resolve only by the pre-recorded alternate key;
   zero rows means no cleanup, one row means exact cleanup, and more than one
   is a hard stop.

The probe performs no SharePoint, Graph, AI, email, Blob, Postgres, pointer,
status-transition, or user-facing action. A cleanup failure blocks all further
assignment and is reported with the exact retained ID; it is never hidden by a
successful attribution readback.

## Stage 5 — one natural application-flow proof

The sentinel proves the table privilege intersection, not every companion
privilege or full application changeset. Before cohort expansion:

1. Choose one naturally needed, owner-approved Request Document operation for
   an eligible pilot writer. Do not generate a new business artifact solely to
   satisfy this test.
2. Record the exact expected Dataverse and external side effects for that
   operation.
3. Execute through the normal authenticated Workbench UI/route.
4. Read back the exact created/modified Request Document row and require the
   pilot actor. Inspect runtime logs for impersonation-rejection fallback.
5. Re-run `scripts/probe-write-attribution-census.js`. Historical
   service-principal rows remain expected; the new durable operation must be
   staff-attributed.
6. Reconcile all other durable writes and external side effects from the
   operation. A correctly attributed Request Document row is not a pass if a
   companion write fell back, duplicated, or failed.

If the flow falls back because of a missing companion privilege, stop and
review that exact privilege and its direct-access consequences. Do not widen
the role or another role automatically.

## Stage 6 — cohort expansion

Only after Stages 0–5 pass:

1. Freeze the source-derived intended writer list and obtain owner approval for
   those exact users.
2. Assign in a small first batch, verify exact associations/effective deltas,
   then assign the remainder.
3. Do not assign the role merely because someone is a Final Writeup reviewer,
   has general Workbench access, or appears in the earlier 11-person matrix.
4. Observe at least one additional natural write from a different assignee and
   verify actor attribution plus absence of fallback warnings.
5. Update the identity plan, Atlas/agent-wiki routing, and session handoff only
   with the actually proved scope and cohort. Run the required documentation
   reconciliation and drift gates at that time.

## Rollback

Rollback removes the dedicated role association from every assigned user using
the prebuilt exact unassignment path. It does not delete the role, remove its
solution component, modify the existing staff/reviewer roles, rewrite historic
records, or claim to reverse legitimate business writes.

After unassignment:

- normal application availability remains protected by the existing 403
  service-principal fallback;
- Request Document attribution may return to the app user;
- verify every association is absent and run one read-only effective-privilege
  check;
- preserve the inert tracked role for diagnosis unless the owner separately
  authorizes deletion.

## Acceptance criteria

The plan is complete only when:

- Claude's review findings are accepted/refuted with evidence and reconciled;
- Option A is explicitly chosen;
- the role-local privilege set is exactly the specified three plus named
  platform baselines;
- the valid pilot lacked preexisting Request Document Create/Write/Append;
- no-fallback sentinel Create and Write both record the pilot;
- sentinel cleanup and all postconditions pass;
- one natural application operation records the pilot without hidden companion
  fallback or unintended side effects;
- the final assignee list is source-derived and explicitly approved;
- exact unassignment has been proved and remains available;
- durable documentation reports only the scope actually demonstrated.

## Residual risks after a successful rollout

1. Every assignee can exercise organization-wide Request Document Create,
   Write, and Append outside this application if another Dataverse client or API
   is available to them.
2. Role combinations can grant more effective authority than this role alone;
   verification must distinguish role-local and cumulative rights.
3. A future new Request Document relationship or writer may require another
   companion privilege or create a new misuse path.
4. The fallback remains available, so a later role regression can silently
   preserve availability while degrading attribution unless warning telemetry
   and periodic census checks are maintained.
5. Built-in actor fields identify the Dataverse impersonated user, not proof
   that the person personally intended every downstream action; application
   authentication and audit controls remain necessary.
