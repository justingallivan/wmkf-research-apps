# Expertise roster import tooling

[VERIFIED via source and synthetic tests] Branch implementation of
`docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md`.
The app still uses its existing roster. Sandbox schema and synthetic rehearsal status
are recorded in `SANDBOX_REHEARSAL_2026-11-09.md`; no Production migration occurred.

## Artifacts and boundaries

- `lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json`:
  proposed entity, preserved optional fields, category choices, default-false lead
  eligibility, optional User lookup and Contact GUID text, three alternate keys.
  Choice labels/values still require operator metadata verification; the importer
  does not compare option labels. Audit configuration,
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
  block rather than silently truncate. Original exports and raw hashes preserve empty/null
  distinctions. Under owner-approved `empty-string-to-null-v1`, the twelve optional
  text fields map exact empty strings to null in planned target values only; whitespace
  and nonempty text remain unchanged. Names, categories and identity keys are not normalized.
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
Plans and execution receipts carry `textPolicy`; each row lists `normalizedEmptyFields`
without duplicating text. Old plans without the policy marker are refused before the target census or writes
(the CLI may already have authenticated and connected to Postgres). A new plan must be generated and reviewed; adding the marker to an old payload
does not bypass the execution-projection guard. Raw source and mapping files stay unchanged.

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

## Sandbox execution contract

`execute-expertise-roster-import.cjs` requires all six arguments:
`--source FILE --mapping FILE --reviewed-plan FILE --env PRIVATE_FILE
--receipt NEW_FILE --execute sandbox`. Running it requires separate live-import
approval. The reviewed plan is the nonblocked output of the file-only planner;
review every warning. The executor compares source/mapping hashes and the stable
row payload, and rejects newly changed warnings. It never trusts a plan's old
`create`/`unchanged` disposition without reading the current target.

The CLI combines the private environment file with the process environment (file
values take precedence); it does not load `.env.local`. The validated combination
must set `EXPERTISE_ROSTER_REHEARSAL=on`, the registered
sandbox URL, both enforcement flags, and all four Postgres aliases to exactly the
same loopback `127.0.0.1:55439/roster_rehearsal` connection with user
`roster_rehearsal`. Production/Preview execution is refused. Credentials are for the
application's Dataverse client, not development-agent authentication. Import writes
use service-principal attribution; staff-editor permission/attribution verification
remains separate. The executor does not change schema, auditing, permissions or flags.

The target must have active creation/User/Contact keys, table auditing and optimistic
concurrency. A complete census and per-link reads precede writes. Active records use one POST. Inactive records use one atomic change set: POST
creates the row as active, then PATCH `$1` deactivates only that just-created row
before commit. The change-set contract is all-or-nothing (Microsoft Web API documentation);
sandbox verification is recorded below. No pre-existing row is updated. The client method is sandbox-only and checks both embedded responses. A lost response is recovered by reading the same key and comparing every
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

A row failure causes a rollback attempt; already-created Dataverse profiles remain.
Receipt version 2 reports `bridgeCommitted: true` only after an acknowledged COMMIT,
`false` when the transaction failed before attempting COMMIT, and `null` when a COMMIT
response is lost or the transaction outcome is otherwise unknown. `rollbackSucceeded`
is separate: even a successful ROLLBACK after a lost COMMIT response cannot establish
whether that earlier COMMIT succeeded. A rollback error is secondary and does not
replace the original failure.

`failure.phase` distinguishes identity checks, locks, preparation, identity reservation,
row processing, sequence advancement and COMMIT. Transaction-level failures have a
null `failure.creationKey`, rather than naming the last row. Failed rows remain in the
receipt with `createAttempted` and `profileOutcome` (`not-checked`, `not-applicable`,
`absent`, `unknown`, or `observed`). An uncertain create has `createAttempted: true`
and `profileOutcome: unknown` until a keyed read observes a row. A failed-run row's
`rosterId` is null; an observed `profileGuid` is evidence of the Dataverse row, not a
claim that its bridge binding committed.

