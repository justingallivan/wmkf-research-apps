# Atlas: Expertise Profile (sandbox preparation)

**Last verified:** 2026-11-10 (sandbox importer canary and readback).

`wmkf_expertiseprofile` / `wmkf_expertiseprofiles` is provisioned in sandbox
`orgd9e66399.crm.dynamics.com` for the roster migration. It is not a Production
roster backend. Existing app reads/writes still use Postgres `expertise_roster`.

Schema source: `lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json`.
Owner mapping decisions: `docs/plans/data/expertise-roster/OWNER_MAPPING_DECISIONS_2026-11-09.md`.

Three Active alternate keys cover `wmkf_creationkey`, nullable `wmkf_contactguid`
(text) and nullable `wmkf_staffuser` (User lookup). Native optimistic concurrency
is enabled. Table-level auditing was enabled with a table-scoped metadata update.
Complete actor attribution/audit-event/permissions validation remains a release gate.

The authorized November 10 canary first failed on direct inactive creation. Repair
`83cf6c93c` was Fable-reviewed and rerun with identical inputs: an atomic POST/PATCH
Content-ID changeset returned two 204 responses and created one inactive synthetic
profile (`statecode:1`, `statuscode:2`). Exact comparison then rejected the role field:
Dataverse normalized empty string to null. The inactive profile remains, SQL rolled
back, and final readback shows zero bridge identities/bindings and unchanged sequence 4.
Successful binding/COMMIT/replay remains unverified. Justin approved empty optional
text as null with original source preserved. The planner implements versioned policy
`empty-string-to-null-v1`; Fable review and a new-plan rerun are pending. Old plans
are refused, and target comparison stays exact against canonical planned values.
Real roster data has not been imported. See the live canary record in
`docs/plans/data/expertise-roster/README.md` for receipts and the next blocker. The related
`expertise_roster_identity` and `expertise_roster_binding` tables exist only in the
local synthetic rehearsal database; no shared-Postgres bridge migration was applied.

Reproducible tools: `scripts/apply-roster-sandbox-schema.cjs`,
`scripts/rehearse-roster-sandbox.cjs`, `scripts/rehearse-roster-bridge.cjs`.
See `docs/plans/data/expertise-roster/SANDBOX_REHEARSAL_2026-11-09.md` for exact
verified scope, retained fixtures and remaining gates.
