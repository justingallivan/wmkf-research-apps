---
title: "Workbench Reviews Tab — Consumption Build-Out Plan"
domain: reviewer-workbench
kind: plan
status: active
summary: "Four-phase Reviews tab build-out: outstanding tracking + nudge, schema-free comparison matrix, panel-prep export, AI synthesis. Consumption side only."
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

**Status: PLANNED (S326, 2026-07-03). No phase built yet.**

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
  days since materials sent, and last-reminder timestamp (from the sweep's send
  record; exact source column to be confirmed at build time [ASSUMED derivable]).
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

### Phase 3 — Panel-prep roll-up/export
- Pure composition module (shared, DOM-free): proposal header, ratings matrix,
  per-reviewer narratives → structured report object.
- Client-side DOCX (primary) and PDF render via existing utils; "Export all
  reviews" button in the tab.
- Hard part: sanitized `answerHtml` → docx structure. Escalate to deep review if
  naive tag mapping (p/br/b/i/ul/ol/li) proves insufficient.

### Phase 4 — AI synthesis
- New registered prompt (prompt governance applies) executed via
  `lib/services/execute-prompt.js` with an `akoya_request` output column (name
  decided at build time); exemplar caller:
  `pages/api/phase-i-dynamics/summarize-v2.js:71-89`.
- Reviewer answer HTML enters the prompt as untrusted content (existing wrapping
  convention).
- Rendered in the tab; optional export section via Phase 3's composition module.

## Verification per phase

Relevant red gates before completion claims: `check:api-routes`(+self-test) and
`check:route-lifecycle-auth`(+self-test) for any new route; `check:atlas` if any
Postgres surface changes (none anticipated); unit tests for the DTO extension,
matrix derivation (drift/retired/not-asked cases), composition module, and nudge
dedupe; E2E drive of the tab for each shipped phase.
