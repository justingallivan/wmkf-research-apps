---
title: Zoom recording import (Stage 3a)
kind: plan
domain: transcription
status: built-in-branch
summary: "Server-side Import from Zoom for the site-visit card: list approved hosts' cloud recordings, import one meeting's audio and Zoom transcript into the existing transcription pipeline, recorded by one new Postgres table and two new routes."
owner: product-engineering
related:
  - docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md
  - docs/atlas/postgres-transcription-pilot.md
  - docs/CREDENTIALS_RUNBOOK.md
---

# Zoom recording import (Stage 3a)

## Build status

**[BUILT on branch `codex/meeting-transcript-ux`, 2026-10-08; not merged, migration 074 not applied, no Vercel variable set.]** The client (`lib/services/meeting-tracker-recordings/zoom-client.js`), import service and store, migration 074, both routes and the step 1 import panel exist with unit tests that mock `fetch` and the service modules. No live Zoom, Blob, Dataverse or database call has been made by the build. Review (Claude, then Codex), the owner's go-ahead to apply the migration and set the variables, and one owner-approved manual local import remain.

Implementation notes that refine this plan:

- The cleanup pathnames are read from the raw job row (`getMeetingTranscriptionJob` in `lib/services/transcription-pilot/store.js`); the job DTO from `projectMeetingTranscriptionJob` exposes only `zoomTranscriptAttached`.
- The import re-lists with the same default 30-day window the picker uses; the POST body has no `days`.
- A Zoom transcript over the 4,000,000-byte cap is treated as absent (audio imports alone); audio over the 200 MiB cap is `zoom_audio_too_large` (422) before any claim.
- `GET zoom-recordings` rejects a non-integer or out-of-range `days` (400) rather than clamping it.
- If the final `started` update itself fails after the job was queued, the row is left `importing` (not marked failed) so the lease-expiry lookup resolves it to `started`; the response then reports state `importing`.
- If anything throws after the job left `uploading` (for example `startMeetingTranscription` queued it and then threw), the row is marked `started` with that job instead of `failed`; if the job cannot be read, the row is left `importing` and the original error is rethrown, so no retry creates a second paid job.

## Scope and authority

The owner approved the import direction on October 7 and asked on October 8 for Stage 3 to be planned by Claude, built by a Sonnet agent, reviewed by Claude and then adversarially reviewed by Codex. The owner approved the schema, routes and environment settings below on 2026-10-08. No migration is applied to any live database, no Vercel environment is changed and nothing merges by this plan.

Stage 3 is split. **3a (this plan)** imports the meeting's audio and Zoom transcript into the existing transcription pipeline, which removes the manual download and upload. **3b (later)** copies the MP4 video into SharePoint. That copy needs chunked Zoom→Graph streaming in a background job and changes to the MP4 finalize path, and Stage 4 video splitting depends on it. Until 3b, the Recording slot keeps today's Zoom link and MP4 inputs.

Work happens on `codex/meeting-transcript-ux` in `/Users/gallivan/Code/WMKF_Apps-codex-transcript-ux`. Before building, merge `origin/main` into the branch so migration numbering starts from main's 073.

## Verified facts this plan relies on

