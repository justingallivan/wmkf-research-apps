---
title: Meeting recording import splitting summaries and retention
domain: transcription
kind: plan
status: proposed
summary: "Owner-approved workflow direction: import a full WMKF Zoom meeting, reconcile speakers before splitting, generate both summaries with one action, archive presentation materials and automatically expire discussion content at the Board meeting deadline. Implementation, schema and release decisions remain pending."
owner: product-engineering
related:
  - docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
  - docs/plans/TRANSCRIPT_SUMMARY_UX_AUDIT_2026-10-07.md
  - docs/atlas/postgres-meeting-transcript-publications.md <!-- drain-table:ignore reason=transcript-publications-atlas-path -->
  - docs/atlas/postgres-meeting-transcript-summary-drafts.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Meeting recording import splitting summaries and retention

## Decision and delivery status

The owner approved the workflow below on October 7, 2026. This document proposes implementation order and acceptance conditions; it does not authorize a migration, authentication change, Production probe, provider charge, deletion, deployment or merge. Stages 0, 1 and 3a were built on `codex/meeting-transcript-ux` and merged to `main` in PR #464 (`441140e6e`, Session 586); migration 074 is applied to Production [VERIFIED via `git log` and `DEVELOPMENT_LOG.md` Session 586 entry]. Later stages use their own reviewed branches. PR #459 speaker reconciliation remains unchanged. The owner reports successful Production acceptance on request 1003038; this is owner evidence, not a fresh hosted test.

The October 4 plan remains an implementation-history reference. Its manual Zoom trimming, separate summary-generation controls, indefinite full-source retention and proposed migration numbering are superseded for future work by this plan. Existing runtime behavior remains unchanged until reviewed implementation ships.

## Accepted user experience

1. Duncan opens a saved visit and selects **Import from Zoom**. A recording picker shows approved hosts' meetings by title and date. Duncan confirms the matching meeting and recording layout. Manual upload remains a proposed fallback for older or outside recordings.
2. The app copies the actual video, audio and available Zoom captions into controlled WMKF storage. A saved viewing link alone does not complete import. Import status identifies missing, pending or failed files and permits a targeted retry.
3. The existing pipeline transcribes the full audio and reconciles speaker identities using the full transcript and Zoom captions. Review names across the whole meeting before cutting any derivative. No new speaker-matching algorithm is in scope.
4. In one review area, Duncan checks names and confirms the presentation-end timestamp. Marking a candidate time early is harmless, but only the confirmed source revision and boundary may drive outputs.
5. The app creates presentation and staff-discussion videos and transcripts. Both use the same reviewed boundary, with verified video/audio time alignment.
6. One **Generate summaries** action, with an acknowledgment covering both inputs, creates the two independent summary drafts. Each remains reviewable and editable before publication. A failed half does not erase a successful half or require paying to regenerate it.
7. The completed page groups six products into **Presentation** and **Staff discussion**, each with Video, Transcript and Summary. Show open/download actions, current/stale/working/failure status and the relevant next action. Presentation materials are eligible for Board sharing after verification. Discussion products are staff-only and show the deletion deadline. Full sources remain separately accessible to authorized staff only until their deadline.

When verified source timing and utterances show no discussion after the confirmed boundary, display **Not recorded** for the discussion products. Skip the discussion provider call and zero-length video generation while allowing the presentation to complete. The current derivative writer emits a one-line no-discussion transcript; do not infer absence by matching that text or summarize that placeholder. This is a proposed edge-case behavior to confirm with the implementation scope.

The page should reveal work in the order it is needed, collapse replacement actions after success, and place feedback beside the operation. Do not put finished-summary status above unrelated upload controls or stack obsolete success banners. Drafts and published files must remain distinguishable.

## Verified source baseline

These are source facts at `90487a62d`, not live Zoom or database probes.

