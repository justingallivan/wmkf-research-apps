---
name: Dynamics Explorer — multi-library + subfolder document listing (shipped)
description: SharePoint document listing in Dynamics Explorer now searches all archive libraries and recurses into subfolders, via the shared sharepoint-buckets helper
type: project
originSessionId: 855d17dc-8935-4bc6-88a5-cb73f4cb1b2d
---
# SHIPPED: Dynamics Explorer multi-library + subfolder document listing

## What changed

`list_documents` and `search_documents` in `pages/api/dynamics-explorer/chat.js` now use the shared `getRequestSharePointBuckets()` helper from `lib/utils/sharepoint-buckets.js`, the same one Grant Reporting uses. Both tools:

- Walk the active `akoya_request` library AND all three `RequestArchive1/2/3` libraries (speculative probes; archive 404s for non-migrated grants are tolerated).
- Recurse into subfolders like `Final Report/`, `Year 1/`, etc. via `GraphService.listFiles(..., { recursive: true })`.
- Carry per-file `library`, `folder`, and `subfolder` so download URLs route to the right drive.
- Drop the top-level `library`/`folder` fields from the tool result (they were always a half-truth) and replace them with a `libraries[]` per-bucket summary array.

`searchDocuments()` fans out 4× per request-scoped search (one parallel KQL call per bucket) and merges/dedupes by file id or webUrl. Unscoped searches are unchanged.

## Verified

- `993879` (Carter/UNC-CH, multi-library): returns 63 files across `akoya_request` (10) + `RequestArchive3` (53). Used to return only 10.
- `993347` (Anslyn/UT Austin, subfolder): surfaces nested files with `subfolder: "Final Report"`. Used to return the folder name itself as a fake file.
- `1001289` (happy path, no archives, no subfolders): returns 4 files from `akoya_request`, archive probes filtered out of the `libraries[]` summary so there's no noise.
- Download routing for nested paths verified via direct `download-document` curl — `validatePath` already permits interior `/` (only blocks leading `/` and `..`).

## How to apply

If you ever need to list a request's SharePoint files from a new caller, import `getRequestSharePointBuckets` from `lib/utils/sharepoint-buckets.js` and walk the buckets in parallel — don't reinvent the bucket discovery. The frontend `DocumentLinks` component in `pages/dynamics-explorer.js` reads `file.subfolder` and shows the location next to the file name; if you build a similar picker elsewhere, do the same so users can disambiguate `Year 1/Report.docx` from `Year 2/Report.docx`.
