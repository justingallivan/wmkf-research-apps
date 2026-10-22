---
name: Dynamics identity reconciliation and write attribution
description: Shipped identity bridge and conditional MSCRMCallerID contract; request-document actor attribution is a separate explicit contract
type: project
originSessionId: 62437821-a516-465d-9fe9-ccd2fa785705
status: active
scope: dynamics
last_verified: 2026-10-22
---

**Verification scope:** source was checked on 2026-10-22 and the documented S271/S466 receipts were read. No current environment probe was run; the receipts are dated evidence, not a fresh check.

## Recall Rule

Read this when: wiring a new session-bound Dynamics write, touching a Dataverse write adapter, or rolling out `MSCRMCallerID` impersonation in any environment.

Do:
- For session-bound Dynamics writes that use the shared impersonation contract, pass the authenticated `actingUserSystemId` through the touched service/adapter. `MSCRMCallerID` is conditional on `DYNAMICS_IMPERSONATION_ENABLED`; reads remain clean.
- Preserve intentional service-principal attribution for unattended cron, token-authenticated, and Power Automate paths where no human actor exists. Do not treat `null` as an unconditional rule: some worker writes carry an explicitly selected system user and use `noFallback`.
- Keep request-document ownership and actor attribution distinct. The owner decision is service-principal writes with explicit, server-controlled actor tracking; it is not a request to impersonate the human for the document write. Consult `docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md` and `lib/services/request-document-actor-service.js` before changing this contract.
- Before enabling impersonation in a new Dataverse environment, verify the **Delegate** role on the app user (`prvActOnBehalfOfAnotherUser` lives there); this does not replace checking the relevant staff role and the dated environment receipt.

Do not:
- Send the caller-id header on reads (reads always stay clean).
- Assume the privilege gap is staff-side per-table writes — the S132 403 was the app user lacking Delegate.

Ground truth: `lib/services/dynamics-service.js`, `lib/services/dynamics-identity-service.js`, `lib/dataverse/adapters/*.js`, `lib/external/token-lifecycle.js`, `lib/services/dynamics/write-core.js`, `lib/services/dynamics/email.js`, `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` § Step 5, and `docs/CREDENTIALS_RUNBOOK.md`.

## Historical rollout record

The following rollout notes preserve the state and decisions at the time. They do not by themselves establish current completion or current outstanding work.

**Status (2026-05-04, post Session 129):** Code complete. At that point the remaining item was flipping `DYNAMICS_IMPERSONATION_ENABLED=true` in preview → prod.

**Shipped Session 127:**
- V27 migration: `user_profiles.dynamics_systemuser_id` (UUID) + `dynamics_reconciled_at` (TIMESTAMP) + index. Applied to prod 2026-05-03.
- `lib/services/dynamics-identity-service.js`: `reconcileProfile` / `reconcileBatch`.
- `scripts/reconcile-dynamics-identities.js`: CLI; `--all`, `--stale N`, `--profile N`.
- NextAuth signIn callback fires `reconcileProfile` (silent) on first profile insert.
- Weekly cron `pages/api/cron/reconcile-identities.js` (Mondays 7:00 UTC). Manual admin trigger + `/admin` UI.
- 7 active prod profiles linked.

**Shipped Session 128 (Step 5 — MSCRMCallerID impersonation, with safety net):**
- All write helpers in `lib/services/dynamics-service.js` accept `actingUserSystemId`. When set AND env `DYNAMICS_IMPERSONATION_ENABLED=true`, sends `MSCRMCallerID: {guid}`. Reads never carry the header.
- **Privilege-intersection safety:** Dataverse evaluates impersonated writes under the intersection of app-user + staff privileges, so a staff role missing one Dynamics privilege would 403. Two safety mechanisms:
  - Env-var flag `DYNAMICS_IMPERSONATION_ENABLED` (default off) makes `_withCallerId` a no-op for ship-now-flip-later rollout.
  - `_writeFetch` retries once without the header on 403 and logs a warning, so a partially-privileged staff user falls back to service-principal attribution rather than failing the request.
