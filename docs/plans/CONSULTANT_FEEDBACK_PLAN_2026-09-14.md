---
title: Consultant Feedback — Informal Consultant Input on the Reviews Tab and the Briefing Page
domain: reviewers
kind: plan
status: active
summary: "Slice 1 PRODUCTION-LIVE 2026-09-14 (PR #293); slice 2 attachments merged to main via PR #295 and await production migration 049 plus smoke; slice 3 staff attachment access and list/chooser polish are source-built and fresh-review approved on branch codex/consultant-feedback-slice-3, awaiting owner merge. Staff record informal feedback on a proposal from retained consultants (pasted text and/or an attached file), attributed to a roster consultant, editable, and shared by default on the deliberation briefing page as its own section. Postgres owns the entry; the request-document registry and SharePoint own any attached file."
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
| CF6 | **Consultant identity comes from the existing roster** (a dropdown of active `expertise_roster` rows with `role_type = 'Consultant'`), with an **"Add person"** option for one-offs. **One-offs are stored on the entry itself and are never added to the roster** (owner, 2026-09-14, second pass: a one-off must not become a roster consultant or appear in recipient pickers). |
| CF7 | Slice 2's Dataverse artifact-type addition is scheduled by the owner after slice 1 ships; it is not a build-time dependency of slice 1. **Done 2026-09-14:** `Consultant Feedback = 100000008` inserted into production via `scripts/extend-requestdocument-artifacttype.mjs` (owner-run), mirrored in `shared/config/requestDocument.js`. |

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
  no "Consultant Feedback" value at plan time; value `100000008` added to production 2026-09-14, CF7). `wmkf_generationkey` is an alternate key the adapter checks on
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
- **Migrations:** at plan time the latest was `047_review_panel.sql` / block v49. Slice 1 added
  `048_consultant_feedback.sql` / block v50 (commit `1a58bac8`); the next migration is 049 → v51.
  Migration 048 was applied to production on 2026-09-14 (`node scripts/apply-migrations.js`:
  1 applied, 46 skipped).

## 3. Contract

### 3.1 One feedback entry [BUILT S512 on `feature/consultant-feedback-slice-1`, commit `1a58bac8`; slice 2 parts MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`)]

| Field | Rule |
|---|---|
| `request_id` | Dataverse `akoya_request` GUID, GUID-validated at the route boundary |
| `consultant_roster_id` | FK `expertise_roster.id`, nullable. When set, name and affiliation are **joined live** for display, never copied; the display join does **not** filter `is_active`, so a deactivated consultant's past feedback keeps its author. |
| `one_off_name`, `one_off_affiliation` | Nullable text. Used only when `consultant_roster_id` is null (CF6). Exactly one of roster id or one-off name is present (check constraint). |
| `body_html` | Optional. Staff-pasted text, stored as sanitized HTML (same `sanitizeReviewHtml` pipeline as reviews) and re-sanitized on every read. Null when the entry is attachment-only. |
| `received_on` | Date the feedback arrived (staff-entered, defaults to today). |
| `requestdocument_id` | Optional Dataverse GUID of the attached file's registry row (slice 2). Unique when present: one attachment per entry; a second file is a second entry. |
| `shared` | Boolean, default `true` (CF2). |
| `mutation_id` | Client-generated UUID sent with every create. `UNIQUE (request_id, mutation_id)`; the create runs `INSERT … ON CONFLICT (request_id, mutation_id) DO NOTHING` and then returns the row that carries the id, so a retry after a lost response replays the original row instead of inserting a duplicate that would appear twice on the briefing page (Codex AR-2 finding 5). **Lifecycle (Codex AR-3):** the component allocates the UUID once when the "Add feedback" form opens, holds it in form state through timeouts, network errors, and 5xx responses so every Save retry sends the same id, and rotates it only after a confirmed 2xx or an explicit form reset. Test: resubmit the same draft after a simulated lost response and assert one row and the same id. |
| `status` | `'active'` or `'deleting'`. External and tab readers select `status = 'active'` only. Set to `'deleting'` as the first step of a slice 2 delete (§3.6); slice 1 deletes go straight from `'active'` to gone. |
| `created_by`, `updated_by`, `created_at`, `updated_at` | Actor from the authenticated profile, never from the request body. No history table (CF5). |

At least one of `body_html` or `requestdocument_id` must be present.

### 3.2 Add person [BUILT S512 on `feature/consultant-feedback-slice-1`, commit `1a58bac8`; slice 2 parts MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`)]

The save route accepts either `consultantRosterId` or `oneOff: { name, affiliation? }`.

**Server-side eligibility (Codex AR-1 finding 3):** on create, and on any edit that changes the
author, the service resolves `consultantRosterId` with
`SELECT id FROM expertise_roster WHERE id = $1 AND is_active = true AND role_type = 'Consultant'`
and rejects a miss with 400 `consultant_not_eligible`. The FK alone would accept any roster row
(the table has no role-type constraint, `scripts/setup-database.js:1371-1390`), so a stale
dropdown or a forged body could otherwise attribute feedback to a Board member or an inactive
person and show it externally. The **unfiltered** join is used only when reading, or when editing
an existing entry without changing its author, so a deactivated consultant's past feedback keeps
its name.

