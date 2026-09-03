---
title: "Workbench Reviews Tab — Consumption Build-Out Plan"
domain: reviewer-workbench
kind: plan
status: active
summary: "Reviews and synthesis are live; Wave 25 is exact and template-backed Word exports await reviewed code promotion."
canonical: false
cataloged: 2026-07-03
last_verified: 2026-09-03
owner: product-engineering
related:
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md
  - docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md
  - shared/components/workbench/ReviewsTab.js
  - lib/services/graph-service.js
  - lib/external/review-answer-snapshot.js
---

# Workbench Reviews Tab — Consumption Build-Out Plan

**Status: Phases 1-3 BUILT + DEPLOYED (S326, 2026-07-03; prod deploys verified
on exact SHAs through `e6991f35`). Browser-drive S326 on applications.wmkeck.org
PASSED all zero-submission-era checks: tab render, Outstanding rows against live
acceptance data (disabled-nudge tooltip confirmed via accessible name), correct
ABSENCE of Compare/Export with zero submissions, clean console, request-switch
stale-guard.**

**Reminder-incident closeout (2026-09-01):** the review-due reminder mechanism
described in this historical build plan remains implemented, but the Vercel
reviewer-reminder schedule is paused. Commit `4dd57369` made review-due reminders
link-free and fail-closed on token liveness/runway before marker claim; they no
longer mint or rotate token authority. After production deployment,
authenticated smoke, and a 51-row D26 audit with zero blocked outcomes, the
owner lifted the procedural manual-reminder freeze. The automatic schedule
remains held. The canonical operating contract is
`docs/REVIEWER_ENGAGEMENT_SPEC.md`.

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
attempts. On 2026-07-28, version-preserving publication made governed v3
`660d7e3f-9e8a-f111-ab0f-000d3a31c468` the sole current row with the tracked
native JSON schema. The controlled post-fix smoke then completed on its first
semantic attempt, persisted valid synthesis, and wrote completed AI run
`20aec518-9f8a-f111-ab0f-6045bd018deb` against prompt version 3. Phase 4
reliability is production-proven. The lifecycle/readiness extension merged
through PR #96 as `70956477` and reached READY production deployment
`dpl_2tgAYjUXFFx4nQo7FgE2Z3TBMqP9`. Its Postgres migration is live, the ledger
remained empty after deployment, and an authenticated cron probe first
confirmed automatic generation was disabled. Signed-in verification then
passed, Production automation was enabled, and the controlled bounded smoke
completed successfully as recorded in decision 6 below.

**Verification boundary update (S376):** no genuine external reviewer has used
the form, but the owner-authorized staged production submission proved the
populated Compare/matrix and DOCX/PDF/courtesy outputs against canonical answer
rows. The smoke data was atomically cleaned up. The 2026-07-27 follow-up also
proved the staff Manual Review Entry producer and exact restoration path. The
terminal-response/native-schema/bounded-retry fix passed focused tests, merged
through PR #92 (`ab1d2943`), and reached a Ready production deployment on
2026-07-28. Governed v3 publication and a successful post-fix smoke completed
the same day; the 11 synthetic answers and four staged parent fields were
restored exactly while the new synthesis and audit remained.

**Current export decision (owner-confirmed 2026-09-02):** the Reviews-tab UI
continues to offer only **Word (.docx)**. The approved formatting pass is
`[SOURCE-BUILT, NOT DEPLOYED]`: the button calls a guarded server route that
rereads authoritative Dataverse data and renders a tracked combined template.
The thank-you sweep uses a separate tracked individual-review template for its
courtesy attachment. Neither output is filed to SharePoint in this phase. The
earlier PDF button remains removed; possible Microsoft Graph DOCX-to-PDF
conversion is still `[PLANNED]`.

## Context

> The first two paragraphs below describe the pre-build S326 baseline. They are
> retained as implementation history, not current Workbench behavior. Phases
> 1–3 now provide Outstanding tracking, comparison/matrix, and Word export.
> Phase-4 synthesis lifecycle/readiness is now deployed and production-proven.
> The 2026-08-10 reviewer-affiliation roster addition is built and tested in
> source but is not production-verified until its branch is promoted.

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
**[SCHEMA APPLIED; WRITER SOURCE-BUILT, NOT DEPLOYED]** Wave 25 adds the complete
ordered categorical option set in `wmkf_questionoptions`. The owner-approved
Production apply completed and independent readback was exact on 2026-09-03.
Existing rows remain renderable with an explicit selected-only
fallback; current question definitions are never relabeled as historical state.

