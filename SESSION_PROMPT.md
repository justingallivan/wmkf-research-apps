# Session 647 Prompt: J27 — decide what the apps build for Dec 8

**Branch:** this handoff lives on `claude/j27-ai-materials-names` (owner choice,
S643/S646; pushed; **no PR**). `main` carries a short banner pointing here.
Prior handoffs, exact: this branch `git show 50fd2ed3b:SESSION_PROMPT.md`
(S645 J27 decisions D7–D21, meeting materials); `main`
`git show 69129dbf9:SESSION_PROMPT.md` (Codex S645: ranking locks, D26 lock,
Board archival constraints).

## Session 646 Summary (Claude, 2026-10-28)

Docs, decisions and read-only production probes. No runtime code changed and
nothing was released. The Oct 28 J27 meeting (Justin, Sarah, Duncan, Connor)
happened; its answers were recorded and the urgent follow-ups mostly cleared.

### What Was Completed

1. **Startup.** Pulled 272 commits on `main`; all 70 `check:*` runs green.
   Owner's Oct 21 local edit of `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.pptx`
   was backed up to the session scratchpad (gone after this session) and the
   file restored to upstream; two untracked `commit-times*.txt` deleted (owner).
2. **Meeting answers recorded** from the decision-calendar artifact
   (`https://claude.ai/artifact/9Jymc35yQXy82pdmBwc2QB`, `answers` collection,
   23 rows) into `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` as **D22–D42** and
   tasks **T8–T13**. Highlights:
   - Arrival status `Phase I Pending`; staff version contents/order; reviewers
     get the staff version in `Reviewer Materials`; magic links for Chairs/Board.
   - Only **Triaged** writes AkoyaGO: Phase I Status `Recommended Do Not Invite`.
     Other staff states stay app-side. The Grants Manager sets Phase I `Invited`
     + `Phase II Pending` (approved) or `Not Invited` (not approved) **in
     Dataverse**; the app writes neither (D31, D35, D39). Connor: nothing
     important triggers on Phase I Status changes (D42).
   - Staff states live in a **new field on the request** (D41), not the D26
     `wmkf_triagestatus`.
   - "Flagged for triage" renamed **"Flagged for concerns"** (D38).
   - Triage list flags proposals still Under consideration from Feb 3 (D40).
   - Connor's flows run on submit: short title (into `wmkf_wmkfprojectdescription`,
     existing `grantee-title.generate` prompt or edited), keywords, lay abstract,
     initial PD, clerical check, fitness flag, expertise (D37). Grantee-title
     cron becomes a no-op for J27; retire after the D26 Board (T13).
   - Either calendar role edits at any time (D7/D8 stand); central reviewer
     values entered later by the Grants Manager (D28).
   - **Placeholder meeting date resolved (T10):** use the request's
     `wmkf_grantcycle` lookup (set at submission, owner-confirmed), meeting
     date as fallback.
3. **Reconciled** the log's older sections, register Q2/Q5/Q8/Q9/Q21/Q22, and
   memory `project-grant-phasing-evolution.md` with the meeting decisions.
4. **Grant-cycle lookup probe** (`scripts/probe-request-grant-cycle-lookup.cjs`,
   on `main`, owner-run 3×). Lookup agrees with meeting-date cycle on all but
   one of ~3,400 requests (1003373: J27 lookup, J26 date); post-Aug coverage drop
   is the discretionary programs (no Board cycle), not SoCal; 001024 → J27.
   Five Research `Phase I Pending` strays lack it: 1002797, 1002822 believed
   deactivated test requests (probe does not filter `statecode`); Connor is
   reviewing 1000211, 1001975, 1002162.

### Commits

Branch `claude/j27-ai-materials-names`: `7b5dd3255` meeting answers;
`9666ed2c6` reconcile log/register/memory; `0686fcef0` short-title field +
cron task; `f72ae36d1` Phase I terminal values; `b85e6ea90` Under
consideration safeguard; `6bae97dad`, `f56595cca`, `567f9ca1e` grant-cycle
lookup findings; `e179e6b87` staff-state field + Phase I trigger check.
`main`: `dc74305cc`, `1fcacf889`, `939a21157` probe script.

## Next Items

### Verified Open

1. **Decide what the apps build for Dec 8** (owner deferred to a later talk).
   Evidence: alignment log D37, R-3, D13. With Connor's flows producing the
   intake outputs, settle: does the apps' Initial Assessment still run; how
   Connor's "fitness flag" relates to Flagged for concerns (D38, F1); which
   side does expertise matching (T8). This sets the Nov 15 build scope.
