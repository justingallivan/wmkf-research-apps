# Zoom VTT speaker mapping for Meeting Tracker transcriptions

Status: **PLAN, revision 1 (2026-10-04, S572). Not built. Awaiting Codex adversarial review on branch `feature/zoom-vtt-speaker-mapping`.**

## Problem

Meeting Tracker transcription jobs (`transcription_jobs`, AssemblyAI provider) return diarized speaker IDs (`A`, `B`, …). Staff currently name those speakers by hand through an owner-editable overlay (`speaker_names`, migration 062). Zoom now produces a WebVTT transcript with real display names per cue. The owner wants the program coordinator to upload the Zoom VTT alongside the audio, and the system to map Zoom names onto the AssemblyAI speaker IDs automatically, with the manual editor remaining as the fallback. The owner states that the existing transcripts without a VTT (owner-reported figure: four, 2026-10-04) will always need the manual path.

## Owner decisions (2026-10-04)

- D1 Surface: existing Meeting Tracker transcription panel; coordinator holds `meeting-tracker` access.
- D2 Arrival: VTT uploaded with the audio at job creation. Attaching a VTT to an existing job is a follow-up, not v1.
- D3 Auto-apply at ready with a confidence floor; staff can still edit afterward.
- D4 Retain the VTT for the life of the job (deleted by the same purge that deletes the transcript).
- D5 Manual editor is primary when no VTT is present; de-emphasized ("Adjust names manually") when alignment succeeded.
- D6 (proposed, overridable) A VTT that parses but has no speaker labels does **not** block transcription; alignment status `no_speakers`, manual editor stays primary. Structural failures (size mismatch, missing blob, bad header) fail start closed.

## Sample evidence

[VERIFIED 2026-10-04 via local inspection of the owner-supplied Zoom VTT, content not recorded]

- Header `WEBVTT`, blank line, then numbered cues: index line, `HH:MM:SS.mmm --> HH:MM:SS.mmm`, one text line.
- Every text line is `<display name>: <text>`. Names may contain commas (`Last, First`) and spaces; the delimiter is the first `: `. Zero multi-line cue bodies in the sample.
- Sample size: 507 cues, 8 distinct names, last cue ends 01:03:27; matching audio is a 41 MB `.m4a`, under the 50 MiB cap. [DERIVED-FROM: `grep -c -- '-->'` and name-prefix `uniq -c` over the local sample, `ls -la` on the audio; independent of TBD count]
- [ASSUMED] The VTT and the uploaded audio share one time base (same untrimmed Zoom recording). The alignment reports an overlap fraction so a bad time base is visible rather than silently wrong.

## Verified mechanics the design rests on

Each item below is [VERIFIED via the cited file:line], read this session on `main` at `cd6f69982`, 2026-10-04. Line numbers are a snapshot and will drift once the build begins.

- Overlay keyed by provider speaker ID, validated against the transcript: `lib/services/transcription-pilot/transcript-format.js:22-44` (`normalizeSpeakerNames`).
- Ready transition is one guarded UPDATE (`status='saving' AND output_sha256 IS NULL`), so fields added to it land atomically and once: `lib/services/transcription-pilot/store.js:780-808` (`publishReady`).
- Audio is deleted immediately after ready: `lib/services/transcription-pilot/worker.js:142-147`. The VTT must not join that step (D4).
- Purge deletes a hard-coded list of pathname columns; completion is computed from hand-written ANDs: `worker.js:319-328`, `store.js:1764-1797` (`finishLocalCleanup`), `store.js:1830-1845` (`expireContent`), pending check `worker.js:400-402`.
- Late-upload watch: both minted tokens would share `upload_valid_until` (`store.js:312,329`), but only the input path is retained under it (`store.js:813`, `store.js:1786`, `lib/services/transcription-pilot/model.js:72`).
- Owner projection nulls `speaker_names` when content is blocked or the receipt expired: `model.js:52-64`. `speaker_alignment` must mirror both.
- Publication and correction drafts read the overlay from the row: `lib/services/meeting-tracker-transcription/service.js:214,242`. Names must be applied before publish; worker placement guarantees it.
- Panel seeds its draft from `job.speaker_names`: `shared/components/meeting-tracker/MeetingTranscriptionPanel.js:21-22,338`.
- Collection POST requires an exact key set: `pages/api/meeting-tracker/visits/[requestId]/transcriptions.js:9-20`. Start requires an exact key set: `pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/start.js:19-20`.
- Purged-content CHECK constraint: `lib/db/migrations/060_transcription_jobs.sql:95-100`.
- `speaker_names` reset sites that the new alignment column must mirror: `store.js:982, 1079, 1619, 1664, 1807, 1836, 1860`. [DERIVED-FROM: `grep -n "speaker_names = '{}'\|speaker_names = {}"` over store.js; independent of TBD count]
- Rehearsal fixture strict-null list: `lib/services/meeting-tracker-transcription/rehearsal-service.js:36-45`.

