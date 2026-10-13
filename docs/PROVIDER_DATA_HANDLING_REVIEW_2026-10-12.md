---
title: Provider Data Handling Review and Confirmation Register
domain: security-auth
kind: audit
status: active
summary: Official provider documentation, public retention limitations, account-specific unknowns, and recommended confirmation evidence; no entitlement attestation.
canonical: false
cataloged: 2026-10-12
last_verified: 2026-10-12
owner: product-engineering
related:
  - docs/IT_TECHNICAL_BRIEF.md
  - docs/SECURITY_MITIGATION_PLAN_2026-10-12.md
  - docs/CREDENTIALS_RUNBOOK.md
---

# Provider Data Handling Review and Confirmation Register

## Scope and evidence boundary

Research retrieved October 12, 2026 PT by an owner-requested subagent. Covers the principal AI, transcription and scan processors identified in the technical brief, plus hosting/storage/source-system copies. This is not an exhaustive census of every research/search integration or every legal document. Public policies can change; recheck before an account or model change.

Public documentation establishes product terms and limitations, not the Foundation's accepted agreement, active account configuration, subscription entitlement or deletion completion. No vendors were contacted, credentials exposed, settings changed or account entitlements independently verified. The owner requested public gaps and concrete confirmation recommendations; these remain recommendations, not accepted vendor-risk exceptions.

## Anthropic API

**Applicable integration:** direct Messages API in `lib/services/llm-client.js`, not consumer Claude, Bedrock or Foundry.

**Public limitation:** commercial policy describes API input/output deletion within 30 days, subject to agreement/legal/safety exceptions. ZDR is organization-specific and model/feature-dependent. Some API-page wording about default retention differs in scope from the commercial retention policy; do not infer default ZDR. Current Covered Models policy also has model-specific retention rules; this is a model-upgrade review requirement, not proof our active model is affected.

