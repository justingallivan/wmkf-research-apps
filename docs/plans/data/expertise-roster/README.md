# Expertise roster import tooling

[VERIFIED via source and synthetic tests] Branch implementation of
`docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md`.
The app still uses its existing roster. Sandbox schema and synthetic rehearsal status
are recorded in `SANDBOX_REHEARSAL_2026-11-09.md`; no Production migration occurred.

## Artifacts and boundaries

- `lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json`:
  proposed entity, preserved optional fields, category choices, default-false lead
  eligibility, optional User lookup and Contact GUID text, three alternate keys.
  Choice values are provisional until metadata preflight. Audit configuration,
  actor attribution, permissions, concurrency and key activation are separate
  release gates. This specification is now provisioned in sandbox only.
- `identity-bridge.sql`: inert DDL draft, deliberately outside auto-discovered
  migrations. No allocator, population, FK retarget or sequence advancement.
  Assign a migration number only after branch claims and live ledger reconciliation;
  then integrate manifest, fresh-install schema and gates together.
- `scripts/plan-expertise-roster-import.cjs`: file-only planner. No credentials,
  environment loading, network requests, database writes or execution mode.
  It emits normalized proposed values, not a directly executable Web API payload.
  `scripts/execute-expertise-roster-import.cjs` now supplies a separate, explicit
  sandbox-only execution path. It is not a Production cutover command.

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
  `role_type` and `is_active`. Execution additionally requires `sequenceHighWater`
  from the original source sequence (now captured by the inventory script), at least
  the maximum exported ID. Do not guess or regenerate lineage for a retry. Original audit columns may be retained and hashed;
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
  an active staff profile with User link; the executor checks enabled status.
  Optional `roleType` applies an explicit category override without mutating the raw
  source. `exclude: true` requires an inactive, ineligible, unlinked legacy identity
  and produces an identity-only tombstone, not a profile deletion.
- New people: optional mapping `newProfiles` entries contain a stable `mutationId`
  UUID, a full source-shaped `row` **without** `id`, and a `decision` containing
  confirmed/link/active/eligibility values. They use `app_<mutationId>` keys; the
  bridge allocates their numeric identities. Amy staging is represented as inactive
  Research Program Staff, null links and false eligibility; no real row or GUID
  is fabricated in checked-in fixtures.

Stable creation keys derive from source lineage and old numeric ID. Exact keyed
matches are unchanged; mismatches stop for reconciliation. Linked duplicates are
blocked including inactive holders. Same-name candidates produce warnings without
merging. Dataset/source/target/mapping hashes bind each report to its input evidence.

## Contract verification

| Invariant | Enforcement / evidence |
|---|---|
| Planner has no live changes | Planner CLI reads three files and exclusively writes one report; no execute option |
| Preserve fields | Explicit projection, type/length checks, null/empty tests |
| Stable identity/replay | Dataset + legacy key; exact existing-value comparison tests |
| No hidden link collisions | Explicit target link projection, canonical GUID and uniqueness tests |
| No implicit decisions | Confirmed mapping and lead/category/link checks |
| No source-to-target GUID copying | Per-target mapping, mismatch warning test |
| No overwrite of evidence | Exclusive mode-0600 output and CLI overwrite test |

The planner remains file-only. The separate executor flow is operator → explicit
CLI arguments → reviewed source/mapping and execution-projection comparison → fresh
complete target census → metadata/link preflight → create-only Dataverse writes →
one locked bridge transaction → private receipt. There is no app/UI entry point,
no matching prompt change and no consumer cutover in this slice.

## Sandbox execution contract (not run live)

`execute-expertise-roster-import.cjs` requires all six arguments:
`--source FILE --mapping FILE --reviewed-plan FILE --env PRIVATE_FILE
--receipt NEW_FILE --execute sandbox`. Running it requires separate live-import
approval. The reviewed plan is the nonblocked output of the file-only planner;
review every warning. The executor compares source/mapping hashes and the stable
row payload, and rejects newly changed warnings. It never trusts a plan's old
`create`/`unchanged` disposition without reading the current target.

The private environment file must set `EXPERTISE_ROSTER_REHEARSAL=on`, the registered
sandbox URL, both enforcement flags, and all four Postgres aliases to exactly the
same loopback `127.0.0.1:55439/roster_rehearsal` connection with user
`roster_rehearsal`. Production/Preview execution is refused. Credentials are for the
application's Dataverse client, not development-agent authentication. Import writes
use service-principal attribution; staff-editor permission/attribution verification
remains separate. The executor does not change schema, auditing, permissions or flags.

