---
title: "Workbench Reviews Tab — Consumption Build-Out Plan"
domain: reviewer-workbench
kind: plan
status: active
summary: "Reviews tab deployed; deterministic consumers verified; local synthesis reliability fix awaits governed publication/deployment and post-fix smoke."
canonical: false
cataloged: 2026-07-03
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
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
verification boundary was exercised on 2026-07-26 with controlled Request
#1002788. Submitted DTO hydration, comparison, DOCX/PDF, and courtesy-copy
consumers passed. A third controlled current-v2 synthesis call on 2026-07-27
again failed before writeback with incomplete JSON and created a failed
append-only AI run; the prior request memo remained unchanged across all three
attempts. Phase 4 therefore remains a red pre-exposure gate.

**Verification boundary update (S376):** no genuine external reviewer has used
the form, but the owner-authorized staged production submission proved the
populated Compare/matrix and DOCX/PDF/courtesy outputs against canonical answer
rows. The smoke data was atomically cleaned up. The 2026-07-27 follow-up also
proved the staff Manual Review Entry producer and exact restoration path. AI
synthesis remains the unresolved production runtime boundary. A local
terminal-response/native-schema/bounded-retry fix passed focused tests on
2026-07-27; governed prompt publication, deployment, and a post-fix smoke remain.

## Context

> The first two paragraphs below describe the pre-build S326 baseline. They are
> retained as implementation history, not current Workbench behavior. Phases
> 1–3 now provide Outstanding tracking, comparison/matrix, and DOCX/PDF export.
> The current gap is the Phase-4 synthesis lifecycle/readiness behavior described
> in decision 6 and Phase 4.

The reviewer-facing submission pipeline is COMPLETE and LIVE (see
`docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md` and
`docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md`, both marked complete):
reviewers author in-browser against the Dataverse-sourced question set
(`wmkf_reviewquestion` [VERIFIED via
`review-question-fetcher.fetchActiveReviewQuestions`]),
drafts autosave to Postgres `review_drafts.draft_json`
[VERIFIED via `lib/services/review-draft-service.js` draft upsert], and submit writes an
atomic Dataverse changeset — parent `wmkf_appreviewersuggestion`
(`wmkf_reviewreceivedat`, affiliation) plus one self-describing
`wmkf_appreviewanswer` snapshot row per question: `questionKey/Order/Text/Type`,
`answerValue`, `answerText` (= picklist option label at submit time), `answerHtml`
[VERIFIED via `lib/external/build-review-submission.js`
`buildReviewSubmission`].

At the S326 starting point, the staff-facing consumption side was a read-only
card list. That gap is now closed: `ReviewsTab` includes Outstanding tracking,
comparison, a categorical matrix, manual review entry, and DOCX/PDF export.

Primary consumers: BOTH program staff pre-panel (compilation/export) and PDs
monitoring in-flight (status/nudges). Owner confirmed scope = all four phases (S326).

## Governing design decisions (owner-confirmed, S326)

1. **Schema-free rendering.** New UI derives everything from the answer snapshot
   rows — rating columns = picklist-type answers, narrative sections = richtext-type
   answers, labels from the row's own `answerText`. NO hardcoded question keys in
   new code. Rationale: questions are staff-editable. Before the matrix build, the
   tab depended on a fixed rating projection. The remaining legacy single-card
   projection now uses the two canonical snapshot keys
   `RATING_KEYS = ['riskLevel', 'overallAssessment']`
   [VERIFIED via `ReviewsTab.RATING_KEYS` and
   `review-answer-snapshot.REVIEW_RATING_KEYS`]; it is not the matrix contract.
   A staff-added rating question would still be invisible to that legacy
   projection, so the schema-free matrix derives its columns from answer rows.
2. **Ordering.** Default view orders questions by the LIVE admin-panel question set
   (`lib/external/review-question-fetcher.js`). Snapshot keys absent from the live
   set (prior-cycle questions) append after in snapshot `questionOrder`, marked
   retired. Owner invariant (S326): questions change between cycles, never mid-cycle.
