# Expertise recommendations through the shared Executor

Status: REVIEWED PLAN; pure domain contract source-built, shared offline typed fixture built; staff endpoint branch-built/default-off; qualified review completed; PG proof gap locally closed; recommendations-only direction approved by Justin on November 11,
2026. This document does not activate a flow, authorize provider spending or approve Production cutover. The initial source
policy is owner-selected below; general future placement remains unsettled. Opus review disposition is recorded
in the companion review document. Owner: roster stream; shared infrastructure remains owned by
“Prompt Calling Architecture.”

## Owner decisions and scope

- Power Automate should be able to request expertise recommendations automatically.
- Preserve the standalone app's expertise content and matching criteria, including
  consultant overlap, board interest, gaps and conflicts. Preserve the approved
  GUID/lead-eligibility contract: only active eligible staff with enabled User links
  may be recommended as leads; other active staff may be consulted.
- Results are recommendations for staff review. No staff assignment, Contact/User
  mutation, reviewer invitation, email or business-field writeback is included.
  Future assignment requires a separate contract coordinated with Connor.
- There will be no future Phase I staff-version document. Its existing code and
  successful rehearsal remain historical/current-runtime evidence, not the future
  source contract. Do not remove those live callers as part of planning.
- Justin selected AI Materials combined narrative–bibliography as the initial
  policy, confirmed from his yes to the preceding shared-stream question. General
  future placement is not settled. Exact source/cache adapter rules still require
  implementation/review; no fallback or broader cache-compatibility claim follows.


## Verified baseline and coordination boundary

[VERIFIED via read-only branch source, 2026-11-11] Roster checkpoint `a29c30826`
has successful bounded normal-UI single matching, batch route matching, History,
attachment and linked-person rehearsals. `roster-match-contract.js` provides the
snapshot and GUID validator, but its target guard is sandbox/local-only. Normal
Production still takes the legacy path. Production roster cutover is a dependency,
not accomplished by these rehearsals. See [rerun evidence](SINGLE_MATCH_RERUN_2026-11-11.md).

[VERIFIED via read-only source at shared branch `0c4b8d39c`]
`codex/coordinated-start-2026-11-10-b` contains `lib/services/prompt-jobs/`
(store, worker, profile, context, capabilities, staff-service, staff-worker,
proposal-source), profiled `executePrompt`, migration 097, Admin authoring and a
restricted staff-draft pilot. Task capabilities admit only two synthetic and two
proposal tasks. Profile result validation accepts nonempty strings, results are
projected as text, and the 1,536-token cap appears in both capabilities and Executor.
The staff service is trial-specific, not general machine authorization. The drain
exists but is unscheduled. PA app-only admission/status and general operations
remain planned in that branch's `docs/plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md`.
At that historical baseline these files were not integrated into the roster branch;
subsequent shared offline typed-fixture progress is recorded below. Live trial outcomes in
that other session are not evidence of deployed PA connectivity.

Ownership: infrastructure owner retains shared auth, ledger/worker, scheduler,
recovery, Admin/profile compiler and common document/cache contracts. Roster owner
owns expertise input/output semantics, prompt adaptation, validator and staff
recommendation presentation. The infrastructure owner confirmed this boundary in chat and supplied clean baseline
`0c4b8d39c` on November 11. Their typed-result handoff explicitly includes worker
string extraction and store `saveValidated` as well as profile/DTO changes.
Any changes to shared modules are a coordinated
handoff after a stable checkpoint; no concurrent edits, duplicate runner or new
queue. The initial plan changed docs only; the pure contract checkpoint below adds no live writes.

## Pure contract implementation checkpoint

[Build receipt](PURE_RECOMMENDATIONS_CONTRACT_BUILD_2026-11-11.md) records exports,
DTO boundaries, test results and remaining shared dependencies.

