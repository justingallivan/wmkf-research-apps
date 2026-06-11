# Phase 1 design — private-blob upload + authenticated download proxy

**Status:** Design / pre-implementation. For Codex review before coding.
**Source finding:** `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P2 — "Generic uploader still creates public Blob artifacts for sensitive document workflows."
**Builds on:** `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md` (origin/scoping — this doc is the concrete implementation design + pilot slice).
**Remediation tracker:** `docs/security-audit/SECURITY_AUDIT_REMEDIATION_PLAN_2026-06-11.md` Phase 1.

## Problem (verified against source)

- `shared/components/FileUploaderSimple.js:50`-`52` calls
  `upload(file.name, file, { access: 'public', handleUploadUrl: '/api/upload-handler' })`.
- `pages/api/upload-handler.js` requires auth (`requireAuth`, `:11`) and validates
  content-type/size in `onBeforeGenerateToken` (`:18`-`37`), but mints a **public**
  blob token. Public blob URLs are auth-free once known and leak via logs, history,
  referrers, and persisted app/DB state.
- The uploader returns `{ url: blob.url, filename, size, originalFile }` to
  `onFilesUploaded` (`FileUploaderSimple.js:63`-`68`). Consumers then hand
  `blob.url` to their processing API, which fetches the **public URL** server-side.
  So the read path — not just the upload — must change for every consumer.
- `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md:14`-`24` lists the
  document-processing consumers (15+, several sensitive grant workflows).

## Critical design constraints (from existing patterns)

1. **Do NOT extend `pages/api/blob-proxy.js`.** Its own header (`:9`-`18`) restricts
   it to **shared org assets** (review-email templates / cycle attachments) with the
   host allowlist as the only boundary, and explicitly says *"Do NOT extend this
   proxy to serve user-owned blobs."* It points to the record-aware pattern in
   `pages/api/review-manager/download-review.js`. The new private-document proxy is a
   **separate** route following that record-aware shape, not a widening of blob-proxy.
2. **Record-aware where a record exists; auth-gated otherwise.** Many generic-uploader
   consumers are *stateless* (upload → process → render, no persisted owning record),
   so blanket record-scoping is not universally possible in v1. `download-review.js`
   shows the record-aware shape (resolve id → record → `requireAppAccess` → stream via
   server credentials). v1 proxy = `requireAuth`/`requireAppAccess` gate keyed by blob
   pathname; record-scoping is layered in for consumers that have a request/app record
   (e.g. `phase-i-dynamics` has the request GUID). The auth-only-vs-record-scoped
   decision is called out as open in `P2_PRIVATE_BLOB_MIGRATION.md:44` — this design
   resolves it as "auth-gated v1, record-scoped where cheap, never weaker than
   `requireAppAccess`."
3. **Force safe response headers** (ties to Phase 7): the proxy sets
   `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` so a
   document can't render inline under the app origin (same lesson as the
   `blob-proxy.js` Phase 7 finding).

## ⚠️ Must verify FIRST (external-platform claim — do not assume)

The current `@vercel/blob` private-access API for **client uploads** must be
confirmed against the installed SDK version before coding — do not assume the shape
from memory (per the "verify external platform claims" rule). Specifically:
- Does `onBeforeGenerateToken` in `handleUpload` accept an `access: 'private'` (or
  equivalent) so the minted client-upload token produces a private blob?
- What is the server-side **read** API for a private blob (download/`head` by
  pathname using `BLOB_READ_WRITE_TOKEN` / the intake token), since a private blob
  has no auth-free public URL?
- Does the client `upload()` return a stable `pathname` we can persist and resolve?

Confirm via the Vercel Blob docs + the installed `@vercel/blob` version (and a
throwaway probe upload in a dev project if needed). If client-upload private mode is
not supported in the installed version, fall back design: route the bytes through a
server upload (`put(..., { access:'private' })`) instead of client `upload()`, at the
cost of the 50 MB body passing through the function — call this out as a branch.

## Target design

1. **Upload (private mode behind a flag/prop).**
   - `upload-handler`'s `onBeforeGenerateToken` mints **private** tokens when private
     mode is requested (keep public as the default until the pilot proves out).
   - `FileUploaderSimple` gains a prop (e.g. `access="private"` / `privateBlob`)
     instead of hard-coding `access: 'public'`; it returns the blob **`pathname`** (in
     addition to / instead of `url`) so consumers persist a stable, resolvable
     reference, not a public URL.
2. **Authenticated download proxy** — new route, e.g. `pages/api/blob/[...path].js`
   or `pages/api/private-blob/download.js`:
   - `requireAuth` minimum; `requireAppAccess(req,res,<appKey>)` where the consumer is
     app-scoped.
   - Resolve the requested pathname, read the private blob **server-side** via the SDK
     with server credentials (never expose a public URL), stream the bytes.
   - Headers: `Content-Type` (from stored metadata or a safe default),
     `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
     `Cache-Control: private, no-store`.
   - Record-scope check where the consumer has an owning record.
