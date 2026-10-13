---
title: Staff discussion sentiment meter
domain: transcription
kind: plan
status: planned
summary: "Planned, not built. Reads each proposal's Staff Discussion Transcript, records enthusiasm, reception, disagreement and uncertainty with named, quoted evidence, and compares chosen proposals."
owner: product-engineering
related:
  - docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md
  - docs/plans/PROPOSAL_RANKING_API_CONTRACT.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
---

# Staff discussion sentiment meter

Date: 2026-10-13 (Session 601). Status: **PLANNED. Nothing in this document is built.**
Owner: Justin.

## 1. Purpose

Staff discuss each proposal after the applicants leave the site visit (research presentation).
The meter reads those discussions and shows, across a set of proposals staff choose:

1. **Enthusiasm vs. poor reception:** which proposals staff were excited about and which they
   received poorly.
2. **Disagreement:** where staff disagreed with each other.
3. **Uncertainty:** where staff seemed unsure.

These three signals are the whole scope. Trends across cycles, dashboards about individual
staff members, and writing ranks automatically into Proposal Ranking are out of scope
(`feedback-anchor-multisession-features-to-the-original-ask`).

## 2. Owner decisions already made (2026-10-13)

| Decision | Choice |
|---|---|
| Source | The **Staff Discussion Transcript**, with quoted evidence. Not the published summary: the summary prompt is neutral by design ("Do not add your own evaluation of the proposal") and drops tone [VERIFIED via `shared/config/prompts/meeting-staff-discussion-summary.js`]. |
| Attribution | **Named speakers**, using the transcript's names under the same rules as the discussion summary. |
| Comparison set | **Staff choose the proposals**, and any proposal can be run again. |
| Location | **A page of its own**, with the data available to Proposal Ranking and other consumers through a read contract. |

## 3. Current state the plan builds on

| Fact | Evidence |
|---|---|
| Each Site Visit can have a Staff Discussion Transcript (request-document type `100000013`): a TXT in SharePoint holding the part of the recording after the confirmed presentation end. | [VERIFIED via `shared/config/requestDocument.js:24`; `lib/services/meeting-tracker-transcription/presentation-boundary.js:99-111`] |
| The discussion summary requires a bound discussion transcript for the confirmed boundary (otherwise 409 `staff_discussion_transcript_not_ready`). It reads the TXT against its pinned hash and eTag, treats an empty discussion as `staff_discussion_not_recorded` (422), and refuses text over 400,000 characters. | [VERIFIED via `lib/services/post-presentation-materials/transcript-summary-service.js:276-297`] |
| Transcript prompts run through the Executor with `requireNoPersistence: true` and `auditRetention: 'content-free'`, so the run row keeps no transcript or model text. | [VERIFIED via `transcript-summary-service.js:350-351`; `docs/EXECUTOR_CONTRACT.md:78,85`] |
| The Executor supports `parseMode: "json"` with a `jsonSchema`, optionally `generationMode: "native-json-schema"` on models that support structured output. Target kinds are `akoya_request` or `none`. | [VERIFIED via `lib/services/execute-prompt.js:187-199,830,993`; `docs/EXECUTOR_CONTRACT.md:264,391-394,414`] |
| Proposal Ranking has a `ProposalCard` with an optional `score` (external peer-review summary). | [VERIFIED via `docs/plans/PROPOSAL_RANKING_API_CONTRACT.md:95-105`] |
| The latest migration is 081. | [VERIFIED via `lib/db/migrations-manifest.json`, 2026-10-13; re-check before claiming 082 — `project-migration-numbers-claimed-off-main`] |
| No sentiment feature exists today. | [VERIFIED via case-insensitive grep for "sentiment" over `lib`, `shared`, `pages`, `scripts`, `docs`: no matches, 2026-10-13] |

## 4. Design

### 4.1 Input

The input is the **published Staff Discussion Transcript TXT** for the request's current bound
site visit, using the same binding, integrity check (hash plus eTag), empty-discussion rule and
400,000-character cap as the discussion summary. Reuse those checks; do not copy them. Preferred
approach: extract the "load verified discussion transcript" step from `transcript-summary-service.js`
into a shared helper both callers use. That is a shared-helper extraction, so run
`/contract-reconcile` on it.

