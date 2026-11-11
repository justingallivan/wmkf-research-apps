# Roster engineering checks — November 10, 2026

## Matching persistence and history

[VERIFIED via real local Postgres and controlled service/route dependencies]
`tests/integration/roster-matching-persistence.pg.test.js` exercises single-match,
batch-match and history against temporary tables derived from migration 004.
The test replaces provider, document, roster snapshot and authentication calls;
it does not invoke a model, Graph or Dataverse. Production/shared databases are
rejected by the existing exact-target guard before connecting. All SQL uses one
transaction; temporary tables and their sequences disappear on rollback.

The check found that history still used Vercel SQL while rehearsal matching saved
through the local transport. History now uses the same guarded seam; normal mode
still delegates to Vercel. The UI also no longer reports failed history reads as
empty history: it shows an explicit error with Retry, and aborts/cancels stale reads
when leaving the tab. Independent review found no remaining blocker; 32 UI tests
passed, including failure, retry and abort cases. Verified invariants:

- Both matching entry points persist GUID results with server-resolved names.
- History reads only the authenticated actor's matches, ignoring request identity.
- Wrong-category or ineligible lead identities cannot be persisted.
- Incompatible live prompt bytes fail before model execution or SQL writes.
- A no-lead result persists explicitly while staff consultation stays available.
- Unauthorized history reads perform no SQL.

The older wrong-category/unknown-identity unit test omitted required assignment
fields, so it could pass for the wrong reason. Its fixture now satisfies that
prerequisite and asserts the actual identity refusal.

## Writer freeze boundary

[VERIFIED via two actual connections to the populated dedicated fixture]
`tests/integration/roster-writer-freeze.pg.test.js` confirms a legacy insert is
blocked by the maintenance lock and works again after rollback. Both transactions
roll back, and the synthetic insert supplies an explicit negative ID to avoid
sequence advancement. Before/after roster, bridge and feedback counts, roster
sequence and feedback FK definitions match. Both connections clean up independently
on failure; a writer cleanup error cannot skip the owner's rollback/end.

This proves lock/release mechanics only. It does not prove a persistent freeze,
FK migration, post-edit data reconciliation, operational rollback or deployment
admission/drain. At that checkpoint, source search found no operational roster cutover/rollback
command or runtime allocator. The November 10 allocator continuation below supersedes
that implementation status. No numbered bridge migration is present; public
promotion remains a separate release prerequisite.

## Editor form normalization

The real RosterForm initializes optional text to empty strings. The editor's create
readback compares against Dataverse nulls, so both active and inactive creation
could commit then return 409. New tests reproduced both failures before repair.
`roster-contract.cjs` now canonicalizes only exact empty optional text in its copied
DTO. Original input, names, whitespace and nonempty text are preserved. This follows
the already-approved empty-text policy; import source artifacts are unchanged.

`probe-roster-editor-empty-text.mjs` is the reproducible bounded sandbox canary.
It validates an exact unlinked inactive synthetic fixture before calling the service,
retains a stable mutation key, and refuses to overwrite an existing receipt. A
negative probe confirmed that altered retained input is rejected before service
invocation. It retains its synthetic profile; no deletion is part of this check.

## Live editor result and review

[VERIFIED via actual service and independent sandbox readback] Fable returned
**READY FOR BOUNDED SANDBOX CANARY**. The blank-form run retained inactive profile
`b34e680b-849c-4207-a2c5-689defd79aa7`; one atomic changeset returned two 204 statuses.
Replay returned the same GUID/ETag with no second changeset; changed values under
that key returned 409. All twelve text fields read back null, and the original
empty-string input stayed unchanged. Native creator/modifier both matched the
approved John actor. Private receipts: `empty-editor-run.json` and
`empty-editor-verification.json` under the full-import evidence directory.

The prior complete census of 45 profiles predates this one additional retained
synthetic profile; expected allocation total is now 46, not a fresh census claim.
No active blank-form live create was performed: active behavior is service-unit
verified, inactive behavior is live verified. The failing-before regressions used
mocks and created no orphan profiles. Whitespace is preserved in unit tests; its
live Dataverse round trip was not tested.

The 21-suite roster run passed 183 tests, including both opt-in SQL suites; their
final cleanup revision passed all seven SQL cases again. The final history UI run
passed 32 tests. Types, API routes/DAL/GUID gates and sequential self-tests, scoped
lint, documentation gates and the final production build passed. History/SQL
checkpoint: `eed5d38a6`. No full SSO or hosted-application claim follows from these.

## Reproduction and limits

