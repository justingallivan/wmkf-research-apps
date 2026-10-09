---
title: "Atlas: Site Visit summary drafts (Postgres)"
domain: postgres
kind: state-page
status: live
summary: "Migration 070 defines meeting_transcript_summary_drafts: one row per Summarize run holding the summarization acknowledgment and, only while ready or publishing, the generated presentation summary a program coordinator reviews before publishing. Production-live since 2026-10-05 (migration 070 applied; PR #440 deployed). Migration 075 (applied to the shared Preview/Production database 2026-10-09; its code is on branch claude/paired-summaries, not merged) admits Staff Discussion Summary (100000010) drafts and moves run reservation into one transaction."
canonical: true
cataloged: 2026-10-05
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
  - lib/db/migrations/070_meeting_transcript_summary_drafts.sql
  - lib/db/migrations/071_summary_draft_slides_identity.sql
  - lib/db/migrations/075_summary_drafts_discussion_kind.sql
  - docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md
  - lib/services/post-presentation-materials/summary-slides-identity.js
  - lib/services/post-presentation-materials/summary-draft-store.js
  - lib/services/post-presentation-materials/transcript-summary-service.js
---

# Atlas: Site Visit summary drafts (Postgres)

## Status

**[PRODUCTION-LIVE 2026-10-05.]** The owner applied migration 070 to the shared
Preview/Production database (1 applied, 68 skipped). PR #440 merged as
`11ff96467` and is served by Production deployment `dpl_7Ci2zRWiMsWH5iZ5zoiBoR9JqnyD`. Stage 2 of the Site Visit summaries plan
(§4.3, §6, §16).

**[PRODUCTION-LIVE 2026-10-05.]** Migration 071 adds the slides-identity
columns below (`docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md`
§3.5). The owner applied it to the shared Preview/Production database (1
applied, 70 skipped). The code that writes and reads the columns shipped in
PR #441 merge `b4fa78819`, deployment `dpl_6kkxdv6oq8JLa4Xyx1T8SS5Szi1W`.

**[MIGRATION 075 APPLIED 2026-10-09 (owner-run: 1 applied, 74 skipped); CODE BUILT ON BRANCH `claude/paired-summaries`, NOT MERGED.]**
Stage 2 of `docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md` (D2, D4, D7). Migration
075 widens the `artifact_type` CHECK to `(100000007, 100000010)`. Running `main` code
writes only 100000007 rows, so the wider CHECK changes nothing until the merge. The
reservation, not-recorded marker and widened run read below exist only on that
branch until it merges. The release order is the plan's "Release sequence".

## Ownership and contract

`meeting_transcript_summary_drafts` holds one row per "Summarize" run for a
request and summary kind (`artifact_type` 100000007 Transcript Summary, the
presentation kind; 100000010 Staff Discussion Summary, the staff-only discussion kind,
after migration 075). `request_id`, `source_revision_id`, `source_artifact_id`, and
`published_artifact_id` are Dataverse identities, not Postgres foreign keys;
`acknowledged_by_profile_id` and `updated_by_profile_id` reference
`user_profiles.id`.

| Column group | Meaning |
|---|---|
| `acknowledgment_version`, `acknowledged_by_profile_id`, `acknowledged_at` | The summarization acknowledgment (plan §6), written when the row is inserted, before the provider call; kept in every state |
| `source_revision_id`, `presentation_end_ms`, `source_artifact_id` | The transcript revision, confirmed boundary, and bound source row the summary was made from (Presentation Transcript for 100000007, Staff Discussion Transcript for 100000010); publish refuses a draft whose pair is no longer current |
| `summary_text`, `text_edited`, `version` | The generated (then staff-edited) text and an optimistic version; text is allowed only in states `ready` and `publishing` (CHECK) and is at most 100,000 characters |
| `prompt_name`, `prompt_version`, `prompt_id`, `ai_run_id`, `failure_code` | Executor provenance; the run row keeps content-free audit only |
| `publish_claim_token`, `publish_claimed_at`, `publish_registration_attempted` | The publishing request's token and claim time (required in state `publishing`), and a durable flag set just before the first registry write; `generating` and `ready` rows carry none of them (CHECK) |
| `published_artifact_id` | The Transcript Summary request-document row, set exactly when state is `published` (CHECK) |
| `slides_recorded`, `slides_artifact_id`, `slides_content_hash` (migration 071) | Which applicant slide PDF the run picked: its request-document row and SHA-256. `slides_recorded` is false for runs before 071 (unknown) and true afterwards; then both identity columns are set together, or both NULL when no slide PDF was on file (CHECK). These survive publish, so staff can be told when the slides changed after a published summary was made |

