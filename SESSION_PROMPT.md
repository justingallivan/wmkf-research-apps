# Session 508 Prompt: Run the Cycle Dossier smoke on 1002852, then the Monday ops meeting

> Session 507 ran 2026-09-11 with the owner present. Start with `/start`. Eight PRs merged to
> production (#252–#259). The Cycle Dossier pilot is LIVE AND ENABLED in production in smoke
> mode, preflight fully green, no run launched yet. The owner ran out of time before launching;
> the smoke is the first task next session.

## Session 507 Summary (Claude Fable, owner-directed; Sonnet subagents for builds and sweeps; Codex reviews)

### What Was Completed

1. **Applicant materials PR 3 promoted** (PR #252, `3b41f879`). With `SITE_VISIT_MATERIALS_SCHEMA_READY`
   on, the three staff lines and the tracker cue render (owner saw "Materials: 2 of 3 received · due
   Sep 16" on ZZTEST-03). Reminder cron dry run verified in production: HTTP 200, 0 scanned. Cron
   remains unscheduled (owner M5; ops decides Monday).
2. **Optional "other" applicant upload hidden** (PR #253, `e71f617d`). One constant
   `SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED=false` gates the page, the upload-token mint (400), and
   finalize (`slot_not_open`). Storage path stays built; cron unaffected (`missingRequiredItems` reads
   checklist items only; `other` is never a key). Plan §16.5.
3. **Briefing page** (PR #254, `18a5bd70`): proposal title between institution and PI/PD; Research
   presentation materials open a new tab only for PDFs (`inline` flag in the context mirrors the
   document route's disposition rule), so a PPTX downloads directly. D28.
4. **Closeout route structured errors** (PR #255, `18073bfb`): `mapWriteError` now maps interlock
   denials (503 `write_interlocked`), Dataverse 401/403 (502 `dataverse_forbidden`), other 4xx (502
   `dataverse_rejected`), 404 on write; fixed copy only. Sibling engagement routes untouched.
5. **Meeting tracker bare paths** (PR #256, `50436d49`): `/meeting-tracker/sessions` and `/visits`
   redirect (307) to the dashboard keeping `cycleCode`/`programId`.
6. **react-hooks lint warnings cleared** (PR #257, `c707f84c`): dead reset block removed from the
   keyed Staff Deliberations tab (`checkingStatus` seeded from the prop; tests mirror the parent's
   key); refs false positive suppressed with reason; distribution panel To/Cc seeding moved to a
   render-time seed check compared by value; `siteVisitId` derived into the prepare payload.
7. **PC manual reminder claims before sending** (PR #258, `dac9f239`; Sonnet build in a worktree):
   `claimManualReminder` conditional UPDATE (open, no reminder in the last 60 s) → send → attach;
   lost claim = 409 `site_visit_materials_reminder_just_sent`; `recordReminder` removed. Plan §16.6.
8. **Cycle Dossier pilot landed and activated** (PR #259, `9c5943ae`; PR #179 auto-marked merged):
   `claude/cycle-dossier-reconcile` merged onto main by a Sonnet agent (seven registry conflicts as
   unions, migration `038`→`045_cycle_dossiers.sql`, fresh-install block V47, preflight
   `MIGRATION_FILE`, counts regenerated: `requireappaccess-endpoint-count` 128,
   `api-route-file-count` 212). Seam-drift sweep: only `graph-service.js` overlapped (non-conflicting
   functions). `/contract-reconcile` Mode B: READY FOR SMOKE. Codex adversarial review: 3 high /
   3 medium / 1 low → fixed in `fb285cd1` (selection resolved against the server-owned roster so a
   request-number allowlist works in smoke mode; resume cannot lower the cap below spent+reserved;
   institution from the Applicant lookup not `wmkf_organizationname`; provider deadline leaves 60 s
   under the 280 s lease; preflight messages say 045; catalog says six tables; matrix wording).
   Codex re-review of the fix commit: no actionable defects.
   **Owner production steps done tonight:** env set in Production (`CYCLE_DOSSIER_ROLLOUT_MODE=smoke`,
   `CYCLE_DOSSIER_OPERATOR_STOP=false`, `CYCLE_DOSSIER_OPERATOR_PROFILE_ID=2`,
   `CYCLE_DOSSIER_REQUEST_ALLOWLIST=1002852`, `CYCLE_DOSSIER_ENABLED=true`; Blob token/store id were
   already connected in all envs); migration 045 applied (`1 applied, 43 skipped`); prompt seed dry
   run refused both rows (already published v1, exact match); preflight `--live-read --smoke-request
   1002852` all 13 checks ready (roster 24, narrative 37,839 chars, destination folder
   `1002852_E5DF0B46…`); redeploy `wmkfresearchapps-kzwmk1npl` Ready; drain probe returns
   `{"claimed":0}`. **No preview, launch, paid call, or SharePoint write has happened.**
9. **Durable tracking.** Ops meeting 2026-09-14 agenda memory (6 items); work queue items 10 (email
   send feedback/consistency audit) and 11 (Cycle Dossier smoke → pilot hardening); agent-wiki index
   re-verified (90-day window expired mid-session, `5321109d`).
10. **Diagnosed, record-only:** the 2026-09-10 deliberation send 403 on ZZTEST-03 was a per-user
    Dataverse role gap (a not-yet-onboarded colleague, one role / 15 privileges; Customer Voice
    plugin on email create needs `prvCreateActivity` on `msfp_alert` under the impersonated
    sender). Owner's sends succeed. Resolution owned via onboarding.

### Commits (main, this session)
`3b41f879` #252 · `554e92ce`/`e71f617d` #253 · `7b7b0649` ops memory · `27794363`/`18a5bd70` #254 ·
`28343800`/`18073bfb` #255 · `d1ce7ad4`/`50436d49` #256 · `457a7af6`/`c707f84c` #257 · `e1d66641`,
`5bb04f83` ops memory · `e5870ba7` queue item 10 · `5321109d` agent-wiki · `fb285cd1` dossier fixes ·
`5fac0254` queue item 11 · `dac9f239` #258 · `9c5943ae` #259.

## Next Items

### Verified Open

1. **Run the Cycle Dossier smoke on 1002852** (owner, in the page). Evidence: preflight JSON above;
   drain probe `{"claimed":0}`; PR #259 body "Owner smoke sequence" steps 5. Sequence: open
   `/cycle-dossier` as profile 2 → select 1002852 (server-checked against the roster) → preview
   (freezes the narrative; returns low/high USD) → launch with a cap ≥ the high bound → the
   per-minute cron claims the run; research stage, entry stage, then DOCX/PDF into the request's AI
   Artifacts folder → verify both private downloads and the exact SharePoint files. Operator stop is
   on the page. A failed item needs an explicit retry (a `paidInFlight` failure may re-bill; by design).
   The agent may poll the drain probe and read `cycle_dossier_runs` (owner authorized ledger reads
   this session) while the owner watches.
2. **Monday 2026-09-14 ops meeting** — agenda in `project-ops-meeting-2026-09-14-agenda.md`:
   materials reminder cron schedule; its effects; PC-reminder race (now DONE via #258 — mark as
   informational); hidden "other" upload; per-user role gap (record-only); dossier drain-cron cadence.
   After the meeting: record decisions in `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 and
   `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`, add cron entries to `vercel.json` if decided, close the memory.
3. **Cycle Dossier pilot-mode hardening** (after a clean smoke; work queue item 11): stop re-read
   inside `LLMClient` retries and between `ensureFolderPath` POSTs; preview/Blob retention job
   (owner decision open since S494); UI retry affordance + dead `pausing`/`cancelling` strings;
   `Content-Disposition` filename escaping in `pages/api/cycle-dossier/download.js`; design-doc
   `last_verified` refresh now that prompts/preflight/activation are real.
4. **Email send feedback and consistency audit** (work queue item 10): subagent sweep of every
   send path and every surface that reports a send; propose one contract before any copy edit.
   Triggers: the quiet 2026-09-10 send failure; the "does not assert inbox delivery" disclaimers.
5. Owner production checks still not eyeballed: Share composer preview and agenda "Exact email"
   preview on 1003222; PR #218 cycle view (the per-request rail was verified today).

### Owner Decision Needed

1. Materials reminder cron: `vercel.json` entry or manual (ops Monday). Dry run verified.
2. Dossier drain cron cadence: per-minute (current, invokes ~43k×/month even when disabled) vs
   `*/5` vs windowed (ops Monday).
3. Combined dossier / preview retention policy (open since S494; Codex medium).
4. Agenda email subject vs "Pre-discussion" body — owner said DONE 2026-09-11 (admin setting).
5. PR #116 (ROR resolver shadow mode, open since 2026-08-07, no activity): keep or close.
6. 45 unmerged local branches (older Codex/Claude work): prune or keep. Grep live refs first.
7. Carried: reissue during Dynamics Pending Send; release-reason `no_response` standing; Program
   select on Final writeups/Awardees; PD front-end flip.
8. Sibling engagement routes may share the closeout route's old generic-500 gap (not audited).
9. The hidden "other" upload toggle is a code constant; an admin setting is an optional follow-up.
10. The four `CYCLE_DOSSIER_*` flags were stored as hidden secrets by the CLI default; re-add with
    `--type config` if auditability matters (functionally fine).

### Parked

1. Connor items (J27 Q5, back-end status changes, slice G). 2. Request Quick Find metadata repair.
3. Legacy Complete row with null eligibility. 4. `NEXTAUTH_SECRET` rotation; multipart direct-upload
conversion; Stage III institution identity authority. 5. Playwright coverage for external briefing
and materials pages. 6. Proposal order P3s. 7. Messages & policies P3s. 8. Slots-only reload after
reorder. 9. Card-vs-line materials count paths (agree for contributor uploads).

### Verify Before Acting

1. **Never set `DATAVERSE_ALLOW_PROD_READS`, `DATAVERSE_PROD_WRITE_ACK`, `*_SCHEMA_READY`, or
   Vercel env vars yourself**; the auto-mode classifier refuses Vercel env writes and (sometimes)
   Node scripts reading production Postgres even with owner authorization — hand the owner a
   `! <command>` line. Owner authorized read-only ledger probes this session (repo-local script,
   `NODE_PATH=node_modules node --env-file=.env.local`, delete after).
2. The dossier preflight reads only `process.env`: run it with `VERCEL_ENV=production`, the three
   smoke vars, `DATAVERSE_ALLOW_PROD_READS=yes`, `--env-file=.env.local`, and the two
   `DOSSIER_BLOB_*` values from a temporary `vercel env pull --environment=development` (deleted
   after). Exact command in the S507 transcript / PR #259 body.
3. Worktrees: `../WMKF_Apps-codex` (`codex/parked`), `../WMKF_Apps-codex-tracker`
   (`codex/meeting-tracker`, merged long ago). The dossier reconcile worktree was removed after #259.
4. Production hostname for cron probes: `https://wmkfresearch.vercel.app` (aliases
   `reviews.wmkeck.org` etc.); `CRON_SECRET` in `.env.local` matches production.
5. Fresh-install blocks: migration 045 = block V47; next migration is 046 → block v48.
6. `visitExpected()` remains the single D26 assumption in the briefing plan.
7. Materials manual reminders are now rate-limited to one per 60 s per collection (#258).

### Do Not Reopen Without New Decision

1. Cycle Dossier: roster scope is server-side Research (2026-09-08); institution from the Applicant
   lookup (PR #201 mirror, 2026-09-11); smoke mode = profile 2 + request 1002852 (2026-09-11);
   entry downloads shared across superusers, combined editions owner-private (design).
2. Materials reminder cron stays out of `vercel.json` until ops/owner decide (M5, 2026-09-11).
3. Optional "other" applicant upload hidden, not retired (2026-09-11). Summary payloads on
   reviewer-gated routes carry counts and window only.
4. Briefing header order institution → title → PI/PD; non-PDF materials download directly (D28).
5. Role-gap send failure is record-only; resolution via onboarding (owner, 2026-09-11).
6. Prior decisions unchanged: arrows removed / position select behind ⋯ / rail drag handle;
   "Pre-discussion" labels; seed text is init data; ledger `sent` = transport accepted.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/CYCLE_DOSSIER_PILOT_DESIGN.md` | Dossier design, env contract, rollout modes, smoke plan |
| `lib/services/cycle-dossier-{service,store,worker,generation,rollout,storage,sharepoint,documents}.js` | Pilot services (worker: fenced 280 s lease, budget reservation, stop checks) |
| `pages/cycle-dossier.js`, `pages/api/cycle-dossier/{index,download}.js`, `pages/api/cron/drain-cycle-dossiers.js` | Pilot UI, actions, private downloads, per-minute drain |
| `scripts/check-cycle-dossier-rollout.js` | Read-only production preflight (all 13 checks ready 2026-09-11) |
| `lib/db/migrations/045_cycle_dossiers.sql` | Six `cycle_dossier_*` tables + control row (applied in production) |
| `lib/services/site-visit-materials/collection-store.js` | `claimManualReminder`, `claimAutomaticReminder`, `attachReminderEmailId` |
| `shared/config/siteVisitMaterials.js` | `SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED` toggle |
| `lib/services/reviewer-engagement/close-review.js` | `mapWriteError` structured errors |
| `.claude-memory/project-ops-meeting-2026-09-14-agenda.md` | Monday ops agenda (6 items) |
| `docs/CURRENT_WORK_QUEUE.md` items 10–11 | Email feedback audit; dossier smoke → pilot hardening |

## Testing

```bash
npx jest tests/unit/cycle-dossier tests/unit/site-visit-materials tests/unit/external-briefing-page.test.js tests/unit/reviewer-closeout-service.test.js tests/unit/meeting-tracker-index-redirects.test.js tests/unit/staff-deliberations-tab.test.js tests/unit/pre-site-distribution-panel.test.js
npm run check:types && npm run check:api-routes && npm run check:atlas && npm run check:fact-consistency
# production probes (owner shell): drain tick + materials reminder dry run
curl -H "Authorization: Bearer $CRON_SECRET" https://wmkfresearch.vercel.app/api/cron/drain-cycle-dossiers
curl -H "Authorization: Bearer $CRON_SECRET" "https://wmkfresearch.vercel.app/api/cron/site-visit-materials-reminders?dryRun=1"
```
