---
title: J27 Workbench Production Rollout and Rollback
domain: workbench
kind: plan
status: planned
summary: Rehearsal evidence, a default-off J27 production cohort, additive Dataverse preparation, and rollback steps for the Workbench redesign.
cataloged: 2026-11-07
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md
  - docs/atlas/dataverse-akoya-request.md
---

# J27 Workbench production rollout and rollback

**[PLANNED]** Prepare the production path behind an off switch, then seek a separate owner decision for any production schema apply, merge to `main`, or activation. Treat this as Tier 2 under the campaign release strategy. The branch and the current Preview are the review candidate. This plan authorizes no production changes.

## Evidence at preparation

| Surface | Evidence | Release implication |
|---|---|---|
| Code and deployment | **[VERIFIED 2026-11-07 via git and Vercel inspect]** `codex/j27-workbench-reports` at `84199d437` is based on remote `main` at `53066edc1`. The sandbox Preview alias serves `dpl_9DensD9svL55mH3b1bnXBvquJhP6`. The production hostname currently serves `dpl_8xoqHAWhtJUmgKVNwbTb4rzccjmg`. | Record the signed-in last-known-good deployment again just before release. Today’s deployment ID is evidence, not a standing rollback target. |
| Staff workflows | **[VERIFIED via signed-in Preview]** On #1000369, opened the proposal PDF, saved and reopened the rationale, saved First Cut by selection, and verified the review summary, manual attendance, visit assessment, and Overview link into Final Assessment. On #1000370, two reports and a saved summary led Overview back to Reports with no presentation. | Rehearsed in sandbox. Re-run both on the final release candidate and record ordinary staff access separately from superuser access. |
| Word | **[VERIFIED via signed-in Preview and owner readback]** On #1000369, the authorized link opened the synthetic draft in Word for the web before group review. Reloading Final Assessment showed the pre-review state. | Keep the existing draft visibility rules and Word workflow. Retest that opening the link does not transition review or send email. |
| Production fields | **[VERIFIED via read-only Dataverse metadata]** The five fields below matched the sandbox specs by type and length. A production metadata query for those five logical names returned none. | Provision and verify them before admission. Do not assume sandbox data or permissions transfer. |
| Current admission | **[VERIFIED via source]** The phase layout and new field routes are sandbox-gated. The visit route shares the summary gate. Rationale and roster have additional readiness switches. The shared First Cut control autosaves in J27 even under the legacy layout, and the shared Final Writeup component can show the new draft link outside J27 if this branch is merged as-is. | A merge alone would neither enable the J27 layout nor fully isolate visible changes. Gate the two shared UI changes as well as the layout and APIs before release. **Done 2026-11-13 [VERIFIED via source and tests]:** outside the phase layout the Scoring card saves only from its Save button (`explicitSave`, `tests/unit/workbench-request-page-scoring-save-mode.test.js`), and Final Assessment offers the pre-review "Open draft in Word" link only in the phase layout (`tests/unit/final-writeup-tab.test.js`). |

Source checks: [Workbench shell](../../pages/workbench/%5BrequestId%5D.js), [summary admission and save](../../lib/services/workbench/staff-review-summary-service.js), [rationale readiness](../../lib/utils/initial-assessment-rationale-readiness.js), [roster readiness](../../lib/utils/meeting-roster-readiness.js), [Word draft visibility](../../lib/services/final-writeup/transition-state.js), [First Cut control](../../shared/components/workbench/FirstCutCard.js), and [Final Writeup UI](../../shared/components/workbench/FinalWriteupTab.js).

## Admission to implement

**Amendment, 2026-11-10 (owner; alignment log D64).** Nothing in this
release is to be tied to the cycle named J27. Read the section below with
these changes:

- "A linked Grant Cycle code of `J27`" and "whose linked cycle is J27" mean
  a cycle of 2027 or later (`isJ27ScopeCycle`). The twelve code tests for
  the literal were replaced on `claude/j27-cycle-page` on 2026-11-10.
- The proposed switch and cohort setting take cycle-free names when they
  are built: `WORKBENCH_PRODUCTION_SCHEMA_READY` and
  `workbench.phase_rollout`, not the `J27_`-named ones written below.
- The seven existing settings were renamed the same day. None was set in
  any Vercel environment `[VERIFIED via vercel env ls, 2026-11-10]`, so
  nothing needed migrating.