States: `generating` → `ready` | `failed`; `ready` → `publishing` |
`discarded` | `superseded` (a new Summarize) | `expired`; `publishing` →
`published` | `ready` | `superseded` | `expired`.

**Run reservation (branch, plan D2).** `reserveSummaryDraftRun` replaces the
two-statement `beginSummaryDraft` with one transaction under
`pg_advisory_xact_lock` keyed on request and type. It reads the active row of that
type. With no active row, or an abandoned `generating`/`publishing` row, it
supersedes that row and inserts a new `generating` row. A `ready` row is
superseded (text cleared) only when it has expired or the request's `replaceDraft`
names its id and current version; otherwise the result is the typed conflict
`summary_draft_exists` with that draft's id and version. A live `generating` or
`publishing` row returns `summary_generation_in_progress`. Both conflicts become
409s before any provider call, and any error rolls back, so an edited draft
survives a failed insert.

**Not-recorded marker (branch, plan D4).** When the discussion half after the
confirmed presentation end has no utterances, `recordEmptySummaryRun` inserts one
`failed` row of type 100000010 with `failure_code = 'staff_discussion_not_recorded'`,
the acknowledgment, `source_revision_id` and `presentation_end_ms`, and no provider
call. A `failed` row is outside the active unique index, so it never conflicts with
or retires a draft. `getLatestSummaryRun` also returns `source_revision_id` and
`presentation_end_ms`, so the discussion GET reports `discussionNotRecorded` only
while the newest run is that marker for the current revision and boundary.
Maintenance expiry touches only active states, so the marker survives it.

A publish claims the row with its own token at the expected version before any
SharePoint or Dataverse write. The claim also matches the summary kind
(`artifact_type`), and the presentation publisher refuses any other kind with
`summary_draft_kind_unsupported`, so a draft of another kind can never be
registered as a Transcript Summary (paired summaries plan, release step 0). On the branch the
publisher serves both kinds, taking the kind only from the stored row; a draft is
registered only as its own kind (a mismatched claim is refused with the same
code), and an unknown stored type fails closed with 409 `summary_draft_changed`. Edit, discard, and a new run act only on `ready`
rows, and a claim held by a running publish cannot be claimed, released, or
yielded by another request (Codex reviews 2026-10-05). Just before the first
registry write the publish sets `publish_registration_attempted`; after that
the row can never return to `ready` (its text may already be published), even
across later retries. On failure the publish releases to `ready` when the flag
is unset, otherwise it yields its token and the row stays `publishing` for an
immediate retry (same generation key, same file). A claim older than 180 s is
abandoned and can be taken over (the publish route allows 120 s). A new run
retires a `publishing` row that no request holds (yielded or abandoned);
whatever it registered stays published. A partial unique index allows at most
one `generating`, `ready`, or `publishing` row per request and type, so the two
kinds run independently; a `generating` row older than 360 s is abandoned.

## Retention

Generated text lives here only while a draft is `ready` or `publishing`. Publishing,
discarding, superseding, or expiring clears `summary_text` and keeps the
metadata, so the acknowledgment record survives. Drafts expire 14 days after
creation, for either kind (paired summaries owner decision 7); the daily maintenance cron (`pages/api/cron/maintenance.js`) clears
the text of expired active rows through `expireSummaryDrafts`. The published
presentation summary is a TXT in governed SharePoint (`Site Visit - Transcript Summary`),
registered as a Transcript Summary row whose `wmkf_inputfingerprint` binds it
to the source revision and boundary
([Request Document Atlas](dataverse-wmkf-requestdocument.md)). On the branch, a
published discussion summary is a TXT in `Site Visit - Staff Discussion Summary`,
registered the same way as a staff-only Staff
Discussion Summary (100000010) row; it joins the Stage 5 deletion inventory.

## Related state

Transcript publication receipts and correction drafts live in a separate table
([Meeting Tracker publication Atlas](postgres-meeting-transcript-publications.md)) <!-- drain-table:ignore reason=transcription-atlas-filename-not-retired-table -->;
those correction drafts are label-only (speaker names and the presentation end; table comment in migration 063), never transcript text.

## Readers and writers

Only `lib/services/post-presentation-materials/summary-draft-store.js` reads or
writes the table. Its callers:
- `transcript-summary-service.js`, through the routes
  `/api/meeting-tracker/visits/[requestId]/transcriptions/summary-draft` and
  `.../summary-draft/publish` (`meeting-tracker` app access);
- `summary-slides-identity.js`, which reads the published run's slides
  identity for the summary-draft GET and for the Staff Deliberations feed
  (`lib/services/site-visit/logistics-service.js`, `reviewers` app access);
- the daily maintenance task.
