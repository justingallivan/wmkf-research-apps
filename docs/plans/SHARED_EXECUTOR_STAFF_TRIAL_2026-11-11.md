# Staff drafts and controlled proposal trial

The staff workflow passed local verification on the isolated branch. The Opus 5.5 follow-up verdict was READY. Two separately approved Request 1003384 cohorts each settled at `needs_attention`. The revised Executive Summary is ready for staff review with grounding caveats. The revised Methodology exceeded its word limit and had substantive grounding errors. Both cohorts reused the cached proposal prefix and made no Request-field writes or deployments.

## Surface and review

[BRANCH-BUILT] Staff Proposal tab → authenticated Workbench job routes → server-owned trial policy/source adapter → existing PostgreSQL Executor ledger → bounded worker → separately authorized validated-result reads. Persistence uses migration 097's existing six tables; Dataverse supplies pinned prompt/profile definitions and receives content-free AI-run audit records only after explicit trial approval. Existing legacy summary paths remain consumers of their existing fields.

Prior findings: Opus 5.5 plan review (`/private/tmp/wmkf-staff-workflow-plan-review.json`) returned READY WITH NAMED CHANGES. Its required changes are captured below. Review model usage was exclusively `claude-opus-5-5` through Claude subscription OAuth. This design review preceded application inference.

## Implementation invariants

| Invariant | Files likely touched | Verification |
|---|---|---|
| Proposal capabilities are draft-only and closed to deployed production | capabilities, store, worker, Admin task validation | reject unknown/mixed capabilities, initialize, production and malformed scopes |
| A trial cohort can admit at most one job across actors/environments; replay precedes cap checks | store | real PostgreSQL simultaneous same/different keys and cross-actor tests |
| Reads require environment, actor, authorization scope, Request and job identity | store, service, routes | foreign-scope tests; no lease/version mutation |
| HTTP DTOs contain only allowlisted status fields or validated result text | service, routes | populated internal secrets/checkpoints excluded; expired result unavailable |
| Worker candidates exclude completed/ambiguous jobs; no browser-driven execution | store, runner | candidate tests; bounded stage loop; polling remains read-only |
| Authorization is re-established before source access, dispatch and audit | trial policy, source, worker | revocation before dispatch and audit blocks effects |
| Source identity and PI provenance are frozen before admission; no silent substitution or truncation | source adapter, worker | identity/version/record changes reject; byte caps and duplicate aliases reject |
| One prepared snapshot feeds the two tasks; received responses are never regenerated | existing worker plus frozen adapter inputs | real PostgreSQL provider-double crash/replay tests |
| Request/actor changes cannot render stale results or discard an uncertain command key | ProposalDrafts | delayed responses, identity change, POST loss and same-key retry tests |
| Source/response retention is 24 hours, results/configuration seven days; receipts remain | service, controlled runner, runbook | expiry invocation and preserved receipt/quota tests |

## Decisions and boundaries

[VERIFIED via repository source reconnaissance] The governed proposal narrative helper selects exact accepted AI Materials filenames; Project Leader is the authoritative PI contact. Existing Executive Summary and Methodology fields found in Pre-Site belong to `wmkf_requestdocument`, not an approved Request destination mapping. Neither those fields nor legacy `wmkf_ai_summary` will be repurposed.

[VERIFIED via read-only source preparation] The trial inputs are the owner-uploaded narrative and directly stored Project Leader name. [BRANCH-BUILT] Executive Summary is capped at 200 words, Methodology at 12,000 characters, each provider call at 1,536 output tokens. One cohort permits one two-task job, with no provider retries and no automatic rerun after source changes. The new task definitions are `proposal.executive-summary` and `proposal.methodology`.

[BRANCH-BUILT] Trial activation defaults off. Configuration binds one trial UUID, one Request GUID and one authenticated staff profile/system-user identity. Environment derives from deployment and actual Dataverse target classification. Only local-production, local-sandbox and preview-sandbox are permitted; deployed production and unknown targets fail closed. A separate stable server nonce secret seals prepared snapshots. Trial activation and cron scheduling are not committed as live configuration.

