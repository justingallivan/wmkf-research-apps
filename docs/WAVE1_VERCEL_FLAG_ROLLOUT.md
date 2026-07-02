---
title: "Wave 1 — Vercel Flag Rollout (HISTORICAL — closed 2026-05-12)"
domain: security-auth
kind: plan
status: active
summary: "Status: ✅ CLOSED 2026-05-12. This runbook is preserved as the historical record of how the flags were flipped and the trailing-newline gotcha that..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/db/migrations/007_drop_wave1_tables.sql
  - lib/services/
  - lib/utils/auth.js
  - docs/archive/
---

# Wave 1 — Vercel Flag Rollout (HISTORICAL — closed 2026-05-12)

**Status:** ✅ **CLOSED 2026-05-12.** This runbook is preserved as the historical record of how the flags were flipped and the trailing-newline gotcha that was caught + corrected. Do not follow it as a live procedure.

- 2026-05-03 — three `WAVE1_BACKEND_*` env vars set to `dataverse` in Vercel prod after correcting a trailing-newline regression (see `Lessons learned` below).
- 2026-05-12 — Postgres tables dropped via `lib/db/migrations/007_drop_wave1_tables.sql`; dispatcher defaults flipped to Dataverse in `lib/services/{settings,app-access,database}-service.js`.
- **Postgres → Dataverse fallback no longer exists.** Setting `WAVE1_BACKEND_*=postgres` now routes to a dropped table and fails loudly. The flags persist only as an explicit-opt-out signal.

The rollout steps below describe the *original* per-flag flip sequence, retained for reference. The runbook is not actionable today.

---

## Rollout order (least → most blast radius)

Flip one per day, watch for regressions between each. Rollback at any step is unset-the-flag — takes effect on next invocation.

### Step 1 — `WAVE1_BACKEND_SETTINGS=dataverse`

Reads: `baseConfig.js` model-override preload (hot, cached 5min), admin/models, admin/secrets, cron/secret-check, maintenance service retention config.

Writes: admin/models PUT (model override change), admin/secrets PUT (rotation date change).

Blast radius: lowest. Settings are read often but written rarely. Model-override misread = one API call uses wrong model. Rollback is instant.

**What to watch after flip:**
- Any new 5xx on `/api/admin/models` GET or PUT.
- API usage log spot check — model overrides still being picked up (e.g., `expense-reporter` using `claude-haiku-3-5`, not the default).
- Cron logs for `/api/cron/secret-check` at next 08:00 UTC firing.

### Step 2 — `WAVE1_BACKEND_PREFS=dataverse`

Reads: per-user preference lookups (API keys, reviewer-finder settings) — happens on almost every user-scoped API call.

Writes: profile settings page, reviewer-finder cycle config save, etc.

Blast radius: medium. Per-user scope so a bug affects one person until caught. Encryption roundtrip is the main risk surface, but it's identical code both sides (same `lib/utils/encryption`).

**What to watch after flip:**
- `/api/user-preferences` GET/POST errors.
- Any user report that an API key "stopped working" — would indicate decryption mismatch.
- Spot-check a known user: sign in as dev, open profile settings, confirm API keys are masked but present.

### Step 3 — `WAVE1_BACKEND_APP_ACCESS=dataverse`

Reads: `requireAppAccess()` in `lib/utils/auth.js` — called on **every authenticated API request** as the auth gate. 2-min in-process cache softens it.

Writes: admin app-access grants/revokes, first-login default grants from NextAuth.

Blast radius: highest. A bug here locks users out of apps. But the data already verified identical, and the hot path is cached, so the failure mode would be a specific edge case (e.g., Dataverse rate limiting on a cold cache).

**What to watch after flip:**
- 403 "user does not have access to X" errors in logs (beyond the usual baseline).
- Admin dashboard `/admin` → Apps tab — all users show correct app counts.
- Confirm superuser (Justin) still bypasses all gates.

---

## How to flip a flag

Either:

**Vercel dashboard:**
1. Project settings → Environment variables
2. Add `WAVE1_BACKEND_SETTINGS` (or PREFS or APP_ACCESS) = `dataverse`
3. Apply to **Production** (leave Preview/Development as-is until they're needed)
4. Redeploy the latest prod deployment (Vercel → Deployments → ... menu → Redeploy) so the new env reaches running functions

**CLI:**
```bash
# Use printf, NOT echo — echo appends a newline that gets captured.
printf 'dataverse' | vercel env add WAVE1_BACKEND_SETTINGS production
vercel --prod  # redeploy to pick up the new env
```

> ⚠️ **Trailing-newline gotcha (2026-05-03 lesson).** The first prod attempt set all three flags to `"dataverse\n"` (likely via `echo "dataverse" | vercel env add ...` or interactive Enter). All three dispatch sites do strict `=== 'dataverse'` equality, so the comparison silently failed and prod ran on Postgres for 6 days while looking like it had been rolled over. **Always use `printf 'dataverse'` (no newline) when piping, or type the value with no trailing whitespace at the interactive prompt.** Verify after with `vercel env pull` + `grep '^WAVE1_BACKEND'` — values must read `"dataverse"` with no `\n`. If you see a stored value of `"dataverse\n"`, the flag is functionally unset.

---

## Rollback

Remove the env var (or set to `postgres`) and redeploy. Takes effect on the next invocation — no data migration needed (Postgres remains the source of truth until we drop the tables).

Dataverse rows written during the short flag-on window stay in Dataverse; Postgres rows from the same period are whatever the previous Postgres read saw. Minor divergence possible during the window but re-syncing Postgres→Dataverse is cheap (`node scripts/sync-wave1-postgres-to-dataverse.js --target=prod --execute` — already idempotent).

---

## After all three flags stable

1. Decide on cutover: stop writing to Postgres, drop the 3 tables.
2. Remove the feature-flag dispatch code (the wrappers become Dataverse-only).
3. Remove the three Postgres tables from the migration plan as "done".
4. Proceed to Wave 2.

## Retirement criterion

This rollout doc is **retired** — and the `WAVE1_BACKEND_*` flag dispatch removed from the codebase — when **all three** of these are true:

1. All three flags have been set to `dataverse` in production.
2. They've stayed in that state for **at least 14 days** with no regressions reported (no rollbacks, no user reports of misbehaving settings/prefs/app-access, no anomalous Dataverse-side errors in cron/log-analysis output).
3. The three Postgres tables (`system_settings`, `user_preferences`, `user_app_access`) have either been dropped OR scheduled for drop within the next 30 days.

When all three hold: delete the dispatch wrappers in `lib/services/{settings,user-preferences,app-access}-service.js`, remove the three env vars from Vercel, archive this doc to `docs/archive/`, and close out the Wave 1 entries in `MEMORY.md` and `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md`.

Until those conditions hold, leave this doc in `docs/` as the active rollback playbook.

---

## Recommended pacing

One flag per day, watch 24h before the next. Full rollout takes ~3 days of calendar time but <1 hour of active work.

Fastest-safe: flip all three in one deployment if there's a reason for urgency (e.g., Postgres bill, data residency). Still works — the verification proved they're identical. Just reduces our ability to isolate a regression to one table.
