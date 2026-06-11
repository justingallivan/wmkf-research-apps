# Phase 1 design — private-blob upload + authenticated download proxy

**Status:** ✅ PILOT IMPLEMENTED 2026-06-11 (expense-reporter). SDK verified, design decisions resolved, pilot shipped server-read-only. Reviewed by Codex (REVISE — folded). **Remaining (later phases):** the browser-facing download proxy + `file-loader.js` private read + the other ~14 consumers. See "Implementation notes" at the end.

> ✅ **Live smoke PASSED 2026-06-11; production promotion pending.** Private blobs use a **dedicated private store** (`wmkf-uploads-private`, `store_WvoDkxrlWniAuJAj`, iad1) with its own `UPLOADS_BLOB_RW_TOKEN` — NOT the public `BLOB_READ_WRITE_TOKEN` store. **Verified end-to-end** (run locally against the real store, flag on): `scripts/smoke-private-upload.mjs` passed; a live expense-reporter receipt upload → extraction worked; the receipts landed in the **private** store; and the receipt URL returns **HTTP 403** unauthenticated. **Remaining:** add `UPLOADS_BLOB_RW_TOKEN` + `NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB=true` to **production** and `vercel deploy --prod`. (`UPLOADS_BLOB_RW_TOKEN` is set in dev + preview; where unset the code fails closed — upload-handler 503, read throws.)
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

## ⚠️ SDK reality (corrected by Codex against installed `@vercel/blob` types)

Codex checked the installed SDK types (`@vercel/blob/dist/client.d.ts`). Findings:
- ✅ Client `upload()` **does** accept `access: 'private'` and returns a stable
  `pathname` we can persist/resolve.
- ✅ Server-side private **read** by pathname is supported (`get()` with the
  RW/intake token) — no auth-free public URL.
- ❌ **The original design was wrong:** `onBeforeGenerateToken`'s return options do
  **not** include `access` (`client.d.ts:188,198,298`). Private mode is selected at
  the **client `upload({ access: 'private' })`** call, not minted by
  `onBeforeGenerateToken`. `upload-handler` still validates content-type/size and
  authn, but it is *not* where private access is configured.

