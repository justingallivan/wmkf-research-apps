---
title: Stop reading the request meeting date — inventory and plan
domain: cycles
kind: plan
status: draft
summary: "Owner, 2026-10-29: no app reads akoya_request.wmkf_meetingdate; a request's cycle comes from its Grant Cycle link (wmkf_grantcycle) and cycle dates from that linked calendar row, with no meeting-date fallback. Whole-repo inventory (106 runtime files, 69 scripts, plus indirect readers through helpers), grouped by what each read is for, the behavior changes, two existing bugs found, a central-helper strategy, and the owner decisions needed before building. Nothing built; PR #552 already moved the reviewer email path."
canonical: false
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md
  - docs/plans/CYCLE_DATES_CENTRALIZATION_PLAN_2026-10-29.md
  - docs/audits/date-consumers-audit-2026-10-29.md
  - docs/atlas/dataverse-akoya-request.md
---

# Stop reading the request meeting date (work queue 6a)

## 1. Direction

Owner, 2026-10-29: nothing in the apps reads `akoya_request.wmkf_meetingdate`.
A request's cycle is its Grant Cycle link (`akoya_request.wmkf_grantcycle`, read
as `_wmkf_grantcycle_value`; alignment log T10). Cycle dates (Board date, Reviews
Due and the rest) come from that linked operations `wmkf_grantcycle` row, the
cycle calendar. No meeting-date fallback (confirmed for invitations; this plan
asks to confirm it everywhere, §7 Q1).

Already done: PR #552 (deployed 2026-10-29) moved the reviewer email path
(invitation due date, cycle config, draft fingerprint) to the link.

## 2. Method and completeness

- **Direct readers** [VERIFIED via `git grep -i` for `wmkf_meetingdate`,
  `meetingDate`, `meeting_date`, `meetingDateToCycleCode`,
  `cycleCodeToOdataFilter`, `isPastCutoff`, 2026-10-29]: 710 lines in 106 runtime
  files under `lib pages shared` and 69 scripts. Every line was classified by
  entity and purpose (three read-only agents, one per area; their tables are
  summarized here). **Evidence level:** file:line references in §3 are
  [AGENT-REPORTED, 2026-10-29], not re-read by the plan author; re-verify each at
  build time. Read directly by the author: the two bugs in §6, the
  `reviewer-request-context.js` → COI path, and the `cycleCodeToOdataFilter` /
  `meetingDateToCycleCode` caller lists [VERIFIED via `git grep`].
- **Indirect readers:** a grep cannot find a file that only receives a derived
  value. Each helper that returns a meeting-date-derived field (`meetingDate`,
  `cycleCode`, `meetingCycleCode`, a cycle list, a boolean) was traced to every
  caller and to the browser components that read the response. The earlier
  PR #552 check missed one such path (the first-manual-invitation COI service,
  through `loadCoiContext`); it is covered here (§3.2). Two more paths reach the
  honorarium write through the external-review token (§3.5).
- **Not the request's date (stays):** the calendar's Board date
  (`wmkf_grantcycle.wmkf_meetingdate`, `shared/config/cycleCalendar.js`), the
  apps cycle table schema (`wmkf_appgrantcycle.wmkf_meetingdate`), and the
  "meeting date" an LLM extracts from an uploaded PDF cover page (Phase II
  writeup, `word-export.js`, proposal summarizer and extraction schema).

## 3. Inventory by purpose

### 3.1 Cycle filters (which requests are in cycle X)

`cycleCodeToOdataFilter` turns a code into a `wmkf_meetingdate` month range.
Non-test callers [VERIFIED via `git grep`]: `proposal-ranking-source.js:93`;
`reviewer-suggestion.js:1568,1774,1848`; `board-writeups/source.js:22`;
`cycle-dossier-rollout.js:25`; `expertise-finder/proposals-service.js:41`;
`final-writeup/dashboard-service.js:153`; `program-briefing-service.js:87`;
`pre-site-visit/cycle-list-service.js:322`; `preparation-worker.js:53`;
`my-proposals-service.js:115`; `workbench/dashboard-service.js:278`;
`awardees-service.js:123`; `cycle-export-service.js:63`;
`pages/api/cron/generate-grantee-titles.js:44`. Two routes call it only to
validate a code (`pages/api/workbench/grantee-deliverables/awardees.js:41`,
`cycle-export.js:35`; use `parseCycleCode`).

