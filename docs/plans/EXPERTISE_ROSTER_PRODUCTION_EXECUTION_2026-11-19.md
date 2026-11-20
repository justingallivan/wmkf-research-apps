# Expertise roster production execution — November 19

**Status: COMPLETE — production import, feedback identity migration and Admin editor cutover.**
Backend automation and Expertise Finder retirement remain separate and unchanged.

## Verified production result

[VERIFIED via production CLI/API/SQL, exact importer verification and signed-in Chrome,
November 19 Pacific / November 20 UTC]

- Owner authorized production migration/deployment and explicitly confirmed Amy should
  remain active, available for matching and eligible as a PD. Existing ID 40, full
  profile and future email were preserved. She links to her already-existing enabled
  production User; that reference grants no app access. No account, app grant or role
  was created for Amy and nothing was sent.
- Fresh export: 40 source rows, 21 active. Imported 39 profiles; placeholder ID 35
  excluded from selectable profiles while its numeric identity and feedback remain.
  John ID 1 was already Staff/active; Kevin ID 13 and placeholder 35 already inactive.
  All other fresh source states/content were preserved. All 10 existing Contact GUIDs
  were copied exactly and resolved to active production Contacts. John has no current
  Contact link; none was invented. No name/email rematching.
- Approved import plan: 39 create, zero blocked, one exclusion. Import and independent
  verification both returned `verified:true`; comparison checked exact fields, names,
  category/state, Contact/User links, numeric mappings and unchanged source data.
- Migration 103 created the bridge. After exact verification, migration 104 retargeted
  `consultant_feedback_consultant_roster_id_fkey` to `expertise_roster_identity(id)`.
  Both used the canonical runner from an env-file-free cwd after inspecting every
  pending migration. Final ledger has no pending files and no missing feedback identity.
  Fresh-install definitions and manifest match; old Postgres roster rows remain for recovery.
- Production `EXPERTISE_ROSTER_BACKEND=dataverse` is a readable Config value. Runtime
  commit `665b652f0` reached Ready deployment `dpl_FfTvUZLnAeeJsD62ffmB8ZyVtBzb`,
  `https://wmkfresearchapps-i0yfx6zvp-justin-gallivans-projects.vercel.app`.
  Signed-in acceptance used `https://applications.wmkeck.org`.
- Final acceptance snapshot: 40 Dataverse profiles (39 imported + one inactive test),
  41 numeric identities, 40 bindings, 21 active matching candidates. All 40 original
  Postgres roster rows remain. All seven original feedback entries remain; one private
  synthetic acceptance entry brings the total to eight. No original entry was deleted
  or reassigned.

## Editor and consumer acceptance

[VERIFIED via signed-in deployed UI and real service/API/SQL probes]

- Admin → People & Access → Expertise Roster lists and searches the migrated roster;
  include-inactive finds deactivated people. Amy's edit form shows Staff, her existing
  User, active state and lead-PD eligibility; source comparison proves the future email.
- Created `TEST — Roster migration acceptance 2026-11-19` through Admin, numeric ID 41.
  Edited and reopened its keywords; deactivated, reactivated, changed it to Staff and
  linked an unused existing User; then cleared the User, restored Consultant category
  and deactivated it. Final direct Dataverse read confirms the lookup is null. These
  operations passed the actual impersonated write path, including atomic reference clear.
- Saved synthetic private feedback for ID 41 on existing marked test request 1003518
  through the real feedback service. Feedback ID 9 has `shared=false`, no attachment,
  and retains the test author's name after deactivation. It is retained as evidence.
- Real matching and recipient services read the migrated roster successfully. All
  imported names/Contact GUIDs/preferred emails match the source; Amy remains in the
  21-person matching input. Historical inactive authors keep their names and excluded
  ID 35 resolves to “Unavailable consultant”.
- Expertise Finder's Roster tab now links to Admin. Matching/batch pages remain;
  no paid model run was invoked. Matching contracts and failures were covered by the
  focused tests in the build report.
- Existing matching history is retained: SQL reports 344 rows, all with null
  `user_profile_id`. The unchanged history route filters to the signed-in profile,
  so Justin's UI shows no personal history. This pre-existing attribution state was
  not rewritten; this pass does not claim historical rows opened in his browser.
- Non-admin refusal, Admin without a Finder grant, Contact preservation through
  category changes and outage/partial-save cases are covered by focused automated
  tests; this pass did not impersonate another user's browser or send email.
