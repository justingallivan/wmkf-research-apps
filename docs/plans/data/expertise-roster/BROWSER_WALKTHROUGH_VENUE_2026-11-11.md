# Signed-in roster browser walkthrough venue

Stage 1 covers the real Expertise Finder roster editor and match-history
reader using an existing sandbox grant, normal Microsoft Entra sign-in and a
disposable SQL schema. Use the existing local Postgres container and a separate
Next.js process bound to localhost port 3000. Preserve the populated public
full-import fixture and its dated receipts. Revision 2 addresses the
[first Opus 5.5 plan review](BROWSER_VENUE_OPUS_5_5_REVIEW_1_2026-11-11.md). The implementation lead accepted the bounded operator walkthrough after verifying the
review findings against source. The runner review corrections and signed-in walkthrough passed; display follow-up tests, READY review, rebuild and read-only browser verification also passed. See [current evidence](ENGINEERING_CHECKS_2026-11-10.md).

[VERIFIED via `scripts/verify-roster-full-import.cjs`] The verifier hashes the
complete Dataverse census including ETags, and any extra profile or changed
ETag prevents reproducing the dated replay snapshot. The default import census
currently omits `modifiedon`. The existing November 10 receipts stay immutable
historical evidence. Later canaries already increased the sandbox count from
the full-import checkpoint's 43, so this walkthrough takes its own complete
before/after census. It edits only the existing inactive synthetic profile
`b34e680b-849c-4207-a2c5-689defd79aa7`, created after full import and recorded
in [the editor canary checkpoint](ENGINEERING_CHECKS_2026-11-10.md). No create or
delete is part of the walkthrough. Restore its original managed values and
record the intentional ETag/native audit change while proving all other profiles
are unchanged. This retains the real browser save requested by the owner.

## Historical preimplementation starting point

- [VERIFIED via `roster-rehearsal-target.cjs`, `roster-sql.cjs` and
  `roster-lifecycle.cjs`] The rehearsal target pins all four Postgres aliases to
  loopback port 55439 and the `roster_rehearsal` database/user, plus the registered
  Dataverse sandbox and both enforcement flags. Roster consumers have a TCP
  transport. Staff auth and profile readers still use `@vercel/postgres`, which
  rejects the pinned numeric loopback URL. The editor lifecycle defaults to public.
- [VERIFIED via `scripts/prepare-roster-full-import-rehearsal.cjs`] The populated
  fixture has only an ID stand-in for `user_profiles`, so it cannot support staff
  OAuth callbacks or the profile and app-grant reads. The existing PG test fixture
  shows owned generated schema creation, isolated search path and public fingerprint
  comparison. Use that isolation pattern for the venue.
- [VERIFIED via `pages/api/auth/[...nextauth].js`, `lib/utils/auth.js`,
  `lib/services/dataverse-identity-map.js` and
  `lib/services/dataverse-app-access-service.js`] Staff sign-in checks a live Azure
  OID match and active profile, updates login timestamps and populates the session
  with the profile and Dataverse actor. A missing profile normally triggers
  provisioning, default grants, a notification and identity reconciliation. App
  access checks active status and roles locally and reads the sandbox app grant
  using the existing identity map. Ordinary mapping skips SQL profile ID 1 and
  remaps ID 6 to 5. A local superuser would bypass the grant proof.
- [VERIFIED via `pages/_app.js`, `shared/context/ProfileContext.js`,
  `shared/context/AppAccessContext.js` and `shared/components/Layout.js`]
  The signed-in shell fetches the session, app access, profile and preferences.
  Preference bootstrap can POST a migration marker even in a clean browser when
  the stored marker is absent, or copy legacy sender information to a signature.
  The layout fetches alerts for superusers and staffing/board capabilities for
  staff who already have the `reviewers` grant.
- [VERIFIED via `docs/AUTHENTICATION_SETUP.md`] The documented development callback
  is `http://localhost:3000/api/auth/callback/azure-ad`. [ASSUMED] The selected
  Entra registration still allows that callback and the operator's existing
  sandbox account has the needed grant. Verify both before starting the walkthrough.

