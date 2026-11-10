# Real inventory and isolated rehearsal preparation

[VERIFIED via live read-only probes, November 9, 2026 Pacific]
Scope authorized by Justin: full roster export, feedback roster IDs, saved Site Visit
and deliberation session/slot attendee references, linked Contact/User identity and
status fields. No Production writes, real-record copy to sandbox, Preview configuration
change or Dataverse schema provisioning occurred.

## Inventory

Canonical restricted evidence directory (outside Git):
`/private/tmp/wmkf-roster-inventory-20261109-final`.
Directory permissions 0700; files 0600. Preserve privately before temporary-directory
cleanup. Do not commit the files. Earlier partial attempts and v3 are superseded by
this final inventory; use its `source.json` dataset UUID for all subsequent exports
and deltas. The explicit UUID is a fixed lineage identifier, not an export timestamp.

| Finding | Result |
|---|---|
| Roster | 39 active rows: 26 Consultant, 9 Board, 4 Research Program Staff |
| Contact links | 10; all resolve to active Contacts with email |
| Duplicate names / Contact links | None in the exported roster |
| Preserved text lengths | All within proposed schema limits |
| Feedback dependencies | 7 roster references; all source IDs exist |
| Production Site Visits | 32 read; 29 nonempty attendee maps; no roster-kind references found |
| Production deliberation sessions | 9 maps; no roster-kind references found |
| Sandbox Site Visits / sessions | 4 Site Visits with no saved maps; zero sessions |
| Deliberation slots | No slot-local attendee field by design; slots inherit the parent session attendee map |
| Proposed Expertise Profile | `wmkf_expertiseprofile` absent in both environments |
| Source DB | PostgreSQL 17.11; read-only transactions enforced |

The attendee parser counts explicit `{kind:'roster', rosterId:...}` references;
zero does not eliminate the requirement to preserve supported future/historical
reference behavior. The earlier missing-slot-field finding was an inventory interpretation error, now
resolved: `DELIBERATION_SLOT_SELECT` omits the field,
`DELIBERATION_SESSION_EXPAND` includes it on `wmkf_Session`, and
`meeting-tracker/schedule-reader.js` resolves attendees from that parent session.
The Wave 28 slot/session schema specifications agree. No schema change is needed.

All four configured source aliases were connected read-only and reported `neondb`;
pooled and direct endpoints report different internal server addresses. This alone
does not prove identical server identity. Rehearsal uses none of these connections.
No live Vercel environment bindings were changed or independently verified.

Private files include the full original source, column/constraint/sequence/ledger
metadata, reference maps, linked Contacts, enabled User identity candidates, input
checksums, aggregate analysis and draft mappings for each target. Every draft mapping
is `confirmed:false`; links/eligibility are not guessed or approved by the exporter.
The original roster remains active as found: Kevin's retirement override has NOT been
applied. Beth's lead eligibility and the two new PD identities remain pending. No
production GUID was treated as a sandbox counterpart. Missing profile tables mean
there is no valid complete target-profile snapshot for a real import dry run yet.

## Dedicated local rehearsal

[VERIFIED via server query and fixture readback] Container
`wmkf-roster-rehearsal17-20261109`, named volume of the same name, PostgreSQL 17.11,
host binding `127.0.0.1:55439`, database/user `roster_rehearsal`.
Image digest: `sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac`.
The initial PostgreSQL 16 container `wmkf-roster-rehearsal-20261109` is stopped and
its synthetic-only volume retained; it is not the rehearsal target.

Restricted connection files:
`/private/tmp/wmkf-roster-rehearsal-20261109/rehearsal.env` and `postgres.env`.
All four database aliases point to the same dedicated local database. Both Dataverse
URL settings point to the registered sandbox hostname; both enforcement flags are on.
The file intentionally contains no Dataverse credentials and is not connected to a
running application or Vercel Preview. Colima must be running to use the database.

Synthetic fixture: three roster rows, one feedback row, original roster FK and
sequence retained, empty identity/binding tables. Roster and feedback DDL come from
existing migrations. `user_profiles` is a minimal FK fixture, not the full app schema.
This is ready for focused SQL migration/recovery development, not end-to-end app UAT.
There are no real exported records in this database.

## Reproduction and guards

- `scripts/inventory-expertise-roster.cjs ENV_FILE NEW_PRIVATE_DIR SOURCE_DATASET_UUID`
  reads scoped records; requires a stable explicit lineage; rejects Git/symlinked
  destinations; enforces read-only Postgres and same-origin bounded GET pagination.
- `scripts/summarize-roster-inventory.cjs PRIVATE_DIR` produces an exclusive aggregate
  analysis file. Does not replace mapping confirmation.
- `scripts/prepare-roster-rehearsal.cjs PRIVATE_REHEARSAL_ENV` initializes only an EMPTY
  dedicated loopback database; refuses URL query overrides, mismatched aliases,
  wrong database/user and nonempty databases. Its successful fixture is already
  initialized; rerunning correctly refuses without modifying it.

Fresh independent review identified URL override isolation, unstable lineage and
Git destination gaps; each was repaired. Regression tests cover isolation override,
required lineage and Git-destination rejection; existing planner tests remain green
(15 tests total). Live initialized-database rerun refused with
`Database is not empty; no changes made`.

## Next boundaries

1. Slot field investigation is resolved: use parent-session attendee references for
   migration parity. No slot-local column is required.
2. Review per-person mappings and owner overrides; no guessed new PD identities.
3. Provision and prove the reviewed Expertise Profile schema in sandbox, including
   auditing, attribution, keys/null behavior and permissions, under scoped write approval.
4. Extend the local fixture into a full isolated application database and configure a
   dedicated Preview only when the runtime slice is ready. Verify every actual deployed
   connection alias then. Do not point that Preview at shared Postgres.
5. Import/recovery/rollback and matching prompt gates remain unexecuted.