With `oneOff`, the entry stores the name and affiliation on the row itself.

**One eligibility path (Codex AR-2 finding 4; shape as built 2026-09-14):** every insert goes
through `writeFeedbackEntry` and every author change through `updateFeedbackEntry`; both call the
same `assertConsultantEligible` and `validateAuthorInput` helpers inside their own same-client
transaction, and eligibility runs only when the submitted author differs from the stored one.
Slice 2 finalize step 7 inserts attachment-only rows through `writeFeedbackEntry` and binds
`requestdocument_id` on existing rows through `updateFeedbackEntry`; finalize never writes the
table directly. Finalize-route tests
submit Board, inactive, missing, and stale roster ids and assert rejection with no registry bind. **No `expertise_roster`
write happens anywhere in this feature** (CF6): a one-off never appears in the site-visit
recipient directory or curated-recipient pickers, and the `expertise-finder`-owned roster stays
that app's surface. If staff later want a one-off to become a roster consultant, they add them
through the Expertise Finder and edit the entry to select the roster row.

### 3.3 Briefing page section [BUILT S512 on `feature/consultant-feedback-slice-1`, commit `1a58bac8`; slice 2 parts MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`)]

- New card section "Consultant feedback" (CF4), placed immediately after Reviews, which is the
  page's last section (Proposal renders before Reviews, so "between Reviews and Proposal" was
  unsatisfiable; corrected at build time 2026-09-14), in the same card style as the existing
  sections. Rendered only when at least one shared entry exists;
  otherwise omitted (no placeholder, unlike the staff brief).
- Each item: consultant name and affiliation (CF3), received date, sanitized body, and, when an
  attachment exists, one link labeled with the filename. PDF opens inline in a new tab; other
  types download (D23/D28 rule reused verbatim).
- Live read on every context call; toggling `shared` changes the page on next load. No reissue,
  no pinning.
- **Unavailable is not empty (Codex AR-1 finding 4).** The context model carries
  `consultantFeedback: { status: 'ok' | 'unavailable', items: [] }`. A read failure on the new
  table sets `unavailable`, is logged server-side with a structured event, and the page renders the
  section with one line, "Consultant feedback could not be loaded", instead of omitting it. Zero
  shared items with `status: 'ok'` omits the section. This departs from the materials section's
  swallow-to-empty policy on purpose: silently missing input at a deliberation is a worse failure
  than a visible notice. (A full Postgres outage never reaches this code: the link itself is
  verified against `deliberation_briefing_links` in Postgres first,
  `lib/external/verify-briefing-token.js`, so the realistic case is a fault on the new table
  alone.)
- `received_on` is emitted as an ISO date string (`YYYY-MM-DD`) and rendered without constructing a
  `Date` from it, so the day never shifts with the viewer's time zone. Name and affiliation render
  as text nodes, never as HTML.
- New `document` member kind `feedback:<requestdocumentid>`. Membership is re-proved on every
  download: the registry row must belong to the token's request, be referenced by a feedback row
  for that request with `shared = true`, be Ready and not Superseded. Anything else is 404 with no
  Graph call, matching the existing kinds. The `material:` kind's artifact-type filter is **not**
  widened.

### 3.4 Routes [slice 1 rows BUILT S512 and registered in `docs/API_ROUTE_SECURITY_MATRIX.md`; slice 2 rows MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`); slice 3 staff download SOURCE-BUILT on `codex/consultant-feedback-slice-3`; all registered in the matrix]

| Route | Method | Guard | Purpose |
|---|---|---|---|
| `/api/workbench/consultant-feedback` | GET | `requireAppAccess('reviewers')`; `withDalContext` | List entries for `?requestId=` (GUID-validated) with live roster join |
| `/api/workbench/consultant-feedback` | POST, PATCH, DELETE | same | Create (roster id or new person), update by `id`, delete by `id`; actor from session |
| `/api/workbench/consultant-feedback/consultants` | GET | same | Combobox search source: active roster rows with `role_type = 'Consultant'`, id/name/affiliation only |
| `/api/workbench/consultant-feedback/attachment` | GET | same | **Slice 3.** Staff PDF/DOCX proxy by request GUID + feedback-entry id. The service proves one active request-owned entry and one same-request, Ready, non-Superseded Consultant Feedback registry row before Graph; no SharePoint coordinate is accepted from the client. |
| `/api/workbench/consultant-feedback/upload-token` | POST | same | **Slice 2.** Actor-bound mint into `portal_upload_staging`, `UPLOADS_BLOB_RW_TOKEN`, request-bound |
| `/api/workbench/consultant-feedback/finalize` | POST | same | **Slice 2.** Reauthorizes independently; scan when enabled; Graph upload; registry create; binds `requestdocument_id` |
| `/api/external/briefing/[token]/context` | GET | existing | Adds `consultantFeedback[]` to the read model |
| `/api/external/briefing/[token]/document` | GET | existing | Adds member kind `feedback:<id>` |

