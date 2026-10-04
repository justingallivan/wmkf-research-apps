# Zoom VTT speaker mapping for Meeting Tracker transcriptions

Status: **BUILT ON BRANCH `feature/zoom-vtt-speaker-mapping` (2026-10-04, S572); NOT MERGED, NOT DEPLOYED, MIGRATION NOT APPLIED, PROMPT NOT SEEDED.** Plan rounds: Codex 1 to 3 NEEDS REWORK, round 4 READY WITH NAMED CHANGES (applied). Build stages 1 to 5b each passed a Sonnet build → Opus review loop (stage 5a required one reject-and-fix round for a wrong import source and claim shape that mocked tests had hidden). Build-time refinements recorded below: cue-exclusive support, Sonnet tier alias (D7), sample budget 160 000 / name budget 20 000, Executor `auditRetention`. Pending: Codex adversarial review of the branch, owner merge decision, apply 065 before deploy, seed the prompt row, production rehearsal on Request `1003222`.

## Problem

Meeting Tracker transcription jobs (`transcription_jobs`, AssemblyAI provider) return diarized speaker IDs (`A`, `B`, …). Staff currently name those speakers by hand through an owner-editable overlay (`speaker_names`, migration 062). Zoom now produces a WebVTT transcript with real display names per cue. The owner wants the program coordinator to upload the Zoom VTT alongside the audio, and the system to map Zoom names onto the AssemblyAI speaker IDs automatically, with the manual editor remaining as the fallback. The owner states that the existing transcripts without a VTT (owner-reported figure: four, 2026-10-04) will always need the manual path.

## Owner decisions (2026-10-04)

- D1 Surface: existing Meeting Tracker transcription panel; coordinator holds `meeting-tracker` access.
- D2 Arrival: VTT uploaded with the audio at job creation. Attaching a VTT to an existing job is a follow-up, not v1.
- D3 Auto-apply with a confidence floor; staff can still edit afterward.
- D4 Retain the VTT for the life of the job (deleted by the same purge that deletes the transcript).
- D5 Manual editor is primary when no VTT is present; de-emphasized ("Adjust names manually") when alignment succeeded.
- D6 (proposed, overridable) A VTT that parses but has no speaker labels does **not** block transcription; alignment status `no_speakers`, manual editor stays primary. Structural failures (size mismatch, missing blob, bad header) fail start closed.
- D7 Alignment is verified by a Claude call on the **Sonnet tier**, run through the Executor as a Tier-1 Dataverse prompt. The owner chose Sonnet (2026-10-04). The prompt row stores the `sonnet` tier alias, the convention most existing seed scripts follow [DERIVED-FROM: grep of the quoted wmkf_ai_model value across scripts/seed-*prompt*.js → six 'sonnet', one concrete 'claude-sonnet-4-6', one script with no model field; independent of TBD count], which resolves to the latest reviewed Sonnet in `lib/services/model-capabilities.js` and `lib/services/model-resolver.js:57`; at build time that is `claude-sonnet-5` [VERIFIED via `model-capabilities.js:200`, `model-resolver.js:57`]. Sonnet 5.5 is not yet a reviewed concrete id; adding it is a separate `check:model-registry`-gated commit (capability + pricing entries), after which the alias resolves to it without a prompt change. The deterministic overlap vote is a prior, not the decision.
- D8 Alignment runs as a **post-ready stage**, not inside the ready transition. A later meeting-summary call will be a sibling stage; it is out of scope for this cut.
- D9 (revision 4, proposed) The Executor gains one caller option, `auditRetention: 'content-free'`, that applies to every run-row write for that call, success or failure, at any stage: override variables are logged as `[redacted: <name>, <chars>]` regardless of prompt-row declarations, raw output retention is forced to `none`, and the failure envelope and notes carry only `code` and `stopReason`. This is a small change to a shared helper and needs owner sign-off; the alternative is listed under section 3.

## Codex rounds and how revision 3 answers them