[VERIFIED via `lib/services/expertise-finder/recommendations-contract.js`]
The pure domain contract is now source-built: it builds a frozen roster snapshot,
canonical all-profile manifest/fingerprint and exact candidate-User state set;
rebuilds the visible roster block and checks its association; and validates closed
structured recommendations before legacy GUID/category/lead canonicalization.
The focused suite passed 60/60 and four existing matching/consumer suites passed
38 tests separately; scoped ESLint passed. Opus focused closure returned READY; named tests and the pure validation extraction are accepted. Only
the unit suite imports this module; no production caller is wired. This module does not fetch, authorize,
persist or establish currentness. `complete: true` is a trusted future adapter's
assertion, not pagination proof. Its 4 MiB cap bounds the roster extension only;
the shared full sealed-snapshot/prompt budget still requires integration checks.
No live calls or assignment writes were added. The initial source policy is AI Materials combined narrative–bibliography; broader future placement remains open.

The agreed shared interface checkpoint is `a756735fa`, documented in the shared
owner's `docs/plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md`; the historical
runtime baseline remains `0c4b8d39c`. Shared machine audit attribution without an
invented human and cleanup that still works after principal revocation are explicit
release gates, alongside typed-result integration, PA admission, source/cache and
worker operations. The pure contract is not shared integration or PA readiness.

## Freshness and shared checkpoint

The shared offline typed fixture is built at runtime `7d0cf0392`, checkpoint
`eb0010163` (coordinating-session source verification; reported 380 tests/25 suites,
Opus READY). The agreed earlier interface is `a756735fa`; `0c4b8d39c` remains its
historical runtime baseline. The shared staff endpoint is branch-built and default-off at runtime `6fe01c88e`,
docs `f9b3dd1b4` (superseding `de67742db`) (clean checkpoint verified by the coordinating session). Shared
verification reports 527 tests/32 suites including three PostgreSQL suites, types,
lint, applicable gates/secret-scan self-test and an environment-free guarded build
passing, with four DOCX warnings. No activation, provider call, provisioning,
deployment or positive live compatible-job proof occurred; a live producer/PA
generation path is not established. The owner approved the exact previously blocked Opus payload and the review ran.
Its qualified verdict cleared items 1, 2, 4 and origin alignment; item 3b identified
one PG inverse-proof gap. Test-only commit `ef5507ab8` restored a valid Sandbox
binding and positive read before both fixture-reader refusals; its real PG suite
passed 33/33, with lint/diff checks. The coordinating session independently reviewed
that diff. Runtime remains `6fe01c88e`; no second external review or unqualified
Opus READY verdict is claimed.
The roster-only freshness comparator is source-built with 21 new passing tests
(final combined 120 tests across seven suites); Opus source review returned READY with no concrete defects. It compares a
retained hash to a trusted complete fresh projection, returning only current/stale/
unknown. Auth, contract version, expiry and document/source proof remain caller
obligations. See [freshness receipt](ROSTER_FRESHNESS_CONTRACT_BUILD_2026-11-11.md).

## Planned caller → result contract

1. An authorized PA flow submits one Request GUID, one allowlisted expertise task
   and an idempotency UUID through the shared machine admission contract. Its
   trigger/event policy remains a rollout decision with Connor. Start with an
   explicitly invoked test flow before enabling a business trigger.
2. The server derives application principal, Request permissions, environment and
   task permission from verified authorization. No caller-supplied human identity,
   source URL, roster, prompt body, model, output schema or destination is accepted.
3. Admission freezes the approved task/profile/compiler/validator revisions and
   authorized source manifest. Preparation creates an integrity-protected snapshot
   before dispatch. Repeated same-key/same-payload requests resolve the same job;
   changed payload under the key conflicts, including after receipt/content expiry.
4. The worker reauthorizes and checks relevant input freshness before one bounded
   provider attempt. It checkpoints the normalized response before validation;
   validation/audit recovery must not regenerate a checkpointed response. An
   ambiguous provider outcome requires explicit recovery, never a blind retry.