- NextAuth jwt + session callbacks load `dynamics_systemuser_id` → `session.user.dynamicsSystemuserId`.
- Wired through user-driven API endpoints: `phase-i-dynamics/summarize`, `phase-i-dynamics/summarize-v2`, `grant-reporting/extract`, `review-manager/send-emails`, `review-manager/mark-received-no-file`, `review-manager/upload-review`, `test-email`. Executor (`lib/services/execute-prompt.js`) accepts the kwarg and threads to its two write sites.
- Intentionally null (unattended): cron, external-token endpoints, `lib/external/token-lifecycle.js`, all PA-triggered paths.
- Test coverage: `tests/unit/dynamics-service-caller-id.test.js` (13 cases) verifies direct + composed helpers, flag on/off, 403 fallback, and that reads stay clean.

**Rollout (UNBLOCKED 2026-05-06):** Connor granted the **Delegate** security role to `# WMK: Research Review App Suite` app user; impersonation re-smoke PASS for Justin and cnoda. The following “remaining work” line is retained as a historical S129-era checklist; the later release receipts establish the Production flag state only and do not establish completion of this separate smoke checklist: full `/phase-i-dynamics` overwrite=true run + flip prod env flag `DYNAMICS_IMPERSONATION_ENABLED=true`.

**Historical context — useful for future Dataverse environments:** The S132 preview rollout 403'd because the platform-level `prvActOnBehalfOfAnotherUser` privilege lives ONLY in the **Delegate** role and isn't part of System Customizer or the typical app-user role mix. The original rollout doc's "privilege-intersection" framing assumed staff roles missing per-table writes; the real gap was on the app user itself. Future rollouts of impersonation in other Dataverse environments must verify Delegate is on the app user *first*.

Procedure documented in `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` § Step 5.

**Shipped Session 129 (adapter chain + token lifecycle):**
- `lib/dataverse/adapters/{contact,potential-reviewer,researcher,reviewer-suggestion}.js` — every write helper takes `{ actingUserSystemId } = {}` as trailing opts, forwards to `DynamicsService.updateRecord`/`createRecord`. Reads stay clean.
- `lib/external/token-lifecycle.js` — `mintAndStore`, `revoke`, `ensureToken`, `extendForPostSubmissionWindow` all accept and forward.
- 8 endpoints plumbed: `reviewer-finder/{save-candidates,my-candidates}`, `review-manager/{render-emails,send-emails,regenerate-token,revoke-token,reviewers,upload-review}`. Historical note: contact promotion was then a staff-driven send write. Since S389 it occurs in the token-authenticated acceptance drain and is therefore service-principal-attributed; staff-driven token/lifecycle writes still carry the acting user.
- 20 pass-through tests in `tests/unit/adapters-caller-id.test.js`. Suite 333/333.

**Current production evidence:** `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md:19` records the Production flag as live from S271 and re-verified by owner env pull at S466 on 2026-08-27; `docs/CREDENTIALS_RUNBOOK.md:202` carries the same dated receipt. Treat this as documented historical verification, not a fresh environment check.

**Current attribution distinctions:**
- The reviewer thank-you sweep supplies the Program Director's system-user ID with `noFallback: true` (`lib/services/reviewer-thankyou-sweep.js:107-117`). The shared write core preserves a 403 rather than retrying as the service principal when that option is set (`lib/services/dynamics/write-core.js:101-115`); the email path enforces the same behavior (`lib/services/dynamics/email.js:333-363`). Thus, “worker path” does not imply null actor or service-principal fallback.
- Request Document writes use a separate owner-selected contract: service-principal Dynamics writes plus explicit server-controlled actor tracking (`lib/services/request-document-actor-service.js:18-39,97-113,164-169`; `lib/dataverse/adapters/request-document.js:282-307`). Preserve intentional no-human exceptions for scheduler and external work. Do not infer from this design that built-in Dynamics `createdby`/`modifiedby` is impersonated.
- For new session-bound writes, pass the authenticated actor only through the public helper being changed; do not thread it speculatively across unrelated adapters.