| Round | Finding | Revision 3 answer |
|---|---|---|
| 1 high | Overlap agreement does not establish identity. | Overlap vote is a prior only. Sonnet 5.5 proposes; deterministic evidence verification in our code decides (section 2, `verifyAlignmentVerdict`). |
| 1 high | Alignment inside the worker shares the save deadline. | Alignment is a separate workflow step after ready, with its own lease and deadline. The ready transition only stamps `pending`. |
| 1 medium | VTT filename persisted in `options_snapshot`. | Filename never accepted or stored; `options_snapshot` records bytes only. |
| 2 high | Executor persists override variables unless declared bounded; failure envelopes embed `err.message`, stack, and JSON-parse excerpts. [VERIFIED via `lib/services/execute-prompt.js:1118-1122, 1319-1335, 937-946, 1142-1162`] | All prompt variables declare `dataClass` + `maxChars` so overrides are redacted. `rawOutputRetention: 'none'`. D9 (now `auditRetention: 'content-free'`, see round 3) removes message and stack from the failure envelope. Sentinel test asserts no transcript text or name in any run-row payload across success, invalid JSON, prompt-fetch failure. |
| 2 high | Alignment write without a version bump can interleave between publication file generation and freeze. [VERIFIED via `service.js:228-252`, `store.js:1162-1190`] | Alignment holds the job lease. Freeze requires a free lease and the expected version (`store.js:1166, 1184-1186`), so a publication that read the row before alignment fails with 409 at freeze, and one that starts during alignment fails at the lease check. The alignment write bumps the version. |
| 2 high | Reclaimed attempts and empty hand edits are not fenced. | Claim = acquire the job lease (token + expiry + version bump). Every alignment write is fenced on `lease_token AND lease_expires_at > NOW() AND version`. The speaker PATCH requires a free lease (`store.js:268`), so it cannot run during alignment; before alignment starts, PATCH atomically marks `pending` → `superseded`, including empty saves. |
| 2 high | A confident excerpt match can still misattribute a whole provider ID; recorded verdicts test application, not the model. | Verification is deterministic and ours: cited pairs must exist, must token-match, must be discriminative, and must be unique per name. Two verified names inside one provider ID → abstain for that ID (suggestions only). Per-speaker sample reservation before the global budget. Live acceptance on the sample pair, the shifted pair, and an unrelated pair. |
| 2 medium | Recovery after a crash following `finishStep` is unreachable; transient failures burn attempts. [VERIFIED via `pages/api/cron/drain-transcriptions.js:72-88`, `store.js:516-529`] | New bounded scan `claimNextPendingAlignmentJob` wired into the hourly recovery handler. Transient failures return the job to `pending` with `attempts` incremented; terminal failures set `failed`. |
| 3 high | Declaration-based redaction does not cover the failure path before declarations are parsed: `variableDecls` starts empty and the catch passes the raw overrides to the run-row writer. [VERIFIED via `execute-prompt.js:152, 164-177, 318-328, 1319-1333`] | D9 becomes `auditRetention: 'content-free'`, a caller option evaluated inside `writeRunRow` on every call path, so override redaction no longer depends on the prompt row having loaded. Sentinel test injects failures at prompt fetch, model resolution, and declaration parse. |
| 3 high | The verifier only examines the pairs the model cites, so a merged ID with strong evidence for two names can be applied to one by selective citation. | `verifyAlignmentVerdict` becomes name-agnostic: it computes support for every candidate name over every reserved sample of the ID, not just cited pairs. Two names with independent verified support → abstain, regardless of the verdict. The model's proposal is accepted only when it matches the sole supported name. |
| 3 medium | A crash during the third attempt leaves `running` forever: claim and recovery both require `attempts < 3`, and only `failAlignment` reaches `failed`. | Recovery gains an atomic terminal transition: `running` with an expired lease and `attempts ≥ 3` → `failed` with code `attempts_exhausted`, no model call, lease cleared. The scan predicate names `speaker_alignment->>'status'` explicitly and groups both branches under the shared eligibility guards. |
| 3 verified closed | Lease blocks PATCH and freeze; version bump closes the pre-alignment publication read; cleanup claims respect live leases; late-upload retention independent. [Codex-verified via `store.js:258-273, 1162-1186, 686-694, 1675-1758, 1783-1788`, `model.js:72-73`] | No change. |
| 4 high | Conflict detection required `minVerifiedPairs` for each name, so a 3:1 split applied the majority name over verified contrary evidence. | Conflict detection is separated from the application minimum: any second name with at least one verified discriminative sample abstains the ID. `minVerifiedPairs` applies only to an uncontested name. Fixture: 3:1 exact matches with selective citation → abstain, both suggestions. |
| 4 medium | Ordinary ready-job cleanup can claim and then release the lease (`lease_token` and `lease_expires_at` set to NULL) while alignment is still `running`, so recovery predicates written as `lease_expires_at <= NOW()` never match. [VERIFIED via `store.js:1675-1697, 686-698`; `worker.js:155-158`] | Both recovery branches use the shared free-or-expired predicate `(lease_token IS NULL OR lease_expires_at <= NOW())`. Fixture: claim three, expire, run cleanup through lease release, recover → `failed` / `attempts_exhausted`; an earlier attempt in the same state is reclaimable; a live cleanup lease is untouched. |
| 4 verified closed | D9 reaches every run-row write (`execute-prompt.js:215, 290, 321 → 1103`); single-token claiming specified; publication and live-lease protections unchanged. | No change. |

## Sample evidence