- [VERIFIED via `scripts/probe-zoom-recordings.mjs`, 2026-10-08] The S2S app holds `cloud_recording:read:list_user_recordings:admin` and `cloud_recording:read:list_recording_files:admin`. `wmk-library@wmkeck.org` hosts every site visit in one Personal Meeting Room. Titles are identical, so the picker must show date and time and key on the occurrence UUID. Each meeting has an `audio_only` M4A (30–55 MB). Meetings since Sep 30 also have an `audio_transcript` VTT with `Name - Affiliation:` speaker labels; the four Sep 28–29 meetings do not.
- [VERIFIED via probe] `download_url` answers 302 from `us02web.zoom.us/rec/download` to 200 on `ssrweb.zoom.us`, using `Authorization: Bearer`. Without the bearer it returns HTTP 200 with an HTML sign-in page. `GET /meetings/{uuid}/recordings` needs double URL-encoding for UUIDs that start with `/` or contain `//`, and reports `host_id`, not email.
- [VERIFIED via source] `uploadMeetingTranscription` (`lib/services/meeting-tracker-transcription/service.js:210`) enforces the access interlock and request→visit binding, then `createMeetingTranscriptionUpload` (`lib/services/transcription-pilot/runtime.js:82`) validates metadata and creates the job row. It returns the job with `input_cleanup_pathname` and `zoom_transcript_cleanup_pathname`; the job reuses the row for a repeated `idempotencyKey`. `writePrivateContent` (`runtime.js:392-397`) is the server-side private Blob write. `startMeetingTranscription` (`service.js:217`) requires `actingUserSystemId`, `expectedVersion` and `nonSensitiveAcknowledged === true`, validates the audio and VTT, and dispatches the workflow.
- [VERIFIED via `runtime.js:392-400`] `writePrivateContent(pathname, contentType, body, deadline)` writes with the `UPLOADS_BLOB_RW_TOKEN` private store, `allowOverwrite: false`. [VERIFIED via `runtime.js:255-258`] `safeFilename` rejects control characters and replaces `/` and `\`; colons are allowed. [VERIFIED via `RecordingAndTranscriptCard.js:1499`] the card sends `providerRegion: 'us'`.
- [VERIFIED via `060_transcription_jobs.sql:113-115`] One job system-wide may be `submitting`, `processing`, `saving` or `submission_uncertain`; queued jobs are not limited. [VERIFIED via `limits.js:19-20`, `runtime.js:21`] Audio is capped at 200 MiB; the Zoom transcript at 4,000,000 bytes.
- [VERIFIED via local `parseZoomVtt` run on the pilot meeting's files, 2026-10-08] Zoom's `audio_transcript` VTT parsed to 521 cues, all named, 7 distinct names. The `closed_caption` VTT parsed to 400 cues with no names. The import therefore uses `audio_transcript` and never `closed_caption`.
- [VERIFIED via `git ls-tree` of every remote branch, 2026-10-08] The highest migration on `origin/main` is 073 and no remote branch has 074–079. Per `.claude-memory/project-migration-numbers-claimed-off-main.md`, re-check remote branches and ask the owner about Production `schema_migrations` immediately before choosing the final number.

## Owner decisions

**Approved by the owner on 2026-10-08:** the `zoom_recording_imports` table (migration 074, written on the branch only), both routes, `ZOOM_RECORDING_HOSTS` as an env var, and credentials for Production and local only (no Preview). Applying the migration to any database, setting Vercel variables and merging each still need a separate go-ahead.


1. **Environment variables** (Vercel Preview and Production, set by the owner after merge approval):
   - `ZOOM_S2S_ACCOUNT_ID`, `ZOOM_S2S_CLIENT_ID`, `ZOOM_S2S_CLIENT_SECRET`: already in local `.env.local` and the credentials runbook.
   - `ZOOM_RECORDING_HOSTS`: comma-separated approved host emails, initially `wmk-library@wmkeck.org`. This is an env var, not Dataverse settings: it is a security allowlist that should change only by deliberate deploy-time action.
   - The import is available only when all four are present and Meeting Tracker transcription is already enabled for the request. Any missing value hides the import and leaves uploads as they are.
   - **Which environments:** recommended Production and local only. Every Preview deployment holding these credentials could read the shared host's recordings. Setting them on the dedicated test Preview project is a separate choice.
2. **One new Postgres table**, `zoom_recording_imports` (migration `074_zoom_recording_imports.sql`), defined below.
3. **Two new routes** under the existing visit namespace, defined below.

## Design

### Zoom client — `lib/services/meeting-tracker-recordings/zoom-client.js` (new)

- `getAccessToken()`: `POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=…` with Basic auth. Cache it in module memory until 60 s before `expires_in`. Never log or return the token.
- `listHostRecordings(email, { from, to })`: `GET https://api.zoom.us/v2/users/{email}/recordings`, one request per window of at most 30 days, following `next_page_token`.
- `getMeetingRecordings(uuid)`: `GET https://api.zoom.us/v2/meetings/{encoded}/recordings`, double-encoding when the UUID starts with `/` or contains `//`.
- `downloadRecordingFile(downloadUrl, { maxBytes, expectedBytes })`:
  - Follow redirects manually (`redirect: 'manual'`, at most 5 hops). Every hop must be `https:`, port 443, no URL credentials, and host `zoom.us` or ending in `.zoom.us`.
  - Send the bearer only on the first request.
  - Reject `text/html` responses and responses over `maxBytes`. Require the final byte count to equal `expectedBytes` (Zoom `file_size`).
  - Return a Buffer. Audio is at most 200 MiB, and `startMeetingTranscription` already buffers the whole file.
