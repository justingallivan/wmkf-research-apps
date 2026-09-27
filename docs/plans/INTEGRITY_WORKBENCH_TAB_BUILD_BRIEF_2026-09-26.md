---
title: Integrity Screener as a Workbench tab — build brief
status: active
date: 2026-09-26
owner: Codex (build), Claude (review)
---

# Integrity Screener as a Workbench tab — build brief (Codex)

## Where you are

You are in `../WMKF_Apps-codex` on branch `codex/integrity-workbench-tab` (from `origin/main` at `d9311b754`). Run `/start` first. **Stay on this branch and in this directory**: other agents are working in the main checkout and on other branches. Do not check out other branches, and do not touch the main checkout. Commit to this branch in small, descriptive commits and push it (`git push -u origin codex/integrity-workbench-tab`). Pushing a feature branch does not deploy. **Never push to `main`, and never merge.**

Read `CLAUDE.md`, then `docs/agent-wiki/topics/integrity-screener.md`.

## Goal (owner decisions, 2026-09-26)

Bring the Integrity Screener into the Workbench so a request's people are screened **without typing their names**.

1. **Who is screened:** the request's **PI and Co-PIs**, with their institutions, read **server-side** from Dataverse. Never take names, institutions or person IDs from the request body; the client sends only the request GUID.
2. **Where:** a new **Integrity tab** on the Workbench request page (`pages/workbench/[requestId].js`, `TABS` at ~:49–60). It has a "Run screen" action, per-person results, and when the run happened.
3. **Persistence:** the **latest run per request** is saved and shown again on reload. Earlier runs may remain in the table, but the tab shows the latest.
4. **The standalone `/integrity-screener` page stays** for ad-hoc manual names. Its behavior must not change.

## Ground truth to build from (derive every field name from source; never invent identifiers)

- **Screening engine:** `IntegrityService.screenApplicants(applicants, claudeApiKey, serpApiKey, userProfileId)` is an async generator (`lib/services/integrity-service.js:35`) that yields progress and results. The existing route `pages/api/integrity-screener/screen.js` shows how it is called, streamed, authorized, and given its keys. Reuse the service; don't fork its logic. Read what shape `applicants` must have from the service and the standalone page.
- **History store:** Postgres `integrity_screenings` (fresh-install shape in `scripts/setup-database.js:151-163`; writer `saveScreening` at `integrity-service.js:579`; readers ~:607-626). It has **no request column today**.
- **People:**
  - The PI/Co-PI junction is Dataverse `wmkf_apprequestperson`, read through `lib/dataverse/adapters/app-request-person.js` (`queryCoPIs`, `queryPersons`, `queryAllPersons`).
  - The documented read strategy is the **UNION** of the junction (roles PI=100000000 and Co-PI=100000001) with `akoya_request._wmkf_projectleader_value`. See `docs/atlas/dataverse-wmkf-apprequestperson.md` "Source of truth" and the header of `pages/api/reviewer-finder/contact-history.js`.
  - Deduplicate by contact. Find how existing Workbench code resolves a contact's name and institution (the Proposal/Overview tab readers and the external review context route) and reuse that path.
- **Tab gating:** tabs are filtered by `visibleTabsFor(hasAccess)` via an optional `gate` app key (`[requestId].js:62-63`). Gate the new tab on the Integrity Screener's app key from `shared/config/appRegistry.js` (`integrity-screener`), and gate the server routes on the same key with `requireAppAccess`, so the UI gate mirrors the server guard.

## Required work

1. **Migration:** add a nullable `request_id` (UUID) to `integrity_screenings` with an index for "latest by request". **Number it 056**, because 055 is claimed by the unmerged `codex/feature-request` (`055_post_presentation_materials.sql`); whoever merges second renumbers if needed. Update the migrations manifest (`npm run prebuild` / `check:migrations-manifest`), the fresh-install mirror in `scripts/setup-database.js`, and the Atlas (`docs/APPLICATION_STATE_ATLAS.md` rows for `integrity_screenings`, plus any Postgres atlas page that covers it). Do not apply the migration anywhere; the owner applies it at release. `node scripts/apply-migrations.js` is the existing-database path.
2. **Service:**
   - A request-scoped entry point that loads the PI/Co-PIs server-side, calls `screenApplicants`, and saves the run with its `request_id`.
   - A reader returning the latest saved run for a request.
   - Keep routes thin (`check:route-service-boundary`). Dataverse reads go through adapters inside `withDalContext` (`lib/dataverse/core/context.js`).
3. **API routes**, e.g. `pages/api/workbench/integrity/` for run and latest:
   - `requireAppAccess('integrity-screener')`;
   - GUID-validate the request id (`check:trust-boundary-guid`);
   - call `loadModelOverrides()` before resolving any LLM model (`check:model-override-warming`);
   - register each route in `docs/API_ROUTE_SECURITY_MATRIX.md` and update `CANONICAL_COUNTS` (route-file and `requireAppAccess` counts; `check:fact-consistency`).
   
   Use the actor from the authenticated context, never from the request.
4. **UI:**
   - A new tab component under `shared/components/workbench/` (follow neighboring tab components' structure and loading/error states).
   - The tab entry in `TABS`.
   - It shows the people to be screened before a run.
   
   Do **not** modify shared primitives (`shared/components/Layout.js` etc.). The current Dismiss placeholder and PDF/JSON/Markdown exports are out of scope unless reusing them is trivial.
5. **Cost guard:** a run spends Claude and SerpAPI credits per person. The UI should confirm before running, and the server must refuse an empty or unexpectedly large person list. Choose a sane cap and say why in the service header.
6. **Docs:**
   - Update `docs/agent-wiki/topics/integrity-screener.md` ("Current UI boundaries") and run `check:agent-wiki`.
   - Add a service catalog entry if you add a service module (`docs/SERVICE_AND_UTILITY_CATALOG.md`).

## Tests and gates

- Unit tests with fakes for:
  - people loading (UNION, dedupe, a PI who is also a Co-PI, no people);
  - the route (auth refusal, bad GUID, request body names ignored);
  - persistence (the latest run by request);
  - the tab (gated hidden, empty, results).
- **Never run a live screen:** it spends paid credits. No live Dataverse writes. Local read-only runs against the app are fine if you need them.
- Run gates for surfaces you touched, **each gate then its `:self-test`, sequentially**: `check:migrations-manifest`, `check:api-routes`, `check:route-service-boundary`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:model-override-warming`, `check:prompt-injection-tagging`, `check:dataverse-access-layer`, `check:atlas`, `check:fact-consistency`, `check:doc-currency`, `check:agent-wiki`, `check:secret-scan`, `check:types`.
- Then `npm run lint` and `npm run build`. Run the full unit suite: `npx jest tests/unit`.

## Hand-back

When done, leave a short summary at the end of this file covering:
- commits;
- files changed;
- the migration number used;
- routes added;
- test and gate results;
- anything you decided differently from this brief, and why.

Claude reviews the branch read-only before the owner decides on merge.