| Setting | Gates | After go-live |
|---|---|---|
| `INITIAL_RATIONALE_SCHEMA_READY` | Staff rationale field; required by the Recommendation step | Stays while a target could lack the field |
| `MEETING_ROSTER_SCHEMA_READY` | Confirmed attendance field | Stays while a target could lack the field |
| `CHAIRS_RECOMMENDATION_ENABLED` | Recommendation to Chairs step | Delete: the step is part of the flow |
| `AUTOMATIC_INTEGRITY_SCREENING` (`on`, `off`, `simulate`) | Integrity screening after a recommendation | Delete once screening is always on |
| `CHAIRS_RECOMMENDATION_REHEARSAL_REQUEST_ID`, `INTEGRITY_SIMULATION_REQUEST_IDS`, `INTEGRITY_SIMULATION_DB_URL` | Preview rehearsal only | Delete |
| `WORKBENCH_PHASE_RELEASE` (added 2026-11-13) | Merge-dark gate (`lib/utils/workbench-phase-release.js`): the cycle page's phase lists, the request page's stage strip and J27 reads, readiness-only discovery (D1), the dashboard's J27 fact reads and the Final Writeup stage facts. Off in a Production deployment unless literal `on`; admitted in Preview, local and test | Delete once the release is live everywhere |

**Merge-dark (2026-11-13, owner go).** An audit of the branch found that a
merge alone would have shown Production staff the J27 cycle page, the
request-page strip and readiness-only discovery, and would have run the J27
reads (including the integrity join on `j27_integrity_jobs`, which needs
migration 096). `WORKBENCH_PHASE_RELEASE` now gates all of these, and the
cycle page receives the server's answer as a prop (`phaseRelease` from
`pages/workbench.js`), so the shell neither chooses nor anticipates the
J27 layout and never starts a J27 row read while the cycle list loads
(Codex review finding, fixed 2026-11-13); unset in
Production, every discovery consumer builds `main`'s filter and the old
request list keeps Advancing / Set aside (restored for 2027-or-later rows,
owner 2026-11-13). Setting it `on` is **not** the release by itself: the
request page's phase layout and new fields still refuse Production
(`pages/workbench/[requestId].js`, the rationale and roster readiness
checks), and migration 096 must be applied first. Changes that reach
Production on merge by the owner's decision: offramp refusals (D7/D63), the
group-review guard (D63/D64), the 2027+ Proposal-tab files and staff version
(D59 to D61), the nav order, the Scoring card for 2027+ with an explicit
Save outside the phase layout, and the reviewer Invite list excluding
candidates whose review was already received, the structured integrity
news rule, the 8000-token integrity analysis limit, and the reviewer
rollup reading four chunks at a time (below).

