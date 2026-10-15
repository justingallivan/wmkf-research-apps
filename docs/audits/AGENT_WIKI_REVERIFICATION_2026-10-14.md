# Session 608 — Intake and Security Wiki Reverification

Date: 2026-10-14 (Pacific). Source baseline: `9279d0f88`.

## Scope

Sweep Mode B: bounded domain audit of `docs/agent-wiki/topics/intake-portal.md`
and `docs/agent-wiki/topics/security-auth.md`, whose 60-day verification windows
expired. Contract-reconcile Mode A: verify documentation against current source.
Entry points are the wiki pages; persistence is Git Markdown; consumers are agent
retrieval, reminder hooks and `check:agent-wiki`. No runtime behavior changed.

Authoritative evidence: current source, existing mocked tests and recorded owner
parked-product decisions. Production configuration, external schema, Entra
registration and paid scanner integration are excluded from this source audit;
the pages explicitly retain those limits. No new external-state claim is made.

## Contract evidence

| Claim | Producer → persistence → consumer | Evidence | Result |
|---|---|---|---|
| Intake identity and account scope | Applicant session → contact bridge/membership → draft and submit routes | `pages/api/intake/draft.js`, `pages/api/intake/submit.js`, `lib/services/membership-service.js` | VERIFIED: identity comes from session; chosen account is membership-checked |
| Intake upload isolation | Upload-token route → private Blob and pending draft entry → attach route | `pages/api/intake/draft/upload-token.js`, `pages/api/intake/draft/attach.js`, `lib/utils/intake-blob.js` | VERIFIED: explicit intake token, private read; local tests cover reject/cleanup behavior |
| Submission handoff | Submit → frozen `submission_jobs.payload` → drain | Submit transaction and `lib/services/cron/drain-submissions-service.js` | VERIFIED: pending/count guards and transactional draft freeze; arbitrary `dataverseFields` spread in `handleScanning` remains an unresolved revival hazard |
| Budget/roster reconciliation | Frozen children → budget-line creation → drain progression | `handleFilesMoved` creates budget lines and parks nonempty persons payloads | PARTIAL implementation; deactivate/recompute remains a design requirement, not an end-to-end completion claim |
| Staff revocation | Sign-in/JWT → `user_profiles.is_active` → shared guards and client session | `pages/api/auth/[...nextauth].js`, `lib/utils/auth.js`, `proxy.js` | VERIFIED: shared guards read status live; proxy uses claims/idle age, not a live DB check |
| Profile transfer and archive | Link/archive entry → row locks/transaction or affected-row check → response | `pages/api/auth/link-profile.js`, `DatabaseService.archiveUserProfile` | VERIFIED: rollback protects failed transfer; archive success requires affected row |
| Client auth render | Auth-status endpoint/session → shared lookup → `RequireAuth` | `shared/utils/auth-enabled.js`, `shared/components/RequireAuth.js` | VERIFIED: loading preserves children; failed status lookup is not cached |
| Cron/webhook boundaries | Bearer/raw signature → verified route → service/storage | `lib/utils/cron-auth.js`, `pages/api/cron/drain-submissions.js`, both webhook routes | VERIFIED: drain has strict verifier; webhook routes require raw-body signature outside development |
| Host routing | Tracked redirect and origin configuration → request guard/navigation | `next.config.js`, `validateOrigin` in `lib/utils/auth.js` | VERIFIED source contract; June deployment receipts remain HISTORICAL, current live values UNKNOWN |
| Parked-product scan prerequisite | Recorded owner decision → memory/wiki → future work selection | `project-intake-portal-parked` memory, J27-055/Q19 | VERIFIED decision: future pilot prerequisite, not next-cycle work |

Partial-success, async state and helper-extraction audits apply only to the
existing behaviors summarized above; no new runtime implementation was reviewed
or modified. New schema, migrations, enum fan-out and API counts are N/A.

## Restatement reconciliation

Searched docs, memory, wiki and session guidance for `before the next cycle`,
virus-scan deferral, obsolete-child deactivation and proxy revocation wording.

- STALE: wiki next-cycle scan deadline and the active scan memory's next-cycle
  parenthesis. Both now defer to an owner-approved pilot and explicit paid-scan
  authorization.
- STALE/ambiguous: wiki deactivation sentence read as implemented behavior.
  Recast as a design requirement and describe the current drain limitation.
- AGREE: parked-product memory and J27-055 already say GOApply carries J27;
  historical inventory excerpts in the transition register and September decision
  table explain why the old wording should be changed when touched. Retained.
- AGREE: closed `slice0-deactivate-not-delete-recalc` memory and July slice-triage
  report express the deactivate-not-delete invariant. This requirement remains;
  their historical deployment account is not a fresh implementation receipt.
- HISTORICAL: August revocation audit and June domain deployment receipts.
  Retained as dated evidence. Wiki now explicitly separates production receipts
  from Session 608 source verification.

Disconfirming checks: inspected `handleFilesMoved` for a completed roster path
(found an explicit park); inspected proxy authorization for a DB revocation read
(found only token/age checks); inspected origin handling for missing config and
cookie-free/headerless exemption (both branches present); tests exercise revoked
accounts, transaction failure, signature rejection and concurrent submit changes.

## Validation and limits

Existing regression run: **14 suites, 297 tests passed** covering NextAuth/bare
auth/link-profile/archive revocation, auth and cron helpers, auth render races,
intake draft/upload/attach/submit guards, and both webhook routes. These are mocked
local tests, not hosted end-to-end acceptance.

Passed after the edits: agent-wiki, doc-currency, fact-consistency,
doc-symbol-refs, build-claim-freshness and memory-router, each followed
sequentially by its self-test; docs-catalog and `git diff --check` also passed.
The startup API-route, route-service-boundary and trust-boundary-GUID gates and
self-tests passed against the same runtime source. No live scan, email, schema
mutation, applicant launch or production promotion was performed.

Verdict: RECONCILED for the bounded wiki claims. Remaining live STALE claims in
this scope: 0. Current production configuration and deployed intake scan E2E
remain UNKNOWN; full intake roster/recompute completion remains PARTIAL and parked.
