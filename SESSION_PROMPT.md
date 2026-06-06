# Session 230 Prompt: Validate the live reviewer-finder COI/concern + prompt changes — then pick up open threads

## Session 229 Summary

Started as live monitoring of the S227 web-suggestions feature and turned into a full reviewer-finder quality pass. Two prod bugs fixed, one multi-part COI feature shipped end-to-end (code + live Dataverse prompt), and a reusable test-reset utility built. Startup gates were all green; repo synced.

### What Was Completed

1. **Web-suggestions monitoring + funnel log** (`73260ff`)
   - Added a counts-only `[WebDiscoveryService] funnel` log on the success paths (queriesRun / fromCache / rawResults / webLeads) so the recall funnel is observable in Vercel logs without persisting the display-only `webLeads`.

2. **Web-suggestions was broken in prod — FIXED** (`c1dce55`)
   - First live search showed "Web search was unavailable." Diagnosed from prod logs (`vercel logs --json`): the Perplexity search succeeded but the Claude **extraction 404'd on `model: sonnet`** — the route never called `loadModelOverrides()`, so `getModelForApp('reviewer-finder')` returned the unresolved tier key. **The feature had never worked since it shipped S227** (the S227 "live contract verified" was the direct-Perplexity probe; all unit tests mock the LLM). Fix: `await loadModelOverrides()` before `WebDiscoveryService.search`, matching the four other reviewer-finder LLM routes (analyze/discover/enrich-contacts/generate-emails) + a regression test.

3. **Reviewer COI/concern surfacing + historical-institution COI** (`da60679`)
   - Triggered by a live card: a reviewer (Taekjip Ha — ex-Johns Hopkins, now Harvard) surfaced on a **Johns Hopkins** proposal with the conflict buried in the free-text REASONING field and no structured flag. Root causes: the code institution-COI check only compared **current** affiliation (missed the former-JHU tie), and the model's `POTENTIAL_CONCERNS` output was parsed but dropped before render.
   - Three parts: (a) **capture + render** — `parseAnalysisResponse` normalizes no-concern values to null via `isNoConcernText` (anchored whole-value sentinel + contrast-conjunction guard; default is render — never hide a real concern); both Workbench + standalone cards render an amber advisory note; roster prune persists it. (b) **historical-institution COI** — `collectAffiliationHistory` + `mergeGroup` aggregate the full affiliation history; `markInstitutionCOI` scans it and flags `institutionCOIDetails.historical`; covers Claude-verified AND Track B candidates; badge reads "Former shared institution." (c) **post-enrichment COI recompute** — `enrich-contacts` re-evaluates COI on the ORCID/Scholar-promoted affiliation (`coiRecomputed` marker), promoted by both client merges + the save path.
   - **Reviewed by Codex across 4 passes; all findings resolved.** 390 tests, A7 + parity gates green.

