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
  - docs/CONNOR_DATA_CLEANUP_QUESTIONS.md
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

0. Sandbox Grant Cycle rows and request links (§5a), with owner approval for
   the sandbox writes.
1. Helpers, adapters and the Research surfaces (filters, membership, cycle lists,
   default cycle), plus the two bugs in §6.
2. Gates, displays and pass-through removals (§3.4, §3.6), after Q2–Q3.
3. Stale-invite expiry and the honorarium write (§3.5), after Q4–Q5.
4. Test Request Factory (§3.7), after Q7, with its ledger migration.
5. Explorer, corpus and scripts (§3.8–3.9) as decided; then the gate.

## 5a. Contract check (2026-10-29, `/contract-reconcile` review mode)

Verified by the author before the Codex review:

- **Navigation property** [VERIFIED via sandbox metadata read, 2026-10-29]:
  `akoya_request.wmkf_grantcycle` → `wmkf_grantcycle`, relationship
  `wmkf_grantcycle_akoya_request`, navigation property `wmkf_GrantCycle`. Filter
  `wmkf_GrantCycle/wmkf_cyclecode eq 'J27'`; bind `wmkf_GrantCycle@odata.bind`.
  `queryRecords` already supports `$expand` and runs it through the restriction
  check [VERIFIED via `lib/services/dynamics/read-ops.js:56-77`].
- **Sandbox has no Grant Cycle rows and no linked requests** [VERIFIED via
  sandbox read, 2026-10-29: `wmkf_grantcycles` empty]. After the migration
  nothing cycle-dependent can be rehearsed in the sandbox, Factory or otherwise,
  until the sandbox has J/D cycle rows and linked requests. **New PR 0:**
  create the sandbox cycle rows (sandbox write; owner approval) and decide how
  sandbox requests get links. It precedes every other PR.
- **Saved fingerprints and hashes that include the meeting date** (each fails
  closed; none silently sends stale content):
  - Staff Deliberations writeup snapshot: unchanged if the month-year format is
    kept (§7 Q3) [VERIFIED] for the meeting-date line; the funding-history text
   can still change (§5b item 4).
  - Initial Assessment generation key: holds the cycle code, identical from
    the link for D26 [VERIFIED via `initial-assessment/artifact-service.js:84-107`].
  - **Presentation invitation previews** (`meeting-coordination/invitation-service.js:25,30,106`
    [VERIFIED]): the frozen snapshot hashes the raw meeting date as `cycle`;
    any change to that value makes every prepared-but-unsent preview stale
    ("Prepare a fresh preview"). Replace it with the linked cycle code and
    deploy when no previews are waiting, or tell coordinators to re-prepare.
  - Review-filing operator backfill and repair plans
    (`individual-file-service.js:270,329`; `backfill-service.js:339`;
    `repair-service.js:258` [VERIFIED]): a plan saved before the deploy is
    refused after it; re-plan.
- **Date-day difference:** D26 requests carry 2026-12-11; the calendar Board
  date is recorded as 2026-12-10 (D45) [not re-read]. Anything that keys a day
  (stale-invite closing, honorarium and Factory dates) moves one day earlier;
  month-year displays do not change.
- **Production write fence** [VERIFIED via `production-write-fence.js:52-56`]:
  `REQUEST_COLUMNS` keeps `wmkf_meetingdate` (the Factory still writes it,
  §7 Q7); `REQUEST_BIND_SETS` gains `wmkf_grantcycles`.
- Not re-verified by the author (agent-reported): the per-file select lists and
  line numbers in §3. Each PR re-verifies its own files.

## 5b. Codex plan review (2026-10-29) — verdict "needs attention"; all four verified