3. **Question-set drift across reviewers** (same proposal): matrix takes the union
   of question keys; averages/spread compute per key only across reviewers who
   answered it; unasked renders as "not asked", distinct from missing.
4. **Export renders client-side; content stays in Dataverse for Power Automate.**
   File generation reuses the existing client-side utils — `.docx` via the `docx`
   package [VERIFIED via `shared/utils/word-export.js`], PDF via `pdf-lib`
   [VERIFIED via `shared/utils/pdf-export.js`]; no server code imports either
   util (disconfirming grep over pages/api/ and lib/ returned nothing, S326).
   The Power Automate option is preserved by DATA, not by a server route: raw
   answers are already in Dataverse, and Phase 4 synthesis persists to an
   `akoya_request` output column via the Executor
   [VERIFIED via `lib/services/execute-prompt.js` target resolution,
   preflight guards, and `persistOutputs`]. Phase 3's report composition must
   be a PURE shared module (no DOM/browser APIs) so a server route or
   Dataverse-persisted roll-up can wrap it later. Do NOT build a roll-up column or
   server export route until a PA flow exists to consume it (owner decision, S326).
5. **Reminder nudges reuse the existing sweep machinery.** Review-due reminders
   already run via `sweepReviewDueReminders`
   [VERIFIED via `reviewer-reminder-sweep.sweepReviewDueReminders`,
   `sendOneReminder`, and `email-defaults.readRequiredEmailDefaults`]. A manual nudge MUST
   share the sweep's exclusion/dedupe record so manual + cron cannot double-send.
   Outward-facing email = high-risk surface; the send guard is the review point.
6. **Synthesis readiness and visibility (owner-confirmed 2026-07-26 and
   participation semantics confirmed 2026-07-27; planned, not implemented).**
   The target is automatic synthesis only when all participating invitations
   are resolved, with at least one submitted review. Staff may explicitly run
   synthesis earlier as a deliberate manual override after at least one
   submission. Display is independent of generation readiness:
   an existing stored synthesis must remain visible even when there are currently
   zero submitted reviews. The present implementation does not enforce this
   contract: it has no automatic trigger, its manual card appears once at least
   one review is submitted, the route rejects only zero submitted reviews, and
   the card (including already-stored output) is hidden at zero submissions.
   The readiness population is every selected, not-applicant-excluded suggestion
   that has entered the invitation/engagement lifecycle (`wmkf_invited=true` or
   `wmkf_accepted=true`). A row resolves with review content when
   `wmkf_reviewreceivedat` is set. It resolves without review content when it has
   an explicit non-review outcome (declined, no-response,
   `withdrawn_sufficient`, withdrew, or released), or when its current external
   token is revoked or expired. A live-token participant without a receipt
   remains blocking, including a not-yet-accepted invitee. Unselected,
   applicant-excluded, and explicitly merged/removed duplicate rows do not
   participate; an unresolved duplicate still in the readiness population
   blocks. Missing/malformed token dates and unknown lifecycle states block
   fail-closed. Minting a replacement token clears revocation and writes a future
   expiry [VERIFIED via `token-lifecycle.mintAndStore` →
   `reviewer-suggestion.setExternalToken`]. It reactivates readiness only when
   revoked/expired token state was that otherwise-participating, nonterminal
   row's sole resolved-without-review condition; it does not reselect a removed
   row or undo decline/withdraw/release. A synthesis generated before a genuine
   reactivation remains visible but is not current until the population resolves
   and synthesis runs again.

## Phases (independently shippable, in order)

### Phase 1 — Outstanding tracking + manual nudge
- Extend `/api/review-manager/reviewers` DTO with per-reviewer submission status,
  days since materials sent, and last-reminder timestamp — source is
  `wmkf_remindersentat` + `wmkf_remindercount` on the suggestion
  [VERIFIED via `reviewer-reminder-sweep.sweepReviewDueReminders`; the cron
  is fire-once (filters `wmkf_remindersentat eq null`)].
