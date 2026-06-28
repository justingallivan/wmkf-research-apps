# P2 residual: private-blob migration for the generic uploader

**Status:** 🟡 Pilot + file-loader cohort shipped & read-path live-smoked 2026-06-11 — `expense-reporter` (pilot), plus `phase-i-dynamics` + `grant-reporting` via the now-private-aware `lib/utils/file-loader.js` (`lib/utils/uploaded-blob.js`). Live smokes passed (`smoke-private-upload.mjs` for the store; `smoke-private-file-loader.mjs` for the shared `loadFile` chokepoint). **All three consumers (`expense-reporter` + `phase-i-dynamics` + `grant-reporting`) PROMOTED TO PRODUCTION 2026-06-11** (prod token + all three flags set + deployed; grant-reporting prod-verified — live upload → private store, URL 403, extraction ran). The browser-render consumer (reviewer-finder **grant-cycle materials**) + its record-scoped **download proxy** are now **code-complete + Codex-reviewed** (flag-gated `NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS`, default public; **PARKED — not smoked/promoted (low-risk, legacy-only consumer)**) — see `docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md`. Concrete design + what-shipped: `docs/archive/PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md`.
**Origin:** Security audit 2026-05-21, finding P2. Created 2026-05-21 alongside A5 (endpoint consolidation), which partially addressed P2.

## Rollout status (2026-06-11)

- ✅ **`expense-reporter`** (pilot) — code shipped; private upload **flag-gated**
  (`NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB`, default `public`).
  `process-expenses.js` reads via `readUploadedBlobBuffer` (server-side
  `get(pathname,{access:'private'})` for private, `safeFetch` for legacy public).
  Server-read-only, so no proxy needed for this consumer.
  Store `wmkf-uploads-private` + `UPLOADS_BLOB_RW_TOKEN` **provisioned 2026-06-11
  (dev + preview + production)**. **Live smoke PASSED** (`smoke-private-upload.mjs` + a real
  expense-reporter upload→extract run locally against the store: receipts landed
  in the private store, URL returns HTTP 403). **PROMOTED TO PRODUCTION 2026-06-11** —
  `NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB=true` set in Production + deployed
  (`wmkfresearchapps-njdq4gr5y`), so new prod receipts now go to the private store. Shares
  the same prod-verified store/token/read path as grant-reporting; a direct browser
  spot-check is optional.
- ✅ **`lib/utils/file-loader.js` is now private-aware** (2026-06-11) — its `upload`
  branch delegates to `readUploadedBlobBuffer` (private `pathname` read, or `safeFetch`
  for legacy public). So its callers (`grant-reporting/extract`, `phase-i-dynamics`
  summarize + summarize-v2) get private reads just by passing `access`/`pathname` in
  the FileRef. Unit-tested; back-compat (no consumer change required). **Live chokepoint
  smoke PASSED** (2026-06-11) — `scripts/smoke-private-file-loader.mjs` PUTs a real DOCX
  private and reads+extracts it through `loadFile({access:'private',pathname})` against
  the live store (marker text round-trips; blob URL HTTP 403). Covers BOTH file-loader
  consumers, since they share this read path.
- ✅ **`phase-i-dynamics`** — page migrated (2026-06-11): uploader `access` gated by
  `NEXT_PUBLIC_PHASE_I_DYNAMICS_PRIVATE_BLOB` (default `public`); the `fileRef` now
  carries `pathname`+`access`, read server-side via the private-aware file-loader.
  Build/lint/tests green. **Read-path live smoke PASSED** (shared file-loader chokepoint,
  above). **PROMOTED TO PRODUCTION 2026-06-11** — `NEXT_PUBLIC_PHASE_I_DYNAMICS_PRIVATE_BLOB`
  set in Production + deployed (`dpl_Cd6MGvsGvYgcqW8LHPNV4j7Wg5oA`). Rides grant-reporting's
  prod-verified read path (same `file-loader` chokepoint, store, and token); a direct
  browser spot-check is still worthwhile but not required.
