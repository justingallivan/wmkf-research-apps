# Session 654 Prompt: Reviewer build — #561 awaits owner reads; #562 manual release next

**Handoff destination:** `main`, docs-only. Feature work lives on two branches
(below); nothing from this session is merged or deployed.

Earlier handoffs, retrievable exactly: Claude Session 652 with Codex Session 649
`git show 45814e64c:SESSION_PROMPT.md`; Claude Session 651 `git show
6a254654c:SESSION_PROMPT.md`; Claude's older J27/cycle workstream `git show
006b87565:SESSION_PROMPT.md`.

## Session 653 Summary (Claude, 2026-10-30)

Next Claude session is **654**. Start: all 41 `check:*` gates and self-tests
green on `main`. No Production or sandbox reads or writes were made.

### What Was Completed

1. **[PR #561 OPEN, not merged; head `6ae3efea9`; CI green] PR 3 of the reviewer
   build: Board setup reads its dates from the cycle calendar (D47).** Branch
   `claude/board-setup-calendar`, worktree `../WMKF_Apps-board-calendar`.
   - Setup no longer stores typed `materialsDue` / `boardEnds`; new adapter read
     `getBoardSetupDatesByCode` (Board Meeting Date, Board Mailing Date) and
     `lib/services/board-writeups/calendar.js` (one total deadline).
   - Saving an **active** setup requires both calendar dates in order; old
     stored keys and old pending intents are stripped on read.
   - Worker: unreadable calendar → archive start and all notices wait (alert);
     releases and queued archive copies continue. Notices store the dates they
     were drafted from and refuse to send if the calendar moved.
   - Board page default cycle uses calendar Board dates.
   - Codex: 3 rounds; rounds 1–2 fixed (`951284330`, `8c5e05075`); round 3
     (signature-keyed notices stay unsent after a date change) noted in the PR,
     not changed. `/contract-reconcile` Mode B done; Atlas updated (`6ae3efea9`).
2. **[PR #562 DRAFT; head `1dfb7b31d`] PR 4: materials on acceptance (D46/D49).**
   Branch `claude/reviewer-materials-on-accept`, worktree `../WMKF_Apps-materials`.
   - Owner decisions recorded (D49): one combined acceptance email; wording drafted
     in the PR; **invitation wording + `{{proposalDelivery}}` / Reviewer Finder
     date-field retirement split into a follow-up PR**; transient pre-claim
     failures retry ~15 minutes, then today's confirmation + "materials held" alert.
   - Migration **091** `reviewer_materials_releases` + store
     `lib/services/reviewer-engagement/materials-release-store.js` (claim =
     `INSERT … ON CONFLICT DO NOTHING RETURNING`; lease-bound steps; staff
     reclaim; `listStuckMaterialsReleases`). No job FK (smoke script deletes jobs).
     Atlas page `docs/atlas/postgres-reviewer-materials-releases.md`.
   - Acceptance job step `release_materials` in
     `lib/services/reviewer-acceptance-drain.js`: reversible checks before claim
     (live reviewer re-read for address check, PDF, Grant Cycle config, strict
     attachments via `review-manager/cycle-materials-attachments.js`), then
     claim → mint (If-Match) → one email → markers via `recordDeliveredEmail`.
     Retries act on the release row's state; every drain run re-raises a
     deduplicated alert per stuck release. New keys
     `email.reviewer_materials_acceptance.*` (create-only seed, Admin-editable).
   - Codex: 2 rounds on the step, 5 high findings, all fixed (`33dd52b00`,
     `7915f93fc`); loop stopped there. Full Jest 26,402 passed locally.

### Commits (branches only; `main` gets only this handoff)
- #561: `d831b3048` code, `27bd54e36` docs, `951284330`, `8c5e05075` review
  fixes, `6ae3efea9` Atlas.
- #562: `2084a695f` D49, `c1adfcb28` / `90b20a3ec` plan notes, `1e8649fe3` /
  `84ef1d7f0` table, `4b13470e9` step, `cdf5006bc`, `33dd52b00`, `7915f93fc` fixes, `1c69f430e`
  15-minute fallback, `5af89da13` decision docs, `1dfb7b31d` pg test fix.

## Next Items

### Verified Open

1. **#562 CI.** The Postgres job failed on `1c69f430e`
   (`reviewer-acceptance-defaults.pg.test.js`: its deps lacked the materials
   stand-ins); fixed in `1dfb7b31d`, **not yet confirmed green**. The new
   `reviewer-materials-release-store.pg.test.js` is in the CI list
   (`.github/workflows/test.yml`) and has never run locally (no local Postgres).
   Check `gh pr checks 562` first.
2. **#562 remaining build, in order** (plan §3.3 build notes,
   `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`):
   manual materials send takes the shared claim just before its mint
   (`send-emails-service.js` materials path; new skip reason → status-enum
   parity + `ReleaseMaterialsModal` labels; also resolve the "held" alert key
   `reviewer-materials-release:<suggestionId>`) → "Send materials again" route +
   UI (`reclaimMaterialsRelease`; route matrix row; server re-checks accepted /
   not released) → invitation PDF precondition (server-side) → accepted-screen
   copy ("proposal link on its way by email"). Then `/contract-reconcile` and a
   Codex round on the manual path.
3. **Follow-up PR (owner split):** invitation wording, `{{proposalDelivery}}` and
   Reviewer Finder `proposalSendDate` / `commitDate` retirement.

### Owner Decision Needed

1. **#561 merge** after three owner-run, read-only Production checks (blocking):
   D26 calendar Board Mailing Date set and ≤ Board date (else every D26 setup
   save is refused); D26 calendar Board Meeting Date = 2026-12-10; no pending D26
   `configIntent` or unsent notice draft.
2. **#562 before merge:** Production `schema_migrations` has no 091 (apply it
   before deploy); seed the two new template keys before deploy; D26 has no open
   invitations; J27 Reviewer Finder cycle record exists; owner reviews the draft
   wording in the PR body.
3. Remote branches of #556–#560 still exist; delete only with the owner's OK.

### Verify Before Acting

- #562 seed body says "A calendar reminder is attached, along with the review
  template" unconditionally; flagged in the PR for the wording review.
- A dismissed stuck-release alert is re-raised every drain run while the row
  stays stuck (by design; noted in PR).
- `check:agent-invariants` / `check:agent-wiki` fail only inside fresh worktrees
  (per-machine links); not a repo defect.
- **Owner's main checkout WIP (leave it):** `.codex/hooks.json`,
  `.github/hooks/impeccable.json`, untracked `.impeccable/critique/…`, `output/`.
- Flaky `tests/unit/workbench-integrity-service.test.js` (Session 652): did not
  recur in this session's full runs.

### Do Not Reopen Without New Decision

- D47 (Board dates from calendar), D48 (fixed due date; withdraw via PD; PDF and
  date required to invite), D49 (one combined email; 15-minute fallback; wording
  split). Meeting-date retirement scope (Session 652).

**Codex workstream (unchanged this session):** PR #553
(`codex/shared-prompt-library-plan`, `1187caf17`) — publication route decided;
merging, messaging Connor, schema, sandbox/Production steps and paid model tests
each need separate owner authorization. Details: `git show
45814e64c:SESSION_PROMPT.md`.

## Concurrent Workstreams

| Owner / workstream | Latest recorded resume boundary |
|---|---|
| Claude / reviewer build (J27) | #561 ready for owner reads; #562 draft at "acceptance step done", manual path next; follow-up wording PR not started |
| Codex / shared prompt library | PR #553, `1187caf17`, unmerged |
| Codex / Ranking, Board archival | Prior handoffs; not revalidated |
| Claude / Research request corpus | Owner-gated; no new authorization |

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/board-writeups/calendar.js` (#561) | Board dates from the cycle calendar |
| `lib/services/reviewer-engagement/materials-release-store.js` (#562) | Release claim table writer |
| `lib/services/reviewer-acceptance-drain.js` (#562) | `release_materials` step + stuck-release alerts |
| `lib/services/review-manager/cycle-materials-attachments.js` (#562) | Shared attachment fetch; strict loader |
| `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md` | Build plan, state table, decisions |

## Testing

```bash
cd ../WMKF_Apps-materials && npx jest tests/unit/reviewer-materials tests/unit/reviewer-acceptance
gh pr checks 561; gh pr checks 562
```

## Verification and Closeout

- Milestone determination: no DEVELOPMENT_LOG entry — nothing merged or deployed.
- Claim-evidence pilot: report found no eligible plan/design edit for this
  session key; no row added.
- No CLAUDE.md or memory changes.
