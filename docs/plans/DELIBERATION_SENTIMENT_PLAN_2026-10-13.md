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

Date: 2026-10-13 (Session 601). Status: **PLANNED; owner decisions recorded (§2). Nothing in this document is built.**
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
| Owning app | **A view inside Meeting Tracker.** Anyone with Meeting Tracker access can read, run and accept; each run and accept is logged against the actor. |
| Names going forward | Some existing discussions are unattributed; staff will use names from now on. Older analyses will mostly have unnamed evidence (`speaker: null`), which is expected. |
| Retention | **No specific retention policy.** Rows are kept; a newer transcript makes older rows out of date. |
| AI consent step | **None.** The analysis does not add a consent acknowledgment. |
| Provider data handling | **Owner accepted** the second model pass over the transcript; the Session 599 provider-confirmation item does not block this feature. |
| Calibration | **Owner picks 3–5 real discussions** for a read-only calibration run (owner authorizes that production read at the time). |
| Picker scope | **Transcript-only (2026-10-13).** The picker lists only proposals whose Staff Discussion Transcript is currently bound, not every site visit. |
| Comparison order | **Most favourable first (2026-10-13), as built:** reception, then enthusiasm, then fewer disagreements, then fewer uncertainties; rows without a current result last. |
| Prompt wording | **Approved as written (2026-10-13).** The seed script may run when the owner seeds each environment (the release-order note in §9 still applies). |
| Review before sharing | **Staff "Accept" required** before the read service returns a record to any other app. The Meeting Tracker page shows unaccepted results labelled "AI analysis; check the quotes". |

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

**What the extracted loader must not do (preserved differences):** it returns
`{ discussionRow, boundary, utteranceCount, transcriptText, speakerNames, discussionContent }`
and makes no writes. `utteranceCount: 0` (with `transcriptText: null`, no TXT read) is how an
empty discussion is reported. `discussionContent` and `speakerNames` are the verified,
attribution-resolved content and names the TXT was produced from, so the sentiment service
rebuilds turns with the formatter's own grouping instead of parsing the TXT (§4.4). The summary path records an
empty discussion as a failed marker row in `meeting_transcript_summary_drafts` via
`drafts.recordEmptySummaryRun` [VERIFIED via `transcript-summary-service.js:283-292`]. That write
stays in the summary caller. The sentiment caller records its own `failed` row in its own table
and never writes into the summary drafts table.

