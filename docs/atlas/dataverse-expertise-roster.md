# Atlas: Expertise Profile (sandbox preparation)

**Last verified:** 2026-11-10 (import/replay, permissions, service writes/native audit and inactive-editor canary).

`wmkf_expertiseprofile` / `wmkf_expertiseprofiles` is provisioned in sandbox
`orgd9e66399.crm.dynamics.com` for the roster migration. It is not a Production
roster backend. Normal-mode app reads/writes still use Postgres `expertise_roster`.
The branch rehearsal path uses Dataverse values and the target-scoped local numeric
bridge. Its live read proof and limits are in
`docs/plans/data/expertise-roster/CONSUMER_TRANSPORT_2026-11-10.md`.

Schema source: `lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json`.
Owner mapping decisions: `docs/plans/data/expertise-roster/OWNER_MAPPING_DECISIONS_2026-11-09.md`.

Three Active alternate keys cover `wmkf_creationkey`, nullable `wmkf_contactguid`
(text) and nullable `wmkf_staffuser` (User lookup). Native optimistic concurrency
is enabled. Table-level auditing was enabled with a table-scoped metadata update.
The owner-approved sandbox role is assigned to John, Beth and Jean with exactly
Create, Read, Write, Append and Append To on this table. Nine platform-added default
privileges were removed from this new role; exact role privileges and assignments
were read back. No Delete, Assign or Share grant was added. Existing roles and
Production were unchanged. Actual impersonated service writes and native audit now
verify John/Beth/Jean attribution; independent signed-in browser access remains open. See
`docs/plans/data/expertise-roster/SANDBOX_PERMISSIONS_2026-11-10.md`.

The November 10 canary first exposed inactive-create and empty/null issues.
Fable-reviewed repair `83cf6c93c` created an inactive synthetic profile atomically.
Owner-approved normalization policy `empty-string-to-null-v1` in `ab0e0e7e3` preserves
raw source hashes and maps exact empty optional text to null in planned values only.
After Fable review, a new plan bound that retained profile to local numeric ID 5;
COMMIT and replay passed, with one identity/binding and sequence stable at 5.
Profile `db8e8f68-6add-f111-84ea-70a8a5b1c1c6` remains inactive, role null; no
Dataverse writes occurred in the normalization run/replay. Old plans fail closed,
and existing profiles must match canonical planned values exactly.
Private evidence is now in `/Users/gallivan/.local/share/wmkf-roster/canary-20261110`;
temporary inputs were recovered against original content hashes (see README).
At the full-import checkpoint, a separately authorized fresh November 10 export had 39 imported profiles in
sandbox (37 active, two inactive), plus the four retained synthetic profiles.
The separate full-import local fixture has 40 identities, 39 bindings, seven original
feedback references with synthetic bodies, and sequence 40. ID 35 is identity-only;
Amy has local ID 40. Four staff User links and five Contact links are verified; five
other source Contact links are explicitly null in sandbox with owner approval.
All managed fields, source rows and references passed parity; replay preserved GUIDs,
ETags and SQL state with zero Dataverse write attempts. Private evidence is at
`/Users/gallivan/.local/share/wmkf-roster/full-import-20261110`.
See `docs/plans/data/expertise-roster/FULL_IMPORT_REHEARSAL_2026-11-10.md`.
The canary container/volume is stopped and preserved; the full-import container now
owns local port 55439. Bridge tables exist only in dedicated local fixtures;
no shared-Postgres bridge migration or runtime consumer cutover was applied.

Reproducible tools: `scripts/apply-roster-sandbox-schema.cjs`,
`scripts/rehearse-roster-sandbox.cjs`, `scripts/rehearse-roster-bridge.cjs`,
`scripts/prepare-roster-full-import-rehearsal.cjs`, `scripts/verify-roster-full-import.cjs`.
See `docs/plans/data/expertise-roster/SANDBOX_REHEARSAL_2026-11-09.md` for exact
verified scope, retained fixtures and remaining gates.

## Later consumer write checkpoint

[VERIFIED via service probes] Feedback create/replay/edit/one-off/shared reads,
native staff audit, isolated live v2 prompt/fallback bytes and formatter parity pass.
Two additional inactive synthetic editor profiles are retained and unbound; the final
complete adapter census at that checkpoint verified 45 sandbox profiles. Two new local feedback records
bring that fixture to nine, with the original seven unchanged. Fable cleared the
inactive editor repair; the live atomic canary confirmed two 204 operations,
unchanged replay GUID/ETag and conflicting payload 409. Evidence and remaining
browser/auth/attachment/matching/cutover gates:
`docs/plans/data/expertise-roster/CONSUMER_WRITE_REHEARSAL_2026-11-10.md`.


## Later engineering checks

History now shares the guarded rehearsal SQL transport with matching. Controlled
single/batch/history tests passed against rollback-only temporary SQL tables;
these do not provision the fixture's full application schema. The real populated
fixture's bounded writer lock/release check preserved counts, sequence and FKs.
Editor exact-empty optional text is now normalized in a copied DTO; a Fable-cleared
blank-form inactive create/replay canary retained one more unbound synthetic profile
(`b34e680b-849c-4207-a2c5-689defd79aa7`), with null readback and original input preserved.
Expected total is 46 after that allocation; the last full census was 45 before it.
[VERIFIED via branch source and `tests/integration/roster-lifecycle.pg.test.js`] The rehearsal runtime now records mutation intents and allocates numeric bindings transactionally while holding a lifecycle write lease. Ten real PostgreSQL tests passed in a disposable schema, including concurrent allocation, uncertain commit recovery, lost-session intent retention and legacy freeze; the fixture verified its public fingerprint unchanged. The `expertise_roster_cutover` control table exists only in that disposable test schema, with no public migration applied. The operational phase module and CLI are source-built, and eight additional PostgreSQL tests passed in a disposable schema with the public fingerprint unchanged. Rollback is not built. Build review is incomplete: both Fable runtime and phase reviews exited with “out of usage credits”; neither completed. Checkpoint `a876c0efd` preserves the passing source. The combined focused suite (97 tests) and production build passed. This does not establish a Production cutover.
See `docs/plans/data/expertise-roster/ENGINEERING_CHECKS_2026-11-10.md`.
