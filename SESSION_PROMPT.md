# Session 599 Prompt: Plan A done; Site Visit server slices C1–C3; worktree pruning; /admin live check

## Session 598 close — tool-app prompts and models editable in /admin (Plan A, Stages 0–6), four streaming-error fixes, Plans B and Postgres parked (Claude Opus orchestrating Sonnet + Codex, shared checkout `main`, 2026-10-12 PT)

### What Was Completed

1. **J27 gate red → green.** Two register rows re-pointed from `pages/admin.js` to the admin section
   files after the Session 596 split (`d5d284258`).
2. **Four streaming tool-app error bugs fixed (Production).** Expense Reporter `sendError` scope
   (`ReferenceError` after headers); Funding Gap page swallowing error frames; Literature Analyzer and
   Multi-Perspective Evaluator routes trying `res.status(500).json` after streaming and pages ignoring
   error frames (now `event:'error'`; per-paper `paper_error` stays non-fatal). Codex approve. Merge
   `a804f63bc`, deploy Ready.
3. **Plan A — tool-app prompts and models editable in Admin → Prompt Templates (Production).**
   Owner decisions: editability is a sufficient prompt→Dataverse trigger (SYSTEM_MODEL fork resolved,
   `ce311e82c`); no Executor — shared resolver seam; model on the row (apps removed from Model Config);
   no fallback model; no temperature (verified against Anthropic's live Haiku 5.5 / Sonnet 5.5
   migration guides). Built Stages 0–5 (Sonnet builds, Opus review, Codex: Stage 0+1 round 1 three
   medium findings fixed, then approve; Stages 2–5 approve). 14 rows seeded in production Dataverse by
   the owner with the operator `DATAVERSE_PROD_WRITE_ACK` (the interlock correctly denied the agent's
   local→prod write); merge `f56125cfa` (PR #474); owner live checks passed. Stage 6 close-out: 408
   golden fixtures replace the old builders, old modules deleted, docs reconciled; Codex approve; merge
   `10d89b54a`, deploy Ready. Plan: `docs/plans/AI_TOOL_APPS_EXECUTOR_CONVERGENCE_PLAN_2026-10-11.md` §8.
4. **Plan B (flat `lib/services` relocation) tabled** with a gate hazard recorded (moving files into
   `reviewer-engagement/` silently exempts them from `check:reviewer-engagement-boundary`) (`9a5183d4f`).
5. **Postgres access layer parked** (branch + draft PR #328 kept on GitHub; local worktree removed);
   its "five migration-only tables" finding is NOT a gap — fresh install replays the migration manifest
   (verified on a throwaway Postgres 16) (`d997d7e2a`, `e173de308`).
6. **Cleanup:** 8 merged remote branches deleted; worktrees removed: `WMKF_Apps-refactor-plan`,
   `WMKF_Apps-admin-decomp`, `WMKF_Apps-codex` (transcription-pilot), `WMKF_Apps-factory-form`,
   `.codex/worktrees/test-request-design` (local-only commits, superseded in `main`; last `d6bb6ac05`),
   `.codex/worktrees/debugging`, `WMKF_Apps-investigate`.
7. **Memory:** deploys are verified by commit SHA (`vercel ls --prod -m githubCommitSha=<sha>`), never
   "newest Ready row" — owner: "Your deployment checks almost never work" (`0323116a7`).

### Commits (first-parent on `main`)
- `d5d284258` J27 re-point · `ce311e82c` Plan A decisions · `a804f63bc` merge error fixes
- `9c8ad0789` Plan A rewrite · `f56125cfa` merge Plan A Stages 0–5 · `0323116a7` deploy memory
- `a29de4921` Plan A live · `10d89b54a` merge Stage 6 · `9a5183d4f` Plan B tabled
- `d997d7e2a`, `e173de308` work-queue parking

## Next Items

### Verified Open

1. **Site Visit server slices C1–C3** (plan §6/§10, not started). Evidence:
   `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md` §10.
2. **Correction-draft server re-check** (load/save/publish of an existing draft while a newer transcript
   is pending is blocked only in the page). Evidence: same plan §10.
3. **Measure a 4-vCPU cut, then lower `PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS`** (carried, not
   rechecked). Evidence: `docs/CREDENTIALS_RUNBOOK.md` Stage 4 table.

### Owner Decision Needed

1. **Remove 14 fully merged worktrees** (verified 2026-10-12: every commit in `origin/main`, no
   uncommitted changes): `codex/feature-request`, `codex/deliberations-card-guidance`,
   `codex/workbench-responsiveness`, `codex/factory-reviewer-b4-runtime`,
   `codex/test-request-email-recipients`, `codex/zoom-attendance`, `codex/meeting-transcript-ux`,
   `codex/test-request-preview-integration`, `claude/ui-work`, `claude/factory-recipe4c-presite-personnel`,
   `claude/factory-recipe4a-composition`, three `.claude/worktrees/agent-*`. Re-run the merged/dirty check
   before removing. Keep `codex/proposal-ranking` (paused) and `codex/leadership-dashboard-testing`
   (recommended keep, owner has not decided; holds the only copy of `docs/audits/LEADERSHIP_DASHBOARD_READINESS_2026-10-04.md`
   plus an uncommitted `package-lock.json` change).
2. **Owner live check of `/admin`** after the Session 596 decomposition (not recorded as done).
3. **Proposal Ranking stays paused** (PR #463 draft, open). Resume with the owner's process decisions.
4. **Optional Plan A follow-ups (owner to request):** make max tokens editable in Prompt Templates
   (read-only today, `PromptTemplatesSection.js`); add Sonnet 5.5 / Haiku 5.5 to the model registry
   (`lib/services/model-capabilities.js`; tiers resolve to `claude-sonnet-5` / `claude-haiku-4-5`).
5. **Widen the auto-mode merge rule** for temporary-worktree pushes (carried).

### Parked

1. **Flat `lib/services` relocation (Plan B)** — `docs/plans/FLAT_SERVICES_RELOCATION_PLAN_2026-10-11.md` §7.
2. **Postgres access layer** — `docs/CURRENT_WORK_QUEUE.md` Parked; GitHub branch
   `claude/postgres-access-layer`, PR #328 (do not merge).

### Verify Before Acting

1. **Dependabot PR #471** (still open): keep the lock npm-10 compatible (`npx -y npm@10 ci --dry-run`).
2. **Stale `model_override:<key>` rows** for the five Plan A apps may sit unreachable in Postgres app
   settings; harmless. Delete only on an explicit owner request after listing them.

### Do Not Reopen Without New Decision

1. Plan A design (seam not Executor, model on the row, no fallback model, no temperature) — §8.
2. The five-table "fresh-install gap" — not a gap (`e173de308`).
3. Session 597's list (header chip, correction gate, `BTN_LINK`).

### Gotchas

- The prompt rows are editable by superusers only; an `/admin` edit that removes `{{a7_preamble}}` or
  changes variables is rejected at publish (declared == used), so the injection preamble cannot be
  dropped from `/admin`.
- Production Dataverse writes from a local script need the operator to set
  `DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"` in their own shell; the agent hands over the
  command (`!` prefix), never sets it.
- `.env.local` targets production Dataverse (`wmkf.crm.dynamics.com`); seed dry runs are production reads.
- `grep` in this shell is a wrapper that treats `lib/utils/ai-payload-boundary.js` as binary — use
  `command grep -a`.
- New worktrees lack the per-machine `.agents/skills` symlink, which turns `check:agent-wiki` red there
  only; create it (`mkdir -p .agents && ln -s ../.claude/skills .agents/skills`).

**Milestone determination:** Plan A shipped a new production capability — DEVELOPMENT_LOG entry exists
("Tool-app prompts and models editable in Admin → Prompt Templates (Plan A, Session 598)").

---

## Session 598 Prompt (superseded): Owner checks (/admin, Plans A/B); Site Visit server slices C1–C3; Proposal Ranking paused

## Session 597 close — Site Visit header chip, server-side correction gate, Button link variant shipped (Claude, shared checkout, 2026-10-11/12 PT)

Numbering: this session started as "596" alongside the Fable session whose close sits below. It is recorded as
**597** so the two do not collide; the next session is 598.

### What Was Completed

1. **Correction gate (Production).** `createMeetingCorrection` returns 409 `meeting_transcript_newer_pending`
   ("A newer transcript is on its way. Wait for it before editing the published transcript.") while a newer
   transcription is pending. The rule lives in `shared/utils/meeting-transcript-pending.js` and the card uses
   the same helper. Codex approve. Merge `b3135037c`, deploy verified. **Remaining UI-only gap:** loading,
   saving or publishing an existing correction draft is not re-checked on the server.
2. **Header status chip (Production).** `shared/utils/site-visit-header-status.js`; the Applicant materials
   card and the Recording and transcript card each report their own state (`onStatusChange`), and the
   `SiteVisitEditor` header shows the first unfinished stage (mapping table in plan §10). Owner decisions:
   closed collection = finished; "recording" = a published meeting transcript (survives Stage 5 deletion).
   Codex three rounds (two real findings fixed: stale data after a failed Refresh; failed first video read),
   then approve. Owner desktop check on 1003222 ("Board page ready", all three Board lines on). Merge
   `cbb2269ed`, deploy verified.
3. **Button link variant (Production).** Shared `Button` `variant="link"` (`shared/components/Layout.js`)
   replaces all 11 `BTN_LINK` actions in `RecordingAndTranscriptCard.js`; no visual change. **DESIGN.md
   rule 11** now lists `link` for quiet in-place actions (owner chose updating the rule over outline buttons).
   Codex approve. Merge `ee3d60c60` (pushed by the owner after the classifier blocked the push), deploy
   verified Ready.
4. **Merge permission.** `~/.claude/settings.json` `autoMode.allow` gained an owner-approved rule for merging
   reviewed `claude/*`/`codex/*` branches into `main` and pushing when the owner says to merge. It does not
   reliably cover `git push origin HEAD:main` from a temporary worktree (blocked once, allowed once); see
   `.claude-memory/feedback-merge-to-main-from-temp-worktree.md`.
5. **Local preview setting found:** `.env.local` also needs `MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY=on`
   (Production has it since 2026-10-02). Without it the summary status reads 503 and the presentation video
   row wrongly shows "Out of date". The owner added it.
6. **Proposal Ranking paused** (Codex handoff, incorporated at the owner's request; details under Owner
   Decision Needed).

### Commits
- `e4dd53353` correction gate → merge `b3135037c`
- `e6961b4d3`, `efcca8bb2`, `99abcc932`, `bc92b35b8`, `e33a9a613`, `3b66ca5e6` header chip → merge `cbb2269ed`
- `0a3295de5`, `cdef0dc03` link variant + DESIGN.md rule 11 → merge `ee3d60c60`

## Next Items

### Verified Open

1. **Site Visit server slices C1–C3** (plan §6/§10, not started): C1 generate split transcripts automatically
   after a publish with a confirmed end; C2 the real reason a presentation video was superseded; C3 stream the
   review video instead of downloading it. Evidence: `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md` §10.
2. **Correction-draft server re-check** (load/save/publish of an existing draft while a newer transcript is
   pending is blocked only in the page). Evidence: plan §10 gate entry; `lib/services/meeting-tracker-transcription/service.js`.
3. **Fix `process-expenses.js` `sendError` scope bug** — still present 2026-10-12 (declared inside `try`
   at :190, called from `catch` at :429). Evidence: Session 596 item 5 below.
4. **Measure a 4-vCPU cut, then lower `PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS`** from 3 h to about 90 min
   (carried, not rechecked). Evidence: `docs/CREDENTIALS_RUNBOOK.md` Stage 4 table.

### Owner Decision Needed

1. **Owner live check of `/admin`** after the Session 596 decomposition (`56a1945c5`, deployed). Evidence:
   Session 596 Next Items below.
2. **Plan A D1–D9 (D7 first) and Plan B D1–D6.** Evidence: Session 596 Owner Decision Needed below.
3. **Proposal Ranking is paused** while Justin considers the process with colleagues and leadership. No
   ranking code change, merge, deployment or live-data operation is authorized. **Resume with Justin's
   process decisions, not implementation.**
   - Saved implementation: checkout `/Users/gallivan/Code/WMKF_Apps-codex-proposal-ranking`, branch
     `codex/proposal-ranking`, draft PR #463 (head `0d161d60f`, verified 2026-10-12). `5edcac077` adds
     institutional research funding context; `0d161d60f` hides it during individual ranking, preserves
     calculated meeting starting orders and adds CSV export. Codex reports a clean tree, 167 ranking tests
     and the isolated meeting/export rehearsal passing. Unmerged and undeployed.
   - Discussion proposal (not approved policy; the app does not implement it):
     `/Users/gallivan/Documents/Codex/2026-10-11/justin-requests-a-separate-research-task/outputs/Research_Funding_Recommendation_Proposal.docx`.
     Sequence: (1) every PD places each proposal A—fund / B—maybe fund / C—don't fund, plus "I'm comfortable
     with this placement" or "I'm not sure"; (2) discuss the science within SE and MR, focusing on
     uncertainty and disagreement; (3) PDs revisit placements and give individual program rankings;
     (4) equally weighted average ranks are starting orders for collective deliberation; (5) develop the
     overall recommendation, considering budget and institutional context at the margins.
   - Preserve: everyone responds, no passes (rare conflicts handled by discussion, not coded exceptions);
     uncertainty is not opposition; agreement informed by colleagues is not multiple independent technical
     validations; "worth funding but below budget" differs from "not recommended on merit"; settle SE and MR
     separately before cross-program choices (program ranks do not establish cross-program equivalence); the
     general 2:1 West/East target is by award count, not dollars, and not mandatory each cycle; funding
     history uses qualifying regular Research-program awards (excluding directed gifts, buildings,
     endowments, teaching awards, Special Grants, Young Scholars); institutional considerations get no
     numerical points and do not change scientific scores; leadership keeps its own notes (no required
     discussion-note workflow or finalization lock).
   - Open leadership questions: timing of individual rankings; whether every PD needs an overall ranking;
     whether ties are acceptable; what individual results accompany the collective list.
   - Continuity: preserve the idle Codex chat "Continue Proposal Ranking work" and the receiving chat
     `01a12d8b-9bf0-7003-aa82-479c67fd6421` (reconciliation + latest proposal). The original workbook
     `/Users/gallivan/Downloads/D26_PD_ranking_sheet.blank.xlsx` is unchanged.
   - Existing trial cleanup, facilitator restoration and colleague dry runs need fresh state verification
     and explicit authorization.
4. **Delete merged remote branches** — all verified ancestors of `origin/main` on 2026-10-12:
   `claude/site-visit-status-chip`, `claude/button-link-variant`, `claude/correction-newer-pending-gate`,
   `claude/admin-decomposition`, `claude/workbench-summary-text`, `claude/workbench-summary-links`,
   `claude/staff-reader-video`, `claude/workbench-recording-superuser`. Re-run
   `git merge-base --is-ancestor origin/<b> origin/main` before deleting.
5. **Remove Session 596 worktrees** `WMKF_Apps-refactor-plan` and `WMKF_Apps-admin-decomp` (still present;
   the latter holds `main`, which is why `git checkout main` fails in the shared checkout).
6. **Widen the auto-mode merge rule** to cover pushing a tested merge from a temporary worktree, or keep
   handing the owner the push command. Evidence: item 4 above.

### Verify Before Acting

1. **Dependabot PR #471** (17 minor/patch bumps, still open): keep the lock npm-10 compatible
   (`npx -y npm@10 ci --dry-run`) before merging. Evidence: `project-ci-npm10-lockfile-parity.md`.

### Do Not Reopen Without New Decision

1. Site Visit header chip, correction gate, `BTN_LINK` convergence — shipped (merges above).
2. An out-of-date presentation video leaves the Board page, so the chip already drops to "Board page
   incomplete"; no separate chip rule needed (owner agreed 2026-10-12).
3. Session 596's list below (route-shell helper NO; Workbench code splitting / client cache).

### Gotchas

- The shared checkout (`/Users/gallivan/Code/WMKF_Apps`) is left on the merged branch
  `claude/button-link-variant` with a dev server possibly still running on :3000; `main` is held by
  `WMKF_Apps-admin-decomp`. Switch branches deliberately at session start.
- Safari's Tab key skips buttons by default (Option-Tab), so ask the owner to check focus rings in Chrome.
- GitHub records no Vercel deployment/status for these `main` pushes; check `vercel ls --prod` once.
- `profile-settings-email-signature.test.js` failed once under full-suite load and passes alone (flaky).

**Milestone determination:** three Production changes shipped (chip, server gate, Button variant); a
DEVELOPMENT_LOG entry was added (Session 597).

---

## Session 597 Prompt (superseded): Decide on Plans A/B; Proposal Ranking review; Site Visit §10 remainder

## Session 596 close — refactor census, three staged plans, admin page decomposition shipped (Fable orchestrating Sonnet/Opus/Codex, 2026-10-11/12 PT)

### What Was Completed

1. **Reconnaissance without disturbing concurrent agents** (read-only): another Claude session held the
   shared checkout on a feature branch for the whole session; this session worked only in its own
   worktrees (`WMKF_Apps-refactor-plan`, then `WMKF_Apps-admin-decomp`). The idle Ultrareview cloud
   sessions were confirmed harmless (their branches are gone).
2. **Census of the largest unplanned refactor** — `docs/plans/LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md`.
   Most obvious candidates were already decided (route-shell helper: owner NO; Workbench code splitting:
   measured and rejected; client cache: omitted; size-only splits: survey). Three live candidates ranked.
3. **Three staged plans**, each verified by a fresh-context agent with mismatches logged:
   - **A** `AI_TOOL_APPS_EXECUTOR_CONVERGENCE_PLAN_2026-10-11.md` — 9 owner decisions first. Finding:
     recorded policy says prompt migration is *demand-driven* (`project-system-model.md:37`), so A proposes a
     policy change and cannot start without D7. The "streaming" apps make unary model calls; the real
     Executor gaps are three multimodal call sites and per-call `wmkf_ai_run` rows.
   - **B** `FLAT_SERVICES_RELOCATION_PLAN_2026-10-11.md` — four waves driven by a codemod + census; 176-row
     ledger and notes under `docs/plans/data/`, probe scripts `scripts/probe-flat-services-ledger*.py`.
   - **C** `ADMIN_PAGE_DECOMPOSITION_PLAN_2026-10-11.md` — executed this session (below).
4. **Plan C executed end to end** (owner-chosen pipeline: Sonnet builds, Opus reviews each stage, Fable
   final review + fixes, Codex adversarial review after Stage 1 and at the end): `pages/admin.js` 3,649 →
   120 lines; 23 new files under `shared/components/admin/`; pure moves (byte-identical, multiset-checked;
   Codex AST diff 53/53); new 21-view coverage test; full suite 22,693 green; memory reconciled.
   **Merged `56a1945c5` (PR #473), ready to deploy; owner has not yet checked `/admin` live.** Stage 6
   (code splitting) omitted by plan default. Every verdict is in the plan's §7.
5. **Bug found in passing, not fixed:** `pages/api/process-expenses.js` declares `sendError` inside the
   `try` (:190) and calls it from the `catch` (:429) → `ReferenceError` on the after-headers error path.

### Commits (all on `main` via PR #473, merge `56a1945c5`)
- `1e34ddeec`, `9283a67da` — census + three plans + ledger/probe scripts/route profiles
- `fad38462a`, `b96713a6e` — Stage 0 coverage test (+ Opus fixes)
- `d357edd78`..`899324c6b`, `99fadde01` — Stage 1 (Operations sections) + review fix
- `13494d27e`, `f875ff01a`, `b87d0e12e` — Stage 2 (AI sections) + review fix
- `9c7dc03d7`..`55be9922c`, `85fbc0a79` — Stages 3–4 (Workflows, People sections) + log
- `52282fb7c`..`7a0a7dfe6`, `d3126e433`, `0ce8898e3` — Stage 5 (workspaces, constants, test re-points) + reconciliation + logs

## Next Items

### Verified Open

1. **Owner live check of `/admin` after deploy** (every workspace/view renders; this is a pure move but the
   production deployment of `56a1945c5` has not been eyeballed). Evidence: PR #473 merged; CI 12/12 green;
   no live check recorded in the plan's §7.
2. **Review Codex's Proposal Ranking work** — PR #463 is still a draft, updated 2026-10-12, worktree clean
   at `0d161d60f` ("Keep PD preparation science-first and export meeting rankings"). Evidence:
   `gh pr view 463`; `git -C /Users/gallivan/Code/WMKF_Apps-codex-proposal-ranking log -1`.
3. **Fix `process-expenses.js` `sendError` scope bug** (one line; Tier 0/1). Evidence: item 5 above;
   `docs/plans/AI_TOOL_APPS_EXECUTOR_CONVERGENCE_PLAN_2026-10-11.md` §1.1 row 4.
4. **Measure a 4-vCPU cut, then lower `PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS`** (carried from Session 595,
   not rechecked). Evidence: `docs/CREDENTIALS_RUNBOOK.md` Stage 4 table; queue "Speed up the presentation
   video cut".

### Owner Decision Needed

1. **Plan A (AI tool apps → Executor): D1–D9**, above all **D7** — adopt staff editability as a sufficient
   trigger for moving a Vercel-only prompt into Dataverse (reverses the recorded demand-driven framing), or
   shelve A. Evidence: plan §2; `.claude-memory/project-system-model.md:37`;
   `.claude-memory/feedback-cycle-vs-executor-scope.md`.
2. **Plan B (flat `lib/services` relocation): D1–D6** — review the 77 `med`/`low` ledger rows, confirm the 9
   new directories, name merge windows. Evidence: plan §2; `docs/plans/data/FLAT_SERVICES_MOVE_LEDGER_2026-10-11.tsv`.
3. **Admin Stage 6 (per-workspace dynamic import)**: omitted by default; reopen only with a bundle
   measurement and the 5 % gate. Evidence: plan Decision 5; Codex #2 verdict in §7.
4. **Proposal Ranking PR #463 merge/promotion, Production cleanup, colleague dry run** (carried). Evidence:
   Session 587 handoff; Codex owns the branch.
5. **Delete merged remote branches**: `claude/admin-decomposition`, `claude/correction-newer-pending-gate`
   (both ancestors of `origin/main`) and Session 595's four (`claude/workbench-summary-text`,
   `claude/workbench-summary-links`, `claude/staff-reader-video`, `claude/workbench-recording-superuser`).
   Confirm each with `git merge-base --is-ancestor origin/<b> origin/main` before deleting.
6. **Remove this session's worktrees** `WMKF_Apps-refactor-plan` (local branch `claude/refactor-scope-plan`,
   never pushed; its commits are in `main` via #473) and `WMKF_Apps-admin-decomp` (now on `main`). Both
   have `node_modules` installed; each also has a per-worktree `.agents/skills` symlink.

### Verify Before Acting

1. **Site Visit redesign §10 remainder** — another session is mid-flight: the shared checkout sits on
   `claude/site-visit-status-chip` at `e33a9a613` ("Site Visit header chip built; owner desktop check
   pending"), unmerged. Do not start the status chip; check that branch/PR state before touching C1–C3,
   `BTN_LINK` convergence. Evidence: `git -C /Users/gallivan/Code/WMKF_Apps rev-parse --abbrev-ref HEAD`;
   `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md` §10. The `createMeetingCorrection` gate shipped
   (`b3135037c`).
2. **Dependabot PR #471** (17 minor/patch bumps): the lock must stay npm-10 compatible
   (`npx -y npm@10 ci --dry-run`) before merging. Evidence: `project-ci-npm10-lockfile-parity.md`.

### Do Not Reopen Without New Decision

1. Shared API route-shell helper — owner NO (`docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:638`).
2. Workbench per-tab code splitting (rejected trial, 0.7135 %) and shared client cache (omitted) —
   `docs/plans/WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md:36-37`.
3. Session 595's closed items (Board link for 1003222; `PRESENTATION_VIDEO_SPLIT_ACCESS=on`; Meeting
   Tracker recording visibility).

### Gotchas

- This repo's ESLint does not report unused imports; prove import hygiene by counting uses (three
  stages each left one stale import behind until a reviewer counted).
- Jest 30: the flag is `--testPathPatterns` (plural). `--testPathPatterns 'admin|Section'` matches
  essentially the whole suite (~50 s), which is fine as a full run.
- Turbopack refuses `next build` in a worktree whose `node_modules` is a symlink; run builds in a worktree
  with its own `npm ci`.
- The shared checkout drifted to other sessions' branches twice this session; every git action here was
  done in a dedicated worktree, and session docs landed on `main` from `WMKF_Apps-admin-decomp`.
- A verifier agent's fresh context only covers one document: cross-document contradictions (census
  vs plan) need an explicit reconciliation pass after corrections.

**Milestone determination:** the admin page decomposition shipped to `main` (production auto-deploys), a
layout change a future reader will search for, so a DEVELOPMENT_LOG entry was added.

---

## Session 596 Prompt (superseded): Site Visit redesign remaining work (plan §10); Proposal Ranking with Codex

## Session 595 close — staff reading page, Workbench presentation video, video cut on for all requests (Claude, main, 2026-10-11 PT)

### What Was Completed

1. **Board page owner check closed:** View on Proposal, Slides and Bios works on desktop and iPad Safari (owner).
2. **Codex set up for Proposal Ranking:** worktree `/Users/gallivan/Code/WMKF_Apps-codex-proposal-ranking` on `codex/proposal-ranking` (draft PR #463), fast-forwarded and merged with current `main` (`5ec0133ca`, pushed; 131 ranking tests pass; npm 10 lock check passes). The owner holds the coordination prompt. The branch's own handoff names a worktree path that no longer exists; the prompt corrects it.
3. **`PRESENTATION_VIDEO_SPLIT_ACCESS=on` in Production** (owner, stored as Config, live with deployment of `e54c4fcac`). Atlas Stage 4 status corrected (`e54c4fcac`). Vercel CLI 63 stores new variables as Secret unless `--type config` (runbook note).
4. **Housekeeping (owner-run):** Stage 4 worktrees `-stage4`, `-stage4-recipe`, `-stage4-s4`, `-stage4-s5` removed; 8 local and 7 remote merged branches deleted, each confirmed merged first.
5. **Workbench summaries with headings and lists** (merge `99c91df93`): shared `SummaryText` gains a compact size; `DISCUSSION_SUMMARY_HEADINGS` added; collapsed preview capped at 700 characters (Codex finding).
6. **Staff reading page and Workbench video** (merge `b9d0d0ff2`; plan `docs/plans/STAFF_READER_AND_VIDEO_PLAN_2026-10-11.md`, Codex approved the plan in round 2 and each slice):
   - `/workbench/read` (reviewers or meeting-tracker): transcripts as timed speaker turns (`TranscriptText`), summaries via `SummaryText`; opened from Workbench and Site Visit card links for plain-text items; PDF/DOCX/VTT keep SharePoint.
   - `GET /api/workbench/site-visit/presentation-text`: five types, TXT only, size + SHA-256, 3 MB source / 4 MB response budgets.
   - `GET /api/workbench/site-visit/presentation-video`: approved cut only (Board rule); logistics feed adds `presentationVideoPlayable` for the Workbench only; shared `PresentationVideoPlayer` used by the Board page too.
   - Owner decision: every staff page allows `media-src` from the SharePoint tenant (CSP is fixed per document; client navigation).
   - Summary links hidden when the summary is shown; "Open full transcript" / "Watch full recording" labels.
   - Verified live in the owner's session on 1003222: video plays and seeks after a direct load and after in-app navigation; reading page shows the real presentation transcript.
7. **Workbench full recording superuser-only** (merge `4a73c847e`, `9c4dbad45`): server drops the RECORDING item for non-superusers. Owner rationale: declutter daily use, not secrecy; Meeting Tracker keeps it.
8. Queue item "Show transcripts and summaries formatted in the browser" closed (`71d7a4e5d`).

### Next Items

#### Verified Open

1. **Site Visit redesign remaining work** (owner chose next session): header status chip; server slices C1-C3 (auto-generate split transcripts after publish, real cancel reason, stream the review video); `BTN_LINK` convergence; server-side gate in `createMeetingCorrection` while a newer transcript is pending. Evidence: `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md` §10.
2. **Review Codex's Proposal Ranking work when it reports** (worktree above; Claude does not edit ranking files meanwhile). Evidence: `git -C /Users/gallivan/Code/WMKF_Apps-codex-proposal-ranking log main..codex/proposal-ranking`.
3. **Measure a 4-vCPU cut, then lower `PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS`** (3 h now; target about 90 min); more cuts will now happen since the flag is on. Evidence: `docs/CREDENTIALS_RUNBOOK.md` Stage 4 table; queue "Speed up the presentation video cut".

#### Owner Decision Needed

1. Proposal Ranking PR #463 merge/promotion, Production cleanup (old unpublished trial, default facilitator) and the colleague dry run. Evidence: Session 587 ranking handoff below; Codex now owns the branch.
2. Delete merged remote branches from this session: `claude/workbench-summary-text`, `claude/workbench-summary-links`, `claude/staff-reader-video`, `claude/workbench-recording-superuser` (all merged into `main`; confirm with `git merge-base --is-ancestor`).

#### Do Not Reopen Without New Decision

1. New Board link for 1003222: owner said not needed (Session 595).
2. Widening `PRESENTATION_VIDEO_SPLIT_ACCESS`: done (`on`).
3. Meeting Tracker recording visibility: stays for Meeting Tracker users (owner, Session 595).

### Gotchas

- `vercel env add` (CLI 63) defaults to Secret; pass `--type config` for readable flags, and `--value` rather than `echo`.
- Chrome defers media loading in a hidden tab: test video playback in the visible tab (a hidden-tab stall looked like a CSP failure).
- Unauthenticated `curl` of a staff page redirects before the CSP is applied, so it cannot show the staff `media-src`.
- Local previews of staff pages: `Reader` in `pages/workbench/read.js` takes a `Shell` prop; a temporary page under `pages/external/` with a fake `AppAccessContext` value and a fetch stub works. Delete it before committing.
- Codex review sandbox cannot run jest; all test results come from local runs (full unit suite 21,931 passing at `71a5b37aa`).

**Milestone determination:** staff reading page and Workbench presentation video shipped to Production, so a DEVELOPMENT_LOG entry was added.

---

## Session 595 Prompt (superseded): Board presentation page redesigned and working end to end

## Session 594 close — Board video fixed, Board page redesigned for board members, proposal and Office viewing added (Claude, main, 2026-10-11 PT)

### What Was Completed

1. **Board video link fixed** (merge `81dbc6c66`). The approved 1003222 video stopped opening (Watch, Download, Resume) because SharePoint bumped its eTag on a metadata-only change (owner-run probe: eTag `,3`→`,4`, size and quickXorHash unchanged). The Board route now binds the video to the approved cut's size + quickXorHash (`getApprovedPresentationVideoByDocument`). Verified live (206 `video/mp4`).
   - Owner decisions: Codex's quickXorHash-collision finding **accepted as outside the threat model** (SharePoint writers trusted; applicant files carry no byte check); transcripts/summaries **stay on eTag** until one breaks (queue item has the versionId follow-up). Recorded in `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md` "Board link fix".
2. **Board page redesigned with Impeccable** (merge `f35ae70f7`, then `35d5456d2`, `e05bbd962`, `700619a76`, `7b9746f7b`). `pages/external/presentation/[token].js`:
   - Proposal title as H1; video first (one-click play); summary rendered on the page via shared `shared/components/SummaryText.js` with an **AI-generated** badge (server returns the text only when size + SHA-256 match the published row; 4 s deadline); Materials rows show **View only** (no filenames, sizes, or download links); full transcript no longer listed; one quiet line before the visit.
   - **Proposal** (owner decision reversing 2026-09-21): the external-reviewer PDF via member `proposal`, found by a strict complete lookup (`listReviewerProposalStrict`); the page asks `mode=check` after render (lookup takes 4–8 s) on its own rate-limit buckets.
   - **View**: Microsoft serves every file as a download, so the page fetches the PDF and opens a blob copy in a new tab; required adding the tenant to `connect-src` on this page only (`proxy.js`). Word/PowerPoint/Excel open via `mode=pdf` (Graph `content?format=pdf`, bounded 4 MB / 20 s through opt-in `downloadFileAsPdf` options). A failed View offers the original.
   - Each slice had a Codex adversarial review; findings fixed or recorded. Verified live: summary text, proposal check, in-browser proposal fetch (2.8 MB PDF), bios conversion (15 KB PDF).
3. **Queue:** new item "Show transcripts and summaries formatted in the browser across the suite" (owner chose Board now, suite next).

### Next Items

#### Verified Open

1. **Owner check of the live Board page**: View on Proposal, Slides, Bios opens a new tab; iPad Safari not yet tried. Evidence: Session 594 live probes.
2. **Suite-wide formatted transcript/summary viewing** (reuse `SummaryText`; staff discussion summary headings). Evidence: `docs/CURRENT_WORK_QUEUE.md`.
3. **Site Visit redesign remaining work** (plan §10), carried from Session 593. Evidence: `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md` §10.

#### Owner Decision Needed

1. **Widen `PRESENTATION_VIDEO_SPLIT_ACCESS`** from `test:<1003222>`; the Board link blocker is fixed. Evidence: `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md`.
2. Delete merged remote branches (`claude/site-visit-redesign` and this session's `claude/board-*`); all are ancestors of `main`.
3. Proposal Ranking PR #463 (draft since 2026-10-08) and the colleague dry run.
4. Optional: issue a new Board link for 1003222 (the current token was pasted into the Session 594 transcript).

#### Verify Before Acting

1. Stage 4 worktrees (`WMKF_Apps-stage4`, `-stage4-recipe`, `-s4`, `-s5`): remove only after confirming no uncommitted work. Sessions 588–590 carryover unchanged.

### Gotchas

- Auto mode blocks Production reads and merges to `main` even after owner approval in chat; hand the owner a `!` command (scripts in the scratchpad print metadata only).
- Board page CSP: `media-src` and now `connect-src` allow only the canonical tenant; any new browser-side fetch elsewhere needs its own CSP review.
- Local preview of the Board page: a temporary page under `pages/external/` (public path) with a fetch stub works; the dev server needs a restart to pick up a new page file. Delete it before committing.
- The strict proposal lookup gives up on folder trees deeper than 3 levels (`failOnDepthLimit`); 1003222 passes.

**Milestone determination:** the Board presentation page shipped a redesigned outside-facing capability (proposal access, on-page summary, in-browser viewing), so a DEVELOPMENT_LOG entry was added.

---

## Session 594 Prompt (superseded): Site Visit redesign shipped; CI green again

## Session 593 close — Site Visit page redesign built, owner-checked, merged and deployed; CI install failure fixed (Claude, main, 2026-10-11 PT)

### What Was Completed

1. **Site Visit page redesign shipped.** Built on `claude/site-visit-redesign` with a Codex adversarial review per commit, owner desktop check on localhost, merged `c574e9e7d`, Production deployment Ready (GitHub deployment for the merge SHA). Docs marked shipped `450272aa0`.
   - Owner decisions 7-12 (plan §8.2): four cards in work order (Recording setup, Presentation, Staff discussion, Board materials); summary before transcript; no full-recording row (full recording will be deleted at Stage 5); full meeting transcript Open + TXT/VTT in step 1's menu.
   - Board materials card: link actions plus a status-only readiness list (`usePresentationVideo`, `publishedSummaryOf`, `collectionCurrent`); six Codex rounds on readiness edge cases; round 6 gap owner-accepted (plan §10).
   - Desktop-check fixes: leftover "Refresh transcription status" buttons removed; contradictory waiting line removed.
2. **CI fixed (PR #472, merge `9aca02fa2`).** Tests and E2E had failed at `npm ci` on every `main` push since `0aca28b9e`: npm 11 wrote a lock that CI's Node 22 / npm 10 rejects (missing nested `chokidar@5`, `readdirp@5`). Added only those two entries; also hardened one CI-timing-sensitive card test. Tests and E2E green on `main`. Memory: `project-ci-npm10-lockfile-parity.md` (`169bff8c1`).
3. `.gitignore` ignores Word lock files under `shared/templates` (`4f5c97d28`); stale lock file deleted.

### Next Items

#### Verified Open

1. **Site Visit redesign remaining work** (plan §10): header status chip; server slices C1-C3 (auto-generate after publish, real cancel reason, stream the review video); `BTN_LINK` convergence; server-side gate in `createMeetingCorrection` while a newer transcript is pending.
   Evidence: `docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md` §10.

#### Owner Decision Needed

1. Optional row renames ("Presentation recording", "Discussion summary/transcript"); current labels kept. Evidence: Session 593 conversation; `RecordingAndTranscriptCard.js` row labels.
2. Delete the merged remote branch `claude/site-visit-redesign`? (offered, not answered).
3. Carried from Session 592, not rechecked this session: widen `PRESENTATION_VIDEO_SPLIT_ACCESS`; Stage 4 SharePoint-writer threat model; Proposal Ranking PR #463 and dry run.

#### Verify Before Acting

1. Carried from Session 592, not rechecked: Board link check for the approved 1003222 video (`pinnedBytesMatch`); Stage 4 worktrees to remove after confirming no uncommitted work; Sessions 588-590 carryover (Proposal Ranking cleanup, paired-summaries checks, PR #470 cleanup test).

### Gotchas

- Localhost needs `MEETING_TRACKER_SCHEMA_READY`, `MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY`, `MEETING_TRACKER_TRANSCRIPTION_ACCESS`, `SITE_VISIT_MATERIALS_SCHEMA_READY`, `PRESENTATION_VIDEO_SPLIT_ACCESS` set to see the full Site Visit page; unset, each feature reports itself off. Owner added `MEETING_TRACKER_SCHEMA_READY` only. Local actions write to the app's Postgres/Blob and call providers even though Dataverse writes are blocked.
- Before pushing dependency changes, check the lock with `npx -y npm@10 ci --dry-run` (CI is npm 10).
- `git merge -F -` does not read stdin; use a message file.
- Codex's review sandbox cannot run jest; all test results come from local runs.

**Milestone determination:** the Site Visit redesign shipped to Production, so a DEVELOPMENT_LOG entry was added.

---

## Session 593 Prompt (superseded): Stage 4 live (first cut approved); Board-link eTag check; Recording and transcript card redesign

## Session 592 close — Stage 4 presentation video built, merged and first real cut approved; three live fixes (Claude orchestrating, Sonnet builds, Codex reviews; main, 2026-10-10 PT)

### What Was Completed

1. **Stage 4 built and merged.** Slices 1-5 on branches, each slice and the whole branch passed Codex adversarial review; merge `e53cb4b9a`.
   - Owner gates done 2026-10-10: migration 079 applied (merge `894826cd5`), migration 080 applied, 100000011 "Presentation Video" added to `wmkf_artifacttype`, pinned FFmpeg uploaded to private Blob, `PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME` set.
   - Production flags: `PRESENTATION_VIDEO_SPLIT_ACCESS=test:e43ae6ea-698f-f111-8076-6045bd018a07` (1003222 only); `PRESENTATION_VIDEO_SANDBOX_VCPUS=4` (set and redeployed by the owner after the first cut).
2. **First real cut on 1003222: approved and registered** (split `d957e094-…`, 2026-10-10 PT). The owner played the output; it ends at the presentation end. Receipt: cut 3,597,257 ms, 89,931 frames, audio packets equal, no edit delay, 40 min on 2 vCPU (encode 22 min), about $0.14 active CPU. Full record: `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md` "First real cut".
3. **Three live defects found and fixed, each on a branch with Codex review:**
   - SharePoint eTag used as content identity; metadata-only bumps superseded valid cuts. Now size + quickXorHash, in-sandbox source hash check, same-response hash on the staff open route (merge `c277afa8f`). Codex round 2 (quickXorHash collision by a SharePoint writer) **rejected by the orchestrator as outside the threat model**; recorded in the build plan for the owner.
   - Non-waiting `getCommand` kept `exitCode` null after the command finished; `commandState` now follows with a 5 s bounded `wait()` (merge `02a5bd146`, Codex approve).
   - Recording and transcript card stayed greyed after a successful transcript publish; owner-token busy claims for publish, save and attendance (merge `4d23ff779`, Codex approve round 3).
4. **quickXorHash parity confirmed live:** the cut script's hash equals Graph's (source and output).
5. **Owner UI notes logged** in `docs/CURRENT_WORK_QUEUE.md`: one "Redesign the Recording and transcript card" item (Copy video ambiguity, off-screen replace confirmation, stacked banners, three refresh controls, hide manual uploads, step order, stale-transcript edit buttons, hinted leavers start unchecked (reverses attendance D2), auto-generate split transcripts after publish, superseded-video message, stream the review video); separate items for the speaker picker using Zoom participants, the Board eTag check, and cut speed-ups.
6. **Attendance attribution exercised live for the first time** (1003222): attendance list loaded from Zoom with leave times and "left before the presentation ended" hints; worked as designed; owner asked for hinted leavers to start unchecked (logged).
7. **Migrations:** Production and `main` end at 080; next free 081 (`.claude-memory/project-migration-numbers-claimed-off-main.md`).

### Next Items

#### Verified Open

1. **Board link check for the approved presentation video (1003222).** The output eTag was unchanged at approval (`,3`), so `pinnedBytesMatch` passed then; the source MP4's eTag moved about 30 minutes after its copy. Owner plays the video from the Board link now and the next day. If it stops opening, the queue item "Board file check uses the SharePoint eTag" becomes urgent (needs a decision: store a content identity at approval, or accept size + versionId).
   Evidence: `docs/CURRENT_WORK_QUEUE.md`; `lib/services/post-presentation-materials/presentation-page-service.js` `pinnedBytesMatch`.
2. **Recording and transcript card redesign.** Plan first, own session. Evidence: `docs/CURRENT_WORK_QUEUE.md` "Redesign the Recording and transcript card".
3. **Measure a 4-vCPU cut, then lower `PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS`** (3 h now; target about 90 min). Packet-timestamp checks are a later recipe change with full Codex review. Evidence: queue item "Speed up the presentation video cut".

#### Owner Decision Needed

1. **Widen `PRESENTATION_VIDEO_SPLIT_ACCESS`** from `test:<1003222>` to on, after the Board link check passes.
2. **SharePoint-writer threat model for Stage 4 identity:** accept the orchestrator's rejection of the quickXorHash collision finding, or require an unforgeable identity (cTag or SHA-256; needs a migration). Evidence: build plan "Codex adversarial review of the content-identity fix".
3. Carried, not rechecked: Proposal Ranking PR #463 and the colleague dry run.

#### Verify Before Acting

1. Carried from Sessions 588-590, not rechecked: Proposal Ranking Production cleanup; optional paired-summaries checks; PR #470 cleanup test.
2. Stage 4 worktrees `/Users/gallivan/Code/WMKF_Apps-stage4`, `-stage4-recipe`, `-s4`, `-s5` hold merged branches; remove only after confirming no uncommitted work.

### Gotchas

- Reading Production Postgres job rows and SharePoint file metadata (no content, no URLs) was done this session to diagnose live jobs; Production **Dataverse** reads still need explicit owner authorization.
- A running Stage 4 sandbox can be inspected read-only with `@vercel/sandbox` `Sandbox.get({ name: 's4-<splitId>' })` from the main checkout's `.env.local` OIDC token; `readFileToBuffer` and short `runCommand` calls worked against a Production-created sandbox.
- Vercel crons keep hitting the previous deployment for about a minute after a deploy reports success.
- Background `node … | grep` pipes buffer; use `grep --line-buffered` (Monitor) for live watchers. Scratchpad scripts need `NODE_PATH=$PWD/node_modules` or `createRequire(process.cwd()+'/package.json')`.
- Codex's review sandbox cannot run jest (read-only); all test results come from local runs.

**Milestone determination:** Stage 4 shipped a new Production capability (presentation video cut, approved and registered on a real request), so a DEVELOPMENT_LOG entry was added.

---

## Session 592 Prompt (superseded): Stage 4 build plan; first live test of attendance attribution

## Session 591 close — provenance and attendance shipped (Codex built, Claude orchestrated); Stage 4 Sandbox pilot passed (Claude, main, 2026-10-09/10 PT)

### What Was Completed

1. **Stage 4 coordinated with Codex's speaker-label work; owner decisions 11-17 recorded** in `docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md` (`090b3e528`, `f7a767f2a`):
   - 11: the video binds to the transcript revision (later edits rare);
   - 12: the same-source check is metadata plus a staff listen (hard gate 1 relaxed; no packet proof, no Zoom re-fetch);
   - 13: 1003222 is a test request; re-import it when a real cut is needed;
   - 14: Codex owns provenance and attendance, Claude owns Stage 4, shared files one editor at a time;
   - 15: guiding principle is fewest sessions and clicks with minimum regeneration (presentation end plus attendance in ONE correction);
   - 16: record the MP4's recording start/end on `zoom_video_copies`;
   - 17: migration 079 is Stage 4.
2. **Synthetic Vercel Sandbox pilot passed, about $0.22 of the $10 cap** (`09930245a`, `fbde74ad4`):
   - 60-minute 1080p generated fixture cut in iad1 at 2 vCPU in about 11.5 min (48-minute presentation);
   - interruption, full disk and sandbox timeout all fail closed;
   - every sandbox removed, no snapshots.
   - Results `docs/plans/STAGE4_SANDBOX_PILOT_RESULTS_2026-10-09.md`; script `scripts/benchmarks/stage4-sandbox-pilot.py`.
   - Not exercised: upload, VFR, Zoom `bin_data` stream, browser/SharePoint ending playback.
3. **Transcript provenance shipped (Codex):** merge `f3cc08540`, migration 077 applied by the owner. Exact Zoom file binding at import, frozen content-free source identity per publication, bundle v6, and the server seam `resolveCurrentMeetingTranscriptSource`.
4. **Attendance attribution shipped (Codex built; Claude reviewed, ran 125 related suites / 2,273 tests, merged):** merge `06ef45ee8` (`7ddc5a4e7`, `3af9267de`), migration 078 applied by the owner before merge; Production deployment of `06ef45ee8` succeeded.
   - Plan `docs/plans/ZOOM_ATTENDANCE_ATTRIBUTION_PLAN_2026-10-09.md`; owner decisions D1-D4 and Q1-Q4.
   - The manual "Shared microphone" link Codex added was removed on owner decision. Claude committed that removal because Codex's sandbox could not write git metadata.
5. **Zoom report facts probed (owner-run, shape-only):** `scripts/probe-zoom-recordings.mjs --attendance` (`1c752504d`).
   - The Meeting Tracker app already has the report and past-participants scopes.
   - Guests have no stable ID; `user_id` is per row, so grouping is by display name only.
   - Repeated names were waiting-room rows; `duration` is seconds.
   - The first join was 884 s before the audio `recording_start`.
6. **Migrations:** Production and `main` end at 078; **079 reserved for Stage 4**; next free 080 (`.claude-memory/project-migration-numbers-claimed-off-main.md`, `cf5b1257e`). **Session 592:** 079 = `zoom_video_copies` recording times, on branch `claude/stage4-slice1`, **applied to Production 2026-10-10 (owner)**, merge pending; 080 is reserved for the split table; next free 081.
7. **Worktrees:**
   - `/Users/gallivan/Code/WMKF_Apps-codex-labels` is on `codex/zoom-attendance` (merged; no uncommitted changes; no `.env.local`, deliberately).
   - New `/Users/gallivan/Code/WMKF_Apps-codex-group-review` on `codex/group-review-non-lead-ui` (no upstream) for minor group-review UI changes for non-lead PDs. The owner holds the Codex prompt; no commits yet.
8. **Wiki:** Sandbox hazards in `docs/agent-wiki/topics/dev-environment.md`: `vercel sandbox run` leaves the sandbox running; no per-sandbox spend cap.

### Next Items

#### Verified Open

1. **Stage 4 BUILT (Session 592) on branch `claude/stage4-build` (worktree `/Users/gallivan/Code/WMKF_Apps-stage4`), every slice and the whole branch approved by Codex adversarial review; NOT merged.** Owner gates before merge:
   - (a) apply migration 080;
   - (b) run `scripts/extend-requestdocument-artifacttype-presentation-video.mjs --execute` (100000011 "Presentation Video");
   - (c) run `scripts/stage4-provision-ffmpeg.mjs --execute` and set `PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME` in Production;
   - (d) merge with `PRESENTATION_VIDEO_SPLIT_ACCESS` unset;
   - then the first real cut on 1003222 via `test:<GUID>` after the re-import and re-copy.

   See `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md` "Build status". Earlier note: **Session 592: drafted and reviewed** — `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md` (slices 0-5; Mode A ready with named changes, applied; owner decisions B1-B6 recorded; slice 0 SDK probe passed; next is slice 1, migration 079 plus copy-time recording times, on a branch). Evidence: Stage 4 plan decisions 11-17; the provenance seam is merged; the card is now free for Stage 4 (attendance merged).
   - Scope: migration 079 (split-job table plus `zoom_video_copies.recording_start/end`), recording times written at copy, split service/worker/Sandbox processor, `bindPresentationVideo` (new file), Board/briefing allowlists, card Video line.
   - Decision 7 (presentation-video picklist value) is owner-provisioned at build time.
   - Ending playback is checked on the first real cut (browser and SharePoint viewer, before Board/briefing exposure), not on a synthetic clip (Session 592).
2. **First live use of attendance attribution.** Not yet exercised on a real meeting. Needs a transcript with verified Zoom provenance (a new import); legacy transcripts show only the voices list. Suggested: re-import 1003222 from Zoom (one paid transcription, owner-run), which also gives Stage 4 its first real input (re-copy its video too, decision 16).
3. ~~Review `codex/group-review-non-lead-ui`~~ **Closed (Session 592): no change needed.** Codex found "Send to leadership" already limited to the lead PD or a superuser; Claude confirmed in source (`resolveAuthorization` in `lib/services/final-writeup/transition-model.js`, UI `canAdvance` gate, server re-check in `transition-service.js`). The owner saw it as an admin, and admins keep access. The worktree and branch hold no commits.

#### Owner Decision Needed

1. Carried, not rechecked: Proposal Ranking PR #463 and the colleague dry run. (`ZOOM_RECORDING_HOSTS` was re-created as non-sensitive in Production on 2026-10-10, Session 592.)

#### Verify Before Acting

1. Carried from Sessions 588-590, not rechecked: Proposal Ranking Production cleanup; optional paired-summaries checks; PR #470 cleanup test.

### Gotchas

- Codex's sandbox cannot write shared git metadata (`index.lock`) in a worktree. Expect to commit and push for it after reviewing its diff.
- The `codex:codex-rescue` Agent prompt must start with the CODEX RESCUE HANDOFF preface (a hook blocks it otherwise).
- Apply a migration from a worktree without `.env.local` with `node --env-file=../WMKF_Apps/.env.local scripts/apply-migrations.js` (owner `!` run).
- `schema_migrations` columns are `name`, `applied_at`, `applied_by` (not `filename`).
- Jest here rejects `--testPathPattern`; pass the regex as a positional argument.
- Earlier gotchas still apply: `.env.local` points at Production; worktree Turbopack needs `--webpack`; `check:agent-invariants` fails in worktrees; the Word lock file `shared/templates/pre-site-visit/~$ase-ii-pre-site-visit-v6.docx` must not be committed.

**Milestone determination:** provenance and attendance attribution shipped to Production, so a DEVELOPMENT_LOG entry was added ("Zoom transcript provenance and attendance-based discussion attribution (Session 591)").

---

## Session 590 close (superseded in part by Session 591) — Stage 3b released and live; picker fixes; Stage 4 designed and researched (Claude, main, 2026-10-09 PT)

### What Was Completed

1. **Stage 3b (Zoom video copy to SharePoint) is live with `ZOOM_VIDEO_COPY_ACCESS=on`.**
   - Owner confirmed rulings 7 and 10. Ruling 7 census (`scripts/probe-recording-slot-versions.mjs`, owner-run): 25 Recording rows, 14 file winners, 0 unversioned.
   - Release: migration 076 applied (owner); step 0 merged `c79f79807` (deploy 6963903401); probe 3 recorded (15 meetings, one MP4 each, 107.5-527.5 MB); local idle tick against Production returned `outcome: idle`; 3b merged `780fab218` (deploy 6965242102) with access unset; `test:<1003222>` then `on` (stored non-sensitive).
   - Mode D on 1003222: 149,405,180 bytes in 92 s; staff MP4 superseded after confirmation; absent from the Board page (verified live in Chrome). Not checked: video playback; repeat-Import is greyed out in the UI (tests cover it).
   - Vercel timing check: the owner's env redeploy `dpl_EARof6vu...` started before the variable was re-created at 10:45:37 PT; the git deploys after it (`243b0b7cd`, `ac7b96868`) carry `on`.
2. **Picker fixes (rulings 30-31), merged `cb2640a88`, Codex-approved.** **Copy video** on its own once a transcript is published; import line reads "Imported, transcribing..." / "Imported, transcript ready" from the joined job status.
3. **quickXorHash record (decision 6 gap), merged `306ba183f`.** The copy worker reads Graph's hash for the exact item at registering, bounded to 10 s, and stores it; failure stores NULL. Codex round 1 found the read unbounded (stalled body); fixed; round 2 approved. The 1003222 copy predates it (NULL).
4. **Stage 4 (cut the presentation video) designed: `docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md`.** Owner decisions: presentation video only (no discussion video); cut exactly at the confirmed end, earlier by measured mapping uncertainty up to 2 s, else block; Zoom copy plus Zoom transcript only; staff click to create; staff listen and approve before Board release; full Recording stays staff-open. Four hard gates recorded. The October 7 workflow plan is reconciled (no discussion video; Stage 5 deletion list).
5. **Codex venue research and local benchmarks merged `228a97b5b`.** Vercel Sandbox is the first venue (Azure pending a Dragonfly IT ticket; a subscription exists). Full re-encode; audio trimmed on a common clock and encoded only from isolated kept PCM, padding accepted only by exact payload match. Local research closed by the owner as promising with limitations; Apple decoders sometimes omit 4-21 ms of retained audio at the end, accepted as a quality limitation. Local timing: 60 min of 1080p at 4.34x real time on two laptop threads.
6. **Docs reconciled:** runbook Zoom section (the four `ZOOM_*` variables are Production-only secrets since 2026-10-08, `06816d870`); 3b plan marked shipped; Atlas `postgres-zoom-video-copies.md` (hash column, Mode D row).
7. **Memory:** `feedback-never-self-authorize-prod-dataverse-reads` gained the lesson that `.env.local` re-sets `DATAVERSE_ALLOW_PROD_READS`, so a "refusal smoke test" against Production is a Production read (`da66213eb`). This session made one such unrequested read (Recording census) and disclosed it.
8. **Worktrees:** removed `zoom-copy`, `zoom-copy-3b`, `zoom-picker`, `zoom-hash`, `codex-stage4` (all merged or pushed). New: `/Users/gallivan/Code/WMKF_Apps-codex-labels` on `codex/transcription-labels` for a Codex label fix (owner handed Codex a self-contained wind-down prompt).

### Addendum after `/stop` (same session, 2026-10-09 PT)

- **Stage 4 is PAUSED by the owner** to deconflict with a Codex speaker-label plan (attendance, Zoom timeline, VTT, per-revision transcript source record). Wait for that plan; then map the overlap and decide ownership and order. Do not edit the Stage 4 plan or run Stage 4 tests until then.
- Focused check part 1 (`804f5aa03`): Codex's fixed-anchor mapper blocks speech-like audio.
- Owner-approved real pair (`f02be6a66`): 1003222's copied MP4 audio is byte-identical to Zoom's M4A (157,533 packets); video constant 25 fps. Mapping is the identity, proven by packet equality; media deleted. Added `probe-zoom-recordings.mjs --only <recording_type>`.
- Open owner decision: transcribed-audio fingerprint at Stage 3a import (option 1, recommended) or Zoom re-download at split time (option 2). Likely folded into the shared transcript source record.
- For the Codex plan, Claude asked it to state: ownership of the source record, fingerprint and revision semantics (names-only vs source change); any change to the manifest, `bundle.js` or `zoom_recording_imports`; any word-timestamp or utterance-boundary change (moves the cut); migration numbers; its worktree/branch. Claude's points: bind the Stage 4 video to audio source + `endMs` + source video, not `revisionId`; add a word-gap check at the cut; per-participant transcripts need their own alignment proof or a block.

### Next Items

#### Verified Open

1. **Stage 4 next steps, in order (PAUSED, see addendum)** (plan "Next steps before the build plan"):
   1. Focused generated-media validation: speech-like/noisy audio, realistic pauses, VFR, delayed audio, ending playback in browser and SharePoint viewer.
   2. Synthetic Vercel Sandbox pilot within the $10 cap: confirm region, pricing and cap enforcement first; persistence off; verified cleanup; full-length runtime and failure cases.
   3. Ask Justin before the first real input (1003222's copied video, isolated test folder, no Board registration).
   4. Then `/contract-reconcile` Mode A on the design and the build plan. Decision 7 (Dataverse picklist value for a presentation video) is owner-provisioned at build time.
2. **Review `codex/transcription-labels` when Codex reports done**, before the owner merges.

#### Owner Decision Needed

1. **Optional:** re-create `ZOOM_RECORDING_HOSTS` as non-sensitive so its value is readable (runbook notes it is stored as a secret).
2. **1003222 cleanup (optional):** check the copied video plays; regenerate its transcripts and summaries, which are out of date after the Oct 9 Import.
3. **Proposal Ranking** (set aside; unchanged from Session 589, not rechecked): PR #463 and the colleague Production dry run.

#### Verify Before Acting

1. **Proposal Ranking Production cleanup** (carried from Session 588; nothing ran). Inspect current state first.
2. **Optional paired-summaries Production checks and the PR #470 cleanup test** (carried, not rechecked).

### Gotchas

- `.env.local` points at Production and sets `DATAVERSE_ALLOW_PROD_READS`; any script that calls `loadEnvLocal()` reads Production. Hand Production commands to the owner.
- Worktree `node_modules` symlinks crash Turbopack; use `next dev --webpack` in a worktree. `verifyCronSecret` skips the secret in development.
- `check:agent-invariants` fails in worktrees (no memory symlink); run it from the main checkout.
- Codex's companion reviews cannot run jest in its sandbox; run the suites locally.
- Homebrew's FFmpeg install (Codex) installed `openssl@4` and unlinked `openssl@3`; `brew link openssl@3` reverses it if a local tool breaks.
- Full jest showed different flaky suites per run this session (`workbench-integrity-service`, virus-scan `scanBytes`); each passes alone.
- Untracked `shared/templates/pre-site-visit/~$ase-ii-pre-site-visit-v6.docx` is a Word lock file; do not commit it.

### Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md` | Stage 4 design, owner decisions 1-10, gates, next steps |
| `docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md`, `STAGE4_LOCAL_MATRIX_RESULTS_2026-10-09.md` | Codex venue research and local benchmark closure |
| `scripts/benchmarks/stage4-*` | Offline synthetic benchmarks (generated media only) |
| `lib/services/meeting-tracker-recordings/video-copy-{store,service,worker}.js` | Live Stage 3b copy |
| `docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md` | 3b plan (shipped), rulings 1-31 |
| `scripts/probe-recording-slot-versions.mjs` | Read-only Recording slot-version census (owner-run) |

### Testing

```bash
npx jest tests/unit/zoom tests/unit/graph tests/unit/post-presentation tests/unit/recording-and-transcript-card
ZOOM_VIDEO_COPY_PG_TEST_URL=postgres://postgres:pw@127.0.0.1:<port>/postgres npx jest tests/integration/zoom-video-copies.pg.test.js   # throwaway loopback container
```

**Milestone determination:** Stage 3b shipped to Production, so a DEVELOPMENT_LOG entry was added ("Zoom meeting videos copy into SharePoint (Session 590)").

---

## Session 589 close — Stage 2 shipped and accepted; Stage 3b built and Codex-approved (Claude, main, 2026-10-08/09 PT)

### What Was Completed

1. **Paired summaries (Stage 2) is Production-live and accepted.**
   - Card slice on `claude/paired-summaries`:
     - `1c41e4c77`: Codex's replaceDraft fix
     - `a7838e3b6`: per-kind hook refactor
     - `19af9ad41`: paired action and discussion block
     - `424394781`: copy
   - Docs slice `4d1917085`. Codex approved the card slice.
   - **Owner decisions 9–12** (the build deviations) were accepted as recommended:
     - 9: the paired click skips any kind that has a draft
     - 10: both kinds send the paired acknowledgment version
     - 11: the "Replace draft with a new summary" label is kept
     - 12: one `SummaryBlock` component serves both kinds
     - The owner also accepted the prompt and consent text as built.
   - **Owner ran the release steps** (2026-10-09 UTC):
     - picklist 100000010 inserted
     - migration 075 applied (1 applied, 74 skipped)
     - prompt `meeting-transcript.staff-discussion-summary` v1 seeded (`87768430-90c3-f111-aaad-6045bd063e21`)
     - merge `5b8225ed8`; Production deployment 6952181551 success
   - **Acceptance on 1003222** (`ce3f45770`):
     - Verified by Claude in Chrome and by status-only probes:
       - the card and Staff Deliberations show both summaries
       - the Board page and the briefing page show only the presentation summary
       - both outside `open` routes return 404 for the discussion row (`064a57e0-…`) and 302 for the presentation summary
     - Not observed: the reload during a run and a draft edit.
   - DEVELOPMENT_LOG milestone added (`c44879d3e`, updated in `ce3f45770`).
   - The `claude/paired-summaries` worktree and local branch were removed. The remote branch is kept.
2. **Stage 3b (Zoom video copy to SharePoint) is built, Codex-approved, and not merged.**
   - The owner accepted decisions 1–3 and 5–7 as recommended, and set the stopping point: branches only; no migration, Vercel setting, live call or merge (`c4ba53bc5` on main).
   - **Step 0**, `claude/zoom-copy-step0` (worktree `/Users/gallivan/Code/WMKF_Apps-zoom-copy`, tip `e874c30ce`):
     - migration 076 (`origin` column plus the inert `zoom_video_copies` table)
     - `origin='browser'` isolation predicates
     - non-destructive registered-item binding
     - Codex approved in one round.
   - **Full build**, `claude/zoom-copy` (worktree `/Users/gallivan/Code/WMKF_Apps-zoom-copy-3b`, tip `61f4773af`, stacked on step 0). Sonnet built eight slices; Claude reviewed each:
     - S1: transport and access flag
     - S2: material-service seams and the decision-8 hook
     - S3: stores, with a real-Postgres proof
     - S4: service and route
     - S5: transfer worker
     - S6: registration, recovery and cron, with a crash-injection suite
     - S7: card
     - S8: docs
   - **Build rulings 1–29** are recorded in the plan under "Build rulings (Session 589, orchestrator)".
   - **Codex adversarial review:** rounds 1–4 raised six medium findings, all fixed with regression tests (rulings 24–29). Round 5 approved with no material findings.
     - a stalled Graph response body
     - receipt conflicts that never retired
     - three duplicate-copy races in Try again / N1
   - **Verification:** full jest 22,090 passed; 30 `check:*` gates plus self-tests green; loopback Postgres proof 18/18.
3. **Side session:** institution-name capitalization fixes applied to production (below).

### Next Items

**Superseded by Session 590:** rulings 7 and 10 confirmed; release steps 1-6 done; 3b live with access `on`. Read this section as history.

#### Owner Decision Needed

1. **Confirm Stage 3b ruling 10 (Import starts both).**
   - Evidence: plan "Build rulings" 10, 19 and 23; card code in `RecordingAndTranscriptCard.js` (`useZoomImport`, `declineReplace`).
   - As built:
     - Import first shows the replace confirmation, when the current Recording is a staff MP4.
     - It then sends the audio import and the video copy as two independent POSTs.
     - **Copy video** works on its own when transcription is off or there is no audio (the listing works video-only).
     - **Keep current file** copies no video and still imports the audio.
   - Confirm, or say what to change, before the 3b merge.
2. **Confirm Stage 3b ruling 7 (unversioned winner).**
   - Evidence: plan ruling 7; `video-copy-service.js` `checkReplacement`.
   - If the current Recording winner is a SharePoint MP4 without a positive slot version, start refuses with 409 `zoom_video_winner_unversioned` and copies nothing (staff can upload manually).
   - Conservative and expected to be rare. Confirm or change.
3. **Stage 3b release, owner-run, in order** (plan "Release"):
   1. Apply migration 076 (`node scripts/apply-migrations.js` from the step-0 worktree).
   2. Merge `claude/zoom-copy-step0` and verify the deployment is the merge build.
   3. Optional probe 3 (`node scripts/probe-zoom-recordings.mjs`; its default listing shows MP4 variants).
   4. Run the cron route once locally with `ZOOM_VIDEO_COPY_ACCESS=test:<TEST GUID>`, after confirming the Dataverse host and SharePoint site `.env.local` targets.
   5. Merge `claude/zoom-copy` with the flag unset.
   6. Set `test:<GUID>` for a Mode D run on one real recording, then `on`.
   - `ZOOM_VIDEO_COPY_ACCESS` is a new non-sensitive variable (runbook row on the branch).
   - The cron runs every minute once merged; with the flag off it only reconciles.
4. **Proposal Ranking** (set aside by the owner): PR #463 review/merge/promotion and the colleague Production dry run. See the ranking sections below.
5. **Institution-name capitalization:** the owner is consulting the database maintainers (side-session section below).

#### Verified Open

1. **Optional paired-summaries checks not observed in Production:** the reload during a run ("Summarizing… started …") and a draft edit before publish. Card tests cover both. Running them costs a provider call and a new published document on 1003222.
2. **Optional test from PR #470** (carried from Session 588, not rechecked this session): provider DELETE rejected, cleanup retries, slot freed.

#### Verify Before Acting

1. **Proposal Ranking Production cleanup** (cancel the old unpublished trial, restore Beth as default facilitator). Unchanged from Session 588: classifier-blocked, nothing ran. Inspect current state first.
2. **Session 588's "Next Items" below are superseded.** Stage 2 has shipped; read that section as history.

### Gotchas

- The Claude Code auto-mode classifier blocks Claude's merge-to-main pushes ("Production Deploy") and Production reads ("Production Reads"). The owner ran those from the terminal with `!`.
- `npm run check:agent-invariants` fails inside the zoom-copy worktrees because `.claude-memory` is not a symlink there. This is a worktree artifact; run that gate from the main checkout.
- The 3b real-Postgres proof needs a loopback Docker Postgres: `ZOOM_VIDEO_COPY_PG_TEST_URL=postgres://postgres:pw@127.0.0.1:<port>/postgres`, against a throwaway container. It is skipped when unset.
- Untracked `shared/templates/pre-site-visit/~$ase-ii-pre-site-visit-v6.docx` is a Word lock file. Do not commit it; delete it once Word is closed.

### Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md` (branch) | 3b plan, build rulings 1–29, release steps |
| `lib/services/meeting-tracker-recordings/video-copy-{store,service,worker}.js` (branch) | Copy store (N1–N7), start/GET/cancel, tick worker |
| `pages/api/meeting-tracker/visits/[requestId]/zoom-video-copies.js`, `pages/api/cron/drain-zoom-video-copies.js` (branch) | Route and cron |
| `tests/integration/zoom-video-copies.pg.test.js` (branch) | Loopback real-Postgres proof (18 cases) |
| `docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md` | Stage 2 plan; live and accepted |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-zoom-copy-3b
npx jest tests/unit/zoom tests/unit/post-presentation tests/unit/graph tests/unit/recording-and-transcript-card
npm run check:types && npm run check:api-routes && npm run check:request-document-writers
```

**Milestone determination:** a DEVELOPMENT_LOG entry was required for Stage 2 shipping, and it was added this session. Stage 3b is not shipped, so it needs no entry.

---

## Side session close — institution-name capitalization: APPLIED (Claude, main, 2026-10-08/09 PT)

The owner's colleagues approved fixing all 40 accounts (2026-10-09). Done; nothing open.

- **Script (`scripts/fix-institution-name-capitalization.js`, commits `0e317e5a4`, `f9088c2ea`).** It now discovers targets live instead of hardcoding 6.
  - Scans every Research Program request (9,406 rows, keyset-paged past the 5000-row cap) → 660 applicant accounts.
  - Lower-cases title-cased "Of/For/And/In/The/At/On" after the first word in `name` and `akoya_aka`.
  - Owner-reviewed exceptions: Rutgers keeps "The"; Temple keeps its legal "-Of The" (only "Of Higher" lowered); Notre Dame becomes "du Lac".
- **Applied to production 2026-10-09:** 45 fields on 39 accounts; 0 skipped, 0 failed. A re-scan finds 0 remaining; re-runs are no-ops.
- **Left as is (not discussed with maintainers):** literal `&amp;` in the HSS account and UVA `name`s; "Childrens" without apostrophe; hyphens/dashes such as "Wisconsin - Milwaukee". `name` was patched along with `akoya_aka`; whether an upstream sync rewrites `name` is unknown — if the old casing reappears, that is the cause.

## Session 588 close — Stage 2 build, 3b plan finished, Pre-Site template v8 (Claude, main, 2026-10-08/09 PT)

### What Was Completed

1. **Pre-Site Visit template v8 is live in Production** (merge `9e435586c`; deployment 6950899994 success).
   - Codex made the owner's edits on `codex/presite-template-fixes` (`9e44ad9ae` v7, `b7ec914aa` v8): the "Phase II Review" title line is removed, the page number sits beside the institution on pages 2+, there is a right-aligned `MR: Request #…` footer, and 12 pt space follows city/state.
   - The renderer points at v8 with render-contract 9; `PRE_SITE_VISIT_CONTRACT.templateVersion` is `'9'`.
   - Claude reviewed it: 149 tests pass, footer placeholders are filled (the renderer handles header and footer parts), and the docx has no tracked changes or comments. Catalog line fixed (`5266f30e7`). The worktree and local branch are removed.
2. **Paired summaries release step 0 is live** (merge `82c6cb26d`; deployment 6951088672 success). The summary publish claim matches `artifact_type`, and the publisher refuses any other kind (`summary_draft_kind_unsupported`). Codex approved it. It is the oldest permitted rollback target for Stage 2.
3. **Stage 2 backend is built on `claude/paired-summaries`** (worktree `/Users/gallivan/Code/WMKF_Apps-paired-summaries`; its `node_modules`, `.env.local` and `.agents/skills` are symlinks into the main checkout). It is pushed and NOT merged:
   - `2c411c6d6` migration 075
   - `d5d05f78d` transactional `reserveSummaryDraftRun` (advisory lock, typed conflicts), `recordEmptySummaryRun`, widened `getLatestSummaryRun`
   - `e197c0ce4` golden presentation publish identities
   - `d9a1d7620` artifact type 100000010 (config, Wave 16, staff projection) plus the owner-run picklist script
   - `905497965` discussion summary binding
   - `95bb9f8fe` discussion prompt config, paired acknowledgment, budgets, A7 inv 34, owner-run seed script
   - `914a03fc4` `SUMMARY_KINDS` service parameterization, the D4 marker and write-side privacy tests (8 mutations each fail a test)
   - `57193bdfd` route `kind`/`replaceDraft`
   - `cb398fb47` staff consumers (Meeting Tracker DTO, Workbench logistics feed, Staff Deliberations inline discussion summary)

   **Codex backend review:** one medium finding, the known gap. The current card's "Replace draft with a new summary" sends no `replaceDraft`, so it always gets 409. The card slice must fix this before any merge. Codex found no outside-surface leak.
4. **Stage 2 plan** reviewed, revised and re-reviewed (`17fd86ac2`, `9d3651b2a`, `5665b406d`). Owner decisions are recorded in the plan.
5. **Stage 3b plan** reviewed, reworked by a Claude agent (`99b923010`), fixed by Codex (`eca27698b`) and given a final Codex fix (`bfd663160`). Owner decisions: `ZOOM_VIDEO_COPY_ACCESS` kill switch; confirm before a copy replaces a staff-uploaded MP4; one migration 076. The distribution-email question is closed because email material links were retired 2026-09-10. All five probes are recorded:
   - Range supported (`30fab00c9`)
   - link lifetime: 206 through 30 min, 403 at 60 min (`8c4765d5f`)
   - Graph session idles out at 15 min; recordings carry quickXorHash only (`c13b6fe88`)
   - mvhd within the first MiB (`eca27698b`)
   - variants: a partial sample only

   The 3b build has not started.
6. **Docs reconciled:** Stage 3a recorded as merged and applied; 100000010 stage numbering fixed (`5e515c253`); Site Visit SharePoint folder names now match the code (`18dfc69c3`).
7. **Production checks V1–V3 for Stage 2 passed**, read-only:
   - V1: 100000010 and 100000011 are absent from the `wmkf_artifacttype` picklist.
   - V2: `schema_migrations` ends at 074, and the drafts CHECK is `artifact_type = 100000007`.
   - V3: no `meeting-transcript.staff-discussion-summary` prompt row exists.

### Next Items

#### Verified Open

1. **Stage 2 card slice.** File: `shared/components/meeting-tracker/RecordingAndTranscriptCard.js`.
   - Evidence: the Codex backend review and the plan (D9, test plan item 13). Summary hook and handlers are at `:1593-1823`; `SummaryBlock` is at `:2310`; the step 3 groups are at `:2669-2683`.
   - First, Codex's fix: "Summarize again" / "Replace draft" sends `replaceDraft: {draftId, expectedVersion}` of the displayed draft, and a 409 `summary_draft_exists` reloads the summary.
   - Then build:
     - a per-kind summary hook used twice; the discussion GET is `?kind=discussion`
     - one paired handler that holds `busy='summarize'` until `Promise.allSettled`
     - per-kind load keys (discussion key uses `staffDiscussionTranscript` and `staffDiscussionSummary` from the collection)
     - the paired checkbox using `PAIRED_SUMMARY_ACKNOWLEDGMENT`
     - "Not recorded" when `discussionNotRecorded`
     - a `DiscussionSummaryBlock` in the Staff discussion group
   - Keep UX and feature changes in separate commits. Then a Codex review.
2. **Stage 2 docs slice.** Atlas pages: `postgres-meeting-transcript-summary-drafts.md`, `dataverse-wmkf-requestdocument.md` (100000010 contract) and `dataverse-wmkf-ai-run-and-prompt.md`; the Atlas index row. The API matrix summary-draft rows (`kind`, `replaceDraft`, new codes). The workflow plan's Stage 2 status. Note the deviation: responses gain an additive `kind`.
3. **Optional test from PR #470:** provider DELETE rejected, cleanup retries, slot freed. Not written.

#### Owner Decision Needed

1. **Before Stage 2 can ship (all owner-run, none executed):**
   - Review the prompt wording (`shared/config/prompts/meeting-staff-discussion-summary.js` on the branch) and the paired consent text (`shared/config/transcriptSummary.js`).
   - Then run `scripts/extend-requestdocument-artifacttype-staff-discussion-summary.mjs` (dry run, then `--execute`), apply migration 075 with `node scripts/apply-migrations.js`, run `scripts/seed-meeting-staff-discussion-summary-prompt.js --dry-run`, then `--execute`, and decide the merge.
   - Release order is in the plan's "Release sequence".
2. **Stage 3b build start.** The plan is final (`docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md`); release step 0 (browser isolation) ships first.
3. **Proposal Ranking:** PR #463 review/merge/promotion and the colleague Production dry run were set aside by the owner this session.

#### Verify Before Acting

1. **Proposal Ranking Production cleanup:** cancel the old unpublished trial and restore Beth as default facilitator.
   - The owner authorized it this session, but the Claude Code auto-mode classifier blocked the delegated agent ("Modify Shared Resources"). Nothing ran.
   - Inspect current state first. The owner may do it in the admin UI or add a permission rule. See the ranking section below.
2. **Production-read probes** from this session are classifier-blocked when Claude runs them. The owner ran probe 4 manually. Its script was scratch and is not in the repo.

### Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md` | Stage 2 plan (reviewed; owner decisions; release sequence) |
| `docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md` | Stage 3b plan (state table, dispatch table, probes 1, 2, 4, 5 recorded) |
| `lib/services/post-presentation-materials/transcript-summary-service.js` (branch) | `SUMMARY_KINDS`, create/get/publish for both kinds |
| `lib/services/post-presentation-materials/summary-draft-store.js` | `reserveSummaryDraftRun` (branch), kind-scoped publish claim (main) |
| `scripts/probe-zoom-recordings.mjs` | Read-only Zoom probe: `--range`, `--lifetime`, `--moov` |
| `shared/templates/pre-site-visit/phase-ii-pre-site-visit-v8.docx` | Live Pre-Site template (render contract 9) |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-paired-summaries
npx jest tests/unit/transcript-summary-service.test.js tests/unit/summary-draft-store-reserve.test.js \
  tests/unit/meeting-tracker-transcription-routes.test.js tests/unit/post-presentation tests/unit/meeting-tracker \
  tests/unit/research-presentation-follow-up.test.js tests/unit/site-visit-logistics-service.test.js
npm run check:types && npm run check:prompt-injection-tagging && npm run check:request-document-writers
```

**Milestone determination:** no DEVELOPMENT_LOG entry. Template v8 is a formatting change and release step 0 is a small publish guard; Stage 2 and 3b are not shipped.

---

## Session 587 close — Proposal Ranking rehearsal and card refinement (2026-10-08 PT)

**Current ranking handoff. Earlier ranking sections below are historical checkpoints;
their card appearance and ordinary-trial reset limitations must not override this section.**
The other workstream handoffs below remain preserved.

[VERIFIED via Git and GitHub] Implementation remains on **codex/proposal-ranking**,
runtime tip **72efac88d**, in open draft [PR #463](https://github.com/justingallivan/wmkf-research-apps/pull/463).
The owner requested this handoff on main, not a runtime merge or promotion.

### Completed and decisions

- Simplified opening and required full participation: `0f9e3b4e4`, `0c04b4ad2`.
  Staff are not excused. The local fixture still has three fictional PDs; the owner
  reports four real staff. Do not confuse the fixture roster with live staffing.
- Kept draft actions/results together (`104590016`), separated My rankings,
  Facilitate and Meeting list (`c51e60de7`), and adopted hello-pangea drag/drop
  (`a2bebba6b`). Owner accepted dragging and called the walkthrough tested for now.
- Explicit dry-run opening and permanent trial-ranking erasure, including after
  publication: backend `e20f014ba`, UI `9dbc3daba`. A content-free receipt remains;
  no trial rankings are retained. Ordinary rounds cannot be relabeled/erased this way.
- Combined SE + MR meeting order: backend `6e1e5d187`, UI `5148af779`.
  Both nonempty programs must be published. Compare the next items' average PD
  ranks on the same scale, preserving each program's current internal meeting order;
  ties choose SE. Later combined edits are independent of program lists.
  Read the branch Atlas for the exact contract.
- Card refinements culminate in `72efac88d`: prominent rank on left; institution
  above a smaller linked proposal title; no proposal number or move buttons;
  Reviews shows individual letter grades followed by the numeric average.
  First-name PD rank badges and Average use light rank-based colors. Staff ranks
  lower left are bottom-aligned with Requested/Cumulative Budget lower right,
  without a horizontal divider. SE/MR and E/W are outlined circles upper right.
  The redundant external-review score disk is removed.
- Notable UI commits: `95d19e97a` review grades, `93886a68f` PD badges,
  `edf5f6ad5` Average badge, `14ca47aed` institution prominence,
  `085f7095a` left alignment, `112c1044a` disk removal,
  `6afe9522d` shared bottom row, `72efac88d` corner badges.
  Intermediate layout experiments are superseded by this final description.

### Verification and resume

[VERIFIED via local Jest, ESLint and in-app browser] Final UI regression: **39 tests
pass**, scoped lint and diff checks pass. Browser shows the latest cards; the preceding
bottom-row check measured equal staff/budget bottom edges. Earlier backend work ran
focused suites and relevant scoped gates/self-tests sequentially. These are local
rehearsal checks, not Production acceptance.
[VERIFIED via GitHub at stop] All reported CodeQL and Vercel checks passed for
`72efac88d`; recheck checks on any newer documentation head before release.
Claim-evidence report was unavailable because local state could not be read;
no advisory observation was invented.

Resume the existing worktree:
`/Users/gallivan/.codex/worktrees/proposal-ranking/WMKF_Apps-codex`.
Do not switch its branch or rebuild from main. Read its
`docs/atlas/dataverse-proposal-ranking.md`, the shared card in
`shared/components/proposal-ranking/ProposalRankingApp.js`, and
`tests/unit/proposal-ranking-page.test.js`.
Current rehearsal is **http://127.0.0.1:3135/**, memory-only. On another machine or
after restart, run `node scripts/rehearse-proposal-ranking.js` and use its printed
loopback URL (default 3133). No credentials or .env.local needed. Select D26.
Temporary memory and browser state do not travel through Git.

### Open items and boundaries

- **Owner decision needed:** review/merge/promotion of PR #463 and scheduling the
  colleague Production dry run. The owner wants a colleague dry run and permanent
  erasure of trial rankings; this is intent, not evidence that it ran.
- **Verify before acting, explicit owner authorization required:** live-state
  preflight, old unpublished-trial cancellation, restoring Beth as default facilitator,
  clean-round verification and role readiness for dry-run erasure. Inspect current
  state first; do not assume historical facilitator/round state is still current.
  Preserve external-review scores and source proposals. Do not publish an old
  ordinary trial expecting the new dry-run erasure path to apply.
- No Production/live Dataverse reads or writes were performed for this local UI
  work or stop. No runtime promotion is authorized by this handoff.
- Preserve privacy, test exclusions and full participation. No fake staff votes,
  source-proposal copies, API-key agent auth, Ultrareview or other metered products.
  Keep UX and feature changes in separate commits.
- Further cosmetic refinement is parked until the owner requests it. No new
  Production milestone shipped; **no DEVELOPMENT_LOG entry required**.

---


## Session 585 close — Proposal Ranking office handoff (2026-10-08)

**Historical Session 585 ranking checkpoint; superseded by Session 587 above.**
Owner asked to resume at the office. Implementation and detailed Atlas remain on
**`codex/proposal-ranking`**, not main. Do not rebuild from main. Draft
[PR #463](https://github.com/justingallivan/wmkf-research-apps/pull/463) remains
unmerged; this main handoff is documentation only, not runtime promotion.

### Completed and verified

- `8643d9645`: isolated local rehearsal using the real ranking screen/service with
  six fictional proposals and three fictional PDs, simulated submissions, role
  views, publication, meeting reordering and reset after publication. Memory only;
  no environment file, live Dataverse service or real staff votes. Reset rejects
  delayed requests from the previous rehearsal generation.
- Same commit swaps the card markers: rating dot upper right, E/W lower right.
- `cd8928bbc`: merged main documentation while preserving both workstream handoffs.
- 42 focused tests and scoped gates/self-tests passed sequentially. Browser checked
  submission, SE composite publication, meeting edits, participant privacy, full
  requested totals and reset; desktop/mobile marker checks passed. Sol findings
  fixed; one bounded subscription-OAuth Opus source review found no blockers.
- [VERIFIED via GitHub, 2026-10-08] PR #463 at `cd8928bbc` has passing Jest,
  Postgres integration, Claude review and security checks. Recheck new-head CI
  before any future promotion. The claim-evidence advisory report was unavailable
  because local state could not be read; no observation row was invented.

### Resume on the office Mac — verified open

Fetch origin and resume the existing `codex/proposal-ranking` checkout. If absent,
create a separate worktree tracking that remote branch; preserve other worktrees.
Read the branch's `SESSION_PROMPT.md` and `docs/atlas/dataverse-proposal-ranking.md`.
With repository dependencies installed, run:

```bash
node scripts/rehearse-proposal-ranking.js
```

Then open **http://127.0.0.1:3133/** on that Mac. No credentials or `.env.local` are
needed for this rehearsal. The current Mac's localhost server and temporary memory
cannot travel through Git; restarting gives a blank slate. Open a round, submit
both own lists, simulate the other PD submissions, generate/publish each program,
and reorder the meeting lists. Reset clears only rehearsal memory, even after
publication. The fixture supports D26; select D26 if a later date changes the default.

### Owner decision and live-state preflight

- **Owner decision needed:** acceptance and promotion of PR #463. This stop request
  does not merge runtime changes. No Production change was performed by rehearsal.
- **Verify before acting:** before colleagues use the live app, inspect current
  live round/configuration. Last verified default facilitator was Justin, temporarily
  replacing Beth. Cancel any unpublished trial, restore Beth and verify a fresh
  round has no trial submissions/composites/meeting edits. Preserve external-review
  scores. Existing cancellation refuses a round after either program is published;
  if that happened since the last check, stop and agree a reset plan with the owner.
- **Do not reopen:** no fake staff votes, no source-proposal copies, no weakening
  test exclusion, no agent API keys/Fable/Ultrareview.

No new Production milestone shipped in the rehearsal/stop work; no additional
DEVELOPMENT_LOG entry is required. The earlier Production activation milestone
remains recorded. Root instructions need no change for this local-only script.

---

## Historical: Owner plan for 2026-10-08 (set by the owner, Session 584; both items addressed in Session 586)

Work on two things, on the other computer:
1. **Meeting Tracker transcript workflow:** done in Session 586; see the PR #464 section at the top. (Originally: resume `codex/meeting-transcript-ux` (pushed at
   `3fa20089f`; planning only, nothing merged).) Handoff directly below. The owner meets WMKF's
   Zoom administrator the morning of 2026-10-08.
2. **Proposal Ranking:** resume the isolated rehearsal using the current office handoff
   at the top of this file and `codex/proposal-ranking` / draft PR #463. Preserve both
   workstream handoffs; do not replace this file wholesale.

Setting up the transcript worktree on a new machine:
```
git fetch origin
git worktree add ../WMKF_Apps-codex-transcript-ux -b codex/meeting-transcript-ux --track origin/codex/meeting-transcript-ux
```
Then add the per-machine pieces: `.agents/skills` symlink to `../.claude/skills`, a `.env.local`
symlink to the main checkout's, and `npm install` (revert any `package-lock.json` churn).

## Historical: Session 584 transcript UX planning handoff — October 7, 2026 (Codex)

*Superseded by the Session 586 PR #464 section at the top. The Zoom admin meeting happened, and Stages 0, 1 and 3a are merged.*

**[VERIFIED via remote Git refs]** Planning branch `codex/meeting-transcript-ux` is pushed at `3fa20089f389acfb59b000628df9831c8a1439d3`. The branch contains the implementation plan, two-slide Zoom admin brief and detailed handoff. This main handoff does not merge the branch or enable any new runtime behavior.

### Resume on the work computer

Fetch origin, then resume `origin/codex/meeting-transcript-ux` in a dedicated checkout, preserving unrelated local work. Do not rebuild from main or use `codex/meeting-transcript-fixes`. On the planning branch, read:

- [Implementation plan](https://github.com/justingallivan/wmkf-research-apps/blob/codex/meeting-transcript-ux/docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md)
- [Two-slide Zoom admin brief](https://github.com/justingallivan/wmkf-research-apps/blob/codex/meeting-transcript-ux/docs/plans/briefs/WMKF-Zoom-Admin-Brief.pptx) — download and open in PowerPoint; exact permission names and official references are in speaker notes.
- The branch's `SESSION_PROMPT.md` for the detailed handoff.

### Decisions and next steps

**Owner-approved direction:** import the full WMKF Zoom recording and available audio/captions; reconcile speakers across the full transcript; review names and confirm the split; create presentation/discussion videos and transcripts; generate both summaries with one click; review and publish. Archive presentation-only products for Board sharing. Automatically delete discussion products and full originals at the Board meeting deadline, including Zoom originals if supported.

**Next:** the owner meets WMKF's Zoom administrator on October 8, 2026 in the morning (Pacific). Seek an internal Server-to-Server OAuth app with recording read access, approved hosts, a secure app-credential handoff and one test recording. Account setup and the import pilot have not been performed. The shared-account 2FA stays enabled; the integration uses its own server-side credentials after administrator authorization.

**Owner decisions still needed:** implementation stage/file scope, schema/auth/Production steps, exact deletion cutoff, reschedules/holds, archive-incomplete handling and permanent erasure versus Zoom/SharePoint recoverable deletion. No deletion or provider execution is authorized by this handoff. Recheck live callers and owned file identities before implementing retention.

**Critical source finding:** current Board transcript/summary binding depends on the full TRANSCRIPT manifest. Source deletion must wait for a reviewed content-free archive proof and tests that the presentation remains available afterward. Preserve the PR #459 speaker fix; the owner accepted it on 1003038.

### Verification and boundaries

Planning-only commit `3fa20089f`: documentation gates and self-tests passed sequentially; both slides passed package/layout checks and visual inspection. A fresh source review added no-discussion handling and content-free AI audit requirements. The checkout-specific memory symlink was repaired; agent invariants passed. The claim-evidence advisory report could not read local state; no observation was invented.

No runtime code, credentials, database/schema, Production data or account settings changed. No new production milestone shipped, so no DEVELOPMENT_LOG entry is required. UX and feature implementation must be separate commits. Push only the feature branch for future work; owner decides merge. The main handoff is the only main change authorized by tonight's stop request.

---

## Historical Proposal Ranking handoff — superseded by the office handoff above

## Current owner-only trial — restore a clean start before colleague use

[VERIFIED via conditional Admin-service PUT and readback, 2026-10-07] Owner approved
Justin Gallivan as temporary default facilitator (`29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`,
profile 2). Beth's previous default was `b6f1cd38-0973-f011-bec3-6045bd0510d4`.
Only this setting changed; no round was opened or rankings submitted by this action.

Owner explicitly requires a blank slate before colleagues start. This means trial
PD orders/submissions/composites must not carry into the real round; source external
reviewer scores remain intact. Keep the trial UNPUBLISHED: existing cancellation
refuses a round after either program is published. Before handoff, cancel any
unpublished trial round (retained read-only as history), restore Beth as default,
and open a fresh round from current source data. Verify the new round has only
initial seed orders and no submitted lists/composites/meeting edits. No reset has
been performed yet. Do not test publication in the live trial without first agreeing
a separate reset-safe rehearsal path. The app is already live with four grants;
this is not an isolated environment inaccessible to colleagues.

Next: Justin can inspect the facilitator preview without opening a round. Other
people's rankings must not be manufactured using their identities.

## Historical release checkpoint: Production deployed and enabled — 2026-10-07

[VERIFIED via GitHub, Vercel and signed-in Chrome] Owner approved release. PR #457
merged at `10c079c8652b4184404b4cb8ee8479f370a56c79`; privacy guards deployed while
disabled, then both ranking flags enabled and the same source rebuilt. Active
Production deployment: `dpl_F5ewaS8DRDhABRVyhrG5XHuSRvwf`. Justin's D26 view shows
“Round not open”; Beth must sign in to open it. No ranking rows or staff votes were
created. Full preview: 23 requests, 11 SE / 12 MR, four grants, all USD amounts present,
9 East / 14 West, all scored; 51 outstanding review assignments. Opening freezes
current scores. Full candidate CI passed (21,357 tests plus 129 PG tests); Sol and
OAuth Opus found no release blocker.

Current receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md`.
Next: Beth's facilitator session and separate PD sessions for the full private-list,
submission, publication, meeting-reordering and budget walkthrough. Do not silently
change facilitator or submit other people's rankings to manufacture acceptance.
For rollback keep the deployed privacy guards: disable ranking or return to the
verified disabled deployment `dpl_8CVM7KUdKhPh2bTHDKdaqVcAA14J`.
Earlier sections below are historical checkpoints superseded by this release.

## Session 583 Summary — ranking branch continuation, 2026-10-07

[VERIFIED via Git] Resumed the existing ranking worktree and merged the 23 incoming
commits through `origin/main` at `27ed1684d`, without rebasing or rebuilding the app.
Kept this branch's ranking handoff and accepted main's transcript-audit annotations.
Main's unrelated handoff remains available at `git show 27ed1684d:SESSION_PROMPT.md`.

[VERIFIED via local commands] Ranking/Explorer regression: 12 suites, 120 tests pass.
All 69 local startup check scripts/self-tests passed, with each gate and self-test
run sequentially; the missing per-worktree Claude memory symlink was repaired and
its gate rerun successfully. This includes API routes, Atlas, route lifecycle auth,
and types. The live factory-ledger check was excluded because Production reads
were not authorized for that run; the later narrow Production inventory is below. Claim-evidence report remains unavailable; no observation invented.

[VERIFIED via fresh GET-only sandbox readiness probe] All three entity identities,
fields/bounds and Active keys pass; application role assignment and isolation marker
schemas pass. The uncapped eligible ordinary Phase II Pending SE/MR scan still returns
zero proposals. No default facilitator setting exists. All four readiness switches
are off in this checkout's loaded configuration; hosted Preview settings were not
inspected. No environment settings, grants, source records or ranking rows changed.

Luna reconnoitered and Sol reviewed the merge without substantive blockers.
Review closure and retained evidence are recorded in the Atlas continuation section.
Production was unchanged; a later owner-approved read-only inventory is recorded below.
The app remains disabled. No production
milestone entry is required. Only `codex/proposal-ranking` is authorized for pushing.

### Follow-up: institution East-West metadata found

[VERIFIED via live sandbox metadata] Added and ran
`scripts/probe-proposal-ranking-geography.mjs`: request `akoya_applicantid` links to
`account`; `account.wmkf_eastwest` is the **East-West** Picklist, with
**East = 100000000**, **West = 100000001**. Only metadata GETs were performed.
No business records or Production metadata were read. The subsequent owner-approved
card change carries `institutionGeography` into new frozen snapshots and the preview
fingerprint and displays a prominent E/W at the card's upper right. Missing/unknown
values and older snapshots show no letter; there is no live refresh or backfill.
The implementation uses the same eligibility and ranking rules. Exact evidence and
remaining live-acceptance boundary are in the Atlas geography section. Geography
regression: 123 tests / 12 suites, lint, types and relevant gates/self-tests pass;
synthetic desktop/mobile component render confirms 24px E/W at upper right without
overflow. Luna built and Sol reviewed. The owner subsequently authorized Opus
reviews as needed, through subscription OAuth only (no API-key authentication).
A bounded Opus source review of `d2cc82fdf` returned APPROVE. Its nonblocking
accessibility note was corrected by giving the E/W symbol an explicitly named
image role; the page regression now checks that accessible role/name. No further
review loop was needed. No milestone entry is required.

### Follow-up: ten-color reviewer-rating circle

The owner chose ten approximate rating colors despite varying reviewer counts.
The shared card now adds a 24px solid lower-right circle: red low, yellow middle,
green high, gray unscored. It maps the frozen raw mean from 1–5 to the nearest of
ten steps; numeric score display and all ordering/calculations remain unchanged.
Matching colors do not imply exact ties. E/W remains at the upper right. No source,
configuration or live data changes are part of this UI-only addition. Validation:
126 ranking/Explorer tests, lint, types and relevant gates pass; desktop/mobile
component renders confirm all colors, gray fallback and no overflow. Luna built;
Sol and OAuth-only Opus approved. The hover label uses the same rounding as the
visible score after correcting Opus's nonblocking note. No milestone entry required.

### Follow-up: owner-approved read-only Production inventory

[VERIFIED via `scripts/probe-proposal-ranking-production-readiness.mjs`, GET-only,
2026-10-07] After the owner-approved December-only cutoff, Production has 24 matching
requests: D26 has 23 (11 SE, 12 MR), J26 has one SE. Five D26 SE requests were
excluded from the original 29-row scan. The shared trial cutoff excludes numeric
`akoya_requestnum >= 1003220` for D26 only before downstream reads/new snapshots;
malformed D26 numbers abort. Other cycles and existing frozen snapshots are unchanged.
Both readiness probes use the same rule; existing test-marker exclusion stays intact.
The scan completed without a cap or unmapped meeting dates. Request number,
meeting date and program were selected; no business rows printed.
All three ranking entity metadata lookups returned 404 (`0x80060888`). The exact
application-role query and assignment query returned 200 with no matching role.
No Production writes, provisioning, settings or activation occurred. Exit 2 denotes
missing readiness prerequisites. The Atlas records scope and limits.
Cutoff validation: 134 tests / 13 suites, types and relevant data/documentation gates
and sequential self-tests pass. Luna built; Sol and bounded OAuth-only Opus reviewed
without substantive findings. The ranking app remains disabled; the later exact-record marker correction is below.

### Owner-approved legacy test flags — 2026-10-07

[VERIFIED via exact-row PATCH and GET readback] Requests 1003220, 1003221 and
1003222 now have `wmkf_istestrequest=true`; each successful conditional PATCH sent
only that field. Their `wmkf_testcreationrunid` values remain null. The owner
explicitly authorized these Production writes. No factory provenance was invented;
the existing classifier calls marker-only legacy rows anomalies and excludes them
from ordinary flows. Ranking activation/schema/roles remain untouched.
The new one-purpose local command is
`scripts/maintain-proposal-ranking-d26-test-markers.mjs` (dry-run default). Its
separate client method fixes the three request numbers, resolves IDs/ETags internally,
retains the target interlock and generic marker guard, and reads back uncertain
outcomes without retrying. All three returned `verified-marked`, confirmed PATCH
success, no transport error, and unchanged empty run ID.
Validation: 81 tests / four client/marker suites, types and data gates pass; Luna
built, Sol and OAuth Opus reviewed, and receipt/uncertainty corrections were included.
Fresh GET-only cohort scan: 26 ordinary-filter matches, two further D26 cutoff
exclusions, D26 still 23 (11 SE / 12 MR), J26 one SE. Keep the D26 cutoff.

### Production setup completed; access and privacy verified

[VERIFIED via live apply and GET metadata/security readback] Owner-approved step 1
is complete: three ranking tables, all expected attributes and Active keys; dedicated
application role with nine ranking Create/Read/Write privileges plus nine documented
Dataverse defaults. Exactly one assignment to the verified application system user,
no team assignments. That schema step did not change app activation, grants or settings.
Receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_SETUP_2026-10-07.md`.
The strengthened GET-only probe exits 0. Luna built verification; Sol and OAuth Opus
reviewed and substantive verification gaps were corrected. Production schema/role
setup must not be repeated as new work.

[VERIFIED via live configuration and independent readback] Beth is now the default
facilitator; Justin, John, Jean and Beth have additive Proposal Ranking grants.
Other grants are unchanged. All four effective staff identities lack ranking Read
privileges and all 12 collection reads returned 403. App controls returned 200/empty;
all three tables are excluded from the provisioned search index. Receipt:
`docs/audits/PROPOSAL_RANKING_PRODUCTION_ACCESS_PRIVACY_2026-10-07.md`.
The app stays disabled with no ranking business rows. Next: owner-directed promotion
and deployment of branch privacy guards (absent on origin/main), then approved
activation and multi-identity browser acceptance. Do not create live ranking rows
before the generic-reader guards are deployed.

Private ranking, submission, composite publication, meeting reordering and full-requested
budget totals still need a source-backed, multi-identity in-app walkthrough. Counts
alone do not verify review completeness or full snapshot eligibility. Do not relax
test exclusion or treat D99's retained synthetic snapshot as eligible proposals.
The Session 582 history below remains the implementation and prior live-proof record.

## Session 582 Summary — 2026-10-07 (Codex)

Owner-approved Proposal Ranking was built on `codex/proposal-ranking` in the
isolated worktree. Luna performed reconnaissance/build work, Sol reviewed its
slices, and the orchestrator integrated and corrected the implementation. Claude
Opus reviewed through subscription OAuth only: R1 requested four concrete fixes;
R2 approved with a nonblocking validation-message note, which was corrected.
No Fable was used. Subsequent sandbox provisioning and live-field corrections are
recorded in `docs/audits/PROPOSAL_RANKING_SANDBOX_SETUP_2026-10-07.md`.
The app remains disabled; production is unchanged.

### Completed source

- Separate `/proposal-ranking` app with private SE/MR PD orders, external-review
  seed, explicit locked submissions, equal-average composites, named ranks and
  disagreement, facilitator publication, shared meeting edits and full-requested
  cumulative budgets.
- Frozen eligible ordinary Phase II Pending pool and roster, ETag changesets,
  operation receipts, filtered private responses, uncertainty recovery and scope
  guards. Exceptional excusal, unpublished cancellation and facilitator transfer.
- Three Wave 32 Dataverse table definitions, dedicated application role, exact-on
  readiness, Admin default-facilitator picker, generic-reader metadata privacy.
- Atlas, API matrix, service catalog, app/route registration, canonical counts,
  reviewed design/API contract, and full Opus source-review receipt.

### Latest session commits

- `458d7248f`: merged main into the isolated feature branch.
- `8d8b10872`: sandbox schema/role evidence and live source-field corrections.
- `8be9f57a1`: ETag normalization fix and successful bounded persistence rehearsal.
- `3f5c6cf10`: reproducible GET-only staff privacy proof and documentation.
- Session-close documentation follows these commits; all work stays on
  `codex/proposal-ranking`, draft PR https://github.com/justingallivan/wmkf-research-apps/pull/457.

### Earlier implementation commits

- `042ec90b0`: reviewed product/design contract.
- `5279c92cc`: owner-approved transcript-doc gate annotations.
- `35052a7c0`: deterministic ranking calculations.
- `f1b812d86`: frozen source preview and persistence schema.
- `27c942c10`: ranking and meeting interface.
- `1d2a721cb`: direct/indirect generic-reader privacy.
- `a1f4e0f4e`: authorized lifecycle, recovery, Admin and reviewed corrections.
- Final receipt/message-tag and handoff documentation follow these commits.

## Historical Session 582 next items — superseded by Production follow-ups above

Source evidence and exact steps: `docs/atlas/dataverse-proposal-ranking.md`.
Sandbox schema/role provisioning is complete and readback passed: three tables,
expected fields/bounds, three Active alternate keys and app-only role assignment.
The complete eligible-source scan returned zero proposals. The owner chose a minimal
rehearsal restricted to the new ranking tables. D99 now retains two synthetic cards
in its snapshot only; no source proposals were created or changed. Initialization,
conditional save, stale ETag rollback and duplicate-key rollback passed. Search
status confirms the three entities absent from the sandbox search index. The follow-up
GET-only probe verified effective staff identity via EqualUserId and denied all
three exact fixture reads with 403 under both impersonation headers, with app-200
controls and absent effective Read privileges. WhoAmI returned the app identity
even under effective impersonation; do not use it as that identity assertion.
Bounded proof: `docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`.
Actual Beth Pruitt identity selection and app grants, readiness configuration and
multi-identity browser rehearsal remain unperformed. Do not recreate the D99 fixture.
Evidence and retained IDs: `docs/audits/PROPOSAL_RANKING_PERSISTENCE_REHEARSAL_2026-10-07.md`.
Luna corrected the processed ETag adapter contract; Sol and bounded OAuth Opus
approved. No new production milestone entry is required.
No production read, write, deployment or activation is authorized by this handoff.
### Next session: in-app walkthrough

[VERIFIED OPEN via Atlas and rehearsal receipts] Configure the verified facilitator
identity and participant app access in the approved environment, then walk through
private ranking, submit, composite generation/publication, meeting reordering and
budget totals. The sandbox has zero eligible ordinary source proposals; resolve
that acceptance-data limitation before claiming an end-to-end live meeting. Do not
silently create or copy source proposals, relax test exclusion, or reuse the D99
storage fixture as a valid source-backed round.

### Owner decision needed

Deliberate production promotion/activation remains pending after acceptance evidence
and current-head CI review. No production action is inferred from this handoff.

### Do not reopen without a new decision

No realtime infrastructure, ranking notes, combined SE/MR list, funding writeback,
or changes to existing proposal fields. Continue Luna build/recon → Sol review →
orchestrator final review → bounded Opus OAuth review when further builds are needed;
no Fable or API-key agent sessions. Avoid review churn over minor improvements.

### Key files

- `docs/atlas/dataverse-proposal-ranking.md`: current activation checklist.
- `docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`: bounded privacy evidence.
- `scripts/probe-proposal-ranking-staff-privacy.js`: repeatable GET-only proof.
- `scripts/probe-proposal-ranking-persistence.js`: retained D99 storage rehearsal;
  do not repeat its write mode.

Local `/private/tmp` receipts are not portable between Macs. Retained record IDs
and sanitized results are checked into the audit receipts; if re-running a probe
on another machine, reconstruct only its required receipt input from that evidence,
then verify the target and rows by GET. Never copy credentials between machines.


## Testing and review evidence

`docs/audits/PROPOSAL_RANKING_OPUS_IMPLEMENTATION_REVIEW_2026-10-07.md` records the
review text, accepted corrections, local build/tests and bounded evidence limits.
Canonical production build passed after the source corrections. The two live-source corrections passed 110 tests
in 10 suites plus lint/type/data gates and Sol/Opus review. The earlier full GitHub Jest run had an unrelated transcript-card failure. The later
run at `8d8b10872` passed (run `37698207467`); no transcript runtime changes were made
here. The ETag correction and rehearsal pass 116 tests in 12 suites, plus lint and
the DAL gate/self-test. Full GitHub Jest also passed at `8be9f57a1`.
The follow-up GET-only privacy probe passed live, with 9 focused safeguard tests
and relevant documentation gates/self-tests passing. New commit CI is separate.
Feature/Explorer integration regression command:

```bash
./node_modules/.bin/jest --runInBand tests/unit/proposal-ranking-*.test.js tests/integration/dynamics-explorer-tool-serialization.test.js
```

The task worktree has its own local dependency copy because Turbopack rejects a
node_modules symlink outside its root. No package/lockfile changes were made.
The original checkout and its unrelated dirty lockfile were left alone.
Claim-evidence pilot report was unavailable (local observation state unreadable);
no invented observation row was added. No production milestone entry was required.

## Other workstreams

Prior transcript/summary UX and Final Writeup handoff context is preserved at
`git show fc56ca483:SESSION_PROMPT.md`. Those items were not reverified or advanced
by this ranking build; read current owner/source evidence before resuming them.
Do not carry forward destructive cleanup instructions without fresh verification.

[VERIFIED via signed-in Chrome after the facilitator change] Justin now sees the
D26 facilitator preview: 23 proposals, four PDs, 51 outstanding reviews, zero
unscored. The Open round acknowledgement remains unchecked; no round was opened.
The institution-name display defect is corrected in source: use linked account.name,
not the sparse request wmkf_organizationname field. Live metadata and all23account
names were verified. Release/browser confirmation is recorded in the Atlas below.
---

## Session 584 Summary (Claude, main) — 2026-10-07/08 PT

### What Was Completed
1. **Zoom speaker-identity fix released:** PR #459 (merge `f48fba1ab`); owner accepted it on 1003038.
2. **Staff Deliberations copy:** PR #460 (merge `ea1e09a0d`): the briefing next step names the upcoming
   deliberation session date; the two writeup warnings drop "the Dataverse fill".
3. **Stage 5 leadership daily digest live:** PR #461 (merge `ddeb1b401`); migration 073 applied and copy
   seeded by the owner. Research only. Codex review: round 1 two high findings fixed (`c16c30092`), round 2
   approve. DEVELOPMENT_LOG entry added.
4. **J27 auto-prepare:** owner set Production `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26","J27"]`
   and redeployed; status list unchanged (register J27-084). Connor's Grant Cycle table note recorded in
   the cycle rollover plan §2a (to-do, not top priority).
5. **Repo hygiene:** 113 merged branches deleted from origin; performance-planning docs landed
   (`fd3366f5e`); test-date queue item closed with no clock dependence (`ef11d8e11`); the drain-table gate
   false positive fixed (`9f6001cb1`); the main handoff dropped by the PR #457 merge restored (`c7e6417f8`).
6. **Deliberations vocabulary options sheet** filed (`docs/plans/DELIBERATIONS_VOCABULARY_OPTIONS_2026-10-08.md`).

### Verified Open
1. **First leadership digest:** after the first Research writeup is sent to leadership, the next night's
   `final_writeup_leadership_digests` rows should have `accepted_at`. Evidence: plan Stage 5 rollout.
2. **First handoff email:** after the next Research "Ready for group review", its
   `final_writeup_handoff_emails` row should be `sent` from the lead PD. Evidence: plan Stage 4.
3. **Dependabot PR #447** (dependency bumps from 2026-10-06): CI check, then owner "merge". Evidence: work queue.
4. **Stream transcription audio** instead of buffering (200 MiB cap is memory-bound); decide alongside the
   Zoom import work. Evidence: work queue "Stream transcription audio".
5. **Stale local worktrees** (~20 on this Mac, including 8 on merged branches). `../WMKF_Apps-codex`
   (`codex/transcription-pilot`) holds `e899518a5`, whose docs landed on main in `fd3366f5e`. Leave
   `../WMKF_Apps-codex-proposal-ranking` and `../WMKF_Apps-codex-transcript-ux` alone while Codex uses them.
   Check each for unpushed work before removing. Evidence: `git worktree list`.

### Owner Decision Needed
1. Cycle rollover design (plan §9): a to-do, not top priority; anchor on the planned `wmkf_grantcycle` table.
2. Deliberations vocabulary: resurface November 1, 2026 (reminder below).

### Do Not Reopen Without New Decision
1. Leadership digest: Research only, system mailbox sender, copy in settings (owner, 2026-10-07).
2. SoCal does not use the app suite yet; keep it out of the handoff email and digest (owner, 2026-10-07).

### Process notes
- A local Production Dataverse write (e.g. `scripts/seed-email-defaults.mjs --execute`) needs
  `DATAVERSE_PROD_WRITE_ACK="<purpose> <today UTC>"`.
- Vercel Production env changes and `vercel redeploy` are blocked for Claude by the permission
  classifier; the owner runs them with `!`.
- When merging a feature branch that carries its own `SESSION_PROMPT.md`, keep main's handoff
  (the PR #457 merge replaced it).

---

## Owner reminder (set 2026-10-07, Session 584)

**November 1, 2026:** remind the owner to pick up the deliberations vocabulary options sheet,
`docs/plans/DELIBERATIONS_VOCABULARY_OPTIONS_2026-10-08.md`, before the after-D26 group decision.

---

# Restored main handoff (Session 584, Claude)

The PR #457 merge (`10c079c86`) replaced this file with the ranking branch's copy, dropping
the main-session handoff below. It is restored verbatim here; the ranking handoff above is current
for Proposal Ranking, and its older ranking sections below are superseded by it.

## Session 585 Prompt: resume Meeting Tracker recording workflow planning after Zoom admin meeting

(The Codex transcript UX planning handoff that stood here was moved to the top of this file on 2026-10-08.)

## Prior handoffs preserved below

The prior S584 notes retain unrelated Proposal Ranking and Final Writeup work. Earlier transcript acceptance TODOs below are historical; the owner acceptance recorded above supersedes them. Historical cleanup suggestions are not authorization to delete anything.

## Session 584 Prompt: transcript speaker fix released (PR #459), owner-accepted; UX follow-up with Codex; preserve Proposal Ranking handoff; group-review handoff email live (S581)

## Session 583 transcript handoff — 2026-10-07 PT (Codex)

**Update, Session 584 (Claude):** the owner said "merge", and the fix went out as
[PR #459](https://github.com/justingallivan/wmkf-research-apps/pull/459), merge
`f48fba1ab`. All CI passed after main was merged in. [VERIFIED via GitHub deployments +
`vercel inspect`] The Production deployment `wmkfresearchapps-bmhqc863s` was built from
`f48fba1ab` and serves the production domains. Steps 1–2 below are done. **Step 3: the owner
reported after regenerating that the fix "looks like it worked"** (owner report; Claude did
not read the job itself). Remaining transcript-page UI/UX issues and a new feature request
were handed to Codex on worktree `../WMKF_Apps-codex-transcript-ux`, branch
`codex/meeting-transcript-ux` (not merged).

Original S583 status: built and pushed on `codex/meeting-transcript-fixes`, tip `5ee323aaa`.
The existing Proposal Ranking handoff is preserved below.

### Completed on the feature branch

- `c7067f3df`: full-recording Zoom timing/wording reconciliation for reused audio speaker IDs.
- `5ee323aaa`: preserve valid global names and prior short-reply corrections; prune metadata
  for vanished IDs; retain recovery of unnamed IDs, including 3:1 evidence with a singleton.
- Names and per-turn corrections persist together in the existing bounded alignment JSON.
  The central content read applies them to preview, manual naming, download and publication.
  No schema migration or saved-job repair was performed.
- Claude Opus reviewed through subscription OAuth. Its three findings were fixed. The follow-up
  accepted those fixes and identified an unnamed-ID recovery regression; that and the singleton
  edge case were then fixed and independently reviewed with no remaining actionable findings.
- Verification: 30 suites / 725 tests passed before the last singleton regression; final focused
  rerun passed 69 tests including that new case. Types, scoped lint and documentation currency
  checks passed. This is mocked/local verification, not hosted end-to-end acceptance.
- Offline VTT replay retained four Allison corrections with zero existing names removed.
  It reconstructs IDs from display names, so it does NOT prove raw-provider generation behavior.

### Verified open and next-session sequence

1. ~~Done S584.~~ Fetch and resume `codex/meeting-transcript-fixes`; do not rebuild from main. Read the branch's
   generation-fix section in `docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md` and its tests.
2. ~~Done S584 (PR #459).~~ Review current-head integration/CI and arrange a deliberate release. **Owner decision needed:**
   runtime merge/promotion; stopping and pushing this handoff did not authorize that release.
3. After confirming the deployed revision includes the fix, regenerate and inspect request
   **1003038**, especially **01:02:04** and **01:02:12**, against Zoom's Allison captions.
   Verify the actual raw-provider output, saved alignment and displayed/downloaded transcript;
   do not substitute the offline VTT probe for acceptance of the real generation path.

**[VERIFIED via signed-in UI and fetched main source]** The owner tested production and still
saw evaan / jingli at those times. New draft job: `ac090b3e-dd49-4719-b3db-c81718865f46`,
ready Oct 7 at 4:23 PM. At inspection, main `afb99fee3` still returned the old verdict without
`reconcileZoomSpeakerTurns`; this run therefore did not test the branch fix. Do not describe
that production result as a failure of deployed new code. Conversely, the branch is not yet
proven by a real hosted generation run. Original earlier job: `adba2697-5c75-4847-bae4-c544ef7a3ca3`.

### Resume references and limits

- Branch source: `lib/services/transcription-pilot/zoom-vtt.js`,
  `lib/services/meeting-tracker-transcription/alignment-service.js`,
  `lib/services/transcription-pilot/runtime.js`, and `transcript-format.js` in that directory.
- Branch regressions: `tests/unit/transcription-zoom-speaker-turns.test.js` and alignment-service tests.
- Branch-only reproducible local probe: `scripts/probe-transcript-speaker-turns.mjs` (two local VTTs).
  Downloads and temporary review reports do not travel between machines; obtain authorized inputs
  afresh if needed. Transcript wording was not committed.
- Feature worktree retained; unrelated worktrees untouched. No new production milestone shipped,
  so no DEVELOPMENT_LOG entry is required. The current-session claim-evidence report was unavailable
  because its local state could not be read; no observation row was invented.

---

## Previous Session 583 Prompt: resume Proposal Ranking from its feature branch

## Proposal Ranking handoff — 2026-10-07 (Codex)

Owner requested this docs-only pointer on main so `/start` on the home machine can
find the unmerged work. The implementation remains on **`codex/proposal-ranking`**,
latest handoff commit **`283f02a19`**, in
[PR #457](https://github.com/justingallivan/wmkf-research-apps/pull/457).
This main commit does not merge or enable the app.

### Resume at home

1. Fetch origin and inspect the current checkout for unrelated changes.
2. Continue on the existing remote branch `codex/proposal-ranking` (create a local
   tracking branch if absent); do not rebuild the feature from main.
3. Read that branch's `SESSION_PROMPT.md` and its linked Atlas/audit receipts for
   the detailed handoff. Use the home machine's own credentials for live checks.

### Verified progress

- Separate ranking app built by Luna, reviewed by Sol and the orchestrator, with
  bounded Claude Opus subscription-OAuth reviews. No Fable or agent API-key use.
- Sandbox schema and role provisioned. Storage initialization, conditional save,
  stale-edit atomic rejection and duplicate-cycle rejection passed.
- GET-only privacy check verified direct-table denial for one enabled nonapp
  sandbox staff identity: effective-user query matched, all three retained records
  returned 403, and application control reads returned 200. This is impersonation
  evidence, not an all-staff or production claim.
- Existing proposal/review fields were unchanged. D99 synthetic cards exist only
  inside retained ranking snapshot data. Do not rerun fixture creation.
- Runtime app remains disabled; production ranking schema/activation is pending.

### Next items

**Verified open:** in-app walkthrough of private rankings, submission, composite
publication, meeting reordering and full-requested budget totals. Facilitator
configuration, participant grants and approved-environment readiness remain open.
The earlier sandbox source scan found zero eligible ordinary proposals; resolve
that acceptance-data limitation without silently copying/creating source proposals
or weakening test exclusion. See feature-branch evidence before acting.

**Owner decision needed:** deliberate production promotion after acceptance and
current-head CI review. No production activation is authorized by this pointer.

**Work constraints:** keep the solution simple; Luna builds/reconnoiters, Sol
reviews, orchestrator finishes, bounded Opus OAuth review. No review loops over
minor polish. Temporary local probe files do not travel between Macs; sanitized
results and retained IDs are committed on the feature branch.

### Commits and milestone determination

- `8d8b10872`: sandbox schema verification and source-field corrections.
- `8be9f57a1`: ETag fix and persistence rehearsal.
- `3f5c6cf10`: effective-user privacy verification.
- `283f02a19`: detailed feature-branch session handoff.

No new production milestone shipped; no DEVELOPMENT_LOG entry is required.

---

## Session 581 handoff (Claude, main) — 2026-10-07 PT

Final Writeup group-review handoff: **Stages 1–4 are live in Production.** Plan:
`docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`.

### What Was Completed

1. **Stage 3, lead-PD sign-off view: live** (PR #454, merge `b2bc23b95`; docs `1c06e0a52`).
   "Sign off" replaces "Mark reviewed"; the lead PD and superusers see which expected PDs have
   signed; Send to leadership names those who haven't.
2. **Stage 4, handoff email: live for Research** (PR #456, merge `8bc5b466b`; docs `3b582c9af`).
   - Ledger `final_writeup_handoff_emails` (migration 072). [VERIFIED via Production read
     2026-10-07] 19 columns, 4 indexes, 5 checks; 0 rows at session end.
   - Copy seeded by the owner (`email.final_writeup_handoff.subject`/`.body`; the same run also
     seeded the unseeded `email.deliberation_share.review_bundle_link_text` with its default).
   - [VERIFIED via `vercel env pull`] Production `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` =
     `["c247b11a-a7cb-ee11-9078-000d3a341e8f"]` (Research Grant Program, the same field as the
     auto-prepare list). Not the `RESEARCH_PROGRAM_IDS` Program GUIDs, which are a different field.
   - Owner rules: always deliver (rebuild, retry cron, alerts); internal staff only (exact
     `@wmkeck.org`); Kevin Moses removed from staffing by the owner; Beth Pruitt is PD and CSO by design.
3. **Lead-PD sender: live** (PR #458, merge `b14651597`; docs `81d87ddd9`). Owner: PD-to-PD mail
   comes from the lead PD, not the system. Impersonation with `noFallback`; a lead who can't send
   keeps the email pending and alerts ops. Owner verified that every PD can send from Dynamics.
4. **Stage 5 decision recorded:** the leadership digest is sent by the system mailbox.
5. **Fixes on main:** transcription pilot test fixture expiry (`b8a113513`); a race in
   `recording-and-transcript-card.test.js` that failed 2 of 3 main CI runs (`4a9817828`).
6. **Codex transcript/summary UX audit:** started in the `codex/transcript-summary-ux-audit`
   worktree; it shipped as PR #455 (`132eac566`). Follow-up is the Session 583 handoff above.
7. **SoCal parked** by the owner: `.claude-memory/project-socal-writeup-workflow-parked.md`.
8. Local `.env.local` Postgres lines refreshed from Vercel after the 2026-10-01 password rotation
   (backup in the S581 scratchpad, not tracked).

### Commits (main, first parent)
`b8a113513`, `b2bc23b95`, `1c06e0a52`, `fc56ca483`, `8bc5b466b`, `3b582c9af`, `4a9817828`,
`b14651597`, `81d87ddd9`; this handoff commit follows. Milestone entry added to DEVELOPMENT_LOG.md.

### Verified Open

1. **Confirm the first real handoff email.** After the next Research "Ready for group review",
   read its `final_writeup_handoff_emails` row: `state = sent`, `to_recipients` all
   `@wmkeck.org`, and the Dynamics activity's sender is the lead PD.
2. **Stage 5, leadership daily digest: LIVE S584** (PR #461, merge `ddeb1b401`; migration 073
   applied and copy seeded by the owner). Research only via `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS`.
   Remaining: after the first writeup is sent to leadership, confirm the next night's
   `final_writeup_leadership_digests` rows have `accepted_at`. Seeding needed
   `DATAVERSE_PROD_WRITE_ACK="<purpose> <today UTC>"` (plan Stage 5 rollout).
3. ~~**Other Mac:** refresh `.env.local` Postgres lines after the 2026-10-01 rotation.~~ **Done** (owner, 2026-10-07).

### Verify Before Acting

1. ~~**1003010 first scheduled preparation**~~ **Closed S584.** The owner ran the receipts
   report: all 14 D26 rows `prepared`, no errors; every scheduled row was last updated by one
   01:30 UTC (18:30 PDT) sweep. The owner saw 1003010's draft before 17:00 PDT (owner report).
   (Original note: expected ~15:45 PDT 2026-10-07; not checked in S581.) Owner-run:
   `DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/report-staff-deliberations-preparation-receipts.mjs --cycle=D26`
2. **S580 deferred small items: live S584** via PR #460 (merge `ea1e09a0d`;
   owner-approved wording). The list's briefing next step names the upcoming
   deliberation session date; the two writeup warnings drop "the Dataverse fill".
3. **J27: done S584.** The owner set Production `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26","J27"]`
   and redeployed; the status list needs no change (register J27-084). Connor's Grant Cycle table note
   is recorded in the cycle rollover plan §2a; the rollover design is a to-do, not top priority.
4. Older S577 items: last state in `git show e6666ae68:SESSION_PROMPT.md`.

### Owner Decision Needed

1. Cycle rollover (`docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` §9).
2. Deliberations vocabulary after D26 (`docs/NOMENCLATURE_GLOSSARY.md`).

### Parked

1. SoCal Final Writeup workflow: wait for the owner to raise it.
2. ~~Merged branches still on origin~~ **Done S584:** 113 branches whose tips were already in main were
   deleted from origin (owner-approved). Kept: 8 merged branches checked out in local worktrees, and
   all 67 unmerged branches. Stale local worktrees are a separate cleanup.

### Do Not Reopen Without New Decision

1. Handoff email: Research only via the program list; PD-to-PD mail from the lead PD with no
   system fallback; internal `@wmkeck.org` staff only; always delivered (owner 2026-10-07).
2. Leadership digest is system-sent (owner 2026-10-07).
3. S580 decisions: sign-off not required; counts after edits; no pull-back; app-level hiding;
   digest at midnight Pacific.

### Process notes

- The owner says "merge" to authorize a PR merge; `gh pr merge` worked this session.
  `vercel redeploy` was blocked by the auto-mode classifier; the owner ran it with `!`.
- Codex adversarial reviews: Claude may launch them
  (`.claude-memory/feedback-codex-delegation-review-vs-rescue-routing.md`).

### Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/final-writeup/handoff-email-service.js` | Stage 4 staging, delivery, recovery, lead-PD sender |
| `lib/services/final-writeup/handoff-email-store.js` | Ledger SQL (lease-fenced) |
| `pages/api/cron/final-writeup-handoff-emails.js` | 15-minute retry |
| `lib/services/final-writeup/acknowledgement-service.js` | Sign-off records and the Stage 3 roster |
| `shared/components/workbench/FinalWriteupTab.js` | Sign off, Send to leadership, handoff copy |

### Testing

```bash
npx jest tests/unit/final-writeup tests/unit/workbench-final-writeup-route.test.js tests/unit/staff-deliberations-tab.test.js tests/unit/test-request-email-sender-census.test.js
```

(Session 580 and earlier main handoffs: `git show 444a2d8f0:SESSION_PROMPT.md`.)
