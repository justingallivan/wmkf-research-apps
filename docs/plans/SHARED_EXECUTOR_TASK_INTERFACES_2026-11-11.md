# Shared Executor task interfaces

**Status [BRANCH-BUILT, offline fixture and default-off Sandbox runtime], [LIVE-VERIFIED, local trial through authenticated withholding], and [PLANNED, broader caller integration].**
This checkpoint coordinates the proposal-draft and expertise recommendation
streams. The shared infrastructure owner controls the capability
registry, Admin compiler, authorization, Executor, worker and ledger. The roster
owner controls expertise inputs, validator semantics and staff presentation. Pin
both branch revisions before handing off changes to shared modules.

## Verified branch baseline

[HISTORICAL BASELINE, VERIFIED via source at `0c4b8d39c`] The proposal branch had four registered
capabilities, two synthetic and two staff proposal tasks. The staff flow is a
restricted, default-off trial. Its drain is unscheduled. `parseExecutionSpec`
allows raw or JSON parsing, but `validateProfileOutput`, the worker's selected
output, `saveValidated`, and scoped result reads require text. `readStaffResults`
projects validated text only. The configured and effective token gates both use
1,536. The version-1 checkpoint already binds the resolved budget with the
prompt row, snapshot integrity and Request ID. Migration 097 separates private
expiring content from durable receipts. Machine admission and polling remain
planned. [Capability registry](../../lib/services/prompt-jobs/capabilities.js), [profile](../../lib/services/prompt-jobs/profile.js), [Executor](../../lib/services/execute-prompt.js), [worker](../../lib/services/prompt-jobs/worker.js), [store](../../lib/services/prompt-jobs/store.js), [staff service](../../lib/services/prompt-jobs/staff-service.js), [job architecture](SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md).

[VERIFIED via roster branch `a29c30826`] The roster rehearsal's
`roster-match-contract.js` validates GUIDs and category and lead eligibility against
its own roster snapshot and adds canonical names. It uses a separate runner and
has a sandbox/local target guard. Its single and batch rehearsals cover the
separate runner. Shared-worker integration and Production cutover remain planned. The roster stream's
`docs/plans/data/expertise-roster/POWER_AUTOMATE_RECOMMENDATIONS_PLAN_2026-11-11.md`
contains the proposed domain schema and read envelope.

## Offline shared runtime implementation

[VERIFIED via branch source and loopback PostgreSQL] The shared runtime uses
the frozen pure recommendations contract in an internal fixture. Admission
requires `environment:'test'`, an `expertise-fixture:<lowercase GUID>`
authorization scope, and one `expertise.recommendations` `generate-draft`
task. It has no business writer. The fixture pins execution metadata v2,
compiler version 1 and `expertise-recommendations-v1`. It caps the
configured and effective output at 4,096 tokens. Existing text tasks
keep their 1,536-token cap, v1 seal/checkpoint binding and result shape.

The fixture prepares a v2 HMAC-sealed snapshot, checks the visible roster
record against the private roster, and wraps the visible record once
after the document cache boundary. The response checkpoint binds the
effective budget and frozen contract and seal. The Executor validates
the closed recommendations JSON against the frozen roster before the
worker commits a typed result and separate content-free audit. Migration
097's existing content rows and lease fences persist both. The internal
five-part owner-scoped reader checks retained content integrity, expiry
and type. It provides no live freshness assertion.