- **Integrity news analysis, 2026-11-13 (owner go; reaches Production on
  merge).** The structured news rule from `318f9642c` and `35a445bec` runs
  in every environment. It was briefly held to main's free-text analysis in
  Production because all 592 stored Google News results in Production have
  an empty snippet, so a flag's verbatim excerpts must come from headlines
  [VERIFIED via `scripts/probe-integrity-news-verdict-sizing.cjs`, owner-run:
  79 screenings, 129 news searches, 16 flagged under the old rule, 111 with
  more than the 5 stored results]. A replay of the 16 old flags on their
  stored results (`scripts/replay-integrity-news-verdicts.cjs`, owner-run,
  Production's model setting `claude-haiku-5-5`) gave 6 `flag_for_review`,
  6 `inconclusive` (shown to staff as an incomplete news screen) and 4
  `clear`. The owner reviewed the 4 clears
  (`scripts/show-integrity-news-flag-cases.cjs`): all were old-rule false
  alarms, three "no concerns" summaries worded differently from "no
  concerns found" and one failed analysis. The owner lifted the hold.
  Limits: 16 cases, 5 stored results each, and model answers vary between
  runs (two cases changed between replays).
- **Integrity analysis token limit, 2026-11-13 (owner go; reaches Production
  on merge).** The integrity analysis call allows 8000 output tokens instead
  of 1000 (`ANALYSIS_MAX_TOKENS`). At 1000 the first replay on Haiku
  (thinking on by default) got one non-JSON and one empty reply in 10
  cases; at 8000 all 16 replies were valid. The model stays Haiku (owner).

- **Preview walk-through and move, 2026-11-12.** The owner walked the
  Preview and Claude took a second look in Chrome. The Final Assessment
  tab's Writeup review section failed with "Final writeup review tracking
  is unavailable": it needs `FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY`,
  which Production has and the Preview branch did not. The sandbox's
  acknowledgement schema is exact and its key Active `[VERIFIED via
  scripts/preflight-final-writeup-review-acknowledgement-schema.mjs
  --target=sandbox, read-only, 11 exact, 2026-11-12]`, so the setting was
  added `on`, scoped to `claude/j27-read-model`, and read back. The branch
  was then fast-forwarded to `cc603be5e` (reviewer counts on any tab, read-model
  plan C7 amendment) and deployed as `dpl_ARxww8Gb6byXvihGmTWzGPC1Lorv`
  (attested: branch, commit, Ready); the stable alias points at it. Previous
  targets the same day: `dpl_THWVcsoBdLRjDACMEukwuUE69VgT` (redeploy of
  `5f81733db` with the new setting) and before it
  `dpl_HfWztktsLVVAXXAYLS26kgbFfMkE`. **Superseded later the same day:**
  after the Codex review fix the branch is at `72368357e` and the alias
  points at `dpl_CLcVRmYVBNEShTeszJeqH9ebheU7` (attested: branch, commit,
  Ready); `dpl_ARxww8Gb6byXvihGmTWzGPC1Lorv` is the previous target. In the
  browser, #1000386 opened from its row read "Next: Identify reviewers", and
  the reviewer counts were read once on opening and once per return to the
  Overview. Six branch-scoped Config settings now;
  remove all six at promotion or retirement.
- **Deliberations fixture, 2026-11-12 (owner go).** The sandbox had no
  request in Deliberations. One presentation record was added to #1000383
  (`wmkf_sitevisits` `f127beed-18df-f111-84ea-70a8a59af221`, subject "TEST:
  J27 Deliberations walk-through (no meeting)", 2027-03-15 17:00 to 17:30 UTC,
  state 0 / status 1, no attendees, nothing sent) by a one-off script pinned
  to the sandbox host; the interlock reported `target=sandbox` and the record
  was read back. The Preview then showed #1000383 as the one Deliberations
  row, "Before presentation" with no line, and its request page strip read
  "Deliberations" with no next step: the page matches the list before the
  presentation ends `[VERIFIED via signed-in Preview, 2026-11-12]`. The
  Meeting Tracker, the normal way to add one, is not enabled on this
  Preview. To restore #1000383 as a plain Scored fixture, delete that record.
- **Preview moved, 2026-11-11.** `claude/j27-read-model` fast-forwarded to
  `01a798524` and deployed as `dpl_EQFqtn7LtKy9G3XyNuspzzquvo6z`; the stable
  alias points at it (previous target `dpl_2GaUBQnXmXsYd2WdYEnxAKfppSxV`).
  Branch-scoped Preview Config settings added the same day and read back:
  `INITIAL_RATIONALE_SCHEMA_READY`, `MEETING_ROSTER_SCHEMA_READY`,
  `CHAIRS_RECOMMENDATION_ENABLED`, `FINAL_WRITEUP_SCHEMA_READY` (all `on`)
  and `STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS` (Production's
  value). The bullets below describe the state before this move. Not yet
  walked through in a browser.
- **Preview state, 2026-11-10.** The branch-scoped Preview has three
  settings of its own (`DYNAMICS_URL`, `POSTGRES_URL`, `DATABASE_URL`). The
  phase layout, review summary and presentation assessment need no setting
  there. The rationale, confirmed attendance and Recommendation to Chairs
  are off because their settings are absent. To rehearse them the owner
  adds the first three settings in the table, scoped to the Preview branch.
  The sandbox has both fields: `wmkf_initialassessmentrationale` and
  `wmkf_confirmedmeetingroster` are present on `akoya_request`, as are
  `wmkf_staffreviewsummary`, `wmkf_staffvisitassessment`,
  `wmkf_phaseiistatus`, `wmkf_readyforreview` and the two document pointers
  `wmkf_currentpresitevisit` and `wmkf_currentfinalwriteup`, which the list
  feed now selects `[VERIFIED via scripts/probe-sandbox-j27-fields.cjs, a
  read-only metadata GET against the sandbox host orgd9e66399, 2026-11-11;
  the interlock reported target=sandbox; no records were read]`.
- **Transition request read and the Grant Cycle expand.** Since `91fc83581`
  the Final Writeup transition's request read expands the linked Grant
  Cycle. Every caller runs inside a trusted Dataverse context: the Final
  Writeup, leadership-review and pre-site-visit routes, the pre-site
  artifact service they and the preparation cron call (the cron wraps it in
  `withDalContext`), and the test-request rehearsal's pre-site dependencies
  `[VERIFIED via git grep of every import of the transition modules,
  2026-11-11]`. Not exercised live.
- **Before promotion: D26 Grant Cycle links (owner-run Production read).**
  Since `91fc83581` the group-review start guard grants the earlier-cycle
  exception only when the request's linked Grant Cycle resolves to a cycle
  before 2027. Confirm that every D26 request still to start group review
  has that link; an unlinked one would be refused. Command (2026-11-12):
  `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-group-review-cycle-links.cjs`
  lists every request with a current Draft Writeup and no Final Writeup,
  its linked and document cycle codes and presentation count, and flags
  the ones the guard would refuse. Dry run on the sandbox: two requests,
  none refused. **Owner run on Production, 2026-11-12:** one request,
  #1003313 (no Grant Cycle link, document D26, Draft Writeup in complete
  review, one presentation record); none refused. With a presentation
  record the earlier-cycle exception does not apply whatever the link, so
  the new rule does not touch it: group review there needs its presentation
  to read as ended under Production's state/status pairs, as before
  `91fc83581`. Whether it does was not checked.
