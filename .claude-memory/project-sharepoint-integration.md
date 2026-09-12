---
name: project-sharepoint-integration
description: "SharePoint document storage architecture — site, folder patterns, virtual entity limitations, multi-library layout, and Graph API service"
metadata: 
  node_type: memory
  type: project
  originSessionId: 17893605-3207-451d-8190-118bbacd8141
  status: active
  scope: sharepoint
  last_verified: 2026-09-09 via docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md controlled-audit section (human permissions / recovery); 2026-06-16 via probe-graph-write-access.mjs (request 1002788) for the app grant
---

## Recall Rule

Read this when: listing, downloading, or writing request documents, reasoning about where attachments live, or reasoning about what *people* can do to these files (delete, prune versions, recover).

Do:
- Use `lib/services/graph-service.js` (Graph API, separate token cache) and `lib/utils/sharepoint-buckets.js` `getRequestSharePointBuckets` to enumerate all plausible libraries.
- Probe `akoya_request` + `RequestArchive1..3` speculatively in parallel and tolerate 404s; walk subfolders with `listFiles(..., { recursive: true })`.
- Use folder pattern `{RequestNumber}_{GUIDNoHyphensUppercase}`.

Do not:
- Use the `sharepointdocument` virtual entity via Web API (does not work) — go through Graph.
- Assume files are in `akoya_request` only; migrated grants often live in an archive library (e.g. 993879 in RequestArchive3).

Ground truth: `lib/services/graph-service.js`, `lib/utils/sharepoint-buckets.js`, `scripts/probe-sharepoint-write.js`, `docs/archive/IT_SECURITY_RESPONSE.md`.

Documents attached to requests are stored in **SharePoint**, not Dynamics.

- **SharePoint site:** `https://appriver3651007194.sharepoint.com/sites/akoyaGO`
- Dynamics links via `sharepointdocumentlocation` entity (filter: `_regardingobjectid_value eq '{GUID}'`)
- Folder pattern: `{RequestNumber}_{GUIDNoHyphensUppercase}` (e.g., `1001289_EEC6F39CE7D4EF118EE96045BD082F70`)
- `sharepointdocument` virtual entity does **NOT** work via Web API
- **`lib/services/graph-service.js`** — Graph API service with SharePoint file listing/download, separate token cache from Dynamics
- IT security response: `docs/archive/IT_SECURITY_RESPONSE.md`

## Permissions

`Sites.Selected` granted with both read AND write roles on the akoyaGO site (write granted 2026-04-15, verified end-to-end 2026-05-01 via `scripts/probe-sharepoint-write.js`). Re-verified 2026-06-16 via `scripts/probe-graph-write-access.mjs` (request 1002788 — upload + delete sentinel in `akoya_request` library succeeded). `Sites.Selected` is the singular Graph permission name — read vs. write is set per-site at authorization time via `POST /sites/{id}/permissions`.

## Multiple Document Libraries

`akoya_request` is the active library (tracked by Dynamics via `sharepointdocumentlocations`), but `RequestArchive1`, `RequestArchive2`, and `RequestArchive3` hold migrated content from a previous grants system. Older grants (e.g. 2023-vintage) often have their full file set in one of the archive libraries.

- Folder naming convention is identical across all libraries — probe speculatively in parallel, tolerate 404s
- **Shared helper:** `lib/utils/sharepoint-buckets.js` `getRequestSharePointBuckets(requestId, requestNumber)` returns all plausible buckets
- Migrated grants frequently keep files in subfolders (`Final Report/`, `Year 1/`, etc.) — `GraphService.listFiles(library, folder, { recursive: true })` walks depth-first; each file carries its actual `folder` path
- **Concrete confirmation:** request 993879 (Carter/UNC-CH) — Project Narrative lives in `RequestArchive3`, NOT `akoya_request`

## Human permissions and deletion recovery (settled 2026-08-13 / 2026-08-20)

Distinct from the app's `Sites.Selected` grant above — this is what *people* can do to these files. Established by administrator attestation (Dragonfly IT), operator observation (Connor), and IT screenshots relayed by the owner, interpreted against Microsoft Learn. Full evidence, classes, and caveats: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` (controlled target-library audit section).

- **Members group = built-in `Edit`.** Grants Delete Items, Delete Versions, and Manage Lists; excludes Manage Permissions. Ordinary editors can delete a document, purge its version history, and reach the Versioning settings page that sets the 500-version limit. Design as if they can.
- **The connected M365 group is Public**, so "Everyone except external users" has site access: effectively any internal user holds Edit. `akoya_request`'s own inheritance is [ASSUMED] from a site-level capture whose List GUID did not match the library.
- **Deletion is recoverable for 93 days, then not.** First-stage bin → second-stage (site-collection) bin, which exists and was seen populated. The 93 days run from the *original* deletion and are shared across both stages; oldest-first quota purge or a manual empty can end it sooner. Only the `dftadmin` account restores from second stage. Microsoft's 14-day backup restores whole site collections, not items — never cite it as a per-file remedy.
- **Purview retention is unknown and accepted-open at low priority.** No regulatory retention obligation applies (owner, 2026-08-13); do not reintroduce compliance framing. It would need an M365 compliance administrator, not the site owner or Dragonfly IT.
- **Diligent, not SharePoint, holds the Board record.** The retained milestone snapshot protects mid-cycle work loss and provenance; the copy-the-bytes decision stands on the remedy argument.
- **Neither the app nor a delegated sign-in can read these permissions.** `Sites.Selected` gets `403` on `/sites/{id}/permissions`; do not re-attempt the tooling — the question goes to IT.
