---
title: Cycle calendar on the operations Grant Cycle table — plan
domain: platform
kind: plan
status: proposed
summary: "Owner decision 2026-10-28 (alignment log D43): the operations Grant Cycle table (wmkf_grantcycle) is the authoritative home for the cycle milestone dates it carries, edited from an app calendar (Admin section + standalone page) by the Grants Manager / Program Coordinator roles, viewable by all staff, with per-date who/when tracking via Dataverse audit history. Prototype scope, edit tracking, Tier 2 controls and open questions; contract-reconcile reviewed 2026-10-28; nothing built."
canonical: false
owner: product-engineering
related:
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md
  - docs/audits/cycle-settings-audit-2026-10-27.md
  - docs/audits/cycle-foundations-2026-10-21.md
  - docs/audits/grant-cycle-dates-2026-10-28-evidence.json
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Cycle calendar on the operations Grant Cycle table

Status: **proposed; slices 1–2 source-built on branch `claude/cycle-calendar`, not deployed:** adapter, service, route (`pages/api/cycle-calendar.js`), panel (`shared/components/cycle-calendar/CycleCalendarPanel.js`) on `/cycle-calendar` (Tools menu, all staff) and Admin → Workflows → Cycle calendar, with unit/UI tests; schema-as-code at live parity; **controlled Production test passed 2026-10-28** (§6). Remaining: final independent review, PR, owner merge.** Decision record: alignment log D43
(2026-10-28), which supersedes the date split in D10. `/contract-reconcile`
plan review done 2026-10-28: ready with the named changes now folded into
§3, §4 and §6.

## 1. Decision

The operations Grant Cycle table (`wmkf_grantcycle`) is the authoritative home
for every cycle milestone date it carries. The apps read those dates and also
**edit them** from one app calendar (an Admin section for superusers and a
standalone `/cycle-calendar` page for staff; §3), so staff manage the cycle's milestone
dates in one place (owner, 2026-10-28: chosen over editing in Dynamics, for
consistency with using the apps to manage multiple milestone dates). There is
one editable copy of each date. `wmkf_appgrantcycle` keeps its non-date role
(review template, attachments, custom fields); its date columns
(`wmkf_meetingdate`, `wmkf_reviewreturndeadline`, all null in production per
the 2026-10-21 foundations audit) are not used as calendar authority.

Each request finds its cycle through its `wmkf_grantcycle` lookup, with the
meeting-date derivation (`lib/utils/cycle-code.js`) as fallback (T10).

## 2. What the table carries

[VERIFIED via `scripts/probe-grant-cycle-dates.cjs`, owner-run 2026-10-28;
evidence `docs/audits/grant-cycle-dates-2026-10-28-evidence.json`]

- 143 rows. Rows exist for D26 (Board Dec 10, 2026), J26 and J27 (Board
  June 10, 2027); no D27 row. Rows are created when the GOApply portal opens
  (owner, 2026-10-28), so a missing future row is normal, not an error.
- Columns: cycle code (alternate key), name, Board Meeting Date
  (`wmkf_meetingdate`, required), and eleven optional date columns Connor
  added: `wmkf_researchproposalduedate` (Proposal Due),
  `wmkf_researchleadershipsemifinalistemaildate`,
  `wmkf_researchleadershipsemifinalistmeetingdate`,
  `wmkf_researchchairssemifinalistemaildate`,
  `wmkf_researchchairssemifinalistmeetingdate`,
  `wmkf_researchreviewsduedate` (Reviews Due Date),
  `wmkf_researchofframpmeetingdate` (Offramp Meeting Date),
  `wmkf_researchleadershipfinalistemaildate`,
  `wmkf_researchchairsfinalistemaildate`, `wmkf_boardmailingdate` (Board
  Mailing Date) and `wmkf_researchbudgetduedate` (Budget Due Date).
- Every date column is DateOnly / TimeZoneIndependent and writable. Values
  arrive as `YYYY-MM-DDT00:00:00Z`; treat them as calendar dates and never
  convert time zones (a Pacific conversion would display the previous day).
- All eleven new columns are **null on D26, J26 and J27**. Which timeline step
  each one represents is TBD: staff are still deciding the dates (owner,
  2026-10-28). Once decided, they are entered through the Admin calendar.
- `wmkf_cyclename`, declared in the repo schema snapshot, does not exist live.

## 3. Prototype scope

The smallest thing that lets the calendar roles enter and see dates:

