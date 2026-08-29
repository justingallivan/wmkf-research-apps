---
name: Dynamics Explorer — multi-library + subfolder document listing (shipped)
description: SharePoint document listing in Dynamics Explorer now searches all archive libraries and recurses into subfolders, via the shared sharepoint-buckets helper
type: project
originSessionId: 855d17dc-8935-4bc6-88a5-cb73f4cb1b2d
status: closed
scope: dynamics
last_verified: unknown via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: listing a request's SharePoint files from any caller, or building a file picker that spans archive libraries / nested subfolders.

Do:
- Import `getRequestSharePointBuckets` from `lib/utils/sharepoint-buckets.js` rather than reinventing bucket discovery. Listing callers may walk independent buckets in parallel; Graph-search callers must preserve the two-wave throttle contract below (tracked folders first, then archive probes serially).
- Carry per-file `library`/`folder`/`subfolder` so download URLs route to the right drive and users can disambiguate (e.g. `Year 1/Report.docx`).

Do not:
- Rebuild this — it shipped (multi-library + recursive subfolder listing in Dynamics Explorer); extend the shared helper instead.
- Assume a single top-level `library`/`folder` on results (replaced by a `libraries[]` per-bucket summary).

Ground truth: `lib/utils/sharepoint-buckets.js`, `pages/api/dynamics-explorer/chat.js`, `GraphService.listFiles`. Shipped feature — verify current behavior in source if extending.

# SHIPPED: Dynamics Explorer multi-library + subfolder document listing

## What changed

`list_documents` and `search_documents` in `pages/api/dynamics-explorer/chat.js` now use the shared `getRequestSharePointBuckets()` helper from `lib/utils/sharepoint-buckets.js`, the same one Grant Reporting uses. Both tools:

- Walk the active `akoya_request` library AND all three `RequestArchive1/2/3` libraries (speculative probes; archive 404s for non-migrated grants are tolerated).
- Recurse into subfolders like `Final Report/`, `Year 1/`, etc. via `GraphService.listFiles(..., { recursive: true })`.
- Carry per-file `library`, `folder`, and `subfolder` so download URLs route to the right drive.
- Drop the top-level `library`/`folder` fields from the tool result (they were always a half-truth) and replace them with a `libraries[]` per-bucket summary array.

`searchDocuments()` searches every bucket of a request-scoped search and merges/dedupes by file id or webUrl — since S468 in **two waves**, not one 4-wide burst: the Dynamics-tracked folder(s) in parallel, then the archive probes one at a time, stopping at the first transient failure (archives are skipped entirely if wave 1 throttled). Recall is unchanged **when every scope executes**; a search degraded by a transient failure skips the remaining archive probes, so archive-only matches are unavailable for that search — the result carries `incomplete: true` and names the skipped scopes. Unscoped searches are unchanged. Same-round `search_documents` calls are serialized per request (`toolContext.searchQueue`) so the breaker cannot be bypassed by parallel tool calls; `retryAfterMs` flows from GraphService through scope results into the breaker and the retry guidance, and GraphService keeps a per-process search cooldown after a long Retry-After.

**S468 (2026-08-29) — throttle handling.** `GraphService.searchFiles` retries 429/502/503/504 (3 attempts) because Graph `/search/query` is tenant-throttled and concurrent callers can burst. A tenant `Retry-After` is honoured as sent, never shortened: if it exceeds the 10 s retry budget the call is NOT retried and the error carries `retryAfterMs`; the no-header fallback is exponential with ±50 % jitter so independent callers do not retry as one burst. `searchDocuments()` no longer reports a FAILED scope as "No documents found": all scopes failed → `error` + `incomplete: true`; partial → hits + `warning` + `incomplete: true`. Because tool-result text is untrusted content to the model (A7), the wording is factual only; the control is a **per-request circuit breaker** (`toolContext.searchThrottle` in `chat.js`): after one transient scope failure, later `search_documents` calls in that request short-circuit without touching Graph. The old false negative made the model re-run the search and produced the 86-row 429 storm on the Operational Events card (2026-08-27). Tests: `tests/unit/graph-service-search-retry.test.js`, `tests/unit/dynamics-explorer-search-documents.test.js`.

## Verified

- `993879` (Carter/UNC-CH, multi-library): returns 63 files across `akoya_request` (10) + `RequestArchive3` (53). Used to return only 10.
- `993347` (Anslyn/UT Austin, subfolder): surfaces nested files with `subfolder: "Final Report"`. Used to return the folder name itself as a fake file.
- `1001289` (happy path, no archives, no subfolders): returns 4 files from `akoya_request`, archive probes filtered out of the `libraries[]` summary so there's no noise.
- Download routing for nested paths verified via direct `download-document` curl — `validatePath` already permits interior `/` (only blocks leading `/` and `..`).

## How to apply

If you ever need to list or search a request's SharePoint files from a new caller, import `getRequestSharePointBuckets` from `lib/utils/sharepoint-buckets.js` rather than reinventing bucket discovery. Parallel bucket reads are appropriate for ordinary listings; Graph search is tenant-throttled, so use the two-wave tracked-then-serial-archive contract above. The frontend `DocumentLinks` component in `pages/dynamics-explorer.js` reads `file.subfolder` and shows the location next to the file name; if you build a similar picker elsewhere, do the same so users can disambiguate `Year 1/Report.docx` from `Year 2/Report.docx`.
