---
title: Consultant Feedback — Informal Consultant Input on the Reviews Tab and the Briefing Page
domain: reviewers
kind: plan
status: active
summary: "Staff record informal feedback on a proposal from retained consultants (pasted text and/or an attached file), attributed to a roster consultant, editable, and shared by default on the deliberation briefing page as its own section. Postgres owns the entry; the request-document registry and SharePoint own any attached file."
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
  - docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/atlas/postgres-infra-tables.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - shared/components/workbench/ReviewsTab.js
  - lib/services/deliberation-briefing/briefing-page-service.js
  - lib/services/site-visit/recipient-directory-service.js
  - lib/services/site-visit-materials/contributor-service.js
  - shared/config/requestDocument.js
---

# Consultant Feedback — Informal Consultant Input on the Reviews Tab and the Briefing Page

## 0. Problem

WMKF retains consultants who send informal feedback on proposals, usually as email text and
sometimes as a DOCX or PDF attachment. Staff weigh this feedback during review, but today it has
no home in the system: it is not a formal review, cannot be bound to a reviewer suggestion
without corrupting reviewer counts, reliability data, and honoraria, and does not reach the
read-only briefing page that board members and consultants open from the Share email.

## 1. Owner decisions (2026-09-14, Session 512)

| # | Decision |
|---|---|
| CF1 | **Home is the Request Workbench Reviews tab**, as a separate "Consultant feedback" section below formal reviews. Staff Deliberations was considered and rejected: feedback arrives before the writeup stage. |
| CF2 | **Share flag defaults to on.** Consultants are paid by WMKF; their input is expected to circulate internally. Staff may turn any item off. |
| CF3 | **The external briefing page shows the consultant's name** (and affiliation), consistent with D13 for reviews. |
| CF4 | External section label is **"Consultant feedback"**. |
| CF5 | **Staff can edit and delete entries. No audit trail** is required. |
| CF6 | **Consultant identity comes from the existing roster** (a dropdown of active `expertise_roster` rows with `role_type = 'Consultant'`), with an **"Add person"** option for one-offs that creates a roster row. |

Decisions from the briefing plan that carry over unchanged: one shared link per proposal,
read-only, no copies of files, PDFs open inline and other files download (D23/D28), live data
rather than pinned for non-writeup sections, external labels are presentation labels (D21).

