# Expertise roster: simplified Production cutover — November 18, 2026

**Status: IN PROGRESS, owner-directed. Remaining-work items 1–3 are built on the branch; nothing is deployed or applied.** Amends
`docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md` §5C/§5D and the
Production parts of `ALLOCATOR_CUTOVER_DESIGN_2026-11-10.md`. Branch inventory:
`BRANCH_INVENTORY_2026-11-18.md`.

## Why

Owner, 2026-11-18: the roster is used about once per cycle (twice a year) by one person
or one flow, and the owner does not require protection against concurrent writers or
races. The prior Production design assumed concurrent writers, lost responses
mid-write and old deployments writing during the switch. At this volume that machinery
costs more than it protects.

## What is superseded (Production only)

- Deployment admission/drain across old deployments (plan §5C).
- Database writer-freeze trigger, prepare/activate/pause/resume phase machine and its
  control table in shared Postgres.
- Pending-intent fencing, the session advisory lifecycle lock
  (`roster-lifecycle.cjs:102`) and allocator high-water synchronization.
- Automated rollback reconciliation (plan §5D after new edits).
- Direct-CRM writer freeze.

That code stays on the branch as dated rehearsal evidence; it is not deleted and is not
wired into Production.

## What is kept

Owner decisions (plan §1); Dataverse schema `wmkf_expertiseprofile` (§3); the numeric
identity and per-target binding tables (`identity-bridge.sql`); deterministic creation
keys; the import tooling; the consumer behaviour table (§3, per-consumer unavailable
handling); the v2 match prompt and recommendations contract; sandbox isolation rules
(never copy sandbox bindings into shared Postgres); no Production write without the
owner's go.

## Design

1. **Read switch.** Environment setting `EXPERTISE_ROSTER_BACKEND`: unset or `postgres`
   keeps today's behaviour; `dataverse` reads profiles from Dataverse. Any other value
   makes roster operations return a clear configuration error. It must not throw in
   shared paths such as sign-in or upload staging. Set per Vercel environment. Unset by
   default, so the branch can merge without changing Production.
2. **Target.** The Dataverse target is the deployment's `DYNAMICS_URL` hostname, the same
   URL `DynamicsService` reads and writes (`read-ops.js`, `write-core.js`). It must be a
   registered Production host: Dataverse mode refuses the sandbox, because sandbox
   bindings never go in the shared Postgres. Sandbox work uses local rehearsal. Bindings are looked up by that host. The local
   rehearsal mode stays as it is.
3. **Cutover marker for legacy writes.** Once `expertise_roster_binding` has a row for
   the Production host (`wmkf.crm.dynamics.com`), the legacy Postgres roster write paths
   refuse with "The roster has moved to Dynamics." Those paths are the API
   POST/PATCH/DELETE in `pages/api/expertise-finder/roster.js`, `seedRoster` in
   `scripts/seed-expertise-roster.js`, and `--apply` in `scripts/link-roster-contacts.js`. Keying on the Production host rather than "any identity
   row" means a stray sandbox row can't freeze Production. It is one query, it covers
   Preview deployments sharing the database, and it needs no setting. The marker turns on
   as soon as the import writes bindings, which freezes legacy edits through the cutover
   window as intended.
4. **Writes after cutover.** Create or update in Dataverse with the existing creation
   key. Then, in one ordinary transaction, `INSERT` an identity row with
   `id = nextval('expertise_roster_id_seq')` plus its binding for the current host, and
   reuse the existing row on a unique conflict. Continuing the old `SERIAL` sequence
   avoids any high-water bookkeeping, and the IDs stay valid if the old table is ever
   restored. Production saves bypass `lifecycle.withRosterWrite` (`withWrite` in
   `roster-service.js`); rehearsal keeps it. Only app-created profiles (`app_` creation
   key) allocate a new ID; an unbound `legacy_`, `direct_` or unkeyed profile is refused
   for reconciliation, so an imported ID's history is never orphaned. The importer's
   `setval` runs on every import in the same transaction (`import-store.cjs:96-123`). [VERIFIED: `expertise_roster.id` is `SERIAL` (`scripts/setup-database.js:2023`);
   the sequence is `public.expertise_roster_id_seq` in the rehearsal database.] No advisory locks, no pending intents. If the bind fails after the
   Dataverse save, return an error; a retry finds the profile by creation key and binds
   it (existing creation-key replay in `saveRoster`).
5. **Prompt.** With the switch on, matching uses `expertise-finder.match.roster-v2` and
   its bundled fallback through `resolveToolPrompt` (`match.js:114-115`). The legacy row is
   untouched. Publishing the live row needs `seed-tool-prompts.js:153` to allow the
   Production target for `roster-v2` (today it accepts only the sandbox).
6. **Migration.** One inert numbered migration creates the two empty bridge tables. It is
   safe to apply at any time (number assigned against the live ledger), with the manifest
   and fresh-install shape updated together.

## Cutover (one operator, quiet window)

Script, dry-run by default, requiring an exact Production target acknowledgement. Local
Production access uses the existing interlock exceptions: `DATAVERSE_ALLOW_PROD_READS=yes`
for reads and `DATAVERSE_PROD_WRITE_ACK="<purpose> <today's UTC date>"` for writes
(`interlock.js:155-175`). The owner sets both.

