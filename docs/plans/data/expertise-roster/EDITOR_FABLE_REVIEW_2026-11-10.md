# Inactive editor Fable review — November 10, 2026

Ordinary read-only Claude OAuth reviews. The initial blocker was repaired; the
second review cleared a bounded sandbox canary, which subsequently passed.
See `CONSUMER_WRITE_REHEARSAL_2026-11-10.md` for executed evidence and limits.

## Initial review

## Verdict: one named blocker, otherwise ready for a bounded sandbox canary

The blocker is a small unknown-outcome leak in the route's status mapping; nothing else I found blocks the canary. I ran no tests or gates (read-only session), so test results are unverified.

### Blocker: unconfirmed commit can reach the client as HTTP 200

- **Where it starts:** `lib/services/dynamics/changeset.js:162-170` throws the "could not confirm an atomic commit" error with `status: resp.status`, which is 200 on that path.
- **How it leaks:** `saveRoster` (`roster-service.js:40`) rethrows it when the keyed readback finds nothing. The route (`pages/api/expertise-finder/roster.js:115`) then maps `error.status || 503`, so it responds 200 with an `{error}` body.
- **Why it matters:** a client checking `res.ok` reads an unknown-outcome create as success. The same response also carries up to 500 characters of raw Dataverse response text.
- **Why it's new:** the editor could not reach this path before; `createRecord` never throws a 2xx-status error.
- **Fix:** have the route treat any error status below 400 as 503, for example `error.status >= 400 ? error.status : 503`. Alternatively `saveRoster` could convert it to its existing "Creation outcome unavailable; retry with the same identity" 503.

### Checked and sound

- **Actor attribution:**
  - The actor comes from `actorRefFromSession(access.session)` in the route, not from request input (I did not open that helper).
  - `MSCRMCallerID` goes on the outer `$batch` request, so both operations carry the actor.
  - `noFallback` reaches `_writeFetch`, which returns the 403 without retrying as the service principal.
- **Fail-closed target:**
  - `check()` runs before either create branch.
  - The route wraps the call in `withDalContext` and `rehearsal.assertTarget()`.
  - The interlock allows `$batch` on the sandbox host and hard-denies it against Production from non-production deployments.
- **Atomicity:**
  - There is a single changeset with POST then PATCH, and the helper throws unless it parses exactly two 2xx results.
  - The caller's body is not mutated.
  - A `statuscode` other than 2 is refused before any write.
- **Replay and key recovery:**
  - `saveRoster` reads by creation key before the create, after a failure, and after success, then compares values including `is_active`.
  - The fresh random GUID per attempt does not give idempotency by itself; that rests on the `wmkf_creationkey` alternate key.
  - The alternate key is declared in the schema file and asserted Active by the import store and rehearsal script. I did not probe it live.
- **Privilege failure:** a 403 throws whether Dataverse reports it on the outer response or the embedded operation, and `createRecord` is never used as a fallback.
- **Regression scope:**
  - `noFallback` defaults to false, so existing changeset callers behave as before.
  - I found no `_writeFetch` spy on a changeset path that asserts exact arguments.
  - The sandbox dependency files use the real `_writeFetch`.

### Caveats that do not block

- **Wire shape differs from the importer.** The importer's changeset uses `PATCH $1`; the editor uses a client-supplied GUID and `PATCH wmkf_expertiseprofiles(<guid>)`. That is reasonable given the helper prefixes the base URL, but it is unproven live under impersonation. The canary is what tests it.
- **The adapter has no impersonation guard of its own.** If `DYNAMICS_IMPERSONATION_ENABLED` is not `'true'`, `noFallback` does nothing and the write lands as the service principal. Only `actorRequired` in `roster-service.js` prevents that. It is the sole write caller, and the active-create path has the same property.
- **Timeout then late commit.** A timeout whose commit lands after the readback surfaces as an error. A retry with the same `mutation_id` is then safe only because of the alternate key, and only if the client keeps the `mutation_id` after a failure, which I did not check.
- **Inactive create now needs Write as well as Create** for the impersonated editor. The scoped editor role should cover it, but the canary's privilege case is the proof.
- **Test gaps:**
  - No test for the `statuscode !== 2` refusal.
  - No `saveRoster` test for inactive create with keyed recovery.
  - No test pinning the default 403 retry for existing changeset callers.
  - No test for the 200-status mapping above.
