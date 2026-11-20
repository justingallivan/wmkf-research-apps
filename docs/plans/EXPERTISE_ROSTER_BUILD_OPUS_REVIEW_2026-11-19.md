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

## Focused correction verification (Opus 5.5, same OAuth mechanism)

I checked the current files by reading them only. I did not run any tests, and every finding below comes from the code itself.

## Findings 1–5

**1. Null User bind: fixed.**
- `roster-contract.cjs:27` only adds `wmkf_StaffUser@odata.bind` when a User is set, and the importer does the same (`expertise-roster-migration.mjs:132`).
- Clearing a User now goes through `expertise-profile.js:32-38`. That is one changeset holding the PATCH (with the loaded ETag) and a `DELETE …/wmkf_StaffUser/$ref`. It runs as the signed-in staff user (`actingUserSystemId: actor`) with `noFallback: true`.
- `changeset.js:206` really sends `If-Match` for each operation, and the DELETE has no body, which is allowed.
- `roster-service.js:77` only sets `clearStaffUser` when a User link is being removed. `wmkf_contactguid: null` is still sent, which is fine because it is a plain text column.
- Tests: `admin-expertise-roster-service.test.js:70,72-78` and `expertise-roster-adapter.test.js:8-14`.

**2. Unbound profile takes down consumers: fixed for Admin-created profiles, with one leftover.**
- The numeric binding is now reserved before the create (`roster-service.js:60`) under the same GUID that the create sends (`:61`).
- An inactive create keeps that GUID too (`expertise-profile.js:21`).
- A lost response is recovered by creation key (`:62`), and on replay the binding is repaired before the "different values" 409 (`:68` runs before `:69-71`).
- Updates repair or check the binding before the PATCH (`:76`).
- Tests: `service.test.js:58-71,35-39`.
- **Leftover (not blocking):** `roster-consumer-service.js:23-24` still returns a 503 for the whole roster if any unbound profile that isn't Admin-created exists (an import row or one made directly in Dataverse). The message tells people to fix it "in Admin", but the Admin list (`ExpertiseRosterSection.js:57-60`) shows no "needs repair" marker. The original review accepted failing hard for those rows.

**3. Stale ETag after a failed save: fixed.**
- After a failed update, the editor shows "Reload saved version" (`Section.js:86-93,97`), which replaces both the fields and the ETag.
- Cancel clears the data and re-fetches the list (`:46`).
- The route passes `?id=` through (`pages/api/admin/expertise-roster.js:30-31`).
- Create failures get no reload button. That is acceptable because retrying with the same `mutation_id` is safe to repeat.

**4. Importer stops on an inactive Contact: fixed.**
- `applyContactHealth` (`import-plan.cjs:142-150`) now blocks only that row unless the mapping sets `retainUnavailableContact:true`.
- The exact GUID is still enforced (`:89`).
- In verify mode it only adds a warning.
- A network or permission failure still stops the run (`:143`), which is intended.
- Blocked plan and import runs write the per-row report (`migration.mjs:108-109`).
- Tests: `migration.test.js:55-63`.
- **Leftover (not blocking), same failure shape but for Users:** `migration.mjs:103-104` still stops the whole run, verify mode included, if a linked User is missing or a lead-eligible User is disabled.
- **Small (not blocking):** `:107` recalculates only `summary.blocked`, so `summary.create` and `summary.unchanged` go stale after these Contact checks.

**5. Diagnostics thrown away: fixed in code.**
- Each import row records `error` (up to 1000 characters), `errorCode` and `httpStatus` (`import-execute.cjs:32`). The receipt is written after every row (`:35`) with mode 0600 (`migration.mjs:38`).
- Provisioning now prints a bounded error to stderr (`provision-expertise-roster.cjs:53`).
- **No test covers either.**
- The receipt can contain raw Dataverse error text. That is acceptable because the receipt is private and kept outside the repo.

**#9 Feedback snapshot: done.** The roster is read before `BEGIN` (`consultant-feedback-service.js:480,555`) and reused at `:484,508,529,601,660`.
- **Small regression:** the read happens even when it isn't needed, such as a one-off author on create (`:484` only uses it when `hasRoster`) or an edit that leaves the author unchanged. So a roster outage or a single unbound profile now gives a 503 on writes that never needed the roster. It fails before `BEGIN`, so nothing is half-written. Load it only when `hasRoster` or the author is changing.

## New blockers

None found. The fixes don't introduce anything that blocks the build.

One minor test note: `service.test.js:28` is called "binding failure after create", but the setup now fails at the pre-create binding. The test still passes as written; it just no longer tests what its name says.

## Verdict

**Code: ready, given that this is production-only, single-operator and a small static dataset.** Findings 1–5 and #9 are fixed. The leftovers above are not blocking.

**Production prerequisites still not done.** The fixes now depend on two new ones:
1. **Dataverse must accept a caller-supplied `wmkf_expertiseprofileid` on POST**, both plain and inside the inactive-create changeset. The whole pre-binding fix assumes this.
2. **`DELETE wmkf_expertiseprofiles(id)/wmkf_StaffUser/$ref` must work inside an impersonated changeset.** The `wmkf_StaffUser` name in that path must match the real navigation property exactly, including capitalisation. The bind uses the same name, so a wrong name would break both.

Earlier prerequisites still outstanding:
- Alternate keys must allow many NULLs.
- Inactive duplicate Contacts in the legacy data must be resolved.
- The Editor role must be assigned to the app user and every editing admin, and Connor's access confirmed as read-only.
- The real FK constraint name and a free migration number must be checked.
- `DYNAMICS_URL` and `resolveTargetResource` must point at the same host.
- One long text field must read back exactly.
- The FK must be applied before switching to the Dataverse backend, and the rollback runbook needs the binding-clear and sequence steps.
- The owner must set `retainUnavailableContact` per affected row.

None of these have been run or verified.

### Final minor dispositions

After this ready verdict, fixed the nonblocking Contact-health summary counts, renamed the prebinding test accurately, added diagnostic-receipt assertions, and preserved one-off-only feedback create/update during a roster outage. Updates preload before the transaction but defer a read failure until the locked row actually requires roster data; roster-attributed writes still fail before mutation. Added positive one-off and negative roster-attributed outage tests. Unbound imported/direct CRM rows still fail closed intentionally; error now asks for administrator reconciliation rather than implying a dedicated Admin repair control. Missing/disabled lead User preflight still blocks import/verification: enable/relink explicitly, never silently change lead eligibility. No further review verdict is claimed for these minor corrections; focused tests/gates cover them.
