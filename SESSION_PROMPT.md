# Session 592 Prompt: Stage 4 build plan; first live test of attendance attribution

## Session 591 close — provenance and attendance shipped (Codex built, Claude orchestrated); Stage 4 Sandbox pilot passed (Claude, main, 2026-10-09/10 PT)

### What Was Completed

1. **Stage 4 coordinated with Codex's speaker-label work; owner decisions 11-17 recorded** in `docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md` (`090b3e528`, `f7a767f2a`):
   - 11: the video binds to the transcript revision (later edits rare);
   - 12: the same-source check is metadata plus a staff listen (hard gate 1 relaxed; no packet proof, no Zoom re-fetch);
   - 13: 1003222 is a test request; re-import it when a real cut is needed;
   - 14: Codex owns provenance and attendance, Claude owns Stage 4, shared files one editor at a time;
   - 15: guiding principle is fewest sessions and clicks with minimum regeneration (presentation end plus attendance in ONE correction);
   - 16: record the MP4's recording start/end on `zoom_video_copies`;
   - 17: migration 079 is Stage 4.
2. **Synthetic Vercel Sandbox pilot passed, about $0.22 of the $10 cap** (`09930245a`, `fbde74ad4`):
   - 60-minute 1080p generated fixture cut in iad1 at 2 vCPU in about 11.5 min (48-minute presentation);
   - interruption, full disk and sandbox timeout all fail closed;
   - every sandbox removed, no snapshots.
   - Results `docs/plans/STAGE4_SANDBOX_PILOT_RESULTS_2026-10-09.md`; script `scripts/benchmarks/stage4-sandbox-pilot.py`.
   - Not exercised: upload, VFR, Zoom `bin_data` stream, browser/SharePoint ending playback.
3. **Transcript provenance shipped (Codex):** merge `f3cc08540`, migration 077 applied by the owner. Exact Zoom file binding at import, frozen content-free source identity per publication, bundle v6, and the server seam `resolveCurrentMeetingTranscriptSource`.
4. **Attendance attribution shipped (Codex built; Claude reviewed, ran 125 related suites / 2,273 tests, merged):** merge `06ef45ee8` (`7ddc5a4e7`, `3af9267de`), migration 078 applied by the owner before merge; Production deployment of `06ef45ee8` succeeded.
   - Plan `docs/plans/ZOOM_ATTENDANCE_ATTRIBUTION_PLAN_2026-10-09.md`; owner decisions D1-D4 and Q1-Q4.
   - The manual "Shared microphone" link Codex added was removed on owner decision. Claude committed that removal because Codex's sandbox could not write git metadata.
5. **Zoom report facts probed (owner-run, shape-only):** `scripts/probe-zoom-recordings.mjs --attendance` (`1c752504d`).
   - The Meeting Tracker app already has the report and past-participants scopes.
   - Guests have no stable ID; `user_id` is per row, so grouping is by display name only.
   - Repeated names were waiting-room rows; `duration` is seconds.
   - The first join was 884 s before the audio `recording_start`.
6. **Migrations:** Production and `main` end at 078; **079 reserved for Stage 4**; next free 080 (`.claude-memory/project-migration-numbers-claimed-off-main.md`, `cf5b1257e`).
7. **Worktrees:**
   - `/Users/gallivan/Code/WMKF_Apps-codex-labels` is on `codex/zoom-attendance` (merged; no uncommitted changes; no `.env.local`, deliberately).
   - New `/Users/gallivan/Code/WMKF_Apps-codex-group-review` on `codex/group-review-non-lead-ui` (no upstream) for minor group-review UI changes for non-lead PDs. The owner holds the Codex prompt; no commits yet.
8. **Wiki:** Sandbox hazards in `docs/agent-wiki/topics/dev-environment.md`: `vercel sandbox run` leaves the sandbox running; no per-sandbox spend cap.

### Next Items

#### Verified Open

1. **Stage 4 build plan (Claude), then `/contract-reconcile` Mode A.** **Session 592: drafted and reviewed** — `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md` (slices 0-5; Mode A ready with named changes, applied; owner decisions B1-B6 recorded; slice 0 SDK probe passed; next is slice 1, migration 079 plus copy-time recording times, on a branch). Evidence: Stage 4 plan decisions 11-17; the provenance seam is merged; the card is now free for Stage 4 (attendance merged).
   - Scope: migration 079 (split-job table plus `zoom_video_copies.recording_start/end`), recording times written at copy, split service/worker/Sandbox processor, `bindPresentationVideo` (new file), Board/briefing allowlists, card Video line.
   - Decision 7 (presentation-video picklist value) is owner-provisioned at build time.
   - Ending playback is checked on the first real cut (browser and SharePoint viewer, before Board/briefing exposure), not on a synthetic clip (Session 592).
2. **First live use of attendance attribution.** Not yet exercised on a real meeting. Needs a transcript with verified Zoom provenance (a new import); legacy transcripts show only the voices list. Suggested: re-import 1003222 from Zoom (one paid transcription, owner-run), which also gives Stage 4 its first real input (re-copy its video too, decision 16).
3. ~~Review `codex/group-review-non-lead-ui`~~ **Closed (Session 592): no change needed.** Codex found "Send to leadership" already limited to the lead PD or a superuser; Claude confirmed in source (`resolveAuthorization` in `lib/services/final-writeup/transition-model.js`, UI `canAdvance` gate, server re-check in `transition-service.js`). The owner saw it as an admin, and admins keep access. The worktree and branch hold no commits.

#### Owner Decision Needed

1. Carried, not rechecked: Proposal Ranking PR #463 and the colleague dry run. (`ZOOM_RECORDING_HOSTS` was re-created as non-sensitive in Production on 2026-10-10, Session 592.)

#### Verify Before Acting

1. Carried from Sessions 588-590, not rechecked: Proposal Ranking Production cleanup; optional paired-summaries checks; PR #470 cleanup test.

### Gotchas

- Codex's sandbox cannot write shared git metadata (`index.lock`) in a worktree. Expect to commit and push for it after reviewing its diff.
- The `codex:codex-rescue` Agent prompt must start with the CODEX RESCUE HANDOFF preface (a hook blocks it otherwise).
- Apply a migration from a worktree without `.env.local` with `node --env-file=../WMKF_Apps/.env.local scripts/apply-migrations.js` (owner `!` run).
- `schema_migrations` columns are `name`, `applied_at`, `applied_by` (not `filename`).
- Jest here rejects `--testPathPattern`; pass the regex as a positional argument.
- Earlier gotchas still apply: `.env.local` points at Production; worktree Turbopack needs `--webpack`; `check:agent-invariants` fails in worktrees; the Word lock file `shared/templates/pre-site-visit/~$ase-ii-pre-site-visit-v6.docx` must not be committed.

**Milestone determination:** provenance and attendance attribution shipped to Production, so a DEVELOPMENT_LOG entry was added ("Zoom transcript provenance and attendance-based discussion attribution (Session 591)").

---

## Session 590 close (superseded in part by Session 591) — Stage 3b released and live; picker fixes; Stage 4 designed and researched (Claude, main, 2026-10-09 PT)

### What Was Completed

1. **Stage 3b (Zoom video copy to SharePoint) is live with `ZOOM_VIDEO_COPY_ACCESS=on`.**
   - Owner confirmed rulings 7 and 10. Ruling 7 census (`scripts/probe-recording-slot-versions.mjs`, owner-run): 25 Recording rows, 14 file winners, 0 unversioned.
   - Release: migration 076 applied (owner); step 0 merged `c79f79807` (deploy 6963903401); probe 3 recorded (15 meetings, one MP4 each, 107.5-527.5 MB); local idle tick against Production returned `outcome: idle`; 3b merged `780fab218` (deploy 6965242102) with access unset; `test:<1003222>` then `on` (stored non-sensitive).
   - Mode D on 1003222: 149,405,180 bytes in 92 s; staff MP4 superseded after confirmation; absent from the Board page (verified live in Chrome). Not checked: video playback; repeat-Import is greyed out in the UI (tests cover it).
   - Vercel timing check: the owner's env redeploy `dpl_EARof6vu...` started before the variable was re-created at 10:45:37 PT; the git deploys after it (`243b0b7cd`, `ac7b96868`) carry `on`.
2. **Picker fixes (rulings 30-31), merged `cb2640a88`, Codex-approved.** **Copy video** on its own once a transcript is published; import line reads "Imported, transcribing..." / "Imported, transcript ready" from the joined job status.
3. **quickXorHash record (decision 6 gap), merged `306ba183f`.** The copy worker reads Graph's hash for the exact item at registering, bounded to 10 s, and stores it; failure stores NULL. Codex round 1 found the read unbounded (stalled body); fixed; round 2 approved. The 1003222 copy predates it (NULL).
4. **Stage 4 (cut the presentation video) designed: `docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md`.** Owner decisions: presentation video only (no discussion video); cut exactly at the confirmed end, earlier by measured mapping uncertainty up to 2 s, else block; Zoom copy plus Zoom transcript only; staff click to create; staff listen and approve before Board release; full Recording stays staff-open. Four hard gates recorded. The October 7 workflow plan is reconciled (no discussion video; Stage 5 deletion list).
5. **Codex venue research and local benchmarks merged `228a97b5b`.** Vercel Sandbox is the first venue (Azure pending a Dragonfly IT ticket; a subscription exists). Full re-encode; audio trimmed on a common clock and encoded only from isolated kept PCM, padding accepted only by exact payload match. Local research closed by the owner as promising with limitations; Apple decoders sometimes omit 4-21 ms of retained audio at the end, accepted as a quality limitation. Local timing: 60 min of 1080p at 4.34x real time on two laptop threads.
6. **Docs reconciled:** runbook Zoom section (the four `ZOOM_*` variables are Production-only secrets since 2026-10-08, `06816d870`); 3b plan marked shipped; Atlas `postgres-zoom-video-copies.md` (hash column, Mode D row).
7. **Memory:** `feedback-never-self-authorize-prod-dataverse-reads` gained the lesson that `.env.local` re-sets `DATAVERSE_ALLOW_PROD_READS`, so a "refusal smoke test" against Production is a Production read (`da66213eb`). This session made one such unrequested read (Recording census) and disclosed it.
8. **Worktrees:** removed `zoom-copy`, `zoom-copy-3b`, `zoom-picker`, `zoom-hash`, `codex-stage4` (all merged or pushed). New: `/Users/gallivan/Code/WMKF_Apps-codex-labels` on `codex/transcription-labels` for a Codex label fix (owner handed Codex a self-contained wind-down prompt).

