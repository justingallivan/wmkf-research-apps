# Session 640 Prompt: J27 readiness — collect Connor's answers and the Wednesday meeting outcomes

## Session 639 Summary

Two agents worked concurrently. Claude (worktree
`/Users/gallivan/Code/WMKF_Apps-claude-2026-10-24`, branch
`claude/session-2026-10-24`, docs only) walked through J27 readiness with the
owner and started a meeting log. Codex (main checkout and `codex/*` worktrees)
shipped personal email defaults slices 2 and 6.

### Claude — J27 alignment log and decisions (docs only, no runtime change)

[VERIFIED via the committed docs] `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`
is the single place for J27 decisions, meeting questions and tasks. It is
written for the owner's meeting with Sarah (Grants Manager), Duncan (Program
Coordinator), Connor (Systems Specialist) and the CSO, expected **Wednesday
2026-10-28**. Owner decisions recorded 2026-10-24:

- **D1:** Calendar authority = Grants Manager role, Program Coordinator role as
  fallback (role-bound, not person-bound). Mirrored in the rollover plan §7.
- **D2:** Reviewer reminders stay manual for J27; automatic schedule stays
  paused (register Q10, `docs/REVIEWER_ENGAGEMENT_SPEC.md`).
- **D3:** All D26 reviews are in (owner-reported); review filing switches
  D26 → J27 once (register Q15). Who/when is task T3.