## Plan

### 1. Migration `065_transcription_zoom_transcript.sql`

Add to `transcription_jobs`:

| Column | Type | Purpose |
|---|---|---|
| `zoom_transcript_pathname` | TEXT | live pointer to the private VTT blob |
| `zoom_transcript_cleanup_pathname` | TEXT | exact path to delete at purge |
| `zoom_transcript_sha256` | TEXT | hash verified at start, re-verified in worker |
| `speaker_alignment` | JSONB NULL | `{ status, floor, coverage, speakers: { <id>: { name, share, overlapMs } } }` |

Drop and re-add `transcription_jobs_purged_content_shape` so `zoom_transcript_pathname IS NULL AND speaker_alignment IS NULL` once purged. Bounded shape CHECK on `speaker_alignment` (object, 64 KiB cap, same bound as `speaker_names` in 062). Regenerate `lib/db/migrations-manifest.json`.

### 2. Pure module `lib/services/transcription-pilot/zoom-vtt.js` [PLANNED]

- `parseZoomVtt(text)` → `{ cues: [{ start, end, name, text }], names: [...] }`. Rejects non-`WEBVTT` header, caps the cue count and name length (name length matches `MAX_SPEAKER_NAME_LENGTH`), strips control characters, delimiter = first `: `. Tolerates multi-line cue bodies and missing index lines.
- `alignSpeakers(utterances, cues, { floor })` → for each utterance, credit overlapped ms to `(speakerId, name)`; per ID pick the max name; `share = winnerMs / totalMs`; apply only when `share ≥ floor`. Returns `{ names, alignment }` where `alignment.status ∈ { applied, partial, below_floor, no_speakers, no_overlap }` and `coverage = overlappedMs / totalUtteranceMs`.
- Floor is a module constant for v1 (initial value 0.6, tunable later; noted per mutable-parameters rule). No I/O.

### 3. Create (collection POST) [PLANNED]

- Body gains optional `zoomTranscript: { filename, contentType: 'text/vtt', bytes }` with a 4 MB cap. Route check becomes required-keys + optional-keys.
- `createMeetingTranscriptionUpload` (`lib/services/transcription-pilot/runtime.js:72-110`) mints a second client token on `transcription-pilot/<owner>/<job>/input/zoom-transcript.vtt`, same `validUntil`, `allowedContentTypes: ['text/vtt']`. VTT metadata goes into `options_snapshot` so idempotent replays compare it (`store.js:230-236`). Response adds `upload.zoomTranscript { pathname, token, maximumSizeInBytes }`.
- `createMeetingJob` (`store.js:194-238`) validates and inserts `zoom_transcript_cleanup_pathname`.

### 4. Start [PLANNED]

In `queueMeetingTranscription` (`runtime.js:112-137`), after the audio readback: if the row has a VTT cleanup path, read it (4 MB cap), verify `blob.pathname`, `contentType`, `bytes === declared`, `WEBVTT` header. Structural failure → `zoom_transcript_invalid` 422 / `zoom_transcript_missing` 410 (fail closed; coordinator can fix). Persist `zoom_transcript_pathname = cleanup pathname` and `zoom_transcript_sha256` in `queueMeetingJob` (`store.js:276-301`).

### 5. Worker [PLANNED]

In `saveCompletedTranscript` (`worker.js:88-152`) after `normalizeTranscript`: if `current.zoom_transcript_pathname`, read within the existing deadline, verify sha256, `parseZoomVtt`, `alignSpeakers`, then `normalizeSpeakerNames(normalized, names)`. Pass `speakerNames` and `speakerAlignment` to `publishReady` (new optional params, default null; admin pilot path passes nothing). Any throw → `speakerAlignment = { status: 'failed', code }`, names `{}`; never a job failure.

### 6. Cleanup symmetry (one invariant, many sites) [PLANNED]

- Add `zoom_transcript_cleanup_pathname` to: purge list `worker.js:321`; pending OR `worker.js:401`; `pathFields` and field→pointer map `store.js:1764-1771`; `allPathsCleared`/`allPointersCleared` `store.js:1792-1797`; `expireContent` NULL list `store.js:1834`; late-upload retention `store.js:1786` (retain alongside input); `model.js:72` `lateUploadWatchPending`.
- Do **not** add it to the non-purge list (`worker.js:322`) or the ready-time audio deletion (`worker.js:142-147`).
- Reset `speaker_alignment = NULL` at every `speaker_names = '{}'` site (listed above) and null it in the projection at `model.js:57,63`.
- Rehearsal strict-null list `rehearsal-service.js:36-45` gains the VTT columns and `speaker_alignment`; pinned tests `tests/unit/meeting-transcription-rehearsal-backend.test.js` and `tests/unit/meeting-transcription-rehearsal-fixture-operator.test.js` [NOT-READ: both — located by the inventory subagent; read before editing].

