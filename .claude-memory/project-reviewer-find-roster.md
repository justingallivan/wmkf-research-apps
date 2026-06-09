---
name: project-reviewer-find-roster
description: "Workbench Reviewers→Find durable per-request candidate roster + cross-run search dedup (SHIPPED S224). reviewer_find_roster is OPERATIONAL Postgres state (not canonical reviewer identity) — do not drop-carryover it."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-08
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

## Clearing / resetting a request's reviewers — USE THE EXISTING SCRIPT
`scripts/reset-request-reviewers.mjs` (commit `89b24fb`) already does per-request reviewer teardown — **don't hand-roll probes/SQL for this.** Dry-run by default; its dry-run **already prints the roster breakdown** (status counts) so you don't need a separate counting probe.
- Clear the Find-tab roster only (regenerable; also resets cross-run dedup so a re-search re-surfaces those names): `--roster-only`
- Also touch saved Dataverse suggestions (`wmkf_appreviewersuggestion`): default soft-delete (`wmkf_selected=false`, reversible) or `--hard`; skip with `--roster-only`.
- Invite slots `wmkf_potentialreviewer1..5`: only with `--include-slots`.
- Run: `node --import ./scripts/lib/use-extensionless.mjs scripts/reset-request-reviewers.mjs --request <num> --roster-only [--execute]` (the bare `node scripts/reset-request-reviewers.mjs ...` form also works; it just prints a typeless-module warning).
- **SAME-FLAGS RULE (S235 — don't repeat this):** the dry-run and the `--execute` run must use **identical flags** — you ONLY append `--execute`. Dropping/changing a scope flag (e.g. previewing without `--roster-only` then executing with it, or vice-versa) makes the preview show a DIFFERENT scope than what actually runs. The script echoes the active scope on its `Target:` line (e.g. `[roster-only]`) — eyeball it before adding `--execute`. S235: a user previewed without `--roster-only` but the prior real run had omitted it too → the default also **soft-deleted the request's applicant-recommended suggestions** (the part `--roster-only` would have skipped).
- **Soft-delete is reversible but re-ingestion will NOT restore it.** `ensureApplicantRecommended` deliberately "never resurrects a staff removal" (leaves `wmkf_selected` untouched on an existing row — `reviewer-suggestion.js:314`), so a soft-deleted (`wmkf_selected=false`) applicant suggestion is only brought back by an **explicit `wmkf_selected=true` PATCH** on those rows (`DynamicsService.updateRecord('wmkf_appreviewersuggestions', id, { wmkf_selected: true })`), filtered to the request + `wmkf_applicantdisposition=100000000`. No app button does this. Dry-run such a fix first; it touches PROD Dataverse.
- **"non-applicant-suggested" mapping:** roster rows carry a provenance kind; applicant suggestions live in Dataverse with `wmkf_sources="applicant"`. The dry-run doesn't show provenance — if the task is "clear non-applicant-suggested," do ONE small query to confirm the split (roster=`literature_retrieved`, Dataverse=`applicant`) before executing. S234: all 9 roster rows were `literature_retrieved`, so a `--roster-only` wipe == clearing the non-applicant set.

## Follow-ups (deferred, optional)
TTL cleanup cron for closed-request rows; split the "filtered out" counter (applicant-exclusion vs dedup); durable "previously surfaced" view; standalone `reviewer-finder.js` parity. See [[project-reviewer-apps-redesign-direction]].