**Preconditions the analysis must also enforce,** taken from the summary service's `assertEnabled`
[VERIFIED via `transcript-summary-service.js:173-184`]: meeting transcription enabled for the
request, transcript-bundle and presentation-materials schema ready, the request allowed by
`isPostPresentationMaterialsRequestAllowed`, a mapped Dataverse staff identity, and refusal under
a supervised test. Binding uses `bindCurrent(...).discussion` with `reason === 'bound'`
[VERIFIED via `transcript-summary-service.js:186-197,276`].

**What the extracted loader must not do (preserved differences):** it returns only
`{ discussionRow, transcriptText, boundary }` and makes no writes. The summary path records an
empty discussion as a failed marker row in `meeting_transcript_summary_drafts` via
`drafts.recordEmptySummaryRun` [VERIFIED via `transcript-summary-service.js:283-292`]. That write
stays in the summary caller. The sentiment caller records its own `failed` row in its own table
and never writes into the summary drafts table.

**AI-consent acknowledgment.** Summaries require a versioned acknowledgment that the transcript
may be sent to Anthropic, recorded on the row before the provider call
[VERIFIED via `shared/config/transcriptSummary.js:17-20`; `transcript-summary-service.js:288`].
The analysis gets its own acknowledgment (new version string and text naming the sentiment
analysis), stored on the row before the call. The existing summary acknowledgment does not
cover this new use.

A request without a bound discussion transcript shows as "No staff discussion transcript". It
cannot be run.

### 4.2 One analysis per proposal; comparison done in code

Each proposal gets one Executor run that returns a **structured record**. Comparing and sorting
across proposals happens in code from those records. No model call ever sees several transcripts
at once. This keeps each run within budget, lets one proposal be re-run without touching the
others, and keeps the comparison deterministic.

Record schema (v1). This record is also the contract for consumers (§4.6):

```ts
type DeliberationSentiment = {
  schemaVersion: 1;
  enthusiasm: 'high' | 'moderate' | 'low' | 'unclear';      // energy and excitement in the room
  reception: 'positive' | 'mixed' | 'negative' | 'unclear'; // overall verdict expressed
  headline: string;                                         // one sentence, no evaluation beyond what was said
  supportPoints: Evidence[];                                // what staff liked
  concernPoints: Evidence[];                                // what staff criticized
  disagreements: Array<{ topic: string; sides: Evidence[] }>; // at least two sides, each quoted
  uncertainties: Array<{ topic: string; evidence: Evidence[] }>;
};
type Evidence = {
  speaker: string | null;  // null when unnamed under the attribution rules
  quote: string;           // verbatim substring of the transcript, short
  time: string;            // the transcript's [time] stamp for the line
};
```

The labels are **categories, not a 1–10 number**. Numeric scores drift from run to run, which
would undermine re-running. The comparison page sorts by `reception`, then `enthusiasm`, then
the number of disagreements and uncertainties.

### 4.3 Prompt

- New seed source `shared/config/prompts/meeting-staff-discussion-sentiment.js`, a seed script,
  and a `wmkf_ai_prompts` row (the owner approves the wording before seeding, as with the discussion
  summary). The rubric (what counts as high enthusiasm, a disagreement, uncertainty) lives in the
  prompt text, so it can be changed in Dataverse/`/admin` without a code change
  (`feedback-mutable-parameters-not-in-code`).
- Attribution rules are copied verbatim from the discussion summary prompt: use the name exactly
  as the transcript gives it. Leave the speaker unnamed when they are "Unidentified speaker",
  "Speaker N", unclear, or a name that looks wrong. Never infer a name.
- Variable `discussion_transcript`: `untrusted: true`, `dataClass: 'meeting_transcript'`,
  `maxChars: 400000`. Output: `parseMode: 'json'`, target `kind: 'none'`,
  `rawOutputRetention: 'none'`. Use `native-json-schema` if the resolved model supports it.
- Caller passes `requireNoPersistence: true` and `auditRetention: 'content-free'`. The service,
  not the Executor, stores the validated record (§4.4).
- Register it as an A7 surface in `scripts/check-prompt-injection-tagging.js`. Add rows to
  `shared/config/executorBudgets.js`. Add a prompt-config test that pins the variable and output
  flags; mutation check: removing `auditRetention` must fail it.
- [ASSUMED] The prompt appears on the `/admin` Prompt Templates page with no extra work, like the
  other seeded prompts (Plan A). Verify during build.

