---
title: "Wave 1 — Revert Temp Elevations (future session)"
domain: security-auth
kind: history
status: active
summary: "Purpose: Remove the elevated privileges the app user needed for the prod cutover, leaving it with the minimal permanent surface."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/apply-security-role.js
  - docs/WAVE1_PROD_RUNBOOK.md
  - docs/archive/WAVE1_PROD_PRIVILEGE_REQUEST.md
  - docs/archive/WAVE1_PROD_PRIVILEGE_REQUEST_2.md
---

# Wave 1 — Revert Temp Elevations (future session)

**Purpose:** Remove the elevated privileges the app user needed for the prod cutover, leaving it with the minimal permanent surface.

**When to do this:** once Wave 1 is in a stable state and we're confident we won't need to re-run the schema/role scripts imminently. Specifically: after all three feature flags have been flipped and are stable (see `WAVE1_VERCEL_FLAG_ROLLOUT.md`), OR at any point before that if we're confident the scripts worked correctly and nothing else needs to be provisioned.

**Who does this:** Connor, in the prod maker portal.

---

## Current state (as of 2026-04-24, prod)

The app user `# WMK: Research Review App Suite` (App ID `d2e73696-537a-483b-bb63-4a4de6aa5d45`, systemuserid `53e97fb3-a006-f111-8406-000d3a352682`) has these roles:

- `WMKF AI Elevated TEMP` — custom, contains metadata-creation privileges (entity/attribute/relationship/role/solution). **Temporary — remove.**
- `System Customizer` — built-in, covers everything metadata/customization. **Temporary — remove.**
- `WMKF AI Tools` — custom, **permanent**. Now includes `prvAssignRole` (added by Connor 2026-04-24).
- `WMKF Custom Entities` — custom, **permanent**.
- `akoyaGO Read Only access` — managed, **permanent**.
- `WMKF Research Review App Suite - Staff` — custom, **permanent** (new as of 2026-04-24 cutover). Covers the 3 Wave 1 tables.

After this revert, the app user should retain only the four permanent roles.

---

## Steps

1. Open **https://make.powerapps.com** → **Production** environment.
2. Left nav → **… More → Users + permissions → Application users**.
3. Find **`# WMK: Research Review App Suite`** (App ID `d2e73696-537a-483b-bb63-4a4de6aa5d45`).
4. Click **Manage Roles**.
5. **Uncheck** these two:
   - `WMKF AI Elevated TEMP`
   - `System Customizer`
6. Confirm these four remain **checked**:
   - `WMKF AI Tools`
   - `WMKF Custom Entities`
   - `akoyaGO Read Only access`
   - `WMKF Research Review App Suite - Staff`
7. **Save**.

---

## Verification (runnable; takes ~5 seconds)

```bash
node -e "
require('./lib/dataverse/client').loadEnvLocal();
const { getAccessToken, createClient } = require('./lib/dataverse/client');
(async () => {
  const url = process.env.DYNAMICS_URL;
  const token = await getAccessToken(url);
  const c = createClient({ resourceUrl: url, token });
  const r = await c.get(\`/systemusers(53e97fb3-a006-f111-8406-000d3a352682)/systemuserroles_association?\$select=name\`);
  for (const role of r.body.value) console.log('  -', role.name);
})();
"
```

Expected output (order may vary):

```
  - WMKF AI Tools
  - WMKF Custom Entities
  - akoyaGO Read Only access
  - WMKF Research Review App Suite - Staff
```

Also a second runtime smoke test — confirms the app can still do the Wave 1 operations it needs for when we flip backends:

```bash
node scripts/verify-wave1-read-path.js --target=prod
```

Expected: 66/66 pass. Any regression here means the permanent role set is missing something and the elevations should go back on until we figure out what.

---

## What could go wrong (and how to recover)

The most likely issue is discovering that the permanent roles are missing some privilege the Wave 1 operations need — something we relied on System Customizer for without realizing.

Candidates to watch for, if something breaks:

- **`prvReadwmkf_AppUserPreference` at Basic depth** — should be on `WMKF Research Review App Suite - Staff`. If missing, the app user can't own rows on the preference table. Easy fix: rerun `node scripts/apply-security-role.js --target=prod --execute` which is idempotent and re-upserts the full privilege matrix.
- **`prvAssignRole`** — now on `WMKF AI Tools`. If missing after removal, any future `--assign` step in the role script would fail 403. Connor would need to re-add it.
- **Metadata read privileges** (`prvReadEntity`, `prvReadAttribute`, etc.) — only needed if we run the schema script again. Day-to-day data operations don't need them.

**Recovery is always:** re-assign `System Customizer` temporarily until the missing privilege is identified. No data loss possible.

---

## Why we're leaving the elevations in place for now (2026-04-24)

Justin's explicit call: we may want to rerun one of the scripts (sync, verify, role privilege adjustments) in the next few days as we flip backends. Keeping the elevations on avoids a back-and-forth with Connor if something comes up. They come off after flags are stable.

---

## Related docs

- `docs/WAVE1_PROD_RUNBOOK.md` — original cutover runbook
- `docs/archive/WAVE1_PROD_PRIVILEGE_REQUEST.md` — the System Customizer request
- `docs/archive/WAVE1_PROD_PRIVILEGE_REQUEST_2.md` — the `prvAssignRole` request
- `docs/WAVE1_VERCEL_FLAG_ROLLOUT.md` — flag-flip rollout plan
