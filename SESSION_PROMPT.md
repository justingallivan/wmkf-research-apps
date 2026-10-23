# Release in progress — memory cleanup and reviewer safeguards, 2026-10-23

The owner explicitly authorized pushing and deploying the completed changes. Release
candidate `405d17bb8` is being merged with current main so the separately released
personal-email-defaults work below is preserved. No further broad audits or optional
testing requested. Local confirmation wording and PD name/email link checks passed
(29 focused tests and scoped lint). Prior release evidence is recorded in
`docs/audits/release-candidate-checklist-2026-10-22.md`; its open-item wording predates
the owner's release decision. Unrelated untracked critique and `output/` stay untouched.

Pre-release production rollback reference (observed Ready immediately before this
merge): `dpl_ET59rCfoBxuSjBK6KScCmArPehg6`,
`wmkfresearchapps-fhwelay0k-justin-gallivans-projects.vercel.app`.
Deployment completion is not yet claimed by this note.

---

# Session 634 Prompt: Owner signed-in check of release wording; hand stale queue entries to Codex

## Session 633 Summary — Personal default wording for reviewer release courtesy emails (Claude, 2026-10-22 PT)

Worked in worktree `/Users/gallivan/Code/WMKF_Apps-claude-2026-10-22` because Codex was active in the main checkout (`codex/memory-audit-followups`, docs work). That checkout and its uncommitted files were not touched.

### What Was Completed

