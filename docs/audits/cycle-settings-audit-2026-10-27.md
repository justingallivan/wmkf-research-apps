---
title: Cycle identity, defaults and dates — source inventory
domain: platform
kind: audit
status: partial
summary: "Source-only inventory (74 rows) of every place the app suite takes a cycle identity, default or cycle date from, including per-app settings; live Vercel/Dataverse values unverified. Feeds the default-cycle redesign planning item."
owner: product-engineering
related:
  - docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/audits/cycle-foundations-2026-10-21.md
---

Produced 2026-10-27 (Session 645) by a delegated read-only Sonnet agent; the
orchestrating session spot-checked five claims against source (no runtime
`wmkf_grantcycle` reader; Expertise batch `resolveWorkingCycle(conventionalCycles())`;
Initial Assessments `'D26'` literal; Board page `'D26'` defaults; Staff
Deliberations env cycle list). Line numbers are as of branch
`claude/j27-ai-materials-names` at that date.

# Cycle identity, defaults and dates: source inventory (read-only audit)

> **Historical snapshot; superseded in part 2026-10-28.** Row A4 lists the operations `wmkf_grantcycle` columns as of this audit. Connor has since added eleven milestone date columns, and the owner made that table the authoritative, app-edited home for cycle dates (alignment log D43; `docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md`; evidence `docs/audits/grant-cycle-dates-2026-10-28-evidence.json`). The "not read at runtime" finding still holds. Rows below are left as recorded.

Audit date 2026-10-27, branch `claude/j27-ai-materials-names`. Source-only: nothing was run against Dataverse, Postgres, Vercel or production. Live values (Vercel env, stored settings rows, Dataverse rows) are therefore [ASSUMED] / unverified unless stated; mechanics are read from source.

Evidence labels: [VERIFIED via path:line] = I read the line. [INFERRED] = follows from verified code but I did not read every hop, or depends on live data.

Conventions used below
- "Exact-date flip": caller passes cycles with `meetingDate`; working cycle = earliest cycle whose meeting day >= today (UTC); so it flips at 00:00 UTC on the day after the latest meeting date in that cycle. [VERIFIED via lib/utils/cycle-code.js:122-128]
- "Month flip": caller passes codes only; working cycle = earliest cycle whose month has not ended; so D26 stays working through Dec 31 UTC and J27 takes over Jan 1 UTC. [VERIFIED via lib/utils/cycle-code.js:105-128]
- If every listed cycle is past, `resolveWorkingCycle` returns the newest cycle (it does not return null). [VERIFIED via lib/utils/cycle-code.js:126-127]
- Cycle identity of a request = UTC month of `wmkf_meetingdate` (June -> `J`yy, December -> `D`yy; any other month -> null = "uncycled"). [VERIFIED via lib/utils/cycle-code.js:24-35]

---

## 1. Summary

### 1.1 Counts by source kind (rows in section 3)

| Source kind | Rows |
|---|---|
| Vercel/env variables naming a cycle or cycle list | 2 cycle pins (`REVIEW_DOCX_SHAREPOINT_CYCLE`, `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES`) + 5 `CYCLE_DOSSIER_*` + 2 related feature switches (`RESEARCH_LEADERSHIP_DIGEST_MODE`, `BOARD_WRITEUPS_ENABLED`) + 1 preview-only (`PROPOSAL_RANKING_TEST_ENABLED`) = 10 variables, 9 rows |
| Dataverse/app settings keys | 2 cycle-bearing keys (`reviewer.campaign_timeline_defaults`, `board_writeups.cycle.<code>`); 1 cycle-adjacent global (`site_visit_materials.due_business_days`) |
| Per-request / per-PD / per-user local settings | 7 request columns (`wmkf_respondoffsetdays`, `wmkf_reviewduedate`, `wmkf_desiredcount`, reminder enable/lead x2), 1 per-suggestion override (`wmkf_reviewduedateoverride`), 1 per-user sticky preference (`reviewer_invite_timing`), 1 legacy per-user preference (`reviewer_finder_grant_cycle_settings`) |
| Records | `wmkf_appgrantcycle` (read), `wmkf_grantcycle` (NOT read by any runtime code), request `wmkf_meetingdate`, request `akoya_fiscalyear`, suggestion `wmkf_grantcyclecode` |
| Hardcoded cycle literals that change behavior | 13 behavior-changing sites (Workbench nav, Initial Assessments panel, Board pages x3 incl. component default, Board roster count, Dossier x6 files/migration, Ranking trial cutoff, Ranking rehearsal `D97`, `visitExpected()`, document-name map) |
| "Today"-derived defaults | 3 helpers, 8 consumers (Workbench dashboard, Meeting Tracker, Program Briefing, Discussion Sentiment via dashboard, Awardees, Proposal Ranking, Expertise batch, grantee-titles cron) + 1 derived default Grant Program |
| Cron jobs | 32 `vercel.json` entries (31 paths; `drain-transcriptions` twice); 6 cycle- or meeting-date-aware: grantee titles, file-review-docx, Staff Deliberations prep (each picks a cycle or month window), board-writeups (iterates all cycles), drain-cycle-dossiers (D26 only), sweep-stale-invites (meeting date); 26 entries have no cycle logic |
| Hardcoded dates | none that name a cycle date in runtime source (only `ROLLOUT_AT` in a script and `LAST_REVIEWED_AT` model metadata, both unrelated) |

Total rows: 74 (IDs A1-A8 in section 2; W, M, R, E, G, B, RV, SD, IA, FW, DS, X in section 3). Some rows are explicit exclusions kept for completeness.

### 1.2 Items that need a Vercel env edit/redeploy or a code edit at rollover

Env edit (Vercel; env change needs redeploy/new deployment to take effect):
1. `REVIEW_DOCX_SHAREPOINT_CYCLE` - single exact cycle; scheduled discovery filters suggestions by `wmkf_grantcyclecode eq <cycle>` (RV5).
2. `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` - JSON list of cycle codes for Staff Deliberations auto-prepare (SD1).
3. `CYCLE_DOSSIER_*` (5 vars) - only matter while the dossier stays a D26 pilot; there is no env way to point it at J27 (DS1-DS6).

