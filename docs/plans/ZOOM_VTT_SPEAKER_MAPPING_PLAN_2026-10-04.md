# Zoom VTT speaker mapping for Meeting Tracker transcriptions

Status: **PLAN, revision 2 (2026-10-04, S572). Not built. Revision 1 received a Codex adversarial NEEDS REWORK (three findings, all addressed below); revision 2 awaits a second Codex round on branch `feature/zoom-vtt-speaker-mapping`.**

## Problem

Meeting Tracker transcription jobs (`transcription_jobs`, AssemblyAI provider) return diarized speaker IDs (`A`, `B`, …). Staff currently name those speakers by hand through an owner-editable overlay (`speaker_names`, migration 062). Zoom now produces a WebVTT transcript with real display names per cue. The owner wants the program coordinator to upload the Zoom VTT alongside the audio, and the system to map Zoom names onto the AssemblyAI speaker IDs automatically, with the manual editor remaining as the fallback. The owner states that the existing transcripts without a VTT (owner-reported figure: four, 2026-10-04) will always need the manual path.

## Owner decisions (2026-10-04)

- D1 Surface: existing Meeting Tracker transcription panel; coordinator holds `meeting-tracker` access.
- D2 Arrival: VTT uploaded with the audio at job creation. Attaching a VTT to an existing job is a follow-up, not v1.
- D3 Auto-apply with a confidence floor; staff can still edit afterward.
- D4 Retain the VTT for the life of the job (deleted by the same purge that deletes the transcript).
- D5 Manual editor is primary when no VTT is present; de-emphasized ("Adjust names manually") when alignment succeeded.
- D6 (proposed, overridable) A VTT that parses but has no speaker labels does **not** block transcription; alignment status `no_speakers`, manual editor stays primary. Structural failures (size mismatch, missing blob, bad header) fail start closed.
- D7 (revision 2) Alignment is verified by a Claude call on **Sonnet 5.5** (`claude-sonnet-5-5`), run through the Executor as a Tier-1 Dataverse prompt. The deterministic overlap vote is a prior, not the decision.
- D8 (revision 2) Alignment runs as a **post-ready stage**, not inside the ready transition. A later meeting-summary call will be a sibling stage in the same place; it is out of scope for this cut.

## Codex round 1 (revision 1) and how revision 2 answers it

| # | Finding | Revision 2 answer |
|---|---|---|
| 1 high | Overlap agreement does not establish identity; a 30 s shifted VTT maps every speaker wrongly with share 1.0. | Overlap vote becomes a prior only. A Sonnet 5.5 call compares the actual words of sampled utterance/cue pairs per speaker ID and returns a verdict with quoted evidence. Shifted or unrelated transcripts fail text agreement and abstain. Test fixtures include the shifted case and an unrelated same-duration case; both must abstain. |
| 2 high | Alignment inside `saveCompletedTranscript` shares the worker deadline; a stalled VTT read can block readiness. | Alignment moves out of the worker entirely into a separate workflow step after the job is ready. The ready transition only stamps `speaker_alignment = {status:'pending'}` when a VTT is attached. No Blob read or model call happens on the readiness path. |
| 3 medium | VTT filename in `options_snapshot` survives content deletion until receipt expiry. | `options_snapshot` records only `{ zoomTranscript: { bytes } }`. The VTT filename is never persisted; the server-chosen pathname is the only identifier and lives in the pathname columns that purge clears. |

## Sample evidence

[VERIFIED 2026-10-04 via local inspection of the owner-supplied Zoom VTT, content not recorded]

- Header `WEBVTT`, blank line, then numbered cues: index line, `HH:MM:SS.mmm --> HH:MM:SS.mmm`, one text line.
- Every text line is `<display name>: <text>`. Names may contain commas (`Last, First`) and spaces; the delimiter is the first `: `. Zero multi-line cue bodies in the sample.
- Sample size: 507 cues, 8 distinct names, last cue ends 01:03:27; matching audio is a 41 MB `.m4a`, under the 50 MiB cap. [DERIVED-FROM: `grep -c -- '-->'` and name-prefix `uniq -c` over the local sample, `ls -la` on the audio; independent of TBD count]
- [ASSUMED] The VTT and the uploaded audio share one time base. Revision 2 no longer depends on this: text agreement is the decision, and the overlap prior only orders candidates.

## Verified mechanics the design rests on

Each item below is [VERIFIED via the cited file:line], read this session on `main` at `cd6f69982`, 2026-10-04. Line numbers are a snapshot and will drift once the build begins.