Existing matrix rows for `context` and `document` are amended, not duplicated. All new
`requestId` inputs pass `isGuid` before any Dataverse selector (`check:trust-boundary-guid`).

### 3.5 Staff surface [BUILT S512 on `feature/consultant-feedback-slice-1`, commit `1a58bac8`; slice 2 parts MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`); slice 3 polish SOURCE-BUILT on `codex/consultant-feedback-slice-3`]

New component `shared/components/workbench/ConsultantFeedbackSection.js`, mounted by
`ReviewsTab.js` below the outstanding-reviews section:

- Heading "Consultant feedback" with an "Add feedback" button.
- Form: searchable, keyboard-first consultant combobox (name/affiliation matching; Arrow Up/Down,
  Enter, and Escape; with "Add person…" that expands name / affiliation
  fields stored on the entry only), received date, rich text body (the existing `RichReviewEditor` contract, so paste
  from email preserves paragraphs), attachment (slice 2), and a "Shared on briefing page"
  checkbox, checked by default.
- List: one row per entry with consultant, date, first line of the body, an authenticated Open
  (PDF) or Download (DOCX) attachment link, a shared/not-shared pill, and Edit / Delete row
  actions. Local All / Shared / Not shared filters include honest counts, default to All, reset
  on request change, and create no persisted preference. Delete asks once inline, then hard-deletes.
- Read-only Preview: mutations disabled with the same `previewReadOnly` title-text pattern the
  tab already uses (lines 747, 756).
- Load-on-mount and reload-after-mutation copy the tab's `fetchIdRef` generation guard
  (`ReviewsTab.js:786-807`): every post-await state write, success and failure, checks the
  generation so a request switch never paints another request's feedback.

### 3.6 Delete semantics [slice 1 hard delete BUILT S512; slice 2 three-step ordering MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`)]

- Slice 1: hard delete the Postgres row (CF5).
- Slice 2 (Codex AR-1 finding 2 and AR-2 finding 3; remedy is a pending status on the row, not
  an outbox job): three ordered steps, each idempotent.
  1. In one explicit same-client transaction: `SELECT … FOR UPDATE`, then
     `UPDATE consultant_feedback SET status = 'deleting' WHERE id = $1 AND status = 'active'`,
     `COMMIT`. From this instant the entry is invisible to the briefing page
     and the tab list (both read `status = 'active'`), so no external viewer ever sees a live
     entry with a dead attachment.
  2. PATCH the registry row to `Superseded` (a no-op when already Superseded).
  3. `DELETE FROM consultant_feedback WHERE id = $1 AND status = 'deleting'`.
  Recovery without a job: the tab's list route runs a bounded sweep on every load,
  `SELECT id, requestdocument_id FROM consultant_feedback WHERE request_id = $1 AND status = 'deleting'`,
  and finishes steps 2–3 for any row it finds before returning. A crash or lost response after
  step 1 therefore completes on the next staff visit to that request, and the intent is durable
  in the row itself. No Graph delete (no copies; exact pathnames only); no audit-trail table (CF5):
  the row disappears on completion. Owner may override to a physical delete later.

### 3.7 What is deliberately out

- **No AI consumer.** Consultant feedback is untrusted external text pasted from email. It is not
  fed to synthesize-reviews, the Review Panel, or the Cycle Dossier in this plan. If a later plan
  adds a model consumer, the body gets A7 prompt-injection tagging first.
- No Dataverse mirror of the text or the share flag. Postgres owns operational state; Dataverse
  and SharePoint own file identity. Stated once here; not revisited.
- No notification, no email to the consultant, no honorarium linkage, no reviewer-count effects.
- No cycle-level view; entries are per request.

## 4. Data model [Postgres table BUILT S512 as migration 048 / fresh-install v50; registry parts MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`)]

Migration `048_consultant_feedback.sql` + manifest entry + fresh-install block v50:

```sql
CREATE TABLE IF NOT EXISTS consultant_feedback (
  id                     BIGSERIAL PRIMARY KEY,
  request_id             UUID NOT NULL,
  consultant_roster_id   INTEGER REFERENCES expertise_roster(id),
  one_off_name           TEXT,
  one_off_affiliation    TEXT,
  body_html              TEXT,
  received_on            DATE NOT NULL,
  requestdocument_id     UUID UNIQUE,
  shared                 BOOLEAN NOT NULL DEFAULT true,
  mutation_id            UUID NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting')),
  created_by             INTEGER NOT NULL REFERENCES user_profiles(id),
  updated_by             INTEGER NOT NULL REFERENCES user_profiles(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consultant_feedback_has_content CHECK (body_html IS NOT NULL OR requestdocument_id IS NOT NULL),
  CONSTRAINT consultant_feedback_one_author CHECK (
    (consultant_roster_id IS NOT NULL AND one_off_name IS NULL)
    OR (consultant_roster_id IS NULL AND one_off_name IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS consultant_feedback_request_idx ON consultant_feedback (request_id, received_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS consultant_feedback_mutation_idx ON consultant_feedback (request_id, mutation_id);
```