1. **Adapter.** A new DAL adapter for the operations table, e.g.
   `lib/dataverse/adapters/operations-grant-cycle.js` [RECHECKED after lib/dataverse/adapters/operations-grant-cycle.js change: built on branch `claude/cycle-calendar`],
   with named operations: list rows with a modern `J`/`D` two-digit code
   (`^[JD]\d{2}$`), get one row by code (with its ETag), update the date
   columns of one row. **Not** `grant-cycle.js`: that file already exists and
   is the adapter for the apps table `wmkf_appgrantcycles` [VERIFIED via
   `lib/dataverse/adapters/grant-cycle.js:2,12`]. Register `wmkf_grantcycles`
   in `lib/dataverse/core/entity-registry.js` [RECHECKED after lib/dataverse/core/entity-registry.js change: registered on branch `claude/cycle-calendar`]. Writes run under `withDalContext`; the
   target interlock allows production-app writes to the production target
   [VERIFIED via `lib/dataverse/core/interlock.js:336-338`]. A service module
   sits between the route and the adapter (`check:route-service-boundary`).
2. **One calendar panel, two places** (owner, 2026-10-28; Staffing
   precedent). The Admin panel is superuser-only [VERIFIED via
   `shared/components/Layout.js:137-139`; Admin routes use `requireSuperuser`,
   e.g. `pages/api/admin/email-defaults.js:41`], so the same panel component
   appears as an Admin section for superusers and as a standalone
   `/cycle-calendar` page in the Tools menu for everyone else, the way
   Staffing does [VERIFIED via `shared/components/Layout.js:133`;
   `pages/staffing.js`]. Layout (owner, 2026-10-28): a **cycle dropdown**
   (recent modern-code rows; default the nearest upcoming one), then the
   chosen cycle's dates as a list, each with its display name from metadata,
   its value or "Not set", and "Changed by X, <date>". Editors get an **Edit**
   control per date that opens the browser's date picker (native
   `<input type="date">`, as in
   `shared/components/reviewers/ReviewerDueDateEditor.js`) with Save,
   Cancel and Clear date. Saving writes that one column; clearing writes
   null. Non-editors see the same list without edit controls.
3. **Access.** View: **any signed-in staff member** (owner, 2026-10-28),
   read-only for non-editors; not tied to Reviewer app access, because the
   Program Coordinator role may be held "without Reviewer app access"
   [VERIFIED via `lib/services/board-writeups/model.js:10-11`]. Edit: a system
   administrator or the user assigned to the Grants Manager or Program
   Coordinator role (D7, D8; role keys `board_writeups.grants_manager`,
   `board_writeups.program_coordinator`, model.js:7), checked server-side on
   every save. Precedent for the role check:
   `lib/services/board-writeups/config.js:58` (`canArchive` = superuser or
   assigned Grants Manager). Reassigning the role moves the right with no code
   change (D1). The page shows the edit controls only when the server reports
   the caller may edit (UI mirrors the server guard).
4. **Concurrency.** Save with the row's ETag: `updateRecord` already accepts
   `ifMatch` and surfaces a changed row as status 412 [VERIFIED via
   `lib/services/dynamics/write-core.js:165-205`]; the panel shows "this
   cycle changed since you opened it; reload" instead of overwriting.
5. **Input.** Cycle chosen by code, validated against `^[JD]\d{2}$`; row id
   GUID-validated before it reaches a Dataverse selector
   (`check:trust-boundary-guid`); only the eleven date columns are writable
   (allowlist); values must be `YYYY-MM-DD` or null.
6. **No consumers yet.** The prototype only stores and shows dates. Readers
   (default cycle, filing window, Feb 3 warning, readiness notices) come in
   later slices, each reading through the same adapter.