- **Unreviewed file.** `tests/unit/expertise-finder-batch-cycle.test.js` is modified in the worktree but was not in the supplied patch or review scope.

### Canary acceptance criteria

1. One inactive create leaves exactly one row, inactive, with `createdby` and `modifiedby` equal to the actor, and never visible as Active.
2. An under-privileged actor gets a 403 and a keyed readback finds zero rows.
3. A replay with the same `mutation_id` returns the same row.
4. A replay with the same key but different values returns 409.

Before the canary, run the two test files and the Dataverse access-layer gate with its self-test, sequentially.


## Re-review after repair

Trace is finished; here is the verdict.

## READY FOR BOUNDED SANDBOX CANARY

The prior blocker is resolved. I ran no tests or gates (read-only session), so the new tests are read, not run.

### Blocker: resolved
- **The path:** `changeset.js:162-170` still throws the unconfirmed-commit error with `status: 200`. `saveRoster` (`roster-service.js:40`) does the keyed readback and rethrows only if nothing is found.
- **The fix:** `pages/api/expertise-finder/roster.js:115-119` now passes a status through only if it is an integer in 400–599. Everything else (200, 201, 302, missing, null, string, 700) becomes 503 with a fixed message, so the raw Dataverse text no longer escapes on that path.
- **No validation regression:** `contract.fail` defaults to status 400 (`roster-contract.cjs:7`), so validation refusals keep their own status and message. The 412→409 mapping is unchanged.
- **Route test:** `tests/unit/expertise-roster-rehearsal-route.test.js` covers 200/201/302/undefined/700 → 503 with the fixed body, and 403/409/412 retained.

### Other test gaps from the prior review: closed
- **Inactive recovery:** the service test rejects the create with status 200, recovers by `app_<mutation_id>`, and asserts a single create call.
- **Invalid inactive status:** the adapter test asserts the refusal happens before either write transport.
- **Default fallback:** the changeset test pins the service-principal retry for existing callers, and the `noFallback` test pins a single `$batch` request.
- **Mock hygiene:** each of the three roster test files resets or clears mocks in `beforeEach`.

### Prior caveats: updates
- **Client keeps `mutation_id` after a failure:** closed. `pages/expertise-finder.js:375-380` clears it only after a successful response, so a retry replays the same key.
- **`expertise-finder-batch-cycle.test.js`:** now in the diff and test-only. It includes an unrelated v2-matching render test, which I did not check against the page.

### Caveats that do not block
- **Raw Dataverse text on 4xx/5xx:** a genuine 403 or 5xx still returns `error.message` verbatim, which includes the raw Dataverse body. This is the other half of my earlier note. It is acceptable for an authenticated sandbox canary; tidy it before any wider exposure.
- **Untracked test file:** `expertise-roster-rehearsal-route.test.js` is `??` in git and must be included in the commit.
- **Still open from before:**
  - The `PATCH wmkf_expertiseprofiles(<guid>)` wire shape is unproven live under impersonation.
  - Only `actorRequired` guards against a write landing as the service principal when impersonation is off.
  - Inactive create needs Write as well as Create for the editor role.
  - The `wmkf_creationkey` alternate key was not probed live.

### Before the canary
Run the four changed roster and changeset test files plus the batch-cycle file. Then run the Dataverse access-layer gate and its self-test, sequentially.

### Canary acceptance criteria (unchanged)
1. One inactive create leaves exactly one row, inactive, with `createdby` and `modifiedby` equal to the actor, and never visible as Active.
2. An under-privileged actor gets a 403 and a keyed readback finds zero rows.
3. A replay with the same `mutation_id` returns the same row.
4. A replay with the same key but different values returns 409.
