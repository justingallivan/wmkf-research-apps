# Expertise roster offline foundation

[VERIFIED via source and synthetic tests] First implementation slice of
`docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md`.
This is not a deployed migration. The app still uses its existing roster.

## Artifacts and boundaries

- `lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json`:
  proposed entity, preserved optional fields, category choices, default-false lead
  eligibility, optional User lookup and Contact GUID text, three alternate keys.
  Choice values are provisional until metadata preflight. Audit configuration,
  actor attribution, permissions, concurrency and key activation are separate
  unexecuted gates. Do not provision this specification yet.
- `identity-bridge.sql`: inert DDL draft, deliberately outside auto-discovered
  migrations. No allocator, population, FK retarget or sequence advancement.
  Assign a migration number only after branch claims and live ledger reconciliation;
  then integrate manifest, fresh-install schema and gates together.
- `scripts/plan-expertise-roster-import.cjs`: file-only planner. No credentials,
  environment loading, network requests, database writes or execution mode.
  It emits normalized proposed values, not a directly executable Web API payload.
  A later writer must translate lookups/state correctly and enforce all release gates.

## Synthetic rehearsal

From the isolated worktree, use a new report path each time:

```bash
node scripts/plan-expertise-roster-import.cjs \
  --source tests/fixtures/expertise-roster/source.json \
  --target tests/fixtures/expertise-roster/target.json \
  --mapping tests/fixtures/expertise-roster/mapping.json \
  --output /tmp/expertise-roster-synthetic-report.json
npm test -- --runInBand tests/unit/expertise-roster-import-plan.test.js
```

Fixtures contain invented information only. Output is created exclusively with
owner-only file permissions and never overwrites an existing file. Reports may
contain all input expertise and identity fields; keep real exports/reports out of
Git and retain them in the approved private location. Stdout contains counts only.
Exit 0 means a valid offline proposal, 2 means at least one blocked row, and 1 means
invalid input or output failure. No exit status authorizes applying changes.
Never partially apply a report containing blocked rows. Every warning requires
review, especially possible name duplicates; names never establish identity.

## Input contract

All three files have `version: 1`; see fixtures for envelope shape.

- Source: fixed source-lineage `datasetId` UUID and full roster `rows`, including
  every preserved text column (explicit null allowed), numeric `id`, `name`,
  `role_type` and `is_active`. Original audit columns may be retained and hashed;
  they are not written over Dataverse native audit fields. Preserve the original
  export for historical audit evidence. Unknown columns and excessive lengths
  block rather than silently truncate. Empty text and null remain distinct.
- Target: registered exact hostname, `complete: true` and `profiles` from a complete
  paginated export. Every row has canonical `profileGuid`, and normalized `values`
  with explicit `wmkf_name`, `wmkf_creationkey`, `wmkf_contactguid` and
  `wmkf_staffuser` (null or GUID). Existing import-key matches require every managed
  value for comparison. This is NOT a raw Web API export: normalize lookup values
  to `wmkf_staffuser`; do not put OData bind syntax in it. Completeness is a supplied
  assertion, not something this offline tool can independently prove.
- Mapping: same dataset and target, one explicit owner-reviewed row per legacy ID,
  including `confirmed`, both optional person links, `active` and `leadPdEligible`.
  Set `confirmed: false` for pending decisions; the row stays blocked. No contact
  reference is copied automatically between environments. Lead eligibility needs
  an active staff profile with User link; enabled status still requires a live probe.

Stable creation keys derive from source lineage and old numeric ID. Exact keyed
matches are unchanged; mismatches stop for reconciliation. Linked duplicates are
blocked including inactive holders. Same-name candidates produce warnings without
merging. Dataset/source/target/mapping hashes bind each report to its input evidence.

## Contract verification

| Invariant | Enforcement / evidence |
|---|---|
| No live changes | CLI reads three files and exclusively writes one report; no execute option |
| Preserve fields | Explicit projection, type/length checks, null/empty tests |
| Stable identity/replay | Dataset + legacy key; exact existing-value comparison tests |
| No hidden link collisions | Explicit target link projection, canonical GUID and uniqueness tests |
| No implicit decisions | Confirmed mapping and lead/category/link checks |
| No source-to-target GUID copying | Per-target mapping, mismatch warning test |
| No overwrite of evidence | Exclusive mode-0600 output and CLI overwrite test |

Caller → CLI validation → pure planner → local report → human review is the full
implemented flow. App/API/auth, async UI, remote persistence, runtime hydration and
cutover are not in this slice. Partial errors remain identified per legacy ID and
make the whole report blocked. No new runtime consumers or routes were added.
A fresh read-only review found missing target projections and missing name-duplicate
warnings; both were repaired with regression tests.

Final Fable plan review: `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_4_2026-11-09.md`.
This review does not certify the implementation or live readiness.

## Next stage and remaining gates

Real inventory and a dedicated local PostgreSQL 17 synthetic fixture are now prepared;
see `INVENTORY_AND_REHEARSAL_2026-11-09.md` for verified counts and limitations.
Reconcile mappings, Beth's eligibility, new PD identities and the active specialist
placeholder. Slot attendee storage is resolved as parent-session inheritance.
Then prove
schema/audit/keys/permissions, build the roster service and bridge recovery, integrate
consumers, and rehearse import plus rollback. The owner-reviewed minimal matching
prompt contract and verified old-deployment admission/drain remain cutover prerequisites.

## Verification record — November 9, 2026

[VERIFIED via commands] All 13 scoped Jest tests passed. The fixture CLI rehearsal
produced one proposed create, zero blocked rows and `executionAuthorized: false`.
Atlas, migration-manifest, doc-currency, fact-consistency and canonical-pointer gates
passed; each available corresponding self-test ran sequentially and passed.
`git diff --check` passed. These cover source/doc consistency and offline behavior,
not actual Dataverse schema or SQL execution. Node emitted its existing mixed-module
package warning when importing the target registry; the command completed successfully.
