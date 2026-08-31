---
title: Dynamics Identity Reconciliation Plan
domain: dataverse
kind: plan
status: active
summary: "Owner: Justin (app side), Connor (Dynamics side — Delegate role granted) Last updated: 2026-05-12 (status banner refresh; original plan dated..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/probe-impersonation-resmoke.js
  - scripts/probe-impersonation-as-user.js
  - docs/REQUEST_WORKBENCH_BUILD_PLAN.md
  - scripts/setup-database.js
---

# Dynamics Identity Reconciliation Plan

**Status:** **SHIPPED S127–S129; PROD FLAG LIVE (verified S271 and re-verified 2026-08-27/S466); WAVE 24 EXPLICIT ACTORS PRODUCTION-LIVE 2026-08-31.** DB bridge live, `MSCRMCallerID` impersonation contract implemented with privilege intersection, adapter chain in place, token lifecycle wired. Preview flag flipped + smoked 2026-05-05. Connor granted Delegate role to app user 2026-05-06; impersonation re-smoke PASS for Justin and cnoda (`scripts/probe-impersonation-resmoke.js`, `scripts/probe-impersonation-as-user.js`). The prod flip was deferred in S207, then landed by the S271 era — `DYNAMICS_IMPERSONATION_ENABLED=true` in Production `[VERIFIED S271 via env pull, per docs/GRANTEE_DELIVERABLE_PACKAGE_MIGRATION_PLAN.md; re-verified 2026-08-27 by owner env pull]`. **Live behavior [DERIVED-FROM: owner-run `scripts/probe-write-attribution-census.js` output, 2026-08-27/S466, 90-day window; independent of TBD count]:** impersonation works where the staff role has privileges — `wmkf_ai_run` rows split 22 staff-attributed / 36 service-principal (unattended writes) — but **every `wmkf_requestdocument` row (13/13) fell back to service-principal attribution** despite the acting user being sent on those write paths (`pages/api/workbench/pre-site-visit.js:96`, the reopen route, adapter passthrough — all read S466). The consistent fallback matches the privilege-intersection signature (impersonated write 403s; `_writeFetch` retries as the app). **Owner decision 2026-08-31:** retain service-principal Request Document writes and add explicit, server-controlled actor tracking (Option B). The Wave 24 Production apply/readback reported 3 exact / 0 absent / 0 divergent; the Production-only readiness flag is exact `on`, and commit `8ff4205a0ad43337cd987a4fc76639f936bab4bc` first reached Ready deployment `dpl_D94J9aRcfLfK81iBDsVYARVhZFPb`. Signed-in health passed and the deployment-boundary census reported 0 violations; the first natural business-flow write/readback remains pending. The implementation and promotion plan is `docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md`. The 2026-08-27 Connor staff-role brief was never sent and is withdrawn; no Request Document privilege change is requested. A confirmation-only question scheduled for 2026-09-07 asks whether any compliance, audit, or CRM consumer specifically requires built-in `createdby`/`modifiedby` staff attribution. This doc remains as the architectural reference; treat the implementation sections below as historical.
**Owner:** Justin (app side), Connor (Dynamics side — Delegate role granted)
**Last updated:** 2026-05-12 (status banner refresh; original plan dated 2026-04-13)

## Problem

The Vercel apps and Dynamics run two parallel identity systems that never meet:

| System | User identifier |
|--------|----------------|
| Vercel apps | `user_profiles.id`, Azure AD `oid`, `azure_email` |
| Dynamics | `systemuser.systemuserid` (GUID), `internalemailaddress` |

Until they are joined, the apps cannot:
- Write records to Dynamics as the acting staff member (writes show as the service principal).
- Cross-reference app usage with Dynamics activity for reporting.
- Dynamically resolve staff (e.g. PD lookup) without hardcoded GUIDs in prompts or PowerAutomate flows.

All 16 licensed staff use `@wmkeck.org` emails that match `internalemailaddress` on `systemuser`, so the mapping is deterministic — we just need to store it.

## What it unlocks

