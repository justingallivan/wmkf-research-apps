# Remaining roster checks — Opus 5.5 build review

## Current disposition

[VERIFIED via the exact source review below] Opus returned READY for the strict
attachment resolver correction and READY with two additions for the linked-Contact
plan. The coordinating session accepted both: repeat the complete unclaimed-link
census immediately before save, and investigate a changed Contact ETag through
modified-by/time evidence without repairing or mutating the Contact. These additions
are incorporated into the [remaining flow plan](REMAINING_FLOW_REHEARSAL_2026-11-11.md).
The review does not establish a completed live linked-Contact or attachment run.
Shared-storage authorization remains a separate prerequisite.

Source transcript: `outputs/roster-remaining-build-opus.md`, preserved verbatim below.

## Archived transcript

Both are **READY**. The strict source fix has no material regression and no partial-success problem. The linked-Contact plan is ready with two small additions. I couldn't write the plan file because Write is disabled in this session, so the full review is here.

## A. Strict source fix: READY

- **Ordering:** at `lib/services/consultant-feedback-attachment-service.js:278-288` the bucket lookup passes both flags. Any resolver error is turned into `folder_unavailable` 503 before `ensureFolderPath` (line 303) or `uploadFile` (line 316) runs. [VERIFIED via source]
- **Truncation detection is real:**
  - `lib/services/dynamics/read-ops.js:78,93-99` asks Dataverse for a total count and sets `hasMore` when there is a next page.
  - `assertCompleteLocationResult` (`lib/utils/sharepoint-buckets.js:34-40`) rejects `hasMore`, more than 10 rows, or a total count above the rows returned.
  - So a full page of 10 with more rows behind it is caught. [VERIFIED]
- **No partial-success regression:**
  - The replay path (lines 240-255) never calls the resolver.
  - If a stale upload is discarded and cleared (lines 267-277) and the lookup then returns 503, the staging slot is left clean and the retry uploads fresh.
  - It exits the same way the existing `scan_unavailable` 503s do.
- **No other writers changed:** every other caller still uses the default flags.
- **Tests:** `tests/unit/consultant-feedback-attachment-service.test.js:415-426` checks the exact arguments. It also runs the actual resolver under adapter stubs for a missing parent, truncated locations and truncated parents, and asserts no Graph call happens.
- **Not blocking:**
  1. The bare `catch {}` at line 284 throws away the reason, so operators can't tell "truncated" from "unresolved parent". Logging `error.message` would fix that.
  2. "Try again shortly" is misleading when the parent is missing for good. Copy only.
  3. A request whose parent library can't be resolved used to fall back to `akoya_request` and now refuses. That is the intended fail-closed change.
- **Couldn't review:** `tests/integration/roster-matching-persistence.pg.test.js` is the modified matching test (`roster-matching-consumers.pg.test.js` doesn't exist). I can't see its diff without git. Its current content is controlled lead-eligibility and persistence tests with a mocked model, and it doesn't touch the attachment path.

## B. Linked-Contact plan: READY with two additions

**Linking does not write the Contact.** [VERIFIED via source trace]
- **Search:** `shared/components/expertise-finder/RosterContactField.js` calls `/api/expertise-finder/contact-search`, which only accepts GET. That uses `searchDirectoryByName` and `getByIds`, which are both plain reads.
- **Save:**
  - The PATCH goes to `/api/expertise-finder/roster`, then `saveRoster`, then `validateLinks`.
  - `validateLinks` only reads `contactid,statecode`, and only when the link changes (`roster-service.js:16`).
  - `encode` writes the GUID as plain text into `wmkf_contactguid` on the roster profile, using an ETag check and the acting user (`roster-contract.cjs:27`, `expertise-profile.js:29`).
  - There is no lookup binding to the Contact, so no Contact update or association fires and the BusinessCentralSync plugins never run.
- **Nothing else is called:** the editor page only calls the roster and contact-search endpoints.
- **No numeric binding writes:** the browser venue requires GUID-only state (`roster-lifecycle.cjs:110`), so saves don't touch the numeric roster tables.
- **Manual email:** changing the email while linked is refused at `roster-contract.cjs:24`.

**Additions:**
1. **Re-check "unclaimed" right before the link save.** In rehearsal mode nothing in the source stops two profiles linking the same Contact. `saveRoster` has no check across profiles, and the Postgres conflict check is skipped. So the read across all 46 profiles must run immediately before the save, not only at preflight.
2. **Plan for an unrelated ETag change.** Other sandbox users or processes can change that Contact. If the ETag differs before and after, read who modified it and when before calling it a failure, and never "repair" the Contact.

The rest stands as written:
- link, save and reload;
- check manual email is disabled;
- activate, then deactivate (deactivation forces lead-PD eligibility back to false, which matches the canary's restored values);
- unlink back to empty;
- confirm the other 45 profiles are unchanged by comparing ETags;
- confirm no emails, Site Visit, provider, Blob or Graph calls.

Dropping the duplicate, numeric and shared-briefing proofs is right. User lifecycle and inactive-Contact cases stay controlled-test only.

**For verification:** nothing new needs to run for the source fix beyond your 39 passing tests. For the live proof, the before/after reads are the acceptance check: the Contact's ETag and values, all 46 profile ETags, and the canary's business values.
