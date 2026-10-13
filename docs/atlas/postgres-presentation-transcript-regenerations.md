---
title: "Atlas: Presentation transcript regenerations (Postgres)"
domain: postgres
kind: state-page
status: source-built
summary: "presentation_transcript_regenerations (migration 081) is the queue behind automatic presentation and staff discussion transcripts after a meeting-transcript correction publish. One pending and one running row per request at most, latest publish wins, drained once a minute by a cron as the staff member who published. Shipped 2026-10-12 (merge fe5b3734a); migration 081 applied to Production by the owner before merge."
canonical: true
cataloged: 2026-10-12
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-presentation-video-splits.md
  - docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md
  - lib/db/migrations/081_presentation_transcript_regenerations.sql
  - lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-store.js
  - lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-worker.js
  - lib/services/meeting-tracker-transcription/service.js
  - pages/api/cron/drain-presentation-transcript-regenerations.js
---

# Atlas: Presentation transcript regenerations (Postgres)

## Status

**[Site Visit redesign slice C1, shipped 2026-10-12 (merge `fe5b3734a`). Migration 081 was applied to Production by the owner before merge (`applied_by` `owner-c1-2026-10-12`).]** Before the table exists the enqueue fails and is swallowed, the cron idles (`schema_not_ready`), and the card read treats the missing table as "not updating", so a deploy that lands first is harmless.

## Ownership and contract

After a meeting-transcript **correction** publish (`publishMeetingCorrection`) the presentation and staff discussion transcripts are generated automatically, where staff used to click Regenerate. A first publish never carries a confirmed presentation end (`presentationEnd: null`), so only correction publishes enqueue. Transcripts only: summaries stay a manual "Summarize again", and no AI call is made. The table holds identifiers, a fingerprint, state and counters. No names, attendance, emails, URLs or transcript text.

| Column group | Meaning |
|---|---|
| `id`, `request_id` | Row id and the Dataverse request id (not a foreign key). |
| `transcript_artifact_id`, `transcript_fingerprint` | The published transcript this row was queued for, exactly as the overview GET presents them (`currentArtifact.id` and `fingerprint`). They are the generator's `expectedCurrentArtifactId` and `expectedCurrentFingerprint`. The fingerprint is CHECKed as 64 lowercase hex. |
| `actor_profile_id`, `acting_user_system_id` | The publishing staff member: `user_profiles.id` and the Dataverse user GUID. Generation runs as them with no session. |
| `state`, `attempts`, `next_attempt_at` | `pending`, `running`, `done`, `failed`, `superseded`. `attempts` (0 to 3) is counted when a row is claimed. `next_attempt_at` is the backoff. |
| `lease_token`, `lease_expires_at` | Set only while `running` (CHECKs `lease_shape`, `running_leased`, `idle_unleased`). |
| `failure_code` | Sanitized code, format CHECK `^[a-z0-9_]{1,80}$`. Required when `failed`; allowed only on `failed` or `superseded`. |
| `created_at`, `updated_at`, `completed_at` | Lifecycle times. |

Indexes: partial unique `idx_presentation_transcript_regenerations_pending` (`request_id WHERE state = 'pending'`) and `..._running` (`request_id WHERE state = 'running'`), plus `..._work` on `(state, next_attempt_at, lease_expires_at)` for the claim.

## Latest publish wins

`enqueuePresentationTranscriptRegeneration` upserts the request's single `pending` row (`ON CONFLICT (request_id) WHERE state = 'pending' DO UPDATE`) with the new artifact id, fingerprint and actor and `attempts = 0`. A `running` row for an older artifact is left alone: its generator call fails 409 `meeting_transcript_current_changed` (the generator re-checks the expectation under its slot lease) and the worker marks it `superseded`.

## Partial-success rule

The publish (SharePoint + Dataverse) and the enqueue (Postgres) are not one transaction. The enqueue runs only after the publication receipt is durably `published`. If the enqueue fails it is logged by code only, the error is swallowed, the publish still returns success (`regenerationQueued: false`), and the card shows today's "Out of date" with Regenerate. The enqueue also does not run under a supervised test (the generator refuses it).