**Remaining unknown to confirm before coding:** whether `handleUpload` /
`onBeforeGenerateToken` can **server-enforce or override** the client-requested
access mode (so a client can't silently request `public`). The callback return type
excludes `access`, so server-side enforcement may require validating the requested
access another way (e.g. inspecting `clientPayload`) or accepting that access is
client-asserted and compensating in the read path. Resolve via a throwaway dev
probe. If server enforcement is impossible, the fallback is a **server upload**
(`put(..., { access:'private' })`) routing bytes through the function (50 MB
through-function cost) — call this out as a branch for sensitive consumers.

## Target design

1. **Upload (private mode behind a flag/prop).**
   - `FileUploaderSimple` gains a prop (e.g. `access="private"` / `privateBlob`)
     instead of hard-coding `access: 'public'`, and passes `access: 'private'` to the
     **client `upload()`** call (this — not `onBeforeGenerateToken` — is where access
     is selected; see SDK reality above). It returns the blob **`pathname`** (in
     addition to / instead of `url`) so consumers persist a stable, resolvable
     reference, not a public URL.
   - `upload-handler` keeps its authn + content-type/size validation; investigate
     whether it can server-enforce the requested access mode (open item above). Keep
     public as the default until the pilot proves out.
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

- `shared/components/FileUploaderSimple.js` — `access` prop; pass `access:'private'`
  to `upload()`; return `pathname`.
- `pages/api/upload-handler.js` — keep validation; investigate server-enforcing the
  requested access mode (not token-minting `access`).
- **`lib/utils/file-loader.js` (Codex GAP):** this shared loader currently accepts a
  `fileUrl` and `fetch`es it directly (`:5`,`:6`,`:47`,`:49`,`:51`). It is very likely
  **the** read chokepoint — make it resolve a private `pathname` via server-side
  `get()` so every consumer that loads through it gets private reads without
  per-caller edits. Confirm which pilot/consumers route through it.
- New: `pages/api/blob/[...path].js` (or similar) — authenticated download proxy
  (for browser-facing render/download paths, distinct from server-side `file-loader`
  reads).
- Pilot page + its processing API route (e.g. `pages/expense-reporter.js` + the
  expense-processing API) — store/pass pathname; read via `file-loader`/proxy.
- `docs/API_ROUTE_SECURITY_MATRIX.md` — new proxy route row.
- Possibly `docs/AI_DATA_FLOW_MATRIX.md` / atlas if a blob reference is persisted.

## Codex review (2026-06-11) — verdict REVISE, folded

- [OVERSTATED→fixed] `onBeforeGenerateToken` does **not** mint `access`; private mode
  is the client `upload({access:'private'})` call. Corrected in SDK-reality + Target
  design. Installed SDK types confirm `upload()` private mode, `pathname` return, and
  server private read by pathname.
- [GAP→added] `lib/utils/file-loader.js` (`fetch`es `fileUrl` directly) added to
  scope as the likely read chokepoint — pathname-only private blobs break it
  otherwise.
- [RISK→open decision] **Ownership/authorization model is undefined.** Auth-only
  pathname proxying is a *bearer-pathname* model — there is no persisted
  pathname→user/app/record mapping today (the token payload records only the
  uploader email, inside the token, not persisted; `upload-handler.js:33`-`35`).
  Before the proxy ships, decide: (a) persist a `{pathname → app/record/uploader}`
  row at upload time and enforce it on read, or (b) accept auth-gated-only for v1
  with record-scoping where a record exists. **Recommendation:** at minimum persist
  app + uploader at upload time so the proxy can enforce `requireAppAccess` + owner,
  not just "any authenticated user."
- [GAP→noted] `X-Content-Type-Options: nosniff` must be **pinned by a test on the new
  route** — the cited `download-review.js` pattern does not set it
  (`download-review.js:77`-`83`), so it won't be inherited.

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

---

## Implementation notes (2026-06-11) — what actually shipped

The sections above are the **full-initiative** design (private upload + download
proxy + `file-loader` + ownership + the ~15 consumers). The **expense-reporter
pilot** that shipped is a narrower, lower-risk slice — the earlier "Files touched
(pilot)" / proxy / `file-loader` items are **deferred to later consumers**, not part
of this pilot. Authoritative record of the shipped change:

**SDK verified (`@vercel/blob@2.3.0`, step 1 done):** client `upload()` accepts
`access:'public'|'private'` and returns `pathname`; server `get(pathname, {access:'private'})`
reads private blobs (`{stream,headers,blob}`) with `BLOB_READ_WRITE_TOKEN`.
`onBeforeGenerateToken` **cannot** set/override `access` (its return `Pick` excludes
it) — access is client-asserted. Acceptable under the authorized-staff / code-level
threat model: our client sets `private`, and the real boundary is the read path (no
auth-free URL + the consumer route's existing `requireAppAccess`).

**Why the pilot needs no proxy / no `file-loader` change:** `expense-reporter` reads
its uploads **only server-side** — `process-expenses.js` fetched `file.url` to feed
Claude (image vision + PDF text); there is no browser-rendered blob. So the pilot
swaps that server read for a private read. The browser-facing download proxy and the
`file-loader.js` private read remain required for **later** consumers that render or
text-extract blobs (e.g. Grant Reporting / Phase-I via `file-loader`; template
attachments via `proxifyBlobUrl`).

**Ownership model (resolved):** app-scoped staff-shared, mirroring `download-review.js`
— the consumer route (`process-expenses`) gates reads with
`requireAppAccess('expense-reporter')`, and the private blob has no public URL. Any
`expense-reporter` user can read any receipt by `pathname` (documented inline at
`process-expenses.js`); this is a strict improvement over the prior public-blob
posture (no auth at all). Per-uploader isolation (prefix pathname with profile id +
verify) is noted inline as the future tightening if receipt policy requires it. No
new `{pathname→owner}` table for the pilot.

**Dedicated private store (Codex BUG fix):** private blobs go to a **separate**
`wmkf-uploads-private` store via `UPLOADS_BLOB_RW_TOKEN`, never the public
`BLOB_READ_WRITE_TOKEN` store. `upload-handler` picks the private token when the
client signals `clientPayload:{access:'private'}`, and `readUploadedBlobBuffer` reads
with it; both **fail closed** (503 / throw) if the token is unset. Store + token are
**not yet provisioned** — see `docs/CREDENTIALS_RUNBOOK.md`.

**Shipped files:**
- `lib/utils/uploaded-blob.js` (new) — `readUploadedBlobBuffer({access,pathname,url})`:
  private → lazy-`import('@vercel/blob')` `get(pathname,{access:'private',token:UPLOADS_BLOB_RW_TOKEN})`
  (fail-closed if token unset); public/legacy → `safeFetch(url)`. The shared
  private-read chokepoint future consumers reuse. `@vercel/blob` is lazy-imported so
  public-only consumers/tests don't load the SDK.
- `pages/api/upload-handler.js` — reads `clientPayload.access`; for private uploads
  mints the client token against the private store (`UPLOADS_BLOB_RW_TOKEN`) and
  returns 503 if it's unset. Public uploads unchanged (default token).
- `shared/components/FileUploaderSimple.js` — new `access='public'` prop (passed to
  `upload()` + sent via `clientPayload:{access}`); descriptor now returns `pathname` +
  `access`. (Codex confirmed the added descriptor keys don't break other consumers.)
- `pages/expense-reporter.js` — uploader `access` gated behind
  `NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB` (default `'public'`), so production is
  unaffected until the env flag is flipped after a live smoke. The read path handles
  both modes, so the flag only governs new uploads.
- `pages/api/process-expenses.js` — both reads now go through `readUploadedBlobBuffer`
  (was `safeFetch(file.url)`); back-compat: a legacy/public ref (no `access`) still
  reads via `safeFetch`.
- `pages/api/process-expenses.js` — both reads now go through `readUploadedBlobBuffer`
  (was `safeFetch(file.url)`); back-compat: a legacy/public ref (no `access`) still
  reads via `safeFetch`. Staff-shared access scope documented inline.
- Tests: `tests/unit/utils/uploaded-blob.test.js` (incl. token pass-through +
  fail-closed-when-token-unset, back-compat, error paths); the A7 `process-expenses`
  integration test still passes (public refs unaffected).

**Verified:** helper + A7 tests green; `npm run build` + `eslint` clean. **NOT
verified:** a live private upload→read against the Vercel store (see status banner).

No new API route was added, so `API_ROUTE_SECURITY_MATRIX` is unchanged.

### Codex post-impl review (folded 2026-06-11) — verdict was REVISE

- **[BUG] dedicated private store/token** → fixed: `UPLOADS_BLOB_RW_TOKEN` +
  `wmkf-uploads-private` store; upload-handler routes private uploads there and reads use
  it; both fail closed if unset; documented in `CREDENTIALS_RUNBOOK.md`.
- **[RISK] known-pathname cross-user read** → resolved by explicitly documenting the
  staff-shared, app-scoped model inline in `process-expenses.js` (Codex-offered
  option), with per-uploader binding noted as the future tightening.
- **[RISK] client-asserted access** → accepted under the authorized-staff threat
  model; the dedicated-store routing + fail-closed reads bound the blast radius
  (a non-private upload simply isn't readable as private).
- **[GAP] tests** → added token pass-through + fail-closed unit cases. A full
  `process-expenses` route-level private test (success + misconfig + all-files-fail)
  remains a follow-up; the helper + route inline behavior cover the core paths.
- **[NIT] back-compat / stream buffering** → Codex confirmed no break and that the
  stream→buffer read matches the SDK shape; no change needed.
