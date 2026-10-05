---
title: Staff replacement upload for Site Visit applicant materials
domain: meeting-tracker
kind: plan
status: draft
summary: "Let a program coordinator upload an updated applicant file (any checklist slot or other) on the PI's behalf, including after the contributor link has closed, through the existing scan/SharePoint/registry pipeline; and tell staff when a published presentation summary was made from slides that have since been replaced."
owner: product-engineering
related:
  - docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
  - docs/plans/MATERIALS_BACKGROUND_PROCESSING_PLAN_2026-10-01.md
  - docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
---

# Staff replacement upload for Site Visit applicant materials

Drafted 2026-10-05 (Session 577) after Stage 2 acceptance on 1003222. Status:
**PLANNED, not built.** This is Tier 1 runtime work: branch, PR, owner merge.

## 1. What the owner asked for (2026-10-05)

PIs sometimes email an updated deck after the contributor link has closed. On
1003222 the on-file slide PDF was a dummy, and staff had no way to replace it.

Owner decisions, 2026-10-05:

1. **Staff upload it.** A program coordinator uploads the file the PI sent,
   from the Applicant materials card. It works after the link expires. The PI
   gets no new link.
2. **All slots:** presentation PDF, presentation source, participant bios, and
   other materials.
3. **Summary note, not hide.** If the slide PDF is replaced after a
   presentation summary was published, the summary stays published, and staff
   see that the slides changed since it was made. Staff can click Summarize
   again.

`docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` never decided staff upload
[VERIFIED: grep for staff upload, on behalf, coordinator, replace].
- Line 443 requires applicant replacement only.
- Lines 806-808 describe staff placing files "by hand through AkoyaGo", and
  those files get no registry row.

## 2. Current contract (traced 2026-10-05)

### Contributor path

- **Auth.** `verifyMaterialsToken` rejects `status = closed` and
  `closes_at <= now` [VERIFIED `lib/external/verify-materials-token.js:34-35`].
  `upload-token.js` and `finalize.js` both call it first
  [VERIFIED `pages/api/external/materials/[token]/upload-token.js:29-36`,
  `finalize.js:70-77`].
- **Staging.** Scope `site_visit_material`; `resource_id` is the request;
  `actor_binding` is `materials:<sha256(token)>`
  [VERIFIED `upload-token.js:53-61`, `lib/services/portal-upload-staging.js:98-100`].
  The table has no profile column; `actor_binding` is the only identity.
- **Inline vs background.** Finalize enqueues a background job when background
  admission and the virus scan are both enabled; otherwise it calls
  `finalizeMaterialUpload` inline [VERIFIED `finalize.js:84, 139-148, 196-204`].

### The background path is token-bound (blocker for a staff path)

1. `enqueueMaterialsUploadJob` selects the collection with
   `token_digest = $3 AND status <> 'closed' AND closes_at > clock_timestamp()`
   and throws `collection_not_open` otherwise
   [VERIFIED `lib/services/site-visit-materials/background-job-store.js:125-133`].
2. `materials_upload_jobs.token_digest` is `CHAR(64) NOT NULL`
   [VERIFIED `lib/db/migrations/060_materials_background_jobs.sql:17`].
3. The drain's `admittedCollectionStillValid` requires
   `collection.token_digest === job.token_digest`. It fails an explicitly
   closed collection, but tolerates a natural expiry after admission
   [VERIFIED `lib/services/site-visit-materials/background-job-drain.js:161-175`].
4. Enqueue also flips a `ready` collection back to `open`
   [VERIFIED `background-job-store.js:222-230`; `reopenFromReady`
   at `collection-store.js:230`].

### `finalizeMaterialUpload` does not check the collection state

It checks only that the slot is open (not waived, or `other` behind its
flag) and that the ids are present
[VERIFIED `lib/services/site-visit-materials/contributor-service.js:316-320`].
For the registry row it writes:

- `wmkf_producer = 'site-visit-materials-portal'`;
- `wmkf_name` ending in the literal "(applicant upload)";
- actor policy `EXTERNAL_CONTRIBUTOR`, which resolves no actor;
- generation key `sha256("site-visit-materials:<request>:<slot>:<stagingId>")`;
- then it supersedes the slot's previous row
  [VERIFIED `contributor-service.js:498-522`, `:209-216`; generation key `:396`].