- Errors are a typed `ZoomClientError` with a sanitized `code`: `zoom_not_configured`, `zoom_auth_failed`, `zoom_scope_missing` (Zoom 4711), `zoom_not_found`, `zoom_rate_limited`, `zoom_download_invalid`, `zoom_unavailable`. Zoom response bodies and URLs are never placed in error messages, logs or responses.

### Import service — `lib/services/meeting-tracker-recordings/import-service.js` (new)

- `readZoomImportConfig(env = process.env)` returns `{ available, hosts }`. It parses `ZOOM_RECORDING_HOSTS` (trimmed, lower-cased, valid emails, de-duplicated). `available` is false if any of the four variables is missing.
- `listZoomRecordingsForVisit({ requestId, days })`:
  - Calls `requireMeetingTranscriptionEnabled` and loads the binding as the existing service does.
  - Lists each approved host's recordings for `days` (default 30, max 90).
  - Returns occurrences newest first: `meetingUuid`, `startTime`, `durationMinutes`, `hostEmail`, and `audio: {bytes}|null`, `transcript: {bytes}|null` for the latest completed files. It also returns this request's existing import (state and job id) for each occurrence.
  - Never returns download URLs, Zoom file ids, topics or passcodes.
- `importZoomRecording({ requestId, ownerProfileId, actingUserSystemId, meetingUuid, acknowledged })`:
  1. Validate `acknowledged === true` and `meetingUuid` (string of 1–200 chars, no control characters). Check the transcription interlock and binding.
  2. Re-list the approved hosts' recordings for the same window the picker uses. `meetingUuid` must appear in that listing, else `zoom_meeting_not_found` (404). Take `host_id` and `start_time` from the listing row. No Zoom call is made for a UUID the approved listing did not return.
  3. Call `getMeetingRecordings(meetingUuid)` for current file metadata and fresh `download_url`s. Its `host_id` must equal the listing row's, else `zoom_host_not_approved` (403).
  4. Choose the newest `completed` `audio_only` M4A (none → `zoom_audio_missing`, 422), plus the newest `completed` `audio_transcript` VTT if present. Captions (`closed_caption`) are not used; they carry no speaker labels.
  5. **Claim** the import row (see table): insert `state='importing'` with a 10-minute lease. The lease must stay longer than the route's 300-second `maxDuration`. If an active row exists for the same request and meeting, return it (state `started`) or reject it (`zoom_import_in_progress`, 409). An `importing` row past its lease is a request killed before its `finally` ran. Before replacing it, look up `transcription_jobs` by `owner_profile_id = row.actor_profile_id AND idempotency_key = row.id` (the job's unique key, `060_transcription_jobs.sql:64`). If that job exists, is past `uploading` and has not failed or expired, mark the row `started` with that job id and return it. If it is still `uploading`, retire it first (`retireMeetingUploadingJob`); if the retire loses because the job was queued meanwhile, mark the row `started`. Otherwise mark the row `failed` (`zoom_import_lease_expired`, or `zoom_import_job_ended` for a failed or expired job) and a new claim proceeds. If the retire or job read throws, the row stays `importing` and nothing is freed.
  6. Call `uploadMeetingTranscription` with `body = { filename: 'Zoom <start time ISO>.m4a', contentType: 'audio/mp4', bytes: audio.file_size, idempotencyKey: <import row id>, providerRegion: 'us', zoomTranscript?: { contentType: 'text/vtt', bytes } }`. Ignore the returned client tokens.
  7. Download the audio (and transcript), then `writePrivateContent` to the job's `input_cleanup_pathname` (and `zoom_transcript_cleanup_pathname`). Re-fetch meeting recordings for fresh `download_url`s first if more than 5 minutes passed since step 3.
  8. Call `startMeetingTranscription` with `{ expectedVersion, nonSensitiveAcknowledged: true }`, where `expectedVersion` is the `version` of the job returned by step 6 (after its upload-window reservation), not an earlier read.
  9. Mark the row `started` with `transcription_job_id`, or `failed` with a sanitized `failure_code`; both updates match `id` and `lease_token`, so only the holder writes. On an error, the job is checked before the row is failed. A job already queued means the row is marked `started` and the call succeeds. A job still `uploading`, including one found by idempotency key when the upload threw before returning it, is retired first. If the job cannot be read or retired, the row stays `importing` for the lease-expiry path and the original error is rethrown.
  - Any error from `uploadMeetingTranscription` or `startMeetingTranscription` is recorded as `failed` with its sanitized code and returned with its existing HTTP status. If `startMeetingTranscription` returns `dispatchPending: true`, the job is queued and the row is `started`; the existing hourly recovery cron dispatches it.
