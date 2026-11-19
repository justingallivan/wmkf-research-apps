# Expertise roster: simplified Production cutover — November 18, 2026

**Status: PLANNED, owner-directed. Nothing here is built.** Amends
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
2. **Target.** The Dataverse target is the deployment's `DYNAMICS_URL` hostname, and it
   must be in the tracked target registry. Bindings are looked up by that host. The local
   rehearsal mode stays as it is.
3. **Cutover marker for legacy writes.** Once `expertise_roster_identity` has rows, the
   legacy Postgres roster write paths (API POST/PATCH/DELETE, seed and link scripts)
   refuse with "The roster has moved to Dynamics." This is one query, it covers Preview
   deployments sharing the database, and it needs no setting.
4. **Writes after cutover.** Create or update in Dataverse with the existing creation
   key. Then, in one ordinary transaction, `INSERT` an identity row with
   `id = nextval('expertise_roster_id_seq')` plus its binding for the current host, and
   reuse the existing row on a unique conflict. Continuing the old `SERIAL` sequence
   avoids any high-water bookkeeping, and the IDs stay valid if the old table is ever
   restored. [VERIFIED: `expertise_roster.id` is `SERIAL` (`scripts/setup-database.js:2023`);
   the sequence is `public.expertise_roster_id_seq` in the rehearsal database.] No advisory locks, no pending intents. If the bind fails after the
   Dataverse save, return an error; a retry finds the profile by creation key and binds
   it (existing replay logic, `roster-service.js:44-50`, which today runs inside the lease).
5. **Prompt.** With the switch on, matching uses `expertise-finder.match.roster-v2` and
   its bundled fallback. The legacy row is untouched.
6. **Migration.** One inert numbered migration creates the two empty bridge tables. It is
   safe to apply at any time (number assigned against the live ledger), with the manifest
   and fresh-install shape updated together.

## Cutover (one operator, quiet window)

Script, dry-run by default, requiring an exact Production target acknowledgement:

1. Export the Postgres roster and checksum it into the private evidence directory.
2. Import into Production Dataverse with the existing import executor, extended to accept
   the Production target only with that acknowledgement. Exclude ID 35 as before. Apply
   the owner overrides recorded in `OWNER_MAPPING_DECISIONS_2026-11-09.md`, using
   Production User/Contact GUIDs.
3. In one SQL transaction: insert identity rows for every existing roster ID (including
   35), bindings for the Production host, and retarget
   `consultant_feedback.consultant_roster_id` to `expertise_roster_identity`.
4. Verify field and reference parity (existing verifier).
5. Publish the v2 prompt row, set `EXPERTISE_ROSTER_BACKEND=dataverse` in Production,
   redeploy, and check the editor, matching, recipients and feedback.

**Rollback:** unset the setting and redeploy. If profiles changed after cutover, re-enter
them in the old roster by hand with the same IDs. Then, if needed, retarget the feedback
FK back with a small script that first confirms every referenced ID exists in
`expertise_roster` and then clears the identity rows, so the cutover marker lifts.

## Accepted risks

- Edits made during the cutover window are not protected. The operator runs it when
  nobody is using the roster.
- Old deployment URLs without the new code can still write the legacy table after
  cutover. With a single operator this is accepted. The cutover marker covers every
  deployment that has the new code.
- Preview with the setting unset reads the frozen Postgres roster, so it shows stale data,
  and Preview writes are refused.

## Remaining work, in order

1. Read switch and target selection for every consumer (roster API, matching, batch
   matching, consultant feedback, recipient directory), plus the cutover marker on legacy
   writers.
2. Simple post-cutover bind path (design item 4), replacing the lifecycle lock in
   non-rehearsal mode.
3. Inert numbered migration for the two bridge tables.
4. Production-capable cutover script and rollback script (dry-run default).
5. Release items: Admin prompt-catalog entry; rehearsal-flag fail mode in shared paths.
6. Atlas, route security matrix and service catalog at implementation.
7. A sandbox rehearsal of the script end to end on the local rehearsal database, then the
   owner's go for Production.