- Reference inventory examined 32 Site Visits, nine meeting sessions and proposal-list
  provenance. No affected roster-kind selections of IDs 1/13/35 required repair.
  Staff profile IDs are distinct from roster IDs. No unrelated saved selections changed.

## Dataverse schema and permissions

`wmkf_expertiseprofile` / `wmkf_expertiseprofiles` is organization owned, with exact
field types/lengths/options, optional Contact GUID, Staff User lookup `wmkf_StaffUser`,
lead eligibility and creation key. Organization/table/editable-column auditing passed
preflight; all three alternate keys are Active. Multiple unlinked profiles and new
Admin creation/reference clear succeeded in production.

Editor was assigned to existing Admin maintainers Justin/Beth and the app identity;
effective read/create/write/append rights were verified. No app superuser grant changed.
Reader was assigned to Connor, but **his existing broader roles already permit
create/write/delete on custom tables**. Those unrelated permissions were preserved.
His actual flow-connection check and any least-privilege adjustment remain separate
follow-up; do not describe his effective access as read-only or strip roles silently.

## Recovery and private evidence

Follow the [cutover/recovery runbook](EXPERTISE_ROSTER_CUTOVER_RUNBOOK_2026-11-19.md).
A flag flip alone is not rollback: reconcile the imported roster plus later Admin
edits/additions into the retained source, preserve IDs/links and User/lead evidence,
restore the validated FK through a new migration if needed, then switch the new code
to Postgres mode before clearing bindings/write markers.

Tested new-code Postgres-mode recovery deployment:
`dpl_BdqcEkGbbMCGdvGLN3tqxeWQ4ZeF`,
`https://wmkfresearchapps-eo3flci1b-justin-gallivans-projects.vercel.app`.
Later Postgres-mode checkpoint: `dpl_14HqP2gfDEMkvWdwy9BNTPei4LaY`,
`https://wmkfresearchapps-a1jq46n68-justin-gallivans-projects.vercel.app`.
Original pre-work deployment: `dpl_A3kN3a5Y6dQSVzintyYin9fomk51`.

Private evidence directory: `/private/tmp/wmkf-roster-production-20261119`;
durable JSON copy: `/Users/gallivan/.local/share/wmkf-roster/production-20261119`.
Directory mode 0700, JSON/env mode 0600. Keep `source.json` and its dataset UUID,
`mapping-approved.json`, `plan-approved.json`, `import-1.json`, `verify-1.json`,
`consumers.json`, `feedback-acceptance.json`, `cutover-final-ledger.json`,
`final-counts.json`, `final-data.json`, and `final-source.json`. Older pending/checkpoint receipts are
historical, not the final state. Never commit private data or credentials.
After the acceptance addition, the original import verifier correctly refuses new
feedback identity 41 outside its frozen export. Use the pre-cutover `verify-1.json`
for exact import proof; `final-source.json` independently proves all 40 source rows
remain unchanged, and final consumer/ledger receipts cover the acceptance addition.
Scoped operator processes used the enabled target interlock, exact production
hostname and dated write acknowledgement. Root `.env.local` was not read.

## Corrections and verification evidence

Production exposed two provisioning defects: metadata auditing requires full-definition
PUT, and User privileges use `prvReadUser`/`prvAppendToUser`, not the logical table
suffix `systemuser`. Both were corrected and production-proved. PUT preserves the
entire fetched definition and merges labels, per
[Microsoft's metadata update contract](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api#update-table-definitions).
Transient customization/recycle-bin locks cleared before provisioning succeeded.
Three regression tests cover metadata preservation and enabled/locked settings.
After migration 104, 44 tests across migration/import/ledger suites passed and the
101-file migration manifest passed. Prior 365 focused tests, scoped gates, builds
and Opus 5.5 OAuth review/correction verification are recorded in the
[build report](EXPERTISE_ROSTER_BUILD_2026-11-19.md).

Sweep Mode A reconciles this completed cutover in the plan, runbook, build status,
Atlas, credential selector, service catalog and session pointers. Final documentation gates and their self-tests passed: Atlas, doc currency, fact
consistency, canonical pointers, doc symbol references and secret scan; docs catalog
and migration manifest also passed. Historical review
reports/November 9 handoff remain dated. Automation, Finder retirement, access grants
for Amy and notifications are outside this completed cutover.
