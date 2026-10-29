---
title: Cycle calendar on the operations Grant Cycle table — plan
domain: platform
kind: plan
status: proposed
summary: "Owner decision 2026-10-28 (alignment log D43): the operations Grant Cycle table (wmkf_grantcycle) is the authoritative home for the cycle milestone dates it carries, edited from an app Admin calendar by the Grants Manager / Program Coordinator roles, with per-date who/when tracking. Prototype scope, edit tracking, Tier 2 controls and open questions; nothing built."
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

Status: **proposed; nothing built.** Decision record: alignment log D43
(2026-10-28), which supersedes the date split in D10. Run `/contract-reconcile`
on this plan before the prototype branch starts.

## 1. Decision

The operations Grant Cycle table (`wmkf_grantcycle`) is the authoritative home
for every cycle milestone date it carries. The apps read those dates and also
**edit them** from one Admin calendar, so staff manage the cycle's milestone
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

1. **Read adapter.** A new DAL adapter, proposed as
   `lib/dataverse/adapters/grant-cycle.js` [NOT-READ: lib/dataverse/adapters/grant-cycle.js — proposed new file; does not exist],
   with named operations: list rows with a modern `J`/`D` two-digit code
   (`^[JD]\d{2}$`), get one row by code, update the date columns of one row.
   Writes run under `withDalContext` and pass the Dataverse target interlock
   like every other write. `check:dataverse-access-layer` requires this shape.
2. **Admin calendar section.** One section in the Admin panel listing the
   recent cycles (columns = cycles, rows = dates) with each date's display
   name from metadata, its value or "Not set", and "last changed by X on Y".
   Editing a date saves that one column.
3. **Access.** View: anyone with Admin access to the section. Edit: a system
   administrator or the user assigned to the Grants Manager or Program
   Coordinator role (D7, D8), checked server-side on every save. Precedent:
   `pages/api/admin/board-writeup-cycles.js` (administrator or assigned
   Grants Manager). Reassigning the role moves the right with no code change
   (D1). New route rows go in `docs/API_ROUTE_SECURITY_MATRIX.md`.
4. **Concurrency.** Save with the row's ETag (`If-Match`); a stale save is
   refused with "this cycle changed since you opened it" rather than
   overwriting another editor's change.
5. **No consumers yet.** The prototype only stores and shows dates. Readers
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
column change with the user and time, for app saves and Dynamics edits alike,
and the app reads it per row (`RetrieveRecordChangeHistory` / the `audits`
table). [VERIFIED 2026-10-28 probe] Organization auditing is **on** and all
fourteen columns are flagged for auditing, but auditing on the
`wmkf_grantcycle` **table is off**, so nothing is recorded today. Turning it
on is a table setting, not code: a task for Connor (T14). History starts from
the moment it is turned on.

**B. Correct attribution of app saves.** Audit history names whoever
Dataverse thinks made the change. App writes carry the staff member's
identity only through impersonation (`MSCRMCallerID`), which
`lib/services/dynamics/write-core.js` sends only when
`DYNAMICS_IMPERSONATION_ENABLED === 'true'` and drops (retrying as the app's
own identity) when Dataverse returns 403 [VERIFIED via
`lib/services/dynamics/write-core.js:78-79,103-104`]. For calendar saves that
fallback would record the app, not Sarah or Duncan. So:

- Calendar saves must **require** impersonation: no silent fallback; a 403
  is shown as "you do not have permission to change this date in Dataverse".
- Before building, confirm the flag is on in Production [ASSUMED, not
  checked] and that the Grants Manager and Program Coordinator users hold
  write privilege on `wmkf_grantcycle` in Dataverse [ASSUMED, not checked].

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
characterization tests, a sandbox rehearsal (Mode C), recorded rollback, and
an explicit owner decision to merge. This plan, the probe and its evidence
are docs (Tier 0).

Before the sandbox rehearsal:

- Update `lib/dataverse/schema/wave0-prod-parity-foundation/01_wmkf_grantcycle.json`
  to the live columns (add the eleven dates; drop `wmkf_CycleName`) and
  apply it to the sandbox; a reviewed commit.
- Add an Atlas page for `wmkf_grantcycle` once runtime code reads it.

## 7. Open questions

| Question | Who | Blocks |
|---|---|---|
| Which timeline step each new date column represents (TBD; staff deciding) | Sarah, Beth, Duncan; Connor for field meaning | Consumers only; the prototype shows display names |
| Dates the apps use with no column yet: reviewer invitation start (opens the D11 filing window), the Feb 3 staff-recommendation deadline (D40), the Jan triage meetings. Add a column, derive from another date, or keep app-side? | Justin with Connor | D11 filing window; D40 warning |
| Turn on auditing for the `wmkf_grantcycle` table (T14) | Connor | §4 A |
| Impersonation flag in Production; calendar users' write privilege on the table | Justin / Connor | §4 B |
| Whether the calendar edits the Board date too, given requests carry their own meeting date and Board writeups keep `boardEnds` | Justin | Board-date reconciliation (default-cycle plan) |