Column names follow the human-legibility schema principle.

### Slice 2 registry contract [MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`); option-set value live in production 2026-09-14 (CF7)]

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
- `wmkf_generationkey` = SHA-256 over (request id, artifact type, **staging id**, content hash).
  The staging id is the `portal_upload_staging.id` UUID minted before any bytes move, so it exists
  for attachment-only entries where no feedback row exists yet (Codex AR-1 finding 1 closed the
  circular dependency on the feedback row id). Two attachments on one request have distinct
  staging ids and never collide.

### Slice 2 attachment lifecycle [MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`); Codex AR-1 finding 1]

Reuses `lib/services/portal-upload-staging.js` verbatim (mint → claim lease → load bytes → record
candidate → complete/reject) with a new scope `consultant_feedback`. The scope allowlist is a
CHECK constraint (`portal_upload_staging_scope_check`, currently
`grantee_image | staff_grantee_image | site_visit_material`, last widened by migration 043), so
slice 2 needs a migration that re-adds the constraint with the new value.

| Step | Store | Durable identity after the step | On failure |
|---|---|---|---|
| 1 mint | PG staging row `pending` (scope, request id as `resource_id`, actor binding, server pathname, cap) | staging id | nothing to recover; row expires |
| 2 browser upload | private Blob | bytes at the server-chosen pathname | staging row stays `pending`; reaped by `cleanupExpiredPortalUploads` |
| 3 finalize: claim | staging row `finalizing` + lease token (actor, scope, resource re-proved) | lease | 409 if another finalize holds the lease |
| 4 load + scan | read exact object, verify etag/hash, virus scan when enabled | Blob etag/hash under the lease | `rejectPortalUpload`, 4xx to client, no Graph call |
| 5 Graph upload | SharePoint | `recordPortalUploadCandidate({driveId, itemId, contentHash})` **before** step 6 | retry re-uses the candidate; `discardPortalUploadCandidate` removes an orphan when the request is abandoned |
| 6 registry create | Dataverse `wmkf_requestdocument` with the generation key | registry row id; `findByGenerationKey` makes a retry a no-op | candidate persisted, so a retry does not re-upload |
| 7 feedback bind | PG `consultant_feedback` insert (attachment-only, via `writeFeedbackEntry`) or `requestdocument_id` bind on an existing entry (via `updateFeedbackEntry`), **inside one explicit same-client Postgres transaction** (`BEGIN` → `SELECT … FOR UPDATE` on the target entry → conditional bind or status decision → `COMMIT`; a bare `FOR UPDATE` under autocommit releases at statement end and protects nothing, Codex AR-3). Loser-side Dataverse/Graph cleanup runs only after the transaction has committed or rolled back. The lock serializes two finalizes on one entry and a finalize against a delete: the loser sees a `requestdocument_id` already set or `status = 'deleting'`, marks its own registry row `Superseded`, calls `discardPortalUploadCandidate` on its Graph item, and returns 409 `attachment_conflict`. | entry | if this fails the registry row is Ready but unbound; a retry with the same staging id finds the row by generation key and only performs step 7 |
| 8 complete | staging row `consumed` with `result_payload = {requestdocumentId, feedbackId}`; staged bytes reaped later | terminal response durable | a lost response is answered from `result_payload` on replay |

Crash-point tests: fail after 5, after 6, after 7; replay the same staging id and assert exactly
one Graph item, one registry row, one feedback row. Lost-response test: complete then replay,
assert the stored payload is returned without new writes. Concurrency tests: two distinct staging
ids finalizing against one entry (exactly one bound, the other Superseded and its Graph item
discarded); finalize racing delete (either the delete wins and finalize returns 409 with its
candidate discarded, or finalize wins and the delete supersedes the newly bound row).

**Slice 2 prerequisite in the shared staging service (Codex AR-2 finding 1) [MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`)]:**
Before Slice 2, `cleanupExpiredPortalUploads` selected only `id, pathname`, deleted staged Blob
bytes, and expired the row; a `candidate_result` recorded at step 5 was never consulted, so a
crash after the Graph upload with no client retry could leave an unregistered SharePoint file and
eventually prune its only cleanup identity [historical finding verified 2026-09-14 against the
pre-Slice-2 source]. Slice 2 closed that shared grantee-image and site-visit-material gap by
extending the expiry sweep with **fail-closed, scope-specific reconciliation** (Codex AR-3:
candidate shapes differ per scope; grantee-image candidates carry an image ref, not a generation
key, so one registry lookup cannot serve every scope):
- `consultant_feedback` scope: a candidate is **bound** when a registry row with its generation
  key exists **and** a `consultant_feedback` row references that registry id. Unbound with a Ready
  registry row (crash after step 6): PATCH the registry row `Superseded` **first**, then
  `discardPortalUploadCandidate`; if either call fails, retain the staging row and try next sweep.
  Never leave a Ready registry row whose file was discarded. Unbound with no registry row (crash
  after step 5): discard the candidate.
- Existing scopes: each gets its own binding proof (grantee image: the deliverable's image ref
  equals the candidate; site-visit material: generation key plus current-slot ownership). Any
  candidate whose shape the sweep does not recognise is **retained and surfaced**, never discarded.
Tests expire after steps 5, 6, and 7 with no retry per scope and assert the SharePoint item and
registry state are each correct, with committed and uncommitted crash fixtures. The prerequisite
landed with Slice 2.

## 5. Security contract [slice 1 items BUILT S512; upload items MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`)]

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
- No write to `expertise_roster` from any route in this feature (CF6); the roster is read-only
  here.

