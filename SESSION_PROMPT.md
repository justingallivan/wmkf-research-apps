# Session 511 Prompt: Review Panel is live in smoke mode; decide typical-cost figure, Fable seat, pilot widening; Monday ops meeting

> Session 510 ran 2026-09-12 through the afternoon of 2026-09-13: overnight autonomous build, then
> the owner merged, configured, and smoke-tested the Virtual Review Panel in production with Fable
> orchestrating fixes live. Start with `/start`. **Read first:**
> `docs/plans/REVIEW_PANEL_OVERNIGHT_BRIEF_2026-09-13.md` §2b (smoke results), §3 (logged
> findings), §4 (delegated decisions). The panel is **enabled in production in smoke mode** on a
> four-request allowlist; all four requests completed at ~$0.60 each.

## Session 511 in progress (2026-09-13) — Review Panel as a gated Workbench tab, PR #291 open

Owner decisions T1–T4 and the build record: `docs/plans/REVIEW_PANEL_WORKBENCH_TAB_PLAN_2026-09-13.md`.
Branch `feature/review-panel-workbench-tab`; Tier 2 runtime work, so the OWNER merges after CI, not the agent.
PR #291 merged 2026-09-13 (4b22c50c); `REVIEW_PANEL_ROLLOUT_MODE=access` set in Production and
redeployed (`wmkfresearchapps-47ehh2pmg`, Ready) — **[VERIFIED via `vercel env pull` + redeploy output]**.
Still owner-side: grant `review-panel` to the pilot users in the admin panel, then smoke the tab
signed-in on one request (Workbench → Review Panel tab: Launch, progress, Word/PDF links). The tab has
NOT had a browser check yet. Also open: the fact-consistency self-test fixture fix landed on main (c1ffda91).

## Session 510 Summary (Fable orchestrating; Sonnet built, Opus reviewed, one Codex adversarial round; owner drove production rollout 2026-09-13)

### What Was Completed

1. **VRP decisions D1–D11 closed** with the owner (plan §1): hybrid vendor seats Claude + OpenAI on a
   governed Executor provider seam, Claude chair (Opus start), all models selectable in the admin
   model panel, seats extensible to 3+; narrative-only input; teamCapacity `not_assessable`; chair
   gets seat reviews + narrative; provisional OpenAI seat model `gpt-5.6-sol`; dedicated private
   Blob store for the panel. Plan: `docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md`
   (four Codex adversarial rounds on the plan itself, §9).