3. **Consumer read-path update.** Each consumer that today sends `blob.url` to its
   processing API switches to the pathname + server-side private read (or the proxy).
   The pilot does this for one app; the rest follow in later phases.

## Pilot slice (the deliverable for the first implementation session)

Per `P2_PRIVATE_BLOB_MIGRATION.md:50`, migrate **one** low-risk consumer end-to-end
behind the flag — candidate `expense-reporter` (low sensitivity, self-contained).
Confirm at implementation time whether a lower-risk consumer is preferable.

Pilot scope:
- private upload token minted for the pilot's uploads;
- pilot stores/passes the blob **pathname**;
- pilot's processing path reads via the authenticated proxy / server-side private read;
- legacy public-URL reads still work (back-compat) so existing saved URLs don't break;
- new route added to `docs/API_ROUTE_SECURITY_MATRIX.md`; `npm run check:api-routes`
  (+ self-test) green.

## Back-compat

Existing persisted **public** blob URLs must keep working during migration: the read
path accepts a legacy public URL OR a private pathname. Decide handling for
pre-existing public blobs (re-host vs. leave to expire) as a later step
(`P2_PRIVATE_BLOB_MIGRATION.md:52`) — not in the pilot.

## Files touched (pilot)

- `pages/api/upload-handler.js` — private-token branch in `onBeforeGenerateToken`.
- `shared/components/FileUploaderSimple.js` — `access` prop; return `pathname`.
- New: `pages/api/blob/[...path].js` (or similar) — authenticated download proxy.
- Pilot page + its processing API route (e.g. `pages/expense-reporter.js` + the
  expense-processing API) — store/pass pathname; read via proxy.
- `docs/API_ROUTE_SECURITY_MATRIX.md` — new proxy route row.
- Possibly `docs/AI_DATA_FLOW_MATRIX.md` / atlas if a blob reference is persisted.

## Tests / verification

- New route tests: proxy rejects unauthenticated requests; rejects a caller without
  the relevant app/record scope; serves the blob to an authorized caller with
  `attachment` + `nosniff` headers.
- Upload-token test: private mode returns private-mode metadata; public default
  unchanged.
- Back-compat test: pilot consumer still processes a legacy public URL.
- Pilot browser smoke: upload → process → re-render/download via proxy (no raw
  `*.public.blob.vercel-storage.com` URL in the rendered DOM / network for private
  uploads).
- `rg -n "access: 'public'|upload-handler|FileUploaderSimple" pages lib shared docs`
  to track remaining public consumers; `npm run check:api-routes && npm run check:api-routes:self-test`.

## Stop conditions (from remediation plan)

Stop and re-plan if the migration appears to require changing **all** consumers at
once, or if private client-upload is unsupported and the server-upload fallback's
50 MB-through-function cost is unacceptable for the pilot app.

## Not in scope

`SettingsModal` grant-cycle review templates/attachments (staff-authored org assets,
lower risk — `P2_PRIVATE_BLOB_MIGRATION.md:54`-`58`); the full 15+ consumer rollout
(later phases); pre-existing public-blob re-hosting.