**Departure stated once:** briefing decision D14 ("the page shows all completed reviews; staff do
not select a subset") governs the Reviews section only. Consultant feedback is a new section
with its own rule: a per-item share flag, default on. This does not reopen D14.

## 2. Current state (all [VERIFIED 2026-09-14 via source])

- **Consultants already live in Postgres.** `expertise_roster` has `id, name, preferred_email,
  role_type, role, affiliation, orcid, …, is_active, created_by, updated_by`
  [VERIFIED via `scripts/setup-database.js:1371-1390`]. The site-visit recipient directory reads
  active rows with `role_type IN ('Board','Consultant')`
  [VERIFIED via `lib/services/site-visit/recipient-directory-service.js:24-31`]. The only writers
  are `pages/api/expertise-finder/roster.js` (guarded by `requireAppAccess(…, 'expertise-finder')`,
  line 38) and `scripts/seed-expertise-roster.js` [VERIFIED via grep for INSERT/UPDATE on the table].
- **Formal reviews are bound to `wmkf_appreviewersuggestion` rows.** The Reviews tab's manual
  entry path (`ManualReviewEntryForm`) posts a complete structured review to
  `/api/review-manager/manual-review-entry` for a specific suggestion
  [VERIFIED via `shared/components/workbench/ManualReviewEntryForm.js:1-30`]. Reusing it for
  consultant text would create a reviewer where none exists. Not reused.
- **The Reviews tab** is `shared/components/workbench/ReviewsTab.js` (967 lines), loads its roster
  from `/api/review-manager/reviewers?proposalId=` (line 792) and has one `<section>` landmark,
  `outstanding-reviews-heading` (line 878). The new section is a **new component file** mounted
  from the tab, not more lines in the tab.
- **The briefing page** (`pages/external/briefing/[token].js`) renders card sections in the order
  Schedule, Staff brief and notes, Proposal, Research presentation materials (lines 119–176), with
  Reviews rendered separately, from a context read model built by
  `lib/services/deliberation-briefing/briefing-page-service.js` (`loadReviews` line 158,
  `loadMaterials` line 228, assembled at line 278). Review HTML is sanitized server-side on read
  through `lib/external/sanitize-review-html.js` (`sanitizeReviewHtml`, `htmlToPlainText`,
  `isEffectivelyEmptyHtml`). Materials are served by
  `GET /api/external/briefing/[token]/document?member=material:<requestdocumentid>` with
  membership re-proved per download [VERIFIED via `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md:54,74`].
- **Request files are registered in `wmkf_requestdocument`.** Artifact types are a local option
  set mirrored in `shared/config/requestDocument.js:10-18` (eight values, 100000000–100000007;
  no "Consultant Feedback" value). `wmkf_generationkey` is an alternate key the adapter checks on
  create (`lib/dataverse/adapters/request-document.js:200-225`). Applicant material rows are
  created `operationstatus = Ready`, `lifecyclestate = Draft`, with `wmkf_name`, the request bind,
  `wmkf_cyclecode`, `wmkf_inputfingerprint`, `wmkf_claimtoken`, and `wmkf_producer`
  [VERIFIED via `lib/services/site-visit-materials/contributor-service.js:315-326`]; the briefing
  filter keeps Ready rows and drops Superseded ones (lines 186–187). Files land under the request's
  active bucket in a per-slot subfolder named from `SITE_VISIT_MATERIALS_FOLDERS`
  (`Site Visit - Slides`, `Site Visit - Participant Bios`, `Site Visit - Other`)
  [VERIFIED via `contributor-service.js:296-297`, `shared/config/siteVisitMaterials.js:33-38`].
- **The staff/external upload pattern is staged, not multipart.** External materials: mint
  (`pages/api/external/materials/[token]/upload-token.js`: browser chooses only slot, filename,
  type, size; scope, actor binding, pathname, and cap are server-derived) → private Blob →
  finalize (`pages/api/external/materials/[token]/finalize.js` → `finalizeMaterialUpload`), which
  virus-scans when `isVirusScanEnabled()`, uploads with `GraphService.uploadFileLarge`, and creates
  the registry row [VERIFIED via `contributor-service.js:11-54,199`]. The staff precedent for an
  actor-bound mint is `pages/api/workbench/grantee-deliverables/replacement-upload-token.js`.
  CLAUDE.md requires the `portal_upload_staging` + `UPLOADS_BLOB_RW_TOKEN` path for staff uploads;
  never multipart Function bodies, never the intake token.
- **Migrations:** latest is `047_review_panel.sql`; fresh-install block is v49
  (`scripts/setup-database.js:1054`). Next migration is 048 → block v50.

## 3. Contract

### 3.1 One feedback entry [PLANNED]

| Field | Rule |
|---|---|
| `request_id` | Dataverse `akoya_request` GUID, GUID-validated at the route boundary |
| `consultant_roster_id` | FK `expertise_roster.id`, required. Names and affiliations are **joined live** for display, never copied. The display join does **not** filter `is_active`, so a deactivated consultant's past feedback keeps its author. |
| `body_html` | Optional. Staff-pasted text, stored as sanitized HTML (same `sanitizeReviewHtml` pipeline as reviews) and re-sanitized on every read. Null when the entry is attachment-only. |
| `received_on` | Date the feedback arrived (staff-entered, defaults to today). |
| `requestdocument_id` | Optional Dataverse GUID of the attached file's registry row (slice 2). Unique when present: one attachment per entry; a second file is a second entry. |
| `shared` | Boolean, default `true` (CF2). |
| `created_by`, `updated_by`, `created_at`, `updated_at` | Actor from the authenticated profile, never from the request body. No history table (CF5). |

At least one of `body_html` or `requestdocument_id` must be present.

### 3.2 Add person [PLANNED]

The save route accepts either `consultantRosterId` or `newConsultant: { name, affiliation,
preferredEmail? }`. With `newConsultant`, the service inserts an `expertise_roster` row with
`role_type = 'Consultant'`, `is_active = true`, `created_by = actor`, and binds the entry to it in
the same transaction.

**Named side effect:** that row immediately appears in the site-visit recipient directory and
curated-recipient pickers (they filter on `role_type` and `is_active`). A row without
`preferred_email` lists but cannot be invited. This is the intended meaning of "one-off": the
person becomes a known consultant. The insert is server-side under `reviewers` access; the
`expertise-finder`-gated roster route is not called (cross-app-key write, noted for the security
review).

### 3.3 Briefing page section [PLANNED]

- New card section "Consultant feedback" (CF4), placed after Reviews and before Proposal, in the
  same card style as the existing sections. Rendered only when at least one shared entry exists;
  otherwise omitted (no placeholder, unlike the staff brief).
- Each item: consultant name and affiliation (CF3), received date, sanitized body, and, when an
  attachment exists, one link labeled with the filename. PDF opens inline in a new tab; other
  types download (D23/D28 rule reused verbatim).
- Live read on every context call; toggling `shared` changes the page on next load. No reissue,
  no pinning.
- New `document` member kind `feedback:<requestdocumentid>`. Membership is re-proved on every
  download: the registry row must belong to the token's request, be referenced by a feedback row
  for that request with `shared = true`, be Ready and not Superseded. Anything else is 404 with no
  Graph call, matching the existing kinds. The `material:` kind's artifact-type filter is **not**
  widened.

### 3.4 Routes [PLANNED — register in `docs/API_ROUTE_SECURITY_MATRIX.md` before build]

| Route | Method | Guard | Purpose |
|---|---|---|---|
| `/api/workbench/consultant-feedback` | GET | `requireAppAccess('reviewers')`; `withDalContext` | List entries for `?requestId=` (GUID-validated) with live roster join |
| `/api/workbench/consultant-feedback` | POST | same | Create (roster id or new person), update by `id`, delete by `id`; actor from session |
| `/api/workbench/consultant-feedback/consultants` | GET | same | Dropdown source: active roster rows with `role_type = 'Consultant'`, id/name/affiliation only |
| `/api/workbench/consultant-feedback/upload-token` | POST | same | **Slice 2.** Actor-bound mint into `portal_upload_staging`, `UPLOADS_BLOB_RW_TOKEN`, request-bound |
| `/api/workbench/consultant-feedback/finalize` | POST | same | **Slice 2.** Reauthorizes independently; scan when enabled; Graph upload; registry create; binds `requestdocument_id` |
| `/api/external/briefing/[token]/context` | GET | existing | Adds `consultantFeedback[]` to the read model |
| `/api/external/briefing/[token]/document` | GET | existing | Adds member kind `feedback:<id>` |

Existing matrix rows for `context` and `document` are amended, not duplicated. All new
`requestId` inputs pass `isGuid` before any Dataverse selector (`check:trust-boundary-guid`).

### 3.5 Staff surface [PLANNED]

New component `shared/components/workbench/ConsultantFeedbackSection.js`, mounted by
`ReviewsTab.js` below the outstanding-reviews section:

- Heading "Consultant feedback" with an "Add feedback" button.
- Form: consultant combobox (roster search, with "Add person…" that expands name / affiliation /
  email fields), received date, rich text body (the existing `RichReviewEditor` contract, so paste
  from email preserves paragraphs), attachment (slice 2), and a "Shared on briefing page"
  checkbox, checked by default.
- List: one row per entry with consultant, date, first line of the body, attachment name, a
  shared/not-shared pill, and Edit / Delete row actions. Delete asks once inline, then hard-deletes.
- Read-only Preview: mutations disabled with the same `previewReadOnly` title-text pattern the
  tab already uses (lines 747, 756).

### 3.6 Delete semantics [PLANNED]

- Slice 1: hard delete the Postgres row (CF5).
- Slice 2: delete the Postgres row and mark the registry row `Superseded` (the briefing filter
  already hides Superseded rows; no Graph delete, consistent with "no copies, exact pathnames
  only"). Owner may override to a physical delete later.

### 3.7 What is deliberately out

- **No AI consumer.** Consultant feedback is untrusted external text pasted from email. It is not
  fed to synthesize-reviews, the Review Panel, or the Cycle Dossier in this plan. If a later plan
  adds a model consumer, the body gets A7 prompt-injection tagging first.
- No Dataverse mirror of the text or the share flag. Postgres owns operational state; Dataverse
  and SharePoint own file identity. Stated once here; not revisited.
- No notification, no email to the consultant, no honorarium linkage, no reviewer-count effects.
- No cycle-level view; entries are per request.

## 4. Data model [PLANNED]

Migration `048_consultant_feedback.sql` + manifest entry + fresh-install block v50:

```sql
CREATE TABLE consultant_feedback (
  id                     BIGSERIAL PRIMARY KEY,
  request_id             UUID NOT NULL,
  consultant_roster_id   INTEGER NOT NULL REFERENCES expertise_roster(id),
  body_html              TEXT,
  received_on            DATE NOT NULL,
  requestdocument_id     UUID UNIQUE,
  shared                 BOOLEAN NOT NULL DEFAULT true,
  created_by             INTEGER NOT NULL REFERENCES user_profiles(id),
  updated_by             INTEGER NOT NULL REFERENCES user_profiles(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consultant_feedback_has_content CHECK (body_html IS NOT NULL OR requestdocument_id IS NOT NULL)
);
CREATE INDEX consultant_feedback_request_idx ON consultant_feedback (request_id, received_on DESC);
```

Column names follow the human-legibility schema principle.

### Slice 2 registry contract [PLANNED; requires Dataverse admin]

- New `wmkf_requestdocument` artifact-type option **"Consultant Feedback"** (next value
  `100000008`), added to the option set by the Dataverse admin, then mirrored in
  `shared/config/requestDocument.js`. Same precedent as the "Participant Bios" note in the
  materials plan §10.1.
- SharePoint target: the request's active bucket from `getRequestSharePointBuckets`, subfolder
  `Consultant Feedback` (sibling of the `Site Visit - …` subfolders), filename
  `Consultant Feedback-<Request#>-<consultant name>-<received_on><ext>` after the existing
  SharePoint-safe sanitization (`contributor-service.js:138-139`).
- Registry row mirrors the applicant-materials create payload: `operationstatus = Ready`,
  `lifecyclestate = Draft`, request bind, `wmkf_cyclecode`, `wmkf_inputfingerprint`,
  `wmkf_claimtoken`, and a feedback-specific `wmkf_producer` value.
- `wmkf_generationkey` = SHA-256 over (request id, artifact type, feedback row id, content
  hash) so a finalize retry is idempotent and two attachments on one request never collide.

## 5. Security contract [PLANNED]

- Actor identity only from the authenticated profile (CLAUDE.md invariant); `created_by` /
  `updated_by` never from the body.
- Every `requestId` GUID-validated before use; every roster id integer-validated; the
  `requestdocument_id` bound at finalize is the one the finalize route itself created, never
  client-chosen.
- Upload bytes: actor-bound `portal_upload_staging` row, private `UPLOADS_BLOB_RW_TOKEN` store,
  mint and finalize reauthorize independently, client never chooses pathnames, virus scan when
  `isVirusScanEnabled()` (as `finalizeMaterialUpload` does), size cap reused from materials
  (`upload-cap.js`) or a smaller feedback-specific cap.
- External page: body sanitized server-side on read; no URL-shaped fields in the context
  response; `feedback:` member fail-closed as in §3.3.
- Deliberate departure requiring review: a `reviewers`-gated route inserts into
  `expertise_roster`, which the `expertise-finder` app otherwise owns.

## 6. Build slices and release tier

### Slice 1 — text feedback end to end [PLANNED; no Dataverse schema change]

Migration 048 / block v50; service `lib/services/consultant-feedback-service.js`; the three
workbench routes (list, mutate, consultants); `ConsultantFeedbackSection` on the Reviews tab;
briefing read-model and page section for text items; matrix rows; Atlas rows. Ships on its own.
**Tier 1 runtime work: feature branch, owner merges.**

### Slice 2 — attachments [PLANNED; blocked on the option-set addition]

Dataverse admin adds the artifact-type value; mirror in `requestDocument.js`; mint + finalize
routes; `feedback:` document member; Superseded-on-delete. Tier 1, same branch or a follow-on.

### Slice 3 — polish [PLANNED, optional]

Filter shared/unshared on the tab; consultant profile link to the roster; keyboard-first
combobox.

## 7. Tests [PLANNED]

- Service: create with roster id / with new person (roster row inserted in the same
  transaction, `role_type = 'Consultant'`); content check constraint; update and hard delete;
  live join keeps a deactivated consultant's name.
- Routes: method guards; GUID rejection; actor from session only; Preview read-only.
- Briefing: section omitted with zero shared items; unshared item never appears in context;
  `feedback:` member 404 for unshared, other-request, Superseded, or non-Ready rows with no Graph
  call; PDF inline vs download.
- Component: default-checked share box; add-person expands fields; delete confirms once.
- Gates for the surfaces touched: `check:types`, `check:api-routes` (+ self-test), `check:atlas`
  (+ self-test), `check:migrations-manifest`, `check:trust-boundary-guid`,
  `check:route-lifecycle-auth`, `check:route-service-boundary`, `check:doc-symbol-refs`,
  `check:build-claim-freshness`; each gate sequential with its self-test.

## 8. Durable surfaces touched

Migration `048_consultant_feedback.sql` + `lib/db/migrations-manifest.json` + fresh-install v50;
`docs/atlas/postgres-infra-tables.md` and `docs/APPLICATION_STATE_ATLAS.md` rows;
`docs/API_ROUTE_SECURITY_MATRIX.md` rows (three new in slice 1, two more in slice 2, two amended);
`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md` §2.1 gains the section row and §2.3 the member kind;
`docs/SERVICE_AND_UTILITY_CATALOG.md` for the new service; `docs/agent-wiki/topics/` reviewer
workbench and external-portal pages; slice 2 also `shared/config/requestDocument.js` and
`docs/atlas/dataverse-wmkf-requestdocument.md`.

## 9. Open items before build

1. Confirm the §3.2 side effect (add-person creates a real roster consultant) is acceptable.
2. Dataverse admin: schedule the artifact-type option addition for slice 2.
3. Run `/contract-reconcile` on this plan (new table, new routes, cross-layer, durable surfaces).
