---
title: "Atlas: Staff discussion sentiments (Postgres)"
domain: postgres
kind: state-page
status: source-built
summary: "staff_discussion_sentiments (migration 082) holds one row per staff discussion sentiment analysis run: a generating row before the provider call, the validated DeliberationSentiment record on ready rows, and Accept/Withdraw columns. Source-built on branch claude/discussion-sentiment only; migration 082 is not applied anywhere, the prompt is not seeded, and the Meeting Tracker routes and page exist in source only."
canonical: true
cataloged: 2026-10-13
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md
  - lib/db/migrations/082_staff_discussion_sentiments.sql
  - lib/services/post-presentation-materials/discussion-sentiment-store.js
  - lib/services/post-presentation-materials/discussion-sentiment-service.js
  - shared/config/prompts/meeting-staff-discussion-sentiment.js
---

# Atlas: Staff discussion sentiments (Postgres)

## Status

**[PLANNED to apply; source-built only (Stages 1 to 5 of `docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md`, branch `claude/discussion-sentiment`, not on `main`).]** Migration 082 has not been applied to any database and the `meeting-transcript.staff-discussion-sentiment` prompt row is not seeded. The routes, page and read service below exist in source only; nothing reads or writes the table until the owner applies the migration, seeds the prompt and the branch ships.

## Ownership and contract

One row per analysis run over a request's Staff Discussion Transcript. The model returns only a turn time and a quote for each evidence item; the service validates the record's shape, rebuilds the speaker turns from the verified source content the TXT was produced from (refusing unless they reproduce the TXT exactly), finds the one turn each quote came from, and derives the speaker from that turn. The record is stored only on `ready` rows.

| Column group | Meaning |
|---|---|
| `id`, `request_id` | Row id and the Dataverse request id (not a foreign key). |
| `source_artifact_id`, `source_content_hash` | The exact discussion transcript analyzed (request-document id; 64 lowercase hex hash). |
| `prompt_name`, `prompt_version`, `model` | What produced it. `prompt_version` is set on completion and is required for `ready`. |
| `status`, `failure_code` | `generating`, `ready`, `failed`. `failure_code` is required exactly when `failed` (format `^[a-z0-9_]{1,80}$`, content-free). |
| `record` | The validated `DeliberationSentiment` v1 JSON, with `speakerLabel` and `speaker` derived by the server. `ready` rows only. |
| `requested_by_profile_id`, `created_at`, `completed_at` | Actor (from authenticated context only) and times. |
| `accepted_*`, `withdrawn_*` | Staff Accept and Withdraw, each an actor profile id plus a time. Withdrawn requires accepted; accepted requires `ready`. |

Indexes: partial unique `idx_staff_discussion_sentiments_generating` (one live `generating` row per request, backstop for the transactional reserve), partial unique `idx_staff_discussion_sentiments_accepted` (one accepted, not withdrawn row per request), and a read index on `(request_id, status, completed_at DESC, id)`. No retention policy and no expiry column (owner decision).

## States and transitions (`discussion-sentiment-store.js`)

| From | To | Function | Trigger |
|---|---|---|---|
| none | `generating` | `reserveRun` | Advisory-locked transaction per request. A live `generating` row returns `sentiment_analysis_in_progress`; one older than 360 s is marked `failed` (`sentiment_run_abandoned`) first. |
| none | `failed` | `recordFailedRun` | Empty staff discussion (`staff_discussion_not_recorded`), no provider call. |
| `generating` | `ready` | `completeRun` | Compare-and-set on `id` and `status = 'generating'`; zero rows means superseded. |
| `generating` | `failed` | `failRun` | Same fence; a late failure after success or abandonment changes nothing. |
| `ready` | accepted | `acceptRun` | Only a `ready`, never-accepted row whose source artifact, content hash and prompt version equal the caller's current values. Withdraws the request's previous accepted row in the same transaction. |
| accepted | withdrawn | `withdrawRun` | No fallback to an older accepted row; no re-accept of a withdrawn row. |

Currentness is computed in code (`isRunCurrent`): the source artifact id and content hash equal the request's currently bound discussion transcript and `prompt_version` equals the currently published prompt's `wmkf_promptversion` (read through `prompt-store.fetchCurrentPrompt`, no execution).

## Writers and readers

| Surface | File | Access |
|---|---|---|
| Store | `lib/services/post-presentation-materials/discussion-sentiment-store.js` | All SQL. |
| Service | `lib/services/post-presentation-materials/discussion-sentiment-service.js` | Analyze, accept, withdraw, and `getDiscussionSentimentStatus` (the page's per-request read; "still analyzing" uses the database clock via `live_generating`). |
| Routes | `pages/api/meeting-tracker/visits/[requestId]/discussion-sentiment.js` (GET read, POST analyze), `.../discussion-sentiment/accept.js`, `.../discussion-sentiment/withdraw.js` | `requireAppAccess('meeting-tracker')`; actor from the session only. Staff-only: no Board or briefing token route imports them (`tests/unit/discussion-sentiment-exposure.test.js`). |
| Page | `pages/meeting-tracker/discussion-sentiment.js` (`DiscussionSentimentView`) | Meeting Tracker staff. Picker uses the existing schedule dashboard route. |
| Consumer read service | `lib/services/post-presentation-materials/discussion-sentiment-reader.js` (`getDeliberationSentiments`) | Active profile with the Meeting Tracker grant or superuser, checked live. Returns a sentiment only for the accepted, not withdrawn, current row. No consumer wired. |

## Not covered

Proposal Ranking wiring (a separate plan) and calibration. The SQL is exercised against a loopback Postgres by `tests/integration/discussion-sentiments.pg.test.js` (opt-in via `DISCUSSION_SENTIMENT_PG_TEST_URL`; skipped otherwise) and against an in-memory stand-in in the unit tests; it has not run against any shared environment.
