---
name: Reviewer count — 3 confirmed needed, 5 invitation slots
description: We need 3 confirmed reviewers per proposal; the 5 wmkf_potentialreviewer1..5 lookup slots are an over-invite buffer for declines, not a target
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
status: active
scope: reviewer
last_verified: 2026-07-27 via owner staffing requirement, akoya-request Atlas, and reviewer lifecycle source
---

## Recall Rule

Read this when: displaying reviewer staffing on a proposal, or counting confirmed vs invited reviewers.

Do:
- Treat 3 confirmed reviewers as the goal; render "{n} invited", not "5/5 slots filled".
- Source confirmed-acceptance counts from the lifecycle ledger (`wmkf_appreviewersuggestion`), not from slot population.

Do not:
- Read the 5 `wmkf_potentialreviewer1..5` slots as a target or as confirmations — they're an over-invite buffer for declines.

Ground truth: `akoya_request.wmkf_potentialreviewer1..5` (Connor's slot pattern), `wmkf_appreviewersuggestion` (Wave 2 ledger).

[VERIFIED 2026-07-27 via owner staffing requirement,
`docs/atlas/dataverse-akoya-request.md`, and current reviewer-suggestion
services]: three confirmations is the product goal; five lookup slots are not
proof of acceptance.

**Goal:** 3 confirmed reviewers per proposal. That is the number we need to actually receive reviews from.

**Why 5 slots on `akoya_request`:** `wmkf_potentialreviewer1` through `wmkf_potentialreviewer5` are 5 lookup slots because we typically invite more than 3 — some reviewers decline, so we over-invite to land 3 acceptances. The slots are *invitations*, not confirmations.

**How to apply:**
- Don't render "5/5 slots filled" — implies the proposal is fully staffed when it might be at 0 acceptances. Use "{n} invited" instead.
- The lifecycle ledger (`wmkf_appreviewersuggestion`) is where accept/decline
  state lives. The current Workbench dashboard/Overview already renders its
  accepted count against `reviewers.needed`
  (`lib/services/workbench/dashboard-service.js`, `pages/workbench.js`,
  `shared/components/workbench/OverviewTab.js`); preserve that source.
- Goal-state for "this proposal is good" = 3 acceptances logged in the ledger, not "all 5 slots populated."

The five-slot model and lifecycle ledger still coexist. Treat the slots as
legacy invitation compatibility, not the Workbench acceptance source.