- Manual-nudge semantics: stamps the SAME marker + increments `wmkf_remindercount`
  (so cron and manual can never double-send — shared-marker mechanism), but manual
  re-sends by staff are allowed deliberately; UI shows last-sent date + count so
  the staffer sees prior nudges before sending again.
- ReviewsTab: "Outstanding" section above submitted cards; per-reviewer
  "Send reminder now" action posting to a new guarded route
  (`requireAppAccess(..., 'review-manager', ...)` per the guarded
  `pages/api/review-manager/download-review.js` route; add security-matrix
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
  [VERIFIED via `sanitize-review-html` allowlist] is simple
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
  [VERIFIED via `lib/services/review-manager/reviewers-service.js` proposal DTO
  assembly]. The DTO has no
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
  preamble. Output: strict JSON with prompt-level
  `generationMode:'native-json-schema'`, single output `synthesis` →
  `akoya_request.wmkf_reviewsynthesisjson`, `guard: 'always-overwrite'`; a
  `validationSchema` (`lib/utils/ai-output-schema.js`) bounds/strips the parsed
  shape before the writeback.
- New memo column `wmkf_reviewsynthesisjson` on `akoya_request`
  (`lib/dataverse/schema/wave11-review-synthesis/`) — APPLIED to prod 2026-07-03
  and live-probed selectable.
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
- **Known workflow/UI gap (owner decisions 2026-07-26 and 2026-07-27; not yet
  implemented):**
  preserve the explicit staff action as the early-run override, add automatic
  execution only after all reviews are in, and decouple stored synthesis display
  from readiness so a populated memo is never hidden merely because the current
  submitted count is zero. The current ≥1 client gate and zero-only service gate
  are implementation evidence, not the intended final workflow. Implement the
  participation state machine in governing decision 6, including revoked/expired
  tokens as resolved-without-review and replacement-token minting as
  reactivation only for otherwise-participating, nonterminal rows.
- `shared/utils/review-report.js#composeReviewReport` accepts an optional
  `synthesis` param → `synthesisSection` on the composed report, additive in
  both the DOCX and PDF renderers; `ExportMenu` passes
  `proposal.reviewSynthesis` through.
- **Production execution results (2026-07-26 and 2026-07-27):** Request
  #1002788 produced the exact categorical digest input, but three controlled
  current-v2/8000-max-token Executor runs failed parsing incomplete JSON
  (`Unexpected end of JSON input`). The first two failed audit ids are
  `f5aa3712-4789-f111-ab0f-6045bd018a07` and
  `04805a39-4789-f111-ab0f-6045bd018deb`. The 2026-07-27 bounded follow-up
  failed as HTTP 500 with audit id
  `be61f383-f289-f111-ab0f-70a8a59cded0`, concrete model
  `claude-sonnet-5`, prompt v2, source `Vercel Interactive`, and redacted
  `reviews_digest`. No attempt changed `wmkf_reviewsynthesisjson`; the latest
  run preserved the exact 1,709-character baseline memo and its prior modified
  timestamp. Its 11 synthetic answers and four staged parent fields were fully
  restored, with no draft or unrelated email/material/reminder/thank-you
  change. The local fix now requires `end_turn` before persistence, preserves
  stop/token/hash diagnostics, uses capability-gated native JSON schema, and
  retries only a typed `max_tokens` termination once with a bounded larger
  budget. This is not yet a production-live claim: publish the governed prompt
  version, deploy the independently reviewed code, and run one controlled
  post-fix smoke before exposure.

## Verification per phase

Relevant red gates before completion claims: `check:api-routes`(+self-test) and
`check:route-lifecycle-auth`(+self-test) for any new route; `check:atlas` if any
Postgres surface changes (none anticipated); unit tests for the DTO extension,
matrix derivation (drift/retired/not-asked cases), composition module, and nudge
dedupe; E2E drive of the tab for each shipped phase.