Sources: [commercial retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [API retention arrangements](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [Covered Models](https://privacy.claude.com/en/articles/15425996-data-retention-practices-for-covered-models), [residency](https://platform.claude.com/docs/en/manage-claude/data-residency), [DPA](https://www.anthropic.com/legal/data-processing-addendum).

**Confirm:** identify the organization/workspace serving the production key; obtain dated confirmation of training use, ZDR entitlement, eligible exact model IDs/features, safety/human-review/legal exceptions, backups and deletion. Export workspace residency controls (`default_inference_geo`, `allowed_inference_geos`). Omitting a per-request region does not prove workspace restrictions are absent.

**Recommendation:** seek ZDR for confidential proposal/review processing and maintain approved model/feature/region lists. If standard retention is accepted instead, record that explicit decision.

## OpenAI API

**Applicable integration:** Chat Completions in `lib/services/openai-client.js`. The body omits `store`; this is not evidence stored completions are enabled.

**Public limitation:** API data is not used for training unless opted in, but default abuse-monitoring logs may contain content and persist up to 30 days, with exceptions. ZDR or Modified Abuse Monitoring requires approval/configuration and has model/feature limitations. `store:false` alone does not eliminate abuse-monitoring retention. Region controls require compatible configuration, endpoints and models.

Sources: [API data controls](https://developers.openai.com/api/docs/guides/your-data), [DPA](https://openai.com/policies/data-processing-addendum/), [subprocessors and notifications](https://openai.com/policies/sub-processor-list/).

**Confirm:** organization owner captures organization Data Retention and the specific production project override; verify training/data-sharing opt-ins, ZDR/MAM approval, exact model/cache/safety rules, regional processing and deletion/backups. Support requests use organization/project identifiers, never API secrets.

**Recommendation:** seek ZDR for confidential text processing; explicit `store:false` is defense in depth, not ZDR. Recheck model eligibility before model changes.

## AssemblyAI asynchronous transcription

**Applicable integration:** `/v2/upload`, transcript submission/read/delete, US/EU roots in `lib/services/transcription-pilot/provider.js`. The runbook records training opt-out and one-day retention acceptance; it is historical acceptance, not fresh dashboard evidence.

**Public gap:** asynchronous transcription is not the streaming product's ZDR offering. Current opened docs describe ordinary transcript automatic deletion beginning at 30 days; configurable TTL can be shorter, but deletion may lag expiry by hours or days. One-day TTL is not a guarantee that every copy disappears within 24 hours. Some billing/logging metadata remains. Stale search snippets saying indefinite transcript retention were not used as the current policy.

Paid accounts have self-service Data Controls; free accounts cannot opt out of model improvement. Opt-out and TTL changes apply prospectively, not retroactively.

Sources: [retention and training](https://www.assemblyai.com/docs/data-retention-and-model-training), [Data Controls](https://www.assemblyai.com/docs/data-controls), [opt-out details](https://www.assemblyai.com/docs/faq/how-to-opt-out-of-data-sharing-for-our-model-improvement-program), [regions](https://www.assemblyai.com/docs/pre-recorded-audio/select-the-region), [DELETE](https://www.assemblyai.com/docs/pre-recorded-audio/delete-transcripts), [DPA](https://www.assemblyai.com/legal/data-processing-addendum).

**Confirm:** capture opt-out and TTL for all production keys with effective dates. Ask when TTL starts and maximum guaranteed deletion delay; coverage of uploaded audio, transcripts, intermediates, failed submissions and backups; orphan-upload deletion without a returned transcript ID; treatment of pre-opt-out requests; residual metadata fields and lifetime; actual US/EU routing.

**Recommendation:** keep non-sensitive-only restriction until answers are accepted. Continue immediate deletion plus retry; provider TTL is a backstop. Select the shortest retention compatible with reliable completion/recovery, supported by measured cleanup evidence.

## Cloudmersive advanced virus scanning

**Applicable integration:** file bytes to `/virus/scan/file/advanced`, `lib/services/cloudmersive-scan.js`.

**Positive public commitment:** security documentation describes stateless APIs that do not retain payloads after transaction completion. This supports transient processing, not a finding of routine scanned-file retention.

**Unknown scope:** the DPA must be accepted to apply and gives a broader customer deletion-request period up to 180 days during the term. This does not establish that scan payloads are kept 180 days. Optional Managed Instance threat analytics has a separate 90-day statement; applicability and retained fields are unverified.

Sources: [security](https://cloudmersive.com/security), [DPA](https://cloudmersive.com/data-processing-dpa), [threat analytics](https://cloudmersive.com/release-notes/Virus-Scan-API-Threat-Detection-Analytics), [subprocessors](https://cloudmersive.com/subprocessors).

**Confirm:** endpoint/subscription/region-specific written statement for file bytes, extracted text, names, hashes, malicious samples, failed payloads, diagnostics/support captures, backups and threat-research/training sharing. Ask whether analytics is enabled and which data DPA section 6.1 covers. Obtain the accepted agreement.

**Recommendation:** keep scanning mandatory while resolving terms. If commitments are unacceptable, evaluate an approved alternative or private deployment rather than disabling protection.

## Infrastructure and source copies

These are additional retention boundaries, not findings that confidential data is exposed.

| Service | Public evidence and implication | Account-specific evidence needed |
|---|---|---|
| SharePoint | [Retention](https://learn.microsoft.com/en-us/microsoft-365/compliance/retention-policies-sharepoint?view=o365-worldwide) and [deletion lifecycle](https://learn.microsoft.com/en-nz/sharepoint/sharepoint-data-deletion): holds/recycle bins/versions may preserve copies. | Site policies, labels, holds, version rules and backups; distinguish records from temporary content. |
| Dataverse | [Backup/restore](https://learn.microsoft.com/en-us/power-platform/admin/backup-restore-environments): backups have independent retention. | Actual geography, backup window, audit retention, AI-run cleanup, handling restored deleted data. |
| Vercel Blob/Functions | [Blob security](https://vercel.com/docs/vercel-blob/security), [runtime logs](https://vercel.com/docs/logs/runtime): access modes and plan-dependent logs differ. | Every store's access mode/region, cleanup, log drains and backend/cache/backup deletion. Do not assume all stores are private. |
| Vercel Workflow | [Workflow docs](https://vercel.com/docs/workflows): run state can retain inputs/outputs/errors. | Actual serialized data, viewer permissions, event/state expiry and deletion. Prefer references to sensitive content where feasible. |
| Vercel Sandbox | [Snapshots](https://vercel.com/docs/sandbox/concepts/snapshots): persistent snapshots have their own lifecycle. | Exact SDK/mode and snapshot use; media/log/snapshot backend deletion. Stopping a sandbox alone is not an all-copy erasure guarantee. |
| Neon PostgreSQL | [Production restore guidance](https://neon.com/blog/6-best-practices-for-running-neon-in-production), [DPA](https://neon.com/pdf/DPA.pdf): restore history/backups outlive row deletion. | Actual app and Factory project region, restore window, branches/clones, exports and backup expiry. Runbook identification is not a fresh account readback. |
| Zoom | [Recording deletion](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066493): recoverable trash stage; imported copies independent. | Auto-delete, trash, sharing, region and AI Companion settings; owner of original-recording cleanup. |

## Evidence package and next decisions

Per production service, retain account/project identifier, accepted agreement/DPA version, dated setting evidence, approved data categories, training policy, region, retention by data type, deletion exceptions/backups, confirmation ticket, owner and recheck date. Never store keys or confidential sample payloads in this register.

1. **UNKNOWN:** Anthropic/OpenAI production retention entitlements. Decide whether to accept standard content retention or obtain ZDR after account evidence.
2. **UNKNOWN:** AssemblyAI opt-out effective date, TTL and deletion lag guarantees. Keep current non-sensitive restriction pending acceptance.
3. **UNKNOWN:** Cloudmersive diagnostic/threat-data scope and applicable DPA. Obtain endpoint-specific support confirmation.
4. **UNKNOWN:** tenant/hosting retention and historical copies. Include Workflow state, sandbox snapshots, database history and Microsoft/Zoom sources.

Request account exports where controls are visible; otherwise ask support for written scope tied to the actual subscription and endpoint. Escalate contractual exceptions to the account representative. No vendor contact is authorized merely by saving this register.