The historical direct-Vercel auth limitation above is superseded only in the
explicit browser opt-in by the implemented `browserSql` selector. Ordinary and
roster-only modes retain their original auth transport. Contract labels below
describe execution bounds, not outstanding implementation tasks.

## Preflight and disposable data

1. [CONTRACT] Check OAuth discovery and the required server-only configuration
   without printing values. The existing Graph application read is unverified
   after HTTP 403 and is unnecessary. Drop that probe step and verify callback
   registration through the real browser sign-in after the disposable seed and
   deny-unseeded guard are in place. Require `NEXTAUTH_URL=http://localhost:3000`, a fresh
   process-specific `NEXTAUTH_SECRET`, configured staff Azure ID/secret/tenant,
   literal `AUTH_REQUIRED=true` and effective auth enabled. Use the regular
   `azure-ad` provider. Leave emergency bypass and applicant provider off.
   Configuration failure stops startup. An Entra callback mismatch stops the
   walkthrough, without changing the registration or requesting directory rights.
2. [CONTRACT] Verify the approved operator's existing Azure OID and email from a
   trusted authenticated identity source and read the sandbox `systemuser` to
   match the OID, email and enabled status uniquely. The current
   `scripts/probe-roster-browser-prerequisites.cjs` already verifies that a complete
   sandbox email lookup returns the same single enabled User and Azure OID as the
   direct GUID read. Independently confirm the authentic signed-in principal at
   OAuth callback against the seed. Verify the existing
   `expertise-finder` grant and expected roster role/impersonation privileges by
   readback. Record only pass/fail or redacted references outside the worktree.
   Preserve existing grants and roles. A missing or ambiguous match stops setup.
3. [CONTRACT] Capture the established public fingerprint, then create one
   `roster_rehearsal_<32 lowercase hex>` schema owned by the pinned database user.
   Set the sole search path and prove its OID, ownership and relation namespace
   before DDL. Use these scoped tables and columns:
   - `user_profiles` from the v10/v11/v27 definitions in
     `scripts/setup-database.js`. Include `id`, `name`, `display_name`,
     `avatar_color`, `is_default`, `is_active`, `created_at`, `last_used_at`,
     `azure_id`, `azure_email`, `last_login_at`, `needs_linking`,
     `dynamics_systemuser_id` and `dynamics_reconciled_at`.
   - Empty `dynamics_user_roles` from v14. Keep the operator a normal staff user.
   - Migration 004 for `expertise_roster` and `expertise_matches`, 048 for
     `consultant_feedback`, and the inert identity bridge draft. The editor's
     dedicated lifecycle verifies all four relations even in GUID-only mode and
     the history reader uses the local profile FK. The Contact and preferred
     email migrations add no required column for this stage. Apply only the
     scoped fixture DDL, with all FKs local and no general migration runner.
   - One verified, active, already-linked operator profile using the approved
     identity, a fixture ID other than 1, 5 or 6, and `needs_linking=false`.
     Seed a synthetic match owned by this profile and an unrelated match to
     prove history scoping. Give the unrelated profile NULL `azure_email` to
     avoid a sandbox identity lookup.
     Keep private source roster/feedback snapshots out of this setup.
4. [CONTRACT] Build without credentials and start a dedicated, unexposed loopback
   Next production server on port 3000 with `NODE_ENV=production` and both
   `VERCEL` and `VERCEL_ENV` unset. Verify neither IPv4 nor IPv6 already has a
   listener on 3000. Use only `http://localhost:3000` as the browser origin. The
   Dataverse interlock classifies the process as local with no Vercel marker.
   Production-mode NextAuth avoids development debug token logging. Keep
   `AUTH_REQUIRED=true` and leave emergency bypass unset. Use a fresh private
   effective environment that excludes unrelated worktree .env fallback, shared
   Blob, Graph write, provider and scheduling configuration. Exclude
   `VERCEL_PROJECT_ID`, meeting-transcription test deployment, ranking-test,
   transcription-pilot and production Dataverse write acknowledgements. Keep any transient
   environment files or process logs private (0600). No new database server or
   deployment.

