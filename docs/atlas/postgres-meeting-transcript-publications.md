---
title: "Atlas: Meeting Tracker transcript publications (Postgres)"
domain: postgres
kind: state-page
status: production-live-controlled-acceptance-passed
summary: "Migrations 063–064 and Wave 31 schema are verified in Production. Controlled non-sensitive end-to-end acceptance passed and staff access is enabled. Synthetic content was removed; publication audit and late-upload watch remain. Scheduled-time delivery is unobserved; confidential use is not approved."
canonical: true
cataloged: 2026-10-01
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-transcription-pilot.md
  - docs/plans/MEETING_TRACKER_TRANSCRIPTION_PLAN_2026-10-01.md
  - docs/plans/evidence/MEETING_TRANSCRIPTION_READINESS_CHECK_2026-10-02.md
  - lib/db/migrations/063_meeting_tracker_transcription.sql
  - lib/db/migrations/064_meeting_transcript_close_attribution.sql
  - lib/db/migrations/065_transcription_zoom_transcript.sql
  - lib/services/transcription-pilot/store.js
  - lib/services/meeting-tracker-transcription/alignment-service.js
  - docs/plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md
---

# Atlas: Meeting Tracker transcript publications (Postgres)

## Status

**[PRODUCTION-LIVE AFTER CONTROLLED ACCEPTANCE — 2026-10-02 PT.]** Migration 063 adds
request/Site Visit bindings to `transcription_jobs` and defines
`meeting_transcript_publications`; migration 064 adds the optional
`closed_by_profile_id` audit field. **[VERIFIED via dedicated test-Neon
bootstrap and independent verify-only, 2026-10-02]** fresh schema in the
isolated `wmkf-meeting-transcription-test` Preview project contains all 61
tracked migrations and 9 required tables; this is not a shared application
database or the old pilot database. **[VERIFIED via isolated local PostgreSQL
16 integration run, 2026-10-02]** a disposable test schema
applied migrations 060–064; the four new Meeting Tracker tests and 19 existing
pilot tests passed (23/23). The new tests cover binding/source constraints,
competing publication and cleanup fencing, recovery lease fencing, and close
actor attribution. A real candidate-writer run exposed an unknown `$3`
parameter; root corrected it with `$3::text`, with no other production-code
fix required by that database check. **[VERIFIED via owner-authorized
Production migration apply and read-only physical readback, 2026-10-02]** The
Production migration ledger matches all 64 manifest entries, with no missing
or extra names. `transcription_jobs` is present with 61 columns, 27
constraints and 10 indexes; `transcription_workflow_dispatches` has 10/7/2;
`meeting_transcript_publications` has 30/17/4. All three tables had zero
rows in this read-only pre-acceptance probe, which used a read-only transaction
and rollback. The disabled-release receipt linked below is a historical
checkpoint, not the current Production state.
The dedicated AssemblyAI pilot's deployment
and isolated-Neon state are recorded separately in [the pilot Atlas](postgres-transcription-pilot.md);
those historical claims are unchanged by these source migrations.

Production schema readiness, bundle readiness, and broad staff access were
enabled after controlled, non-sensitive acceptance on 2026-10-02 PT. The full
hosted flow passed: audio upload, AssemblyAI transcription, speaker-label edit,
TXT/VTT downloads, Request Document publication, and Workbench visibility.
Synthetic content was removed and its published SharePoint files were verified
absent. The registry record was soft-retired; the publication/audit receipt and
late-upload safety watch remain by design. This does not authorize confidential
recordings. The owner accepted provider training opt-out and one-day retention
for non-sensitive use; this is not zero-data-retention. The global active
provider-slot limit remains unchanged. A valid text-only provider draft with
no timed utterances remains readable and downloadable as TXT; publication
fails with `meeting_transcript_timed_vtt_required` and does not invent cue
times or publish an empty VTT. Wall-clock delivery of the registered daily and
hourly schedules remains unobserved despite successful platform-triggered
checks. The incomplete-maintenance warning was accepted for delivery but not
confirmed in the recipient inbox.

## Ownership and relationships

`meeting_transcript_publications` is designed as an operational receipt and
recovery ledger, not a transcript-content store. Transcript bytes remain in
private temporary storage while a job is active and in governed SharePoint for
published products. The table comment explicitly says transcript bytes remain
in governed SharePoint. Its `operation_id` UUID is the primary key. It binds a
Dataverse request and exact Site Visit activity UUID without Postgres foreign
keys; `initiator_profile_id` and optional `published_by_profile_id` reference
`user_profiles.id`.

