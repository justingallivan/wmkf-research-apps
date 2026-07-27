# Wave 1 Prod Cutover — Second (smaller) privilege ask

**For:** production administrator
**Date:** 2026-04-24
**Time needed:** ~1–3 min, either path

---

## Where we are

After you assigned System Customizer, I reran the schema apply and it completed cleanly in prod:

- Publisher reused: `WMKF_Publisher` ✓
- Solution `wmkfResearchReviewAppSuite` ✓
- Columns on `systemuser` (`wmkf_app_AvatarColor`, `wmkf_app_NeedsLinking`) ✓
- Table `wmkf_AppSystemSetting` + column + relationship + alt-key ✓
- Table `wmkf_AppUserAppAccess` + 2 relationships + composite alt-key ✓
- Table `wmkf_AppUserPreference` + 2 columns ✓

Then I ran the role script. It also mostly succeeded:

- Role `WMKF Research Review App Suite - Staff` created ✓
- 18 privileges applied via `AddPrivilegesRole` ✓
- Role added to `wmkfResearchReviewAppSuite` solution ✓

**Blocked on:** assigning that role to the 7 staff users + the app user. Exact error:

```
403 Principal user ... is missing prvAssignRole privilege
for entity 'role' (LocalizedName='Security Role')
```

`prvAssignRole` is (by design) not part of System Customizer — that role grants customization power but not security-administration power. Assigning roles to users is the latter.

---

## Two paths to unblock. Your call.

Both are ~2 minutes of work. Presenting explicit steps for each.

---

### Option X — Grant `prvAssignRole` to `WMKF AI Elevated TEMP`

**When this makes sense:** you'd like the whole cutover scripted end-to-end, and future role assignments (onboarding new staff, etc.) to work via code too.

#### Steps (maker portal)

1. Open **https://make.powerapps.com** → **Production** environment.
2. Left nav → **… More → Security roles**.
3. Open **WMKF AI Elevated TEMP** for editing.
4. Find the **Security Role** row (it's on the **Core Records** tab, near the bottom — or use the search/filter to find "Security Role").
5. In that row, find the **Assign** column (the 7th circle, between Delete and Share).
6. Click it until it's a **green filled circle** (Organization level).
7. **Save and Close.**

The role is already on the app user — no re-assignment needed.

#### What happens next

I rerun `node scripts/apply-security-role.js --target=prod --execute --assign=<7 emails>`. The script is idempotent — the role itself shows `· exists`, privileges get re-upserted (harmless), solution-membership shows no-op, and the 7 user assignments go through.

Then I separately assign the app user to that same role.

Total my-time: ~1 minute.

---

### Option Y — You assign the 8 users yourself in the maker portal

**When this makes sense:** you'd rather not grant `prvAssignRole` to a service principal (some organizations treat it as sensitive), and you're already in the portal.

Role to assign: **`WMKF Research Review App Suite - Staff`**

Users to assign it to:

- the 7 current staff accounts supplied through an access-controlled roster;
  and
- the `# WMK: Research Review App Suite` application user.

The staff roster, email addresses, and application identifier are intentionally
not retained in this public historical document.

The 8th is important — without the app user being assigned the role, the data-sync step can't create preference rows on behalf of each user, because the preference table is User-owned and the caller needs `prvReadwmkf_AppUserPreference` at Basic depth to even create a row whose owner is set.

#### Steps (maker portal)

For each staff user (#1–7):

1. Open **https://make.powerapps.com** → **Production** environment.
2. Left nav → **… More → Users + permissions → Users**.
3. Find the user by email. Click their row to open.
4. Top nav → **Manage Roles**.
5. Check **WMKF Research Review App Suite - Staff**.
6. **Save**.

For the app user (#8):

1. Same environment, but left nav → **… More → Users + permissions → Application users**.
2. Find **`# WMK: Research Review App Suite`** by its current registered application identity.
3. Top nav → **Manage Roles**.
4. Check **WMKF Research Review App Suite - Staff**. (Leave the other roles checked.)
5. **Save**.

Total your-time: ~2–3 minutes.

---

## My recommendation: Option X

Three reasons, in order of weight:

1. **Future maintainability.** When a new staff member joins, role assignment is one command from this repo instead of a back-and-forth. Same story for any future custom role we create.
2. **Blast radius is genuinely small.** `prvAssignRole` lets the app user assign roles — it does not let it create new roles or modify role privileges (those are separate privileges System Customizer already granted, and which we've already used intentionally). Anything the app user assigns is a role that already exists and that someone (you, via System Customizer or similar) already defined.
3. **Audit trail.** Script runs leave a commit + log; UI clicks don't.

That said, if you have a standing policy against `prvAssignRole` on service principals, Option Y is fine — it costs 2–3 minutes today and nothing after. The cutover doesn't require ongoing automation.

---

## After either path

Assuming you've unblocked user-assignment:

1. I rerun the role script (Option X only) or skip straight to step 3 (Option Y).
2. I run the data sync: `node scripts/sync-wave1-postgres-to-dataverse.js --target=prod --execute`. Migrates 149 rows across the 3 tables.
3. I run read-path verification to confirm prod Dataverse matches prod Postgres byte-for-byte.

Total remaining: ~2 min after whichever option you pick.

---

## After the cutover: revoking System Customizer

Once all three scripts complete and verification passes, System Customizer can be removed from the app user. The `WMKF AI Elevated TEMP` role can stay as-is (or can be trimmed separately); it's needed for any future schema changes but not for day-to-day app operation.
