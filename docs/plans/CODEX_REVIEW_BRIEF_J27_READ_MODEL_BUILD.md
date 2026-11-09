# Codex review brief: J27 read model build (steps C and D), branch `claude/j27-read-model`

Read-only review. Do not edit, commit, or run writes. Worktree `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, commits `5e315bffe`, `256d4341c`, `a7499a3ec` on top of `97f696faf`. Plan: `docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` (revision 5, which you returned READY TO IMPLEMENT). Step F is not built.

## Deviations from the reviewed plan, stated up front

1. **Basis widened to task inputs on live rows** (`j27-read-model.js`, plan C3 edited "as built"). Reason: C8.4 expects every tier 1 key `unavailable` to degrade, but rationale, integrity and calendar are not phase-row inputs; the two plan statements could not both hold. Terminal rows use the phase rows above them only. Consequence: on a deployment with memo waves off (production today) every J27 row is `degraded`.
2. **Roster presence by key status.** `roster` and `rosterMemo` carry presence in `status` (`present` / `absent`); `roster` adds `stale`. No `present` boolean field.
3. **`chairs-outcome-pending` fires literally**, including on a decided row with Phase I Invited and request status Approved; it blocks nothing there (tasks are empty).
4. **Primary task rule clarified** (plan C5 edited): in-phase non-secondary, else any non-secondary, else secondary.
5. **Dashboard counts.** The pure-model test's `tier1()` helper is the page before its rollup; `dashboard()` adds counts. Scenario rows carry both.

## Built
- `lib/services/workbench/j27-read-model.js` (pure), `tests/unit/j27-read-model.test.js` (100 rows).
- `lib/services/workbench/j27-read-model-inputs.js` (server tier 1 assembly), `lib/dataverse/adapters/reviewer-suggestion.js` `existsAnySuggestionForRequests`, `lib/services/workbench/j27-integrity-jobs.js` `readLatestIntegrityStates` + `isFlaggedIntegrityResults`.
- `resolve-request-service.js`, `dashboard-service.js` wiring; `j27` only on in-scope rows.
- Tests: `j27-read-model-inputs`, `reviewer-suggestion-any-suggestion`, `j27-integrity-latest-states`, extensions to `workbench-resolve-request-service`, `workbench-resolve-request-route` (pinned SELECT gained three fields), `workbench-dashboard-service`.

## Decisions to challenge
- Memo column guards: `wmkf_staffvisitassessment` has no helper of its own; it shares `staffReviewSummaryEnabled()` (sandbox-only). Production existence of each memo column is `[ASSUMED]`; the guards carry the risk. Is any column selected on production by this change? (Intended answer: none; `REQUEST_FIELDS` are pre-existing production columns.)
- Postgres enters resolution and the dashboard for the first time; each read is wrapped and a thrown `sql` call yields `unavailable`. Verify the dashboard never 500s on a missing `POSTGRES_URL`.
- Read budget: resolution one Dataverse read + one Postgres read; dashboard one suggestion query + one integrity query + one calendar read per page, in parallel with the rollup. Verify no per-row read.
- `readLatestIntegrityStates`: `DISTINCT ON` winner, `LEFT JOIN` on `screening_id`, target applied after; null target accepts the winner. Check against `integrity-service.js:151-157` and `:554,592`.
- `existsAnySuggestionForRequests` must not change `findForRollup` or any count bucket.
- Page-side recomputation (plan C7 request-page paragraph) is deferred to step E; the DTO carries `input` for it.

## Known pre-existing
- `tests/unit/reviewer-suggestion-rollup.test.js` fails on the base commit (`ROLLUP_SELECT` gained `wmkf_reviewreceivedat` without the pin). Not touched.
- `package-lock.json` drift from `npm install` in this worktree; not committed.

## Output
Findings with `file:line`, verdict READY TO IMPLEMENT / READY WITH NAMED CHANGES / NEEDS REWORK, under the contract-reconcile Mode A format. Name any deviation above you consider wrong.
