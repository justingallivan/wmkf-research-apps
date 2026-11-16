# Executive Summary and worker automation

Owner: Codex; implementation branch `codex/executive-summary-generation-2026-11-16`.
Status: bounded Summary integration is branch-built and default-off. No Summary
activation, deployment or live generation follows from this build. Current implementation,
verification and setup checklist: [bounded Summary integration](PA_EXECUTIVE_SUMMARY_INTEGRATION_2026-11-16.md).

## Current intake contract

[OWNER CONFIRMED via Connor response and Justin's follow-up] Generate Executive
Summary from the project narrative in `Submission-Documents`; store it in
`akoya_request.wmkf_layabstract`. The combined Narrative–Bibliography PDF remains
reviewer-matching input. `wmkf_readyforreview` is the final handoff after all required
AI and document steps succeed. Power Automate halts failed intake and notifies
check-in staff; the Summary worker does not set that flag or send those notifications.
Document upload completion precedes submission; the final ready flag is not an AI
prerequisite.

Connor intends intake-only writes to this field and no later flow edits. Staff edit
in the app. Justin accepts the rare seriously broken-intake rerun edge case; a
persistent staff-edited marker is not a prerequisite. The disconnected marker helper
and its earlier synthetic tests are historical experiments, not required rollout work.
This decision does not add an overwrite or reservation-reset API.

## Bounded implementation and next steps

[VERIFIED via `machine-summary-service.js`, `machine-summary-policy.js`,
`machine-summary-worker.js`, `summary-source.js`, `store.js`, and `worker.js`]
The separate submit/status routes and unscheduled worker use
`PROMPT_JOB_SUMMARY_PILOT`, exact Sandbox Request/event enrollment and pinned
prompt/profile/database identity. The owner selected bounded test Requests first;
production intake and broad rollout are excluded. Staff draft and Short Title
policies remain separate.

The worker freezes the narrative identity/revision and directly stored PI name,
uses the shared Executor without direct persistence, retains validation and audit,
and publishes only through the original Request ETag. Existing nonblank text is
protected. Permanent Request/physical-field reservations survive failure, clearing,
expiry and a new event/key. Unknown provider/audit/write outcomes never authorize
another automatic attempt. Source replacement is checked before generation and
publication. No staff marker column or migration is required.

Before a bounded live setup, verify the actual
`Submission-Documents/Project-Narrative_{Request#}.pdf` naming and upload completion,
current Summary metadata/permissions, prompt/profile pins, exact Request/event and
isolated database. Exercise submit, polling, worker advancement and readback under
a separately reviewed bounded test setup. Do not reuse completed Short Title trial
pins or credentials. Effective deployed duration and source extraction remain live
verification items; offline tests are not evidence of either.

Keep one stage per invocation and durable leases/checkpoints. The new Summary drain
is unscheduled; future unattended scheduling, production enrollment and broader
capacity/retention policy remain separate rollout work. Power Automate submits and
polls; it receives no cron secret and implements no second provider client.

## Historical evidence boundary

Everything below preserves November 12–13 receipts and the decisions then in force.
References to an unbuilt Summary path, open intake ordering or required staff marker
are superseded by the current contract above. Historical reviews do not approve the
new branch build, and completed trial instructions are not authorization to rerun it.

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

## Historical receipt: Bounded operator driver: implementation and live use

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

## Historical receipt: Deployment timing and completed live trial

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

## Historical receipt: Source-decision reconciliation (2026-11-13)

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

## Historical receipt: Offline Summary source adapter (2026-11-13)

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

## Historical receipt: Offline permanent reservation safeguards (2026-11-13)

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


## Historical receipt: Offline staff-edit protection (2026-11-13)

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
model. Runtime references to the new exports are absent; only test suites import
them. The existing runtime marker/integration requirements above remain open.


## Historical receipt: Offline workflow composition rehearsal (2026-11-13)

[VERIFIED via `tests/integration/prompt-jobs-summary-rehearsal.pg.test.js` and local
PostgreSQL] The rehearsal composes `createSummarySource`, the edit-protection helper,
`advanceJob` and `createPromptJobStore`. Migration 097 is applied unchanged to a
randomized schema in a disposable loopback PostgreSQL database. The existing
`synthetic.executive-summary` capability writes only the fake `fixture_summary`
destination. No production capability, admission rule, worker or schema is changed.

Trace: synthetic admission → real narrative adapter/sealed snapshot → marker-aware
fake target capture → fake Executor dispatch/response hooks → real validation and
SQL checkpoints → fake audit → real frozen publication → fake conditional
record write → durable readback/replay. The fake record models atomic text/marker
saves. Exact source naming remains a candidate convention awaiting the intake
producer; the test does not settle it. No ready flag or actual marker column exists
in this fixture. Test authorization checks fixture identity, not live staff policy.

| Invariant | Evidence |
| --- | --- |
| Narrative reaches generation | Fake Executor verifies sealed snapshot, narrative text and authoritative synthetic PI; combined PDF and applicant abstract are present but excluded |
| Early staff intent survives | Edit-clear, blank clear, whitespace and unreadable marker block dispatch |
| Later edits survive | Edits/clears during generation cause original-ETag publication conflict; no retry |
| Source drift prevents work | Changed source before dispatch and before publication blocks the corresponding side effect; missing narrative does not fall back |
| Duplicates stay bounded | Concurrent admission and overlapping ticks yield one generation/audit/publication; successful replay after staff clear and content expiry preserves the clear and reservation |
| Uncertain outcomes stay fenced | Lost generation response and lost publication acknowledgement, with and without an applied fake write, never cause automatic retry |
| Real Summary remains disabled | Generic and machine admission reject `proposal.executive-summary` initialization |

Important separation: synthetic known pre-dispatch failures may release their slot.
The companion `prompt-jobs-summary-reservations.pg.test.js` separately proves real
Summary receipt retention through failures/expiry using hypothetical SQL receipts.
Neither suite claims an admitted real Summary end-to-end path. No capability mock,
production guard removal or runtime admission bypass was introduced for the rehearsal.

Verification after the resilience follow-up: 107 tests across four suites passed,
including 28 rehearsal cases, 10 companion reservation cases and 69 source/edit-helper
unit cases. The initial composition build passed 96 tests before that follow-up. Temporarily
removing the helper's marker guard made three rehearsal tests fail; the original
helper was restored. Independent read-only review found no material issues. Tests
use fake PDF extraction, Executor, authorization, audit and Dataverse behavior;
there is no live evidence for those systems. Audit failure and simulated interruption/
lease expiry are covered by the resilience follow-up below; actual process kills
and provider checkpoint-binding validation are not exercised by this suite. The real worker's
unmapped Summary-source preparation error propagates safely in the missing-source
case; future integration still needs explicit error/status semantics.

Only tests and branch documentation changed. Intake decisions, external-writer
coverage, Dataverse schema/security, Summary activation and Connor's existing test
remain untouched. No provider, Graph, Dataverse, cloud database or deployment calls.

Scoped ESLint, documentation currency/catalog/symbol gates and sequential available
self-tests passed. The restored-marker rehearsal passed all 17 cases again. The
new disposable PostgreSQL container and its volume were removed after verification;
the pre-existing roster database container was left untouched.


### Offline interruption and recovery follow-up (2026-11-13)

[VERIFIED via the same rehearsal suite and isolated PostgreSQL] Eleven additional
cases exercise the real worker/store recovery boundaries. The fake Executor now
separately counts generation and validates supplied saved-response content, allowing
two Executor invocations to prove one generation. These tests model interruption at
durable checkpoints, not OS process termination or live provider behavior.

| Invariant | Evidence |
| --- | --- |
| Audit failure/uncertainty blocks publication | Definitive failure and lost acknowledgement before/after a fake audit record exists; no audit retry |
| Saved response is reusable without regeneration | One durable attempt, two validation invocations, one generation; expired response never regenerates |
| Abandoned side effects remain fenced | Real generation/audit/publication dispatch intents followed by fixture-only SQL lease expiry become unknown under replacement worker |
| Work before dispatch can resume | Expired pre-intent lease safely completes with one generation/publication |
| Old lease cannot alter replacement state | Late response/audit/publication completion and old release return null, preserving recovered receipts; old lease cannot release an active new lease |
| Still-running worker cannot save late response | Generation waits on a controlled barrier while a replacement worker recovers the expired lease; resumed old worker saves no response and makes no publication |

Independent read-only review identified a possible test hang if the old worker exited
before reaching the generation barrier. The test now races barrier entry against early
worker completion/rejection and a bounded startup timeout, with barrier/timer cleanup
in finally. All 107 tests passed after this fix. No production source, schema, intake
policy, actual marker column, external service, deployment or Connor fixture changed.
The existing synthetic known-failure release exception and disabled real Summary
admission remain explicit. This completes the planned offline resilience pass;
remaining Summary integration depends on Connor's intake answers and writer coverage.

Scoped ESLint and documentation currency/catalog/symbol checks with sequential
available self-tests passed. The follow-up disposable PostgreSQL container and its
volume were removed; the pre-existing roster database remained untouched.