Hand-written filters that bypass the helper: `request-search-service.js:81,161,163`;
`workbench/dashboard-service.js:149-150`; `awardees-service.js:84-85`;
`my-proposals-service.js:76-80,147`; `program-briefing-service.js:87` (`ne null`);
`final-writeup/dashboard-service.js:152` (`eq null` = "No cycle"), `:167`;
`grant-request.js:314-332` `aggregateMeetingDateCycles` (cycle dropdown counts).

### 3.2 Cycle membership per request (which cycle is this request in)

`meetingDateToCycleCode` callers, about 34 sites: reviewer-suggestion adapter
(`meetingCycleCode`), board-writeups notifications and `ordinary()`,
consultant-feedback attachments, Final Writeups dashboard, Initial Assessment,
program briefing, post-presentation materials (`loadBoundContext`), pre-RP brief,
pre-site-visit (allowlist, worker, proposal core), Proposal Ranking D26 trial
cutoff, individual review filing fallback, Review Manager reviewers,
contact history, my-candidates, my-proposals, reminder liveness audit,
reviewer request context, site-visit materials contributors, site-visit
logistics label, the Test Request Factory runner, applicant reviewers,
Workbench dashboard, proposal documents (two), candidate export, awardees,
manual reviewer, program scope, request search, resolve-request. Full list with
lines in the slice reports; each becomes "code of the linked row".

**Persisted copies of a derived code** (these were written from meeting dates and
stay as stored): `wmkf_requestdocument.wmkf_cyclecode` (consultant feedback,
site-visit contributors, post-presentation materials, transcripts, Initial
Assessment, pre-site visit); `wmkf_appreviewersuggestion.wmkf_grantcyclecode`
(manual reviewer, applicant reviewers, Factory); Initial Assessment generation
key; pre-site-visit receipts `cycle_code`. For Research J/D requests the link
and the date agreed on all but one of ~3,400 requests since 2024 (T10), so
existing stored codes stay valid; no backfill proposed (§7 Q6).

**Indirect: `reviewer-request-context.js`** returns `meetingDate` and
`cycleCode`. Its consumers: `analyze.js` and `enrich-recommended-service.js`
(fields dropped before the LLM or browser); the first-manual-invitation COI
service and `promote-applicant-reviewer-service.js` (read only institutions and
PI, not the derived fields); `save-candidates-service.js:662` (meant to stamp the
code; see bug 1, §6).

### 3.3 Cycle lists and the default cycle

