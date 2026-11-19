# Expertise roster migration handoff — November 9, 2026

## Resume boundary

Owner requested stop and a docs-only handoff on main. Runtime work remains on
`codex/expertise-roster-foundation-2026-11-09`, pushed at **`1aedcb25d`**.
Worktree: `/private/tmp/wmkf-codex-isolated-start-2026-11-09`.
Do not merge the feature branch to carry documentation or promote this checkpoint.
The last verified foundation is **`d2b467e84`**; the later checkpoint is unverified WIP.

## Verified foundation

- Saved migration plan and four Claude Fable OAuth reviews. Final plan verdict READY
  was plan-text only; it did not certify implementation or Production release.
- Real read-only inventory: 39 roster rows (26 Consultant, 9 Board, 4 Research Program
  Staff), 10 healthy Contact links and 7 feedback references. No duplicate names/links
  or text-size overflow in the export. No real roster import or Production writes.
- Sandbox `orgd9e66399.crm.dynamics.com` now has `wmkf_expertiseprofile` /
  `wmkf_expertiseprofiles`, three Active alternate keys, optimistic concurrency and
  table auditing. Staff User lookup audit was separately enabled. Synthetic audit
  records were observed; end-user attribution/permission tests remain open.
- Three synthetic Dataverse profiles are retained; temporary Contact/User reservations
  were cleared, so John's sandbox account is not reserved by a fixture.
- Dedicated local PostgreSQL 17.11 fixture passed null/duplicate/key/ETag checks,
  bridge population/rollback, old-writer lock, feedback FK retarget and rollback.
  This is not a full application migration or durable deployment freeze.
- Deliberation slots inherit attendee references from their parent session. The earlier
  missing-slot-field claim was an inventory interpretation error; no column is needed.
- 18 focused tests and relevant gates passed at the verified foundation. Those results
  do NOT cover the later WIP service/editor checkpoint.

## Settled owner decisions

One profile/person and one category; no program partition, Short ID, Match Type or
roster dates. Preserve existing structured expertise fields; content/scoring deferred.
Contact links are optional; never create Contacts for privacy-sensitive Board profiles.

- Justin and Jean: confirmed User links, active, lead eligible.
- Beth: confirmed User link, active, lead eligibility off for now.
- John Sader (`jsader@wmkeck.org`): existing John E. Sader roster ID 1, change Consultant
  to Research Program Staff, active and lead eligible. Enabled User verified in both
  environments; GUIDs differ and must remain target-specific.
- Kevin: inactive, not lead eligible.
- Amy Rowat: starts December 2026; stage inactive, no User link or lead eligibility.
  No account/profile has been created for her by this work.
- TBD specialist, ID 35: owner requested exclusion. Contrary to their initial
  expectation, live feedback record 1 references it. Preserve the numeric identity
  for that feedback while excluding the profile from the migrated roster; no live
  feedback was deleted or reassigned. No Production deletion occurred.
- Easy deactivate/reactivate, include-inactive view, and preserved historical
  references are required. Other retirements can be decided through the editor.

## Intentional unfinished checkpoint — `1aedcb25d`

Owned by this Codex roster stream. Files are committed/pushed solely for continuity:

- New `lib/dataverse/adapters/expertise-profile.js` and entity registry entry.
- `lib/services/expertise-finder/roster-contract.cjs`,
  `roster-rehearsal-target.cjs`, `roster-service.js`.
- Rehearsal dispatch in roster API; matching endpoint refusal during rehearsal.
- Editor draft: inactive filtering/reactivation, staff picker, lead eligibility,
  ETag submission, request generation guard and create mutation identity.

Only parser checks on three edited JS files and `git diff --check` were run on this
checkpoint. No feature tests, browser test, type/build/DAL/route gate run or independent
review of this new slice. The earlier 18 tests are not evidence for these changes.
Do not deploy or turn on `EXPERTISE_ROSTER_REHEARSAL` from this handoff alone.