2. **PR for this branch.** Evidence: 57 commits ahead / 12 behind `origin/main`;
   the AI Materials name change (`62d7af5b6`, `b5bc02ae3`,
   `lib/utils/proposal-document-names.js`) is Tier 1, unreleased, needs
   independent review, and must ship before Dec 7. Docs-only commits could land
   first.
3. **Default-cycle plan** (D29, T10). Evidence: `docs/audits/cycle-settings-audit-2026-10-27.md`.
   One calendar-driven rule; read `wmkf_grantcycle` lookup first, meeting date
   fallback; three Board-date stores to reconcile.
4. **Builds decided, not built** (target Nov 15; confirm scope/order first):
   calendar editing + central values, filing window (D11), readiness digest
   (D12), Proposal tab J27 entry with D22 order (D20), triage list (D19, D40;
   Impeccable first), staff-state field (D41), Triaged → Phase I write (D31),
   Chairs writeup (D21, T11), `wmkf_grantcycle` reader.

### Owner Decision Needed

1. Triage-flag criteria and prompt (CSO; D38, F1). Expertise roster choice and
   mechanics (T8). Intake AI prompts (T9) and staff prompt debate (T7) before Dec 8.
2. Who assigns MR/S&E and when (CSO); Connor creates the "program at
   submission" field (D30) and the new files-ready flag (D25).
3. Leadership: timeline update for Chairs writeup review time (T12).

### Parked

1. Research request file corpus (owner approval; DB ops owner-run). Evidence:
   `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`.
2. Reviewer-save recovery follow-up; don't auto-resume.
3. T6: prompts readable to all staff.

### Verify Before Acting

1. Retiring the grantee-title cron (T13): only after the D26 Board meeting and
   the destructive-carryover check (callers, `vercel.json`, route matrix, Atlas).
2. Board archival: operational only; no batch or email authorized. D26 ranking
   meeting is deliberately locked — do not unlock/reset/archive as a test.
3. Calendar artifact rows were left as the owner set them; republish only from
   a fresh `read`.

### Do Not Reopen Without New Decision

1. D1–D42 as recorded through 2026-10-28; placeholder meeting date (T10).
2. Accept-both J27 file naming (2026-10-26); 001024 is the Research form.

## Constraints

- Production Dataverse/Postgres reads are owner-run with `!`.
- Plain item names, not log codes, with Justin and colleagues.
- Do not reset/stash/clean untracked `output/`, `.impeccable/critique/`, or the
  `backup/local-main-slice2-plan-drafts-2026-10-25` branch. `.codex/hooks.json`
  and `.github/hooks/impeccable.json` modifications (owner unknown): leave alone.
- A fresh worktree needs `.agents/skills -> ../.claude/skills` for `check:agent-wiki`.

## Concurrent Workstreams

| Workstream | Resume boundary |
|---|---|
| J27 alignment (Claude) | This branch; next: Dec 8 app scope |
| Ranking (Codex) | Done; PRs #536/#537. Codex also merged #539 (review management for responsible PD writeups) during S646 — not reviewed here |
| Board archival (Codex) | Readiness done; rehearsal runtime only on `codex/board-archive-rehearsal` |
| Research request corpus (Claude) | Owner-gated |

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Decisions D1–D42, tasks, state model, decision calendar, AkoyaGO field matrix |
| `docs/J27_TRANSITION_REGISTER.md` | Register; Q2/Q5/Q8/Q9/Q21/Q22 updated 2026-10-28 |
| `scripts/probe-request-grant-cycle-lookup.cjs` (`main`) | Read-only grant-cycle lookup probe |
| `docs/audits/cycle-settings-audit-2026-10-27.md` | Cycle identity/default/date sources |
| `lib/utils/proposal-document-names.js` | Accepted AI Materials names (branch change) |

## Testing

```bash
npx jest tests/unit/workbench-proposal-text.test.js tests/unit/workbench-proposal-document-listing.test.js
npm run check:j27-register && npm run check:doc-symbol-refs
```

## Verification and Closeout

Milestone determination: no DEVELOPMENT_LOG entry; decisions, docs and
read-only probes only, nothing shipped. No CLAUDE.md change. Claim-evidence
report: no eligible plan/design edit events, so no observation row.