- Overlay keyed by provider speaker ID, validated against the transcript: `lib/services/transcription-pilot/transcript-format.js:22-44` (`normalizeSpeakerNames`).
- Ready transition is one guarded UPDATE (`status='saving' AND output_sha256 IS NULL`): `lib/services/transcription-pilot/store.js:780-808` (`publishReady`). Revision 2 adds only a status marker to it.
- The workflow loop returns after `advanceJobStep` reports `complete`, calling `finishStep` first: `lib/services/transcription-pilot/workflow.js:93-101`. Steps are `'use step'` functions with `maxRetries`; each runs with its own budget, independent of the worker's deadline: `workflow.js:18-59`. This is where the post-ready stage attaches.
- Audio is deleted immediately after ready: `lib/services/transcription-pilot/worker.js:142-147`. The VTT must not join that step (D4).
- Purge deletes a hard-coded list of pathname columns; completion is computed from hand-written ANDs: `worker.js:319-328`, `store.js:1764-1797` (`finishLocalCleanup`), `store.js:1830-1845` (`expireContent`), pending check `worker.js:400-402`.
- Late-upload watch: both minted tokens would share `upload_valid_until` (`store.js:312,329`), but only the input path is retained under it (`store.js:813`, `store.js:1786`, `lib/services/transcription-pilot/model.js:72`).
- Owner projection nulls `speaker_names` when content is blocked or the receipt expired: `model.js:52-64`. `speaker_alignment` must mirror both.
- Publication and correction drafts read the overlay from the row: `lib/services/meeting-tracker-transcription/service.js:214,242`. A publication that starts before alignment finishes must win; alignment must never overwrite a published or hand-edited overlay.
- Panel seeds its draft from `job.speaker_names`: `shared/components/meeting-tracker/MeetingTranscriptionPanel.js:21-22,338`.
- Collection POST requires an exact key set: `pages/api/meeting-tracker/visits/[requestId]/transcriptions.js:9-20`. Start requires an exact key set: `pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/start.js:19-20`.
- Purged-content CHECK constraint: `lib/db/migrations/060_transcription_jobs.sql:95-100`.
- `speaker_names` reset sites that the new alignment column must mirror: `store.js:982, 1079, 1619, 1664, 1807, 1836, 1860`. [DERIVED-FROM: `grep -n "speaker_names = '{}'\|speaker_names = {}"` over store.js; independent of TBD count]
- Rehearsal fixture strict-null list: `lib/services/meeting-tracker-transcription/rehearsal-service.js:36-45`.
- Executor entry point and server-owned options (`promptName`, `overrideVariables`, `runSource`, `deadlineMs`, `requireNoPersistence`): `lib/services/execute-prompt.js:92-110`; contract table `docs/EXECUTOR_CONTRACT.md:69-83`. Pattern for an all-override prompt with no writeback target: `lib/services/grantee-title-service.js:81-89`.
- Executor run logging writes the raw model output to Dataverse according to the prompt row's `rawOutputRetention` (`full` default, `hash`, `none`): `execute-prompt.js:265-284`, `docs/EXECUTOR_CONTRACT.md:430`.
- Tier-1 prompts live in Dataverse `wmkf_ai_prompts`, seeded create-only by a `scripts/seed-*-prompt.js` script and edited via `/admin`: `.claude-memory/project-prompt-governance.md`.
- LLM-input surfaces that carry untrusted content must be registered in the A7 inventory with preamble and call-site markers: `scripts/check-prompt-injection-tagging.js:89-118` (`SURFACES`).

## Plan

### 1. Migration `065_transcription_zoom_transcript.sql`

Add to `transcription_jobs`:

| Column | Type | Purpose |
|---|---|---|
| `zoom_transcript_pathname` | TEXT | live pointer to the private VTT blob |
| `zoom_transcript_cleanup_pathname` | TEXT | exact path to delete at purge |
| `zoom_transcript_sha256` | TEXT | hash verified at start, re-verified before alignment |
| `speaker_alignment` | JSONB NULL | `{ status, attempts, model, floor, speakers: { <id>: { name, confidence, prior, evidence } }, code? }` |

`status ∈ { pending, running, applied, partial, abstained, no_speakers, failed, superseded }`. Drop and re-add `transcription_jobs_purged_content_shape` so `zoom_transcript_pathname IS NULL AND speaker_alignment IS NULL` once purged. Bounded shape CHECK on `speaker_alignment` (object, 64 KiB cap, same bound as `speaker_names` in 062). Regenerate `lib/db/migrations-manifest.json`.

