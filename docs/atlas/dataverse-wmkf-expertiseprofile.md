# Expertise Profiles and numeric roster bridge

**[VERIFIED via production import, SQL/API readback and signed-in Admin acceptance, 2026-11-19.]**
Dataverse owns roster content; Production `EXPERTISE_ROSTER_BACKEND=dataverse` is
active. Migrations 103/104 are applied. Exact verification imported 39 profiles
from 40 source identities, excluding placeholder 35; all 10 Contact links survived.
Acceptance added one inactive test profile: final snapshot 40 profiles, 41 identities,
40 bindings and 21 active matching candidates. Amy ID 40 is active and lead eligible,
with her existing User, profile and future email preserved; no access grant or send.
See the [execution report](../plans/EXPERTISE_ROSTER_PRODUCTION_EXECUTION_2026-11-19.md). `EXPERTISE_ROSTER_BACKEND` unset,
empty, or `postgres` retains Postgres; `dataverse` selects the production-only
adapter; unknown values fail closed. See the [runbook](../plans/EXPERTISE_ROSTER_CUTOVER_RUNBOOK_2026-11-19.md).

## Dataverse `wmkf_expertiseprofile`

Entity set `wmkf_expertiseprofiles`, organization owned, schema in
`lib/dataverse/schema/wave-expertise-roster/wmkf_expertiseprofile.json`.
All roster text plus category, active state, optional Contact GUID, optional Staff
User lookup, lead-PD eligibility, and immutable creation key. Contact GUID is a
reference string, intentionally not a cascading relationship. It survives category
changes and deactivation. Contact/User alternate keys reserve links across inactive
and active rows; creation key makes create retries recoverable. No hard delete.
Auditing at organization, entity and editable-column levels and all three Active
keys passed the live import preflight. Editor/application effective rights were verified;
Connor retains broader existing rights.

Writes: `/api/admin/expertise-roster` (`requireSuperuser`, trusted DAL context,
authenticated mapped User, impersonation required, no fallback) → `roster-service`
→ adapter. POST requires a stable mutation UUID; PATCH carries the loaded ETag.
Admin UI: People & Access → Expertise Roster. Contact and User lookups use that
same Admin guard, independent of Expertise Finder grants. Import is an explicit
operator process, not a web endpoint. Connor has the Reader role but his broader existing roles also permit writes; his
connection/read-only acceptance remains open. Direct CRM
creation is not supported because numeric consumers require a binding.

Reads: Admin list; consultant eligibility,
feedback author/attachment/briefing hydration; Site Visit/meeting and proposal-list
recipient directory. `roster-consumer-service` projects numeric IDs, includes
inactive authors for history, rejects incomplete/unbound records and propagates
outages. Excluded placeholder ID 35 has no profile: historical author displays
“Unavailable consultant”. Standalone matching is retired in production; see the [retirement report](../plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md) for release status. Lead eligibility is stored for later backend automation.

## Postgres `expertise_roster_identity`, `expertise_roster_binding`

Migration 103 and fresh-install definitions create **empty** tables. Identity is a
positive integer primary key; binding maps `(roster_id, target_host)` to a unique
`(target_host, dataverse_profile_guid)` with a foreign key to identity. No roster
content, synchronization, cleanup worker or expiry. Keep identities indefinitely
while feedback or saved recipient provenance can refer to them.

Importer inserts every exported identity, even exclusions, advances the legacy
`expertise_roster_id_seq` beyond imported IDs, and records verified bindings per
row. New Admin creations reserve a binding using the mutation UUID as the proposed
Dataverse primary ID before creating the profile. They use that same sequence. A
binding failure cannot publish an unbound person; a failed create leaves only an
unused identity. Same creation key repairs uncertain saves on retry. Unbound imported/direct CRM profiles
cannot allocate an arbitrary replacement ID. The first production binding blocks
legacy route/seed/contact-link mutations. Existing Postgres reads continue during
import; Admin is unavailable until the switch.

`consultant_feedback` remains Postgres. Migration 104, applied after exact import
verification, retargeted its FK to `expertise_roster_identity(id)`; all seven original
feedback rows remain unchanged. The private synthetic acceptance entry was removed
after retirement; its test profile remains inactive. All 344 obsolete matching-history
rows were deleted with owner authorization; the empty `expertise_matches` table and
old roster content remain. Backend automation remains separate. Production cleanup
evidence is recorded in the retirement report.
