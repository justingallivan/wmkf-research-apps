# Session 510 Prompt: Monday ops meeting; VRP Phase A plan; dossier cost figure; Codex email-templates review

> Session 509 ran 2026-09-12 with the owner present. Start with `/start`. The Cycle Dossier is in
> **pilot mode over the full D26 roster** (23 requests; 7 entries generated). Next: the Monday
> 2026-09-14 ops meeting, then the owner's to-do: a Phase A build plan for the Virtual Review
> Panel revival from the survey doc.

## Session 509 Summary (Claude Opus 5 after a mid-session model switch from Fable; Sonnet agents built the hardening slice)

### What Was Completed

1. **Startup gates all green** (38 gates + 29 self-tests). Memory/skills symlinks consolidated.
2. **Cycle Dossier pilot-mode hardening** (PR #265, `1cc994c3`…`7bc7b989`): Content-Disposition
   escaping (`lib/utils/content-disposition.js`); two-decimal USD; "Retry failed entries"; inline error
   beside Launch and the run controls; Progress tab default while a run is unsettled; dead
   `pausing`/`cancelling` removed; Word Online warning; **operator stop re-read inside in-flight LLM
   calls and `ensureFolderPath`** via a new server-owned `signal` argument on `executePrompt`
   (combined with `deadlineMs` through `AbortSignal.any`; reason propagates unwrapped). Review caught
   two Sonnet defects (transient control-read aborts; `allSettled` swallowing the abort) and the
   ambiguous-charge state (`unknownCost` retained on an aborted paid call).
3. **Fable model tier** (PR #266): `fable` → `claude-fable-5-1` labelled "Fable (extra high)" above
   Opus; Fable 5.1 registered in capabilities and pricing; all hardcoded tier-key sets updated.
4. **All 18 Dependabot alerts closed**: Next 16.3.5, xmldom 0.8.15, sharp 0.35.4, qs 6.16.0 (#267);
   js-yaml, csv-parse 7.0.2 (#270); **tiptap 2 → 3.31 editor migration** (#271: `prosemirror-markdown`
   direct import, `setContent({emitUpdate:false})`, `shouldRerenderOnTransaction:true`, StarterKit
   extras disabled) with a production Chrome smoke of both editors.
5. **Reviewer release without courtesy email** (PR #273): "No longer needed" gains the checkbox
   (default on); explicit `sendEmail` flag through route and service. For Mikhail Shapiro on 1002903.
6. **Pilot widened** (owner ran the env commands): `CYCLE_DOSSIER_ROLLOUT_MODE=pilot`, 23-request
   allowlist (full D26 Research roster minus test copy 1003222), readable config vars; redeploy verified.
7. **First pilot-run failure diagnosed and fixed**: entry call timed out at the 85 s code default
   (`api_usage_log` error row). PR #274 registers `cycle-dossier.entry` as an admin-tunable Executor
   budget (default 200 s, envelope 60–220 s), pinned at preview; PR #276 makes retry re-read it.
   Successful briefings ran 83–108 s. Plus plain-language failure copy (`describeEntryFailure`).
8. **Functional UI fixes from live use**: "Dossier editions" section with request numbers per card
   and honest copy; Include all / Exclude all; PDF preview fixed (`X-Frame-Options: SAMEORIGIN` on
   the download route only) (#275); Word/PDF links on ready run rows (#277); **per-request revision
   numbers, migration 046** applied to production and backfilled (#278).
9. **Cost actuals** (from `api_usage_log` + run ledger): 1002874 $0.47 across two runs; five-request
   run $1.87 ($0.34–$0.43 per entry: research plan ~$0.09 at 6–9 s, briefing ~$0.28 at 83–108 s,
   ~7k output tokens). Reservation bounds run ~40× above actuals.
10. **Codex email-templates brief** written and committed (`docs/plans/EMAIL_TEMPLATES_CONFIGURABLE_CODEX_BRIEF_2026-09-12.md`);
    worktree `../WMKF_Apps-codex` on `codex/email-templates-configurable` at `c63a5473`, pushed. My
    first dispatch via `codex:rescue` could not write into the worktree (sandbox pinned to the main
    checkout); **the owner runs Codex in another app** (new memory `feedback-codex-worktree-owner-runs-it`).
11. **Virtual Review Panel revival survey** (`docs/plans/VIRTUAL_REVIEW_PANEL_REVIVAL_SURVEY_2026-09-12.md`):
    as-built VRP, internal context inventory, proposed admin-only rebuild on the dossier scaffolding,
    six owner decisions (D1–D6), three-phase plan.
12. **Process corrections saved to memory**: use the tool's own wait (`gh pr checks --watch`,
    `vercel inspect --wait`) in a background command and merge in a separate step
    (`feedback-deployment-monitoring-use-inspect` updated after the owner's "you don't notice them").

### Commits (main, this session; merges omitted)
`1cc994c3` `a07f22d8` `77cbd577` `7bc7b989` `a0049902` (#265) · `0d4b8615` (#266) · `15b60f84` (#267) ·
`940196b1` (#270) · `58c410f1` `abcb0b4c` `ff0e6e48` (#271) · `16b82a6f` `6f0175ce` (#273) ·
`993c58c6` `00c8122b` (#274) · `dc2110b7` (#275) · `7a76271a` (#276) · `cbb5240e` (#277) ·
`d8564fce` (#278) · `9fbc2243` `78bc2ea4` `c63a5473` (Codex brief) · `6b6a9633` (VRP survey).

## Next Items

### Verified Open

1. **Monday 2026-09-14 ops meeting** — agenda in `project-ops-meeting-2026-09-14-agenda.md` (6 items
   incl. materials reminder cron and dossier drain-cron cadence). Afterward: record decisions in
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 and `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`, add
   `vercel.json` entries if decided, close the memory.
2. **Owner to-do: Virtual Review Panel Phase A build plan** from
   `docs/plans/VIRTUAL_REVIEW_PANEL_REVIVAL_SURVEY_2026-09-12.md`. Needs the owner's answers to D1–D6
   first (D1 Claude-only personas vs multi-vendor is the fork). Evidence: survey doc §4–5.
3. **Dossier "typical cost from real runs" figure** beside the reservation bound. Evidence: seven
   logged entries in `api_usage_log` (`app_name='cycle-dossier'`); owner asked to decide after seeing
   actuals (now in hand, ~40× below the bound).
4. **Codex email-templates branch**: when the owner reports Codex done, review read-only per
   `parallel-agent-worktree` Step 5 (surface in brief §3; seed module + `scripts/seed-email-defaults.mjs`
   map; fail-closed defaults; tests), verify, merge on the owner's go. Evidence: branch at `c63a5473`,
   no commits yet at session end.
5. **Dossier redesign effort** (owner: "get this functioning better and then we can mount a
   redesign"). Functional list is clear; the redesign is unscoped.
6. **Email send feedback and consistency audit** (work queue item 10): unchanged.
7. **Five sibling routes with unescaped `Content-Disposition`** (queue audit follow-up): convert to
   `lib/utils/content-disposition.js` in one pass.
8. Owner production checks still not eyeballed: Share composer preview and agenda "Exact email"
   preview on 1003222; PR #218 cycle view.

### Owner Decision Needed

1. VRP D1–D6 (survey §4). 2. Dossier preview/Blob retention policy (open since S494).
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
12. Retire the upload-based VRP page only after a rebuilt panel reaches parity (survey D5).

### Verify Before Acting

1. **Never set Vercel env vars yourself**; hand the owner `! <command>` lines (worked well this
   session: `vercel env add … --type config --force`, `vercel env rm … -y`, `vercel redeploy <alias>`).
2. **Waiting on CI or a deploy:** `gh pr checks <n> --watch --fail-fast` / `vercel inspect <url> --wait`
   in a background command; merge in a separate step after the notification. Never a home-rolled
   poll loop. (`feedback-deployment-monitoring-use-inspect`.)
3. **Codex parallel work:** set up worktree + brief, hand off; the owner launches Codex elsewhere.
   Never `codex:rescue` a worktree build. (`feedback-codex-worktree-owner-runs-it`.)
4. Worktrees: `../WMKF_Apps-codex` (`codex/email-templates-configurable`, live task),
   `../WMKF_Apps-codex-tracker` (`codex/meeting-tracker`, merged long ago).
5. Production hostname for probes: `https://wmkfresearch.vercel.app` (redirects to
   `applications.wmkeck.org`); SharePoint site `https://appriver3651007194.sharepoint.com/sites/akoyaGO`.
6. Fresh-install blocks: migration 046 = block v48; next migration is 047 → block v49.
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
