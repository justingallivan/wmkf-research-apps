# Expertise roster — production cutover and recovery

Status: **production schema/roles, migration 103 and Postgres-mode deployment complete; import/cutover pending Amy status clarification**. See [execution checkpoint](EXPERTISE_ROSTER_PRODUCTION_EXECUTION_2026-11-19.md). This runbook
implements the [accepted plan](EXPERTISE_ROSTER_PRODUCTION_MIGRATION_PLAN_2026-11-19.md).
One operator, static dataset. No sandbox, locks, synchronization or automated rollback.

## 1. Prepare and inventory

Record the current deployment and a tested Postgres-mode recovery deployment of
this new code. Inventory Admin maintainers and their mapped enabled Dataverse Users;
do not silently grant superuser. Save the current Postgres migration ledger and
pending filenames. 103 creates only the empty bridge; 097/100 belong to other work.

Use explicitly supplied authorized production configuration. Tools here never load
env files or enable interlock flags. Do not read root `.env.local`. The shared
migration runner DOES load cwd `.env`/`.env.local`: invoke its absolute path from
an empty env-file-free directory, after inspecting **all** pending migrations.
All private JSON exports/mappings/receipts must stay outside the repo, mode 0600.
Application credentials used by these operator data tools are separate from agent
CLI authentication (agent sessions remain OAuth-only).

CLI process configuration: `POSTGRES_URL`, the existing `DYNAMICS_*` application
credentials, exact production `DYNAMICS_URL`, `DATAVERSE_TARGET_INTERLOCK=on`,
owner-supplied `DATAVERSE_ALLOW_PROD_READS=yes`; writes additionally require today's
`DATAVERSE_PROD_WRITE_ACK="<purpose> YYYY-MM-DD"`. Import uses
`EXPERTISE_ROSTER_BACKEND=dataverse` **in its own process only**,
`DYNAMICS_IMPERSONATION_ENABLED=true` and `EXPERTISE_ROSTER_ACTOR_ID` (mapped operator
User). Do not change the application's Postgres setting yet.

Examples below use `/private/roster` as an illustrative owner-managed directory;
choose the real private location. Run with Node 24 and the repository root as cwd,
except the migration runner as described above:

```bash
node --import ./scripts/lib/use-extensionless.mjs scripts/expertise-roster-migration.mjs export --out=/private/roster/source.json
```

Export includes every source field/audit value, feedback IDs, dataset UUID and
sequence state. Timestamp-without-zone values remain literal strings, independent
of the operator timezone. Retain the original source and UUID for all retries/reimports.
Create a separate mapping JSON: `{version:1,datasetId,targetHost,rows,newProfiles}`.
Every `rows` entry has `legacyId`, `contactGuid` (EXACT exported value/null),
`staffUserGuid` (verified production User or null), `active`, `leadPdEligible`,
`confirmed:true`; optional `roleType`, `exclude`, and `retainUnavailableContact`. Never rematch Contacts.
An inactive/missing Contact produces a per-row blocked plan entry until the owner
explicitly sets `retainUnavailableContact:true`; its exact GUID stays unchanged.
Verification after import reports current Contact-health warnings without requiring
reactivation. Transport/permission errors always stop preflight.
`newProfiles` entries have a stable UUID `mutationId`, a `row` containing all source
content fields except `id`, and a `decision` with the five link/eligibility fields
and `confirmed:true`. Optional text fields must be present (null permitted).

Owner mappings: Justin/Jean active lead; Beth active nonlead; John E. Sader ID 1
Staff/active/lead; Kevin ID 13 inactive; Amy Rowat new inactive Staff with null User
and no lead eligibility. ID 35 excluded, inactive and unlinked, but retains its
numeric identity. Any linked exclusion, duplicate Contact across inactive/active
rows or Contact mapping mismatch blocks import before writes. Confirm User GUIDs,
Contact health and duplicate-name warnings manually, without guessing identities.

Inventory references to IDs 1, 13, 35 in consultant feedback (including shared
entries), Site Visit identity maps, meeting attendee maps and proposal-list
provenance. Record changed eligibility, and repair affected editable selections in
the normal UI before acceptance. No silent reassignment of a Consultant→Staff entry.

## 2. Provision and deploy with Postgres selected

```bash
node scripts/provision-expertise-roster.cjs --apply
```

Creates/verifies the schema and two dedicated roles, enables table/column audit,
and publishes this table only. No automatic role assignments. Verify organization
auditing; wait until all alternate keys are Active. Confirm multiple null key
values are permitted, the primary ID can be caller-supplied on POST (including
inactive-create changesets), and the actual Staff User navigation name is
`wmkf_StaffUser` with impersonated atomic reference-clear support. Existing metadata is not
silently redefined: the import preflight rejects type/length/key/audit mismatches.
Assign Editor to intended maintainers and the application identity as needed;
verify impersonation privilege intersection, Contact reads and Staff User lookup
permissions. Reader is for Connor's connection. Inspect **effective** permissions
including other roles/teams: adding Reader does not revoke broader existing rights.
Do not claim read-only until his actual connection proves it.

