---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
source_files:
  - docs/agent-wiki/topics/reviewer-find-applicant-flow.md
  - docs/agent-wiki/topics/reviewer-address-referrals.md
  - docs/agent-wiki/topics/reviewer-engagement-closeout.md
  - docs/agent-wiki/topics/reviewer-invitation-email.md
  - docs/agent-wiki/topics/reviewer-activity-history.md
  - docs/agent-wiki/topics/reviewer-institution-display.md
  - docs/agent-wiki/topics/submitted-reviews-and-documents.md
  - docs/agent-wiki/topics/review-synthesis.md
  - docs/agent-wiki/topics/workbench-shell-handoffs.md
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - docs/agent-wiki/topics/reviewer-find-applicant-flow.md
  - docs/agent-wiki/topics/reviewer-address-referrals.md
  - docs/agent-wiki/topics/reviewer-engagement-closeout.md
  - docs/agent-wiki/topics/reviewer-invitation-email.md
  - docs/agent-wiki/topics/reviewer-activity-history.md
  - docs/agent-wiki/topics/reviewer-institution-display.md
  - docs/agent-wiki/topics/submitted-reviews-and-documents.md
  - docs/agent-wiki/topics/review-synthesis.md
  - docs/agent-wiki/topics/workbench-shell-handoffs.md
update_triggers:
  - reviewer workbench capability pages or routing change
  - reviewer lifecycle or workbench behavior changes
---

# Reviewer Workbench & Lifecycle

> **Scoped source recheck (2026-10-22):** the due-date editor request/context
> lifetime note in [Invitation and Email Delivery](./reviewer-invitation-email.md)
> was checked against the current repository source. This is source-only; deployment
> and live state are unknown. Other lifecycle claims retain their cited evidence
> dates. No whole-page semantic recertification or live probe was run.

Use this page for reviewer UI/workbench flows, durable roster behavior,
cross-run deduplication, referral capture, address collection, lifecycle state,
and staff-facing reviewer management.


## Routing

This page is the lifecycle index. The capability extracts preserve source wording and its dated evidence; follow their source and canonical-document pointers before treating a claim as current. The inherited `last_verified` date is not a new semantic verification.

## Reviewer Find warm-reconciliation incident — RESOLVED BY REVERT (2026-08-03, S396)


See [reviewer find applicant flow](./reviewer-find-applicant-flow.md), [reviewer engagement closeout](./reviewer-engagement-closeout.md).

## Find → Invite promotion contract (production-live)


See [reviewer find applicant flow](./reviewer-find-applicant-flow.md).

## Reviewer → CRM contact promotion (production-live 2026-07-31)


See [reviewer engagement closeout](./reviewer-engagement-closeout.md).

## Candidate removal, decline archival, and restore (Invite Reviewers)


See [reviewer engagement closeout](./reviewer-engagement-closeout.md).

## Decline-referral surface + one-click add (S349)


See [reviewer address referrals](./reviewer-address-referrals.md).

## Reviewer activity history — Phase 1 (PRODUCTION-LIVE, S419, PR #120)


See [reviewer activity history](./reviewer-activity-history.md).

## Invitation timeline validation (S422, production-live `4dd4a31d`)


See [reviewer invitation email](./reviewer-invitation-email.md).

<!-- source-lines: 796-807 -->
## Materials on acceptance and the shared release row (PR #562 branch, NOT merged)

Automatic release on acceptance and the manual Release Materials send both claim one `reviewer_materials_releases` row per engagement before minting the reviewer link ([Atlas](../../atlas/postgres-reviewer-materials-releases.md); plan `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md` §3.3 build notes). Staff recovery lives in the Release Materials send result: "Send again" for a stopped or abandoned release, "Mark as delivered" (`/api/review-manager/materials-release-delivered`) for a sent but unrecorded one. A `failed` release is retaken by any normal send; the acceptance drain retries bookkeeping for `sent` rows. Treat all of this as branch-only until #562 merges and migration 091 is applied.

## Durable Memory

- Workbench and invite workflow: `project-reviewer-apps-redesign-direction`, `project-reviewer-workbench-invite-workflow`.
- Lifecycle and automation: `project-reviewer-lifecycle`, `project-reviewer-lifecycle-automation`.
- Address collection: `project-reviewer-address-collection-provisional`.
- Referral capture: `project-reviewer-referral-capture`.
- Find roster and dedup: `project-reviewer-find-roster`.
- Data model/migration: `project-reviewer-finder-dataverse-entry-path`, `project-appresearcher-collapse-post-pilot`. Historical S136 migration rationale is in closed memory `project-reviewer-postgres-to-dataverse-migration`.
- Count/history/excluded invariants: `project-reviewer-count-invariant`, `project-reviewer-history-data-quality`, `project-excluded-reviewers-often-in-pool`.
- Closeout, reliability, transient states, local invite testing (routed here from the memory router 2026-09-17): `project-reviewer-closeout-payability`, `project-reviewer-reliability-data`, `project-accepted-awaiting-materials-is-transient`, `reviewer-invite-capture-mode-not-full-sandbox`, `project-workbench-consolidation-rollout`.
- Candidate-card simplification and affordance consistency (routed here from the memory router 2026-10-05): `project-reviewer-card-simplification-direction`, `feedback-affordance-consistency-beats-deduplication`. The closed lifecycle-autonomy directive (D0–D5 orchestration cycle) is indexed in `project-closed-work-archive`.

<!-- end-source-lines: 796-807 -->

## Applicant-Suggested Reviewer Flow (S263/S264)


See [reviewer find applicant flow](./reviewer-find-applicant-flow.md).

<!-- source-lines: 1351-1354 -->
## Review Panel tab (S511, gated slot between Reviews and Staff Deliberations)

`shared/components/workbench/ReviewPanelTab.js`; TABS entry `{ key: 'review-panel', gate: 'review-panel' }` in `pages/workbench/[requestId].js`. `visibleTabsFor(hasAccess)` hides any gated tab unless `hasAccess(gate) === true` (fail-closed while access loads; a deep link falls back to Overview). Detail, hazards, and the server contract live in [Review Panel](review-panel.md).

<!-- end-source-lines: 1351-1354 -->

## Reviews tab (workbench consumption of submitted reviews)


See [submitted reviews and documents](./submitted-reviews-and-documents.md), [review synthesis](./review-synthesis.md).

## Email templates (admin org default + per-PD override)


See [reviewer invitation email](./reviewer-invitation-email.md).

## Final Writeup lifecycle (Slices 1–4)


See [workbench shell handoffs](./workbench-shell-handoffs.md).

## Operating Notes


See [Find and Applicant Reviewer Flow](./reviewer-find-applicant-flow.md), [Address Evidence and Referrals](./reviewer-address-referrals.md), [Engagement and Closeout](./reviewer-engagement-closeout.md), [Invitation and Email Delivery](./reviewer-invitation-email.md), [Activity History](./reviewer-activity-history.md), [Institution Display](./reviewer-institution-display.md), [Submitted Reviews and Documents](./submitted-reviews-and-documents.md), [Review Synthesis](./review-synthesis.md), [Workbench Shell and Handoffs](./workbench-shell-handoffs.md).

<!-- source-lines: 2256-2260 -->
## Standard Probe

```bash
rg -n "pruneCandidateForRoster|saveCandidates|my-candidates|referral|referred|excluded|reset-request-reviewers|enrichRecommended|recPhase|applicant_suggested" pages shared lib scripts tests docs
```
<!-- end-source-lines: 2256-2260 -->
