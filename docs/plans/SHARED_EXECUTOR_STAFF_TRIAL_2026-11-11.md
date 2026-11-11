# Staff drafts and controlled proposal trial

Status: implementation in progress; live trial awaits a specific Request, source confirmation, and scoped live-access/model-cost approval. No deployment or Request field writes are part of this slice.

## Surface and review

[PLANNED] Staff Proposal tab → authenticated Workbench job routes → server-owned trial policy/source adapter → existing PostgreSQL Executor ledger → bounded worker → separately authorized validated-result reads. Persistence uses migration 097's existing six tables; Dataverse supplies pinned prompt/profile definitions and receives content-free AI-run audit records only after explicit trial approval. Existing legacy summary paths remain consumers of their existing fields.

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

[PLANNED] Trial activation defaults off. Configuration binds one trial UUID, one Request GUID and one authenticated staff profile/system-user identity. Environment derives from deployment and actual Dataverse target classification. Only local-production, local-sandbox and preview-sandbox are permitted; deployed production and unknown targets fail closed. A separate stable server nonce secret seals prepared snapshots. Trial activation and cron scheduling are not committed as live configuration.

[PLANNED] Source adapter uses strict complete SharePoint resolution, a unique active AI Materials location, bounded download with identity/version checks before and after, and exact source/PI comparison before each dispatch. Manifest stores identity and hashes; snapshot stores source text. Real Request/source reads, prompt/profile publication, two Anthropic application calls and content-free audit writes require a concrete trial approval. Ordinary Opus OAuth development reviews are already authorized and do not substitute for application model-cost consent.

## Pending evidence

Implementation tests, build review, browser verification, scoped gates, and trial receipt will be recorded here before a completion claim. Current branch-only work is not deployed. A successful fabricated provider-double rehearsal is not evidence of live provider, Dataverse audit, or actual document-source behavior.
