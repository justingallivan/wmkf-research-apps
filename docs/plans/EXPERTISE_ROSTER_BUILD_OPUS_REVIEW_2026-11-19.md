# Opus implementation review — November 19, 2026

Read-only Claude Code review via host OAuth (`authMethod: claude.ai`); no agent API-key authentication or Ultrareview. Requested `claude-opus-5-5`; CLI usage metadata lists `claude-opus-5-5` and built-in `claude-fable-5-2` usage. This is the original review of the work in progress, not a verdict on the corrected files.

## Original report

# Expertise roster migration: adversarial implementation review (read-only)

**Verdict: not ready.** Two code problems block the build. Once they and items 3–5 are fixed, it is ready, subject to the production prerequisites at the end.

I edited nothing and made no network calls. `scripts/expertise-roster-migration.mjs` changed while I was reading it (a line I cited at 122 later appeared at 127), so its line numbers may be a few lines off.

## Code blockers

**1. Every write for an unlinked person sends `'wmkf_StaffUser@odata.bind': null`.**
- **Where:** `roster-contract.cjs:27` (`encode`), used by Admin create and update, and `expertise-roster-migration.mjs` around lines 122–127 (importer create).
- **Why it matters:** the repo's own `lib/services/dynamics/write-core.js:327` says a PATCH with `<NavProp>@odata.bind: null` "is NOT accepted by Dataverse". That means every Admin edit of a Consultant or Board member, and every "Unlink staff account", is expected to fail. The same null goes into the import's POST for most rows. Whether POST rejects it is unproven, but it is the same risk.
- **Tests:** they only check the non-null form (`admin-expertise-roster-service.test.js:43`, `expertise-roster-migration.test.js:52`).
- **Fix:**
  - Leave the key out when the value is null on create.
  - On update, send the bind only when it is set or changed.
  - Clear a link with a DELETE of `wmkf_StaffUser/$ref`, using `disassociate` in `write-core.js:339`. `disassociate` has no `noFallback` option yet, so add one to keep "no service-user fallback". Ideally put the clear and the PATCH in one changeset.
  - Add tests for the null and clearing cases.

**2. One profile without a numeric binding takes down every roster consumer.**
- **Where:** `roster-consumer-service.js:17-20` throws for the whole roster if any profile has no binding.
- **How it happens** (`roster-service.js:55-65`):
  - The create succeeds but `ensureProfileBinding` fails.
  - Or the user changes the form after a lost response, and the retry hits the "different values" 409 at line 62 before binding runs.
  - Or the user closes the form after an error.
- **Effect:** matching, the consultant dropdown, feedback list and writes, Site Visit, meeting and proposal-list recipients all return 503. The external briefing quietly shows `unavailable`. Nothing in the Admin list marks the profile that needs repair.
- **Fix (pick one or both):**
  - Assign the number before creating. Use `mutation_id` as `wmkf_expertiseprofileid`, call `ensureProfileBinding(host, mutation_id, key)`, then create. Retries become naturally idempotent and no unbound window exists.
  - Or have consumers skip unbound profiles whose key starts with `app_`. Nothing can reference them by number yet, so skipping loses nothing. Keep the hard failure for `legacy_` and unkeyed rows, and show a "needs identity repair" badge in Admin.
- Either way, bind before returning the 409 at line 62.

## Should fix before production

**3. A lost PATCH response leaves the editor stuck on a stale ETag.**
- `ExpertiseRosterSection.js:45-59, 83` never reloads after a save error. Retrying or reopening sends the old ETag and gets 412 until a full page reload.
- If the PATCH succeeded but the follow-up `profiles.get` at `roster-service.js:72` fails, the user sees an error for a save that actually landed.
- **Fix:** on any save failure or cancel, re-fetch `GET ?id=` (or bump `reload`) and refresh the form's ETag.

**4. The importer stops outright on an inactive linked Contact.**
- `expertise-roster-migration.mjs:89-98` throws in plan, import and verify modes before any receipt is written.
- There is no way to record that the owner accepted keeping the exact link, and verify becomes permanently impossible if a Contact is deactivated later.
- **Fix:** turn it into a blocking error on that row in the plan, with an explicit mapping flag that lets the owner keep the GUID unchanged.

**5. Diagnostics are thrown away.**
- `expertise-roster-import-execute.cjs:32` tells the operator to "inspect the private operator log", but nothing is logged.
- `provision-expertise-roster.cjs:53` discards every error.
- **Fix:** write the error message, status and code to the private receipt (mode 0600) or to stderr.

## Lower priority

6. **Unhelpful Admin errors.** `pages/api/admin/expertise-roster.js:42-46` turns an impersonation 403 into "could not be completed". It also turns `roster_binding_requires_reconciliation` (no status) into a generic 503. Return messages that say what to do.
7. **Wrong status on roster outage in matching.** `match.js:195-217` returns a generic 500 instead of 503.
8. **Missing user or Contact crashes validation.** `validateLinks` (`roster-service.js:25,28`) reads properties straight off the lookup result, so a missing record gives a 404 or TypeError instead of a clear message.
9. **Dataverse reads inside open feedback transactions.** In `consultant-feedback-service.js:482, 506, 598, 657`, `eligibleRoster` and `hydrateFeedbackAuthors` read the whole Dataverse roster while a Postgres transaction (and a `FOR UPDATE` lock on updates) is open. Run the eligibility read before `BEGIN`.
10. **Typed email blocks a new person's save.** On create, a preferred email typed before picking a Contact is kept, and `roster-contract.cjs:24` then rejects the save. Clear the email when a Contact is selected.
11. **ID 35 file names.** A new attachment on ID 35's feedback will be named "…-Unavailable consultant-…". Confirm that is acceptable.

