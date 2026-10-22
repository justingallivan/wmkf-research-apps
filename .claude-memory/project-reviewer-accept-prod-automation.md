---
name: project-reviewer-accept-prod-automation
description: An ordinary, non-opted-out production accept can lead the acceptance drain to create a honorarium akoya_request when request-creation gates allow it; contact and request automation may then run. Historical production inventory also found a Bill.com flow reference and contact-to-Business-Central sync. Preserve the human Power-Automate review gate; automated tests should mock the Dataverse data layer.
metadata:
  type: project
  status: active
  scope: dataverse
  last_verified: 2026-06-10 via scripts/probe-dataverse-automation.js against prod (wmkf.crm.dynamics.com)
---

## Recall Rule

Read this when: deciding HOW/WHERE to test the reviewer Stage-2a accept flow (`respond.js` → `respond-service.js` → `reviewer_acceptance_jobs` → `reviewer-acceptance-drain.js` → `honorarium-onboard-orchestrator.js`), or before any real-prod test that creates a honorarium `akoya_request` / updates a reviewer contact.

The handler returns after recording acceptance; the drain performs later contact/
honorarium work for ordinary requests when the relevant isolation, opt-out, and
request-creation gates permit it. When test-request isolation is enabled, a confirmed test request is cancelled by
the drain before contact, honorarium, BILL, or email follow-ups; an unreadable
test marker retries. A handler-only test does not cover the drain. This source boundary
was checked 2026-10-22; the automation inventory below remains the June 10 snapshot.

Do:
- For an AUTOMATED accept test (e.g. Playwright), MOCK the Dataverse data layer — the real handler logic runs (422 guard, opt-out, state machine) but NO `akoya_request` is created and NO contact is touched, so no Dataverse automation fires.
- Re-run `node scripts/probe-dataverse-automation.js` only after owner authorization for the production metadata read and a named target/scope; it performs metadata GETs to refresh the inventory of workflows/plugins/cloud-flows on `akoya_request` / `contact` / `wmkf_appreviewersuggestion` before trusting older counts.

Do not:
- Run an unfenced real-prod accept test. For an ordinary, non-opted-out request with creation gates enabled, the drain can create a honorarium `akoya_request` and fire automation you can't un-fire by deleting; `scripts/reset-request-reviewers.mjs` does NOT clean the honorarium request; do not assume promoted contacts can be hard-deleted: the permission evidence is historical ([[project-contact-promotion-permission]]).
- Trust our `BILL_ONBOARDING_DEFERRED` gate to suppress Power Automate — PA flows react to Dataverse events, not our env flags.

## What the probe found (prod, 2026-06-10)

The accept writes three tables; automation density:
- **`akoya_request` CREATE** (the honorarium request — same entity as grant requests): **0** custom cloud-flow CREATE triggers (Activated); **1** Activated cloud trigger with an unparsed event (deprecated "GOapply Add Request to Review Group"); **12** Activated classic workflows on Create (likely gated by request type/program to grant/scholarship — NOT confirmed); **42** enabled plugin Create steps, almost all AkoyaGo/system internals (`ObjectModel Implementation`, `RollupTriggerPlugin`, `CalculatedFields`, `RequestUpdate`, `RequestSetGrantAndStatus`, `AsyncEntityCreated`, `WorkflowExpansion`) that fire on EVERY real honorarium create already — benign baseline, not new risk.
- **MUST CONFIRM before any real-prod test:** the Activated **"Bill.com - Push Payments"** cloud flow references `akoya_request` (detected in actions, not as a create-trigger) — verify it triggers on a PAYMENT record, not request-create, or a test accept could push a real payment.
- **`contact` UPDATE** (address+phone PATCH): fires `AkoyaGo.Sync_BusinessCentral` (async → external accounting sync) + `CalculatedFields`/address plugins. Low harm (editing an address) but a real external sync.
- **`wmkf_appreviewersuggestion` UPDATE** (accept stamp): only system `ObjectModel` plugins — NO custom workflows/flows. Clean.

**Historical June 10 environment context:** the observed accept path targeted Production; local development then pointed at Production and the sandbox lacked the reviewer schema ([[project-dynamics-sandbox-state]]). The app registration could read `workflow` and `sdkmessageprocessingstep` metadata in that probe. Neither the old target configuration nor that access is a current authorization or freshness check.

**How to apply:** mock-the-data-layer for CI; a real-prod accept is a human-supervised one-off gated on a Power-Automate owner (Connor) confirming "Bill.com - Push Payments" and the 12 Create-workflows don't act on a honorarium-type request. Related: [[project-bill-honorarium-integration]], [[project-reviewer-address-collection-provisional]], [[project-dynamics-sandbox-state]].