- No Dataverse writes, no SharePoint writes and no Zoom writes or deletes.

### Table — `lib/db/migrations/074_zoom_recording_imports.sql` (new)

```sql
CREATE TABLE IF NOT EXISTS zoom_recording_imports (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  zoom_meeting_uuid TEXT NOT NULL CHECK (char_length(zoom_meeting_uuid) BETWEEN 1 AND 200),
  zoom_host_id TEXT NOT NULL CHECK (char_length(zoom_host_id) BETWEEN 1 AND 100),
  zoom_meeting_start TIMESTAMPTZ NOT NULL,
  includes_zoom_transcript BOOLEAN NOT NULL,
  state TEXT NOT NULL,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  transcription_job_id UUID REFERENCES transcription_jobs(id) ON DELETE SET NULL,
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT zoom_recording_imports_state_check CHECK (state IN ('importing', 'started', 'failed')),
  CONSTRAINT zoom_recording_imports_lease_shape CHECK ((state = 'importing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT zoom_recording_imports_failed_shape CHECK ((state = 'failed') = (failure_code IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_recording_imports_active
  ON zoom_recording_imports (request_id, zoom_meeting_uuid) WHERE state IN ('importing', 'started');
CREATE INDEX IF NOT EXISTS idx_zoom_recording_imports_request_recent
  ON zoom_recording_imports (request_id, created_at DESC);
```

- `started` does not require `transcription_job_id`, because the FK nulls it when a job is purged.
- The row stores identifiers only: no content, URLs, tokens, topics or names.
- Re-importing a meeting is allowed once the earlier row is `failed`. A `started` row blocks duplicates for the same request while its job is live; when the job is `failed`, `expired`, missing, or has had deletion requested (a cancelled queued run stays `queued` until its audio is cleaned up), the row is marked `failed` (`zoom_import_job_ended`) and the meeting can be imported again. A `ready` or `submission_uncertain` job still blocks, to avoid duplicate spend.
- Retention of these rows follows later Stage 5 work and is recorded as open.
- The store module is `lib/services/meeting-tracker-recordings/import-store.js` and uses parameterized SQL only.

### Routes (new)

Both follow the transcriptions route preamble (`pages/api/meeting-tracker/visits/[requestId]/transcriptions.js:8-37`): `isGuid(requestId)`, `requireAppAccess(req, res, 'meeting-tracker')`, a linked profile, `Cache-Control: private, no-store`, `withDalContext('meeting-tracker-zoom-import', …)`, the same error envelope, and calls to services only.

