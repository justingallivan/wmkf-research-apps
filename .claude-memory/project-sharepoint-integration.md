---
name: project-sharepoint-integration
description: "SharePoint document storage architecture — site, folder patterns, virtual entity limitations, multi-library layout, and Graph API service"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
---

Documents attached to requests are stored in **SharePoint**, not Dynamics.

- **SharePoint site:** `https://appriver3651007194.sharepoint.com/sites/akoyaGO`
- Dynamics links via `sharepointdocumentlocation` entity (filter: `_regardingobjectid_value eq '{GUID}'`)
- Folder pattern: `{RequestNumber}_{GUIDNoHyphensUppercase}` (e.g., `1001289_EEC6F39CE7D4EF118EE96045BD082F70`)
- `sharepointdocument` virtual entity does **NOT** work via Web API
- **`lib/services/graph-service.js`** — Graph API service with SharePoint file listing/download, separate token cache from Dynamics
- IT security response: `docs/archive/IT_SECURITY_RESPONSE.md`

## Permissions

`Sites.Selected` granted with both read AND write roles on the akoyaGO site (write granted 2026-04-15, verified end-to-end 2026-05-01 via `scripts/probe-sharepoint-write.js`). `Sites.Selected` is the singular Graph permission name — read vs. write is set per-site at authorization time via `POST /sites/{id}/permissions`.

## Multiple Document Libraries

`akoya_request` is the active library (tracked by Dynamics via `sharepointdocumentlocations`), but `RequestArchive1`, `RequestArchive2`, and `RequestArchive3` hold migrated content from a previous grants system. Older grants (e.g. 2023-vintage) often have their full file set in one of the archive libraries.

- Folder naming convention is identical across all libraries — probe speculatively in parallel, tolerate 404s
- **Shared helper:** `lib/utils/sharepoint-buckets.js` `getRequestSharePointBuckets(requestId, requestNumber)` returns all plausible buckets
- Migrated grants frequently keep files in subfolders (`Final Report/`, `Year 1/`, etc.) — `GraphService.listFiles(library, folder, { recursive: true })` walks depth-first; each file carries its actual `folder` path
- **Concrete confirmation:** request 993879 (Carter/UNC-CH) — Project Narrative lives in `RequestArchive3`, NOT `akoya_request`