1. **Writes attributed to the right person.** Sending the `MSCRMCallerID` header with the impersonated systemuserid causes Dynamics to record the acting staff member on `modifiedby`, `createdby`, and audit history.
2. **Unified reporting.** Admin dashboard usage stats, expertise matches, panel reviews, etc. can join cleanly with Dynamics records.
3. **Dynamic PD lookup.** If PD expertise is stored on `systemuser` records (see "Dependency on Connor" below), the PowerAutomate flow can query active PDs with their expertise descriptions at runtime instead of hardcoding GUIDs. Eliminates silent drift when staff join or leave.

## Implementation

### 1. Schema change — migration V26

Add to `scripts/setup-database.js`:

```sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS dynamics_systemuser_id UUID,
  ADD COLUMN IF NOT EXISTS dynamics_reconciled_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_user_profiles_dynamics_systemuser_id
  ON user_profiles(dynamics_systemuser_id);
```

Nullable — profiles for external/test users without a Dynamics account stay null.

### 2. Resolver script — `scripts/reconcile-dynamics-identities.js`

For each `user_profiles` row with non-null `azure_email`:

```
GET {DYNAMICS_URL}/api/data/v9.2/systemusers
  ?$filter=internalemailaddress eq '{azure_email}'
  &$select=systemuserid,fullname,isdisabled
```

- Match found → write `dynamics_systemuser_id` + `dynamics_reconciled_at = NOW()`.
- No match → log, leave null, continue.
- Disabled user (`isdisabled = true`) → log, leave null (they lost their Dynamics license).

Run once manually to backfill existing profiles. Requires only read access, which the current app registration already has.

### 3. Resolve on user creation

In the NextAuth sign-in callback (or wherever the first-login profile insert happens), call the resolver once for the new user and set `dynamics_systemuser_id` before the welcome modal. Adds ~200ms to first login; silent if lookup fails.

### 4. Weekly maintenance cron

New entry in `pages/api/cron/reconcile-identities.js`:
- Re-run the resolver for profiles where `dynamics_reconciled_at` is older than 30 days OR `dynamics_systemuser_id IS NULL AND azure_email IS NOT NULL`.
- Catches staff who get their Dynamics account after their first app login.
- Authenticated via existing `CRON_SECRET` / `requireCron`.
- Schedule: weekly, `0 7 * * 1` (Mondays 7am UTC).

Add a "Reconcile now" button in the admin app that calls the same endpoint on demand.

### 5. Impersonation on writes — SHIPPED 2026-05-04 (Session 128)

Direct API → DynamicsService writes plumb `actingUserSystemId` from `session.user.dynamicsSystemuserId`:
- `lib/services/dynamics-service.js` — write helpers accept the option, conditionally adds `MSCRMCallerID`. Reads never carry it.
- NextAuth: JWT/session loads `dynamics_systemuser_id` so `session.user.dynamicsSystemuserId` is available everywhere.
- API endpoints wired: `phase-i-dynamics/summarize`, `phase-i-dynamics/summarize-v2`, `grant-reporting/extract`, `review-manager/send-emails`, `review-manager/mark-received-no-file`, `review-manager/upload-review`, `test-email`. Executor (`lib/services/execute-prompt.js`) accepts the kwarg. [RECHECKED after lib/services/execute-prompt.js change: S466 added an unrelated optional timeoutMsOverride; the impersonation kwarg contract here is unchanged]
- Intentionally null (unattended): `pages/api/cron/spend-check.js`, `pages/api/external/review/[token]/*`, `lib/external/token-lifecycle.js`, all PowerAutomate triggers.

**Privilege-intersection safety (added Session 128 after Codex review):**

Microsoft's docs ([impersonate-another-user-web-api](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/impersonate-another-user-web-api)) confirm Dataverse evaluates impersonated requests under the *intersection* of the app-user privileges and the impersonated-user privileges. A staff role missing a single table-level write (e.g. Update on `wmkf_ai_run`, prvSendAsUser on email) would 403 even though the app registration has the privilege. To make rollout safe:

1. **Feature flag `DYNAMICS_IMPERSONATION_ENABLED`** (default off). `_withCallerId` is a no-op until set to `"true"`. Flip per environment after a privilege audit.
2. **403 fallback.** `_writeFetch` retries once without `MSCRMCallerID` on 403, logs a structured warning so the missing privilege is actionable telemetry rather than a hard failure. The user request still succeeds; that one write falls back to service-principal attribution.

