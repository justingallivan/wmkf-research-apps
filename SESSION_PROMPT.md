# Session 211 Prompt: Workbench Phase 3 prod-smoke + pilot enablement

## ⏰ Standing context / guardrails (carried from S197–S210)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory — in S210 it caught a tab-count error ("8 placeholders" → verified from source = **9**; 10 tabs, Reviewers live). Authoritative lint counts = `npx eslint . -f json` keyed on `ruleId`/`severity`, NOT grep over the default formatter.
- **Codex stop-time review gate is ENABLED and it WORKS.** In S210 it blocked four times and each catch was real (false-empty-state, staff-removal resurrection, 412 conflict-guard, diacritic exclude-miss, stale placeholder docs). Reconcile every restatement in the same turn; verify-as-you-go.
- **Deliver Codex output VERBATIM** ([[feedback-share-codex-verbatim]]) — paste the whole `codex:codex-rescue` tool result in a delimited block as the *next* message; fold fixes a turn later. S210 recurred (I gave a "verbatim summary" = a contradiction). Do not repeat.
- **rtk grep filter STILL corrupts output** — in S210 a plain `rg` rendered "standalone Reviewer Finder" as "n". For "does X exist" use `git grep` / Read; never trust a bare `rg`/`grep`. rtk is an explicit CLI, plain `git grep`/`Grep`/`Read` are unaffected.
- **Push deploys to prod.** `main` auto-deploys on Vercel. All S210 work is pushed (`81f4010`).
- **CI-green ≠ correct for async/effect/UI code.** Manual smoke is mandatory for load-bearing UI ([[feedback-profile-context-runtime-bugs]]). The in-panel search hits live Claude/PubMed/Dataverse and **was NOT browser-smoked** — that's the #1 next step.
- **Local-dev auth bypass:** `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Under bypass `/api/app-access` returns all apps + `isSuperuser:true`. The Workbench's per-request paths (`applicant-reviewers?requestId=`, `resolve-request?requestId=`, `load-proposal`, `analyze`/`discover`/`enrich`/`save-candidates`) are email-independent and work under bypass; the PD-email dashboard (`/api/workbench/dashboard`) hard-fails. Smoke the Find tab via `/workbench/<guid>?tab=reviewers&sub=find`.
- **`npm run` glitches the Bash tool intermittently** — call binaries directly (`./node_modules/.bin/next build`, `npx jest`) when `npm run X` errors with an `H.replace`-type message.

## Session 210 Summary

**Built Workbench Phase 3 — the long pole — end to end: applicant-reviewer ingestion + the full in-panel reviewer search, completing the Find tab. 10 commits, all pushed, tree clean, 1689 tests green, all gates green. Four Codex stop-gate rounds + one post-impl review, all folded. Decision locked with Justin: option B (excluded = soft-block only).**

### What was completed
1. **Applicant-reviewer ingestion (`79a2840`, hardened `e0b7190`/`f393d74`).** `pages/api/workbench/applicant-reviewers.js` (GET `?requestId=`): idempotently materializes the 5 legacy `wmkf_potentialreviewer1..5` slots into `disposition=recommended` candidate rows (race-safe `ensureApplicantRecommended` — converges a lost alternate-key 412 to an update; **never resurrects a staff `softDelete`**; "excluded wins"); parses free-text `wmkf_excludedreviewers` via a hardened (A7-wrapped) Claude extraction (`lib/services/reviewer-exclusion-parser.js`) into names for the **soft-block only** — NO structured excluded rows ([[project-excluded-reviewers-often-in-pool]]).
2. **Proposal auto-pick fix (`bec416c`).** `classifyFile` was picking "Application Cover Page.docx" (broad `application` signal). Added a front-matter exclusion + recognized `ProjectDescription.pdf` (solid-cased) as a narrative signal, in **both** picker copies + the shared classifier (fixes Grant Reporting too); added a **manual file-picker override** to the Find panel. +26 classifyFile tests (none existed).
3. **In-panel reviewer search (`e946401`, diacritic fix `4628ec3`).** `shared/components/reviewers/ReviewerSearchSection.js` replaces the standalone-handoff: reuses the loaded proposal `blobUrl` + applicant excludes and chains `analyze → discover → enrich-contacts → save-candidates(requestId)` over a shared SSE reader (`sse.js`), saving into this request's pool. Pure logic in `reviewer-search-logic.js` (`mergeEnrichment`, `filterExcluded` with **NFD diacritic folding**, `asPercent`). **Codex post-impl review (12 findings) folded:** excluded names hard-filtered from `/discover` results (the soft-block isn't honored server-side); `event: error` SSE frames detected; editable exclude box; reset-on-context-change + generation guard; `savedCount===0` = failure; run/save double-submit refs.
4. **Doc reconciliation sweep (2 rounds, `8808e53`+`81f4010`).** Every "Find placeholder / standalone handoff / deferred NewSearchTab" restatement corrected across CLAUDE.md, the two component headers, the build plan (§Phase 3 SHIPPED + Deferred list + verification), `[requestId].js`, and a probe memory. Tab count corrected to 9 (verified from source).

### Commits
- `79a2840` ingestion + Find panel (option B) · `e0b7190` no-resurrect-staff-removal · `f393d74` 412 conflict-guard + doc · `bec416c` proposal auto-pick + manual picker · `9d2db30` honest handoff copy · `e946401` in-panel search · `4628ec3` NFD diacritic exclude-fold · `213238f` memory (Codex-verbatim recurrence) · `8808e53` doc reconcile · `81f4010` doc reconcile round 2

## Potential Next Steps

### 1. ⭐ Browser-smoke the Workbench Find tab in prod (the parked must-do)
On the deployed site, open `/workbench/<D26-guid>?tab=reviewers&sub=find` (e.g. request **1002794**) with a real Azure session and verify the full path: applicant recommendations badged + saved as candidates; `ProjectDescription.pdf` auto-loads (manual picker corrects a wrong pick); **Run reviewer search** → candidates stream in → excluded names filtered → select + Save reports "Saved N" → invited accepters show in the Invite tab. CI-green ≠ correct for this (live Claude/PubMed/Dataverse). Capture console errors if anything misbehaves.

### 2. Grant `reviewers` to the pilot PDs + validate the dashboard tier
Adding the registry key grants no one. Grant `reviewers` via `/admin` → App Access to the 4 pilot PDs, then validate `/workbench` shows the 35 D26 rows + My/All with a real login (the dashboard is PD-email-gated; never smoked in prod).

### 3. Find-mod 6 cleanup (small, optional)
The Workbench no longer passes `summaryPages`, but shared `analyze.js` still references `summaryPages`/`summaryBlobUrl`/`extractPages`. Per the build plan's Deferred list, the analyze-side strip is still pending (keep `maintenance-service.js` L317's historical blob-cleanup read). Low priority.

### 4. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session. Separate track from the Workbench.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | Build plan — §Phase 3 now marked SHIPPED. Reviewers tab is the only live tier-3 tab; 9 placeholders remain. |
| `pages/api/workbench/applicant-reviewers.js` | Ingestion endpoint (recommended → rows; excluded → soft-block names). |
| `lib/services/reviewer-exclusion-parser.js` | Hardened Claude extraction of excluded names (noise-gated). |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `ensureApplicantRecommended` (race-safe, no-resurrect) + the disposition machinery. |
| `shared/components/reviewers/ReviewerFindPanel.js` | Find tab: ingestion display + auto-load proposal + manual picker + search section. |
| `shared/components/reviewers/ReviewerSearchSection.js` | In-panel search (analyze→discover→enrich→save). |
| `shared/components/reviewers/{sse,reviewer-search-logic}.js` | SSE reader + pure search logic (unit-tested). |
| `pages/api/grant-reporting/lookup-grant.js` | Shared `classifyFile` + `pickProposalBestGuess` (proposal auto-pick). |

## Testing
```bash
npx jest                                 # 1689 tests
npx eslint . -f json                     # authoritative lint count (0 errors; warnings don't gate)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:doc-currency && npm run check:fact-consistency
./node_modules/.bin/next build           # confirms routes compile
# Workbench Find smoke (local bypass): /workbench/<guid>?tab=reviewers&sub=find — per-request path is email-independent.
```
