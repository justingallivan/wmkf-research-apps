# Session 657 Prompt: PR553 parked for Monday Windows09 checks with Connor

**Session 656 summary — Codex, 2026-10-30 Pacific.** Documentation closeout is on
`main`; runtime feature work remains on `codex/shared-prompt-library-plan` and is
not merged or pushed. Connor's ZIP must never be added or pushed to Git.

Prior handoffs are preserved exactly and were verified retrievable before this
rewrite: `git show aa32a0c12:SESSION_PROMPT.md` (Claude Session655 plus Monday
parking pointer), `git show b19a1f4dd:SESSION_PROMPT.md` (original Claude655), and
`git show b091cf5cd:SESSION_PROMPT.md` (Codex Board release Session654).
Historical paths, live observations and permissions are not fresh authority.

## What Was Completed

1. **[VERIFIED via feature Git history/milestone] Local PR553 tooling completed and reviewed.**
   Latest feature head `9d838c4c804c6f9607737b870e12c4ac3eb91736`, worktree
   `/private/tmp/wmkf-pr553`. It is clean and 15 commits ahead of its remote at
   closeout. Existing schemas/settings are test-only; no live publication operation
   or guards were registered/enabled by this work. No enabled package was built.
   Fable subscription-OAuth review/corrections completed; recorded verification is
   18 suites /697 tests, 25 packaging checks, 1,484 portable checks and applicable
   gates. These are recorded feature checks, not tests rerun on main at stop.
2. **[VERIFIED via file/ZIP hashes] Windows09 prepared and packaged with Connor's Claude prompt.**
   The outer ZIP contains exactly the full prompt and the unchanged Windows09 ZIP.
   The tracked [Monday archive](docs/plans/PR553_MONDAY_RESUME_2026-11-02.md)
   preserves full instructions, original hashes, local branch references and stop
   boundaries. Original source/SDK details are retrievable with
   `git show 9d838c4c8:docs/plans/PR553_ACTIVATION_AND_ENABLED_PACKAGE_2026-10-30.md`.
3. **[OWNER REPORTED] Justin emailed Connor the ZIP and downloaded it.**
   Connor execution is not yet verified. User explicitly prohibited sending the
   ZIP to Git. GitHub metadata confirms the repository is PUBLIC. All binary
   handoffs remain local/untracked; documentation-only sync does not include them.
4. **[OWNER DIRECTED] Local expansion paused until Windows results.**
   Monday starts with offline checks only. A Windows PASS does not authorize
   registration, uploads, guard activation, enablement, production work or a
   feature deployment. Actual identity/bindings/quiet-window evidence and separate
   exact-plan approvals remain required for the later test rehearsal.

### Commits and destinations

Feature branch only (held local, no push/promotion):
- `bac77ba98` activation and enabled-test-package tooling; Fable corrections.
- `9d838c4c8` Windows09 source-bound handoff and pause.
- Earlier exact execution/recovery: `24c09a74e`; guard preparation: `994a54e25`.
- The other unpushed feature commits remain reachable on that branch; preserve it.

Main docs only:
- `aa32a0c12` Monday archive and parked-task pointer.
- This closeout: Session657 prompt and owner-reported delivery/no-Git-ZIP rule.

## Next Items

### Parked — Monday, November 2

**Shared prompt publication with Connor.** Resume from the
[Monday archive](docs/plans/PR553_MONDAY_RESUME_2026-11-02.md).
- Supply the already-delivered bundle09 to Claude on Windows and run only its
  offline checks. Preserve `windows-check-result.json` and complete console output;
  transcript must be outside the extracted directory.
- Bring results here for exact package/source-hash validation. Do not run the
  registration or activation commands merely because offline checks pass.
- Preserve original IDs, journals, existing prompts/settings and signing-key custody.
- No local feature expansion until results or a new owner instruction.

### Verified Open

No additional PR553 implementation is scheduled. Actual Windows proof and later
approved live rehearsal remain outstanding. Recheck local worktree/branch/status
before resuming; do not treat a temporary path as guaranteed to survive.

### Owner Decision Needed / Other Streams

#561 and #562 are merged (see Concurrent Workstreams; Claude, 2026-10-30/31).
Still open from the prior Claude handoff: the removed-candidate terminal-history
question and the first-link due-date write gap. Consult the exact prior handoff
and the owning plan before acting. Do not convert those carryovers into
authorized live actions.

### Verify Before Acting

- The latest 15 PR553 commits are LOCAL ONLY. Main documentation is remotely
  synced at closeout; this is not a backup of the unpushed feature code. Do not
  push that branch casually: it may trigger Preview. Preserve the worktree and
  common Git objects; obtain a deliberate backup/promotion decision if changing
  machines or needing remote feature access.
- Local sendable archive:
  `output/connor-windows09-offline-checks/Connor-Windows09-Offline-Checks.zip`.
  It is not in Git and will not appear on another machine through a pull. The
  owner has already handled email/download delivery. Preserve local output.
- PR heads below were checked via GitHub at this stop, not their CI/live readiness.
- Prior migration/seed/deletion/retirement steps need fresh preflight and explicit
  authority; no carryover removal is authorized by this handoff.