**Rollout procedure:**
1. Verify staff Dynamics roles include write on the touched tables: `akoya_request`, `wmkf_ai_run`, `email`/`activitymimeattachment` send privileges, `wmkf_appreviewersuggestion`. Two of the licensed staff users are sufficient for the smoke test (one with the broadest role, one minimal). Use `/api/test-email` to check the email path; use `/phase-i-dynamics` to check the writeback + audit-log path.
2. Set `DYNAMICS_IMPERSONATION_ENABLED=true` in Vercel preview first, exercise the smoke flows, watch logs for `[DynamicsService] Impersonated write rejected` warnings.
3. If warnings appear, decide per-table: add the missing privilege to the role, or accept service-principal attribution for that table (no code change needed; fallback already handles it).
4. Promote to production.

- **Deferred — adapter chain.** `lib/dataverse/adapters/{contact,potential-reviewer,researcher,reviewer-suggestion}.js` still write as the service principal. Wiring those would touch ~12 call sites (reviewer-finder save-candidates, send-emails contact promotion, etc.) and is a clean follow-up. Behavior today: the email activity itself is attributed to the staff sender, while the contact-promotion / lifecycle PATCHes that follow are still service-principal. Acceptable as an intermediate state; track in a future session.

Original plan text below:

```js
await dynamicsService.updateRequest(requestId, fields, {
  actingUserSystemId: session.user.dynamics_systemuser_id,
});
```

Internally adds the header:
```
MSCRMCallerID: {systemuserid}
```

PowerAutomate-triggered writes don't set this — they're unattended, so `modifiedby` correctly reads "System" / the app registration.

### 6. Admin dashboard visibility

Add one line to `/admin` user management: each row shows "Dynamics: ✓ linked" or "Dynamics: not linked (last checked: {date})". Helps spot reconciliation failures without tailing logs.

## Dependency on Connor

**For (1)–(4):** none. Read access is already granted.

**For Request Document attribution:** no permission grant is requested. The
former Connor brief was never sent and is superseded by the owner-selected
explicit-actor design. Connor's only scheduled question is whether a specific
compliance, audit, report, view, flow, business rule, or plug-in requires the
built-in Request Document actor columns; absent such a requirement, no Connor
action is needed.

**For (3) to fully replace hardcoded PD prompts:** ~~Connor would need to add a custom field to `systemuser` for PD expertise description.~~ **Done 2026-05-07** — Connor added `wmkf_expertise` (Memo) on `systemuser`. Out of scope for this plan; the swap-out of hardcoded PD lists is a separate downstream task.

## Out of scope

- **Two-way sync.** We're one-directional: Azure AD / app profile → find the Dynamics systemuser. If a staff person's email changes on one side, we re-run the resolver; we don't try to keep Dynamics in sync with our DB or vice versa.
- **Non-staff profiles.** Reviewers, external collaborators, etc. don't live in Dynamics as systemusers. Nothing to reconcile.
- **Historical backfill of existing records.** Things already written by the service principal stay as-is; this only affects writes going forward.

## Original effort estimate (historical)

~½ day of focused work once Justin picks it up:
- Migration + index: 15 min
- Resolver script: 1 h (mostly error handling for the three cases above)
- NextAuth hook: 30 min
- Cron endpoint: 30 min
- Admin dashboard line: 30 min
- Tests + manual verification against real profile: 1 h
- Impersonation helper (Step 5): shipped; the later Request Document privilege
  grant direction was withdrawn on 2026-08-31

## References

- `user_profiles` schema — `scripts/setup-database.js` V10 (line ~249)
- Memory: **Dynamics CRM Users** — 16 licensed staff, all `@wmkeck.org`
- [`lib/services/dynamics-service.js`](../lib/services/dynamics-service.js) — where the impersonation header will plug in
- [BACKEND_AUTOMATION_PLAN.md](./BACKEND_AUTOMATION_PLAN.md) — context for why attribution matters
- [DYNAMICS_AI_FIELDS_SPEC.md](./DYNAMICS_AI_FIELDS_SPEC.md) — point 7 (PD prompt drift) motivated this
