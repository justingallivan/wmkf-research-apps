---
title: Security Controls and Application Authority Implementation Plan
domain: security-auth
kind: plan
status: active
summary: Owner-approved direction for mandatory security controls, scan quarantine, explicit write authority, and attributable elevated actions; implementation not started.
canonical: false
cataloged: 2026-10-12
last_verified: 2026-10-12
owner: product-engineering
related:
  - docs/IT_TECHNICAL_BRIEF.md
  - docs/PROVIDER_DATA_HANDLING_REVIEW_2026-10-12.md
  - docs/SECURITY_OPERATING_PLAN.md
---

# Security Controls and Application Authority Implementation Plan

## Decision and implementation status

**PLANNED, not implemented.** On October 12, 2026, the owner approved the recommendations for configuration safeguards and application authority and requested an implementation plan. This documentation does not authorize a production release, account-permission change, vendor contact, or confidential-transcription expansion.

Approved direction:

- Production safeguards cannot silently switch off.
- Files requiring malware scanning remain unavailable until scanning succeeds. Use private quarantine where safely supported; otherwise reject with a retry message.
- Shared staff workflows may deliberately use application authority, including the request-abstract update.
- User-authorized operations stop when the user lacks permission; automatic permission-denied escalation ceases to be the general default.
- Elevated actions must remain attributable to their initiating human or named job.

Provider retention decisions remain separate: see [provider evidence register](PROVIDER_DATA_HANDLING_REVIEW_2026-10-12.md). No retention period or ZDR entitlement has been approved or verified by this plan.

## Verified baseline and limits

Review baseline: `2962dee705ceff0886a3976bd742f0309d72c16a`. A read-only Vercel query found production alias `applications.wmkeck.org` READY on that same commit, deployment `dpl_Af7fn4tX9ivphLmmRit6mFdR2d6E`. Saved production project settings were:

| Setting | Observed value |
|---|---|
| AUTH_REQUIRED | true |
| DYNAMICS_IMPERSONATION_ENABLED | true |
| VIRUS_SCAN_ENABLED | true |
| DATAVERSE_TARGET_INTERLOCK | on |
| DATAVERSE_DAL_ENFORCEMENT | on |

These are dated project-setting readbacks, not in-process attestation of every running function. No secrets were recorded. The live Microsoft service principal's complete permissions were not audited.

| Finding | Source evidence | Qualification |
|---|---|---|
| Missing scan flag disables scanning | `lib/utils/virus-scan-config.js`, `isVirusScanEnabled` | When enabled, integrated upload paths are intended to fail closed. This does not establish universal coverage of all media paths. |
| Missing target interlock disables it | `lib/dataverse/core/interlock.js`, `resolveInterlockMode` | Invalid nonempty values resolve to on. |
| Production DAL enforcement defaults off | `lib/services/dynamics-context.js`, `isDalEnforcementOn` | Trusted context is a structural write guard, not per-record authorization. |
| Ordinary missing configuration does not disable production sign-in | `lib/utils/auth-policy.js` | Explicit emergency bypass is a separate path. |
| Impersonated 403 can retry as app | `lib/services/dynamics/write-core.js`, `_writeFetch` | Not a demonstrated unauthenticated bypass; strict workflows opt out. |
| Concrete shared-workflow caller | `pages/api/review-manager/update-abstract.js` → `lib/services/review-manager/update-abstract-service.js` → grant-request adapter → updateRecord | Route checks app access; individual Dynamics permissions do not consistently constrain the operation. |
| Skipped scan can be marked clean | `pages/api/intake/draft/attach.js`, scanner posture and cleanRow | `scanner: skipped` distinguishes it; affected production records have not been established. |
| No general safety-value gate found | `package.json` prebuild, `.github/workflows`, `next.config.js`, `vercel.json`, `lib/utils/health-checker.js` | Existing targeted gates are not a whole-app configuration attestation. |

A fresh subagent challenged the permission/configuration findings and confirmed the qualifications above. Focused Jest execution did not reach tests: Next/Workflow initialization attempted to generate a source file and the filesystem restriction blocked it. Do not cite that attempt as passing tests. No application/configuration/data changes were made during this review.

## Release 1 — Enforce required security configuration

Create one production security-policy validator used by deployment checks and runtime guards. Require target protection, trusted DAL enforcement, scanner enablement on scanner-required paths, and authentication without the ordinary emergency-bypass path. User-authorized writes additionally require functioning impersonation.

Classify production, preview, local development, and tests explicitly using platform context; `NODE_ENV=production` alone must not confer production target authority on a preview build. Preserve existing narrowly scoped rehearsal contracts. Missing, disabled or malformed mandatory settings reject the affected operation rather than silently weakening protection.

Add a protected, content-free security-status check. Report policy identifiers and safe status only; do not expose secrets, query business content or invoke AI. Connect failure and recovery to a named operator with deduplicated alerts. Do not reuse the current general health checker as a supposedly free security probe: it makes an AI request.

**Verification:** missing/invalid/off flag matrix; production auth remains required; preview-to-production writes denied; saved settings and running revision independently checked. Test both positive and negative paths. Capture an alert and its recovery.