- `GET /api/meeting-tracker/visits/[requestId]/zoom-recordings?days=30` returns either `{ available: false }` or `{ available: true, windowDays, meetings: [...] }`. `maxDuration: 60`.
- `POST /api/meeting-tracker/visits/[requestId]/zoom-imports` accepts exactly the keys `meetingUuid` and `nonSensitiveAcknowledged`, with an 8 kb body limit. It returns `{ import: { id, state, failureCode }, job }`. `maxDuration: 300`. The acting user comes from the session (`actorRefFromSession`), never the body.

Add both to `docs/API_ROUTE_SECURITY_MATRIX.md` under the common Meeting Tracker transcription guard.

### Card — step 1 (`shared/components/meeting-tracker/RecordingAndTranscriptCard.js`)

The card treats anything other than `available === true` as unavailable, so existing card test mocks (which return `{}` for unknown routes) keep the Stage 1 behavior without edits. The list is fetched only when staff open the import panel, never on card mount, so viewing a visit makes no Zoom call.

When `available`:
- Step 1's primary content is **Import from Zoom**. It lists meetings by Pacific date and time with duration and "Audio + Zoom transcript" or "Audio only". Already-imported meetings show their state instead of a button.
- Choosing a meeting shows the existing consent text (provider, plus Anthropic excerpt matching when a Zoom transcript is present, paid credits) and **Import and transcribe**.
- The current audio form, finished-transcript upload and video inputs move under a collapsed **Other ways to add a recording**.
- A busy import keeps step 1 open. Success reloads the transcription collection, so progress appears in step 1 as today.

When unavailable or the list fails, step 1 is unchanged from Stage 1, with a quiet line only on list failure.

## Verification required before review

- Unit tests:
  - Zoom client: token caching; pagination across windows; double encoding; redirect host rejection; HTML 200 rejection; size mismatch; 4711 mapping; no token or URL in thrown messages.
  - Import service: host not approved; audio missing; transcript optional; duplicate import returns the existing row; in-progress 409; expired lease takeover; global-slot conflict recorded as failed; byte write paths are the job's cleanup pathnames.
  - Routes: method, GUID and exact-body checks; actor from session.
  - Card: available versus unavailable; selection; consent gating; import busy keeps step 1 open; Other ways reveals uploads.
- `docs/CANONICAL_COUNTS.md` `api-route-file-count` rises by two; `check:fact-consistency` must pass.
- Gates (each with its self-test, sequentially): `check:migrations-manifest`, `check:atlas` (new `docs/atlas/postgres-zoom-recording-imports.md` and an Atlas index row), `check:api-routes`, `check:route-service-boundary`, `check:secret-scan`, `check:doc-currency`, `check:types`, scoped ESLint and the existing card suites.
- Docs: credentials runbook (add `ZOOM_RECORDING_HOSTS` and move the section from "local pilot only" to "proposed"), the workflow plan's Stage 3 note, and the wiki transcription topic if it names the input paths.
- The import re-lists the default 30-day window; the GET accepts up to 90 days. The card sends no `days`, so both use 30. A future picker offering a longer window must pass the same window to the import.
- Known limitation: the import POST is synchronous and can take a few minutes, with a busy indicator but no byte progress. Staff must keep the page open. A durable background job (Vercel Workflow, already used by transcription) is the upgrade path if this proves a problem.
- No live Zoom call is made in automated tests. One manual local import against the pilot host requires owner approval at that time; it spends transcription credits.

## Contract review (`/contract-reconcile` Mode A, 2026-10-08)

Surface: the step 1 import panel → two new visit routes → import service → Zoom API, private Blob and the existing transcription job/start services → `zoom_recording_imports` and `transcription_jobs` → the card's transcription collection and the zoom-recordings list.

