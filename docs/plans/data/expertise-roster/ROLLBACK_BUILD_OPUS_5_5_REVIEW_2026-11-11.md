# Slice B rollback — Opus 5.5 build review

## Current disposition

[VERIFIED via the transcript below] The OAuth Opus 5.5 source-only review of
checkpoint `6b2c2704e` returned **READY**, with no source changes requested.
The reviewer ran no tests. Both named evidence gaps are closed: inserting a baseline quarantined profile
after it becomes bound, and refusing a new binding on original identity-only ID 35.
[VERIFIED via the coordinating session's final test run and test review] Rollback
passed 28/28; the combined five-suite run passed 103/103 under non-UTC process and
SQL session time zones with unchanged public fingerprints. The review cycle is
closed with no material blockers or outstanding named test gaps. Source remains
unchanged at `6b2c2704e`, so the prior full build remains current.
No additional Opus round is required for these test-only additions.

The reviewer explicitly assumed null legacy audit actors are tolerated by readers;
[VERIFIED via the coordinating session's source trace] the current legacy roster
GET returns rows without actor joins or filters, the page/components do not read
`created_by` or `updated_by`, Site Visit and feedback picker projections omit actors,
and matching's `buildRosterContext` ignores them. This establishes tolerance in
those current consumers, not full browser/SSO verification. The existing
baseline capture uses process-time-zone-dependent Postgres Date parsing and
millisecond JSON precision. A different process time zone between prepare and
rollback causes a safe frozen-source refusal. An external freeze-bypassing change
below baseline audit precision remains a residual limitation. Original audit columns
remain physically preserved and verified through SQL text in the rollback tests.
These boundaries do not establish control over external writers or Production readiness.

See [engineering evidence](ENGINEERING_CHECKS_2026-11-10.md) for executed checks.
Source transcript: `outputs/roster-rollback-build-opus-5-5-1.md`, preserved verbatim
below; line references identify the reviewed snapshot.

## Archived transcript

**Verdict: the source is READY, with two test gaps against the design's own evidence table.** I found nothing that needs a source change. This was a source-only review: I ran no tests, so the passing results are your report, not mine.

## Test gaps (no source change needed)

The design's evidence table (design doc lines 194 and 196) lists two cases. I found no test for either in `roster-rollback.pg.test.js` or the related roster tests. The source handles both; they are just unproven.

1. **A baseline unbound profile that gets bound during the active phase should be restored as an insert.**
   - The fixture's baseline census has no unbound profile, so the path where a binding has no baseline profile and no original row never runs. Amy has a baseline profile and the "new synthetic" test uses a profile that isn't in the census, so neither covers it.
   - Minimal fix: in `beforeEach`, add one unbound `direct_` profile before prepare. In a new test, bind it at ID 43 with `high_water=43` and assert it is inserted at 43.
2. **A rebound profile should refuse without writes.** [VERIFIED via source] The check that rejects a changed profile binding (`cutover.cjs:351`) and the binding subset check (`cutover.cjs:271-273`) both handle it, but nothing exercises them.
   - Minimal fix: one test that adds a binding of a new profile GUID onto an original ID that had no binding, such as 35, and asserts the refusal and an unchanged `state()`.

Feedback preservation is covered indirectly. [VERIFIED via source] The fixture seeds feedback on ID 35 (`roster-pg-fixture.cjs:189`), and every successful rollback re-adds the original FK, which checks every existing reference. An explicit row-count assertion would be a nice extra, not a gap.

## What I traced and found sound [VERIFIED via source]

- **Every B1/B2 and clarification point from review 1 is implemented.**
  - B1: any unbound current profile not in the manifest's unbound list with the same GUID and creation key is refused, whatever its key prefix (`cutover.cjs:344-347`). Tests cover `app_`, `direct_` and `legacy_` keys.
  - B2: on original bound rows, lead eligibility may go from true to false only when the final row is inactive (`:358-359`). Other User and lead changes refuse, and inserts require no User and no lead eligibility.
  - Clarification 1: the staff/Contact rule is applied only to Dataverse profiles. The final legacy check covers role, name, null bytes, column widths, Contact GUID format and active-Contact uniqueness, which matches the legacy route.
  - Clarifications 2 and 3: the linked-email refusal and its resume, revert, pause, retry recovery are tested. A row counts as changed only when its final values differ from the original, so a delta that lands back on the original value writes nothing.
  - Clarification 4: timestamps are bound as ISO text with `::timestamptz AT TIME ZONE 'UTC'`, never as JavaScript `Date` objects, and audit checks compare `::text` in SQL.
  - Clarification 5: the sequence restart interpolates only a range-checked safe integer, and a fault injected after the restart test covers it.
- **Delta merge.** Each changed row starts from the original SQL row and takes only the managed fields that differ between the baseline and current profiles. So an unchanged sandbox-null Contact keeps the Production GUID, and unchanged empty text stays as stored. Rows are joined only by binding ID and GUID.
- **Contact swap.** Rows giving up an active Contact are cleared first, after the freeze is removed and before the per-row writes. A row whose Contact is cleared but not otherwise changed gets its final Contact written back, and duplicates across all final rows, including untouched ones, are checked in JS beforehand.
- **Audit fields.** Unchanged rows are never updated, and every row's audit fields are compared as SQL text before and after. Changed rows keep `created_at` and `created_by` and get `updated_by=NULL` and `updated_at` from `modifiedon`. Inserts take `createdon` and `modifiedon` with NULL actors, and the insert parameter order is correct.
- **FK and sequence.** The restored FK matches the saved original metadata through the catalog check. The next ID is one above the highest of the old sequence, the manifest sequence, the allocator high-water mark, every reserved identity and every final row ID. It is checked against the integer maximum and verified as not yet called.
- **Admission and fences.**
  - The exclusive advisory lock is taken first, then the four table locks, then the control row; the state must not change between the first and second reads.
  - The final control-row update is guarded by generation, phase and an empty pending list. The pending check runs again under the lock.
  - Two Dataverse reads, both including the audit timestamps, must match, and the second runs after all SQL work and before COMMIT. The comparison helper (`fingerprint`) sorts object keys, so these comparisons don't depend on key order.
- **Terminal state and lost COMMIT.**
  - The control table's CHECK constraint correctly ties `terminal_action` to the legacy phase, and the state reader refuses old control rows that lack the column.
  - Asking for rollback when the stored action is abort, or the reverse, refuses.
  - A repeated rollback takes the "observed" path: it checks the catalog, the original FK and that no freeze remains, makes no Dataverse read and no writes, and tolerates legacy inserts made since.
- **Read-only Dataverse and public refusal.** The CLI transport throws on anything but GET, and the import store checks that paging links stay on the sandbox host. `public` is refused before connecting. The default census query is unchanged, and the timestamp option is passed through.
- **Legacy consumers.** The column layout, nullability and widths that rollback checks match migration 004 plus 035 and 050. Site Visit normalizes `preferred_email` when it reads it (`recipient-directory-service.js:138`), so Dataverse-cased emails restored into legacy are harmless there.
  - [ASSUMED] Legacy roster readers tolerate NULL `created_by` and `updated_by` on inserted rows. Both columns are nullable, but I didn't trace every reader.

## Non-blocking notes

- **The creation key of a quarantined profile isn't re-checked once it becomes bound.** Only the GUID's absence from the baseline profile list is used. This is harmless, because the creation key is never written to legacy.
- **The frozen-source check depends on the process time zone, not only on millisecond precision.** It compares the legacy rows as read through `pg`'s `Date` parsing. If prepare and rollback run under different process time zones, rollback refuses safely ("Frozen legacy source changed"). This is the same mechanism as the residual limitation you already accepted.
- **Inserts are stricter than the app.** A new profile with a Contact link and a nonempty email refuses on insert, even if the email was entered before the link. The design calls for this, and it fails safe.

The residual limitation you named (manifest timestamps at millisecond precision, and privileged DDL that bypasses the freeze) is acknowledged, not a finding.
