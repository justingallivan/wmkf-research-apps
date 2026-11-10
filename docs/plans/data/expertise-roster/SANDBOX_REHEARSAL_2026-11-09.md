# Roster sandbox schema and foundation rehearsal — November 9, 2026

[VERIFIED via sandbox Web API and isolated PostgreSQL execution]
Owner authorized saving mappings, verifying John, sandbox setup and rehearsal.
No Production writes, real roster import, Preview deployment or runtime cutover.

## Saved decisions and verification

`OWNER_MAPPING_DECISIONS_2026-11-09.md` records the accepted staff/category/eligibility
and Amy staging decisions. Private target-specific GUID mappings and live John check
are in `/private/tmp/wmkf-roster-inventory-20261109-final/confirmed-owner-decisions.json`
and `owner-verification.json`. John is uniquely enabled in both environments at the
owner-supplied email, with different GUIDs. Never copy between targets.

Contrary to the owner's initial expectation, a live read found feedback record 1
referencing TBD roster ID 35. After being informed, the owner reiterated removal.
Exclude that profile from the migrated roster while retaining the numeric bridge
identity for historical feedback; do not delete/reassign feedback or break its FK.
No deletion has occurred in Production. Local synthetic rehearsal proved this shape.

## Provisioned sandbox surface

Target: `orgd9e66399.crm.dynamics.com` only.
Entity: `wmkf_expertiseprofile`; entity set: `wmkf_expertiseprofiles`.
Schema wrapper: `scripts/apply-roster-sandbox-schema.cjs` fixes the sandbox target
and passes only app Dataverse credentials to the existing schema engine. It has no
Production mode. Specification is in `lib/dataverse/schema/wave-expertise-roster/`.

All three exact alternate keys became Active after asynchronous index creation:
creation key, Contact GUID text, User lookup. Native optimistic concurrency is on.
Table audit was enabled and read back. Organization auditing was already on.
The User lookup audit flag required a separate table-scoped correction; see
`scripts/configure-roster-sandbox-audit.cjs` and the private audit receipt.
The User lookup audit correction read back true. Audit queries returned records
for all three synthetic profiles (1, 4 and 3 events); this proves audit presence,
not end-user attribution or a post-correction User-lookup change event. Receipt:
`/private/tmp/wmkf-roster-rehearsal-20261109/audit-readback.json`.
Computed label columns and primary GUID are not editable audit fields.

## Executed synthetic checks

| Check | Result |
|---|---|
| Three profiles with null Contact and User links | Accepted; explicit projected null values checked |
| Same creation key submitted twice | Duplicate rejected; existing profile not overwritten |
| Stale ETag update | Rejected with 412 |
| Duplicate Contact text GUID, existing holder inactive | Rejected; second row unchanged |
| Duplicate User lookup, existing holder inactive | Rejected |
| Synthetic link reservations after tests | Cleared and read back; John's sandbox User is not reserved by a fixture |
| Local numeric bindings | Populated for three synthetic profiles inside a transaction; rolled back to empty |
| Old roster writer during local cutover | Blocked by actual table lock, checked with second connection |
| Local feedback FK retarget | Repointed to numeric identity table inside transaction |
| Excluded synthetic placeholder | Profile removed while feedback still references retained numeric identity |
| SQL rollback | Original FK restored; old writer resumes; no durable fixture row changes |

Synthetic profiles retained with creation keys `direct_8c6a2c01-2609-4000-8000-000000000001`
through `...0003`. GUID receipts are in
`/private/tmp/wmkf-roster-rehearsal-20261109/rehearsal-run2.json`.
No real Contact records were created or changed; Contact uniqueness used a synthetic
text reference. The User test referenced John's verified sandbox account without
modifying that account. Test reservations were removed from the synthetic profiles.

The first attempted alternate-key PATCH with `If-None-Match: *` returned 404
`0x80060891` despite Active keys; it created no profiles. We did not use an unrestricted
upsert. The verified creation path instead uses POST with the unique creation key,
then GET by key and exact managed-field comparison; duplicate POST is rejected.
This is the create-only primitive to carry forward. The PATCH discrepancy remains
unexplained, so do not claim it was validated. Receipt: `rehearsal-run1.json`.

## Verification and limitations

Tools: `scripts/rehearse-roster-sandbox.cjs`, `scripts/rehearse-roster-bridge.cjs`.
Eighteen scoped Jest tests passed (planner plus isolation guards). Independent review
led to exact key-set checking, explicit null projections, local preflight before
writes and restoring synthetic links so later imports are not blocked.

This is a schema/identity foundation rehearsal, not the full application migration.
Still required: actual import writer with owner overrides/exclusions/new profiles,
interrupted-create recovery, durable deployment admission/freeze, sequence high-water
setup, editor controls, dependent runtime consumers, end-user audit attribution and
staff permissions, Contact lifecycle cases, matching prompt contract, full app/rollback
rehearsal. The transaction-scoped lock is not a deployed application freeze. SQL test
rollbacks can consume sequence values; that is harmless in this isolated fixture.

The private directories are temporary local evidence, not a durable backup. Keep
credentials and person exports outside Git. The repository stores scripts and
non-sensitive result summaries only.

Atlas, doc-currency, fact-consistency and canonical-pointer gates and their sequential
self-tests passed. `git diff --check` passed.