- Unknown main WIP belongs to its owners: `.codex/hooks.json`,
  `.github/hooks/impeccable.json`, untracked `.impeccable/critique/…` and `output/`.
  These were left untouched and unstaged.

### Do Not Reopen Without New Direction

- No Connor ZIP in Git, no automatic retry of uncertain registration/activation
  writes, no invented runtime IDs/evidence, no implicit approval to enable.
- Preserve prior Board release/email receipts; do not re-release the nine files
  or resend the five Sent activities from the prior Board milestone.
- Prior Claude D26 restriction remains recorded: no reviewer proposal-availability
  emails and no clearing/removal of historical rows under this closeout.

## Concurrent Workstreams

| Owner / workstream | Latest recorded boundary |
|---|---|
| Codex / shared prompt library | PARKED; local `9d838c4c8`, Windows09 offline check with Connor Monday; [resume archive](docs/plans/PR553_MONDAY_RESUME_2026-11-02.md) |
| Claude / Board calendar #561 | **MERGED + DEPLOYED** on owner approval (Claude, 2026-10-30): merge `955613bdb`, Vercel Production success, all `main` CI green. Head `82039e29d` also fixed the `reviewer-engagement-census` failure that `b19a1f4dd`'s close-out script caused on `main`. All three owner-run pre-merge checks passed (D26 Board Mailing 2026-11-25 ≤ Board 2026-12-10; no pending intent or unsent draft). Unverified: D26 Board page rendering calendar dates (needs a signed-in look) |
| Claude / materials #562 | **MERGED + DEPLOYED** on owner approval (Claude, 2026-10-31): merge `fcad0ad53`, Vercel Production success, all `main` CI green, head `59c31abe7` (owner wording approved; the acceptance email's attachment sentence is now `{{attachmentsNote}}`, naming only the calendar file/template actually attached). Owner-approved Production prep done first: migration 091 applied (`reviewer_materials_releases`, 0 rows, 15:49 UTC) and `email.reviewer_materials_acceptance.{subject,body}` seeded (`created=2`, 43 existing keys skipped). Open owner decisions: removed-candidate terminal history; first-link due-date write gap; follow-up PR (invitation wording, `{{proposalDelivery}}`, Reviewer Finder date retirement) |
| Claude / manual-send gap #568 | **MERGED + DEPLOYED** on owner pre-approval (Claude, 2026-10-31): merge `166b808e2`, Vercel Production success. The manual materials send rechecks the reviewer after its release claim and mints bound to that ETag (a decline mid-batch now sends nothing). Codex approved. Also fixed `main` red on `check:atlas` from the D26 audit probe (`dacb8b1c7`) |
| Claude / invited-reviewer outcomes | **IN PROGRESS**: slices 1–2 **MERGED** as #569 (`e14a1abb1`, owner-approved 2026-10-31); branch `claude/invited-reviewer-outcomes`, worktree `../WMKF_Apps-outcomes` (continue slices 3–5 on a fresh branch off main). Plan + build contract: `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md`. Slice 1: Wave 35 `wmkf_endedby` + Did-not-submit provisioning scripts, owner-run, NOT applied. Slice 2: Remove/Restore/re-add/save/promotion/corrections never erase a contacted reviewer's response; `reinvite_unavailable`; server-computed `canRemove`/`canRestore`; operator scripts guarded. Codex: 5 rounds, final approve; full Jest 26,577 green. Owner confirmed decline→Accepted correction from any open status (2026-10-31). Next: slices 3 (outcome writers, materials cutoff), 4 (Record outcome UI), 5 (reporting); then the two Production schema changes (separate approval). D26: 10 removed rows lost an answer; repair after the build |
| Codex / Board #563/#564 | Prior deployed milestone preserved at `b091cf5cd`; no new live work here |
| Codex / ranking, prior archival | Prior handoffs; not revalidated |
| Claude / research request corpus | Owner-gated; no new authorization |

## Key Files and Resume Verification

- [Monday task archive and complete Claude prompt](docs/plans/PR553_MONDAY_RESUME_2026-11-02.md).
- Feature-only detailed record:
  `git show 9d838c4c8:docs/plans/PR553_ACTIVATION_AND_ENABLED_PACKAGE_2026-10-30.md`.
- Feature-only operator sequence:
  `git show 9d838c4c8:docs/plans/PR553_OPERATOR_CHECKLIST_2026-10-30.md`.
- Other streams' owning plan:
  `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`.

```bash
git status --short --branch
git -C /private/tmp/wmkf-pr553 status --short --branch
git -C /private/tmp/wmkf-pr553 log -2 --oneline
```

## Closeout Verification

- Run scoped documentation/reference/fact/secret gates sequentially with self-tests;
  do not rerun live mutations or broaden feature work for session cleanup.
- Claim-evidence pilot report was attempted; local state could not be read. No
  eligible-session observation or zero-advisory row was invented.
- Milestone determination: no DEVELOPMENT_LOG entry required. This is unmerged
  local preparation and archival, not a newly shipped capability or production
  cutover. No CLAUDE.md or memory changes were needed.
- Sync only docs on main. The feature remains explicitly held; Connor's ZIP is
  absent from the commit/push payload. No feature promotion is implied.
