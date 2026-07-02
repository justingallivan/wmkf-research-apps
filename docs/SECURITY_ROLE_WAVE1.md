---
title: "Security Role Config — Wave 1 Tables"
domain: security-auth
kind: history
status: active
summary: "For: Connor Environment: WM Keck Sandbox (https://orgd9e66399.crm.dynamics.com) first, then prod when we cut over Status: Schema is live in..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/dataverse/client.js
  - scripts/apply-dataverse-schema.js
  - scripts/apply-security-role.js
  - docs/POSTGRES_TO_DATAVERSE_MIGRATION.md
---

# Security Role Config — Wave 1 Tables

**For:** Connor
**Environment:** WM Keck Sandbox (`https://orgd9e66399.crm.dynamics.com`) first, then prod when we cut over
**Status:** Schema is live in sandbox; roles are the last step before we can move real data

---

## The ask, in one paragraph

We just created three new custom tables in the sandbox (Wave 1 of the Postgres → Dataverse migration). Two of them (`wmkf_AppSystemSetting`, `wmkf_AppUserAppAccess`) should behave like the rest of akoyaGO's tables — all staff can read/write. The third (`wmkf_AppUserPreference`) **stores encrypted per-user secrets** (API keys, tokens, etc.) and must be readable only by the owning user, even though all staff have full access elsewhere. That single constraint is the reason we need a role config instead of using the default staff role as-is.

---

## The three tables

All three are part of the `wmkfResearchReviewAppSuite` solution, publisher `WMKF_Publisher`.

| Table | Ownership | Why |
|---|---|---|
| `wmkf_AppSystemSetting` | Organization-owned | Admin-editable key/value (model overrides etc.). Shared reference data. |
| `wmkf_AppUserAppAccess` | Organization-owned | Per-user app grants. Admins need to see everyone's grants. |
| `wmkf_AppUserPreference` | **User-owned** | Holds encrypted secrets. **Each user should see only their own rows.** |

`wmkf_AppUserPreference` is the only one that needs special handling. The other two get treated like existing akoyaGO tables.

---

## What needs to happen

1. Add privileges for these three tables to the existing staff security role (whatever role akoyaGO staff already use in the sandbox — probably a customization of a base role).
2. For `wmkf_AppSystemSetting` and `wmkf_AppUserAppAccess`: grant full privileges at **Organization** access level — matches akoyaGO's "staff see all business data" convention.
3. For `wmkf_AppUserPreference`: grant full privileges at **User** access level only. Not Organization. Not Business Unit. Just User.

The "User access level" here means: Dataverse filters query results server-side so that even though Alice's app makes a query that looks like `GET /wmkf_appuserpreferences`, the only rows she gets back are the ones where `ownerid = Alice`. It's not an app-layer check — it's enforced by the platform.

---

## Why User-level on that one table matters

The preferences table will hold things like encrypted Claude API keys, ORCID tokens, and similar per-user secrets. Everything is encrypted at rest (AES-256-GCM with a server-side key), but we'd still rather not hand ciphertext to every staff member who queries the table — it narrows the attack surface considerably, and keeps us honest about "this row belongs to one person."

This is the only table in our migration plan (across all 5 waves, ~16 new tables) that needs anything other than Org-level Read. Everything else fits akoyaGO's "all staff see all data" pattern.

---

## How to configure — maker portal

1. Open **https://make.powerapps.com**, switch to the sandbox environment (`orgd9e66399...`).
2. Left nav → **Tables** — confirm you can see the three tables above. If they're there, the schema is live.
3. Left nav → **… More → Security roles**. Find the role that Keck staff currently use. If it's a managed role (padlock icon), clone it into a customizable copy — we can't edit managed roles directly.
4. Open the role editor. Find the **Custom Entities** tab (or search for the tables by name — the UI has changed a few times).
5. Set privileges on each table. In the classic role editor, each privilege (Create/Read/Write/Delete/Append/AppendTo/Assign/Share) is a circle you click to cycle through access levels:

   | Table | Create | Read | Write | Delete | Append | AppendTo | Assign | Share |
   |---|---|---|---|---|---|---|---|---|
   | `wmkf_AppSystemSetting` | Org | Org | Org | Org | Org | Org | — | — |
   | `wmkf_AppUserAppAccess` | Org | Org | Org | Org | Org | Org | — | — |
   | **`wmkf_AppUserPreference`** | **User** | **User** | **User** | **User** | **User** | **User** | — | — |

   Notes:
   - **Append / AppendTo** control whether rows on this table can be referenced by / can reference other tables. User level is fine for the preference table since the references are to the user's own `systemuser`.
   - **Assign / Share** can stay at None — we don't need staff to reassign preference rows to other users, and sharing would defeat the privacy point.
   - If your UI shows an N:1 "reparent" column or something else I'm not listing here, default to matching your existing convention on comparable tables.

