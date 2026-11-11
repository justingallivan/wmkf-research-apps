# Expertise roster sandbox permissions checkpoint — November 10, 2026

## Scope and authorization

Justin approved one standard sandbox-only roster editor role for John, Beth and
Jean, with Create, Read, Write, Append and Append To on Expertise Profile, without
Delete, Assign or Share. He explicitly cautioned against unnecessary infrastructure.
The existing `scripts/apply-security-role.js` and declarative role specification
`lib/dataverse/schema/roles/expertise-roster-sandbox.json` were used. No new
permission framework, deployment, Production change or existing-role edit occurred.

## Verified evidence

[VERIFIED via private execution log and read-only Dataverse probes] The role
`WMKF Expertise Roster Editor - Sandbox` was created and assigned to the three
approved staff in `orgd9e66399.crm.dynamics.com`. Initial effective privilege reads
showed no roster grants for these staff; post-assignment reads showed the five
approved grants and no Delete. Justin's pre-existing access was unchanged.

A complete role readback exposed nine platform-added default privileges, including
SharePoint data privileges. These were removed from this newly created role with
the standard `RemovePrivilegeRole` action. A subsequent `RetrieveRolePrivilegesRole`
read verified exactly the five approved privileges, all at Global depth, and direct
association reads confirmed all three assignments. This is a roster permission
checkpoint, not proof of signed-in application access or successful staff writes.

Private evidence is retained under
`/Users/gallivan/.local/share/wmkf-roster/full-import-20261110`:

- `role-execution.log`: creation, five requested grants and three assignments.
- `access-audit-privileges.json` and `access-audit-after-role.json`: effective roster
  privilege comparison and import service-principal audit evidence.
- `role-privilege-readback.json`: initial platform defaults.
- `role-default-removal.jsonl` and `role-after-default-removal.json`: removal results.
- `role-exact-verification.json`: final exact privilege set and assignments.

These files are private (0600); the directory also contains credentials and must
never be copied into Git. `scripts/probe-roster-access-audit.cjs` reproduces the
bounded effective-privilege/import-audit read, not the complete role-set comparison.
Reapplying the declarative role is additive; always read the complete role privilege
set afterward rather than inferring it from the requested five grants.

## Remaining verification

Signed-in staff editing, native end-user audit attribution, linked-person lifecycle,
and full dependent-consumer testing remain open. The import audit probe confirms an
existing service-principal event only; it does not establish an end-user write.

The later owner-approved minimal rehearsal transport and live consumer read proof
are recorded in `CONSUMER_TRANSPORT_2026-11-10.md`. They do not close the signed-in
staff-write or full-application gates above.

## Bounded reconciliation

Sweep mode A: sandbox permission provisioning changed from pending to verified;
end-user editing/audit remains pending. The Atlas now records this distinction.
The migration plan's permission/actor-verification requirements and older dated
rehearsal reports remain applicable and are not completion claims. Source → role
specification → existing CLI → Dataverse role/associations → readback is verified;
UI and staff write hops are explicitly unverified. The exact-set readback falsified
the initial assumption that a new role would contain only requested privileges;
the final readback passed after removing the defaults.
