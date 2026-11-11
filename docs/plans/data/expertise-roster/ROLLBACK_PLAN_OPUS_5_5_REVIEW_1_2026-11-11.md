**Verdict: NOT READY TO BUILD.** There are two material blockers, and each needs only a one-sentence change to the plan. Five more contract points need pinning down before you build. Everything else I traced matches the current source.

## Material blockers

**B1. A new unbound profile without an `app_` key drops out of legacy without any error.**
- The plan (line 57, copied from the parent design at line 214) refuses only "newly observed unbound `app_` profiles".
- The census and the lifecycle both accept `direct_` and `legacy_` keys [VERIFIED via `roster-lifecycle.cjs:26`, `cutover.cjs:184-196`].
- So a profile created during the active phase by a direct or older writer, under any other key, is in Dataverse but never reaches legacy SQL. Nothing would detect it. Writers being stopped at rollback time does not cover writes made earlier in the active phase.
- **Smallest change:** refuse any unbound current profile that is not in `manifest.unboundProfiles` with the same GUID and creation key. Add a refusal test using a `direct_` key.

**B2. Deactivating a lead-eligible staff member makes rollback impossible.**
- `saveRoster` sets lead eligibility to false whenever a profile is deactivated, and the contract requires lead eligibility to imply active [VERIFIED via `roster-service.js:36`, `roster-contract.cjs:19`].
- The plan (line 91) refuses any post-baseline change to lead eligibility on original bound rows.
- The real fixture has three lead-eligible staff [VERIFIED via `FULL_IMPORT_REHEARSAL_2026-11-10.md:41`]. Deactivating any of them, which is a routine edit, blocks rollback. The only way out is to undo the edit.
- The refusal protects nothing in legacy. Lead eligibility only exists in the rehearsal contract, service, match contract and page; the legacy table and route have no such column [VERIFIED via grep; `004_expertise_finder.sql`; `import-plan.cjs:14`]. Dataverse keeps the value anyway.
- **Smallest change:** on original bound rows, accept lead eligibility going from true to false when the final `is_active` is false. Keep the other User/lead refusals. Add a test for it.

## Contract points to pin down (one sentence each)

1. **The staff/Contact restriction is not a legacy rule.**
   - The legacy route checks only the three roles, the Contact GUID format and the linked-email rule [VERIFIED via `pages/api/expertise-finder/roster.js:56-70, 239-241, 347-353`].
   - As written (lines 100-101), the rule could refuse untouched historical rows. It could also refuse a valid Dataverse change of category to staff on rows 9, 10, 24, 30 and 39, which keep their Production Contact in SQL while Dataverse has null.
   - **Change:** either drop the restriction from legacy validation, or apply it only to changed or inserted rows and say so.
2. **Email edits on the five sandbox-null rows refuse.**
   - Dataverse allows an email edit on those rows because they are unlinked there. In legacy they keep their Production Contact, so the linked-email rule refuses the merged row.
   - Refusing is correct. The plan should state the way out (resume, revert the edit, pause, retry) and test it.
3. **Define "changed row" by the final values.**
   - For rows where the import overrode the source (Kevin's active state, John's category), a Dataverse edit can land back on the original SQL value.
   - Treat a row as changed only if the final managed projection differs from the original SQL row. Otherwise a no-op rewrites `updated_by` and `updated_at`.
4. **Timestamps must not pass through JavaScript `Date` objects.**
   - `manifest.source` is built through the pg driver's `Date` and then JSON, so it has millisecond precision and depends on the process time zone [VERIFIED via `cutover.cjs:169,180`].
   - Pin these three things:
     - Bind ISO text as `$n::timestamptz AT TIME ZONE 'UTC'`, never a `Date`.
     - Never copy `created_at` from the manifest.
     - Make the "exact audit" checks compare in SQL (`::text` or `to_jsonb`), and run them with a non-UTC session and process time zone.
   - Treating the legacy `timestamp` columns as UTC wall-clock time is `[ASSUMED]`. They are written with `CURRENT_TIMESTAMP` in the session's time zone [VERIFIED via `roster.js:358`]. State this assumption in the plan.
5. **The sequence restart needs a literal.**
   - `ALTER SEQUENCE … RESTART WITH` cannot take a bind parameter, so interpolate a validated safe integer there.
   - That the restart is transactional on PG 17 is `[ASSUMED]`. The planned fault-injection test is what proves it, so keep that test.

## Verified as sound (no findings)

- **Lock order:** the exclusive advisory lock is taken before `ACCESS EXCLUSIVE` on the tables, and the control row is locked `FOR UPDATE` after that (`cutover.cjs:290-305`).
- **Paused admission:** manifest hash and generation are checked through `verifyManifest`; frozen source and sequence through `verifyFrozenSource` with the subset check; the high-water check sits at `:314`.
- **Pending intents:** the pending check while paused can never fire, but it does no harm. Intents can only be added while active, and pause requires none pending (`lifecycle.cjs:108`, `cutover.cjs:296,349`).
- **FK restore:** comparing against the saved original FK metadata matches the existing abort path (`cutover.cjs:313`).
- **Terminal state:** `terminal_action` is needed because the "observed" check today compares only the phase (`:294`). The abort `UPDATE` at `:348` must also set the action, which the plan already covers.
- **Lost COMMIT:** distinguishing a committed rollback from a still-paused state by the control row and catalog works with the existing receipt states.
- **Contact uniqueness:** releasing outgoing Contact slots before the final updates is necessary, because a non-deferrable unique index is checked row by row even inside a single `UPDATE`.

## Smaller implementation notes

- **CLI pass-through:** `readTarget()` in the CLI takes no arguments today, so it must forward the timestamp option [VERIFIED via `rehearse-roster-cutover.cjs:61`].
- **Fixture:** it has only rows 1, 2 and 35, with no Contacts, emails or varied timestamps. The evidence table needs a richer fixture: sandbox-null and linked rows, a lead-eligible staff row, and a baseline-only row like Amy's.
- **Canaries:** a baseline unbound canary that gets bound by an app edit during active becomes a legacy insert. That is acceptable in a rehearsal, but say so in the plan.

This review was read-only and made no edits. The parent design shares B1's `app_`-only wording (line 214), so it needs the same one-line fix.