The target must have active creation/User/Contact keys, table auditing and optimistic
concurrency. A complete census and per-link reads precede writes. New records use
POST only. A lost response is recovered by reading the same key and comparing every
managed value. A mismatch fails without overwriting or deleting the profile.

The dedicated local bridge transaction locks the old roster, identity and binding
tables. All legacy identities, including exclusions, are reserved before new-number
allocation. Bindings are target-specific and conflicting forward/inverse mappings
are refused. Allocation includes the captured source sequence high-water, local old
sequence/rows and every existing bridge identity. On successful completion the local
fixture's old sequence is advanced above allocated IDs; rollback can leave harmless
sequence gaps. These are temporary transaction locks, **not** the durable deployment
admission/freeze required for Production. No numbered migration or runtime allocator
is installed by this command.

If any row fails, the SQL transaction rolls back as a unit; already-created Dataverse
profiles remain. The receipt names the failing creation key and marks prior bridge
results unconfirmed, never saved. A lost COMMIT response likewise remains unconfirmed.
Replay unchanged inputs to recover by key and target binding. Do not mint new mutation
or dataset UUIDs to bypass an error. Dataverse requests have 30-second timeouts so
transport failure can release the database locks. The exclusive mode-0600 receipt
contains identities/status, not expertise text; retain it privately with the inputs.
A killed process may leave a started-only receipt: replay is the recovery path.

No real import or local SQL execution was performed during this implementation.
Synthetic tests use in-memory durable stores for failure recovery and mocked concrete
transport/SQL boundaries. Actual PostgreSQL transaction behavior, Dataverse null/empty
round trips, permissions, audit events and all linked-person lifecycle cases still
need the separately authorized rehearsal. Exact comparison deliberately refuses a
server normalization mismatch instead of silently losing source distinctions.

Final Fable plan review: `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_4_2026-11-09.md`.
This review does not certify the implementation or live readiness.

## Next stage and remaining gates

Real inventory and a dedicated local PostgreSQL 17 synthetic fixture were prepared on November 9; the private temporary directories are unavailable in the current session. Recover them or obtain an authorized fresh export with the same source lineage before a real import;
see `INVENTORY_AND_REHEARSAL_2026-11-09.md` for verified counts and limitations.
Staff eligibility, new PD staging and placeholder exclusion are recorded in
`OWNER_MAPPING_DECISIONS_2026-11-09.md`. Slot storage is parent-session inheritance.
Complete the remaining
schema/audit/keys/permissions verification, integrate consumers, and rehearse
actual import plus rollback. The executor is built on the import branch; its presence
is not live-import evidence. The owner-reviewed minimal matching
prompt contract and verified old-deployment admission/drain remain cutover prerequisites.

## Historical verification record — November 9, 2026

[VERIFIED via commands] All 13 scoped Jest tests passed. The fixture CLI rehearsal
produced one proposed create, zero blocked rows and `executionAuthorized: false`.
Atlas, migration-manifest, doc-currency, fact-consistency and canonical-pointer gates
passed; each available corresponding self-test ran sequentially and passed.
`git diff --check` passed. These cover source/doc consistency and offline behavior,
not actual Dataverse schema or SQL execution. Node emitted its existing mixed-module
package warning when importing the target registry; the command completed successfully.

## November 10 implementation verification and bounded reconciliation

[VERIFIED via source, Jest and repository gates] The create-only executor, explicit
sandbox CLI, and guarded transport/bridge store are implemented on
`codex/expertise-roster-import-2026-11-10`. Tests cover approved-input/payload tampering,
lost create responses, later-row failure, bridge rollback/replay, exclusions, new-person
allocation, conflicting mappings, target isolation, high-water preservation, HTTP
timeouts, pagination refusal and CLI argument refusal. No live import was executed.
Independent source/test review found three issues (reviewed payload binding, bridge
high-water on replay, unbounded HTTP waits); all were repaired and re-reviewed.

Narrow sweep mode A: claim changed from “planner only” to “sandbox executor built,
not live exercised.” Authoritative evidence is the three import modules, CLI and
synthetic tests. README, owner-decision guidance, Atlas tool status and this branch's
session pointer were updated. The migration plan remains an agreed broader release
contract; its unperformed consumer/cutover requirements are unchanged. The dated
November 9 inventory and rehearsal records remain historical evidence. The same
search for “not yet apply,” “later writer,” and “planning-only” in these roster
surfaces found no remaining stale statement. Remote state was not re-probed.

Unknowns remain explicit: actual SQL transaction/locking execution, Dataverse
normalization/permission behavior, full import parity, restored private source evidence,
consumer integration and Production release. A green mocked test is not evidence
that any of those live steps occurred.