- **Before promotion: the J27 list's cost at volume (owner-run Production
  read).** `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-workbench-load-timing.js
  --email=<staff email> --profile-id=<id> --cycle=D26 --scope=all --later-facts=yes`
  times the cycle's request list twice and, with `--later-facts=yes`, the
  three batched later-phase reads over the same request ids (the list runs
  them only for 2027-or-later rows, so D26 gives the volume). Prints timings
  and counts only. The script was extended 2026-11-12 to pass the cycle;
  before, it timed only the cycle picker. **Owner run on Production,
  2026-11-12** (after `dabdf5378` fixed the bundle): D26, all program
  directors, 25 requests. Request list 2,766 ms cold / 706 ms warm, mostly
  program catalog and assignments; the three later-phase reads over the 25
  ids 934 ms cold / 439 ms warm, no fact unavailable (they run beside the
  other reads in the list, so they add at most that); Deliberations panel
  3,034 / 1,028 ms. Not measured: a 300-request cycle. At 25 ids per batch
  this run needed one batch per read, while 300 would need about twelve
  (Codex's count of 36 queries); whether the batches run in sequence was
  not checked. *(2026-11-13: they did run in sequence, 25 requests per
  chunk. The J27 list reads now run four chunks at a time
  (`J27_READ_CONCURRENCY`, `lib/services/workbench/j27-later-facts.js`), so
  at most 20 Dataverse queries are in flight across the five reads; other
  callers of the three adapters stay sequential.)* *(2026-11-13, measured
  [VERIFIED via `scripts/time-j27-large-reads.cjs`, owner-run against
  Production, 300 Research requests from J26/D26, three rounds]: each J27
  read is 12 calls; alone it takes about 1.5 s sequential, 0.45 s at 4
  chunks and 0.27 s at 8. Run together with today's reviewer rollup, the
  whole set takes 1.47 to 1.69 s at every level, because the rollup
  (sequential on `main`, 1.6 to 2.0 s) is the slowest read. No read failed
  or came back capped, and 8 chunks drew no throttling. The J27 reads
  therefore add almost nothing to a 300-request page at 4.)* *(2026-11-13,
  owner go; reaches Production on merge for every cycle: the reviewer
  rollup (`fetchReviewerRollup`) now reads four chunks at a time
  (`ROLLUP_READ_CONCURRENCY`), counting in chunk order; a failed chunk still
  fails the rollup. `scripts/time-j27-large-reads.cjs --email=…` also times
  the whole cycle-page server read (`loadDashboard`) per cycle, request list
  included.)* *(2026-11-13, measured again [VERIFIED via the same script,
  owner-run, 300 requests, three rounds]: with the rollup at 4 the whole set
  of list reads takes 0.42 to 0.54 s (1.54 to 1.62 s with everything
  sequential; 0.29 to 0.32 s at 8). Staying at 4 keeps about 20 queries in
  flight per page; every page shares the app's Dataverse identity and its
  concurrent-request limit [ASSUMED from Microsoft's service protection
  limits, not checked here]. The whole-page read could not be measured at
  300 rows: past cycles show 1 (J26) and 25 (D26) rows to Research staff,
  because decided requests drop out of the list. On those, program scope
  took 0.2 to 0.5 s and the request list with its reads 0.2 to 0.6 s.)*
  *(2026-11-13, third run [VERIFIED via the same script, owner-run]: the
  request-list query with the page's columns over every Research request
  in the cycle (400 in J26, 367 in D26) is one Dataverse call, 1.3 to 1.4 s
  in the first round and 0.4 to 0.75 s after. The list reads need the
  list's ids, so a 300-row page's server read is about program scope (0.2
  to 0.26 s) + the list (0.4 to 1.4 s) + the list reads at 4 (0.45 to 0.7
  s): roughly 1 to 2.3 s. At 8 chunks one read failed in round 1 ("fetch
  failed", 7 of 9 calls), which the page would show as unavailable facts on
  every row; nothing failed at 4 or 1 in three runs. Concurrency stays at
  4.)*
- **Preview needs `FINAL_WRITEUP_SCHEMA_READY=on`** for its branch to show
  the review stages (group and leadership review) and to rehearse the Final
  Assessment list's standing chips. It is set for Production and another
  rehearsal branch only `[VERIFIED via vercel env ls, 2026-11-11]`. Set for
  the Preview branch 2026-11-11. *(Corrected 2026-11-12: the "Final writeup
  review tracking is unavailable" message comes from the separate
  `FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY`, added for the Preview branch
  2026-11-12; see the first bullet.)*
- **Preview needs a fourth setting to rehearse group review:**
  `STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS` is set for Production
  only. Without it on the Preview a presentation's end reads unknown and,
  since D63, nobody can start group review there.
- **Still true below:** the rationale and attendance gates refuse a
  Production deployment whatever the setting says
  (`lib/utils/initial-assessment-rationale-readiness.js`,
  `lib/utils/meeting-roster-readiness.js`). Promotion has to lift that
  deliberately; a merge alone does not turn these on.

**[PLANNED]** Use a single server policy shared by the request context and all four new Workbench field endpoints. The production branch of the policy requires a production deployment, the registered production Dataverse target, the proposed `J27_WORKBENCH_PRODUCTION_SCHEMA_READY` switch set to literal `on`, and a fresh, authoritative linked Grant Cycle code of `J27`. The existing isolated sandbox admission remains available for rehearsal. Other deployment and target pairings cannot qualify for the production branch.

Use a dedicated, non-secret Dataverse application setting such as `workbench.j27_rollout` for the cohort. Reuse the existing strict setting read and revision-checked write contract. The operator write path is a prerequisite to build and rehearse, with a superuser-only, single-key allowlist and an auditable actor. Store the setting as a JSON object and accept exactly these forms.

| Setting | Admission |
|---|---|
| `{"mode":"off"}` | Existing UI. New field GET and POST routes deny access before selecting the new columns or attempting a write. |
| `{"mode":"pilot","requestIds":[...]}` with a nonempty list of valid request GUIDs | Only the named requests whose linked cycle is J27. All Workbench staff authorized for the request can use the new staff fields. |
| `{"mode":"on"}` | All requests whose linked cycle is J27. |

A missing, invalid, unreadable, or timed-out setting resolves to off. Keep the read bounded and avoid a cross-request cache for the setting used to authorize writes. Return only the effective admission in request context. Resolve it again on each direct GET or POST. A client tab, a query parameter, a cached page, or an apparent request number cannot authorize entry. Preserve the existing authenticated staff checks, session-derived Dataverse actor, impersonation with no fallback on new saves, and the request ETag. The rollout setting should be rechecked before issuing the conditional write. A write already dispatched at disable time can still complete and must be accounted for in rollback.

Apply the same effective admission to the five-phase layout, Overview, Reports summary, Deliberations fields, and Final Assessment handoffs. Preserve the existing First Cut explicit-save UI when admission is off. Keep existing Word actions in other cycles and gate only the added pre-review draft link. The new link must respect the server-projected draft visibility. A user may be able to open an authorized draft without being allowed to start group review. Preserve old bookmarks and access gates. On disable, verify that new phase bookmarks have a safe landing and that the legacy sections remain reachable.

**[PLANNED]** Manual attendance is the release path. Gate Zoom suggestions separately and leave the production suggestion branch off, including the direct `suggest=yes` GET. Show manual entry and confirmation without a Zoom action. Verify that no Zoom request is issued when a client asks for suggestions directly. Keep the formal offramp outcome and any new status mapping out of this release. Overview continues to distinguish the recorded Dataverse status from a suggested next step. Keep the parked Semi-finalist status changes separate. Existing First Cut still writes only Scored or Not Scored, subject to the existing lead PD or superuser rule. Before enabling autosave in production, verify the exact choices against live Dataverse and check workflows on those values. The new prose and roster saves must not trigger unrelated flows or email.

## Production schema preparation

**[PLANNED]** Add optional fields to `akoya_request` using the reviewed schema waves. There is no new data backfill, data copying from rehearsal, or retirement of the existing Word assessment in this release.

| Wave | Field | Type and limit |
|---|---|---|
| 37 | `wmkf_staffreviewsummary` | Memo, 10,000 characters |
| 37 | `wmkf_staffreviewevidencehash` | String, 64 characters |
| 38 | `wmkf_staffvisitassessment` | Memo, 10,000 characters |
| 39 | `wmkf_confirmedmeetingroster` | Memo, 100,000 characters on Request |
| 40 | `wmkf_initialassessmentrationale` | Memo, 10,000 characters |

After separate approval, dry-run each wave with the exact production target and compare metadata before applying. The operator must use the production target guard, explicit `--target=prod --execute`, and the approved same-UTC-day production write acknowledgement. Apply waves 37 through 40 in order. If publishing is needed for the runtime read, publish only the Request entity through the approved Dataverse procedure after checking pending customizations on it. Verify exact metadata and select all five fields in a real read before marking the schema ready. Keep access off during schema work. Wave 39 targets the Request row. The unused sandbox-only Site Visit memo is outside the production rollout.

Dry-run form, to run when preparing the separately approved schema change:

```bash
for wave in 37-j27-staff-review-summary 38-j27-staff-visit-assessment \
  39-j27-meeting-roster 40-j27-initial-assessment-rationale; do
  DATAVERSE_TARGET_INTERLOCK=on DATAVERSE_ALLOW_PROD_READS=yes \
    node scripts/apply-dataverse-schema.js --target=prod --wave="$wave" || exit
done
```

## Postgres preparation

**[PLANNED; added 2026-11-10]** Apply migration `096_j27_integrity_jobs.sql` to the Production database with `node scripts/apply-migrations.js` before the J27 code serves there. The J27 read model reads the latest Integrity Screen for every J27 Research row through a query that joins `j27_integrity_jobs`, whether or not the automatic screen is switched on. Without the table that read fails and every J27 row shows "Some details could not be read." [VERIFIED via a throwaway local Postgres, 2026-11-10; read-model plan section 11]. The Production database does not have the table: an owner-run `apply-migrations.js` pass from the main checkout on 2026-11-10 skipped 002 through 095 and applied nothing, and the main checkout has no 096. The table is additive and empty until the automatic screen is enabled.

**Sandbox Preview database (2026-11-10).** Until this date the `claude/j27-read-model` Preview used the shared Production database, so it read (and wrote) Production Postgres and lacked the J27 table. The owner created a Neon branch `j27-preview` of the Production database (project `expert-reviewers-neon-db`, branched from `main` with data, auto-delete Never), scoped `POSTGRES_URL` and `DATABASE_URL` to Preview for the git branch `claude/j27-read-model`, and applied 096 there (`1 applied, 94 skipped, 95 total`). With that, "Some details could not be read." no longer appears on the Preview's J27 list or request pages (seen in the browser the same day), which confirms the missing table was the cause. The branch is a copy of Production data taken at that moment; treat its connection string as a Production secret. **Remove the Neon branch and the two branch-scoped variables when the J27 line is promoted or retired**, together with the branch-scoped sandbox `DYNAMICS_URL`.

The memo fields above stay switched off in Production after waves 37 through 40 are applied: each readiness helper also requires a non-production deployment (`lib/utils/initial-assessment-rationale-readiness.js`, `lib/utils/meeting-roster-readiness.js`, `staffReviewSummaryEnabled`). Enabling them in Production is a separate code change. Until then those facts read "not provisioned" and do not mark a row.

## Verification and staged release

1. **Build the admission changes on the development branch.** Recheck remote main and the final diff. Require type checks, focused Workbench and legacy regressions, route/DAL and reviewer boundary checks, and production admission tests. Test both deployment/target pairs, J27 and older/unlinked cycles, off, invalid setting, unavailable settings read, pilot allowed and denied IDs, and on. Hit the four GET/POST routes directly. Off, wrong cycle, wrong target, missing staff access, unmapped actor, or stale versions must fail as applicable. Populate the denied fixtures with data so the test proves exclusion. Test a stale open page across a switch to off.
2. **Rehearse the final release candidate in sandbox Preview.** Keep the Dataverse target interlock and DAL enforcement on. Confirm #1000369 can save and reopen rationale, First Cut, review summary and visit assessment, confirm attendance manually, and open the authorized Word draft before group review. Confirm #1000370 still goes to Reports and carries no formal outcome. Compare a non-J27 request with the existing UI and exercise legacy bookmarks, including the existing Word path. Test an ordinary staff viewer and an authorized editor, the existing First Cut owner rule, and a viewer without draft access. Rehearse settings off → pilot → off, including the legacy path and API denials. Use mock or sandbox tests for external reviewer and email behavior touched by the integration. Record remaining scenarios explicitly.
3. **Prepare the production change record.** Record the exact candidate commit/deployment, auth hostname, approved J27 pilot request GUIDs, owner, operator and backup operator, production schema readback, verified last-known-good production deployment, observation window, rollback controls, and stop conditions. Verify literal `DATAVERSE_TARGET_INTERLOCK=on`, `DATAVERSE_DAL_ENFORCEMENT=on`, `DYNAMICS_IMPERSONATION_ENABLED=true`, and the existing Word readiness state. Check the campaign calendar and obtain the owner’s explicit approval for the window. The merge to `main` is a production deploy action.
4. **Release with admission off, after approval.** Confirm signed-in access and baseline behavior in production with reads only. Verify a J27 request and an older-cycle request still open the existing layout, and verify the new routes deny even when invoked directly. Reconcile any differences before enabling.
5. **Admit the named pilot, after a separate go decision.** Use a small set of approved J27 request GUIDs. Compare a pilot request, a J27 request outside the pilot, and a non-J27 request. Confirm only the first receives the new layout. Check Overview direction, Word link visibility, and the manual roster for staff with normal access. Ordinary staff work in the pilot is the first legitimate production write. Any artificial production write rehearsal needs its own approved dedicated test record and side-effect controls. Check save/readback, actor attribution, route failure rates, timeouts and conflicts, and any unexpected mail or jobs. Review results with the owner before expanding to all linked J27 requests. Retain the old path through the campaign.

**Stop and restore the old path** for any wrong-cycle or wrong-request exposure, save without correct attribution, loss of an existing workflow, misdirected or inaccessible Word drafts for authorized staff, unexplained errors on save or reload, or unintended email, Zoom, status, or background activity. Record expected stale-edit conflicts separately from unexpected failures.

## Rollback

1. **Set the rollout setting to `{"mode":"off"}`.** The release operator uses the authorized settings control and records its revision and time. Reload a pilot J27 request, an older-cycle request, and a former new phase bookmark. Verify the legacy UI, a working existing staff read path, and denial of the four new endpoints. Check that an open editor cannot begin another new-field save after disable.
2. **If off does not restore service, restore the pinned known-good production deployment.** Use the existing Vercel production rollback procedure with the exact deployment recorded immediately before release, and verify the production domain points to it. Recheck sign-in, Workbench, and existing document/reviewer links. Keep the rollout setting off before any subsequent deployment. If rollback is due to an unintended downstream action, stop the specific job or send path with its existing operator control and notify the owner.
3. **Reconcile data separately.** Keep the additive fields and all saved staff work. Review the pilot request audit trail for saves already dispatched, identify any partial or unexpected writes, and assign repair to the owner. Never bulk revert request statuses, remove fields, or delete Word files as part of code rollback. Record the intended old UI’s lack of access to the new saved text and how staff can retrieve it through an authorized Dataverse read if needed. Re-enable only after the fault is fixed and the rollback and regression checks pass again.

The formal offramp outcome remains an open decision. Zoom attendance suggestions remain a separate rehearsal and release decision.