Code edit (no config path exists):
4. `shared/components/workbench/WorkbenchViewsNav.js:68` and `InitialAssessmentsPanel.js:19,28,67` - `'D26'` literal controls whether Initial Assessments shows.
5. `pages/board-writeups.js:8`, `pages/board-cycle-setup.js:7`, `shared/components/board-writeups/BoardWriteups.js:15` - page default cycle is `'D26'`; `lib/services/board-writeups/config.js:98` - D26 roster must be 23.
6. Dossier: `lib/services/cycle-dossier-rollout.js:16`, `cycle-dossier-store.js:56,60`, `cycle-dossier-worker.js:158,321,351`, `cycle-dossier-service.js:39,264,268`, `cycle-dossier-documents.js:212`, `pages/cycle-dossier.js:481-505`, DB `CHECK (cycle='D26')` in `lib/db/migrations/045_cycle_dossiers.sql:5,16` (needs a migration, not an env).
7. `shared/utils/deliberation-stage.js:59` `visitExpected()` returns `true` for every cycle (J27 has no site visits).
8. `shared/config/workbenchProposalDocuments.js:31-36` - J27 silently inherits the D26 Phase I filename map.
9. `lib/services/proposal-ranking/trial-cutoff.js:3,9,15` - D26 request-number cutoff 1003220 (permanent D26-only rule).
10. `vercel.json` cron `generate-grantee-titles` schedule months `4-6,10-12` and the month-granular conventional fallback in `pages/api/cron/generate-grantee-titles.js:43`.
11. Fixed defaults: `respondOffsetDays` 7 and `desiredCount` 4 (`lib/services/reviewer-campaign-timeline.js:20-24`, `InviteEmailModal.js:229`, `ReviewerCampaignTimelineSection.js:10`); token grace 2 / long window 90 days (`lib/external/reviewer-token-ttl.js:19-25`).
12. Form registry `lib/utils/form-schema.js:12-15` keyed to `phase-ii-research-2026-06`.

