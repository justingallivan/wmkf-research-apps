---
name: project-reviewer-coi-concern-surfacing
description: "Reviewer-finder COI surfacing (SHIPPED S229, da60679 + live Dataverse prompt reseed): model POTENTIAL_CONCERNS now parsed→rendered as an amber advisory; markInstitutionCOI flags FORMER shared institution via affiliationHistory; COI recomputed after enrichment promotes a new affiliation. Plus scripts/reset-request-reviewers.mjs for from-scratch test resets."
metadata:
  node_type: memory
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-06
---

## Recall Rule
Read when touching reviewer-finder COI handling, the analyze prompt's POTENTIAL_CONCERNS/REASONING fields, institution-COI logic, or when setting up a clean reviewer-search test.

## Why it exists (S229 trigger)
A live card surfaced Taekjip Ha (ex-Johns Hopkins, now Harvard) on a **Johns Hopkins** proposal as a 100%-match contactable suggestion, with the conflict buried in the free-text REASONING field. Two gaps: (1) the code institution-COI check (`markInstitutionCOI`) only compared the candidate's **current** recency-best affiliation → it structurally missed the former-JHU tie; (2) the model's `POTENTIAL_CONCERNS` output was parsed but **dropped at the UI normalize layer**, so the only signal was the model freelancing it into REASONING.

## What shipped (da60679 code + live `wmkf_ai_prompt` reseed)
- **Capture + render**: `parseAnalysisResponse` normalizes no-concern values to null via `isNoConcernText` (anchored whole-value sentinel + contrast-conjunction guard). **Design principle: default to RENDER — hiding a real concern is the costly failure, so when ambiguous, show it.** Both cards (Workbench `ReviewerSearchSection.js` + standalone `pages/reviewer-finder.js`) render a distinct amber "Potential concern (AI-flagged)" note; `pruneCandidateForRoster` persists it.
- **Historical-institution COI**: `collectAffiliationHistory` + `mergeGroup` aggregate the full affiliation history; `markInstitutionCOI` scans it and sets `institutionCOIDetails.historical=true` when matched only in the past. Covers Claude-verified AND Track B candidates. Badge reads "Former shared institution."
- **Post-enrichment recompute**: enrichment can promote an ORCID/Scholar current affiliation over the PubMed-recency one COI was computed against. `enrich-contacts` re-runs `markInstitutionCOI` on the post-enrichment affiliation and flags `coiRecomputed`; both client merges + the save path promote it (gated on `coiRecomputed` so "ran and found none" overrides, "didn't run" keeps the discover value).
- **Prompt** (reseeded live to Dataverse via `seed-reviewer-finder-prompts.js --execute`, verified): REASONING fitness-only (COI forbidden there), COI→POTENTIAL_CONCERNS, fame/seniority de-prioritization. Source in `reviewer-finder.js` + `reviewer-finder-dynamics.js` (byte-parity test).

## Hard-won (don't relearn)
- Reviewed by Codex across 4 passes; the design→impl→post-impl loop caught real defects (notably `isNoConcernText` over/under-matching — final form anchors the sentinel to the whole value so a continuation clause like "No conflicts; they competed for the same grant" renders).
- The analyze prompt is **Dataverse-resolved at runtime** — editing source alone is inert in prod. Reseed (probe the live row first for `/admin` edits) or republish via `/admin`. See [[reviewer-finder-prompt-dataverse-migration]].
- Resolver order is **override → dataverse → code-fallback** — a per-user `reviewer-finder.analyze` override masks a reseed for that user.

## Testing aid: scripts/reset-request-reviewers.mjs (S229, 89b24fb)
Per-request, dry-run-by-default reset so a test request searches from scratch. Clears Postgres `reviewer_find_roster` (the Find-tab cross-run dedup — the actual "from scratch" blocker) + Dataverse `wmkf_appreviewersuggestion` (soft-delete default, `--hard`), reports/optionally clears `akoya_request` invite slots (`--include-slots`, best-effort, unexercised live). NEVER touches `wmkf_potentialreviewers` or `search_cache`; refuses to run without a request id. `.env.local` = prod, so keep scoped. See [[project-reviewer-find-roster]].
