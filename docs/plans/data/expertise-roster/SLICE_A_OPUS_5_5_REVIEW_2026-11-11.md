# Roster Slice A — Opus 5.5 source review

## Current review disposition

[VERIFIED via the archived review transcript below] The owner-authorized OAuth
Opus 5.5 review returned **READY for Slice A**, with no material blockers.
The reviewer read source only and did not rerun tests or the build. The earlier
97-test run and build are separate checkpoint evidence.
[VERIFIED via `outputs/roster-opus-fixes-build.log`] A fresh full build passed after the Slice A fixes at checkpoint `3a58a32e5`.

The owner switched this roster continuation's future plan/build reviews to OAuth
Opus 5.5. This is the session's reviewer choice, not a new repository policy or
permission to use a paid review product.

[VERIFIED via the final combined test run reported by the coordinating session]
Findings 1–4 (abort receipt recovery, creation-key admission, post-commit unlock
handling and CLI refusal messages) and the receipt-directory fsync nit are fixed.
The final run passed 109 tests across five suites, including private-environment
SQL tests with unchanged public fingerprints. Types and scoped lint passed, and
the coordinating session reviewed the final diffs. The review loop is closed with
no material blockers; no additional Opus cycle was run for these low-severity fixes.
The transcript's stated coverage gaps remain explicit limits of that source review.
The coordinating session accepted Slice B plan revision 2 after source verification;
rollback is source-built and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers.

Historical review attempts: both preceding Fable runtime/phase reviews exited
with "out of usage credits" and did not complete. That failure remains historical;
the Opus source review supersedes the current review-blocked status.
Rollback reconciliation is source-built for disposable schemas and has an Opus 5.5 READY source review; both named regression gaps are closed and the review cycle is complete without material blockers. Public phase execution, Production readiness and
independent browser/SSO verification are not established by this review.

Source transcript: `outputs/roster-slice-a-opus-5-5-review-1.md`, preserved verbatim
below. Line references describe the source snapshot reviewed at that time.

## Archived transcript

**Verdict: READY for Slice A.** I found no material blockers. There are four low-severity issues, and every one of them fails closed.

I only read code for this review; nothing was edited or executed. I did not re-run the 97 tests or the build. The plan file couldn't be written because the Write tool is disabled here, so this message is the full review.

## What holds up (checked against the source)

**Intent ordering.** `saveRoster` validates the ETag, the links and the values before calling `beforeMutation` (`roster-service.js:35-37,44,53`). If the commit of the intent itself is uncertain, `query()` throws a 503 and no Dataverse write is sent (`roster-lifecycle.cjs:102-109`). Adding and removing intents are each a single UPDATE that only applies if the phase and generation still match, and the row count is checked.

**Unknown outcomes.** The runtime transport is `DynamicsService.createRecord`, `updateRecord` and `executeChangeset`, called with `noFallback:true`.
- Nothing in that path retries. `fetchWithTimeout` makes one fetch, and `_writeFetch` only retries a 403, which `noFallback` turns off. So a 412 can't hide an update that actually landed.
- An unconfirmed changeset becomes `buildServiceError` with the outer 200 status (`changeset.js:159-170`). That isn't a definite rejection, so the intent is kept.
- A failed inner operation in the atomic changeset gives a definite 4xx, which correctly clears the intent.
- A failure reading the response body throws a plain Error, so the outcome stays unknown.
- Updates always send If-Match, so a PATCH can never turn into an upsert.

**Concurrency and stable binding.**
- `complete()` locks the control row (`FOR UPDATE`), checks phase and generation, looks up the existing binding by (host, GUID), and clears intents in the same transaction.
- Imported keys (`legacy_<datasetId>_<id>` and `app_<uuid>`, from `import-plan.cjs:94`) pass `creationKey()`, so the first edit of an imported profile binds rather than dead-ending.
- The advisory-lock key is built from the schema's OID, so locks in public and in a disposable schema never collide.

**Target and namespace isolation.**
- Public is refused before any connection (`cutover.cjs:271`, `lifecycle.cjs:83`).
- The search path is set to one validated schema, and all four tables are checked to belong to that schema's namespace.
- The foreign-key catalog query catches both inbound and outbound cross-schema keys (`cutover.cjs:88-90`).
- The importer is public-only and refuses to run once the control table exists, checked after it takes its table locks (`import-store.cjs:94-97`).

