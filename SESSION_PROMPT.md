# Session 653 Prompt: Meeting-date retirement done; reviewer build (D47, D46/D48) next

**Handoff destination:** `main`, docs-only.
**Merged and deployed in Session 652 (owner-authorized, per PR):** #556, #557,
#558, #559, #560. Their worktrees and local branches are removed; the remote
branches still exist (delete only with the owner's OK). **Still open:**
`codex/shared-prompt-library-plan` (PR #553). Merge authorization is per PR.

Earlier handoffs, retrievable exactly: Claude Session 651 (with Codex Session
649) `git show 6a254654c:SESSION_PROMPT.md`; Claude Session 650 and Codex
Session 649 `git show 930387f26:SESSION_PROMPT.md`; Claude's older J27/cycle
workstream `git show 006b87565:SESSION_PROMPT.md`.

## Session 652 Summary (Claude, 2026-10-30) — meeting-date retirement finished

Next Claude session is **653**. The owner authorized each merge in the session.
No sandbox or Production reads or writes were made (sandbox write for the
step-5 rule check was offered and declined: the rule is sandbox-only).

1. **[DEPLOYED; PR #556 `a1f9d0035`] Step 5, Test Request Factory.** Admin
   clones link to an operator-chosen Grant Cycle row of the destination
   calendar (Production: real cycles only); meeting date and fiscal year come
   from its Board date. The CLI needs `--cycle` for `--reserve`. Production test
   requests 1003308 and 1003310 stay unlinked; re-create them if needed.
2. **[DEPLOYED; PR #557 `84ba3bf84`] Step 4, invitation closing and honoraria.**
   The stale-invite sweep, its recheck and the Review Manager "automated cycle
   close" label use the linked cycle's Board date (D26 closes Dec 10, not
   Dec 11); no cycle or no Board date is never auto-closed. New honoraria
   re-read the parent's link, bind `wmkf_GrantCycle`, and take meeting date and
   fiscal year from its Board date; no cycle alerts `honorarium_no_grant_cycle`
   and retries, except when the honorarium already exists (Codex finding).
3. **[DEPLOYED; PR #558 `fd0333864`] Step 6.** Dynamics Explorer prompt treats a
   request's cycle as its link (meeting date only as a stated fallback) and
   documents `wmkf_grantcycle`; `get_entity` returns the link. The Explorer
   restriction guard now checks `$filter` navigation paths, including
   multi-level and lambda forms (Codex finding). Six current-use scripts moved
   to the link. New gate `check:request-meeting-date-reads` (+ self-test, pin
   test, CI, `/start`).
4. **[DEPLOYED; PRs #559 `95bde8874`, #560 `4906e7793`] Reader batches.** The
   owner chose a ratchet then conversion; all 28 remaining app readers were
   removed or converted. The gate now records 19 files, all deliberate
   (calendar column, honorarium write, Factory, helper definitions, Explorer
   fallback, Bulk Export column). The My Candidates picker and contact history
   order by linked cycle, newest first. The individual review file fingerprint
   dropped the meeting date: rebuild any review-file backfill/repair manifest
   made before 2026-10-30.
5. **Housekeeping (owner OK):** removed the orphaned `WMKF_Apps-cycle-lookup`
   worktree (with its `.env.local` copy) and the four build worktrees; deleted
   the merged local branches.

### Commits
- `a1f9d0035` merge #556 (`f0f9c6df9`..`b6f314cc9`)
- `84ba3bf84` merge #557 (`c584d234e`, `619ccf4d5`)
- `fd0333864` merge #558 (`4e6b239ea`, `95d5ae9f6`, `372ee8ed4`)
- `95bde8874` merge #559 (`25fe659b9`)
- `4906e7793` merge #560 (`536582756`)
- This docs-only closeout commit on `main`.

## Session 649 Summary (Codex, 2026-10-29)

### What Was Completed

1. **[MERGED; verified via GitHub] Admin prompt-page improvements.** PR #545
   added descriptive titles, explanations, Used by and caller-classification
   labels with technical keys retained. PR #546 added search and collapsed
   legacy references; PR #548 added counted workflow sections using **Pre-flight**.
   PR #549 moved execution budgets beneath prompts, initially collapsed, with
   Pre-flight / Reviews and evaluations / Meetings and briefings headings and
   catalog-backed titles. Existing budget payloads, draft retention, validation,
   versioning and conflict recovery were preserved. Latest merge: `ebf010f8f`.
   All PR #549 checks passed before its owner-authorized merge. The user had
   previously reported seeing the prompt descriptions in Production; no fresh
   authenticated Production rendering/deployment check was performed at closeout.
2. **[OWNER DIRECTION] Shared Dataverse library.** Justin and successors should
   create/edit prompts in Admin; Connor continues LLM-assisted backend authoring
   and uses Admin for small edits. Both need shared discovery and grouping
   without code/deployment for each new prompt. Today's titles/groups still live
   in the source catalog; no runtime migration has been implemented.
3. **[VERIFIED via owner-authorized read-only Production probe] Live schema.**
   40 names / 59 rows / 39 current; no descriptive/grouping columns and no
   alternate key on prompt versions. One name, `phase-i.checkin`, has no current
   row and null status: do not assume it is a valid Draft. The existing settings
   table supports a uniquely keyed group configuration; `prompt-library.groups`
   was absent. Snapshot observed 2026-10-29T23:22:42Z. No prompt bodies,
   credentials, variable values, or output-schema content are in the evidence.
4. **[PROPOSED; BRANCH ONLY] PR #553: plan, publication contract for Connor,
   schema evidence, probe, and local publication-contract source.** Head
   `1187caf17` (first commit `e35918ba2`). **[OWNER DECIDED, recorded in the
   PR's plan "Review disposition"]** Admin and Connor's coding tools both
   publish through one shared Dataverse operation (a Custom API backed by a
   .NET plug-in); **Connor does not need Admin**. Drafts use GUIDs; published
   version numbers are assigned at activation. This replaced the earlier
   Admin-first / reserved-draft / Postgres-lock proposal. Connor maintains the
   Dataverse operation; initial publishers are Connor and existing Admin
   superusers. Connor's agreement to the common prompt format is
   owner-confirmed. Local source (`lib/prompt-publication/`, fixtures, tests)
   is on the branch only. No schema, data, Dataverse solution, Power Automate
   integration or model execution changed.

### Commits / PRs

- `88136c3b7` — merge PR #545, descriptive prompt catalog/cards.
- `1da6d5673` — merge PR #546, search and collapsed stored references.
- `b84d343ce` — merge PR #548, workflow grouping.
- `e04470c65` — budget organization feature commit; PR #549 merged as `ebf010f8f`.
- `e35918ba2`..`1187caf17` — shared-library plan, publication decisions,
  format/contract source and fixtures, pushed; PR #553 open.
- This docs-only closeout commit is separate from the retained planning branch.

## Next Items

### Verified Open

**Claude workstream (J27 and cycle dates):**

- **Remaining reviewer build, before Feb 24:** Board setup reads the calendar
  (D47) and materials on acceptance with new wording (D46/D48). Plan:
  `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`. Other
  carried J27 items: `git show 006b87565:SESSION_PROMPT.md`.
- **Meeting-date retirement follow-ups (data, not code):** about 140 older
  unlinked Research requests (`docs/CONNOR_DATA_CLEANUP_QUESTIONS.md` DC1, low
  priority); app-made 2026 honoraria without a link (DC5, parked by the owner).

**Codex workstream (prompt library):**

1. **Review PR #553 and continue its local foundation.** Evidence:
   https://github.com/justingallivan/wmkf-research-apps/pull/553 (head
   `1187caf17`). The publication route is settled (see Session 649 item 4);
   do not reopen it. Still gated on separate explicit owner authorization:
   merging #553, any message to Connor, schema provisioning, sandbox
   deployment of the Dataverse operation and its write/attribution/concurrency
   rehearsal, Production promotion, and paid model tests.

### Owner Decision Needed

- **Remote branches** of #556–#560 still exist on GitHub; delete with the
  owner's OK.
- None open for the prompt library; publication coordination with Connor was
  decided 2026-10-29 (recorded on the PR #553 branch).

### Parked / Not Included

- Power Automate execution adapter, trigger/flow creation, unattended publishing
  authentication, new general-purpose direct field-write authoring, and model
  Test actions are separate scope. Sharing the library does not imply any of
  them exists. Current flow definitions were not probed in this planning task.

### Verify Before Acting

- The 2026-10-29 snapshot establishes prompt/settings metadata only. Verify
  sandbox parity, numeric limits, actual write roles, actor attribution and new
  columns before implementation. Dataverse `queryRecords` clamps inventory
  queries to 100 rows; complete paging is a build requirement, not shipped here.
- Preserve all unknown WIP. Untracked Impeccable critique in the prompt worktree
  was intentionally left alone, per the previous handoff.
- **Owner's main checkout WIP (owner said leave it, 2026-10-30):**
  `.codex/hooks.json` and `.github/hooks/impeccable.json` (newer Impeccable
  launcher); untracked `.impeccable/critique/…` and `output/`.
- **Flaky test:** `tests/unit/workbench-integrity-service.test.js` failed in
  two of several full local Jest runs and passed alone every time; untouched by
  this work. Investigate only if it recurs in CI.

### Do Not Reopen Without New Decision

- Meeting-date retirement scope: link-only everywhere, Discretionary requests
  out of cycles (§7 Q2), Bulk Export column and request-file corpus out of
  scope (§7 Q8b/c), Factory real cycles only (§7 Q7). Plan:
  `docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md`.

## Concurrent Workstreams

| Owner / workstream | Latest recorded resume boundary |
|---|---|
| Codex / shared prompt library | PR #553, `codex/shared-prompt-library-plan`, `1187caf17`; publication route decided, unmerged |
| Codex / prompt UI organization | PRs #545/#546/#548/#549 merged; no further UI work requested |
| Claude / J27 alignment and cycle dates | Meeting-date retirement done (PRs #552, #554–#560 deployed; queue item 6a met); next: reviewer build D47, D46/D48 (`docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`); decisions through D48 in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` |
| Codex / Ranking | Prior handoff records PRs #536/#537 done; not reopened |
| Codex / Board archival | Prior handoff records readiness done and rehearsal runtime on `codex/board-archive-rehearsal`; not revalidated here |
| Claude / Research request corpus | Prior handoff records owner-gated; no new authorization |

## Constraints

- Merge authorization is per PR. #553 remains open and unmerged.
- Production read permissions are task/session scoped; follow the owner's
  current access instructions. Production writes need separate explicit
  authorization and the normal interlocks. Sandbox writes need fresh
  authorization.
- Never treat a new prompt, declared caller, or run-source label as proof of an
  active Power Automate flow. No automatic execution is part of catalog editing.
- Preserve the previous handoff's parked/destructive-work constraints. Review
  current queue/owning plans and live callers before any retirement or deletion.
- New app code must not read `akoya_request.wmkf_meetingdate`;
  `check:request-meeting-date-reads` fails on it. Use the Grant Cycle link
  helpers in `lib/dataverse/adapters/operations-grant-cycle.js`.

## Verification and Closeout

- **Claude (Session 652):**
  - Session start: all 40 `check:*` gates and self-tests green on main.
  - Each PR: full Jest suite (last 26,353 passed), relevant gates with
    sequential self-tests, types and lint clean, `/contract-reconcile` on steps
    4–5, Codex adversarial review on every PR; CI green on each before merge;
    Vercel commit status success after each merge.
  - `check:agent-invariants` and `check:agent-wiki` fail only inside fresh
    worktrees (per-machine links); not a repo defect.
  - Stacked PRs: merged one at a time, retargeting the child to `main` after
    each parent merge (branches not deleted, so nothing auto-closed).
  - Milestone: DEVELOPMENT_LOG entry added, "No app reads the request meeting
    date" (Session 652, Claude).
  - Claim-evidence pilot: report found no eligible plan/design edit for this
    session key; no row added.
  - No CLAUDE.md change; no memory files changed.

- Budget layout: 75 focused tests across six suites passed, types passed, lint
  had zero errors and one existing loading-effect warning. Actual-component
  static previews inspected on desktop and at 390px; no horizontal overflow.
  Client interactions were unit-tested, not exercised in authenticated Production.
- Plan/probe: Production metadata GETs succeeded; probe syntax/lint passed.
  Doc currency, symbol refs, canonical pointers and fact-consistency gates and
  sequential self-tests passed; docs catalog and diff checks passed. Independent
  review confirmed corrections; this is not implementation verification.
- Milestone determination: no new DEVELOPMENT_LOG entry required for this
  closeout. Prompt UI organization is an incremental admin refinement; the shared
  library architecture is proposed, not shipped. Existing calendar/landing-cycle
  milestones remain in that log.
- Claim-evidence pilot report was attempted with `--current` but local session
  state was unavailable. No session key or zero-advisory observation was invented.