## Minimal runtime changes

[CONTRACT] Add a server-only browser opt-in and schema setting to the existing
`lib/services/expertise-finder/roster-rehearsal-target.cjs` guard. Accept only
the exact disposable pattern, current database/user, local process, expected
`NEXTAUTH_URL`, enabled real staff auth and the existing rehearsal target
requirements. Both `EXPERTISE_ROSTER_BROWSER_REHEARSAL=on` and the generated
`EXPERTISE_ROSTER_BROWSER_SCHEMA` must be supplied together. An invalid or
partial browser configuration fails closed
before SQL/Dataverse side effects. Existing unset normal mode delegates to
the unchanged transport. Existing roster-only rehearsal keeps its current
behavior when the browser setting is absent.

[CONTRACT] Extend `roster-sql.cjs` to select the validated schema for browser mode.
Start local pool clients with a sole schema search path derived from the
validated identifier. Await namespace/ownership and search-path verification
on the actual checked-out client before handing it to the caller or issuing
a standalone query. An async pool connect listener cannot provide this ordering.
On verification failure discard the client. Pin the pool to the chosen
connection string and namespace and reject changes within the process. Pass
the same verified schema to the editor's dedicated lifecycle connection in
`roster-lifecycle.cjs`. Preserve the pool and lifecycle boundaries and
parameterization. Refuse the unused pooled transaction `db.connect()` in this
browser mode. The editor uses the separately guarded lifecycle Client. Direct
callers keep the existing normal-mode Vercel path.

[CONTRACT] Wire the browser-only tagged SQL selector into
`pages/api/auth/[...nextauth].js`, `lib/utils/auth.js` and
`lib/services/dataverse-identity-map.js`. These consumers retain their original
Vercel tag outside browser mode, including existing roster-only rehearsal.
Keep `DatabaseService` unchanged. Its optional profile bootstrap read may
return 404, with the header falling back to authenticated session identity.
Protected app access and roster/history proof still use the seeded profile.
Use explicit server-only imports and verify the Next bundle. Keep existing DAL,
role and application grant checks. A global alias or package shim would change
unrelated SQL consumers.

[CONTRACT] Add a browser sign-in branch before normal provisioning, modeled on
the existing isolated meeting-transcription callback. Any present but invalid
browser configuration denies the sign-in. Require the real staff `azure-ad`
account, exactly one matching Azure identity row with active true and
`needs_linking=false`, and a successful conditional timestamp update. Reject
unseeded, disabled and unlinked accounts before default grants, notifications or
identity reconciliation. A valid seeded user still needs the existing grant.

[CONTRACT] Deny every non-GET `pages/api/user-preferences.js` request with 403 in
browser mode. The existing bootstrap only deletes old browser localStorage keys
after a successful POST. The roster keeps its real auth, grant and sandbox
write checks. The named inactive canary,
single-field PATCH, and restoration are operator execution bounds. Use the
existing conditional ETag edit path after verifying the canary's exact identity,
inactive unlinked shape and original values. The browser venue has no active
allocator state. Do not create, delete, activate or touch another profile.

[VERIFIED via `instrumentation.js`, `lib/utils/migration-drift.js`,
`lib/utils/auth-bypass-monitor.js`, `ProfileContext.js` and `Layout.js`]
The direct Vercel client rejects the pinned URL for startup migration tracker
and alert/notification SQL. Migration drift logs a tracker-query failure and
returns without taking the missing-table notification branch. Check the
private runtime log for that warning and no alert or email attempt. The
emergency bypass monitor stays inactive with its flag unset. Profile selection,
not startup, sends the last-used PATCH. The welcome modal only affects local
storage. Leave the Board writeups feature disabled. If the existing reviewers
grant triggers the header staffing capability GET, `pages/api/workbench/staffing.js`
calls `staffingCapabilities` → `requireSetupManager` → read-only `eligibleStaff`
in `lib/services/board-writeups/config.js`. Its direct Vercel profile SQL can
refuse the pinned URL. The Board header request returns 404 with
`BOARD_WRITEUPS_ENABLED` absent, before actor/cycle reads. Record shell status without
visiting out-of-scope paths. All database aliases remain pinned so untouched
Vercel SQL cannot fall through to shared Postgres.