5. The expertise validator produces canonical structured recommendations against
   the exact frozen roster snapshot. It never validates by fetching a different
   roster. Validation failure retains the response/receipt but exposes no usable
   recommendation. No recommendation is a successful valid outcome when the
   eligible lead set is empty; invalid/unknown identities are failures.
6. The existing ledger retains the validated result. PA polls content-free status
   and receives a result reference; authenticated staff read the recommendations
   for that Request. A 202 or provider HTTP 200 is not completion. Audit failures
   must not erase the saved result or trigger another paid inference.

## Inputs, freshness and prompt adaptation

The source interface must return approved document roles, Request association,
item/version identities, byte hashes, extraction revision, bounded text and any
required assemblage lineage. The initial policy is AI Materials combined narrative–bibliography. Until the
shared source/cache interface is implemented and reviewed, fabricated snapshots
remain the integration proof; real-source wiring/publication are not established.

The roster component contains ordered active profile GUIDs, canonical names,
categories and existing formatted expertise, plus the eligible lead GUIDs.
Server provenance additionally records profile identities/ETags and every candidate
lead's User identity/disabled state, including disabled candidates excluded from
the lead set. Preserve warnings for invalid excluded profiles. Build a new complete manifest adapter; do
not reuse rehearsal `matchRosterSnapshot` unchanged, because a missing
`isdisabled` currently falls through as ineligible. Require a boolean disabled
state on every candidate User; missing/malformed/failed reads block preparation.
Roster and User reads are server-owned, read-only capabilities under trusted
`withDalContext` and the target interlock. They do not borrow or expand the PA
caller's Request permissions; Production admission still requires roster cutover. Store a canonical roster fingerprint.

Shared-owner decision: use a capability-specific versioned sealed snapshot
extension for private typed roster rows, eligible lead GUIDs, warnings and the full
ETag/User-state manifest. Do not introduce generic hidden-record flags, place the
manifest in the 1,024-byte provenance field, or retain full source data in task
configuration. The extension is code-owned and allowlisted, inherits source TTL
and the sealed snapshot byte cap, and is never rendered into model-visible text.
Configuration holds bounded capability/adapter/validator versions and source
manifest identity/fingerprints only. Freeze the fingerprint association with the
snapshot; do not trust caller-provided provenance.

Rebuild visible `roster_block` from this typed extension using the existing
formatter, GUID catalogue and eligible list. Require exact equality before dispatch
and post-checkpoint validation. Bind private snapshot integrity AND frozen
capability/validator versions into a versioned checkpoint contract; the current
checkpoint's snapshot-integrity binding alone does not bind the whole configuration.
Preserve replay compatibility for v1 text jobs. Missing/expired snapshot during
recovery fails closed without generation. After successful validation, bounded
manifest identity/fingerprints retained with configuration support later freshness
checks without retaining all source data for the longer result lifetime.

Keep roster/task data after the shared proposal cache marker. Do not put
expertise-specific instructions before a common boundary without agreement on
shared profile compatibility. The visible block must fit the existing encoded
64,000-byte record maximum; the typed extension and all duplicated content must
fit the sealed snapshot cap. Measure canonical record, full sealed snapshot and
composed prompt, including current duplicate rendering/JSON escaping. Slice 2 selects capability-specific rendering of the exact formatter text once
in a protected roster suffix, omitting duplicate generic-record/placeholder output
for this capability. The shared owner implements and reviews that compiler
revision; existing text tasks keep their current rendering. Golden tests must
prove exact formatter preservation, one roster occurrence and intact wrappers.
If any bound fails, reject the entire input before inference: no truncation,
omitted expertise or automatic global limit increase. Reserve the output budget
within the selected model's complete context bound. Generic hidden-record
configuration and unchecked output-as-text are expressly excluded.

