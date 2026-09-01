---
title: Final Writeup Persona Configuration Consolidation Plan
domain: workbench
kind: plan
status: active
summary: "Source-built, rollout-disabled replacement for persona teams using one versioned Final Writeup staffing configuration in the existing Admin editor."
canonical: false
cataloged: 2026-08-31
last_verified: 2026-08-31
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Final Writeup Persona Configuration Consolidation Plan

## Decision and status

**Verdict: SLICES A, B, AND D ARE SOURCE-BUILT; SLICE C IS NOT EXECUTED.
DO NOT ENABLE YET.**

The owner rejected the operational burden of creating and maintaining three
Dataverse owner teams solely as persona markers. This plan replaces that
unshipped storage choice with an extension of the existing, Production-proved
Final Writeup configuration and its existing Admin editor.

The role-specific dashboard behavior and version-2 staffing contract are now
source-built on branch `codex/final-writeup-persona-rollout`. The team resolver,
team-provisioning specification, and provisioning scripts have been removed as
a superseded prototype. The persona feature flag remains false, Production
still stores the proved version-1 Research matrix, no persona team exists in
Production, and the failed create attempt made zero Dataverse writes.

## Contract surface

- **Change surface:** global Final Writeup PD, PC, and Leadership persona
  assignment and the existing program-specific matrix audiences.
- **Entry points:** the existing **Workflows → Final Writeups** Admin editor,
  its existing superuser GET/PUT route, the Final Writeups dashboard service,
  and the focused Final Writeup page.
- **Persistence:** the existing `final_writeup.matrix_audiences` value in
  Dataverse `wmkf_appsystemsettings`; no new table, entity, team, security role,
  environment variable, or settings row.
- **Consumers:** superuser Admin, ordinary Final Writeup dashboard users,
  focused review navigation, PC matrix visibility, later PC backup authority,
  tests, Atlas, API route matrix, service catalog, current queue, and session
  handoff.
- **Prior finding replaced:** pinned no-privilege Dataverse team membership was
  selected as the persona source. The owner has rejected that operational
  dependency before rollout.

## Verified current state

- **[VERIFIED via Production proof recorded 2026-08-31]**
  `final_writeup.matrix_audiences` already stores the Research Grant Program
  audience and has passed signed-in superuser publish, ETag readback, reload,
  and dashboard consumption.
- **[VERIFIED via `matrix-audience-service.js` and focused tests]** the service
  reads strict v1/v2 values, resolves the exact enabled `WMKF Final Writeup
  Reviewer` roster, publishes only complete v2 replacements through
  `setSettingIfUnchanged`, and prunes stale runtime references with warnings.
- **[VERIFIED via `FinalWriteupMatrixAudiencesSection.js` and component tests]**
  one consolidated Admin panel owns the responsibility/program draft,
  unsaved-change guard, stale-reference repair, optimistic revision, and one
  publication action.
- **[VERIFIED via repository census]** the team membership resolver, team
  constants, schema manifest, provisioning/preflight scripts, and isolated
  adapter method have no live source path and are removed. No Final Writeup
  behavior needs team ownership, roles, record assignment, or sharing.
- **[VERIFIED via the 2026-08-31 Production preflight]** request relationships
  are useful evidence but are not a complete global staff directory: John
  Sader is owner-confirmed as a PD despite no matching request relationship;
  Connor Noda and Duncan Spore have isolated PD-shaped historical rows despite
  their confirmed PC responsibility; leadership has no reliable request-field
  source. Names, email, job titles, and program labels therefore remain
  non-authoritative.
- **[VERIFIED via source and prior Production readback]** the feature flag
  remains false and Production ordinary-user behavior is unchanged. The v2
  migration/repair command exists but has not been run against Production.

## Product and administration decision

Use one existing operational surface, not another panel:

1. Rename the current panel from **Final Writeup review matrix** to
   **Final Writeup staffing**.
2. Add a compact **Staff responsibilities** section above the current
   **Program review audiences** section inside that same panel.
3. Show one row per current enabled reviewer-role member with three explicit,
   multi-select responsibilities: **Program Director**, **Program
   Coordinator**, and **Leadership**, plus a mutually exclusive **No persona
   lens** state for people whose role is limited to acknowledgement duties.
4. Keep the existing per-Grant-Program reviewer checkboxes below it.
5. Publish both sections with the existing single sticky publication action and
   one Dataverse ETag. Do not add another navigation item, card, modal, page,
   route, or save button.