Each publication has exactly one source by database CHECK: either
`input_job_id` references `transcription_jobs.id`, or `source_artifact_id`
identifies a prior governed artifact. `input_job_version` freezes the job
version when publishing from a job; `source_revision_id` identifies the source
revision when correcting. `expected_current_artifact_id` and its optional
SHA-256 fingerprint record the current artifact precondition. These artifact
UUIDs represent Dataverse identities and are not declared Postgres foreign
keys.

The migration also adds these nullable columns to `transcription_jobs`:

| Column | Purpose / constraint |
|---|---|
| `request_id` | Dataverse request UUID; paired with the Site Visit binding below. |
| `site_visit_activity_id` | Exact Site Visit activity UUID; a CHECK requires it to be null exactly when `request_id` is null. |
| `publication_operation_id` | Active publication operation associated with the job. |
| `updated_by_profile_id` | Profile attribution; references `user_profiles.id`. |

**[BUILT ON BRANCH `feature/zoom-vtt-speaker-mapping`, 2026-10-04; NOT APPLIED; NOT DEPLOYED.]**
Migration 065 adds these nullable columns to `transcription_jobs` for the optional
Zoom WebVTT upload and automatic speaker naming:

| Column | Purpose / constraint |
|---|---|
| `zoom_transcript_pathname` | Live pointer to the private Zoom VTT blob; retained for the life of the job; cleared at purge. |
| `zoom_transcript_cleanup_pathname` | Exact server-minted path deleted at purge; retained under the late-upload watch like the audio input path. |
| `zoom_transcript_sha256` | Hash verified at start and re-verified before alignment. |
| `speaker_alignment` | Bounded JSONB status/result (`pending`, `running`, `applied`, `partial`, `abstained`, `no_speakers`, `failed`, `superseded`); CHECK `transcription_jobs_speaker_alignment_shape`; must be null once content is purged (re-created `transcription_jobs_purged_content_shape`). |

Alignment is a post-ready stage: the ready transition only stamps `pending`; a
workflow step (and the hourly recovery cron) claims the job lease, reads the
transcript and VTT, calls the `meeting-transcript.speaker-alignment` Executor
prompt content-free, verifies the verdict against cue-exclusive wording support,
and writes `speaker_names` plus `speaker_alignment` under the lease and version
fence. A publication that exists for the job, a hand edit, or a held lease makes
alignment yield (`superseded` / 409), never overwrite. Service:
`lib/services/meeting-tracker-transcription/alignment-service.js`.

An index supports recent request-bound job listing. Migration 063 leaves the
global active provider-slot index from migration 060 unchanged: jobs in
`submitting`, `processing`, `saving`, or `submission_uncertain` continue to
share one active slot across pilot and Meeting Tracker scopes. It creates no
separate Meeting Tracker provider concurrency allowance.

## Publication receipt schema

The receipt freezes bounded identifiers and publication state, including:

- Source identity: `input_job_id`, `input_job_version`, or
  `source_artifact_id` / `source_revision_id`.
- Actor and target binding: request, exact Site Visit, initiator, publisher
  profile, and `published_by_system_id` (the mapped Dataverse staff identity).
- Version checks: expected current artifact ID/fingerprint, frozen input hash,
  operation state/version, and lease token/expiry.
- Candidate and verified output identities: `candidate_paths`,
  `verified_files`, and `resulting_document_id`; `slot_fence_version` binds
  publication/recovery to the shared `TRANSCRIPT` slot fence.
- Recovery and retention metadata: `error_code` (TEXT; the fixed error-code
  vocabulary is an application contract, not a database CHECK), `expires_at`,
  `quarantine_until`, `closed_by_profile_id` (migration 064; profile that
  explicitly closed the receipt), and timestamps.

Allowed states are `draft`, `publishing`, `published`,
`published_reconcile`, `retryable`, `unknown`, and `closed`. A verified
publication that has since been superseded is terminal `published` with
`error_code = 'publication_superseded'`; it is not unresolved or closeable.
Database checks
require paired lease token/expiry, 64-hex fingerprints when present, object
JSON for frozen names/candidate paths/file descriptors within 64 KiB, 16 KiB,
and 32 KiB respectively, exactly one source kind, and `expires_at` only on a
`draft` row. The store further requires the frozen candidate path object and
verified descriptor object to have exactly `source`, `txt`, and `vtt` roles;
candidate paths are operation-specific beneath the request transcript path.

Indexes support request history, unresolved recovery states, and unresolved
job-linked operations. Although the schema includes `quarantine_until`, no
candidate quarantine or candidate deletion is implemented. Partial candidate
sets and unresolved receipts are retained for operator attention. Transcript
text is not intended in these JSON columns: the store freezes bounded speaker
labels and persists candidate paths and verified-file descriptors. The DDL
checks JSON object type and total size, not the complete semantic shape or
contents; callers enforce those contracts.

