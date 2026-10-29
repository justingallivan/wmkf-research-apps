# Session 649 Prompt: J27 — plan the reviewer-invitation build; Workbench list before Dec 11

**Branch:** `main` (both landing-cycle PRs merged). Prior handoff, exact:
`git show 442c7c009:SESSION_PROMPT.md` (Session 647: cycle calendar shipped, D43).

## Session 648 Summary (Claude, 2026-10-29)

The cycle calendar now decides which cycle every app opens on, automatically, and
an audit of every business date showed what the calendar does not yet drive.

### What Was Completed

1. **Landing cycle shipped (PR #547, `6c9a1013b`; PR #550, `aefaebdf7`; both
   deployed to Production per Vercel commit status).** Apps open on the cycle with
   the next Board meeting (operations Grant Cycle Board date) and switch at the
   start of the Pacific day after it: J27 from 12:00 am Fri Dec 11, 2026 (D45,
   amends D29). Workbench/Meeting Tracker, Program Briefing, Proposal Ranking,
   Expertise Finder and Board pages follow it when the cycle is in their list; a
   URL cycle wins; open pages never switch; reads are deadline-bounded. Board pages
   follow it only once that cycle has a Board setup (else nearest upcoming dated
   setup by Pacific day). Calendar box: "Automatic: …", next switch date, optional
   override. Reviews: contract-reconcile; Codex gpt-6.1-terra (plan) and
   gpt-6.1-sol (plan, PR, two fix rounds) — all findings fixed.
2. **Codex now works on `gpt-6.1-sol`.** Root cause of "model not supported": the
   review plugin's background broker still ran Codex 0.156.1 after the npm upgrade
   to 0.165.0; the owner killed it. Stale brokers from Oct 8/15 sessions remain
   (harmless; owner may kill).
3. **Calendar attribution proven for non-superusers in Production**: the Grants
   Manager's 8 saves and a second editor's 1 are each recorded under their own
   names (`docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md`).
4. **Decisions:** D44 review filing has no start bound (files until the Board
   date); D45 automatic landing cycle; D46 J27 reviewers get materials on
   acceptance, no proposal-release date. Column meanings: invitation start = Chairs
   Semi-Finalist Meeting; Board materials due = Board Mailing Date. Dates with no
   Grant Cycle column stay app-side (only the Feb 3 deadline remains). J27 Reviews
   Due is Mar 10, 2027 (calendar; old timeline said Mar 17).
5. **Plans and audit:** `docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md`;
   `docs/plans/CYCLE_DATES_CENTRALIZATION_PLAN_2026-10-29.md`;
   `docs/audits/date-consumers-audit-2026-10-29.md` (Claude + independent Codex,
   compared; two Claude errors corrected).
6. **Guide for Sarah and Duncan** (Claude doc, rewritten plain):
   https://claude.ai/artifact/96BYj2iYny5aW1LmTLwDYJ
7. Housekeeping: Codex calendar worktree removed (merged, clean); route matrix,
   Atlas and catalog markers updated to deployed; main checkout `npm ci` restored a
   missing dependency.

### Commits

`main`: plan `813935bb8`…`cde648ce0` (on branch, merged); PR #547 merge
`6c9a1013b`; PR #550 merge `aefaebdf7`; docs `f396c8cc7`, `b0ce91fd5`,
`99d8ad9ae`, `988aadec8`, `91dca2e06`, `174233434`, `d6aba6cb6`, `bb3816ef3`,
`eeefeb567`, `bcc5ec4dd`, `ba03ccd62`, `6574dbc3b`, `ce8c4ba3e`; session close:
this commit.

## Next Items

### Verified Open

1. **Plan the one reviewer-invitation build (owner, 2026-10-29), before Feb 24.**
   Materials on acceptance (D46; work queue item 6) together with the review due
   date from the calendar (audit risk 1): shared calendar reader; invitation and
   stored request due date from Reviews Due; remove per-send and browser-saved due
   dates; extensions based on the calendar date; Reviewer Finder record dates
   retired; new invitation and acceptance email wording. Evidence:
   `docs/CURRENT_WORK_QUEUE.md` item 6; centralization plan §2a, §6; audit §7.
   Plan-first, contract-reconcile, Codex review.
2. **Workbench list shows J27 Phase I Pending (Nov 15 list, R-1).** Needed so staff
   see J27 proposals, and so the Dec 11 automatic switch reaches Workbench,
   Meeting Tracker and Program Briefing (they only list cycles with visible
   proposals). First confirm with Connor the status J27 proposals arrive with.
   Evidence: `shared/config/workbenchVisibility.js`; audit W3.
