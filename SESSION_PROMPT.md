# Session 511 Prompt: merge/configure Review Panel Phase A (PR #281); Monday ops meeting; dossier cost figure

> Session 510 ran 2026-09-12 into the night of 2026-09-13 (owner present, then an autonomous
> overnight build). Start with `/start`. **First thing to read:**
> `docs/plans/REVIEW_PANEL_OVERNIGHT_BRIEF_2026-09-13.md` — the Review Panel Phase A foundation is
> built, reviewed, and waiting as **PR #281** (branch `feature/review-panel-foundation`, worktree
> `../WMKF_Apps-codex`). Nothing is merged, deployed, migrated, seeded, or configured.

## Session 510 Summary (Fable orchestrating; Sonnet built, Opus reviewed, Codex adversarial round)

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

### Commits (main, this session; merges omitted)

VRP plan revisions (4399fcbb … 262f3322), email-templates group move, brief commits
(0a52e8c7 … latest). Branch commits are on `feature/review-panel-foundation` (2b714ebf … 72dd40dd).

## Next Items

### Verified Open

1. **Monday 2026-09-14 ops meeting** — agenda in `project-ops-meeting-2026-09-14-agenda.md` (6 items
   incl. materials reminder cron and dossier drain-cron cadence). Afterward: record decisions in
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 and `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`, add
   `vercel.json` entries if decided, close the memory.
2. **Review Panel Phase A: owner's merge and configuration decision** on PR #281. Read brief §3
   (logged findings) first, then §5 in order: merge → `apply-migrations.js` → provision the D11
   store and set both Blob vars → `OPENAI_API_KEY` + `VRP_ALLOWED_PROVIDERS=claude,openai` →
   rollout flags (`smoke`, allowlist) → seed the two prompts (`--execute`) → cron entry in
   `vercel.json` (tracked commit) → smoke run on one request. Natural follow-up before the smoke:
   a `scripts/check-review-panel-rollout.js` clone of the dossier preflight to prove the store
   identity. Evidence: brief §2 table, PR #281 checks.
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

1. Review Panel: merge PR #281 and the §5 configuration order; whether to change the provisional
OpenAI seat model `gpt-5.6-sol` (D10) before the smoke; whether the panel needs a `cycle` scope.
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
4. Worktrees: `../WMKF_Apps-codex` (`feature/review-panel-foundation`, PR #281, keep until merged),
   `../WMKF_Apps-codex-tracker` (`codex/meeting-tracker`, merged long ago).
5. Production hostname for probes: `https://wmkfresearch.vercel.app` (redirects to
   `applications.wmkeck.org`); SharePoint site `https://appriver3651007194.sharepoint.com/sites/akoyaGO`.
6. Fresh-install blocks: migration 047 = block v49 (on the PR #281 branch, never applied anywhere);
   next migration is 048 → block v50.
7. Retry resumes from the last checkpoint on a NEW run row (spent resets to 0 on the card; the
   source run keeps its charges) and now re-reads the entry timeout budget.
8. Production Postgres reads for diagnosis (usage log, run ledger) were done from `.env.local`,
   which points at the production Neon database; read-only, under an explicit owner ask.
9. A dossier's persisted selection is an explicit include list; a smoke-era selection showed the
   widened roster as excluded until "Include all" (now a button).

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