### 2. Pure module `lib/services/transcription-pilot/zoom-vtt.js` [PLANNED]

- `parseZoomVtt(text)` → `{ cues: [{ start, end, name, text }], names }`. Rejects a non-`WEBVTT` header, caps the cue count and name length (name length matches `MAX_SPEAKER_NAME_LENGTH`), strips control characters, delimiter = first `: `. Tolerates multi-line cue bodies and missing index lines.
- `buildAlignmentPrior(utterances, cues)` → per speaker ID, overlapped ms per Zoom name and the top candidates. Used only to order candidates and to pick samples.
- `sampleAlignmentPairs(utterances, cues, { perSpeaker })` → for each speaker ID, a bounded set of utterances spread across the recording, each with the Zoom cues in a ±window. Caps total characters so the prompt stays well under budget. No I/O.
- `applyAlignmentVerdict(content, verdict, { floor })` → validates the model's JSON (IDs exist in content, names exist in the VTT name set, confidence numeric), applies the floor, and returns `{ names, alignment }` with `names` already passed through `normalizeSpeakerNames`.

### 3. Executor prompt `meeting-transcript.speaker-alignment` [PLANNED]

- Tier-1 Dataverse prompt, seeded create-only by `scripts/seed-meeting-speaker-alignment-prompt.js` following the existing seed scripts. Model on the prompt row: `claude-sonnet-5-5`. Output schema `kind: none`, `rawOutputRetention: 'hash'` so no transcript text or names are retained in `wmkf_ai_runs`. Caller passes `requireNoPersistence: true`.
- Variables (all `override`): `speaker_samples` (the sampled pairs as untrusted content), `zoom_names` (the closed list of Zoom display names), `prior` (the overlap ranking). The prompt asks for one JSON object: per speaker ID, either a Zoom name from the closed list with a 0 to 1 confidence and the matching excerpt pair, or `null` with a reason. It must state that identical or near-identical wording across the pair is the only acceptable evidence; timing proximity alone is not.
- Register the surface in `scripts/check-prompt-injection-tagging.js` `SURFACES` with the preamble and call-site markers; transcript text is applicant-influenced content.
- Floor: confidence `≥ 0.8` applies; `0.5 to 0.8` records the candidate as a suggestion without applying; below is blank. Initial values are constants in `zoom-vtt.js`; the prompt row and the model are already editable through `/admin` without a deploy.

### 4. Create (collection POST) [PLANNED]

- Body gains optional `zoomTranscript: { contentType: 'text/vtt', bytes }` with a 4 MB cap. No filename is accepted or stored. Route check becomes required-keys + optional-keys.
- `createMeetingTranscriptionUpload` (`lib/services/transcription-pilot/runtime.js:72-110`) mints a second client token on `transcription-pilot/<owner>/<job>/input/zoom-transcript.vtt`, same `validUntil`, `allowedContentTypes: ['text/vtt']`. `options_snapshot` gains `{ zoomTranscript: { bytes } }` so idempotent replays compare it (`store.js:230-236`). Response adds `upload.zoomTranscript { pathname, token, maximumSizeInBytes }`.
- `createMeetingJob` (`store.js:194-238`) validates and inserts `zoom_transcript_cleanup_pathname`.

### 5. Start [PLANNED]

In `queueMeetingTranscription` (`runtime.js:112-137`), after the audio readback: if the row has a VTT cleanup path, read it (4 MB cap), verify `blob.pathname`, `contentType`, `bytes === declared`, `WEBVTT` header, and that `parseZoomVtt` succeeds. Structural failure → `zoom_transcript_invalid` 422 / `zoom_transcript_missing` 410 (fail closed; coordinator re-uploads). Zero speaker-labelled cues → not an error; recorded as `speaker_alignment = {status:'no_speakers'}` at queue time. Persist `zoom_transcript_pathname = cleanup pathname` and `zoom_transcript_sha256` in `queueMeetingJob` (`store.js:276-301`).

### 6. Ready transition [PLANNED]

`publishReady` (`store.js:780-808`) gains one computed assignment: `speaker_alignment = CASE WHEN zoom_transcript_pathname IS NOT NULL AND speaker_alignment IS NULL THEN '{"status":"pending","attempts":0}' ELSE speaker_alignment END`. No parameters, no reads, no model call. The worker is otherwise untouched.

### 7. Post-ready alignment stage [PLANNED]

