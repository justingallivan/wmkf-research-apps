---
name: Wave 1 automated onboarding — agreed design
description: Agreed design (2026-04-24) for zero-touch first-login provisioning after Wave 1 flags flip, including the new ensureStaffRoleAssigned helper and where to wire it. DESIGN agreed but UNBUILT — no `lib/services/onboarding.js`; `grantDefaultApps` does not yet call `ensureStaffRoleAssigned`; manual `apply-security-role.js` covers onboarding meanwhile.
type: project
originSessionId: 12929e8f-a1f9-4780-8aeb-89b85e260c0b
status: active
scope: dataverse
last_verified: 2026-06-04 via code (confirmed UNBUILT — no onboarding service; only grantDefaultApps wired)
---

## Recall Rule

Read this when: a new staff onboarding triggers the auto-provisioning gap, or planning zero-touch first-login provisioning.

Do:
- Extend `grantDefaultApps` in `pages/api/auth/[...nextauth].js` to call a new `ensureStaffRoleAssigned(profileId)` helper (to live at `lib/services/onboarding.js`).
- Make it idempotent and non-fatal — log failures, let sign-in proceed; resolve via `dataverse-identity-map.js` + `role-apply.js` against the Staff role.
- Until built, use `apply-security-role.js --assign=<email>` to cover onboarding.

Do not:
- Build a separate panel/app/script — the /admin dashboard already handles grant-more-apps.
- Treat the Wave 1 prerequisite as unmet — flags flipped 2026-05-03, tables dropped 2026-05-12.

Ground truth: `pages/api/auth/[...nextauth].js`, `lib/services/dataverse-identity-map.js`, `lib/dataverse/role-apply.js`. Related: [[project-wave1-closeout-role-tail]].

Once `WAVE1_BACKEND_APP_ACCESS=dataverse` is flipped in prod, new staff onboarding should be automated — not a panel, not a separate app, not a script. Justin approved this direction 2026-04-24 ("I'm not super worried about Dataverse being reachable on sign-in").

**Design:**

1. Extend `grantDefaultApps` in `pages/api/auth/[...nextauth].js` (which already runs on first sign-in) to also call a new `ensureStaffRoleAssigned(profileId)` helper.
2. Helper lives at `lib/services/onboarding.js` (to be created). It resolves the user via the identity map (already built at `lib/services/dataverse-identity-map.js`) and calls `assignRoleToUser` from `lib/dataverse/role-apply.js` against the `WMKF Research Review App Suite - Staff` role.
3. Idempotent: if the user already has the role, no-op. Swallows "already assigned" errors the same way `role-apply.js` does today.
4. Failure is logged but non-fatal — the user still gets through sign-in. Pairing this with a self-healing retry in `requireAppAccess` (if a preference read 403s, attempt assignment then retry once) covers the rare Dataverse-down case.

Pre-provisioning (creating a user record before their first login) is a nice-to-have, not required. If it becomes a real ask, add a button to the existing `/admin` dashboard rather than building a new app.

**Why:** onboarding happens rarely (low-frequency event), and the /admin dashboard already handles the grant-more-apps flow via the flag-dispatched app-access-service. This closes the remaining gap.

**How to apply:** Wave 1 prerequisite is satisfied (flags flipped 2026-05-03, Postgres tables dropped 2026-05-12). Build whenever a new staff onboarding triggers the gap; until then, `apply-security-role.js --assign=<email>` covers it. Wire-up is ~30 lines.