### 7. Projection and panel [PLANNED]

- `model.js` `OWNER_FIELDS` (`model.js:36-45`) + `runtime.js` `projectMeetingTranscriptionJob` (`runtime.js:43-68`): expose `speaker_alignment` and `zoomTranscriptAttached` (boolean; never the pathname). Redact alignment with the other content fields when content is unavailable.
- Panel: optional "Zoom transcript (.vtt)" input under the audio input; the single button gains an inline confirm step when the VTT slot is empty ("No Zoom transcript selected… Add transcript / Continue without it"); multi-file drop sorts by type. Upload both blobs with `@vercel/blob/client` `put` (`MeetingTranscriptionPanel.js:452-457`), then start.
- Ready view: with alignment `applied`/`partial`, show "Speaker names from Zoom transcript" with per-speaker share and collapse `SpeakerEditor` behind "Adjust names manually". Otherwise the editor is primary as today.

### 8. Docs [PLANNED]

`docs/atlas/postgres-transcription-pilot.md` and `docs/atlas/postgres-meeting-transcript-publications.md` (new dated status, columns, sources, `related:` 065); `docs/API_ROUTE_SECURITY_MATRIX.md` rows for the collection and start routes; `docs/SERVICE_AND_UTILITY_CATALOG.md` transcription entries. No new route, so canonical route counts are unchanged. [NOT-READ: the four docs above — the inventory subagent located the rows; read before editing.]

## Invariant table

| Invariant | Files | Verification |
|---|---|---|
| Names land atomically with ready, once | `store.js publishReady`, `worker.js saveCompletedTranscript` | unit: second publish attempt returns null; integration: row has names + alignment at ready |
| Alignment failure never fails the job | `worker.js` | unit: parser throw → job ready, alignment `failed` |
| VTT survives ready-time audio deletion; deleted at purge | `worker.js:142-147, 319-328` | worker unit: deletedPaths for ready non-purge excludes VTT; purge includes it |
| Cleanup completion never set while VTT blob exists | `store.js finishLocalCleanup`, migration CHECK | pg integration: purge with VTT present → `content_purged_at` only after VTT path acknowledged |
| Late-upload watch retains VTT path like audio | `store.js:1786`, `model.js:72` | store unit |
| Client never chooses pathnames; VTT token is `text/vtt` only, size-capped | `runtime.js createMeetingTranscriptionUpload` | runtime unit |
| Idempotent replay with different VTT metadata conflicts | `store.js createMeetingJob` | store unit |
| Names pass the single validator | `worker.js` → `normalizeSpeakerNames` | unit with over-long / control-char Zoom name |
| Pathname never reaches the client | `model.js OWNER_FIELDS`, projection tests | existing not-to-have-property tests extended |
| Fresh-agent review | — | `/codex:adversarial-review --wait` (OAuth) on the plan and on the build |

## Tests that fail if the feature is broken

- Split: one Zoom name across two provider IDs → both IDs get the name.
- Merge: two Zoom names inside one ID → winner applied only if share ≥ floor; loser never applied.
- No speaker labels → `{}` and `no_speakers`; start not blocked.
- Offset fixture (VTT shifted by thirty seconds) → shares drop below floor → blanks (proves the floor is live).
- Purge deletes VTT path and clears `speaker_alignment`; ready-time deletion leaves it.
- Route: optional key accepted, unrecognized key rejected, `contentType` other than `text/vtt` rejected.

Existing suites to extend (locations from the inventory subagent; verify at build time): `tests/integration/transcription-pilot.pg.test.js` (migration list, deletedPaths), `tests/integration/meeting-tracker-transcription.pg.test.js` (`MIGRATION_PATHS`), `tests/unit/transcription-pilot-{worker,store,runtime,preflight}.test.js`, `tests/unit/meeting-tracker-transcription-{routes,panel,service-gates}.test.js`.

## Out of scope (v1)

Attaching a VTT to an existing/ready job; admin pilot surface; retroactive mapping for the existing VTT-less transcripts; persisting the Zoom meeting link on the job (the Site Visit "location or link" field already exists).

## Test venue

Owner-designated test Request `1003222` for the live Meeting Tracker rehearsal with the supplied sample pair. Prior privacy limits remain; no blanket confidential-recording clearance.
