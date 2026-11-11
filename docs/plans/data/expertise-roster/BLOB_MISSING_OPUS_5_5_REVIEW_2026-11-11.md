# Portal staged Blob missing-object handling — Opus 5.5 review

## Current evidence boundary

[VERIFIED via the exact transcript below] Opus returned READY for the reviewed
source scope. The reviewer did not run the tests. The coordinating session reports
commit `27fd99574`, 245 passing tests across 16 suites
(`outputs/roster-post-blob-pdf-focused-tests.log`), four relevant gate/self-test pairs
passing and a credential-free build exiting zero (`outputs/roster-pdf-bytes-build.log`).
These are separate post-review verification results. The transcript describes its
reviewed snapshot, including its explicitly limited scope and observations.

This review alone does not establish live outcomes. Subsequent batch success and
final cleanup, with the unsuccessful single proof still explicit, are recorded in
[final results](LIVE_ATTACHMENT_MATCHING_RESULTS_2026-11-11.md).

Source transcript: `outputs/roster-blob-missing-opus.md`, preserved verbatim below.

## Archived transcript

**READY.** No blockers; the repair is correct and as small as it can be.

**What I checked (read-only):**
- **The SDK class, @vercel/blob 2.8.0:** Neither `BlobError` (`chunk-YYMLUMXS.js:219-222`) nor `BlobNotFoundError` (`:591-595`) sets a `name` or a `status`. So the old helper could never recognise one. `BlobNotFoundError` is only created for API code `not_found` (`:691-692`). The missing-store error, `BlobStoreNotFoundError`, is a separate class, so the `instanceof` check won't mistake a missing store for a missing blob.
- **Where the error is thrown:** `head` and `del` throw `BlobNotFoundError` for a missing blob (`dist/index.js:41-87`). Both catch blocks now use the shared helper: `portal-upload-staging.js:410-414` and `:960-968`. A plain outage error still gets 503, goes into `failedBlobCleanupIds`, and is kept out of the prune.
- **The `typeof BlobNotFoundError === 'function'` guard is needed, so keep it:** About 34 other test files mock `@vercel/blob` without `BlobNotFoundError`, including `roster-browser-staging.pg` and `site-visit-materials-background-jobs.pg`. In those files the import is `undefined`, and the guard stops `instanceof` from throwing a TypeError. They fall back to the old name/status behaviour.
- **Tests:** Both files get the real SDK class through `requireActual`. The 503 outage case and the failed-row prune exclusion are still covered (`portal-upload-staging.test.js:236-247`, `portal-upload-staging-cleanup.test.js:543-550`).

**Not blockers, and outside this change's scope:**
1. **A missing blob on `get` still returns 503.** In 2.8.0, `get()` returns `null` on a 404 instead of throwing (`dist/index.js:177-179`). So in `loadClaimedPortalFile`, the `result?.statusCode === 404` check (`:274`) never matches, and a missing blob hits `!result` at `:277`, which returns 503 `staged_upload_unavailable`. That also means the test that makes `get` throw `BlobNotFoundError` (`portal-upload-staging.test.js:238`) doesn't match what the SDK actually does. This was already the behaviour before the repair, not something it broke. If you want it fixed later, it's one line, `if (result === null || result?.statusCode === 404)` → 409, plus a test where `get` resolves to `null`.
2. **Style nit:** the new cleanup test at `portal-upload-staging-cleanup.test.js:543-550` is written in a dense one-line style, unlike the rest of that file.

I didn't run anything. When you rebuild, run the 73 focused tests again, and optionally the two `.pg` integration tests to confirm the guard handles their partial mocks.
