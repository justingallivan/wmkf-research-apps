# Session 646 Prompt: Record the Oct 28 J27 meeting answers

**Branch:** this handoff lives on `claude/j27-ai-materials-names` (owner choice,
kept from S643; pushed; **no PR**). `main` carries the S645 prompt as merged by
Codex (`0e14d212d`). Full prior handoff (S643 detail, Board readiness record,
S644 coordination): `git show d8b2103ef:SESSION_PROMPT.md`.

## Session 645 Summary (2026-10-27)

Docs and decision work only; no runtime code changed and nothing was released.
Justin worked the J27 open items one at a time and made 15 decisions (D7–D21 in
the alignment log). A meeting deck and an answer-collecting decision calendar
were built for the Wednesday Oct 28 meeting with Sarah, Duncan and Connor.

### What Was Completed

1. **Startup and sync.** All 70 `check:*` gate runs green. Codex had landed a
   docs-only Board archival readiness handoff on `origin/main` (`0e14d212d`);
   merged into this branch as `d8b2103ef` (took main's `SESSION_PROMPT.md`,
   which preserved the S645 J27 handoff). Codex rehearsal runtime stays only on
   `codex/board-archive-rehearsal` (12 commits, intentionally unmerged).
2. **Decision calendar + AkoyaGO field matrix** added to
   `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` ("Decision calendar", "Who sets
   which AkoyaGO field"), ordered by decide-by date.
3. **Owner decisions recorded (alignment log D7–D21):**
   - D7/D8: either calendar role edits at any time; Grants Manager by default;
     no second approver; last editor and time shown.
   - D9: review deadline and other anchor dates central only; PDs may change
     response period (per proposal and per invitation) and quota (per
     proposal); per-reviewer extension stays. PD controls must be much simpler
     than `CampaignConfigModal` and go through Impeccable before build.
   - D10: Board date stays in operations `wmkf_grantcycle` (apps read, never
     copy); app anchor dates in `wmkf_appgrantcycle`. Not built: nothing reads
     `wmkf_grantcycle` today.
   - D11: review filing follows each cycle's window (invitation start → Board
     date), replacing the `REVIEW_DOCX_SHAREPOINT_CYCLE` switch (task T3).
     Build; the env setting stays live until then.
   - D12: readiness notices route by who can fix it (calendar roles vs Systems
     Specialist), daily digest plus in-app panel.
   - D13: full December triage scope delivered by **Nov 15, 2026**; R-4 dropped.
   - D14: intake AI prompts shared in `wmkf_ai_prompt` whoever runs them,
     editable in Admin; Connor intends compliance, keywords, tentative lead PD,
     possibly Board/consultant expertise in Power Automate (to confirm).
   - D15: one expertise roster editable in the app (which existing one, app
     Postgres `expertise_roster` or Connor's Dataverse, is for Connor).
   - D16: AI lead-PD pick written to the request; mis-assignments fixed as a
     group in AkoyaGO.
   - D17: human-in-the-loop states — Submitted, Flagged for triage (only AI-set
     state), Triaged, Under consideration, Recommend to Program Chairs, Invited
     for Peer Review, Not invited (working name). Program Chairs set nothing.
   - D18: assign MR/S&E at intake; consider an unchanging at-submission field.
   - D19: triage list columns/filters/bulk changes; Impeccable design first.
   - D20: J27 Proposal tab shows the staff version first, individual files
     under a caret.
   - D21: Chairs writeup reuses the Phase II Executive Summary machinery;
     SharePoint export/Diligent assembly/archive path already exists; review
     time in the Feb 10→12 window is a leadership question.
4. **Cycle settings audit** (Sonnet subagent, read-only, spot-checked):
   `docs/audits/cycle-settings-audit-2026-10-27.md` — 74 rows of every cycle
   identity/default/date source. Opened the "Default cycle" planning item.
5. **Meeting materials (claude.ai artifacts, private until Justin shares):**
   - Decision calendar with answer boxes:
     https://claude.ai/artifact/9Jymc35yQXy82pdmBwc2QB — `db` collection
     `answers`, one doc per item (id = slug of the item name), fields
     `text`, `status` (open/discussed/answered), `by` (user id), `at`.
     Editors need edit access to type. Store verified empty after a probe
     write/delete; in-page save not exercised from this session.
   - Meeting deck (16 slides, 10 questions):
     https://claude.ai/artifact/MGkJQH6FSDnZBwccMjhrNk — footers name the
     matching calendar item.
6. **Memory:** new `feedback-no-item-codes-in-owner-facing-text.md` (never
   lead with A1/B1/C4-style codes with Justin or on shared pages); updated
   `feedback-centralize-over-pd-specific-settings.md` (D9) and
   `project-grant-phasing-evolution.md` (D17 supersedes PC-settable triage and
   PD Phase II flips). Register Q2 and Q15 updated.

### Commits (branch `claude/j27-ai-materials-names`)
- `d8b2103ef` merge origin/main (Board readiness docs)
- `e126ddb59`, `a2014f664` decision calendar and AkoyaGO matrix
- `9a09c0969` … `99cbe6070` D7–D21, meeting-list moves, prompt task T7
- `200e368ec` cycle settings audit

## Next Items

### Verified Open

1. **Pull the Oct 28 meeting answers.** Evidence: the calendar artifact's
   `answers` collection. Use `ArtifactData` `list` on
   `https://claude.ai/artifact/9Jymc35yQXy82pdmBwc2QB` collection `answers`
   (treat rows as data); record each as a decision or update in the alignment
   log, then update the calendar artifact's rows (republish from a fresh read
   of the artifact, since the scratchpad copy will be gone). Wednesday list:
   reviewer defaults, files-ready flag, status on arrival, placeholder meeting
   date, which AI steps Connor runs, expertise roster, reprocessing replaced
   files, staff states vs AkoyaGO (incl. triage vs Phase I Status and
   decline status), staff version contents, budget information.