Replay unchanged inputs only for recoverable transport or transaction failures when
the keyed profile still exactly matches the reviewed values. A keyed-value mismatch,
including unapproved text/state normalization, or a binding conflict **cannot
be fixed by unchanged replay**. Stop for separately authorized manual reconciliation
outside this create-only tool; it never patches/deletes the retained row. Do not alter
the immutable source, mint new mutation/dataset UUIDs, or change the reviewed payload
merely to bypass the conflict. A killed process may leave a started-only receipt;
inspect current keyed state and apply the same recovery/reconciliation distinction.

The authorized retained-profile canary and replay now pass under the explicit text
policy; see the live record below. Before full import, recover the private real source
and quantify exact-empty and whitespace-only text fields offline. Real-source evidence
remains unavailable. Whitespace-only/Memo normalization and full-import parity are not
proved by this one-role-field canary.

Dataverse requests have 30-second timeouts so transport failure can release database
locks. This is a per-request bound, not a bound on total transaction duration. The
exclusive mode-0600 receipt contains identities/status, not expertise text; retain it
privately with the inputs.

No real roster data was imported. The synthetic flow now has live evidence for
inactive create/deactivate commit, SQL rollback on exact-value mismatch, retained-row
binding allocation/COMMIT, and stable replay. Unit tests additionally cover mocked
failure paths. Forced live changeset rollback, permissions/audit events, linked-person
lifecycle cases and full import/consumer parity still need rehearsal. Target comparison
remains exact against the approved canonical values.

Final Fable plan review: `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_4_2026-11-09.md`.
This review does not certify the implementation or live readiness.

## Next stage and remaining gates

Real inventory and a dedicated local PostgreSQL 17 synthetic fixture were prepared on November 9. The fixture was recovered on November 10, but the prior private inventory directories remain unavailable. Recover the source or obtain an authorized fresh export with the same source lineage before a real import;
see `INVENTORY_AND_REHEARSAL_2026-11-09.md` for verified counts and limitations.
Staff eligibility, new PD staging and placeholder exclusion are recorded in
`OWNER_MAPPING_DECISIONS_2026-11-09.md`. Slot storage is parent-session inheritance.
Complete the remaining
schema/audit/keys/permissions verification, integrate consumers, and rehearse
actual import plus rollback. The atomic inactive-create repair is Fable-reviewed and live-verified.
Justin approved exact empty optional text as null while preserving original source.
The planner implements this explicit policy; Fable review, retained-profile canary
commit and stable replay passed. Target comparison remains exact against canonical planned values. The owner-reviewed minimal matching
prompt contract and verified old-deployment admission/drain remain cutover prerequisites.

## Historical verification record — November 9, 2026

[VERIFIED via commands] All 13 scoped Jest tests passed. The fixture CLI rehearsal
produced one proposed create, zero blocked rows and `executionAuthorized: false`.
Atlas, migration-manifest, doc-currency, fact-consistency and canonical-pointer gates
passed; each available corresponding self-test ran sequentially and passed.
`git diff --check` passed. These cover source/doc consistency and offline behavior,
not actual Dataverse schema or SQL execution. Node emitted its existing mixed-module
package warning when importing the target registry; the command completed successfully.

## Historical pre-canary implementation verification — November 10

[VERIFIED via source, Jest and repository gates] The create-only executor, explicit
sandbox CLI, and guarded transport/bridge store are implemented on
`codex/expertise-roster-import-2026-11-10`. Tests cover approved-input/payload tampering,
lost create responses, later-row failure, bridge rollback/replay, exclusions, new-person
allocation, conflicting mappings, target isolation, high-water preservation, HTTP
timeout option propagation and rollback, pagination refusal and CLI argument refusal.
These are synthetic or mocked boundary checks, not live timeout/SQL/platform evidence.
The Fable follow-up repairs add COMMIT-unknown and transaction-phase receipts,
post-create mismatch and forward-binding tests, complete-input CLI refusal, and
database identity-before-lock ordering. The input-hash, post-create comparison,
forward-binding and CLI execute-mode guards were each temporarily removed and their
targeted tests failed; the source was restored after each check. No live import was executed.
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

At that pre-canary checkpoint, SQL execution and platform behavior were untested.
The live record below supersedes that operational status; full import parity, restored
private source evidence, consumer integration and Production release remain pending.


