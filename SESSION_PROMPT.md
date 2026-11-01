# Session 657 Prompt: PR553 parked for Monday Windows09 checks with Connor

**Session 656 summary — Codex, 2026-10-30 Pacific.** Documentation closeout is on
`main`; runtime feature work remains on `codex/shared-prompt-library-plan` and is
not merged or pushed. Connor's ZIP must never be added or pushed to Git.

Prior handoffs are preserved exactly and were verified retrievable before this
rewrite: `git show aa32a0c12:SESSION_PROMPT.md` (Claude Session655 plus Monday
parking pointer), `git show b19a1f4dd:SESSION_PROMPT.md` (original Claude655), and
`git show b091cf5cd:SESSION_PROMPT.md` (Codex Board release Session654).
Historical paths, live observations and permissions are not fresh authority.

## Claude closeout — 2026-11-01 (Session 655 continuation)

The Claude invited-reviewer outcomes stream continued on `main` today while the
Codex Session656 summary below stays current for PR553. Prior Claude detail for
this stream is preserved at `git show 1fd66db14:SESSION_PROMPT.md`.

### What Was Completed (all owner-approved, merged, Vercel Production success)

1. **Track Reviewers withdrawal dialog (#578) and "Record outcome…" for invited,
   unanswered reviewers (#579), verified in Production** on Factory test requests
   1003429 (accepted → conflict of interest raised by Foundation) and 1003430
   (invited → Other, ended by Foundation). Production read-back matched:
   Declined, reason + note, Ended by Foundation, Ended at, link revoked; review
   status Withdrew on 1003429 and blank on 1003430.
2. **#582 `466cc9ef`**: invite-dialog campaign timeline layout fix.
3. **#584 `2a183767`**: Reviewer Finder "Failed to load proposal from SharePoint"
   fixed. Blob `head`/`put` now pass `BLOB_READ_WRITE_TOKEN`; Production
   `BLOB_STORE_ID` points at the private Factory store.
4. **#585 `c0ccde79`**: a staff-recorded conflict of interest or Foundation
   ending now shows by its reason ("Conflict of interest" / "Ended by
   Foundation") in the Track badge and the History status, not "Withdrew".
5. **#586 `f949a5cf` + hotfix #587 `745ec4fb`**: the invitation no longer
   promises a proposal release date.
   - The invite dialog and admin defaults lose the field.
   - `{{proposalDelivery}}` is removed automatically only on recognized
     standalone release lines; any other line keeps it and blocks Send, so
     custom wording never loses its link or a deadline.
   - #587 added the live default's sentence after #586 had blocked Send for it.
   - Codex: 6 rounds, approved.
   - Production edits (owner-approved, ETag-bound, read back): in the live
     `email.reviewer_invitation.body` (a custom 2026-07-25 wording, so not
     force-rebaselined) and in Jean Kim's saved invitation, only the release
     sentence was replaced with the approved two sentences. No saved invitation
     still carries the token.
6. **#588 `264d511f`** (docs) and **#589 `fdd60f49`**: the Reviewer Finder cycle
   record's `wmkf_reviewreturndeadline` is no longer read, written, projected or
   fingerprinted (the column stays).
   - The Release Materials dialog loses its Proposal Send Date field; the unused
     legacy `DEFAULT_TEMPLATE` is removed.
   - Production read beforehand: the column was empty on all 10 cycle rows, and
     no live or saved wording used the date tokens.
   - Codex approved on round 1.
7. **Factory runs** (Production, parent 1002788, recipe basic, cycle J27):
   - run A `2827ffbd-466b-43e2-ad1a-1b938999b2b2` → 1003429;
   - run B `333b4f11-24c4-43cc-954e-b703f94579ff` → 1003430.

   Both were written to ledger database `ledger_prod` via
   `TEST_REQUEST_LEDGER_URL`; the host label (`lib/db/ledger-registry.js`) was
   not recorded at run time. Synthetic reviewer "TEST · Factory Reviewer"
   (`e5003660`) is bound and invited on both requests. The private scratch
   bundle/manifests were deleted at the owner's direction.
8. **Earlier today:** test request 1003221 (no Factory run id, so its reviewer
   email is refused) was moved D26 → J27 (owner-approved).

### Next Items (Claude stream)

**Verified open** (plan `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md`):
- Materials cutoff: refuse portal decline/re-accept once a
  `reviewer_materials_releases` row exists in a state other than `failed`, with
  interleaving tests.
- Reporting: outcome history query/DTO, bucket precedence, rollup.
- D26 repair of the 10 rows that lost an answer: needs a per-row manifest and
  separate owner authorization.

**Owner decisions:**
- Disconnect the Factory store from the default `BLOB` env prefix (env change,
  not done).
- Removed-candidate terminal history.
- The first-link due-date write gap in `regenerate-token`.
- Old Claude worktrees (`../WMKF_Apps-board-calendar`, `-materials`,
  `-manual-mint`, `-outcomes`) and merged remote branches: cleanup needs an OK.

**Known gaps (not fixed):**
- The Release dialog isn't closed on a context change.
- `check:script-suggestion-writers` misses `createClient().patch` writes.
- PD users can't delete honorarium requests (slow service-principal fallback).
- D26 Board calendar render is unverified.
- 1003221's legacy request meeting date may still show D26.
- Find-tab applicant-referred enrichment aborts on Factory clones
  ("Could not determine the proposal's authors/institution").
- Invite Reviewers says "No saved candidates yet" while the Removed list has
  rows.
- History's "Recorded; send not confirmed" on invitations is deliberate (no
  delivery proof).
- The per-user Reviewer Finder preference defaults (`reviewerFinderPreferences.js`
  `GRANT_CYCLE_SETTINGS.reviewDeadline` / `EMAIL_TEMPLATE`) were not retired.
- Playwright cannot start its web server in a node_modules-symlinked worktree
  (Turbopack error); CI runs e2e.

**Safety, carried forward:**
- Production reads and writes each need a specific owner OK; the auto-mode
  classifier refuses generic approvals such as "go for it", so ask with the
  exact action.
- Writes need a same-day `DATAVERSE_PROD_WRITE_ACK`.
- No reviewer proposal-availability emails for D26.
- Never invoke native `confirm()` dialogs via browser automation; the owner
  clicks Send/OK.

Milestone: DEVELOPMENT_LOG entry added (staff-recorded reviewer endings and the
retired proposal release date).

## Codex Session 656 summary (PR553, unchanged)

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

## Concurrent Codex documentation audit — 2026-10-31

[VERIFIED via source/Git at `f6376751d`; no live probes] A bounded audit of the
eleven product threads and three stale shipped-feature to-dos is recorded in
`docs/audits/product-backlog-reconciliation-2026-10-31.md`. Materials-on-acceptance,
cycle-calendar and Zoom-picker build status are corrected across the queue,
plans, memory and wiki; genuinely open products and owner decisions stay open.
Grant Reporting audit logging is distinguished from request-field writeback;
retrospective and staged-pipeline designs account for existing building blocks.
This is documentation only on `codex/session-2026-10-31-start`; no runtime
promotion or change to Claude's outcomes ownership is implied. Historical
carryovers remain subject to verification and their original authorization.

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
| Claude / materials #562 | **MERGED + DEPLOYED** on owner approval (Claude, 2026-10-31): merge `fcad0ad53`, Vercel Production success, all `main` CI green, head `59c31abe7` (owner wording approved; the acceptance email's attachment sentence is now `{{attachmentsNote}}`, naming only the calendar file/template actually attached). Owner-approved Production prep done first: migration 091 applied (`reviewer_materials_releases`, 0 rows, 15:49 UTC) and `email.reviewer_materials_acceptance.{subject,body}` seeded (`created=2`, 43 existing keys skipped). Open owner decisions: removed-candidate terminal history; first-link due-date write gap. Follow-up done 2026-11-01: invitation wording/`{{proposalDelivery}}` (#586/#587 + live edits) and Reviewer Finder cycle date retirement (#589) |
| Claude / manual-send gap #568 | **MERGED + DEPLOYED** on owner pre-approval (Claude, 2026-10-31): merge `166b808e2`, Vercel Production success. The manual materials send rechecks the reviewer after its release claim and mints bound to that ETag (a decline mid-batch now sends nothing). Codex approved. Also fixed `main` red on `check:atlas` from the D26 audit probe (`dacb8b1c7`) |
| Claude / invited-reviewer outcomes | **IN PROGRESS** (2026-11-01): slices 1–3b and the two staff-ending dialogs merged (#569–#579) and verified in Production on test requests 1003429/1003430; #585 labels conflict/Foundation endings by reason. Next: materials cutoff, reporting, D26 repair (separate auth). Plan `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md`; full prior row at `git show 1fd66db14:SESSION_PROMPT.md` |
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