[BRANCH-BUILT] Source adapter uses strict complete SharePoint resolution, a unique active AI Materials location, bounded download with identity/version checks before and after, and exact source/PI comparison before each dispatch. Manifest stores identity and hashes; snapshot stores source text. The owner authorized scoped Request 1003384 and related document inspection; those reads are recorded below. The owner separately approved the scoped trial publication, application calls and content-free audit writes. The design reviews used Claude subscription OAuth.

## Initial read-only Request 1003384 inspection

[VERIFIED via owner-authorized Dataverse and Graph reads, 2026-11-11] Request `1003384` resolves uniquely to `15d8e475-02d3-f111-a05b-70a8a5b11800`. Its Project Leader contact existed and had a stored name. Before the owner uploaded the trial narrative, the one active `akoya_request` folder contained eight files, all under `Submission-Documents`. The complete bounded inventory found no AI Materials copy.

| File | Observed state |
|---|---|
| `Project-Narrative_1003384.pdf` | 263,288 bytes; stable metadata across download; 7,034 extracted UTF-8 bytes / 1,074 words. The nine-page draft test application contains placeholders, rather than substantive research methods. |
| `Research Proposal_2026-10-28T19-04-54Z.pdf` | 10,720,526 bytes; stable metadata; 63,340 extracted UTF-8 bytes / 9,502 words. Mixed test application and assorted attachments, including research slides; not one coherent narrative for this Request. |
| `Bibliography_1003384.pdf`, `Biosketches_1003384.pdf`, `Collaboration-Letters_1003384.pdf`, `Other-Support_1003384.pdf`, `Graphical-Abstract_1003384.jpg`, `declarationofstatus_Test 1.pdf` | Present in the bounded metadata inventory. Separate contents were not validated; filenames alone do not prove the advertised content. |

This initial inspection did not establish a suitable trial narrative. The AI Materials policy stayed in place. The owner subsequently supplied the missing input.

The inspection used a process-only production-read allowance after the owner's explicit instruction, with the Dataverse interlock on and a fetch guard permitting only GET/HEAD plus Azure token POSTs. No generation, prompt publication, Request mutation, or audit write occurred. No personal contact values or extracted applicant text are retained in this repository.

## Verified owner-uploaded trial source

[VERIFIED via owner-authorized read-only source adapter, 2026-11-11] The owner
uploaded `ProposalNarrative_1003384.pdf` to the active Request folder
`1003384_15D8E47502D3F111A05B70A8A5B11800/AI Materials`. The default adapter's
`inspect`, `prepare`, and `isCurrent` succeeded with the unpublished
candidate profile and an ephemeral nonce. The PDF was the only accepted
alias present. The version remained stable through download and the final
freshness check. The file SHA-256 is
`d7e31d37ed2163e29ade2bf878720af34582bcf10e7c8252a223c3dd79a20c44`.

The extracted text was 59,311 UTF-8 bytes (8,096 words). The in-memory
canonical snapshot was 123,057 bytes. Both fit their limits. The document
contains an overview, objectives, hypothesis, context, potential impact,
detailed methods across three aims, innovation, key personnel, and 80
references. The separately sourced PI record was populated. The exact stored
name did not appear in the extracted text, so PI identity remains sourced
from Dataverse. This narrative supplies the material needed for both tasks.

The probe persisted no snapshot or job, made no provider call, and wrote no
configuration, audit or Request data. That read-only probe preceded the separately authorized live trial.

## Authorized live trial

The owner approved one `local-production` trial for Request 1003384, including
profile/task publication, up to two Sonnet 4.6
application calls at 1,536 output tokens each, retained validated drafts
and content-free AI-run audit writes. The proposal SHA-256 above bound the
approved source. The deployment and Request fields were outside the scope.

[VERIFIED via live preflight and admission, 2026-11-11] The configured current
Superuser was profile `2`, mapped to Dynamics system user
`29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`. The owner's Claude OAuth account
matched that profile. The configured application Postgres database lacked
the six ledger tables. Comparing every migration filename with the tracker showed exactly
`097_shared_prompt_jobs.sql` pending. A transactional DDL rehearsal rolled
back cleanly. The canonical `scripts/apply-migrations.js` then applied exactly
097 and skipped 94 recorded files. The shared profile catalog and both
proposal task names were empty before publication.