- New `alignSpeakersStep(jobId)` in `workflow.js`, `'use step'`, `maxRetries` 2, invoked after `finishStep` when `advanceJobStep` reports `complete`. It is also reachable from the hourly recovery cron for jobs left `pending` or `running` past a timeout, so a lost workflow run cannot strand a job.
- Service function `alignMeetingTranscriptionSpeakers({ jobId })` in `lib/services/meeting-tracker-transcription/`:
  1. Claim: `UPDATE ... SET speaker_alignment = jsonb_set(status→'running', attempts+1) WHERE status='ready' AND speaker_alignment->>'status' IN ('pending','running'-stale) AND speaker_names = '{}' AND publication_operation_id IS NULL AND cleanup_requested_at IS NULL AND attempts < 3 RETURNING *`. No row → return; nothing to do.
  2. Read transcript JSON and VTT from private Blob with a step-local deadline; verify both hashes.
  3. Build prior and samples, call `executePrompt` with `deadlineMs`, parse the verdict, `applyAlignmentVerdict`.
  4. Write: `UPDATE ... SET speaker_names = $names, speaker_alignment = $alignment WHERE id AND version = $claimedVersion AND status='ready' AND speaker_names = '{}' AND publication_operation_id IS NULL AND cleanup_requested_at IS NULL`. Zero rows → a publication or hand edit won; record `superseded` without touching names.
  5. Any throw → `speaker_alignment.status = 'failed'`, `code` sanitized, names untouched. The job stays ready. After the attempt cap, status stays `failed` and the panel shows the manual editor as primary.
- Hand edits: the existing speakers PATCH is unchanged. If it runs while alignment is `pending` or `running`, the alignment write in step 4 finds `speaker_names <> '{}'` and records `superseded`.

### 8. Cleanup symmetry (one invariant, many sites) [PLANNED]

- Add `zoom_transcript_cleanup_pathname` to: purge list `worker.js:321`; pending OR `worker.js:401`; `pathFields` and field→pointer map `store.js:1764-1771`; `allPathsCleared`/`allPointersCleared` `store.js:1792-1797`; `expireContent` NULL list `store.js:1834`; late-upload retention `store.js:1786` (retain alongside input); `model.js:72` `lateUploadWatchPending`.
- Do **not** add it to the non-purge list (`worker.js:322`) or the ready-time audio deletion (`worker.js:142-147`).
- Reset `speaker_alignment = NULL` at every `speaker_names = '{}'` site (listed above) and null it in the projection at `model.js:57,63`.
- Rehearsal strict-null list `rehearsal-service.js:36-45` gains the VTT columns and `speaker_alignment`; pinned tests `tests/unit/meeting-transcription-rehearsal-backend.test.js` and `tests/unit/meeting-transcription-rehearsal-fixture-operator.test.js` [NOT-READ: both — located by the inventory subagent; read before editing].

### 9. Projection and panel [PLANNED]

- `model.js` `OWNER_FIELDS` (`model.js:36-45`) + `runtime.js` `projectMeetingTranscriptionJob` (`runtime.js:43-68`): expose `speaker_alignment` (status, confidence per speaker, suggestions; never pathnames or evidence text beyond a short excerpt) and `zoomTranscriptAttached` (boolean). Redact alignment with the other content fields when content is unavailable.
- Upload card: optional "Zoom transcript (.vtt)" input under the audio input; the single button gains an inline confirm step when the VTT slot is empty ("No Zoom transcript selected… Add transcript / Continue without it"); multi-file drop sorts by type. Upload both blobs with `@vercel/blob/client` `put` (`MeetingTranscriptionPanel.js:452-457`), then start. The confirmation resets whenever the selected files or the request change, and both uploads run under the existing generation and context guards (`MeetingTranscriptionPanel.js:423-470`).
- Acknowledgement copy (`MeetingTranscriptionPanel.js:778,786`) states that the recording goes to AssemblyAI and, when a Zoom transcript is attached, excerpts of both transcripts go to Anthropic for speaker matching.
- Ready view by alignment status: `pending`/`running` → "Matching speaker names from the Zoom transcript…" with the editor collapsed but reachable; `applied`/`partial` → "Speaker names from Zoom transcript" with per-speaker confidence, suggestions offered as one-click fills for unapplied IDs, editor behind "Adjust names manually"; `abstained`/`no_speakers`/`failed`/`superseded` or no VTT → editor primary as today, with a one-line reason.

### 10. Docs [PLANNED]

