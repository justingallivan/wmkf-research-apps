# Shared Executor task interfaces

**Status [BRANCH-BUILT, offline fixture and default-off Sandbox runtime], [LIVE-VERIFIED, four bounded trials with one authenticated current result], and [PLANNED, broader caller integration].**
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
separate admission path. The fourth trial verified a signed GET returning
an available, current Sandbox result. The trial uses Sandbox Dataverse and
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
in the pinned database. Exact replay precedes the admission quota, which
counts every existing Sandbox recommendations job, including expired or
terminal jobs. The first job used the singleton rule. The authorized
successors require the exact audited predecessor lineage described below.
Each job has one typed draft task without a destination.

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
generation. At that point a signed GET with an available, current
recommendation was still unverified. The local server was stopped after
the check.

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

### Authorized role-prompt successor trial

The owner approved one bounded successor to the first Sandbox trial.
The [v2 candidate](EXPERTISE_SANDBOX_1000339_CANDIDATE_V2_2026-11-11.json)
changes only the task body. It instructs the model to use each GUID's
exact roster category, put Board recommendations in `board_interest`,
reserve `consultant_overlap` for Consultants, and leave arrays or staff
slots empty when no eligible candidate fits. The shared profile, typed
output schema, roster validator, source, model and token ceiling stay
the same. The candidate and role regression are in `8fb8dd00d`.
The 67 focused candidate and role-contract tests passed.

[VERIFIED via branch source at `2ae930fe2` and loopback PostgreSQL]
The second trial's admission followed these invariants.

| Boundary | Contract |
| --- | --- |
| Owner and quota | The same database-wide Sandbox transaction lock covers exact replay, count and insert. A fresh successor requires exactly one existing Sandbox recommendations job across both Sandbox environments and all owners. It must be the pinned first job, with its sole task and one attempt in `failed_validation` / `profile_output_invalid` and the audit delivered. |
| Frozen pins | The service verifies current access, prompt/profile, exact combined PDF, complete roster and budget. The store reconstructs the first command hash from its receipt and retained configuration using the same Request, staff actor, backend app, database, source and profile. New admission requires the first configuration to remain unexpired. |
| Successor identity | A new scope UUID, idempotency key, prompt GUID and the next prompt version distinguish the successor. Its exact replay returns the admitted job even after the first configuration expires. Both receipts remain quota-bearing. The transaction refused a third job at this revision. |
| Paid dispatch and retention | The successor has one draft-only task and at most one Sonnet 4.6 request at the existing 4,096-output-token cap. The same preflight cost, dispatch, checkpoint, audit and result guards apply. Source/response and configuration/result/audit expiry remain 24 hours and seven days respectively for each job. |

The 89-test regression across four suites, including all three real
loopback PostgreSQL job suites, passed. Scoped ESLint, types, Atlas and
its self-test, and migration manifest checks passed.

[VERIFIED via operator source at `2bc14a68d`] The runner checks the
existing profile publication and refuses a v2 settings write. It
creates the exact v2 prompt noncurrent, reads back the complete history,
then conditionally demotes v1 and promotes v2 using the ETag from each
full-row observation. Each write intent is fsynced before transport.
An incomplete switch stops for inspection. A completed switch reads
back v2 as sole current and preserves the v1 content and receipt.
The guarded environment-file-free webpack build passed at that
revision. Private v2 initialization and read-only source preparation
also passed.

[VERIFIED via the source review receipt] The ordinary OAuth review used
only `claude-opus-5-5`, one turn and 136,123 ms elapsed. The 115,491-byte
source packet SHA-256 was
`31fcd50ea53874260e47fd4af9874d00508ec0bf993f7e7d91ada0188eb1c882`.
The reviewer approved the role-only candidate and its tests with no
blocking findings, and approved the successor code conditional on two
source checks. The operator verified that `setIsCurrent` sends only
`wmkf_ai_iscurrent` and passes the supplied `If-Match`, and that
Dataverse annotations map `@odata.etag` to `_etag`. The recommended
initial ETag check landed in `ddfe6761f`, before the v2 create, while
the conditional demotion still uses the fresh post-create ETag.
Syntax and runner guard tests passed. The packet predates that local
fix. The candidate digest stayed fixed and the source review was not
rerun. The review noted that the stricter wording can still yield a
response the closed validator rejects. Publication and the live
outcome are separate evidence.