Names and initials resolve live from Dataverse. Only stable GUIDs persist.
Assignment remains explicit and multi-valued: Beth Pruitt can be both Program
Director and Leadership. Program responsibility remains global; the separate
Grant Program audiences continue to control who appears in each program's
review matrix.

## Versioned configuration contract

Keep the existing setting key and advance its stored value from version 1 to
version 2:

```json
{
  "version": 2,
  "personas": [
    {
      "reviewerId": "00000000-0000-0000-0000-000000000000",
      "roles": ["program-director", "leadership"]
    }
  ],
  "programs": [
    {
      "grantProgramId": "00000000-0000-0000-0000-000000000000",
      "reviewerIds": ["00000000-0000-0000-0000-000000000000"]
    }
  ]
}
```

Validation is strict and server-owned:

- the top level contains only `version`, `personas`, and `programs`;
- version 2 is the only writable version;
- a persona row contains only one reviewer GUID and a role array; an empty role
  array is the canonical, explicit **No persona lens** state and grants no
  persona visibility;
- allowed roles are exactly `program-director`, `program-coordinator`, and
  `leadership`;
- reviewer rows, role values, programs, and program reviewers are unique;
- every saved reviewer reference must resolve to a current enabled direct
  member of `WMKF Final Writeup Reviewer` at publication time;
- every current reviewer-role member must have exactly one persona row when a
  version-2 configuration is published, but that row may explicitly contain
  zero roles;
- program audiences retain their current nonempty and active-program rules;
- canonical serialization sorts persona rows by reviewer GUID, roles by the
  fixed enum order, programs by Grant Program GUID, and reviewer GUIDs within
  each program;
- the route and service enforce a bounded serialized payload below the
  Dataverse Memo limit; the existing 32 KB route cap must be recalculated for
  the combined maximum rather than copied forward without proof.

The configuration stores no names, titles, emails, permissions, or inferred
organizational facts.

## Backward compatibility and promotion

Production currently contains a valid version-1 Research matrix. Deployment of
version-2-capable code must not disturb it.

1. Readers continue accepting version 1 for matrix resolution exactly as they
   do today. A version-1 value has no persona contract. If the persona flag is
   accidentally enabled while v1 remains stored, the resolver returns no
   persona roles for every ordinary viewer and emits an operational warning;
   it does not throw a dashboard-wide error.
2. Admin GET returns the existing program audiences unchanged, the live
   reviewer roster, `migrationRequired: true`, and a version-2 draft. Persona
   suggestions may be generated from the owner-confirmed GUID manifest for the
   one-time draft, but suggestions never authorize runtime behavior before
   publication.
3. Admin PUT accepts only a complete version-2 replacement and the exact loaded
   ETag. The existing Research audience must survive the normalized v1→v2
   draft byte-for-byte in membership semantics.
4. The first publication is either performed through the existing superuser UI
   or through a dry-run-by-default, ETag-guarded upgrade command using the same
   service. It requires normal Production-write authorization but no new
   Dataverse privilege and no outside administrator. During this migration
   window, any program-audience publication deliberately upgrades the whole
   setting to v2; the explicit **No persona lens** state prevents that rule from
   forcing a false staff assignment.
5. Post-write readback must prove version 2, exact persona assignments, exact
   unchanged Research membership, exact configured programs, and a new ETag.
6. Persona lenses remain source-disabled until that readback and representative
   PC/Leadership Word-access proof are complete.

If the v2 publish never occurs, the Production matrix remains on v1 and persona
lenses remain disabled. Rollback before publication is therefore no-op. After
v2 publication, the first v2-capable Production deployment becomes the
last-known-good rollback floor: no pre-v2 build may be promoted while v2 is
stored because its matrix reader rejects the version.

The upgrade tooling must also provide a dry-run-by-default, ETag-guarded repair
and downgrade mode. It writes a validated v1 projection containing only
`{version: 1, programs}` through the same optimistic setting seam, using an
audited pre-publication or operator-supplied program snapshot. Repair mode must
be able to replace malformed or future-version JSON using the setting row's
ETag without first parsing that invalid value. Crossing below the v2 deployment
floor requires this exact order: disable the persona flag in a v2-capable
deployment, verify disabled behavior, downgrade the setting to the v1
projection, verify v1 readback, and only then promote a pre-v2 deployment.

## Runtime authorization and fail-closed behavior

