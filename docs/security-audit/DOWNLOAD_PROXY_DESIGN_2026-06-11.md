# Phase 1 — authenticated private-blob download proxy + cycle-materials migration

**Status:** 🟨 SLICES 1–3 CODE-COMPLETE + CODEX-REVIEWED (2026-06-11); flag-gated
(default public), **live e2e smoke pending**. Slice 1 = the record-scoped proxy route
(`pages/api/reviewer-finder/cycle-material.js`; Codex: no record-scope bypass). Slice 2 =
all readers private-aware (`grant-cycles` GET, `generate-emails`, `send-emails`) +
`maintenance-service` data-loss fix (Codex-verified; two findings folded). Slice 3 =
`SettingsModal`'s template + attachment uploads flip to `access="private"` under the
`cycle-materials/` prefix behind `NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS`
(default public), persisting the blob **pathname**. Builds on the completed file-loader
cohort (`PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md`). **Remaining:** set the flag in
dev/preview + browser e2e smoke (upload a template in SettingsModal → it lands private →
generate/send-emails attaches it via private read → blob URL 403), then prod promotion.

## Codex review (2026-06-11) — folded

Slice 1: no bypass found (exact `Map.get(pathname)`); LOW content-type-from-filename
(acceptable under forced `attachment`+`nosniff`); INFO 404-timing side channel (a
patient caller could distinguish "attached-but-gone" from "not-this-cycle" — accepted).
Slice 2 findings drive the plan below: **HIGH** both email routes silently drop private
materials (`generate-emails` `isAllowedUrl`/`safeFetch`, `send-emails` `fetchAttachment`);
**MEDIUM** `grant-cycles` GET has no private-proxy branch; **MEDIUM** storage discriminator
fragility → resolved with the strict-prefix rule below; **MEDIUM** `maintenance-service`
blob cleanup is an UNLISTED consumer (data-loss hazard) → new §E.

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

Storage approach (minimize schema change) — **RESOLVED: option (a) + strict-prefix
discriminator** (Codex SLICE2-4 push-back folded):
- **Attachments** are already JSON → extend each element to
  `{ pathname, access: 'private', filename }` (add keys; no schema change).
- **Template** has only `wmkf_reviewtemplateurl` (string) + filename. Store the
  **pathname** there for private materials (no schema change, parity with attachments).
  The legacy-public-vs-private discriminator is **NOT** the fragile "not http://" rule —
  it is a **strict allowlist prefix**: private cycle-material uploads are written under a
  fixed `CYCLE_MATERIAL_PREFIX = 'cycle-materials/'` pathname prefix, and a stored value
  counts as private **iff it starts with that prefix** (and is not an http(s) URL).
  Everything else (https URLs, protocol-relative `//…`, malformed legacy values) is
  treated as legacy-public — fail-safe toward the unchanged public path, never toward a
  private read. The prefix is added at upload time (slice 3) via a new
  `FileUploaderSimple` `pathPrefix` prop. Shared logic lives in a new
  `lib/utils/cycle-material-ref.js` (`CYCLE_MATERIAL_PREFIX`,
  `isPrivateCycleMaterialPathname`, `cycleMaterialDownloadPath`) so the route and every
  slice-2 reader agree.
- **The prefix is the SINGLE classifier for BOTH the template and attachments** (Codex
  SLICE2-5-VERIFY). An attachment is private iff `isPrivateCycleMaterialPathname(att.pathname)`
  — **not** its JSON `access` field. Slice 3 still writes `access:'private'` as metadata,
  but no reader keys off it; using `access` in one consumer and the prefix in another caused
  a fail-silent divergence (a non-prefixed private attachment was dropped only by
  `send-emails`). One classifier everywhere = no disagreement.

### C. Read legs branch on the prefix classifier (with back-compat)

Every reader classifies via `isPrivateCycleMaterialPathname` (the prefix), so a private
ref routes to `readUploadedBlobBuffer` / the proxy and a legacy public ref keeps its
`safeFetch` / `blob-proxy` path.