### Live successor outcome

[VERIFIED via scoped Sandbox readback and shared-ledger admission]
The operator reused the first profile publication and read back
Sandbox prompt `9935d70a-986f-481f-abae-28fe255c8996` as sole-current
version 2. The v1 row retained its body and became noncurrent. The
preflight input bound was 125,694, with 4,096 output tokens and an
estimated ceiling of $1.116198. The shared ledger admitted successor
job `ba425a76-1257-4b6a-a54d-1c7fc6ceb3fe` and saved its sealed snapshot.

[VERIFIED via the saved response checkpoint, audit readback and signed
GET] One Sonnet 4.6 request stopped at `max_tokens` after 4,096 output
tokens. The saved response was incomplete JSON. The task recorded
`failed_validation` / `claude_output_truncated` before reaching the
roster-role validator. The live response therefore supplies no verdict
on whether the revised prompt fixes the first trial's category error.
The job retained no validated recommendations.

| Receipt | Value |
| --- | --- |
| Sandbox failure audit | `60b9bab4-d197-4043-a3ed-0dd5b97bbfab`, delivered and read back |
| Provider usage | 14,475 input, 4,096 output, 21,370 cache-write and zero cache-read tokens |
| Cost | $0.1850025 estimated from usage |

The normal Microsoft OAuth session read only the second job's metadata,
with `status: unavailable` and `freshness: unknown`. The separate
anonymous GET returned 307 to sign-in. The local server was stopped
after the check. The two trials verify withholding on distinct validation
failures. An available, current recommendation was still unverified
at that point. The trial made no Request-field writes or deployment. At the time
of this run, both receipts counted against the two-job quota. The
separately approved third trial below tests a tighter response-length
instruction while keeping the closed JSON and role validator.

### Successor retention

The operator must run exact-job expiry after **2026-11-12 22:52:13.832 UTC**
for the successor's source and response, and again after
**2026-11-18 22:52:13.832 UTC** for configuration and audit content.
There is no retained successor result. Use the successor's private
trial directory and the original pinned database and job identity.

```sh
node scripts/run-expertise-sandbox-trial-1000339.cjs expire /private/tmp/wmkf-expertise-sandbox-trial-1000339-v2-20261111
```

These deadlines are separate from the first job's deadlines. The
approved SharePoint PDF and both quota-bearing receipts remain in place.

### Authorized response-length trial

The owner approved one bounded third trial after the second response
truncated. The [v3 candidate](EXPERTISE_SANDBOX_1000339_CANDIDATE_V3_2026-11-11.json)
has SHA-256 `0c5ae42ab2b1023b2c2e04200b2a4f71ac48f01b4892f15d23500904e99d9889`.
It changes only the task body, keeping the profile, typed output schema,
roster validator, model and 4,096-token output cap. The prompt requests
compact complete JSON within an 8,000-character target. It caps the
shortlist at three staff consultations, five consultant overlaps and
three Board recommendations. Rationales target at most 25 words and
160 characters, Board notes and conflict reasons 12 words and 80
characters, and the expertise gap 60 words and 400 characters. The
instructions preserve both lead slots, all identified visible-roster
conflicts, and material gaps. These are prompt instructions. The tests
show that the intended envelope can fit with fabricated responses, and
the live model's completeness remains to be measured.

[VERIFIED via branch source at `aaac59d2f` and loopback PostgreSQL]
The third trial uses the same default-off operator and shared-ledger
boundary.