1. **Slice 3 of personal email defaults shipped.** [VERIFIED via GitHub merge and Vercel commit status] PR #517 merged as `00a706afb`; Vercel reported the production deployment complete. PDs can save their own wording for the pending-withdrawal and accepted-release courtesy emails from a "Your default wording" section in each dialog. Previews start from the sending PD's saved wording; absent → Admin copy; unreadable/damaged → Admin copy with a notice. Send paths unchanged (staff-reviewed overrides only).
2. **Authorization tightened (owner decision).** [VERIFIED via source and route tests] `render-withdraw-emails` and `withdraw-sufficient` now require the lead PD for every target or a superuser (`authorizeReviewerRequestMutation`), matching `terminal-transition` and the UI's existing `canManage` gate.
3. **Reviews.** [VERIFIED via review output] Codex adversarial plan review (note-baseline finding folded in), build review round 1 (stale callback during slow save, fixed in `cece8610c`), round 2 approve. CI 13/13 green on the merged head.
4. **Owner rehearsal passed.** [OWNER-CONFIRMED] Synthetic click-through `npm run rehearse:reviewer-release` (127.0.0.1:3134; real dialogs, in-memory API). No Dataverse or email was touched.
5. **Queue drift found (not fixed — Codex owns docs).** [VERIFIED via Git ancestry and Production env listing] `docs/CURRENT_WORK_QUEUE.md` still lists as open: Zoom speaker picker (merged PR #511 `bb7b5e04c`), card busy after publish (merged `4d23ff779`), PD on reviewer follow-up cards (merged PR #200), Site Visit applicant materials (built in the Site Visit redesign), and video cut step 1 (`PRESENTATION_VIDEO_SANDBOX_VCPUS` exists in Production since ~10-10; value not read).

### Commits (all via PR #517, merge `00a706afb`)

- `9bf2159ae`, `92acac96a` — plan and Codex plan-review update.
- `821d374cf` — build.
- `cece8610c` — lock dialogs while default wording saves (Codex build review).
- `87fb00c81` — synthetic staff rehearsal + validator parity test.
- This handoff and the DEVELOPMENT_LOG entry follow on `claude/session-633-handoff`.

## Next Items

### Verified Open

1. **Owner signed-in production check of release wording.** Evidence: PR #517 test plan; not observed in-session. Open a release dialog on a request you lead, open "Your default wording", optionally save then Clear. Do not release a real reviewer as a test. Rollback reference: promote `wmkfresearchapps-cll2citny-justin-gallivans-projects.vercel.app` (last-known-good before the merge) or revert `00a706afb`; owner is the assumed rollback operator.
2. **Hand docs updates to Codex.** Evidence: item 5 above; `docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md` slice table still shows slice 3 "Not started". Mark slice 3 shipped (PR #517) and correct the five stale queue entries.
3. **Next personal-email slice: 2, reviewer due-date extension notice** (owner order 4 → 1 → 3 → **2** → 6 → 7 → 5). Evidence: inventory doc slice list. Not started; it is plan-first (adds a pre-send copy review where none exists today).

### Optional

1. Extra race tests Codex suggested (round 2, non-blocking): deferred Clear, failed save, close during refresh, unmount/re-entry of `ReleaseWordingDefault`.
2. Video cut speed-up: step 2 (lower `PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS`) waits on a measured 4-vCPU run; step 3 (packet timestamps instead of frame decode) changes the privacy recipe and needs full Codex review. Evidence: `docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md`.

### Verify Before Acting

1. **Reviewer cron-reminders ledger branch** (`feature/reviewer-cron-reminders-ledger`, last commit 2026-08-27) is ~4,260 commits behind main; "merge after the cycle" now means a rebuild. Evidence: `git rev-list --count`.
2. **Live Admin wording for `email.reviewer_withdraw.*` / `email.reviewer_release.*` was never read in-session.** The rehearsal used synthetic stand-ins.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/PERSONAL_EMAIL_REVIEWER_RELEASE_COURTESIES_PLAN_2026-10-22.md` | Plan, owner decisions, Codex findings, evidence |
| `lib/services/reviewer-release-personalization.js` | Validation, sender-PD resolution with fallback, own save/clear |
| `pages/api/review-manager/release-email-preferences.js` | Own-profile GET/PUT/DELETE route |
| `shared/components/reviewers/ReleaseWordingDefault.js` | "Your default wording" section used by both dialogs |
| `scripts/rehearse-reviewer-release.js` | Synthetic staff rehearsal (`npm run rehearse:reviewer-release`) |

## Testing

```bash
npx jest reviewer-release release-email release-wording withdraw-sufficient terminal-transition-service user-preferences-reserved-keys
npm run rehearse:reviewer-release   # http://127.0.0.1:3134, no live calls
```

Milestone determination: production capability shipped → DEVELOPMENT_LOG entry added ("Personal default wording for reviewer release courtesy emails (Session 633)"). CLAUDE.md unchanged. Claim-evidence report: no eligible plan/design documentation edit recorded; no observation row added. Startup gates: all green except `check:agent-wiki` (reviewer-origination page passed its 60-day staleness window on 2026-10-22); owner left it to Codex.

---

# Concurrent workstreams — index (not re-verified this session)

Full prior handoffs: `git show 00a706afb:SESSION_PROMPT.md` (Sessions 626–633 stacked snapshots). Each line is the owning session's last recorded boundary.

- **Meeting coordination designs** (Codex, S632, kept in full below): parked; runtime build not authorized.
- **Overlapping cycles / J27 calendar** (Codex, S631): plan proposed, not implemented. Owner decisions pending: calendar-authority role, backup/escalation and date-change approval; Connor: external calendar contract. `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`, `docs/audits/cycle-foundations-2026-10-21.md`.
- **Shared roles Program Coordinator / Systems Specialist** (Claude, S630, PR #516): live; no runtime consumers yet — read via the config contract, never hardcode names.
- **Workflow selection for further performance work** (S629/S630): owner decision pending. Grant Reporting and Literature Analyzer parked; Expense Reporter: leave as is.
- **Stage B Research co-PI backfill** (Claude, S628): awaiting Duncan's workbook; then owner-run read-only resolve re-run, then build apply/verify/rollback. Owner decisions: approve the five groups, email policy for new contacts, locate Stage A apply log, Connor's 2024-on split. Do not record replaced award-time PIs.
- **Reviewer panel coverage pilot** (Codex, S626): parked by owner; do not run or expand.

---

# Session 633 Prompt (preserved): Resume Meeting coordination edge-case review when requested

## Session 632 Summary — Meeting coordination layouts and Admin startup incident (Codex, 2026-10-21 PT)

### What Was Completed

1. **Meeting coordination previews saved.** [VERIFIED via design commits and local browser checks] Setup now includes existing agenda controls; use existing `@hello-pangea/dnd` in the future build, not as a required mockup demonstration. Selected staff/Board/consultants carry from setup to Invitations for both meeting types; invitation materials labels distinguish discussion-session and research-presentation packets. Materials collection is owner-approved and belongs to the Admin-assigned Program Coordinator (Duncan currently, per owner).
2. **Transcript review and simplified materials flow.** [VERIFIED via owner decisions and standalone HTML] Collapsed Import manually below Zoom; provider/non-sensitive/credit acknowledgement removed from mockup. Video playback with current-time boundary action and audio fallback uses local synthetic silent media. Save and prepare materials leads to Presentation and Staff discussion/Internal only, editable summaries, separate presentation Save draft, per-item processing/failure examples and simulated Board approval. Keep review checkboxes for now. [PLANNED] Runtime orchestration and coordinated checkbox dependency removal are documented, not implemented.
3. **Admin loading incident fixed and released.** [VERIFIED via PR #514 and fresh authenticated browser acceptance] Next 16.4.2 exposed a static startup/CSP nonce mismatch. `_app.getInitialProps` delegates to NextApp so startup renders with the request nonce. User approved merge/deploy after checks; merge `6d6fefdd2`, Production deployment `7242027781` succeeded, and fresh Admin/Staffing populated. CSP/auth protections were preserved. Details and regression coverage: `docs/plans/ADMIN_CSP_STARTUP_FIX_2026-10-21.md`.
4. **Main handoff requested.** [OWNER-CONFIRMED] Land this handoff and saved designs on main. Concurrent cycle-planning/role/refactoring handoffs below are preserved as owning-session context, not a new actionable worklist.

### Commits

- `a8f8bd49f`, `0ab61fc58` — agenda controls and drag-package decision.
- `f0035df6d`, `2e09dfc60` — attendee continuity and distinct invitation packets.
- `8bc29ef84`, `cee25cedd` — manual import preview and coordinated acknowledgement-removal requirement.
- `c685bedac` — video/audio review playback.
- `3604cea20`, `d3fa98d25` — simplified preparation/approval and presentation draft save.
- `6d6fefdd2` — released Admin startup fix (PR #514).
- Main design merge and handoff commit follows; earlier design branch history is included in that merge.

## Next Items

### Parked — resume only when owner requests

1. **No-video approval, revisions after approval, and returning later.** Evidence: owner’s final instruction and design plan's Review paused section. Resolve audio-only approval, stale/revoked Board materials, durable drafts, resumed jobs and partial-failure recovery before implementation. No extra mockups or runtime build requested now.
2. **Meeting coordination application build.** Evidence: plan labels and owner scope. Design approval does not authorize runtime routes, schema, jobs, paid processing or sharing changes. The proposed single preparation action changes existing save/publish/generate behavior; source-to-Board-consumer reconciliation is required.

### Verify Before Acting

1. **Use the latest standalone HTML, not old captures.** Evidence: transcript mockup and design plan. Earlier screenshots predate playback/materials controls. Preview saves/approvals are simulated and not persisted across reloads. Synthetic video is an excerpt, not a trimmed presentation output.
2. **Program Coordinator is a shared role.** Evidence: concurrent role handoff below and current design decision. Read current assignment via its existing config contract before wiring collection ownership/sender; do not hardcode the name or confuse responsibilities with access permissions.
3. **Removed checkbox has live runtime dependencies.** Evidence: documented UI guards, Zoom/start routes, import/queue services and acknowledgement timestamp. Remove these together only within an authorized build, preserving historical data and the separate admin-pilot workflow.

### Done / Do Not Reopen Without New Evidence

1. **Admin startup incident.** Released and accepted as above. Reinvestigate only for a new failure; do not reapply the old fix.
2. **Review checkboxes retained.** Owner chose to leave them for now and revisit only if burdensome.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/review/MEETING_TRACKER_LANDING_STRUCTURE_2026-10-20.md` | Current decisions, build requirements and parked edge cases |
| `docs/plans/review/meeting-tracker-2026-10-20/transcript-preparation.html` | Review/playback/materials preview |
| `docs/plans/review/meeting-tracker-2026-10-20/meeting-setup.html` | Agenda/attendee preview |
| `docs/plans/review/meeting-tracker-2026-10-20/invitations.html` | Attendee continuity and distinct materials |
| `docs/plans/ADMIN_CSP_STARTUP_FIX_2026-10-21.md` | Released incident evidence and verification |

## Verification and Handoff

Owner: Codex → future owner-paced design session. Designs retained in `/Users/gallivan/.codex/worktrees/meeting-agenda-layout/WMKF_Apps` on `codex/meeting-agenda-layout`; static preview server uses port 8768. Source previews are under the same relative docs path on main after this merge. Design checks included local stage transitions, timestamp update, manual disclosure, draft save and separate approval confirmation; detector found no primary anti-patterns. These are not runtime accessibility, persistence, authorization or processing acceptance. Admin incident had 43 focused unit and 36 browser tests, production build and hosted checks, plus authenticated production acceptance, recorded in its incident doc. Stop-time documentation gates/push reported at close.

Milestone determination: Admin startup incident outcome merits a DEVELOPMENT_LOG entry; design work alone does not. CLAUDE.md unchanged. Claim-evidence report returned local state unavailable; no observation row invented. Main's preexisting untracked critique and `output/` remain untouched. No instruction or skill edits.

---

