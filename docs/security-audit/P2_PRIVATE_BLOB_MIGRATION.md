# P2 residual: private-blob migration for the generic uploader

**Status:** 🟡 Pilot shipped 2026-06-11 — `expense-reporter` migrated to private upload + server-side read (`lib/utils/uploaded-blob.js`). Remaining: live upload→read smoke, the browser-facing download proxy, the `file-loader.js` private read, and the other consumers (list below). Concrete design + what-shipped: `docs/security-audit/PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md`.
**Origin:** Security audit 2026-05-21, finding P2. Created 2026-05-21 alongside A5 (endpoint consolidation), which partially addressed P2.

## Rollout status (2026-06-11)

- ✅ **`expense-reporter`** (pilot) — code shipped; private upload **flag-gated**
  (`NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB`, default `public`).
  `process-expenses.js` reads via `readUploadedBlobBuffer` (server-side
  `get(pathname,{access:'private'})` for private, `safeFetch` for legacy public).
  Server-read-only, so no proxy needed for this consumer.
  Store `wmkf-uploads-private` + `UPLOADS_BLOB_RW_TOKEN` **provisioned 2026-06-11
  (dev + preview)**. **Live smoke PASSED** (`smoke-private-upload.mjs` + a real
  expense-reporter upload→extract run locally against the store: receipts landed
  in the private store, URL returns HTTP 403). **Production token + flag + deploy
  still pending.**
- ⏳ **Browser-render consumers** (templates/attachments via `proxifyBlobUrl`,
  `blob-proxy.js`) — need the new authenticated download proxy (record/app-scoped).
- ⏳ **`file-loader.js` consumers** (Grant Reporting, Phase-I writeback, etc.) — switch
  the shared loader's `upload` source from `safeFetch(fileUrl)` to a private
  `pathname` read.
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
