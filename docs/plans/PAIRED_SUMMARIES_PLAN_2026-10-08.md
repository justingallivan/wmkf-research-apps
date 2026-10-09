---
title: Paired presentation and staff discussion summaries (Stage 2)
domain: transcription
kind: plan
status: proposed
summary: "One staff action drafts both a presentation summary and a staff-only discussion summary by calling the existing summary-draft routes once per allowlisted kind. Each kind has its own consent record, retry, draft and publish; the server refuses to replace a ready draft unless the request names it. Needs migration 075 (widens one drafts CHECK), artifact type 100000010 inserted in Dataverse, and a new content-free discussion prompt."
owner: product-engineering
related:
  - docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md
  - docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md
  - docs/atlas/postgres-meeting-transcript-summary-drafts.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/EXECUTOR_CONTRACT.md
---

# Paired presentation and staff discussion summaries (Stage 2)

## Status and authority

**Reviewed and revised (Session 588), not built.** The owner answered the review decisions on 2026-10-08; see "Owner decisions". This plan covers Stage 2 of `docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md` §2, which the owner approved on October 7. It does not authorize a migration, Dataverse picklist insert, prompt seed, Production read, provider call, merge or deployment. Each of those is listed below as an owner step.

Migration number **075** is reserved for this stage and 076 for Stage 3b. A scan of all 82 remote-tracking refs after a fresh fetch (`git ls-tree … lib/db/migrations/`, Session 588) found no `075_`–`079_` file. It is re-run before committing (see "Pre-implementation verification").

