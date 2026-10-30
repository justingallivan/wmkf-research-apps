---
title: Coordinated Pre-Site Prompt and Reader Transition
domain: ai-platform
kind: runbook
status: proposed
summary: Reviewed offline preparation and staged operational sequence for replacing the exact Pre-Site prompt schema without mixed-reader generation.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_TRANSACTION_MILESTONE_2026-10-30.md
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Pre-Site prompt/reader transition

[PREPARED LOCALLY; NOT EXECUTED] This is a release procedure, not approval to
write or deploy. No current live prompt content, deployment configuration,
active run or queue was probed for this milestone. Connor owns the Dataverse
operation; Justin approves the rehearsal/release and resumption. Do not merge
PR553 to auto-deploying main until the gates below are satisfied.

## Exact change and offline artifact

The reviewed old native schema repeats each local proposal-core string bound as
native maxLength. The proposed native schema omits those unsupported provider
constraints; the local validation schema, 30,000-character sink limit, variable
boundaries, retention, templates and other definition/catalog fields remain.
The old and new exact readers cannot safely be mixed during generation.

Export one complete current snapshot in the wire v1 shape, using a future
trusted read tool bound to the explicitly verified target. Record its actual
row GUID, published version, ETag, status/current, head and complete history
SEPARATELY as release evidence. The preparation CLI takes only the snapshot;
it neither authenticates the export nor binds a live row or creates a draft.
Unknown current contents are not inferred from a source seed.

```
node scripts/prepare-pre-site-prompt-transition.cjs --input /private/tmp/pre-site-current-snapshot.json --output /private/tmp/pre-site-transition-plan.json
```

[VERIFIED via source/tests] This command loads no env or service, makes no
network request and writes a private 0600 create-only local artifact. Its console
output contains only hashes/action/deploymentAuthorized:false. It recognizes
only the exact old maxLength-only delta or the already-compatible schema.
Unknown schema drift, bad templates/variables or an unreviewed/null model stop
preparation. It does not pick a model or silently repair an old definition.
A compatible definition produces a verify-only result preserving all memo bytes;
that is not a reason to publish another version. The full local artifact contains
prompt content: keep it in the restricted review location, not general logs.

## Pause control and staging

[LOCAL CODE; NOT DEPLOYED] `PRE_SITE_PROMPT_TRANSITION_PAUSE` is a server-only,
non-secret operational setting. Unset, empty or literal `off` preserves ordinary
operation; literal `on` or any other nonempty value blocks with 503
`pre_site_prompt_transition_paused`. Keep explicit `on` throughout the transition
and use explicit `off` only after approved verification. No request parameter,
profile, test flag or alternate source can bypass it.

Canonical equivalence only identifies a candidate: the final definition check
also enforces the reader's exact parsed memo ordering. Reordered compatible-looking
memos are rejected, never greenlit as verify-only.

The guard is at both `generatePreSiteVisitArtifact` entry and shared
`executePrompt` dispatch for the exact Pre-Site key. The artifact guard blocks before artifact input reads, registry claims and model
calls. The shared Executor guard blocks direct callers before dispatch, including
ASCII case/whitespace aliases, and rechecks the resolved row. The scheduled
worker can already have read status and claimed a Postgres queue receipt before
calling the artifact facade; those earlier worker effects are not prevented.
The Factory can likewise journal its own step before the facade refuses it.
Other prompts and read-only artifact/status views remain available. Existing
in-flight work is NOT cancelled or locked by this flag. Older deployments
without the guard ignore it; changing an environment record alone does not
pause those processes.

Prepare the pause guard as a SEPARATE backportable commit containing only its
module, the two entry-point checks and its test. Validate that patch against the
actual known-good production baseline before release. Do not deploy the whole
PR553 branch merely to obtain the guard: that would also replace the exact
schema reader too early. Pause-only commit: `4fcc0ad86` (four files, no schema-reader change).
This milestone prepares that separate commit; the
backport and safety deployment still require their own review/authorization.

## Operator sequence (all live steps remain gated)

1. **Rehearse first.** Prove the publication SDK port, IsInTransaction, Active
   head/receipt unique keys, current policy/raw-write guards, exact row-version
   rollback, actor attribution/no fallback, role mapping, receipt recovery and
   same-target budget writer in sandbox. Verify one compatible current Initial
   Assessment row before Factory tests. Match .NET golden vectors. Local fake
   transactions do not satisfy any of these gates.
2. **Capture the release baseline.** Record source/deployment IDs, target org/host,
   actual current Pre-Site row identity/ETag/schema snapshot hash, complete
   version inventory/head high-water and budget/control state. Run offline
   preparation on that exact export; review the proposed snapshot and immutable
   request UUID. A different current row/ETag/catalog requires fresh explicit
   review, never a force flag or an automatic refreshed precondition.
