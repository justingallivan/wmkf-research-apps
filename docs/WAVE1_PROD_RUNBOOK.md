---
title: "Wave 1 Production Cutover — Runbook for Connor (HISTORICAL — applied 2026-04-24)"
domain: security-auth
kind: runbook
status: active
summary: "Wave 1 of the Postgres → Dataverse migration has been applied end-to-end in sandbox (orgd9e66399) and verified at every layer:."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/db/migrations/007_drop_wave1_tables.sql
  - scripts/apply-dataverse-schema.js
  - scripts/smoke-test-wave1.js
  - scripts/apply-security-role.js
---

# Wave 1 Production Cutover — Runbook for Connor (HISTORICAL — applied 2026-04-24)

**Status:** ✅ Cutover applied 2026-04-24. Flag flip 2026-05-03. Postgres tables dropped 2026-05-12 via `lib/db/migrations/007_drop_wave1_tables.sql`. This runbook is the historical record of the cutover-day commands; verification queries against the dropped Postgres tables will fail. Do not run as a live procedure.

---

## Where we are

Wave 1 of the Postgres → Dataverse migration has been applied end-to-end in **sandbox** (`orgd9e66399`) and verified at every layer:

| Layer | Status | Proof |
|---|---|---|
| Schema (3 tables + systemuser extensions) | ✓ live | `scripts/apply-dataverse-schema.js` + `scripts/smoke-test-wave1.js` |
| Security role + privilege matrix | ✓ live | `scripts/apply-security-role.js` + role is in solution `wmkfResearchReviewAppSuite` |
| Role assigned to all 7 real staff users | ✓ | same script, `--assign=<emails>` |
| User-level isolation on encrypted preferences | ✓ | `scripts/test-role-isolation-wave1.js` — 11/11 symmetric asserts (Justin + Kevin, both non-admin) |
| Data migrated (Postgres → Dataverse) | ✓ | `scripts/sync-wave1-postgres-to-dataverse.js` — 149 rows, Tom→Beth remap, Test User dropped |
| Byte-level data fidelity Postgres ↔ Dataverse | ✓ | `scripts/verify-wave1-read-path.js` — 66/66 asserts across all users |
| Application-level prefs service works against Dataverse | ✓ | `scripts/test-dataverse-prefs-service.js` — 16/16 asserts (CRUD + encryption + masking + bulk + skip) |

Nothing in prod has been touched. The app is still running off Postgres.

---

## Why this needs you

Our Azure app user in prod (`WMK: Research Review App Suite`) has read-only access — `akoyaGO Read Only access` + `WMKF AI Tools` + `WMKF Custom Entities`. It can't create tables, roles, or solutions in prod.

In sandbox the same app user has System Administrator, which is why we've been able to do all of the above without involving you.

---

## The three commands

Run these from this repo on a machine where `DYNAMICS_URL` points at prod (`wmkf.crm.dynamics.com`) **and** the app user has temporary elevated privileges. Two ways to give it those:

- **Simplest:** assign `System Administrator` role to the `WMK: Research Review App Suite` application user in prod, run the three commands, revoke.
- **Simpler middle ground:** assign the built-in `System Customizer` role. It covers all the metadata + role-management privileges listed below without granting data access. Probably the right call if Sys Admin is off the table — single built-in role, no custom role to build and maintain.
- **Most surgical:** build a temporary custom role with just these privileges, assign it, run the commands, remove.

#### Surgical privilege list (if building a temporary custom role)

| Privilege | Where it's used | Why |
|---|---|---|
| `prvCreateSolution` | `POST /solutions` in schema script | Solution `wmkfResearchReviewAppSuite` doesn't exist in prod yet — must be created |
| `prvWriteSolution` | `POST /AddSolutionComponent` | Role-apply script adds the staff role into the solution |
| `prvCreateEntity` | Metadata API — new tables | The 3 Wave 1 tables |
| `prvCreateAttribute` | Metadata API | Columns on new tables + 2 extension columns on `systemuser` |
| `prvCreateRelationship` | Metadata API | N:1 lookups (e.g., `wmkf_UpdatedBy` → `systemuser`) |
| `prvCreateEntityKey` | Metadata API | Alternate keys for idempotent upserts |
| `prvCreateRole` | `POST /roles` | Staff role doesn't exist in prod yet |
| `prvWriteRole` | `AddPrivilegesRole` action | Setting the role's privilege matrix |