### Addendum after `/stop` (same session, 2026-10-09 PT)

- **Stage 4 is PAUSED by the owner** to deconflict with a Codex speaker-label plan (attendance, Zoom timeline, VTT, per-revision transcript source record). Wait for that plan; then map the overlap and decide ownership and order. Do not edit the Stage 4 plan or run Stage 4 tests until then.
- Focused check part 1 (`804f5aa03`): Codex's fixed-anchor mapper blocks speech-like audio.
- Owner-approved real pair (`f02be6a66`): 1003222's copied MP4 audio is byte-identical to Zoom's M4A (157,533 packets); video constant 25 fps. Mapping is the identity, proven by packet equality; media deleted. Added `probe-zoom-recordings.mjs --only <recording_type>`.
- Open owner decision: transcribed-audio fingerprint at Stage 3a import (option 1, recommended) or Zoom re-download at split time (option 2). Likely folded into the shared transcript source record.
- For the Codex plan, Claude asked it to state: ownership of the source record, fingerprint and revision semantics (names-only vs source change); any change to the manifest, `bundle.js` or `zoom_recording_imports`; any word-timestamp or utterance-boundary change (moves the cut); migration numbers; its worktree/branch. Claude's points: bind the Stage 4 video to audio source + `endMs` + source video, not `revisionId`; add a word-gap check at the cut; per-participant transcripts need their own alignment proof or a block.

### Next Items

#### Verified Open

