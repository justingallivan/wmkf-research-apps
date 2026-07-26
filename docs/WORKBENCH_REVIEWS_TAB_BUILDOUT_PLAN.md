---
title: "Workbench Reviews Tab — Consumption Build-Out Plan"
domain: reviewer-workbench
kind: plan
status: active
summary: "All four Reviews-tab phases are built and deployed. The remaining verification boundary is the first real submitted review (or a staged test submission)."
canonical: false
cataloged: 2026-07-03
owner: product-engineering
related:
  - docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md
  - docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md
  - shared/components/workbench/ReviewsTab.js
  - lib/external/review-answer-snapshot.js
---

# Workbench Reviews Tab — Consumption Build-Out Plan

**Status: Phases 1-3 BUILT + DEPLOYED (S326, 2026-07-03; prod deploys verified
on exact SHAs through `e6991f35`). Browser-drive S326 on applications.wmkeck.org
PASSED all zero-submission-era checks: tab render, Outstanding rows against live
acceptance data (disabled-nudge tooltip confirmed via accessible name), correct
ABSENCE of Compare/Export with zero submissions, clean console, request-switch
stale-guard.**

**Phase 4 DEPLOYED (S326, 2026-07-03): full go-live sequence executed in
order — wave11 column provisioned in prod Dataverse
(`akoya_request.wmkf_ReviewSynthesisJson`, live-probed selectable HTTP 200),
code deployed (prod deployment READY on `fc9ab2c7`), and the
`review-synthesis.generate` prompt seeded as v1 (create-only bootstrap,
exactly-one-current verified), then advanced through the audited admin route to
current backward-compatible v2 on 2026-07-26. Same D26
verification-boundary caveat as Phases 2-3: the synthesis flow cannot be
exercised end-to-end until at least one review is submitted (the route correctly
409s `no_submitted_reviews` until then); unit tests (mocked Executor/Dataverse)
are the coverage today.

**Verification boundary (owner context, S326): the portal is being built AHEAD
of the December-2026 cycle — no reviewer has ever submitted through it, so the
populated Compare grid, narrative browser, and DOCX/PDF exports CANNOT be
browser-verified against real data yet. They are covered by unit tests only.
Verify them at the first real submission.**

## Context

The reviewer-facing submission pipeline is COMPLETE and LIVE (see
`docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` and
`docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md`, both marked complete):
reviewers author in-browser against the Dataverse-sourced question set
(`wmkf_reviewquestion` [VERIFIED via lib/external/review-question-fetcher.js:29-48]),
drafts autosave to Postgres `review_drafts.draft_json`
[VERIFIED via lib/services/review-draft-service.js:70-75], and submit writes an
atomic Dataverse changeset — parent `wmkf_appreviewersuggestion`
(`wmkf_reviewreceivedat`, affiliation) plus one self-describing
`wmkf_appreviewanswer` snapshot row per question: `questionKey/Order/Text/Type`,
`answerValue`, `answerText` (= picklist option label at submit time), `answerHtml`
[VERIFIED via lib/external/build-review-submission.js:142-198].

The staff-facing consumption side is the gap: `shared/components/workbench/ReviewsTab.js`
is a read-only card list (ratings, narrative answers, SharePoint download) with the
panel-prep roll-up explicitly deferred [VERIFIED via ReviewsTab.js:18 comment and
component body]. This plan builds it out.

Primary consumers: BOTH program staff pre-panel (compilation/export) and PDs
monitoring in-flight (status/nudges). Owner confirmed scope = all four phases (S326).

## Governing design decisions (owner-confirmed, S326)

1. **Schema-free rendering.** New UI derives everything from the answer snapshot
   rows — rating columns = picklist-type answers, narrative sections = richtext-type
   answers, labels from the row's own `answerText`. NO hardcoded question keys in
   new code. Rationale: questions are staff-editable, but the current tab hardcodes
   `RATING_KEYS = ['impact','risk','overallRating']`
   [VERIFIED via shared/components/workbench/ReviewsTab.js:34], projects only those
   three keys in `ratingsFromAnswers()`
   [VERIFIED via lib/external/review-answer-snapshot.js:40-49], and decodes labels
   through the static schema [VERIFIED via ReviewsTab.js:23 import of
   review-form-schema] — a staff-added rating question would silently not render.
   Legacy projections stay for existing consumers; new code does not read them.
