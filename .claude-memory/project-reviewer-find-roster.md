---
name: project-reviewer-find-roster
description: "Workbench Reviewers→Find durable per-request candidate roster + cross-run search dedup (SHIPPED S224). reviewer_find_roster is OPERATIONAL Postgres state (not canonical reviewer identity) — do not drop-carryover it."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-05
---

## Recall Rule
Read when touching the Workbench Find tab, reviewer-search dedup/exclusion, or anything that reads/writes `reviewer_find_roster`. Also read before any "drop a reviewer Postgres table" carryover — this one is LIVE.

## What shipped (S224, `dee37aa`, deployed)
Find-tab search candidates are no longer ephemeral. Every candidate a search surfaces for a request is recorded per-request and **suppressed from future searches for that request** — so a re-run finds NEW people instead of re-spending tokens. Surfaced candidates form a **durable roster**: an active selectable list (persists across reload) + a collapsed, recoverable **Excluded** section. **Exclude** sets aside (never deletes); **Promote back** restores to the active list. Saving stays the existing separate step (graduates to `status='saved'`, leaves the active list, stays deduped).

## Load-bearing design facts (don't relearn the hard way)
- **`reviewer_find_roster` is OPERATIONAL / pre-save / per-request working state, NOT canonical reviewer identity.** Same class as the retained `search_cache`. Canonical saved reviewers stay in Dataverse `wmkf_appreviewersuggestion`. So adding this Postgres table is NOT a regression of the S219/migration-018 Postgres→Dataverse cutover. **Do not act on a "drop reviewer Postgres tables" carryover against it** (see [[feedback-verify-before-destructive-carryover]]).
- **Why Postgres not Dataverse:** search candidates are name-based and often email-less at surface time; the canonical pool is email-keyed (`upsertByEmail`), so they can't cleanly become Dataverse rows — and shouldn't (it'd pollute the vetted pool). Name-keyed, `unique(request_id, normalized_name)` = the dedup key.
- **The dedup is server-side in `/discover`** (before `generateDiscoveredReasoning`) — that's what actually saves tokens; client `filterExcluded` is defense-in-depth only. Exact-match (`partitionByExcluded`) is a SEPARATE pass from the fuzzy `filterProposalAuthors` — never merge them.
- **Status model:** `active|excluded|saved`. `recordSurfaced` never downgrades excluded/saved → active (`ON CONFLICT ... WHERE status='active'`). PATCH handlers are eviction-tolerant (per-request cap=300 evicts oldest non-excluded; upsert/no-op so an evicted row's card action can't 404).
- **Identity-guard hazard (Codex post-impl HIGH):** `pruneCandidateForRoster` drops `contactEnrichment.identity`/`tierResults` but carries safe `identityPersistAllowed`/`scholarPersistAllowed` flags so a roster-RELOADED save still honors the resolver gate in `save-candidates.js`. If you change the prune DTO or the save gate, keep those flags wired.

## Files
Store `lib/services/reviewer-roster-store.js`; route `pages/api/workbench/reviewer-roster.js`; shared name-match `lib/utils/reviewer-name-match.js` (CJS, server+client); `pruneCandidateForRoster` in `shared/components/reviewers/reviewer-search-logic.js`; UI `ReviewerSearchSection.js` (displayCandidates refactor, selection keyed by normalized name). Atlas `docs/atlas/postgres-reviewer-find-roster.md`. Plan `~/.claude/plans/cosmic-yawning-starlight.md`.

## Follow-ups (deferred, optional)
TTL cleanup cron for closed-request rows; split the "filtered out" counter (applicant-exclusion vs dedup); durable "previously surfaced" view; standalone `reviewer-finder.js` parity. See [[project-reviewer-apps-redesign-direction]].