### 4.4 Quote check and storage

**Quote check (server-side, before saving):** every `quote` must be a verbatim substring of the
transcript text sent to the model (whitespace normalized), found within one speaker-turn paragraph (`[time] Speaker: text`, one per turn) whose `[time]`
stamp equals `time` and whose speaker equals `speaker`
[VERIFIED via `lib/services/transcription-pilot/transcript-format.js:229-237`]. A named `speaker` must be a name that appears
as a speaker in the transcript, and never "Unidentified speaker" or "Speaker N". A record that fails either check is rejected as
`sentiment_evidence_unverified` and is not saved; staff see "Couldn't verify the analysis. Try
again." This stops invented quotes and invented names.

**Storage:** one new Postgres table, `staff_discussion_sentiments` (migration 082, if still free).

| Column | Purpose |
|---|---|
| `id` uuid | Row id |
| `request_id` uuid | Dataverse request |
| `source_artifact_id` uuid, `source_content_hash` text | The exact discussion transcript analyzed |
| `prompt_name`, `prompt_version`, `model` | What produced it |
| `status` `generating` \| `ready` \| `failed` | Run state; a `generating` row is inserted before the provider call, as the summary drafts do |
| `failure_code` text | Content-free failure code |
| `record` jsonb | The validated `DeliberationSentiment` (ready only) |
| `requested_by_profile_id`, `created_at`, `completed_at` | Actor from authenticated context only |

A record is **current** when its `source_artifact_id` and `source_content_hash` match the request's
currently bound discussion transcript. It is **out of date** after a transcript republish or a
moved boundary. Re-running adds a new row; reads use the latest `ready` row for the current source.
Concurrent runs: reserve the run in one transaction, following the summary drafts' reserve
pattern. A live `generating` row for the same request returns `sentiment_analysis_in_progress`.
A `generating` row older than an abandonment window (the summary store uses 360 s against a
300 s route limit) no longer blocks and is marked `failed`
[VERIFIED via `lib/services/post-presentation-materials/summary-draft-store.js:12-13,18-43`].
A partial unique index alone cannot express that time rule, so it does not replace the
transaction.

Additional columns: `acknowledgment_version`, `acknowledged_at` (§4.1), and `expires_at`.

**Retention mechanism:** an `expireStaffDiscussionSentiments()` maintenance function clears
`record` and marks expired rows, in the same way as `expireSummaryDrafts`
[VERIFIED via `summary-draft-store.js:286-293`]. It is wired into `pages/api/cron/maintenance.js`, which already runs
that function [VERIFIED via `pages/api/cron/maintenance.js:25,234`]. The retention period is the owner decision in §5.1. A removed or replaced
discussion transcript must also make its sentiment rows unreadable, not just out of date.

Required documentation and gate surfaces: `scripts/setup-database.js` shape, manifest entry,
`docs/atlas/postgres-staff-discussion-sentiments.md` plus its `docs/APPLICATION_STATE_ATLAS.md`
row, `docs/SERVICE_AND_UTILITY_CATALOG.md` entry, any route counts in `CANONICAL_COUNTS`
(`check:fact-consistency`), and status/label maps covered by `check:status-enum-parity`.

### 4.5 Page and routes

- **Location:** a new **"Discussion Sentiment"** page. Which app owns it is an owner decision
  (§5.4); the recommendation is a new view inside Meeting Tracker, so it reuses that app's access
  grant and the staff-only posture.
- **Selection:** a picker over requests that have a bound discussion transcript (any cycle,
  filterable by cycle and meeting date). Staff tick proposals; each row shows "Not analyzed",
  "Current", "Out of date" or "Analyzing…" and has **Analyze** / **Re-analyze**. Desktop-first.
  No internal IDs shown (`feedback-staff-ui-never-shows-internal-ids`). Vocabulary follows what
  the Staff Deliberations surface already says (glossary unsettled).
- **Comparison:** a table, one row per chosen proposal, with columns for reception, enthusiasm,
  headline, and counts of disagreements and uncertainties. Expanding a row shows the quoted
  evidence with speaker and time.
