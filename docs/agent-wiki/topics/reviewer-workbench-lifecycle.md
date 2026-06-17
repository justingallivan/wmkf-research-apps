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
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/export-candidates.js
  - lib/services/reviewer-candidate-export.js
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
  - pages/api/workbench/applicant-reviewers.js
  - pages/api/workbench/promote-applicant-reviewer.js
  - pages/api/workbench/export-candidates.js
  - lib/services/reviewer-candidate-export.js
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

## Applicant-Suggested Reviewer Flow (S263/S264)

Applicant-suggested reviewers (`disposition=recommended` junction rows from `wmkf_potentialreviewer1..5`) are integrated into the main candidate list on the Find tab rather than shown in a separate bottom card. As of S264, ingestion creates these rows with `wmkf_selected=false`; the candidate pool is the PD-selected set, and applicant-suggested rows enter it only when a Program Director explicitly promotes the existing junction row.

**Auto-enrichment:** `ReviewerSearchSection` fires `POST /api/workbench/enrich-recommended` automatically via `useEffect` as soon as both `blobUrl` (proposal loaded) and `recommended` slots (ingestion done) are ready. No manual button click. The effect gates on `recPhase === 'idle'` and `recRunningRef.current === false`, firing once per request/proposal pair and re-firing if the PD navigates to a new request (main reset effect sets `recPhase` back to `'idle'`). The enrichment route reads by `wmkf_applicantdisposition=Recommended`, not by `wmkf_selected`, so unpromoted applicant rows are still verified and surfaced for review.

**Unified candidate list:** Enriched applicant candidates (`recCandidates`) are prepended into `displayCandidates` so fresh enrichment wins over stale roster copies. Candidates with a resolved identity surface in the `applicant_suggested` provenance section — which appears after `cited_or_proposal_named` and `literature_retrieved` in that order — via `provenanceGroupOf` detecting `isApplicantRecommended: true` → `APPLICANT_SUGGESTED` kind. **Exception:** candidates where enrichment could not confirm identity (`needsIdentification: true`, typically when the applicant provided no affiliation) route to `needs_identity_review` instead — `provenanceGroupOf` checks `needsIdentification` before `APPLICANT_SUGGESTED` (reviewer-provenance.js:228 vs :231). The `applicant_suggested` section is selectable unless normal safety gates make a row read-only; selecting it calls `POST /api/workbench/promote-applicant-reviewer` with the existing `suggestionId` instead of `save-candidates`.

**Explicit promotion:** `/api/workbench/promote-applicant-reviewer` validates `requestId` and `suggestionId` as GUIDs, reads the existing suggestion, checks ownership (`_wmkf_request_value`) and `wmkf_applicantdisposition=Recommended`, then flips `wmkf_selected=true` via `updateLifecycle`. This avoids duplicate person upserts and bypasses the normal `save-candidates` COI path that intentionally excludes applicant-origin rows.

**Status card:** The bottom card below the search is a status/progress/error surface only — no candidate list, no manual verify button. It shows ingestion state, enrichment progress while running, a done summary ("N verified — see Applicant-suggested section above"), or an error with a "Try again" button.

**Publication count for applicant rows (S264):** Applicant-recommended reviewers skip PubMed/preprint discovery, so they carry no publications list and used to show a FALSE "0 publications" beside a real h-index. `enrich-recommended.js` now backfills `publicationCount5yr` from the OpenAlex author it already resolves for the metrics — `OpenAlexService.getWorksByAuthor(openAlexId, { yearFrom: year - DiscoveryService.YEARS_LOOKBACK, limit: 1 }).totalCount` (count-only query; same window as `DiscoveryService.countRecentPublications`). Gated on `blockScholar` like the other metrics (no count for an unconfirmed/wrong-person match); best-effort (a failure leaves it null). One extra OpenAlex call per applicant reviewer.

**Export to Excel (S264):** A bottom-row "Export to Excel (N)" button (next to Save) exports the **selected** candidates via `POST /api/workbench/export-candidates`. The client sends a slim per-row DTO (same fields the card resolves — email/orcid/scholar fall back to `contactEnrichment`); the route fetches request metadata (number/institution/PI) authoritatively by `requestId` and streams back a two-sheet `.xlsx` (Request Info + Candidates). Column formatting (Source/Why/Conflicts/ORCID/Scholar) lives in `lib/services/reviewer-candidate-export.js` so the sheet and the cards agree. `needs_identity_review` rows aren't selectable, so they're naturally excluded. The "reviewer diversity"/temperature slider was removed the same cycle (search runs at the server default 0.3).

**Re-verify removed intentionally:** The "Re-verify" button was dropped because enrichment output is static within a cycle (COI computed against a fixed proposal author list; PubMed/Scholar data stable over weeks). The only valid re-run use case is error recovery ("Try again"). Do not restore a general re-verify — if a re-resolve-after-edit pattern is ever needed, see the Future Work section in `reviewer-identity.md`.

## Recurring Hazards

- Roster reload must preserve fields that keep deferred/unresolved/conflicted rows non-selectable.
- Cross-run dedup is durable; do not casually drop carryover.
- Reviewer removal/reset behavior often spans UI state, roster store, and Dataverse suggestion state.
- Applicant-suggested rows are persisted as `disposition=recommended` but are **not** in the candidate pool until `wmkf_selected=true`; keep the promotion route as the only UI save path for these rows.
- The auto-enrichment effect re-fires whenever `blobUrl` or `recommended` changes while `recPhase === 'idle'`. A proposal re-pick resets `blobUrl`, which triggers the main reset effect (clearing `recPhase` to `'idle'`), which then re-triggers enrichment. This is intentional — but be careful if adding new blobUrl-dependent effects that they don't double-invoke enrichment.

## Standard Probe

```bash
rg -n "pruneCandidateForRoster|saveCandidates|my-candidates|referral|referred|excluded|reset-request-reviewers|enrichRecommended|recPhase|applicant_suggested" pages shared lib scripts tests docs
```
