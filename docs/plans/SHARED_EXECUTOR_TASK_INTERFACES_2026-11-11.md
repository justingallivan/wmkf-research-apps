# Shared Executor task interfaces

**Status [PLANNED].** This checkpoint coordinates the proposal-draft and expertise
recommendation streams. The shared infrastructure owner controls the capability
registry, Admin compiler, authorization, Executor, worker and ledger. The roster
owner controls expertise inputs, validator semantics and staff presentation. Pin
both branch revisions before handing off changes to shared modules.

## Verified branch baseline

[VERIFIED via source at `0c4b8d39c`] The proposal branch has four registered
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

The staff recommendation envelope is `{jobId, requestId, taskKey, contractVersion,
status, freshness, expiresAt, result?}`. The domain `status` values are `available`,
`not-ready`, `unavailable` and `expired`. `freshness` is `current`, `stale` or
`unknown`. Use `unknown` if no freshness check can apply. Emit `result` only for
an authorized, validated, unexpired result with current inputs. Stale/unverifiable
results stay private and require an explicit new authorized job. This read-time
freshness check is new. The existing staff text projector has no such check. Use
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

**OPEN.** Future proposal and roster document placement can be the project
narrative in Submission-Documents or the combined narrative–bibliography in AI
Materials. Selection, document roles, extraction and cache compatibility need an
owner decision. Use fabricated data for integration until then. No future Phase I
staff-version document is part of this direction. Existing callers and rehearsal
evidence remain in place. Reconcile future staff-version assumptions in broader
planning documents separately. Reuse a cache prefix only after confirming exact
protected bytes, profile/system and schema compatibility, authorization domain,
model and measurements under separate trial approval.

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
enablement, with the existing proposal cohort rules preserved. Staff require
current expertise app access, the existing Request restriction policy and an
explicit entitlement to the capability's result. The
server resolves the machine-owned job under the authorized Request and task,
then calls an owner-scoped ledger read. Keep all existing ledger owner predicates
and submitting-principal audit identity. Do not accept a principal selector from
either caller or widen user-private expertise history. Reauthorize the read and
recheck freshness before exposing content. Foreign jobs return non-enumerating
responses. PA polls content-free state and a result reference for the staff viewer.
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
| Repository and release | Run the existing real PostgreSQL suites `prompt-jobs.pg.test.js`, `prompt-jobs-executor.pg.test.js` and `prompt-jobs-staff.pg.test.js` against disposable loopback PostgreSQL plus the new typed-path cases. Run route/security, Atlas and migration-manifest gates for new surfaces, DAL/context and injection-tagging gates, status enum parity, focused lint, types and build. Run each changed gate's existing self-test after its gate. Source choice, operations, connector proof and a separately approved live validation run precede release. |

Contract reconciliation covers transition invariants and consumers above. The
planned ledger change reuses existing tables; verify migration/setup/Atlas parity
if reviewed implementation adds a schema change. No business writer is in scope.
This checkpoint adds no runtime changes or live verification claims.

## Review

Ordinary Claude Opus 5.5 subscription review returned READY WITH NAMED CHANGES.
The follow-up verified both plans and closed the findings. Both receipts report
only `claude-opus-5-5` model usage. The shared machine audit and cleanup gates
remain open for implementation.
