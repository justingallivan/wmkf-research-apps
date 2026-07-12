---
name: project-dynamics-sandbox-state
description: A Dynamics sandbox exists and is reachable, but is schema-stale — not drop-in usable for reviewer-Workbench testing
metadata:
  node_type: memory
  type: project
  originSessionId: ada6c18e-51f9-4c56-94fa-c8dabd742178
  status: active
  scope: dataverse
  last_verified: 2026-07-12 via discover-dynamics-envs.js (sandbox orgd9e66399 reachable, WhoAmI OK, OrgId 3d52a072-b138-ef11-8e4b-000d3a106422 matches) + read-only OData GET (wmkf_appreviewersuggestion/appresearcher/appgrantcycle → 404; wmkf_policyversion → 0 rows) — all reachability + schema-staleness claims re-confirmed live
---

## Recall Rule

Read this when: deciding where to run reviewer-Workbench smoke tests, or considering the sandbox as a test store.

Do:
- Treat the sandbox (`orgd9e66399`) as reachable but schema-stale — NOT drop-in usable for reviewer-Workbench testing.
- Run reviewer smokes on prod against the dedicated test request (S213: 1002788, in the D26 allowlist) until the sandbox is provisioned.
- To route the local app at the sandbox, set `DYNAMICS_URL` (not `DYNAMICS_SANDBOX_URL`) in `.env.local`.

Do not:
- Repeat the "there is NO isolated test store" claim — a sandbox exists.
- Assume the sandbox can send email or has the reviewer schema (`wmkf_appreviewersuggestion`/`wmkf_appgrantcycle` 404; `wmkf_policyversion` 0 rows).

Ground truth: `scripts/discover-dynamics-envs.js`, `scripts/apply-dataverse-schema.js`, [[project-contact-promotion-permission]].

A Dynamics **sandbox exists and is reachable** by our app registration — `WM Keck Sandbox`, `https://orgd9e66399.crm.dynamics.com` (org `3d52a072-b138-ef11-8e4b-000d3a106422`). Verified S213 (2026-06-02) via `scripts/discover-dynamics-envs.js` (read-only Global Discovery + WhoAmI both succeed with the prod `DYNAMICS_CLIENT_ID`/`SECRET`/`TENANT_ID`). So the "there is NO isolated test store" claim that rode along in SESSION_PROMPT S213 is **overstated** — a sandbox is there.

**BUT it is schema-stale and not drop-in usable for reviewer-Workbench testing.** It's a prod-data clone (akoya_request/contact each 5000+, wmkf_potentialreviewer 680, plus old "TEST A/B/C" requests) that predates (or never received) the wave4/5/6 reviewer schema:
- ❌ `wmkf_appreviewersuggestion` → 404 (the core junction — candidate/invite/track/accept all hang off it)
- ❌ `wmkf_appresearcher` → 404 (bibliometric sidecar)
- ❌ `wmkf_appgrantcycle` → 404
- ⚠️ `wmkf_policyversion` → exists but **0 rows** (accept step needs COI + AI-use version GUIDs, so accept would fail)

**Why:** sandbox was used for the Wave-1 Postgres→Dataverse migration testing (settings/identity-map/app-access/prefs), via `DYNAMICS_SANDBOX_URL`; the later reviewer-Workbench entities were only ever deployed to prod.

**How to apply:**
- The main app's `DynamicsService` reads `DYNAMICS_URL`, NOT `DYNAMICS_SANDBOX_URL`. Only the Wave-1 Dataverse adapters (`dataverse-settings-service.js`, `dataverse-app-access-service.js`, `dataverse-prefs-service.js`) plus `dataverse-identity-map.js` and standalone scripts honor `DYNAMICS_SANDBOX_URL`. To route the whole local app at the sandbox you must set `DYNAMICS_URL=https://orgd9e66399.crm.dynamics.com` in `.env.local` (the discover script's "set DYNAMICS_SANDBOX_URL" hint is for schema scripts, not the app).
- To make the sandbox usable for reviewer testing: deploy the reviewer schema there (`scripts/apply-dataverse-schema.js` already targets `DYNAMICS_SANDBOX_URL`), seed `wmkf_policyversion` rows, then verify **sandbox email actually sends** — Dynamics SendEmail from a sandbox is often disabled, which would defeat any "send a real invitation + click the magic link" smoke. Until that's done, reviewer smokes run on prod against a dedicated test request — **1002788** ("Dec 2026 Project Title TEST 2", Connor-created, applicant = WMKF) as of S213, in the D26 allowlist (see [[project-contact-promotion-permission]] for the undeletable-promoted-contact gotcha).