3. **J27 proposal file slots** (Workbench Proposal tab inherits D26's map) before
   Dec 7. Evidence: `shared/config/workbenchProposalDocuments.js`; audit W7.
4. **Rest of date centralization** (plan §2, §6): review filing by window replacing
   `REVIEW_DOCX_SHAREPOINT_CYCLE` (D44); Staff Deliberations prep by calendar after
   the old/new cohort diff, and check J27 Zoom presentations trigger prep (before
   April); Board setup dates default from the calendar; show on the calendar when a
   manual override holds the landing cycle; remove Admin `inviteStartDate`.
5. **Dec 8 scope decision** (carried): does the apps' Initial Assessment run for
   J27; Connor's fitness flag vs "Flagged for concerns" (D38, F1); expertise
   matching (T8). Sets the Nov 15 scope.

### Owner Decision Needed

1. **Ask Connor:** when a Board date moves, do request meeting dates follow? (Board
   date lives in three stores; audit §4.) And the status J27 proposals arrive with.
2. **Sarah:** fill the Chairs Semi-Finalist Meeting Date before Feb 24 (invitation
   start). Stopgap if the reviewer build slips: Admin reviewer default review due
   date = 2027-03-10.
3. Per-request due dates already saved on D26 requests stay as they are (proposed).
4. Whether the calendar should edit the Board date (read-only today).
5. Carried: triage-flag criteria (CSO; D38, F1), expertise roster (T8), intake
   prompts (T9/T7), MR/S&E assignment (CSO), Connor's program-at-submission field
   (D30) and files-ready flag (D25), Chairs-writeup review time (T12).

### Parked

1. Research request file corpus (owner-gated):
   `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`.
2. Reviewer-save recovery follow-up; T6 prompts readable to all staff.
3. Workflow vocabulary rename in the apps (approved Oct 21; mid-cycle hold):
   `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`.

### Verify Before Acting

1. Retiring the grantee-title cron (T13): only after the D26 Board meeting and the
   destructive-carryover check.
2. Board archival: operational only; D26 ranking stays locked.
3. Stale Codex brokers (pids from Oct 8/15 under `~/.claude/plugins/data/codex-openai-codex/state/`):
   owner-run kill only; confirm no live Claude session uses that state dir.

### Do Not Reopen Without New Decision

1. D1–D46 as recorded through 2026-10-29; automatic landing cycle (D45); calendar
   page keeps its own default (nearest Board date); Staff Deliberations name kept.
2. Accept-both J27 file naming; 001024 is the Research form; 1003373 is Connor's.
3. Site-visit materials and reviewer reminder crons are unscheduled by decision.

## Constraints

- Production Dataverse/Postgres reads are owner-run with `!`; Production writes
  need the owner plus a dated `DATAVERSE_PROD_WRITE_ACK` passed to the one process.
- Pass `DYNAMICS_SANDBOX_URL` inline only; setting it in `.env.local` repoints four
  runtime services to the sandbox.
- Plain item names, not log codes, with Justin and colleagues; no technical terms
  in anything for Sarah and Duncan.
- Add a calendar date only together with the feature that reads it.
- Merging a PR needs the owner's OK for that PR (an earlier OK doesn't carry).
- Codex: `gpt-6.1-sol` default; if a review fails on "model not supported", check
  for a stale broker before switching models (don't pass `--model` without the
  owner's OK).
- Leave untracked `output/`, `.impeccable/critique/`, the
  `backup/local-main-slice2-plan-drafts-2026-10-25` branch, and the
  `.codex/hooks.json` / `.github/hooks/impeccable.json` modifications (owner
  unknown) alone.
- Codex rescue delegations whose brief mentions a review need
  `[INTENTIONAL-RESCUE: …]` plus the CODEX RESCUE HANDOFF preface (hook).

## Concurrent Workstreams

| Workstream | Resume boundary |
|---|---|
| J27 alignment / cycle dates (Claude) | `main`; next: reviewer-invitation build plan; Workbench list |
| Admin prompts grouping (Codex) | Merged PRs #548/#549 |
| Ranking (Codex) | Done; PRs #536/#537 |
| Board archival (Codex) | Readiness done; rehearsal runtime only on `codex/board-archive-rehearsal` |
| Research request corpus (Claude) | Owner-gated |

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/CYCLE_DATES_CENTRALIZATION_PLAN_2026-10-29.md` | One home per cycle date; order to Feb 24 |
| `docs/audits/date-consumers-audit-2026-10-29.md` | Every business date, its homes and consumers |
| `docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md` | Landing cycle design and build record |
| `lib/services/landing-cycle-service.js` | Automatic rule, override, Board default |
| `shared/components/landing-cycle/` | Calendar control and client hooks |
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Decisions D1–D46 |
| `scripts/probe-grant-cycle-history-entries.cjs` | Read-only calendar history probe (owner-run) |

## Testing

```bash
npx jest tests/unit/landing-cycle-*.test.js tests/unit/board-page-landing-cycle.test.js tests/unit/expertise-finder-landing-cycle.test.js
npm run check:api-routes && npm run check:atlas && npm run check:j27-register
```

## Verification and Closeout

Milestone determination: DEVELOPMENT_LOG entry added ("Landing cycle: every app
opens on the next Board cycle and rolls over by itself", Session 648). No CLAUDE.md
change. Claim-evidence pilot: one recorded event for session key
`77c85ca295d49e75`; row added.
