# Atlas: Expertise Profile (sandbox preparation)

**Last verified:** 2026-11-09.

`wmkf_expertiseprofile` / `wmkf_expertiseprofiles` is provisioned in sandbox
`orgd9e66399.crm.dynamics.com` for the roster migration. It is not a Production
roster backend. Existing app reads/writes still use Postgres `expertise_roster`.

Schema source: `lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json`.
Owner mapping decisions: `docs/plans/data/expertise-roster/OWNER_MAPPING_DECISIONS_2026-11-09.md`.

Three Active alternate keys cover `wmkf_creationkey`, nullable `wmkf_contactguid`
(text) and nullable `wmkf_staffuser` (User lookup). Native optimistic concurrency
is enabled. Table-level auditing was enabled with a table-scoped metadata update.
Complete actor attribution/audit-event/permissions validation remains a release gate.

The only profile writer so far is the explicitly authorized sandbox synthetic
rehearsal script. Real roster data has not been imported. The related
`expertise_roster_identity` and `expertise_roster_binding` tables exist only in the
local synthetic rehearsal database; no shared-Postgres bridge migration was applied.

Reproducible tools: `scripts/apply-roster-sandbox-schema.cjs`,
`scripts/rehearse-roster-sandbox.cjs`, `scripts/rehearse-roster-bridge.cjs`.
See `docs/plans/data/expertise-roster/SANDBOX_REHEARSAL_2026-11-09.md` for exact
verified scope, retained fixtures and remaining gates.
