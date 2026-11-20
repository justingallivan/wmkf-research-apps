# Session 690 Prompt: Proposal lists carry advisor picks; retirement closeout complete

Two concurrent sessions closed on 2026-11-19: Codex Session 688 (app/pilot
retirement and Admin cleanup; full handoff at `git show 2e6153a84:SESSION_PROMPT.md`)
and Claude Session 689 (proposal lists, below). Codex's open items are kept under
Next Items.

## Session 689 Summary — 2026-11-19 (Claude, worktree `WMKF_Apps-claude-2026-11-19b`)

### What Was Completed

1. **Advisor picks during Scoring, live.** PR #654 (merge `8819feb62`). Once a request's
   saved Initial Assessment decision is Scored, an "Advisors who should see this"
   section lists the Board-role roster members; any Workbench staff member ticks them,
   each tick saved on its own (Postgres `proposal_list_advisor_picks`, migration 105,
   applied to Production by the owner before merge and confirmed by the probe).
   Creating a Board member's list highlights the proposals ticked for them; a refresh
   highlights newly listed ticked proposals and keeps existing marks; a test list
   highlights a test proposal ticked for anyone. Read-only Preview refuses ticks.
2. **Lists hold only scored proposals** (Scored or any later Phase I status). Recipient
   page titled "Proposals for review". The CSO pastes each link into their own email.
3. **J27+ membership uses Grant program, not the Program field.** PR #658 (merge
   `2ecd5384c`). Found in the Production rehearsal: Scored test request 1003528 had
   Grant program Research but a blank Program field (owner-authorized read-only probe).
   Owner: the Program field plays no part. Pre-2027 cycles keep it.
4. **"Ticked for: …" note in the CSO's highlight editor** (staff only; the recipient page
   never reads picks). PR #659 (merge `acb10dce4`), with a Codex-review fix so a failed
   names read never turns a committed save into an error (`tickedForUnavailable`).
