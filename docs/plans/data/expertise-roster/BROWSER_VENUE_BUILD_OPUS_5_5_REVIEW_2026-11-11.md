# Browser venue — Opus 5.5 build review

## Current disposition

[VERIFIED via the source-only transcript below] Opus found the runtime target,
SQL, lifecycle, auth consumers and preferences gate sound, but returned NOT READY
for two runner defects: intentional Next shutdown codes and signal-handler lifetime,
and reuse of the startup Dataverse token for the final census. The reviewer ran
no tests. The transcript remains the exact historical review of that source snapshot.

The coordinating session accepted and implemented the named corrections: recognize
intentional Next 130/143 shutdown outcomes while retaining handlers through cleanup,
and obtain a fresh token/client behind the GET-only guard before the final census.
The ten runner tests passed; the initial 105-test/14-suite run plus five additional runner cases covered
110 tests across 14 suites in aggregate. The coordinating session accepted the verified corrections; no second Opus
round is required for these bounded fixes.

[VERIFIED via the coordinating session's reported checks] The final build after the
lazy-import correction passed, as did gates and scoped lint. The subsequent real signed-in browser walkthrough, canary save/reload/restoration,
46-profile census and isolated cleanup passed. Display defects found in the walkthrough
were corrected with three passing UI tests, an Opus READY review, successful rebuild
and a second read-only OAuth browser pass with unchanged profiles/public SQL and cleanup; these outcomes are separate from this historical source review. See the
[venue contract](BROWSER_WALKTHROUGH_VENUE_2026-11-11.md).

Source transcript: `outputs/roster-browser-build-opus-1.md`, preserved verbatim below.

## Archived transcript

**NOT READY.** The runtime target, SQL, lifecycle, the three auth consumers and the preferences gate all hold up. Two bugs in the runner need small fixes before it can produce a valid result. I only read files and ran nothing. Write was disabled in this session, so the review is only in this message.

## Required

**1. A normal stop always reports failure** (`scripts/run-roster-browser-venue.cjs:146-152`)
- Next 16.3.8 runs the server inside the `next start` process (`node_modules/next/dist/cli/next-start.js:102`). On shutdown it calls `process.exit(130)` for Ctrl-C and `process.exit(143)` for SIGTERM (`node_modules/next/dist/server/lib/start-server.js:370-376, 388-389`).
- The runner only treats `code === 0 || signal === 'SIGTERM'` as success (line 150). Ctrl-C reaches Next directly through the shared process group, and the runner's own `child.kill('SIGTERM')` produces exit code 143. Both end up as "Venue server failed".
- So every walkthrough writes `success:false` to `result.json` and exits 1, even when the census and cleanup pass.
- A second problem in the same place: the SIGINT/SIGTERM handlers are removed when Next exits (line 150). A second Ctrl-C during the after-census or schema drop kills the runner before cleanup finishes.
- **Fix:** once the runner has asked Next to stop, accept exit code 130/143 (or signal SIGINT/SIGTERM) as success. Keep the signal handlers in place until the census and `fixture.cleanup()` finish.

**2. The after-census reuses the startup Dataverse token** (line 115, line 158)
- `createClient({ token: await getAccessToken(...) })` builds the client once with a fixed bearer token (`lib/dataverse/client.js:263, 302`). The census after the walkthrough reuses that client.
- These tokens usually last 60–90 minutes (standard Microsoft lifetime, not checked here). A longer session would get a 401 on the after-census. The no-change proof would be lost, although the schema would still be dropped.
- **Fix:** get a new token and client just before the after-census, wrapped in the same GET-only guard.

## Checked and sound
- **Browser mode switch:**
  - Setting either browser variable turns browser mode on.
  - Startup then also requires:
    - the exact schema pattern
    - production mode with no Vercel markers
    - `localhost:3000` as the origin
    - `AUTH_REQUIRED=true` and no emergency bypass
    - the staff sign-in settings
    - the sandbox and all database URLs pinned
  - Anything missing or wrong refuses startup (`roster-rehearsal-target.cjs:16-28`).
- **SQL:** each pooled client is checked for the right namespace, owner and tables before the caller's query runs. A client that fails the check is discarded. Pooled transactions are refused, and the pool cannot switch connection or schema (`roster-sql.cjs:9-39, 69-73`). The editor's dedicated connection uses the same schema, rejects a mismatch, and refuses any cutover state (`roster-lifecycle.cjs:87-99, 110`).
- **Three auth consumers:** `browserSql` falls back to the normal Vercel client outside browser mode, including roster-only rehearsal; `roster-browser-sql.test.js:16-19` covers this.
- **Sign-in:** the browser branch runs before any provisioning. It requires the staff provider, exactly one active, linked row matching both OID and email, and a conditional timestamp update. Any error refuses sign-in.
- **App access:** `/api/app-access` and `requireAppAccess` read profiles and roles only through those three consumers. Grants come from the sandbox through the identity map, which skips profile 1. The unrelated profile has no email, so it triggers no lookup.
- **Preferences:** an invalid browser configuration returns 503, and any non-GET returns 403. Both happen before auth or any database access.
- **Remaining surfaces:**
  - The CSRF origin check reads `NEXTAUTH_URL`, so localhost saves are allowed.
  - `next.config.js` has no `env` block, so no credentials are built in.
  - The runner refuses root `.env*` files.
  - The child process gets an allowlisted environment.
  - Census reads are GET-only.
  - `verifyCensus` checks the profile count and membership. It compares every other profile in full, including ETag and `modifiedon`, and the canary's business values.
  - Cleanup order is right: stop Next, take the census, then drop only the owned schema after matching its name and OID, then compare the public data.

## Minor, not blocking
- The census doesn't read `statuscode`. The editor derives it from `statecode`, so this barely matters for an app-created inactive canary.
- The setup grant check doesn't filter out inactive grant records. The app's own grant check at runtime still decides access.
- If the Entra `email` claim doesn't match the user's Dataverse email, sign-in is refused. That fails safe, but confirm the two match at the callback.