- **grant-cycles GET** (`proxifyCycle`, SLICE2-3): a private ref → the proxy URL via
  `cycleMaterialDownloadPath(cycle.id, pathname)`; a legacy public URL → `proxifyBlobUrl`.
  Both template and each attachment go through the same `materialDownloadUrl(cycleId, value)`
  helper. (Private attachments have no `blobUrl`, so the old `proxifyAttachments` emitted no
  downloadable URL — the helper fixes that.)
- **generate-emails** (SLICE2-1, HIGH): the template branch and the attachment loop add a
  private branch (`isPrivateCycleMaterialPathname(pathname)` →
  `readUploadedBlobBuffer({access:'private', pathname})`); public URLs keep `safeFetch`.
  **Guard:** a failed public `safeFetch` leaves `buffer` null, so each push is preceded by
  `if (!buffer) continue` — the restructure must NOT push an empty MIME part (Codex
  SLICE2-1-VERIFY regression, fixed).
- **send-emails** (SLICE2-2, HIGH): `fetchAttachment(ref, cache, explicitFilename)` detects
  a private cycle-material pathname by prefix and reads it via `readUploadedBlobBuffer`
  (throws on failure → caught + skipped by the callers, never cached); public URLs keep the
  `isAllowedUrl`/`safeFetch` path. The attachment loop selects `a.pathname` (prefix-private)
  else `a.blobUrl || a.url`.

### D. Back-compat

Existing cycles keep their **public** `wmkf_reviewtemplateurl` + attachment
`blobUrl`s; they continue to render via `blob-proxy.js` and server-read via
`safeFetch` unchanged. Only **new** uploads (flag on) are private. No backfill /
re-host of existing public materials in this slice (later step, if ever).

### E. Blob cleanup must be private-aware (Codex SLICE2-5, data-loss hazard)

`lib/services/maintenance-service.js` (~`:347-370`) scans cycles for orphaned blobs but
reads **only** `wmkf_reviewtemplateurl` into a URL set, and ignores
`wmkf_additionalattachments` entirely. Post-migration this is a DATA-LOSS risk: a private
**pathname** sitting in the template field would be fed into public-URL cleanup logic, and
all attachments (public or private) are invisible to the scanner → could be deleted as
orphans. Required before any private cycle material exists in an environment with cleanup
enabled:
- include `wmkf_additionalattachments` in the scan;
- partition the inventory into **public-store URLs** vs **private-store pathnames** (via
  `isPrivateCycleMaterialPathname`), and never run a public-store deletion pass against a
  private pathname (and vice-versa). Until the scanner handles the private store
  explicitly, **fence private pathnames out of any deletion set** (treat as referenced).

## Slicing

The four legs move in lockstep per material (a private upload whose email
server-read still `safeFetch`es a 403 URL breaks attachments). Order:
1. ✅ **DONE** — Proxy route + record-scope + tests (`cycle-material.js`), Codex-reviewed.
2. ✅ **DONE** — Shared `cycle-material-ref.js` helper + read-leg branching (grant-cycles GET +
   both email routes) + `maintenance-service` safety (§E) + back-compat. Readers private-aware
   while no private refs exist yet (legacy public path unchanged). Codex-verified.
3. ✅ **CODE-COMPLETE** — `SettingsModal`'s template + attachment `upload()` handlers
   flag-gated → `access="private"` under the `cycle-materials/` prefix, persisting the blob
   pathname (`NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS`, default public). No
   `EmailGeneratorModal`/`FileUploaderSimple` change (the modals use direct `upload()`, and
   neither renders the ref as a clickable link). **Remaining: live e2e smoke** (set the flag
   in dev/preview → upload a template → confirm it lands private + 403 + generate/send-emails
   attaches it via the private read), then prod promotion.

## Resolved decisions

1. Template storage discriminator: **option (a) + strict `cycle-materials/` prefix
   allowlist** (not "not-http" shape inference) — §B. Fail-safe toward public.
2. Proxy identifier: `cycleId + pathname` (record-scoped, stateless, no mapping table).
3. Worth the four-leg cost now: yes (user chose to proceed; gives the proxy a real
   record-scoped consumer and closes the public-blob posture for cycle materials).

## Not in scope

Backfill/re-host of existing public cycle materials; the remaining server-read
`FileUploaderSimple` consumers (separate, proxy-less migration); per-attachment
content-type persistence beyond filename inference.