| Audit | Result |
|---|---|
| Whole-flow | Caller → route guard → service → Zoom/Blob/job writes → response `{import, job}` → card reloads the collection. Each hop is named above. [PLANNED] |
| Partial success | One unit per import. A failure after the job is created retires the still-`uploading` job before freeing the slot (`retireMeetingUploadingJob`, fenced so it cannot also be queued). The retired job is expired by the existing cleanup sweep [VERIFIED via `lib/services/transcription-pilot/store.js:1877`, `:1970`]. A retry claims a new import row, so it gets a new idempotency key and a new job. `dispatchPending` counts as success; the hourly recovery cron dispatches it [VERIFIED via `vercel.json` cron `drain-transcriptions?recovery=1`, from delegated read]. |
| Async / stale state | Card: the import POST and list GET must use the card's existing request-generation guard, so a response for an earlier request never writes into the current one (the card is keyed by `requestId`). Server: the row lease outlives `maxDuration`. The final row update matches `id` and `lease_token`, so a takeover cannot be overwritten by the killed request. |
| Helper extraction | None. Existing services are called, not copied. `writePrivateContent` has `allowOverwrite: false` [VERIFIED via `runtime.js:397`], so bytes are written once per job; the new-job-per-retry rule keeps that safe. |
| Durable surface | Migration 074 and manifest; Atlas page and index row; API matrix rows; canonical route count; credentials runbook; tests named above. Cleanup of import rows is open (Stage 5). |
| Doc reconcile | Workflow plan Stage 3 note and credentials runbook in the same build; whole-repo `/sweep` not claimed. |
| Symbol fan-out | New table only; no existing enum or status changes. `transcription_jobs` rows are expired, never deleted (no `DELETE FROM transcription_jobs` in `lib/` or `scripts/`, checked with grep), so the FK `ON DELETE SET NULL` is a safety net only. |

Verdict: **ready to implement with the named changes already folded in above**, subject to owner approval of the three decisions.

## Review record (2026-10-08)

- **Claude review of the Sonnet build** found two defects. A `started` row blocked re-import forever even after its job failed or expired. A job queued just before a later error was recorded as `failed`, so a retry would pay twice. Both were fixed in `b877fc293`.
- **Codex adversarial review 1** (`gpt-6-astra`, base `c1ffd09cc`): needs-attention, one high finding. Failed imports left live `uploading` jobs, which blocked the card for up to 24 hours and could later be started. Fixed in `1cef46de3`:
  - A conditional `retireMeetingUploadingJob` (`lib/services/transcription-pilot/store.js`) fenced against `queueMeetingJob`.
  - Retire-before-release in the import catch path and the stale-lease takeover.
  - The card treats only queued and later statuses as blocking. This also removes a Stage 1 regression where any `uploading` job hid the audio form.
- **Codex adversarial review 2**: needs-attention, one medium finding. The picker never refreshed cached import states. Fixed in `b46117553` with a Refresh list button and a quiet reload when the job signature changes, but only after the panel is opened.
- **Codex adversarial review 3**: approve, no material findings. Codex reviewed source only; its sandbox could not run Jest.
- [VERIFIED via local commands at `b46117553`] 1,026 tests passed in 57 related suites (Zoom import, card, all `transcription-pilot-*` and `meeting-tracker-*`, `site-visit-editor-t5-matrix`). The gates and self-tests passed sequentially: migrations-manifest, atlas, api-routes, route-service-boundary, fact-consistency, canonical-pointers, secret-scan, doc-currency, doc-symbol-refs, build-claim-freshness, trust-boundary-guid, dataverse-access-layer, dynamics-context-boundary, model-override-warming, prompt-injection-tagging, scaffolding-tokens, docs-catalog, agent-invariants and types.
- Not yet done:
  - [VERIFIED via read-only `schema_migrations` read, 2026-10-08] The owner applied migration 074 to shared Production Postgres with `applied_by` `claude-s586-zoom-import-2026-10-08`; it applied only 074, and the empty `zoom_recording_imports` table exists. The branch is not merged.
  - No Vercel variables are set.
  - There has been no live import against Zoom; one manual local import needs owner approval because it spends transcription credits.
  - Nothing is merged.