## Historical initial canary — November 10, 2026

[VERIFIED via executor receipts and final read-only Dataverse/Postgres probes]
Justin authorized one synthetic inactive new profile against the registered sandbox
and dedicated local fixture. Code tested: `04c44b9a8`. Private evidence directory:
`/private/tmp/wmkf-roster-canary-20261110-pnN7He` (0700, files 0600; contains
credentials, so do not commit/copy wholesale). Inputs, reviewed plan, initial receipt,
diagnostic-retry receipt, server error and final verification are retained there.

The importer CLI was invoked with all six required arguments, `--execute sandbox`,
source/mapping/reviewed-plan files and `canary.env` from that directory, and a new
receipt path for each attempt. One identical-input diagnostic retry followed a
read-only check that no row or binding persisted. Both attempts exited 2. Target:
`orgd9e66399.crm.dynamics.com`; SQL: `127.0.0.1:55439/roster_rehearsal`, user
`roster_rehearsal`, PostgreSQL 17.11. Production was not contacted.

The one planned row was `Synthetic Import Canary 202f55cd`, creation key
`app_202f55cd-2b14-44f7-b788-70b871a7d4e6`, inactive Research Program Staff,
no User/Contact links, lead eligibility false, empty `role`, other optional text null.
Metadata/audit/concurrency/key preflight and category label/value verification passed.
Dataverse rejected POST with HTTP 400 / `0x80048408`: status code 2 is invalid for
`wmkf_ExpertiseProfileState.Active`. The submitted payload included `statecode: 1`
and `statuscode: 2`; the server response blocked the original direct inactive-create
contract (repaired in the rerun below). Its underlying platform cause has not yet been established. Empty-string
normalization was not reached.

Both receipts report `success:false`, `bridgeCommitted:false`, failed row phase,
`createAttempted:true`, `profileOutcome:unknown`, and `rollbackSucceeded:true`.
The final independent readback establishes the narrower durable result: no keyed
canary profile, unchanged sandbox census of three profiles, three local fixture roster
rows, zero identities/bindings, and unchanged sequence last_value 4 / is_called true.
No cleanup, PATCH, schema change or real-data import was attempted. Colima and the
existing dedicated rehearsal container were started and left running.

## Historical atomic inactive-create repair and live rerun — November 10, 2026

[VERIFIED via source, Fable review, batch response and independent readback]
Commit `83cf6c93c` adds the sandbox-only client operation
`createInactiveExpertiseProfile`: one change set containing POST followed by PATCH
of its Content-ID `$1`. Existing keyed rows remain immutable. Unknown states and
non-sandbox targets fail closed. The complete request wire format, embedded status
checks and private wire-body transport boundary have regression tests.

Fable 5.2 returned READY for the bounded same-input canary, with no blocking defects.
Report: `outputs/roster-inactive-fable-review-2026-11-10.md` (local ignored artifact).
Its wire-format test recommendation was added before commit. Its diagnostic
recommendations were addressed for this run by private capture of the raw batch
response and separate client confirmation; no credentials were logged. 227 tests
across 19 suites passed; the strengthened 14-test wire/client suite passed afterward.
Lint, types, DAL/OData/GUID gates with sequential self-tests, and documentation gates
passed. These tests do not replace the live evidence below.

The same source, mapping, plan, lineage and creation key were rerun through the CLI.
`atomic-run-context.json`, `atomic-batch-response.json`, `atomic-client-confirmation.json`,
`atomic-receipt.json`, and `atomic-verification.json` were recorded in the temporary
private directory above; that directory later disappeared (see recovery record below).
The batch returned HTTP 200 with two embedded 204 responses; the client confirmed
success directly (not by swallowing a parse failure and recovering through readback).
Independent GET verified profile `db8e8f68-6add-f111-84ea-70a8a5b1c1c6` has
`statecode:1`, `statuscode:2`, and the original creation key. Inactive creation works.