## Implementation invariants

| Invariant | Enforcement and verification |
|---|---|
| Ordinary traffic retains its existing transport and auth | Explicit browser-only tagged SQL selector, normal and roster-only delegation tests, and unmodified production auth decisions outside browser mode. |
| The venue cannot fall into public or shared Postgres | Exact paired opt-in, sandbox and all-alias target checks, generated owned namespace and relation checks on each client, same schema for history and lifecycle, and unchanged public fingerprints after cleanup. |
| A normal Entra principal and existing app grant authorize access | Anonymous denial, completed provider callback, unique seeded active/linked Azure identity, normal sandbox grant lookup, and unseeded/disabled refusal without provisioning. |
| Bootstrap has no out-of-scope writes | Deny preference mutations in exact browser mode, no startup notifications, no added roles/grants, no uploads and no model call. |
| The real browser edit is bounded and reversible | Normal auth, grants and ETag plus operator pin to the named canary and field, explicit restore, and complete target before/after verification. |

## Browser evidence and isolation

[CONTRACT] Open a new Chrome tab and verify the protected roster API initially
refuses anonymous access under the fresh process-specific `NEXTAUTH_SECRET`.
Follow the Microsoft redirect and callback. Existing Microsoft SSO may satisfy
the provider login. Do not inject application cookies or clear other browser
cookies. Verify the resulting first-party
session, own profile, expected grant and protected roster response. Record
statuses and visible UI results, with no cookies, credentials or personal
profile data in retained evidence. Walk through roster search/category and
inactive filters. Take a complete private before-census and confirm the exact
synthetic canary is unbound and outside the dated full-import snapshot. Use the
real editor to save its fixed test role, reload and independently verify the
readback, then restore the original value through the editor using the current
ETag. After restoration take a second complete census. Require equal counts,
identical GUID/key membership and unchanged values and ETags for every other
profile, and exact restoration of the canary's managed values. Document its
changed ETag and native audit. If restore fails or the readback is uncertain,
stop further edits and surface the current canary state. Verify the synthetic
history reader and its profile scoping. Start the bounded write step only
after anonymous denial, callback, session and read-only app/grant checks pass.
A roster-only browser rehearsal keeps the
disposable lifecycle in GUID-only preparation mode, so its result proves
editor/auth transport, while numeric allocation and rollback retain their
separate guarded PG evidence. Do not claim SSO from a synthetic session,
direct service call or an unsuccessful redirect.

[CONTRACT] Run focused browser-mode target, namespace, auth, and SQL regression
tests before the walkthrough. Cover unchanged normal and roster-only rehearsal
routing, malformed/absent schema in browser mode, wrong target or aliases,
missing/foreign schema or relation, first-query namespace ordering, connection
cleanup, unseeded/disabled/unlinked auth refusal, and non-superuser grant
behavior. Verify denied preference writes and preserve existing stale-ETag editor tests. Verify built source paths and anonymous protected-route denial.
Do not submit a live match or upload from the browser.
After the walkthrough stop the Next process and end all clients, remove only
the owned disposable schema after matching its name and OID, then compare public
relation, row, sequence, FK and trigger/function fingerprints. Keep scoped
evidence and remove transient private configuration.

[CONTRACT] Stage 1 excludes consultant feedback attachments, upload and match
submissions. These cross Blob, Graph and Dataverse persistence or invoke metered
models; they require separately bounded authorization. Stage 1 also excludes
new grants/roles, OAuth registration changes, deployment and Production/shared
writes.
