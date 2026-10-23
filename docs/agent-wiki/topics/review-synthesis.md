---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Review Synthesis"
source_files:
  - shared/config/prompts/review-synthesis.js
  - shared/components/workbench/ReviewsTab.js
  - lib/services/review-manager/reviewers-service.js
  - lib/services/review-manager/export-reviews-service.js
  - lib/services/review-documents/docx-renderer.js
  - lib/services/pre-site-visit/docx-renderer.js
  - shared/utils/review-report.js
  - shared/utils/review-writeup-paragraphs.js
canonical_docs:
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/atlas/dataverse-wmkf-appreviewanswer.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
watch_paths:
  - shared/config/prompts/review-synthesis.js
  - shared/components/workbench/ReviewsTab.js
  - lib/services/review-manager/reviewers-service.js
  - shared/utils/review-report.js
  - shared/utils/review-writeup-paragraphs.js
update_triggers:
  - "Synthesis prompt or generation/readiness rules change"
  - "Quote verification, report composition, or lifecycle participation changes"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "1646-1846"
---

# Review Synthesis

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 1646-1846 -->
**Phase 4 BUILT (2026-07-03); reliability production-proven 2026-07-28:**
Executor-based AI synthesis of a proposal's submitted reviews. New Tier-1
prompt `review-synthesis.generate` (`shared/config/prompts/review-synthesis.js`,
initially bootstrapped as v1 and published through the audited admin path as
backward-compatible current v2
`7423049a-3f89-f111-ab0f-7ced8d3d15a6` on 2026-07-26); all-override, single untrusted variable
`reviews_digest` (reviewer `answerText`, never `answerHtml`, composed
server-side into a plain digest) so the Executor wraps it + injects the A7
preamble. Output is strict JSON (prompt-level
`generationMode:native-json-schema`, single output `synthesis`;
`validationSchema` bounds/strips the parsed shape) written to a new memo column
`akoya_request.wmkf_reviewsynthesisjson` with `guard: 'always-overwrite'` —
schema-as-code APPLIED TO PROD 2026-07-03 (column live-probed) from
`lib/dataverse/schema/wave11-review-synthesis/`. `POST
/api/review-manager/synthesize-reviews` (`requireAppAccess('review-manager',
'reviewers')`, requestId GUID-validated) returns 409 `no_submitted_reviews`
with zero submitted reviews (no LLM call); since the guard is
always-overwrite, regeneration gating is enforced at THIS route instead — 409
`already_exists` unless `overwrite: true` is passed. The deployed lifecycle
extension also requires explicit `confirmEarly:true` while
participants remain unresolved and records each generation in
`review_synthesis_jobs`. `GET /api/review-manager/reviewers` projects
`proposal.reviewSynthesis` (fail-soft JSON parse) and
`proposal.reviewSynthesisState`. `ReviewsTab` retains the Synthesis
card even at zero accepted/submitted reviews, with Current/Stale, readiness,
and queued/running/failed state. Output is plain-text only (no
`dangerouslySetInnerHTML`); `composeReviewReport` accepts an optional
`synthesis` param rendered in the current Word export.