Four services build a cycle list from the latest request meeting date per cycle
and feed it to `resolveWorkingCycle` / `resolveLandingCycle` /
`resolveLastDecidedCycle` (`cycle-code.js:92,110`):
`workbench/dashboard-service.js:162-208`, `awardees-service.js:97-106`,
`program-briefing-service.js:95-100`, `my-proposals-service.js:76-97`. Plus
`program-scope-service.js:87-94` (a PD's newest cycle picks the default program).
Replacement: cycles from the link, dates from the calendar (`listBoardDates`).

### 3.4 "Has a meeting date" gates

`meeting-coordination/invitation-service.js:35` (and `:44` copies the raw date
into a hashed snapshot); `meeting-tracker-transcription/binding.js:42`;
`site-visit-materials/collection-service.js:567,890`;
`site-visit/logistics-service.js:167`. Generation gates that need a J/D code:
Initial Assessment (`artifact-service.js:84`), pre-RP brief (`input-service.js:79`),
pre-site visit (`proposal-core-service.js:340`), post-presentation materials
(`material-service.js:262`). Replacement: "has a Grant Cycle link".

### 3.5 Date arithmetic and writes

- **Stale invitation expiry:** `reviewer-suggestion-sweep.js:70-96` (cron
  `sweep-stale-invites`) and `reviewer-engagement/expire-invitation.js:68-73`
  via `isPastCutoff`; the Review Manager's "Recorded by automated cycle close"
  label (`reviewer-activity-history.js:275`, from `reviewers-service.js:381`)
  must use the same date. Replacement: the linked row's Board date (§7 Q4).
- **Honorarium onboarding (a write):** `lib/bill/honorarium-onboard-orchestrator.js:144-172,898`
  requires the parent's meeting date, derives `akoya_fiscalyear` ("June 2026")
  from it, and copies `wmkf_meetingdate` onto the new honorarium request. The
  value arrives from `verify-suggestion-token.js:67` → acceptance job payload
  (`respond-service.js:430`) → drain. Change the orchestrator before the token
  select (§7 Q5).
- **Historical award recency** (other, older requests): `funding-history.js:134`,
  `proposal-core-service.js:279-280`, `research-funding.js:36`,
  `proposal-ranking-source.js:63` use the meeting date as a fallback after the
  decision date or fiscal year (§7 Q3).
- **Request-file corpus** (offline index, no route reads it):
  `index-store.js:22-23,97-109`, migration 090 `meeting_date` (§7 Q8).

### 3.6 Displays and pass-through fields

- Shown to staff: Workbench Overview "Board Meeting" (`resolve-request-service.js:91`
  → `OverviewTab.js:136`); pre-site-visit writeup `[[DV:MeetingDate]]`
  (`proposal-core-service.js:352`, fingerprinted snapshot `artifact-model.js:229,542`);
  prior-request label on candidate cards (`reviewer-contact-reconciliation.js:168`
  → roster cache `reviewer-roster-projection.js:246` →
  `reviewer-prior-request-context.js:7-8`, its own "Month YYYY" regex); request
  search "(off-cycle)" and "Unclassified" labels (`request-search-service.js:100-122`);
  user CSV export column (`dataverse-export/constants.js:341`).
- Sent but not read by any screen found: external review and grantee context
  `meetingDate`, contact history, my-proposals, my-candidates cycle fields,
  applicant-reviewers `cycleCode`, Review Manager proposal `meetingDate`. Remove.
- Selected but never used: `cycle-dossier-service.js:31`,
  `briefing-page-service.js:76`, `expertise-finder/proposals-service.js:45`,
  `reviewer-suggestion.js:1575`. Remove.

### 3.7 Test Request Factory (sandbox clones)

The Factory copies the source request's meeting date to the clone, has a
`correct_meeting_date` step (undoes a sandbox business rule, with two error codes,
UI copy and a ledger column `test_request_runs.meeting_date DATE NOT NULL`,
migration 054/058), and later derives the clone's cycle from it (`run-runner.js:1158,2256`,
`cast-binding-runner.js:72`, `presite-sandbox-deps.js:382`). Clones never set the
Grant Cycle link today. Moving the Factory needs the link on clones
(`wmkf_GrantCycle@odata.bind`, `wmkf_grantcycles` in `production-write-fence.js`
`REQUEST_BIND_SETS`, matching sandbox cycle rows), a new ledger migration, and
changed bundle digests (§7 Q7).

### 3.8 Dynamics Explorer

`shared/config/prompts/dynamics-explorer.js:55,541,648` teaches the model to
slice by `wmkf_meetingdate`; `dynamics-explorer/tools/get-entity.js:31` selects it
(§7 Q8).

### 3.9 Scripts

Operator scripts that use the helpers (backfills, pre-site drafts, ranking
access, smoke tests) follow the helper change. One-off probes and historical
backfills stay as written; `probe-request-grant-cycle-lookup.cjs` compares link
and date on purpose and stays.

## 4. Behavior changes to expect