1. **Restriction checks do not cover the linked table** [VERIFIED via
   `lib/services/dynamics/restrictions.js:55-88`]: a field restriction on an
   expanded table is enforced only when it is the parent table, and navigation
   filters are not checked; the calendar adapter's raw reads (`getCycleDatesById`,
   `listBoardDates`, `findCycleByCode`) skip `checkRestriction` (the first added
   by PR #552). A table-level block on `wmkf_grantcycle` does catch an expand
   (the navigation name contains the table name). **Required:** the shared cycle
   helper calls the restriction check for `wmkf_grantcycle` /
   `wmkf_cyclecode` explicitly before any filter, expand or batch read, with
   negative tests for table- and field-restricted callers on each path.
2. **`grant-request.getById` drops `expand`** [VERIFIED via
   `grant-request.js:91-97`]. **Required:** PR 1 either adds expand support to
   the adapter or every `getById` caller selects `_wmkf_grantcycle_value` and
   resolves the code; tests go through the real adapter, not mocked expanded
   rows.
3. **Cached reviewer enrichment** [VERIFIED via `reviewer-search-logic.js:31-33`,
   `enrich-recommended-service.js:411`]: roster candidates persist prior-request
   `meetingDate` and are reused while `APPLICANT_ENRICHMENT_CACHE_VERSION`
   matches. **Required:** bump the version with the producer change so cached
   rows refresh to the linked-cycle label.
4. **Staff Deliberations writeup fingerprint** [VERIFIED via
   `pre-site-visit/artifact-model.js:234`]: the snapshot also holds the funding
   history text; Q3 (no meeting-date fallback for past grants) can change it when
   a past grant lacks a fiscal year or decision date, even though the
   meeting-date line stays the same. §5a's "unchanged" applies to that line only.
   **Resolved (owner, 2026-10-29): no hold, no count.** Nothing compares a
   stored draft fingerprint with current data (only the record adapter reads
   `wmkf_inputfingerprint`; regeneration reuses the stored value) and the
   auto-prepare worker runs once per site visit and reuses a document already
   in Review [VERIFIED via `git grep inputfingerprint`,
   `pre-site-visit/artifact-service.js:145-162,253-258`,
   `preparation-worker.js:362-376`]. D26 drafts are with the CSO for final
   review, then go to the President outside the apps; no one regenerates them.
   Still test the missing-date cases for new drafts.

Also from the review: remove `wmkf_meetingdate` from a select list only after
every consumer of that select has moved, including later-PR gates, expiry,
honorarium and Factory paths.

## 6. Existing bugs found

1. **Reviewer Finder saves never stamp the cycle code** [VERIFIED via
   `save-candidates-service.js:662`, `reviewer-request-context.js:303-309`,
   `reviewer-suggestion.js:537`]. The service reads `coiContext.cycleCode`, but
   `loadCoiContext` nests it at `requestContext.cycleCode`, so every new
   suggestion from Reviewer Finder is created with `wmkf_grantcyclecode` null
   (since `f766b004d`, 2026-09-08). The unit test mocks the wrong shape
   (`tests/unit/save-candidates-service.test.js:1118`). Review filing still works
   only for rows another write later stamps: the hourly filing job discovers
   suggestions by stamped code alone (`reviewer-suggestion.js:1530-1555`
   [VERIFIED]); the per-row fallback (`individual-file-service.js:230-236`) and
   the operator backfill cover the rest. D26 impact: none (all 221 D26
   suggestions stamped, §7 Q6). Fix in PR 1 with the link-based code.
2. **My-candidates PD scope reads fields the adapter does not return** [VERIFIED
   via `my-candidates-service.js:231-233`, `reviewer-suggestion.js:1798-1804`]:
   it reads `request.cycleCode` / `cycleLabel`, the adapter returns
   `meetingCycleCode`. No screen reads the result, so the effect is nil today.

## 7. Decisions for the owner

1. **No fallback everywhere?** **Decided (owner, 2026-10-29): yes.** Every
   surface uses only the link; a request without one shows as "No cycle". The
   older-years probe (§8) runs before the screens that list past cycles
   (awardees, cycle export, search, funding history) switch; a gap there is fixed
   in Dynamics data, not with app fallback code. **Probe done 2026-10-29
   (owner-authorized, read-only, counts only):** Research link coverage is
   54–69% (2005–2009), 69–91% (2010–2014), 97–100% (2015 on). Every Research
   request whose link differs from its meeting-date cycle (2016–2020) has an
   off-month meeting date (Jan, Jul, Aug and so on) that yields no cycle today,
   so the link adds a cycle rather than contradicting one. A meeting-date
   fallback would place only about 140 Research requests (mostly 2010–2014)
   with a June/December date and no link. Owner, 2026-10-29: keep link-only and
   ask Connor to fill those links (`docs/CONNOR_DATA_CLEANUP_QUESTIONS.md` DC1;
   low priority).
2. **Discretionary requests** (§4.1). **Decided (owner, 2026-10-29):** the apps
   are not used for discretionary requests, so their leaving June/December cycles
   and the link gates refusing them is acceptable. SoCal follows the Research
   cycles.
3. **Displays.** **Decided (owner, 2026-10-29):** the Workbench Overview "Board
   Meeting" field shows the linked cycle's calendar Board date (D47 decision day),
   or "Not set" with no link or no calendar date; the Staff Deliberations writeup
   prints that date's month and year; candidate cards show the linked cycle's
   label. Build constraint: keep the writeup snapshot field `meetingDate` and the
   `formatMeetingDate` month-year format [VERIFIED via
   `proposal-core-service.js:119-128,352`, `artifact-model.js:229`] so live D26
   drafts (Board meeting still ahead) do not change fingerprint for that line;
   test it. The funding-history text can change only for a draft generated
   after the deploy (§5b item 4); D26 drafts are final.
   Historical award recency (§3.5). **Decided (owner, 2026-10-29):** past grants
   use only their own fiscal-year label and decision date (writeup "awarded in"
   and Proposal Ranking: fiscal year, then decision date; most-recent-grant
   ordering: decision date, then the fiscal-year label as a date); no meeting
   date; a grant with neither shows no year. The §8 probe also counts past
   Research grants with neither field.
4. **Stale invitation expiry.** **Decided (owner, 2026-10-29):** the daily sweep
   (`vercel.json:100-101`), the per-row recheck (`expire-invitation.js`) and the
   "Recorded by automated cycle close" label all use the linked cycle's calendar
   Board date (today's behavior within a day: D26 requests carry Dec 11 and the
   calendar Board date is recorded as Dec 10, so closing may come one day
   earlier); no link or no Board date
   means never auto-closed, as with a missing meeting date today.
5. **Honorarium requests.** **Decided (owner, 2026-10-29):** going forward, new
   honorarium rows set the Grant Cycle link from the parent's link and write
   `wmkf_meetingdate` and `akoya_fiscalyear` from the linked cycle's calendar
   Board date; a parent with no link creates no honorarium and alerts, as today.
   Existing honorarium rows are not changed (staff are working them now).
   Evidence, owner-authorized read-only Production read 2026-10-29: GoApply-made
   honorarium #1002764 carries the link (June 2026), meeting date 2026-06-04 and
   fiscal year "June 2026"; the nine newest app-made honoraria (#1003263–#1003274,
   Aug 2026) carry no link, meeting date 2026-12-11 and "December 2026". The
   D26 calendar Board date is recorded as Dec 10 (D45 landing switch) [not
   re-read], so the stored day may move one day earlier; the fiscal year does
   not change.
6. **Stored cycle codes.** **Decided (owner, 2026-10-29): no backfill.** Codes
   already written from meeting dates stay. Evidence, owner-authorized read-only
   Production count 2026-10-29: 564 requests link to D26; all 221 selected,
   non-excluded suggestions on them carry `wmkf_grantcyclecode = D26`; none is
   blank, so the hourly review-filing job (which discovers only stamped rows,
   `reviewer-suggestion.js:1530-1555` [VERIFIED]) misses nothing despite bug 1.
   Bug 1 is still fixed in PR 1 so J27 does not depend on a later fill-in.
7. **Test Request Factory.** **Decided (owner, 2026-10-29):** clones set the
   Grant Cycle link; the operator picks a cycle (default: the source's linked
   cycle) instead of a meeting date; clones still get `wmkf_meetingdate`, from
   that cycle's calendar Board date, so the sandbox correction step and the
   ledger column `test_request_runs.meeting_date` stay (no migration; record the
   chosen cycle in the run plan). Production adds `wmkf_grantcycles` to the write
   fence's `REQUEST_BIND_SETS` as a reviewed change. Prerequisite: confirm the
   sandbox has matching Grant Cycle rows (sandbox read) [ASSUMED unknown].
8. **In or out of scope** (asked one at a time):
   - **8a Dynamics Explorer.** **Decided (owner, 2026-10-29): in scope, last
     PR.** The prompt tells the model to use the Grant Cycle link first and fall
     back to the request meeting date only when the link is blank, saying so in
     its answer (a staff Q&A tool, not an app screen, so link-only in the apps
     still holds); Board-date questions use the cycle calendar; `get_entity`
     drops the meeting date from its default fields. Coordinate with Codex on
     where prompt edits land (PR #553, shared prompt library).
   - **8b Request-file corpus index.** **Decided (owner, 2026-10-29): out of
     this migration.** Offline, rebuildable admin index, no app reader
     [VERIFIED via `git grep`]; when corpus work resumes it moves to the
     fiscal-year label (population and era) and the link (era 4). Recorded in
     `docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md`.
   - **8c Dataverse Bulk Export "Meeting date" column.** **Decided (owner,
     2026-10-29): out of scope.** The column copies the stored value; the
     export never uses it to choose or group requests [VERIFIED via `git grep`
     of `lib/services/dataverse-export`]; current users unknown (per-person
     grant, no run log).
   - **8d Scripts.** **Decided (owner, 2026-10-29):** scripts still used for
     current work (Staff Deliberations drafts and preflight, Proposal Ranking
     access, deliberations cohort review, reminder-liveness audit, honorarium
     backfill, smoke tests) move with the app code they mirror. Finished
     one-offs and probes stay as written; the caveat is logged in
     `docs/agent-wiki/topics/dataverse-dynamics.md` (Operating Notes) with a
     pointer in `scripts/README.md`. The old helpers stay in
     `lib/utils/cycle-code.js` for scripts only; the guard check refuses them
     under `lib/`, `pages/` and `shared/`.

## 8. Data needed (owner-run, read-only)

**Done 2026-10-29** for link coverage by year and program (§7 Q1). Still open:
the count of past Research grants with neither a fiscal year nor a decision
date (§7 Q3).

Extend `scripts/probe-request-grant-cycle-lookup.cjs` to count requests by
(link present, meeting date present, program, decision year), including before
2024, so §4.1 and §4.2 have numbers. Production read; owner runs it.