1. **Stage 4 next steps, in order (PAUSED, see addendum)** (plan "Next steps before the build plan"):
   1. Focused generated-media validation: speech-like/noisy audio, realistic pauses, VFR, delayed audio, ending playback in browser and SharePoint viewer.
   2. Synthetic Vercel Sandbox pilot within the $10 cap: confirm region, pricing and cap enforcement first; persistence off; verified cleanup; full-length runtime and failure cases.
   3. Ask Justin before the first real input (1003222's copied video, isolated test folder, no Board registration).
   4. Then `/contract-reconcile` Mode A on the design and the build plan. Decision 7 (Dataverse picklist value for a presentation video) is owner-provisioned at build time.
2. **Review `codex/transcription-labels` when Codex reports done**, before the owner merges.

#### Owner Decision Needed

1. **Optional:** re-create `ZOOM_RECORDING_HOSTS` as non-sensitive so its value is readable (runbook notes it is stored as a secret).
2. **1003222 cleanup (optional):** check the copied video plays; regenerate its transcripts and summaries, which are out of date after the Oct 9 Import.
3. **Proposal Ranking** (set aside; unchanged from Session 589, not rechecked): PR #463 and the colleague Production dry run.

#### Verify Before Acting

1. **Proposal Ranking Production cleanup** (carried from Session 588; nothing ran). Inspect current state first.
2. **Optional paired-summaries Production checks and the PR #470 cleanup test** (carried, not rechecked).

### Gotchas

- `.env.local` points at Production and sets `DATAVERSE_ALLOW_PROD_READS`; any script that calls `loadEnvLocal()` reads Production. Hand Production commands to the owner.
- Worktree `node_modules` symlinks crash Turbopack; use `next dev --webpack` in a worktree. `verifyCronSecret` skips the secret in development.
- `check:agent-invariants` fails in worktrees (no memory symlink); run it from the main checkout.
- Codex's companion reviews cannot run jest in its sandbox; run the suites locally.
- Homebrew's FFmpeg install (Codex) installed `openssl@4` and unlinked `openssl@3`; `brew link openssl@3` reverses it if a local tool breaks.
- Full jest showed different flaky suites per run this session (`workbench-integrity-service`, virus-scan `scanBytes`); each passes alone.
- Untracked `shared/templates/pre-site-visit/~$ase-ii-pre-site-visit-v6.docx` is a Word lock file; do not commit it.

### Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/STAGE4_VIDEO_SPLIT_PLAN_2026-10-09.md` | Stage 4 design, owner decisions 1-10, gates, next steps |
| `docs/plans/STAGE4_VIDEO_PROCESSING_OPTIONS_2026-10-09.md`, `STAGE4_LOCAL_MATRIX_RESULTS_2026-10-09.md` | Codex venue research and local benchmark closure |
| `scripts/benchmarks/stage4-*` | Offline synthetic benchmarks (generated media only) |
| `lib/services/meeting-tracker-recordings/video-copy-{store,service,worker}.js` | Live Stage 3b copy |
| `docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md` | 3b plan (shipped), rulings 1-31 |
| `scripts/probe-recording-slot-versions.mjs` | Read-only Recording slot-version census (owner-run) |

### Testing

```bash
npx jest tests/unit/zoom tests/unit/graph tests/unit/post-presentation tests/unit/recording-and-transcript-card
ZOOM_VIDEO_COPY_PG_TEST_URL=postgres://postgres:pw@127.0.0.1:<port>/postgres npx jest tests/integration/zoom-video-copies.pg.test.js   # throwaway loopback container
```

**Milestone determination:** Stage 3b shipped to Production, so a DEVELOPMENT_LOG entry was added ("Zoom meeting videos copy into SharePoint (Session 590)").

---

## Session 589 close — Stage 2 shipped and accepted; Stage 3b built and Codex-approved (Claude, main, 2026-10-08/09 PT)

### What Was Completed

1. **Paired summaries (Stage 2) is Production-live and accepted.**
   - Card slice on `claude/paired-summaries`:
     - `1c41e4c77`: Codex's replaceDraft fix
     - `a7838e3b6`: per-kind hook refactor
     - `19af9ad41`: paired action and discussion block
     - `424394781`: copy
   - Docs slice `4d1917085`. Codex approved the card slice.
   - **Owner decisions 9–12** (the build deviations) were accepted as recommended:
     - 9: the paired click skips any kind that has a draft
     - 10: both kinds send the paired acknowledgment version
     - 11: the "Replace draft with a new summary" label is kept
     - 12: one `SummaryBlock` component serves both kinds
     - The owner also accepted the prompt and consent text as built.
   - **Owner ran the release steps** (2026-10-09 UTC):
     - picklist 100000010 inserted
     - migration 075 applied (1 applied, 74 skipped)
     - prompt `meeting-transcript.staff-discussion-summary` v1 seeded (`87768430-90c3-f111-aaad-6045bd063e21`)
     - merge `5b8225ed8`; Production deployment 6952181551 success
   - **Acceptance on 1003222** (`ce3f45770`):
     - Verified by Claude in Chrome and by status-only probes:
       - the card and Staff Deliberations show both summaries
       - the Board page and the briefing page show only the presentation summary
       - both outside `open` routes return 404 for the discussion row (`064a57e0-…`) and 302 for the presentation summary
     - Not observed: the reload during a run and a draft edit.
   - DEVELOPMENT_LOG milestone added (`c44879d3e`, updated in `ce3f45770`).
   - The `claude/paired-summaries` worktree and local branch were removed. The remote branch is kept.
2. **Stage 3b (Zoom video copy to SharePoint) is built, Codex-approved, and not merged.**
   - The owner accepted decisions 1–3 and 5–7 as recommended, and set the stopping point: branches only; no migration, Vercel setting, live call or merge (`c4ba53bc5` on main).
   - **Step 0**, `claude/zoom-copy-step0` (worktree `/Users/gallivan/Code/WMKF_Apps-zoom-copy`, tip `e874c30ce`):
     - migration 076 (`origin` column plus the inert `zoom_video_copies` table)
     - `origin='browser'` isolation predicates
     - non-destructive registered-item binding
     - Codex approved in one round.
   - **Full build**, `claude/zoom-copy` (worktree `/Users/gallivan/Code/WMKF_Apps-zoom-copy-3b`, tip `61f4773af`, stacked on step 0). Sonnet built eight slices; Claude reviewed each:
     - S1: transport and access flag
     - S2: material-service seams and the decision-8 hook
     - S3: stores, with a real-Postgres proof
     - S4: service and route
     - S5: transfer worker
     - S6: registration, recovery and cron, with a crash-injection suite
     - S7: card
     - S8: docs
   - **Build rulings 1–29** are recorded in the plan under "Build rulings (Session 589, orchestrator)".
   - **Codex adversarial review:** rounds 1–4 raised six medium findings, all fixed with regression tests (rulings 24–29). Round 5 approved with no material findings.
     - a stalled Graph response body
     - receipt conflicts that never retired
     - three duplicate-copy races in Try again / N1
   - **Verification:** full jest 22,090 passed; 30 `check:*` gates plus self-tests green; loopback Postgres proof 18/18.
3. **Side session:** institution-name capitalization fixes applied to production (below).

### Next Items

**Superseded by Session 590:** rulings 7 and 10 confirmed; release steps 1-6 done; 3b live with access `on`. Read this section as history.

#### Owner Decision Needed

1. **Confirm Stage 3b ruling 10 (Import starts both).**
   - Evidence: plan "Build rulings" 10, 19 and 23; card code in `RecordingAndTranscriptCard.js` (`useZoomImport`, `declineReplace`).
   - As built:
     - Import first shows the replace confirmation, when the current Recording is a staff MP4.
     - It then sends the audio import and the video copy as two independent POSTs.
     - **Copy video** works on its own when transcription is off or there is no audio (the listing works video-only).
     - **Keep current file** copies no video and still imports the audio.
   - Confirm, or say what to change, before the 3b merge.
2. **Confirm Stage 3b ruling 7 (unversioned winner).**
   - Evidence: plan ruling 7; `video-copy-service.js` `checkReplacement`.
   - If the current Recording winner is a SharePoint MP4 without a positive slot version, start refuses with 409 `zoom_video_winner_unversioned` and copies nothing (staff can upload manually).
   - Conservative and expected to be rare. Confirm or change.
3. **Stage 3b release, owner-run, in order** (plan "Release"):
   1. Apply migration 076 (`node scripts/apply-migrations.js` from the step-0 worktree).
   2. Merge `claude/zoom-copy-step0` and verify the deployment is the merge build.
   3. Optional probe 3 (`node scripts/probe-zoom-recordings.mjs`; its default listing shows MP4 variants).
   4. Run the cron route once locally with `ZOOM_VIDEO_COPY_ACCESS=test:<TEST GUID>`, after confirming the Dataverse host and SharePoint site `.env.local` targets.
   5. Merge `claude/zoom-copy` with the flag unset.
   6. Set `test:<GUID>` for a Mode D run on one real recording, then `on`.
   - `ZOOM_VIDEO_COPY_ACCESS` is a new non-sensitive variable (runbook row on the branch).
   - The cron runs every minute once merged; with the flag off it only reconciles.
4. **Proposal Ranking** (set aside by the owner): PR #463 review/merge/promotion and the colleague Production dry run. See the ranking sections below.
5. **Institution-name capitalization:** the owner is consulting the database maintainers (side-session section below).

#### Verified Open

1. **Optional paired-summaries checks not observed in Production:** the reload during a run ("Summarizing… started …") and a draft edit before publish. Card tests cover both. Running them costs a provider call and a new published document on 1003222.
2. **Optional test from PR #470** (carried from Session 588, not rechecked this session): provider DELETE rejected, cleanup retries, slot freed.

#### Verify Before Acting

1. **Proposal Ranking Production cleanup** (cancel the old unpublished trial, restore Beth as default facilitator). Unchanged from Session 588: classifier-blocked, nothing ran. Inspect current state first.
2. **Session 588's "Next Items" below are superseded.** Stage 2 has shipped; read that section as history.

### Gotchas

- The Claude Code auto-mode classifier blocks Claude's merge-to-main pushes ("Production Deploy") and Production reads ("Production Reads"). The owner ran those from the terminal with `!`.
- `npm run check:agent-invariants` fails inside the zoom-copy worktrees because `.claude-memory` is not a symlink there. This is a worktree artifact; run that gate from the main checkout.
- The 3b real-Postgres proof needs a loopback Docker Postgres: `ZOOM_VIDEO_COPY_PG_TEST_URL=postgres://postgres:pw@127.0.0.1:<port>/postgres`, against a throwaway container. It is skipped when unset.
- Untracked `shared/templates/pre-site-visit/~$ase-ii-pre-site-visit-v6.docx` is a Word lock file. Do not commit it; delete it once Word is closed.

### Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md` (branch) | 3b plan, build rulings 1–29, release steps |
| `lib/services/meeting-tracker-recordings/video-copy-{store,service,worker}.js` (branch) | Copy store (N1–N7), start/GET/cancel, tick worker |
| `pages/api/meeting-tracker/visits/[requestId]/zoom-video-copies.js`, `pages/api/cron/drain-zoom-video-copies.js` (branch) | Route and cron |
| `tests/integration/zoom-video-copies.pg.test.js` (branch) | Loopback real-Postgres proof (18 cases) |
| `docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md` | Stage 2 plan; live and accepted |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-zoom-copy-3b
npx jest tests/unit/zoom tests/unit/post-presentation tests/unit/graph tests/unit/recording-and-transcript-card
npm run check:types && npm run check:api-routes && npm run check:request-document-writers
```

**Milestone determination:** a DEVELOPMENT_LOG entry was required for Stage 2 shipping, and it was added this session. Stage 3b is not shipped, so it needs no entry.

---

## Side session close — institution-name capitalization: APPLIED (Claude, main, 2026-10-08/09 PT)

The owner's colleagues approved fixing all 40 accounts (2026-10-09). Done; nothing open.

- **Script (`scripts/fix-institution-name-capitalization.js`, commits `0e317e5a4`, `f9088c2ea`).** It now discovers targets live instead of hardcoding 6.
  - Scans every Research Program request (9,406 rows, keyset-paged past the 5000-row cap) → 660 applicant accounts.
  - Lower-cases title-cased "Of/For/And/In/The/At/On" after the first word in `name` and `akoya_aka`.
  - Owner-reviewed exceptions: Rutgers keeps "The"; Temple keeps its legal "-Of The" (only "Of Higher" lowered); Notre Dame becomes "du Lac".
- **Applied to production 2026-10-09:** 45 fields on 39 accounts; 0 skipped, 0 failed. A re-scan finds 0 remaining; re-runs are no-ops.
- **Left as is (not discussed with maintainers):** literal `&amp;` in the HSS account and UVA `name`s; "Childrens" without apostrophe; hyphens/dashes such as "Wisconsin - Milwaukee". `name` was patched along with `akoya_aka`; whether an upstream sync rewrites `name` is unknown — if the old casing reappears, that is the cause.

## Session 588 close — Stage 2 build, 3b plan finished, Pre-Site template v8 (Claude, main, 2026-10-08/09 PT)

### What Was Completed

1. **Pre-Site Visit template v8 is live in Production** (merge `9e435586c`; deployment 6950899994 success).
   - Codex made the owner's edits on `codex/presite-template-fixes` (`9e44ad9ae` v7, `b7ec914aa` v8): the "Phase II Review" title line is removed, the page number sits beside the institution on pages 2+, there is a right-aligned `MR: Request #…` footer, and 12 pt space follows city/state.
   - The renderer points at v8 with render-contract 9; `PRE_SITE_VISIT_CONTRACT.templateVersion` is `'9'`.
   - Claude reviewed it: 149 tests pass, footer placeholders are filled (the renderer handles header and footer parts), and the docx has no tracked changes or comments. Catalog line fixed (`5266f30e7`). The worktree and local branch are removed.
2. **Paired summaries release step 0 is live** (merge `82c6cb26d`; deployment 6951088672 success). The summary publish claim matches `artifact_type`, and the publisher refuses any other kind (`summary_draft_kind_unsupported`). Codex approved it. It is the oldest permitted rollback target for Stage 2.
3. **Stage 2 backend is built on `claude/paired-summaries`** (worktree `/Users/gallivan/Code/WMKF_Apps-paired-summaries`; its `node_modules`, `.env.local` and `.agents/skills` are symlinks into the main checkout). It is pushed and NOT merged:
   - `2c411c6d6` migration 075
   - `d5d05f78d` transactional `reserveSummaryDraftRun` (advisory lock, typed conflicts), `recordEmptySummaryRun`, widened `getLatestSummaryRun`
   - `e197c0ce4` golden presentation publish identities
   - `d9a1d7620` artifact type 100000010 (config, Wave 16, staff projection) plus the owner-run picklist script
   - `905497965` discussion summary binding
   - `95bb9f8fe` discussion prompt config, paired acknowledgment, budgets, A7 inv 34, owner-run seed script
   - `914a03fc4` `SUMMARY_KINDS` service parameterization, the D4 marker and write-side privacy tests (8 mutations each fail a test)
   - `57193bdfd` route `kind`/`replaceDraft`
   - `cb398fb47` staff consumers (Meeting Tracker DTO, Workbench logistics feed, Staff Deliberations inline discussion summary)

   **Codex backend review:** one medium finding, the known gap. The current card's "Replace draft with a new summary" sends no `replaceDraft`, so it always gets 409. The card slice must fix this before any merge. Codex found no outside-surface leak.
4. **Stage 2 plan** reviewed, revised and re-reviewed (`17fd86ac2`, `9d3651b2a`, `5665b406d`). Owner decisions are recorded in the plan.
5. **Stage 3b plan** reviewed, reworked by a Claude agent (`99b923010`), fixed by Codex (`eca27698b`) and given a final Codex fix (`bfd663160`). Owner decisions: `ZOOM_VIDEO_COPY_ACCESS` kill switch; confirm before a copy replaces a staff-uploaded MP4; one migration 076. The distribution-email question is closed because email material links were retired 2026-09-10. All five probes are recorded:
   - Range supported (`30fab00c9`)
   - link lifetime: 206 through 30 min, 403 at 60 min (`8c4765d5f`)
   - Graph session idles out at 15 min; recordings carry quickXorHash only (`c13b6fe88`)
   - mvhd within the first MiB (`eca27698b`)
   - variants: a partial sample only

   The 3b build has not started.
6. **Docs reconciled:** Stage 3a recorded as merged and applied; 100000010 stage numbering fixed (`5e515c253`); Site Visit SharePoint folder names now match the code (`18dfc69c3`).
7. **Production checks V1–V3 for Stage 2 passed**, read-only:
   - V1: 100000010 and 100000011 are absent from the `wmkf_artifacttype` picklist.
   - V2: `schema_migrations` ends at 074, and the drafts CHECK is `artifact_type = 100000007`.
   - V3: no `meeting-transcript.staff-discussion-summary` prompt row exists.

### Next Items

#### Verified Open

1. **Stage 2 card slice.** File: `shared/components/meeting-tracker/RecordingAndTranscriptCard.js`.
   - Evidence: the Codex backend review and the plan (D9, test plan item 13). Summary hook and handlers are at `:1593-1823`; `SummaryBlock` is at `:2310`; the step 3 groups are at `:2669-2683`.
   - First, Codex's fix: "Summarize again" / "Replace draft" sends `replaceDraft: {draftId, expectedVersion}` of the displayed draft, and a 409 `summary_draft_exists` reloads the summary.
   - Then build:
     - a per-kind summary hook used twice; the discussion GET is `?kind=discussion`
     - one paired handler that holds `busy='summarize'` until `Promise.allSettled`
     - per-kind load keys (discussion key uses `staffDiscussionTranscript` and `staffDiscussionSummary` from the collection)
     - the paired checkbox using `PAIRED_SUMMARY_ACKNOWLEDGMENT`
     - "Not recorded" when `discussionNotRecorded`
     - a `DiscussionSummaryBlock` in the Staff discussion group
   - Keep UX and feature changes in separate commits. Then a Codex review.
2. **Stage 2 docs slice.** Atlas pages: `postgres-meeting-transcript-summary-drafts.md`, `dataverse-wmkf-requestdocument.md` (100000010 contract) and `dataverse-wmkf-ai-run-and-prompt.md`; the Atlas index row. The API matrix summary-draft rows (`kind`, `replaceDraft`, new codes). The workflow plan's Stage 2 status. Note the deviation: responses gain an additive `kind`.
3. **Optional test from PR #470:** provider DELETE rejected, cleanup retries, slot freed. Not written.

#### Owner Decision Needed

1. **Before Stage 2 can ship (all owner-run, none executed):**
   - Review the prompt wording (`shared/config/prompts/meeting-staff-discussion-summary.js` on the branch) and the paired consent text (`shared/config/transcriptSummary.js`).
   - Then run `scripts/extend-requestdocument-artifacttype-staff-discussion-summary.mjs` (dry run, then `--execute`), apply migration 075 with `node scripts/apply-migrations.js`, run `scripts/seed-meeting-staff-discussion-summary-prompt.js --dry-run`, then `--execute`, and decide the merge.
   - Release order is in the plan's "Release sequence".
2. **Stage 3b build start.** The plan is final (`docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md`); release step 0 (browser isolation) ships first.
3. **Proposal Ranking:** PR #463 review/merge/promotion and the colleague Production dry run were set aside by the owner this session.

#### Verify Before Acting

1. **Proposal Ranking Production cleanup:** cancel the old unpublished trial and restore Beth as default facilitator.
   - The owner authorized it this session, but the Claude Code auto-mode classifier blocked the delegated agent ("Modify Shared Resources"). Nothing ran.
   - Inspect current state first. The owner may do it in the admin UI or add a permission rule. See the ranking section below.
2. **Production-read probes** from this session are classifier-blocked when Claude runs them. The owner ran probe 4 manually. Its script was scratch and is not in the repo.

### Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md` | Stage 2 plan (reviewed; owner decisions; release sequence) |
| `docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md` | Stage 3b plan (state table, dispatch table, probes 1, 2, 4, 5 recorded) |
| `lib/services/post-presentation-materials/transcript-summary-service.js` (branch) | `SUMMARY_KINDS`, create/get/publish for both kinds |
| `lib/services/post-presentation-materials/summary-draft-store.js` | `reserveSummaryDraftRun` (branch), kind-scoped publish claim (main) |
| `scripts/probe-zoom-recordings.mjs` | Read-only Zoom probe: `--range`, `--lifetime`, `--moov` |
| `shared/templates/pre-site-visit/phase-ii-pre-site-visit-v8.docx` | Live Pre-Site template (render contract 9) |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-paired-summaries
npx jest tests/unit/transcript-summary-service.test.js tests/unit/summary-draft-store-reserve.test.js \
  tests/unit/meeting-tracker-transcription-routes.test.js tests/unit/post-presentation tests/unit/meeting-tracker \
  tests/unit/research-presentation-follow-up.test.js tests/unit/site-visit-logistics-service.test.js
npm run check:types && npm run check:prompt-injection-tagging && npm run check:request-document-writers
```

**Milestone determination:** no DEVELOPMENT_LOG entry. Template v8 is a formatting change and release step 0 is a small publish guard; Stage 2 and 3b are not shipped.

---

## Session 587 close — Proposal Ranking rehearsal and card refinement (2026-10-08 PT)

**Current ranking handoff. Earlier ranking sections below are historical checkpoints;
their card appearance and ordinary-trial reset limitations must not override this section.**
The other workstream handoffs below remain preserved.

[VERIFIED via Git and GitHub] Implementation remains on **codex/proposal-ranking**,
runtime tip **72efac88d**, in open draft [PR #463](https://github.com/justingallivan/wmkf-research-apps/pull/463).
The owner requested this handoff on main, not a runtime merge or promotion.

### Completed and decisions

- Simplified opening and required full participation: `0f9e3b4e4`, `0c04b4ad2`.
  Staff are not excused. The local fixture still has three fictional PDs; the owner
  reports four real staff. Do not confuse the fixture roster with live staffing.
- Kept draft actions/results together (`104590016`), separated My rankings,
  Facilitate and Meeting list (`c51e60de7`), and adopted hello-pangea drag/drop
  (`a2bebba6b`). Owner accepted dragging and called the walkthrough tested for now.
- Explicit dry-run opening and permanent trial-ranking erasure, including after
  publication: backend `e20f014ba`, UI `9dbc3daba`. A content-free receipt remains;
  no trial rankings are retained. Ordinary rounds cannot be relabeled/erased this way.
- Combined SE + MR meeting order: backend `6e1e5d187`, UI `5148af779`.
  Both nonempty programs must be published. Compare the next items' average PD
  ranks on the same scale, preserving each program's current internal meeting order;
  ties choose SE. Later combined edits are independent of program lists.
  Read the branch Atlas for the exact contract.
- Card refinements culminate in `72efac88d`: prominent rank on left; institution
  above a smaller linked proposal title; no proposal number or move buttons;
  Reviews shows individual letter grades followed by the numeric average.
  First-name PD rank badges and Average use light rank-based colors. Staff ranks
  lower left are bottom-aligned with Requested/Cumulative Budget lower right,
  without a horizontal divider. SE/MR and E/W are outlined circles upper right.
  The redundant external-review score disk is removed.
- Notable UI commits: `95d19e97a` review grades, `93886a68f` PD badges,
  `edf5f6ad5` Average badge, `14ca47aed` institution prominence,
  `085f7095a` left alignment, `112c1044a` disk removal,
  `6afe9522d` shared bottom row, `72efac88d` corner badges.
  Intermediate layout experiments are superseded by this final description.

### Verification and resume

[VERIFIED via local Jest, ESLint and in-app browser] Final UI regression: **39 tests
pass**, scoped lint and diff checks pass. Browser shows the latest cards; the preceding
bottom-row check measured equal staff/budget bottom edges. Earlier backend work ran
focused suites and relevant scoped gates/self-tests sequentially. These are local
rehearsal checks, not Production acceptance.
[VERIFIED via GitHub at stop] All reported CodeQL and Vercel checks passed for
`72efac88d`; recheck checks on any newer documentation head before release.
Claim-evidence report was unavailable because local state could not be read;
no advisory observation was invented.

Resume the existing worktree:
`/Users/gallivan/.codex/worktrees/proposal-ranking/WMKF_Apps-codex`.
Do not switch its branch or rebuild from main. Read its
`docs/atlas/dataverse-proposal-ranking.md`, the shared card in
`shared/components/proposal-ranking/ProposalRankingApp.js`, and
`tests/unit/proposal-ranking-page.test.js`.
Current rehearsal is **http://127.0.0.1:3135/**, memory-only. On another machine or
after restart, run `node scripts/rehearse-proposal-ranking.js` and use its printed
loopback URL (default 3133). No credentials or .env.local needed. Select D26.
Temporary memory and browser state do not travel through Git.

### Open items and boundaries

- **Owner decision needed:** review/merge/promotion of PR #463 and scheduling the
  colleague Production dry run. The owner wants a colleague dry run and permanent
  erasure of trial rankings; this is intent, not evidence that it ran.
- **Verify before acting, explicit owner authorization required:** live-state
  preflight, old unpublished-trial cancellation, restoring Beth as default facilitator,
  clean-round verification and role readiness for dry-run erasure. Inspect current
  state first; do not assume historical facilitator/round state is still current.
  Preserve external-review scores and source proposals. Do not publish an old
  ordinary trial expecting the new dry-run erasure path to apply.
- No Production/live Dataverse reads or writes were performed for this local UI
  work or stop. No runtime promotion is authorized by this handoff.
- Preserve privacy, test exclusions and full participation. No fake staff votes,
  source-proposal copies, API-key agent auth, Ultrareview or other metered products.
  Keep UX and feature changes in separate commits.
- Further cosmetic refinement is parked until the owner requests it. No new
  Production milestone shipped; **no DEVELOPMENT_LOG entry required**.

---


## Session 585 close — Proposal Ranking office handoff (2026-10-08)

**Historical Session 585 ranking checkpoint; superseded by Session 587 above.**
Owner asked to resume at the office. Implementation and detailed Atlas remain on
**`codex/proposal-ranking`**, not main. Do not rebuild from main. Draft
[PR #463](https://github.com/justingallivan/wmkf-research-apps/pull/463) remains
unmerged; this main handoff is documentation only, not runtime promotion.

### Completed and verified

- `8643d9645`: isolated local rehearsal using the real ranking screen/service with
  six fictional proposals and three fictional PDs, simulated submissions, role
  views, publication, meeting reordering and reset after publication. Memory only;
  no environment file, live Dataverse service or real staff votes. Reset rejects
  delayed requests from the previous rehearsal generation.
- Same commit swaps the card markers: rating dot upper right, E/W lower right.
- `cd8928bbc`: merged main documentation while preserving both workstream handoffs.
- 42 focused tests and scoped gates/self-tests passed sequentially. Browser checked
  submission, SE composite publication, meeting edits, participant privacy, full
  requested totals and reset; desktop/mobile marker checks passed. Sol findings
  fixed; one bounded subscription-OAuth Opus source review found no blockers.
- [VERIFIED via GitHub, 2026-10-08] PR #463 at `cd8928bbc` has passing Jest,
  Postgres integration, Claude review and security checks. Recheck new-head CI
  before any future promotion. The claim-evidence advisory report was unavailable
  because local state could not be read; no observation row was invented.

### Resume on the office Mac — verified open

Fetch origin and resume the existing `codex/proposal-ranking` checkout. If absent,
create a separate worktree tracking that remote branch; preserve other worktrees.
Read the branch's `SESSION_PROMPT.md` and `docs/atlas/dataverse-proposal-ranking.md`.
With repository dependencies installed, run:

```bash
node scripts/rehearse-proposal-ranking.js
```

Then open **http://127.0.0.1:3133/** on that Mac. No credentials or `.env.local` are
needed for this rehearsal. The current Mac's localhost server and temporary memory
cannot travel through Git; restarting gives a blank slate. Open a round, submit
both own lists, simulate the other PD submissions, generate/publish each program,
and reorder the meeting lists. Reset clears only rehearsal memory, even after
publication. The fixture supports D26; select D26 if a later date changes the default.

### Owner decision and live-state preflight

- **Owner decision needed:** acceptance and promotion of PR #463. This stop request
  does not merge runtime changes. No Production change was performed by rehearsal.
- **Verify before acting:** before colleagues use the live app, inspect current
  live round/configuration. Last verified default facilitator was Justin, temporarily
  replacing Beth. Cancel any unpublished trial, restore Beth and verify a fresh
  round has no trial submissions/composites/meeting edits. Preserve external-review
  scores. Existing cancellation refuses a round after either program is published;
  if that happened since the last check, stop and agree a reset plan with the owner.
- **Do not reopen:** no fake staff votes, no source-proposal copies, no weakening
  test exclusion, no agent API keys/Fable/Ultrareview.

No new Production milestone shipped in the rehearsal/stop work; no additional
DEVELOPMENT_LOG entry is required. The earlier Production activation milestone
remains recorded. Root instructions need no change for this local-only script.

---

## Historical: Owner plan for 2026-10-08 (set by the owner, Session 584; both items addressed in Session 586)

Work on two things, on the other computer:
1. **Meeting Tracker transcript workflow:** done in Session 586; see the PR #464 section at the top. (Originally: resume `codex/meeting-transcript-ux` (pushed at
   `3fa20089f`; planning only, nothing merged).) Handoff directly below. The owner meets WMKF's
   Zoom administrator the morning of 2026-10-08.
2. **Proposal Ranking:** resume the isolated rehearsal using the current office handoff
   at the top of this file and `codex/proposal-ranking` / draft PR #463. Preserve both
   workstream handoffs; do not replace this file wholesale.

Setting up the transcript worktree on a new machine:
```
git fetch origin
git worktree add ../WMKF_Apps-codex-transcript-ux -b codex/meeting-transcript-ux --track origin/codex/meeting-transcript-ux
```
Then add the per-machine pieces: `.agents/skills` symlink to `../.claude/skills`, a `.env.local`
symlink to the main checkout's, and `npm install` (revert any `package-lock.json` churn).

## Historical: Session 584 transcript UX planning handoff — October 7, 2026 (Codex)

*Superseded by the Session 586 PR #464 section at the top. The Zoom admin meeting happened, and Stages 0, 1 and 3a are merged.*

**[VERIFIED via remote Git refs]** Planning branch `codex/meeting-transcript-ux` is pushed at `3fa20089f389acfb59b000628df9831c8a1439d3`. The branch contains the implementation plan, two-slide Zoom admin brief and detailed handoff. This main handoff does not merge the branch or enable any new runtime behavior.

### Resume on the work computer

Fetch origin, then resume `origin/codex/meeting-transcript-ux` in a dedicated checkout, preserving unrelated local work. Do not rebuild from main or use `codex/meeting-transcript-fixes`. On the planning branch, read:

- [Implementation plan](https://github.com/justingallivan/wmkf-research-apps/blob/codex/meeting-transcript-ux/docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md)
- [Two-slide Zoom admin brief](https://github.com/justingallivan/wmkf-research-apps/blob/codex/meeting-transcript-ux/docs/plans/briefs/WMKF-Zoom-Admin-Brief.pptx) — download and open in PowerPoint; exact permission names and official references are in speaker notes.
- The branch's `SESSION_PROMPT.md` for the detailed handoff.

### Decisions and next steps

**Owner-approved direction:** import the full WMKF Zoom recording and available audio/captions; reconcile speakers across the full transcript; review names and confirm the split; create presentation/discussion videos and transcripts; generate both summaries with one click; review and publish. Archive presentation-only products for Board sharing. Automatically delete discussion products and full originals at the Board meeting deadline, including Zoom originals if supported.

**Next:** the owner meets WMKF's Zoom administrator on October 8, 2026 in the morning (Pacific). Seek an internal Server-to-Server OAuth app with recording read access, approved hosts, a secure app-credential handoff and one test recording. Account setup and the import pilot have not been performed. The shared-account 2FA stays enabled; the integration uses its own server-side credentials after administrator authorization.

**Owner decisions still needed:** implementation stage/file scope, schema/auth/Production steps, exact deletion cutoff, reschedules/holds, archive-incomplete handling and permanent erasure versus Zoom/SharePoint recoverable deletion. No deletion or provider execution is authorized by this handoff. Recheck live callers and owned file identities before implementing retention.

**Critical source finding:** current Board transcript/summary binding depends on the full TRANSCRIPT manifest. Source deletion must wait for a reviewed content-free archive proof and tests that the presentation remains available afterward. Preserve the PR #459 speaker fix; the owner accepted it on 1003038.

### Verification and boundaries

Planning-only commit `3fa20089f`: documentation gates and self-tests passed sequentially; both slides passed package/layout checks and visual inspection. A fresh source review added no-discussion handling and content-free AI audit requirements. The checkout-specific memory symlink was repaired; agent invariants passed. The claim-evidence advisory report could not read local state; no observation was invented.

No runtime code, credentials, database/schema, Production data or account settings changed. No new production milestone shipped, so no DEVELOPMENT_LOG entry is required. UX and feature implementation must be separate commits. Push only the feature branch for future work; owner decides merge. The main handoff is the only main change authorized by tonight's stop request.

---

## Historical Proposal Ranking handoff — superseded by the office handoff above

## Current owner-only trial — restore a clean start before colleague use

[VERIFIED via conditional Admin-service PUT and readback, 2026-10-07] Owner approved
Justin Gallivan as temporary default facilitator (`29b0de0d-4ff7-ee11-a1fd-000d3a3621c7`,
profile 2). Beth's previous default was `b6f1cd38-0973-f011-bec3-6045bd0510d4`.
Only this setting changed; no round was opened or rankings submitted by this action.

Owner explicitly requires a blank slate before colleagues start. This means trial
PD orders/submissions/composites must not carry into the real round; source external
reviewer scores remain intact. Keep the trial UNPUBLISHED: existing cancellation
refuses a round after either program is published. Before handoff, cancel any
unpublished trial round (retained read-only as history), restore Beth as default,
and open a fresh round from current source data. Verify the new round has only
initial seed orders and no submitted lists/composites/meeting edits. No reset has
been performed yet. Do not test publication in the live trial without first agreeing
a separate reset-safe rehearsal path. The app is already live with four grants;
this is not an isolated environment inaccessible to colleagues.

Next: Justin can inspect the facilitator preview without opening a round. Other
people's rankings must not be manufactured using their identities.

## Historical release checkpoint: Production deployed and enabled — 2026-10-07

[VERIFIED via GitHub, Vercel and signed-in Chrome] Owner approved release. PR #457
merged at `10c079c8652b4184404b4cb8ee8479f370a56c79`; privacy guards deployed while
disabled, then both ranking flags enabled and the same source rebuilt. Active
Production deployment: `dpl_F5ewaS8DRDhABRVyhrG5XHuSRvwf`. Justin's D26 view shows
“Round not open”; Beth must sign in to open it. No ranking rows or staff votes were
created. Full preview: 23 requests, 11 SE / 12 MR, four grants, all USD amounts present,
9 East / 14 West, all scored; 51 outstanding review assignments. Opening freezes
current scores. Full candidate CI passed (21,357 tests plus 129 PG tests); Sol and
OAuth Opus found no release blocker.

Current receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_RELEASE_2026-10-07.md`.
Next: Beth's facilitator session and separate PD sessions for the full private-list,
submission, publication, meeting-reordering and budget walkthrough. Do not silently
change facilitator or submit other people's rankings to manufacture acceptance.
For rollback keep the deployed privacy guards: disable ranking or return to the
verified disabled deployment `dpl_8CVM7KUdKhPh2bTHDKdaqVcAA14J`.
Earlier sections below are historical checkpoints superseded by this release.

## Session 583 Summary — ranking branch continuation, 2026-10-07

[VERIFIED via Git] Resumed the existing ranking worktree and merged the 23 incoming
commits through `origin/main` at `27ed1684d`, without rebasing or rebuilding the app.
Kept this branch's ranking handoff and accepted main's transcript-audit annotations.
Main's unrelated handoff remains available at `git show 27ed1684d:SESSION_PROMPT.md`.

[VERIFIED via local commands] Ranking/Explorer regression: 12 suites, 120 tests pass.
All 69 local startup check scripts/self-tests passed, with each gate and self-test
run sequentially; the missing per-worktree Claude memory symlink was repaired and
its gate rerun successfully. This includes API routes, Atlas, route lifecycle auth,
and types. The live factory-ledger check was excluded because Production reads
were not authorized for that run; the later narrow Production inventory is below. Claim-evidence report remains unavailable; no observation invented.

[VERIFIED via fresh GET-only sandbox readiness probe] All three entity identities,
fields/bounds and Active keys pass; application role assignment and isolation marker
schemas pass. The uncapped eligible ordinary Phase II Pending SE/MR scan still returns
zero proposals. No default facilitator setting exists. All four readiness switches
are off in this checkout's loaded configuration; hosted Preview settings were not
inspected. No environment settings, grants, source records or ranking rows changed.

Luna reconnoitered and Sol reviewed the merge without substantive blockers.
Review closure and retained evidence are recorded in the Atlas continuation section.
Production was unchanged; a later owner-approved read-only inventory is recorded below.
The app remains disabled. No production
milestone entry is required. Only `codex/proposal-ranking` is authorized for pushing.

### Follow-up: institution East-West metadata found

[VERIFIED via live sandbox metadata] Added and ran
`scripts/probe-proposal-ranking-geography.mjs`: request `akoya_applicantid` links to
`account`; `account.wmkf_eastwest` is the **East-West** Picklist, with
**East = 100000000**, **West = 100000001**. Only metadata GETs were performed.
No business records or Production metadata were read. The subsequent owner-approved
card change carries `institutionGeography` into new frozen snapshots and the preview
fingerprint and displays a prominent E/W at the card's upper right. Missing/unknown
values and older snapshots show no letter; there is no live refresh or backfill.
The implementation uses the same eligibility and ranking rules. Exact evidence and
remaining live-acceptance boundary are in the Atlas geography section. Geography
regression: 123 tests / 12 suites, lint, types and relevant gates/self-tests pass;
synthetic desktop/mobile component render confirms 24px E/W at upper right without
overflow. Luna built and Sol reviewed. The owner subsequently authorized Opus
reviews as needed, through subscription OAuth only (no API-key authentication).
A bounded Opus source review of `d2cc82fdf` returned APPROVE. Its nonblocking
accessibility note was corrected by giving the E/W symbol an explicitly named
image role; the page regression now checks that accessible role/name. No further
review loop was needed. No milestone entry is required.

### Follow-up: ten-color reviewer-rating circle

The owner chose ten approximate rating colors despite varying reviewer counts.
The shared card now adds a 24px solid lower-right circle: red low, yellow middle,
green high, gray unscored. It maps the frozen raw mean from 1–5 to the nearest of
ten steps; numeric score display and all ordering/calculations remain unchanged.
Matching colors do not imply exact ties. E/W remains at the upper right. No source,
configuration or live data changes are part of this UI-only addition. Validation:
126 ranking/Explorer tests, lint, types and relevant gates pass; desktop/mobile
component renders confirm all colors, gray fallback and no overflow. Luna built;
Sol and OAuth-only Opus approved. The hover label uses the same rounding as the
visible score after correcting Opus's nonblocking note. No milestone entry required.

### Follow-up: owner-approved read-only Production inventory

[VERIFIED via `scripts/probe-proposal-ranking-production-readiness.mjs`, GET-only,
2026-10-07] After the owner-approved December-only cutoff, Production has 24 matching
requests: D26 has 23 (11 SE, 12 MR), J26 has one SE. Five D26 SE requests were
excluded from the original 29-row scan. The shared trial cutoff excludes numeric
`akoya_requestnum >= 1003220` for D26 only before downstream reads/new snapshots;
malformed D26 numbers abort. Other cycles and existing frozen snapshots are unchanged.
Both readiness probes use the same rule; existing test-marker exclusion stays intact.
The scan completed without a cap or unmapped meeting dates. Request number,
meeting date and program were selected; no business rows printed.
All three ranking entity metadata lookups returned 404 (`0x80060888`). The exact
application-role query and assignment query returned 200 with no matching role.
No Production writes, provisioning, settings or activation occurred. Exit 2 denotes
missing readiness prerequisites. The Atlas records scope and limits.
Cutoff validation: 134 tests / 13 suites, types and relevant data/documentation gates
and sequential self-tests pass. Luna built; Sol and bounded OAuth-only Opus reviewed
without substantive findings. The ranking app remains disabled; the later exact-record marker correction is below.

### Owner-approved legacy test flags — 2026-10-07

[VERIFIED via exact-row PATCH and GET readback] Requests 1003220, 1003221 and
1003222 now have `wmkf_istestrequest=true`; each successful conditional PATCH sent
only that field. Their `wmkf_testcreationrunid` values remain null. The owner
explicitly authorized these Production writes. No factory provenance was invented;
the existing classifier calls marker-only legacy rows anomalies and excludes them
from ordinary flows. Ranking activation/schema/roles remain untouched.
The new one-purpose local command is
`scripts/maintain-proposal-ranking-d26-test-markers.mjs` (dry-run default). Its
separate client method fixes the three request numbers, resolves IDs/ETags internally,
retains the target interlock and generic marker guard, and reads back uncertain
outcomes without retrying. All three returned `verified-marked`, confirmed PATCH
success, no transport error, and unchanged empty run ID.
Validation: 81 tests / four client/marker suites, types and data gates pass; Luna
built, Sol and OAuth Opus reviewed, and receipt/uncertainty corrections were included.
Fresh GET-only cohort scan: 26 ordinary-filter matches, two further D26 cutoff
exclusions, D26 still 23 (11 SE / 12 MR), J26 one SE. Keep the D26 cutoff.

### Production setup completed; access and privacy verified

[VERIFIED via live apply and GET metadata/security readback] Owner-approved step 1
is complete: three ranking tables, all expected attributes and Active keys; dedicated
application role with nine ranking Create/Read/Write privileges plus nine documented
Dataverse defaults. Exactly one assignment to the verified application system user,
no team assignments. That schema step did not change app activation, grants or settings.
Receipt: `docs/audits/PROPOSAL_RANKING_PRODUCTION_SETUP_2026-10-07.md`.
The strengthened GET-only probe exits 0. Luna built verification; Sol and OAuth Opus
reviewed and substantive verification gaps were corrected. Production schema/role
setup must not be repeated as new work.

[VERIFIED via live configuration and independent readback] Beth is now the default
facilitator; Justin, John, Jean and Beth have additive Proposal Ranking grants.
Other grants are unchanged. All four effective staff identities lack ranking Read
privileges and all 12 collection reads returned 403. App controls returned 200/empty;
all three tables are excluded from the provisioned search index. Receipt:
`docs/audits/PROPOSAL_RANKING_PRODUCTION_ACCESS_PRIVACY_2026-10-07.md`.
The app stays disabled with no ranking business rows. Next: owner-directed promotion
and deployment of branch privacy guards (absent on origin/main), then approved
activation and multi-identity browser acceptance. Do not create live ranking rows
before the generic-reader guards are deployed.

Private ranking, submission, composite publication, meeting reordering and full-requested
budget totals still need a source-backed, multi-identity in-app walkthrough. Counts
alone do not verify review completeness or full snapshot eligibility. Do not relax
test exclusion or treat D99's retained synthetic snapshot as eligible proposals.
The Session 582 history below remains the implementation and prior live-proof record.

## Session 582 Summary — 2026-10-07 (Codex)

Owner-approved Proposal Ranking was built on `codex/proposal-ranking` in the
isolated worktree. Luna performed reconnaissance/build work, Sol reviewed its
slices, and the orchestrator integrated and corrected the implementation. Claude
Opus reviewed through subscription OAuth only: R1 requested four concrete fixes;
R2 approved with a nonblocking validation-message note, which was corrected.
No Fable was used. Subsequent sandbox provisioning and live-field corrections are
recorded in `docs/audits/PROPOSAL_RANKING_SANDBOX_SETUP_2026-10-07.md`.
The app remains disabled; production is unchanged.

### Completed source

- Separate `/proposal-ranking` app with private SE/MR PD orders, external-review
  seed, explicit locked submissions, equal-average composites, named ranks and
  disagreement, facilitator publication, shared meeting edits and full-requested
  cumulative budgets.
- Frozen eligible ordinary Phase II Pending pool and roster, ETag changesets,
  operation receipts, filtered private responses, uncertainty recovery and scope
  guards. Exceptional excusal, unpublished cancellation and facilitator transfer.
- Three Wave 32 Dataverse table definitions, dedicated application role, exact-on
  readiness, Admin default-facilitator picker, generic-reader metadata privacy.
- Atlas, API matrix, service catalog, app/route registration, canonical counts,
  reviewed design/API contract, and full Opus source-review receipt.

### Latest session commits

- `458d7248f`: merged main into the isolated feature branch.
- `8d8b10872`: sandbox schema/role evidence and live source-field corrections.
- `8be9f57a1`: ETag normalization fix and successful bounded persistence rehearsal.
- `3f5c6cf10`: reproducible GET-only staff privacy proof and documentation.
- Session-close documentation follows these commits; all work stays on
  `codex/proposal-ranking`, draft PR https://github.com/justingallivan/wmkf-research-apps/pull/457.

### Earlier implementation commits

- `042ec90b0`: reviewed product/design contract.
- `5279c92cc`: owner-approved transcript-doc gate annotations.
- `35052a7c0`: deterministic ranking calculations.
- `f1b812d86`: frozen source preview and persistence schema.
- `27c942c10`: ranking and meeting interface.
- `1d2a721cb`: direct/indirect generic-reader privacy.
- `a1f4e0f4e`: authorized lifecycle, recovery, Admin and reviewed corrections.
- Final receipt/message-tag and handoff documentation follow these commits.

## Historical Session 582 next items — superseded by Production follow-ups above

Source evidence and exact steps: `docs/atlas/dataverse-proposal-ranking.md`.
Sandbox schema/role provisioning is complete and readback passed: three tables,
expected fields/bounds, three Active alternate keys and app-only role assignment.
The complete eligible-source scan returned zero proposals. The owner chose a minimal
rehearsal restricted to the new ranking tables. D99 now retains two synthetic cards
in its snapshot only; no source proposals were created or changed. Initialization,
conditional save, stale ETag rollback and duplicate-key rollback passed. Search
status confirms the three entities absent from the sandbox search index. The follow-up
GET-only probe verified effective staff identity via EqualUserId and denied all
three exact fixture reads with 403 under both impersonation headers, with app-200
controls and absent effective Read privileges. WhoAmI returned the app identity
even under effective impersonation; do not use it as that identity assertion.
Bounded proof: `docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`.
Actual Beth Pruitt identity selection and app grants, readiness configuration and
multi-identity browser rehearsal remain unperformed. Do not recreate the D99 fixture.
Evidence and retained IDs: `docs/audits/PROPOSAL_RANKING_PERSISTENCE_REHEARSAL_2026-10-07.md`.
Luna corrected the processed ETag adapter contract; Sol and bounded OAuth Opus
approved. No new production milestone entry is required.
No production read, write, deployment or activation is authorized by this handoff.
### Next session: in-app walkthrough

[VERIFIED OPEN via Atlas and rehearsal receipts] Configure the verified facilitator
identity and participant app access in the approved environment, then walk through
private ranking, submit, composite generation/publication, meeting reordering and
budget totals. The sandbox has zero eligible ordinary source proposals; resolve
that acceptance-data limitation before claiming an end-to-end live meeting. Do not
silently create or copy source proposals, relax test exclusion, or reuse the D99
storage fixture as a valid source-backed round.

### Owner decision needed

Deliberate production promotion/activation remains pending after acceptance evidence
and current-head CI review. No production action is inferred from this handoff.

### Do not reopen without a new decision

No realtime infrastructure, ranking notes, combined SE/MR list, funding writeback,
or changes to existing proposal fields. Continue Luna build/recon → Sol review →
orchestrator final review → bounded Opus OAuth review when further builds are needed;
no Fable or API-key agent sessions. Avoid review churn over minor improvements.

### Key files

- `docs/atlas/dataverse-proposal-ranking.md`: current activation checklist.
- `docs/audits/PROPOSAL_RANKING_STAFF_PRIVACY_2026-10-07.md`: bounded privacy evidence.
- `scripts/probe-proposal-ranking-staff-privacy.js`: repeatable GET-only proof.
- `scripts/probe-proposal-ranking-persistence.js`: retained D99 storage rehearsal;
  do not repeat its write mode.

Local `/private/tmp` receipts are not portable between Macs. Retained record IDs
and sanitized results are checked into the audit receipts; if re-running a probe
on another machine, reconstruct only its required receipt input from that evidence,
then verify the target and rows by GET. Never copy credentials between machines.


## Testing and review evidence

`docs/audits/PROPOSAL_RANKING_OPUS_IMPLEMENTATION_REVIEW_2026-10-07.md` records the
review text, accepted corrections, local build/tests and bounded evidence limits.
Canonical production build passed after the source corrections. The two live-source corrections passed 110 tests
in 10 suites plus lint/type/data gates and Sol/Opus review. The earlier full GitHub Jest run had an unrelated transcript-card failure. The later
run at `8d8b10872` passed (run `37698207467`); no transcript runtime changes were made
here. The ETag correction and rehearsal pass 116 tests in 12 suites, plus lint and
the DAL gate/self-test. Full GitHub Jest also passed at `8be9f57a1`.
The follow-up GET-only privacy probe passed live, with 9 focused safeguard tests
and relevant documentation gates/self-tests passing. New commit CI is separate.
Feature/Explorer integration regression command:

```bash
./node_modules/.bin/jest --runInBand tests/unit/proposal-ranking-*.test.js tests/integration/dynamics-explorer-tool-serialization.test.js
```

The task worktree has its own local dependency copy because Turbopack rejects a
node_modules symlink outside its root. No package/lockfile changes were made.
The original checkout and its unrelated dirty lockfile were left alone.
Claim-evidence pilot report was unavailable (local observation state unreadable);
no invented observation row was added. No production milestone entry was required.

## Other workstreams

Prior transcript/summary UX and Final Writeup handoff context is preserved at
`git show fc56ca483:SESSION_PROMPT.md`. Those items were not reverified or advanced
by this ranking build; read current owner/source evidence before resuming them.
Do not carry forward destructive cleanup instructions without fresh verification.

[VERIFIED via signed-in Chrome after the facilitator change] Justin now sees the
D26 facilitator preview: 23 proposals, four PDs, 51 outstanding reviews, zero
unscored. The Open round acknowledgement remains unchecked; no round was opened.
The institution-name display defect is corrected in source: use linked account.name,
not the sparse request wmkf_organizationname field. Live metadata and all23account
names were verified. Release/browser confirmation is recorded in the Atlas below.
---

## Session 584 Summary (Claude, main) — 2026-10-07/08 PT

### What Was Completed
1. **Zoom speaker-identity fix released:** PR #459 (merge `f48fba1ab`); owner accepted it on 1003038.
2. **Staff Deliberations copy:** PR #460 (merge `ea1e09a0d`): the briefing next step names the upcoming
   deliberation session date; the two writeup warnings drop "the Dataverse fill".
3. **Stage 5 leadership daily digest live:** PR #461 (merge `ddeb1b401`); migration 073 applied and copy
   seeded by the owner. Research only. Codex review: round 1 two high findings fixed (`c16c30092`), round 2
   approve. DEVELOPMENT_LOG entry added.
4. **J27 auto-prepare:** owner set Production `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26","J27"]`
   and redeployed; status list unchanged (register J27-084). Connor's Grant Cycle table note recorded in
   the cycle rollover plan §2a (to-do, not top priority).
5. **Repo hygiene:** 113 merged branches deleted from origin; performance-planning docs landed
   (`fd3366f5e`); test-date queue item closed with no clock dependence (`ef11d8e11`); the drain-table gate
   false positive fixed (`9f6001cb1`); the main handoff dropped by the PR #457 merge restored (`c7e6417f8`).
6. **Deliberations vocabulary options sheet** filed (`docs/plans/DELIBERATIONS_VOCABULARY_OPTIONS_2026-10-08.md`).

### Verified Open
1. **First leadership digest:** after the first Research writeup is sent to leadership, the next night's
   `final_writeup_leadership_digests` rows should have `accepted_at`. Evidence: plan Stage 5 rollout.
2. **First handoff email:** after the next Research "Ready for group review", its
   `final_writeup_handoff_emails` row should be `sent` from the lead PD. Evidence: plan Stage 4.
3. **Dependabot PR #447** (dependency bumps from 2026-10-06): CI check, then owner "merge". Evidence: work queue.
4. **Stream transcription audio** instead of buffering (200 MiB cap is memory-bound); decide alongside the
   Zoom import work. Evidence: work queue "Stream transcription audio".
5. **Stale local worktrees** (~20 on this Mac, including 8 on merged branches). `../WMKF_Apps-codex`
   (`codex/transcription-pilot`) holds `e899518a5`, whose docs landed on main in `fd3366f5e`. Leave
   `../WMKF_Apps-codex-proposal-ranking` and `../WMKF_Apps-codex-transcript-ux` alone while Codex uses them.
   Check each for unpushed work before removing. Evidence: `git worktree list`.

### Owner Decision Needed
1. Cycle rollover design (plan §9): a to-do, not top priority; anchor on the planned `wmkf_grantcycle` table.
2. Deliberations vocabulary: resurface November 1, 2026 (reminder below).

### Do Not Reopen Without New Decision
1. Leadership digest: Research only, system mailbox sender, copy in settings (owner, 2026-10-07).
2. SoCal does not use the app suite yet; keep it out of the handoff email and digest (owner, 2026-10-07).

### Process notes
- A local Production Dataverse write (e.g. `scripts/seed-email-defaults.mjs --execute`) needs
  `DATAVERSE_PROD_WRITE_ACK="<purpose> <today UTC>"`.
- Vercel Production env changes and `vercel redeploy` are blocked for Claude by the permission
  classifier; the owner runs them with `!`.
- When merging a feature branch that carries its own `SESSION_PROMPT.md`, keep main's handoff
  (the PR #457 merge replaced it).

---

## Owner reminder (set 2026-10-07, Session 584)

**November 1, 2026:** remind the owner to pick up the deliberations vocabulary options sheet,
`docs/plans/DELIBERATIONS_VOCABULARY_OPTIONS_2026-10-08.md`, before the after-D26 group decision.

---

# Restored main handoff (Session 584, Claude)

The PR #457 merge (`10c079c86`) replaced this file with the ranking branch's copy, dropping
the main-session handoff below. It is restored verbatim here; the ranking handoff above is current
for Proposal Ranking, and its older ranking sections below are superseded by it.

## Session 585 Prompt: resume Meeting Tracker recording workflow planning after Zoom admin meeting

(The Codex transcript UX planning handoff that stood here was moved to the top of this file on 2026-10-08.)

## Prior handoffs preserved below

The prior S584 notes retain unrelated Proposal Ranking and Final Writeup work. Earlier transcript acceptance TODOs below are historical; the owner acceptance recorded above supersedes them. Historical cleanup suggestions are not authorization to delete anything.

## Session 584 Prompt: transcript speaker fix released (PR #459), owner-accepted; UX follow-up with Codex; preserve Proposal Ranking handoff; group-review handoff email live (S581)

## Session 583 transcript handoff — 2026-10-07 PT (Codex)

**Update, Session 584 (Claude):** the owner said "merge", and the fix went out as
[PR #459](https://github.com/justingallivan/wmkf-research-apps/pull/459), merge
`f48fba1ab`. All CI passed after main was merged in. [VERIFIED via GitHub deployments +
`vercel inspect`] The Production deployment `wmkfresearchapps-bmhqc863s` was built from
`f48fba1ab` and serves the production domains. Steps 1–2 below are done. **Step 3: the owner
reported after regenerating that the fix "looks like it worked"** (owner report; Claude did
not read the job itself). Remaining transcript-page UI/UX issues and a new feature request
were handed to Codex on worktree `../WMKF_Apps-codex-transcript-ux`, branch
`codex/meeting-transcript-ux` (not merged).

Original S583 status: built and pushed on `codex/meeting-transcript-fixes`, tip `5ee323aaa`.
The existing Proposal Ranking handoff is preserved below.

### Completed on the feature branch

- `c7067f3df`: full-recording Zoom timing/wording reconciliation for reused audio speaker IDs.
- `5ee323aaa`: preserve valid global names and prior short-reply corrections; prune metadata
  for vanished IDs; retain recovery of unnamed IDs, including 3:1 evidence with a singleton.
- Names and per-turn corrections persist together in the existing bounded alignment JSON.
  The central content read applies them to preview, manual naming, download and publication.
  No schema migration or saved-job repair was performed.
- Claude Opus reviewed through subscription OAuth. Its three findings were fixed. The follow-up
  accepted those fixes and identified an unnamed-ID recovery regression; that and the singleton
  edge case were then fixed and independently reviewed with no remaining actionable findings.
- Verification: 30 suites / 725 tests passed before the last singleton regression; final focused
  rerun passed 69 tests including that new case. Types, scoped lint and documentation currency
  checks passed. This is mocked/local verification, not hosted end-to-end acceptance.
- Offline VTT replay retained four Allison corrections with zero existing names removed.
  It reconstructs IDs from display names, so it does NOT prove raw-provider generation behavior.

### Verified open and next-session sequence

1. ~~Done S584.~~ Fetch and resume `codex/meeting-transcript-fixes`; do not rebuild from main. Read the branch's
   generation-fix section in `docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md` and its tests.
2. ~~Done S584 (PR #459).~~ Review current-head integration/CI and arrange a deliberate release. **Owner decision needed:**
   runtime merge/promotion; stopping and pushing this handoff did not authorize that release.
3. After confirming the deployed revision includes the fix, regenerate and inspect request
   **1003038**, especially **01:02:04** and **01:02:12**, against Zoom's Allison captions.
   Verify the actual raw-provider output, saved alignment and displayed/downloaded transcript;
   do not substitute the offline VTT probe for acceptance of the real generation path.

**[VERIFIED via signed-in UI and fetched main source]** The owner tested production and still
saw evaan / jingli at those times. New draft job: `ac090b3e-dd49-4719-b3db-c81718865f46`,
ready Oct 7 at 4:23 PM. At inspection, main `afb99fee3` still returned the old verdict without
`reconcileZoomSpeakerTurns`; this run therefore did not test the branch fix. Do not describe
that production result as a failure of deployed new code. Conversely, the branch is not yet
proven by a real hosted generation run. Original earlier job: `adba2697-5c75-4847-bae4-c544ef7a3ca3`.

### Resume references and limits

- Branch source: `lib/services/transcription-pilot/zoom-vtt.js`,
  `lib/services/meeting-tracker-transcription/alignment-service.js`,
  `lib/services/transcription-pilot/runtime.js`, and `transcript-format.js` in that directory.
- Branch regressions: `tests/unit/transcription-zoom-speaker-turns.test.js` and alignment-service tests.
- Branch-only reproducible local probe: `scripts/probe-transcript-speaker-turns.mjs` (two local VTTs).
  Downloads and temporary review reports do not travel between machines; obtain authorized inputs
  afresh if needed. Transcript wording was not committed.
- Feature worktree retained; unrelated worktrees untouched. No new production milestone shipped,
  so no DEVELOPMENT_LOG entry is required. The current-session claim-evidence report was unavailable
  because its local state could not be read; no observation row was invented.

---

## Previous Session 583 Prompt: resume Proposal Ranking from its feature branch

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

## Session 581 handoff (Claude, main) — 2026-10-07 PT

Final Writeup group-review handoff: **Stages 1–4 are live in Production.** Plan:
`docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`.

### What Was Completed

1. **Stage 3, lead-PD sign-off view: live** (PR #454, merge `b2bc23b95`; docs `1c06e0a52`).
   "Sign off" replaces "Mark reviewed"; the lead PD and superusers see which expected PDs have
   signed; Send to leadership names those who haven't.
2. **Stage 4, handoff email: live for Research** (PR #456, merge `8bc5b466b`; docs `3b582c9af`).
   - Ledger `final_writeup_handoff_emails` (migration 072). [VERIFIED via Production read
     2026-10-07] 19 columns, 4 indexes, 5 checks; 0 rows at session end.
   - Copy seeded by the owner (`email.final_writeup_handoff.subject`/`.body`; the same run also
     seeded the unseeded `email.deliberation_share.review_bundle_link_text` with its default).
   - [VERIFIED via `vercel env pull`] Production `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` =
     `["c247b11a-a7cb-ee11-9078-000d3a341e8f"]` (Research Grant Program, the same field as the
     auto-prepare list). Not the `RESEARCH_PROGRAM_IDS` Program GUIDs, which are a different field.
   - Owner rules: always deliver (rebuild, retry cron, alerts); internal staff only (exact
     `@wmkeck.org`); Kevin Moses removed from staffing by the owner; Beth Pruitt is PD and CSO by design.
3. **Lead-PD sender: live** (PR #458, merge `b14651597`; docs `81d87ddd9`). Owner: PD-to-PD mail
   comes from the lead PD, not the system. Impersonation with `noFallback`; a lead who can't send
   keeps the email pending and alerts ops. Owner verified that every PD can send from Dynamics.
4. **Stage 5 decision recorded:** the leadership digest is sent by the system mailbox.
5. **Fixes on main:** transcription pilot test fixture expiry (`b8a113513`); a race in
   `recording-and-transcript-card.test.js` that failed 2 of 3 main CI runs (`4a9817828`).
6. **Codex transcript/summary UX audit:** started in the `codex/transcript-summary-ux-audit`
   worktree; it shipped as PR #455 (`132eac566`). Follow-up is the Session 583 handoff above.
7. **SoCal parked** by the owner: `.claude-memory/project-socal-writeup-workflow-parked.md`.
8. Local `.env.local` Postgres lines refreshed from Vercel after the 2026-10-01 password rotation
   (backup in the S581 scratchpad, not tracked).

### Commits (main, first parent)
`b8a113513`, `b2bc23b95`, `1c06e0a52`, `fc56ca483`, `8bc5b466b`, `3b582c9af`, `4a9817828`,
`b14651597`, `81d87ddd9`; this handoff commit follows. Milestone entry added to DEVELOPMENT_LOG.md.

### Verified Open

1. **Confirm the first real handoff email.** After the next Research "Ready for group review",
   read its `final_writeup_handoff_emails` row: `state = sent`, `to_recipients` all
   `@wmkeck.org`, and the Dynamics activity's sender is the lead PD.
2. **Stage 5, leadership daily digest: LIVE S584** (PR #461, merge `ddeb1b401`; migration 073
   applied and copy seeded by the owner). Research only via `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS`.
   Remaining: after the first writeup is sent to leadership, confirm the next night's
   `final_writeup_leadership_digests` rows have `accepted_at`. Seeding needed
   `DATAVERSE_PROD_WRITE_ACK="<purpose> <today UTC>"` (plan Stage 5 rollout).
3. ~~**Other Mac:** refresh `.env.local` Postgres lines after the 2026-10-01 rotation.~~ **Done** (owner, 2026-10-07).

### Verify Before Acting

1. ~~**1003010 first scheduled preparation**~~ **Closed S584.** The owner ran the receipts
   report: all 14 D26 rows `prepared`, no errors; every scheduled row was last updated by one
   01:30 UTC (18:30 PDT) sweep. The owner saw 1003010's draft before 17:00 PDT (owner report).
   (Original note: expected ~15:45 PDT 2026-10-07; not checked in S581.) Owner-run:
   `DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/report-staff-deliberations-preparation-receipts.mjs --cycle=D26`
2. **S580 deferred small items: live S584** via PR #460 (merge `ea1e09a0d`;
   owner-approved wording). The list's briefing next step names the upcoming
   deliberation session date; the two writeup warnings drop "the Dataverse fill".
3. **J27: done S584.** The owner set Production `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26","J27"]`
   and redeployed; the status list needs no change (register J27-084). Connor's Grant Cycle table note
   is recorded in the cycle rollover plan §2a; the rollover design is a to-do, not top priority.
4. Older S577 items: last state in `git show e6666ae68:SESSION_PROMPT.md`.

### Owner Decision Needed

1. Cycle rollover (`docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` §9).
2. Deliberations vocabulary after D26 (`docs/NOMENCLATURE_GLOSSARY.md`).

### Parked

1. SoCal Final Writeup workflow: wait for the owner to raise it.
2. ~~Merged branches still on origin~~ **Done S584:** 113 branches whose tips were already in main were
   deleted from origin (owner-approved). Kept: 8 merged branches checked out in local worktrees, and
   all 67 unmerged branches. Stale local worktrees are a separate cleanup.

### Do Not Reopen Without New Decision

1. Handoff email: Research only via the program list; PD-to-PD mail from the lead PD with no
   system fallback; internal `@wmkeck.org` staff only; always delivered (owner 2026-10-07).
2. Leadership digest is system-sent (owner 2026-10-07).
3. S580 decisions: sign-off not required; counts after edits; no pull-back; app-level hiding;
   digest at midnight Pacific.

### Process notes

- The owner says "merge" to authorize a PR merge; `gh pr merge` worked this session.
  `vercel redeploy` was blocked by the auto-mode classifier; the owner ran it with `!`.
- Codex adversarial reviews: Claude may launch them
  (`.claude-memory/feedback-codex-delegation-review-vs-rescue-routing.md`).

### Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/final-writeup/handoff-email-service.js` | Stage 4 staging, delivery, recovery, lead-PD sender |
| `lib/services/final-writeup/handoff-email-store.js` | Ledger SQL (lease-fenced) |
| `pages/api/cron/final-writeup-handoff-emails.js` | 15-minute retry |
| `lib/services/final-writeup/acknowledgement-service.js` | Sign-off records and the Stage 3 roster |
| `shared/components/workbench/FinalWriteupTab.js` | Sign off, Send to leadership, handoff copy |

### Testing

```bash
npx jest tests/unit/final-writeup tests/unit/workbench-final-writeup-route.test.js tests/unit/staff-deliberations-tab.test.js tests/unit/test-request-email-sender-census.test.js
```

(Session 580 and earlier main handoffs: `git show 444a2d8f0:SESSION_PROMPT.md`.)
