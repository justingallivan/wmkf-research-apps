---
name: Reviewer count — 3 confirmed needed, 5 invitation slots
description: We need 3 confirmed reviewers per proposal; the 5 wmkf_potentialreviewer1..5 lookup slots are an over-invite buffer for declines, not a target
type: project
originSessionId: 8d412c2f-d6c6-4080-a43c-79e0e04e9653
---
**Goal:** 3 confirmed reviewers per proposal. That is the number we need to actually receive reviews from.

**Why 5 slots on `akoya_request`:** `wmkf_potentialreviewer1` through `wmkf_potentialreviewer5` are 5 lookup slots because we typically invite more than 3 — some reviewers decline, so we over-invite to land 3 acceptances. The slots are *invitations*, not confirmations.

**How to apply:**
- Don't render "5/5 slots filled" — implies the proposal is fully staffed when it might be at 0 acceptances. Use "{n} invited" instead.
- The Wave 2 lifecycle ledger (`wmkf_appreviewersuggestion`) is where accept/decline state actually lives — eventually the UI should pull confirmed-acceptances count from there, not infer from slot population.
- Goal-state for "this proposal is good" = 3 acceptances logged in the ledger, not "all 5 slots populated."

**Future tweak:** the 5-slot model on `akoya_request` may itself become legacy as the lifecycle ledger takes over. For now both coexist — the slots are Connor's pre-existing pattern, the ledger is our Wave 2 addition.
