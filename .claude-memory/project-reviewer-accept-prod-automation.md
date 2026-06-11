---
name: project-reviewer-accept-prod-automation
description: A real-prod reviewer-accept test CREATEs a honorarium akoya_request, which fires AkoyaGo platform plugins + classic workflows; there is a live "Bill.com - Push Payments" cloud flow and a contact→Business-Central sync. So real-prod accept tests are gated on human Power-Automate review; automated tests should MOCK the Dataverse data layer. Read-only inventory: scripts/probe-dataverse-automation.js.
metadata:
  type: project
  status: active
  scope: dataverse
  last_verified: 2026-06-10 via scripts/probe-dataverse-automation.js against prod (wmkf.crm.dynamics.com)
---

## Recall Rule

Read this when: deciding HOW/WHERE to test the reviewer Stage-2a accept flow (`pages/api/external/review/[token]/respond.js` → `lib/bill/honorarium-onboard-orchestrator.js`), or before any real-prod test that creates a honorarium `akoya_request` / updates a reviewer contact.

Do:
- For an AUTOMATED accept test (e.g. Playwright), MOCK the Dataverse data layer — the real handler logic runs (422 guard, opt-out, state machine) but NO `akoya_request` is created and NO contact is touched, so no Dataverse automation fires.
- Re-run `node scripts/probe-dataverse-automation.js` (READ-ONLY, metadata GETs only) to refresh the inventory of workflows/plugins/cloud-flows on `akoya_request` / `contact` / `wmkf_appreviewersuggestion` before trusting older counts.

Do not:
- Run an unfenced real-prod accept test. It creates a honorarium `akoya_request` → fires automation you can't un-fire by deleting; `scripts/reset-request-reviewers.mjs` does NOT clean the honorarium request; promoted contacts are undeletable ([[project-contact-promotion-permission]]).
- Trust our `BILL_ONBOARDING_DEFERRED` gate to suppress Power Automate — PA flows react to Dataverse events, not our env flags.

## What the probe found (prod, 2026-06-10)

The accept writes three tables; automation density:
- **`akoya_request` CREATE** (the honorarium request — same entity as grant requests): **0** custom cloud-flow CREATE triggers (Activated); **1** Activated cloud trigger with an unparsed event (deprecated "GOapply Add Request to Review Group"); **12** Activated classic workflows on Create (likely gated by request type/program to grant/scholarship — NOT confirmed); **42** enabled plugin Create steps, almost all AkoyaGo/system internals (`ObjectModel Implementation`, `RollupTriggerPlugin`, `CalculatedFields`, `RequestUpdate`, `RequestSetGrantAndStatus`, `AsyncEntityCreated`, `WorkflowExpansion`) that fire on EVERY real honorarium create already — benign baseline, not new risk.
- **MUST CONFIRM before any real-prod test:** the Activated **"Bill.com - Push Payments"** cloud flow references `akoya_request` (detected in actions, not as a create-trigger) — verify it triggers on a PAYMENT record, not request-create, or a test accept could push a real payment.
- **`contact` UPDATE** (address+phone PATCH): fires `AkoyaGo.Sync_BusinessCentral` (async → external accounting sync) + `CalculatedFields`/address plugins. Low harm (editing an address) but a real external sync.
- **`wmkf_appreviewersuggestion` UPDATE** (accept stamp): only system `ObjectModel` plugins — NO custom workflows/flows. Clean.

**Why:** the accept's honorarium-create + contact-PATCH run against PROD Dataverse (local dev points at prod; the sandbox lacks the reviewer schema — [[project-dynamics-sandbox-state]]). The app registration CAN read `workflow` + `sdkmessageprocessingstep` metadata, so the inventory is self-serviceable.

**How to apply:** mock-the-data-layer for CI; a real-prod accept is a human-supervised one-off gated on a Power-Automate owner (Connor) confirming "Bill.com - Push Payments" and the 12 Create-workflows don't act on a honorarium-type request. Related: [[project-bill-honorarium-integration]], [[project-reviewer-address-collection-provisional]], [[project-dynamics-sandbox-state]].