| Boundary | Contract |
| --- | --- |
| Exact lineage | Under the same Sandbox-wide transaction lock, fresh admission requires the two exact prior jobs and no other Sandbox recommendations job. Each has one terminal task and attempt and a delivered audit. The v1 error must be `profile_output_invalid` and the v2 error `claude_output_truncated`. |
| Frozen pins | Both retained configurations must be unexpired. The store reconstructs the v1 and v2 command hashes from the exact receipts and requires the same Request, staff actor, backend app, database, source and profile pins. |
| Identity and quota | The third job uses a new scope, idempotency key and prompt GUID at version 3. Exact replay precedes new admission checks. All three receipts remain quota-bearing after cleanup. At this revision the fence rejected a fourth job. |
| Publication | The operator verifies the unchanged profile and the exact two-row prompt history, with v1 noncurrent and v2 current. It creates v3 noncurrent, conditionally demotes v2 and promotes v3 with same-observation ETags and persisted write intents, and reads back sole-current v3. The earlier prompt bodies and v1 state remain intact. Uncertain publication stops for inspection. |
| Dispatch and retention | One draft task permits at most one Sonnet 4.6 call after the existing source/roster, access and spend checks. The same checkpoint, validator, audit and read guards apply. Source/response expiry remains 24 hours and configuration/result/audit expiry seven days for the third job. |

The admission regression passed 90 tests across four suites, including
all three real loopback PostgreSQL job suites. The candidate/contract
run passed 74 tests, including seven compact-envelope feasibility cases.
The largest disjoint-conflict fixture combines 13 recommendations and
27 conflicts.

[VERIFIED via the plan review receipt] The 42,565-byte ordinary OAuth
plan review packet had SHA-256
`08654398ecf6a8d0b00bceccefb1e3f47a87bcb8cc3c3f66d34120aa06804a64`.
The one-turn review reported only `claude-opus-5-5` and returned
NAMED CHANGES. Its brevity feedback led to the full-shortlist and
disjoint-conflict fixture and clarified that both lead keys must be
included. An ambiguous publication intent requires a stop, a fresh GET
of complete history and ETags, and reconciliation against the recorded
receipt before a separately authorized corrective write. The runner
does not automatically retry or roll back that switch.

[VERIFIED via the compiled contract and source] The appended 2,775-byte
contract had SHA-256
`8d11c79bf021c4dfd6eeea47268defe9d7ebb1924b3f7f3ee6ae603cdf40efd8`.
It specifies the same seven fields, uses GUIDs without name fields,
allows an empty proposal summary and permits the shorter rationale
target. The composer places proposal text inside its nonce-framed
untrusted-document block. The shared provider path disables retries,
parameter repair, fallback and redirects. The operator saves the
provider intent before transport, and the store checks the quota
and writes the admission in one transaction. Publication targets
Sandbox Dataverse and exact prompt versions. The combined contract,
route and source run passed 94 tests across three suites.

The trial's primary pass criteria are `end_turn`, complete JSON,
closed validator pass and zero category violations. Secondary targets
are at most 3,000 output tokens and 8,000 JSON characters, compliance
with the requested per-field caps, and no duplicate recommendations.
Record only content-free diagnostics: stop reason, usage, parse and
validator status, issue paths, category, field counts, lengths,
duplicates and conflicted recommendation counts. A pass on this
proposal and roster supports the execution contract. Scientific
suitability and conflict-of-interest clearance require separate
review.

[VERIFIED via the source review receipt] The 214,589-byte ordinary OAuth
source packet had SHA-256
`64d581c7fc20f8c3356c19bb2796c9faceff0ec7bba97b264039a7bbcd4cb897`.
The one-turn review reported only `claude-opus-5-5` and 219,698 ms
elapsed. It passed the admission and replay changes and conditionally
passed the runner pending proof that an incomplete publication cannot
admit a noncurrent prompt. The exact-ID loader checks the pinned Sandbox
origin, the prompt GUID, current and published flags, and all required
fields. The trial service uses that loader and checks the frozen
definition. The Executor rechecks the budget before dispatch. These
source checks resolved the condition without a runtime change. The
runner enforces the body-only candidate comparison. Roster freshness is
checked within each run. The final digest and additional fixture were
verified locally after the reviewed packet. The external review was
not rerun.

### Live response-length trial outcome

[VERIFIED via scoped Sandbox readback, shared-ledger receipt, checkpoint
diagnostics, and signed GET] Sandbox prompt
`d4a0677b-58a9-46f7-a742-f9da5273cf62` became sole-current v3. The
operator reused the original profile. The shared ledger admitted
`21af0399-0fd7-4d5f-9eb2-b5a77d4ff1fd` and saved the sealed snapshot.
The frozen roster hash was unchanged across the comparison:
`479ef02955ff983bf1d60faa1fec281603d243988ee431ee3c25243f30b3ec81`.
The operator verified the private state directory had neither a lock
nor a pending state file before generation.