## 6. Build slices and release tier

### Slice 1 — text feedback end to end [PRODUCTION-LIVE 2026-09-14 (S512): PR #293 merged `b25e4376`, deployment `wmkfresearchapps-f87jgx64x` Ready, migration 048 applied to production by the owner the same day; owner smoke passed 2026-09-14 on request 1003222: entry added from the Reviews tab, card appeared on the briefing page, unshare removed it on reload]

Migration 048 / block v50; service `lib/services/consultant-feedback-service.js`; the three
workbench routes (list, mutate, consultants); `ConsultantFeedbackSection` on the Reviews tab;
briefing read-model and page section for text items; matrix rows; Atlas rows. Ships on its own.
**Tier 1 runtime work: feature branch, owner merges.**

### Slice 2 — attachments [MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`); awaiting production migration 049 and smoke]

Dataverse admin adds the artifact-type value; mirror in `requestDocument.js`; mint + finalize
routes; `feedback:` document member; Superseded-on-delete. Tier 1, same branch or a follow-on.

### Slice 3 — staff attachment access and polish [SOURCE-BUILT + FRESH-REVIEW APPROVED 2026-09-14 on `codex/consultant-feedback-slice-3`; awaiting owner merge]

- Authenticated staff can open a PDF inline or download a DOCX from the Reviews tab. The browser
  sends only request GUID + feedback-entry id; the service re-proves active request membership,
  exact registry cardinality, Consultant Feedback artifact type, Ready/non-Superseded state, and
  server-owned Graph pointers before downloading. Shared is deliberately not required for staff.
- All / Shared / Not shared filtering is local, count-labeled, defaults to All, and resets when the
  request changes. It adds no persistence or API query semantics.
- The roster chooser searches consultant name and affiliation and supports Arrow Up/Down, Enter,
  and Escape while preserving the one-off-person path.
- **Deferred:** a consultant profile link. `expertise_roster` has no canonical profile-route key,
  and Expertise Finder is a separately gated app without a stable consultant deep-link. Slice 3
  does not invent a broken URL or broaden access; a future Expertise Finder contract may add one.

## 7. Tests [slice 1 tests BUILT S512 (91 passing across 6 suites); slice 2 tests MERGED TO MAIN 2026-09-14 via PR #295 (`bf6b41be`; source tip `98be7dae`): 169 passing across 10 suites after Opus round 2; slice 3 focused set after fresh-review fixes: 95 passing across 3 suites; post-merge Slice 2 + Slice 3 regression: 190 passing across 8 suites]

- Service: create with roster id / with one-off name (no roster write; assert the roster row
  count is unchanged); **eligibility**: Board, inactive, missing, and stale-dropdown roster ids are
  rejected on create and on author change, accepted unchanged on a body-only edit; one-author and
  has-content check constraints; update and hard delete; live join keeps a deactivated
  consultant's name; one-off entries render their stored name.
- Briefing degraded read: a thrown query on the new table yields `status: 'unavailable'` and the
  page renders the notice; the test's fixture has shared items present so the assertion proves the
  notice replaces content rather than proving absence.
- Slice 2: crash-point and lost-response tests as in §4; delete with the Postgres step failing
  leaves the entry visible and a second delete completes.
- Routes: method guards; GUID rejection; actor from session only; Preview read-only.
- Briefing: section omitted with zero shared items; unshared item never appears in context;
  `feedback:` member 404 for unshared, other-request, Superseded, or non-Ready rows with no Graph
  call; PDF inline vs download.
- Component: default-checked share box; add-person expands fields; delete confirms once.
- Slice 3: active-entry/request/registry membership and file-state negative fixtures before Graph;
  PDF-inline/DOCX-download response headers; local filter counts and reset semantics; attachment
  URLs contain no drive/item coordinates; combobox name/affiliation search and keyboard selection.
- Gates for the surfaces touched: `check:types`, `check:api-routes` (+ self-test), `check:atlas`
  (+ self-test), `check:migrations-manifest`, `check:trust-boundary-guid`,
  `check:route-lifecycle-auth`, `check:route-service-boundary`, `check:doc-symbol-refs`,
  `check:build-claim-freshness`; each gate sequential with its self-test.