When the source flag is false, preserve the current dashboard response exactly
and issue no persona-configuration read.

When the source flag is true:

1. Resolve the session-linked `systemuser` GUID server-side.
2. Load and strictly validate the stored version-2 configuration and its
   revision.
3. Resolve the current enabled reviewer-role roster.
4. Require the viewer to remain in that roster; app access alone is not a
   persona grant.
5. Match only the viewer's GUID to the stored persona rows.
6. Return all explicitly assigned roles so overlapping lenses remain a union.

A valid current reviewer added after the last publication appears immediately
in Admin but has no stored persona. That person fails closed to no persona lens
until a superuser publishes an assignment; existing assigned users continue to
work. The Admin response reports the unassigned reviewer explicitly. The next
publication requires a row for every current roster member, including an
explicit empty-role row when **No persona lens** is the correct choice.

A disabled user or a user removed from the reviewer role cannot retain persona
access merely because an old GUID remains stored. At runtime, persona and
program-audience resolution use only the intersection of stored references with
the current enabled reviewer roster and active Grant Programs. Stale references
are omitted, never grant access, and produce an Admin warning rather than a
global dashboard outage. The next publish rejects them until repaired. If
pruning leaves a program with no eligible reviewers, that program's matrix is
empty and explicitly warned rather than failing every coordinator matrix.
Malformed configuration, missing revision, unsupported future version, or
duplicate/unknown values returns a service error rather than falling back to
the rollout-off all-row behavior; the ETag-guarded repair command is the
out-of-band recovery path when Admin cannot parse the stored value.

The existing dashboard semantics remain:

- Program Coordinator: all active rows and the complete neutral matrix;
- Program Director: group-review rows plus the viewer's responsible-PD rows;
- Leadership: leadership-stage rows;
- overlapping assignments: union of all applicable rows;
- unassigned/ineligible viewer: no persona visibility;
- superuser: existing complete operational view independent of persona.

Program audiences affect matrix columns only. They do not infer persona or
grant stage authority.

## New-user lifecycle

This plan removes the second, team-membership onboarding step. It does not
remove the already-live reviewer-role requirement that grants acknowledgement
privileges.

1. The person becomes an enabled, session-linked Dataverse `systemuser` and
   receives the existing Final Writeup reviewer role through the established
   onboarding path.
2. Because Admin loads that exact role roster live, the person automatically
   appears in both **Staff responsibilities** and every program-audience picker.
3. Admin marks one or more responsibilities and independently selects the
   person's program matrix participation, then publishes once.
4. Until publication, the new person receives no persona lens. Existing users
   and existing Research matrix membership remain unchanged.

The separate missing-reviewer-role detector previously requested by the owner
remains necessary because a person who never receives the role cannot appear in
this role-backed directory. That detector should surface as an exception in the
existing Admin Overview, not as another configuration panel.

## Implementation slices

### Slice A — replace the storage contract while disabled — source-built

- Add version-2 validation, canonicalization, v1 read compatibility, and v2
  optimistic publication to the existing matrix-audience service.
- Add persona resolution from the stored configuration and current role roster.
- Change runtime matrix resolution to prune stale reviewer/program references
  with explicit Admin warnings while keeping publication validation strict.
- Preserve the source flag as false.
- Remove runtime team-membership reads and team constants after caller census.
- Keep the existing Admin route path and superuser guard; update its response
  contract and body-size proof rather than adding a route.

### Slice B — consolidate the existing Admin editor — source-built

- Rename the one panel **Final Writeup staffing**.
- Add the compact responsibility grid inside the existing component.
- Preserve current program-audience editing, stale-reference repair,
  unsaved-change protection, load-generation guard, ETag conflict behavior,
  and one atomic Publish action.
- Show counts for assigned, overlapping, unassigned, and stale staff without
  turning the page into a compliance dashboard.
- Require an explicit **No persona lens** choice before serializing an empty
  role array; absence of a stored row remains distinguishable from a deliberate
  no-lens assignment.
- Verify desktop and narrow layouts; responsibility labels remain visible and
  touch targets remain usable without horizontal dependence.

### Slice C — migrate the live setting without enabling personas — not executed

- Dry-run the v1→v2 transformation against Production reads.
- Prove the Research reviewer GUID set is unchanged.
- Record the first v2-capable Production deployment as the rollback floor and
  prove the ETag-guarded v1 projection/repair mode before publication.
