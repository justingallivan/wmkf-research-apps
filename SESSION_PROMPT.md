# Session 643 Prompt: Email defaults released; await Duncan and Connor

## Session 642 Summary

[VERIFIED via merged PRs, release receipts and deployment checks, 2026-10-25–26.]
Released reviewer exclusion recovery and four personal email-default families,
after independent ordinary OAuth Claude reviews and CI. Justin ended the session
rather than selecting another small reliability task. No new implementation is queued.

### What Was Completed

1. **Reviewer exclusion recovery:** PR #527 / `3e53510ff` restored failed
   exclusions without overwriting concurrent selection/roster changes.
2. **Deliberation-distribution defaults:** PR #529 / `7f2a6e9c8`; nonempty message,
   fresh ordinary reopen, discard warnings and frozen uncertain-send recovery.
3. **Scheduled grantee reminder defaults and recovery:** PR #531 / `6a37ea105`;
   reassignment holds, current-PD checks and preserved transport correlation.
4. **Automatic reviewer thank-you defaults:** PR #533 / `a9e9b4de6`; separate
   exact-owner wording and rendered-copy/DOCX preparation before the send claim.
5. **Acceptance-confirmation defaults:** PR #534 / `8b02e8467`; personal PD wording,
   shared non-PD fallback, one combined discard guard and recoverable preclaim
   preparation. Owner policies: normalize CR/LF only in subject placeholder values,
   preserve body text; retry assigned-PD lookup failures before claiming.

### Release evidence and boundaries

- Final acceptance implementation review: Claude PASS at `0ac9ce254`;421 focused
  tests,3 isolated PostgreSQL cases and15 fixture browser cases passed. All CI
  passed before merge. Types, lint and scoped gates passed.
- Release closeout `ed6d91630`: production deployment
  `dpl_FfRgyPV3hwgQ7SewRuAMNy2fCECL` READY and active on production aliases.
  Read-only probe verified public acceptance settings/discard assets and signed-out
  protection; error scan returned zero records in its bounded window. No live
  preference write or real confirmation send was tested.
- Claude's committed corpus/database/report work was integrated unchanged.
  Its other checkout, pre-existing database, migrations and environment were not
  operated. Only an owned disposable PostgreSQL fixture was used and removed.
- Retain family-specific sender/recipient authority, strict Save/Clear readback,
  uncertain-write Reload barriers and postclaim at-most-once behavior. Acceptance
  retries are finite; no staff requeue tool is claimed. Signature lookup remains
  independent; cancellations outside the drain may leave stale preparation alerts.

### Key commits / destinations

- `b3ec15085`, `3e53510ff` — exclusion recovery and release.
- `7f2a6e9c8`, `6a37ea105`, `a9e9b4de6`, `8b02e8467` — reviewed email releases.
- `2ff4e861e` — acceptance implementation; `0ac9ce254` — review coverage corrections.
- `ed6d91630` — acceptance production verification/probe and release-status records.
- Feature branch `codex/reviewer-acceptance-defaults` is preserved; handoff prepared
  separately on `codex/session-642-final-handoff` from current origin/main for a
  docs-only landing on main, following the recorded cross-machine preference.
- Prior Session 641 handoff is retrievable with
  `git show ed6d91630:SESSION_PROMPT.md` (verified). Older context remains at
  `git show efb633f9c:SESSION_PROMPT.md`; historical checkout paths are not authority.

## Concurrent Claude session (S642, same days): Research request file corpus

[VERIFIED via commits on main and owner-run output pasted into the session,
2026-10-25–26.] Codex's handoff above is the primary prompt; this section is
the Claude corpus workstream's resume boundary.

- **Index built, merged and loaded.** Migration 090 (`request_corpus_runs`,
  `request_corpus_requests`, `request_corpus_files`) applied from the branch
  2026-10-25; branch `claude/request-corpus-index` merged `460e4476a` after a
  final Codex review (fixes `56a692dfe`: the loader now needs
  `POSTGRES_URL_NON_POOLING` for its session advisory lock; a rejected
  `--resume` no longer touches the run). Full owner-run load, run
  `5631c55d-1b92-498f-9e93-e625dd1bfd16`: **3,853 Research requests (meeting
  years 2018–2026), 38,399 files, 1 error** (request 992853: a Dynamics pointer
  to a missing `RequestArchive3` folder; passed to Connor). Record: build plan
  "First Production load"; Atlas `docs/atlas/postgres-request-corpus.md`.
- **Owner decisions this session** (recorded in the parent plan
  `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`): corpus starts
  at meeting year 2018 (1990–2017 parked; proposals believed on microfiche);
  pre-1990/no-date history gaps tabled; no per-request visibility rule (admin
  exercise); request 1001931 flagged test (`156074df1`).
