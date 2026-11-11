# Remaining roster checks — Opus 5.5 plan review

## Current disposition

[VERIFIED via the exact transcript below] Opus returned READY WITH NAMED CHANGES
for the strict attachment-bucket correction and linked-Contact rehearsal. The
coordinating session accepted the strict resolver flags plus `folder_unavailable`
503 mapping/tests, exact fixture-location/path checks before any approved attachment
writes, and the linked-Contact trigger preflight, exact absence proof, sandbox/DAL
context, conditional deactivation and inactive-link refusal steps. Implementation,
tests and live probes are underway; this archive claims no completed outcome.

The live attachment run remains blocked on exact fixture/storage scope and separate
authorization for shared SharePoint writes, the private uploads store and Blob usage.
Venue transport/token changes must wait for that authorization. No new storage
infrastructure is part of the scope. The optional real-User duplicate-key probe,
numeric consumer seed and shared-member briefing proof are excluded. User lifecycle
remains controlled-test-only without an owned test User.

[VERIFIED via the coordinating session's read-only model GET] The current live
model is `claude-sonnet-5-5`, maximum 4096 tokens; the transcript's `claude-sonnet-5`
reference reflects the earlier static fallback. No inference ran. Matching still
requires explicit authorization for the current named model and runtime pin/refusal.
The source transcript is preserved unchanged; it is not current model configuration.

Source transcript: `outputs/roster-remaining-plan-opus.md`.

## Archived transcript

**Verdict: READY WITH NAMED CHANGES** for the linked-Contact rehearsal and the strict-flag code change. The live attachment run is **not ready**. It needs the venue changes below plus your separate approvals for shared storage.

I used only Read, Grep and Glob, and wrote nothing (no plan file). One limit: the venue allowlist and `portal-upload-staging.js` show *what* `UPLOADS_BLOB_RW_TOKEN` and `@vercel/postgres` would reach in the venue. I did not trace exactly how each would fail.

## Material blockers

1. **The attachment venue can't run as written.**
   - `run-roster-browser-venue.cjs:37-49` builds the server environment from a fixed allowlist of names. `UPLOADS_BLOB_RW_TOKEN` is not on it, so mint fails closed.
   - `portal-upload-staging.js:16` imports `sql` straight from `@vercel/postgres`. In the venue, `POSTGRES_URL` is the local `roster_rehearsal` database (enforced at `roster-rehearsal-target.cjs:12`). So staging rows would land in that database's **public** schema, which is the fixture the plan promises to leave unchanged, or the driver fails against local Postgres. Either way the "same owned schema" invariant breaks.
   - `roster-sql.cjs:71` blocks `db.connect()` whenever a schema is set. `writeFeedbackEntry`, `updateFeedbackEntry` and `deleteFeedbackEntry` (`consultant-feedback-service.js:516/602/763`) all use it, so attachment create and delete refuse in the venue.
   - **Fix:** do all three together, and only once the attachment run is approved:
     - add exactly `UPLOADS_BLOB_RW_TOKEN` to the allowlist (not the shared or intake Blob tokens);
     - switch the staging `sql` import to `roster-sql.cjs`, which already falls through to `vercel.sql` in normal mode — `consultant-feedback-service.js:75` does the same;
     - let browser-mode `db.connect` return a pooled client only after `verifyNamespace(client, schema, {browser:true})`, as `localQuery` does at lines 27-33.
   - Add one test that proves normal mode still uses `vercel.db.connect` / `vercel.sql`.

2. **"No competing *active* locations" is too narrow.**
   - `findByRegardingObject` (`sharepoint-document-location.js:28-33`) has no `statecode` filter, so it returns inactive locations too.
   - `activeBucket` (`consultant-feedback-attachment-service.js:95-99`) just picks the first `akoya_request` result.
   - The strict flags don't change which one is chosen.
   - **Fix:** require the fixture Request to have **exactly one** location row of any state, plus a resolved parent library. Then assert the computed `folderPath` equals the approved folder before any write.

3. **Error mapping for the strict flags isn't specified.**
   - With `requireResolvedParents`, the resolver throws a plain `Error` (`sharepoint-buckets.js:99-115`). That surfaces as a 500, not the existing `folder_unavailable` 503.
   - This is a runtime behaviour change on the normal path. It also fires when your own Request has an unresolvable parent.
   - **Fix:**
     - pass `{requireResolvedParents:true, requireCompleteResults:true}` at line 278 only;
     - wrap the call so a resolver failure becomes `attachmentError(..., 'folder_unavailable', 503)`;
     - add unit tests that assert the call arguments, and that an unresolved or truncated result reaches neither `ensureFolderPath` nor `uploadFile`.
   - Current tests mock `getSharePointBuckets` (`tests/unit/consultant-feedback-attachment-service.test.js:19`), so they don't check the flags. Other writers that skip the flags (materials, post-presentation) stay out of scope; list them as a follow-up only.

4. **Contact-create side effects are unverified.** This is an assumption, not a finding. Sandbox flows, plugins or duplicate detection on Contact create could send mail or touch other records.
   - **Fix:** a bounded read-only preflight of active `workflows` and `sdkmessageprocessingstep` registrations for `contact` Create/Update. If anything sends mail or writes to another entity, stop. The `example.invalid` address limits delivery but doesn't stop other writes.

## Named changes to the linked-Contact steps

- **Absence proof:** check an exact `fullname eq` and exact `emailaddress1 eq` match plus the GUID read. The existing probe's `contains(fullname,'Synthetic')` with `$top=50` (`probe-roster-remaining-fixtures.cjs:19`) doesn't prove absence.
- **Context and interlock:** the creating script must call `withDalContext`, with the interlock on and `DYNAMICS_URL` set to the sandbox. Assert the interlock's classification before the POST, as the venue already does for the rehearsal target.
- **Deactivate with the ETag:** `updateFields(id, {statecode:1, statuscode:2}, {ifMatch})` — `DynamicsService.updateRecord` supports `ifMatch` (`dynamics-service.js:260`). Drop "where supported".
- **Contact check runs only on change:** `roster-service.js:16` checks an active Contact only when the link changes. Add one step: linking the now-inactive Contact is refused. It costs one extra save, keeps the refusal in the transcript, and leaves no new state.

## Overengineering to cut

- **Optional live duplicate-key refusal (step 3):** drop it. If the key isn't enforced, the canary gets linked to a real User. Controlled tests already cover the refusal, and the risk outweighs the evidence.
- **Optional numeric consumer seed (step 4):** defer it. It's a separate proof and isn't needed to show the linked-person lifecycle.
- **Shared-member briefing proof:** keep it out unless you specifically ask for it.

## Missing prerequisites (none can be assumed)

- **Attachment run:** exact synthetic Request GUID and number; its single location and resolved parent; the Graph drive and folder ID; the Blob prefix `portal-staging/consultant_feedback/<GUID>/` (matches `portal-upload-staging.js:141`); and your separate approvals for SharePoint writes on `akoyago-shared`, the `wmkf-uploads-private` store, and Vercel Blob usage.
- **Live User lifecycle:** an owned test User. Until then it stays controlled-test only.
- **Matching:** your named approval of `claude-sonnet-5` before any inference, plus a runtime pin-and-refuse check. Nothing to build now.

## Fine as written

- Client-token minting needs no callback (`generateClientTokenFromReadWriteToken`, line 148), so a localhost browser-direct upload is plausible. [ASSUMED until exercised]
- Leaving the scanner off is consistent with no metered use.
- The receipt-as-cleanup-allowlist, exact-GUID read after an uncertain response, and refuse-on-ambiguity pattern is sound.

**Recommended order:**
1. The strict-flag change and its tests (runtime change, on this branch, no live calls).
2. The read-only Contact-trigger preflight.
3. The linked-Contact rehearsal, with the changes above.
4. Venue SQL/Blob changes only after you approve the attachment run.
