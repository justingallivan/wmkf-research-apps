---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Workbench Shell and Deliberation Handoffs"
source_files:
  - shared/components/workbench/WorkbenchShell.js
  - shared/components/workbench/StaffDeliberationsPanel.js
  - shared/components/workbench/WorkbenchViewsNav.js
  - shared/components/final-writeups/FinalWriteupsViews.js
  - pages/workbench/[requestId].js
  - lib/services/pre-site-visit/preparation-config.js
  - lib/services/pre-site-visit/cycle-list-service.js
  - pages/api/cron/staff-deliberations-preparation.js
canonical_docs:
  - docs/J27_TRANSITION_REGISTER.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
watch_paths:
  - shared/components/workbench/WorkbenchShell.js
  - shared/components/workbench/StaffDeliberationsPanel.js
  - shared/components/workbench/WorkbenchViewsNav.js
  - pages/workbench/[requestId].js
  - lib/services/pre-site-visit/preparation-config.js
  - pages/api/cron/staff-deliberations-preparation.js
update_triggers:
  - "Workbench shell navigation or view ordering changes"
  - "Staff Deliberations preparation, handoff, or cycle behavior changes"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "2013-2098"
  - "2135-2153"
---

# Workbench Shell and Deliberation Handoffs

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 2013-2098 -->
## Final Writeup lifecycle (Slices 1–4)

One Final Writeup row per request over the same stable SharePoint Word item; the row's `wmkf_lifecyclestate` is the stage discriminator. Source: `lib/services/final-writeup/transition-service.js`; plans `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` and `docs/FINAL_WRITEUP_LEADERSHIP_TRANSITION_PLAN.md`; Atlas `docs/atlas/dataverse-wmkf-requestdocument.md`.

