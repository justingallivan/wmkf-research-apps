# Expertise roster production execution — November 19

**Status: PARTIAL — production schema/roles and Postgres-mode deployment complete;
roster import and backend cutover await the owner's Amy Rowat status decision.**
Backend automation and Expertise Finder retirement remain separate and unchanged.

## Verified production checkpoint

[VERIFIED via production CLI/API/SQL and signed-in Chrome, November 19 Pacific]

- Owner explicitly authorized production migration and deployment in this chat.
  Scoped operator reads/writes used the enabled target interlock, exact production
  hostname and dated write acknowledgement. Root `.env.local` was not read.
- Fresh Postgres export contains 40 rows, including existing Amy Rowat ID 40, active.
  John ID 1 is already Staff, Kevin ID 13 and placeholder ID 35 are already inactive.
  Other current content/states are retained, including existing inactive consultants.
- All 10 existing Contact GUIDs resolve to active production Contacts. The mapping
  copies the exact source values; John currently has no Contact link. No rematching.
- All seven feedback rows are accounted for, including ID 35. No affected roster
  references to IDs 1/13/35 were found in 32 Site Visits, nine meeting sessions or
  proposal-list recipient provenance. Existing Staff references are not roster IDs.
- Migration 103 was the sole pending migration and applied through the canonical
  runner from an env-file-free cwd: one applied, 99 skipped. It creates only the
  empty bridge. Feedback FK still references `expertise_roster(id)`.
- `wmkf_expertiseprofile` is provisioned in production with the expected organization
  ownership, field types/lengths, category values, Staff User lookup and all three
  Active alternate keys. Organization/table/editable-column auditing passed the
  live importer preflight after table publication.
- Editor role assigned to existing Admin maintainers Justin and Beth, and the app
  identity. Reader assigned to Connor. Effective privilege reads confirm Justin/
  Beth/app can read/create/write/append the roster. No app superuser grant changed.
  **Connor is not effectively read-only:** his pre-existing roles already grant
  create/write/delete on custom tables. Those broader roles were preserved. His
  actual flow connection/read-only acceptance remains unproven; do not describe
  the Reader assignment as removing existing rights.
- Commit `8eb08ba65` was deliberately promoted to `main`. Ready production deployment
  `dpl_BdqcEkGbbMCGdvGLN3tqxeWQ4ZeF`:
  `https://wmkfresearchapps-eo3flci1b-justin-gallivans-projects.vercel.app`.
  The production backend selector remains absent (Postgres).
- Signed-in Chrome proved Admin → Expertise Roster shows the pre-migration message,
  and the retained Expertise Finder roster reads 21 active people. No paid matching
  or email was run. Admin CRUD acceptance awaits cutover.

Original production deployment retained for diagnosis:
`dpl_A3kN3a5Y6dQSVzintyYin9fomk51`,
`https://wmkfresearchapps-2x0prcx4x-justin-gallivans-projects.vercel.app`.
Use the new Postgres-mode deployment above for recovery, per the runbook.

## Remaining decision and continuation

The reviewed plan staged Amy inactive, without a User link/lead eligibility; fresh
production already contains her active record at ID 40. The owner was asked whether
to retain that active state or make her inactive per the plan. **No answer yet.**
Preserve ID 40 and all existing content either way; do not add another Amy.

The private live plan reports 38 create, one exclusion (ID 35), one blocked (ID 40,
owner confirmation only). Metadata/User/Contact checks passed; generic offline
planner warnings are covered by these live checks. No import has run, no identity
or binding has been inserted, and no FK/backend switch has occurred.

1. Resolve Amy's status in the existing private mapping, then rerun plan with a new
   receipt name. Keep the exported dataset ID and exact Contact values.
2. Follow the [cutover runbook](EXPERTISE_ROSTER_CUTOVER_RUNBOOK_2026-11-19.md): import,
   exact verification, separate new feedback-FK migration/fresh-install parity,
   production backend setting and redeployment, then signed-in CRUD/consumer checks.
3. Reconcile current Atlas/plan/session facts again after actual cutover. Confirm
   Connor's connection and resolve the read-only access expectation without
   stripping unrelated existing roles.

Private source, mapping, receipts, selected configuration and logs are stored in
`/private/tmp/wmkf-roster-production-20261119` (private directory; JSON/env mode 0600).
`run.cjs` supplies explicit selected application credentials and interlock settings;
these are application data operations, not agent CLI authentication. The source is
`source.json`; pending mapping is `mapping-pending-amy.json`; plan evidence is
`plan-pending-amy.json`. A durable private copy of all JSON evidence is also saved in
`/Users/gallivan/.local/share/wmkf-roster/production-20261119`. Preserve the original
dataset identity for resumption; never commit private data.

## Provisioning corrections and checks

Production exposed two script defects: metadata auditing requires full-definition
PUT, and User privileges use `prvReadUser`/`prvAppendToUser` rather than the logical
table suffix `systemuser`. Both corrected in the scoped provisioning script.
PUT preserves the entire fetched definition and merges labels, as required by
[Microsoft's metadata update contract](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api#update-table-definitions).
Transient customization/recycle-bin locks cleared before successful provisioning.
Three regression tests cover metadata preservation and enabled/locked settings;
DAL and GUID gates/self-tests plus secret scan passed. Original application tests
and Opus review evidence remain in the [build report](EXPERTISE_ROSTER_BUILD_2026-11-19.md).