2. **A0 Executor provider seam merged** (PR #280, built by Codex, reviewed by Fable):
   `allowedProviders` opt-in per call (default Anthropic only), dispatch by the capability row's
   `provider`, `lib/services/openai-client.js`, error-attached usage, `usageComplete`, `paidCall`;
   provider-keyed `check:model-registry`; `validateReviewedProviderModelValue`; review-panel model
   slots in `/api/admin/models` and `shared/config/reviewPanelSeats.js`.
3. **Codex email-templates branch merged** (PR #279) and the four site-visit templates moved into a
   new "Applicant emails" admin group (direct to main).
4. **Phase A foundation built overnight** on `feature/review-panel-foundation` (PR #281, 27 commits,
   ~6k lines, CI green): migration 047 + block v49 (five tables; `review_panel_seat_attempts` ledger
   with the two fences and cost CHECKs), store/rollout/input DTO/questions projection/generation/
   worker/service/storage/documents, routes + page + matrix rows, seed script (dry-run only), spend-check
   and admin-stats ledger reads with withheld totals, Atlas page, wiki topic, runbook rows. Review
   chain: 3 Opus slice reviews, 1 Codex adversarial round (4 blocking, fixed), 2 Opus rechecks
   (one regression pair found and fixed). Brief §3 lists what was logged rather than fixed; §4 the
   decisions made on the owner's behalf; §5 the exact owner-side commands.

5. **Production rollout and smoke (2026-09-13, owner-run):** migration 047 applied; PR #281 merged;
   store `wmkf-review-panel-private` (`store_cwVLLxRMR3A8NFA2`) connected under the `REVIEW_PANEL_BLOB`
   prefix; `OPENAI_API_KEY`, `VRP_ALLOWED_PROVIDERS=claude,openai`, `REVIEW_PANEL_ENABLED=true`,
   `REVIEW_PANEL_ROLLOUT_MODE=smoke`, four-request allowlist; prompts seeded (seat v2 Opus, chair v3);
   drain cron per minute. Four complete panels: 1002852 $0.61, 1002874 $0.59, 1002903 $0.65,
   1002912 $0.59 (~4 min each). Fixes merged during the smoke: PR #282 progress polling + seat
   pills, #283 answer cap + timeline, #284 admin-tunable output budgets (seat 16k, chair 12k),
   #285 tier-key resolution + readiness reason, #286 PDF WinAnsi sanitizer + stored error detail,
   #287 retry-state UX, #288 report rendering (labelled matrix, disagreements), #289/#290 "Re-render report"
   action (no model calls; run resolved from entry ids; chair winner recorded on normal completion). Fable refused the seat prompt on two biology proposals (API `refusal`);
   Claude seat default is now Opus (a88ea0b2).

### Commits (main, this session; merges omitted)

VRP plan revisions (4399fcbb … 262f3322); email-templates group move; brief/handoff commits
(0a52e8c7 … b22486f6 and later); seat ceiling f3449fdc; Opus seat default a88ea0b2; cron fb6a911a;
docs reconcile 899a6785. PR merges: 8d7c6490 (#280), bbef47ac (#281), 59e2284e (#282), 753238c0
(#284), 242569ce (#286), 2b609c9e (#288), ca078e9c (#289), 182ddf8f (#290); #283, #285, #287 in between.

## Next Items

### Verified Open

1. **Monday 2026-09-14 ops meeting** — agenda in `project-ops-meeting-2026-09-14-agenda.md` (6 items
   incl. materials reminder cron and dossier drain-cron cadence). Afterward: record decisions in
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 and `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`, add
   `vercel.json` entries if decided, close the memory.
2. **Review Panel next steps** (all owner decisions; the app is live in smoke mode):
   (a) whether the page shows a typical-cost figure (~$0.60/request from four runs, D6);
   (b) whether to widen to pilot mode / the full D26 roster (`REVIEW_PANEL_ROLLOUT_MODE=pilot`,
   allowlist); (c) Fable seat: test on a non-biology proposal or leave Opus; (d) the OpenAI seat id
   (D10, still `gpt-5.6-sol`). (e) DONE 2026-09-13: owner re-rendered 1002852 and 1002874; all four
   smoke editions now carry the current report template. Follow-ups logged in brief §3:
   worker-stamped retry marker, `check-review-panel-rollout.js` preflight clone, prompt editor
   should show the slot model for the two panel rows, admin model changes take up to 5 minutes to
   reach launches (override cache TTL). Evidence: brief §2b/§3.
3. **Dossier "typical cost from real runs" figure** beside the reservation bound. Evidence: seven
   logged entries in `api_usage_log` (`app_name='cycle-dossier'`); owner asked to decide after seeing
   actuals (now in hand, ~40× below the bound).
4. **Site-visit email templates**: merged (PR #279) and regrouped under "Applicant emails";
   production rehearsal of the four templates still not done. Evidence: `shared/config/editableTextDefaults.js`.
5. **Dossier redesign effort** (owner: "get this functioning better and then we can mount a
   redesign"). Functional list is clear; the redesign is unscoped.
6. **Email send feedback and consistency audit** (work queue item 10): unchanged.
7. **Five sibling routes with unescaped `Content-Disposition`** (queue audit follow-up): convert to
   `lib/utils/content-disposition.js` in one pass.
8. Owner production checks still not eyeballed: Share composer preview and agenda "Exact email"
   preview on 1003222; PR #218 cycle view.

### Owner Decision Needed

1. Review Panel: typical-cost figure (D6), pilot widening, Fable seat, OpenAI seat id (D10), `cycle`
scope. Old upload-based VRP page retirement stays deferred (D5).
2. Dossier preview/Blob retention policy (open since S494).
3. Drain-cron cadence and materials reminder cron (ops Monday). 4. PR #116 (ROR resolver shadow
mode): keep or close. 5. 45 unmerged local branches: prune or keep (grep live refs first).
6. Carried: reissue during Dynamics Pending Send; Program select on Final writeups/Awardees; PD
front-end flip. 7. The other four `CYCLE_DOSSIER_*` flags are still hidden secrets (allowlist and
rollout mode are now readable).

### Parked

1. Connor items (J27 Q5, back-end status changes, slice G). 2. Request Quick Find metadata repair.
3. Legacy Complete row with null eligibility. 4. `NEXTAUTH_SECRET` rotation; multipart direct-upload
conversion; Stage III institution identity authority. 5. Playwright coverage for external briefing
and materials pages. 6. Proposal order P3s. 7. Messages & policies P3s. 8. Slots-only reload after
reorder. 9. Card-vs-line materials count paths. 10. Executor usage-accounting consolidation.
11. `lib/utils/email-generator.js:489` legacy `DEFAULT_TEMPLATE` with no live importer (cleanup).
12. Retire the upload-based VRP page only after the new panel reaches parity (D5; not before Phase B).
13. Dossier adopting `err.usage` ledger logging (plan §8) and Executor usage-accounting consolidation.

### Verify Before Acting

1. **Never set Vercel env vars yourself**; hand the owner `! <command>` lines (worked well this
   session: `vercel env add … --type config --force`, `vercel env rm … -y`, `vercel redeploy <alias>`).
2. **Waiting on CI or a deploy:** `gh pr checks <n> --watch --fail-fast` / `vercel inspect <url> --wait`
   in a background command; merge in a separate step after the notification. Never a home-rolled
   poll loop. (`feedback-deployment-monitoring-use-inspect`.)
3. **Codex parallel work:** worktree + brief; `codex-companion.mjs … -C <worktree> --model gpt-5.6-sol`
   is fine when the owner is not running parallel work (owner 2026-09-12); Codex cannot commit in a
   worktree, Claude commits for it. Adversarial review needs `--base <commit>`. Confirm delegation
   scope in one line before dispatching a build (S510: "have codex make the fixes" was over-read as
   "build everything").
4. Worktrees: `../WMKF_Apps-codex` (parked on the last merged panel branch; all panel PRs #281–#289 merged),
   `../WMKF_Apps-codex-tracker` (`codex/meeting-tracker`, merged long ago).
5. Production hostname for probes: `https://wmkfresearch.vercel.app` (redirects to
   `applications.wmkeck.org`); SharePoint site `https://appriver3651007194.sharepoint.com/sites/akoyaGO`.
6. Fresh-install blocks: migration 047 = block v49 (applied to production 2026-09-13); next migration
   is 048 → block v50.
7. Retry resumes from the last checkpoint on a NEW run row (spent resets to 0 on the card; the
   source run keeps its charges) and now re-reads the entry timeout budget.
8. Production Postgres reads for diagnosis (usage log, run ledger) were done from `.env.local`,
   which points at the production Neon database; read-only, under an explicit owner ask.
9. A dossier's persisted selection is an explicit include list; a smoke-era selection showed the
   widened roster as excluded until "Include all" (now a button).

### Verify Before Acting (added 2026-09-13)

10. **Deploy readiness:** `vercel inspect <alias>` reporting Ready can be the PREVIOUS deployment.
    Before telling the owner a merge is live, confirm the newest production deployment's `created`
    time is after the merge commit and its status is Ready (S510: 1002874 rendered with the old
    report template because of this).
11. **Production reads for diagnosis** were done read-only from `.env.local` under explicit owner
    permission ("read"); temp scripts under `scripts/_*.mjs` were deleted after each use.

### Do Not Reopen Without New Decision

1. Cycle Dossier: roster scope server-side Research; institution from the Applicant lookup;
   **pilot mode = 23-request allowlist, any superuser** (2026-09-12); entry timeout is the
   `cycle-dossier.entry` Executor budget, not a code literal; revision numbers are per request;
   editions are dossier-level; DOCX verification structural, PDF exact; frozen Blob bytes are the
   artifact of record.
2. Reviewer release: "No longer needed" may skip the courtesy email (2026-09-12).
8. Review Panel D1–D11 (plan §1, 2026-09-12) and the brief §4 delegated decisions unless the owner
   overrides them in the morning review.
3. Materials reminder cron stays out of `vercel.json` until ops/owner decide (M5).
4. Optional "other" applicant upload hidden, not retired. 5. Briefing header order and non-PDF
download behaviour (D28). 6. Role-gap send failure is record-only. 7. Prior decisions unchanged.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/VIRTUAL_REVIEW_PANEL_REVIVAL_SURVEY_2026-09-12.md` | VRP as-built, internal context inventory, proposed rebuild, D1–D6 |
| `docs/plans/EMAIL_TEMPLATES_CONFIGURABLE_CODEX_BRIEF_2026-09-12.md` | Codex brief (owned surface §3, handoff section) |
| `lib/services/cycle-dossier-worker.js` | `operatorStopSignal`, `describeEntryFailure`, per-item publish |
| `lib/services/cycle-dossier-generation.js` | `resolveEntryTimeoutMs`, `boundedEntryTimeout`, `loggedExecute` |
| `shared/config/executorBudgets.js` | `cycle-dossier.entry` timeout budget (200 s, 60–220 s) |
| `lib/services/execute-prompt.js` | `signal` argument combined with `deadlineMs` |
| `lib/db/migrations/046_cycle_dossier_entry_request_revision.sql` | per-request revision (applied to prod 2026-09-12) |
| `lib/services/model-resolver.js` | `fable` tier |
| `lib/utils/content-disposition.js` | shared safe header builder |
| `next.config.js` | `X-Frame-Options: SAMEORIGIN` on `/api/cycle-dossier/download` |
| `.claude-memory/project-ops-meeting-2026-09-14-agenda.md` | Monday ops agenda |

## Testing

```bash
npx jest tests/unit/cycle-dossier tests/unit/executor-budget tests/unit/release-email-modal.test.js
npm run check:types && npm run check:status-enum-parity && npm run check:api-routes
vercel env ls production | grep CYCLE_DOSSIER
vercel logs --environment production --since 30m --query "drain-cycle-dossiers" --limit 100 --json
```