[VERIFIED 2026-10-04 via local inspection of the owner-supplied Zoom VTT, content not recorded]

- Header `WEBVTT`, blank line, then numbered cues: index line, `HH:MM:SS.mmm --> HH:MM:SS.mmm`, one text line.
- Every text line is `<display name>: <text>`. Names may contain commas (`Last, First`) and spaces; the delimiter is the first `: `. Zero multi-line cue bodies in the sample.
- Sample size: 507 cues, 8 distinct names, last cue ends 01:03:27; matching audio is a 41 MB `.m4a`, under the 50 MiB cap. [DERIVED-FROM: `grep -c -- '-->'` and name-prefix `uniq -c` over the local sample, `ls -la` on the audio; independent of TBD count]
- [ASSUMED] The VTT and the uploaded audio share one time base. Revision 3 does not depend on it: text agreement is the decision, and the overlap prior only orders candidates.

## Verified mechanics the design rests on

Each item below is [VERIFIED via the cited file:line], read this session on `main` at `cd6f69982`, 2026-10-04. Line numbers are a snapshot and will drift once the build begins.

- Overlay keyed by provider speaker ID, validated against the transcript: `lib/services/transcription-pilot/transcript-format.js:22-44` (`normalizeSpeakerNames`).
- Ready transition is one guarded UPDATE: `lib/services/transcription-pilot/store.js:780-808` (`publishReady`). Revision 3 adds only a status marker to it.
- Job lease primitives already exist and fence every worker write: claim template `store.js:1675-1697` (`claimCleanup`), release template `store.js:686-698` (`releaseReadyCleanupLease`), lease-fenced mutation `store.js:641-668`.
- Speaker PATCH requires `status='ready'`, the expected version, and a free lease, and bumps the version: `store.js:258-275` (`updateMeetingSpeakerNames`).
- Publication reads the row and generates files before freezing: `lib/services/meeting-tracker-transcription/service.js:228-252`. Freeze requires a free lease and the expected version, takes the lease, bumps the version, and snapshots `speaker_names`: `store.js:1162-1190`.
- The workflow loop calls `finishStep` and returns after `advanceJobStep` reports `complete`: `lib/services/transcription-pilot/workflow.js:93-101`. Steps are `'use step'` functions with `maxRetries`, independent of the worker deadline: `workflow.js:18-59`.
- Hourly recovery drains only running dispatches for non-ready jobs: `pages/api/cron/drain-transcriptions.js:72-88`, `store.js:516-529` (`listRunningWorkflowDispatches`). Ready jobs are outside it.
- Audio is deleted immediately after ready: `lib/services/transcription-pilot/worker.js:142-147`. The VTT must not join that step (D4).
- Purge deletes a hard-coded list of pathname columns; completion is computed from hand-written ANDs: `worker.js:319-328`, `store.js:1764-1797` (`finishLocalCleanup`), `store.js:1830-1845` (`expireContent`), pending check `worker.js:400-402`.
- Late-upload watch: both minted tokens would share `upload_valid_until` (`store.js:312,329`), but only the input path is retained under it (`store.js:813`, `store.js:1786`, `lib/services/transcription-pilot/model.js:72`).
- Owner projection nulls `speaker_names` when content is blocked or the receipt expired: `model.js:52-64`. `speaker_alignment` must mirror both.
- Panel seeds its draft from `job.speaker_names`: `shared/components/meeting-tracker/MeetingTranscriptionPanel.js:21-22,338`.
- Collection POST requires an exact key set: `pages/api/meeting-tracker/visits/[requestId]/transcriptions.js:9-20`. Start requires an exact key set: `pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/start.js:19-20`.
- Purged-content CHECK constraint: `lib/db/migrations/060_transcription_jobs.sql:95-100`.
- `speaker_names` reset sites that the new alignment column must mirror: `store.js:982, 1079, 1619, 1664, 1807, 1836, 1860`. [DERIVED-FROM: `grep -n "speaker_names = '{}'\|speaker_names = {}"` over store.js; independent of TBD count]
- Rehearsal fixture strict-null list: `lib/services/meeting-tracker-transcription/rehearsal-service.js:36-45`.
- Executor entry point and server-owned options: `lib/services/execute-prompt.js:92-110`; contract table `docs/EXECUTOR_CONTRACT.md:69-83`. Pattern for an all-override prompt with no writeback target: `lib/services/grantee-title-service.js:81-89`.
- Executor run logging: override variables are written to `wmkf_ai_promptoverride`, redacted only for variables declaring `dataClass` + `maxChars` (`execute-prompt.js:1118-1122, 1319-1335`); raw output follows `rawOutputRetention` (`full`, `hash`, `none`) (`execute-prompt.js:265-284`, `docs/EXECUTOR_CONTRACT.md:430`); the failure envelope records `err.message`, six stack lines, and retention-filtered output (`execute-prompt.js:1142-1162`); an invalid-JSON failure message embeds a short excerpt of the model text (`execute-prompt.js:937-946`; Node quotes the leading characters).
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
| `speaker_alignment` | JSONB NULL | `{ status, attempts, model, floor, speakers: { <id>: { name, confidence, prior, pairIds } }, suggestions: { <id>: [name] }, code? }` |

