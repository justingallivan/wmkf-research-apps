---
title: "Atlas: Zoom recording imports (Postgres)"
domain: postgres
kind: state-page
status: planned
summary: "Migration 074 defines zoom_recording_imports: one row per attempt to import a Zoom meeting's audio and Zoom transcript into the Meeting Tracker transcription pipeline, with a lease so a killed request cannot overwrite a takeover. Written on a branch only; not applied to any database."
canonical: true
cataloged: 2026-10-08
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-transcription-pilot.md
  - docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md
  - lib/db/migrations/074_zoom_recording_imports.sql
  - lib/services/meeting-tracker-recordings/import-store.js
  - lib/services/meeting-tracker-recordings/import-service.js
---

# Atlas: Zoom recording imports (Postgres)

## Status

**[PLANNED, branch only 2026-10-08.]** Migration 074 is written on `codex/meeting-transcript-ux`. It is not applied to any database and nothing is merged. Applying it, setting the Zoom environment variables and merging each need a separate owner go-ahead (`docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md`).

## Ownership and contract

`zoom_recording_imports` holds one row per import attempt for a request's Site Visit meeting. It stores identifiers and lifecycle state only: no recording content, download URLs, tokens, topics or names. `request_id` and `site_visit_activity_id` are Dataverse identities, not foreign keys; `actor_profile_id` references `user_profiles.id`; `transcription_job_id` references `transcription_jobs.id` (`ON DELETE SET NULL`; jobs are expired, never deleted).

| Column group | Meaning |
|---|---|
| `zoom_meeting_uuid`, `zoom_host_id`, `zoom_meeting_start` | The occurrence the picker listed; host and start come from the approved-host listing row, never from the request body |
| `state`, `lease_token`, `lease_expires_at` | `importing` holds a 10-minute lease (longer than the 300 s route limit); `started` and `failed` clear both lease columns (CHECK) |
| `transcription_job_id` | The job created for the import; its `idempotency_key` is this row's `id` |
| `failure_code` | Sanitized code matching `^[a-z0-9_]{1,80}$`; present exactly when `state = 'failed'` (CHECK) |
| `includes_zoom_transcript` | Whether the Zoom `audio_transcript` VTT was imported with the audio |

A partial unique index allows one `importing` or `started` row per request and meeting; a `failed` row frees the slot, and a retry claims a new row and creates a new job. A `started` row blocks duplicates only while its job is live (any status except `failed` and `expired`, so `ready` and `submission_uncertain` still block); if the job is `failed`, `expired` or missing, the service conditionally marks the row `failed` with `zoom_import_job_ended` and the meeting can be imported again. The final update matches `id`, `lease_token` and `state = 'importing'`; an expired lease is taken over by a conditional update so two concurrent requests cannot both take over.

## Writers and readers

- Writer: `lib/services/meeting-tracker-recordings/import-store.js`, called only from `import-service.js`, reached from `POST /api/meeting-tracker/visits/[requestId]/zoom-imports`.
- Readers: the same service, to show per-meeting import state in the picker (`GET .../zoom-recordings`) and to find the job for an expired lease.
- Retention of these rows follows later Stage 5 work and is open.
