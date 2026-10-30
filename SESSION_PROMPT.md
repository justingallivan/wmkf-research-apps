# Session 652 Prompt: Meeting-date retirement — build step 5 (Test Request Factory) before the next rehearsal

**Handoff destination:** `main`, docs-only (handoff and work queue only).
**Merged and deployed this session (owner-authorized):** PR #554 (`fe749f063`)
and PR #555 (`701a58bea`); their branches are deleted. **Still open:**
`codex/shared-prompt-library-plan` (PR #553). Merge authorization is per PR.

Earlier handoffs, retrievable exactly: Claude Session 650 and Codex Session 649
`git show 930387f26:SESSION_PROMPT.md`; Claude's older J27/cycle workstream
`git show 006b87565:SESSION_PROMPT.md`.

## Session 651 Summary (Claude, 2026-10-29 → 10-30) — meeting-date retirement steps 2 and 3 built

Next Claude session is **652**. The owner was away for most of the session and
authorized: autonomous work with Codex reviews, PRs left open (no merge),
starting step 3 on a stacked branch, and **sandbox reads only** (no sandbox
writes, no Production access).

1. **[MERGED to main] Handoff fixes and the plan branch.** Corrected the stale
   "Connor publication decision needed" item (`561cb177e`; the decision is
   recorded on PR #553's branch). Merged the meeting-date retirement plan branch
   directly (owner OK; docs plus the sandbox seed script, no runtime change):
   `8dd123543`.
2. **[DEPLOYED; PR #554 `fe749f063`, Vercel commit status success] Step 2: cycle lookup and Research
   screens.** Every non-Factory app path takes a request's cycle from its Grant
   Cycle link. Helpers in `lib/dataverse/adapters/operations-grant-cycle.js`
   (`linkedCycleFilter`, `noLinkedCycleFilter`, `linkedCycleExpand`,
   `linkedCycleCode`, `listBoardDatesOrNone`), each with an explicit
   `wmkf_grantcycle` restriction check (plan §5b item 1); request adapter reads
   forward `expand`; `aggregateLinkedCycles` replaces the meeting-date aggregate.
   All 39 membership call sites traced to a production read carrying the expand
   (the trace caught transcript/summary, Initial Assessment lineage, site-visit
   transition, request-number and id-list reads). Both plan §6 bugs fixed.
   Proposal Ranking scripts moved with the code (syntax-checked only; they target
   Production). Codex: one P2 (Factory Pre-Site recipe reader) fixed in
   `20a1365b3`; re-review clean.
3. **[DEPLOYED; PR #555 `701a58bea`, Vercel commit status success] Step 3: checks,
   dates shown, cleanup.** "Has a meeting date" gates use the link; Workbench
   Overview and the Staff Deliberations writeup show the linked cycle's calendar
   Board date (writeup snapshot field and month-year format kept; D26 pinned);
   candidate cards label prior requests by linked cycle (enrichment cache v5);
   past-grant recency uses fiscal year and decision date only; unread
   pass-through fields and unused selects removed.
4. **[VERIFIED via owner-authorized read-only Production count, 2026-10-30]
   Plan §8:** of 2,945 program grants (955 Research), none lacks both a
   decision date and a readable fiscal year (22 lack a decision date; all have
   a fiscal year), so #555's past-grant date rule leaves no current grant
   undated. Recorded in the plan §8 on the #555 branch and on the PR.
5. **Sandbox reads (owner-authorized, read-only, 2026-10-30):** link filter
   counts D26 12 / D97 12 / D99 1; expand shape on list and single reads;
   link-entity aggregate (also with a program condition, 6 = 6); the No-cycle
   filter partitions linked and unlinked requests exactly.
6. **Owner-attention items before merge** are listed in each PR body. The main
   ones: Factory clones carry no link until step 5 (they show "No cycle" and
   cycle-gated flows refuse them, except the Factory's own Pre-Site reader,
   which derives the clone's cycle and Board date from its meeting date until
   step 5); unlinked requests (about 140 older Research, Discretionary) leave
   cycle views and cycle-gated flows; Overview D26 date shows Dec 10 (calendar)
   instead of Dec 11; presentation invitation previews prepared in the 15
   minutes before deploy go stale once; refusal copy now says "June or December
   Grant Cycle".

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

- **Step 5, Test Request Factory, BEFORE the next Factory rehearsal** (owner:
  none for at least a few days from 2026-10-30). Until it lands, every Factory
  test request (existing Production ones included) has no Grant Cycle link, so
  it shows no cycle and cycle-gated flows refuse it. **Owner decided
  2026-10-30: real cycles only** — Production clones link to an existing real
  cycle (default: the source's linked cycle); no test rows in the Production
  calendar. Plan §5 step 5 and §7 Q7. Same change removes the Pre-Site
  reader's meeting-date fallback (`lib/services/test-requests/presite-sandbox-deps.js`).
  Own branch, Codex review; merge with the owner's OK.
- **Steps 4 and 6** (invitation closing and honoraria; Dynamics Explorer,
  scripts and guard) after step 5, each with the owner's OK.
- **Remaining reviewer build:** Board setup reads the calendar (D47) and
  materials on acceptance with new wording (D46/D48), before Feb 24. Plan:
  `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`. Other
  carried J27 items: `git show 006b87565:SESSION_PROMPT.md`.

**Codex workstream (prompt library):**

1. **Review PR #553 and continue its local foundation.** Evidence:
   https://github.com/justingallivan/wmkf-research-apps/pull/553 (head
   `1187caf17`). The publication route is settled (see Session 649 item 4);
   do not reopen it. Still gated on separate explicit owner authorization:
   merging #553, any message to Connor, schema provisioning, sandbox
   deployment of the Dataverse operation and its write/attribution/concurrency
   rehearsal, Production promotion, and paid model tests.

### Owner Decision Needed

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
- **Owner's main checkout WIP (not this session's):** `.codex/hooks.json` and
  `.github/hooks/impeccable.json` point at a newer Impeccable launcher
  (likely a tool update); untracked `.impeccable/critique/…` and `output/`.
  The owner has not said whether to commit them; left untouched.
- **Worktree `/Users/gallivan/Code/WMKF_Apps-cycle-lookup`** (its branches are
  merged and deleted on GitHub) has a `node_modules` symlink and **a copy of
  `.env.local` (gitignored)**. Reuse it for step 5 or remove it
  (`git worktree remove`) so no credentials copy lingers.

## Concurrent Workstreams

| Owner / workstream | Latest recorded resume boundary |
|---|---|
| Codex / shared prompt library | PR #553, `codex/shared-prompt-library-plan`, `1187caf17`; publication route decided, unmerged |
| Codex / prompt UI organization | PRs #545/#546/#548/#549 merged; no further UI work requested |
| Claude / J27 alignment and cycle dates | PRs #551 and #552 deployed; meeting-date retirement plan on main (`8dd123543`); steps 2–3 deployed (PR #554 `fe749f063`, PR #555 `701a58bea`); step 5 next (real cycles only), steps 4 and 6 after; reviewer plan `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`; decisions through D48 in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`; older carried items at `git show 006b87565:SESSION_PROMPT.md` |
| Codex / Ranking | Prior handoff records PRs #536/#537 done; not reopened |
| Codex / Board archival | Prior handoff records readiness done and rehearsal runtime on `codex/board-archive-rehearsal`; not revalidated here |
| Claude / Research request corpus | Prior handoff records owner-gated; no new authorization |

## Constraints

- Merge authorization is per PR. #553 remains open and unmerged.
- Production read permissions from this chat were task/session scoped; the next
  session must follow the owner's current access instructions. Production writes
  need separate explicit authorization and the normal interlocks.
- Never treat a new prompt, declared caller, or run-source label as proof of an
  active Power Automate flow. No automatic execution is part of catalog editing.
- Preserve the previous handoff's parked/destructive-work constraints. Review
  current queue/owning plans and live callers before any retirement or deletion.
- Sandbox reads only were authorized for the meeting-date build this session;
  sandbox writes and any Production access need fresh authorization.

## Verification and Closeout

- **Claude (Session 651):**
  - Session start: all 40 `check:*` gates and self-tests green on main.
  - #554 and #555: full unit and integration suites (26,265 and 26,286 passed),
    every `check:*` gate with sequential self-tests, lint clean; CI green on
    both. `check:agent-invariants` and `check:agent-wiki` fail only inside the
    worktree (per-machine links); both pass in the main checkout.
  - Milestone: DEVELOPMENT_LOG entry added, "The apps take each request's
    cycle from its Grant Cycle link" (Session 651, Claude).
  - Merge note: `gh pr merge --delete-branch` on #554 closed stacked #555
    instead of retargeting it; recovered by restoring the base branch from its
    commit, reopening, retargeting to `main`, and close/reopen to refresh the
    review check. For stacked PRs, retarget the child to `main` before
    deleting the parent's branch.
  - Claim-evidence pilot: report found no eligible plan/design edit for this
    session key; no row added.
  - No CLAUDE.md change. Memory changes travel with the PR branches
    (`akoya-temporal-axis-encodings.md`, `project-akoya-request-pd-fields.md`).

- **Claude (Session 650):**
  - PR #552 final: focused tests 304 and the reviewer/email/cycle suites (9,412)
    passed; 11 relevant gates with sequential self-tests passed; CI green
    (Jest, Playwright, CodeQL and the rest) before merge.
  - Plan branch: doc gates (agent-wiki, docs-catalog, doc-currency,
    doc-symbol-refs, fact-consistency) and `check:dataverse-access-layer` with
    self-tests passed at `77307fba6`.
  - `check:agent-invariants` fails in fresh worktrees only because the local
    `.claude-memory` and `.agents/skills` links are not created there; not a repo
    defect.
  - Milestone: DEVELOPMENT_LOG entry added, "Reviewer invitations take the cycle
    and due date from the Grant Cycle link" (Session 650, Claude).
  - Claim-evidence pilot: report found no eligible plan/design edit for this
    session key; no row added.
  - No CLAUDE.md change. One memory file updated:
    `.claude-memory/feedback-no-item-codes-in-owner-facing-text.md` (no "PR 0/1"
    labels for build steps).

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
