---
agent_wiki: topic
status: active
last_verified: 2026-06-16
stale_after_days: 90
owner: reviewers
source_files:
  - shared/components/reviewers/ReviewersTab.js
  - shared/components/reviewers/ReviewerFindPanel.js
  - shared/components/reviewers/ReviewerSearchSection.js
  - shared/components/reviewers/ReviewerManagePanel.js
  - shared/components/reviewers/reviewer-search-logic.js
  - pages/api/reviewer-finder/my-candidates.js
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/workbench/enrich-recommended.js
  - lib/services/reviewer-roster-store.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
watch_paths:
  - shared/components/reviewers/**
  - pages/api/reviewer-finder/**
  - pages/api/review-manager/**
  - pages/api/workbench/enrich-recommended.js
  - lib/services/reviewer-roster-store.js
update_triggers:
  - reviewer workbench UX or lifecycle changes
  - roster persistence / reload behavior changes
  - referral or address collection behavior changes
  - applicant-suggested enrichment trigger or display behavior changes
---

# Reviewer Workbench & Lifecycle

Use this page for reviewer UI/workbench flows, durable roster behavior,
cross-run deduplication, referral capture, address collection, lifecycle state,
and staff-facing reviewer management.

## Durable Memory

- Workbench and invite workflow: `project-reviewer-apps-redesign-direction`, `project-reviewer-workbench-invite-workflow`.
- Lifecycle and automation: `project-reviewer-lifecycle`, `project-reviewer-lifecycle-automation`.
- Address collection: `project-reviewer-address-collection-provisional`.
- Referral capture: `project-reviewer-referral-capture`.
- Find roster and dedup: `project-reviewer-find-roster`.
- Data model/migration: `project-reviewer-postgres-to-dataverse-migration`, `project-reviewer-finder-dataverse-entry-path`, `project-appresearcher-collapse-post-pilot`.
- Count/history/excluded invariants: `project-reviewer-count-invariant`, `project-reviewer-history-data-quality`, `project-excluded-reviewers-often-in-pool`.

## Applicant-Suggested Reviewer Flow (S263)

Applicant-suggested reviewers (`disposition=recommended` junction rows from `wmkf_potentialreviewer1..5`) are integrated into the main candidate list on the Find tab rather than shown in a separate bottom card.

**Auto-enrichment:** `ReviewerSearchSection` fires `POST /api/workbench/enrich-recommended` automatically via `useEffect` as soon as both `blobUrl` (proposal loaded) and `recommended` slots (ingestion done) are ready. No manual button click. The effect gates on `recPhase === 'idle'` and `recRunningRef.current === false`, firing once per request/proposal pair and re-firing if the PD navigates to a new request (main reset effect sets `recPhase` back to `'idle'`).

**Unified candidate list:** Enriched applicant candidates (`recCandidates`) are prepended into `displayCandidates` so fresh enrichment wins over stale roster copies. Candidates with a resolved identity surface in the `applicant_suggested` provenance section — which appears after `cited_or_proposal_named` and `literature_retrieved` in that order — via `provenanceGroupOf` detecting `isApplicantRecommended: true` → `APPLICANT_SUGGESTED` kind. **Exception:** candidates where enrichment could not confirm identity (`needsIdentification: true`, typically when the applicant provided no affiliation) route to `needs_identity_review` instead — `provenanceGroupOf` checks `needsIdentification` before `APPLICANT_SUGGESTED` (reviewer-provenance.js:228 vs :231). The `applicant_suggested` section is **read-only** (no checkbox): applicant candidates are already persisted as `disposition=recommended` junction rows; PDs invite them from the Invite tab.

**Status card:** The bottom card below the search is a status/progress/error surface only — no candidate list, no manual verify button. It shows ingestion state, enrichment progress while running, a done summary ("N verified — see Applicant-suggested section above"), or an error with a "Try again" button.

**Re-verify removed intentionally:** The "Re-verify" button was dropped because enrichment output is static within a cycle (COI computed against a fixed proposal author list; PubMed/Scholar data stable over weeks). The only valid re-run use case is error recovery ("Try again"). Do not restore a general re-verify — if a re-resolve-after-edit pattern is ever needed, see the Future Work section in `reviewer-identity.md`.

## Recurring Hazards

- Roster reload must preserve fields that keep deferred/unresolved/conflicted rows non-selectable.
- Cross-run dedup is durable; do not casually drop carryover.
- Reviewer removal/reset behavior often spans UI state, roster store, and Dataverse suggestion state.
- Applicant-suggested section is **read-only by design** — do not add checkboxes without understanding that these rows are already persisted in Dataverse as `disposition=recommended`, not candidates awaiting save.
- The auto-enrichment effect re-fires whenever `blobUrl` or `recommended` changes while `recPhase === 'idle'`. A proposal re-pick resets `blobUrl`, which triggers the main reset effect (clearing `recPhase` to `'idle'`), which then re-triggers enrichment. This is intentional — but be careful if adding new blobUrl-dependent effects that they don't double-invoke enrichment.

## Standard Probe

```bash
rg -n "pruneCandidateForRoster|saveCandidates|my-candidates|referral|referred|excluded|reset-request-reviewers|enrichRecommended|recPhase|applicant_suggested" pages shared lib scripts tests docs
```