- Under explicit write authorization, publish once through the existing
  optimistic setting seam and read back the exact stored value and new ETag.
- Leave the persona feature flag false.

### Slice D — remove the superseded team prototype — source-built

- Delete the team provisioning/preflight scripts, team schema manifest,
  `FINAL_WRITEUP_PERSONA_TEAMS` constants,
  `systemUserAdapter.getByIdWithTeams`, and its adapter-test coverage only
  after a caller search proves they are isolated to the unshipped prototype.
- Replace team-specific unit tests with configuration and roster tests.
- Reconcile source headers, implementation plan, lifecycle plan, Atlas, API
  route matrix, service catalog, work queue, strategy/wiki, memory, and session
  handoff. Historical commits remain untouched.

### Slice E — access proof, enablement, and smoke

- Have a representative PC and representative Leadership user open the exact
  canonical Word item through the signed-in Final Writeup experience.
- Flip the tracked persona source flag only after both proofs succeed.
- Deploy deliberately, then smoke PD, PC, Leadership, overlapping-persona,
  unassigned, and superuser behavior with non-sensitive requests.
- Verify no team read, create, membership, or role-management call occurs.

## Invariants and verification

| Invariant | Likely surfaces | Required proof |
|---|---|---|
| No new Admin layer | `pages/admin.js`, existing Final Writeup component | One Workflows navigation entry, one editor panel, one Publish action |
| Live Research matrix survives migration | configuration service and migration path | Exact reviewer-GUID set before/after plus signed-in matrix read |
| New reviewer-role users appear automatically | Admin GET and component | Add roster fixture absent from stored personas; it renders unassigned and selectable |
| Unassigned users do not broaden access | persona resolver and dashboard | Positive row fixture exists but unassigned viewer receives zero persona rows |
| Removed-role users cannot retain persona | resolver | Stored assignment plus absent current-role membership rejects/fails closed |
| Overlap remains explicit | config validator and dashboard | Beth-shaped PD+Leadership fixture returns union once, without duplication |
| Version 1 remains safe | config service and matrix resolver | Current v1 fixture produces the same program matrices and no personas |
| Flag-on plus version 1 is bounded | persona resolver/dashboard | Empty personas plus operational warning; no dashboard-wide throw |
| Version 2 is atomic | Admin route/service/UI | One ETag-guarded replacement; stale editor receives 409 and draft remains retryable |
| Rollout-off behavior is unchanged | persona resolver/dashboard | No setting/roster read and byte-equivalent response fixtures when flag is false |
| Program audiences do not grant personas | service/dashboard | Program-selected but unassigned viewer remains without persona visibility |
| Stored names/titles are unnecessary | persistence validation | Only GUIDs and exact enum values accepted; live names resolve independently |
| Superseded team machinery is gone | repository census | No live imports/callers or current durable instructions require persona teams |
| Rollback below the v2 floor is safe | upgrade/repair tooling and release runbook | Flag disabled first, ETag-guarded v1 projection read back, then pre-v2 deployment |

## Test and gate plan

Run the relevant gate and its self-test sequentially:

1. focused service tests for v1/v2 parsing, exact-key rejection, canonical
   ordering, explicit empty-role rows, roster coverage, stale-reference
   pruning and warnings, unsupported versions, payload limits, optimistic
   conflict, readback, and repair without parsing invalid stored JSON;
2. persona/dashboard tests for rollout-off no-read, flag-on/v1 empty roles and
   warning, PD/PC/Leadership/overlap, explicit no-lens and unassigned viewers,
   removed-role viewer, superuser bypass, focused-row 404, stale matrix pruning,
   and program-audience/persona independence;
3. route tests for unchanged superuser authorization, exact request body,
   current ETag, v1 GET compatibility, v2 PUT, and bounded body size;
4. Admin component tests for one panel/action, preserved Research draft,
   responsibility toggles, new-user appearance, unassigned/stale warnings,
   load-generation protection, unsaved navigation, 409 recovery, and accessible
   desktop/narrow interaction;
5. scoped ESLint and focused Jest;
6. `check:api-routes` then its self-test because the documented response/write
   contract changes even though no route is added;
7. `check:atlas` then its self-test, service-catalog, docs-catalog,
   doc-currency, build-claim, canonical-pointer, fact-consistency, memory/wiki,
   and agent-invariant gates for the durable reconciliation;
