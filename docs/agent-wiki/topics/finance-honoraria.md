---
agent_wiki: topic
status: active
last_verified: 2026-07-12
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

**OWNER DECISION 2026-07-12: the BILL API integration is TABLED for several
months, possibly permanently.** Reviewer onboarding will instead use the
reviewer's address plus existing foundation systems. Do not build on or propose
the BILL API pipeline without a new owner decision; the BILL code stays dormant,
not deleted (`BILL_ENABLED` unset in every Vercel environment — verified
2026-07-12 — so `onboardReviewer()` degrades to alert_only). Detail:
`project-honorarium-payment-landscape` memory. The 2026-07-01 posture below
remains the live mechanical state.

**Current plan (2026-07-01 decision):** full BILL.com onboarding remains deferred,
but the portal is now the planned sole creator of reviewer honorarium
`akoya_request` rows for reviewers who come through it. Use
`docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` as the current source of truth for
the no-BILL cycle. **This posture WENT LIVE in Production 2026-07-02** (GUIDs set,
`HONORARIUM_ONBOARDING_DEFERRED` removed from Production / kept `true` on Preview,
BILL still deferred, prod redeployed) — honorarium-ON / BILL-off is the live
posture, not a plan; a real honorarium `akoya_request` was created
`[VERIFIED via #1003172, 2026-07-06]`. The clean go-live posture is:

- set the three honorarium discriminator GUIDs;
- unset `HONORARIUM_ONBOARDING_DEFERRED` so `ensureHonorariumOnboarding()` mints
  the honorarium request;
- set `BILL_ONBOARDING_DEFERRED=true` so `onboardReviewer()` silently skips BILL;
- redeploy/restart after the env update, because the discriminator env vars are
  read when the server module loads;
- keep payment offline by check until the person-payee/BILL tail is separately
  approved and verified.

If an accepted reviewer self-withdraws before materials release, the portal
removes that engagement's exact linked honorarium `akoya_request` automatically
in the same Dataverse changeset that flips the suggestion to declined. The
reviewer/contact and suggestion history remain. The acceptance-job drain
re-checks after honorarium creation and compensates for a concurrent withdrawal,
so a late worker cannot leave or recreate an honorarium for an unfulfilled
review obligation.

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

### Honorarium → proposal self-lookup (DONE 2026-07-02)

A honorarium and a proposal are both `akoya_request` rows, and `akoya_request` had no
native self-referential lookup (65 lookup fields, none targeted `akoya_request`). To
give each app-created honorarium a structured, queryable link to the proposal it
reviews, a custom self-lookup on `akoya_request` → `akoya_request` was created via the
Dataverse Web API on 2026-07-02 (into the Default Solution; default publisher prefix
is `wmkf`). Authoritative names read back from the relationship metadata:
- lookup logical name: **`wmkf_reviewedproposal`**
- **Referencing** nav property (honorarium → proposal, the one our create binds):
  **`wmkf_ReviewedProposal`** (casing confirmed by a read-only `$expand`, 200)
- **Referenced** collection nav (proposal → its honoraria, for a dashboard subgrid):
  `wmkf_akoya_request_reviewedproposal`
- cascade `Delete = RemoveLink` (referential — deleting a proposal only clears the link)

The create body in `lib/bill/honorarium-onboard-orchestrator.js` binds it
(`'wmkf_ReviewedProposal@odata.bind': /akoya_requests(<proposalId>)`, guarded on
`request.akoya_requestid`). The bind is metadata-verified; it is first exercised by a
live create at go-live (pipeline still deferred). Our app populates the FK but does
NOT surface the field in its own UI. Connor surfaces it in an AkoyaGO dashboard and
may add the component to `wmkfResearchReviewAppSuite`. The proposal is also still
conveyed by the honorarium title (Option C) and derivable via the
`wmkf_appreviewersuggestion` junction (`wmkf_HonorariumRequest` + `wmkf_Request`).
Detail: `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` §8/§9.

## Standard Probe

```bash
rg -n "honorarium|Bill|BILL|payment|bank|akoya_request" lib pages docs tests
```
