---
agent_wiki: topic
status: active
last_verified: 2026-06-21
stale_after_days: 90
owner: finance-ops
source_files:
  - pages/api/review-manager/send-emails.js
  - pages/api/external/review/[token]/respond.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/
watch_paths:
  - pages/api/external/review/**
  - pages/api/review-manager/**
  - lib/dataverse/**
update_triggers:
  - honorarium request creation changes
  - payment field semantics changes
  - banking/PII handling changes
---

# Finance & Honoraria

Use this page for BILL, honoraria, payment semantics, and the no-banking/PII
constraint. When a flow can trigger external payment automation, verify with
source, Atlas, and the Power Automate owner before testing against production.

## Durable Memory

- BILL/honoraria integration: `project-bill-honorarium-integration`.
- Field semantics/nomenclature: `akoya-request-honorarium-nomenclature`, `akoya-payment-field-semantics`.
- Firm data constraint: `project-no-banking-pii-in-dataverse`.
- External accept automation hazard: `project-reviewer-accept-prod-automation`.

## Capture-only (deferred) honorarium onboarding

Two independent deferral gates sit on the post-accept honorarium pipeline; both
capture the reviewer's contact + mailing address upstream and pay manually:

- **`HONORARIUM_ONBOARDING_DEFERRED=true`** (or discriminator GUIDs unset) →
  `ensureHonorariumOnboarding()` returns `status: 'deferred'` **before** minting
  the `akoya_request` or calling BILL. It does NOT throw. `respond.js` picks the
  alert posture from the deferred result, in priority order:
  - `addressCaptureError` set (the address PATCH failed → no downstream copy) →
    emailing **warning** `honorarium_capture_failed`, deduped per suggestion, on
    every accept until resolved (avoids silent data loss — Codex S274 P1).
  - `partialDiscriminatorConfig` (some-but-not-all GUIDs, no explicit flag → likely
    a botched go-live) → emailing **warning** `honorarium_discriminator_partial_config`,
    deduped to one recurring alert (Codex S274 P2).
  - otherwise → ONE non-emailing `honorarium_capture_only` notice (`info`,
    `emailAdmins:false`) per fresh accept.
  Use when the payment pipeline isn't built yet but you still want address+choice.
  Note: the explicit flag is checked FIRST, so re-enabling creation needs all three
  GUIDs **and** the flag unset.
- **`BILL_ONBOARDING_DEFERRED=true`** → one step LATER: the `akoya_request` IS
  created, but `onboardReviewer()` returns `status: 'deferred'` (no BILL, no alert).

Both are reversible env gates (configure GUIDs / set `BILL_ENABLED=true`, unset the
flag). Source: `lib/bill/honorarium-onboard-orchestrator.js`,
`lib/bill/onboard-reviewer-service.js`; design banners in
`docs/BILL_CHUNK_4_DESIGN.md` + `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.

## Standard Probe

```bash
rg -n "honorarium|Bill|BILL|payment|bank|akoya_request" lib pages docs tests
```