Nothing records whether an applicant or staff uploaded the file.

### Readers that must keep seeing a replaced file

- **`matchReceivedFiles`:** the newest READY, non-superseded canonical row; no
  producer check. It feeds the staff card, reminders, the summary reader and
  folder listings [per trace, `materials-matching.js:36-58`].
- **`readSlidesText`** (presentation summary input): filters
  `producer === 'site-visit-materials-portal'`, APPLICANT_SLIDES, READY, not
  superseded, `application/pdf`; picks the newest by `createdon`
  [VERIFIED `transcript-summary-service.js:178-198`].
- **The Board presentation page** also filters on that producer
  [per trace, `presentation-page-service.js:82`].
- **Briefing page, Pre-Site distribution and the logistics feed** select by
  artifact type [per trace].

**Consequence:** a staff upload must keep `wmkf_producer =
'site-visit-materials-portal'`. Otherwise the summary input and the Board
page silently stop seeing it.

### Which slides a summary used is not recorded

The drafts table holds `source_revision_id`, `presentation_end_ms` and
`source_artifact_id` (the transcript); the published fingerprint covers
request, revision and end only. `slidesIncluded` is returned but not
persisted [VERIFIED `transcript-summary-service.js:275, 380-381`;
`070_meeting_transcript_summary_drafts.sql:14-22`].

### Precedent: grantee image staff replacement

`replacement-upload-token.js` and `replace-submission.js` work as follows:

- `requireAppAccess` gate;
- scope `staff_grantee_image`;
- `actorBinding = profile:<id>` from the session;
- a stored `original_etag`;
- the claim matches on scope, resource and binding;
- finalize re-authorizes and rejects as `stale` when the ETag moved;
- `actingUserSystemId` comes from the session.

[per trace, `pages/api/workbench/grantee-deliverables/replacement-upload-token.js:28-63`,
`replace-submission.js:59-126`]

## 3. Design

### 3.1 Staff routes (under `meeting-tracker`)

1. `POST /api/meeting-tracker/visits/[requestId]/materials/staff-upload-token`
   - Guards: GUID edge validation, `requireAppAccess('meeting-tracker')`, the
     literal-on schema gate.
   - Body allowlist: `slot, filename, contentType, size`.
   - Server checks: a collection exists for the request (open, ready or
     closed); the slot is a non-waived checklist key, or `other` when enabled;
     the extension is allowed for the slot; the size is within the cap.
   - Mint: `createPortalUpload` with a staff binding `profile:<id>` from the
     session, never from the body.
2. `POST .../materials/staff-finalize`
   - Body: `stagingId, slot`.
   - Claims the staging row on the same scope, request and staff binding.
   - Re-reads the collection and slot server-side; nothing from the client is
     trusted.
   - Hands off to the same pipeline as the contributor (3.2).

Both routes need API matrix rows, `check:route-lifecycle-auth` coverage, and
`check:trust-boundary-guid` coverage.

### 3.2 One pipeline, an explicit uploader kind

`finalizeMaterialUpload` gains an `uploader` argument with exactly two values:

- `{ kind: 'contributor' }`, which is today's behavior;
- `{ kind: 'staff', actorId }`, with `actorId` from the session.

Any other value throws, so the branch is not fail-open. For staff it changes
only three things:

- the actor policy is `REQUIRED` with the staff system user, so
  `wmkf_initiatedby` records who uploaded;
- `wmkf_name` ends in "(staff upload)";
- the collection-state check is skipped, because staff authorization replaces
  the token.

It keeps the following unchanged: the producer, the folder, the canonical
filename, the generation key, the scan, the slot lease, and the supersede step.
`check:request-document-writers` records the new actor policy.

### 3.3 Background processing for staff uploads (the main build decision)

Large decks need the background path; a 300+ MB PPTX exhausted inline
finalize memory before PR #400 (applicant materials plan §16.14). Staff jobs
cannot satisfy the token checks in 2.2, so the job contract needs a second
admission kind. **Migration (next free number at build time; 071 if Stage 3
has not taken it):**

