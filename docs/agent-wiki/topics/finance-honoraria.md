---
agent_wiki: topic
status: active
last_verified: 2026-07-02
stale_after_days: 90
owner: finance-ops
source_files:
  - pages/api/review-manager/send-emails.js
  - pages/api/external/review/[token]/respond.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/
  - docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md
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

## Honorarium Request Creation And BILL Deferral

**Current plan (2026-07-01 decision):** full BILL.com onboarding remains deferred,
but the portal is now the planned sole creator of reviewer honorarium
`akoya_request` rows for reviewers who come through it. Use
`docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` as the current source of truth for
the no-BILL cycle. The clean go-live posture is:

- set the three honorarium discriminator GUIDs;
- unset `HONORARIUM_ONBOARDING_DEFERRED` so `ensureHonorariumOnboarding()` mints
  the honorarium request;
- set `BILL_ONBOARDING_DEFERRED=true` so `onboardReviewer()` silently skips BILL;
- redeploy/restart after the env update, because the discriminator env vars are
  read when the server module loads;
- keep payment offline by check until the person-payee/BILL tail is separately
  approved and verified.

The 2026-06-22 production lock was capture-only:
`HONORARIUM_ONBOARDING_DEFERRED=true` with the discriminator GUIDs unset. Treat
that as the safety/off state before the config flip, not the target operating
state for the no-BILL creation cycle.

Two independent deferral gates sit on the post-accept honorarium pipeline:

- **`HONORARIUM_ONBOARDING_DEFERRED=true`** (or discriminator GUIDs unset) →
  `ensureHonorariumOnboarding()` returns `status: 'deferred'` **before** minting
  the `akoya_request` or calling BILL. It captures the contact + mailing address
  upstream and does not throw. `respond.js` picks the alert posture from the
  deferred result, in priority order:
  - `addressCaptureError` set (the address PATCH failed → no downstream copy) →
    emailing **warning** `honorarium_capture_failed`, deduped per suggestion, on
    every accept until resolved (keeps address-copy failure visible — Codex S274 P1).
  - `partialDiscriminatorConfig` (some-but-not-all GUIDs, no explicit flag → likely
    a botched go-live) → emailing **warning** `honorarium_discriminator_partial_config`,
    deduped to one recurring alert (Codex S274 P2).
  - otherwise → ONE non-emailing `honorarium_capture_only` notice (`info`,
    `emailAdmins:false`) per fresh accept.
  Use only for capture-only/off mode. Note: the explicit flag is checked FIRST,
  so enabling request creation needs all three GUIDs **and** the flag unset.
- **`BILL_ONBOARDING_DEFERRED=true`** → one step LATER: the `akoya_request` IS
  created, but `onboardReviewer()` returns `status: 'deferred'` (no BILL, no
  alert). This is the target no-BILL creation posture.

Both are reversible env gates. Source:
`lib/bill/honorarium-onboard-orchestrator.js`,
`lib/bill/onboard-reviewer-service.js`; current strategy:
`docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`; older design banners:
`docs/BILL_CHUNK_4_DESIGN.md` + `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.

Reviewers who accepted while capture-only was on won't re-accept, so once the
pipeline is live, mint their missing records with
`scripts/backfill-honorarium-capture-only.mjs --cycle <CODE>` (dry-run by default;
cycle-scoped so it can't sweep older cohorts; drives the same idempotent
`ensureHonorariumOnboarding`; refuses to run while still deferred). The two
readiness hardening edits are LANDED (S316): the backfill applies the same
required-address completeness AND validity checks as fresh accept — the shared
`missingRequiredAddressFields` + `validateAddress` in
`lib/external/required-address.js` — and includes `akoya_title` in its request
reload, so historical rows can no longer mint with partial/unnormalized stale
contact addresses (e.g. a full-name country) or generic proposal titles.

### Honorarium → proposal self-lookup (approved 2026-07-02, not yet wired)

A honorarium and a proposal are both `akoya_request` rows, and there is no native
self-referential lookup on `akoya_request` (verified: 65 lookup fields, none targets
`akoya_request`). To give each app-created honorarium a structured, queryable link to
the proposal it reviews, Connor is creating a custom self-lookup on `akoya_request` →
`akoya_request` (proposed `wmkf_relatedproposal`; final name is Connor's, to be
surfaced in an AkoyaGO dashboard). Being self-referential, it exposes a Referencing
(N:1) nav property (the one our create binds, honorarium → proposal) and a Referenced
(1:N) collection (proposal → its honoraria). **Status:** the bind is parked as a TODO
in `lib/bill/honorarium-onboard-orchestrator.js` (create body) — wire it only after
Connor publishes and the exact Referencing nav-property casing is confirmed from live
metadata (`0x80060888` on wrong casing). Our app populates the FK on create but does
NOT surface the field in its own UI yet. Until the lookup lands, the proposal is still
conveyed by the honorarium title (Option C) and derivable via the
`wmkf_appreviewersuggestion` junction (`wmkf_HonorariumRequest` + `wmkf_Request`).
Detail: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §8/§9.

## Standard Probe

```bash
rg -n "honorarium|Bill|BILL|payment|bank|akoya_request" lib pages docs tests
```