## 8. Durable surfaces touched

Migration `048_consultant_feedback.sql` + `lib/db/migrations-manifest.json` + fresh-install v50;
`docs/atlas/postgres-infra-tables.md` and `docs/APPLICATION_STATE_ATLAS.md` rows;
`docs/API_ROUTE_SECURITY_MATRIX.md` rows (three new in slice 1, two more in slice 2, one more in
slice 3, two amended);
`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md` §2.1 gains the section row and §2.3 the member kind;
`docs/SERVICE_AND_UTILITY_CATALOG.md` for the new service; `docs/CANONICAL_COUNTS.md`
(`api-route-file-count` and `requireappaccess-endpoint-count` both shift) with
`check:fact-consistency`; `docs/agent-wiki/topics/` reviewer workbench and external-portal pages; slice 2 also `shared/config/requestDocument.js`,
`docs/atlas/dataverse-wmkf-requestdocument.md`, a migration widening
`portal_upload_staging_scope_check` (precedent: `043_portal_upload_staging_document_scope.sql`),
and `PORTAL_UPLOAD_SCOPES` in `lib/services/portal-upload-staging.js`.

## 9. Open items before build

1. ~~Add-person side effect~~ — resolved 2026-09-14: one-offs stay on the entry (CF6).
2. ~~Dataverse artifact-type option addition~~ — completed in production 2026-09-14 (CF7).
3. `/contract-reconcile` pass on this plan — run 2026-09-14; findings recorded in §10.
4. Codex adversarial review 1 — run 2026-09-14; four findings folded in (§10).
5. Codex adversarial review 2 — run 2026-09-14; five findings folded in with proportionate remedies (§10).
6. Codex adversarial review 3 — run 2026-09-14; agreed on two dispositions, three precision pushbacks folded in (§10). Loop closed.

## 10. Contract-reconcile findings (Mode A, 2026-09-14)

**Surface:** staff-entered consultant feedback per request; entry points Reviews tab component,
three `/api/workbench/consultant-feedback*` routes, two amended external briefing routes;
persistence new Postgres table `consultant_feedback` (+ slice 2 `wmkf_requestdocument` rows);
consumers Reviews tab list, briefing context read model, briefing page section, `document`
member resolver, Atlas/matrix/counts gates. Prior findings verified: none (first pass).

| # | Verdict | Finding | Evidence |
|---|---|---|---|
| 1 | VERIFIED | The `document` member resolver ends in an unconditional `throw notFound()`, so an unknown member (including `feedback:` before it is built) is fail-closed. Adding a `feedback:` prefix branch beside `material:` follows the existing shape. | `briefing-page-service.js:317-384` |
| 2 | VERIFIED | Review HTML is sanitized at write (`submit-service.js`, `manual-review-entry-service.js:105-110`) **and** re-sanitized on read (`review-answers.js` header). The plan's write-and-read sanitization for `body_html` matches the existing contract. | `lib/services/review-answers.js:7-12`; `lib/external/sanitize-review-html.js:84` |
| 3 | VERIFIED, changed | `check:atlas` finds tables by the regex `CREATE TABLE IF NOT EXISTS`; the v49 block uses that form. §4 SQL changed to `IF NOT EXISTS` for the table and index. New table must be added to `docs/atlas/postgres-infra-tables.md`. | `scripts/check-application-state-atlas.js:97,218-222`; `scripts/setup-database.js:1054-1056` |
| 4 | VERIFIED | `/api/workbench` has `guardAppKeys: null` (heterogeneous), so `check:route-lifecycle-auth` will not pin the new routes; they must still match the sibling convention `requireAppAccess(req, res, 'reviewers')` + `withDalContext`. A `.js` file and a same-named directory coexist in this namespace already (`final-writeup.js` + `final-writeup/`). | `shared/config/appRegistry.js:350-357`; `pages/api/workbench/staff-deliberations.js:12-23`; `ls pages/api/workbench` |
| 5 | VERIFIED, changed | `docs/CANONICAL_COUNTS.md` registers `api-route-file-count` and `requireappaccess-endpoint-count`; three new route files shift both. Added to §8. | `docs/CANONICAL_COUNTS.md:33-43` |
| 6 | VERIFIED, changed | The Reviews tab guards every post-await state write with a `fetchIdRef` generation counter. The new component must copy it; added to §3.5. | `ReviewsTab.js:786-807` |
| 7 | VERIFIED | `RichReviewEditor` is standalone (`value`, `onChange`, `disabled`, labels) and needs no question-set context, so it is reusable for the body field. | `shared/components/external/RichReviewEditor.js:79-86` |
| 8 | VERIFIED, changed | `loadMaterials` swallows failures to `[]`. The plan now states the same degrade-and-log policy for the feedback section rather than leaving it implicit. | `briefing-page-service.js:283` |
| 9 | VERIFIED | `expertise_roster` and the new table share the one Postgres database (`@vercel/postgres` `sql`), so the FK and live join are same-store. Roster is read-only in this feature (CF6). | `recipient-directory-service.js:8-31`; writers grep: `pages/api/expertise-finder/roster.js`, `scripts/seed-expertise-roster.js` only |
| 10 | PLANNED, fan-out named | Slice 2's new artifact-type value `100000008` must be added to **both** maps in `shared/config/requestDocument.js` and the briefing `eligibleMaterialRow` allowlist must **not** gain it (the `material:` kind stays narrow). At build time grep the raw field `wmkf_artifacttype` for every reader (Proposal tab Documents section, `ArtifactFileMetadata`, dossier/site-visit readers) and confirm each either ignores or labels the new value; allowlist readers exclude it by default, denylist readers would fail open. | `shared/config/requestDocument.js:10-29`; `briefing-page-service.js:186-187,225` |

