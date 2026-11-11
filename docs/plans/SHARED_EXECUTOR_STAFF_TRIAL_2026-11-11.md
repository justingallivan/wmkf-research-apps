# Staff drafts and controlled proposal trial

Status: staff workflow built and verified on the isolated branch; Opus 5.5 follow-up verdict READY. The owner selected Request 1003384 for read-only inspection. Live generation awaits a substantive narrative, source confirmation, and scoped publication/model-cost approval. No deployment or Request field writes are part of this slice.

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

[PLANNED; owner confirmation pending] First trial uses that narrative and directly stored Project Leader name; Executive Summary is capped at 200 words, Methodology at 12,000 characters, each provider call at 1,536 output tokens. One cohort permits one two-task job, with no provider retries and no automatic rerun after source changes. The new task definitions are `proposal.executive-summary` and `proposal.methodology`.

[BRANCH-BUILT] Trial activation defaults off. Configuration binds one trial UUID, one Request GUID and one authenticated staff profile/system-user identity. Environment derives from deployment and actual Dataverse target classification. Only local-production, local-sandbox and preview-sandbox are permitted; deployed production and unknown targets fail closed. A separate stable server nonce secret seals prepared snapshots. Trial activation and cron scheduling are not committed as live configuration.

[BRANCH-BUILT] Source adapter uses strict complete SharePoint resolution, a unique active AI Materials location, bounded download with identity/version checks before and after, and exact source/PI comparison before each dispatch. Manifest stores identity and hashes; snapshot stores source text. The owner authorized scoped Request 1003384 and related document inspection; those reads are recorded below. Prompt/profile publication, two Anthropic application calls, and content-free audit writes still require a concrete trial approval. Ordinary Opus OAuth development reviews are already authorized and do not substitute for application model-cost consent.

## Read-only Request 1003384 inspection

[VERIFIED via owner-authorized Dataverse and Graph reads, 2026-11-11] Request `1003384` resolves uniquely to `15d8e475-02d3-f111-a05b-70a8a5b11800`. Its Project Leader contact exists and has a stored name. The one active `akoya_request` folder contains eight files, all under `Submission-Documents`; no AI Materials copy was found in the complete bounded inventory.

| File | Observed state |
|---|---|
| `Project-Narrative_1003384.pdf` | 263,288 bytes; stable metadata across download; 7,034 extracted UTF-8 bytes / 1,074 words. The nine-page draft test application contains placeholders, rather than substantive research methods. |
| `Research Proposal_2026-10-28T19-04-54Z.pdf` | 10,720,526 bytes; stable metadata; 63,340 extracted UTF-8 bytes / 9,502 words. Mixed test application and assorted attachments, including research slides; not one coherent narrative for this Request. |
| `Bibliography_1003384.pdf`, `Biosketches_1003384.pdf`, `Collaboration-Letters_1003384.pdf`, `Other-Support_1003384.pdf`, `Graphical-Abstract_1003384.jpg`, `declarationofstatus_Test 1.pdf` | Present in the bounded metadata inventory. Separate contents were not validated; filenames alone do not prove the advertised content. |

The missing trial input is a substantive project narrative with a hypothesis, approach, experiments/methods and expected impact. A representative past proposal or realistic sample can exercise the architecture. A separate bibliography is unnecessary for this first pair. The owner may supply that narrative. The candidate AI Materials source policy has not been silently switched to a different folder, and no files were moved or written.

The inspection used a process-only production-read allowance after the owner's explicit instruction, with the Dataverse interlock on and a fetch guard permitting only GET/HEAD plus Azure token POSTs. No generation, prompt publication, Request mutation, or audit write occurred. No personal contact values or extracted applicant text are retained in this repository.

## Verification and review

[VERIFIED via local commands] Final integrated proof passed **1,110 tests in 50 suites**, including three real PostgreSQL suites, after the Opus review fixes. The full application build and 25 scoped gates/self-tests passed. The staff panel passed desktop and 390px mocked-browser inspection with actual shared controls; narrow document scroll width was 390px. The unpublished candidate configuration in `SHARED_EXECUTOR_PROPOSAL_TRIAL_INPUTS_2026-11-11.json` passes the actual Admin preview validator with fabricated materials.

Opus 5.5's build review requested a larger timing window. The staff worker now uses a 240-second coordination lease within a 300-second function limit, preserving the existing model timeout and persisted prompt output budget. Source expiry now terminates before preparation; a race at snapshot persistence also terminates. Known source admission failures have safe actionable responses. Discovery retries a version race. The drain reports terminal receipt state, and the CLI treats only `complete` as exit zero. Targeted and integrated regression tests pass. The [Opus review receipt](../audits/SHARED_EXECUTOR_STAFF_OPUS55_REVIEW_2026-11-11.md) records the READY follow-up, dispositions and verification limits.

This branch is not deployed. Provider-double proofs do not establish live provider latency/cache reuse, Dataverse audit creation, or source behavior for a future replacement narrative. Before any live run, verify the exact final source, frozen prompts/profile, actor scope, cost cap and retention execution. Keep the configured cohort available for scoped 24-hour/seven-day expiry cleanup, or arrange explicit scoped cleanup before deactivating it. Never delete job or attempt receipts to reset the quota.
