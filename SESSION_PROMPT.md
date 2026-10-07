# Session 583 Prompt: resume Proposal Ranking from its feature branch

## Proposal Ranking handoff — 2026-10-07 (Codex)

Owner requested this docs-only pointer on main so `/start` on the home machine can
find the unmerged work. The implementation remains on **`codex/proposal-ranking`**,
latest handoff commit **`283f02a19`**, in
[PR #457](https://github.com/justingallivan/wmkf-research-apps/pull/457).
This main commit does not merge or enable the app.

### Resume at home

1. Fetch origin and inspect the current checkout for unrelated changes.
2. Continue on the existing remote branch `codex/proposal-ranking` (create a local
   tracking branch if absent); do not rebuild the feature from main.
3. Read that branch's `SESSION_PROMPT.md` and its linked Atlas/audit receipts for
   the detailed handoff. Use the home machine's own credentials for live checks.

### Verified progress

- Separate ranking app built by Luna, reviewed by Sol and the orchestrator, with
  bounded Claude Opus subscription-OAuth reviews. No Fable or agent API-key use.
- Sandbox schema and role provisioned. Storage initialization, conditional save,
  stale-edit atomic rejection and duplicate-cycle rejection passed.
- GET-only privacy check verified direct-table denial for one enabled nonapp
  sandbox staff identity: effective-user query matched, all three retained records
  returned 403, and application control reads returned 200. This is impersonation
  evidence, not an all-staff or production claim.
- Existing proposal/review fields were unchanged. D99 synthetic cards exist only
  inside retained ranking snapshot data. Do not rerun fixture creation.
- Runtime app remains disabled; production ranking schema/activation is pending.

### Next items

**Verified open:** in-app walkthrough of private rankings, submission, composite
publication, meeting reordering and full-requested budget totals. Facilitator
configuration, participant grants and approved-environment readiness remain open.
The earlier sandbox source scan found zero eligible ordinary proposals; resolve
that acceptance-data limitation without silently copying/creating source proposals
or weakening test exclusion. See feature-branch evidence before acting.

**Owner decision needed:** deliberate production promotion after acceptance and
current-head CI review. No production activation is authorized by this pointer.

**Work constraints:** keep the solution simple; Luna builds/reconnoiters, Sol
reviews, orchestrator finishes, bounded Opus OAuth review. No review loops over
minor polish. Temporary local probe files do not travel between Macs; sanitized
results and retained IDs are committed on the feature branch.

### Commits and milestone determination

- `8d8b10872`: sandbox schema verification and source-field corrections.
- `8be9f57a1`: ETag fix and persistence rehearsal.
- `3f5c6cf10`: effective-user privacy verification.
- `283f02a19`: detailed feature-branch session handoff.

No new production milestone shipped; no DEVELOPMENT_LOG entry is required.

---

## Prior main handoff — historical context, not a freshly verified worklist

The earlier main handoff is preserved below for other workstreams. Its open/closed
claims were not reverified by this ranking session. Check current source and owner
context before resuming any item, especially cleanup or production actions.

## Previous Session 581 Prompt: hand the transcript/summary UX audit to Codex; build Stage 3 (lead-PD sign-off view); check 1003010

## Session 580 Summary — 2026-10-06 PT (Claude)

The owner's item 1 grew into a planned group-review handoff. **Stages 1 and 2 are live in
Production.** Plan: `docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`, which
records the owner decisions A, B and C.

### What Was Completed

1. **Process design with the owner.**
   - The lead PD drafts alone, then hands off.
   - Research PDs get an email at handoff, and the writeup appears in their Final writeups view.
   - Sign-off is not required; the lead PD can send to leadership at any time.
   - A sign-off still counts after later edits, shown as "edited since".
   - Leadership gets a daily digest at midnight Pacific.
   - There is no pull-back from group review.
   - Program Coordinators can see the draft.
   - Wording: "Ready for group review", "Sign off", "Send to leadership".
2. **Stage 1: PR #452, merge `40b70a145`, live.**
   - Step 4 is titled "Post-presentation writeup" and reads "Post-visit drafting". It offers **Edit
     writeup in Word** and **Ready for group review**, using the same `POST
     /api/workbench/final-writeup` route.
   - The `finalReview` fact carries `canStart`, `startBlockedReason` and `sourceArtifactId`
     (`status-facts.js`).
   - The confirmation is bound to the displayed document (Codex finding).
   - Step 5 lost the button that only switched tabs. The panel copy was trimmed after owner review.
3. **Stage 2: PR #453, merge `b47a70eae`, live.**
   - `lib/services/pre-site-visit/writeup-visibility.js` hides the Draft/Review file except from
     the lead PD, Program Coordinator persona holders and superusers. Covered surfaces:
     - pre-site GET: `currentArtifact`, `pendingArtifact`, and `writeup`, each redacted on its own
       lifecycle;
     - final-writeup GET: `sourceFile` and the pending file, via the facade's `canSeeDraft`;
     - the deliberations list, per row;
     - logistics materials.
   - Generate/regenerate and start-site-visit return 403 `pre_site_writeup_lead_only` to anyone
     who isn't the lead PD or a superuser.
   - The pre-site GET returns `writeupAccess`. Unlinked accounts get an explanation.
   - Codex round 1 found the race between the two artifact reads; fixed with a test that failed on
     the old code. Round 2 found only Dynamics Explorer, which the owner accepted as a gap.
   - The owner published the Program Coordinator persona for Connor, Sarah and Duncan.
4. **Durable docs:**
   - route security matrix rows and Auth column;
   - service catalog;
   - glossary (new step title);
   - work queue entry;
   - agent wiki;
   - a historical note on the 2026-10-04 status-clarity mock-ups;
   - DEVELOPMENT_LOG milestone;
   - claim-evidence pilot row.

### Commits (main)
- Plan: `f1a0fe52f`, `1b7a49c97`.
- PR #452: `74a15afa2`…`ebc217151`, merged as `40b70a145`. Docs: `cd847a585`.
- PR #453: `dcd2c99a6`…`36faa9fd6`, merged as `b47a70eae`. Docs: `fe7d19329`.
- The handoff commit follows.

## Next Items

### Verified Open

1. **Codex workstream: transcript and summary UX audit, Meeting Tracker side.**
   - Owner, 2026-10-06: "we have built infrastructure, but it doesn't seem integrated well into
     UI/UX"; confusing or missing screens are the starting point.
   - Run it in a parallel worktree (`/parallel-agent-worktree`, base `main`).
   - **Phase A, read-only:**
     - inventory every built transcript/summary capability (recording upload, transcription,
       speaker names, presentation/discussion split, presentation summary and its
       republish/stale rules, staff and Board-facing pieces);
     - map each to the screen where staff can see or use it (Meeting Tracker session and visit
       pages, the Staff Deliberations Presentation step, Admin);
     - flag what has no screen, what is reachable only by script or Admin, and confusing wording
       or state;
     - propose ranked screen changes, then **stop for owner selection**.
   - **Phase B:** build the approved items with tests, a Codex adversarial review and a PR.
   - Include the two S578 bugs:
     - a session that fails to load shows an empty, saveable form (`SessionEditor.js`; data-loss
       shape; reproduced with an invalid `cycleCode`);
     - a slot's "Briefing not yet shared" disagrees with Workbench history (TEST 1003222).
   - **Boundary:** do not change the Staff Deliberations reads of session or summary data
     (`ResearchPresentationFollowUp.js`, the session line in `StaffDeliberationsTab.js`) without
     flagging it.
   - **Sources:**
     - `docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md` (Stage 2 shipped S577;
       Stage 3 discussion summary and Stage 4 Board recording not started);
     - `docs/plans/SITE_VISIT_TRANSCRIPT_CARD_REDESIGN_PLAN_2026-10-04.md`;
     - `docs/plans/MEETING_TRACKER_TRANSCRIPTION_PLAN_2026-10-01.md`;
     - `docs/plans/ASSEMBLYAI_TRANSCRIPTION_PILOT_PLAN_2026-09-30.md` and its runbook.
2. **Stage 3: the lead PD's sign-off view** (plan §4, Stage 3).
   - Rename "Mark reviewed" → "Sign off" (`FinalWriteupTab.js`; tests pin the old name).
   - Per-request projection for the lead PD and superusers: expected PDs = the request's program
     audience in `final_writeup.matrix_audiences` ∩ PD persona, minus the lead.
   - States: signed / signed (edited since) / not yet. Names only.
   - The confirmation on **Send to leadership** names the PDs who haven't signed off.
   - Today only superusers and PCs see the matrix (`dashboard-service.js:676-678`).
   - Run `/contract-reconcile` first.
3. **Stage 4: handoff email to Research PDs.** Send after the transition with its own receipt.
   Copy from settings keys, sent from the system mailbox. Needs a migration. Run
   `/contract-reconcile` first.
4. **Stage 5: leadership daily digest.** Cron `0 7 * * *` (midnight PDT), modelled on
   `scheduled-email-service.js:754`. Needs the census, matrix and Atlas updates.
5. **Watch the first scheduled preparation:** 1003010.
   - Its presentation ends Wed 2026-10-07 15:30 PDT; expect it prepared by ~15:45.
   - Owner-run check:
     `DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/report-staff-deliberations-preparation-receipts.mjs --cycle=D26`
   - This is the first real request to show the new step 4 and the hidden-draft rules.
6. **Deferred small items** (from S579, not touched):
   - the list's next step for a ready briefing should name the deliberation session date
     (`cycle-list-service.js:618`);
   - reword the two "generated before the Dataverse fill" warnings (`artifact-model.js`; a test
     pins them).
7. **Before J27 research presentations:** add `J27` to `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES`
   (J27-084), unless the cycle-rollover work replaces it.

### Owner Decision Needed

1. **Cycle rollover** (`docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` §9).
   Waiting on the colleagues' briefing on future cycle dates.
2. **Deliberations vocabulary:** after D26, suite-wide (`docs/NOMENCLATURE_GLOSSARY.md`).

### Parked

1. The orange "Automatic preparation is off" copy. Re-open with the cycle-rollover work.
2. Merged branches still exist locally and on GitHub:
   - `feature/deliberations-prep-exclusions`, `-handoff-robustness`, `-prep-schedule`;
   - `feature/writeup-group-review-handoff`, `feature/writeup-hide-before-handoff`.
   Delete when convenient, after confirming each is merged.

### Verify Before Acting

1. Older S577 items were not touched in S579–S580: memory hygiene, the Sonnet 5.5 inventory, the
   PR #431 remainder, and the pre-site distribution email rows. Their last state is in
   `git show e6666ae68:SESSION_PROMPT.md`.
2. Production reads, writes and env changes are owner-run (`!`). The auto-mode classifier blocks
   agent PR merges ("Merge Without Review"); the owner merges.
3. To pause automatic preparation: `vercel env rm STAFF_DELIBERATIONS_AUTO_PREPARE production --yes`,
   then redeploy.

### Do Not Reopen Without New Decision

1. Sign-off is not required before leadership. A sign-off counts after later edits ("edited
   since"). No pull-back from group review (owner 2026-10-06).
2. Hiding is app-level only, with no SharePoint permission changes. PCs = Program Coordinator
   persona holders, global, not per-program. Dynamics Explorer is an accepted gap (owner
   2026-10-06).
3. Handoff email recipients: Research PDs from the staffing setting (program audience ∩ PD
   persona), with no new allowlist. SoCal is added later by publishing a program entry.
4. Leadership is notified by a daily digest at midnight Pacific, not per event.
5. S579 decisions:
   - the exclusion list for 1003220–1003222;
   - staff-page attribution;
   - the 15-minute schedule;
   - deliberation sessions before the site visit are normal.

## Local dev

`GUARDED_REOPEN_SCHEMA_READY=on MEETING_TRACKER_SCHEMA_READY=on SITE_VISIT_MATERIALS_SCHEMA_READY=on npm run dev`

Localhost reads Production. Dataverse writes are blocked by the interlock; Postgres and email are
not. The owner is a superuser, so localhost always shows the draft. The view for other staff is
covered by route tests.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md` | Handoff plan, decisions, Stages 1–5 |
| `lib/services/pre-site-visit/writeup-visibility.js` | Draft visibility and change rights before group review |
| `shared/components/workbench/StaffDeliberationsTab.js` | Step 4 handoff, hidden-draft states |
| `shared/components/workbench/FinalWriteupTab.js` | Group review, "Mark reviewed" (→ Sign off), Send to leadership |
| `lib/services/final-writeup/transition-service.js` | Facade: status (with `writeupViewer`), start, advance |
| `lib/services/final-writeup/acknowledgement-service.js` | Sign-off records keyed to the SharePoint version |
| `lib/services/final-writeup/matrix-audience-service.js` | Staffing setting: personas, program audiences |
| `tests/unit/pre-site-writeup-visibility.test.js` | Predicate tests and the list of surfaces |

## Testing

```bash
npx jest tests/unit/staff-deliberations tests/unit/pre-site tests/unit/final-writeup tests/unit/workbench- tests/unit/site-visit tests/unit/document-lifecycle
npm run check:types && npm run build
```

(Session 579 and earlier handoffs: `git show fb0b90195:SESSION_PROMPT.md`.)