The service-level runner set trial configuration for its process. It left
environment files and deployment configuration unchanged. Dataverse DAL and
target interlocks stayed enabled. A short-lived rehearsal grant admitted
collection POSTs for profile settings, prompt rows and AI-run audit rows.
Request PATCH was denied by a pre-dispatch negative interlock check. The
runner guarded the specific profile/task inputs and stable audit IDs,
checked audit impersonation, and journaled at most two Sonnet Messages POSTs.
The fetch guard covered HTTP writes. The ledger store used its own
transactional Postgres connection for scoped job-state writes.
One `proposal-staff-trial` profile revision and both v1 task rows were
published through the existing Admin services.

Cohort `6affca32-74e9-4628-ba7a-f4e43aa56b65` admitted job
`4640cd5c-6112-473a-9217-e8a58b525384` at 18:35:20 UTC. Before admission the
runner compared the exact approved document hash and calculated the canonical
snapshot hash with the run's stable nonce. The saved snapshot matched
`93684d56f4f4d87b477e230a3d303dd6810a84f0e2cc17e1e4b71a529d6baae8`
before provider dispatch. The worker also rechecks the source manifest and
actor before dispatch. The nonce and proposal and draft text are excluded
from the repository.

[PRE-RUN ESTIMATE 2026-11-11] The two calls were expected to cost well under $1
at Sonnet 4.6 rates of $3 per million input tokens, $15 per million output
tokens, and $3.75 per million five-minute cache-write tokens. The estimate
assumed both calls could write the cache and used the full output-token
allowance. Actual billing depends on provider token accounting. The code
caps call count and output tokens. [Sonnet 4.6 pricing](https://platform.claude.com/docs/en/models/sonnet-4-6/overview), [cache pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing).

## Live generation outcome

The [sanitized trial receipt](../audits/SHARED_EXECUTOR_CONTROLLED_TRIAL_2026-11-11.json) preserves the final state, usage, snapshot hash and audit readback without applicant text.

[VERIFIED via the scoped PostgreSQL receipt and provider usage, 2026-11-11]
Both Sonnet 4.6 Messages POSTs returned HTTP 200. The worker saved both
response checkpoints and ran the normal validator. One draft passed the
format checks and remained available for staff review.

| Task | Validation and retention | Uncached input | Output | Cache write | Cache read |
|---|---|---:|---:|---:|---:|
| Executive Summary | Format validated and retained for review. 199 words, 1,592 characters. | 370 | 337 | 21,507 | 0 |
| Methodology | `failed_validation` / `claude_output_truncated`. Reached the 1,536-token cap. No validated draft. | 380 | 1,536 | 0 | 21,507 |

The terminal job receipt is version 17, `needs_attention`. The scoped
result read returned the retained Executive Summary. The status read
reported the Methodology failure. Two audit POSTs returned HTTP 201, and
both attempt receipts reached `delivered`. Readback verified the stable
AI-run IDs, Request, v1 prompt rows, model, success/failure statuses and
impersonation. The configured actor was `createdby`, and the service
identity was `createdonbehalfby`. The rows carry the existing `Vercel User`
run-source label. This was a local service run. The worker passed its
closed, content-free payload plus the stable row ID to the audit transport.
The final readback found the raw-output and prompt-override fields absent
on both rows and verified the bounded status notes.

| Task | Published v1 prompt ID | Dataverse AI-run ID |
|---|---|---|
| Executive Summary | `07203a95-fedd-f111-84ea-6045bd04539e` | `262a4fb2-af4a-4e8e-8ccd-d08f07008f93` |
| Methodology | `43ea739a-fedd-f111-84ea-000d3a361c1f` | `7ba978ef-4ad5-4ae2-a402-77e8e16f0ea0` |

Both receipts have complete usage. The Methodology call read the 21,507
prefix tokens written by the Executive Summary call. This establishes
cache reuse for this exact pair. The validation failure did not trigger a
retry. The Executive Summary SHA-256 is
`99bcdf42d3243f1b75e9a0bea4ae6bcfc6d27981688dc2c0861b87f5af443240`.

Qualitative review of the retained draft found a PI-attribution problem. The
scientific content was coherent, but the draft put the stored Project Leader
name next to institution and co-investigator claims drawn from the proposal.
The stored name did not appear in the PDF, and those relationships have
not been verified for that person. The summary remains a draft. A proposed
prompt-contract correction is to keep identity and affiliation claims out
of the scientific draft and render the structured PI field separately.
This finding provides no basis to change the Request's Project Leader.

[ESTIMATE] The measured token usage prices to approximately **$0.11745**
at the published Sonnet 4.6 rates above, including the $0.30 per million
cache-read rate. Billing was not independently verified.

## Scoped retention follow-up

The temporary trial process ended and the gate returned to its default-off
state. No scheduler was installed. The source and response content becomes
eligible for physical deletion at 2026-11-12 18:35:20.575 UTC. Configuration,
results and the deferred audit payloads become eligible on 2026-11-18
at 18:35:20.575 UTC. The job, task and attempt receipts remain.

At the next session after each deadline, Codex or the operator must run and
verify the exact scoped cleanup. The runner matches the stored job ID under
the four-part environment, principal, authorization and Request scope
before deleting expired content. The command uses the retained private
state and calls `expireContent` for this cohort only. It requires no
Dataverse reads or active actor. Physical deletion has not yet been verified.

```sh
node scripts/run-proposal-trial-1003384.cjs --approved-request-1003384 expire /private/tmp/wmkf-proposal-trial-1003384
```

## Prompt revisions for the second trial

The [corrected task inputs](SHARED_EXECUTOR_PROPOSAL_RETRY_CANDIDATE_2026-11-11.json)
instruct both tasks to omit PI and personnel names and institutional or
collaboration attributions. Methodology targets 300–350 words with a
400-word validation ceiling. The candidate keeps profile revision 1,
Sonnet 4.6 and the 1,536-token output budget. The shorter target is
intended to leave room within the token budget.

The current contract requires the frozen PI declaration and its
`{{pi_name}}` placeholder. Admin preview rejected the candidate when the
placeholder was omitted. Restoring it as context-only allowed both task
inputs to pass offline validation. That checks configuration and the declared
output contract. The separately approved follow-up published both task
revisions as v2. The first runner remains bound to its original publication
and cohort.

## Second controlled trial

[VERIFIED 2026-11-11 via publication and scoped service readback] The owner
approved both v2 task updates and one fresh two-call Sonnet 4.6 cohort under
the same 1,536-token budget and an estimated cost below $1. Preflight confirmed
the actor, all migration 097 tables and the unchanged profile revision 1.
The publisher created v2 for both tasks and conditionally demoted the
exact v1 rows. Readback found both v2 rows current and both v1 rows no
longer current. No settings, schema, Request, Graph, Blob or deployment
writes occurred in this cohort.

Cohort `2fe01641-1860-4233-9233-7864946feb68` admitted job
`c4fa16dc-867a-417e-977f-f9cfae962c70`. The approved PDF hash was unchanged
and the stored snapshot matched the approved canonical hash. Both provider
calls completed with `end_turn`. The final receipt is v17, `needs_attention`,
with both content-free audits delivered. Readback confirmed the Request,
actor, exact v2 prompt links and absent raw-output/prompt-override fields.
The [sanitized second-trial receipt](../audits/SHARED_EXECUTOR_CONTROLLED_TRIAL_V2_2026-11-11.json)
records the IDs, hashes and readback.

| Task | Outcome | Uncached input | Output | Cache write | Cache read |
|---|---|---:|---:|---:|---:|
| Executive Summary | Retained. 186 words and 1,520 characters. | 441 | 304 | 21,507 | 0 |
| Methodology | `failed_validation` / `profile_output_invalid`. Finished at 419 words against the 400-word maximum. | 478 | 783 | 0 | 21,507 |

Both usage records are complete. The second call reused all 21,507 prefix
tokens. The usage-based estimate is **$0.10617** at the published rates.
Billing was not independently verified.

The Opus 5.5-only qualitative review found the retained summary ready for
staff review. The v1 identity/affiliation association was absent. Staff
should attribute the applicant's novelty claim and distinguish proteome-wide
length evidence from topology evidence on the reader-domain panel.
Scientific claims were not independently verified, and the reviewer
did not read the bibliography tail.

The rejected Methodology also contained grounding errors. It misstated the
oligomer range for crystallography, mischaracterized the role of chemical
synthesis despite an existing branched trimer, and overstated the phasing
precedent and program-wide dependencies. The prompt asks for material gaps.
The issue is presenting unsupported inference as source fact. Offline
replay of the exact validator reproduced rejection at 400 words. A
hypothetical 419-word limit accepted the format, leaving the grounding
issues unresolved. No live policy change or third call occurred. The
failed job remains intact. Further work uses saved evidence for offline
length and grounding checks.

### Second cohort retention

The operator must verify exact-scope cleanup after 2026-11-12 19:11:55.608 UTC
for source and responses, and after 2026-11-18 19:11:55.608 UTC for
configuration, results and deferred audit payloads. No scheduler was
installed. Physical deletion is pending. Preserve the first cohort's
separate deadlines and private state.

```sh
node scripts/run-proposal-trial-1003384-v2.cjs --approved-request-1003384-v2 expire /private/tmp/wmkf-proposal-trial-1003384-v2
```

## Verification and review

[VERIFIED via local commands] Final integrated proof passed **1,110 tests in 50 suites**, including three real PostgreSQL suites, after the Opus review fixes. The full application build and 25 scoped gates/self-tests passed. The staff panel passed desktop and 390px mocked-browser inspection with actual shared controls; narrow document scroll width was 390px. The candidate configuration in `SHARED_EXECUTOR_PROPOSAL_TRIAL_INPUTS_2026-11-11.json` passed the actual Admin preview validator with fabricated materials before publication.

Opus 5.5's build review requested a larger timing window. The staff worker now uses a 240-second coordination lease within a 300-second function limit, preserving the existing model timeout and persisted prompt output budget. Source expiry now terminates before preparation; a race at snapshot persistence also terminates. Known source admission failures have safe actionable responses. Discovery retries a version race. The drain reports terminal receipt state, and the CLI treats only `complete` as exit zero. Targeted and integrated regression tests pass. The [Opus review receipt](../audits/SHARED_EXECUTOR_STAFF_OPUS55_REVIEW_2026-11-11.md) records the READY follow-up, dispositions and verification limits.

The staff pilot was neither activated nor exercised through HTTP in the isolated Power Automate Preview. Both scoped runs exercised the provider, cache,
validator, result readback and impersonated audit delivery. Another live
cohort or additional generation calls require separate approval. Keep each
cohort's private cleanup state until both of its expiry steps are verified.

## Offline Methodology follow-up

[VERIFIED via local test] The unpublished Methodology v3 candidate changes
only the Methodology instructions from the published v2 definition.
It expects current task version 2 and keeps profile revision 1, Sonnet 4.6,
the 1,536-token budget, the 400-word ceiling and the 12,000-character limit.
It asks for up to four short paragraphs and aims for 220–280 words. It
requires attribution to the proposal, limits ranges to the experiments
they describe, and distinguishes existing materials, planned methods,
fallbacks and review inferences. One optional final review sentence can
identify a specific omission and a possible implication. It keeps the frozen PI context required
by the current profile contract and instructs the model to omit identity
from the draft. [Unpublished candidate](SHARED_EXECUTOR_PROPOSAL_METHODOLOGY_V3_CANDIDATE_2026-11-11.json).

The offline command runs the Admin sample preview and output-format validator.

```sh
npx jest tests/unit/prompt-jobs-methodology-offline.test.js --runInBand --silent
```

Preview uses a fabricated document and an injected profile read. The
validator accepts 400 words and rejects 401 and a synthetic 419-word case,
as well as text above the character limit. The synthetic grounding
challenge provides source excerpts, draft claims and human review
annotations for unsupported ranges, primary versus fallback synthesis,
overstated dependencies and missing information treated as a negative
finding. [Synthetic grounding challenge](../../tests/fixtures/prompt-jobs-methodology-grounding.synthetic.json).
All of those drafts can pass the format validator. Reviewers must compare
the claims to the source manually. The offline check establishes
configuration and format behavior. Generation behavior and grounding
under the revised instructions remain unverified. No applicant content
was recovered for this work, and the candidate was not published or run.


The read-only Opus 5.5 subscription OAuth review returned READY for the
offline contract. Its model-usage receipt named only `claude-opus-5-5`.
The follow-up confined any inference to the single review sentence, made
the feasibility boundary explicit, and strengthened the test to check
that the Admin preview contains the revised body and resolves the PI
placeholder. Local tests were rerun after those changes.