Out of scope for the prototype: creating cycle rows (Connor's process),
editing cycle code, name or Board date unless the owner adds them, and any
copy of these dates into settings or Postgres.

## 4. Tracking who changed each date, and when

Requirement (D7; owner 2026-10-28): every date shows who last changed it and
when, whether the change came from the Admin calendar or directly in Dynamics.

Row-level `modifiedby` / `modifiedon` cannot answer this per date: one save to
any column overwrites them for the whole row. Two mechanisms do:

**A. Dataverse audit history (preferred).** Field-level audit records every
column change with the user and time, for app saves and Dynamics edits alike.
The app reads it **per row** with `RetrieveRecordChangeHistory` (a handful of
cycle rows, so per-row reads are cheap). That per-record read returned 200
for this app on `akoya_request` and `contact`; the bulk `/audits` query is
403 because the app lacks `ReadAuditSummary` [VERIFIED via
`docs/DATAVERSE_POWER_TOOLS_DESIGN.md:79`;
`docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md:237`]. **Response contract verified 2026-10-28** (Codex adversarial review claimed
Web API AuditDetail entries omit `AuditRecord`; tested rather than assumed)
with `scripts/probe-audit-history-shape.cjs`, owner-run, structure only
(`docs/audits/audit-history-shape-2026-10-28-evidence.json`):

- On a recently modified `akoya_request`, `RetrieveRecordChangeHistory`
  returned 200 with 12 `AttributeAuditDetail` entries; **every** one carried
  `AuditRecord` with `createdon`, `_userid_value` and its formatted name. The
  Codex claim does not hold for this org.
- On the J27 `wmkf_grantcycle` row it returned 200 with one entry that has no
  type and no value sides (recorded when auditing was enabled); it changes no
  tracked column and is ignored.
- The collection carries `MoreRecords` / `PagingCookie`. A paged result is
  treated as **incomplete**, not guessed at.
- The fallback route is **closed**: `/audits` filtered to one object is 403
  for this app on both rows. `RetrieveRecordChangeHistory` is the only audit
  read available.

Parsing rule (`latestChanges`): entries that change no tracked column are
ignored; a tracked change missing `createdon` or the formatted user name, or a
paged collection, marks the cycle's history unavailable. A date is attributed
only when its newest audited value (a clear counts as "Not set") equals the
value displayed; otherwise that date shows no "changed by". This covers an
edit landing between the row read and the history read (Codex re-review,
2026-10-28; judged unlikely, accepted because the check is cheap) and dates
changed while auditing was off or by a path that writes no history. Row-ETag
re-checks and retries were judged not worth the complexity. Unavailable history
(that, a failed read, or a revoked audit privilege) never shows a per-date
claim: the panel shows the row's `modifiedon` / `modifiedby` labelled "last
change to this cycle (any date)". Tests use a fixture built from the captured
structure. [VERIFIED 2026-10-28 probe] Organization auditing is **on** and all
fourteen columns are flagged for auditing, but auditing on the
`wmkf_grantcycle` **table was off**. **Turned on 2026-10-28 (Pacific)** with
owner-run `scripts/enable-grant-cycle-audit.cjs --apply`: before `false`,
after `true` (T14; Justin informing Connor). History starts from that moment;
no earlier edits are recorded.

**B. Correct attribution of app saves.** Audit history names whoever
Dataverse thinks made the change. App writes carry the staff member's
identity only through impersonation (`MSCRMCallerID`), which
`lib/services/dynamics/write-core.js` sends only when
`DYNAMICS_IMPERSONATION_ENABLED === 'true'` and drops (retrying as the app's
own identity) when Dataverse returns 403 [VERIFIED via
`lib/services/dynamics/write-core.js:78-79,103-104`]. For calendar saves that
fallback would record the app, not Sarah or Duncan. So:

- Calendar saves call `updateRecord(..., { ifMatch, actingUserSystemId,
  noFallback: true })` [VERIFIED option set via
  `lib/services/dynamics/write-core.js:177`; precedent
  `lib/services/reviewer-due-extension.js:294`]; a 403 is shown as "you do
  not have permission to change this date in Dataverse".
- `noFallback` alone is not enough: when the flag is not `'true'` or the
  caller has no Dataverse user id, no impersonation header is sent at all and
  the write lands as the app [VERIFIED via `write-core.js:77-80`]. The save
  service therefore **refuses** unless `DYNAMICS_IMPERSONATION_ENABLED ===
  'true'` and the session carries `dynamicsSystemuserId` (precedent: a
  sending feature that requires the flag, `docs/CREDENTIALS_RUNBOOK.md:137`).
- The flag is documented `true` in Production [VERIFIED via
  `docs/CREDENTIALS_RUNBOOK.md:205`, last verified S466; not re-checked this
  session]. Write privilege [VERIFIED 2026-10-28 via owner-run read-only
  `scripts/probe-grant-cycle-write-privileges.cjs`,
  `docs/audits/grant-cycle-write-privileges-2026-10-28-evidence.json`]: the
  app user, the assigned Grants Manager, the assigned Program Coordinator and
  the owner each hold `prvReadwmkf_GrantCycle` and `prvWritewmkf_GrantCycle`
  at Global depth through their security roles. Impersonated writes run under
  the intersection of the app's and the user's privileges
  (`write-core.js:62`), which here includes Write.

**Fallback if A or B cannot be met:** the app writes its own change record
with each save (cycle, column, old value, new value, staff member, time) and
shows it; direct Dynamics edits then show only as "changed outside the app on
<row modifiedon>". Where that record would live (an app-owned Dataverse table
or a versioned app setting, following the revision-checked
`board_writeups.cycle.<code>` pattern) is decided only if this fallback is
needed.

## 5. Behavior when data is missing

- **No row for a cycle:** normal before its portal opens; the calendar shows
  only existing rows and never creates one.
- **Null date:** shown as "Not set". Consumers treat it as unknown and say
  so (for example in the readiness view); they never substitute a hardcoded
  or derived date.
- **Request without a lookup:** fall back to the meeting-date cycle (T10).

## 6. Delivery controls