0. **Before the window:** apply the bridge-table migration to the Production database.
   Provision `wmkf_expertiseprofile` in Production Dataverse (entity, three alternate
   keys, auditing, optimistic concurrency) and the editor role. Assign the role to every
   staff member with Expertise Finder access. Staff saves impersonate the user with no
   fallback (`expertise-profile.js:25,27`; impersonation is on in Production per
   `docs/CREDENTIALS_RUNBOOK.md`), so without the role every save fails. The sandbox
   tools (`apply-roster-sandbox-schema.cjs`, role script) are sandbox-only today and need
   a Production-capable variant.
1. Export the Postgres roster and checksum it into the private evidence directory.
2. Import into Production Dataverse with the existing import executor, extended to accept
   the Production target and the shared database only with that acknowledgement. Today it
   is pinned to the sandbox and loopback Postgres (`import-store.cjs:8,30-31`,
   `execute-expertise-roster-import.cjs:14-21`). Exclude ID 35 as before. Apply the owner
   overrides recorded in `OWNER_MAPPING_DECISIONS_2026-11-09.md`, using Production
   User/Contact GUIDs. The importer already writes identity rows for every roster ID
   (including 35) and Production-host bindings, and advances the old sequence
   (`import-store.cjs:103-123`).
3. In one SQL transaction: retarget `consultant_feedback.consultant_roster_id` to
   `expertise_roster_identity`, after confirming every referenced ID has an identity row.
4. Verify field and reference parity (existing verifier).
5. Publish the v2 prompt row, set `EXPERTISE_ROSTER_BACKEND=dataverse` in Production,
   redeploy, and check the editor, matching, recipients and feedback.

**Rollback:** unset the setting and redeploy. If profiles changed after cutover, re-enter
them in the old roster by hand with the same IDs. Then, if needed, run a small script
that confirms every referenced ID exists in `expertise_roster`, retargets the feedback FK
back, and deletes the Production-host bindings before any identity rows (bindings use
`ON DELETE RESTRICT`). Removing those bindings lifts the cutover marker.

## Review

`/contract-reconcile` plan review, 2026-11-18: **READY WITH NAMED CHANGES**, applied
above: Production-host marker; bypassing the lifecycle lease in Production; prompt seeding
for Production; schema and editor-role provisioning before the window; the import already
writing bindings; the interlock exceptions; rollback delete order; a credentials-runbook
row.

## Accepted risks

- Edits made during the cutover window are not protected. The operator runs it when
  nobody is using the roster.
- Old deployment URLs without the new code can still write the legacy table after
  cutover. With a single operator this is accepted. The cutover marker covers every
  deployment that has the new code.
- Preview with the setting unset reads the frozen Postgres roster, so it shows stale data,
  and Preview writes are refused.

## Remaining work, in order

1. ~~Read switch and target selection for every consumer, plus the cutover marker on
   legacy writers.~~ **[BUILT 2026-11-18]** `lib/services/expertise-finder/roster-mode.js`
   (`rosterMode`, `usesDataverseRoster`, `rosterTarget`) replaces every
   `rehearsal.enabled()`/`assertTarget()` branch point (roster API, matching, batch
   matching, consultant feedback, recipient directory, profile adapter, consumer
   projection, match contract). `roster-cutover-marker.cjs` guards the legacy API
   POST/PATCH/DELETE and both legacy scripts.
2. ~~Simple post-cutover bind path.~~ **[BUILT 2026-11-18]** `roster-binding.js`
   `ensureProfileBinding`; `roster-service.js` uses it through a direct lease in Dataverse
   mode and keeps the lifecycle lease in rehearsal. Tests: `roster-mode`,
   `roster-cutover-marker`, `roster-binding`, `roster-service-dataverse-mode`, plus the
   route marker cases in `expertise-roster-route`; real-SQL bind test
   `tests/integration/roster-binding.pg.test.js` (disposable schema). Full Jest, all gates and the seven pg
   suites pass. Not deployed; the setting is unset everywhere.
3. ~~Inert numbered migration for the two bridge tables.~~ **[BUILT 2026-11-18]**
   `lib/db/migrations/100_expertise_roster_identity_bridge.sql` (DDL identical to the
   reviewed `identity-bridge.sql`), manifest, fresh-install mirror in
   `scripts/setup-database.js` and Atlas entry in `docs/atlas/postgres-infra-tables.md`.
   Applied twice cleanly in a disposable schema. **Number 100 is free:** owner-run read-only
   probe (`scripts/probe-meeting-migration-filenames.cjs`, 2026-11-18) shows the app
   database tracker ends at `099_test_request_narrative_bibliography.sql`; 096 is applied,
   and `097_shared_prompt_jobs.sql` is applied although that file exists only on the parked
   backend branch. Not applied to any shared database.
4. Production-capable cutover script and rollback script (dry-run default).
5. Release items: Admin prompt-catalog entry; rehearsal-flag fail mode in shared paths;
   `seed-tool-prompts.js` Production support for `roster-v2`; Production schema and
   editor-role provisioning tools (cutover step 0).
6. Atlas, route security matrix, service catalog and a `docs/CREDENTIALS_RUNBOOK.md` row for
   `EXPERTISE_ROSTER_BACKEND` at implementation.
7. A sandbox rehearsal of the script end to end on the local rehearsal database, then the
   owner's go for Production.