At the S326 starting point, the staff-facing consumption side was a read-only
card list. That gap is now closed: `ReviewsTab` includes Outstanding tracking,
comparison, a categorical matrix, manual review entry, and Word export.

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
4. **Current export is a server-authoritative Word download; content remains in
   Dataverse.** The browser sends only the proposal GUID to guarded GET
   `/api/review-manager/export-reviews`; the service rereads the proposal,
   submitted reviews, answers, and synthesis before composing and rendering the
   tracked combined template. The historical generic DOCX and `pdf-lib` renderers
   remain source modules, but the Reviews tab imports neither. No SharePoint
   storage, roll-up column, or browser-authored report DTO is part of this phase.
   The Power Automate option is preserved by DATA, not by a server route: raw
   answers are already in Dataverse, and Phase 4 synthesis persists to an
   `akoya_request` output column via the Executor
   [VERIFIED via `lib/services/execute-prompt.js` target resolution,
   preflight guards, and `persistOutputs`]. Phase 3's report composition must
   be a PURE shared module (no DOM/browser APIs) so a server route or
   Dataverse-persisted roll-up can wrap it later. Do NOT build a roll-up column or
   separate Dataverse roll-up column until a PA flow exists to consume it.
5. **Reminder nudges reuse the existing sweep machinery.** Review-due reminder
   code is implemented via `sweepReviewDueReminders`; the Vercel schedule is
   paused as of 2026-09-01
   [VERIFIED via `reviewer-reminder-sweep.sweepReviewDueReminders`,
   `sendOneReminder`, and `email-defaults.readRequiredEmailDefaults`]. A manual nudge MUST
   share the sweep's exclusion/dedupe record so manual + cron cannot double-send.
   Outward-facing email = high-risk surface; the send guard is the review point.
