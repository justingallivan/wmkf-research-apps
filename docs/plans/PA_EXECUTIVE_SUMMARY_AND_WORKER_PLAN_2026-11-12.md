# Next Power Automate slice: Executive Summary and worker automation

Owner: Codex; branch `codex/power-automate-integration-2026-11-11`.
Status: supervised Short Title worker trial passed on isolated Request 1000389.
Executive Summary uses the existing Lay Abstract field; staff editing is branch-built.
Automatic Summary delivery and unattended scheduling remain unactivated.
Connor’s original Short Title deployment, Request and scoped ledger are unchanged.
See the [trial receipt](PA_BOUNDED_LIVE_TRIAL_APPROVAL_2026-11-13.md#automatic-worker-trial--passed).

## Recommendation

Reuse the shared Executor and migration 097 ledger. Keep Executive Summary draft-only
until its initialization event and staff-edit protection contract are implemented and approved for activation. Plan automatic processing as
backend-owned durable worker ticks; Power Automate submits and polls, with no provider
implementation, direct output PATCH or cron credential. Do not add a queue service,
new database, generic field mapper or another application merely for this slice.

[OWNER DECIDED 2026-11-13] Summary uses the project narrative in
`Submission-Documents`. The combined Narrative-Bibliography PDF in `AI Materials`
is for reviewer matching, not Summary input or a Summary prerequisite. No fallback
to that PDF, applicant abstract or Phase I staff version. The existing AI Materials
source adapter belongs to prior trials; the dedicated Summary adapter is now built
and synthetic-tested offline, with no runtime importer or machine admission wiring.

## Evidence and boundaries

| Claim | Evidence | State |
| --- | --- | --- |
| Summary capability exists: `proposal.executive-summary`, output `summary`, 200-word cap, destination null | `lib/services/prompt-jobs/capabilities.js` | VERIFIED source |
| Prior staff trials retained summaries but made no Request-field writes | `SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md`, dated live receipts | VERIFIED historical; not a fresh content-quality approval |
| Current machine route accepts only `preflight.short-title`, initialize, one pinned Request/event | `machine-service.js`, `machine-pilot-policy.js` | VERIFIED source; Summary cannot be enabled by changing a prompt row |
| Legacy machine scope targets `wmkf_wmkfprojectdescription`; new branch configurations can declare an approved direct text field | `request-field-delivery.js`, `machine-destination.js` | VERIFIED source; exact prompt target + server grant, Summary still gated; see [configuration contract](PA_CONFIGURABLE_DESTINATIONS_2026-11-13.md) |
| Proposal source currently pins AI Materials and Project Leader name | `proposal-source.js`, `createProposalSource` | VERIFIED existing staff-trial source; Summary requires the separately selected Submission-Documents policy |
| Legacy `wmkf_ai_summary` has writers and readers | `phase-i-dynamics/summarize-service.js`, `cycle-dossier-generation.js`, `workbench/resolve-request-service.js` | VERIFIED source; not an unused destination |
| Machine drain is POST-only, server selects one stage, no schedule entry | `pages/api/cron/drain-machine-prompt-jobs.js`, `machine-worker.js`, `vercel.json` | VERIFIED source |
| Current pilot rejects Production deployment classes and expires after at most seven days | `machine-pilot-policy.js` | VERIFIED source; not production-ready policy |

Live metadata and consumer checks now establish the existing Lay Abstract destination.
See the [field contract](PA_EXECUTIVE_SUMMARY_FIELD_CONTRACT_2026-11-13.md) for the
owner-approved reuse and the branch-built staff editor. Source selection is settled; external
writer/visibility checks, staff-edit protection and event eligibility remain activation gates.

## Executive Summary delivery contract

| Contract | Proposed value / decision boundary |
| --- | --- |
| Task | Reuse `proposal.executive-summary`; preserve existing staff draft semantics |
| Prompt | Dataverse versioned task instructions and execution profile; pin ID, revision and hashes at admission. Re-read current rows before publishing a new prompt definition, then freeze admitted job pins; no new prompt publication in this plan |
| Content | Existing summary starting point, maximum 200 words. Wording optimization deferred; audience and grounding still require review |
| Required records | Current profile requires the directly stored Project Leader name as `pi_name`; do not remove it silently |
| Document | Project narrative in `Submission-Documents`, server-selected under a versioned policy; proposed exact name `Project-Narrative_{Request#}.pdf` must be verified against the intake producer |
| Output | Validated nonblank `summary` text under existing profile bounds; JSON/profile envelope remains the existing Executor contract |
| Immediate persistence | Retained validated draft in existing ledger; bounded expiry, not permanent output storage |
| Final destination | Owner-approved existing `akoya_request.wmkf_layabstract`; staff label Executive Summary, stable API key `lay_abstract`, Memo 100,000 characters |
| Excluded automatic mappings | `wmkf_ai_summary`, Initial Assessment and Pre-Site document sections are not approved substitutes |
| Delivery proposal | One-time initialization only, never automatic replacement; this is a proposal, not an owner-approved refresh policy |
| Audience | Staff review initially proposed. Chairs distribution remains OPEN; storing in Dataverse alone does not enforce an audience |

The destination is settled. Before automatic delivery, confirm external writers,
visibility and the approved first-initialization event. Preserve staff edits and
clearing. Output format validation is not scientific quality approval; no Chairs
distribution follows from this change.

### Selected source and cache contract

Freeze Request/authorization scope, document identity, revision/ETag, extraction
version and content hash, plus required record values, prompt and profile pins.
Reject missing, ambiguous, unauthorized, changed or oversized sources. Keep source
text untrusted and preserve references where the selected extraction supports them.
No fallback to whichever folder happens to have a file, and no client-supplied URL.

Use the existing prepared snapshot and cache-prefix composition. Cache reuse requires
compatible model/settings/schema and the same authorized content; measure after
selection, do not promise savings. A replaced file does not automatically rerun jobs.
A new explicit run freezes new source identity. Durable result reuse/idempotency is
separate from provider caching. Scope participates in the wrapper nonce; the same PDF
does not establish cross-scope prefix compatibility. Do not widen authorization for
cache reuse or add an extraction framework for this slice.

### Staff-edit protection and initialization eligibility

[PLANNED, owner requested inclusion 2026-11-13] Add one monotonic Request Boolean
meaning “staff edited Summary”; its logical name, security and provisioning are
not yet settled. It is not an existing field or an implemented runtime guarantee.
A disconnected command builder now exercises the contract with a synthetic marker
and versioned fake rows; see the offline protection evidence below.

- Every deliberate staff Summary save or clear sets the marker true in the same
  concrete-ETag PATCH as `wmkf_layabstract`. An explicit clear of an already blank
  field must record intent, despite the current service's unchanged-text shortcut.
  Reads, untouched fields and failed conditional saves do not set it. The editor
  needs an explicit way to express that clear intent; no autosave is introduced.
- Never automatically reset the marker. Inventory external forms, flows and other
  writers; all manual-edit paths must set it atomically and ordinary writes must
  not clear it. An asynchronous follow-up marker write leaves a race and is insufficient.
- Read marker, Summary value and ETag together. True, missing or unreadable marker
  denies automatic initialization; nonempty/whitespace text remains protected.
  A false default does not prove historical non-editing: admit only a specifically
  enrolled new intake cohort after protection is in force, with no blanket backfill.
- An edit before capture is detected by the marker; one after capture changes the
  row ETag and causes the original conditional publication to conflict. Never refresh
  that ETag to force delivery. Staff may edit without waiting for AI completion.
- Retain the per-Request/physical-field initialization receipt through failure,
  expiry, clearing and source changes. The marker protects manual intent; the receipt
  prevents another automatic attempt. Neither replaces the other.

[UNKNOWN] The exact first-intake event and readiness ordering need Connor's flow
contract. The newer J27 branch decision D56 identifies `wmkf_readyforreview`, but
`J27_READY_FOR_REVIEW_VISIBILITY_PLAN_2026-11-02.md` records it as completion of
assembly and AI. The source predicate `shared/config/requestReadiness.js` filters
staff discovery; `workbench/request-narratives-service.js` does not gate editing on
readiness. Reset/resubmission semantics and external flow enforcement are unverified.
Do not use this Boolean as both an AI prerequisite and AI-completion signal.

Proposed ordering, pending that contract: narrative finalized → submit Summary job
with a stable intake event identity → finish required processing → mark ready for
staff. Summary does not wait for the combined reviewer PDF. Define the outcome when
Summary is protected, failed or uncertain before making readiness depend on it.
A readiness reset, file replacement or fresh event ID never grants another automatic
initialization. Connor's existing Short Title test is a separate, unchanged scope.

Required offline regressions: edit then clear before capture; explicit blank clear;
edit during generation; atomic save failure; missing/true marker; forbidden marker
reset; duplicate event and event-ID change; known failure and content expiry retaining
the Summary reservation; exact narrative selection with combined PDF also present;
missing narrative must not fall back. Test source identity/revision changes and the
original ETag across the complete submit → generation → publication → staff readback flow.

### Evidence for the revised contract (2026-11-13)

| Claim | Evidence | Status / disconfirming check |
| --- | --- | --- |
| Summary source is Submission-Documents narrative; matching keeps combined PDF | Owner's explicit source decision in this chat | VERIFIED intent; dedicated adapter built offline, runtime wiring still required |
| Current editor permits early saves and skips unchanged text | `lib/services/workbench/request-narratives-service.js`, `canEdit` / `saveRequestNarratives` | VERIFIED source; readiness is absent from these guards |
| Worker captures baseline after source preparation | `lib/services/prompt-jobs/worker.js`, `advanceJob`; `store.js`, `captureTarget` | VERIFIED source; an earlier edit-and-clear defeats blankness alone |
| Permanent Summary reservation retention | `store.js`, `markAttemptFailed`; offline SQL receipt tests | VERIFIED branch source/local PostgreSQL: only registered synthetic tasks in test may release; Summary admission remains disabled |
| Proposed marker closes both edit races if all writers participate | Atomic text/marker PATCH + existing original-ETag publication | PLANNED; external writers and new marker not tested/provisioned |
| Readiness timing and writer inventory | Branch-local readiness plan and newer J27 decision record | UNKNOWN external lifecycle; no flow or live system changed |

Existing source/context/conditional-writer/editor tests passed (106 tests in four
suites); readiness/editor checks passed (45 tests in two suites, overlapping).
Those checks do not test the proposed marker. Independent read-only review identified
blank-clear intent, all-writer coverage, new-cohort eligibility and permanent Summary
receipts as requirements. Historical Opus receipts below do not approve these new edits.

### Smallest implementation after decisions

1. Keep staff draft admission and readers intact. Proposed discriminator for task-key
   reuse: operation `initialize` AND a separate `pa-executive-summary:<UUID>` scope,
   under its own default-off machine policy/grant. Staff remains `generate-draft`
   under `proposal-trial:<UUID>`. Both components are mandatory, not an OR check.
   Reuse only the authentication verifier and ledger; title-specific auth policy,
   database checks and worker composition require separate explicit Summary bindings.
   Never mutate `PROMPT_JOB_MACHINE_PILOT` during Connor’s trial or share its scope:
   its worker rejects non-title tasks. Machine Summary excludes `local-production`.
   Tests must prove staff listing/admission/readers cannot see or create machine jobs,
   and machine grants cannot read staff drafts. Client fields never choose destinations.
2. Bind only the approved source policy and published Summary/profile pins. Permit
   a single Summary task in the first trial. Do not implicitly admit Methodology.
3. Once field semantics are approved, wire capture/write through the trusted Request
   DAL. Reuse reservation/publication machinery and the original row ETag; do not
   globally change `proposal.executive-summary` from draft to initialize for its
   existing staff callers. Make the new mode explicit in reviewed capability checks.
4. Implement the staff-edit protection above, including whitespace and intentional clearing. Initialization
   receipt survives source/prompt changes, expiry and deployment changes in the same
   database. Permanent retention is now implemented offline: only known synthetic
   tasks in test can release a slot (`store.js`, `markAttemptFailed`). Summary
   admission/publication are still disabled. Never relocate the Request into a fresh
   database to evade its receipt.
5. Unknown provider/audit/write outcomes stay fenced; no automatic resend or new
   model generation. Retain validated output on write conflict within retention;
   any recovery requires a separately reviewed authorized operation.

Testing must trace submit → policy/source → configuration/snapshot → fenced provider
attempt → validated result → audit → conditional publication → status/readback.
Use isolated SQL and fake provider/DAL first: concurrent same-key requests, changed
payload, wrong principal/task, expiry, missing/changed source, pre/post-dispatch denial,
staff edit/clear, row-wide 412, uncertain audit/write, response recovery, and retained
receipt after cleanup. A delivered sibling must not mask a failed task. Do not enable
multi-task admission in this first slice. Verify staff draft APIs still create no
initialization or publication rows. Live paid generation and writes require their
own bounded approval after review.

## Worker automation plan

Keep one stage per invocation and existing durable claims/checkpoints. No background
promise detached from an HTTP response. The server selects eligible work; Connor
never receives `CRON_SECRET` or a job-execution endpoint. Duplicate/overlapping ticks
must acquire the existing lease and cannot repeat dispatch or publish.

### Immediate sandbox path

Connor’s completed Short Title fixture needs no worker tick. The separately approved
Request 1000389 trial used an operator-owned bounded driver to call the current POST drain sequentially, inspect every response, and stop at
completion, error, uncertainty, expiry or a fixed tick/time budget. A client timeout, network error or non-200 response stops the driver without retry.
Its HTTP timeout must exceed the verified server budget plus network margin; never
start another tick while the prior one may still be running. Read-only diagnosis and
lease reconciliation must establish the outcome before any operator-directed resume.
This is supervised trial automation, not a durable production scheduler. It may run on the operator’s
machine; Connor still needs only Power Automate. The subsequent authorized offline
build is recorded below; its separate approved live execution passed on Request 1000389.
No new scheduler service/project or broad cron-secret sharing is justified for a
single sandbox trial. A durable unattended Preview requirement would need a separate
hosting decision; do not promote the existing sandbox to Production to get a timer.

### Eventual unattended operation

[PLANNED, conditional recommendation] Reuse Vercel Cron on the eventual approved
Production deployment after production policy and task/destination contracts are
reviewed. Vercel Cron invokes **GET** and only Production deployments; merely adding
the present POST route to `vercel.json` cannot activate this Preview. See
[Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json)
and [Vercel cron behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Vercel now labels Cron Jobs legacy and points to Schedules. Reusing the repository’s
existing cron mechanism is the minimal conditional option here, not a platform
migration decision. Recheck support before implementation; a scheduler migration
is separate scope and is not authorized by this plan.

Required implementation, before any activation:

- Add an authenticated GET entry to the same worker service (retain bounded operator
  POST). Preserve strict secret checking before DAL context and no development bypass.
- Replace the trial-only policy with a separately reviewed deployment/target policy,
  exact task grants, source/destination bindings and bounded admission. Do not make
  `production` an extra allowed string in the sandbox policy. Production Dataverse
  enablement, scheduling and spend caps require deliberate approval.
- Use the existing ledger as work ownership. Production selection must be bounded,
  fair across approved scopes and skip settled/uncertain jobs; the current single-job
  `listJobs(limit:1)` pilot selector is not a general dispatcher. No new queue yet.
- Resolve the execution budget before rollout: route declares 300 seconds, the
  `vercel.json` cron wildcard declares 120, and the current worker lease is 240 seconds.
  Effective deployed duration is UNVERIFIED for a future scheduler. For both driver
  and scheduler, set an explicit route configuration and enforce: provider deadline
  plus checkpoint margin fits within BOTH the remaining function budget and remaining
  lease. Prefer a lease longer than the effective invocation budget plus margin.
  Independently prove that any post-intent lease reclaim fences unknown and cannot
  redispatch, including a still-live original invocation. Test actual deployed budget,
  deadline, checkpoint margin and lease expiry together. A killed invocation must fence ambiguity rather
  than trigger another paid call. Do not simply increase all timeouts.
- Proposed initial cadence: one minute if the approved hosting plan supports it.
  Multiple stages imply minutes of latency, not instant completion. Confirm acceptable
  latency with Connor before activation; polling faster does not accelerate work.
- Treat missed/duplicate ticks as expected. Retry scheduling only advances safe saved
  work; it never authorizes retrying an ambiguous side effect. Return safe stage/status
  telemetry; surface stalled/needs-attention jobs through existing operational tooling.
- Schedule bounded content cleanup without removing permanent replay/initialization
  receipts. Malformed policy cannot authorize cleanup; expired/disabled exact-scope
  cleanup needs explicit tests. Document the operator and retention deadline.
- Stop new admission and disable the schedule to stop rollout; in-flight calls may
  finish, so retain receipts and review their outcomes. Current immutable deployment
  environment pins are not an instantaneous revocation mechanism. No destructive rollback.

Acceptance: duplicate and overlapping ticks, lease loss, process interruption at each
side-effect boundary, source/access changes, disabled/expired policy, no eligible work,
cleanup, and safe restart. Then one approved Sandbox trial must show queued → running
→ succeeded with no manual stage calls, one generation/audit/publication, and no work
on replay. A supervised bounded driver proves automatic stage advancement only;
Production scheduler operation needs its own deployment verification and must not be
claimed from that driver. Existing paid runtime approval does not authorize a new run.

## Ordered next actions and open decisions

1. Await Connor’s POST/replay/poll result; independently verify existing ledger and
   field still unchanged afterward. No new infrastructure depends on that test.
2. Source and destination are settled. Before implementation, settle the exact intake
   event/readiness ordering, verify the narrative naming contract, specify the staff-edit
   marker and every writer that must maintain it, and identify the eligible new cohort.
   The existing staff editor is branch-built; the marker and automatic Summary path are not.
3. The bounded driver now has offline tests (below). Scheduler implementation and
   future scheduler budget verification remain pending. The supervised driver trial
   and its Preview duration verification passed. Review any scheduler implementation
   with Opus 5.5 before deployment or activation.
4. Build only the selected Summary mode once the source/destination contract is final;
   then request one bounded end-to-end trial. Leave broader prompts and multi-task
   dispatch to later slices using the same contracts.

Contract-reconcile scope: documentation planning, existing machine routes/store/status,
Summary capability/source and conditional writer; this update proposes one Dataverse
Boolean, but creates no schema or runtime changes.
Partial-success, async/freshness and consumer compatibility requirements are above.
Helper extraction and migrations are N/A in this planning slice. Source evidence
shows why neither adding a prompt row nor adding a cron line is sufficient.

## Historical Opus 5.5 review of the earlier worker plan

Reviewed via Claude Code subscription OAuth, tools disabled. Packet SHA-256
`aa021d700b2f1bef202057bfc474c42c194671007a704e37f64d06ba342d90ac`.
Verdict: GO after six named plan edits. Applied: separate writer/admission blockers;
explicit operation+scope isolation and compatibility tests; execution/lease deadline
invariant plus unknown-outcome fencing; stop driver on transport ambiguity; clarify
that prompt re-read precedes definition publication, not result writeback; separate
Summary policy/grant from the active title pilot. The reviewer’s suggested sum of
function budget and provider deadline double-counts execution time; root instead
requires deadline+checkpoint margin inside both budgets and tests no redispatch on
lease loss. No speculative prompt re-read at delivery was added. Frozen prompt pins
remain the execution contract; authorization/source freshness checks remain required.
These are closed plan edits, not implementation or deployment evidence. Documentation
and fact gates passed. Existing current-state restatements remain accurate: machine
Summary and scheduling are still unbuilt; the pilot stays unchanged.

## Bounded operator driver: implementation and live use

`../../scripts/run-pa-sandbox-worker.cjs` is a standalone Node operator utility,
not a Power Automate action or deployed worker. It does not submit jobs, issue
credentials, change policy, or implement Summary. The current exact Preview/job
pins name the completed Request 1000389 trial. Its retained receipt prevents another
execution. The original offline build was followed by the separately approved live
trial; Connor’s fixture was never advanced by this driver.

Default invocation is a network-free dry run. `--help` explains arguments; `--execute`
is the only CLI execution switch. Do not run the completed trial again.

A private regular file owned by the operator, mode 0600, supplies `baseUrl`, `jobId`,
`serverBudgetMs`, `budgetVerified: true`, `cronSecret`, `statusToken` and `cookie`.
Use only the exact Preview and job pins recorded in the live-trial receipt.
The status token is a short-lived Entra app bearer token acquired by the operator;
it is not the app client secret. The cookie is the single `_vercel_jwt=…` pair.
The cron secret stays operator-only. Do not put any of these in CLI arguments,
logs, commits, flow exports or messages. A private credential file was created for the approved live trial.

Before live approval, verify effective deployed function duration and the provider/
lease/checkpoint invariant above. `budgetVerified` is an operator attestation, not
an automatic Vercel configuration probe. A value of true does not establish approval.
The client timeout is the supplied function budget plus 10 seconds. The driver
reserves that full interval before each call and caps its run at 10 minutes, eight
worker POSTs and the November 18 19:30 UTC cutoff. It may stop early with unused ticks
because the remaining wall time cannot accommodate another full request budget.

It GETs the exact job before each POST, requires the expected single Short Title task,
and stops on any attention/unknown/failed state or unexpected response. Only enumerated
progress stages permit another status check. `published` alone never means success:
GET must confirm succeeded + validated + applied + no error. Requests are awaited,
redirects disabled, and failures never retried. Five seconds separate successful ticks.

An exclusive retained receipt at `~/.wmkf-pa-worker-nplsf4137.receipt` prevents
cooperating drivers in the same user account from overlapping or restarting blindly. Tick
intent is flushed before POST. The script never removes this receipt, including on
success. `--help` prints its exact path. After a crash/timeout, an operator must inspect
server status/lease and outcomes before removing it for a separately authorized run.
A different user account, machine or manual POST can bypass the local guard: database leases and
side-effect fences remain the authority. This is not a distributed lock or scheduler.
Only safe codes, timestamps, job ID and tick count are recorded, never raw transport
errors, response bodies, headers or secrets.

Verification: `tests/unit/pa-sandbox-worker-driver.test.js` exercises fake HTTP and
real temporary receipt files, including completion with zero POSTs, sequential ticks,
concurrent local exclusion, retained crash guard, transport/non-200/JSON uncertainty,
wrong job/status, false success, cutoff/time/tick bounds and configuration rejection.
No provider, Dataverse, Vercel or Entra endpoint is used by these tests. Scheduler GET
routing, Production policy and multi-scope fairness remain unbuilt. The separate
live trial verified its deployed budget and supervised automatic progression.

Build review: Opus 5.5 via OAuth, tools disabled, verdict GO with fresh-trial
conditions. Packet SHA-256
`9d39e7670cdae517040d4fdc7a6203e5af620dfa8ff2ab054b51564044bc3b8d`.
Root applied the receipt-location recommendation now: fixed home-directory file,
mode 0600, per-user rather than per-host, outside OS temporary-file cleanup.
No receipt was created by this offline build. Before re-pinning or live execution,
verify the server’s exact policy/database/single-job selector: the POST accepts no
job ID and returns only a stage, so client GET pins alone cannot prove which job the
server advances. Current source selects only the pinned scope, but that must be
reconfirmed for a new deployment/trial. Local exclusion supplements, never replaces,
server lease and side-effect fencing. Review did not verify live duration or database
state. Optional config-file TOCTOU hardening was not required for this operator-owned
file and is not represented as implemented. Twenty offline tests and scoped ESLint
passed; scheduler implementation remains outside this build.

## Deployment timing and completed live trial

[VERIFIED 2026-11-13 UTC via both Preview Resources tables and live receipts]
The original and new isolated Preview drain functions each showed Max Duration
≤300 seconds. No forced timeout was tested. The 240-second lease and provider
deadline remain unchanged. The first ordinary create failed in GoVerify; Justin
then approved one temporary bypass, which created Request 1000389 and restored
the workflow before subsequent work. The separate Preview completed five automatic
worker stages in about 59 seconds, with one generation/audit/publication. Same-key
replay left the output, ETag and scoped ledger unchanged; Connor’s original Request
and scoped ledger also remained unchanged. The
[trial receipt](PA_BOUNDED_LIVE_TRIAL_APPROVAL_2026-11-13.md#automatic-worker-trial--passed)
records exact pins and evidence. This is supervised operator automation, not an
unattended Production scheduler. No schedule is active.

## Source-decision reconciliation (2026-11-13)

Sweep Mode A: Summary input decision and proposed staff-edit protection only.
Authority: owner's explicit Submission-Documents narrative decision; inspected
source adapter, staff save service, worker baseline capture, reservation release
and readiness predicate. Updated current Summary plans, machine handoff, branch
session handoff, Request Atlas and architecture mapping; historical trial outcomes
remain unchanged. The bounded trial's forward-looking source statements now point
to the settled decision rather than reopening it. Other tasks' source policies and
older dated trial evidence are outside this change. Searches across docs, memory,
wiki and runtime classified prior staff/recommendation AI Materials inputs as
historical or task-specific, not the new Summary policy. Remaining live stale
source-selection claims in these in-scope surfaces: zero after repeat search.
External readiness lifecycle, writer coverage, marker schema and new-cohort
eligibility remain unknown/planned; no external-state certification is claimed.
Documentation gates and sequential self-tests: doc-currency, fact-consistency,
canonical-pointers, atlas, doc-symbol-refs and build-claim-freshness passed.
No runtime, schema, credential, deployment or Connor test change.

## Offline Summary source adapter (2026-11-13)

[VERIFIED via source and synthetic tests] `lib/services/prompt-jobs/summary-source.js`
exports `createSummarySource` with `inspect`, `prepare` and `isCurrent`. The separate
policy `submission-documents-summary-pi-v1` selects exactly
`Submission-Documents/Project-Narrative_{Request#}.pdf` under one active Request
location. This candidate filename awaits Connor's confirmation before activation.
The existing staff/recommendation adapters and source policies are unchanged.

| Invariant | Enforcement / verification |
| --- | --- |
| Narrative only, no fallback | Exact folder/name; tests supply combined PDF, legacy narrative and applicant abstract while removing the narrative |
| Caller supplies authorized Request context | Header requires caller authorization and trusted DAL context; no public route, worker or admission imports the adapter |
| Frozen source and authoritative PI | Manifest pins Request, contact/name hash, Graph site/drive/item/version/ETag; checks before and after download and after extraction |
| Bounded, trustworthy shape | 20 MiB download cap, PDF magic bytes, nonblank extraction, existing profile UTF-8/snapshot limits; errors contain safe codes only |
| Shared snapshot contract | Existing sealed context builder retains raw-byte hash, extraction version, document text and PI provenance; integrity readback tested |
| No durable or external side effect in verification | All source/extraction dependencies mocked or injected; no database, provider, Graph, Dataverse or deployment calls |

Unknown/foreign manifest policy, invalid scope/profile, absent/ambiguous location,
changed source and invalid bytes fail closed. Transport uncertainty is distinguished
from confirmed stale input. Freshness is a bounded observation, not a lock: future
worker integration must recheck source and authorization before side effects.
`isCurrent` compares metadata/PI; it does not redownload or promise content freshness
if an external producer violates revision semantics. Raw bytes are hashed at preparation.
No extraction-helper refactor, new persistence, migration, status or API was added.
Partial-batch success and UI state are N/A; this adapter returns one snapshot or fails.

Validation: 68 tests across the Summary source, existing proposal source and context
suites passed with synthetic inputs. Scoped ESLint and repository type check passed.
Independent read-only build review found no material issues. No real PDF extraction,
live source/authorization or cache savings is claimed. Staff-edit marker, event
eligibility, grants and initialization/publication wiring remain unimplemented.
Connor's test, deployed code and configuration remain untouched.

## Offline permanent reservation safeguards (2026-11-13)

[VERIFIED via branch source and isolated local PostgreSQL] Failure handling in
`store.js` releases an initialization slot only for a registered synthetic capability
in environment `test`, subject to the existing no-publication/protected-content guards.
Unknown outcomes never release. Summary and unknown task types retain reservations;
no special Summary admission hook, capability, policy, event or destination grant was
added. Existing Short Title and staff-draft paths keep their admission contracts.

The new `tests/integration/prompt-jobs-summary-reservations.pg.test.js` applies
migration 097 to a randomized schema in a dedicated loopback scratch database.
It creates hypothetical Summary receipt rows directly through test SQL, with
non-executable configuration. These are not admitted jobs and cannot demonstrate a
live Summary workflow. It exercises real claim/capture/failure/content-expiry/read
operations and the existing physical-field unique index. No schema change is needed.

| Invariant | Offline evidence |
| --- | --- |
| Failed Summary slot remains occupied | Pre-dispatch failure, validation failure, expiry and unknown outcomes |
| New event/key/principal/scope cannot evade physical-field uniqueness | Competing synthetic SQL receipts conflict before and after content cleanup; concurrent reservations yield one winner |
| Receipt reads/expiry do not reopen initialization | Repeated reads preserve receipt state; expired content is deleted while the slot remains |
| Release exception is closed | Known synthetic/test releases; synthetic outside test and unknown task do not |
| Admission stays disabled | Generic Summary initialize and machine entry reject; no configuration load or job row |
| Existing callers remain compatible | Generic ledger, Short Title store and staff-draft real PostgreSQL regressions |

This slice does not test Dataverse clearing, implement the staff-touch marker,
or enable Summary same-key admission replay. Slot uniqueness is independent of
current field text, but actual edit protection and integrated replay still require
future source/marker/admission work. Partial-batch response changes, UI async state,
helper extraction, new migrations and external contracts are N/A in this change.
All test data is fabricated. No provider, Dataverse, Graph, Neon, deployment or
Connor test call occurred. No intake decision was selected by these tests.

Verification: 76 real local PostgreSQL tests across five suites passed (52 ledger/
Summary/Short Title/staff tests and 24 actual Short Title worker tests, run with
separate explicit scratch URLs). An enabled valid Short Title policy rejects the
Summary task before configuration loading. Restoring the original release rule
made six of the ten new Summary reservation tests fail; the fixed rule passes.
Scoped ESLint, repository type checking, Atlas/fact/doc/symbol/DAL/status gates and
sequential self-tests passed. Independent read-only review found no material issues.
Changed-fact reconciliation updated this plan, architecture, Atlas, service catalog
and branch handoff; repeat searches found no remaining Short-Title-only retention
claim in the scoped current docs. Both newly created disposable containers were
removed after testing; the pre-existing roster container was untouched.


## Offline staff-edit protection (2026-11-13)

[VERIFIED via source and synthetic unit tests] `summary-edit-protection.js` is a
pure, disconnected command builder. `prepareSummaryStaffEdit` emits immutable
text + true-marker intent with a concrete original version, even for unchanged or
already blank text. `captureSummaryBaseline` returns only that original version
when text is null/empty and the marker is exactly false. Missing, malformed, true
markers, invalid versions and nonblank/whitespace text fail closed.

The neutral DTO keys `text`, `staffEdited` and `version` are synthetic contract
names, not proposed Dataverse logical columns. The helper performs no reads or
writes and grants no authorization or cohort eligibility. Tests apply its commands
to a versioned in-memory fake with atomic conditional writes. They cover edit then
clear before capture, deliberate blank clear, post-capture edits/clears, machine-first
ordering and stale staff-save failure without partial marker/text mutation. Frozen
commands preserve the observed version if input objects later change.

Contract trace: synthetic caller → pure helper → fake conditional row write →
asserted readback. Runtime UI/routes, production persistence, batching and async
execution are N/A in this slice. Future adapters must apply the two fields in ONE
conditional PATCH, preserve authorization and original-version checks, and never
retry with a refreshed ETag. The helper does not establish this external guarantee.
All manual writers, explicit-clear UI, actual marker schema/security, new-cohort
eligibility, intake event/readiness ordering and Summary admission/publication remain
unimplemented or unsettled. No intake decision, Dataverse schema, runtime route,
Connor test or deployment changed. Source remains Submission-Documents narrative.

Verification: 94 tests across the new protection, existing narrative service and
Summary source suites passed, including 32 new synthetic protection cases. Scoped
ESLint and documentation currency/catalog/symbol gates plus available sequential
self-tests passed. Independent read-only review found no material issues, while
explicitly limiting the evidence to command formation and a synthetic atomic-write
model. Runtime references to the new exports are absent; only the unit suite imports
them. The existing runtime marker/integration requirements above remain open.