Apply migration 103 with the canonical runner from the env-free cwd. Deploy the
new code with backend unset/`postgres`. Verify legacy reads, admin-only mutations,
and the Admin “available after migration” state. Do not introduce the FK migration yet.

## 3. Plan, import, compare

```bash
node --import ./scripts/lib/use-extensionless.mjs scripts/expertise-roster-migration.mjs plan --source=/private/roster/source.json --mapping=/private/roster/mapping.json --out=/private/roster/plan.json
node --import ./scripts/lib/use-extensionless.mjs scripts/expertise-roster-migration.mjs import --apply --source=/private/roster/source.json --mapping=/private/roster/mapping.json --out=/private/roster/import-1.json
node --import ./scripts/lib/use-extensionless.mjs scripts/expertise-roster-migration.mjs verify --source=/private/roster/source.json --mapping=/private/roster/mapping.json --out=/private/roster/verify-1.json
```

Review every warning/error before apply. Import reports per-ID/key outcomes and
saves its private receipt after each row. First binding freezes legacy edits; reads
remain available. Any failure keeps the app on Postgres. Resolve it, then rerun with
the **same dataset and mutation keys** and a new receipt path. Exact existing rows
are reused; differing rows block, never overwritten. Inactive creation is atomic.
A crash can leave a keyed profile without a binding; the retry verifies and binds it.

Require `verified:true` and zero blocked rows; independently check expected names,
text, categories/states, Contact/User links, IDs, feedback references and owner
exceptions. Compare source to export (the tool also does this). A count alone is
insufficient. Complete the saved-recipient checks from step 1.

## 4. Switch and accept

Only now copy `scripts/sql/expertise-roster-feedback-cutover.sql.template` to a
**free new numbered migration** under `lib/db/migrations/`, regenerate the manifest,
and change the fresh-install feedback FK to `expertise_roster_identity(id)` (ensure
identity is created first). Commit that cutover change separately. Apply through
`apply-migrations.js`; SQL validation refuses any missing identity. Set the production
application's `EXPERTISE_ROSTER_BACKEND=dataverse`, then redeploy once.

Check Admin list/search/filter/include-inactive; add a clearly named test consultant,
edit, reload, deactivate/reactivate; retain/deactivate the test profile afterward.
Where a suitable unused enabled User is available, verify Staff User link/clear
and its atomic category/eligibility save; never borrow another roster member's
reserved identity. A failed save offers Reload saved version before retry.
Verify the numeric binding and new consultant feedback selection/save. Existing
inactive authors retain names; ID 35 displays “Unavailable consultant” in staff and
shared briefing. Verify linked Contact current-email rules and saved recipient
resolution; verify non-admin refusal and an admin without Expertise Finder access.
Confirm old roster tab links to Admin for admins, while matching/history still work.
Use mocked model-transport tests for matching; no paid matching or email send needed.
Connor verifies the real production table/fields and effective read-only access.
Record deployment, ledger, receipts and acceptance results in private evidence.

## Recovery, including partial import

1. Keep the current mode while reconciling. Compare the final owner-mapped roster
   **plus every post-cutover edit/addition** to legacy Postgres. Manually preserve
   IDs, Contact references, John's Staff category, Kevin/35 inactive, Amy inactive,
   and new numeric IDs. Preserve User/lead values in a private export (legacy PG has
   no columns for those). If Dataverse is unavailable, use import/acceptance records;
   resolve unknown edits before reopening writes.
2. Check `expertise_roster_id_seq` is beyond every restored ID; advance with
   `setval` if needed, never lower it. Verify all feedback and recipient references.
3. Verify the actual FK constraint name is `consultant_feedback_consultant_roster_id_fkey`
   before applying either SQL template. If switched, introduce a new numbered recovery migration from
   `scripts/sql/expertise-roster-feedback-rollback.sql.template`, align fresh-install
   FK, regenerate manifest, apply through the same runner. Its validated FK must pass.
4. Switch to the tested **new code in Postgres mode**; do not redeploy an old build
   lacking the marker. Verify reads. Only then clear bindings for
   `target_host='wmkf.crm.dynamics.com'` to reopen legacy edits (explicit operator SQL,
   after saving the bindings privately). Keep identity rows and Dataverse profiles.
5. Reimport reuses original dataset/mutation keys. Retained profiles with differing
   values require explicit reconciliation; never create another dataset blindly.

No table drops, app retirement, automation changes, or broad database migration.
