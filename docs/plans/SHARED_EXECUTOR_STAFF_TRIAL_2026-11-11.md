# Staff drafts and controlled proposal trial

The staff workflow passed local verification on the isolated branch. The Opus 5.5 follow-up verdict was READY. The owner-uploaded narrative for Request 1003384 passed a read-only run of the source adapter. Live generation awaits scoped configuration, actor and storage preflight, then explicit publication and application API-spend approval. No deployment or Request field writes are part of this slice.

## Surface and review

[BRANCH-BUILT] Staff Proposal tab → authenticated Workbench job routes → server-owned trial policy/source adapter → existing PostgreSQL Executor ledger → bounded worker → separately authorized validated-result reads. Persistence uses migration 097's existing six tables; Dataverse supplies pinned prompt/profile definitions and receives content-free AI-run audit records only after explicit trial approval. Existing legacy summary paths remain consumers of their existing fields.

Prior findings: Opus 5.5 plan review (`/private/tmp/wmkf-staff-workflow-plan-review.json`) returned READY WITH NAMED CHANGES. Its required changes are captured below. Review model usage was exclusively `claude-opus-5-5` through Claude subscription OAuth. No application inference has run.

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

[BRANCH-BUILT] Source adapter uses strict complete SharePoint resolution, a unique active AI Materials location, bounded download with identity/version checks before and after, and exact source/PI comparison before each dispatch. Manifest stores identity and hashes; snapshot stores source text. The owner authorized scoped Request 1003384 and related document inspection; those reads are recorded below. Prompt/profile publication, two Anthropic application calls, and content-free audit writes still require a concrete trial approval. Ordinary Opus OAuth development reviews are already authorized and do not substitute for application model-cost consent.

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
configuration, audit or Request data. Live execution still requires the
scoped preflight and explicit approval.

## Proposed live trial

After scoped configuration, actor and storage preflight, the proposed run
would publish one profile revision and two task versions, activate one
cohort for Request 1003384, and use the uploaded file version verified above.
It would make at most two Sonnet 4.6 application calls at 1,536 output
tokens each, retain validated Executive Summary and Methodology drafts, and
write content-free AI-run audit records. The run has no Request-field
writeback or deployment step. Publication, activation, application API spend
and audit writes still require explicit approval. The Opus 5.5 development
reviews used separate Claude subscription OAuth.

[ESTIMATE 2026-11-11] The two calls are expected to cost well under $1 at
Sonnet 4.6 rates of $3 per million input tokens, $15 per million output tokens,
and $3.75 per million five-minute cache-write tokens. The estimate assumes
both calls may write the cache and applies the full output-token allowance.
Actual billing depends on provider token accounting. The code caps call
count and output tokens. [Sonnet 4.6 pricing](https://platform.claude.com/docs/en/models/sonnet-4-6/overview), [cache pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing).

## Verification and review

[VERIFIED via local commands] Final integrated proof passed **1,110 tests in 50 suites**, including three real PostgreSQL suites, after the Opus review fixes. The full application build and 25 scoped gates/self-tests passed. The staff panel passed desktop and 390px mocked-browser inspection with actual shared controls; narrow document scroll width was 390px. The unpublished candidate configuration in `SHARED_EXECUTOR_PROPOSAL_TRIAL_INPUTS_2026-11-11.json` passes the actual Admin preview validator with fabricated materials.

Opus 5.5's build review requested a larger timing window. The staff worker now uses a 240-second coordination lease within a 300-second function limit, preserving the existing model timeout and persisted prompt output budget. Source expiry now terminates before preparation; a race at snapshot persistence also terminates. Known source admission failures have safe actionable responses. Discovery retries a version race. The drain reports terminal receipt state, and the CLI treats only `complete` as exit zero. Targeted and integrated regression tests pass. The [Opus review receipt](../audits/SHARED_EXECUTOR_STAFF_OPUS55_REVIEW_2026-11-11.md) records the READY follow-up, dispositions and verification limits.

The branch remains undeployed. Live provider latency/cache reuse and Dataverse audit attribution remain unverified. Next, check the scoped configuration and profile/task versions, current actor, ledger storage and expiry handling. Obtain explicit approval for trial publication, activation, application API spend, and content-free audit writes before the live run. The source adapter rechecks the exact file and PI record before dispatch. Keep the configured cohort available for scoped 24-hour/seven-day expiry cleanup, or arrange explicit scoped cleanup before deactivating it. Never delete job or attempt receipts to reset the quota.