4. **Applied the analyze prompt change to the LIVE Dataverse row** (no git artifact — Dataverse data)
   - The prompt source edits (REASONING fitness-only, COI→POTENTIAL_CONCERNS, fame/seniority de-prioritization) shipped in `da60679` but were INERT in prod (prod resolves `wmkf_ai_prompt` from Dataverse, not source). **Probed the live row first** (per the migration memory's clobber warning): live analyze body was byte-identical to the old dynamics body (no `/admin` edits), score-candidates identical → reseed safe. Ran `seed-reviewer-finder-prompts.js --execute`; verified the live `reviewer-finder.analyze` row now == the new 5,586-char body with all three changes present.

5. **`scripts/reset-request-reviewers.mjs` test utility** (`89b24fb`)
   - Per-request, dry-run-by-default cleanup so a test request can search for reviewers from scratch. Clears Postgres `reviewer_find_roster` (Find-tab roster + cross-run dedup) + Dataverse `wmkf_appreviewersuggestion` (soft-delete default, `--hard` opt-in), reports/optionally clears `akoya_request` invite slots. Never touches `wmkf_potentialreviewers` or `search_cache`; refuses to run without a single request id; uses the script-only Dynamics restriction bypass.
   - **Executed a `--hard` reset on test request #1002788** (12 roster rows DELETED, 10 suggestions hard-deleted, slots left). Verified clean — ready for a from-scratch search.

### Commits
- `73260ff` feat: web-discovery funnel log (pushed)
- `c1dce55` fix: warm model overrides in web-suggestions route (pushed)
- `da60679` feat: reviewer COI concerns + former-institution ties (pushed)
- `89b24fb` chore: reset-request-reviewers test utility (was local-only; pushed at /stop)

## Potential Next Steps

### 1. Validate the live prompt + COI feature with a real run (the immediate point)
`#1002788` is already reset to a clean slate. Run a from-scratch reviewer search/analyze there and confirm the model now (a) leans currently-active / mid-career over field founders, and (b) puts conflicts (e.g. a former-shared-institution tie) in **POTENTIAL_CONCERNS** → rendered as the amber advisory, with REASONING staying fitness-only. Prompt wording shapes but does not guarantee model behavior — this needs a real observation.

### 2. Per-user prompt override caveat
Resolver order is **override → dataverse → code-fallback**. If a `reviewer-finder.analyze` per-user override exists (e.g. from testing the `/admin` editor), it overrides the row reseeded this session — so a test as that user won't reflect the change. If validation (#1) doesn't show the new wording, check/clear the override (`wmkf_appuserpreferences` PROMPT_OVERRIDES).

### 3. Web-suggestions monitoring (now that it actually works)
v1 read-only is still the monitoring phase, but it was inert until `c1dce55` this session. Watch the first real searches: are web leads relevant/current (mid-career, not founders)? Funnel log (`[WebDiscoveryService] funnel`) is now in Vercel logs. Quality drives whether deferred-v2 (pipeline integration) is worth doing.

### 4. reset-request-reviewers `--include-slots` is unexercised live
The slot-clearing path ($ref disassociation, nav-property `wmkf_PotentialReviewer{N}`) was NOT run live — watch its output the first time and confirm the nav-property name resolves.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked.** Stage by explicit path (not `-A`) — Justin edits in parallel.
- **`.env.local` points at the same prod Dataverse + Postgres.** Scripts that mutate (reset-request-reviewers, seed-reviewer-finder-prompts) hit prod — keep them scoped + dry-run-first.
- Dataverse-querying scripts need `enterDynamicsBypassForScript(label)` (fail-closed restriction layer); raw-fetch scripts use `DynamicsService.getAccessToken()`.
- `/contract-reconcile` + Codex review before declaring multi-layer work done; the design→impl→post-impl loop holds (it caught real defects this session).

## Key Files Reference

| File | Purpose |
|------|---------|
| `scripts/reset-request-reviewers.mjs` | Per-request reviewer cleanup for from-scratch testing (dry-run default) |
| `scripts/seed-reviewer-finder-prompts.js` | Reseed the `wmkf_ai_prompt` analyze/score rows from `dynamics.js` (probe live row first) |
| `shared/config/prompts/reviewer-finder.js` | `createAnalysisPrompt` + `parseAnalysisResponse` + `isNoConcernText` (no-concern normalization) |
| `shared/config/prompts/reviewer-finder-dynamics.js` | Canonical analyze/score prompt bodies (seed source + code fallback) |
| `lib/services/deduplication-service.js` | `markInstitutionCOI` (current + historical) + `mergeGroup` affiliationHistory |
| `lib/services/discovery-service.js` | `collectAffiliationHistory` + verify-candidate `affiliationHistory` |
| `pages/api/reviewer-finder/enrich-contacts.js` | Post-enrichment COI recompute (`coiRecomputed`) |
| `shared/components/reviewers/ReviewerSearchSection.js` / `pages/reviewer-finder.js` | Concern + historical-COI rendering (Workbench + standalone) |

## Testing

```bash
npx jest reviewer-finder-parse-analysis institution-coi-historical reviewer-search-logic discovery-affiliation-recency reviewer-prompt-composer dedup reviewer-finder-a7   # COI/concern + parity
node scripts/reset-request-reviewers.mjs --request <num|GUID>             # dry-run reviewer reset
node scripts/seed-reviewer-finder-prompts.js --dry-run                    # prompt reseed preview
# full startup gate set: see .claude/skills/start
```