`docs/atlas/postgres-transcription-pilot.md` and `docs/atlas/postgres-meeting-transcript-publications.md` (new dated status, columns, sources, `related:` 065); `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` (new Tier-1 prompt); `docs/API_ROUTE_SECURITY_MATRIX.md` rows for the collection and start routes; `docs/SERVICE_AND_UTILITY_CATALOG.md` transcription entries; `docs/EXECUTOR_CONTRACT.md` caller list if it enumerates callers. No new route, so canonical route counts are unchanged. [NOT-READ: the Atlas, matrix, and catalog files above beyond the cited Executor contract lines — the inventory subagent located the rows; read before editing.]

## Invariant table

| Invariant | Files | Verification |
|---|---|---|
| Readiness never waits on the VTT or the model | `store.js publishReady`, `worker.js` | worker unit: ready path has no Blob read of the VTT and no Executor import; integration: job ready with `pending` marker only |
| Alignment applies at most once and never over a hand edit or publication | new service claim/write SQL | pg integration: concurrent PATCH then alignment write → `superseded`, names unchanged; publication started → zero-row write |
| Alignment failure never changes job status | new service | unit: Executor throw → status `failed`, job still `ready` |
| Shifted or unrelated VTT abstains | prompt + `applyAlignmentVerdict` | fixture-driven unit with a recorded verdict; live acceptance on the sample pair and on the sample pair shifted 30 s |
| VTT survives ready-time audio deletion; deleted at purge | `worker.js:142-147, 319-328` | worker unit: deletedPaths for ready non-purge excludes VTT; purge includes it |
| Cleanup completion never set while VTT blob exists | `store.js finishLocalCleanup`, migration CHECK | pg integration: purge with VTT present → `content_purged_at` only after VTT path acknowledged |
| Late-upload watch retains VTT path like audio | `store.js:1786`, `model.js:72` | store unit |
| Client never chooses pathnames; VTT token is `text/vtt` only, size-capped; no filename persisted | `runtime.js createMeetingTranscriptionUpload`, `createMeetingJob` | runtime and store unit; row inspection after create |
| Idempotent replay with different VTT bytes conflicts | `store.js createMeetingJob` | store unit |
| No transcript text or names retained in Dataverse run logs | prompt row `rawOutputRetention: 'hash'`, `requireNoPersistence: true` | seed-script unit asserting the schema; Executor meta assertion in the service test |
| Untrusted transcript content is tagged | `SURFACES` entry + markers | `check:prompt-injection-tagging` and its self-test |
| Pathname never reaches the client | `model.js OWNER_FIELDS`, projection tests | existing not-to-have-property tests extended |
| Fresh-agent review | — | `/codex:adversarial-review --wait` (OAuth) on this revision and on the build |

## Tests that fail if the feature is broken

- Split: one Zoom name across two provider IDs → both IDs get the name when the verdict confirms both.
- Merge: two Zoom names inside one ID → the verdict's choice applied only if confidence ≥ floor; the other never applied.
- No speaker labels → `{}` and `no_speakers` at queue time; start not blocked; no Executor call.
- Shifted fixture (sample VTT moved 30 s) → recorded verdict abstains → blanks and `abstained`.
- Unrelated fixture (different meeting, same duration) → abstains.
- Verdict naming an ID not in the transcript or a name not in the VTT list → rejected by `applyAlignmentVerdict`, status `failed`.
- Hand edit during `running` → `superseded`, hand edit preserved.
- Purge deletes VTT path and clears `speaker_alignment`; ready-time deletion leaves it.
- Route: optional key accepted, unrecognized key rejected, `contentType` other than `text/vtt` rejected, filename key rejected.

Existing suites to extend (locations from the inventory subagent; verify at build time): `tests/integration/transcription-pilot.pg.test.js` (migration list, deletedPaths), `tests/integration/meeting-tracker-transcription.pg.test.js` (`MIGRATION_PATHS`), `tests/unit/transcription-pilot-{worker,store,runtime,preflight,workflow}.test.js`, `tests/unit/meeting-tracker-transcription-{routes,panel,service-gates}.test.js`.

## Out of scope (v1)

Attaching a VTT to an existing/ready job; admin pilot surface; retroactive mapping for the existing VTT-less transcripts; the meeting-summary call (sibling stage, next cut); persisting the Zoom meeting link on the job (the Site Visit "location or link" field already exists).

## Test venue

Owner-designated test Request `1003222` for the live Meeting Tracker rehearsal with the supplied sample pair. Prior privacy limits remain; no blanket confidential-recording clearance. The Tier-1 prompt seed runs against the Dataverse environment the owner designates; seeding is create-only.