Admin preview and publication reject the fixture capability. No HTTP
route or client DTO, real source adapter, live audit attribution,
machine authorization, PA integration, schedule or deployment is part
of the fixture. The remaining sections describe the planned caller
and domain integration. [Executor contract](../EXECUTOR_CONTRACT.md#typed-recommendations-fixture),
[ledger](../atlas/postgres-prompt-jobs.md#typed-recommendations-fixture).

## Offline recommendations read facade

[VERIFIED via branch source and loopback PostgreSQL] The server-only
`createRecommendationsReader` accepts normalized Request and job GUID
selectors. It checks a trusted injected staff authorizer, then resolves
an independent `app:`-namespaced job owner in the test fixture scope.
The scope GUID identifies the cohort independently of the Request ID.
The store requires all five owner predicates, a sole recommendations
task, draft operation and no destination or writeback. An invalid,
unauthorized, missing or foreign selector yields no job envelope.

`readStatus` returns only `jobId`, `requestId`, `taskKey`,
`contractVersion`, `expiresAt` and task `state`. It reads ledger metadata
without loading proof or result payloads, invoking source or roster
observers, or mutating the ledger. `readResult` can load a hash-checked
proof from retained configuration for a validated result. Admission
validates the optional `fixture-documents-v1` proof and snapshot save
checks it against document identities in profile role order. The proof
contains a hash and version. The full v2 seal separately covers source
text. A replay keeps the original frozen proof. A proofless legacy fixture
can return status and cannot establish a current result.

The result method compares fabricated source and complete roster
observations against frozen fingerprints. An unverifiable observation
takes precedence over a known change. It rereads receipt identity,
version, hashes and expiries after observations, then uses the scoped
typed reader only when both observations are current. It checks owner
binding again after the payload read and reauthorizes the original
staff subject as its final asynchronous step. A database-clock sample
plus conservative monotonic elapsed time fences job, configuration and
content expiry. Only `available` and `current` include the unwrapped
canonical result. A validated result can survive a separate audit
failure and source cleanup while its own proof and payload remain
retained. Source and roster freshness are bounded observations.

This fixture does not select a real source placement or install HTTP,
DAL, real authorization or source/roster adapters, PA, scheduling or
deployment. [Ledger](../atlas/postgres-prompt-jobs.md#typed-recommendations-fixture).

## Sandbox recommendations read

[VERIFIED via branch source] `GET /api/expertise-finder/recommendations` accepts
exactly a Request GUID and job GUID. A coarse default-off target check
precedes the generic app guard. The route requires a linked staff session
with the Expertise Finder app and an exact server-owned grant for one
Request, job, staff profile/SystemUser, machine app and cohort. The service
rechecks the linked Postgres profile, enabled Sandbox SystemUser and active
Sandbox app grant around the read. The DAL context supplies trusted
execution. The grant supplies entitlement. Foreign or unmatched jobs
return the same non-enumerating 404 and responses are private, no-store.
[Configuration](../CREDENTIALS_RUNBOOK.md#optional--sandbox-expertise-recommendations-read).

The read-only ledger accessor selects the sole recommendations draft
under the exact five-part owner scope. Result delivery requires a retained
`ai-materials-combined-pdf-v1` proof bound to the registered Sandbox host
and the `proposal` role. A fixture proof cannot establish a current
Sandbox result. The source observer resolves the Request's one exact
accepted AI Materials PDF, verifies identity and version before and after
a bounded 20 MiB PDF download and hashes the actual bytes. It loads no PI
record and performs no extraction. Both source and roster observations must
match the retained Sandbox target and input fingerprints before result
projection. The route reuses the offline facade's receipt, owner,
authorization and expiry fences.

The GET remains read-only. The local operator trial below supplies a
separate admission path. A signed GET returning an available, current
Sandbox result remains unverified. The trial uses Sandbox Dataverse and
the approved shared PostgreSQL ledger. PA and deployment remain outside
the trial.

## Local Sandbox recommendations trial

[VERIFIED via branch source at `2a0f4d6bd` and loopback PostgreSQL]
The default-off operator service reuses migration 097. It pins the
registered local Sandbox target, the configured PostgreSQL database,
one staff actor, one backend app, one Request and a fixed cohort and
idempotency key. The service verifies current staff access and checks the
exact prompt, profile, combined PDF, complete roster and budget before
new admission. A transaction lock spans both Sandbox environment labels
in the pinned database. Exact replay precedes a singleton quota that
counts every existing Sandbox recommendations job, including expired
or terminal jobs. The only task is a typed draft without a destination.

The producer extracts text from the exact verified PDF bytes and
freezes the source proof and roster digest. The worker rechecks
staff access, source and roster before dispatch and after checkpointing
the response, before retaining an accepted result. Confirmed input or
access changes fail validation. Unavailable evidence can leave a saved
response for explicit zero-call recovery. The shared Executor pins
Sonnet 4.6 and 4,096 output tokens, with a 195,000 encoded-input bound
and 5,000 additional tokens in the cost estimate. It makes at most one
provider request, with retries, fallback, parameter repair and redirects
disabled. The reviewed worst-case estimate is $1.665101. The existing
content-free audit stays pending without an adapter. Source and response
content expire at 24 hours, and configuration, result and audit content
at seven days. Exact-job operator cleanup preserves receipts and quota
history. [Executor contract](../EXECUTOR_CONTRACT.md#local-sandbox-recommendations-trial),
[configuration](../CREDENTIALS_RUNBOOK.md#optional--local-sandbox-recommendations-trial).

[VERIFIED via approved SharePoint copy journal and governed read-only preparation]
On 2026-11-11 the operator copied the combined PDF from Production Request
1003384 to the newly created `AI Materials` folder of Sandbox Request
1000339. The approved copy created that folder and
`ProposalNarrative_1000339.pdf` only. The 1,311,649-byte file matched the
Production source SHA-256
`d7e31d37ed2163e29ade2bf878720af34582bcf10e7c8252a223c3dd79a20c44`.
The Sandbox source adapter verified the file identity and version and
successfully prepared it read-only. Production was read-only, and the
Sandbox copy remains in place.

[VERIFIED via local commands] The runtime regression passed 436 tests
across 19 suites, including all three real loopback PostgreSQL job
suites. Coverage includes replay and quota isolation, the zero-retry
transport, and retaining a saved response when the app-grant lookup
cannot establish access. The environment-file-free guarded build at
the same revision exited zero with four existing DOCX tracing warnings.
Scoped lint, types, DAL/context, Atlas, enum, migration, model and prompt
tagging gates passed. The read-only application ledger probe found no
fixture-only schema constraint or existing expertise job. The reviewed
plan and implementation summary returned READY WITH NAMED CHANGES
from Opus 5.5. The subsequent exact-packet source review also returned
READY WITH NAMED CHANGES. The runner checks the exact database endpoint
as well as the database identity. The configured application PostgreSQL
database is shared by Production and Preview, even with Sandbox Dataverse.
The owner explicitly approved one scoped trial on the shared ledger.
[Opus source review and dispositions](../audits/EXPERTISE_SANDBOX_ADMISSION_OPUS55_2026-11-11.md).

### Live Sandbox trial outcome

[VERIFIED 2026-11-11 via controlled runner, ledger and audit readback]
Sandbox Request 1000339 used the approved combined PDF and the complete
Sandbox roster. The runner published and verified one profile and one
prompt in Sandbox Dataverse, admitted one job in the approved shared
PostgreSQL ledger, and sealed the snapshot before dispatch.

| Receipt | Value |
| --- | --- |
| Profile publication UUID | `a2c5629d-14e2-4eb8-9f5e-015cab42133c` |
| Sandbox prompt row | `d190a925-f060-4ac6-acf2-88b63a61ee7f` |
| Shared PostgreSQL job | `d85b9e13-a7a1-44a9-ae39-5961f4a9696a` |
| Sandbox failure audit | `2071381b-d4b7-4279-8f33-ce26e42f7dc1`, delivered and read back |
| Provider | One Sonnet 4.6 request, 14,190 input, 2,325 output, 21,376 cache-write and zero cache-read tokens |
| Cost | $1.105236 preflight ceiling, $0.157605 estimated from usage |

The saved response passed the closed JSON shape check. Offline validation
of that exact checkpoint found `consultant_overlap[2]` used a valid roster
GUID in the Board category, where the contract required Consultant.
The live task recorded `failed_validation` / `profile_output_invalid`.
It retained no validated recommendation result. The separate
content-free audit was delivered by the Sandbox backend app without
staff impersonation. The trial proved live publication, admission,
snapshot and dispatch fences, response checkpointing, validation denial
and audit delivery. It produced no usable recommendations. The
operator made no paid retry, Request-field write or deployment.

A normal Microsoft OAuth session then read the exact job through the
local signed GET. The browser showed only the Request and job IDs,
task key, contract version, expiry, `status: unavailable` and
`freshness: unknown`. The separate anonymous GET returned 307 to
sign-in. This verifies authenticated withholding after a failed
generation. A signed GET with an available, current recommendation
remains unverified. The local server was stopped after the check.

### Sandbox trial retention

The operator must run exact-job expiry after **2026-11-12 22:19:56.668 UTC**
for source and response content, and again after **2026-11-18 22:19:56.668 UTC**
for configuration and audit content and any retained result content.
This run has no retained result. The operator runner requires the
original private trial directory and pinned database and job identity.

```sh
node scripts/run-expertise-sandbox-trial-1000339.cjs expire /private/tmp/wmkf-expertise-sandbox-trial-20261111
```

The deletion checks are pending until those deadlines. The approved
SharePoint copy and ledger receipts remain in place.

## Capability and result path

[PLANNED] The published task pins its capability and result contract version
alongside the current profile/compiler, prompt and model revisions. Admission
freezes them. Capability lookup is code-owned. A request cannot select a validator,
schema, budget or destination. Preserve every existing text receipt and its
checkpoint binding. Unknown type, version or capability combinations fail closed.

| Task group | Result and operation | Output ceiling at both gates |
|---|---|---|
| Existing synthetic and proposal tasks | Existing text contract, operations and destinations | 1,536 tokens, existing profile limits |
| `expertise.recommendations` | `expertise-recommendations-v1` structured recommendations, `generate-draft`, no destination | 4,096 tokens, 128 KiB total canonical result |

The shared registry supplies the ceiling to Admin publication and admission for
the configured value, and to the Executor after resolving the actual call budget
and before dispatch. Both require a positive integer within the pinned capability
ceiling. Use the approved model and reserve the resolved output budget when
checking composed input size. Bind the effective budget, sealed snapshot integrity and frozen capability,
compiler and validator versions in the expertise checkpoint. Preserve the
existing version-1 text checkpoint binding and the response-byte guard. Check encoded size including
JSON escaping, wrapping and metadata. An oversized record, response or result is
a bounded failure. Do not truncate evidence, swap models or regenerate a saved
response.

The Executor checkpoints a received response before validation. Its profiled
post-response step runs the frozen expertise validator against that response
and the exact frozen roster, including on checkpoint recovery. Reject extra
model keys recursively before generic JSON normalization can discard them.
Then apply `rosterMatchSchema` and roster identity/category/eligibility rules.
Canonical names, `roster_contract`, `roster_warnings` and
`no_lead_recommendation` come from code. The result retains the roster domain fields,
including nullable leads, consultation, overlap, board interest, gaps and
conflicts. Reject malformed present optional members and the same GUID in both
lead slots. An empty eligible lead set can yield a valid result with no lead
recommendation.

The worker carries the approved result type through `saveValidated`. The store
atomically attaches validated content under the existing attempt fence. Use the
existing content/receipt tables and bind the type and validator version to the
frozen task and result; exact encoding is an implementation review decision.
Check kind, type/version, integrity hash, byte limit and expiry on reads. Keep
existing string validation and text DTOs. The typed object goes through a dedicated
capability projector. Unvalidated checkpoints, private config and raw snapshots
have no consumer DTO. Validation or audit recovery cannot dispatch a second
model call for a checkpointed attempt. Ambiguous dispatch remains an operator
case. A failed audit does not erase already validated data.

The offline result facade implements the planned staff recommendation envelope `{jobId, requestId, taskKey, contractVersion,
status, freshness, expiresAt, result?}`. The domain `status` values are `available`,
`not-ready`, `unavailable` and `expired`. `freshness` is `current`, `stale` or
`unknown`. Use `unknown` if no freshness check can apply. Emit `result` only for
an authorized, validated, unexpired result with current inputs. Stale/unverifiable
results stay private and require an explicit new authorized job. This read-time
freshness check is verified with fabricated observations. The existing staff
text projector has no such check. Use
safe codes for unavailable details. The aggregate job status vocabulary remains the shared
one. The recommendations operation has no business writer for assignment, invitation,
notification, Contact/User, Request fields or history. The result field
`staff_assignment` describes proposed leads.

## Versioned source and frozen eligibility

[VERIFIED via `createProposalSource`] The current staff adapter selects a single
accepted AI Materials narrative plus the stored Project Leader name. Its manifest
binds Request, item/ETag/version and PI identity/hash. `prepare` rechecks identity
around bounded download and extraction. `isCurrent` compares the manifest with a
fresh inspection. This policy remains scoped to the existing staff cohort.
[Proposal source](../../lib/services/prompt-jobs/proposal-source.js), [staff trial](SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md).

[PLANNED] Use a server-selected adapter with a frozen policy/version and three
operations. `inspect({requestId})` identifies the approved Request-linked roles
and immutable selection. `prepare({manifest,scope,profile,nonceSecret})` verifies
the same selection and returns a sealed, bounded snapshot with ordered item
identities, byte hashes, extraction revision, bounded text and applicable
assemblage lineage. `isCurrent({manifest})` returns current or changed, with a
typed failure for unverifiable input. Recheck relevant identity and provenance
around reads, before dispatch and before showing a roster recommendation as
current. Changed or incomplete reads cannot substitute another item. Cross-system
freshness checks are bounded observations. Freeze adapter version with the task
and reject unsupported versions during recovery.

**[OWNER DECIDED 2026-11-11, initial integration]** Use one PDF containing
the proposal narrative and bibliography in the Request's active AI Materials
folder. The starting example is `ProposalNarrative_1003384.pdf`, verified in
the controlled staff trial. The planned adapter reuses the accepted
Request-number narrative filenames and requires a unique match in that
folder. Missing or ambiguous files withhold the source. A broader source
policy and other assemblage formats remain open. Verify the exact file
identity, extraction and cache compatibility for the new integration
before live use. The staff trial and other existing callers keep their
own source policies. This decision authorizes offline work. Live reads,
writes, provider calls and deployment require separate scope and approval.
No future Phase I staff-version document is part of this direction.
[Staff trial source receipt](SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md#verified-owner-uploaded-trial-source).

Reuse a cache prefix only after confirming exact protected bytes,
profile/system and schema compatibility, authorization domain, model and
measurements under separate trial approval.

[PLANNED] The roster manifest freezes `contractVersion`, canonical `rosterHash`,
ordered profiles with GUID, category, active/lead flags, relevant expertise hash,
ETag and linked User GUID, the complete candidate User set and each disabled
state, and `eligibleLeadGuids`. Retain disabled candidates in the fingerprint.
The sealed snapshot also carries the matching full expertise, canonical names
and warnings for invalid excluded profiles. Use server-owned read-only roster
and User access under explicit DAL context and target interlock. Require complete
reads and an explicit boolean disabled state for each candidate User. Use the new
complete snapshot builder with the existing `validateRosterMatch` contract. Hash
the same relevant fields when rechecking so a disable or re-enable invalidates
prior recommendations. The fingerprint is reproducible from those fields and the
algorithm version, without a timestamp, nonce or original snapshot. Incomplete
reads stop preparation and yield unknown freshness on result reads.

Use a roster-only versioned extension to the sealed snapshot for typed private
roster context. It is never rendered to the model and expires with source bytes.
Capture the complete roster fingerprint and version at admission and compare
them during preparation and before dispatch. Retain those values and the bounded
source selection in task configuration for authorized result freshness checks
after source content expires. Recovery after snapshot expiry fails closed.
The staff trial uses a separate seven-day configuration lifetime. Configuration
is outside the Executor's version-1 checkpoint binding. This placement keeps full roster content
on the source lifetime and binds it through the new snapshot integrity check.
There is no general hidden-record flag or caller-selectable extension.

The visible `roster_block` holds the exact formatted expertise and GUID catalogue
with eligible leads produced by `buildRosterV2Variables`. Rebuild that block from
the sealed typed roster and require exact equality before dispatch and checkpoint
validation. A capability-scoped compiler revision renders the exact block once
as wrapped data after the proposed cache marker. The current compiler JSON-escapes
a frozen record and renders it twice, and record provenance is capped at 1,024
bytes. Preserve existing text composition. Verify the
64,000-byte encoded record limit, 4 MiB sealed snapshot limit, actual wrapped
prompt size and model context fit with full fabricated rosters. Reject overflow
without omitting entries. Golden prompts cover legacy instruction parity, data
boundaries and one unambiguous output contract.

## Authorization and retention

[PLANNED] Machine admission and polling use an allowlisted app principal derived
server-side from verified single-tenant Entra app-only identity and role. Recheck
current local principal policy and Request/task scope on replay, polling and
worker dispatch. Expertise needs its own allowlisted authorization scope and
enablement, with the existing proposal cohort rules preserved. Staff result
access requires a current linked staff identity, current expertise app access
and an explicit server-owned entitlement scoped to the Request, job and
recommendations task. The generic app guard's cache and trusted DAL context
do not establish that entitlement. The server resolves the machine-owned job
under the authorized Request and task, then calls an owner-scoped ledger read. Keep all existing ledger owner predicates
and submitting-principal audit identity. Do not accept a principal selector from
either caller or widen user-private expertise history. Reauthorize the read and
recheck freshness before exposing content. The offline facade exercises these
checks with injected authority. Foreign jobs return non-enumerating responses.
PA polling with a result reference for the staff viewer remains planned.
Polls perform no proposal or roster freshness reads.

Use the existing trial retention defaults as proposed initial values, 24 hours
for source/response and seven days for configuration/result. Expire exact content
while preserving receipts and idempotency identity. The current cleanup covers
only the scoped staff trial. Machine jobs need an approved cleanup scope that
works after caller revocation. The current Dataverse AI-run audit impersonates
the staff actor. Machine jobs need an approved content-free audit attribution
and writer contract with no invented human identity. Both are release gates,
alongside PA connector proof, worker scheduling, recovery and roster cutover.
[Machine authorization and status contract](SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md#machine-authorization).

## Integration gates

| Boundary | Evidence required before advancing |
|---|---|
| Config → Executor → worker → ledger → DTO | Offline fixtures prove cap at configured and resolved gates, exact JSON byte bounds, and current text receipt replay with zero provider calls. Fail the slice if a capability inherits the wrong cap, an unknown JSON key is dropped before validation, an object reaches a text DTO, or a changed validator version can replay a checkpoint. Mismatched or recovered checkpoints make zero provider calls. |
| Source → validator → read | Test complete and truncated/paged rosters, empty leads, partial/failed User reads, disabled/re-enabled User, changed file/version, unknown GUID/category, hostile input, unsupported claims and encoded bounds. Change source or roster after validation with no worker tick and require a stale result status with no payload. Hidden roster bytes in the prompt, visible/hidden roster mismatch, duplicate leads, a stale result displayed as current, or an assignment writer call blocks integration. Grounding fixtures and human review are quality evidence distinct from deterministic length/schema checks. |
| Request/actor → receipt → result | Prove foreign tenant/audience, delegated, role-less, revoked and out-of-Request identities fail. Cross-owner reads must preserve ledger scope. Cover lost POST, concurrent replay/conflict, expired result, current result after 24-hour source cleanup, crash and audit recovery, and stale UI response after Request change. PA rehearsal begins with a no-model auth and idempotency proof. |
| Repository and release | Run the existing real PostgreSQL suites `prompt-jobs.pg.test.js`, `prompt-jobs-executor.pg.test.js` and `prompt-jobs-staff.pg.test.js` against disposable loopback PostgreSQL plus the new typed-path cases. Run route/security, Atlas and migration-manifest gates for new surfaces, DAL/context and injection-tagging gates, status enum parity, focused lint, types and build. Run each changed gate's existing self-test after its gate. Verification of the chosen initial source, operations, connector proof and a separately approved live validation run precede release. |

Contract reconciliation covers transition invariants and consumers above. The
planned ledger change reuses existing tables; verify migration/setup/Atlas parity
if reviewed implementation adds a schema change. No business writer is in scope.
The checked-in shared runtime establishes the offline fixture described above.
The remaining integration gates apply before enabling any live caller.

## Review

Ordinary Claude Opus 5.5 subscription review of the interface plan returned
READY WITH NAMED CHANGES. The follow-up verified both plans and closed the
findings. Both receipts report only `claude-opus-5-5` model usage. The shared
machine audit and cleanup gates remain open for implementation.

## Offline implementation verification

The shared runtime is recorded in commit `7d0cf0392`. It imported the
reviewed six-file pure contract subset
from roster commit `f93f88478`, plus the jsdom schema-import correction and
regression from `9cc1dbd4e`. That import adds no roster service, route,
write adapter or production integration.

The initial ordinary Claude Code OAuth build-review attempt hit its turn
limit and returned no verdict. A bounded patch review returned READY WITH
NAMED CHANGES. Both receipts report only `claude-opus-5-5` model usage.
The review requested typed-only terminal preparation errors, an
order-independent store snapshot guard, tighter normalized-result shape
checks and verification of all text result readers. It also called for
negative coverage across snapshot versions, checkpoint audit recovery,
Admin publication and the existing text token cap. The follow-up code scopes
terminal preparation errors to the expertise fixture and identifies its
single task independently of row order. Commit and read checks require
the normalized result's closed top-level keys and field types. The
Executor separately checks domain eligibility against the sealed roster.
The caller search found two readers that request result content by kind.
The scoped result reader enforces the selected contract, and fixture
publication requires text and its registered synthetic destination. The final
targeted Opus 5.5 review returned READY and closed all four findings. Its
model-usage receipt named only `claude-opus-5-5`.

[VERIFIED via local commands] The focused regression run passed 380 tests
across 25 suites, including all three real PostgreSQL job suites in disposable
loopback schemas. Added cases cover legacy text binding and cap parity,
snapshot-version and roster-fingerprint mismatches, checkpoint rejection
through audit delivery, closed result envelopes, owner-scope reads and
result retention after source cleanup. Provider and audit effects used
test doubles.

The first local application build passed after loading the worktree's
ignored `.env.local`. The final build superseded it and exited zero in a
temporary current-source copy without environment files or application
credentials, with a loopback-only Node socket guard. It retained four
existing DOCX tracing warnings and the `_app` static-optimization warning.
This is local build evidence.


## Offline facade verification

Runtime commit `c9777bc87` imports the pure roster comparator and its tests
from `b0b69b90a` and adds the offline facade. The ordinary Opus 5.5 OAuth plan review returned READY WITH
NAMED CHANGES. The implementation applies its eight findings to proof
admission and save, immutable replay, receipt/version checks, DB-clock
expiry, profile-ordered source metadata, non-enumerating failures,
machine-owner scope and the returned envelope. The build review and the
focused final review both returned READY. All three receipts name only
`claude-opus-5-5`.

The follow-up adds a status owner-rebinding regression and an explicit
configuration expiry check. The store can record a task as `expired`
before a result exists. The result facade reports that case as
`unavailable` while the job remains within its retention window.
Content cleanup deletes only expired bytes and keeps the validated
receipt. An expired or deleted result then returns `expired` without
a payload. An audit outcome does not itself invalidate a retained result.


[VERIFIED via local commands] Final verification passed 409 tests across
26 suites, including all three job suites against disposable loopback
PostgreSQL. Tests cover metadata-only SQL, no reads for denied selectors,
owner and actor changes across awaits, proof replay, malformed and changed
observations, deleted or corrupt results, and expiry during final
authorization. The application build exited zero in an environment-file-free
source copy with the non-loopback Node TCP guard. Four existing DOCX
tracing warnings remain. Scoped lint, types and repository gates passed.
All staff, source and roster observations were fabricated.


## Sandbox read verification

Runtime commit `6fe01c88e` integrates the common read path and strict roster
transport. The ordinary Opus 5.5 OAuth plan review returned READY WITH NAMED CHANGES.
Its dispositions pin staff identity and app grants to the same Sandbox
target, require an exact active grant row, withhold unmatched jobs behind
a common 404, derive Request number from the bound Sandbox row, and preserve
the existing PI-dependent staff source behavior. Roster transport and
common route code have separate owners.

The build review returned READY WITH NAMED CHANGES. It required strict
helper arguments and default adapter wiring tests, inverse Sandbox ledger
and fixture-scope cases, and landing the strict roster transport with its
common route caller. The fixes and their inverse tests passed locally.
Both completed reviews named only `claude-opus-5-5` in model usage.
The first automatic approval review rejected sending the final source
diff because it found the existing authorization insufficient for
that transfer. The owner subsequently approved the exact payload with
SHA-256 `a7af9f7d0a27ba9473998603d3641049966ca24b9edfaa511d5f34ce2ac43d24`.
The resulting no-tools OAuth review reported only `claude-opus-5-5`.

The closure review accepted the strict adapter changes, default wiring
tests, binding mismatch tests, roster import and origin alignment. It
identified one test gap in the reverse Sandbox-to-fixture read assertion.
That assertion ran after corrupting the Sandbox receipt's binding, so
the test lacked a positive read of the same valid Sandbox receipt.
The review identified no new runtime defect and gave a qualified verdict.
Test-only commit `ef5507ab8` adds an available/current positive control
before the mismatch cases, restores the valid binding afterward, and proves
that the Sandbox read succeeds while the fixture reader denies it. The
fixture-to-Sandbox denial remains covered. The roster stream independently
reviewed the revised test. All 33 targeted vertical tests passed against
disposable loopback PostgreSQL, with scoped lint and diff checks passing.
The amended test was verified locally after the approved external review.


[VERIFIED via local commands] Before the test-only follow-up, the integrated
regression run passed 527 tests
across 32 suites, including all three job suites against disposable
loopback PostgreSQL. It covered strict Request/User adapter wiring,
complete roster paging and same-host inputs, legacy v1 source behavior,
inverse frozen configuration and owner-scope cases, and the route's
non-enumerating access checks. The environment-file-free source-copy
build exited zero with the non-loopback Node TCP guard and included the
new route. Four existing DOCX tracing warnings remained. Scoped lint,
types and repository gates passed. Test receipts and observations were
fabricated. This historical regression preceded the live operator
trial above.