**Slice 2 (Reviews Tab Phase II, 2026-09-14,
docs/plans/REVIEWS_TAB_WRITEUP_PARAGRAPHS_PLAN_2026-09-14.md §4.3):** the
tracked prompt (`shared/config/prompts/review-synthesis.js`) and
`jsonSchema`/`validationSchema` gain two fields inside `synthesis` —
`writeupThemes` (string, 2-3 sentences) and `writeupQuotations`
(`{questionKey, quote}[]`, up to three representative quotes) — both `required`
in the native JSON schema (no `maxItems`/`maxLength` there; all caps live in
`validationSchema` only, which fails the whole write closed on a cap breach).
`parseReviewSynthesis` (`reviewers-service.js`) passes both through as a
read-boundary shape guard only. **Quote provenance is verified downstream, not
here**: `shared/utils/review-writeup-paragraphs.js`'s exported
`verifyAndSelectQuotations` keeps a candidate quote only when it is a
normalized substring of exactly one submitted reviewer's
`answers[].answerText`, at most one kept quote per reviewer, ordered by
`reviewerOverallAssessment` descending, reduced to the top/median/bottom three
when more than three survive (W8); unverifiable/ambiguous/duplicate candidates
are dropped and counted (`droppedQuotationCount`, surfaced on the Reviews tab
as "N quotation(s) could not be matched to a review and were omitted"). The
Reviews tab's Writeup paragraphs card renders the verified themes/quotations,
or a "Regenerate synthesis to add themes and quotations" hint (pointing at the
existing Regenerate control, not a new action) when a synthesis is current but
predates these fields. `review-report.js`'s `synthesisSection` carries the
same VERIFIED quotations (never the raw `synthesis.writeupQuotations`) plus
`writeupThemes`, for the Word export. **Slice 3 (2026-09-14):**
`composeReviewReport` also builds `writeupSection` (the deterministic
score/reviewer/expertise sentences as `{text, underline}` run arrays, plus the
same verified `themes`/`quotations`) from the shared `composeWriteupParagraphs`
composer, and `shared/utils/review-report-docx.js` renders it as a "Reviews
(writeup)" DOCX section with `TextRun({underline:{}})` on reviewer-name runs
only — model strings (themes, quotations, institution text) are always plain
runs; the PDF renderer is unchanged (W4: no PDF work) and ignores the new
section without erroring. The Opus Slice 2 review also fixed a cross-surface
divergence: quote-tie-break ordering now uses the exported
`compareReviewersByName` on a canonical re-sort inside
`verifyAndSelectQuotations`, so the tab (name-sorted `submitted`) and the
`export-reviews-service.js` roster (now also sorted with the same comparator)
select identical W8 quotations regardless of caller order (locale pinned
`'en'` in `compareReviewersByName` so server and browser sort identically).
**Slice 4 (2026-09-14, plan §4.5):** the same deterministic sentences (no
model text) fill `STAFF:RefereeSection` in the Phase II Pre-Site Visit
Word draft. `reviewers-service.js`'s new request-scoped `getWriteupRoster`
(no caller `scope`/`azureEmail`) feeds
`review-writeup-paragraphs.js`'s new `composeRefereeSection`, which returns
`null` when zero reviews are submitted (token left for staff) or
`{text, names, diagnostics}`; naming an outstanding reviewer is an
ALLOWLIST (`accepted === true` AND `reason === 'active_invitation'` only —
every other blocker reason collapses into a counted generic clause plus a
`referee_blocker_unnamed` diagnostic). `pre-site-visit/docx-renderer.js`
moved the token out of `MANUAL_PLACEHOLDERS` into a new
`CONDITIONAL_PLACEHOLDERS` set and now returns `{docx, diagnostics}` instead
of a bare Buffer — `referee_name_not_matched` for any supplied name with zero
underlines in the referee paragraph (reviewer names never join
`personnelNames`, so they can never trigger `personnel_name_not_matched`).
`artifact-service.js`'s input snapshot is schemaVersion 4
(`request.refereeSection`), coreEnvelope bumped to 4 in lockstep; a genuine
roster-read failure at generation fails closed
(`pre_site_visit_referee_roster_unavailable`); `referee_section_manual`
surfaces whenever the stored snapshot predates the feature (v2/v3) or a v4
snapshot has no composed section (zero submitted reviews at generation) —
modelled on the existing `funding_history_manual` note. **Wrap-up
(2026-09-14):** a composer failure (as distinct from a roster read failure)
fails closed separately as `pre_site_visit_referee_compose_failed`; a
submitted review with an unlabelled (pre-current-scale) rating emits
`referee_rating_unlabelled` instead of silently vanishing from the score
tally; **(2026-09-21)** a submitted reviewer with neither `wmkf_keywords` nor
`wmkf_areaofexpertise` emits a named `referee_expertise_missing` diagnostic
(shared `expertiseAreasOf` helper, so the sentence and the diagnostic cannot
disagree about who was omitted) — observed on request 1002852, where the
applicant-recommended reviewer had no expertise while both Finder reviewers
did. That structured diagnostic remains Pre-Site-only (`composeRefereeSection`
never accepts a `synthesis` argument); **the Reviews tab has its own copy**
— `composeWriteupParagraphs` (`review-writeup-paragraphs.js`) pushes the same
condition, for the same reviewers, into its plain-string `warnings` array
("`<name>` has no recorded expertise, so the expertise sentence omits them.
Add keywords or an area of expertise to their reviewer record."), which
`ReviewsTab.js`'s `WriteupParagraphsCard` already renders as a list beneath
the composed paragraphs — so staff see the gap before exporting, not only in
the Pre-Site artifact; `renderPreSiteVisitDocx` treats a blank/whitespace-only
`refereeSection.text` as `null`; and `review-synthesis-readiness.js` exports
`REVIEW_SYNTHESIS_BLOCKER_REASONS` so the allowlist test iterates the live
reason set rather than a hand-copied list. **Codex adversarial review
(2026-09-14):** `verifyAndSelectQuotations` now also requires (a) a
narrative `questionType` (`richtext`/`string`; never `picklist`/
`multiselect`, whose `answerText` is a decoded option LABEL, not
reviewer-authored prose), (b) a minimum of 6 normalized words, and (c)
word-boundary matching (not a bare substring) before a model-proposed quote
verifies against a submitted answer; `getWriteupRoster` now sorts its
`reviewers` with `compareReviewersByName` before returning (previously
adapter fetch order), so `composeRefereeSection` agrees with the tab on tied
ratings. `WriteupParagraphsCard`'s Copy button (`ReviewsTab.js`) now guards
its post-await state writes with a `useRef` generation counter, bumped on
every `copy()` call and on every html-change reset, so a clipboard promise
that resolves/rejects after content changed underneath it (a permission
prompt outliving a request switch) can no longer paint a stale "Copied"/
"Copy failed" label; the card is also a named export now, purely so a unit
test can mount it directly without `ReviewsTab`'s own loading-gate unmount
masking the regression. **[HISTORICAL PRODUCTION MILESTONE 2026-09-15 UTC]**
PR #296 merged as `b9ad64eb` and deployment
`wmkfresearchapps-adp2hh965` reached Ready; the owner then published governed
`review-synthesis.generate` v4 as the sole-current seven-key row with a dated
`DATAVERSE_PROD_WRITE_ACK`. **[CURRENT PRODUCTION STATE 2026-09-16 UTC]**
Commit `c52cb7b0` temporarily disabled representative quotation generation:
the tracked prompt, native schema, and validation schema omit
`writeupQuotations`, and the regeneration hint promises themes only. After
explicit owner authorization, guarded `--force` publication created
sole-current v5 `d8b80702-29b2-f111-aaac-002248086b29`; independent readback
confirmed exact system/body/variables/schema parity and exactly six required
keys (`consensus`, `disagreements`, `keyConcerns`, `ratingSummaries`,
`overall`, `writeupThemes`) with no quotation field in either schema.
Publication did not invoke the model or generate a request synthesis. The read
paths remain version-tolerant: five-key syntheses and seven-key v4 syntheses
remain readable, and already-stored v4 quotations still pass through the
existing provenance verification/rendering path. Same
verification boundary as Phases 2-3: Request #1002788 production-proved the
submitted DTO, categorical matrix, and both then-present export renderers on
2026-07-26; that historical smoke does not make PDF a current UI feature.
Three real v2 synthesis executions failed before writeback with
`Claude output not valid JSON: Unexpected end of JSON input`, producing failed
append-only audit runs `f5aa3712-4789-f111-ab0f-6045bd018a07` and
`04805a39-4789-f111-ab0f-6045bd018deb` on 2026-07-26, then
`be61f383-f289-f111-ab0f-70a8a59cded0` on 2026-07-27. The latest attempt
returned HTTP 500 with `claude-sonnet-5`, prompt v2, Vercel Interactive source,
and a redacted override. The prior request memo remained byte-for-byte
unchanged. The 11 synthetic answers and four staged suggestion fields were
fully restored, with no draft or unrelated email/material/reminder/thank-you
change; the failed AI run remains append-only. The same smoke also proved the
staff Manual Review Entry path. The local 2026-07-27 change preserves joined
response text/stop metadata, requires `end_turn` before persistence, uses
capability-gated native JSON schema, and retries one typed `max_tokens`
termination once with a bounded larger budget. Each semantic attempt retains
its own AI-run audit attempt. Governed v3
`660d7e3f-9e8a-f111-ab0f-000d3a31c468` became the sole current production row
on 2026-07-28 with the exact tracked native JSON schema. The controlled Request
`1002788` smoke then completed on its first semantic attempt with `end_turn`,
persisted valid synthesis, and wrote completed AI run
`20aec518-9f8a-f111-ab0f-6045bd018deb` against prompt version 3. Exact cleanup
deleted the 11 staged answers and restored four parent fields while preserving
the synthesis and append-only audit. Independent follow-up review returned READY.

**Owner-confirmed lifecycle (2026-07-26; participation semantics closed
2026-07-27; production-deployed and enabled 2026-07-28):** automatic
synthesis runs only after
all participating invitations resolve and at least one review is submitted;
staff may explicitly generate it earlier after one submission. Participants are
selected, not-applicant-excluded rows that entered invitation/engagement
(`wmkf_invited=true` or `wmkf_accepted=true`). A receipt resolves with review
content. Declined, no-response, `withdrawn_sufficient`, withdrew, released, and
a currently revoked or expired token resolve without content. Every other
participant without a receipt blocks, including live-token invitees who have
not accepted, unresolved duplicates, and malformed/unknown lifecycle or token
state. Unselected, applicant-excluded, and explicitly merged/removed duplicates
do not participate. `mintAndStore` clears revocation and writes a future expiry, but
token regeneration is independently fail-closed to response type unset/accepted/held,
an unset or known nonterminal review status, and a concrete ETag; it does not reselect a removed row or undo
decline/no-response/withdraw/release, and a concurrent lifecycle change cannot be
overwritten. An existing synthesis remains
visible but is not current until synthesis runs again after genuine reactivation
and resolution. The exact answer digest plus lifecycle classification is hashed;
a matching completed ledger row establishes Current state. The feature-gated
`/api/cron/drain-review-syntheses` uses leased claims and revalidates readiness
and the fingerprint before generation. It remains inert unless
`REVIEW_SYNTHESIS_AUTOMATION_ENABLED=true`. **This extension is production-deployed
and enabled after signed-in verification plus the controlled Request `1002788`
automatic smoke. Job `2`, maintenance run `27723`, and AI run
`1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` completed in one claim; exact cleanup
returned the census to zero eligible requests and the retained memo to Stale.
PR #98 corrected the automatic Executor run source; PR #99 moved lifecycle
revalidation before content loading so vanished inputs cancel. Final deployment
`dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready, and a post-deploy bounded drain
returned zero eligible/enqueued/claimed/failed.** Plan doc:
`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

<!-- end-source-lines: 1646-1846 -->