| Receipt | Value |
| --- | --- |
| Preflight | 127,266 encoded-input bound, 4,096 output tokens, $1.128648 estimated ceiling |
| Provider | One Sonnet 4.6 request, 14,806 input, 637 output, 21,369 cache-write and zero cache-read tokens |
| Cost | $0.13410675 estimated from usage |
| Sandbox failure audit | `35ce89a3-5ae2-479c-ba53-9df8c449333a`, delivered and read back |

The response stopped at `end_turn` and parsed as complete JSON at
2,074 characters. It met the total length targets. The task recorded
`failed_validation` / `profile_output_invalid` because the response's
top-level `resultContract` and `modelOutput` keys matched the
compiler's explanatory metadata wrapper instead of the closed model
output shape. The earlier compiled-schema check established that the
inner shape was compatible with the prompt, but left the wrapper
ambiguous. The live check establishes the mismatch, not why the model
chose that form.

A private diagnostic-only check of the inner object found unknown GUIDs
at `staff_assignment.secondary` and `board_interest[0]`, and a Board
candidate in `consultant_overlap[2]`. It counted two lead slots, zero
staff consultations, three consultant overlaps, one Board entry and
one conflict. Maximum rationale length was 19 words and 144 characters.
The gap was 337 characters and the Board note 44 characters. The
123-character conflict reason exceeded the 80-character target. The
diagnostic counted zero duplicate recommendations or recommendations
also listed as conflicts. The original checkpoint remained unchanged
and no validated result was retained. The trial met the completeness
and total-length targets and failed the schema and role criteria.

The normal Microsoft OAuth browser session displayed only the exact
job's metadata with `status: unavailable` and `freshness: unknown`.
An anonymous GET returned 307 to sign-in. The local server was stopped
after verification. The trial made no Request-field writes or
deployment. At this revision the ledger retained all three receipts and
denied a fourth job. This outcome motivated the offline native compiler below. A
post-trial regression confirms that the
validator accepts a valid inner recommendation object and rejects the
same object under the metadata wrapper. The focused contract suite
passed 75 tests, and the combined contract, route and source run
passed 95 across three suites. Runtime and prompt code remained as
tested in the live run.

### Third-trial retention

Run exact-job expiry after **2026-11-12 23:10:27.154 UTC** for the third
job's source and response and again after **2026-11-18 23:10:27.154 UTC**
for configuration and audit content. This job has no retained result.

```sh
node scripts/run-expertise-sandbox-trial-1000339.cjs expire /private/tmp/wmkf-expertise-sandbox-trial-1000339-v3-20261111
```

The deletion checks remain due. The SharePoint PDF and all three
quota-bearing receipts remain in place.

## Native recommendation output compiler

[BRANCH-BUILT, offline] A task explicitly selecting
`compilerVersion: 2` uses native JSON Schema output for the model-facing
recommendation object. This compiler version is independent of profile
revision and the stored `expertise-recommendations-v1` result contract.
The code-owned builder revalidates the frozen visible roster and emits
an explicit subset of the domain shape. It constrains each role's GUIDs
to that role and lead slots to eligible staff. Conflict GUIDs are drawn
from the complete visible roster. The model-facing schema puts the
recommendation fields at its root. The prompt asks for the recommendation
object directly, without the compiler metadata wrapper observed in the
third trial.

| Boundary | Design invariant |
| --- | --- |
| Empty categories | Omit an array property with no allowed GUIDs and let the existing domain default supply `[]`. Use null-only lead slots when there are no eligible leads. Never emit an empty enum. |
| Contract and transport | Compose the prompt contract from the same native schema supplied to the provider. `effectiveProviderOutputSchema` serves transport, trial preflight and Executor budget checks. Require model support and enforce local limits of 512 total enum entries and 64 KiB of encoded schema before dispatch. |
| Checkpoint | Bind the validated selected compiler version and the canonical effective-schema hash in compiler version 2. A builder change that alters the schema blocks replay of an incompatible saved response. Preserve the compiler version 1 payload and checkpoint binding byte for byte. |
| Parse and storage | Keep the frozen `spec.outputSchema` for parsing and write-result projection. The existing closed domain validator remains authoritative for GUID membership, role, duplicate leads, lengths and stored shape. No response unwrapping, repair, regeneration or validator weakening. |
| Trial scope | Keep the three published prompt rows, provider attempts, audits and ledger receipts historical. This offline increment adds no prompt publication, provider call, admission extension or fourth trial. |