Stages 0, 1 and 3a are merged to `main` (PRs #464, #467–#470). The workflow plan's stale Stage 3a "not merged" notes were reconciled in Session 588.

## Current flow (source baseline at `ee773977b`)

| Hop | What it does today | Evidence |
|---|---|---|
| Route `summary-draft.js` | GET/POST/PATCH/DELETE. POST exact body `{acknowledgmentVersion, expectedCurrentArtifactId, expectedCurrentFingerprint}`, 256 KB, `maxDuration` 300; guard `requireAppAccess(…'meeting-tracker')`, linked profile, `withDalContext`, actor from session | [VERIFIED via `pages/api/meeting-tracker/visits/[requestId]/transcriptions/summary-draft.js:11,16-35,43-55`] |
| Route `summary-draft/publish.js` | POST exact `{draftId, expectedVersion}`, 4 KB, `maxDuration` 120 | [VERIFIED via `…/summary-draft/publish.js:8,17-22`] |
| Create | Checks the acknowledgment version, binds the current TRANSCRIPT, requires the bound Presentation Transcript, reads its bytes against the pinned hash and eTag, adds slide text, inserts the `generating` row **before** the provider call, then runs the Executor with `requireNoPersistence: true` and `auditRetention: 'content-free'` | [VERIFIED via `lib/services/post-presentation-materials/transcript-summary-service.js:198-266`, flags at `:238-239`, row at `:222-229`] |
| Get | Active draft, newest run (`lastFailure`), published state, `draftMatchesTranscript` (revision and `endMs` equal current) | [VERIFIED via `transcript-summary-service.js:269-292`] |
| Publish | Claim with a per-request token, slot lease, stale check (`summary_draft_stale`), upload, `markSummaryDraftRegistering`, `createDocument`, `settleWinner`, mark published; release-or-yield on error | [VERIFIED via `transcript-summary-service.js:327-498`; type `TRANSCRIPT_SUMMARY` hardcoded at 14 sites in the file, including `:223,273-274,364,380,394,416,447,468,475,494` (Session 588 grep)] |
| Store | One row per run. `beginSummaryDraft`'s supersede `UPDATE` filters on the given `artifact_type` and supersedes any `ready` row **unconditionally**, clearing its text (this is how a new run discards edits); `ON CONFLICT (request_id, artifact_type)` for active states; abandoned after 360 s (generating) or 180 s (publish claim) | [VERIFIED via `lib/services/post-presentation-materials/summary-draft-store.js:11-53,151-200`] |
| Table | `meeting_transcript_summary_drafts_artifact_type_check CHECK (artifact_type IN (100000007))`; partial unique index on `(request_id, artifact_type)` | [VERIFIED via `lib/db/migrations/070_meeting_transcript_summary_drafts.sql:41-42,61-63`] |
| Binding | `transcriptSummaryBindingFingerprint` = SHA-256 of producer, request, **type**, revision, `endMs`; `bindTranscriptSummary` and `bindStaffDiscussionTranscript` exist | [VERIFIED via `lib/services/post-presentation-materials/presentation-transcript-binding.js:28-34,52-54,118-160`] |
| Discussion transcript | The utterances that end after `endMs` (the exact complement of the presentation half). When there are none, `buildStaffDiscussionTranscriptText` returns null and the writer's `text` falls back to a one-line note | [VERIFIED via `lib/services/meeting-tracker-transcription/presentation-boundary.js:99-111`; `lib/services/post-presentation-materials/presentation-transcript-service.js:258,287`] |
| Service row filter | `bindCurrent` keeps only Transcript, Presentation Transcript and Transcript Summary before projecting, so inside this service the discussion transcript is never bound | [VERIFIED via `transcript-summary-service.js:133-134`, Session 588] |
| Collection DTO | `staffDiscussionTranscript` and `transcriptSummary` states; records filtered to four types | [VERIFIED via `lib/services/meeting-tracker-transcription/service.js:88,99-135`] |
| Card | The summary flow shares the card's `busy` value (`:1043`) and holds one summary state, text, conflict and acknowledgment; `SummaryBlock` sits in the step 3 Presentation group; the Staff discussion group has only a transcript line | [VERIFIED via `shared/components/meeting-tracker/RecordingAndTranscriptCard.js:1043,1593-1600,1703-1745,2310-2360,2669-2683`] |
| Prompt | `meeting-transcript.presentation-summary`; untrusted override variables; `target: none`, `parseMode: raw`, `rawOutputRetention: 'none'`; seeded by script; registered as A7 surface `inv: 33`; standing budget 16,000 tokens / 240 s | [VERIFIED via `shared/config/prompts/meeting-presentation-summary.js:23,57-90`; `scripts/seed-meeting-presentation-summary-prompt.js:62-100`; `scripts/check-prompt-injection-tagging.js:458-469`; `shared/config/executorBudgets.js:79-83,130-133,165-168`] |

## Design decisions

### D1. Kinds are a frozen spec table inside the existing service

Add `SUMMARY_KINDS` to `transcript-summary-service.js`, shaped like `DERIVATIVES` in `presentation-transcript-service.js:265-289`. There are two entries, `presentation` and `discussion`. Each carries its artifact type, folder, label, filename and `wmkf_name` builders, prompt name, accepted acknowledgment versions, input builder, binding function and fingerprint function. Parameterize the existing create/get/publish functions by the spec; do not copy them. Keep exactly one `dependencies.createDocument(` call so `check:request-document-writers` still matches its registered entry [VERIFIED via `scripts/check-request-document-writers.js:46`].

The presentation entry must produce byte-identical generation keys, fingerprints, folder and filenames to today. A golden-hash test pins this.

Widen the service's own `bindCurrent` filter (`:133-134`) to include 100000013 and 100000010, preferably derived from `SUMMARY_KINDS`. Without this every discussion POST fails with `staff_discussion_transcript_not_ready`.

### D2. Route contract: kind on POST and GET only

- **POST** accepts the existing three-key body (meaning `presentation`) plus two optional keys: `kind ∈ {'presentation','discussion'}` and `replaceDraft`, which is `null` or `{draftId: <GUID>, expectedVersion: <integer>}`. Any other value or key is rejected with 400.
- **Server-side draft protection (owner decision 8).** A `ready` draft of the kind is superseded only when `replaceDraft` names its exact id and version. Change `beginSummaryDraft`'s supersede `UPDATE` so a `ready` row matches only `id = replaceDraft.draftId AND version = replaceDraft.expectedVersion`; the `generating`/`publishing` abandonment clauses are unchanged. An unmatched `ready` row stays, the `INSERT` hits the partial unique index (which covers `ready`, `070:61-63`), and the service returns 409 `summary_draft_exists` with that draft's id and version. This happens before any provider call. The paired action always sends `replaceDraft: null`; each kind's **Summarize again** sends the draft it is showing. A tab holding an old version gets 409 and must reload. This also changes today's presentation behavior: an old tab without `replaceDraft` can no longer discard a ready draft.
- **GET** accepts `?kind=`. If it is absent, the kind is `presentation` and the response is unchanged. Any other value, including an array, is 400. This is new code: today `validBody` returns `true` for GET (`summary-draft.js:17`). The discussion response has the same shape plus `kind`, and its `transcriptSummary` key holds that kind's published state. `slidesChangedSinceSummary` is `null` for discussion.
- **PATCH, DELETE and publish** do not change their bodies. The server takes the kind from the stored row's `artifact_type`, never from the client. A row whose type is not in `SUMMARY_KINDS` fails closed with 409.
- No new route. The guards, body caps and `maxDuration` stay as they are, so `check:route-lifecycle-auth` and the route count are unaffected.

### D3. Transcript span for each summary and stale handling

- **Presentation:** unchanged. It uses the bound Presentation Transcript bytes plus optional slides.
- **Discussion:** it uses the bytes of the bound Staff Discussion Transcript row (`bindStaffDiscussionTranscript(...).reason === 'bound'`), read with the same hash-and-eTag check as `readPresentationText`. No slides are included. The span is therefore every utterance ending after the confirmed `endMs` of the current revision, by construction. `source_artifact_id` records the discussion transcript row. `source_revision_id` and `presentation_end_ms` record the same boundary as the presentation run.
- **No confirmed boundary:** both kinds return 409 before any row is created. Presentation keeps `presentation_transcript_not_ready`; discussion returns a new `staff_discussion_transcript_not_ready`, also used when the discussion half is missing or stale. The card shows no Summarize action until step 2 is done.
- **Boundary or revision changes after drafting:** the generic checks already cover both kinds. GET reports `draftMatchesTranscript: false`, and publish refuses with `summary_draft_stale` [VERIFIED via `transcript-summary-service.js:279-280,369-373`].
- **Changes after publishing:** add `staffDiscussionSummaryBindingFingerprint` (type 100000010) and `bindStaffDiscussionSummary`, mirroring `bindTranscriptSummary`. Staff surfaces keep showing a stale discussion summary with the existing "earlier transcript version" note. A names-only republish also makes both summaries stale. This matches the presentation rule (plan §16 decision A; Atlas `dataverse-wmkf-requestdocument.md`, Transcript Summary writer).

### D4. "Not recorded" discussion

The manifest carries no utterance count or last-utterance time, so absence cannot be read cheaply. `validateMeetingTranscriptManifest` in `lib/services/meeting-tracker-transcription/bundle.js` reads only `files`, `revisionId`, `sourceRevisionId`, `presentationEnd`, `schemaVersion`, `formatterVersion` and ids [VERIFIED via grep of `manifest.*` in that function]. The plan forbids matching the note text.

**Decided (owner decision 3, Session 588): a durable marker with no schema change.** On a discussion POST only:
1. Export and call `loadVerifiedSource` (`presentation-transcript-service.js:129-154`) and test `staffDiscussionContent(source.content, endMs).utterances.length === 0`.
2. If it is empty, record the run with `beginSummaryDraft` (consent metadata included) and immediately mark it `failed` with `failure_code = 'staff_discussion_not_recorded'`. There is no provider call. Respond 422 `staff_discussion_not_recorded`.
3. GET already returns the newest run as `lastFailure` (`transcript-summary-service.js:288`). When that run's `source_revision_id` and `presentation_end_ms` match the current boundary, the card shows **Not recorded** and no Summarize action for discussion. A later boundary or revision change makes the marker stale, and Summarize returns.

`failure_code` is free text, so no migration change is needed [agent-reported, Session 588 review]. The source read happens before any row exists, so concurrent discussion clicks each pay one source read but no provider charge.

### D5. Discussion prompt

- **New files (proposed):** `shared/config/prompts/meeting-staff-discussion-summary.js` and `scripts/seed-meeting-staff-discussion-summary-prompt.js`, copied in shape from the presentation pair.
- **Prompt:** name `meeting-transcript.staff-discussion-summary`, model `sonnet`.
- **Variable:** one variable, `discussion_transcript`, with `source: override`, `untrusted: true`, `dataClass: 'meeting_transcript'` and `maxChars` 400,000. The service refuses anything longer before the call.
- **Output:** `outputs: [{ name: 'summary', type: 'string', target: { kind: 'none' } }]`, `parseMode: 'raw'`, `rawOutputRetention: 'none'`.
- **Intent:** a plain-text summary for program staff of the foundation's internal discussion after the applicants left. It covers the main points raised, the questions or concerns staff voiced, and any follow-ups or decisions mentioned. It adds no evaluation, refers to people by role, follows no instructions found in the transcript, and uses three fixed plain headings. The final wording is a build step for the owner to review, alongside the presentation prompt's tone.
- **Governance:** the Executor is required (`docs/EXECUTOR_CONTRACT.md` rows `requireNoPersistence` and `auditRetention`). The caller always passes `requireNoPersistence: true` and `auditRetention: 'content-free'`, the same as `transcript-summary-service.js:238-239`. Content-free applies to every run-row write, including failures and pre-flight blocks [VERIFIED via `docs/EXECUTOR_CONTRACT.md:85`].
- **Registration:**
  - Register it in `scripts/check-prompt-injection-tagging.js` as the next `inv` with the same `requiredMarkers`.
  - Add the name to all three maps in `shared/config/executorBudgets.js`, with the same envelope, and to `tests/unit/executor-budget-service.test.js`.
  - `loadModelOverrides()` is already called before execution (`transcript-summary-service.js:233`).
- **Tests:**
  - A prompt-config test pins `target.kind: 'none'`, `rawOutputRetention: 'none'` and every variable `untrusted: true`.
  - A service test asserts both flags on the discussion `executePrompt` call, including the failure path, where the call still carries both flags.
  - Mutation checks: remove `auditRetention` and the test must fail. Change `target` to `kind: 'field'` and the config test must fail.

### D6. Acknowledgment and consent

Add `PAIRED_SUMMARY_ACKNOWLEDGMENT` to `shared/config/transcriptSummary.js`. One checkbox covers both inputs (accepted UX step 6). Proposed text: the presentation transcript, any applicant slides, and the staff discussion transcript may be sent to Anthropic, and each draft will be reviewed before publication.

Each POST records its own row with its own `acknowledgment_version`, actor and time before its provider call. The presentation kind accepts the existing `presentation-summary-2026-10-05` version and the paired version. The discussion kind accepts only the paired version. An old browser tab therefore keeps working for presentation only. The discussion GET returns `PAIRED_SUMMARY_ACKNOWLEDGMENT`, not the presentation acknowledgment it returns today (`transcript-summary-service.js:286`).

### D7. Persistence

**Postgres (migration `075_summary_drafts_discussion_kind.sql`, proposed):**

```sql
-- Staff Discussion Summary (100000010) drafts share meeting_transcript_summary_drafts
-- with the presentation summary (docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md).
-- Re-declares the CHECK set by 070; the (request_id, artifact_type) unique index
-- already allows one active draft per kind.
ALTER TABLE meeting_transcript_summary_drafts
  DROP CONSTRAINT IF EXISTS meeting_transcript_summary_drafts_artifact_type_check;
ALTER TABLE meeting_transcript_summary_drafts
  ADD CONSTRAINT meeting_transcript_summary_drafts_artifact_type_check
    CHECK (artifact_type IN (100000007, 100000010));
```

- Append `075_summary_drafts_discussion_kind.sql` to `lib/db/migrations-manifest.json`.
- No `scripts/setup-database.js` edit is needed: a fresh install executes every manifest migration [VERIFIED via `scripts/lib/fresh-database-bootstrap.js:98,127-147`].
- Migration 070 is not edited.
- The slot-lease and upload CHECKs already admit 100000010 [VERIFIED via `lib/db/migrations/069_staff_discussion_transcript_type.sql:9-18`], so publish needs no other schema change.
- Discussion rows store `slides_artifact_id`/`slides_content_hash` as NULL. The store writes `slides_recorded = TRUE` unconditionally (`summary-draft-store.js:47`). The 071 CHECK admits this [VERIFIED via `lib/db/migrations/071_summary_draft_slides_identity.sql:14-19`], and `getPublishedSummaryDraft` filters by type (`summary-draft-store.js:71-80`), so the slides-changed reader never sees discussion rows.
- Add `tests/unit/migration-075-summary-drafts-discussion-kind.test.js` mirroring the 069 test.

**Dataverse:**
- Use `STAFF_DISCUSSION_SUMMARY = 100000010`, label "Staff Discussion Summary". Source reserves exactly this value [VERIFIED via `docs/atlas/dataverse-wmkf-requestdocument.md:702-704`; `scripts/extend-requestdocument-artifacttype-staff-discussion-transcript.mjs:12-13`]. It is absent from `shared/config/requestDocument.js:10-23` and from the Wave 16 record (`lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:29-35`).
- Whether the value is free in live Dataverse is **[UNVERIFIED]** (step V1).
- Add the proposed single-purpose sibling script `scripts/extend-requestdocument-artifacttype-staff-discussion-summary.mjs`. It reads, dry-runs by default, runs `--execute`, then re-reads.
- Mirror the value in the Wave 16 record and `requestDocument.js`.
- Add it to `POST_PRESENTATION_ARTIFACT_TYPES` in `material-model.js:15-24` with a staff-only comment.
- Published file: `Site Visit - Staff Discussion Summary/<num>-Staff-Discussion-Summary-<stamp>-v<n>.txt`, `wmkf_name` "… site visit staff discussion summary (staff only)", same producer, prompt/run binding, `wmkf_inputfingerprint` per D3.

### D8. Consumers and staff-only exclusion

**Outside readers.** There are two outside readers, and both select by an explicit two-type allowlist, picking rows only through `bindPresentationTranscript` and `bindTranscriptSummary`. Neither iterates `POST_PRESENTATION_ARTIFACT_TYPES`. Adding 100000010 to that set therefore cannot reach them [VERIFIED via `lib/services/post-presentation-materials/presentation-page-service.js:34-38,90-100,167-168`; `lib/services/deliberation-briefing/briefing-page-service.js:91-104,288-296,779-782`]. The applicant/contributor materials surface selects named types only:
- The folder readers list `SITE_VISIT_MATERIALS_FOLDERS` (Slides, Participant Bios, Other) [VERIFIED via `shared/config/siteVisitMaterials.js:42-47`].
- `matchReceivedFiles` filters each slot's rule by artifact type [VERIFIED via `lib/services/site-visit-materials/materials-matching.js:37-42`].
- `summary-reader.js` reads only Applicant Slides and Other Applicant Materials [VERIFIED via `lib/services/site-visit-materials/summary-reader.js:21-23`].

**Denominator:**
- 43 files under `lib/services` match the request-document adapter grep.
- Only `material-model.js` references `POST_PRESENTATION_ARTIFACT_TYPES` or `isPostPresentationArtifactType` [VERIFIED via grep of `lib`, `shared` and `pages`].
- Its projection is consumed by 8 files [VERIFIED via grep]: the two outside readers above, and 6 staff modules (`material-service`, `logistics-service`, `meeting-tracker-transcription/service`, `transcript-summary-service`, `presentation-transcript-service`, `presentation-transcript-binding`).
- That leaves 7 outside-facing files verified (2 page readers, 5 site-visit-materials files).
- Added in the Session 588 review [agent-reported]:
  - The Pre-Site distribution list (`pre-site-visit/distribution/model.js:23-30`) is a third named-type reader. It is an allowlist without 100000010, and its selection is retired and fails closed (`composition.js:191`).
  - SharePoint folder readers: the external recursive listers return only `Reviewer Materials/Proposal_{num}.pdf` (`lib/external/reviewer-materials.js:39-46,81`; `pages/api/external/review/[token]/proposal.js:114-121`). The other recursive listers are staff tools. No tracked prompt uses a `kind: 'sharepoint'` variable.
  - The other registry readers were spot-checked and select by named type, pointer or id list (`cycle-list-service.js:97-116`, `transition-claims.js:34`, `consultant-feedback-service.js:107`, `share-lock-service.js:69`, `reopen-service.js:208-222`, `meeting-tracker/dashboard-service.js:32`). The build re-checks them.
- **The read side is not enough.** With 14 hardcoded `TRANSCRIPT_SUMMARY` sites, one missed site in the publish path would register discussion text as 100000007, which the outside readers do serve. The write-side tests in test-plan item 7 are therefore required.

**Staff consumers:**
- `lib/services/meeting-tracker-transcription/service.js`: add the type to the `:88` filter, and add `staffDiscussionSummary` beside `transcriptSummary` in the DTO.
- `lib/services/site-visit/logistics-service.js`: add the type to `MATERIAL_TYPES` (`:59-68`). Parameterize `readPresentationSummary` (`:96-123`) so the Workbench response gains `discussionSummary` beside `presentationSummary`.
- `shared/components/workbench/ResearchPresentationFollowUp.js`: add a "Staff discussion summary" slot after the discussion transcript (`:9-10`) and, if the owner wants it (question 5), inline text.
- Audience: the Workbench route is guarded by `requireAppAccess(…'reviewers')` and already shows the staff discussion transcript [VERIFIED via `pages/api/workbench/site-visit/logistics.js:51,66`; `shared/components/workbench/ResearchPresentationFollowUp.js:9`], so the audience does not change.
- `pages/api/workbench/site-visit/logistics.js:77` copies response fields one by one; add `discussionSummary` there [agent-reported].
- The Meeting Tracker materials list (`material-service.js:430,444-458`) will list 100000010 once it joins `POST_PRESENTATION_ARTIFACT_TYPES`. It is staff-only; label it "Staff discussion summary (staff only)" [agent-reported].
- Not touched: `shared/components/Layout.js` and the rehearsal panel.

**Exclusion tests.** Inject a **bound** 100000010 row with a correct fingerprint into the existing discussion fixtures in `tests/unit/presentation-page-service.test.js:227` and `tests/unit/deliberation-briefing-page-service.test.js:1579`. Assert that it is absent from the listing and that opening it by id returns 404. Mutation check: add 100000010 to either outside allowlist and both tests must fail.

### D9. Card (staff UI, desktop-first, plain language)

- **State:** move the summary state (`summary`, `summaryText`, `summaryConflict`, sequence ref, read state, error, notice) into one per-kind hook used twice.
- **One lock for the paired run.** Today `busy` is a single string; `summarize` returns early when it is set (`:1703`) and clears it in `finally` (`:1738`). Two parallel calls would let the first to finish unlock the card while the other is still generating. Instead, one paired handler sets `busy = 'summarize'`, runs the per-kind POSTs with `Promise.allSettled`, and clears `busy` only after both settle. Each kind's in-progress state lives in its hook. Other actions (names, boundary, transcription) stay disabled until both settle. A single-kind **Try again** uses the same handler with one kind.
- **Per-kind load keys.** `summaryLoadKey` (`:1616`) includes the published summary's state and id, and stale responses are dropped (`:1619,1717`). Each kind's key holds only its own published state, its own transcript-half state, and the shared transcript id, fingerprint and `endMs`. Publishing one kind must not discard the other kind's in-flight result or edits.
- **Step 3 Results, top:** when the presentation transcript is bound, show one checkbox with the paired notice and one button, **Summarize presentation and discussion**. It sends a POST for each kind whose transcript half is bound: presentation when `presentationTranscript.state === 'bound'`, discussion when `staffDiscussionTranscript.state === 'bound'`. It skips a kind that already has a current draft or a current published summary (owner decision 2). The server separately refuses to replace a ready draft (D2). The POSTs run in parallel, and the box is unchecked afterwards. A missing discussion half shows "Generate the discussion transcript first" in the Staff discussion group. While running it reads "Summarizing… This can take a few minutes. Keep this page open."
- **Presentation group:** `SummaryBlock` keeps its status, editor, Save, Discard and Publish. It loses its own Summarize form, but per-kind **Try again** / **Summarize again** stays here.
- **Staff discussion group:** add a sibling `DiscussionSummaryBlock` under the transcript line (`:2678-2682`) with the same controls. Its status reads "Staff only. Never included on the Board page." On a 422 `staff_discussion_not_recorded` it shows **Not recorded**.
- **Independent results:** each POST resolves on its own. A failure shows inline beside that kind with **Try again**, which reuses the checkbox and sends one POST. The other kind's draft and edits are untouched.
- **Reload:** the card loads both GETs on mount, each with the existing generation guard. A `generating` row shows "Summarizing… started at …". A row past 360 s is treated as abandoned and offers Try again.

## Partial success, concurrency and idempotency

- **Two kinds in flight:** separate function invocations, separate rows; the partial unique index is per `(request_id, artifact_type)` (070:61-63). One kind timing out cannot fail the other.
- **Double click or second tab:** the second POST of a kind gets 409 `summary_generation_in_progress` from `beginSummaryDraft` before any provider call (`transcript-summary-service.js:222-229`; `summary-draft-store.js:49`). The paired lock also prevents it in the UI.
- **Out-of-date tab after the other tab's draft is ready:** today the new run would supersede the ready draft and discard its edits (`summary-draft-store.js:27-36`). With D2's `replaceDraft` rule the server returns 409 `summary_draft_exists` and makes no provider call.
- **One kind failing:** that row becomes `failed` with `failure_code` and keeps its consent metadata. The other kind is unaffected. A retry creates a new row and supersedes only same-kind rows.
- **Edits and new runs:** a `ready` draft is replaced only by a POST whose `replaceDraft` names its id and current version, which only that kind's **Summarize again** sends. The paired button also skips kinds with a current draft or published summary (owner decision 2).
- **Version conflicts:** PATCH, DELETE and the publish claim use `expectedVersion` per row, unchanged.
- **Publish:** each kind publishes separately, under its own slot lease (keyed by artifact type), its own claim token, `markSummaryDraftRegistering`, and release-before-registry or yield-after. The existing state machine is parameterized, not copied. The generation key gains the spec's type (unchanged for presentation).

## Durable surfaces to update in the build

- **Atlas:** `docs/atlas/postgres-meeting-transcript-summary-drafts.md` (075, two kinds, retention note) and its `docs/APPLICATION_STATE_ATLAS.md` row (`:110`); `docs/atlas/dataverse-wmkf-requestdocument.md` (100000010 contract, staff-only, fingerprint recipe); `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` (new content-free prompt).
- **`docs/API_ROUTE_SECURITY_MATRIX.md:289-290`:** the `kind` field, server-derived kind for PATCH/DELETE/publish, new error codes.
- **Workflow plan Stage 2 note:** built status, after merge.
- **Not needed:** no `docs/CANONICAL_COUNTS.md` route change and no new gate.
- **Gates**, each with its self-test, run sequentially per `docs/CI_GATES_REFERENCE.md`: `check:types`, scoped ESLint, `check:migrations-manifest`, `check:atlas`, `check:api-routes`, `check:route-lifecycle-auth`, `check:route-service-boundary`, `check:request-document-writers`, `check:prompt-injection-tagging`, `check:model-override-warming`, `check:fact-consistency`, `check:doc-currency`, `check:doc-symbol-refs`, `check:docs-catalog`, `check:drain-table-mentions`.

## Test plan (discriminating cases)

1. **Route:** the three-key POST still means presentation. `kind: 'board'`, an extra key and a non-string `kind` are each 400. GET without `kind` matches today's response exactly. Publish ignores any client kind (an extra key is 400).
2. **Presentation unchanged:** golden generation key, fingerprint, folder and filename for a fixed presentation draft. The existing `transcript-summary-service` and card suites stay green unmodified, except where the Summarize form moves.
3. **Discussion create:** the `executePrompt` arguments carry the discussion text only (no slides variable) plus both retention flags. Missing or stale discussion transcript gives 409 with no row. Changed bytes or eTag give 409. The `not_recorded` path gives 422 with no `beginSummaryDraft` and no `executePrompt` call. Mutation: drop the `utterances.length` check and the test must see a provider call.
4. **Draft protection (D2):**
   - With a `ready`, edited draft, a POST with `replaceDraft: null` returns 409 `summary_draft_exists`, makes no provider call, and leaves the text and version unchanged. Run this for both kinds and for the old three-key body.
   - A POST naming the draft at an older version is also 409.
   - Two tabs: tab A's draft becomes ready and is edited, then tab B's paired POST arrives. Tab A's edits survive.
   - A POST naming the exact id and version supersedes it.
   - Mutation: restore the unconditional `state = 'ready'` clause and the stale-tab test must fail.
5. **Independence:** with a presentation draft `ready` and edited, a discussion run or failure leaves its text and version unchanged. A discussion failure followed by a retry leaves one `failed` row and one `ready` row.
6. **Stale:** for each kind, a boundary move after drafting gives `draftMatchesTranscript: false` and publish 409. After publishing, a boundary move makes `bindStaffDiscussionSummary` report stale.
7. **Publish discipline:** the existing claim, registration and yield tests are parameterized over both kinds, not duplicated by hand.
8. **Exclusion, read side:** see D8, including the mutation check.
9. **Exclusion, write side (privacy).** Publishing a discussion draft must produce:
   - a `createDocument` payload with `wmkf_artifacttype === 100000010`;
   - a `wmkf_inputfingerprint` equal to the discussion fingerprint and different from the presentation fingerprint;
   - the discussion folder, filename and `wmkf_name`;
   - a slot lease, generation key, reconciliation record and `settleWinner` call all on 100000010.

   An end-to-end case passes the resulting rows to `buildPresentationContext` and `buildBriefingContext` and finds no discussion member. Mutation: revert any one of the 14 sites to `TRANSCRIPT_SUMMARY` and a test must fail.
10. **Service filter:** a discussion POST against a bound 100000013 row reaches the provider stub. Mutation: remove 100000013 from the `bindCurrent` filter and it must fail.
11. **Not recorded:** an empty discussion half produces one `failed` row with `staff_discussion_not_recorded` and consent metadata, plus a 422, with no `executePrompt` call. GET then reports it as `lastFailure`.
12. **Migration:** the 075 test pins the CHECK text and its manifest order after 074.
13. **Card:**
   - One click sends exactly two POSTs, and only one when a current draft exists.
   - A rejected discussion POST shows Try again beside discussion only.
   - Try again sends one POST.
   - A reload with a `generating` row shows progress.
   - "Not recorded" renders.
   - Discussion never shows the Board eligibility line.
   - `busy` stays set until both POSTs settle: resolve presentation first, and the boundary and transcription actions stay disabled until discussion settles.
   - Publishing presentation while discussion is generating keeps the discussion result when it arrives.
   - **Summarize again** sends `replaceDraft` with the shown draft; a 409 `summary_draft_exists` shows a reload message.
   - Mutation: clear `busy` per kind and the parallel test must fail.

## Release sequence (Tier 2: migration, Dataverse write, LLM)

1. Build on a short branch off `main` (proposed `claude/paired-summaries`). Run the tests and gates. Then a Claude review and an ordinary Codex adversarial review, with no metered products.
2. The owner authorizes and runs the read-only checks V1–V3 below.
3. The owner runs the picklist script: dry run, then `--execute` and re-read. This only adds a value. Until the merge, the Wave 16 preflight (`preflight-request-document-table.mjs:209-219`) reports 100000010 as an "Unexpected option". That is expected in this window. Running code ignores unknown types: the projection skips any type outside `POST_PRESENTATION_ARTIFACT_TYPES` [VERIFIED via `lib/services/post-presentation-materials/material-model.js:155-158`].
4. The owner applies 075 with `node scripts/apply-migrations.js`. This only widens a CHECK, so current code is unaffected and a rollback is safe.
5. The owner seeds the prompt: `--dry-run`, then `--execute`.
6. The owner decides the merge. Then verify that the Production deployment is the merge build.
7. **Acceptance on test request 1003222** (or an owner-chosen real request):
   - Run the paired action.
   - Edit one draft, reload mid-run and see recovery.
   - Publish both.
   - Check that Staff Deliberations shows both summaries.
   - Check that the Board presentation link and the briefing link show the presentation summary but no discussion summary.
   - Opening the discussion row id on the briefing link returns 404.

**Rollback:** revert the merge. The old code projects no 100000010 rows, and the schema stays expanded.

## Pre-implementation verification (owner-authorized, read-only)

- **V1 [UNVERIFIED], Production Dataverse metadata.** The new script's dry run, i.e. `GET {DYNAMICS_URL}/api/data/v9.2/EntityDefinitions(LogicalName='wmkf_requestdocument')/Attributes(LogicalName='wmkf_artifacttype')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`. Confirm 100000010 is absent (or already labelled Staff Discussion Summary) and 100000011 untouched. Do not repeat without asking (`feedback-never-self-authorize-prod-dataverse-reads.md`).
- **V2 [UNVERIFIED], Production Postgres.**
  - `SELECT name, applied_by FROM schema_migrations WHERE name >= '074' ORDER BY name;` should return only 074.
  - `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'meeting_transcript_summary_drafts_artifact_type_check';` should return the 070 definition.
- **V3 [UNVERIFIED], Production `wmkf_ai_prompts`.** The seed `--dry-run` should show no row named `meeting-transcript.staff-discussion-summary`.
- **Branch re-check:** immediately before committing 075, re-run the remote-branch migration scan after a fresh `git fetch`.

## Owner decisions

1. **Artifact value 100000010 "Staff Discussion Summary".** *Recommend yes,* subject to V1. It matches every source reservation, and the slot-lease CHECK already admits it.
2. **Paired click skips kinds that already have a current draft or current published summary.** *Recommend yes.* It protects edits and avoids paying twice. Replacing a kind uses its own Summarize again. **Decided:** both conditions; the server-side protection is decision 8.
3. **"Not recorded" detection.** **Decided (owner, Session 588):** a durable marker, implemented as a `failed` run with `staff_discussion_not_recorded` and no provider call (D4). It needs no schema change. This replaces the earlier recommendation of a POST-only check.
4. **Acknowledgment.** A new paired version; presentation also accepts the 2026-10-05 version. *Recommend yes.* Approve the final consent wording at build time.
5. **Staff Deliberations shows the discussion summary inline, like the presentation summary.** *Recommend inline with Read more.* The audience is the same as for the existing discussion transcript.
6. **Discussion prompt model `sonnet`, same budget envelope.** *Recommend yes.* The owner reviews the final prompt text before seeding.
7. **Retention.** Discussion drafts expire in 14 days like presentation drafts. Published discussion summaries join the Stage 5 deletion inventory. *Recommend recording this now and implementing it in Stage 5.*
8. **Server-side draft protection (from review).** **Decided (owner, Session 588): fix in Stage 2.** It also covers today's presentation summaries (D2).

Decisions 1 and 4–7 had no owner objection in Session 588 and stand as recommended. Decision 1 is still subject to V1.

## Source contradictions found

- The migration 070 header and the drafts Atlas page (`:39-40`) say "Stage 3 extends with 100000010". That is the October 4 plan's stage numbering; this work is Stage 2 of the October 7 plan. Reconciled in Session 588.
- The October 4 plan says the Postgres constraints already admit 100000010 and that "Stages 2–4 need no constraint migration" (`SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md:333,385`). That holds for the slot-lease and upload CHECKs, but not for the drafts CHECK, which admits only 100000007. The workflow plan already says a new constraint migration is needed.
- The workflow plan's accepted UX places one Generate summaries action with the review, but today's Summarize form sits in step 3 under Presentation. This plan places the paired action at the top of step 3.

## Evidence limits

This plan was written from source only, plus local `git ls-tree`. No Production, Dataverse, SharePoint, LLM or Zoom call was made. Nothing was built or committed.

## Review — Session 588 (2026-10-08)

**Folded in (Session 588 revision):** every required change below is now in the body (D1, D2, D4, D6, D8, D9, partial success, test plan items 4 and 9–13, release step 3), and the owner decisions are recorded above.

Reviewers: a Claude source review (`/contract-reconcile` Mode A) and a Codex adversarial review (`gpt-6-astra`). No Production probe ran; V1–V3 are still unrun. **Verdict: READY WITH NAMED CHANGES.** The plan's design holds. The changes below are contained and must be folded in before build approval.

Claims are marked [VERIFIED via file:line] (the Session 588 lead re-read the source) or [agent-reported] (a reviewer read it; not yet re-read).

**Required changes**
1. **Widen the service's own row filter.** `bindCurrent` keeps only Transcript, Presentation Transcript and Transcript Summary [VERIFIED via `transcript-summary-service.js:133-134`]. A discussion POST would always see `discussion_missing`. Add 100000013 and 100000010, or derive the list from `SUMMARY_KINDS`, and test a discussion POST against a bound 100000013 row.
2. **Prove the discussion writer cannot register as a presentation summary (privacy, HIGH).** `TRANSCRIPT_SUMMARY` is hardcoded at 14 sites [VERIFIED via grep of `transcript-summary-service.js`], including `createDocument`, the generation key and `settleWinner`. One missed site would register discussion text as 100000007, which the Board page and briefing link serve. The read-side allowlists hold (page, briefing, distribution and the external folder listers all exclude 100000010) [agent-reported, both reviewers]. The write side is untested. Add publish tests asserting the type, fingerprint, folder/filename, slot lease and winner type are 100000010, plus an end-to-end case through `buildPresentationContext` and `buildBriefingContext`. Mutation check: reverting any site to `TRANSCRIPT_SUMMARY` must fail.
3. **Stale-tab replacement of an edited draft (pre-existing, amplified).** `createSummaryDraftRun` supersedes any `ready` draft of the type and clears its text unconditionally [VERIFIED via `summary-draft-store.js:27-36`]. That is today's behavior for presentation summaries too. The paired action sends two POSTs per click and skips kinds only in the browser, which raises the odds. Owner choice: fix it in Stage 2 (POST carries explicit replacement intent plus expected draft id/version; paired POST refuses to replace a `ready` draft server-side) or track it separately. Recommend fixing in Stage 2.
4. **Card concurrency** [agent-reported]. One `busy` string (`RecordingAndTranscriptCard.js:1043`) cannot hold two parallel runs. The first to finish clears it. The shared `summaryLoadKey` (:1616) can drop the other kind's in-flight result. Specify one paired handler that holds the lock until `Promise.allSettled`, per-kind state, and per-kind load keys. Add a test where publishing one kind mid-generation keeps the other's result.
5. **Missing touch-points** [agent-reported]: the Workbench route copies fields one by one (`pages/api/.../logistics.js:77`), and the Meeting Tracker materials list (`material-service.js:430-458`) will list 100000010. Both are staff-only.
6. **Consistency:** pick "current draft" or "current draft or published summary" for the skip rule (D9 vs decision 2). The discussion GET returns the paired acknowledgment, not the presentation one (`:286`). Note the Wave 16 preflight "Unexpected option" window between picklist insert and merge.

**Owner decisions after review:** 1, 2 (once item 6 fixes the wording), 4, 5, 6 and 7 agree with the recommendation. **Decision 3 refined:** a `failed` run with `failure_code='staff_discussion_not_recorded'` and no provider call is a durable "Not recorded" marker with no schema change (`failure_code` is free text; GET already returns `lastFailure`) [agent-reported]. This contradicts the plan's statement that a marker would need schema work. **New decision:** item 3 scope.
