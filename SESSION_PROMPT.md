# Session 585 Prompt: resume Meeting Tracker recording workflow planning after Zoom admin meeting

## Session 584 transcript UX planning handoff — October 7, 2026 (Codex)

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

## Prior handoffs preserved below

The prior S584 notes retain unrelated Proposal Ranking and Final Writeup work. Earlier transcript acceptance TODOs below are historical; the owner acceptance recorded above supersedes them. Historical cleanup suggestions are not authorization to delete anything.

# Session 584 Prompt: transcript speaker fix released (PR #459), owner-accepted; UX follow-up with Codex; preserve Proposal Ranking handoff; group-review handoff email live (S581)

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
3. **Other Mac:** its `.env.local` Postgres lines likely still hold the pre-rotation password. Fix:
   `vercel env pull` to a temporary file and copy only the `POSTGRES_*`/`DATABASE_URL*` lines.

### Verify Before Acting

1. ~~**1003010 first scheduled preparation**~~ **Closed S584.** The owner ran the receipts
   report: all 14 D26 rows `prepared`, no errors; every scheduled row was last updated by one
   01:30 UTC (18:30 PDT) sweep. The owner saw 1003010's draft before 17:00 PDT (owner report).
   (Original note: expected ~15:45 PDT 2026-10-07; not checked in S581.) Owner-run:
   `DATAVERSE_ALLOW_PROD_READS=yes node --import ./scripts/lib/use-extensionless.mjs scripts/report-staff-deliberations-preparation-receipts.mjs --cycle=D26`
2. **S580 deferred small items: live S584** via PR #460 (merge `ea1e09a0d`;
   owner-approved wording). The list's briefing next step names the upcoming
   deliberation session date; the two writeup warnings drop "the Dataverse fill".
3. **J27:** add `J27` to `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` before J27 research
   presentations unless the cycle-rollover work replaces it.
4. Older S577 items: last state in `git show e6666ae68:SESSION_PROMPT.md`.

### Owner Decision Needed

1. Cycle rollover (`docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md` §9).
2. Deliberations vocabulary after D26 (`docs/NOMENCLATURE_GLOSSARY.md`).

### Parked

1. SoCal Final Writeup workflow: wait for the owner to raise it.
2. Merged branches still on origin: `feature/writeup-handoff-email`,
   `feature/handoff-email-from-lead-pd`, `feature/writeup-signoff-view`, plus the S580 list
   (`git show 444a2d8f0:SESSION_PROMPT.md`). Delete when convenient after confirming each is merged.

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