2. **Ordering.** Default view orders questions by the LIVE admin-panel question set
   (`lib/external/review-question-fetcher.js`). Snapshot keys absent from the live
   set (prior-cycle questions) append after in snapshot `questionOrder`, marked
   retired. Owner invariant (S326): questions change between cycles, never mid-cycle.
3. **Question-set drift across reviewers** (same proposal): matrix takes the union
   of question keys; averages/spread compute per key only across reviewers who
   answered it; unasked renders as "not asked", distinct from missing.
4. **Export renders client-side; content stays in Dataverse for Power Automate.**
   File generation reuses the existing client-side utils — `.docx` via the `docx`
   package [VERIFIED via shared/utils/word-export.js:4-54], PDF via `pdf-lib`
   [VERIFIED via shared/utils/pdf-export.js:5-54]; no server code imports either
   util (disconfirming grep over pages/api/ and lib/ returned nothing, S326).
   The Power Automate option is preserved by DATA, not by a server route: raw
   answers are already in Dataverse, and Phase 4 synthesis persists to an
   `akoya_request` output column via the Executor
   [VERIFIED via lib/services/execute-prompt.js:15-16,233,318 — target.kind
   'akoya_request' with skip-if-populated guard]. Phase 3's report composition must
   be a PURE shared module (no DOM/browser APIs) so a server route or
   Dataverse-persisted roll-up can wrap it later. Do NOT build a roll-up column or
   server export route until a PA flow exists to consume it (owner decision, S326).
5. **Reminder nudges reuse the existing sweep machinery.** Review-due reminders
   already run via `sweepReviewDueReminders`
   [VERIFIED via lib/services/reviewer-reminder-sweep.js:166 and its
   `sendOneReminder`/`readRequiredEmailDefaults` call graph]. A manual nudge MUST
   share the sweep's exclusion/dedupe record so manual + cron cannot double-send.
   Outward-facing email = high-risk surface; the send guard is the review point.

## Phases (independently shippable, in order)

### Phase 1 — Outstanding tracking + manual nudge
- Extend `/api/review-manager/reviewers` DTO with per-reviewer submission status,
  days since materials sent, and last-reminder timestamp — source is
  `wmkf_remindersentat` + `wmkf_remindercount` on the suggestion
  [VERIFIED via lib/services/reviewer-reminder-sweep.js:174-188,254-255; the cron
  is fire-once (filters `wmkf_remindersentat eq null`)].
- Manual-nudge semantics: stamps the SAME marker + increments `wmkf_remindercount`
  (so cron and manual can never double-send — shared-marker mechanism), but manual
  re-sends by staff are allowed deliberately; UI shows last-sent date + count so
  the staffer sees prior nudges before sending again.
- ReviewsTab: "Outstanding" section above submitted cards; per-reviewer
  "Send reminder now" action posting to a new guarded route
  (`requireAppAccess(..., 'review-manager', ...)` per existing pattern
  [VERIFIED via pages/api/review-manager/download-review.js:44]; add security-matrix
  + route-lifecycle entries).
- Manual send goes through the sweep's send + dedupe path.

### Phase 2 — Comparison matrix (schema-free)
- Ratings grid: reviewers × picklist answers, per-question average/spread; labels
  from `answerText`.
- Per-question narrative view: all reviewers' richtext answers aligned under each
  question, live-set ordering per decision 2.
- Read-only over the existing route (plus live question order from the fetcher).
  No schema changes.

### Phase 3 — Panel-prep roll-up/export (BUILT S326)
- Pure composition module `shared/utils/review-report.js#composeReviewReport`
  (shared, DOM-free, consumes `deriveReviewMatrix` rather than re-deriving):
  proposal header, summary (counts + per-rating-question average/spread),
  ratings table (same rows/columns as the Compare grid), per-richtext-question
  narrative sections (all reviewers' answers, matrix order, `retired` flag
  carried through). The sanitizer's allowlist
  [VERIFIED via lib/external/sanitize-review-html.js:31-38] is simple
  structural/inline tags only (p, br, strong/b, em/i, ul/ol/li, h2/h3,
  blockquote, a — no tables/images/spans/divs), so the naive tag-mapping
  approach anticipated above was sufficient; no deep-review escalation was
  needed. The same module's `htmlToBlocks(html)` tokenizes that allowlisted
  grammar into typed blocks/inline runs consumed by both renderers; an
  unknown/malformed tag degrades to plain text rather than throwing or
  dropping content.