For the two opt-in SQL tests, set `ROSTER_LIVE_SQL_TEST_ENV` to the private full-import
`full.env` path and run Jest with `--runInBand`. Without that variable they skip.
For the editor canary, run:

```sh
node --import ./scripts/lib/use-extensionless.mjs scripts/probe-roster-editor-empty-text.mjs PRIVATE_DIR
```

Never commit private environment or receipt directories. The SQL tests use controlled
authentication/provider dependencies, not independent SSO or paid model execution.
The full application/browser, actual attachment upload, linked-Contact lifecycle,
public new-profile numeric allocation and operational cutover/rollback gates remain open.
No push, deployment, Production mutation or shared-database write occurred.


## Allocator continuation — Slice A

[VERIFIED via source and disposable-schema PostgreSQL tests] Runtime admission now
uses a dedicated client and durable per-attempt intents; confirmed saves ensure a
stable numeric binding under a control-row lock. Unknown writes remain pending.
Create binding failures preserve retry identity; confirmed updates surface a saved
reconciliation warning. The importer refuses lifecycle-controlled tables after its
existing exclusive locks.

Ten allocator tests pass, including concurrent same/different GUID saves, lost COMMIT
response recovery, lost-session intent retention and freeze/sequence checks. Eight
phase-command tests pass for prepare/activate/pause/resume/abort, drift refusal and
lost-COMMIT reruns. Every fixture cleanup verifies the populated public fingerprint.
Three UI regressions verify warning retention, stable create retries and paused edit
retention; the existing disabled fieldset already prevents in-flight cancellation.

The combined 97-test run and production build passed at the implementation checkpoint.
Historically, both Fable build reviews exited with "out of usage credits" without
completing. The owner switched future plan/build reviews for this continuation to
OAuth Opus 5.5. Its source review returned READY with no material blockers and four
low-severity findings. Those four findings and the receipt-directory fsync nit are
fixed. The final combined run passed 109 tests across five suites, including isolated
SQL tests with unchanged public fingerprints; types and scoped lint passed. The
coordinating session reviewed the final diffs and closed the review loop without
another Opus cycle. The reviewer did not rerun tests or the build.
[VERIFIED via `outputs/roster-opus-fixes-build.log`] A fresh full build passed after the Slice A fixes at checkpoint `3a58a32e5`.
The coordinating session accepted Slice B plan revision 2 after source verification;
rollback is source-built and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers. See the full
[archived review and disposition](SLICE_A_OPUS_5_5_REVIEW_2026-11-11.md).
Rollback reconciliation is source-built for disposable schemas and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers. No control table or phase is applied to public, and the CLI refuses
public before connecting. Abandoning an uncertain create via explicit Cancel remains
an accepted disposable-schema dead end; there is no force-clearing repair command.
See `ALLOCATOR_CUTOVER_DESIGN_2026-11-10.md` for the accepted boundaries.

## Slice B rollback implementation checkpoint