[VERIFIED via the design review receipt and current domain source]
The one-turn ordinary OAuth review reported only `claude-opus-5-5`,
131,932 ms elapsed and a NAMED CHANGES verdict. The 86,145-byte packet
had SHA-256
`c2afca4e4e7e75f9d229c58e607db5354054a9f9f8e9a761766b0a029578e7c3`.
The existing domain schema makes all four category arrays optional
with `[]` defaults. It accepts null gaps text and an empty summary.
Keep parser and persistence on the frozen specification while the
effective schema governs generation, budgeting and the v2 binding.
The local enum and byte bounds are conservative safeguards. Offline
checks do not establish provider acceptance, grammar compilation time
or the provider's injected schema overhead at real roster size.
The domain helper was imported as `7b140b6ee` from roster commit
`94b361c04`. Follow-up `3ce88acb6` keeps conflict instructions
separate from the recommendation shortlist. Shared integration is
committed as `aa763f044`. The final unit run passed
225 tests across nine suites. The prompt-injection, DAL, OData and
context checks and their self-tests passed, as did lint, types and the
isolated environment-file-free production webpack build.

[VERIFIED via loopback PostgreSQL and mocked provider transport]
All 90 tests across the three PostgreSQL job suites passed. The
compiler version 1 fixture matches the pre-change composed bytes,
wire request and checkpoint binding. Compiler version 2 tests
capture the exact outbound native schema, match trial preflight and
Executor budgets, recover with zero provider calls, and reject a
changed schema on checkpoint recovery. The worker rejects duplicate
leads, unknown GUIDs, the metadata wrapper and other invalid outputs
after checkpointing a single response. Unsupported compiler, model
and schema configurations fail before dispatch. These are offline
transport and persistence tests.

[VERIFIED via the build review receipt] The 161,004-byte ordinary OAuth
source packet had SHA-256
`a46f3753ff827c4b05d9b56f9b03b8b49a416759c528dd0b7a821a9bd0d585b2`.
The one-turn review reported only `claude-opus-5-5` and 122,764 ms
elapsed. It passed the domain builder and gave the shared integration
NAMED CHANGES because the packet lacked results for the new real
PostgreSQL cases. The final 90-test run supplied the named refusal,
truncation, wrong-role, duplicate-lead and oversized-rationale
evidence, plus the later unknown-GUID and wrapper regressions. The
review required no code changes. The additional evidence was verified
locally without another review.

