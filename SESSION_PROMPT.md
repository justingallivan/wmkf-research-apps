# Session 650 Prompt: Shared prompt library — review PR #553 before the sandbox build

**Handoff destination:** `main`, docs-only, owner-confirmed 2026-10-29.
**Feature/planning branch retained:** `codex/shared-prompt-library-plan`, PR #553
open; do not merge it without the owner's authorization for that PR.

Prior complete handoff (Claude's J27/cycle workstream), retrievable exactly:
`git show 006b87565:SESSION_PROMPT.md`. This compact handoff preserves that
workstream by reference; it does not replace its owner decisions or turn old
carryover into a newly verified worklist.

## Session 650 Summary (Claude, 2026-10-29) — meeting-date retirement planned; PR #552 shipped

Runs alongside Codex's work below; the next Claude session is **651**. Claude's
Session 649 handoff, exact: `git show 4d63eb048:SESSION_PROMPT.md`.

1. **[DEPLOYED; Vercel commit status] PR #552, merge `54070863f`.** Reviewer
   invitations take the cycle from the request's Grant Cycle link
   (`akoya_request.wmkf_grantcycle`) and the review due date from that linked
   calendar row, saved on the request before the first invitation is sent (D48).
   No meeting-date fallback; a request with no link and no saved due date is
   refused (owner-confirmed). Render and send also pick the cycle configuration
   (template, attachments, program name) from the link, and the draft
   fingerprint binds the Grant Cycle id: the reviewer email path no longer reads
   the meeting date. Codex re-review approved; CI green. Docs marked deployed in
   `6428398d8`.
2. **[PLANNED; on main via merge `8dd123543`, 2026-10-29] Stop
   reading the request meeting date across the apps (work queue 6a).** Plan
   `docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md`: whole-repo inventory
   (106 runtime files, 69 scripts, plus indirect readers traced through
   helpers), owner decisions for every question (§7), contract check (§5a) and
   Codex plan review with four verified findings folded in (§5b). Six named
   build steps; **step 1, sandbox setup, is done** (owner-approved sandbox
   writes, `scripts/seed-sandbox-grant-cycles.cjs`, verified by re-read: sandbox
   cycles J26, D26, J27 copied from the Production calendar plus test-only D97,
   D99; 25 sandbox requests linked).
3. **Owner decisions (2026-10-29), recorded in the plan §7:** link-only
   everywhere with no meeting-date fallback (older gaps are fixed as Dynamics
   data, not code); discretionary requests out of scope; displays use the linked
   cycle's calendar Board date; past grants use fiscal year and decision date
   only; stale invitations close against the linked Board date; new honorarium
   requests get the link and calendar-sourced dates (existing ones untouched);
   no backfill of stored cycle codes; Test Request Factory clones carry the
   link; Dynamics Explorer uses the link first with a stated fallback; corpus
   index and Bulk Export column out of scope; finished scripts left as written
   with a wiki caveat.
4. **Read-only Production probes (owner-authorized, counts only):** honorarium
   rows (GoApply's carry the link, app-made ones do not); D26 suggestions (all
   221 carry D26, so the review-filing job misses nothing); link coverage by year
   (Research 97–100% since 2015; about 140 older Research requests with a
   June/December date lack the link); D26 calendar Board date verified as
   2026-12-10.
5. **Two existing bugs found** (plan §6): Reviewer Finder saves never stamp the
   cycle code (field read from the wrong level, since `f766b004d`); the PD-scope
   candidate list reads fields the adapter does not return. Neither affects D26
   data; both are fixed in the cycle-lookup build step.
6. **New docs (now on main):** `docs/CONNOR_DATA_CLEANUP_QUESTIONS.md`
   (data cleanup asks for Connor, low priority); wiki Operating Note in
   `docs/agent-wiki/topics/dataverse-dynamics.md` on scripts that still derive
   cycles from the meeting date, pointer in `scripts/README.md`; corpus plan note.

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

- **Build the meeting-date retirement, next step "cycle lookup and Research
  screens"** (plan §5 build step 2): shared cycle helpers with explicit
  restriction checks for `wmkf_grantcycle` (§5b item 1), expand support in
  `grant-request.getById` (§5b item 2), Research filters, cycle lists and default
  cycle, and the two bugs in §6. Own branch, focused tests, contract check,
  Codex review; merge only with the owner's OK. Steps 3–6 follow in the plan's
  order. Evidence: `docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md` on
  main (plan branch `77307fba6` merged directly as `8dd123543`, owner-approved).
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
  was intentionally left alone, per the previous handoff. No memory or root
  instruction changes were needed.

## Concurrent Workstreams

| Owner / workstream | Latest recorded resume boundary |
|---|---|
| Codex / shared prompt library | PR #553, `codex/shared-prompt-library-plan`, `1187caf17`; publication route decided, unmerged |
| Codex / prompt UI organization | PRs #545/#546/#548/#549 merged; no further UI work requested |
| Claude / J27 alignment and cycle dates | PRs #551 and #552 deployed; meeting-date retirement plan on main (`8dd123543`; sandbox setup done, next: cycle lookup and Research screens); reviewer plan `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`; decisions through D48 in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`; older carried items at `git show 006b87565:SESSION_PROMPT.md` |
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
- Leave the user's main checkout untouched. The stop handoff used an isolated
  docs-only checkout; the prompt planning branch is preserved.

## Verification and Closeout

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
