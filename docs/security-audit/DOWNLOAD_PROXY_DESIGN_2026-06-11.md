# Phase 1 — authenticated private-blob download proxy + cycle-materials migration

**Status:** 🟧 DESIGN (2026-06-11). No code yet. Builds on the completed file-loader
cohort (`PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md`). Pending Codex design review.

## Why this, why now

The three server-read consumers (`expense-reporter`, `phase-i-dynamics`,
`grant-reporting`) are private + prod-promoted. The remaining ~12
`FileUploaderSimple` consumers appear **server-read-only** (2026-06-11 — a grep
heuristic for browser-render patterns — `window.open`/`<img>`/`<iframe>`/`href={…url}`/
`download=` — over each page surfaced none against an uploaded blob; the one `<a href>`
hit, in `multi-perspective-evaluator`, is an external *publication* link, not a blob).
Re-confirm per-page before migrating each, but on current evidence they take the proven
`readUploadedBlobBuffer` pattern and need **no proxy**.

The only **browser-render** blob consumer is the reviewer-finder **grant-cycle
materials** — the review-email **template** + **additional attachments** — surfaced
via `proxifyBlobUrl` → `blob-proxy.js` (the org-asset proxy). These are staff-authored
org assets (lower-risk), but they currently live in the **public** Blob store. This
work moves them to the **private** store behind a new **record-scoped** download
proxy, which (a) closes their public-URL posture and (b) gives the proxy a real,
record-scoped first consumer — resolving the design's open ownership question
(`PHASE_1_PRIVATE_BLOB_DESIGN` Codex review, RISK→open).

## Current flow (verified against source 2026-06-11)

Cycle materials have **four legs**:

1. **Upload** — `shared/components/SettingsModal.js` + `shared/components/EmailGeneratorModal.js`
   use `FileUploaderSimple` (currently default `access: 'public'`); the returned
   `url` is saved onto the cycle.
2. **Storage** — Dataverse `wmkf_appgrantcycle` (`lib/services/grant-cycles-dataverse.js`):
   - `wmkf_reviewtemplateurl` ← `reviewTemplateBlobUrl` (public URL today)
   - `wmkf_reviewtemplatefilename` ← `reviewTemplateFilename`
   - `wmkf_additionalattachments` ← JSON array of `{ blobUrl, filename, ... }`
3. **Browser render/download** — `pages/api/reviewer-finder/grant-cycles.js` GET wraps
   every URL with `proxifyBlobUrl` (→ `/api/blob-proxy`, public-store host allowlist);
   the modals render those as download links.
4. **Server-read for email attachment** — `pages/api/reviewer-finder/generate-emails.js`
   and `pages/api/review-manager/send-emails.js` `safeFetch` the URLs to attach the
   template/attachments to outgoing reviewer emails (`fetchAttachment`, SSRF host
   allowlist).

## Target design

### A. New record-scoped private download proxy

`GET /pages/api/reviewer-finder/cycle-material.js?cycleId=<guid>&pathname=<blob-pathname>`
(co-located under the owning app, NOT a widening of `blob-proxy.js`; follows the
`download-review.js` record-aware shape).

1. `requireAppAccess(req, res, 'reviewer-finder', 'reviewers')` — never weaker.
2. Resolve `cycleId` → cycle (Dataverse). **Record-scope check:** the requested
   `pathname` MUST equal the cycle's stored review-template pathname OR one of its
   stored attachment pathnames. Reject (404) otherwise. This is what makes it
   record-scoped, not bearer-pathname: an authed reviewer-finder user can only read
   a material that actually belongs to a cycle they can see.
3. Read the private blob server-side: `get(pathname, { access: 'private', token:
   UPLOADS_BLOB_RW_TOKEN })` (reuse `readUploadedBlobBuffer`). Fail closed → 503 if
   the token is unset.
4. Stream with: `Content-Type` (from stored filename / default
   `application/octet-stream`), `Content-Disposition: attachment; filename="…"`,
   `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
   (NOTE: `download-review.js` omits `nosniff` — pin it here with a test.)
5. Register in `docs/API_ROUTE_SECURITY_MATRIX.md`; `check:api-routes` + self-test green.

### B. Upload → private, persist a resolvable ref

Behind a flag (`NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS`, default
`public`), the two modals pass `access="private"` to `FileUploaderSimple` and persist
the **pathname** + **access**, not the public URL.

Storage approach (minimize schema change):
- **Attachments** are already JSON → extend each element to
  `{ pathname, access: 'private', filename }` (add keys; no schema change).
- **Template** has only `wmkf_reviewtemplateurl` (string) + filename. **Open
  decision (for Codex):** (a) store the **pathname** in `wmkf_reviewtemplateurl` and
  discriminate by value shape (`https://…` = legacy public; otherwise = private
  pathname) — no schema change but relies on shape inference; vs (b) add an explicit
  `wmkf_reviewtemplateaccess` choice column (clean discriminator, but a Dataverse
  schema deploy with the documented gotchas). Leaning (a) for parity with the
  in-band attachments JSON, with a defensive `access` field where we can.

### C. Read legs branch on access (with back-compat)

- **grant-cycles GET:** for a private ref, return the new proxy URL
  (`/api/reviewer-finder/cycle-material?cycleId=…&pathname=…`); for a legacy public
  URL, keep `proxifyBlobUrl` (→ `blob-proxy.js`). One helper decides per ref.
- **generate-emails / send-emails:** for a private ref, read via
  `readUploadedBlobBuffer({ access:'private', pathname })`; for legacy public, keep
  `safeFetch(url)`. `fetchAttachment` gains a private branch keyed by pathname.

### D. Back-compat

Existing cycles keep their **public** `wmkf_reviewtemplateurl` + attachment
`blobUrl`s; they continue to render via `blob-proxy.js` and server-read via
`safeFetch` unchanged. Only **new** uploads (flag on) are private. No backfill /
re-host of existing public materials in this slice (later step, if ever).

## Slicing

The four legs move in lockstep per material (a private upload whose email
server-read still `safeFetch`es a 403 URL breaks attachments). Proposed order:
1. Proxy route + record-scope + tests (serves nothing until B persists a private ref,
   but unit-testable with a stubbed cycle).
2. Storage refs + read-leg branching (grant-cycles GET + email routes) + back-compat.
3. Modal uploaders flag-gated → private; end-to-end smoke (upload template in
   SettingsModal → render via proxy 403-unauth → generate-emails attaches it).

## Open decisions (for Codex design review)

1. Template storage discriminator: value-shape inference vs. new Dataverse column (B).
2. Proxy identifier: `cycleId + pathname` (record-scoped, chosen) vs. an opaque token.
   Chosen keeps it stateless and record-scoped without a new mapping table.
3. Is the lower-risk classification still worth the four-leg cost now, or defer behind
   finishing the remaining server-read consumers first? (User chose to proceed.)

## Not in scope

Backfill/re-host of existing public cycle materials; the remaining server-read
`FileUploaderSimple` consumers (separate, proxy-less migration); per-attachment
content-type persistence beyond filename inference.