1. **Discretionary programs** (Directors'/Staff/Senior Staff Directed, Matching)
   have meeting dates but no Grant Cycle link (T10). Today they land in a June or
   December cycle wherever a surface is not limited to Research: Workbench with
   the Discretionary program selected (cycle list, proposals, Staff Deliberations,
   search, Overview), Expertise Finder (no program filter), the default-program
   choice, the "has a meeting date" gates (§3.4) and the Final Writeups "No cycle"
   bucket. After the change they have no cycle. Research-only surfaces (board
   writeups, Proposal Ranking, program briefing, awardees, cycle export, dossier,
   auto-prepare) are unaffected.
2. **Historical requests.** T10 covered requests since 2024. Awardees, cycle
   export, request search, funding history and Workbench history list older
   cycles; whether older requests carry the link is unknown [ASSUMED unknown] and
   needs an owner-run probe (§8).
3. **Off-month dates disappear.** Search's "(off-cycle)" month labels and the
   Final Writeups off-month error go away; a request is in its linked cycle or in
   none.
4. **Request 1003373** (J27 link, J26 date) moves to J27 everywhere. Owner,
   2026-10-29: not a Research request; Connor is looking at it; low priority.

## 5. Strategy

- **Two shared helpers do most of the work.** Replace `cycleCodeToOdataFilter`
  with a link filter and `meetingDateToCycleCode` callers with "code of the
  linked row". Filter shape to verify before building: a navigation filter
  (`wmkf_GrantCycle/wmkf_cyclecode eq 'J27'`) needs no extra read; the
  navigation property name is [ASSUMED] and must be read from metadata. For rows,
  `$expand` of the linked code avoids one read per request; otherwise batch
  `cycleCodesByGrantCycleId` (built in PR #552).
- **Every `akoya_request` select that carries `wmkf_meetingdate` gains
  `_wmkf_grantcycle_value` (or the expand)**; about 50 select lists, listed in
  the slice C report. Then remove `wmkf_meetingdate` from each.
- **Board-date reads** use `listBoardDates` / `getCycleDatesById`.
- **Gate:** add a check that fails on new `akoya_request` reads of
  `wmkf_meetingdate` and new `meetingDateToCycleCode` calls outside an allowlist
  (calendar, probes), so the class does not come back.

Proposed PRs, each with focused tests and a Codex review:

1. Helpers, adapters and the Research surfaces (filters, membership, cycle lists,
   default cycle), plus the two bugs in §6.
2. Gates, displays and pass-through removals (§3.4, §3.6), after Q2–Q3.
3. Stale-invite expiry and the honorarium write (§3.5), after Q4–Q5.
4. Test Request Factory (§3.7), after Q7, with its ledger migration.
5. Explorer, corpus and scripts (§3.8–3.9) as decided; then the gate.

## 6. Existing bugs found

1. **Reviewer Finder saves never stamp the cycle code** [VERIFIED via
   `save-candidates-service.js:662`, `reviewer-request-context.js:303-309`,
   `reviewer-suggestion.js:537`]. The service reads `coiContext.cycleCode`, but
   `loadCoiContext` nests it at `requestContext.cycleCode`, so every new
   suggestion from Reviewer Finder is created with `wmkf_grantcyclecode` null
   (since `f766b004d`). The unit test mocks the wrong shape
   (`tests/unit/save-candidates-service.test.js:1118`). Review filing still works
   because it falls back to the request (`individual-file-service.js:230-236`).
   Fix in PR 1 with the link-based code.
2. **My-candidates PD scope reads fields the adapter does not return** [VERIFIED
   via `my-candidates-service.js:231-233`, `reviewer-suggestion.js:1798-1804`]:
   it reads `request.cycleCode` / `cycleLabel`, the adapter returns
   `meetingCycleCode`. No screen reads the result, so the effect is nil today.

## 7. Decisions for the owner

1. **No fallback everywhere?** A request with no Grant Cycle link has no cycle on
   every surface (confirmed for invitations only).
2. **Discretionary requests** (§4.1): accept that they leave June/December
   cycles and are refused by the "has a meeting date" gates (presentation
   invitations, transcription, site-visit logistics and materials), or should
   those gates accept discretionary requests some other way?
3. **Displays:** the Workbench "Board Meeting" date and the pre-site-visit
   writeup's meeting date become the linked cycle's Board date (the decision day,
   D47), or blank when there is no link? Historical award recency (§3.5) uses the
   decision date and fiscal year only?
4. **Stale invitation expiry** keys on the linked cycle's Board date?
5. **Honorarium requests:** set the Grant Cycle link instead of copying the
   meeting date, and take `akoya_fiscalyear` from the calendar Board date? Does
   AkoyaGO or any flow need `wmkf_meetingdate` on honorarium requests?
6. **Stored cycle codes:** keep codes already written from meeting dates (no
   backfill)?
7. **Test Request Factory:** copy the link to clones, and drop the
   meeting-date copy and the `correct_meeting_date` step?
8. **In or out of scope:** Dynamics Explorer prompt and `get_entity`; the
   request-file corpus index; the user CSV export column; one-off scripts.

## 8. Data needed (owner-run, read-only)

Extend `scripts/probe-request-grant-cycle-lookup.cjs` to count requests by
(link present, meeting date present, program, decision year), including before
2024, so §4.1 and §4.2 have numbers. Production read; owner runs it.