Admin/UI edit only (no deploy), but NOT cycle-keyed so each rollover overwrites the previous cycle's values:
- `reviewer.campaign_timeline_defaults` (one key for the whole app; free-text `cycleLabel`; consumers never match the label to a request's cycle).
- Request campaign config (per request) and `wmkf_appgrantcycle` row (per cycle code; has `wmkf_reviewreturndeadline`).
- `board_writeups.cycle.<code>` is cycle-keyed (new key per cycle; no overwrite).

### 1.3 Items that would show the wrong cycle (or pre-fill the wrong dates) Dec 7 - Feb 24 if nothing changes

(D26 Board Dec 10; J27 proposals arrive Dec 7; reviewer invitations ~Feb 24; reviews due ~Mar 17 per docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md:12-22. The Feb 24 milestone is from that doc, not from code.)

1. Expertise batch (`pages/expertise-finder.js:671`): month flip, so it opens on D26 until Dec 31 UTC. J27 expertise matching is planned Dec 8; staff must change the picker by hand for three weeks.
2. Proposal Ranking (`ProposalRankingApp.js:308`): month flip, D26 through Dec 31, then J27. Acceptable for ranking, but it differs from Workbench's Dec 11 flip.
3. Workbench / Meeting Tracker / Program Briefing / Discussion Sentiment / Awardees-default: exact-date flip. Dec 7-10 all open on D26. From Dec 11 UTC (day after the latest ordinary visible D26 meeting date) they open on J27 if any J27 request is visible (status Phase II Pending or triage Advancing); otherwise they stay on D26 because the fallback is the newest cycle. D26 post-board work (Awardees, final write-ups) lands on J27 until the user switches. [INFERRED: J27 visibility timing depends on intake status mapping, not verified]
4. Board pages: `/board-writeups` and `/board-cycle-setup` (and the nav links in `shared/components/Layout.js:132,134`, which carry no `?cycle=`) open on D26 forever.
5. `REVIEW_DOCX_SHAREPOINT_CYCLE` (if still `D26` in Vercel [ASSUMED]): J27 reviews are never discovered (suggestion stamp must equal the pin); after the pin moves to J27, any late D26 review stops auto-filing.
6. `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` (live value [ASSUMED] D26 only): J27 requests are never auto-prepared; the worker also rejects receipts whose cycle is not in the list (`preparation-worker.js:203`).
7. `reviewer.campaign_timeline_defaults`: whatever is stored (likely D26 label/dates [ASSUMED]) seeds the invitation modal for J27 invitations on Feb 24 and, on first send, is persisted to each request (`send-emails-service.js:1207-1245`). The label is never compared with the request's cycle.
8. Per-user sticky `reviewer_invite_timing` (InviteEmailModal) re-applies a PD's last-used dates to any cycle until the admin default or request config overrides.
9. Grantee-titles cron: D26 until Dec 31 UTC; no run Jan-Mar (month list `4-6,10-12`), so J27 is first processed Apr 1 and D26 stragglers after Dec 31 are not processed. [INFERRED]
10. Proposal tab documents: J27 inherits the D26 Phase I slot map; J27 flows use `Project-Narrative_*` names (accepted separately by `proposal-document-names.js:36-49`).
11. Dossier and Ranking trial cutoff are D26-only by design; no J27 equivalent exists.
12. Default Grant Program (Workbench) is derived from the caller's assigned visible requests in the newest cycle (`program-scope-service.js:79-97`); it can change when the first J27 requests become visible.

---

## 2. Cross-cutting helpers and records

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| A1 | Cycle identity for every request-based surface (labels, filters, grouping) | `lib/utils/cycle-code.js:24-35,70-82` | Request `wmkf_meetingdate` (UTC month) | Whoever edits the request meeting date in Dynamics/GOApply (app writes it only in the test-request factory and honorarium onboarding); code change for any non-June/December cycle | June -> J, December -> D; filter window = month start inclusive to next month exclusive | Dec 7 J27 proposals have a June 2027 meeting date so they are J27 and D26 proposals stay D26; both coexist. A board-date edit across a month/year boundary silently re-codes a request | [VERIFIED via cycle-code.js:24-35,70-82; lib/bill/honorarium-onboard-orchestrator.js:171; lib/services/test-requests/policy.js:337] |
| A2 | `resolveWorkingCycle` / `resolveLastDecidedCycle` (default cycle) | `lib/utils/cycle-code.js:122-136` | Today (server or browser clock, UTC day) + cycle list | Code only | See conventions above | See conventions | [VERIFIED via cycle-code.js:122-136] |
| A3 | `conventionalCycles()` fallback list, six codes prev-June to next-December | `lib/utils/cycle-code.js:142-147` | Today's UTC year | Code only | Rolls Jan 1 UTC | Gives D26 through Dec 31, J27 from Jan 1 | [VERIFIED via cycle-code.js:142-147] |
| A4 | Operations cycle record `wmkf_grantcycle` (CycleCode key, CycleName, MeetingDate) and request lookup `wmkf_grantcycle_akoya_request` | `lib/dataverse/schema/wave0-prod-parity-foundation/01_wmkf_grantcycle.json`, `zz_akoya_request.json:504` | Dataverse (operations) | Operations staff | Not read at runtime: case-insensitive grep of lib/pages/shared/scripts finds no reference outside schema JSON | Nothing in the app reacts to it today | [VERIFIED via grep, zero runtime hits] |
| A5 | Apps cycle record `wmkf_appgrantcycle`: lookup by `wmkf_shortcode` for display name, program name, `wmkf_reviewreturndeadline`, review template, attachments, custom fields | `lib/services/grant-cycles-dataverse.js:76-109,131-146`; loader `lib/services/review-manager/cycle-config-loader.js:36-47` | Dataverse (apps) | Reviewer Finder cycle admin API `pages/api/reviewer-finder/grant-cycles.js` | `wmkf_MeetingDate` exists in schema (`schema/wave2/wmkf_app_grant_cycle.json`) but is not in `SELECT_FIELDS`, so runtime cannot read it. Deadline used only for email rendering (RV4) | A missing row for J27 means no cycle deadline/template/attachments for J27 emails | [VERIFIED via grant-cycles-dataverse.js:76-109; schema json] |
| A6 | Per-cycle counts in the cycle admin list group requests by `akoya_fiscalyear` string ("June 2026") and suggestions by `wmkf_grantcyclecode` | `lib/services/grant-cycles-dataverse.js:180-215` | Request label vs suggestion stamp: two different cycle identities | Dynamics (label), app (stamp) | n/a | Counts for a cycle may disagree if the fiscal-year label differs from the meeting-date month | [VERIFIED via grant-cycles-dataverse.js:180-215] |
| A7 | Reviewer-suggestion cycle stamp `wmkf_grantcyclecode` (set at suggestion creation from the request's meeting-date code; backfilled only if empty) | `lib/dataverse/adapters/reviewer-suggestion.js:537,819,972`; callers `lib/services/review-manager/reviewers-service.js:294,331`, `save-candidates-service.js:662` | Request meeting date at the time of save | App writes; scripts/Dynamics can edit | Never re-stamped after first set | A request later moved to another cycle keeps the old stamp; the review DOCX discovery depends on it (RV5) | [VERIFIED via reviewer-suggestion.js:819,972] |
| A8 | Request `akoya_fiscalyear` label (also derived for honoraria from the meeting date) | `lib/bill/honorarium-onboard-orchestrator.js:172,905`; `lib/dataverse/adapters/grant-request.js:209` | Dynamics label / derived | Dynamics staff | n/a | Display/grouping only | [VERIFIED via honorarium-onboard-orchestrator.js:172,905] |

---

## 3. Rows by app

### 3.1 Workbench shell (`/workbench`) and shared dashboard

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| W1 | Cycle the Workbench opens on (picker default) | `lib/services/workbench/dashboard-service.js:133-215` (`listCycles`, `today = new Date()`); client `shared/components/workbench/WorkbenchShell.js:81,116,137` | Today (server UTC) + cycles found among visible ordinary requests; per cycle `meetingDate` = latest ordinary request meeting date | Nobody (derived); PD can pick another cycle | Exact-date flip, at 00:00 UTC the day after the latest ordinary meeting date; falls back to newest cycle if all past | Dec 7-10: D26 (J27 not in list until a J27 request is visible). From Dec 11 UTC: J27 if visible, else D26. A single D26 request dated Dec 11 delays the flip to Dec 12 (a test request in `shared/config/d26Allowlist.js:49` is dated 2026-12-11; live D26 dates not verified) | [VERIFIED via dashboard-service.js:133-215, WorkbenchShell.js:132-147] |
| W2 | URL-carried cycle (`?cycleCode=`), written back with `replace` so bookmarks and shared links pin a cycle; no localStorage/sessionStorage for cycle | `shared/components/workbench/workbench-location.js:29-35,61,79`; `WorkbenchShell.js:145-147` | URL | PD (picker or link) | Absent -> W1 | Old bookmarks keep opening D26 after Dec 10 | [VERIFIED via workbench-location.js:29-35,79; grep for storage] |
| W3 | Visibility predicate that decides which requests (and so cycles) appear: `akoya_requeststatus = 'Phase II Pending'` or triage Advancing | `shared/config/workbenchVisibility.js:11-15` | Hardcoded status literal | Code | n/a | A J27 cycle does not enter the list until a J27 request satisfies it | [VERIFIED via workbenchVisibility.js:11-15] |
| W4 | Default Grant Program derived from caller's assigned visible requests in the newest cycle | `lib/services/workbench/program-scope-service.js:79-97` | Caller assignments + request meeting dates | Nobody (derived) | Newest visible cycle by timestamp | Can change when first J27 requests become visible | [VERIFIED via program-scope-service.js:79-97] |
| W5 | Initial Assessments view hidden for D26, shown otherwise | `shared/components/workbench/WorkbenchViewsNav.js:61-68` | Hardcoded `'D26'` literal | Code edit | n/a | D26 hidden; every other cycle (J27) shown | [VERIFIED via WorkbenchViewsNav.js:68] |
| W6 | Initial Assessments panel shows "not part of D26 dual-phase workflow" and makes no API call for D26 | `shared/components/workbench/InitialAssessmentsPanel.js:19,28,67-70` | Hardcoded `INITIAL_ASSESSMENTS_EXCLUDED_CYCLE = 'D26'` | Code edit | n/a | As W5 | [VERIFIED via InitialAssessmentsPanel.js:19,28,67] |
| W7 | Proposal tab document slot map per cycle | `shared/config/workbenchProposalDocuments.js:17-36`; consumed `lib/services/workbench-proposal-documents.js:19,72` | Hardcoded map; only `D26` keyed; every other cycle (J27) falls back to the D26 default | Code edit | n/a | J27 shows D26's Phase I filenames (`ProjectDescription.pdf` etc.) | [VERIFIED via workbenchProposalDocuments.js:31-36] |
| W8 | Governed proposal input file names (`ProposalNarrative_*` vs `Project-Narrative_*`; `ProposalBibliography_*` vs `Bibliography_*`) accepted side by side, not cycle-keyed | `lib/utils/proposal-document-names.js:30-50` | Hardcoded | Code edit | Both accepted, both present fails closed | No cycle switch needed | [VERIFIED via proposal-document-names.js:30-50] |
| W9 | Reviewer Finder proposal loader falls back to `Phase I/ProjectDescription.pdf` | `lib/services/reviewer-finder/load-proposal-service.js:83-97,159-182` | Hardcoded folder/file name | Code edit | n/a | J27 single-submission layout is not covered [INFERRED] | [VERIFIED via load-proposal-service.js:83-97] |
| W10 | Edit-time stage 3 "visit" counted in Staff Deliberations rail | `shared/utils/deliberation-stage.js:59`; used `lib/services/pre-site-visit/cycle-list-service.js:681-690`, `StaffDeliberationsTab.js:834-837` | Hardcoded `visitExpected() { return true }` | Code edit | n/a | Applies to every cycle; J27 has no site visits | [VERIFIED via deliberation-stage.js:59, cycle-list-service.js:681-690] |
| W11 | Cycle label/code stamped onto artifacts and rows (Initial Assessment, pre-site, site-visit materials, consultant feedback, pre-RP brief, export) from meeting date | `lib/services/initial-assessment/artifact-service.js:84`; `pre-site-visit/artifact-service.js:406`; `site-visit-materials/contributor-service.js:528`; `consultant-feedback-attachment-service.js:337`; `pre-rp-brief/input-service.js:79`; `workbench/export-candidates-service.js:61`; `site-visit/logistics-service.js:452` | Request meeting date at write time | n/a | Pure derivation | No default; no action needed. Excluded from pins; included for completeness | [VERIFIED via the cited lines] |

### 3.2 Meeting Tracker (list, sessions, Program Briefing, Discussion Sentiment)

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| M1 | Meeting Tracker list/sessions cycle default | `shared/components/meeting-tracker/MeetingTrackerList.js:130` uses `dashboard.defaultCycleCode` (same W1 service, `lib/services/meeting-tracker/dashboard-service.js:6,100-142`); sessions page reads `?cycleCode` (`pages/meeting-tracker/sessions/index.js:10`) | Today + W1 | PD picker/URL | Exact-date flip as W1 | As W1 | [VERIFIED via MeetingTrackerList.js:130; dashboard-service.js:6] |
| M2 | Program Briefing default cycle (own cycle list: visible, non-set-aside requests; latest meeting date per cycle) | `lib/services/meeting-tracker/program-briefing-service.js:80-95` (`resolveWorkingCycle(cycles, dependencies.now())`); client `ProgramBriefingView.js:99` | Today + request dates | PD picker | Exact-date flip (set-aside excluded, so list can differ from W1) | As W1 | [VERIFIED via program-briefing-service.js:80-95] |
| M3 | Discussion Sentiment cycle default | `shared/components/meeting-tracker/DiscussionSentimentView.js:194-219` (`body.defaultCycleCode || cycles[0]`); candidates `lib/services/post-presentation-materials/discussion-sentiment-candidates.js:50-56` | W1 service | PD picker | As W1; `from`/`to` date filter fields are free per-page browser state (`:165-166`) | As W1 | [VERIFIED via DiscussionSentimentView.js:194-219] |
| M4 | Meeting sessions/agenda/slots | `lib/services/meeting-tracker/session-service.js`, `slot-service.js`, `agenda-service.js` | none | n/a | Grep finds no cycle reference | Not cycle-scoped; excluded | [VERIFIED via grep] |
| M5 | Default attendee list (global, not cycle-scoped) | `shared/config/meetingTracker.js:36` | Dataverse setting `meeting_tracker.default_attendees` | Admin | n/a | Excluded: not cycle/date | [VERIFIED via meetingTracker.js:36] |
| M6 | Site Visit materials due date = N business days setting (global) | `shared/config/siteVisitMaterials.js:11`; `lib/services/site-visit-materials/due-date-setting.js:24-38` | Dataverse setting `site_visit_materials.due_business_days` | Admin | Relative to the visit, not cycle | Not a cycle date; listed because it is a date default | [VERIFIED via due-date-setting.js:24-38] |

### 3.3 Proposal Ranking

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| R1 | Picker default and options | `shared/components/proposal-ranking/ProposalRankingApp.js:15-20,308` | Browser clock via `resolveWorkingCycle(conventionalCycles())` (no server cycle list); options = six conventional codes | Nobody; user can pick | Month flip: D26 through Dec 31 UTC, J27 from Jan 1 UTC | D26 on Dec 7-10 and until Dec 31; J27 Jan 1 onward | [VERIFIED via ProposalRankingApp.js:15-20,308] |
| R2 | D26 trial cutoff: D26 requests with `akoya_requestnum >= 1003220` are removed from ranking | `lib/services/proposal-ranking/trial-cutoff.js:3,9,15`; used `lib/dataverse/adapters/proposal-ranking-source.js:112` | Hardcoded constant | Code edit | Applies only to D26 | Permanent; D26 requests above the number never rank | [VERIFIED via trial-cutoff.js:3-18, proposal-ranking-source.js:112] |
| R3 | Rehearsal cycle `D97` and Preview-only switch `PROPOSAL_RANKING_TEST_ENABLED` | `lib/services/proposal-ranking/test-policy.js:6`; `pages/proposal-ranking.js:6-9` | Hardcoded + env (Preview only) | Redeploy | Never Production | none | [VERIFIED via test-policy.js:6,25; pages/proposal-ranking.js:9] |
| R4 | Facilitator defaults (not cycle) | `lib/services/proposal-ranking/config.js:12-13` | Dataverse settings | Admin | n/a | Excluded: global | [VERIFIED via config.js:12-13] |

### 3.4 Expertise Finder (batch tab)

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| E1 | Batch tab cycle default | `pages/expertise-finder.js:671` (`resolveWorkingCycle(conventionalCycles())`) | Browser clock | User picker | Month flip | D26 through Dec 31 even though J27 proposals arrive Dec 7 | [VERIFIED via expertise-finder.js:671] |
| E2 | Picker options: current year +1 back to 2020, both codes per year | `pages/expertise-finder.js:679-688` | Browser UTC year, hardcoded floor 2020 | Code | Rolls Jan 1 | none | [VERIFIED via expertise-finder.js:679-688] |
| E3 | Proposal search for a cycle (`cycleCode` required, validated) | `pages/api/expertise-finder/proposals.js:31-42` | Query | n/a | n/a | none | [VERIFIED via proposals.js:31-42] |

### 3.5 Awardees / grantee deliverables

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| G1 | Awardees cycle list: cycles with Active research awardees; `defaultCycleCode` (working) and `lastDecidedCycleCode` (newest meeting before today) | `lib/services/workbench/grantee-deliverables/awardees-service.js:79-112` (`today = new Date()`) | Today + awardee meeting dates | Nobody | Exact-date flip; `lastDecided` flips at the same moment | After Dec 10 UTC, `lastDecided` becomes D26 | [VERIFIED via awardees-service.js:79-112] |
| G2 | Awardees panel uses the shell's cycle, then offers a "last decided" link when empty | `shared/components/workbench/AwardeesPanel.js:112-141` | Shell cycle + G1 | PD | n/a | After Dec 11 shell may sit on J27 (no awardees) and point back to D26 | [VERIFIED via AwardeesPanel.js:112-141] |
| G3 | Edited-title (grantee-titles) cron: picks one cycle, month window | `pages/api/cron/generate-grantee-titles.js:38-44`; `vercel.json` schedule `0 6 * 4-6,10-12 *` | `resolveWorkingCycle(conventionalCycles(now), now)` unless `?cycleCode=` | Redeploy for schedule/months; query param for one-off | Month flip; runs daily at 06:00 UTC in Apr-Jun and Oct-Dec only | D26 titles processed daily Oct-Dec 31; none Jan-Mar; J27 first processed Apr 1 [INFERRED from cron string] | [VERIFIED via generate-grantee-titles.js:38-44; vercel.json] |
| G4 | Research program ids eligible (not cycle) | `shared/config/granteeResearchPrograms.js` | Hardcoded | Code | n/a | Excluded: not cycle | [VERIFIED via file head] |
| G5 | Deliverable day-12 reminder cron | `lib/services/cron/grantee-deliverable-reminders-service.js` | Invited deliverables; no cycle | n/a | n/a | Excluded: not cycle-aware (grep finds no cycle reference) | [VERIFIED via grep] |

### 3.6 Board writeups / Board cycle setup

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| B1 | `/board-writeups` and `/board-cycle-setup` default cycle | `pages/board-writeups.js:8`, `pages/board-cycle-setup.js:7`, `shared/components/board-writeups/BoardWriteups.js:15`; nav links without `?cycle=` at `shared/components/Layout.js:132,134` | Hardcoded `'D26'` unless `?cycle=` | Code edit | Never flips | D26 forever unless URL carries a cycle | [VERIFIED via the cited lines] |
| B2 | Per-cycle Board setup: roster request ids, `materialsDue`, `boardEnds`, admin recipient, active flag; saved in setting `board_writeups.cycle.<code>` (versioned, revision-checked) | `lib/services/board-writeups/model.js:12,37-48`; `config.js:30-41,91-117` | Dataverse `wmkf_appsystemsettings` | Admin / Grants Manager role in the setup page | New key per cycle; no default | This is the only cycle-keyed, no-deploy calendar store; Board date (`boardEnds`) is entered here separately from `wmkf_grantcycle` (A4) and from request meeting dates | [VERIFIED via model.js:37-48, config.js:30-41] |
| B3 | Archive and cleanup timing from `boardEnds`: archive starts the Pacific day after `boardEnds` at 09:00; cleanup reminder at `boardEnds + 7 days` | `lib/services/board-writeups/worker.js:49`; `notifications.js:19`; `model.js:67-68` | `boardEnds` + `America/Los_Angeles` clock | Board setup | Calendar-driven, no deploy | D26: archive begins the day after the stored end date | [VERIFIED via worker.js:49, model.js:60-72] |
| B4 | D26 roster must contain exactly 23 requests to confirm | `lib/services/board-writeups/config.js:98` | Hardcoded 23 | Code edit | D26 only | none for J27 | [VERIFIED via config.js:98] |
| B5 | Cron `board-writeups` iterates every configured cycle | `lib/services/board-writeups/worker.js:5,18-21`; `vercel.json` hourly | `listCycles()` from settings prefix, capped at 100 | Adding a setting key | n/a | Both cycles processed independently | [VERIFIED via worker.js:18-21, config.js:36-41] |
| B6 | Board work enable switches (global, not cycle-keyed): `RESEARCH_LEADERSHIP_DIGEST_MODE` (`legacy`/`board-release`/`paused`) and `BOARD_WRITEUPS_ENABLED=on` | `lib/services/board-writeups/mode.js:2-7`; `lib/services/final-writeup/leadership-digest-service.js:372` | Vercel env | Redeploy | Default `legacy` | Switching to `board-release` changes the leadership digest for all cycles at once | [VERIFIED via mode.js:2-7] |

### 3.7 Reviewer Finder / Review Manager / external reviewer portal

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| RV1 | App-wide reviewer campaign defaults: `cycleLabel` (free text, max 120), `inviteStartDate`, `respondOffsetDays` (default 7), `proposalReleaseDate`, `reviewDueDate`, `desiredCount` (default 4) | `lib/services/reviewer-campaign-timeline.js:16-24,108-123`; admin UI `shared/components/admin/ReviewerCampaignTimelineSection.js` (in `WorkflowsWorkspace.js:214`); API `pages/api/review-manager/campaign-timeline-defaults.js` | Dataverse setting `reviewer.campaign_timeline_defaults` (single key) | Admin (Workflows workspace) | Blank dates until set. `inviteStartDate` and `proposalReleaseDate`: `inviteStartDate` has no runtime consumer found; `proposalReleaseDate` seeds `proposalSendDate` in the invite modal only | One value for all cycles; the label is not matched to anything. D26 values keep seeding until overwritten | [VERIFIED via reviewer-campaign-timeline.js; grep of `inviteStartDate` shows only the setting and admin UI] |
| RV2 | Invitation modal timing precedence (low to high): hard default `respondOffsetDays: 7` -> user sticky pref `reviewer_invite_timing` -> admin timeline default -> request campaign config | `shared/components/reviewers/InviteEmailModal.js:229,296-335,717`; `shared/config/reviewerFinderPreferences.js:32` | Hardcoded; per-user preference store; RV1; request columns | PD (modal), Admin | Sticky preference is rewritten on each send (`:717`) | A PD's last D26 dates pre-fill J27 invitations unless the admin default or request config is set | [VERIFIED via InviteEmailModal.js:296-335,717] |
| RV3 | Per-request campaign config: respond offset, review due date, reminder enable/lead, reviewer quota `wmkf_desiredcount` | `lib/services/review-manager/campaign-config-service.js:31-39`; UI `shared/components/reviewers/CampaignConfigModal.js:45-83` | Request columns `wmkf_respondoffsetdays`, `wmkf_reviewduedate`, `wmkf_respondreminder*`, `wmkf_reviewduereminder*`, `wmkf_desiredcount` | PD (Campaign settings modal) | Modal pre-fills blanks from RV1 (`reviewDueDate`, `desiredCount`, not offset) | Per proposal; this is the existing PD-adjustable layer | [VERIFIED via campaign-config-service.js:31-39, CampaignConfigModal.js:61-65] |
| RV4 | First invitation send seeds request columns "only if unset": offset and due date from the composer payload; quota from RV1 server-side | `lib/services/review-manager/send-emails-service.js:1203-1245` | Composer + RV1 | Automatic | Seeds once per request | The first D26/J27 send freezes whatever RV1 holds at that moment onto the request | [VERIFIED via send-emails-service.js:1203-1245] |
| RV5 | Review due date used in emails: per-suggestion override -> composer -> request `wmkf_reviewduedate` -> `wmkf_appgrantcycle.wmkf_reviewreturndeadline` | `lib/services/review-manager/render-emails-service.js:331-345`; `lib/external/reviewer-due-date.js:15-19` | A5 + request + suggestion `wmkf_reviewduedateoverride` | PD (override), Admin (cycle row) | n/a | Cycle-row deadline reaches emails only; portal, reminders and token expiry read only override then request (`context-service.js:250-253`, `reviewer-reminder-sweep.js:286-287`, `send-emails-service.js:988-992`). A cycle-row-only deadline is not enforced elsewhere | [VERIFIED via render-emails-service.js:331-345, context-service.js:250-253] |
| RV6 | Respond-by reminder: `emailSentAt + wmkf_respondoffsetdays`; review-due reminder from `wmkf_reviewduedate` minus lead days | `lib/services/reviewer-reminder-sweep.js:191-199,284-290` | Request columns | PD | n/a | Per request; no cycle input | [VERIFIED via reviewer-reminder-sweep.js:191-199] |
| RV7 | Reviewer link lifetime: non-responder = due date + 2 days; accepted = due date + 90 days; fallback 90 days | `lib/external/reviewer-token-ttl.js:19-38` | Hardcoded constants + due date | Code edit | n/a | Cycle-agnostic | [VERIFIED via reviewer-token-ttl.js:19-38] |
| RV8 | Automatic review DOCX filing cohort | `lib/services/review-documents/individual-file-service.js:42,1006,1050`; discovery `lib/dataverse/adapters/reviewer-suggestion.js:1551`; cron `pages/api/cron/file-review-docx.js` hourly; also `REVIEW_DOCX_SHAREPOINT_WRITE=on` | Vercel env `REVIEW_DOCX_SHAREPOINT_CYCLE` (exact code) compared to suggestion `wmkf_grantcyclecode` | Vercel edit + redeploy (one cycle at a time; invalid value fails closed with alert) | No default; exact code required | Pin value [ASSUMED] `D26`: D26 reviews file; J27 never discovered. docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md:47 (D11) records the decision to replace this with a calendar window, not built in source | [VERIFIED via individual-file-service.js:1006-1050, reviewer-suggestion.js:1551] |
| RV9 | Stale invitation sweep: pending invitations flip to `no_response` when the request meeting date is past (`graceDays` default 0) | `lib/services/reviewer-suggestion-sweep.js:6-8,39-41`; `pages/api/cron/sweep-stale-invites.js:28`; daily 09:00 UTC | Request meeting date + now | Query param for grace | Calendar-driven | D26 pending invitations expire from Dec 11 UTC automatically; J27 unaffected | [VERIFIED via reviewer-suggestion-sweep.js:6-8, sweep-stale-invites.js:28] |
| RV10 | Reviewer thank-you cron (daily 10:30 UTC) and reconcile jobs | `lib/services/reviewer-thankyou-sweep.js` | Review received; no cycle | n/a | n/a | Excluded: not cycle-aware (grep) | [VERIFIED via grep] |
| RV11 | Legacy per-user `reviewer_finder_grant_cycle_settings` (programName, reviewDeadline default `''`) | `shared/config/reviewerFinderPreferences.js:25,105-113`; `shared/context/ProfileContext.js:147,171` | Per-user preference (migration path only) | n/a | Blank | Only a migration references it; no runtime consumer found | [VERIFIED via grep; INFERRED unused] |
| RV12 | "My candidates" / "my proposals": cycle derived from request meeting date, stamp as fallback; cycle list newest first | `lib/services/reviewer-finder/my-candidates-service.js:128,224-242`; `my-proposals-service.js:11,54-59` | Request date / stamp | n/a | Caller-chosen cycle | No default | [VERIFIED via the cited lines] |
| RV13 | Test-request factory sets `wmkf_grantcyclecode` from destination meeting date and verifies it | `lib/services/test-requests/cast-binding-runner.js:73`; `run-runner.js:2481,3137` | Test run | Operator | n/a | Excluded: test tooling | [VERIFIED via cited lines] |

### 3.8 Staff Deliberations / pre-site

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| SD1 | Auto-prepare cohort: program ids x cycle codes x request statuses (+ excluded request numbers, state/status pairs, batch size, on/off, production, fence flags) | `lib/services/pre-site-visit/preparation-config.js:36-71`; worker `preparation-worker.js:51-76,203`; cron `staff-deliberations-preparation` every 15 min | Vercel env `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` (JSON list), plus `_PROGRAM_IDS`, `_REQUEST_STATUSES`, `_EXCLUDED_REQUEST_NUMBERS`, `STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS` | Vercel edit + redeploy | Empty list = not ready (`cycle_allowlist_missing`) | List is multi-cycle capable; live contents [ASSUMED] D26. J27 absent = no J27 auto-prep. Removing the list alone would widen the production scan | [VERIFIED via preparation-config.js:48-71, preparation-worker.js:71,203] |
| SD2 | Rail/cycle read model for Staff Deliberations | `lib/services/pre-site-visit/cycle-list-service.js:290-322` | Shell cycle | PD | n/a | Follows W1/W2 | [VERIFIED via cycle-list-service.js:290-322] |
| SD3 | Final write-up schedule gate reads the same env pairs | `lib/services/final-writeup/transition-schedule.js:22-24` | Vercel env | Redeploy | n/a | Not cycle-keyed | [VERIFIED via transition-schedule.js:22-24] |
| SD4 | Visit-expected assumption (see W10) | `shared/utils/deliberation-stage.js:59` | Hardcoded | Code | n/a | Same | [VERIFIED] |

### 3.9 Initial Assessment, Final write-ups

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| IA1 | Initial Assessment registry reads `?cycleCode`; cycle list when none given | `pages/api/workbench/initial-assessment.js:44-56`; artifact stamp `lib/services/initial-assessment/artifact-service.js:84` | Shell cycle | PD | n/a | Hidden for D26 (W5/W6) | [VERIFIED via initial-assessment.js:44-56] |
| FW1 | Final write-ups index default: newest of 3 newest cycles that has a viewer-visible row, else newest empty; `none` sentinel for requests without meeting date; explicit selector never walks back | `lib/services/final-writeup/dashboard-service.js:53,603-626` | Data (not calendar) | Constant `FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK = 3` (code) | Data-driven | Not date-based; does not flip on Dec 10 | [VERIFIED via dashboard-service.js:53,603-626] |
| FW2 | Handoff-email and leadership-digest crons | `pages/api/cron/final-writeup-handoff-emails.js`; `final-writeup-leadership-digest.js` | not cycle-keyed | n/a | n/a | Excluded: no cycle logic (digest governed by B6) | [VERIFIED via grep] |

### 3.10 Cycle Dossier (D26 pilot, superuser) and Virtual Review Panel

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| DS1 | Dossier cohort cycle | `lib/services/cycle-dossier-rollout.js:16,25`; `cycle-dossier-service.js:16,39` | Hardcoded `DOSSIER_CYCLE = 'D26'` | Code | n/a | D26 only, always | [VERIFIED via cycle-dossier-rollout.js:16-25] |
| DS2 | Database constraints and defaults pin D26 | `lib/db/migrations/045_cycle_dossiers.sql:5,16`; queries `lib/services/cycle-dossier-store.js:56,60` | Postgres CHECK `cycle = 'D26'` | New migration + code | n/a | J27 rows cannot be inserted | [VERIFIED via 045_cycle_dossiers.sql:5,16] |
| DS3 | Storage/title strings: folder `AI Artifacts/Cycle Dossier/D26/...`, titles `D26 Scientific Dossier`, file names `D26-...` | `lib/services/cycle-dossier-worker.js:158,321,351`; `cycle-dossier-service.js:264,268`; `cycle-dossier-documents.js:212`; `pages/cycle-dossier.js:481-505` | Hardcoded | Code | n/a | n/a | [VERIFIED via cited lines] |
| DS4 | Rollout env: `CYCLE_DOSSIER_ENABLED`, `CYCLE_DOSSIER_ROLLOUT_MODE` (pilot/smoke), `CYCLE_DOSSIER_OPERATOR_STOP`, `CYCLE_DOSSIER_REQUEST_ALLOWLIST`, `CYCLE_DOSSIER_OPERATOR_PROFILE_ID`; cron `drain-cycle-dossiers` every 5 min | `lib/services/cycle-dossier-rollout.js:41-51`; `pages/api/cron/drain-cycle-dossiers.js:8` | Vercel env | Redeploy | Disabled unless `ENABLED=true` | Feature gates, not cycle choice | [VERIFIED via cycle-dossier-rollout.js:41-51] |
| DS5 | Virtual Review Panel is explicitly not cycle-scoped (migration 047 dropped the `cycle='D26'` constraint) | `lib/db/migrations/047_review_panel.sql:5`; `lib/services/review-panel-rollout.js:25` | n/a | n/a | n/a | Excluded: not cycle-bound (env `REVIEW_PANEL_ENABLED`) | [VERIFIED via 047_review_panel.sql:5] |

### 3.11 Admin, intake and others

| ID | Surface and effect | Location | Source of value | Who changes / how | Default and flip | Dec 7-10 / after Dec 10 | Evidence |
|---|---|---|---|---|---|---|---|
| X1 | Admin edit of the reviewer campaign defaults ("Grant cycle label" placeholder `D26`) | `shared/components/admin/ReviewerCampaignTimelineSection.js:106-115` | Admin input | Admin | n/a | Placeholder text only | [VERIFIED via ReviewerCampaignTimelineSection.js:115] |
| X2 | Intake form schema registry keyed to `phase-ii-research-2026-06` | `lib/utils/form-schema.js:12-15` | Hardcoded | Code | n/a | Parked portal; frozen to the June 2026 form | [VERIFIED via form-schema.js:12-15] |
| X3 | GOApply opportunity Phase 1 due dates (e.g. record 001024 due Dec 7, 2026) exist in Dataverse but no runtime code reads `akoya_akoyaapply` | docs/audits/cycle-foundations-2026-10-21.md:71-84; `lib/services/graph/constants.js:37` (name only) | Dataverse (GOApply) | Connor / GOApply admin | n/a | The Dec 7 date is not read by this app | [VERIFIED via grep; table from audit doc] |
| X4 | Dormant `shared/config/d26Allowlist.js` (`D26_ALLOWLIST_CYCLE_CODE`) | `shared/config/d26Allowlist.js:36` | Hardcoded; retired | n/a | No runtime import (comments only in `dashboard-service.js:13,279`) | Excluded: dead | [VERIFIED via grep] |
| X5 | Dataverse marker-maintenance allowlist for D26 test rows | `lib/dataverse/client.js:162,367` | Hardcoded request numbers | Code | n/a | Excluded: operator tooling | [VERIFIED via client.js:162,367] |
| X6 | Dynamics Explorer prompt text describing `akoya_fiscalyear` | `shared/config/prompts/dynamics-explorer.js:37,55` | Prompt text | Prompt governance | n/a | Excluded: description only | [VERIFIED via file] |

### 3.12 Cron jobs (vercel.json, 32 scheduled entries)

| Cron | Schedule | Cycle/date logic | Row |
|---|---|---|---|
| generate-grantee-titles | `0 6 * 4-6,10-12 *` | Conventional working cycle, month window | G3 |
| file-review-docx | hourly | Env cycle pin | RV8 |
| staff-deliberations-preparation | every 15 min | Env cycle list | SD1 |
| board-writeups | hourly | Every cycle in settings; Pacific 09:00 and `boardEnds` | B3, B5 |
| drain-cycle-dossiers | every 5 min | D26 only | DS1-DS4 |
| sweep-stale-invites | daily 09:00 UTC | Meeting date < now | RV9 |
| drain-review-panels, drain-review-syntheses, drain-reviewer-acceptances, drain-submissions, drain-materials-uploads, drain-meeting-material-preparations, drain-zoom-video-copies, drain-presentation-video-splits, drain-presentation-transcript-regenerations, drain-transcriptions (x2) | minutely/2-5 min/daily | none (grep) | Excluded |
| maintenance, health-check, secret-check, log-analysis, spend-check, reconcile-identities, refresh-irs-bmf, send-review-thankyous, reviewer-email-reconcile, auth-bypass-check, pricing-canary, pricing-refresh, grantee-deliverable-reminders, final-writeup-handoff-emails, final-writeup-leadership-digest | various | none (grep) | Excluded |

`pages/api/cron/reviewer-reminders.js` and `site-visit-materials-reminders.js` exist but are not in `vercel.json` (reminders run through the sweep libraries; invoked elsewhere or manually) [INFERRED, not traced].

---

## 4. Coverage sweep (disconfirming)

Scope searched (non-test source): `lib pages shared app modules proxy.js instrumentation.js next.config.js vercel.json` (tests, docs, `scripts/`, `.claude`, `node_modules` excluded).

| Sweep | Hits | Result |
|---|---|---|
| `\b[DJ]2[0-9]\b` (any context) | 100 lines in 46 files (schema JSON excluded) | All 46 files opened or grepped. Behavior-changing: 13 sites (rows W5, W6, W7, B1, B4, R2, R3, DS1-DS3, RV8 doc, SD1 doc, W10). Comment/docs-only or examples (excluded): `lib/utils/cycle-code.js` (docs), `proposal-document-names.js` (comment), `workbench-proposal-documents.js` (comments), `deliberation-stage.js`, `StaffDeliberationsTab.js`, `cycle-list-service.js`, `consultant-feedback-service.js`, `filename-rules.js`, `review-panel-rollout.js`, `research-funding.js`, `triageStatus.js`, `word-export.js`, `grantee-title.js`, `granteeResearchPrograms.js`, `appRegistry.js` (notes), validation messages/examples in these route files (`cycle-export`, `awardees`, `final-writeups`, `staff-deliberations`, `initial-assessment`, `expertise-finder/proposals`, `generate-grantee-titles`), `review-documents/repair-service.js` and `backfill-service.js` (CLI error text), `modules/expertise_matching/src/reviewer_matcher.jsx` (sample prose mentioning "J26"), `d26Allowlist.js` (dead, X4), `lib/dataverse/client.js` (X5). |
| Quoted literal in code (not comment) `'D26'`/`'J27'` etc. | 25 lines | All 25 map to rows above or exclusions (X4, X5, DS*, W5-W7, B1, B4, R2, R3) |
| `meetingDateToCycleCode(` | 49 call sites in 38 files | All classified: 14 sites feed defaults/pins (dashboard, briefing, awardees, preparation-config/worker, trial-cutoff, individual-file-service, program-scope, board notifications/source, final-writeup dashboard) = rows; remaining ~24 are pure derivation for display/stamp (W11, RV12, A7); 0 apply a default or restriction I did not list |
| `resolveWorkingCycle|resolveLastDecidedCycle|conventionalCycles` callers | 8 files (dashboard-service, awardees-service, program-briefing-service, ProposalRankingApp, expertise-finder, generate-grantee-titles; plus definitions in cycle-code.js) | All rows: W1, G1, M2, R1, E1, G3 |
| `process.env.*CYCLE*` / `*ROLLOUT*` | 4 hits in runtime (`CYCLE_DOSSIER_ENABLED` x2, `CYCLE_DOSSIER_ROLLOUT_MODE`, `REVIEW_DOCX_SHAREPOINT_CYCLE` via indirection) + `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` via `env.` argument | All rows: RV8, SD1, DS4. Scripts-only hits (`CYCLE_DOSSIER_PROMPT_MODEL`, `CYCLE_DOSSIER_UI_URL`, `HONORARIUM_LINK_ROLLOUT_AT`) excluded (operator scripts) |
| `cycleCode = '...'` literal defaults | 2 hits (`WorkbenchShell.js:168` clears cycle on program change; `MeetingTrackerList.js:235` empty option) | Not defaults; excluded |
| `getSetting*(` key literals/constants | 6 cycle-or-date-relevant keys among ~25 key families (`reviewer.campaign_timeline_defaults`, `board_writeups.cycle.*`, `site_visit_materials.due_business_days`, `meeting_tracker.default_attendees`, `proposal_ranking.default_facilitator*`, `stage.deliberations.*`) | Rows RV1, B2, M6; others excluded as non-cycle (`email.*` template copy, `alertRecipientsByCategory`, `executor.budgets.v*`, `final_writeup.matrix_audiences`, `site_visit.distribution_recipient_directory`, `secret_*`) |
| Date arithmetic with `getUTCMonth/getMonth/getFullYear` | ~35 hits | All unrelated (publication-search lookbacks, calendar-invite formatting, validation) except cycle-code.js and honorarium fiscal-year (A8) |
| Hardcoded 2026/2027 date literals in runtime | none cycle-related | `LAST_REVIEWED_AT`/`reviewedAt` model metadata only |
| `wmkf_grantcycle` operations table | 0 runtime hits | A4 |
| Browser storage keyed on cycle | 0 | W2 |

Totals (approximate): the sweeps returned roughly 100 literal lines, 49 `meetingDateToCycleCode` calls, 8 default-resolver files, 5 env reads, ~25 settings key families and ~35 date-arithmetic lines (about 220 hits). Each is covered by one of the 74 rows or by an exclusion reason stated above (comment/example text, scripts, derivation-only stamps, dead code, non-cycle settings). I classified the `meetingDateToCycleCode` calls by file and opened the ones that could apply a default or restriction; I did not open every one of the pure-derivation call sites.

---

## 5. Could not verify

- Live Vercel values: `REVIEW_DOCX_SHAREPOINT_CYCLE`, `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES`, `CYCLE_DOSSIER_*`, `RESEARCH_LEADERSHIP_DIGEST_MODE`, `BOARD_WRITEUPS_ENABLED` [ASSUMED from docs; docs/J27_TRANSITION_REGISTER.md J27-047/J27-084 describe them].
- Stored value of `reviewer.campaign_timeline_defaults` and of `board_writeups.cycle.D26`, and whether a `wmkf_appgrantcycle` row for J27 exists.
- Actual `wmkf_meetingdate` values on D26/J27 requests (test request in `d26Allowlist.js:49` carries 2026-12-11; the owner states the Board meets Dec 10). The Workbench flip day is the day after the latest ordinary D26 request's value, so this matters by one or more days. Date-only vs date-time storage and time zone are also unverified.
- Whether J27 requests will be visible to the Workbench on Dec 7 (depends on status mapping at intake; visibility needs `Phase II Pending` or triage Advancing).
- Who edits `wmkf_meetingdate` in practice (the app only writes it in the test factory and honorarium onboarding).
- `inviteStartDate` in `reviewer.campaign_timeline_defaults` has no runtime consumer I could find (grep of `inviteStartDate` only hits the setting module and admin UI); confirm it is display-only.
- Whether `pages/api/cron/reviewer-reminders.js` and `site-visit-materials-reminders.js` are triggered by anything outside `vercel.json`.
- Production behavior (no probes run): all "what happens" statements are derived from source.
- The Feb 24 / Mar 17 dates come from docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md, not from any runtime source.