| Capability | Source and persistence | Current limitation |
|---|---|---|
| Production visit UI | `shared/components/meeting-tracker/SiteVisitEditor.js` mounts `RecordingAndTranscriptCard.js` | `MeetingTranscriptionPanel.js` is a separate rehearsal surface, not the production edit target |
| Zoom link and MP4 | `lib/services/post-presentation-materials/material-service.js` `saveZoomRecording` stores an external URL; upload path publishes files to SharePoint and the Request Document registry | Saving a Zoom link does not import bytes or provide transcription audio |
| Full transcript and speakers | `lib/services/meeting-tracker-transcription/service.js`, `alignment-service.js`, `lib/services/transcription-pilot/zoom-vtt.js`; jobs in private temporary storage, settled bundles in SharePoint | Preserve PR #459 behavior and central content reads |
| Split transcript | `presentation-boundary.js` partitions utterances; `post-presentation-materials/presentation-transcript-service.js` publishes both halves | Video slicing is absent from the inspected recording path |
| Presentation summary | `transcript-summary-service.js`, `summary-draft-store.js`, existing `summary-draft` and `summary-draft/publish` routes | `070_meeting_transcript_summary_drafts.sql` admits only artifact type 100000007; discussion summary is not implemented |
| Artifact vocabulary | `shared/config/requestDocument.js` has full recording/transcript, presentation transcript, staff discussion transcript and presentation summary | Old plan proposes 100000010/100000011 for future types. These are not verified live picklist values; do not allocate a discussion-video value by guessing |
| Board readers | `presentation-page-service.js` and `deliberation-briefing/briefing-page-service.js` restrict post-presentation types | Full recording and discussion content must stay excluded from both listing and direct open paths |
| Boundary binding | `presentation-transcript-binding.js` validates the current full TRANSCRIPT manifest, revision and confirmed end to admit presentation derivatives | Deleting or hiding the source row without a replacement proof would break the archived presentation and summary |
| Board date | `meeting-tracker-transcription/binding.js` already selects request field `wmkf_meetingdate`; `reviewer-request-context.js` identifies it as the Board-cycle temporal field | Exact day cutoff, timezone, reschedules and retrospective imports need policy confirmation |

## Proposed implementation order and file map

Each stage has its own reviewable commit or small commit series. UX and feature work remain separate. Schema/prompt provisioning, auth work and Production steps stop for owner approval. Push only the named feature branch; the owner decides merging.

### 0. Zoom access and read-only feasibility pilot

Tomorrow's admin meeting is October 8, 2026, Pacific time. Deliverable: an active internal Server-to-Server OAuth app, approved recording hosts, stable app owner/contact, secure credential handoff, and one test meeting. See `briefs/WMKF-Zoom-Admin-Brief.pptx`, including its speaker notes.

Use per-host listing with an approved configured host list to avoid user-directory permissions initially. Official API contracts: `GET /users/{userId}/recordings`, `GET /meetings/{meetingId}/recordings`; preserve the exact meeting-instance UUID and recording-file IDs supplied by Zoom. A recurring meeting number is insufficient to identify an occurrence. Follow pagination/date-window limits and handle processing, unavailable files, revoked credentials and rate limits. Re-fetch download URLs instead of persisting expiring bearer URLs. Verify the actual MP4/M4A/VTT files exposed by WMKF's settings, including multiple layouts or recording segments.

