---
title: Admin proposal package reprocessing plan
domain: workbench
kind: plan
status: deferred
summary: Retained app-only package reprocessing feature, deferred until revised application flows are settled; stage membership and implementation recommendations remain provisional.
canonical: false
cataloged: 2026-11-04
owner: product-engineering
related:
  - docs/EXECUTOR_CONTRACT.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/plans/J27_READY_FOR_REVIEW_VISIBILITY_PLAN_2026-11-02.md
---

# Admin proposal package reprocessing

## Owner direction and resume condition

[VERIFIED via Justin's explicit instruction, 2026-11-04] The reprocessing
feature is still wanted and must remain on the roadmap. Defer its design and
implementation until the revised application flows are settled. Field Primer
and Initial Assessment are expected to be overhauled; they are not an approved
first implementation sequence or stable integration targets for this feature.

Resume when the owner has settled the new stages, inputs, outputs, dependencies,
and staff-edit/lifecycle boundaries. Then rebuild the inventory against the new
source and revise this plan before implementing adapters, persistence, or UI.
The source investigation below is a dated baseline, not a constraint on the
workflow redesign. The detailed storage, retention, and lifecycle recommendations
are provisional and have not been accepted as product decisions.

## Outcome and scope

[VERIFIED via Justin's instructions, 2026-11-04] Add a way for an administrator
to restart app analyses and generated documents after proposal files change.
Connor's Power Automate package assembly/AI processing is outside this action.
Justin accepted the proposed preview, preserved history, and per-stage progress
direction and requested this plan. Detailed stage membership and implementation
choices below remain [PLANNED], not approved production behavior.

The action is **Reprocess proposal package**. It operates on one existing
Request, using its updated, already-prepared package. It leaves
`wmkf_readyforreview`, Request identity, cycle, lifecycle statuses, reviewer
relationships, submitted reviews, invitation state, payments, and sent
communications unchanged. It makes no sends or lifecycle promotions.

This plan authorizes no production read/write, model call, fixture mutation,
deployment, or cleanup. It proposes implementation and verification work.

## Verified starting point

[VERIFIED via the source below; source-only investigation 2026-11-04, no new
Production probes] Readiness is not a generic app processing trigger. The
current Admin services have no whole-package rerun action. Existing generation
paths have distinct input, reuse, authorization, and persistence contracts.

| Surface | Current contract and evidence | Consequence for this feature |
|---|---|---|
| Readiness | `shared/config/requestReadiness.js`; owning readiness plan: Power Automate writes real-intake readiness after processing; app discovery reads it for linked 2027-and-later cycles | Do not toggle readiness or manufacture a new intake event |
| Field Primer | `lib/services/field-primer/generate-service.js` `generateForRequest`: `regenerate` bypasses existing-result reuse, a nonce/ETag lease fences persistence, failures try to restore the prior value; `akoya_request.wmkf_ai_fieldprimer` holds the current envelope | Existing regeneration is reusable, but frozen input and retained prior-version support need explicit work; an unpersisted returned result is not stage success |
| Initial Assessment | `lib/services/initial-assessment/artifact-service.js`: input-derived generation identity, governed Request Document lineage, SharePoint DOCX, Ready only after final registry writes | Reuse the governed producer; preview must distinguish changed input from unchanged-generation reuse |
| Draft writeup | `lib/services/pre-site-visit/artifact-service.js`; `pages/api/workbench/pre-site-visit.js`: general/missing-only/regenerate have different guards; regenerate validates expected artifacts, actor, operation ID, and lifecycle stage. Group-review activation stages and delivers a handoff email | Admin must preserve those guards. Exclude group-review regeneration from this no-send action; skipping immediate delivery would still leave an intent for recovery to send |
| Automatic writeup preparation | `lib/services/pre-site-visit/preparation-worker.js`: scheduled eligibility, missing-only generation, preparation receipts, and a separate promotion step | Reuse generation logic without invoking its promotion step or assuming a readiness event schedules it |
| AI Review Panel | `lib/services/review-panel-service.js` `launchReviewPanel`: access/rollout/storage checks, active-run exclusion, frozen inputs/configuration, launch replay; worker/store own attempts and report persistence | An optional adapter should attach to the existing run contract, with its own configuration/cost preview |
| Prompt invocation | `lib/services/execute-prompt.js`, `docs/EXECUTOR_CONTRACT.md`: single-prompt execution with explicit output targets; caller success can include separate persistence outcomes | Orchestration belongs outside the Executor; inspect persistence outcomes, not just resolved promises |

The Admin prompt destination catalog (`shared/config/adminPromptDestinations.js`)
helps find writers but is not an automation schedule or a complete dependency
graph. Its inventory must not become the rerun list by itself.

## Resume milestone: establish the revised workflow and stage inventory

[DEFERRED until revised flows are settled] Before runtime edits, trace every app-owned candidate from trigger to
inputs, writes, reuse checks, and consumers. Record the result here or in a
linked inventory with source citations. Include preparation workers, jobs,
manual generators, and upstream-owned fields merely displayed in the app.

For each stage record: owning service; trigger and eligibility; source documents
and Request fields; prompt/model/budget configuration; output table/field/file;
current-artifact behavior; staff-edit protection; dependency stages; active-run
check; safe retry/reconciliation mechanism; and whether it fits this feature.

Pre-redesign candidates, retained for reassessment rather than execution:

| Candidate | Proposed treatment |
|---|---|
| Field Primer | Expected overhaul; reassess its successor after workflow decisions |
| Initial Assessment | Expected overhaul; reassess its successor after workflow decisions |
| Draft writeup | Start with eligible Draft-stage generation using its general-mode contract, not the post-visit `regenerate` mode. Post-visit Review-stage replacements need a separate adapter review; group-review regeneration is excluded because it stages/sends handoff mail |
| AI Review Panel | Optional, separately selected stage; retain owner, access, provider, rollout, and cost controls |
| Summary, fit rationale, extracted context, integrity results, other app automations | Inventory first. Classify actual writer and input contract; add only verified app-owned stages with defined replacement semantics |
| Human-review synthesis, meeting summaries, awardee content, dossier exports | Not automatically selected just because a prompt exists. Determine whether changed proposal input actually invalidates them; require explicit scope approval for inclusion |

Default selection should be **all supported, applicable proposal-derived
stages**, with the actual selected list shown before confirmation. Unsupported,
blocked, and intentionally excluded stages remain visible with reasons. Do not
label a limited first slice as “all automations.” Inventory/stage selection is
an implementation gate, not a reason to invent currently missing generators.

## Admin workflow

[PLANNED] Add a superuser-only Admin tool, linked to an existing Request search
or lookup surface. No bulk mode in the first release.

1. Select the Request and show request number, institution, cycle, readiness,
   current source files, and existing generated outputs.
2. Prepare a server-owned preview: selected stages, input changes, proposed
   replacements, preserved prior artifacts, blocks, and expected paid operations.
   Cost information uses existing reservation logic where available; no invented
   price or “typical cost” estimate.
3. Require a reason and explicit confirmation of the displayed stage list and
   replacement consequences. Changes after preview invalidate confirmation.
4. Start one durable job. Show each stage as queued, running, completed,
   reused unchanged, failed, blocked, or needing reconciliation. Refreshing or
   closing Admin does not stop the job. UI polling is scoped to this job and
   uses request/generation guards so stale responses cannot populate another job.
5. Link each completed stage to its saved output. Show a partial outcome when
   some stages succeed. Offer **Retry failed stages** for eligible failures;
   never silently retry an uncertain paid call or artifact commit.

Keep existing outputs accessible while work runs. Mark replacement and source
provenance in the job details; expose active/partial reprocessing status beside
the affected Workbench outputs so users can recognize mixed old/new results.
The feature does not claim cross-store, whole-package atomic publication.

## Package capture and service adapters

[PLANNED] Resolve input files server-side through each domain's authoritative
document rules. The browser supplies Request/stage choices and expected preview
identity, never arbitrary Blob URLs, SharePoint paths, or prompt snapshots.

The preview captures file role, site/drive/item identity, exact version or ETag,
byte hash, extraction version/text hash, relevant Request values, current output
identities/ETags, and prompt/model/budget identities needed by selected stages.
Missing/ambiguous input or unverified same-name replacement blocks that stage.

At start, revalidate the preview and freeze the exact bytes/text and structured
inputs needed by the job. Use private storage for content; operational rows
carry opaque references and hashes. A version must be downloaded exactly, or
read with before/after version checks and refused if it changes during capture.

Existing generators often reread live sources. Add narrow server-owned prepared
input/configuration seams where necessary, preserving existing public callers
and their defaults. A wrapper invoking endpoints sequentially is insufficient:
all selected stages must consume the job's verified snapshot. Preserve each
stage's distinct input semantics; the Review Panel's narrative-only contract
must not inherit the writeup's richer request context.

If files or relevant Request context change after capture, pause undispatched
stages and require a new preview for the new package. An in-flight result may
be retained for its captured revision, but must not become the current output
over a newer revision or a staff edit. Final promotion checks must fence against
source drift and changed current-output identities.

Source drift also needs a way to close the old job. Mark it stop-requested,
fence undispatched work and old-worker publication, and settle or reconcile
in-flight domain operations. Once their effects are known and no old worker can
activate output, mark the job terminal **superseded** and release the active
Request uniqueness slot. Keep its receipts, snapshots, and recovery references.
A new preview may be prepared while settling, but a new job cannot launch while
an old dispatch/commit remains uncertain. Do not release the slot merely because
a lease expired. Operator cancellation follows the same settlement fence and
ends **cancelled**. These are proposed job outcomes, not existing statuses.

Prior upstream-derived AI fields may be stale even when readiness remains true.
Record those dependencies in the preview. A stage requiring refreshed upstream
data blocks with a specific explanation when app-only reprocessing cannot
refresh it; do not pass stale context as newly recomputed content.

## Preservation and replacement rules

[PLANNED] Reprocessing requests fresh analysis of changed inputs; it does not
clear all outputs first or disable existing reuse checks globally.

- Preserve prior SharePoint items, versions, Request Document lineage, and
  human edits. Activate replacement artifacts only through their domain's
  existing verified commit rules. Forbidden lifecycle transitions remain blocked.
- Exclude group-review writeup regeneration in the first release. Its existing
  `activateRegeneration` branch stages an email intent and calls delivery; the
  handoff-email recovery worker can also send a staged intent later. Any future
  inclusion needs a separately reviewed domain operation that preserves the
  correct artifact pair without creating notification intent or sending mail.
  Suppressing only the immediate send is insufficient.
- Draft-stage generation uses the producer's general path. Existing
  `generationMode: regenerate` accepts post-visit Review or group-review Final
  states, not ordinary Drafts. A future post-visit adapter must preserve Review
  stage and exact milestone/lineage rules; it is not implied by Draft support.
- Inspect automatic preparation receipts and schedules during preview and again
  at activation. The independent preparation worker can promote a Ready Draft.
  Define its coordination with package jobs before enabling this adapter; block
  affected Requests/stages when safe exclusion cannot be enforced. The package
  action must not call a promotion step or unintentionally make one eligible
  through a racing preparation receipt. Do not globally disable existing jobs.
- A stage may report **reused unchanged** only when its full domain input and
  configuration identity still matches; show that no fresh generation occurred.
  “Force new generation despite identical inputs” is outside the first release.
- Before replacing a scalar/JSON current field such as Field Primer, retain its
  exact prior envelope in protected recovery storage and show the field's
  overwrite consequence in the preview. The existing field is not a permanent
  version history. Recovery retention must be agreed before enabling replacement.
- Preserve domain failure recovery. A generation response with `persisted:false`,
  a failed write-result, an uncertain upload, or an unfinished lineage commit
  cannot be marked completed.
- No automatic whole-job rollback after partial success. Keep verified results
  and report the rest. Any restore is a separate reviewed action with fresh
  authority checks; a code revert cannot undo published artifacts or field writes.

## Durable orchestration and retry contract

[PLANNED] Use one small app-operational Postgres job table, provisionally named
`proposal_reprocessing_runs`, with bounded stage state in JSON rather than a
generic workflow engine. Dataverse/SharePoint keep their business authority.
The exact schema, migration number, and dispatch mechanism are not yet selected.

Minimum state: run ID; Request GUID; authenticated initiating actor; reason;
confirmation/idempotency key and payload hash; frozen package/configuration
references; expected output identities; stage IDs/dependencies/statuses/attempts;
domain operation/run/artifact references; lease/version; timestamps; safe errors;
and retention/cleanup timestamps. Do not put proposal or generated text in logs.

Required enforcement, to be designed and tested before claiming idempotency:

- A unique actor/operation key with matching payload hash returns the same job;
  a changed payload under that key conflicts. Only one nonterminal package job
  may exist per Request, enforced in the database.
- Domain active-run guards also apply. The package lock alone does not block
  Workbench/manual/cron writers; adapters must use the same domain concurrency
  fences or decline the stage before dispatch.
- A database-claimed bounded lease and compare-and-set version fence every
  stage transition. Persist dispatch intent before calling a provider/domain job.
- Existing durable domain operation IDs are reused on resume. A crash after a
  domain commit but before journal settlement rereads exact output identities;
  it does not blindly launch another generation.
- Stages with no recoverable dispatch/commit receipt must add one before the
  adapter is enabled. Ambiguous provider outcomes become needs reconciliation;
  they are not automatically billed again.
- Retry preserves completed stage IDs/results, freezes the original package,
  and dispatches only explicitly retryable failed stages. Required dependent
  stages block after prerequisite failure. Continue independent stages only
  where the approved dependency graph permits it.
- Completed requires every selected required stage to be durably completed or
  verified reused. Inapplicable stages are excluded at preview. Failed/blocked
  selected stages make the job partial or failed, never successful by count alone.

Select the existing repository-supported worker/dispatch mechanism during the
inventory milestone. Do not launch unawaited work inside the Admin request or
rely on a browser session to keep execution alive. No new hosted workflow
product, credential, or paid tooling is implied by this plan.

Preview/snapshot and recovery content need bounded private-store retention and
exact-path cleanup, with no deletion while an active job or recovery operation
references them. Proposed review values: 24-hour unconfirmed previews, 90-day
terminal-job snapshots/prior-field recovery, and 90-day redacted job history.
These are [PLANNED] policy choices requiring owner confirmation. Pruning a job
must not delete domain artifacts, prior Word files, or their business audit.

## Authorization, APIs, and operational visibility

[PLANNED] Preview, launch, read, and retry routes independently require a
superuser and validate Request/job identifiers. Reauthorize the initiating
actor at dispatch, apply trusted DAL context after authorization, preserve
Dataverse target interlocks/test-request isolation, and derive actor identity
from authentication. An Admin role does not bypass document lifecycle guards.

Register each new route in the API security matrix. The UI must distinguish
validation failure, changed preview, busy Request, partial results, and unknown
commit outcome. Record actionable operational events with run/stage references
and deduplication; proposal text and provider secrets stay out of those events.

## Provisional implementation sequence after workflow decisions

All steps are deferred. Re-select the first vertical slice from the revised
workflow; the earlier Field Primer → Initial Assessment recommendation is not
an approved sequence.

1. **Workflow decisions, inventory and owner review:** settle the revised app
   flows first, then complete the stage/dependency matrix, exact
   first-release selections, source authority, lifecycle blocks, and retention
   choices. No runtime behavior change.
2. **Read-only preview:** implement server-side resolution and change detection;
   show eligibility/replacement consequences without model calls or writes to
   business data. Persist private previews only under the reviewed retention
   contract. Test role and source-binding behavior.
3. **One-stage vertical slice:** choose a stable stage from the revised workflow,
   then add durable jobs, worker dispatch, snapshot/prior-output preservation,
   and its adapter. Prove failures, restart recovery, persistence errors, and
   concurrent Workbench operations.
4. **Governed documents:** add the approved document stages from the revised
   workflow. Validate preservation/pointer activation, post-handoff/final-stage
   blocks, uncertain uploads, and same-input reuse against real domain contracts.
   Keep group-review regeneration excluded; prove that enabled notification
   configuration still creates no email intent or send on accepted paths.
5. **Remaining approved stages:** add the verified inventory entries individually.
   Optional Review Panel integration retains its frozen DTO and existing policy.
   Do not widen provider permissions, roster visibility, or storage authority.
6. **Release:** branch/PR, scoped gates and CI, isolated Preview rehearsal, then
   deliberate production promotion under the campaign release strategy. Keep
   launch disabled until schema/storage/worker readiness checks pass. Observe
   one specifically authorized production job before broader availability.

For persistence changes: migration + manifest; existing-DB migration runner;
fresh-install compatibility; Atlas page; service catalog; API matrix and
canonical counts where affected; cleanup contracts; and operational runbook.
No existing source-of-truth doc should claim this feature shipped until verified.

## Acceptance tests and completion evidence

[PLANNED] Tests must exercise actual failure/competing-state inputs, not merely
assert that unused mocks were never called.

| Scenario | Required outcome |
|---|---|
| Updated source bytes | Preview detects the change; selected stages use the same frozen revision |
| Source changes during download or after confirmation | Refuse stale capture/confirmation; no result promoted over the newer package |
| Source drift followed by a replacement job | Fence/settle the old job, retain its evidence, mark superseded, then release uniqueness and launch the newly confirmed package; uncertain old dispatch blocks launch |
| Missing, ambiguous, or wrong-Request file | Named stage blocks before paid dispatch |
| Same-input stage | Explicit reused unchanged outcome, never masquerading as fresh generation |
| Duplicate submit / restart / expired worker lease | One logical job; existing domain receipts recovered; stale worker cannot settle |
| Concurrent Workbench/cron generation or staff edit | Domain guard blocks or refuses stale activation without clobbering newer work |
| Provider timeout after dispatch | Needs reconciliation; no automatic duplicate paid call |
| Generated output but failed field/registry/file commit | Stage not completed; prior usable output preserved; exact reconciliation possible |
| One stage fails, another succeeds | Correct identifiers and saved-output links; truthful partial status; only eligible failures retry |
| Existing Review/Final/staff-edited writeup | Lifecycle/lineage guards remain enforced; no bypass through Admin |
| Group-review document with handoff emails enabled | Package action blocks that stage before regeneration; neither new notification intent nor immediate/recovery send is possible |
| Automatic preparation receipt races a replacement Draft | Existing worker and package activation obey the reviewed exclusion contract; no accidental promotion or duplicate generation |
| Actor loses access / test marker changes / interlock denies target | Stop before the next protected operation; no privilege or isolation bypass |
| Browser changes Request or closes | Job survives; late responses do not populate another Request/job |
| Recovery retention expires | Cleanup respects active references; domain artifacts and business history remain |
| App-only scope | Readiness, Power Automate triggers, reviewer state, communications, and payment state unchanged |

Relevant gate/self-test pairs run sequentially. Include types, API security,
Atlas/migrations, Dataverse access/context, route-service boundary,
request-document writers/explicit actor contracts, output/status parity,
prompt-injection tagging, secrets, and durable-doc gates where touched. Run
contract-reconcile and a fresh read-only review of the final implementation.
Provider calls and live writes need specific authorization; this planning task
does not authorize a smoke run or consuming metered review products.

## Decisions to settle before runtime implementation

1. Settle the revised app flows, including the planned Field Primer and Initial
   Assessment overhauls. Then approve the rebuilt stage inventory and first-release selection. In
   particular, decide which optional analyses should run every time and which
   are explicitly selected (especially AI Review Panel).
2. Confirm recovery-content retention and whether current-field replacement
   needs longer-lived history than the proposed 90-day recovery window.
3. Confirm UI placement and the document lifecycle stages supported at launch.
   The proposed shape remains one Request and superuser-only; the first stage
   and supported document states must be selected from the revised workflow.

## Contract-reconcile planning verdict

[VERIFIED] Product boundary and the cited existing service contracts are
source/owner supported as the pre-redesign baseline. [DEFERRED by owner]
Stage inventory, preview/snapshot storage,
job persistence, worker adapters, UI, migrations, and deployment are unbuilt.
Unverified external flow internals and live runtime configuration remain outside
this source-only plan; no claim of end-to-end production proof is made.

Caller → Admin preview/confirmation → authenticated route → durable job → domain
adapter → business persistence → exact output verification → stage/job response
→ Admin/Workbench status is the proposed flow. Partial-success, async fencing,
helper semantics, durable surfaces, and status-consumer fan-out are covered by
the requirements above; implementation evidence remains to be produced. No
new persisted enum, field, table, or route exists merely because it is named here.

Plan review, 2026-11-04: a fresh read-only review found the group-review email
side effect and the missing terminal disposition for source-drifted jobs. Both
were corrected above, including preparation-worker coordination, and the
follow-up review found no remaining actionable contradictions. Documentation
currency, fact consistency, symbol-reference, build-claim-freshness, and catalog
checks passed with applicable self-tests sequentially. The direct citation
check found all 13 referenced repository paths present. These checks validate
the plan's documentation/source references, not the proposed runtime behavior.