This is a new write path to a Dataverse table, so it is **Tier 2** under
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`: its own branch,
characterization tests, an integrated rehearsal (here a controlled Production
test, Mode D, by owner decision below), recorded rollback, and an explicit
owner decision to merge. This plan, the probe and its evidence
are docs (Tier 0).

**Merge condition (owner, 2026-10-28: "I don't want to rely on hope as a
strategy"):** before the branch merges, a real edit must be read back with
correct attribution. **Venue (owner decision 2026-10-28):** the sandbox cannot
prove Production privileges or Production attribution (different users, an
app user with System Administrator, no cycle rows, table auditing off) and
would need four sandbox-only workarounds, so the proof is a **controlled
Production test** instead: the branch runs locally against Production with a
dated write acknowledgement passed to that one process; the owner, signed in
as themselves, sets one J27 date, confirms "changed by", clears it and
confirms again. J27's audit history keeps those two entries. A passing unit
fixture alone does not satisfy this.

**Controlled Production test — passed 2026-10-28 (Pacific)** [VERIFIED via
owner click-through on the branch running locally against Production, then
owner-run read-only `scripts/probe-grant-cycle-history-entries.cjs --cycle J27`]:
the owner set J27 Proposal Due to 2026-12-07 at 03:56:58Z and cleared it at
03:58:46Z (UTC). Both audit entries are `AttributeAuditDetail`, `Update`,
user **Justin Gallivan** (impersonation recorded the person, not the app); the
clear records the old value in `OldValue` with no `NewValue` column, as the
parser expects. Fed those exact entries, `loadCalendar` attributes the cleared
date to the owner, and the page showed "Changed by Justin Gallivan, Oct 28,
2026". J27 is back to all eleven dates null. The test found two UI issues,
both fixed on the branch: (1) the save response reads history before Dataverse
makes the new audit entry readable, so the panel now shows "Recording who made
this change…" and re-checks at 2, 4 and 8 seconds; (2) a reload reset the
dropdown to the default cycle, so the chosen cycle is now kept in the URL
(`?cycle=`).

Schema and sandbox:

- ~~Update `lib/dataverse/schema/wave0-prod-parity-foundation/01_wmkf_grantcycle.json`
  to the live columns and apply it to the sandbox.~~ **Done 2026-10-28 on the
  branch:** eleven dates added, `wmkf_CycleName` removed from the spec. The
  sandbox (`orgd9e66399`, `DYNAMICS_SANDBOX_URL` passed inline only — setting
  it in `.env.local` repoints runtime services) dry run showed exactly the
  eleven column creations; `--execute` created them; a rerun creates nothing.
- Sandbox state found 2026-10-28 [VERIFIED via read-only sandbox query]:
  organization auditing on, **`wmkf_grantcycle` table auditing off**, and
  **no J/D cycle rows**. These were prerequisites for a sandbox rehearsal;
  **superseded** by the owner's choice of a controlled Production test, so
  neither was done.
- Atlas page for `wmkf_grantcycle`: added (`docs/atlas/dataverse-wmkf-grantcycle.md`).

**Rollback.** Revert the merge commit. The feature adds a route, a page, an
Admin view, a Tools link, an adapter and a service; it has no migration, no
Production schema change and no data-model change, so reverting removes it
cleanly. Independent of the revert and left in place: Production table
auditing on `wmkf_grantcycle` (enabled 2026-10-28; turn off with the same
metadata update if ever needed) and the eleven columns added to the sandbox.
Dates saved through the calendar stay in Connor's table, as they would if
entered in Dynamics.

Surfaces the build must update, each with its gate: route rows in
`docs/API_ROUTE_SECURITY_MATRIX.md` (`check:api-routes`); route namespace
lifecycle map (`check:route-lifecycle-auth`); route counts in
`CANONICAL_COUNTS` (`check:fact-consistency`); adapter-only Dataverse access
(`check:dataverse-access-layer`); service between route and adapter
(`check:route-service-boundary`); GUID validation
(`check:trust-boundary-guid`); OData escaping of the cycle code
(`check:odata-escape`); Atlas (`check:atlas`); service catalog entry; unit
tests for the role check, the impersonation refusal, the 412 path, the
column allowlist and the null-date display.

## 7. Open questions

| Question | Who | Blocks |
|---|---|---|
| Which timeline step each new date column represents (TBD; staff deciding) | Sarah, Beth, Duncan; Connor for field meaning | Consumers only; the prototype shows display names |
| Dates the apps use with no column yet: reviewer invitation start (opens the D11 filing window), the Feb 3 staff-recommendation deadline (D40), the Jan triage meetings. Add a column, derive from another date, or keep app-side? | Justin with Connor | D11 filing window; D40 warning |
| Impersonation flag in Production; calendar users' write privilege on the table | Justin / Connor | §4 B |
| Whether the calendar edits the Board date too, given requests carry their own meeting date and Board writeups keep `boardEnds` | Justin | Board-date reconciliation (default-cycle plan) |