`status ∈ { pending, running, applied, partial, abstained, no_speakers, failed, superseded }`. Drop and re-add `transcription_jobs_purged_content_shape` so `zoom_transcript_pathname IS NULL AND speaker_alignment IS NULL` once purged. Bounded shape CHECK on `speaker_alignment` (object, 64 KiB cap, same bound as `speaker_names` in 062). Regenerate `lib/db/migrations-manifest.json`.

### 2. Pure module `lib/services/transcription-pilot/zoom-vtt.js` [PLANNED]

- `parseZoomVtt(text)` → `{ cues: [{ start, end, name, text }], names }`. Rejects a non-`WEBVTT` header, caps the cue count and name length (name length matches `MAX_SPEAKER_NAME_LENGTH`), strips control characters, delimiter = first `: `. Tolerates multi-line cue bodies and missing index lines.
- `buildAlignmentPrior(utterances, cues)` → per speaker ID, overlapped ms per Zoom name and the ranked candidates. Ordering only.
- `sampleAlignmentPairs(utterances, cues, { minPerSpeaker, maxPerSpeaker, maxChars })` → reserves `minPerSpeaker` utterances for every speaker ID first (spread across the recording, preferring longer utterances), then fills to the global character budget. Each sample gets a stable `pairId` and carries the utterance text plus the Zoom cues in a ±window with their names. No I/O.
- `computeNameSupport(samples, utterances, zoomNames, { minContentWords, minTokenOverlap })` → name-agnostic, verdict-independent, and **cue-exclusive** (build-stage decision 2026-10-04 after the Opus stage 2 review found that an uncaptioned or echoing speaker could inherit a neighbour's name when support was computed per name-bag within a window). Each Zoom cue is attributed to at most one utterance across all speaker IDs: the utterance within the cue's ±window whose text best matches that single cue's text, provided the match has at least `minContentWords` shared content words and word-set overlap ≥ `minTokenOverlap`; if the best match and the best match from a *different* speaker ID tie within 0.1, the cue is attributed to none (a near-tie between two utterances of the same speaker still attributes to that speaker). A name supports speaker ID X only through cues attributed to X's *sampled* utterances, and the count is the number of distinct attributed cues. Output: per ID, the set of names with verified discriminative support and the count for each. Known conservative limitations (both abstain rather than misname): one real person split by diarization into two IDs whose cues straddle the switch; and identical wording from two speakers within one window plus utterance length, including the inclusive window boundary.
- `verifyAlignmentVerdict(samples, support, verdict, { floor, minVerifiedPairs })` → the decision. For each speaker ID:
  1. If `support` shows two or more names with at least one verified discriminative sample each, the ID is abstained and all supported names become suggestions. One contrary verified sample is enough to abstain; `minVerifiedPairs` is an application minimum, not a conflict threshold. This runs before the verdict is consulted, so selective citation cannot hide a conflict.
  2. Otherwise, the verdict's name must be in the closed Zoom name set, must equal the sole supported name with ≥ `minVerifiedPairs` samples, and every cited `pairId` must exist, belong to this ID, and be among that name's supporting samples. Any violation rejects the ID (suggestion only, with the supported name if there is one).
  3. Applied only if the model's confidence ≥ `floor` and the checks above pass. A supported name with confidence below `floor` becomes a suggestion.
  Returns `{ names, alignment }` with `names` passed through `normalizeSpeakerNames`. Initial constants: floor 0.8, minContentWords 6, minTokenOverlap 0.5, minVerifiedPairs 2, minPerSpeaker 4, maxPerSpeaker 10, maxChars 160 000 (raised from 60 000 during stage 5a: eight speakers × four reserved samples × up to 4 500 chars must fit, since the owner sample has eight named speakers). The overlap tokenizer lowercases, strips punctuation, and drops a small stop-word list; the denominator is the smaller word set, so ASR and caption length differences do not penalize a true match. Constants are calibrated on the owner's sample pair before the floor is finalized, and the guarantee is explicitly bounded to the sampled evidence: an ID is pure only as far as its reserved samples show.

### 3. Executor prompt `meeting-transcript.speaker-alignment` [PLANNED]

- Tier-1 Dataverse prompt, seeded create-only by `scripts/seed-meeting-speaker-alignment-prompt.js` following the existing seed scripts. Model on the prompt row: the `sonnet` tier alias (see D7). Output schema `kind: none`, `rawOutputRetention: 'none'`. Caller passes `requireNoPersistence: true`, `deadlineMs` from the step budget, and `auditRetention: 'content-free'` (D9).
- Variables, all `override`, all declared `untrusted: true` with `dataClass: 'meeting_transcript'` and `maxChars` (160 000 for `speaker_samples`, 20 000 for `zoom_names`, 4 000 for `prior`; raised in stage 5a so a 200-name closed list and an eight-speaker reserved sample set fit). The declarations drive the A7 untrusted-content wrapper; they are not relied on for redaction, because D9 redacts independently of them.
- The prompt asks for one JSON object keyed by speaker ID: `{ name | null, confidence, pairIds: [...] , reason? }`. It states that the only acceptable evidence is matching wording between the utterance and a cue carrying that name, that timing proximity alone is not evidence, and that an ID whose samples match two different names must be returned as `null` with both names in `reason`.
- D9 Executor change: an `auditRetention` option defaulting to the current behavior. `'content-free'` is threaded into `writeRunRow` (`execute-prompt.js:1103`) and consulted there, so it covers the success write and the catch-path write at `execute-prompt.js:318-328` even when `promptRow`, `variableDecls`, or `outputSchema` are still null. Under it: `wmkf_ai_promptoverride` lists variable names and character counts only; `rawOutput` is replaced by `{ code, stopReason }`; `notes` carry `code`, `stopReason`, `semanticAttempt`, and `retryOfRunId` only. Unit-tested in the Executor suite with sentinel overrides and failures injected at prompt fetch, model resolution, declaration parse, provider call, and JSON parse. Alternative if the owner declines D9: call `createLLMClient` directly with the prompt text resolved from the Dataverse row and write no run row. Not recommended because it forks the Executor's audit lineage.
- Register the surface in `scripts/check-prompt-injection-tagging.js` `SURFACES` with preamble and call-site markers.

### 4. Create (collection POST) [PLANNED]

- Body gains optional `zoomTranscript: { contentType: 'text/vtt', bytes }` with a 4 MB cap. No filename is accepted or stored. Route check becomes required-keys + optional-keys.
- `createMeetingTranscriptionUpload` (`lib/services/transcription-pilot/runtime.js:72-110`) mints a second client token on `transcription-pilot/<owner>/<job>/input/zoom-transcript.vtt`, same `validUntil`, `allowedContentTypes: ['text/vtt']`. `options_snapshot` gains `{ zoomTranscript: { bytes } }` so idempotent replays compare it (`store.js:230-236`). Response adds `upload.zoomTranscript { pathname, token, maximumSizeInBytes }`.
- `createMeetingJob` (`store.js:194-238`) validates and inserts `zoom_transcript_cleanup_pathname`.

### 5. Start [PLANNED]

In `queueMeetingTranscription` (`runtime.js:112-137`), after the audio readback: if the row has a VTT cleanup path, read it (4 MB cap), verify `blob.pathname`, `contentType`, `bytes === declared`, `WEBVTT` header, and that `parseZoomVtt` succeeds. Structural failure → `zoom_transcript_invalid` 422 / `zoom_transcript_missing` 410 (fail closed; coordinator re-uploads). Zero speaker-labelled cues → not an error; `speaker_alignment = {status:'no_speakers'}` at queue time. Persist `zoom_transcript_pathname = cleanup pathname` and `zoom_transcript_sha256` in `queueMeetingJob` (`store.js:276-301`).

### 6. Ready transition [PLANNED]

`publishReady` (`store.js:780-808`) gains one computed assignment: `speaker_alignment = CASE WHEN zoom_transcript_pathname IS NOT NULL AND speaker_alignment IS NULL THEN '{"status":"pending","attempts":0}' ELSE speaker_alignment END`. No parameters, no reads, no model call.

### 7. Post-ready alignment stage [PLANNED]

New store functions, all in `store.js`, all following the lease templates:

- `claimJobForAlignment({ jobId, leaseSeconds = 180 })`: `UPDATE ... SET lease_token = $token, lease_expires_at = NOW() + lease, speaker_alignment = jsonb(status 'running', attempts + 1), version = version + 1 WHERE id AND status = 'ready' AND output_pathname IS NOT NULL AND zoom_transcript_pathname IS NOT NULL AND speaker_names = '{}' AND publication_operation_id IS NULL AND cleanup_requested_at IS NULL AND expires_at > NOW() AND (lease_token IS NULL OR lease_expires_at <= NOW()) AND (speaker_alignment->>'status' = 'pending' OR speaker_alignment->>'status' = 'running') AND (speaker_alignment->>'attempts')::int < 3 RETURNING *`. A `running` row is claimable only because its lease expired; the lease predicate enforces that.
- `completeAlignment({ jobId, leaseToken, expectedVersion, speakerNames, alignment })`: `UPDATE ... SET speaker_names = $names, speaker_alignment = $alignment, lease_token = NULL, lease_expires_at = NULL, version = version + 1 WHERE id AND lease_token = $token AND lease_expires_at > NOW() AND version = $v AND status = 'ready' AND speaker_names = '{}' AND publication_operation_id IS NULL AND cleanup_requested_at IS NULL RETURNING *`.
- `failAlignment({ jobId, leaseToken, expectedVersion, terminal, code })`: same fence; sets status `failed` when `terminal` or attempts ≥ 3, otherwise `pending`; stores `code`; releases the lease; bumps version.
- `claimNextPendingAlignmentJob({ limit })`: the recovery scan. It selects IDs only; the service then runs `claimJobForAlignment` per ID, so there is one claim path and one token issuer. Predicate: all of the claim's eligibility guards (`status = 'ready'`, VTT present, `speaker_names = '{}'`, no publication, no cleanup, not expired) AND `(lease_token IS NULL OR lease_expires_at <= NOW())` AND `((speaker_alignment->>'status' = 'pending' AND updated_at < NOW() - INTERVAL '2 minutes') OR speaker_alignment->>'status' = 'running')` AND `(speaker_alignment->>'attempts')::int < 3`, ordered by `updated_at`. A `running` row qualifies whenever its lease is free or expired, which covers the case where ordinary ready-job cleanup claimed and released the lease after the alignment attempt died (`store.js:1675-1697, 686-698`).
- `expireExhaustedAlignments({ limit })`: the terminal transition for the gap the claim cannot reach. `UPDATE ... SET speaker_alignment = jsonb(status 'failed', code 'attempts_exhausted'), lease_token = NULL, lease_expires_at = NULL, version = version + 1 WHERE status = 'ready' AND speaker_alignment->>'status' = 'running' AND (lease_token IS NULL OR lease_expires_at <= NOW()) AND (speaker_alignment->>'attempts')::int >= 3`. No model call. Runs in the recovery handler before the scan. A live lease is never touched.
- `updateMeetingSpeakerNames` (`store.js:263-270`) gains `speaker_alignment = CASE WHEN speaker_alignment->>'status' IN ('pending','running') THEN jsonb_set(status 'superseded') ELSE speaker_alignment END`. Because PATCH already requires a free lease, `running` here means an expired lease only.

Service `alignMeetingTranscriptionSpeakers({ jobId })` in `lib/services/meeting-tracker-transcription/alignment-service.js` [RECHECKED after lib/services/meeting-tracker-transcription/alignment-service.js change: file created in stage 5a (uncommitted at the time of this note); orchestrator trace found it importing the five alignment store functions from `runtime.js`, which does not export them (`store.js:2095-2099` does), and reading `claimed.lease_token` where the store returns `{ job, leaseToken }` (`store.js:812`); both are queued as stage 5a review fixes before commit]: claim → read transcript JSON and VTT from private Blob with a step-local deadline and verify both hashes → `buildAlignmentPrior`, `sampleAlignmentPairs`, `computeNameSupport` → `executePrompt` → parse → `verifyAlignmentVerdict` → `completeAlignment`. Any throw → `failAlignment` with `terminal` true for `zoom_transcript_missing`, hash mismatch, invalid verdict shape, or `stop_reason: 'refusal'`, and false for Executor transport or deadline errors. The job's `status` column never changes in this stage.

Workflow wiring: `alignSpeakersStep(jobId)` in `workflow.js`, `'use step'`, `maxRetries` 2, called after `finishStep` when `advanceJobStep` reports `complete`. A step retry re-enters through the claim, so a stale claim from a crashed step is reclaimed only after its lease expires. The hourly recovery handler (`drain-transcriptions.js:72-88`) additionally runs `expireExhaustedAlignments` and then `claimNextPendingAlignmentJob` with a small limit and the same service, within the existing deadline budget.

### 8. Cleanup symmetry (one invariant, many sites) [PLANNED]

- Add `zoom_transcript_cleanup_pathname` to: purge list `worker.js:321`; pending OR `worker.js:401`; `pathFields` and field→pointer map `store.js:1764-1771`; `allPathsCleared`/`allPointersCleared` `store.js:1792-1797`; `expireContent` NULL list `store.js:1834`; late-upload retention `store.js:1786` (retain alongside input); `model.js:72` `lateUploadWatchPending`.
- Do **not** add it to the non-purge list (`worker.js:322`) or the ready-time audio deletion (`worker.js:142-147`).
- Reset `speaker_alignment = NULL` at every `speaker_names = '{}'` site (listed above) and null it in the projection at `model.js:57,63`.
- Rehearsal strict-null list `rehearsal-service.js:36-45` gains the VTT columns and `speaker_alignment`; pinned tests `tests/unit/meeting-transcription-rehearsal-backend.test.js` and `tests/unit/meeting-transcription-rehearsal-fixture-operator.test.js` [NOT-READ: both — located by the inventory subagent; read before editing].

### 9. Projection and panel [PLANNED]

- `model.js` `OWNER_FIELDS` (`model.js:36-45`) + `runtime.js` `projectMeetingTranscriptionJob` (`runtime.js:43-68`): expose `speaker_alignment` (status, per-speaker confidence, suggestions; never pathnames, pair ids, or excerpt text) and `zoomTranscriptAttached` (boolean). Redact alignment with the other content fields when content is unavailable.
- Upload card: optional "Zoom transcript (.vtt)" input under the audio input; the single button gains an inline confirm step when the VTT slot is empty ("No Zoom transcript selected… Add transcript / Continue without it"); multi-file drop sorts by type. Upload both blobs with `@vercel/blob/client` `put` (`MeetingTranscriptionPanel.js:452-457`), then start. The confirmation resets whenever the selected files or the request change, and both uploads run under the existing generation and context guards (`MeetingTranscriptionPanel.js:423-470`).
- Acknowledgement copy (`MeetingTranscriptionPanel.js:778,786`) states that the recording goes to AssemblyAI and, when a Zoom transcript is attached, excerpts of both transcripts go to Anthropic for speaker matching.
- Ready view by alignment status: `pending`/`running` → "Matching speaker names from the Zoom transcript…"; Save names and Publish are disabled with that reason, since the server would answer 409 while the lease is held. `applied`/`partial` → "Speaker names from Zoom transcript" with per-speaker confidence, suggestions as one-click fills for unapplied IDs, editor behind "Adjust names manually". `abstained`/`no_speakers`/`failed`/`superseded` or no VTT → editor primary as today, with a one-line reason.

### 10. Docs [PLANNED]

`docs/atlas/postgres-transcription-pilot.md` and `docs/atlas/postgres-meeting-transcript-publications.md` (new dated status, columns, lease use, sources, `related:` 065); `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` (new Tier-1 prompt); `docs/API_ROUTE_SECURITY_MATRIX.md` rows for the collection and start routes; `docs/SERVICE_AND_UTILITY_CATALOG.md` transcription entries; `docs/EXECUTOR_CONTRACT.md` for the D9 option. No new route, so canonical route counts are unchanged. [NOT-READ: the Atlas, matrix, and catalog files above beyond the cited Executor contract lines — the inventory subagent located the rows; read before editing.] <!-- drain-table:ignore reason=atlas-file-path-contains-word-publications -->

## Invariant table

| Invariant | Files | Verification |
|---|---|---|
| Readiness never waits on the VTT or the model | `store.js publishReady`, `worker.js` | worker unit: ready path has no VTT read and no Executor import; integration: job ready with `pending` marker only |
| Every alignment write is fenced on the job lease and version | new store functions | pg integration: expired-lease reclaim then late write from the old token → zero rows; two claimers → one wins |
| Alignment never overwrites a hand edit or races a publication | lease + `speaker_names = '{}'` fence; PATCH supersede | pg integration: PATCH before claim → `superseded`, later claim finds nothing; publication read → alignment → freeze → 409; PATCH during lease → 409 |
| Alignment failure never changes job status | `alignment-service.js` | unit: Executor throw → `pending` or `failed`, job still `ready`, lease released |
| Transient failures retry; terminal failures stop; attempts capped at 3; a crashed third attempt cannot strand `running` | `failAlignment`, `claimJobForAlignment`, `expireExhaustedAlignments` | unit per failure class; third attempt → `failed`; pg integration: crash after claim three, expire lease, run recovery → `failed`, old token rejected; before expiry → no mutation |
| Conflict detection is independent of the verdict and of the application minimum | `computeNameSupport`, `verifyAlignmentVerdict` | unit: 2:2 and 3:1 long exact matches split two names, verdict cites only the majority at 0.99 → abstain with both suggestions |
| Recovery predicates match a released lease, not only an expired one | `claimNextPendingAlignmentJob`, `expireExhaustedAlignments` | pg integration: crashed attempt, cleanup claims and releases the lease, recovery still reaches the row; live cleanup lease untouched |
| Recovery reaches stranded jobs | `claimNextPendingAlignmentJob` in the cron handler | pg integration: crash simulated after `finishStep` → cron claims and completes |
| Shifted, unrelated, repeated-phrase, fabricated-citation, and merged-speaker inputs never auto-apply | `verifyAlignmentVerdict` | unit fixtures for each, including a verdict with confidence 0.99 citing a non-matching pair; live acceptance on the sample pair and its shifted copy |
| Low-talk speakers get reserved samples | `sampleAlignmentPairs` | unit: eight speakers with one dominant → every ID has ≥ `minPerSpeaker` samples |
| VTT survives ready-time audio deletion; deleted at purge | `worker.js:142-147, 319-328` | worker unit: deletedPaths for ready non-purge excludes VTT; purge includes it |
| Cleanup completion never set while VTT blob exists | `store.js finishLocalCleanup`, migration CHECK | pg integration: purge with VTT present → `content_purged_at` only after VTT path acknowledged |
| Late-upload watch retains VTT path like audio | `store.js:1786`, `model.js:72` | store unit |
| Client never chooses pathnames; VTT token is `text/vtt` only, size-capped; no filename persisted | `runtime.js createMeetingTranscriptionUpload`, `createMeetingJob` | runtime and store unit; row inspection after create |
| Idempotent replay with different VTT bytes conflicts | `store.js createMeetingJob` | store unit |
| No transcript text or name in any Dataverse run-row field, on any path | D9 `auditRetention: 'content-free'` inside `writeRunRow` | Executor unit capturing every `aiRunAdapter.create` payload for success and for failures injected at prompt fetch, model resolution, declaration parse, provider call, and JSON parse; transcript and name sentinels absent from every field including `wmkf_ai_promptoverride` and `wmkf_ai_notes` |
| Untrusted transcript content is tagged | `SURFACES` entry + markers | `check:prompt-injection-tagging` and its self-test |
| Pathname never reaches the client | `model.js OWNER_FIELDS`, projection tests | existing not-to-have-property tests extended |
| Fresh-agent review | — | `/codex:adversarial-review --wait` (OAuth) on this revision and on the build |

## Tests that fail if the feature is broken

- Split: one Zoom name across two provider IDs, each with verified pairs → both IDs get the name.
- Merge: two Zoom names with verified samples inside one ID, at 2:2 and at 3:1 → that ID abstains; both names become suggestions; nothing applied even at confidence 0.99, and even when the verdict cites only one name's pairs.
- Crash after the third claim, lease expired → recovery marks `failed` with `attempts_exhausted`; the panel re-enables Save names and Publish.
- Repeated short phrase ("Yes, thank you") as the only evidence → below `minContentWords` → suggestion only.
- Fabricated citation: verdict cites a pair whose cue does not match the utterance → pair discarded → below `minVerifiedPairs` → not applied.
- Shifted fixture: a shift larger than the sample window plus the inter-turn gap leaves no cue in any utterance's window → abstain. A shift inside the window keeps the correct names because wording, not timing, decides (invariant restated after the Opus stage 2 review; the earlier "30 s always abstains" wording overclaimed).
- Uncaptioned or echoing speaker (no cues of its own, repeats a neighbour's words) and own-cue-missed speaker → abstain under cue-exclusive attribution; a correctly captioned speaker in the same fixture is still named.
- Unrelated fixture (different meeting, same duration) → abstain.
- No speaker labels → `no_speakers` at queue time; start not blocked; no Executor call.
- Empty hand edit saved before claim → `superseded`; claim finds no row.
- Expired-lease reclaim → old token's completion write affects zero rows.
- Publication interleave → freeze returns null → 409.
- Purge deletes VTT path and clears `speaker_alignment`; ready-time deletion leaves it.
- Route: optional key accepted, unrecognized key rejected, `contentType` other than `text/vtt` rejected, filename key rejected.
- Run-row sentinel: transcript sentinel and name sentinel absent from every logged payload in success and both failure modes.

Existing suites to extend (locations from the inventory subagent; verify at build time): `tests/integration/transcription-pilot.pg.test.js` (migration list, deletedPaths), `tests/integration/meeting-tracker-transcription.pg.test.js` (`MIGRATION_PATHS`), `tests/unit/transcription-pilot-{worker,store,runtime,preflight,workflow}.test.js`, `tests/unit/meeting-tracker-transcription-{routes,panel,service-gates}.test.js`, `tests/unit/execute-prompt*.test.js` for D9.

## Out of scope (v1)

Attaching a VTT to an existing/ready job; admin pilot surface; retroactive mapping for the existing VTT-less transcripts; the meeting-summary call (sibling stage, next cut); persisting the Zoom meeting link on the job (the Site Visit "location or link" field already exists).

## Test venue

Owner-designated test Request `1003222` for the live Meeting Tracker rehearsal with the supplied sample pair. Prior privacy limits remain; no blanket confidential-recording clearance. The Tier-1 prompt seed runs against the Dataverse environment the owner designates; seeding is create-only.