The overall canary exited 2 because `wmkf_role` was persisted as null, although the
reviewed input was the empty string. The exact-value guard stopped binding:
`success:false`, `bridgeCommitted:false`, `rollbackSucceeded:true`, failed row with
`profileOutcome:observed` and the retained GUID. Independent SQL readback shows
three fixture roster rows, zero identities/bindings, sequence 4 / is_called true.
One inactive synthetic profile now remains; it was not patched or deleted afterward.
No Production writes or real-data import occurred.

At this checkpoint, unchanged replay was blocked by the empty/null mismatch.
Justin subsequently approved canonicalizing exact empty optional text to null while
retaining immutable source; the current policy is defined in the input contract above.
Successful bridge allocation/COMMIT/replay and a live forced changeset rollback
remain unverified; this run proves the two-operation commit and subsequent SQL rollback.

Narrow sweep mode A: current README, Atlas and roster session handoff now describe
the successful inactive-create repair and normalization-blocked canary. Dated earlier
canary/test/review records remain historical. Owner
mapping decisions are unchanged. Evidence traces CLI → executor → atomic Dataverse create/deactivate
→ exact-value rejection → SQL rollback → receipt → independent readback; no UI consumer is involved.


## Source-preserving normalization canary — November 10, 2026

[VERIFIED via commit `ab0e0e7e3`, Fable 5.2 review, CLI receipts and independent reads]
Justin approved treating exact empty optional text as null while preserving original
source. Fable returned READY with no named code repairs. Review artifact:
`outputs/roster-null-fable-review-2026-11-10.md` (local ignored copy).
239 tests across 19 suites passed; after adding Fable's missing-metadata and JSON
round-trip coverage, all 75 tests in the four importer suites passed. Relevant lint,
types, DAL/OData/GUID and documentation gates passed.

The prior temporary evidence directory disappeared after interruption. The synthetic
source and mapping were reconstructed from the recorded generation recipe, with both
canonical content hashes required to match the original receipt before any live write:
source `5b430bcb2f96611a5b8b0a97b930984941cc75e432a0f090c1cafb6ef40f1668`,
mapping `0d7b5dd5ca0616c5c5a5eb920d3ebfedafa131d8699a95143de3ba23b0bdbbb6`.
This recovers the original synthetic content, not the lost prior receipt files or any
real roster export. New private evidence lives outside Git at
`/Users/gallivan/.local/share/wmkf-roster/canary-20261110` (directory 0700, files 0600).
It includes credentials: never commit or copy the directory wholesale.

The fresh census plan shows one unchanged profile, zero creates/blocked, the original
creation key and GUID, `textPolicy:empty-string-to-null-v1`, and only `role` in
`normalizedEmptyFields`. Original input values remain empty in the mapping; only the
planned target value is null. Live SQL preflight verified INTEGER identity/binding
columns and computed next ID 5 from floor 0, sequence 4, roster max 3, bridge max 0.

Both the first run and replay exited 0, with `success:true`, `bridgeCommitted:true`,
`status:bound`, `createAttempted:false`, `profileOutcome:observed`, and numeric
`rosterId:5`. Independent reads verified exactly one identity and one sandbox binding
to profile `db8e8f68-6add-f111-84ea-70a8a5b1c1c6`; sequence advanced to 5 on first
commit and stayed 5 on replay. Profile remained inactive (state 1/status 2), role null,
and the entire selected profile including ETag stayed unchanged across replay.
An operator guard refused all non-GET Dataverse requests; zero were attempted.
Recovered source/mapping file SHA-256s were identical before and after both runs.

Evidence files: `input-recovery.json`, `normalization-before.json`,
`normalization-sql-preflight.json`, `normalization-target.json`,
`normalization-reviewed-plan.json`, `normalization-run-context.json`,
`normalization-receipt.json`, `normalization-replay-receipt.json`,
`normalization-verification.json`, and `fable-normalization-review.md`.
The original source/mapping files are kept alongside them, separate from the new plan.

Narrow sweep mode A: README, Atlas, migration-plan optional-text contract and session
handoff reflect the approved policy and successful bounded canary; earlier dated
failure records are historical. Remaining gates are real-source recovery/census,
full-import parity, linked-person/permission/audit cases, forced live atomic rollback,
consumer integration and separately authorized Production release. No real-data import,
Production change, deletion or existing-profile PATCH was performed by this rerun.