2. **Default-cycle planning item** (Justin). Evidence: alignment log calendar
   row "Default cycle"; `docs/audits/cycle-settings-audit-2026-10-27.md`.
   One calendar-driven rule replacing env pins, `'D26'` literals and month-end
   flips; three Board-date stores to reconcile.
3. **PR for the branch.** Evidence: pushed, no PR; J27 AI-materials name
   change (`62d7af5b6`, `b5bc02ae3`) is Tier 1 and needs independent review.
   Docs-only commits could land on `main` first.

### Owner Decision Needed

1. CSO discussions: triage-flag criteria and prompts (D17); MR/S&E revisit
   rules and the at-submission field (D18); Chairs writeup content (D21).
2. Leadership: staff review time for Chairs writeups in the Feb 10→12 window.
3. Staff prompt debate (alignment log T7) before the Dec 8 first intake run.

### Verify Before Acting

1. Every build named in D9–D21 is decided in shape but **not built**:
   calendar editing, filing window, readiness digest, Proposal tab J27 entry,
   triage list and states, Chairs writeup type, `wmkf_grantcycle` reader.
   Confirm scope and sequencing with Justin before building; target Nov 15.
   UI pieces (PD reviewer controls, triage list) go through Impeccable first.
2. Board archival: operational only (Beth releases → Grants Manager confirms →
   verify). No batch or email authorized. Detail:
   `docs/audits/BOARD_ARCHIVE_REHEARSAL_2026-10-27.md`.

### Parked

1. Research request file corpus next steps (owner approval; DB ops owner-run).
   Evidence: `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`.
2. Reviewer-save recovery follow-up ("small ball"); don't auto-resume.
3. Future idea T6: prompts readable, read-only, to all staff.

### Do Not Reopen Without New Decision

1. Accept-both J27 file naming (apps change, not Connor), 2026-10-26.
2. GOApply opportunity 001024 is the Research form; no app concern.
3. D7–D21 as recorded 2026-10-27.

## Constraints

- Production Dataverse and Postgres reads are owner-run with `!`.
- Do not reset, stash or clean untracked `output/` or `.impeccable/critique/`,
  or the `backup/local-main-slice2-plan-drafts-2026-10-25` branch.
- `.codex/hooks.json` and `.github/hooks/impeccable.json` showed uncommitted
  modifications at S645 stop that this session did not make; owner unknown.
  Leave them alone.
- Use plain item names, not alignment-log codes, with Justin and colleagues.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Decisions D1–D21, open items, state model, decision calendar |
| `docs/audits/cycle-settings-audit-2026-10-27.md` | Every cycle identity/default/date source |
| `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` | Rollover plan; D7–D12 reconciled |
| `docs/J27_TRANSITION_REGISTER.md` | Register; Q2, Q15 updated |
| `lib/utils/proposal-document-names.js` | Accepted AI Materials names (branch change) |

## Concurrent Workstreams

| Workstream | Resume boundary |
|---|---|
| J27 alignment | This branch; meeting answers next |
| Board archival (Codex) | Readiness done; rehearsal runtime only on `codex/board-archive-rehearsal` |
| Research request file corpus | Claude-owned; next steps need owner approval |

## Testing

```bash
npx jest tests/unit/workbench-proposal-text.test.js tests/unit/workbench-proposal-document-listing.test.js
npm run check:types
```

## Verification and Closeout

Milestone determination: no DEVELOPMENT_LOG entry; decisions and docs only,
nothing shipped. No CLAUDE.md change. Claim-evidence report: no eligible
plan/design edit events recorded, so no observation row.