Native schema acceptance, grammar overhead and cache behavior remain
unverified against the provider. At the close of the offline compiler
work, a fourth trial still needed a new reviewed prompt, policy and
admission path, plus separate authorization. [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Authorized native-schema trial

[LIVE-VERIFIED] The owner approved one native-schema trial for the same
Sandbox Request 1000339 and shared ledger. The
[v4 candidate](EXPERTISE_SANDBOX_1000339_CANDIDATE_V4_2026-11-11.json)
has SHA-256 `2ee6db99915482d5d1f22dd7a523eb73c45fb63ddd2924a6468d285c10562fb7`.
It changes the task body and selects compiler version 2. The profile,
model, temperature, 4,096-token ceiling and result contract stay fixed.
It keeps the role and brevity instructions and asks for the direct
recommendation object, including empty arrays only for categories
present in the native schema.

[VERIFIED via the plan review receipt] The 114,345-byte ordinary OAuth
packet had SHA-256
`007bb41bf5850abe648c62860a84a84697a766608b8a7d51d7b85ab61e0035e7`.
The one-turn review reported only `claude-opus-5-5` and 106,664 ms
elapsed. Its verdict was NAMED CHANGES. The review requires the
operator to reconstruct each historical prompt row from its own
candidate, allow only the v4 body and compiler-selection delta,
and cross-check prior local receipts. It also asks for a test of the
actual provider wire shape and one-call failure handling, plus proof
that the closed version mapping preserves v1–v3 replay and binds v4
to compiler 2. The offline candidate check must exercise omitted
category arrays and the existing normalization to empty arrays.

The approved run permits one Sonnet 4.6 request after fresh source,
roster, actor, prompt and budget checks. It requires separate owner
confirmation if the expected generation cost exceeds $10. An
unavailable or rejected response does not authorize another dispatch.
The operator initialized private state and verified read-only source
preparation before publication and dispatch.

[VERIFIED via branch source at `d6919c949` and loopback PostgreSQL]
Under the same transaction lock, fresh v4 admission requires exactly
the three pinned prior jobs. It checks their terminal errors, delivered
audits, unexpired configurations and original grant hashes. V1–v3 retain
compiler 1 and their replay hashes. V4 requires compiler 2 and a new
scope, key and prompt GUID at version 4. All four receipts count after
content expiry. The fence denies a fifth job.

The runner reconstructs each historical prompt row from its own
candidate. It permits only the v4 task-body and compiler-selection
changes, then fences the exact history switch with fresh ETags and
persisted intents. Offline checks verified omitted category arrays
normalize to empty arrays. The actual mocked Executor-to-LLMClient
request passed the exact native wire guard, including rejection of
extra request options. A definitive provider 400 stays terminal;
an uncertain 503 stays held. Both produce a scoped content-free audit
and neither permits a repeat request.

[VERIFIED via build review and local checks] The 252,133-byte source
packet had SHA-256
`0729d783966d8a1a16ce7232b10aaf31b3551e09efee736d3ce182ed30890e8b`.
The one-turn ordinary OAuth review used only `claude-opus-5-5`, took
137,421 ms and returned NAMED CHANGES. It accepted the core lineage,
publication and audit contracts. The local closure verified the actual
runner wrapper, waiting before dispatch on unavailable schema
derivation, durable guard-denial metadata, content-free preflight
schema counts and the offline schema subset check. The 232 unit tests
across nine suites and the earlier 93 tests across three real
PostgreSQL suites passed. The final affected PostgreSQL suite passed
60 tests after the review fixes. Scoped lint, types, runner guards and
the isolated environment-free production build passed.

### Live native-schema trial outcome

[VERIFIED via scoped publication, ledger and audit readback, provider
receipt, and signed browser GET] Sandbox prompt
`6e1443be-e662-41ca-bcc0-469614c00745` became sole-current v4.
Job `27232d4d-1be9-4489-b7a1-1fda69b05551` completed with one Sonnet
4.6 POST, HTTP 200, and no runner guard denial. The provider accepted
the exact 6,342-byte native schema with 88 enum entries in this run.
The preflight input bound was 137,914 with 4,096 output tokens and a
$1.212980 estimated ceiling.

The response ended at `end_turn` with 548 output tokens and 1,869
characters. The closed validator passed with zero schema or identity
issues. The retained draft has two leads, zero staff consultations,
three consultant overlaps, one Board entry and zero conflicts. The
longest rationale was 19 words and 153 characters. The gap was 257
characters and the Board note 62 characters. All trial targets passed
with zero duplicate or conflicted recommendations. This verifies the
output contract on this proposal and roster. Scientific suitability
and conflict-of-interest clearance require staff review.

Provider usage was 17,109 input, 548 output, 25,297 cache-write and
zero cache-read tokens. Estimated usage cost was $0.15441075.
Content-free success audit `20754273-7a8e-4619-9a44-5199d1f12022`
was delivered and read back.

The normal Microsoft OAuth Chrome session first saw unavailable/unknown
metadata during completion. After reload it showed the validated
result as available/current. An anonymous GET returned 307 to sign-in.
The local server was stopped. The trial made no Request-field writes,
Production Dataverse writes or deployment. The ledger retains all
four receipts and denies a fifth job.

### Fourth-trial retention

Run exact-job expiry after **2026-11-13 04:03:52.504 UTC** for source
and response and again after **2026-11-19 04:03:52.504 UTC** for
configuration, validated result and audit content.

```sh
node scripts/run-expertise-sandbox-trial-1000339.cjs expire /private/tmp/wmkf-expertise-sandbox-trial-1000339-v4-20261111
```

The deletion checks remain due. The approved SharePoint PDF and all
four quota-bearing receipts remain in place.

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