3. **Establish the safety pause using the old reader.** FIRST disable scheduled
   preparation (`STAFF_DELIBERATIONS_AUTO_PREPARE=off`) and stop its cron
   invocation; apply that configuration on the known-good old-reader baseline.
   Stop operator scripts, Factory runs and external generation/publication
   participants. THEN deploy the independently reviewed pause-only patch on the
   known-good baseline with pause=`on`. Verify authenticated manual generation
   and direct Executor tests return the pause error without new artifact claim,
   AI-run or provider effects. Automation-off alone cannot stop manual callers.
   No env or cron change is performed by offline preparation.
   An already-claimed scheduled receipt can still hit the 503 pause: the current
   worker treats it as transient, retries with backoff up to five attempts, then
   persists `blocked` with `pre_site_prompt_transition_paused`. Its reported
   generation-invoked flag can be true although no provider call happened.
   Factory may instead persist `presite_verification_failed`; correlate its
   stopped step with the maintenance window. Do not alter those classifiers as
   part of the pause-only backport.
4. **Drain and prove quiet.** Remove access to all old deployment URLs/processes
   that can generate or publish, and wait for their bounded work to finish.
   Enumerate generating registry rows/leases, in-flight requests, worker jobs,
   unknown uploads and incomplete publication outcomes on the exact target.
   A timeout or expired lease is not proof of rollback. Reconcile unknown
   outcomes by existing identities before proceeding. Record zero active work
   and evidence that every reachable generation entry point enforces pause.
   If this cannot be established, stay paused and stop the release.
5. **Install the reviewed release while paused.** Deliberately promote the new
   reader and the same reviewed publication artifact/guards for both routes.
   Drain old writer versions too. Verify pause remains effective on all reachable
   instances. Reader preflight is allowed; generation remains stopped. Resume
   no writer whose policy artifact is no longer accepted at Dataverse boundary.
6. **Publish the exact prepared draft through the shared operation.** Create a
   noncurrent/unversioned draft, bind the returned draft GUID/ETag, reverify all
   original baselines and snapshot hash, and submit the reviewed request UUID.
   Either Admin or Connor's delegated tool may call the same operation. Do not
   use the legacy two-write Admin publisher, seed force mode, raw lifecycle PATCH
   or this offline planner to perform publication. If already compatible, skip
   content publication and verify the existing identity instead.
7. **Resolve before retrying.** On timeout/conflict, look up/retry the SAME UUID
   under the SAME organization, initiating user AND effective user as the
   original publication, normally through the same route/credential context.
   Switching operator or Admin/delegated contexts can change that tuple and
   correctly returns `publication_request_id_reused`; it is not necessarily an
   attack or a reason to invent a new UUID. If the original actor context is
   unavailable, stop for audited reconciliation; never spoof actor fields or
   silently transfer receipt ownership.
   Preserve the historical receipt unchanged even if current later advances;
   read current separately. An unavailable lookup stays unknown. Never infer a
   failed commit or send a new UUID. Check receipt actor/org, promoted row ID,
   original expected IDs/ETags, published version above full history, exact hash,
   sole current Published row, head revision and original budget fence.
8. **Verify with the new reader while paused.** Run the pure narrative-prompt
   preflight on the exact readback row and compare complete memo/template/model
   fields to the approved artifact. Check both old/new deployment reachability
   and current policy guards again. Local validation alone is not tenant proof.
9. **Resume deliberately.** Obtain explicit resume and bounded provider-smoke
   authorization. Deploy the reviewed new-reader release with pause=`off`, keep
   automation off for the approved manual canary, and observe its actual prompt
   ID/version, local bounds, no unintended output writes and registry/SharePoint
   finalization. Inspect `staff_deliberations_preparations` for pause-coded
   pending/blocked receipts: clearing the flag does NOT requeue blocked work.
   After the canary, enable valid automation configuration while keeping cron
   invocation stopped; use the existing authenticated lead-PD retry endpoint
   `/api/workbench/pre-site-visit/retry-preparation` for each still-eligible blocked
   receipt. Reconcile ineligible receipts manually rather than force-editing the
   ledger. Check pending backoff jobs and stopped Factory runs separately, then
   resume cron only after the queue review passes. Record operator, timestamps,
   settings/deployment IDs and evidence.

## Failure and recovery

Before publication, keep the old-reader safety deployment paused while resolving
failures; no prompt lifecycle change is needed. After publication, keep the
new-reader release paused and resolve the same UUID/current readback first.
Do not redeploy an old unguarded reader, edit a published schema, reactivate old
content directly, reset head/control counters, delete receipts, reuse numbers
or assume that reverting source undoes Dataverse/SharePoint writes. The new
validator intentionally rejects the old provider-unsupported schema, so a blind
"republish the old row" is not a valid rollback command. Prefer a reviewed
forward reader fix against the committed valid prompt. Any alternative needs a
separately reviewed compatibility/policy plan and rehearsal while paused.

Acceptance evidence must distinguish PREPARED, REHEARSED and PRODUCTION-VERIFIED.
This document and the local artifact establish PREPARED only. Missing SDK, pause
backport/deployment, drain, target export, role or transaction evidence leaves the
release blocked; no silent defaults or approvals arise from elapsed time.