[VERIFIED via the coordinating session's source review and test results] Rollback
reconciliation is source-built for disposable schemas and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers. The final combined run passed 103/103 tests across five suites under non-UTC
process and SQL session time zones, including 28/28 rollback tests.
Public fingerprints remained unchanged. Types, scoped lint, Atlas and DAL gates
passed, as did the DAL and Atlas self-tests. The fresh Slice B full build passed
(`outputs/roster-rollback-build.log`); Opus returned READY with no requested source fixes. Both named test gaps are closed. The coordinating session reviewed the added
tests and closed the review cycle with no material blockers. Source is unchanged
at `6b2c2704e`, so the prior full build remains current; no further Opus round
is needed for the test-only additions.

Original audit columns remain physically untouched and are verified through SQL
text, including sub-millisecond precision. The preexisting baseline capture uses
Postgres Date/JSON millisecond precision: detecting an external freeze-bypassing
audit-only change below that precision remains a limitation. Different process
time zones between prepare and rollback safely refuse on the frozen-source check. This does not weaken
the physical preservation claim or establish control over external writers.
See [the accepted rollback contract](ROLLBACK_RECONCILIATION_DESIGN_2026-11-11.md).
The [Opus build review](ROLLBACK_BUILD_OPUS_5_5_REVIEW_2026-11-11.md) of `6b2c2704e`
requested no source fixes. Tests for baseline-quarantined-to-bound insertion and
rebound identity-only ID 35 refusal passed. [VERIFIED via the coordinating
session's source trace] Current legacy consumers tolerate null audit actors: the
roster GET returns rows without actor joins/filters, page/components do not read
those fields, Site Visit and feedback picker projections omit them, and matching's
`buildRosterContext` ignores them. This is source evidence, not full browser/SSO
verification.
No public rollback, live Dataverse rollback or Production readiness is claimed.

## Historical Fable empty-text source review transcript

**READY FOR BOUNDED SANDBOX CANARY** — no named blockers, with caveats below.

This is a source-read review only: I have no shell in this session, so I did not see the actual diff hunks and ran no tests or gates. I read the current contents of the four modified and two new files plus their callers.

## Empty optional text → null (`roster-contract.cjs:20-22`)
- **Fix is correct for the reported failure.** A blank form now encodes every optional text column as null, so the readback comparison at `roster-service.js:42` matches and a same-`mutation_id` replay returns the existing profile without a second create.
- **Policy is preserved.** Only exact `''` is converted; whitespace-only, padded text and `name` are untouched, and the caller's input object is never mutated (`clean()` and `normalize()` both copy).
- **UI payload fits.** The Add form sends only allowed fields, with `''` for text and `null` for the two link fields (`pages/expertise-finder.js:588-594`).
- **Callers are safe.**
  - `saveRoster` is the only caller that uses the normalized value, for both create and update. Clearing a field on edit now sends null, which is what Dataverse stores anyway.
  - `roster-consumer-service.js:21` and `roster-match-contract.js:18` call `normalize` only to validate decoded rows and discard the result.
  - The import store does not call `normalize`/`encode` at all, so import behavior is unchanged.

## Creation recovery, active and inactive
- **Replay and uncertain-commit recovery hold.** Replay finds the row by creation key and skips create; a thrown create re-queries by key and rethrows only if nothing exists.
- **Inactive path is consistent.** The atomic changeset reads back as `statecode 1`, which decodes to `is_active:false` and matches; the key lookup has no state filter.
- **Tests cover the service, not the wire.** The new `test.each([true,false])` blank-form test mocks `profiles.create`. The changeset itself is covered separately in `expertise-roster-adapter-attribution.test.js`, which I did not open.

## History SQL seam (`pages/api/expertise-finder/history.js`)
- **Safe.** It now reads through `roster-sql.cjs`, the same seam `match.js` and `batch-match-service.js` write through, so rehearsal history reads the database the matches land in.
- **Auth and scoping unchanged.** `requireAppAccess` runs before any SQL, and the query is scoped to `access.profileId`, never request input.
- **Fails closed.** Outside rehearsal it delegates to Vercel unchanged; an invalid flag or target throws inside the `try` and returns 500. `roster-sql.test.js` covers delegation, parameterization, target refusal and no-fallback.

## Opt-in pg tests
- **Matching/persistence test is safe.**
  - It is skipped unless `ROSTER_LIVE_SQL_TEST_ENV` is set, and the real target guard checks the env file before connecting.
  - All work runs in one transaction that is rolled back, against TEMP shadow tables for `user_profiles` and `expertise_matches`.
  - LLM, Graph, SharePoint, Blob, prompt resolver and usage logging are all mocked.
- **Freeze test is safe but takes a real lock.**
  - It is guarded the same way, and both connections always roll back.
  - The explicit-id insert does not advance the sequence, and a before/after snapshot is asserted.
  - It holds a bounded `ACCESS EXCLUSIVE` lock on the real `expertise_roster` fixture table.

## Caveats for the canary (none blocking)
1. **Only exact-empty is proven.** Whether Dataverse round-trips whitespace-only, padded or multiline text unchanged is [ASSUMED]. A mismatch would still produce a created profile plus a 409. Keep the canary to a blank create plus a same-identity replay, active and inactive, or add one deliberate whitespace probe.
2. **Null lookup bind on create is unverified by me.** `encode` sends `wmkf_StaffUser@odata.bind: null` on create, while the import store deliberately omits it. I am relying on your report that the earlier canary's create succeeded before the 409.
3. **Earlier attempts left profiles behind.** The create-then-409 runs left orphaned sandbox profiles whose creation identities the UI has since discarded. Inventory them so they are not mistaken for canary output.
4. **Do not run the freeze test during the canary.** Its lock would briefly block roster reads and writes on the local fixture.
5. **The matching test does not prove the fixture schema.** Because it shadows `expertise_matches` with a TEMP table, it says nothing about whether the real fixture has that table for live history reads.
6. **Undeclared dependencies, for promotion only.** `dotenv` and `pg-connection-string` are present in `node_modules` but not declared in `package.json`. The default jest `testMatch` loads both pg test files even when skipped, and `history.js` now loads the guard module at import.
