---
title: "Atlas: Zoom video copies (Postgres)"
domain: postgres
kind: state-page
status: planned
summary: "Migration 076 defines zoom_video_copies, one row per Stage 3b attempt to copy a Zoom meeting video into SharePoint, and adds the origin column to presentation_material_uploads. Built on branch claude/zoom-copy-step0, not merged; migration 076 NOT applied. The table is inert: nothing writes it."
canonical: true
cataloged: 2026-10-08
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-infra-tables.md
  - docs/atlas/postgres-zoom-recording-imports.md
  - docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md
  - lib/db/migrations/076_zoom_video_copies.sql
  - lib/services/post-presentation-materials/upload-intent-store.js
---

# Atlas: Zoom video copies (Postgres)

## Status

**[SOURCE-BUILT on branch `claude/zoom-copy-step0`, not merged; migration 076 NOT applied. Nothing is live.]** This is release step 0 of Stage 3b (`docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md`). Migration 076 holds both the `presentation_material_uploads.origin` column and the `zoom_video_copies` table. No code writes the table or the `zoom_copy` origin; the branch only makes browser MP4 paths ignore any non-`browser` intent. The state machine, store functions, routes and card in the plan are not built.

## Ownership and contract

`zoom_video_copies` is planned to hold one row per attempt to copy a Zoom meeting's video into the request's SharePoint folder, linked one-to-one to a `presentation_material_uploads` intent (`upload_id = id`, CHECK). It stores identifiers, counters and lifecycle state only: no URLs, tokens, topics or email addresses (the approved host is kept as `zoom_host_email_sha256`). `request_id` and `site_visit_activity_id` are Dataverse identities, not foreign keys; `actor_profile_id` references `user_profiles`.

| Column group | Meaning |
|---|---|
| `state`, `lease_token`, `lease_expires_at`, `next_attempt_at` | `queued`, `copying`, `registering`, `copied`, `failed`, `cancelled`; terminal states hold no lease (CHECK) |
| `zoom_*`, `declared_size` | The chosen Zoom file; size is positive and at most 2,000,000,000 bytes |
| `confirmed_winner_document_id`, `confirmed_winner_slot_version` | The Recording winner seen at start, for the replace-a-staff-MP4 check; both set or both null |
| `bytes_confirmed`, `session_create_attempts`, `session_restarts`, `uncertain_checks`, `registration_attempts` | Bounded counters |
| `sharepoint_drive_id`, `sharepoint_item_id`, `request_document_id` | Receipt identities Stage 5 needs; set once the exact item resolves and the Request Document exists |
| `failure_code`, `cancel_requested_at` | Sanitized failure code, present exactly when `state = 'failed'` (CHECK); staff cancel flag |

Partial unique indexes allow one `queued`, `copying` or `registering` copy per request and one `copied` row per request and Zoom file.

## Writers and readers

None yet. The plan assigns writes to a copy store and a cron tick that are not built.