- **Group review** (`REVIEW`, Production-live): `startFinalWriteup` claims a deterministic Final row from the current Pre-Site source, moves the *source* row to `FINAL`, sets `wmkf_CurrentFinalWriteup`, records `wmkf_GroupReviewStartedBy`/`At`.
- **Leadership review** (`FINAL` on the Final row, **[PRODUCTION-LIVE 2026-09-07: PR #176 merged as `25dc8645`, Ready deployment `dpl_22eyAD8S4yPmx16iv3Nng2u9sw5T`, owner-run signed-in smoke passed on Request `1002788`.]**): `advanceToLeadershipReview` via POST `/api/workbench/final-writeup/leadership-review`, lead PD or superuser, authorization before any state inspection; one changeset (Final-row PATCH + request-pointer re-bind, both ETag-fenced); writes the leadership pair and refreshes the row's SharePoint observation fields; **never writes `wmkf_milestone*` or `wmkf_MilestoneCreatedBy`** (that actor means Site Visit handoff). `committedFinal`, the acknowledgement reader, and the dashboard stage map all accept `FINAL` only with the complete, well-formed checkpoint via the shared `lib/services/final-writeup/leadership-checkpoint.js`.
- **Readers**: `getFinalWriteupStatus` returns `phase` `group-review` | `leadership-review` and `canAdvance`; the dashboard maps lifecycle to stage and the Leadership persona sees `leadership-review` rows only; acknowledgements continue at both stages.
- **Hazards**: any new reader of a Final row's lifecycle must handle `FINAL`; do not reuse milestone fields for Final-row checkpoints; the group-review activation's milestone stamp has no actor (pre-existing census gap, plan §10 D6).

## Operating Notes

- **Single-page Workbench shell (PR #204, `claude/workbench-shell`, 2026-09-08).** `pages/workbench.js`
  is a guard around `shared/components/workbench/WorkbenchShell.js`. The URL owns the shell state
  (`shared/components/workbench/workbench-location.js`: `view`, `programId`, `cycleCode`, `scope`,
  `setAside`; defaults omitted). The shell loads the program's cycle list once from
  `/api/workbench/dashboard`, honors a listed `?cycleCode=` deep link, otherwise falls back to the
  list's `defaultCycleCode` (the working cycle, `lib/utils/cycle-code.js` `resolveWorkingCycle`)
  and writes it back with `router.replace` so the address is always shareable. Cycle and program
  changes push history entries; scope and Set Aside replace. An external navigation (back button,
  a nav link) is adopted from `router.query` once no write of the shell's own is in flight — the
  first cut had a same-commit race where the cycle fallback effect undid an adoption, so the
  fallback compares against the render's `location.cycleCode`, never the ref. Panels so far:
  Request list (`RequestListPanel.js`, PR #204) and Reviewer follow-up (`ReviewerFollowUpPanel.js`,
  step 2: shares the shell's `scope`, owns `reviewers=attention|all` and `q=` in the URL with the
  search box mirrored after a 300 ms pause; `previewReadOnly` now comes from the shell page's
  `getServerSideProps` via `lib/services/workbench/preview-read-only.js`; the legacy
  `/workbench/reviewer-follow-up` route redirects into the shell carrying cycle and program), and
  Final writeups (`shared/components/final-writeups/FinalWriteupsViews.js` `FinalWriteupsPanel`,
  step 3: keys `writeups=`, `pd=`, `q=`, `uncycled=1` (sent as `cycleCode=none`); the API's
  default-cycle walk-back is no longer used by the UI — an empty cycle renders one in-place notice
  linking the newest other cycle with writeups and the uncycled rows; the legacy
  `/workbench/final-writeups` index redirects into the shell translating its old `view`/`pd` keys;
  both search boxes share `useUrlMirroredInput.js`), Awardees (`AwardeesPanel.js`, step 4: shows the
  shell's working cycle and shares its `scope` ("Show all programs" = `scope=all`); when a cycle is
  empty it reads the awardees endpoint's cycle-list mode once and links `lastDecidedCycleCode`
  ("N awardees in June 2026") which changes the shell cycle — owner decision 2026-09-08; the
  standalone page's own default-cycle resolution is gone), and Initial assessments
  (`InitialAssessmentsPanel.js`, step 4: takes the shell's cycle; renders the D26 explanatory card
  without calling the API, which is what a `view=initial-assessments&cycleCode=D26` deep link shows
  while the tab stays hidden for D26 — briefly unhidden and re-hidden 2026-09-09; in J27 it moves
  left of Request list and a Find reviewers view surfaces), and **Staff deliberations**
  (`StaffDeliberationsPanel.js`, added 2026-09-09 between Reviewer follow-up and Final writeups:
  the cycle-wide list of Pre-Site Visit Word drafts via read-only
  `GET /api/workbench/staff-deliberations?cycleCode=` → `lib/services/pre-site-visit/cycle-list-service.js`,
  one row per request — the `wmkf_CurrentPreSiteVisit` pointer row, else the newest active draft —
  linking to the per-request Staff Deliberations tab, which owns every write. PC Meeting Tracker
  slice 3, 2026-09-09 (`docs/PC_MEETING_TRACKER_PLAN.md`): both the tab and this panel now render a
  shared four-keyed-stop rail — `draft` (AI draft ready; since 2026-09-10 the first stop reads the
  code-owned substate text "No draft yet" / "Generating draft" / "Draft failed" in gray until a
  draft exists — `draftStopText` in `shared/utils/deliberation-stage.js`) → `shared` (Shared; D5, locked not
  "first sent") → `visit` (date-derived "visited", D7) → `final` — with admin-editable labels
  (D6, `shared/config/editableTextDefaults.js` keys `stage.deliberations.*`); the old
  Draft/Draft ready/Share/Wrap Up hard-coded labels are gone. **Tab redesign 2026-09-10 (S503,
  `docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md`):** stage → sentence → one primary
  action. A code-owned stage sentence (`deliberationStageSentence` in
  `shared/utils/deliberation-stage.js`) sits under the rail with a "Deliberation session: …" line
  (tracker §5.4 via the status payload / cycle list) and the visit line; the action row is one dark
  button plus at most one outline button (draft: Edit in Word + Share…; shared not-sent: Share… +
  Open working document; shared sent: Open working document, Resend only after a failed send;
  visit: Add site-visit edits in Word + Continue in Final Writeup; final: Open Final Writeup), with
  Download / Regenerate / Send again under a portalled More menu
  (`shared/components/workbench/OverflowMenu.js`). Share… opens `PreSiteDistributionPanel` in
  `composer="dialog"` mode; the composer's first button is "Lock and preview" at the draft stage and
  calls the tab's `lockForShare` (guarded `start-site-visit`) before `prepare`, so the order is lock →
  preview → send and a lock failure lands in the composer. The help popover, "Start sharing" block,
  Shared/Materials sent chips, and the cycle view's registry block are gone; the email carries no
  attachment (PR #224, migration 039). **Meeting Tracker slice 2b (2026-09-10):** the site visit is
  scheduled from the tracker (`/meeting-tracker/visits/[requestId]`, route
  `/api/meeting-tracker/visits/[requestId]` over the existing logistics service); the Activity is
  still the record every reader here uses. The panel gained a `scope=my|all`
  ScopeSegment like Request list/Reviewer follow-up/Awardees, stage-grouped cards, and a lead
  count line; a deliberation-session line is deferred to tracker slice 1.) All six views are
  panels (`SHELL_PANEL_VIEWS` =
  every view); `pages/workbench/{artifacts,awardees,reviewer-follow-up,final-writeups/index}.js` are
  redirects; `WorkbenchViewsNav` no longer reads the router. **Shell rule change in
  step 3:** a well-formed `?cycleCode=` is honored even when the program's dashboard list omits it
  (rendered as an extra option) — Final writeups and Awardees cycles need not have pending
  requests; only a missing cycle falls back to the working cycle. Readiness after a program change
  is derived from which program the loaded list belongs to (`loadedProgramKey`), because the
  fallback effect otherwise ran one render early on the previous program's default; `WorkbenchViewsNav` links
  shell-backed views into the shell (shallow) and the rest to their own pages. Tests:
  `tests/unit/workbench-shell.test.js`, `workbench-location.test.js`, `workbench-views-nav.test.js`,
  and the request-locator suite (stateful router mock). Remaining panels and the Awardees
  cycle question: `docs/CURRENT_WORK_QUEUE.md` audit follow-ups.
- **Automatic post-visit preparation is live (S579, 2026-10-06; PRs #449–#451).** `/api/cron/staff-deliberations-preparation` runs every 15 minutes and acts only with `STAFF_DELIBERATIONS_AUTO_PREPARE=on` plus the Production allowlists (Research, `D26`, `Phase II Pending`) and `_EXCLUDED_REQUEST_NUMBERS`; one predicate, `requestMatchesPreparationAllowlists` (`lib/services/pre-site-visit/preparation-config.js`), gates scan, claim, fence, retry and list/detail status. Hazards: the worker has no age bound (the cycle allowlist is the only backstop — see register J27-084 and `docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md`); SharePoint rewrites a file once on its first read (eTag +1, ~2.5 KB, version unchanged), absorbed as a transient `site_visit_sharepoint_version_changed` retry; the governed DOCX hash now covers reachable parts outside `word/` (staff-pasted `/media/…` images). Operator tools: `scripts/review-staff-deliberations-preparation-cohort.mjs`, `scripts/report-staff-deliberations-preparation-receipts.mjs`, `scripts/probe-staff-deliberations-handoff-file.mjs`. Group-review handoff from the writeup step ("Ready for group review") is live (PR #452, merge `40b70a145`, 2026-10-06); Stage 2 (draft hidden in the apps before group review except to the lead PD, PCs and superusers, via `lib/services/pre-site-visit/writeup-visibility.js`) is live (PR #453, merge `b47a70eae`, 2026-10-06; Dynamics Explorer is an owner-accepted gap); Stage 3 ("Sign off" replaces "Mark reviewed"; the lead PD and superusers see a names-only roster of expected Program Directors from `final_writeup.matrix_audiences` on the acknowledgement route, and Send to leadership names unsigned PDs) is live (PR #454, merge `b2bc23b95`, 2026-10-07); Stage 4 (handoff email to the other PDs, gated by fail-closed `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS`, ledger `final_writeup_handoff_emails` keyed by the handed-off draft, staged before the transition only while the request has no Final, sent only after the transition is confirmed) is live for Research (PR #456, merge `8bc5b466b`, 2026-10-07; first real send not yet observed); Stage 5 is planned in `docs/plans/FINAL_WRITEUP_GROUP_REVIEW_HANDOFF_PLAN_2026-10-06.md`.
- **Staff Deliberations redesign (S578, 2026-10-06, `feature/workbench-ux`; dated UI description).** The list is Reviewer-follow-up-style cards: `#number` + title, "Institution · PI · PD" (`projectLeader` from `cycle-list-service.js`), a stage chip with time, the next step naming the request-page action or the specific `attentionReason()`, and one "Open request"/"Open review" button deep-linking to `#deliberations-status|briefing|writeup`; no Word shortcut on the list (owner). The 2026-10-06 request-tab stepper labels (Pre-site briefing → Deliberation session → Presentation → Working writeup → Group review; step 4 then retitled "Post-presentation writeup") are historical labels, not unresolved naming choices. Recording/transcripts/summary sit in the Presentation step in this dated description. Deliberation sessions precede the site visit (memory `project-deliberation-session-precedes-site-visit`). Vocabulary was approved 2026-10-21; **Draft writeup** replaced proposed **Post-presentation writeup**. On 2026-10-31 a branch-local display-copy slice was authorized for `StaffDeliberationsTab`, `StaffDeliberationsPanel`, `FinalWriteupTab`, and `PreSiteDistributionPanel`; it is not merged or deployed. Other runtime wording remains pending separate scope; internal identifiers and persisted values remain unchanged. See `docs/NOMENCLATURE_GLOSSARY.md` and `docs/CURRENT_WORK_QUEUE.md`.
<!-- end-source-lines: 2013-2098 -->
<!-- source-lines: 2135-2153 -->
- **Workbench UI polish (Codex PR #151, `3fc0a936`, production 2026-09-05).** UI-only; no
  `pages/api` or `lib` change, payload shapes and SSE vocabulary unchanged. Durable behavior
  changes: (a) `/workbench/reviewer-follow-up` is now a focused attention queue — request
  cards start collapsed ("Show reviewer activity"), the per-card **Campaign settings** button,
  the **Open full reviewer panel** link and the page-level `WorkbenchViewsNav` were removed,
  and search sits in the toolbar (the views strip returned 2026-09-08 when the view moved
  inside the single-page shell, owner decision — see the shell note above); the panel it mounts is still `ReviewerManagePanel` in
  `track` mode; its refetch-error handling was fixed in PR #152 (see the 6B3d note above).
  (b) `/workbench/artifacts` is retitled **Initial assessments** and renders a "not part of
  the D26 dual-phase workflow / available for J27" card for `cycleCode === 'D26'` without
  calling the initial-assessment API; `WorkbenchViewsNav` hides that view for D26. The
  D26-pilot records in `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md` and the
  requestdocument Atlas page are historical and no longer reproducible through that view for
  D26. **Owner-confirmed 2026-09-05 (S489):** the D26 pilot existed to prove the plumbing;
  its output is not used by D26 business processes, so hiding the view is intended. Initial
  Assessments return in J27 as a real feature, not a test — do not "restore" the D26 view. (c) `ReviewersTab` wraps the panel in a `request-reviewer-table` container carrying
  `degraded={Boolean(error)}` (pinned by `reviewers-tab-stale-request.test.js`); status pills
  across Status, Staff Deliberations, Final writeups and the request locator gained a uniform
  min-height. Change record: `docs/plans/UI_FEATURES_CODEX_HANDOFF_2026-09-05.md`.
<!-- end-source-lines: 2135-2153 -->