- **Connor (SharePoint libraries):** four libraries (`Request` = Graph
  `akoya_request`, `RequestArchive1`–`3`); the loader already lists all. He
  removed 994366's stray pointer. `scripts/report-request-file-multi-library.mjs`
  (`1a908ba6e`, offline over the 2026-10-25 inventory CSVs) found 36 requests
  (2018–2021) with the application in `RequestArchive3` and later reports in
  `Request`; CSV in the owner's Shuttle folder for Connor.
- **Next (each needs owner approval):** step 4 text extraction for Read-priority
  files; an optional model pass for undecided files; the admin-only browsing
  surface. After Connor fixes 992853, resume the same run id to list it.
- **Constraints:** Production reads (Dataverse and Postgres) are owner-run with
  `!` — the auto-mode classifier blocks the agent, correctly. Inventory/pilot
  CSVs name people and stay in the OneDrive Shuttle folder, never the repo.
  `lib/utils/file-loader.js` `.doc` branch sends binary Word to mammoth
  (noted, not fixed, out of scope).
- **Git:** at /start the agent reset local main to origin; the two local-only
  drafts it held are preserved on the unpushed branch
  `backup/local-main-slice2-plan-drafts-2026-10-25` — keep it, delete nothing.
  `claude/request-corpus-index` is merged and retained.

## Next Items

### Owner Decision Needed

- **Duncan scheduling walkthrough — blocked awaiting discussion.** No calendar
  implementation authorized. Use the checklist in
  `docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md`. Confirm organizer/edit
  access, event linkage, audience, notifications and recovery before planning an
  implementation. The app-managed Agenda section remains a proposal.
- **Connor/J27 answers — awaiting colleagues.** Current authority is
  `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`, re-read at closeout. D1–D6 are
  recorded owner decisions, not unresolved questions; remaining A/B/C/R/X/F items
  need meeting answers. T3 filing-switch ownership/date is unassigned; T5 timeline
  labels await a reply. Do not activate a filing switch, automatic reminder schedule,
  central campaign settings or intake AI pass merely from this handoff.
- **Next substantive project — owner to choose.** Justin called the proposed
  reviewer-save recovery follow-up “small ball” and chose to wrap up. Do not
  auto-resume it or substitute another minor hardening task as the next priority.

### Verify Before Acting / Parked

- Reviewer-save recovery is an unconfirmed potential issue. Source inspection and
  the follow-up note motivated investigation, but no current failure was reproduced.
  No fix or investigation was selected/authorized. Do not present it as a confirmed
  defect. Search cancellation and acceptance-alert consolidation were alternatives,
  not assignments.
- Recheck source, current receipts and new owner answers before using older queue
  entries as actionable work. Completed email releases above are DONE; no additional
  personal-default family is selected here. Do not reopen calendar/J27 decisions,
  Grant Reporting sunset, reviewer panel coverage or the Research Institution
  confirmation campaign without a new owner direction.
- Do not reset, stash, archive or clean another checkout/branch, its untracked
  output/critique files or retained synthetic data based on historical handoffs.
  No cleanup operation is authorized.

## Concurrent Workstreams / Key Files

| Workstream | Owner / resume boundary |
| --- | --- |
| Acceptance defaults | Released; `docs/audits/REVIEWER_ACCEPTANCE_DEFAULTS_RELEASE_2026-10-26.md`; implementation limits in its build receipt |
| Thank-you defaults | Released; `docs/audits/REVIEWER_THANKYOU_DEFAULTS_RELEASE_2026-10-26.md` |
| Distribution / scheduled reminders | Released; `docs/audits/DISTRIBUTION_DEFAULTS_RELEASE_2026-10-25.md`, `docs/audits/SCHEDULED_GRANTEE_DEFAULTS_RELEASE_2026-10-25.md` |
| Exclusion recovery | Released; F2 in `docs/plans/REVIEWER_SEARCH_FOLLOW_UPS_2026-09-18.md` |
| Duncan calendar workflow | Owner + Duncan walkthrough first; personal-email TODO checklist |
| J27 / overlapping cycles | Await answers; alignment log, rollover plan and `docs/J27_TRANSITION_REGISTER.md` |
| Research request file corpus | Claude-owned; index merged and loaded 2026-10-26 (section above); next steps need owner approval; DB operations are owner-run |

## Verification and Closeout

Milestone determination: production capabilities shipped; added **Personal email
defaults and reviewer recovery released (Session 642)** to DEVELOPMENT_LOG.md.
No CLAUDE.md, memory, instruction or skill changes needed: route, service and
script details already live in their canonical catalogs/receipts, not the root
instruction file. No memory-router advisory received. Claim-evidence report was
unavailable because local state could not be read; no observation row invented.
Final documentation gates/self-tests and push are completed as part of stop.
No live emails, preference mutations or business-record writes authorized by stop.