Module locations: `lib/services/meeting-tracker-recordings/zoom-client.js` and `import-service.js` (built for Stage 3a, 2026-10-08; merged to `main` in PR #464, `441140e6e`). First test uses one authorized recording and verifies imported bytes, sizes, media duration and file types before any transcription/provider call. No deletion in this pilot. Account access, credentials, provider data handling and test environment require authorization before execution.

**Pilot result, 2026-10-08 [VERIFIED via `scripts/probe-zoom-recordings.mjs`, run locally with `.env.local`].** The admin created and activated the internal S2S app. The token grants `list_user_recordings:admin` and `list_recording_files:admin` (the second was added after the first run returned Zoom code 4711), plus an unrequested `list_user_recordings:master`. Approved pilot host: `wmk-library@wmkeck.org`. Findings for Stage 3:

- All 13 recordings in the 30-day window share one Personal Meeting Room number and the generic title "WM Keck Foundation's Personal Meeting Room". The picker must show date/time, and the import must key on the occurrence UUID; titles cannot identify a visit.
- Files per meeting: MP4 `shared_screen_with_speaker_view` (suffixed `(CC)` when captions exist), M4A `audio_only` and `timeline` JSON. Zoom's `audio_transcript` VTT, with `Name - Affiliation:` speaker labels, is present from 2026-09-30 onward but absent from the four Sep 28–29 meetings. `closed_caption` VTT and `chat_file` TXT appear on some meetings only; the sampled CC track began 24 minutes into the meeting. The timeline JSON carries timestamped active-speaker names, a possible speaker-reconciliation input not yet evaluated.
- One meeting (Oct 5, 62 min, five files, 289 MB) downloaded with `Authorization: Bearer` on `download_url`, following a redirect. Every file's byte count matched Zoom `file_size`. MP4/M4A `mvhd` durations matched Zoom's `recording_start`/`recording_end` (3749 s); the transcript's last cue ended at 3746 s.
- Without the bearer header, `download_url` still returns HTTP 200 with an HTML sign-in page. Import must reject HTML and verify size, not trust the status code.
- `GET /meetings/{uuid}/recordings` works with double-encoded UUIDs that contain `/`, and reports the host as Zoom `host_id`, not email. The host allowlist must resolve approved emails to IDs.

Downloaded bytes stayed in the session's temporary folder; nothing was written to SharePoint, Dataverse, Blob or Zoom, and no transcription or AI provider was called. Credentials exist only in local `.env.local`; Vercel provisioning needs separate approval.

### 1. UX commit using existing capabilities

Edit `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` and `tests/unit/recording-and-transcript-card.test.js`. Organize input, review and outputs without changing shared primitives or speaker services. Keep audio plus optional VTT together and distinguish captions for speaker matching from uploading a finished transcript. Surface both current transcript halves and the existing presentation summary by name. Do not display functioning controls for unbuilt features. Update the matching UX plan and later the new feature controls in their own commits.

**Built 2026-10-08 (`d99817f67`); merged to `main` in PR #464 (`441140e6e`).** The owner chose a step-by-step layout over a regrouping. The card reads **1 Get the recording**, **2 Check speaker names and where the presentation ends**, **3 Results**. Step 1 shows the audio form with optional Zoom captions directly. Uploading a finished transcript is a secondary link, and the Zoom link/MP4 sits below. Step 1 collapses to status lines once a transcript or reviewable run exists. It stays open while a chosen file or an upload from this browser is in progress, or a transcription is queued or processing (since `1cef46de3`, a stranded `uploading` job no longer counts). Step 2 holds the review editor, speaker names, presentation end and the generate action; for an uploaded transcript it explains why the file cannot be checked or split. Step 3 groups Presentation (transcript and summary), Staff discussion (transcript) and Full meeting (recording, full transcript downloads), plus the Board link. It adds Open links for both transcript halves from the existing staff materials list. Errors, notices and Needs attention render above the steps. With no transcript at all, Results is one line and the summary block is not shown; this deliberately narrows the PR #455 rule that the summary always explains its prerequisite, which still applies once a transcript exists.

[VERIFIED via local commands] 163 tests passed across `recording-and-transcript-card`, `site-visit-editor-t5-matrix`, `meeting-tracker-pages`, `transcript-summary-service` and `presentation-transcript-binding`, including five new step-layout tests; one was mutation-checked. Types passed; card/test ESLint reported 0 errors and the six pre-existing warnings. A local preview rendered the real card with synthetic data in Chrome; this is not hosted acceptance. When Stage 3 lands, step 1's primary action becomes **Import from Zoom**, with uploads behind "Other ways to add a recording". Owner follow-up option, not built: hide re-summarize controls behind "Summarize again" once a current summary is published.

### 2. Paired summaries feature

**Production-live 2026-10-09 (merge `5b8225ed8`, Production deployment 6952181551 success); acceptance on 1003222 verified 2026-10-09 except the in-run reload and a draft edit, which were not observed (see that plan's release step 7).** Planned and built in `docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md` (migration 075, artifact type 100000010, prompt `meeting-transcript.staff-discussion-summary`; owner decisions 1–12). The paragraphs below are the original direction.

Extend existing routes `pages/api/meeting-tracker/visits/[requestId]/transcriptions/summary-draft.js` and `summary-draft/publish.js` with explicit allowlisted summary kind handling, preserving existing callers. Prefer two independent existing-route calls behind one UI action over a new batch route or a doubled synchronous server timeout. Each request records consent and source identity separately. The UI uses independent results and retries only the failed kind. An interrupted browser reload recovers durable drafts from GET.

Files: `lib/services/post-presentation-materials/transcript-summary-service.js`, `summary-draft-store.js`, `presentation-transcript-binding.js`, `material-model.js`; `lib/services/meeting-tracker-transcription/service.js`; `shared/config/requestDocument.js`, `transcriptSummary.js`, `executorBudgets.js`; existing presentation prompt config/seed as reference for a new discussion prompt and seed. Carry forward the existing Executor requirements `requireNoPersistence: true` and `auditRetention: 'content-free'` for the discussion prompt and failure path, and test them explicitly so the retention inventory does not miss AI audit copies. Keep the two input builders explicit: presentation transcript plus optional applicant slides versus discussion transcript alone. Reuse the existing claim/version/registration-retry discipline, not a second copied publishing state machine.

Consumer files: `lib/services/site-visit/logistics-service.js`, `shared/components/workbench/ResearchPresentationFollowUp.js`, and both outside-reader services for exclusion tests. This names the Workbench expansion for scope approval before editing it. Do not modify `shared/components/Layout.js` or the rehearsal panel.

Provisioning gate: verify the live Dataverse artifact option before an owner-approved extension; propose a new constraint migration admitting the approved discussion-summary type. Do not edit migration 070 or reuse the old plan's migration 072 number. Reserve the next available number across active branches at implementation time. Update the manifest/fresh-install parity as required by actual bootstrap, Atlas, API matrix, prompt provenance/A7 registry and writer gate. No schema execution is authorized by this plan.

### 3. Zoom recording picker and durable import

**Stage 3 is split (2026-10-08).** 3a, imported audio and Zoom transcript into the existing transcription pipeline, is planned in `docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md` (owner-approved schema, routes and variables; merged to `main` in PR #464, `441140e6e`; migration 074 applied to Production). It allocates migration 074 (`zoom_recording_imports`), `GET .../zoom-recordings`, `POST .../zoom-imports` and `ZOOM_RECORDING_HOSTS`, which the paragraphs below left unallocated. 3b, copying the MP4 into SharePoint, is planned in `docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md` and **step 0 merged (`c79f79807`) and migration 076 applied 2026-10-09; the copy runtime is built on branch `claude/zoom-copy`, not merged; the copy is not live.** Until it ships the Recording slot keeps today's Zoom link and MP4 inputs.

Add selection/progress to the card after the pilot proves access. Proposed new recording-service modules own token acquisition, server-side host allowlisting, safe Zoom URL validation and request/visit authorization. Reuse `material-service.js` and existing upload/publication mechanics only where their caller and storage contracts fit; do not force imported bytes through a browser multipart route or impersonate a client upload token.

An import requires a durable, schema-approved operation record with exact source-file identities, request/visit binding, verified destination descriptors, retry state and cleanup ownership. Names of new tables/columns, routes and environment variables remain unallocated. Repeated selection of the same source must not duplicate files or transcription. Every worker rechecks binding and cancellation/expiry fences. Reuse the existing route namespace; a separate list/import/status endpoint is likely needed because existing routes accept exact upload contracts. Present exact routes for approval and register them in `docs/API_ROUTE_SECURITY_MATRIX.md` before implementation.

### 4. Video splitting and presentation archive

Proposed new module `lib/services/meeting-tracker-recordings/split-service.js`; publication integrates with the existing material model, registry writer and both outside readers. Persist a frozen source-video identity, transcript revision, reviewed boundary, timing transform and immutable output identity before processing. Distinguish video source changes from names-only transcript changes to avoid unnecessary re-encoding without weakening provenance.

Run long video work asynchronously in a durable worker, outside the UI request. The processing venue is **UNKNOWN** pending input sizes/durations, security boundary and runtime/codec feasibility. A read-only marketplace discovery found Mux, but no provider is selected or installed. Prefer existing approved infrastructure if it can handle the workload. A new external processor requires owner approval of data handling and costs. Do not promise deployment on a particular runtime before a representative benchmark.

Verify audio/video start offsets, pauses, segmented recordings and multiple layouts. Never assume equal timestamps merely because files belong to one meeting. Confirm the end around the actual video frames/audio. Avoid keyframe-only cuts that could leak post-boundary discussion. If accurate mapping/cutting cannot be proven, block Board publication and show a resolvable reason. Keep one successful derivative if the other fails; show individual output states. Boundary changes immediately withhold stale outside outputs, including direct opens.

Archive presentation-only MP4, transcript and reviewed summary in governed SharePoint, using exact published file identity/content checks and a durable content-free lineage record. Before enabling source deletion, change `presentation-transcript-binding.js`, `bundle.js` and reader contracts so proof of the archived presentation does not require retained full source bytes. Do not bypass existing binding checks with a permanent boolean. Keep enough immutable revision/boundary/output evidence to revalidate the archive, without full text, speaker snippets, signed download URLs or discussion-bearing manifests. Exact schema needs a separate design and approval. Regression: full-source deletion must leave all three correct presentation artifacts usable, with no path back to discussion bytes.

### 5. Retention with automatic deletion

**Owner decision:** automatically delete discussion video, transcript, summary and full-length originals at the Board meeting deadline. Presentation-only materials remain archived. Zoom-original deletion is desired when supported. The account belongs to WMKF; account-specific permissions and Trash settings are unverified.

Coverage inventory must include all content-bearing copies: original video/audio/VTT, full transcript TXT/VTT/source JSON, discussion derivatives and summary drafts, prior/superseded revisions, partial/orphaned uploads, temporary Blob/worker files, Zoom variants, and provider retention. SharePoint recycle bins/version history, Zoom Trash and backup/retention holds affect permanent erasure; removing an app link is not deletion. Record precisely what the system can verify versus what provider policy controls. Unrelated meeting files and unrelated account recordings are outside the automatic deletion scope.

Proposed new module `lib/services/meeting-tracker-recordings/retention-service.js`, integrated into the appropriate bounded maintenance/recovery entry point after inspecting `pages/api/cron/maintenance.js` and the existing transcription cleanup worker. Durable records must store exact owned identities and retry evidence. Never delete by filename prefix, folder sweep or meeting-series ID. A shared Zoom file associated with more than one request requires an explicit ownership/deadline decision rather than deleting it for the first request that expires.

At the deadline: deny new discussion reads and generation, revoke app-issued access where possible, fence active writers, delete owned content in bounded idempotent steps and verify per-store results. A late upload/retry must not resurrect expired content. Record content-free success/failure receipts and surface unresolved deletion. Existing external downloads/copies cannot be recalled; state that operational limit. Provider retention and account Trash behavior must be reconciled before describing the policy as permanent erasure.

**Policy blockers before enabling:**
- Exact cutoff/timezone: propose end of the Board meeting date in America/Los_Angeles, but this is not yet approved. Confirm whether deletion must complete by that time or begin then.
- Missing/changed Board date, postponements, already-past dates and retroactive coverage of existing recordings.
- What to do if presentation archiving is incomplete at the deadline. Do not silently retain discussion indefinitely or destroy the only presentation copy; establish the owner-approved exception/escalation rule beforehand.
- Zoom Trash and SharePoint recovery/hold behavior, permanent deletion expectations, and copied/downloaded originals outside app control.
- Approved treatment of named institutional holds and the staff member responsible for failures.

A synthetic dry run should enumerate exact intended deletions and exclusions. Activation follows an owner-approved test of deletion, retries, archive survival and scheduled execution. A successful manual invocation is not proof that the schedule runs.

## Verification and release contract

Use `/contract-reconcile` across UI request, route guards, service, durable operation, file/registry writes, recovery and every reader. Authentication stays session-derived; never accept actor/host/path authority from the browser. Preserve Dataverse restriction context and target interlock.

Meaningful tests cover two summaries with one failing, saved edits during retries, stale source/boundary, context-switch races, absent captions/audio, duplicate imports, multiple recording segments, offset video, inaccurate cut rejection, staff-content exclusion at listing and direct open, replaced SharePoint bytes, post-retention archive access, due-date changes, held files, partial deletion, stale worker completion and resurrection attempts. Inject actual discussion artifacts into exclusion tests.

Run applicable existing suites including `recording-and-transcript-card.test.js`, `transcript-summary-service.test.js`, `presentation-transcript-binding.test.js`, summary/recording route tests and outside-reader tests. New import/split/retention tests should prove failure behavior, not mirror implementation. Use local/synthetic integration tests for claims and deletion fences before approved hosted checks.

Gates depend on actual edits: types, scoped lint, API routes, Atlas, migrations manifest, request-document writers, prompt injection tagging/model override warming, relevant auth/boundary gates and docs checks. Run every gate and its self-test sequentially. Commit UX separately from features. Push only `git push -u origin codex/meeting-transcript-ux`. No merge or Production promotion without owner direction.

## Admin meeting brief and references

Read-only scopes to request for the first per-host picker/import test:
- `cloud_recording:read:list_user_recordings:admin`
- `cloud_recording:read:list_recording_files:admin`

No webhook or user-directory scope is needed for the initial configured-host picker. Admin scopes can access more than one host, so the application must enforce its own approved host list. The first meeting should identify hosts and one suitable test recording. Authentication credentials stay in approved server-side secret storage; do not put them into the brief, repository or chat.

Later per-file deletion uses `cloud_recording:delete:recording_file:admin` with applicable account permissions. Confirm supported semantics in WMKF's account. Zoom documentation describes recoverable Trash behavior; this research did not establish an ordinary Meetings API permanent-purge option. Do not borrow Video SDK endpoint parameters for Zoom Meetings.

Official sources checked October 7, 2026:
- [Create internal S2S app](https://developers.zoom.us/docs/internal-apps/create/)
- [Token lifecycle](https://developers.zoom.us/docs/internal-apps/s2s-oauth/)
- [Granular scopes](https://developers.zoom.us/docs/integrations/oauth-scopes-granular/)
- [Meetings recording APIs](https://developers.zoom.us/docs/api/meetings/)
- [Recording deletion and recovery](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066493)

## Evidence limits and handoff

This is planning-only work. No Zoom account access, credential use, migration, provider execution, Production data operation or runtime implementation occurred. Source review exposed the archive-binding dependency above. Live schema options, permission availability, real timing alignment, processing cost and permanent-erasure behavior remain unknown until approved probes. No new table name, schema option or migration number is assigned here.

Scoped `/sweep` Mode A records the October 7 product decisions and makes the October 4 plan visibly historical rather than leaving its old forward instructions authoritative. The PR #455 audit is already explicitly historical and is retained. Broader old Atlas implementation-status inconsistencies are outside this planning change and are not claimed reconciled. Before implementation, approve the stages/file scope and resolve each stage's named dependency. The admin meeting can proceed using the brief independently of those implementation approvals.

Fresh source review found and resolved two plan gaps: content-free discussion-summary execution and the no-discussion outcome. Review was read-only and did not establish live Zoom/schema readiness. Documentation gates and their self-tests passed sequentially; the deck passed package/layout checks and visual inspection of both slides. The checkout-specific memory symlink was restored and `check:agent-invariants` passed. The claim-evidence advisory report was unavailable because local state could not be read; no observation was invented.