**Audits:** whole-flow traced (1 staff → 2 component state → 3 JSON body → 4 route guard/GUID →
5 service → 6 PG write/read → 7 JSON → 8 tab list and briefing section → 9 gates). Partial-success:
slice 1 mutations are single-row and single-store (N/A); slice 2 finalize and delete span three
stores and are covered by the §4 lifecycle table and the §3.6 ordering rule (corrected after Codex
AR-1 finding 2). Async/stale: finding 6. Helper-extraction N/A (no shared helper
extracted; `sanitizeReviewHtml` reused unchanged). Durable-surface: findings 3, 5, plus §8.
Doc-reconcile: §8 lists every restatement; run `/sweep` after slice 1 lands. Symbol fan-out:
`shared` has three readers (tab list, context, member resolver), all named; artifact type is
finding 10.

**Verdict (pass 1): READY TO IMPLEMENT (slice 1)** with the changes above already folded into
§3–§8. Slice 2 remains blocked on the option-set addition (CF7) and finding 10's read-side sweep.

### Codex adversarial review 1 (2026-09-14, gpt-5.6-sol, base `9994e1f1`) — disposition

| Codex finding | Severity | Disposition |
|---|---|---|
| Attachment-only creation is circular (generation key needed the feedback row id, which cannot exist before the file) | high | **Accepted.** Key now uses the staging id; full lifecycle table added to §4 with durable identity after every step, recovery per failure, and crash-point/lost-response tests. Slice 2 only. |
| Slice 2 delete spans two stores with no ordering or compensation; "partial success N/A" was wrong | high | **Accepted with a lighter remedy.** Supersede-first ordering with idempotent steps and a visible, retryable failure (§3.6) instead of a tombstone row and retry ledger; keeps CF5. Audit text corrected. |
| Submitted roster id not enforced as an active consultant | high | **Accepted.** Server-side eligibility query on create and author change (§3.2); unfiltered join retained for reads and body-only edits. Slice 1. |
| Database failure renders as "no feedback" | medium | **Accepted, narrowed.** Explicit `unavailable` status with a visible notice (§3.3). Noted that a full Postgres outage fails link verification first, so the realistic case is a fault on the new table. Slice 1. |

**Verdict (pass 2, after folding AR-1): READY TO IMPLEMENT (slice 1).** Slice 2 now has a written
lifecycle and is blocked only on CF7 and the finding 10 read-side sweep.

### Codex adversarial review 2 (2026-09-14, gpt-5.6-sol, base `9994e1f1`) — disposition

Proportionality note recorded for the third review: this feature holds a handful of informal
items per proposal, written by a few authenticated staff, read internally. Codex's remedies were
correct on mechanism; where a lighter mechanism gives the same guarantee for this scale, the
lighter one was chosen and the reasoning is stated.

| Codex finding | Severity | Disposition |
|---|---|---|
| Expired staging rows never discard a recorded SharePoint candidate; orphaned file after a crash post-Graph-upload | high | **Accepted as a shared-service prerequisite** (§4). Verified in source. Fix belongs in `cleanupExpiredPortalUploads` and benefits the two existing scopes; landed separately before slice 2. |
| Two finalizes with distinct staging ids, or finalize vs delete, race on one entry | high | **Accepted with a row lock.** `FOR UPDATE` on the entry during step 7 and during delete step 1; the loser supersedes its own registry row and discards its Graph item (§4 step 7). Concurrency tests added. Chosen over an attachment-version CAS because the lock is one line and the write rate is human. |
| Supersede-first delete can stay half-done with no durable intent | high | **Accepted with a `deleting` status, not an outbox job** (§3.6). Intent is durable in the row, readers hide it immediately, and the tab's list route finishes any pending delete on the next load. Same guarantee (eventual completion, never externally visible half-state) without a job runner; CF5 preserved since the row disappears on completion. |
| Finalize inserts attachment-only rows outside the eligibility check | high | **Accepted.** One eligibility path for every insert/author change; finalize calls the service, never the table (§3.2). *Superseded by §3.2 as built: two functions, `writeFeedbackEntry` + `updateFeedbackEntry`, sharing the eligibility helpers.* |
| Slice 1 create not idempotent on lost response | medium | **Accepted.** `mutation_id` column, unique per request, `ON CONFLICT DO NOTHING` + replay (§3.1, §4). |