- **Routes (new):** `GET` list/read and `POST` analyze, under the owning app's namespace. Each one
  uses `requireAppAccess`, `withDalContext`, `loadModelOverrides()` before model resolution,
  route → service only (no adapter imports in `pages/api`), and GUID validation of `requestId`.
  Add rows to `docs/API_ROUTE_SECURITY_MATRIX.md` and `ROUTE_NAMESPACE_LIFECYCLE`.
- **Staff-only:** never served on the Board presentation page or the briefing link, the same
  rule as the Staff Discussion Summary.

### 4.6 Consumer contract (Proposal Ranking and others)

A read service, `getDeliberationSentiments(requestIds)`, returns, per request, the current
`DeliberationSentiment` (or `null`) plus `{ status: 'current' | 'out_of_date' | 'none',
analyzedAt }`. Other apps call this service. Proposal Ranking would add an optional
`deliberationSentiment` field next to `ProposalCard.score`.

**Wiring Proposal Ranking is a separate follow-on change.** This plan does not modify Proposal
Ranking. That needs its own decision about whether a frozen round snapshot captures the
sentiment and how it interacts with ranking privacy (private lists before publication). It
also needs an access decision: a consumer app's own grant (for example `proposal-ranking`)
must not become a way around the owning app's staff-only access. The read service therefore
takes the caller's access context and fails closed when that context does not satisfy the
§5.1 readership rule.

## 5. Owner decisions needed

1. **Durable named opinions.** This creates a lasting, searchable record of which named colleague
   was enthusiastic or doubtful about which proposal. Today nothing stores that: discussion
   summaries are reviewed and neutral, and the run rows are content-free. Decide:
   - who can read it (recommend: the same staff who can see the Staff Discussion Summary);
   - how long it is kept (recommend: delete with the discussion transcript and summary under the
     Stage 5 deletion inventory, and never longer than the cycle);
   - whether staff can see their own quoted lines before another app shows them.
2. **Provider data handling.** Session 599 recorded provider confirmation as UNKNOWN and said "no
   confidential-transcription expansion is approved". This is a second model pass over a
   transcript already sent to the same provider through the same Executor path. It is not new
   transcription, but it is a new use of the transcript. Please confirm it is acceptable before
   build. Evidence: `docs/PROVIDER_DATA_HANDLING_REVIEW_2026-10-12.md`.
3. **Calibration data.** The rubric cannot be tuned without real discussions. How many real
   Staff Discussion Transcripts exist is [ASSUMED unknown]: checking needs an owner-authorized
   production read (`feedback-never-self-authorize-prod-dataverse-reads`). TEST request 1003222
   has one, but it is feature-test data. Options: the owner picks 3–5 real discussions for a
   read-only calibration run, or calibration waits for the next cycle.
4. **Owning app.** Meeting Tracker view (recommended) or a new app registry entry with its own
   grant.
5. **Who may run an analysis.** Recommend anyone with access to the owning app; each run is
   logged with the actor.
6. **Human review before display.** Discussion summaries are reviewed by staff before they are
   published [VERIFIED via `transcript-summary-service.js:1-17`]. This plan shows the analysis
   as soon as it passes the quote check, with no review. Options: show immediately (labelled
   "AI analysis; check the quotes"), or require a staff "Accept" before other apps can read it.
   Recommend requiring "Accept" before the read service returns a record to any consumer.

## 6. Build stages (after the owner decides §5)

1. Shared verified-discussion-transcript loader extracted from the summary service; existing
   summary tests stay green. `/contract-reconcile`.
2. Prompt seed source, config test, A7 registration, budgets; owner approves wording, then seed.
3. Migration 082, store, analyze service with the quote check; unit tests for the quote and
   speaker checks, for out-of-date detection, and for the single in-flight run.
4. Routes and security matrix rows; comparison page.
5. Calibration on the owner-chosen discussions; rubric changes are prompt edits only.
6. Read service and contract doc for consumers. Proposal Ranking wiring is a separate plan.

Branch work per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` (new table, route and
prompt make it Tier 1 or above). Codex adversarial review before merging.

## 7. Tests that must have teeth

- A quote that is not a substring of the transcript, and a speaker name not in the transcript,
  must each reject the record. Mutation: remove the check and both tests must fail.
- A record for an older `source_content_hash` must read as out of date.
- Prompt config: `untrusted: true`, `target.kind: 'none'`, `rawOutputRetention: 'none'`; the
  caller passes both retention flags.
- Routes refuse requests without app access and never return records to Board or briefing tokens.