At preparation and dispatch compare source identity/hash and relevant roster/User
fingerprints. Before serving a saved result as current, repeat authorization and
freshness checks. Status polling remains content-free and never performs source,
roster or User freshness queries; freshness is checked on an authorized result
read (and before dispatch), independently of aggregate job state. Proposed first-version policy: stale or unverifiable inputs yield
an actionable unavailable/stale status, not current recommendations. Retain the
old result privately for audit; no automatic rerun or historical-result override.
Expected source/roster changes require an explicit new authorized job. Unrelated
Request fields need not invalidate the proposal. Cross-system checks are bounded
observations, not a SharePoint/Dataverse transaction.

Use a distinct versioned shared-execution task identity (proposed
`expertise.recommendations`) and pinned profile; do not convert the legacy prompt
row in place. The old exact system/body assertion cannot apply to a differently
composed profile. Replace it only for the new capability with pinned task/profile
hashes and compiler/validator contract versions. Keep legacy behavior unchanged.

Parity proof: compare all original formatted roster fields; map every legacy
matching instruction to its adapted location; preserve role/expertise wording,
recommendation criteria and null-lead/consultation semantics. Include compiler-added system authority instructions and the output-contract
block in this mapping. Render a single canonical output-shape description; replace
the old inline JSON example through the versioned adapter rather than leave it
contradicting the typed schema. A golden test proves the single output contract.
Golden composed fixtures exercise full roster, empty leads and hostile proposal/roster text.
Prove security wrappers still classify documents/roster as data. Prompt relocation
is not byte parity or a guarantee of identical model scoring. Representative
output review and cache measurements require a separately approved live trial.

## Structured output, storage and access

Add one closed structured-result capability, reusing `validateRosterMatch` with
its frozen snapshot. Carry schema/compiler versions through response recovery and
result reading. Wire capability-specific output type, byte bound and token budget
through Admin validation, admission, Executor, store and result DTOs. In particular,
replace neither 1,536-token guard globally: retain the pilot limits and register
expertise's reviewed 4,096-token budget at both checks. Bound the entire encoded
result to the existing 128 KiB result ceiling, not only the first output. Reject
all extra model keys and malformed types recursively before canonicalization; refuse truncation, refusal,
invalid JSON, invalid categories/GUIDs, duplicate primary/secondary lead GUIDs
and ineligible leads before saving success. Run the domain validator in
`executeProfiledPrompt`'s post-response-checkpoint validation stage, receiving the
integrity-verified frozen roster. Failure is `profile_output_invalid`; recovery
revalidates the saved response without another model call.

Use the existing prompt-job content/receipt tables first; no new result table or
Dataverse recommendation columns are justified for the initial proof. Return a
typed structured result from the existing content layer, not a text string for
consumers to parse themselves. Keep staff and machine principal namespaces distinct.
Retain the submitting principal for audit, while a separate Request-scoped read
policy allows currently authorized staff to see service-generated recommendations.
The server resolves the owning job scope; callers cannot supply a principal key to
cross the ledger's scope checks. Preserve the old user-private expertise history;
do not fabricate `user_profile_id` or broaden its query to all users.

Reuse the pilot's bounded retention as a proposed initial policy: source/response
24 hours; configuration/validated result seven days; content-free receipt and
idempotency identity survive. Expired content is explicitly unavailable, never
silently regenerated. Operational scheduling, exact expiry verification and staff
visibility of expiry are release requirements. Longer-lived recommendation history
is a separate retention decision, not an implicit permanent copy into old history.

## Proposed interface checkpoint (not implemented)

Task key: `expertise.recommendations`; capability/validator contract:
`expertise-recommendations-v1`; operation: `generate-draft`; destination: none.
The model/budget are pinned in the published task, with a 4,096-token capability
ceiling for the initial expertise contract. No caller can choose them. Register an expertise-specific authorization scope and
enablement rule, and update the store admission task-set restriction for this
capability. Do not reuse `proposal-trial:` or assume adding a task key alone
overrides the store's exact two-proposal-task gate.