Publisher `WMKF_Publisher` already exists in prod (verified 2026-04-24), so `prvCreatePublisher` is NOT needed.

For the data-sync step (command 3 below), the app user additionally needs normal read/write privileges on the three Wave 1 tables. Easiest path there: assign the `WMKF Research Review App Suite - Staff` role to the app user *after* command 2 creates it. Or leave Sys-Admin/System-Customizer on until command 3 is done.

My recommendation: **System Customizer** unless there's a reason not to. It's one role, built-in, covers everything in the table above, doesn't grant broad data access.

Each command is **dry-run by default**. You have to add `--execute` for any write to happen. You can run any of them dry-run first to see the plan.

### 1. Apply schema (2 min)

```bash
node scripts/apply-dataverse-schema.js --target=prod                   # dry-run first
node scripts/apply-dataverse-schema.js --target=prod --execute
```

**Creates:**
- Publisher `WMKF_Publisher` (if not present — likely already is)
- Solution `wmkfResearchReviewAppSuite`
- Tables: `wmkf_AppSystemSetting`, `wmkf_AppUserAppAccess`, `wmkf_AppUserPreference`
- 2 new columns on `systemuser` (in the same solution wrapper)

**Idempotent.** Re-running produces all `· exists`.

**Expected output:** ~13 artifacts, all `✓ created` on first run.

**Rollback:** delete the `wmkfResearchReviewAppSuite` solution via maker portal (cascades all components).

---

### 2. Apply security role (1 min)

```bash
node scripts/apply-security-role.js --target=prod                      # dry-run
node scripts/apply-security-role.js --target=prod --execute
```

**Creates:**
- Role `WMKF Research Review App Suite - Staff` in the root BU
- 18 privileges (Global on shared tables, Basic/User-level on encrypted prefs table)
- Adds role to `wmkfResearchReviewAppSuite` solution

**Idempotent.** `AddPrivilegesRole` upserts safely.

**Rollback:** delete the role via maker portal, or remove privileges via Web API.

---

### 3. Migrate data (1 min)

```bash
node scripts/sync-wave1-postgres-to-dataverse.js --target=prod         # dry-run
node scripts/sync-wave1-postgres-to-dataverse.js --target=prod --execute
```

**Migrates:**
- 20 preference rows (skipping 5 Test User rows)
- 84 app-access rows
- 45 system settings

**Identity bridge:** matches on `azure_email` → `systemuser.internalemailaddress`. Tom Rieker's rows route to Beth Pruitt (he left; she took over). All 7 real users resolve cleanly (Justin, Kevin, Jean, Beth, you, Sarah, Allison).

**Idempotent.** Pre-queries each row by natural key; skips existing.

**Prerequisites:** this step needs all 7 users to have the staff role assigned for ownership on the preferences table. Run the role script first with `--assign=jgallivan@wmkeck.org,kmoses@wmkeck.org,jkim@wmkeck.org,bpruitt@wmkeck.org,cnoda@wmkeck.org,shibler@wmkeck.org,akeller@wmkeck.org` — same flag that worked in sandbox.

**Rollback:** Postgres is untouched. To roll back Dataverse, just delete the three tables (or the solution).

---

## Verification (30 sec)

```bash
node scripts/verify-wave1-read-path.js --target=prod
```

Reports 66/66 if prod Dataverse matches prod Postgres byte-for-byte. Safe to run any time — read-only.

---

## What happens next (not your problem yet)

After cutover:
1. We deploy a version of the app that reads/writes Dataverse behind a feature flag (`PREFS_BACKEND=dataverse`). Flag defaults to `postgres`.
2. We flip the flag for preferences first, watch for a few days.
3. Then app-access and settings.
4. After a week of stable reads, Postgres tables go read-only, then drop.

Nothing in that sequence needs your help unless something breaks.

---

## Two open questions for you

Low priority — whenever you have a minute:

1. **`wmkf_ai_prompt`** — our app user still has no `prvRead` on it. We have the dynamic prompt-resolver pattern designed but can't hit the table. See `docs/archive/CONNOR_PROMPT_TABLE_NOTES.md`.
2. **System/user prompt split** — whether you'd add a second Memo column (`wmkf_ai_systempromptbody`) or keep the combined body + marker-based split. No rush; we can ship the first prompts either way.

---

## If anything fails

Three scripts, each dry-run-able, each idempotent, each with a one-action rollback. The scripts log before they write and print exactly what failed if something does.

If something looks wrong, stop and grab Justin. Reverting is cheap.