**Baseline, census and FK checks.**
- Prepare re-checks the local bridge while holding the exclusive table locks, and reads the Dataverse census twice.
- Activate rebuilds the baseline and requires an exact match, ETags included. It adds the new feedback FK (which Postgres validates on creation) and then re-checks the catalog. The high-water mark is the largest of the old sequence, the source row IDs and the identity IDs, with an exhaustion guard.

**Commit recovery.** The manifest is created exclusively (`wx`) before any DDL and is only reused if its content is identical. Rerunning a phase that already happened returns `observed`. A lost COMMIT is recorded as `commit-unknown`.

**Caller → persistence → consumer.**
- `pages/api/expertise-finder/roster.js:107-119` calls `requireAppAccess`, then `withDalContext`, and takes the actor from the session. It maps 412 to 409 and maps a 503 from `fail()` correctly, and the save `warning` reaches the client.
- `roster-consumer-service.js:22` skips profiles that have no numeric binding.

## Findings (Low, non-blocking)

1. **Recovering a lost `abort` receipt fails once legacy writers resume.** In `cutover.cjs:305-309`, a `legacy` state still runs `verifyFrozenSource(…, exactBridge=true)`, which compares the live source rows and sequence to the manifest. Any write after the abort makes a rerun of `abort` refuse with "Frozen legacy source changed" instead of returning `observed`. That contradicts the design's same-phase rerun contract.
   - *Fix:* when `state.phase==='legacy' && observed`, skip the source and sequence comparison. Keep `verifyManifest`, `assertNoFreeze` and the original-FK equality check.

2. **The census accepts creation keys the runtime later rejects.** `cutover.cjs:186-188` accepts any non-empty `wmkf_creationkey`, but `complete()` requires the `app_`, `direct_` or `legacy_` format (`lifecycle.cjs:26,117`).
   - An unbound profile with an unusual key can pass prepare and activate.
   - Its first edit then records an intent, applies the Dataverse PATCH, and fails `complete()`.
   - That leaves a dead end that blocks pause, even though nothing about the outcome was uncertain.
   - *Fix (either):* use the lifecycle `creationKey` validator inside `census()`, or check the stored key before `beforeMutation` on the update path whenever `lease.active` is true.

3. **An unlock error can override a committed result.** `cutover.cjs:368` awaits `session.close()` with no catch. If unlocking fails after a successful COMMIT, the CLI prints a generic failure even though the receipt says `committed`; a rerun returns `observed`.
   - *Fix:* `await session.close().catch(()=>{})`, matching `lifecycle.cjs:136`.

4. **CLI hides its own refusal messages.** The errors `main` throws itself (bad arguments or usage, private-env-file check, acknowledgement mismatch, target errors) carry no `code`. `rehearse-roster-cutover.cjs:80-81` therefore replaces them with the generic "Cutover rehearsal failed".
   - *Fix:* tag those throws with `code:'roster_cutover_refused'`.

5. **Nit: the receipt's directory isn't fsynced after creation, unlike the manifest's** (`cutover.cjs:64-65`).

## Scope gaps
- **Real census path not exercised.** The integration tests inject `readTarget`, so the real CLI census has never run. I'm assuming, without checking, that `client.raw` keeps the `@odata.etag` annotation on each row, which `census()` requires. If it doesn't, a real `prepare` refuses, which is safe.
- **Untested recovery cases.** No test covers a prepare COMMIT that truly failed followed by a rerun with no control state, or a lost COMMIT on activate or abort.
- **Tests read.** I read both pg integration tests in full. I saw the rehearsal-service unit test only through search hits, and didn't look for separate importer-refusal or CLI tests.

**Suggested tests if you fix these:** abort → legacy INSERT → `run('abort')` should return `observed` (finding 1), and a census containing a profile with key `foo_x` should make prepare refuse (finding 2). Re-run both pg suites with `ROSTER_LIVE_SQL_TEST_ENV` and confirm the public fingerprints are unchanged.