- **D4:** Reviewer campaign values (deadline, respond-by days, quota) move to
  central cycle-level settings; per-PD campaign settings are not the target.
  Email wording is excluded: per-user wording over central seeds stays.
  Rollover plan Slice 1 is scheduled for **November 2026**; its slice 2
  dependency shipped (#521). New memory:
  `.claude-memory/feedback-centralize-over-pd-specific-settings.md`.
- **D5:** Volume of the Dec 8 AI pass is not a concern (owner).
- **D6:** Expertise matching is rebuilt to run inline in the intake AI pass,
  not on demand (current app is an early version of the CSO's Claude project).

The log also holds the provisional J27 key dates (Dec 7 submission, Dec 8 AI
pass, Dec 9 release; Jan 6 decline notes; Jan 14 First Cut; Feb 24 reviewer
invitations; Jun 9–10 Board with D27 intake the same week), the December and
January readiness lists, and meeting questions A1–A5, B1, C1–C5, R1–R2, X1,
F1–F3. **B1 correction:** the AI input files were already decided 2026-08-17
(`AI Materials/ProposalNarrative_{n}.pdf` + `ProposalBibliography_{n}.pdf`,
`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`); Connor only confirms J27
production. The owner is sending Connor a pre-meeting question email (drafted
in session, grouped as: proposal files B1, intake records C1/C4/C5, AI-pass
trigger R2, cycle dates C2/C3, lower-priority register Q7/Q14/Q23).

Timeline source: owner-shared provisional J27/D27 timeline PDF, generated from
`keck_6months_timelines_updated.xlsx` (OneDrive, New Cycle Development/
timelines) by a Claude-built script. Its hand-typed Day column has weekday
errors, mostly on the D27 page (incl. D27 Board Dec 9–10, 2027 = Thu–Fri). The
owner emailed the timeline owner a correction prompt; tracked as T5,
non-blocking for J27.

Incidental: three pre-existing "unknown" phrasings in the rollover plan were
reworded because the scope-claim hook misreads date digits as counts.

### Codex — personal email defaults (production)

[Recorded by Codex; see the exact prior handoff below.] Slice 2 (assigned-PD
reviewer deadline email defaults) shipped as PR #521 `687994c2a`; slice 6
(personal meeting agenda email defaults) shipped as PR #522 `9d12b24ce`, with
release evidence in `docs/audits/REVIEWER_DEADLINE_EMAIL_BUILD_2026-10-24.md`
and `docs/audits/MEETING_AGENDA_DEFAULTS_BUILD_2026-10-24.md`. Codex's full
Session 639 text: `git show ad4cbac85:SESSION_PROMPT.md` (verified
retrievable).

### Commits (Claude, docs only, landed on main)

`b6c0ddeaf`-era series rebased onto `ad4cbac85`: calendar authority + log
start; reminders/filing; December readiness; central campaign settings;
November scheduling; Slice 1 unblocked + email-wording exclusion; T5; timeline
rebuild; D6; trigger/flag questions; B1 Connor questions; B1 correction. See
`git log --oneline ad4cbac85..HEAD`.

## Next Items

### Verified Open

1. **Record Connor's pre-meeting answers in the log.** Evidence: log B1 detail,
   C1–C5, R2. Update the matching rows; B1 answers 1–3 unblock the Dec 8 pass.
2. **After the Wednesday meeting, record decisions** for A1–A5, C1–C5, R1–R2,
   X1, F1–F3 and assign T3. Evidence: log "To confirm at the meeting".
3. **Draft the Dec 8 automatic AI-pass plan** (Initial Assessment + inline
   expertise matching + flags; one background worker per proposal, steps run
   separately, narrative file as input, model as a setting, Board names moved
   from the prompt into the roster). Owner agreed no non-meeting planning
   question remains; meeting answers become placeholders. Evidence: log R-3,
   D5, D6; `shared/config/prompts/expertise-finder-dynamics.js`;
   `lib/services/initial-assessment/artifact-service.js`. Run
   `/contract-reconcile` before implementation.
4. **Slice 1 central reviewer settings (November).** Needs A4/A5 from Sarah.
   Evidence: rollover plan §3.2 owner decision, log D4.

### Owner Decision Needed (meeting)

- Calendar fallback meaning, readiness recipients, approval rules (A1–A3).
- Per-proposal exception to central settings; J27 central values (A4–A5).
- Triage flags definition and visibility; Dec 9 list shape; unassigned
  proposals (F1–F3). Roster ownership and whether the suggested PD is written
  to the request (X1). Program (S&E/MR) recording (C5).

### Verify Before Acting

- **December readiness R-1/R-2/R-4** were checked against code 2026-10-24:
  untriaged `Phase I Pending` requests do not appear in the Workbench list
  (`shared/config/workbenchVisibility.js`); only Advancing/Set aside triage
  states exist. R-4 (advance to Phase II Pending from Workbench) was not
  verified. January items J-1/J-2 were not checked against code.
- The Expertise roster (`expertise_roster`, Postgres) is also read by Site
  Visit/meeting attendee services; a rebuild must preserve that contract.
- Retained synthetic fixtures (request 1003371, its SharePoint folder,
  isolated rehearsal database, Preview/private Blob store) are owned test
  assets, not cleanup instructions. No resource deletion is authorized.
- Main checkout's untracked `.impeccable/critique/...boardwriteups-js.md` and
  `output/` belong to the owner/Codex; preserve them.

### Parked / queued (from Codex's handoff)

- Existing-calendar agenda updates and the suite-wide Impeccable email-interface
  review: `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`.
- Grant Reporting sunset parked; reviewer panel coverage parked; Research
  Institution confirm-your-details campaign tabled.

### Do Not Reopen Without New Decision

- D1–D6 above. Meeting Tracker decisions (video required, Coordinator approval,
  materials retention/withdrawal, no provider confirmation, manual audio/video
  fallback). D26 invited-amount correction is DONE; no re-ranking authorized.
- No real sends, metered processing, sandbox repairs or business-record writes
  are authorized by this handoff.

## Concurrent Workstreams — resume index

- J27 / overlapping cycles: `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`,
  `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`,
  `docs/J27_TRANSITION_REGISTER.md`.
- Personal email defaults: slices 2, 3 and 6 shipped (#521, #517, #522).
  `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`.
- Research Institution at Award:
  `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md`.
- Older history: `git show ad4cbac85:SESSION_PROMPT.md`, then
  `git show f66eee9e0:SESSION_PROMPT.md`.

## Key Files

| File | Purpose |
|---|---|
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | J27 decisions, meeting questions, readiness lists, tasks |
| `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` | Overlapping cycles plan; §7 calendar decision; §3.2 central settings |
| `docs/J27_TRANSITION_REGISTER.md` | Single-phase change register; Q10/Q15 updated |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | Decided AI Materials narrative/bibliography contract |
| `.claude-memory/feedback-centralize-over-pd-specific-settings.md` | Owner direction on central vs per-PD settings |

Milestone determination: no DEVELOPMENT_LOG entry from Claude (planning and
decisions only, nothing shipped); Codex's slice releases are feature slices
recorded in their audits. CLAUDE.md requires no change. Claim-evidence pilot:
`--current` report showed zero advisory events and no eligible documents, so
no observation row was added. No memory-router advisory was received.