The validated payload is the existing structured `rosterMatchSchema` result plus
its code-authored canonical names, `roster_contract`, `roster_warnings` and
`no_lead_recommendation`. The object contains proposal_summary, staff_assignment
(primary/secondary nullable), staff_consultation, consultant_overlap, board_interest,
expertise_gaps and conflicts. Person references use `profile_guid`; their category
and lead membership are validated against the frozen snapshot. Preserve the current
field limits and 128 KiB whole-result ceiling. The legacy normalizer strips unknown
keys and permits optional fields; that behavior is not sufficient for the new
closed capability. Perform a strict recursive shape/type check before legacy
normalization/canonicalization: reject extra model keys at every object level and malformed present
optional values, preserve valid optional fields, and add code-authored fields only
after validation. Legacy callers keep their existing normalization behavior. Do not treat the model's prose as an authorized assignment.

The domain result-read DTO is proposed as `{jobId, requestId, taskKey,
contractVersion, status, freshness, expiresAt, result?}`. `result` appears only
when authorized, validated, unexpired and freshly checked. `status` distinguishes
available, not-ready, unavailable and expired; `freshness` distinguishes current,
stale and unknown. Unavailable details are allowlisted safe codes, with no applicant
content in polling. These are result-availability states, not replacements for the aggregate job
state. Freshness is independent: a job may be validated while its result is now
stale or access is revoked. The shared owner will reconcile this envelope with
their exhaustive job-status vocabulary; no result is returned without a separate
current authorization and freshness check.

The frozen roster manifest records contractVersion, canonical rosterHash,
profiles (GUID, category, active/lead flags, staff User GUID, relevant expertise
hash, ETag), candidate Users (GUID, disabled state), and eligibleLeadGuids. The
sealed snapshot carries the corresponding full expertise data. Capture candidate
Users even when disabled; re-enabling can change the eligible set. Full rows and
User reads must be complete, followed by a relevant fingerprint recheck before
sealing/dispatch. Integrity protects the manifest/snapshot association. Profile
ETags are conservative invalidation inputs until a reviewed semantic field-hash
policy is implemented; a nonsemantic profile edit may therefore require a new run.
The freshness fingerprint is a canonical hash of reproducible current reads:
profile GUIDs, ETags and relevant field hashes, User GUIDs/disabled states and
derived lead membership, with an explicit algorithm version. Never include a
read timestamp or random nonce. Later checks reconstruct it from authorized reads
and do not require the expired source snapshot.

Staff visibility requires existing expertise app access plus the established
Request-level restriction policy. PA requires its own allowed Request/task scope.
Both are reauthorized on read; a staff read never changes the stored submitting
principal and must not remove principal predicates from generic ledger reads.
Infrastructure owns a narrow server-authorized lookup/read seam for this purpose.
Unknown/revoked access denies, and cross-Request job IDs cannot enumerate results.
Exact route/guard binding is part of that shared implementation checkpoint.

The source adapter and cache compatibility identity are deliberately not specified
beyond the required inspection/preparation/freshness interface. The owner confirmed
that identical files alone do not guarantee cache reuse: profile system bytes,
protected prefix, authorization domain, model and native-schema compatibility must
also agree. The visible roster suffix and private snapshot extension require measured
size/privacy bounds and the shared reviewed compiler/checkpoint revision. No cache-driven prompt or model change is authorized.

## Implementation order and exit gates

| Slice | Owner and work | Exit evidence |
|---|---|---|
| 0: shared seam agreement | Agreed interface `a756735fa`; runtime baseline `0c4b8d39c`; shared ownership retained | No overlapping edits; source/cache and PA dependencies explicitly tracked |
| 1: expertise contract | Pure module source-built; 60 focused tests passed; Opus closure READY | No roster expertise text truncated or omitted; changed disabled User affects fingerprint; unknown/oversized outputs reject |
| 2: shared capability | Infrastructure owner or explicit handoff adds narrow typed-result/budget support; roster owner adapts versioned prompt | Legacy prose tasks unchanged; both budget guards agree; checkpoint replay validates without model call |
| 3: Request result access | Coordinated job admission/read policy and staff display; source remains fabricated until decision | Human/machine Request authorization, stale/expired status and no assignment writes verified |
| 4: integrated automation rehearsal | After source/cache contract and PA admission/worker operation exist | No-model PA auth/duplicate delivery proof, then separately authorized metered recommendation run |
| 5: deliberate release | Coordinate roster cutover and backend deployment; review trigger with Connor | Production target/data admission, disabled-by-default rollout, rollback and retention checks |