6. **Synthesis readiness and visibility (owner-confirmed 2026-07-26 and
   participation semantics confirmed 2026-07-27; production-deployed and
   enabled 2026-07-28).**
   Automatic synthesis is allowed only when all participating invitations
   are resolved, with at least one submitted review. Staff may explicitly run
   synthesis earlier as a deliberate manual override after at least one
   submission. Display is independent of generation readiness:
   an existing stored synthesis must remain visible even when there are currently
   zero submitted reviews.
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
   and synthesis runs again. The tracked implementation calculates readiness
   fail-closed, fingerprints the exact digest plus lifecycle classification,
   stores only job/hash state in Postgres, leaves content in the Dataverse memo,
   and exposes Current/Stale plus queued/running/failed state. The automatic cron
   is inert unless `REVIEW_SYNTHESIS_AUTOMATION_ENABLED` is exactly `true`.
   **Release boundary:** migration 028 and merge `70956477` are live; signed-in
   verification passed and Production automation is enabled. The controlled
   Request `1002788` smoke completed job `2`, maintenance run `27723`, and AI
   run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` in one claim. Exact cleanup
   returned zero answers/drafts/eligible requests and the retained memo to
   Stale. PRs #98 and #99 closed the run-source and vanished-input cancellation
   defects; final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready.
7. **Named roster, anonymous synthesis (owner-confirmed 2026-08-10).** Current
   Reviews outputs list the submitted reviewers and their affiliations in a
   deterministic roster, while AI-authored synthesis observations remain
   unattributed. The engagement-specific accepted suggestion value
   `wmkf_revieweraffiliation` wins; the potential-reviewer person's primary
   affiliation is fallback-only, and a missing value is displayed explicitly.
   Contact `parentcustomerid` is not required for this display contract. The
   roster must be composed outside the prompt so the model cannot omit,
   alter, hallucinate, or attach an identity to a synthesized observation.

## Phases (independently shippable, in order)

### Phase 1 — Outstanding tracking + manual nudge
- Extend `/api/review-manager/reviewers` DTO with per-reviewer submission status,
  days since materials sent, and last-reminder timestamp — source is
  `wmkf_remindersentat` + `wmkf_remindercount` on the suggestion
  [VERIFIED via `reviewer-reminder-sweep.sweepReviewDueReminders`; the sweep
  filters `wmkf_remindersentat eq null`].
- Manual-nudge semantics: fail closed unless the current token is active and
  covers the effective review deadline, then stamp the SAME marker + increment
  `wmkf_remindercount` without minting or rotating token authority (so ordinary
  cron/manual eligibility shares one dedupe marker; same-window concurrency and
  a failed post-send stamp remain a known residual). The implemented contract
  permits deliberate staff re-sends and shows last-sent date + count. Production
  use resumed after the verified 2026-09-01 remediation; the automatic schedule
  remains paused.
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
  structural/inline tags only (p, br, strong/b, em/i, sub/sup, ul/ol/li, h2/h3,
  blockquote, a — no tables/images/spans/divs), so the naive tag-mapping
  approach anticipated above was sufficient; no deep-review escalation was
  needed. The same module's `htmlToBlocks(html)` tokenizes that allowlisted
  grammar into typed blocks/inline runs consumed by the Word renderer and the
  retained legacy PDF renderer; an
  unknown/malformed tag degrades to plain text rather than throwing or
  dropping content.
- `lib/services/review-documents/docx-renderer.js` preserves the approved Word
  package shell and injects escaped report content at one required marker. It
  retains headers, footer, section geometry, categorical checkbox comparisons, lists,
  headings, blockquotes, line breaks, and supported inline styles. Independent
  ordered lists restart at one; historical option gaps and unreadable snapshots
  are labeled rather than silently presented as unselected choices. The separate
  tracked individual and combined templates live in `shared/templates/reviews/`.
  The retained generic DOCX and PDF renderers are not exposed by the current UI.
- "Export: Word (.docx)" affordance on `ReviewsTab`'s submitted-reviews
  toolbar (visible once ≥1 review is submitted) fetches
  `/api/review-manager/export-reviews?proposalId=<guid>`. The server calls the
  existing reviewers service with the session email, filters to authoritative
  submitted rows, and returns private/no-store DOCX bytes. Filename remains
  server-owned. No Dataverse roll-up column or SharePoint write is introduced.
- Proposal identity on the export uses whatever `proposals[0]` already
  carries on the `/api/review-manager/reviewers` DTO — `requestNumber`,
  `proposalTitle`, `proposalInstitution`, `proposalAuthors`
  [VERIFIED via `lib/services/review-manager/reviewers-service.js` proposal DTO
  assembly]. The DTO has no
  dedicated `piName` field; `proposalAuthors` (project leader/applicant)
  stands in as the best-available PI identity rather than extending the
  route.
- **[SOURCE-BUILT and focused-test/visual-QA verified 2026-09-02; Wave 25
  exact 2026-09-03; reviewed deployment still pending.]**
  The report model and Word renderer add a named `Reviewers` roster for the
  submitted-review population. Each row renders name plus accepted
  self-reported affiliation, falling back to the person affiliation and then
  the explicit `Not reported` state. The roster is separate from the existing
  per-question material and AI synthesis. When synthesis currentness is false,
  the export labels it stale and states that the roster/answers reflect current
  submissions while synthesis may reflect an earlier reviewer set.

### Deferred future option — Graph-backed PDF conversion `[PLANNED]`

**Purpose decided:** if staff later need one-click PDF again, derive it from the
canonical formatted DOCX instead of maintaining an independent rich-text PDF
layout engine. [Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content-format?view=graph-rest-1.0)
supports downloading a SharePoint/OneDrive DOCX drive item as PDF with
`GET /drives/{drive-id}/items/{item-id}/content?format=pdf`.

**Not built:** there is no conversion route, Graph format-aware download method,
temporary review-export folder, cleanup record, permission proof, or production
probe. The current `GraphService.downloadFile` retrieves original bytes only.

Proposed contract:

1. **Completed locally for Word export.** The staff report's canonical DOCX is
   behind a guarded server service that reads request/review data authoritatively
   and returns a Buffer. A future PDF route must reuse that service and must not
   trust a browser-supplied report DTO.
2. Upload that DOCX as a uniquely named temporary drive item in the request's
   governed SharePoint location (exact folder/retention policy still requires an
   owner decision).
3. Add a narrow Graph helper that requests `content?format=pdf`, handles the
   authenticated 302 response, then follows the short-lived `Location` URL
   without forwarding the Authorization header, matching the existing original-
   content redirect discipline in `GraphService.downloadFile`.
4. Stream the converted bytes from a `requireAppAccess('review-manager',
   'reviewers')` route with a bounded timeout and response size. Return no PDF
   bytes unless the full conversion succeeds.
5. Clean up the temporary DOCX after success or failure. If deletion cannot be
   guaranteed synchronously, record bounded durable cleanup work rather than
   silently accumulating temporary artifacts.
6. Before claiming formatting fidelity, replace the DOCX renderer's styled-only
   link runs with real external hyperlink relationships so Word and the converted
   PDF preserve the target as well as its appearance.

Required pre-build verification:

- `[ASSUMED]` Current Graph application permissions are sufficient; verify the
  production app registration and run a read-only/throwaway tenant conversion
  probe before implementation.
- Decide the governed temporary-file location, retention, collision naming,
  cleanup/retry behavior, and whether the DOCX should be retained as an artifact.
- Add route-security/lifecycle documentation, unit tests for redirect/auth-header
  handling and cleanup fall-through, and an authenticated conversion smoke using
  representative headings, lists, quotes, mixed bold/italic runs,
  subscript/superscript, page breaks, and links.

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
  and `overwrite` was not passed. In the deployed lifecycle extension, an early run
  also requires boolean `confirmEarly:true`, every manual invocation has a
  leased `review_synthesis_jobs` audit row, and ledger-finalization failure
  after Dataverse persistence returns an explicit partial 502.
- `GET /api/review-manager/reviewers` DTO includes
  `proposal.reviewSynthesis` (fail-soft JSON parse of
  `wmkf_reviewsynthesisjson`). The deployed lifecycle extension also retains the
  proposal at zero accepted rows and projects `proposal.reviewSynthesisState`:
  fail-closed readiness, exact-fingerprint Current/Stale state, latest job
  status, timestamps, and sanitized error text. A ledger read failure degrades
  to unavailable/stale without hiding submitted reviews or stored synthesis.
- `ReviewsTab`'s Synthesis card renders stored synthesis independently of
  accepted/submitted count and shows Current/Stale plus readiness and
  queued/running/failed state. Early manual generation uses an explicit browser
  confirmation and sends `confirmEarly:true`. LLM output remains plain-text
  only (no `dangerouslySetInnerHTML`). **[VERIFIED via source and focused tests
  2026-08-10; deployment pending.]** When submitted reviews exist, the card
  now renders their deterministic named affiliation roster above the anonymous
  synthesis values. A non-current synthesis carries an explicit warning that
  the roster is current while the synthesis may cover an earlier set.
- `/api/cron/drain-review-syntheses` plus
  `review-synthesis-drain.js` implement the automatic all-in path with an exact
  request+fingerprint dedupe key, small leased claims, pre-generation
  lifecycle-readiness/content-fingerprint revalidation, and three-attempt bounded retries.
  Terminal fingerprints are not automatically reopened. The route is
  deployment-safe by default because any value other than exact
  `REVIEW_SYNTHESIS_AUTOMATION_ENABLED=true` returns an inert response.
- **Automatic production result (2026-07-28):** signed-in read-only verification
  passed, the Production flag was deliberately enabled, and a controlled
  Request #1002788 review made the global census exactly one eligible request.
  The bounded drain enqueued/claimed/completed job `2` in one attempt,
  maintenance run `27723` recorded `eligible=1/enqueued=1/claimed=1/completed=1`,
  and prompt-v3 AI run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` ended with
  `end_turn` and wrote the synthesis. Cleanup atomically removed the 11 staged
  answers and restored the four parent fields; zero answers/drafts/eligible
  requests remain and the retained memo correctly reports Stale. The first
  pre-LLM attempt exposed unsupported `Vercel Cron` run-source labeling (fixed
  by PR #98); the sweep then closed vanished-input cancellation before content
  loading in PR #99. Final production deployment
  `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready with automation enabled.
- `shared/utils/review-report.js#composeReviewReport` accepts an optional
  `synthesis` param → `synthesisSection` on the composed report, additive in
  the current DOCX export; `ExportMenu` passes `proposal.reviewSynthesis`
  through. The retained legacy PDF renderer also understands the section but
  is not reachable from the Reviews-tab UI.
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
  budget. The independently reviewed code is production-deployed through PR #92
  (`ab1d2943`). Governed v3 was then published with the exact tracked schema,
  and the 2026-07-28 controlled smoke succeeded on the first semantic attempt:
  valid synthesis persisted and completed AI run
  `20aec518-9f8a-f111-ab0f-6045bd018deb` records prompt version 3,
  `end_turn`, and the redacted review digest. Exact cleanup removed the 11
  staged answers and restored four parent fields without altering the new memo.

## Verification per phase

Relevant red gates before completion claims: schema preflight/readback before
code deployment; `check:api-routes`(+self-test), trust/route/DAL boundary gates,
`check:atlas`(+self-test), fact consistency, focused renderer/service/route and
answer-snapshot tests, DOCX render inspection, traced-template bundle inspection,
and a production build. Signed-in export verification follows deployment.
