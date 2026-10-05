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
**SOURCE-BUILT on `feature/staff-materials-replacement`
(2026-10-05), not merged or deployed; see §7.** This is Tier 1 runtime work:
branch, PR, owner merge.

## 1. What the owner asked for (2026-10-05)

PIs sometimes email an updated deck after the contributor link has closed. On
1003222 the on-file slide PDF was a dummy, and staff had no way to replace it.

Owner decisions, 2026-10-05:

1. **Staff upload it.** A program coordinator uploads the file the PI sent,
   from the Applicant materials card. It works after the link expires. The PI
   gets no new link.
2. **All slots:** presentation PDF, presentation source, participant bios, and
   other materials, **including waived slots** (owner, 2026-10-05: an item is
   sometimes waived only to move forward, and the file arrives later).
3. **Summary note, not hide.** If the slide PDF is replaced after a
   presentation summary was published, the summary stays published, and staff
   see that the slides changed since it was made. Staff can click Summarize
   again.

`docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` never decided staff upload
[VERIFIED via `rg -i "staff upload|on behalf|coordinator upload"`, no hits].
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

### The background path is token-bound (why staff uploads stay inline)

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
     closed); the slot is any checklist key, waived or not, or `other` when
     enabled;
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
- `wmkf_name` ends in "(staff upload)" (nothing reads the "(applicant upload)"
  literal [VERIFIED via `rg "applicant upload"`: only the writer at
  `contributor-service.js:500`]);
- the collection-state check is skipped, because staff authorization replaces
  the token;
- a waived slot is accepted. Today's slot check rejects waived items
  [VERIFIED `contributor-service.js:318`]; the contributor branch keeps that.

It keeps the following unchanged: the producer, the folder, the canonical
filename, the generation key, the scan, the slot lease, and the supersede step.
`check:request-document-writers` records the new actor policy.

### 3.3 Staff uploads finalize inline (owner decision 2026-10-05)

`staff-finalize` calls `finalizeMaterialUpload` directly within the request,
using the same 300-second budget as the contributor route
[VERIFIED `pages/api/external/materials/[token]/finalize.js:45`]. It never
enqueues a background job. As a result, the token-bound job contract in 2.2 is
untouched: there is no migration and no relaxed check. The signed-in session
supplies the staff system user, so `REQUIRED` resolves its actor the way the
grantee precedent does
[VERIFIED `lib/services/request-document-actor-service.js:65-74, 104`].

Why inline is acceptable for staff:
- **Proven at size:** PR #400 made a 326,914,310-byte PPTX complete inline
  (applicant materials plan §16.14, memory
  `project-site-visit-materials-planning-handoff`).
- **Timing:** the first real large Production job took about 2m44s end to
  end, about 1m20s of it in the scan
  (`docs/plans/MATERIALS_BACKGROUND_PROCESSING_PLAN_2026-10-01.md:20`).
- **Usage:** staff uploads are occasional and made by one coordinator.

Costs, accepted:
- The staff member keeps the page open while it runs.
- A timeout, or an upload overlapping an applicant job's memory use, surfaces
  as a retryable error. Retry reuses the staged bytes and the generation key,
  so it does not create a second row [VERIFIED generation key
  `contributor-service.js:396` keys on the staging id].

**Revisit trigger:** if staff hit timeouts in practice, add a staff admission
kind to the background jobs. That design (nullable `token_digest`, an
`admission_kind`, a recorded `actor_system_user_id`, a staff rule in
`admittedCollectionStillValid`, and no ready-to-open flip) is recorded in
this plan's git history at `5106fd54a`.

**Interaction with an active applicant job:** `acquireSlotLease` locks the
collection row and takes a per-request advisory lock. It returns no lease while
another live lease holds the slot, or while a queued, processing or
needs-attention job exists for a non-`other` slot
[VERIFIED `lib/services/site-visit-materials/collection-store.js:258-288`]. So
a staff upload on a busy slot is refused rather than racing; the card says to
try again once the applicant's upload finishes.

**Staging scope:** reuse `site_visit_material` with the `profile:<id>`
binding, so the existing candidate reconciler
(`portal-upload-staging.js:870`) and cleanup cover staff rows unchanged.
The reconciler and maintenance never assume a `materials:` binding: the
binding is only compared on claim [VERIFIED
`lib/services/portal-upload-staging.js:188-227`]. If they do, add a
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

- **Migration (the only one in this plan):** add `slides_artifact_id UUID NULL` and
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
| A staff upload never reopens or extends the applicant link, and never enqueues a job | test: a ready or closed collection stays ready or closed after a staff finalize; no `materials_upload_jobs` row is written |
| The contributor path is unchanged | the existing contributor finalize and drain suites pass unmodified |
| An unknown `uploader.kind` fails closed | test |
| Staff may fill a waived slot; contributors still may not | tests: a staff upload to a waived slot succeeds; a contributor upload to the same slot is refused |
| A staff row records the uploader | test: the row is created with `REQUIRED` and the session's system user; a session without one is refused before any byte work |
| A staff-uploaded APPLICANT_SLIDES PDF is what `readSlidesText` and the Board page read | test with a staff-produced row (same producer) |
| The slides-changed note is decided by row id and hash, not by timestamp | test: replace the slides after publish, and the flag turns true |

## 5. Owner-run steps

1. The migration for the summary-drafts columns (3.5;
   `node scripts/apply-migrations.js`).

No Dataverse schema change is needed: no new picklist value and no new column.

