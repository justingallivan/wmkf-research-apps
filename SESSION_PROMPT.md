# Session 519 Prompt: Reminder-cron schedule decision and Pre-RP Brief bundle smoke

## Session 518 Summary

Session 518 started on `main` with every gate green and one advisory: the memory router
had crossed its 8 KiB routine-audit trigger. The session ran the router diet and then the
full runbook §6 routine audit, set Codex up on a worktree branch to record the
2026-09-16 operations-meeting outcomes, reviewed and merged that branch, verified the
Production deployment, and cleaned up a stale 2026-07-02 stash.

### What Was Completed

1. **Memory router diet (runbook §10), commit `c39e43ed`.** `MEMORY.md` 8,239 → 6,921 B,
   unique leaf refs 67 → 52. Status narratives (Site Visit materials ship state, PC
   Meeting Tracker decisions and its two Codex briefs, lifecycle program, Find-latency
   incident) moved to `project-closed-work-archive.md`; environment, delegated-work,
   reviewer-product-decision, and workbench closeout leaf lists collapsed onto the wiki
   Durable Memory sections of `dev-environment.md`, `reviewer-identity.md`, and
   `reviewer-workbench-lifecycle.md`. No leaf deleted; every removed router reference
   resolves through a hub.
2. **Full §6 routine audit, commit `724d4e52`.** All 21 health flags dispositioned
   (21 → 9 → 5 by session end). Recall rules added to eleven routed leaves;
   `feedback-red-gates-are-p0` re-pointed from a `CLAUDE.md` heading that no longer
   exists to Universal Operating Rule 4; `feedback-codex-model-gpt56-sol` corrected
   (`~/.codex/config.toml` now pins `gpt-5.6-sol`). Five-leaf sample verified against
   source: one stale pointer, no contradicted frames, no demotions. Audit note
   `docs/audits/memory-routine-audit-2026-09-17.md`; §18 metrics row appended.
3. **Two oversize leaves split, commit `03bf0d8a`.** `project-reviewer-apps-redesign-direction`
   59,150 → 11,473 B and `project-j27-doc-capture-evolution` 11,747 → 7,891 B; history
   moved verbatim to closed leaves `project-reviewer-apps-redesign-history` and
   `project-j27-doc-capture-history` (line-multiset check: 0 lines lost). Both indexed in
   the archive.