### Codex adversarial review 3 (2026-09-14, gpt-5.6-sol, agree-or-push-back on the AR-2 dispositions)

| Disposition | Codex | Result |
|---|---|---|
| (a) row lock instead of version CAS | PUSH BACK: lock is void without an explicit same-client transaction | **Accepted**; transaction boundaries written into §4 step 7 and §3.6 step 1 |
| (b) `deleting` status + sweep instead of outbox | **AGREE** | unchanged |
| (c) orphan cleanup in the shared staging service | PUSH BACK: one generation-key lookup cannot serve every scope; unbound Ready registry row must be Superseded before the file is discarded | **Accepted**; scope-specific fail-closed reconciliation and Superseded-before-discard written into §4 |
| (d) `mutation_id` + `ON CONFLICT` | PUSH BACK: only works if the client keeps one id across ambiguous retries | **Accepted**; allocation/retention/rotation lifecycle and a lost-response test written into §3.1 |
| (e) one `writeFeedbackEntry` primitive | **AGREE** | unchanged in intent; *as built (§3.2) the guarantee is one shared eligibility path across `writeFeedbackEntry` and `updateFeedbackEntry`* |

No new mechanism was requested; every pushback was a precision gap in how a chosen remedy was
specified. Review loop closed at three passes.

**Verdict (pass 4, after folding AR-3): READY TO IMPLEMENT (slice 1)** with `mutation_id`
(client lifecycle defined), `status`, and one shared eligibility path (*as built: two write
functions, see §3.2*). Slice 2 blocked on CF7, the finding 10 read-side sweep,
and the staging-service cleanup prerequisite.

### Slice 2 reviews (2026-09-14) — disposition

Sonnet build; Opus review round 1 (CHANGES REQUIRED: loser cleanup fired on every bind error; sweep
regressed prune for consumed rows; filename dependencies unwired + `replace` overwrite; ambiguous
lookups fail-open; test gaps; fresh-install scope list) → all fixed; Opus round 2 APPROVE. Then Codex
adversarial review of commit `dd5f1611` and the coordinator's own review, reconciled:

| Finding | Source | Disposition |
|---|---|---|
| Re-binding the identical registry id was treated as a conflict, so a crash between bind commit and `completePortalUpload` + retry would supersede the bound row and delete its file | Codex (high), Claude | **Fixed:** identical id = idempotent success; delete-wins race gets `attachment_target_gone` (409, loser cleanup); unique-violation on `requestdocument_id` in create resolves to the existing row |
| Step-5 retry uploaded again and overwrote the recorded candidate, losing the first item's cleanup identity | Codex (high) | **Fixed:** finalize reuses a recorded candidate with the same generation key (one Graph upload total); a mismatched candidate is discarded and cleared before a new upload. Inherent window between Graph accept and candidate record remains (same as materials) |
| Grantee scopes always retained → interrupted grantee finalizes never expire (regression vs base); site-visit proof lacked slot ownership | Codex (high); Opus residual | **Fixed:** per-scope proofs implemented (deliverable image ref; registry row + current slot holder); unknown shapes still retained |
| `feedback:` member did not require the Consultant Feedback artifact type or file pointers | Codex (medium) | **Fixed** with negative fixtures |
| >25 attachments: `findByIds` cap turned into a silent empty map | Codex (medium) | **Fixed:** chunked reads; failed batch → `attachment.status='unavailable'` for those ids |
| Registry rows omitted `wmkf_cyclecode` | Codex (medium) | **Fixed** (`meetingDateToCycleCode`, as materials do) |
| `folder_unavailable` classified permanent | Claude | **Fixed:** released for retry |
| Plan still said slice 2 planned/blocked | Codex (medium) | **Fixed** in this pass (section labels, §2 artifact value, summary) |
| Staff cannot download an attachment from the Workbench (plain label) | Opus B13 | **Fixed in slice 3:** dedicated authenticated proxy accepts request + feedback-entry identity only and independently re-proves the Postgres and registry membership chain before Graph |
| Bound-candidate clear bumps `updated_at`, delaying prune one retention cycle | Opus residual | Accepted |

### Slice 3 fresh reviews (2026-09-14) — disposition

After integrating PR #295/main, a fresh Codex review returned one P1 and four P2 findings. The
branch fixed all five: request-keyed rendering plus save/upload generation guards; known-lifecycle
fail-closed registry checks; the shared Unicode-safe `Content-Disposition` helper; one shared
download-eligibility predicate for list links and Graph reads; and canonical Atlas/CF7 status
reconciliation. Direct regression coverage rose to 95 passing tests across the three changed
suites and 190 across the eight-suite Slice 2 + Slice 3 set. A second fresh closeout review found
four missing Persistence cells in the security matrix; the rows were repaired, the delete
lifecycle wording was checked against source, and the final closeout verdict was **APPROVE**.