**No AI-consent acknowledgment** (owner decision, §2). The summary flow's acknowledgment
[VERIFIED via `shared/config/transcriptSummary.js:17-20`] is not reused or extended.

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
  time: string;            // the turn's [time] stamp — model-supplied
  quote: string;           // verbatim substring of that turn's text — model-supplied
  speakerLabel: string | null; // server-derived: the turn's label as shown ("Dr. Lee", "Speaker 3", "Unidentified speaker")
  speaker: string | null;      // server-derived: the label only when it is a real name, else null
};
```

The model supplies only `time` and `quote`. The server finds the matching turn and fills in
`speakerLabel` and `speaker` (§4.4), so the model cannot attach a quote to the wrong person.

The labels are **categories, not a 1–10 number**. Numeric scores drift from run to run, which
would undermine re-running. The comparison page sorts by `reception`, then `enthusiasm`, then
the number of disagreements and uncertainties.

### 4.3 Prompt

- New seed source `shared/config/prompts/meeting-staff-discussion-sentiment.js`, a seed script,
  and a `wmkf_ai_prompts` row (the owner approved the wording on 2026-10-13, before seeding, as with the discussion
  summary). The rubric (what counts as high enthusiasm, a disagreement, uncertainty) lives in the
  prompt text, so it can be changed in Dataverse/`/admin` without a code change
  (`feedback-mutable-parameters-not-in-code`).
- Attribution is done by the server, not the model (§4.4). The prompt asks for each evidence
  item's turn `[time]` and a short verbatim quote, and tells the model not to name speakers in
  `topic` or `headline` text. Speaker names reach the record only through the server's turn match.
- Variable `discussion_transcript`: `untrusted: true`, `dataClass: 'meeting_transcript'`,
  `maxChars: 400000`. Output: `parseMode: 'json'`, target `kind: 'none'`,
  `rawOutputRetention: 'none'`. Use `native-json-schema` if the resolved model supports it.
- Caller passes `requireNoPersistence: true` and `auditRetention: 'content-free'`. The service,
  not the Executor, stores the validated record (§4.4).
- Register it as an A7 surface in `scripts/check-prompt-injection-tagging.js`. Add rows to
  `shared/config/executorBudgets.js`. Add a prompt-config test that pins the variable and output
  flags; mutation check: removing `auditRetention` must fail it.
- The prompt is not hard-coded: the live text lives in Dataverse and is editable in Admin → Prompt
  Templates, which lists every `wmkf_ai_prompt` row, so a seeded row appears with no extra work
  [VERIFIED via `pages/api/admin/prompts/index.js:4`]. The seed file is only the starting text.

### 4.4 Quote check and storage

**Schema validation (server-side, before the quote check).** The Executor checks only that
top-level required keys exist; full validation happens only when a `validationSchema` is
declared [VERIFIED via `lib/services/execute-prompt.js:935-950`]. The service therefore runs its
own validator on every result, whether or not native structured output was used: exact
`schemaVersion`, category enums, bounded string lengths and array sizes, non-empty quotes,
each disagreement having at least two sides, and at least one evidence item behind any
`high`/`low` enthusiasm or `positive`/`negative` reception. A failure is
`sentiment_output_invalid` and nothing is saved.

**Quote check (server-side, before saving).** The server rebuilds the speaker turns from the
verified source content the transcript TXT was produced from (formatter turn grouping), and
requires the formatted result to equal the verified TXT sent to the model exactly. That TXT has one paragraph per turn,
`[time] Label: text`, with labels from `speakerNameFor` (a mapped name, or `Speaker <id>`) and
`Unidentified speaker` for excluded attribution
[VERIFIED via `lib/services/transcription-pilot/transcript-format.js:91-94,205-213,229-237`].
For each evidence item there must be exactly one turn whose `[time]` equals `time` and whose
text contains `quote` (both sides control-character-replaced and whitespace-collapsed by the
service's `normalizeSpace`; that goes beyond the TXT's own `safePlainText`, which replaces
control characters and line breaks but keeps doubled spaces, so a quote copied from the TXT
matches whether or not the model preserved them). The server then sets `speakerLabel` to that turn's label
and `speaker` to the label only when it is not `Speaker <id>`, not `Unidentified speaker`, and
not absent. Older unattributed discussions therefore pass with `speaker: null`. A disagreement is also rejected
(`sentiment_evidence_unverified`) when two sides resolve to the same turn and the same normalized quote, or
when every side resolves to the same non-null speaker; sides with a null speaker may differ. A record
with any unmatched or ambiguous item is rejected as `sentiment_evidence_unverified` and not
saved; staff see "Couldn't verify the analysis. Try again." Tests cover named, numbered,
excluded and label-free turns.

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
currently bound discussion transcript **and** its `prompt_version` equals the currently published
sentiment prompt's version. It is **out of date** after a transcript republish, a moved boundary,
or any change to the prompt (rubric). Records analyzed under different rubrics are therefore
never compared side by side as current. A rubric edit means re-analyzing, and re-accepting,
before results reach consumers again. Re-running adds a new row; the page shows the most recent
`ready` row for the current source and prompt (ties broken by `completed_at`, then `id`).
Concurrent runs: reserve the run in one transaction, following the summary drafts' reserve
pattern. A live `generating` row for the same request returns `sentiment_analysis_in_progress`.
A `generating` row older than an abandonment window (the summary store uses 360 s against a
300 s route limit) no longer blocks and is marked `failed`
[VERIFIED via `lib/services/post-presentation-materials/summary-draft-store.js:12-13,18-43`].
A partial unique index alone cannot express that time rule, so it does not replace the
transaction.

**Terminal-write fence.** Completing or failing a run is a compare-and-set on the exact run id
`WHERE status = 'generating'`. Zero rows updated means the run was abandoned and replaced, so the
late result is discarded as `sentiment_run_superseded`. This matches the summary store
[VERIFIED via `summary-draft-store.js:115-124`; `transcript-summary-service.js:376`]. Tests: an
abandoned run finishing after its replacement, and a late failure after a successful completion,
must not change either row.

Additional columns: `accepted_by_profile_id`, `accepted_at`, `withdrawn_by_profile_id`,
`withdrawn_at` (staff "Accept" and "Withdraw", §2).

**Accept and withdraw:**
- Accept is a conditional update on a `ready`, current row; an out-of-date row cannot be
  accepted.
- An older result can never displace a newer accepted one: `acceptRun` refuses (409
  `sentiment_newer_result_accepted`) when an accepted, not withdrawn row is newer in
  `(completed_at, id)` order, checked under the request lock before any withdraw. A stale acceptance that
  displaces nothing is harmless because consumers re-check currentness at read time.
- At most one row per request is accepted and not withdrawn (partial unique index). Accepting a
  new row withdraws the previous accepted row in the same transaction, recording the actor.
- Withdraw marks the accepted row withdrawn and keeps its acceptance history. Withdrawal never
  falls back to an older accepted row: the request has no accepted result until someone
  accepts again.
- A failed re-analysis leaves the current accepted row unchanged.
- Consumers read only the single accepted, not-withdrawn row, and only while it is current.
- Tests: withdrawal; failed re-analysis; concurrent Accept and Withdraw; accept followed by a
  transcript republish (the row becomes out of date and invisible to consumers).

**Retention:** none (owner decision, §2). No expiry column and no maintenance job. Rows for a
replaced transcript stay stored but read as out of date and are never returned to consumers.

Required documentation and gate surfaces: `scripts/setup-database.js` shape, manifest entry,
`docs/atlas/postgres-staff-discussion-sentiments.md` plus its `docs/APPLICATION_STATE_ATLAS.md`
row (no `docs/SERVICE_AND_UTILITY_CATALOG.md` entry: the sibling summary services are not catalogued and no gate checks it), any route counts in `CANONICAL_COUNTS`
(`check:fact-consistency`), and status/label maps covered by `check:status-enum-parity`.

### 4.5 Page and routes

- **Location:** a new **"Discussion Sentiment"** view inside **Meeting Tracker** (owner decision,
  §2), using the `meeting-tracker` access grant and the staff-only posture.
- **Selection:** a picker over requests that have a bound discussion transcript (any cycle,
  filterable by cycle and meeting date). Staff tick proposals; each row shows "Not analyzed",
  "Current", "Out of date" or "Analyzing…" and has **Analyze** / **Re-analyze**. Desktop-first.
  No internal IDs shown (`feedback-staff-ui-never-shows-internal-ids`). Vocabulary follows what
  the Staff Deliberations surface already says (glossary unsettled).
- **Comparison:** a table, one row per chosen proposal, with columns for reception, enthusiasm,
  headline, and counts of disagreements and uncertainties. Expanding a row shows the quoted
  evidence with speaker and time.
- **Accept:** each current, unaccepted result has **Accept**. Until then it is labelled "AI analysis;
  check the quotes" and is visible only on this page.
- **Withdraw:** an accepted result has **Withdraw**.
- **Routes (new):** `GET` list/read, `POST` analyze, `POST` accept and `POST` withdraw, under the Meeting Tracker namespace. Each one
  uses `requireAppAccess`, `withDalContext`, `loadModelOverrides()` before model resolution,
  route → service only (no adapter imports in `pages/api`), and GUID validation of `requestId`.
  Add rows to `docs/API_ROUTE_SECURITY_MATRIX.md` and `ROUTE_NAMESPACE_LIFECYCLE`.
- **Staff-only:** never served on the Board presentation page or the briefing link, the same
  rule as the Staff Discussion Summary.
- **As built (Stage 4, §9):** the picker shows the cycle's dashboard proposals (existing
  `/api/meeting-tracker/dashboard?projection=schedule&scope=all`) intersected with
  `GET /api/meeting-tracker/discussion-sentiment/candidates?cycleCode=`, which returns request ids whose
  discussion transcript is bound. Two cycle-wide queries (TRANSCRIPT and STAFF_DISCUSSION_TRANSCRIPT, with the
  bundle manifest) are grouped by request and each group goes through the analysis's own `bindCurrent`, so a stale
  or missing discussion TXT is excluded exactly as analyze would refuse it; no per-proposal reads. A `capped` result
  (the export record cap) makes the page say the list may be incomplete. "No staff discussion transcript" can still
  appear after ticking if the transcript went stale in between. `ROUTE_NAMESPACE_LIFECYCLE` has no
  `/api/meeting-tracker` entry, so it is unchanged.

### 4.6 Consumer contract (Proposal Ranking and others)

A read service, `getDeliberationSentiments(requestIds)`, returns, per request, the current
**accepted, not withdrawn, current** `DeliberationSentiment` (or `null`) plus `promptVersion` and `{ status: 'current' | 'out_of_date' | 'none',
analyzedAt }`. Other apps call this service. Proposal Ranking would add an optional
`deliberationSentiment` field next to `ProposalCard.score`.

**Wiring Proposal Ranking is a separate follow-on change.** This plan does not modify Proposal
Ranking. That needs its own decision about whether a frozen round snapshot captures the
sentiment and how it interacts with ranking privacy (private lists before publication). It
also needs an access decision: a consumer app's own grant (for example `proposal-ranking`)
must not become a way around the owning app's staff-only access. The read service therefore
takes the caller's access context and fails closed when that context does not satisfy the
Meeting Tracker readership rule.

Per-request failures never fail the batch. A request the feature is not available for (transcription disabled,
schema not ready, request not allowed) reads `none`. If the sentiment prompt is unseeded or duplicated, no row can be
current: a request with an accepted row reads `out_of_date`, otherwise `none`, always with `sentiment: null`. Only
genuine infrastructure failures throw.

## 5. Owner decisions

All decided 2026-10-13 and recorded in §2. Who may run an analysis: anyone with Meeting Tracker
access; each run is logged against the actor.

## 6. Build stages

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

## 8. Review record

- 2026-10-13 `/contract-reconcile` (Claude): preconditions, loader preserved differences,
  abandoned-run reservation, consumer access, human review folded in.
- 2026-10-13 Codex adversarial plan review (`gpt-6-astra`, verdict needs-attention, 5 findings,
  all confirmed against source and folded in): service-owned schema validation (§4.4);
  server-derived attribution with null for numbered or unidentified speakers (§4.2, §4.4);
  withdrawal path and single accepted row (§4.4); terminal-write fence (§4.4); prompt version
  in currentness (§4.4, §4.6).

## 7. Tests that must have teeth

- A quote that is not a substring of the transcript, and a speaker name not in the transcript,
  must each reject the record. Mutation: remove the check and both tests must fail.
- A record for an older `source_content_hash` must read as out of date.
- Prompt config: `untrusted: true`, `target.kind: 'none'`, `rawOutputRetention: 'none'`; the
  caller passes both retention flags.
- Valid JSON with invalid nested values (bad enum, one-sided disagreement, empty evidence) is
  rejected before the quote check.
- The model cannot set `speaker`. A quote from a "Speaker 3" turn is saved with `speaker: null`.
  A quote whose time matches a different turn is rejected.
- A prompt version bump makes existing records out of date with the transcript unchanged.
- The read service returns nothing for an unaccepted, withdrawn or out-of-date row. Mutation: drop the
  accepted filter and the test must fail.
- Routes refuse requests without app access and never return records to Board or briefing tokens.

## 9. Stage log

- **Stages 1–3 built** (Sonnet) on `claude/discussion-sentiment`: `4e75f1b79` loader extraction,
  `57be45ccc` prompt source/seed/config test/A7 `inv: 35`, `35a7f3247` migration 082, store,
  service. Orchestrator added the Executor budget rows and the matching
  `executor-budget-service.test.js` fixture/count update (the fixture enumerates every budget name).
  Fresh-install shape comes from the manifest via `scripts/lib/fresh-database-bootstrap.js`, so
  `scripts/setup-database.js` is not edited (same as 070–081).
- **Release-order requirement (found in Stage 2):** once the budget row is on `main`, the admin
  budget publish reads every registered prompt's current row (`assertModelCeilings`) and returns
  409 `executor_prompt_not_found` until `meeting-transcript.staff-discussion-sentiment` is seeded
  in that environment. Seed the prompt in Production (owner; wording approved 2026-10-13) **before or
  together with** the merge, and in any Preview environment used for testing.
- Open for Stage 4: map prompt-store `NOT_FOUND`/`DUPLICATE_CURRENT` in accept/read to typed 409s.
- **Review fixes (Opus review, 2026-10-13):** the prompt text now states every validator
  bound (`sidesMax`, `uncertaintyEvidenceMax`, one evidence item per uncertainty, `quoteMin` 12;
  the provider JSON schema carries no `minItems`/`maxItems` because Anthropic native structured
  output rejects array-size keywords and `llm-client.js` sends the schema unmodified, so list
  sizes and the two-sides/one-evidence minimums are enforced only by the prompt and
  `validateSentimentOutput`, where a miss is `sentiment_output_invalid` and staff retry);
  attribution comes from structured turns (formatter grouping over the loader's `discussionContent`,
  with an exact-equality check against the verified TXT, `sentiment_transcript_mismatch` before any
  run row or provider call) instead of parsing TXT labels; `assertEnabled` arguments are asserted;
  `getLatestCurrentReadyRun`/`getAcceptedRun` covered; the 400,000 cap is one shared constant; and a
  loopback-only Postgres test (`tests/integration/discussion-sentiments.pg.test.js`,
  `DISCUSSION_SENTIMENT_PG_TEST_URL`) proves reserve, CAS fence, accept/withdraw and the indexes.
- **Final review (Fable, 2026-10-13):** the exact-equality check reproduces every TXT the
  producer has written: the producer formats `buildStaffDiscussionTranscriptText(source.content,
  source.speakerNames, endMs)` over the same `loadVerifiedSource` result the loader uses, prefixed
  with a UTF-8 BOM that the reader strips [VERIFIED via
  `lib/services/post-presentation-materials/presentation-transcript-service.js:130-155,288,344-345`,
  `transcript-summary-service.js:232`]; bundles before schema v7 carry no attribution decision, so
  `resolveDiscussionAttribution` is a no-op and the pre-v7 formatter output is unchanged [VERIFIED via
  `lib/services/meeting-tracker-transcription/bundle.js:38,231`, `presentation-boundary.js:119-125`];
  an attribution or boundary change publishes a new source revision, which unbinds the TXT as
  `discussion_stale` (409 `staff_discussion_transcript_not_ready`) rather than mismatching [VERIFIED
  via `meeting-tracker-transcription/service.js:600-601` (`publishMeetingCorrection` sets
  `revisionId: operationId`; the recovery path at `:746-755` does the same),
  `presentation-transcript-binding.js:133-139`].
  **Durable hazard:** any future change to the turn layout (`formatTranscriptText`,
  `groupTranscriptByTurn`, `safePlainText`, `formatTranscriptTurnTime`, `speakerNameFor`) makes
  every already-bound discussion TXT fail `sentiment_transcript_mismatch` until that TXT is
  rewritten, and the derivative generation key is revision + boundary with no formatter version
  [VERIFIED via `presentation-transcript-binding.js:30-36`], so there is no regenerate-in-place path
  today. Decide the recovery path (a formatter-version component in the key, or re-cutting the
  boundary) before changing the formatter; `discussion-sentiment-service.test.js` pins the literal
  layout.
- **Codex adversarial review of Stages 1-3 (2026-10-13), two confirmed defects fixed:** a stale acceptance
  computed before the request lock could withdraw a newer accepted result (monotonic guard in `acceptRun`,
  pg-tested for the v1/v2 interleaving); duplicate or same-speaker evidence could manufacture a
  disagreement (rejected after turn resolution).
- **Stage 4 built** (Sonnet, branch `claude/discussion-sentiment`, not on `main`): routes
  `GET|POST /api/meeting-tracker/visits/[requestId]/discussion-sentiment` (read, analyze; `maxDuration` 300; the
  POST body must be empty so no actor can be supplied) and `.../discussion-sentiment/accept` and `/withdraw`
  (body `{ runId }`), all `requireAppAccess('meeting-tracker')` + `withDalContext`, actor from the session only;
  `getDiscussionSentimentStatus` in the service; typed 409 `sentiment_prompt_not_ready` for a missing or duplicated
  current prompt (read, accept, analyze); the loader's "summarize" copy is reworded to "analyze" with the same
  codes. Page `/meeting-tracker/discussion-sentiment` (`DiscussionSentimentView`), linked from the Meeting Tracker
  list. The picker reuses the existing `/api/meeting-tracker/dashboard?projection=schedule&scope=all` visit list
  (no new list route); status is read only for proposals staff tick, never for every visit. The model-override
  gate did not need a route change (`loadModelOverrides()` stays inside `analyzeDiscussionSentiment`), and
  `ROUTE_NAMESPACE_LIFECYCLE` has no `/api/meeting-tracker` entry, so it is unchanged. Sort order (reception,
  enthusiasm, then fewer disagreements, then fewer uncertainties; no-result rows last) is `sortSentimentRows`
  (owner confirmed 2026-10-13). Out-of-date results show no comparable values. The picker originally listed every
  site visit; the owner decided transcript-only on 2026-10-13 (see the candidates entry below).
- **Stage 5 built** (this is item 6 of §6; calibration, item 5, is the owner's separate read-only run):
  `getDeliberationSentiments(requestIds, accessContext)` in
  `discussion-sentiment-reader.js`; no consumer wired, Proposal Ranking untouched. It refuses (403) unless the
  profile in `accessContext.profileId` is active and holds the `meeting-tracker` grant or the superuser role,
  checked live like `requireAppAccess` and `assertReviewPanelAccess` (Postgres `is_active` and superuser read, then
  `listAppKeysForUser`); it does not trust a caller-supplied grant list.
  At most 50 GUID request ids; results are keyed by lowercase GUID. A `sentiment` is returned only for the
  accepted, not withdrawn, `ready`, current row (re-checked in code as well as in the store query). One request
  never fails the batch: a request the feature is not available for reads `none`; an unseeded or duplicate prompt
  makes nothing current (an accepted row reads `out_of_date`, otherwise `none`, always `sentiment: null`); only
  real infrastructure failures throw.
- **Stage 4-5 review fixes (Opus, 2026-10-13):** per-request reader failures and an unseeded prompt no longer fail
  the batch (§4.6); Withdraw stays available when the transcript is unbound or stale (`accepted` is returned in the
  `no_transcript` branch); an errored page row has Try again and offers no actions until `ready`; "still analyzing"
  uses the database clock; a token-surface exposure test (§7); supervised-test refusal worded for sentiment.
- **Stage 4-5 final review fixes (Fable, 2026-10-13):** an action started before a proposal was unticked no longer
  writes to the re-ticked row (per-pick guard, view test); an abandoned `generating` row (no longer live, not yet
  marked failed) reads as a failed last run so the page says the last analysis did not finish; matrix accept row
  lists 404 `sentiment_not_found`; §4.5 carries the as-built picker note.
- **Final Codex branch review** (`gpt-6-astra`, needs-attention, 1 finding, confirmed and fixed by the
  orchestrator): a withdrawn run still offered Accept, which the store always refuses
  (`accepted_at IS NULL`). Accept now requires a never-accepted run; a withdrawn run shows "Withdrawn.
  Re-analyze to accept a new result." View test covers accept → withdraw → reload (mutation-checked).
- **Owner decisions and transcript-only picker (2026-10-13):** picker transcript-only, sort order kept, prompt
  approved (all in §2). Built on the exact path: `discussion-sentiment-candidates.js`
  (`listDiscussionSentimentCandidates`) behind `GET /api/meeting-tracker/discussion-sentiment/candidates`;
  `request-document.js` `findByCycle` gained an opt-in `includeMeetingTranscriptBundle` (default off, other
  callers unchanged) so the TRANSCRIPT row's boundary manifest comes back. Only TRANSCRIPT and
  STAFF_DISCUSSION_TRANSCRIPT are fetched: `bindStaffDiscussionTranscript` reads only those winners and the
  projection chooses each type's winner independently. Also fixed a page bug: the program and cycle options were
  read from a variable reassigned before React ran the updater, so the selects could stay empty.
