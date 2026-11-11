The plan is not ready. One thing blocks it, and four changes are needed. With those changes the plan is ready, and smaller than it is now. I couldn't save this as a plan file because the write tool is off in this session, so the review is here only.

## Blocker

**B1. Saving a roster edit in the browser would permanently break the full-import receipts you want to keep.**
- In rehearsal mode the roster editor reads and writes the sandbox Dataverse profile records, not SQL (`roster.js:107-113`, `roster-service.js:29-63`).
- The Dataverse adapter can create and update but never hard-delete (`expertise-profile.js:14-29`). A browser-created profile can only be deactivated, never removed.
- `verify-roster-full-import.cjs:41-46` requires sandbox profile count = before + imported, and replay-hashes every profile including its ETag and `modifiedon`. One create breaks the count; one update to an imported profile breaks the replay hash.
- The plan's teardown only fingerprints Postgres, so this would go unnoticed.
- **Fix:** make Stage 1 read-only for the roster: search, category and inactive filters, reload, and history. This needs no new code. Leave `DYNAMICS_IMPERSONATION_ENABLED` unset, and `saveRoster` → `actorRequired` (`roster-service.js:18,30`) returns 503 before any lifecycle connection or Dataverse call. Add a browser check that a save attempt gets that 503.
- **Side effect:** the `roster-lifecycle.cjs` schema wiring is then unnecessary, since only saves reach it. Drop it, along with migrations 048, 050 and the bridge DDL from the disposable schema. Live saves become a later stage with a named synthetic record, a deactivation step and a Dataverse before/after check.

## Required changes

1. **Wire three database consumers, not four; leave `DatabaseService` alone.** If it stays on `@vercel/postgres`, `getUserProfileById` swallows the rejection and returns null (`database-service.js:288`), and `/api/user-profiles` returns 404. `fetchProfiles` then returns `[]`, and the header falls back to the session name and colour (`Layout.js:259,264`). The effect is cosmetic. Swapping the whole module would also redirect its `user_profiles` updates (`:328,369`).
2. **Block preference writes unconditionally in browser mode, not "if necessary".** Preferences live in sandbox Dataverse (`dataverse-prefs-service.js:24`). After any successful GET:
   - `migrateLegacySettings` POSTs whenever its migration flag is missing.
   - It also copies any old `localhost:3000` localStorage keys into those preferences, then deletes the keys from the browser.
   - The legacy sender-to-signature copy can POST as well.

   Return 403 for non-GET `user-preferences` requests in browser mode. The client only deletes localStorage after a successful response, so a 403 leaves both browser and Dataverse untouched.
3. **Copy the existing sign-in branch built for the meeting-transcription test deployment.** It is at `[...nextauth].js:110-130`. In browser mode:
   - Return false if the setting is present at all but the configuration is invalid.
   - Require exactly one row with `is_active=true` and `needs_linking=false`.
   - Deny before the provisioning lookup at line 181.

   The existing match-by-Azure-ID branch (160-176) doesn't check `needs_linking`, so browser mode must add that.
4. **List every startup and shell write in the plan, and check one in the run log.**
   - `instrumentation.js` runs a migration-drift check at startup. It stays on `@vercel/postgres`, gets `invalid_connection_string` (not `42P01`), logs a warning and returns: no alert, no ops email (`migration-drift.js:59-78,134`). The run log should show "tracker query failed".
   - The emergency-auth-bypass monitor does nothing while `EMERGENCY_AUTH_BYPASS` is unset.
   - Alert and notification services use `@vercel/postgres`, which rejects the pinned URL.
   - The profile `last_used` PATCH is not automatic: startup calls `loadSession` directly. Only a user-initiated profile switch sends it.
   - The welcome modal only touches localStorage.
   - Any other `@vercel/postgres` importer fails the same way, because every database alias points at loopback. That is your guarantee of no fallback to a shared database; the plan should say so.
   - I did not trace the staffing and board-writeup GETs the layout fetches when you hold the `reviewers` grant; treat them as assumed read-only.

## Answers to your questions

- **Auth bypass:** none. In production mode `isAuthRequired()` fails closed, and `requireAppAccess` still checks active status and roles fresh on every request and reads the Dataverse grant (`auth.js:360-416`). An empty roles table means no superuser path.
- **Shared fallback:** none, as long as the browser selector is a new export. Pointing the auth code at the existing roster `sql` would send it to the public stand-in `user_profiles(id)` whenever `EXPERTISE_ROSTER_REHEARSAL=on`.
- **Normal-mode behaviour:** unchanged, provided two things hold:
  - When browser mode is off, the selector passes calls straight to `vercel.sql(strings, ...values)`. The three consumers use only tagged templates.
  - Browser mode refuses to start when `VERCEL` or `VERCEL_ENV` is set. The auth settings are checked directly in the `.cjs`, the way `test-deployment-policy.js:46-53` does.
- **Graph 403:** a normal browser sign-in is enough; no extra permissions are needed.
  - Entra checks `redirect_uri` at `/authorize` and again at the token step. An unregistered callback fails with AADSTS50011 before any code is issued, so nothing reaches the app or database.
  - Count it as passed only on a completed callback, a session showing the seeded profile, and a 200 from the protected roster route.
  - Sign in only after the change-3 guard and the seed are in place.
  - Remove the Graph `applications` read from `probe-roster-browser-prerequisites.cjs`; it's unnecessary.
- **The probe doesn't yet do plan step 2.** It never compares the Azure ID or checks that the email is unique. The identity map takes the first email match (`dataverse-identity-map.js:65-71`), so require exactly one enabled sandbox user for that email. Seed `dynamics_systemuser_id` with that user's ID. A wrong Azure ID seed just makes sign-in fail closed.

## Smaller items

1. **Search path:** set it at connect time with `options: '-c search_path="<schema>"'`, then verify each new pool client once before its first query. In browser mode, refuse `db.connect`; only the excluded consultant-feedback flows use it.
2. **Seed IDs:** avoid profile IDs 1, 5 and 6, which the identity map skips or remaps. Give any unrelated fixture row a NULL `azure_email` so it causes no sandbox lookup.
3. **Origin:** use `http://localhost:3000` only. Opening `127.0.0.1` fails the cross-site request check (`auth.js:91-108`) and the cookie scope.
4. **Port:** before starting, confirm nothing else listens on port 3000 on IPv4 or IPv6. A stray listener could receive the sign-in code.
5. **Environment:** confirm these are absent, since they switch the proxy and identity-map branches:
   - `MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE`
   - `VERCEL_PROJECT_ID`
   - the ranking-test and transcription-pilot variables
   - any production-Dataverse write acknowledgement
6. **Build:** build with no credentials. Production mode on plain-HTTP localhost already works: the CSP skips the HTTPS upgrade on loopback (`proxy.js:117-124`), and browsers ignore HSTS over HTTP.
7. **Paid models and uploads:** these are blocked only because provider and Blob credentials are missing, and the default Match tab offers upload and match. Add one check that a match attempt fails without calling a provider.

## Smallest workable venue

- **Disposable schema:**
  - `user_profiles`
  - an empty `dynamics_user_roles`
  - migration 004 for `expertise_matches`
  - one synthetic match row
- **Runtime changes:**
  - browser-mode checks in the target guard
  - the browser pool and selector in `roster-sql.cjs`, with history using the browser schema
  - the selector wired into `[...nextauth].js`, `auth.js` and `dataverse-identity-map.js`
  - the sign-in deny
  - the preferences 403
  - no lifecycle or `DatabaseService` change
- **Teardown:** as planned, plus a check that the sandbox profile count and ETags match the stored before-snapshot and receipt.