## 6. Open items

1. ~~Waived slots~~ **Decided 2026-10-05:** staff may upload to a waived
   slot. The waiver flag is left as it is; there is no extra collection write.
   The card already shows a received file on a waived row
   [VERIFIED `SiteVisitMaterialsCard.js:267-269`]. At build time, drop the
   strike-through when a waived slot has a file. Readers that pick a file by
   artifact type (the summary slides reader, the Board page) do not consult
   the waiver.
2. Migration numbering with Stage 3 of the summaries plan: whichever branch
   applies first takes 071 (memory `project-migration-numbers-claimed-off-main`).
3. Reviews: `/contract-reconcile` Mode B during the build, and a Codex
   adversarial round on the PR. The focus is the staff branch of
   `finalizeMaterialUpload`, which skips the collection-state and waiver
   checks, because exemptions are where fail-open hides.

## 7. Build record, 2026-10-05 (Session 577)

Branch `feature/staff-materials-replacement`, cut from `main` at `a93974cdf`.

1. **Server** (`737249ed2`):
   - `staff-upload-token` and `staff-finalize` under
     `/api/meeting-tracker/visits/[requestId]/materials/`.
   - `finalizeMaterialUpload` gains an explicit `uploader`. Anything other than
     `contributor`, or `staff` with a GUID system user, fails closed, and a
     staff uploader with a background job is refused.
   - Writer-gate note, matrix rows, canonical counts.
   - The waived-slot and unknown-uploader guards were mutation-checked: each
     mutation turned the suite red.
2. **Card** (`5c2f8354d`): `StaffMaterialUpload` on every checklist row, in
   any collection state, disabled while that slot has a blocking applicant
   job. The staff read exposes `uploadedByStaff` from `_wmkf_initiatedby_value`.
3. **Slides-changed note** (`f99376e43`):
   - Migration 071; `summary-slides-identity.js`.
   - `slidesChangedSinceSummary` on the summary-draft GET, and `slidesChanged`
     on the Staff Deliberations feed.
   - The 071 CHECK was exercised against a throwaway Postgres 16 with seven
     cases. It first accepted an id without a hash (`NULL ~ regex` is NULL);
     fixed with an explicit `IS NOT NULL`.

**Verification:**
- Full unit suite: 1,239 suites, 20,090 tests passed.
- Gates passed with sequential self-tests: `api-routes`,
  `route-lifecycle-auth`, `trust-boundary-guid`, `request-document-writers`,
  `route-service-boundary`, `dataverse-access-layer`,
  `dynamics-context-boundary`, `model-override-warming`,
  `migrations-manifest`, `types`, and the docs gates.

**Before merge (owner-run):**
- Apply migration 071 (`node scripts/apply-migrations.js`). The new summary
  insert writes its columns.

**Codex adversarial review (2026-10-05), round 1: needs-attention, one medium finding.**

- **Finding:** after a retryable or lost `staff-finalize`, the card forgot the
  staging id. The next attempt minted a new staging row, so a `supersede_failed`
  partial success could leave the predecessor active, and a lost success
  response could produce a duplicate row.
- **Fix:** `StaffMaterialUpload` keeps `{stagingId, slot}` after any retryable
  outcome and offers Retry, which re-finalizes the same staging row. Retryable
  means a thrown/lost response, a 5xx, a 409 or a 429. A 4xx other than 409/429,
  or a success, clears it. This is the same rule as the applicant page.
- **Tests:** a lost response followed by Retry, and `supersede_failed`
  followed by Retry; both show one blob upload and two finalizes with the same
  staging id. A final 422 offers no Retry. Each retention guard was
  mutation-checked.
- **Round 2 (needs-attention, one medium):** the file chooser stayed enabled
  beside Retry, so choosing file C discarded B's staging id. C then superseded
  only B, and predecessor A stayed current.
  - **Fix (implemented by Codex rescue, reviewed by Claude):** while a finalize
    is unresolved, the upload button and file input are disabled, a line says
    to press Retry first, and `upload()` refuses without minting a token.
  - **Tests:** the regression covers 503 → choosing C → Retry with the original
    staging id; after a terminal 422 the controls are enabled again. The
    defensive guard and the disabled controls were each mutation-checked
    separately.
- **Limitation:** the staged id is held in component memory only. A page
  reload, or switching to another request or slot, loses it. The staging row
  then expires; the slot keeps whichever file is current. After a
  `supersede_failed`, that can be the new file beside the old one, until a
  later upload to the same slot supersedes the newest receipt only.

**Behaviour notes for review:**
- **`other` is add-only.** `finalizeMaterialUpload` supersedes nothing for
  `other`, and the slot lease does not serialize it against jobs
  [VERIFIED `collection-store.js:281`]. So "Add other file" appends a file and
  never replaces a specific one. Per-file replacement of `other` would need its
  own design. The slot is hidden in Production
  (`SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED` false), and both staff routes
  refuse it before minting.
- **Non-staging load errors release the staging row.** When
  `loadClaimedPortalImage` throws an error that is not a staging error,
  `staff-finalize` releases the row and rethrows, so a Retry can claim it
  again. The contributor route rethrows without releasing (`finalize.js:179-191`).
  This difference is deliberate.

**Known gap, not addressed here:**
- `scripts/setup-database.js` already lacked the fresh-install shape for 061,
  064, 070 and the 068/069 constraint changes. 071 follows that state rather
  than half-fixing it. `apply-migrations.js` still applies every file after a
  fresh install.