5. **Red startup gate fixed:** `check:j27-register` (row J27-026 cited files removed with
   the Finder; Codex's PR #651 landed the same fix, resolved in favor of main).
6. **Production rehearsal passed** (Claude in the owner's Chrome, owner's test list):
   1003528 listed, highlighted from the Stolper tick, "Ticked for: Edward M. Stolper".
   The owner's earlier test list was switched off and a new one created; it is still on.

### Owner decisions recorded (plan decisions 15–18, 2026-11-19)

Lists hold only the ~50 scored proposals (all titles reach the Chairs another way);
PD ticks set highlights; CSO sends from their own email (app sends nothing); no roster
chair marker; list-type picker not remembered.

### Verification

72 gates and self-tests; full unit suite; Playwright 77/77; migration 105 and pick
queries on a throwaway postgres:17; two Codex adversarial reviews (#654 approve;
#658+#659 one medium finding, fixed); all CI green before each merge; Vercel Production
deploys succeeded. One CI Jest flake (integrity deadline test) passed on rerun.

## Proposal lists — Next Items

### Verified Open

1. **Check real J27 membership once proposals are scored.** Codex review recommendation:
   compare the Scored proposals list against the Workbench's Scored J27 Research
   requests; source inspection cannot prove data completeness.
2. **Two-level sections and a real staff-version PDF** remain unproven live: no test
   request carries a keyword. Blocked on Connor; real proposals after December 7.

### Owner Decision Needed

1. Whether `/proposal-lists` (and its menu link) should be limited to the CSO. Not changed.
2. 21 runtime files still read the Program field (`_akoya_programid_value`). The owner
   decision covered list membership only; ask before changing others. Memory:
   `project-program-field-retired-use-grant-program`.

### Verify Before Acting

- The owner's J27 test list (to the owner, 4 test requests) is live; switching it off
  is harmless. Do not create a list for a real Board member to test.
- Memory router is 8,247 bytes, over the 8,192-byte routine-audit trigger after this
  session's one-line addition; run the router diet (`docs/MEMORY_HYGIENE_RUNBOOK.md` §10).

### Do Not Reopen Without New Decision

- Proposal-list decisions 1–18 in the plan (supersede the earlier "every submitted
  proposal" wording); ticks do not live-sync to existing highlights by design.

## Other Streams — Next Items (from Codex Session 688)

### Verified Open

- No additional retirement implementation is queued. Reusable capabilities stay
  preserved until the owner chooses a new source/workflow and authorizes adaptation.
- Connor's actual production roster connection still needs a read check according
  to `docs/plans/EXPERTISE_ROSTER_CONNOR_HANDOFF_2026-11-19.md`; backend automation is
  separate work. Do not change effective permissions or remove unrelated roles.

### Parked / Owner Decisions Preserved

- Backend expertise matching stays in Connor's existing flow; no replacement flow
  or second matching call authorized.
- Parked Executor lineage: do not merge `codex/executive-summary-generation-2026-11-16`.
  Owning inventory: `docs/plans/PARKED_EXECUTOR_BRANCH_INVENTORY_2026-11-19.md`.
- Recommendation to Chairs Production stages and paid automatic Integrity Screen
  each require separate owner approval; do not enable `AUTOMATIC_INTEGRITY_SCREENING`.
- Intake prompt choices, Connor notification, missing-PI handling, Feb 24 D39 status
  choice and dependency/Node decisions remain earlier owner boundaries, not new tasks.

### Verify Before Acting

- Initial Assessment authenticated save rehearsal was owner-deferred in the prior
  handoff. Recheck that decision before any write rehearsal.
- Dated Executive Summary trial batch-2 cleanup after November 23 remains a carryover
  requiring fresh expiry/owner preflight, not authorization to delete now. See
  `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md`.
- Worktree disposal remains outside this closeout. Check open processes, dirtiness,
  unique commits and the runbook preservation preflight before removing anything.
- Dependency alert #144 and old request statuses require fresh probes, not inference
  from prior handoffs.

## Concurrent Workstreams

| Stream | Owning reference | Resume boundary |
|---|---|---|
| App-suite retirement | `docs/plans/APP_SUITE_RETIREMENT_2026-11-19.md` | PR #651 DONE; interfaces retired, backend capabilities/data retained |
| Pilot retirement | `docs/plans/evidence/TRANSCRIPTION_PILOT_RETIREMENT_2026-11-19.md` | DONE; cleanup receipt recorded, shared engine and infrastructure retained |
| Admin cleanup | PRs #657 and #660 | DONE after release verification; display-only preservation |
| Expertise roster | `docs/plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md`; Connor handoff | Other owner; connection check/backend adoption separate |
| Proposal lists | `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` | Claude, Session 689: PRs #654, #658, #659 live; see Proposal lists below |
| Chairs | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Separate approval per stage |
| Intake/Executor | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Parked lineage retained; no merge |

## Key Files (proposal lists)

| File | Purpose |
|---|---|
| `lib/services/proposal-lists/list-snapshot-service.js` | Scored-only membership; Grant program for 2027+ |
| `lib/services/proposal-lists/list-link-service.js` | Create/rebuild highlights from picks; pick read/write; ticked-for names |
| `lib/services/proposal-lists/list-store.js` | Picks storage (migration 105) |
| `shared/components/workbench/AdvisorPicks.js` | Checkboxes in Initial Assessment |
| `shared/components/proposal-lists/ProposalLists.js` | CSO page; "Ticked for" note |
| `scripts/probe-proposal-list-schema.mjs` | Read-only check for migrations 101/102/105 |

```bash
npx jest --runInBand --silent --testPathPatterns='tests/unit/(proposal-list|workbench-advisor)'
```

## Closeout

Docs landed on `main` from `claude/session-stop-2026-11-19b`. Runtime branches
(`claude/session-2026-11-19b`, `claude/proposal-list-grant-program`,
`claude/proposal-list-ticked-for`) are merged. The worktree has a gitignored
`.env.local` symlink the owner created for the migration. Milestone: entry added to
DEVELOPMENT_LOG.md. CLAUDE.md unchanged. Claim-evidence report: no eligible
plan/design edit recorded, so no observation row. Never read root `.env.local`.

Codex Session 688 closeout notes (preserved): documentation landed from
`codex/retirement-session-close`; pilot retirement received a milestone entry; do not
delete retained data, grants, settings, prompt versions, pilot infrastructure or shared
services as a consequence of retirement.