- **Jobs table:** add `admission_kind TEXT NOT NULL DEFAULT 'contributor'
  CHECK (admission_kind IN ('contributor','staff'))`. Make `token_digest`
  nullable, with a CHECK that it is present if and only if
  `admission_kind = 'contributor'`.
- **Enqueue:** a staff job requires a collection that exists, but not a
  token match or an open status. It must **not** flip `ready` to `open`, so a
  staff replacement never reopens the applicant link.
- **Drain:** `admittedCollectionStillValid` keeps today's rule for contributor
  jobs. For staff jobs it requires the same collection and request and an open
  slot, and ignores token and status.
- **Fresh install:** `scripts/setup-database.js` gets the same change.

Alternative: staff uploads always run inline, with no migration. Rejected
because it reintroduces the large-file memory failure for exactly the files
staff will upload.

**Staging scope:** reuse `site_visit_material` with the `profile:<id>`
binding, so the existing candidate reconciler
(`portal-upload-staging.js:870`) and cleanup cover staff rows unchanged.
Before building, verify that the reconciler and maintenance never assume a
`materials:` binding [ASSUMED until read]. If they do, add a
`staff_site_visit_material` scope; that also requires a CHECK migration on
`portal_upload_staging.scope`, last changed in 055.

### 3.4 Card UI

The Applicant materials card (`SiteVisitMaterialsCard.js`) gets an "Upload
updated file" action on each slot row, plus an "Add other file" action.
These show whether the collection is open, ready or closed. They use the
existing browser-direct upload helper, show progress and the scan outcome,
and refresh the row. The row shows "Uploaded by staff" when
`wmkf_initiatedby` is set.

### 3.5 "Slides changed" note on the presentation summary

- **Migration (with 3.3):** add `slides_artifact_id UUID NULL` and
  `slides_content_hash CHAR(64) NULL` to `meeting_transcript_summary_drafts`.
- **Write:** `createPresentationSummaryDraft` stores the slides row's id and
  `wmkf_contenthash` when `readSlidesText` used one, and NULLs otherwise. The
  columns survive publish, because only the text column is cleared.
- **Read:** the staff GET compares the published summary's draft against the
  current `readSlidesText` pick (row id and hash). It returns
  `slidesChangedSinceSummary: true` when slides were used and now differ, or
  when none were used and a slide PDF now exists. The card and Staff
  Deliberations show "The slides were updated after this summary was made.
  Summarize again to include them."
- **Outside pages:** unchanged (owner decision 3).

Summaries published before this migration have NULL columns. They show no
note, and that limitation is recorded rather than guessed at.

## 4. Invariants (build guardrail)

| Invariant | Verification |
|---|---|
| A staff upload needs `meeting-tracker` access, and the staff binding comes only from the session | route tests: a body-supplied actor is ignored; a wrong profile cannot claim another's staging row |
| A staff upload never reopens or extends the applicant link | test: a ready or closed collection stays ready or closed after staff enqueue and drain |
| Contributor jobs keep every token check | test: a contributor job with a changed `token_digest` still settles `collection_or_token_changed` |
| An unknown `uploader.kind` or `admission_kind` fails closed | tests on both switches |
| A staff-uploaded APPLICANT_SLIDES PDF is what `readSlidesText` and the Board page read | test with a staff-produced row (same producer) |
| The slides-changed note is decided by row id and hash, not by timestamp | test: replace the slides after publish, and the flag turns true |

## 5. Owner-run steps

1. The migration (`node scripts/apply-migrations.js`).

No Dataverse schema change is needed: no new picklist value and no new column.

## 6. Open items

1. Waived slots: a closed collection hides the waive controls
   (`SiteVisitMaterialsCard.js:274`). If a PI sends a file for a waived item,
   staff would need to un-waive it first. This plan keeps the existing rule:
   no upload to a waived slot.
2. Migration numbering with Stage 3 of the summaries plan: whichever branch
   applies first takes 071 (memory `project-migration-numbers-claimed-off-main`).
3. Reviews before build: `/contract-reconcile` Mode B and a Codex
   adversarial round on the enqueue/drain admission change, because it
   relaxes a gate (2.2) and exemptions are where fail-open hides.