6. **Save**. Assign (or re-assign) the role to a test staff user — usually this is automatic if the role was already assigned, but worth confirming.

7. Add the role to the `wmkfResearchReviewAppSuite` solution so it travels with the schema when we export to prod: Solutions → wmkfResearchReviewAppSuite → Add existing → Security role → pick the role. That way the managed-solution export bundles it.

---

## How to test

A few minutes of verification. You can do this with any two staff accounts that have the role assigned — call them Alice and Bob.

### Test 1 — shared tables work for everyone (the easy check)

As Alice: create a row in `wmkf_AppSystemSetting` (any test key/value) via the Power Apps model-driven form, maker-portal data grid, or a quick Web API call.
As Bob: open the same table and confirm Alice's row is visible. Edit it; save should succeed.

Expected: both users see and edit each other's rows on this table. If not, the Org-level config didn't take.

### Test 2 — preference isolation (the point of this whole exercise)

As Alice: create a row in `wmkf_AppUserPreference` with any `wmkf_preferencekey` (e.g., `"test.preference.alice"`) and some value.
As Bob: do the same with a different key (e.g., `"test.preference.bob"`).

Now:
- As Alice, list all rows in `wmkf_AppUserPreference`. She should see **only her row** — Bob's row must not appear in the list.
- As Bob, list all rows. He should see **only his row**.

Try also:
- As Alice, attempt to read Bob's row by its GUID directly. Should return 403 / "no access."
- As Alice, attempt to edit or delete Bob's row. Should return 403.

Expected outcomes:
- Each user can CRUD their own rows freely.
- Neither can see, edit, or delete the other's rows.
- The `ownerid` column on each row reflects the creator's `systemuser` ID.

### Test 3 — app user (service principal) behavior

Our backend authenticates as the App Registration **"WMK: Research Review App Suite"**, which is registered as an application user. That app user will typically be the one writing preference rows on behalf of staff, *impersonating* them (via `MSCRMCallerID` header or similar). For now — before any impersonation work — the app user itself will need privileges on these tables. Easiest path: ensure the app user's role also has the same table privileges (either assign the same staff role to the app user, or mirror the config on the "App User role" akoyaGO may already have for service principals).

We can iterate on impersonation patterns once the basic role is in place.

---

## What happens after this

Once the role is configured and tested:

1. I'll run the Postgres → Dataverse data sync for Wave 1 tables (small row counts; seconds).
2. We dual-read for a week — our app reads from Dataverse, falls back to Postgres on miss, logs divergence.
3. We cut over: app reads/writes Dataverse only, Postgres tables go read-only, then get dropped.
4. Wave 2 (Reviewer Finder core — researchers, publications, reviewer_suggestions, grant_cycles) comes next. Same pattern, more tables, similar role config.

---

## Questions I'm likely to be wrong about

- **Business units** — Keck may have more than the default root BU. If there are multiple BUs and the staff role uses BU-level access on other tables, that's fine for our two Org-level tables (BU would be narrower, which is stricter, which is safer). For `wmkf_AppUserPreference`, **User-level is what we want regardless** of how BUs are structured.
- **Role inheritance / team privileges** — if akoyaGO staff get their privileges via a team rather than a direct role assignment, the table privileges go on the team's role. Same config, different place.
- **Existing staff role name** — I don't know what akoyaGO called it (probably something like "Grantmaker" or "Foundation Staff"). Pick whichever role staff already have; if it's managed and locked, the clone-and-edit pattern above is the fix.

Shoot me the slightest thing that doesn't match what you see in the sandbox and I'll adjust.

---

## Appendix — if you prefer Web API

All of the above can be scripted. I have a working Dataverse client in `lib/dataverse/client.js` and the `scripts/apply-dataverse-schema.js` script that uses it. I can add a `scripts/apply-security-role.js` that declares the role + privileges as JSON and applies them idempotently (same pattern as the schema apply). Let me know if scripting the role is preferable to point-and-click; either way, it ends up in the solution for the prod export.

---

## Reference docs

- `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md` — full 27-table migration plan, person model, ownership decisions
- `lib/dataverse/schema/wave1/wmkf_app_user_preference.json` — canonical schema definition for the user-preference table (carries the notes field explaining the User-level Read requirement)
- `scripts/apply-dataverse-schema.js` — the script that created these tables; re-runnable idempotently
- `scripts/smoke-test-wave1.js` — data-level smoke test (INSERT / alt-key / lookup / ownership); confirms the schema itself is sound before you configure roles on top of it
