# Next Power Automate slice: Executive Summary and worker automation

Owner: Codex; branch `codex/power-automate-integration-2026-11-11`.
Status: proposed design, not activation approval. No runtime, schema, credentials,
schedules, deployed configuration or sandbox records changed in this planning slice.
Connor’s existing Short Title replay test remains isolated and unchanged.

## Recommendation

Reuse the shared Executor and migration 097 ledger. Keep Executive Summary draft-only
until its exact destination and audience are approved. Plan automatic processing as
backend-owned durable worker ticks; Power Automate submits and polls, with no provider
implementation, direct output PATCH or cron credential. Do not add a queue service,
new database, generic field mapper or another application merely for this slice.

Document selection remains open between the project narrative in Submission-Documents
and the narrative/bibliography in AI Materials. No Phase I staff-version dependency.
The existing source adapter is evidence of a prior trial, not a decision for this flow.

## Evidence and boundaries

| Claim | Evidence | State |
| --- | --- | --- |
| Summary capability exists: `proposal.executive-summary`, output `summary`, 200-word cap, destination null | `lib/services/prompt-jobs/capabilities.js` | VERIFIED source |
| Prior staff trials retained summaries but made no Request-field writes | `SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md`, dated live receipts | VERIFIED historical; not a fresh content-quality approval |
| Current machine route accepts only `preflight.short-title`, initialize, one pinned Request/event | `machine-service.js`, `machine-pilot-policy.js` | VERIFIED source; Summary cannot be enabled by changing a prompt row |
| Machine writer permits only `wmkf_wmkfprojectdescription` | `request-field-delivery.js` | VERIFIED source; not a generic delivery adapter |
| Proposal source currently pins AI Materials and Project Leader name | `proposal-source.js`, `createProposalSource` | VERIFIED source; future document policy OPEN |
| Legacy `wmkf_ai_summary` has writers and readers | `phase-i-dynamics/summarize-service.js`, `cycle-dossier-generation.js`, `workbench/resolve-request-service.js` | VERIFIED source; not an unused destination |
| Machine drain is POST-only, server selects one stage, no schedule entry | `pages/api/cron/drain-machine-prompt-jobs.js`, `machine-worker.js`, `vercel.json` | VERIFIED source |
| Current pilot rejects Production deployment classes and expires after at most seven days | `machine-pilot-policy.js` | VERIFIED source; not production-ready policy |

No new live schema probe was needed to preserve these boundaries. Availability/type,
length, security and existing contents of a prospective Summary column are UNKNOWN
until an exact destination is chosen and read-only metadata/consumer probes run.

## Executive Summary contract to approve

| Contract | Proposed value / decision boundary |
| --- | --- |
| Task | Reuse `proposal.executive-summary`; preserve existing staff draft semantics |
| Prompt | Dataverse versioned task instructions and execution profile; pin ID, revision and hashes at admission. Re-read current rows before publishing a new prompt definition, then freeze admitted job pins; no new prompt publication in this plan |
| Content | Existing summary starting point, maximum 200 words. Wording optimization deferred; audience and grounding still require review |
| Required records | Current profile requires the directly stored Project Leader name as `pi_name`; do not remove it silently |
| Document | Server-selected full-proposal source under one versioned policy; exact folder/file composition remains OPEN |
| Output | Validated nonblank `summary` text under existing profile bounds; JSON/profile envelope remains the existing Executor contract |
| Immediate persistence | Retained validated draft in existing ledger; bounded expiry, not permanent output storage |
| Final destination | UNDECIDED. Recommend a dedicated Request Executive Summary column if no semantically correct existing column is approved. Do not invent/provision a logical name yet |
| Excluded automatic mappings | `wmkf_ai_summary`, Lay Abstract, Initial Assessment and Pre-Site document sections are not approved substitutes |
| Delivery proposal | One-time initialization only, never automatic replacement; this is a proposal, not an owner-approved refresh policy |
| Audience | Staff review initially proposed. Chairs distribution remains OPEN; storing in Dataverse alone does not enforce an audience |

Before field implementation, record exact entity/column/type/limit, business owner,
readers/editors, permissions and approved initialization event. Compare existing schema
and consumers first; create one column only if needed and explicitly approved. If
refresh/overwrite is required, stop and review a replacement contract instead of
silently weakening initialization. Output format validation is not scientific quality
approval. No delivery to Chairs follows from a successful API call.

### Source and cache contract independent of document choice

Freeze Request/authorization scope, document identity, revision/ETag, extraction
version and content hash, plus required record values, prompt and profile pins.
Reject missing, ambiguous, unauthorized, changed or oversized sources. Keep source
text untrusted and preserve references where the selected extraction supports them.
No fallback to whichever folder happens to have a file, and no client-supplied URL.

Use the existing prepared snapshot and cache-prefix composition. Cache reuse requires
compatible model/settings/schema and the same authorized content; measure after
selection, do not promise savings. A replaced file does not automatically rerun jobs.
A new explicit run freezes new source identity. Durable result reuse/idempotency is
separate from provider caching. No extraction framework expansion while source is open.

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
4. Preserve staff text, including whitespace and intentional clearing. Initialization
   receipt survives source/prompt changes, expiry and deployment changes in the same
   database. Never relocate the Request into a fresh database to evade its receipt.
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

The completed Short Title fixture needs no worker tick. While Connor tests, make no
sandbox change. For a future approved fresh trial, an operator-owned bounded driver
can call the current POST drain sequentially, inspect every response, and stop at
completion, error, uncertainty, expiry or a fixed tick/time budget. A client timeout, network error or non-200 response stops the driver without retry.
Its HTTP timeout must exceed the verified server budget plus network margin; never
start another tick while the prior one may still be running. Read-only diagnosis and
lease reconciliation must establish the outcome before any operator-directed resume.
This is supervised trial automation, not a durable production scheduler. It may run on the operator’s
machine; Connor still needs only Power Automate. Do not build or run it in this slice.
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
2. Writer wiring waits for destination, audience/column security, initialization event
   and refresh semantics, plus read-only schema/consumer checks. Machine admission
   and any Summary trial additionally wait for source selection with the caching work.
   Neither is Summary-ready while its prerequisites remain open.
3. Prepare the bounded worker-driver and scheduler contract tests offline after plan
   acceptance. Review implementation with Opus 5.5 before deployment or activation.
4. Build only the selected Summary mode once the source/destination contract is final;
   then request one bounded end-to-end trial. Leave broader prompts and multi-task
   dispatch to later slices using the same contracts.

Contract-reconcile scope: documentation planning, existing machine routes/store/status,
Summary capability/source and conditional writer; no new persisted shape or enum.
Partial-success, async/freshness and consumer compatibility requirements are above.
Helper extraction and migrations are N/A in this planning slice. Source evidence
shows why neither adding a prompt row nor adding a cron line is sufficient.

## Opus 5.5 review and closure

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
