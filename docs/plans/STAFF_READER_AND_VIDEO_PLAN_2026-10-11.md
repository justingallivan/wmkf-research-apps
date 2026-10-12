---
title: Staff reading page and Workbench presentation video
status: planned
created: 2026-10-11
owner: Justin Gallivan
summary: "Plan for a staff reading page that shows transcripts and summaries formatted in the browser, and for playing the approved presentation video inline on the Workbench Staff deliberations tab."
---

# Staff reading page and Workbench presentation video

Queue item: "Show transcripts and summaries formatted in the browser across the suite" (`docs/CURRENT_WORK_QUEUE.md`). Part A (Workbench summaries through the shared `SummaryText`) shipped 2026-10-11 (merge `99c91df93`). The follow-up on branch `claude/workbench-summary-links` (summary links hidden when the text is shown; "Open full transcript") is held, not merged.

## Owner decisions (2026-10-11, Session 595)

1. Transcripts and summaries open on a **new-tab reading page**, not inline on the card.
2. Scope is the **Site Visit card and the Workbench**. The transcription rehearsal page and the admin transcription pilot keep their TXT/VTT downloads.
3. The Workbench plays the **approved presentation cut** inline, like the Board page. The full meeting recording stays a "Watch full recording" link (it contains the staff discussion; the Zoom share page cannot be embedded).
4. The video and the reading page ship together on one branch.

## Facts this plan rests on

- The Workbench already receives the approved Presentation Video (artifact 100000011) in `presentationMaterials`, but `SLOTS` in `shared/components/workbench/ResearchPresentationFollowUp.js` has no entry for it [VERIFIED via `lib/services/post-presentation-materials/material-model.js` `POST_PRESENTATION_ARTIFACT_TYPES`; subagent trace].
- The Board page plays the video by setting `video.src` to its open route, which 302s to Graph's short-lived download URL after `approvedVideoBytesMatch` (drive/item ids, size, quickXorHash of the approved cut) [VERIFIED via `presentation-page-service.js:352-358, 368-410`].
- Only `/external/presentation/[token]` has `media-src` for the SharePoint origin; every staff page falls back to `default-src 'self'`, which blocks a redirect to SharePoint [VERIFIED via `proxy.js:96-110`; `rg 'media-src|Content-Security-Policy'` outside docs/tests finds only `proxy.js`].
- No staff route serves the approved video by document id; the Meeting Tracker review route is keyed by split and requires `meeting-tracker` [VERIFIED via subagent trace of `presentation-video-splits/[splitId]/open.js:27`].
- The Workbench app key is `reviewers`, Meeting Tracker is `meeting-tracker`; grants are per key [VERIFIED via `shared/config/appRegistry.js:51,60`, `lib/utils/auth.js:367-397`].
- Staff Workbench materials are the current winners after `withoutUnboundDerivatives` and `projectPostPresentationDescriptors(..., { includeStaffUrls: true })`, gated by `presentationSchemaReady && presentationRequestAllowed` [VERIFIED via `lib/services/site-visit/logistics-service.js:472-481`].
- Summaries and split transcripts record `wmkf_filesize` and `wmkf_contenthash` (SHA-256) [VERIFIED via `presentation-transcript-service.js:373,382`, `transcript-summary-service.js:228`]. The full transcript's integrity is already enforced by `downloadMeetingTranscript` (manifest or row hash; current artifact only; TXT for uploaded transcripts only when hashed) [VERIFIED via `lib/services/meeting-tracker-transcription/service.js:615-660`].
- The staff summary reader `readPublishedSummary` checks SHA-256 only, not size [VERIFIED via `logistics-service.js:111-133`]. The reader below checks both, like the Board page.

## Design

### 1. Presentation video route (Workbench)

`GET /api/workbench/site-visit/presentation-video?requestId=<GUID>` → `302` to the Graph download URL, or `404`.