4. **Codex branch `codex/ops-meeting-2026-09-16` (commit `1b5b2717`) merged as `8bc3b530`
   and deployed (`p91w1wbax`, Ready 12:50:55 PDT).** Owner outcomes recorded in
   `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.6 and
   `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`: reminder-cron schedule still open (item 1);
   PC manual-reminder race already guarded since S507 `90641978` (item 3); optional
   "other" upload stays hidden (item 4); Cycle Dossier drain cron changed to
   `*/5 * * * *` in `vercel.json` (item 6, live). Brief committed at
   `docs/plans/OPS_MEETING_2026-09-16_CODEX_BRIEF.md`. Follow-up `6ed14ae9` gave the
   ops-meeting leaf a Recall Rule and verified basis.
5. **Worktree parked.** `../WMKF_Apps-codex` is clean on `codex/parked` at `6ed14ae9`;
   local task branch deleted, `origin/codex/ops-meeting-2026-09-16` retained. A stale
   stash from 2026-07-02 (`codex/scratch`, a Next 9 / next-auth 3 package downgrade) was
   inspected read-only and dropped on the owner's direction.
6. **`~/.claude` config repo** (outside this repo): a stalled rebase was finished by the
   owner, and `skills/synced/` was added to its `.gitignore` so the SessionStart
   auto-pull works again.

### Commits (main)
- `c39e43ed` - memory: diet the router below the 8 KiB trigger (8,239 -> 6,921 B)
- `724d4e52` - memory: complete the §6 routine audit (health flags 21 -> 9)
- `03bf0d8a` - memory: split the two largest routed leaves into active + closed history
- `1b5b2717` - docs: record September operations decisions (Codex, on branch)
- `8bc3b530` - Merge codex/ops-meeting-2026-09-16
- `6ed14ae9` - memory: recall rule and verified basis for the ops-meeting outcome leaf

## Next Items

### Verified Open

1. **Bundle rebuild after a new review** was never smoked in Production (unchanged
   from S517). Evidence: `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md`
   §12 step table ("NOT RUN — no third review submitted"). Needs a third ZZTEST-03
   reviewer submission via the portal, then "Download all reviews (PDF)" on the briefing
   page should rebuild.
2. **Memory deep-audit remainder.** Evidence: audit note "Unknowns" section. Shrink
   `project-site-visit-materials-planning-handoff` (7.6 KB, ship-status description now
   duplicated by the archive); the other four oversize-routed leaves are accepted.
   `check:memory-health` is advisory and prints 5 flags, all oversize-routed.

### Owner Decision Needed

1. **Applicant-materials reminder cron schedule** for
   `/api/cron/site-visit-materials-reminders`. Evidence: plan §16.6 item 1; memory
   `project-ops-meeting-2026-09-16-agenda.md` (active, sole open line). The owner is
   talking with the team; do not infer a schedule. When decided: one `vercel.json` line,
   plan §16.6 item 1, close the memory; gates `check:reviewer-reminder-hold` and
   `check:api-routes`.
2. **Plan §11 "Open for owner" (PR #312):** unconvertible review fails Share closed vs a
   placeholder page; Unicode reviewer names need `@pdf-lib/fontkit` + a bundled TTF;
   separator-page content; the three bundle bounds as code literals (memory
   `feedback-mutable-parameters-not-in-code`). Unchanged from S517.
3. **Plan §10.4 residual (PR #311)** and **plan §12 accepted residual (Codex round 3)**:
   unchanged from S517.
4. **Managed private-repository migration gates** (unchanged from S514). Evidence:
   `docs/MANAGED_PRIVATE_GITHUB_REPOSITORY_MIGRATION_PLAN.md`.
5. **Memory-drift report refresh.** `check:memory-drift` evaluates a committed report it
   flags as stale; `npm run refresh:memory-drift` is an authorized live refresh
   (production reads) and was not run.

### Parked

1. Plan §8 (vi) panel defaults-seed case and the To-field caret splice (plan §12 note 1);
   plan §8 remaining items; plan §12 note 3 (Administration "Guarded reopen attempts"
   shows Pre-Site only). Unchanged from S517.
2. Five protected historical branches; reviewer-institution Phase 3 flags (unchanged).

### Verify Before Acting

1. ZZTEST-03 residue: the regenerated brief is locked and previewed (not sent) as the
   current share; the 9:20 AM sent row and shared briefing link remain; abstract restored
   by the owner. A future smoke should start from this state.
2. The #311/#312 conflict resolution (`dcc9c796`) and the fixture fix (`8f8cfc1b`) are
   test-verified but were never Codex-reviewed.
3. Router diet landing point (6.9 KiB / 52 leaves) is above the §10 target (~6 KiB /
   ~45); the remaining leaf lists are Working Norms feedback entries with no wiki hub.
   Going further needs a norms hub page, which is a design choice, not a cleanup.

### Do Not Reopen Without New Decision

1. **Cycle Dossier drain cadence is `*/5 * * * *`** (owner, 2026-09-16, confirmed again
   at S518 close). Recorded in `docs/CYCLE_DOSSIER_PILOT_DESIGN.md` with the accepted
   wall-clock tradeoff. Do not reopen Vercel Workflow or alternative scheduling.
2. Ops-meeting items 2–6 (plan §16.6). Item 3's guard exists since S507 `90641978`.
3. Owner decisions B1–B14 in the Pre-RP Brief plan; Word snapshot identity is the
   governed content hash; confirmed sends render only **Sent for delivery.**

## Key Files Reference

| File | Purpose |
|---|---|
| `.claude-memory/MEMORY.md` | Router, dieted to 6,921 B; leaf lists now live in wiki Durable Memory sections |
| `docs/audits/memory-routine-audit-2026-09-17.md` | Full §6 audit note: dispositions, five-leaf sample, splits, unknowns |
| `docs/MEMORY_HYGIENE_RUNBOOK.md` §18 | Metrics row for 2026-09-17 |
| `.claude-memory/project-ops-meeting-2026-09-16-agenda.md` | Ops-meeting outcomes; item 1 is the only open line |
| `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.6 | Ops-meeting record for the materials workflow |
| `docs/CYCLE_DOSSIER_PILOT_DESIGN.md` | Five-minute drain cadence decision and tradeoff |
| `vercel.json` | `drain-cycle-dossiers` at `*/5 * * * *`; reminder route still absent |
| `docs/plans/OPS_MEETING_2026-09-16_CODEX_BRIEF.md` | The Codex brief, committed for cross-machine recovery |

## Testing

```bash
npm test -- --runInBand --silent
npm run lint
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:memory-health          # advisory; expect 5 oversize-routed flags
npm run check:reviewer-reminder-hold # any vercel.json edit
```

Session 518: all `check:*` gates green at start and at every commit; Codex branch gates
green in the worktree before merge and on the merged tree before push.
`report:claim-evidence-pilot -- --current` recorded no eligible plan/design edit; no
observation row added.
