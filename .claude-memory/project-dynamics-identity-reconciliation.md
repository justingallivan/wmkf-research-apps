---
name: Dynamics Identity Reconciliation
description: SHIPPED + UNBLOCKED — user_profiles ↔ systemuser bridge + MSCRMCallerID write attribution end-to-end (S127–S129). Connor granted Delegate role to app user 2026-05-06; impersonation re-smoke PASS for Justin and cnoda. Remaining: full /phase-i-dynamics overwrite=true run + flip prod env flag DYNAMICS_IMPERSONATION_ENABLED=true.
type: project
originSessionId: 62437821-a516-465d-9fe9-ccd2fa785705
status: active
scope: dynamics
last_verified: 2026-06-04 via code+probe (reconcile-identities cron present + has run in maintenance_runs)
---

## Recall Rule

Read this when: wiring a new session-bound Dynamics write, touching a Dataverse write adapter, or rolling out `MSCRMCallerID` impersonation in any environment.

Do:
- Pass `actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null` on session-bound writes; leave null for cron / token-auth / PA paths.
- Thread `actingUserSystemId` only through the adapter function you're touching — don't add it speculatively everywhere.
- Before enabling impersonation in a new Dataverse env, verify the **Delegate** role is on the app user first (`prvActOnBehalfOfAnotherUser` lives only there).

Do not:
- Send the caller-id header on reads (reads always stay clean).
- Assume the privilege gap is staff-side per-table writes — the S132 403 was the app user lacking Delegate.

Ground truth: `lib/services/dynamics-service.js`, `lib/services/dynamics-identity-service.js`, `lib/dataverse/adapters/*.js`, `lib/external/token-lifecycle.js`, `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` § Step 5.

**Status (2026-05-04, post Session 129):** Code complete. Only outstanding item is flipping `DYNAMICS_IMPERSONATION_ENABLED=true` in preview → prod.

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

**Rollout (UNBLOCKED 2026-05-06):** Connor granted the **Delegate** security role to `# WMK: Research Review App Suite` app user; impersonation re-smoke PASS for Justin and cnoda. **Remaining work:** full `/phase-i-dynamics` overwrite=true run + flip prod env flag `DYNAMICS_IMPERSONATION_ENABLED=true`.

**Historical context — useful for future Dataverse environments:** The S132 preview rollout 403'd because the platform-level `prvActOnBehalfOfAnotherUser` privilege lives ONLY in the **Delegate** role and isn't part of System Customizer or the typical app-user role mix. The original rollout doc's "privilege-intersection" framing assumed staff roles missing per-table writes; the real gap was on the app user itself. Future rollouts of impersonation in other Dataverse environments must verify Delegate is on the app user *first*.

Procedure documented in `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` § Step 5.

**Shipped Session 129 (adapter chain + token lifecycle):**
- `lib/dataverse/adapters/{contact,potential-reviewer,researcher,reviewer-suggestion}.js` — every write helper takes `{ actingUserSystemId } = {}` as trailing opts, forwards to `DynamicsService.updateRecord`/`createRecord`. Reads stay clean.
- `lib/external/token-lifecycle.js` — `mintAndStore`, `revoke`, `ensureToken`, `extendForPostSubmissionWindow` all accept and forward.
- 8 endpoints plumbed: `reviewer-finder/{save-candidates,my-candidates}`, `review-manager/{render-emails,send-emails,regenerate-token,revoke-token,reviewers,upload-review}`. Audit-trail mismatch closed: contact promotion + token writes now attribute to the same staff user as the surrounding action.
- 20 pass-through tests in `tests/unit/adapters-caller-id.test.js`. Suite 333/333.

**How to apply going forward:**
- New session-bound writes: `actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null` and pass to the write helper. Unattended (cron / token-auth / PA) leaves it null.
- When touching an adapter, thread `actingUserSystemId` through its public function — don't add it speculatively to all of them at once.