- ✅ **`grant-reporting`** — page migrated (2026-06-11): both uploaders (proposal +
  report, one shared `renderDocPicker`) gated by `NEXT_PUBLIC_GRANT_REPORTING_PRIVATE_BLOB`
  (default `public`); both fileRefs carry `pathname`+`access`; `extract.js` passes them
  through to the private-aware file-loader. Build/lint/tests green. **Read-path live smoke
  PASSED** (shared file-loader chokepoint, above). **PROMOTED TO PRODUCTION + PROD-VERIFIED
  2026-06-11** — flag set in Production + deployed (`dpl_Cd6MGvsGvYgcqW8LHPNV4j7Wg5oA`); a
  live prod upload landed in the **private** store (`wvodkxrlwniaujaj.private.blob…`,
  `Content-Disposition: attachment`), the blob URL returned **HTTP 403** unauthenticated,
  and extraction ran (the server-side private read worked in prod). Completes the
  file-loader cohort.
- 🟨 **Browser-render consumer — reviewer-finder grant-cycle materials** (review template +
  additional attachments, formerly public via `proxifyBlobUrl`/`blob-proxy.js`):
  **code-complete + Codex-reviewed 2026-06-11**, flag-gated (`NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS`,
  default public). Ships the record-scoped download proxy `pages/api/reviewer-finder/cycle-material`
  + private-aware `grant-cycles` GET / `generate-emails` / `send-emails` + private uploads in
  `SettingsModal` + a `maintenance-service` data-loss fix. **PARKED — not smoked/promoted** (low-risk, legacy-only consumer; reusable pattern for future Postgres-backed private storage). Full design:
  `docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md`.
- ⏳ Remaining `FileUploaderSimple` consumers below — flip to `access="private"` +
  pathname once their read path is private-aware.

## Problem

`/api/upload-handler` mints Vercel Blob client-upload tokens, and the shared
`shared/components/FileUploaderSimple.js` calls `upload(..., { access: 'public' })`.
Every file uploaded through it lands in a **publicly readable** blob. URLs carry
`addRandomSuffix` (unguessable) but are auth-free once known, and URLs leak via
logs, browser history, referrers, and persisted app/DB state.

`FileUploaderSimple` is used by 15+ document-processing apps, several of which
handle **sensitive grant content** — not "explicitly shared organizational
assets":

- `phase-i-writeup`, `phase-ii-writeup`, `phase-ii-writeup-legacy`
- `batch-phase-i-summaries`, `batch-proposal-summaries`
- `peer-review-summarizer`, `literature-analyzer`, `multi-perspective-evaluator`
- `funding-gap-analyzer`, `expense-reporter`, `grant-reporting`
- `reviewer-finder`, `expertise-finder`, `virtual-review-panel`, `phase-i-dynamics`
- `pages/api/expertise-finder/match.js`

A5 (2026-05-21) consolidated the two generic endpoints onto `upload-handler` and
retired the legacy `/api/upload-file`, but did **not** change the public-blob
posture. That is this residual.

## Target design

1. `upload-handler`'s `onBeforeGenerateToken` mints tokens for **`access:
   'private'`** blobs (and `FileUploaderSimple` stops passing `access: 'public'`).
2. A new authenticated download proxy (e.g. `/api/blob/[...path]`) streams a
   private blob only to a caller who passes `requireAuth` / `requireAppAccess`.
   Ideally record-aware (the blob belongs to a request/app the caller may see).
3. Every consumer that currently stores or renders a raw `blob.url` is updated
   to store the blob pathname and render the proxied URL instead.

## Why it is its own initiative

- Touches 15+ pages plus their result/render paths and any persisted blob URLs.
- `access` is currently chosen client-side; private blobs change the read path
  everywhere a URL is consumed, not just the upload call.
- Needs a decision on proxy granularity (auth-only vs. record-scoped) and on
  back-compat for any already-stored public blob URLs.

## Suggested sequencing

1. Build the download proxy + a private-blob mode behind a flag.
2. Migrate one low-risk app end to end as a proof (e.g. `expense-reporter`).
3. Roll through the remaining consumers; flip the default; remove the flag.
4. Decide handling for pre-existing public blobs (re-host vs. leave to expire).

## Not in scope here

`SettingsModal`'s grant-cycle review templates / attachments are staff-authored
org assets and are lower-risk; they can move with the general migration but are
not the urgent part.