Required tests also cover same-key races and lost POSTs; changed configuration on
replay; worker death before/after dispatch/checkpoint; source changes between reads;
User disabled/re-enabled and missing/nonboolean disabled state; duplicate leads; no eligible leads; forbidden foreign profile/category;
invented expertise evidence and unsupported scientific inferences (adversarial
quality fixtures and human review, not falsely claimed deterministic fact-checking);
partial task and audit failure; stale worker completion; principal revocation and
cross-Request reads; result bytes over bound; expired source/result with retained
idempotency receipt; delayed UI responses across Request changes. PA status mapping
must cover every terminal/unknown state. Reuse existing real-Postgres tests for
locks/uniqueness rather than mocking their guarantees. Tests must assert zero
assignment/Contact/User/Request-field writes with actual proposed writers present.

Release is blocked on implementing/verifying the selected initial source/cache policy, machine authorization
proof with Connor, operational worker/recovery/retention, explicit roster cutover,
and accepted typed-result/read contracts. Work on pure expertise adapters and
fabricated tests may proceed after shared ownership agreement. Do not claim that
current browser rehearsals close those release gates.

## Contract-reconcile and review

Implementation invariants: one authorized Request/job; no assignment effects;
frozen source/roster/config; canonical GUID validation; no regeneration after a
saved response; isolated principals with explicit Request result access; bounded
content/retention; no live Phase I source dependency introduced.

Persistence is existing job content/receipts, with roster Dataverse reads; new
business writes are N/A. Consumer fan-out includes Admin, Executor, worker, store,
status/results DTOs, PA polling and staff display. Shared-helper extraction must
preserve existing legacy and prose-task behavior. Unknown capability/type/state
fails closed. Shared integration remains planned; pure-module tests passed and Opus closure returned READY
at the implementation checkpoint. No deployment checks are claimed. Scoped durable reconciliation follows `/sweep` for owner decisions;
old test receipts remain historical. The initial and follow-up Opus 5.5 reviews,
named-change dispositions and confirmed peer ownership are recorded in
[the review receipt](POWER_AUTOMATE_RECOMMENDATIONS_OPUS_5_5_REVIEW_2026-11-11.md).
The follow-up verdict is READY for the agreed bounded implementation direction;
this is not a runtime or release approval.

## Scoped durable reconciliation and peer handoff

Mode A: owner decisions change future expertise automation, not current runtime
source selection. Source baselines and explicit owner messages are the authority.
Session, roster Atlas and remaining-flow guidance were read and updated together;
existing batch fixture/Phase I references remain historical runtime evidence.
Searches included docs, memory and agent wiki. No precise memory/wiki restatements
needed changes. Doc currency, symbol references and Atlas gates/self-tests passed
for this bounded documentation change. Runtime tests/probes are N/A for this plan.

Broader Phase I future-work statements in `docs/BACKEND_AUTOMATION_PLAN.md`,
`docs/GRANT_CYCLE_LIFECYCLE.md`, `docs/J27_TRANSITION_REGISTER.md` and
`docs/J27_ALIGNMENT_LOG.md` were classified outside this roster-only scope and
reported to the shared owner. No whole-repository retirement/reconciliation claim
is made. Current target flags and live batch loaders are not retired by a plan.

The shared owner reviewed the proposed interface and confirmed alignment subject
to strict pre-normalization JSON validation, independent freshness, the exact
64,000-byte input-record bound, and an explicit machine-job-to-staff Request read
policy preserving generic SQL scope. Those clarifications are incorporated above.
Common runtime edits remain gated on the shared reviewed interface checkpoint.