- `shared/utils/review-report-docx.js` (dynamic `import('docx')`, full-
  fidelity: bold/italic/links/lists/headings) and
  `shared/utils/review-report-pdf.js` (pdf-lib via `PDFReportBuilder`) render
  the report object; PDF FLATTENS inline bold/italic runs to plain text
  (`PDFReportBuilder` has no mixed-run text primitive) — documented
  degradation in that module's header, DOCX is the full-fidelity artifact.
- "Export: Word (.docx) / PDF" affordance on `ReviewsTab`'s submitted-reviews
  toolbar (visible once ≥1 review is submitted); composes client-side from
  already-loaded `submitted`/`liveQuestions` — no new fetch, no new route, no
  Dataverse roll-up column. Filename: `reviews-<requestNumber>-<yyyymmdd>.ext`.
- Proposal identity on the export uses whatever `proposals[0]` already
  carries on the `/api/review-manager/reviewers` DTO — `requestNumber`,
  `proposalTitle`, `proposalInstitution`, `proposalAuthors`
  [VERIFIED via pages/api/review-manager/reviewers.js:200-209]. The DTO has no
  dedicated `piName` field; `proposalAuthors` (project leader/applicant)
  stands in as the best-available PI identity rather than extending the
  route.

### Phase 4 — AI synthesis (BUILT; provisioned; prompt current in production)
- Tier-1 prompt `review-synthesis.generate` (`shared/config/prompts/review-synthesis.js`,
  initially bootstrapped with create-only
  `scripts/seed-review-synthesis-prompt.js`, then published through the audited
  admin route as current backward-compatible v2
  `7423049a-3f89-f111-ab0f-7ced8d3d15a6` on 2026-07-26).
  All-override; the untrusted variable is `reviews_digest` — reviewer
  `answerText` (never `answerHtml`) composed server-side into a plain digest —
  declared `untrusted: true` so the Executor wraps it + injects the A7
  preamble. Output: strict JSON, single output `synthesis` →
  `akoya_request.wmkf_reviewsynthesisjson`, `guard: 'always-overwrite'`; a
  `validationSchema` (`lib/utils/ai-output-schema.js`) bounds/strips the parsed
  shape before the writeback.
- New memo column `wmkf_reviewsynthesisjson` on `akoya_request`
  (`lib/dataverse/schema/wave11-review-synthesis/`) — APPLIED to prod 2026-07-03, was prepared/not applied to
  any environment.
- Route `POST /api/review-manager/synthesize-reviews`
  (`requireAppAccess('review-manager', 'reviewers')`, requestId GUID-validated):
  409 `no_submitted_reviews` on zero submitted reviews (no LLM call); since the
  prompt's output guard is `always-overwrite`, regeneration gating lives at
  this route instead — 409 `already_exists` when a synthesis is already stored
  and `overwrite` was not passed. Exemplar caller followed:
  `pages/api/phase-i-dynamics/summarize-v2.js:71-89`.
- `GET /api/review-manager/reviewers` DTO extended with `proposal.reviewSynthesis`
  (fail-soft JSON parse of `wmkf_reviewsynthesisjson`, added to the
  `fetchRequestByIdOrNumber` request-row select).
- `ReviewsTab`'s Synthesis card (renders only when ≥1 review is submitted):
  stored synthesis sections or a "Generate synthesis" / "Regenerate" action;
  plain-text rendering only (LLM output; no `dangerouslySetInnerHTML`).
- `shared/utils/review-report.js#composeReviewReport` accepts an optional
  `synthesis` param → `synthesisSection` on the composed report, additive in
  both the DOCX and PDF renderers; `ExportMenu` passes
  `proposal.reviewSynthesis` through.

## Verification per phase

Relevant red gates before completion claims: `check:api-routes`(+self-test) and
`check:route-lifecycle-auth`(+self-test) for any new route; `check:atlas` if any
Postgres surface changes (none anticipated); unit tests for the DTO extension,
matrix derivation (drift/retired/not-asked cases), composition module, and nudge
dedupe; E2E drive of the tab for each shipped phase.