## States and transitions

| From | To | Function (`presentation-transcript-regeneration-store.js`) | Trigger |
|---|---|---|---|
| none or `pending` | `pending` | `enqueuePresentationTranscriptRegeneration` | Correction publish succeeded. Replaces a waiting row (latest wins). |
| `pending` | `running` | `claimPresentationTranscriptRegeneration` | Cron claim: due (`next_attempt_at`), `FOR UPDATE SKIP LOCKED`, skipped while the request has any `running` row. Takes a lease, counts the attempt. |
| `running` | `done` | `markPresentationTranscriptRegenerationDone` | Generator returned (including "already bound"). |
| `running` | `superseded` | `supersedePresentationTranscriptRegeneration` | 409 `meeting_transcript_current_changed`; also a transient retry that finds a newer pending row (`presentation_transcript_regeneration_replaced`). |
| `running` | `failed` | `failPresentationTranscriptRegeneration` | Supervised-test refusal or any other non-transient 4xx. |
| `running` | `pending` | `retryPresentationTranscriptRegeneration` | Transient fault (5xx, timeout, network error, 408, 429, no status): backoff 1 minute after the first attempt, 5 after the second. |
| `running` | `failed` | `retryPresentationTranscriptRegeneration` | Transient fault on the third claimed attempt: fails with the last code. |
| `pending` (older) | `superseded` | `moveRunningToPending` (inside retry and recovery) | When a running row's return to `pending` hits the pending unique index and the existing pending row has a LOWER `transcript_slot_version` (a delayed enqueue for an older publish), that pending row is superseded (`presentation_transcript_regeneration_replaced`) and the running row's move is retried once. If the pending row is newer or equal, or the retry conflicts again, the running row is superseded instead. |
| `running` | `pending` / `failed` / `superseded` | `recoverExpiredPresentationTranscriptRegenerations` | Lease expired (worker died). Back to `pending` under the cap, `failed` (`presentation_transcript_regeneration_lease_expired`) at the cap, `superseded` if a newer pending row exists. |

Every worker transition is fenced by `lease_token = $x AND lease_expires_at > NOW()` and its own from-state. After `failed` the card falls back to "Out of date" with Regenerate.

## Writers and readers

| Surface | File | Access |
|---|---|---|
| Enqueue | `lib/services/meeting-tracker-transcription/service.js` (`publishMeetingCorrection`, `enqueueAutomaticTranscripts`) | Writer: one upsert after `published`; never throws. |
| Store | `lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-store.js` | All SQL. |
| Worker | `lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-worker.js` | Claims and settles rows; calls `generatePresentationTranscript` (unchanged) as the stored actor with the stored expectations. |
| Cron | `pages/api/cron/drain-presentation-transcript-regenerations.js` | Every minute, `maxDuration` 300, 270 s work deadline, `withDalContext('cron-drain-presentation-transcript-regenerations')` (matrix row). |
| Overview GET (reader) | `service.js` (`getMeetingTranscriptionOverview`, `readUpdatingArtifactIds`) | `listActivePresentationTranscriptRegenerations`: pending or running artifact ids. `updating: true` is added to `currentArtifact.presentationTranscript` and `staffDiscussionTranscript` only when one equals the CURRENT artifact id; absent otherwise. A failed read means not updating. |
| Card (reader) | `shared/components/meeting-tracker/RecordingAndTranscriptCard.js` | When the state is `stale` or `missing` and `updating`, shows a gray "Updating…" chip and hides Regenerate; re-reads the status every 15 s for at most about 22 minutes, then gives up on "Updating…". |

## Not covered

Summaries, the correction-draft server re-check, and reconciled (uncertain) correction publishes: a publish completed later by reconciliation does not enqueue, so its card stays "Out of date" with Regenerate. There is no operator UI for the queue; `failure_code` on `failed` rows is the diagnostic.
