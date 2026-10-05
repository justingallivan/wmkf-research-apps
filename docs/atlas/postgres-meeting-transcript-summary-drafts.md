---
title: "Atlas: Site Visit summary drafts (Postgres)"
domain: postgres
kind: state-page
status: source-built
summary: "Migration 070 defines meeting_transcript_summary_drafts: one row per Summarize run holding the summarization acknowledgment and, only while ready, the generated presentation summary a program coordinator reviews before publishing. Source-built on feature/presentation-summary; not applied or deployed."
canonical: true
cataloged: 2026-10-05
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
  - lib/db/migrations/070_meeting_transcript_summary_drafts.sql
  - lib/services/post-presentation-materials/summary-draft-store.js
  - lib/services/post-presentation-materials/transcript-summary-service.js
---

# Atlas: Site Visit summary drafts (Postgres)

## Status

**[SOURCE-BUILT 2026-10-05, branch `feature/presentation-summary`.]** Migration
070 is written and listed in the manifest; it is not applied in any shared
database and the code is not deployed. Stage 2 of the Site Visit summaries plan
(§4.3, §6, §16).

## Ownership and contract

`meeting_transcript_summary_drafts` holds one row per "Summarize" run for a
request and summary type (`artifact_type` 100000007 Transcript Summary; Stage 3
adds 100000010). `request_id`, `source_revision_id`, `source_artifact_id`, and
`published_artifact_id` are Dataverse identities, not Postgres foreign keys;
`acknowledged_by_profile_id` and `updated_by_profile_id` reference
`user_profiles.id`.

| Column group | Meaning |
|---|---|
| `acknowledgment_version`, `acknowledged_by_profile_id`, `acknowledged_at` | The summarization acknowledgment (plan §6), written when the row is inserted, before the provider call; kept in every state |
| `source_revision_id`, `presentation_end_ms`, `source_artifact_id` | The transcript revision, confirmed boundary, and bound Presentation Transcript row the summary was made from; publish refuses a draft whose pair is no longer current |
| `summary_text`, `text_edited`, `version` | The generated (then staff-edited) text and an optimistic version; text is allowed only in state `ready` (CHECK) and is at most 100,000 characters |
| `prompt_name`, `prompt_version`, `prompt_id`, `ai_run_id`, `failure_code` | Executor provenance; the run row keeps content-free audit only |
| `published_artifact_id` | The Transcript Summary request-document row, set exactly when state is `published` (CHECK) |

States: `generating` → `ready` | `failed`; `ready` → `published` | `discarded`
| `superseded` (a new Summarize) | `expired`. A partial unique index allows at
most one `generating` or `ready` row per request and type; a `generating` row
older than 360 s is treated as abandoned and superseded by the next run.

## Retention

Generated text lives here only while a draft is `ready`. Publishing,
discarding, superseding, or expiring clears `summary_text` and keeps the
metadata, so the acknowledgment record survives. Drafts expire 14 days after
creation; the daily maintenance cron (`pages/api/cron/maintenance.js`) clears
the text of expired active rows through `expireSummaryDrafts`. The published
text is a TXT in governed SharePoint (`Site Visit - Transcript Summary`),
registered as a Transcript Summary row whose `wmkf_inputfingerprint` binds it
to the source revision and boundary
([Request Document Atlas](dataverse-wmkf-requestdocument.md)).

## Related state

Transcript publication receipts and correction drafts live in a separate table
([Meeting Tracker publication Atlas](postgres-meeting-transcript-publications.md)) <!-- drain-table:ignore reason=transcription-atlas-filename-not-retired-table -->;
those correction drafts are label-only (speaker names and the presentation end; table comment in migration 063), never transcript text.

## Readers and writers

Only `lib/services/post-presentation-materials/summary-draft-store.js` reads or
writes the table, called from `transcript-summary-service.js` (routes
`/api/meeting-tracker/visits/[requestId]/transcriptions/summary-draft` and
`.../summary-draft/publish`, `meeting-tracker` app access) and from the daily
maintenance task.