## Source implementation status

The checked-in migration is `lib/db/migrations/063_meeting_tracker_transcription.sql`.
In `lib/services/transcription-pilot/store.js`,
`freezeMeetingPublicationFromJob` transactionally checks a ready, unexpired,
unpurged job at the expected version and exact request/Site Visit binding,
leases the job, and inserts a `publishing` receipt with the output hash, frozen
speaker-name map, publisher/initiator IDs, and three candidate paths.
`renewMeetingPublicationJobLease` renews that request-bound job lease.
`closeMeetingPublicationJobLease` accepts the three verified descriptor roles,
stores their bounded metadata, clears the frozen label map and leases, and
releases the job's publication binding under version/token checks. In the
source, receipt fields `published_by_system_id` and `slot_fence_version` are
captured before SharePoint writes. Recovery re-verifies all three persisted
files (TXT, VTT, and source) and may resume registry finalization only after
reacquiring the same original slot-fence version. Any currently authorized
Meeting Tracker staff member with a mapped Dataverse identity may explicitly
resume through the guarded reconciliation route. The route supplies the
current session actor for the resumed Request Document write; the receipt's
original publisher fields remain provenance for the initial publish intent and
are never used to impersonate that person. A missing or mismatched registry
row, incomplete candidate set, failed identity/content check, or unavailable
original fence is retained for operator attention; the code does not delete
or quarantine files.

`requestMeetingJobCleanup` version-checks and locks the bound job, then returns
a conflict while an associated receipt is `publishing`, `retryable`, `unknown`,
or `published_reconcile`. This is a source-level delete barrier; it is not a
complete destructive cleanup process. Existing daily maintenance performs a
bounded inspection of at most 20 unresolved publication receipts, verifies
only exact recorded identities, marks checked receipts so older untouched
receipts rotate forward, and reports operator-attention cases. It does not
resume publication, delete candidates, or quarantine files. The final products
are intended to outlive temporary job cleanup under the existing
governed-material retention posture. No final-product expiration or deletion
mechanism is added here.

The source has two explicit close cases. If publication freezes but no slot
fence or verified candidate has been recorded, its failure handler can close
the receipt only under the matching live job-publication lease and release that
same job lease; it does not imply that a SharePoint write occurred. For a
partial/uncertain attempt, staff may use
`POST /api/meeting-tracker/visits/[requestId]/transcriptions/publications/[operationId]/close`
with exactly `{acknowledgeRetainedFiles:true}` only after `quarantine_until`
and matching receipt/job/slot leases have expired. Freeze, lease renewal, and
recovery reclaim persist/extend the quarantine deadline to at least ten minutes
after the matching receipt lease expiry; close also proves that the matching
job and slot leases are no longer active. It never releases an unrelated
cleanup token. The service performs an
authoritative generation-key lookup: a lookup error fails closed, any matching
row is handed to reconciliation, and only an exact zero-row result permits
closure. Closure records `closed_by_profile_id`, clears the matching stale job
binding, and retains every candidate path and SharePoint file; it does not
delete or quarantine files. The operator explicitly acknowledges that
retention in the request.

For ordinary reconciliation, a verified receipt whose Request Document has
been superseded is marked terminal `published` (with the superseded error
code), and the newer current artifact remains unchanged.

## Deployed follow-up behavior and bounded verification

Formatter/schema v3 (branch-built 2026-10-04, owner decision after the Oregon
State rehearsal) renders readable TXT as one paragraph per speaker turn, each
prefixed with the turn's start time, with no minute sections; consecutive
utterances by the same speaker ID merge, so a multi-minute monologue reads as
one paragraph. The source shape is identical to v2 (optional word timings kept).
New publications use v3; `TRANSCRIPT_FORMATTER_VERSIONS` in
`lib/services/transcription-pilot/transcript-format.js` is the single accepted-
version list for the bundle builder, the manifest validator and the store, and
recovery still rebuilds v1 and v2 byte-for-byte through the recorded version.
The deployed flow supports Meeting Tracker bundle formatter/schema v2
with optional, validated word timings. When word spans align with the exact
utterance text, readable TXT may split an utterance at timed minute boundaries
without dropping its punctuation or changing speaker attribution; absent or
misaligned timings retain whole-utterance v1 behavior. VTT continues to use the
original utterance cues. New publications use v2; recovery accepts explicit v1
and v2 source/manifests and rebuilds using the receipt's frozen formatter
version so legacy v1 hashes remain reproducible. Optional word data is omitted
if needed to stay within the existing 4 MB bounds. Formatter v2 was exercised
in the Production acceptance flow; no additional database migration was
required for this format change.
The correction UI consumes the service's normalized speaker/start/end/words
shape, including timed turns with empty top-level text. A worker retry also
preserves an already-written legacy output only after an exact byte match;
this is separate from publication receipt replay.