The shared owner chose the versioned sealed snapshot extension over generic
hidden records after source inspection. Both streams require checkpoint binding
of extension integrity plus frozen capability/validator versions, bounded metadata
only in configuration, source TTL for full roster data, and v1 text replay
compatibility. The selected representation remains planned pending shared build.

## Proposed sandbox roster read adapter and aggregate probe

[VERIFIED via the coordinating session's read-only probe at 2026-11-11T20:44Z]
`scripts/probe-recommendations-roster-read.mjs` read the registered sandbox under
explicit DAL context and target checks: 46 profiles, 40 active, three enabled
candidate Users, three eligible leads, zero warnings, every selected field present
including nulls and all ETags present, with a complete count. This is aggregate
read evidence from the old helper/single-page response, not strict multipage live
verification, an implemented runtime adapter or authorization proof.
Combined Opus plan review returned READY WITH NAMED CHANGES, accepted by the
coordinating session. The read-only sandbox adapter and opt-in strict pagination/read behavior are
source-built; 207 tests/ten suites and the final one-page strict-adapter probe passed.
Opus initial review returned READY WITH NAMED CHANGES; all named tests passed; focused Opus closure returned READY. See
[adapter build evidence](SANDBOX_ROSTER_READ_ADAPTER_BUILD_2026-11-11.md). It is sandbox-
only, with no Production cutover or cross-environment assembly. No writes, generation
or deployment were performed. Source/cache policy work remains shared-owner scope.

## Shared staff endpoint checkpoint and final review boundary

The shared staff endpoint is branch-built and default-off at runtime `6fe01c88e`,
docs `f9b3dd1b4` (superseding `de67742db`) (clean checkpoint verified by the coordinating session). Shared
verification reports 527 tests/32 suites including three PostgreSQL suites, types,
lint, applicable gates/secret-scan self-test and an environment-free guarded build
passing, with four DOCX warnings. No activation, provider call, provisioning,
deployment or positive live compatible-job proof occurred; a live producer/PA
generation path is not established. The owner approved the exact previously blocked Opus payload and the review ran.
Its qualified verdict cleared items 1, 2, 4 and origin alignment; item 3b identified
one PG inverse-proof gap. Test-only commit `ef5507ab8` restored a valid Sandbox
binding and positive read before both fixture-reader refusals; its real PG suite
passed 33/33, with lint/diff checks. The coordinating session independently reviewed
that diff. Runtime remains `6fe01c88e`; no second external review or unqualified
Opus READY verdict is claimed.

The coordinating session independently ran 131 tests/six suites before the final
wrapper fixes and reviewed the latest runtime fixes without a new blocker. That is
separate from the shared 527-test checkpoint and the later 33/33 PG proof run.
The initially blocked exact payload was subsequently owner-approved and sent:
`/private/tmp/wmkf-expertise-sandbox-closure-opus-20261111.txt`, 14,786 bytes,
SHA-256 `a7af9f7d0a27ba9473998603d3641049966ca24b9edfaa511d5f34ce2ac43d24`.
The approved review artifact is
`/private/tmp/wmkf-expertise-sandbox-closure-approved-20261111.json`.
The earlier automatic approval rejection is historical, not a current permission
block. The review's item 3b gap was locally corrected: a positive baseline precedes
the ten mutations, observer state is cleared, the original binding is restored and
a positive current Sandbox result precedes both fixture-reader null assertions.
The shared test fixture was removed after the passing run. Runtime is unchanged;
this closes the named test evidence gap without inventing another Opus verdict.
The initial AI Materials combined narrative–bibliography policy remains selected;
prior sandbox read proof does not establish positive live endpoint delivery.

Both owners agree the next dependency is bounded sandbox producer/admission and
compatible-job delivery proof before PA wiring. That requires a separately reviewed
trial and any needed paid-call authorization; no activation has started. Shared
final docs `f9b3dd1b4` follow test-only `ef5507ab8`; runtime remains `6fe01c88e`.