- Guard: `requireAppAccess(req, res, 'reviewers')`; `withDalContext`; GUID check on `requestId`.
- Same gates as the Workbench materials: presentation schema ready and `presentationRequestAllowed(requestId)`; otherwise 404.
- Service (new export in `presentation-page-service.js`, reusing its internals rather than copying them): load the request's documents, take the bound Presentation Video from `bindPresentationVideo` over the current winners (as `eligiblePresentationRows` does), resolve the media, require the same drive/item ids and no malware flag, `video/mp4` with `.mp4`, `approvedVideoBytesMatch` against `getApprovedPresentationVideoByDocument`, and an https redirect with no credentials. Any failure is 404.
- `Cache-Control: no-store`; the Graph URL is never logged.

### 2. Text route (reading page)

`GET /api/workbench/site-visit/presentation-text?requestId=<GUID>&documentId=<GUID>` → `{ kind, label, publishedAt, text }` or an error.

- Guard: `requireAppAccess(req, res, 'reviewers', 'meeting-tracker')` (the page is reached from both apps); `withDalContext`; GUID checks. `/api/workbench` is registered as heterogeneous (`guardAppKeys: null`) in `ROUTE_NAMESPACE_LIFECYCLE`, so a mixed-key route there is allowed [VERIFIED via `shared/config/appRegistry.js:376-382`].
- Allowed rows: only the current staff winners the Workbench and card already list (same projection as §Facts), and only types TRANSCRIPT, PRESENTATION_TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT, TRANSCRIPT_SUMMARY, STAFF_DISCUSSION_SUMMARY. Anything else is 404.
- TRANSCRIPT reads through `downloadMeetingTranscript({ format: 'txt' })`, so its existing currency and integrity rules apply unchanged. The other four read `wmkf_filesize` bytes with `maxBytes`, require `text/plain`, matching size and SHA-256, fatal UTF-8, and strip the BOM.
- Text cap: 4 MB of bytes (below the Function response limit). Larger files return `413` and the page offers the SharePoint file.
- Stale halves: a summary bound to an earlier transcript is still readable by staff (as the Workbench shows it today) and the response says `stale: true`.

### 3. Reading page

`pages/workbench/read.js?request=<GUID>&document=<GUID>`, opened in a new tab.

- Gate: shown when the viewer has `reviewers` or `meeting-tracker` (the server re-checks).
- Impeccable Read mode, One Shell Rule (shell `max-w-7xl`, main column `max-w-4xl`), Left Header Rule: back line with the request number and title, H1 = the item's label, one metadata line (published date, "AI-generated" for summaries, stale note), and secondary actions (download TXT where available, open in SharePoint).
- Summaries render with the shared `SummaryText` (reading size) and the matching heading constants.
- Transcripts render with a new `shared/components/TranscriptText.js`: one turn per `[MM:SS]`/`[H:MM:SS] Speaker: text` paragraph, timestamp in a tabular gutter, speaker in semibold; the v1/v2 minute layout and plain text fall back to paragraphs.
- Loading skeleton; errors in place with Retry; request identity always shown.

### 4. Entry points

- Workbench: a presentation video player in the Presentation step (click to play, like the Board page; retry once and resume on error); the RECORDING link becomes "Watch full recording". Transcript links open the reading page. Summary links stay hidden when shown inline (held branch).
- Site Visit card: the split transcript and summary name links and "Open full transcript" open the reading page. TXT/VTT downloads stay in the "…" menu; uploaded PDF/DOCX transcripts keep the SharePoint link.

### 5. CSP

- `/workbench/[requestId]` gains `media-src 'self' <SharePoint canonical origin>`, matching the Board page; no other directive changes.
- The reading page needs no CSP change (same-origin fetch only).

## Out of scope

- Transcription rehearsal and admin pilot pages.
- Changing `readPublishedSummary` (staff inline summaries keep their current check).
- Range or byte proxying (the Board page relies on the Graph URL for seeking).

## Verification

- Unit tests for both services (allowlist, gates, integrity failures, stale, cap), both routes (auth, GUID, 404 shape), `TranscriptText` parsing, and the entry-point links.
- `check:api-routes` (+ matrix rows), `check:route-lifecycle-auth`, `check:route-service-boundary`, `check:trust-boundary-guid`, `check:dataverse-access-layer`, `check:fact-consistency` if route counts are registered, then a Codex adversarial review per slice.
- Owner check on localhost and live: video plays and seeks on the Workbench for 1003222; each reader opens formatted.