**Release gate:** required controls are enforced during operations, not merely at deployment; configuration drift alerts an accountable operator.

## Release 2 — Make scan results and quarantine reliable

Inventory scanner-integrated admission, finalize, extraction, publication, download, retry and cleanup paths. Bind the successful scan to the exact immutable bytes or verified digest/version published. Reauthorize retries and finalization.

Allow private staging during outages only where a safe retry/expiry path already exists or is deliberately implemented. Block ordinary download, extraction, publication and distribution while pending. Otherwise reject with a clear retry message. Reuse existing staging; a new asynchronous quarantine platform is not a prerequisite for safe rejection.

Distinguish clean, infected, pending, unavailable and skipped. Correct applicant intake's skipped-as-clean branch. Before changing persisted status semantics, inventory every consumer, schema constraint and projection. Perform a bounded, separately authorized historical assessment of `scan_result=clean` with `scanner=skipped`; do not assume records exist, mark them scanned, or automatically delete/reclassify business files.

**Verification:** scanner timeouts, missing credentials, infected and mixed-result batches, post-scan byte substitution, duplicate finalization, authorization revocation, expiry, retries and cleanup. Ensure success cannot be reported for an entirely failed batch.

**Release gate:** scanner-required content cannot be released without an actual clean result, and historical skipped results have an explicit remediation disposition.

## Release 3 — Declare the authority of each operation

Inventory every mutation path: direct writes, adapters, update-if-empty, deletes, associations/disassociations, batch/changesets, email activity/attachment/send, background jobs and scripts. Document application-identity reads and their route/service access scopes as well.

| Mode | Required behavior |
|---|---|
| Individual user | Require a server-established actor and enabled impersonation. Denial stops the operation; missing actor cannot become an app write. |
| Shared application workflow | Require an approved named operation, server-side app access, target-record and allowed-field checks. Deliberately use application authority. |
| Unattended job | Require a named job identity, bounded scope, and workflow authorization. Do not fabricate a human actor. |

Clients cannot select the authority mode or provide trusted actor identity. Unknown operation names and unclassified mutation paths fail closed. A generic DAL context alone does not authorize an elevated operation.

Classify callers before changing shared defaults. Keep the approved shared request-abstract workflow working. Preserve strict final-writeup acknowledgement and lead-PD sending behavior; do not convert those to app authority just to avoid permission failures. Preserve concurrency checks, partial-success contracts, idempotency and uncertain-outcome recovery. Inspect embedded batch errors as well as outer HTTP status.

**Verification:** individual denial makes no elevated retry; absent actor/disabled impersonation stops user-mode writes; shared workflow succeeds only for authorized callers/targets/fields; unknown policy rejected; batch and email semantics match; unattended jobs remain scoped.

**Release gate:** every production mutation has a declared contract and no unclassified caller retains implicit fallback.

## Release 4 — Audit elevated actions and narrow tenant privileges

Record initiating human/job, executing app, operation, target, authorization decision, correlation ID and outcome without document bodies or secrets. Persist a durable audit intent before an elevated action; if that fails, stop. Record the result afterward and reconcile uncertainty without blind mutation retries. There is no transaction spanning Postgres, Dataverse and other stores; the design must handle a successful write followed by failed audit completion.

IT exports actual Dataverse roles/privileges and Graph application permissions. Compare them with the operation inventory, narrow in stages, and separate identities only where materially different duties justify it. The user's approved business model is not evidence that existing tenant grants are least privilege.

**Verification:** reconstruct successful, rejected, failed and interrupted elevated operations; inject audit failures before/after mutation; rehearse reduced privileges with representative workflows.

**Release gate:** elevated activity is attributable and IT has reviewed actual assigned permissions.

## Delivery, evidence and rollback

Implement as separate reviewed changes on a runtime feature branch under the repository release policy. Configuration enforcement is first; permission inventory can proceed alongside it. Use isolated test environments; do not invoke production health/model/email/upload probes as harmless checks. Run the applicable route, DAL, interlock, type, migration/Atlas and documentation gates when their surfaces change. Solve Workflow test generation in an isolated writable checkout during implementation.

Acceptance packet: focused negative/positive test results; exact deployed revision and policy readback; scan-path and authority inventories; example audit receipts; tenant-permission review; alert/exception owners; updated operating instructions. A green build alone is insufficient.

Rollback can pause a feature or restore a previously verified secure revision. It must not restore silent scan bypass or general permission fallback. Any exceptional operating mode requires separately approved scope, owner, expiry and audit trail; do not implement a broad bypass merely to provide an emergency switch.

## Next session

1. Reverify HEAD and the relevant source defaults; this review is a dated baseline.
2. Begin Release 1 implementation design and scan/authority inventories using the approved direction. No repeat business-policy decision is needed.
3. Obtain named operational owners and IT tenant evidence before release.
4. Keep vendor confirmation work separate from code implementation and preserve confidential-transcription restrictions.

No production capability shipped in this session; no DEVELOPMENT_LOG milestone entry is required.