8. production build, using the repository-documented webpack fallback only if
   canonical Turbopack is blocked by the known sandbox process/port signature;
9. signed-in Admin desktop/narrow QA, v2 publication/readback, rollout-off
   matrix regression smoke, representative Word-access proof, then enabled
   persona smoke.

No Postgres migration, Dataverse schema wave, new API route, new environment
variable, or new security privilege is planned.

## Risks and rollback

- **Atomic config coupling:** one publication changes persona and program
  audiences together. Mitigation: canonical full-draft comparison, one ETag,
  exact pre/post Research membership proof, 409 on stale editors, and an
  explicit no-lens state so an audience-only edit never requires a false
  persona assignment.
- **Roster changes after publication:** a new role member lacks a persona.
  Mitigation: viewer-specific fail closed plus Admin Overview exception; do not
  globally break existing mapped viewers.
- **Stored stale reference:** a removed person or inactive program remains in
  JSON. Mitigation: runtime intersects with the live eligible sets, warns Admin,
  and never treats stale data as authorization; strict repair is required at
  the next publication.
- **Unsupported future schema:** older code sees version greater than 2.
  Mitigation: fail closed; never reinterpret unknown fields as version 1; use
  the ETag-guarded out-of-band repair mode when Admin cannot load it.
- **Enablement regression:** disable the tracked source flag and redeploy. The
  v2 `programs` configuration continues powering the existing matrix. Do not
  roll back below the recorded v2 deployment floor unless the flag-off and v1
  downgrade sequence has completed.

## Explicitly out of scope

- Dataverse owner teams, Access teams, Microsoft Entra group teams, or new
  Dataverse security privileges.
- Inferring personas from names, email, job title, program label, or request
  counts.
- Changing the existing Final Writeup reviewer role or its six custom
  privileges.
- Completing the Southern California program audience; it remains a separate
  product configuration after Research persona rollout.
- Board-package workflow, required review counts, approval sequencing, or
  routine Word-edit notifications.
- Enabling PC backup or Leadership queues before persona configuration and
  representative Word access are proved.

## Review questions for Claude

1. Does a single version-2 setting preserve the current v1 matrix contract
   without a false-success or stale-editor path?
2. Does viewer-specific fail-closed behavior prevent a new or removed user from
   broadening access without causing a global outage for mapped users?
3. Is current direct reviewer-role membership enforced at every execution point
   where a stored persona could change rows, matrix visibility, or later stage
   authority?
4. Does the one-panel/one-publication design genuinely consolidate
   administration, or does it hide two unrelated concepts in one unsafe save?
5. Are team-prototype removal, durable reconciliation, payload sizing,
   rollback, and representative Word-access proof fully covered?

## Independent review disposition

Claude completed the requested ordinary read-only architecture review on
2026-08-31 against plan SHA-256
`99f5e60e41914b80c60a246dcb9d0e01f4711108aa8a1cb80a24b2bc2416e216`.
No live probe, file edit, commit, deployment, or Ultrareview occurred. Verdict:
**READY WITH NAMED CHANGES**.

All seven findings are accepted in this revision:

1. record the v2-capable deployment floor and supply an ETag-guarded v1
   downgrade/invalid-value repair path;
2. name that out-of-band repair path for malformed or future values;
3. prune stale runtime references with warnings instead of causing a global
   matrix outage while keeping publication strict;
4. define flag-on/v1 as empty personas plus an operational warning and require
   flag-off before downgrade;
5. represent a deliberate no-lens reviewer without inventing a responsibility;
6. name the adapter method, constants, and tests in the prototype census; and
7. track and catalog this plan before implementation.

The durable review receipt is recorded at
`docs/audits/final-writeup-persona-configuration-claude-review-2026-08-31.md`.

## Independent implementation review

Claude completed the requested authenticated, ordinary read-only implementation
review on 2026-08-31 against clean commit `8ef0b8ba`. It reported no actionable
findings and returned **READY** after checking authorization, v1/v2 behavior,
ETag publication/repair, stale pruning, explicit no-lens semantics,
rollout-disabled no-read behavior, Admin conflict recovery, payload bounds,
server-only suggestion data, and discriminating tests. The successful safe-mode
pass could not invoke its shell tool, so it reviewed the clean HEAD source and
tests rather than independently executing the parent diff; Codex separately
verified the exact commit delta and gates. The receipt is
`docs/audits/final-writeup-persona-implementation-claude-review-2026-08-31.md`.