## Checked and behaving correctly

- **Contact GUIDs are preserved exactly.**
  - The importer copies the source GUID (`expertise-roster-import-plan.cjs:87-88`).
  - Excluding a linked row is a blocking error (`:110`), and duplicate links across active and inactive rows are blocked.
  - The Staff-cannot-have-a-Contact rule is gone.
  - Changing category clears only the User link (`Section.js:93`), so Consultant→Staff keeps the Contact.
- **Numeric IDs and the excluded/inactive authors:**
  - Every source ID, including excluded ones, is reserved and the sequence advanced.
  - Binding conflicts refuse rather than overwrite.
  - ID 35 shows "Unavailable consultant".
  - A Dataverse outage surfaces as an error, and the briefing shows `unavailable`.
  - Inactive people keep their names.
- **Auth and actor:**
  - Admin writes require `requireSuperuser` plus a matching session profile.
  - The actor is the session's mapped system-user ID (stored as a UUID, so lowercase) with no fallback.
  - `noFallback` reaches `_writeFetch` for creates, updates and changesets.
  - The legacy route returns 409 in Dataverse mode, and requires superuser plus the cutover marker in Postgres mode. The seed and contact-link scripts are also gated.
- **Import:** runs one row at a time, recovers a lost create response by creation key, checks the readback, and resumes without duplicating people.
- **Context:** single-match now runs inside `withDalContext`.
- **FK template:** `apply-migrations.js` wraps each file in one transaction, so the DROP-then-ADD template is all-or-nothing.

## Production prerequisites (not code problems)

- **Null values in alternate keys:** confirm the keys on `wmkf_contactguid` and `wmkf_staffuser` allow many NULLs. Most rows are unlinked, so otherwise the import fails at the second unlinked row.
- **Duplicate Contacts in legacy data:** the legacy unique index only covers active rows (`setup-database.js:2071-2073`). Inactive duplicates will block the plan until resolved.
- **Roles:**
  - Assign the Editor role to the app user and to every administrator who will edit, since impersonation needs both and there is no fallback.
  - Confirm Connor's effective permissions are read-only.
- **Configuration checks:**
  - Check the real production name of `consultant_feedback_consultant_roster_id_fkey` and pick a free migration number.
  - Confirm `DYNAMICS_URL` and `resolveTargetResource` point at the same host.
  - Run export and import in the same timezone, because timestamps without a timezone feed the source fingerprint.
  - Spot-check that one long text field reads back exactly.
- **Ordering and rollback:**
  - Apply the FK migration before setting `EXPERTISE_ROSTER_BACKEND=dataverse`.
  - The rollback runbook needs the binding-clear and sequence steps. Reverting the FK will fail until any IDs created in Admin are added back to `expertise_roster`.

## Author dispositions

1. Fixed: omit null User binds; clear an existing User using atomic ETag PATCH + DELETE of the lookup reference, same impersonated actor/no fallback. Inactive creates retain the caller-proposed GUID.
2. Fixed: reserve numeric binding before Admin creation, using mutation UUID as Dataverse primary ID. Failed binding cannot publish an unbound person; a failed create leaves an unused numeric identity. Existing keyed profiles repair binding before a payload-mismatch 409. Import remains sequential verify-then-bind while the application stays in Postgres mode.
3. Fixed: failed updates offer explicit Reload saved version, updating fields/ETag; cancel refreshes the list. No automatic discard of edits.
4. Fixed: inactive/missing Contact becomes a per-row blocked plan entry unless the owner confirms `retainUnavailableContact:true`; exact GUID cannot change. Later verification records health warnings without requiring Contact reactivation. Network/permission failure is not treated as a missing Contact.
5. Fixed: private row receipt retains bounded diagnostic message/status/code; provisioning reports its bounded error rather than discarding it.
6. Fixed: readable permission/conflict/binding messages without exposing provider bodies.
7. Fixed: roster transport failures have typed 503; single-match maps them to unavailable.
8. Fixed: null/disabled person and 404 give actionable validation; unrelated provider errors propagate.
9. Fixed: feedback writes load one complete Dataverse roster snapshot before beginning the Postgres transaction; eligibility and return hydration reuse it.
10. Fixed before review completed: selecting a Contact for a new person clears their unsaved manual email.
11. Intentional: ID 35 remains explicitly Unavailable consultant, including new attachment naming; no fabricated author or reassignment.

Production-only prerequisites remain in the cutover runbook: schema/key/null behavior, effective permissions, actual FK identity, field parity and owner-confirmed recipient repairs. Timestamp-without-zone export values are now retained literally by the pg parser, removing the operator-timezone fingerprint dependency. No production verification is claimed.
