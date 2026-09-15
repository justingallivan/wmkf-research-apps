# Session 512 Prompt: Review Panel is a gated Workbench tab in `access` mode; Wednesday ops meeting; VRP owner decisions

> Session 511 ran 2026-09-13 (evening) into 2026-09-14 (morning). Start with `/start`. **Read first:**
> `docs/plans/REVIEW_PANEL_WORKBENCH_TAB_PLAN_2026-09-13.md` (owner decisions T1–T4, build record,
> residual risks). The Review Panel is **live in production as a Request Workbench tab** between
> Reviews and Staff Deliberations, visible only with the admin-panel `review-panel` grant, rollout mode
> `access` (env allowlist ignored). The owner smoked it on 1002874 and the distilled layout (PR #292)
> is deployed.

## Session 511 Summary (Fable; owner present and merging)

### What Was Completed

1. **Red gate fixed at start.** `check:fact-consistency:self-test` had gone red because its "14
   applications" fixture literal became the live app count when the Review Panel app registered; the
   fixture now derives its sentinel from the live count (c1ffda91, direct to main, Tier 0).
2. **Review Panel as a Workbench tab (PR #291, merge 4b22c50c).** Owner decisions 2026-09-13:
   T1 access gate = admin-panel `review-panel` grant (superuser still passes); T2 new fail-closed rollout
   mode `access` replaces the env allowlist; T3 shared per-request visibility, mutations stay
   owner-scoped; T4 standalone `/review-panel` page kept. Server: `assertReviewPanelActor` is now
   Postgres-only (active profile) and stays inside `FOR UPDATE` transactions; new `assertReviewPanelAccess`
   (superuser OR grant via Dataverse `listAppKeysForUser`) at the four service entry points and the
   worker's claim-time / pre-paid-dispatch checks — a grant-lookup failure is a 503 marked `interrupted`
   (worker pauses; never a revocation). `getReviewPanelForRequest` + `GET /api/review-panel?requestId=`
   returns every launcher's runs for one request with `owner.isMine`, `requestCount`, and a
   server-computed `launchable {ok, reason}`; `launchReviewPanel` refuses (409) a second run for a
   request with an unsettled one. UI: shared helpers lifted to
   `shared/components/review-panel/review-panel-ui.js`; `ReviewPanelTab`; gated TABS slot via
   `visibleTabsFor(hasAccess)` (deep link without the grant falls back to Overview). Contract-reconcile
   pass on the plan found the transaction/Dataverse hazard that produced the gate split.
3. **Production cutover.** Owner set `REVIEW_PANEL_ROLLOUT_MODE=access` and redeployed
   (`wmkfresearchapps-47ehh2pmg`); verified via `vercel env pull`. Runbook, Atlas, wiki reconciled.
4. **Distill (PR #292, merge c853c413, production `wmkfresearchapps-52sw34jq0`).** After the owner's
   first screenshot ("crowded; unsure whether failures should stay visible"): impeccable `distill` pass.
   Completed run = one line with Word/PDF as row actions and a run total (withheld as "cost unknown" if
   any seat cost is unknown; `runTotalLabel`); settled failed/stopped runs collapse to one muted line
   (specific seat reason, spend, Retry) — kept for the record, never hidden; configuration behind a
   disclosure; the D6 bound shows beside Launch while launchable; no repeated request number or
   duplicate status pills. Running runs keep the full progress view.
5. **Handoff hygiene:** re-render on 1002852/1002874 recorded done (9c804ab5).

### Commits (main; merges 4b22c50c #291, c853c413 #292)

9c804ab5 handoff · c1ffda91 self-test fixture · a4356519 access mode + gate split · c2e3b545 per-request
read + 409 guard · 1704576d UI lift · 16a3ff52 tab + docs · ee5b5f77 counts · 70b1e138 tab structure ·
d0cf4379 Stop scope + polling · 5d75c371 handoff · dea5bcbd/4d1653b5/c7648d50 docs after cutover ·
fbf5a4d4 distill · c7c69fd8 handoff.

## Next Items

### Verified Open

1. **Wednesday 2026-09-16 ops meeting** — rescheduled after the September 14 meeting did not occur;
   agenda in `.claude-memory/project-ops-meeting-2026-09-16-agenda.md`
   (6 items incl. materials reminder cron and dossier drain-cron cadence). Afterward: record decisions in
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 and `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`, add
   `vercel.json` entries if decided, close the memory. Evidence: memory file status `active`.
2. **Review Panel follow-ups** (evidence: plan §3b, brief §3):
   (a) owner still to grant `review-panel` to pilot users in the admin panel (superusers already see the
   tab); (b) owner eyeball of the distilled tab; (c) brief §3 follow-ups unchanged: worker-stamped retry
   marker, `check-review-panel-rollout.js` preflight clone, prompt editor showing slot models, 5-minute
   model-override cache; (d) residual risks accepted in plan §3b (soft active-run guard, roster reload per
   4 s poll).
3. **Dossier "typical cost from real runs" figure** beside the reservation bound. Evidence: seven
   `api_usage_log` rows (`app_name='cycle-dossier'`); owner asked to decide after seeing actuals.
4. **Site-visit email templates**: merged (PR #279), regrouped; production rehearsal of the four
   templates still not done. Evidence: `shared/config/editableTextDefaults.js`.
5. **Dossier redesign** (unscoped; "get this functioning better and then we can mount a redesign").
6. **Email send feedback and consistency audit** (work queue item 10): unchanged.
7. **Five sibling routes with unescaped `Content-Disposition`**: convert to
   `lib/utils/content-disposition.js` in one pass.
8. Owner production checks still not eyeballed: Share composer preview and agenda "Exact email" preview
   on 1003222; PR #218 cycle view.

### Owner Decision Needed

1. Review Panel: typical-cost figure on the tab/page (D6 currently forbids it; ~$0.60 from four runs),
   Fable seat retest on a non-biology proposal or leave Opus, OpenAI seat id (D10, still `gpt-5.6-sol`),
   `cycle` scope. Pilot widening is DONE via `access` mode (T2). Old upload-based VRP page retirement stays
   deferred (D5).
2. Dossier preview/Blob retention policy (open since S494).
3. Drain-cron cadence and materials reminder cron (ops Wednesday, 2026-09-16). 4. PR #116 (ROR resolver shadow mode):
   keep or close. 5. 45+ unmerged local branches: prune or keep (grep live refs first; this session added
   `feature/review-panel-workbench-tab` and `feature/review-panel-tab-distill`, both merged).
6. Carried: reissue during Dynamics Pending Send; Program select on Final writeups/Awardees; PD
   front-end flip. 7. The other four `CYCLE_DOSSIER_*` flags are still hidden secrets.

### Parked

1. Connor items (J27 Q5, back-end status changes, slice G). 2. Request Quick Find metadata repair.
3. Legacy Complete row with null eligibility. 4. `NEXTAUTH_SECRET` rotation; multipart direct-upload
conversion; Stage III institution identity authority. 5. Playwright coverage for external briefing and
materials pages. 6. Proposal order P3s. 7. Messages & policies P3s. 8. Slots-only reload after reorder.
9. Card-vs-line materials count paths. 10. Executor usage-accounting consolidation.
11. `lib/utils/email-generator.js:489` legacy `DEFAULT_TEMPLATE` with no live importer (cleanup).
12. Retire the upload-based VRP page only after the new panel reaches parity (D5; not before Phase B).
13. Dossier adopting `err.usage` ledger logging (plan §8).

### Verify Before Acting

1. **Never set Vercel env vars yourself**; hand the owner `! <command>` lines (`vercel env add … --type
   config --force`, `vercel redeploy <alias>`). Verify values afterwards with `vercel env pull` to the
   scratchpad (readable config only) and delete the file.
2. **Waiting on CI or a deploy:** `gh pr checks <n> --watch --fail-fast` in a background command; a
   push to the PR branch resets checks, so restart the watch after every push. Confirm a production
   deployment is the merge build with `vercel ls --prod --meta githubCommitSha=<sha>` then
   `vercel inspect <url> --wait` (`vercel inspect` alone does not print the commit).
3. **Tier 1–3 runtime work** goes on a feature branch and the OWNER merges (S511: both PRs merged on the
   owner's "merge"). Tier 0 docs/tests may land on main directly.
4. **App-grant propagation:** route grant cache 2 min (cleared on grant for the same instance);
   service-level `assertReviewPanelAccess` is uncached; the browser tab strip only refetches grants on
   reload — tell users to reload after a grant. The "5 minutes" figure is the admin MODEL override cache.
5. **Codex parallel work:** worktree + brief; adversarial review needs `--base <commit>`. Worktrees
   `../WMKF_Apps-codex` and `../WMKF_Apps-codex-tracker` are parked on merged branches.
6. Production hostname for probes: `https://wmkfresearch.vercel.app` (aliases include
   `applications.wmkeck.org`, `reviews.wmkeck.org`).
7. Fresh-install blocks: migration 047 = block v49 (applied to production 2026-09-13); next migration
   is 048 → block v50. No migration this session.
8. Production Postgres reads for diagnosis only from `.env.local` under an explicit owner ask; delete
   temp scripts after use.

### Do Not Reopen Without New Decision

1. Review Panel T1–T4 (2026-09-13, plan §1) and D1–D11 (Phase A plan §1) unless the owner overrides.
2. Failed Review Panel runs stay visible but collapsed (owner 2026-09-13; distill decision).
3. Cycle Dossier: roster scope server-side Research; institution from the Applicant lookup; pilot mode =
   23-request allowlist, any superuser; entry timeout is the `cycle-dossier.entry` Executor budget;
   revision numbers per request; editions dossier-level; frozen Blob bytes are the artifact of record.
4. Reviewer release: "No longer needed" may skip the courtesy email (2026-09-12).
5. Materials reminder cron stays out of `vercel.json` until ops/owner decide (M5).
6. Optional "other" applicant upload hidden, not retired; briefing header order and non-PDF download
   behaviour (D28); role-gap send failure is record-only; prior decisions unchanged.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/REVIEW_PANEL_WORKBENCH_TAB_PLAN_2026-09-13.md` | T1–T4 decisions, slices, residual risks |
| `shared/components/workbench/ReviewPanelTab.js` | per-request tab (`runTotalLabel`, three run shapes) |
| `shared/components/review-panel/review-panel-ui.js` | shared pills/timeline/entry row for page and tab |
| `pages/workbench/[requestId].js` | `visibleTabsFor(hasAccess)`; gated TABS entry |
| `lib/services/review-panel-store.js` | `assertReviewPanelActor` (PG-only) / `assertReviewPanelAccess` (grant); `listReviewPanelRunsForRequest` |
| `lib/services/review-panel-service.js` | `getReviewPanelForRequest`, `assertNoActiveRunForRequests`, `loadConfigurationSummary` |
| `lib/services/review-panel-rollout.js` | `REVIEW_PANEL_ROLLOUT_MODES` incl. `access` |
| `docs/plans/REVIEW_PANEL_OVERNIGHT_BRIEF_2026-09-13.md` | §3 logged follow-ups |
| `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` | Wednesday ops agenda |

## Testing

```bash
npx jest tests/unit/review-panel-*.test.js tests/unit/workbench-review-panel-tab*.test.js tests/unit/workbench-request-preview-safety.test.js
npm run check:types && npm run check:api-routes && npm run check:fact-consistency && npm run check:atlas
vercel env ls production | grep REVIEW_PANEL
```
