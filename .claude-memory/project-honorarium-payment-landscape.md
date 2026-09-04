---
name: Reviewer honorarium onboarding/payment reality
description: Current reviewer-honorarium posture: the portal creates the Dataverse honorarium request, BILL API work is tabled, and payment remains outside this app.
metadata:
  type: project
  status: active
  scope: bill
  last_verified: 2026-09-04 via closeout source/tests, Production eligibility metadata/runtime select, finance-honoraria wiki, and prior GET-only honorarium-link census; numeric payment probes remain 2026-06-27/28
---

## Recall Rule

Read when discussing reviewer payment, changing accept-time honorarium creation,
or proposing BILL/vendor automation. Re-probe before quoting historical cohort or
payment counts. Do not revive the BILL API/PNI plan without a new owner decision.

## Current operating posture

**Owner decision 2026-07-12:** BILL API integration is tabled for several months,
possibly permanently. Reviewer onboarding uses the address already collected by
the portal plus existing foundation systems. The BILL code remains dormant, not
deleted.

**Portal request creation is live.** Since 2026-07-02, reviewers who accept through
the portal can receive an app-created reviewer-honorarium `akoya_request` through
`ensureHonorariumOnboarding()`:

- the three honorarium discriminator GUIDs identify Research Reviewer / Honorarium /
  Individual;
- `HONORARIUM_ONBOARDING_DEFERRED` is unset in Production, so the request may be
  created;
- `BILL_ONBOARDING_DEFERRED=true` prevents the BILL tail;
- the request binds the reviewer contact and parent proposal, and the suggestion
  junction holds the deterministic honorarium marker.

The GET-only production linkage census on 2026-07-27 found 40 portal-era
honoraria: all 40 had the direct `wmkf_reviewedproposal` link, all 40 had the
suggestion-junction marker, and all 40 proposal identities agreed. Re-run
`scripts/probe-honorarium-link-population.js` before quoting a later population.

The earlier capture-only posture is the safety/off mode, not the current Production
target. Detailed configuration and rollout evidence live in
`docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`; current operational routing lives in
`docs/agent-wiki/topics/finance-honoraria.md`.

## Payment landscape — dated evidence, not a live counter

The 2026-06-27/28 probes found:

- 0 of 9,151 completed Dataverse payment children paid a contact/person; all paid
  an Account/institution;
- the historical individual-honorarium cohort had no `akoya_requestpayment`
  children and no populated person-vendor identifier;
- the shared payment machinery was rail-agnostic (pre-BILL ACH and later BILL
  references both used it), so the blocking question was the person-payee model,
  not simply which payment rail was chosen;
- grant approval/remit fields were live on a minority of grants but unused on the
  honorarium cohort.

These counts explain the decision but are not self-refreshing facts. Re-run the
payment probes or obtain current Ops evidence before using them for a new design.

## Current implementation invariants

- The portal is the sole creator for portal-origin reviewer honoraria; do not add a
  second GoApply creation path.
- Request creation and payment are separate. A successful request create is not
  evidence that the reviewer was vendored or paid.
- Contact/address capture precedes request creation; payment PII does not belong in
  Dataverse beyond the already-approved contact fields.
- `ensureHonorariumOnboarding()` uses deterministic suggestion-derived identity and
  the junction marker to prevent duplicate request creation on retries.
- `wmkf_reviewedproposal` / `wmkf_ReviewedProposal` is the structured
  honorarium-to-proposal link; the title is only the human-readable companion.
- Do not run a blanket historical backfill. The 2026-07-02 capture-only eligibility
  sweep found no real reviewer needing that backfill; any future run must be
  cycle-scoped and dry-run first.

## Superseded exploration

The earlier PNI self-report field, BILL-account walkthrough, vendor-create API,
webhook, and resume-sweep recommendations are **not active work** after the
2026-07-12 decision. Their old measurements remain in git history and the BILL
design documents, but agents must not present them as the next step.

**Owner decision 2026-09-04:** reviewer closeout must not set
`wmkf_authorizationtoremitpaymentflag`. The PD will record a separate
engagement-level eligibility disposition (`eligible`, `not_eligible`, or
`not_applicable`) when closing a received review; the app workflow is source-built
and awaiting deployment. Production contains the published/readable exact local
Picklist, though its description still needs the tracked authority-warning
correction. Operations/Finance retains the final remit decision. A
read-only Production probe that day found all 159 exact honorarium requests
explicitly false on the remit flag, while a broader Research-request scan found
87 true values, confirming that the field is live elsewhere rather than the
honorarium closeout signal. Treat this as the reviewer-closeout project
(`project-reviewer-closeout-payability`), not an implicit BILL task.

## Ground truth

- `docs/agent-wiki/topics/finance-honoraria.md`
- `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`
- `lib/bill/honorarium-onboard-orchestrator.js`
- `lib/bill/onboard-reviewer-service.js`
- `lib/services/honorarium-config.js`
- `scripts/backfill-honorarium-capture-only.mjs`
- `akoya-payment-field-semantics` and `akoya-request-honorarium-nomenclature`
