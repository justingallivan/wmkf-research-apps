# Slice B roster rollback reconciliation

Accepted implementation contract for the Slice B section of
[the allocator design](ALLOCATOR_CUTOVER_DESIGN_2026-11-10.md). The executable
scope remains a disposable `roster_rehearsal_<32 lowercase hex>` schema on the
existing guarded local database. Dataverse is a read-only input. Release routing,
older application admission, direct CRM writer control and public/Production
activation remain separate work. Revision 2 incorporates both blockers and the
contract points from the [first Opus 5.5 review](ROLLBACK_PLAN_OPUS_5_5_REVIEW_1_2026-11-11.md).
The implementation lead verified the named corrections against source and accepted
revision 2 for implementation. The initial NOT READY review is historical.

## Implementation status

[VERIFIED via the coordinating session's source review and test results] Rollback
is source-built for disposable schemas and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers.
The final combined five-suite run passed 103/103 tests under non-UTC process and SQL
session time zones, including 28/28 rollback tests. Public fingerprints stayed unchanged.
Types, scoped source lint, Atlas and DAL gates and their self-tests passed. The
fresh full build passed (`outputs/roster-rollback-build.log`); Opus returned READY with no requested source fixes; both named test gaps are closed. Contract labels below describe the accepted requirements, not an
independent reviewer verdict. Current evidence and the baseline audit-precision
limitation are recorded in [engineering checks](ENGINEERING_CHECKS_2026-11-10.md).

## Source and consumer contract

- [VERIFIED via `scripts/lib/expertise-roster-cutover.cjs`] Slice A owns phase
  admission, private baseline/generation and receipts, original FK metadata,
  freeze verification, catalog checks and the SQL lock order. The baseline carries
  original SQL rows, bridge IDs/bindings, the sequence, bound profile values and
  a separate unbound profile inventory. The existing CLI defaults to dry-run
  and refuses public before connecting.
- [VERIFIED via `scripts/lib/expertise-roster-import-store.cjs`] The complete
  target census preserves creation keys and ETags and its default projection omits
  `createdon` and `modifiedon`; rollback explicitly requests those audit fields. The full-import verifier fingerprints this projection,
  including preexisting canaries. The full-import checkpoint records ID 35 as
  identity-only and Amy as bound ID 40 without an original legacy source row.
  [Full-import rehearsal](FULL_IMPORT_REHEARSAL_2026-11-10.md)
- [VERIFIED via migrations 004/035/048/050 and the Atlas] Legacy rows carry their
  integer ID, managed fields and SQL audit fields. The nullable Contact GUID
  controls linked email resolution. The partial unique index reserves a Contact
  only for active rows. Feedback's original validated FK targets the legacy roster
  and one-off feedback has a null roster ID. Site Visit and other numeric clients
  use the same integer identity.
  [Application State Atlas](../../../APPLICATION_STATE_ATLAS.md)
- [CONTRACT] The operator invokes the existing CLI with phase `rollback`. The
  transaction restores legacy rows, FK, sequence and writer admission as a unit.
  The receipt records outcome, generation and counts without profile content.
  Legacy readers recover their source of truth after the separate application
  routing step. No UI or API route changes are required.

## Admission and exact inputs

1. [CONTRACT] Reuse `runCutover`, the exact target acknowledgement, private manifest
   and new receipt arguments, and the existing namespace guard. Acquire the
   exclusive lifecycle lock before SQL table locks. For a new rollback, require
   phase `paused`, the exact manifest hash/generation/target/schema and zero
   pending intents. Hold the existing table locks on legacy, identity, binding and
   feedback before locking the control row. Verify the owned freeze, local catalog,
   active identity FK, frozen source rows/sequence, baseline bridge subset and
   counter at or above all reserved identities. A paused command with an unsettled
   write refuses without changing admission. Existing operator quiescence of older
   and direct Dataverse writers is required through commit. The lease only drains
   participating application writers.
2. [CONTRACT] Read a complete census before table locks and again immediately
   before commit while both locks remain held. Require equality over sorted
   membership, GUIDs, creation keys, ETags and the selected values, including audit
   timestamps. Compare baseline bindings to the current bridge by integer and GUID.
   Require a valid unique current profile for every target binding and every
   baseline bound profile, with unchanged creation key for baseline profiles.
   Reject bindings for unexpected hosts, missing or malformed bound profiles,
   duplicate GUIDs/keys and every unbound current profile absent from the manifest's
   unbound inventory by exact GUID and creation key, regardless of key type.
   Matching preexisting unbound canaries stay outside reconciliation while unbound.
   A baseline-quarantined profile that becomes bound is reconciled as a legacy
   insert when its bridge ID has no original source row. Never infer
   deletion from a missing profile. A census difference between the two reads
   aborts SQL. This detects drift up to the last read; it depends on the external
   writer stop through commit.
3. [CONTRACT] Add an optional `readTarget({ includeAuditTimestamps: true })` projection
   for rollback in the existing import store and pass that option through the
   read-only CLI transport. Include `createdon,modifiedon` when requested. Preserve
   the default import, full-verifier and Slice A baseline projection so existing
   snapshots and manifests remain comparable. Neither timestamp participates in
   the managed-field delta. Slice B compares baseline and current managed values
   using the explicit field map below.

## Reconcile the projected legacy rows

[CONTRACT] Build the intended final SQL rows before removing the freeze. Start from
the immutable original SQL rows and join by current binding ID/GUID. Never join on
name, email or a Dataverse-supplied numeric field. Use strict bound-profile
validation before decoding, including exact active state, valid category, booleans,
explicit nullable links and all managed text. Canonicalize Dataverse's empty
optional text to null for the baseline/current comparison. The original SQL
values remain verbatim where that comparison has no delta.

| Case | Reconciliation |
|---|---|
| Original legacy row with a binding | Compare the reviewed cutover Dataverse profile and current Dataverse profile field by field. Copy only changed managed values into the original row. An unchanged sandbox-null Contact leaves the original Production Contact GUID intact. An unchanged normalized Dataverse null leaves original SQL empty text intact. |
| Original legacy row without a binding | Preserve verbatim, including identity-only ID 35 and all audit values. |
| Current binding without an original legacy row | Insert a row at the same bridge ID with current managed fields, even if the binding predates activation. This covers baseline-only Amy as well as profiles allocated after activation. |

[CONTRACT] The legacy projection consists of name, role_type/category,
is_active/state, dataverse_contact_id/Contact GUID, and all twelve roster text
fields `role`, `affiliation`, `orcid`, `preferred_email`, `primary_fields`,
`keywords`, `subfields_specialties`, `methods_techniques`, `distinctions`,
`expertise`, `keck_affiliation`, `keck_affiliation_details`. On original
bound rows refuse post-baseline User changes. Allow baseline lead eligibility
to change from true to false when the final profile is inactive, as the app's
deactivation path clears it. Refuse all other lead eligibility changes. On
inserts require null User and false lead eligibility because legacy has no
representation for either. Preserve unchanged Dataverse-only fields in Dataverse. SQL row ID
and Dataverse binding never change.

[CONTRACT] Validate the merged projection against the verified legacy relation's
actual column types, nullability and VARCHAR limits and the partial unique active
Contact index. The known VARCHAR limits are name 255, role type 50, role 255,
affiliation 500, ORCID 255, Keck affiliation 255 and preferred email 320.
Verify the index's local relation, uniqueness, key and active/non-null predicate.
Check the three known roles, canonical Contact GUIDs and the legacy linked-email
rule against the final merged link. The Dataverse staff/Contact restriction applies
to validating bound Dataverse profiles, and legacy permits retained Contact links
across categories. An unchanged historical preferred email can remain on a linked
row. A new or changed nonempty email while linked refuses, including when an edit
was allowed in sandbox because the link there is null. To resolve this refusal,
resume, revert the Dataverse email edit, pause again and retry rollback. Check
active Contact collisions across all final rows, including
untouched rows with original source links. When a validated edit moves an active
Contact slot, release the outgoing slots of changed rows in the transaction
before applying the final deltas so a valid swap does not fail on a transient
unique conflict. All final changes still pass the real index and database checks.
Reject unfamiliar schema or rules; do not truncate or coerce values.

[CONTRACT] A row is changed only when its final managed SQL values differ from
the original row. A Dataverse delta that restores an original SQL value leaves
the row physically untouched. For a changed original row, retain `created_at`
and `created_by` in place, set `updated_by` to NULL, and take `updated_at` from
Dataverse `modifiedon`. Never assign `created_at` from the manifest. New rows
have NULL legacy audit actor IDs and use Dataverse `createdon` and `modifiedon`.
Require valid UTC ISO timestamp strings for values written, including
created-before-or-equal-to-modified on inserts. Pass the ISO text directly as
`$n::timestamptz AT TIME ZONE 'UTC'` into the `timestamp without time zone`
column. JavaScript `Date` objects are excluded from this write path. Use SQL
`::text` or `to_jsonb` for exact audit verification under non-UTC process and
SQL session time zones, including original sub-millisecond precision.
[ASSUMED] Existing legacy timestamp values can be interpreted as UTC wall-clock
values. Rollback depends only on preserving them verbatim and applies explicit UTC
conversion exclusively to newly written audit values. Dataverse native audit
remains the source for staff attribution.

## Commit and terminal observation

1. [CONTRACT] Check every non-null feedback reference against the final ID set
   before writing, including excluded identity-only source rows and feedback
   added after activation. A reference to an identity with neither an original
   row nor a current binding refuses. With the verified freeze and table locks
   held, calculate next ID as one above the maximum of live old sequence
   `last_value`, manifest sequence high-water, allocator counter, every reserved
   bridge identity and the largest final SQL ID. Require the expected integer
   sequence range, increment one, cache one, no cycle and its original ownership
   and default. Refuse if next ID exceeds the sequence maximum. Gaps are preserved.
2. [CONTRACT] Within the same transaction remove only the verified freeze, apply
   parameterized updates/inserts, swap the identity FK back to the exact validated
   original FK using the fixed reviewed DDL and matching its saved metadata, verify the resulting catalog and use transactional
   `ALTER SEQUENCE ... RESTART WITH` at the calculated next ID. Interpolate
   only the range-checked safe integer because this command requires a literal.
   [VERIFIED via the rollback PostgreSQL suite] Post-restart fault injection
   verifies transactional restoration on the rehearsal PostgreSQL version. Check the restored sequence's next-value state
   without consuming it. Verify the final legacy projection and FK against the
   calculated result. The second census and connection liveness check precede
   commit. Preserve all Dataverse profiles, identities, bindings and feedback
   rows. Any error rolls back SQL data, FK, sequence, freeze and phase together.
3. [CONTRACT] Add nullable `terminal_action` to the disposable control DDL and
   validate its consistency in the existing lifecycle state reader and at SQL
   level. It is NULL in prepared/active/paused and exactly `abort` or `rollback`
   in legacy. Both terminal transitions set phase and action atomically in the
   existing generation/pending-guarded UPDATE. Update synthetic fixture/test
   control row setups as needed. Disposable Slice A schemas are temporary; use
   fresh control DDL for Slice B and refuse malformed or older terminal rows.
   No automatic migration or production schema change is needed.
4. [CONTRACT] A matching terminal rerun with the original manifest/generation
   confirms local catalog, original FK, and no freeze and returns `observed`
   without writes, target census or a sequence reset. It accepts legitimate
   legacy writes since the earlier commit. A mismatched terminal action refuses
   even when the phase is legacy. An uncertain COMMIT leaves the original receipt
   as `commit-unknown`. A new invocation with the same manifest distinguishes
   committed rollback from still-paused state using the control row and catalog.
   Dry-run performs admission, catalog and both census checks plus reconciliation
   and returns planned counts without files, DDL or DML.

## File scope and verification

[CONTRACT] Extend `scripts/lib/expertise-roster-cutover.cjs` with the new action and
reuse its private receipts, state admission and catalog helpers. Keep the pure
merge/projection testable within the operations module unless extraction becomes
necessary. Pass census options in `scripts/rehearse-roster-cutover.cjs` and
`scripts/lib/expertise-roster-import-store.cjs`. Add the terminal marker to
`lib/services/expertise-finder/roster-lifecycle.cjs`. Expand the existing
`tests/integration/roster-cutover.pg.test.js` and the relevant transport/lifecycle
tests. Fixture teardown must prove the public relation, content, sequence, FK and
trigger fingerprints still match.

| Contract | Required evidence |
|---|---|
| Restore legacy readers and numeric references | Seed a lead-eligible staff member, sandbox-null legacy Contacts, linked rows and a baseline-only Amy-like binding. Deactivate the lead-eligible staff member and preserve original empty text and sandbox-unlinked Contacts. Leave excluded row 35 untouched, restore baseline-only and newly allocated profiles and a baseline canary later bound in active phase, preserve feedback and validate the restored FK. Assert the next legacy INSERT uses the calculated ID above the captured sequence and all reservations. |
| Bound rollback writes and audit | Assert original unchanged rows and audit are exact in SQL under non-UTC process and session time zones, including a delta that lands on the original SQL values. Changed rows and inserts have expected nullable actor IDs and UTC audit timestamps. Valid active Contact swaps succeed. |
| Refusals preserve paused state | Pending intent, bad manifest, stale second census, new unbound app and direct keys, missing/rebound profile, unsupported User or lead change, malformed audit timestamp, oversized text, duplicate active Contact, missing feedback reference and sequence exhaustion. Verify a sandbox-null linked-email refusal and successful resume → revert → pause → retry. After a fault injected after trigger/FK/sequence work, verify transaction rollback restores the paused identity FK, old sequence and verified freeze. |
| Recover receipts without replaying data | Simulate lost rollback COMMIT, resume a legacy insert and observe rollback with the same manifest; refuse observing abort as rollback or the reverse. Prove dry-run and public refusal, and re-run Slice A operational and runtime tests. |
| Preserve import and isolation | Verify default census query remains unchanged, optional audit fields are selected for rollback, no transport write is possible, and the public fingerprint matches after every real SQL fixture. |

[CONTRACT] Run focused unit and opt-in local Postgres suites and the applicable build
checks before Opus 5.5 build review. Public rehearsal, live Dataverse rollback and
deployment admission remain outside the evidence from synthetic SQL fixtures.