The shared worker's bounded daily drain excludes each job already attempted in
that pass. After save-time or daily ready-job cleanup, including an error exit, it
releases only the matching still-valid ready lease using its token and version;
publication-bound, cleanup-requested, stale, or mismatched leases are not
released by that helper. This does not change the global active provider-slot
limit. Cleanup state separately projects observed content deletion and a
pending late-upload watch. It retains the exact input pathname and upload
window until a verified closure condition exists; expiry or a successful
delete/HEAD observation is not treated as proof that late writes are
impossible. Daily/hourly schedules are registered and platform-triggered
invocations succeeded; scheduled-time delivery remains unobserved. The
2026-10-02 disabled-release checkpoint remains historical. The dedicated
isolated pilot's separate hosted behavior is unchanged. See the [dated release
receipt](../plans/evidence/TRANSCRIPTION_DISABLED_RELEASE_2026-10-02.md) for
that pre-merge boundary.

Historical implementation verification: the builder reported five focused Jest suites (95 tests) and changed-source
ESLint passing. Root's in-memory PGlite SQL check verified ready-lease release
with matching token/version and rejection of wrong-token or stale-version
release, plus same-drain claim exclusions; it also verified that an existing
`audio_deleted_at` value survives the first cleanup write. This is not a native
PostgreSQL integration run, hosted verification, or concurrent-drain proof.
Root's synthetic desktop/mobile UI check showed the same long utterance split
between 0:00 and 1:00 without overflow; it does not exercise a provider or live
deployment.

## Historical synthetic Preview speaker rehearsal

An earlier isolated Preview-only rehearsal was source-implemented and Sol/Fable-reviewed for a fixed synthetic job. It could read that ready job's transcript
and private Blob output and save only the validated `speaker_names` overlay;
the endpoint must not start, upload, queue, dispatch, or claim worker work.
Access additionally required the exact test request/visit binding, pinned
staff identity, dedicated Preview project, and
`MEETING_TRANSCRIPTION_REHEARSAL_ENABLED=on`. **[HOSTED SCOPED REHEARSAL VERIFIED]**
The isolated Preview deployment was READY at the time. Signed-in Chrome loaded three synthetic
speakers; manual label save survived full-page reload, and TXT contained the
three labels with entries at 0:00, 1:00, and 2:00. Anonymous collection
returned 401; normal Tracker dashboard and rehearsal-start POST returned 404.
VTT browser download was unverified in that Preview rehearsal despite an HTTP
200 server log. This is historical and distinct from the later successful
Production provider/publication flow, which independently verified TXT/VTT.
The rehearsal added no table and did not itself enable Production processing.

## Source evidence

- Migrations: `lib/db/migrations/063_meeting_tracker_transcription.sql` and
  `lib/db/migrations/064_meeting_transcript_close_attribution.sql` (applied to
  Production and dedicated Preview test Neon; Production physical schema
  readback is summarized above; also exercised in disposable local PostgreSQL
  16 integration).
- Store: `lib/services/transcription-pilot/store.js`.
- Zoom VTT speaker alignment (merged; migration 065 is in Production `schema_migrations` [VERIFIED 2026-10-05 via the owner-run `apply-migrations.js` output, which skipped 065 as already applied]): `lib/db/migrations/065_transcription_zoom_transcript.sql`, `lib/services/transcription-pilot/zoom-vtt.js`, `lib/services/meeting-tracker-transcription/alignment-service.js`, and [Zoom VTT speaker mapping plan](../plans/ZOOM_VTT_SPEAKER_MAPPING_PLAN_2026-10-04.md).
- Settled product and publication contract: [Meeting Tracker transcription plan](../plans/MEETING_TRACKER_TRANSCRIPTION_PLAN_2026-10-01.md).
- Dedicated pilot deployment and isolated Neon evidence: [AssemblyAI transcription pilot Atlas](postgres-transcription-pilot.md).

The existing-database migration path is `node scripts/apply-migrations.js`;
fresh-install-only `scripts/setup-database.js` must not be used on a populated
database. Migrations 063–064 were applied to Production and physically
verified on 2026-10-02. Controlled acceptance subsequently enabled Production
staff access; schema application alone was not release authorization.