The draft switch defaults off and is designed to require the registered sandbox,
loopback Postgres on port 55439, matching aliases and enforcement flags. It has no
Production cutover mode. Staff writes also require impersonation and authenticated
User identity. These guards still need tests. Administration currently uses GUID IDs;
legacy numeric consumer hydration and creation allocation are NOT integrated.
The real import executor has NOT been implemented: existing import tooling only plans
and rehearses synthetic writes. Owner overrides/exclusions/Amy staging still need a
reviewed execution path with deterministic retry keys and numeric identity recovery.

## Verified open work

1. Review/test the checkpoint before extending it. Trace category/link transitions,
   inactive eligibility, stale edits, create retry/body changes, post-save hydration,
   missing/invalid rows, UI request races and actor attribution. Check existing roster
   Contact tests and both backend paths. Do not assume parsing establishes correctness.
2. Implement real import execution from immutable source plus confirmed overrides;
   include exclusion tombstones, new-person creation, interrupted-write recovery and
   per-target binding conflict refusal. No real export copy into sandbox was performed.
3. Complete runtime consumers: feedback, Site Visit/meeting directory and saved
   references. Preserve historical unavailable-identity behavior and never guess names.
4. Review the minimal matching prompt/GUID contract with owner before enabling new
   matching. Workload, expertise wording and scoring remain out of scope.
5. Full isolated app rehearsal, staff permissions/attribution, Contact lifecycle,
   deployment admission/drain, sequence high-water, actual import parity and complete
   rollback remain release prerequisites. No Production release authorized.

## Local-only evidence and credentials

These do not travel with Git. Do not commit or upload them automatically:

- `/private/tmp/wmkf-roster-inventory-20261109-final`: private source, metadata,
  reference inventory, confirmed owner decisions and GUID receipts (0700/0600).
- `/private/tmp/wmkf-roster-rehearsal-20261109`: private connection files and rehearsal
  receipts. Container/volume `wmkf-roster-rehearsal17-20261109`, loopback 55439,
  database/user `roster_rehearsal`. Colima required. Initial PostgreSQL 16 container
  `wmkf-roster-rehearsal-20261109` remains stopped with its synthetic volume retained.
- Three sandbox synthetic profile keys use `direct_8c6a2c01-2609-4000-8000-000000000001`
  through `...0003`. No deletion authorized by stop.
- Preserve fallback clone `/tmp/wmkf-codex-session-2026-11-09` and all other worktrees.

On another Mac, inspect availability first. Re-export only under the saved read scope
and preserve the existing source-lineage UUID; do not generate a new UUID for a delta.
If private evidence is unavailable, report the gap rather than guessing mappings or
copying Production GUIDs into sandbox. Private temporary files need an owner-approved
secure transfer/retention decision before this machine is cleaned up.

## Feature-branch documents and commits

Documents below are on the feature branch, not necessarily main:
`docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md`,
`docs/plans/data/expertise-roster/OWNER_MAPPING_DECISIONS_2026-11-09.md`,
`docs/plans/data/expertise-roster/SANDBOX_REHEARSAL_2026-11-09.md`, and
`docs/atlas/dataverse-expertise-roster.md`.

- `be5790336`: initial plan and session pointer.
- `acc1f7507`, `c0530f345`, `6c7e1a9c8`: Fable review findings and plan repairs.
- `7512c0fd6`: offline foundation and final plan review.
- `e4e39b494`: inventory and isolated rehearsal preparation.
- `ad7c4a511`: corrected slot attendee ownership finding.
- `d2b467e84`: sandbox schema and verified foundation rehearsal.
- `1aedcb25d`: intentionally unverified service/editor WIP checkpoint.

Milestone determination: no DEVELOPMENT_LOG entry required. This is preparation,
sandbox provisioning and unfinished branch code, not a shipped Production capability.
CLAUDE.md unchanged. Claim-evidence report was unavailable; no observation row invented.
