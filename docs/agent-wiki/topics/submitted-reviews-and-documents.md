---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Submitted Reviews and Review Documents"
source_files:
  - shared/components/workbench/ReviewsTab.js
  - lib/services/review-manager/reviewers-service.js
  - lib/services/review-manager/export-reviews-service.js
  - lib/services/review-documents/docx-renderer.js
  - lib/services/pre-site-visit/docx-renderer.js
  - lib/services/reviewer-thankyou-sweep.js
  - pages/api/review-manager/export-reviews.js
  - lib/external/sanitize-review-html.js
canonical_docs:
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/atlas/dataverse-wmkf-appreviewanswer.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
watch_paths:
  - shared/components/workbench/ReviewsTab.js
  - lib/services/review-manager/reviewers-service.js
  - lib/services/review-manager/export-reviews-service.js
  - lib/services/review-documents/docx-renderer.js
  - lib/external/sanitize-review-html.js
update_triggers:
  - "Submitted-review projection or staff review entry changes"
  - "Review document generation, retention, or export behavior changes"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "1355-1645"
---

# Submitted Reviews and Review Documents

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 1355-1645 -->
## Reviews tab (workbench consumption of submitted reviews)

The workbench Reviews tab (`shared/components/workbench/ReviewsTab.js`) is fed
by `/api/review-manager/reviewers`; ratings project from the
`wmkf_appreviewanswer` snapshot via `ratingsFromAnswers` (the two canonical
rating keys, `riskLevel` and `overallAssessment`; categorical multiselect
answers remain separate from numeric ratings).
Submitted reviewers still render as a read-only per-reviewer card list
(ratings decoded via the static schema, richtext narrative answers, SharePoint
download). Comparison and Writeup-paragraph clipboard composition run in the
browser; the combined Word export uses the server-authoritative
`/api/review-manager/export-reviews` read/compose/render path (Phase 3, below).
Earlier client-side roll-up/export work is retained as implementation history,
not the current export authority. For draft, answer-snapshot, receipt, and file
pointer boundaries and reader-specific acceptance rules, see the **Review-record
authority** section in
`docs/atlas/dataverse-wmkf-appreviewanswer.md`.

**Writeup paragraphs (Reviews Tab Phase II Slice 1, 2026-09-14,
`docs/plans/REVIEWS_TAB_WRITEUP_PARAGRAPHS_PLAN_2026-09-14.md`):** a
"Writeup paragraphs" card renders directly below the Synthesis card once at
least one review is submitted, showing deterministic score/reviewer/expertise
sentences composed from stored data by the pure module
`shared/utils/review-writeup-paragraphs.js` (also home to the lifted
`reviewerAffiliationOf`). No model, no digest change. A "Copy" button writes
`text/html` (underlined names) and `text/plain` to the clipboard via
`ClipboardItem`, falling back to `writeText`; it stays enabled in read-only
Preview because the write is client-only. An unlabelled overall rating is
excluded from the score tally and surfaced as a muted warning line rather
than dropped silently. Model-authored themes and verified quotations were added in Slice 2 (see the
synthesis section below); the Word export (Slice 3) and the Pre-Site Visit
RefereeSection token fill (Slice 4) reuse the same composers.

**Consultant Feedback (slices 1–3, 2026-09-14):** `ReviewsTab` also mounts
`shared/components/workbench/ConsultantFeedbackSection.js` below Outstanding,
backed by `lib/services/consultant-feedback-service.js` and
`/api/workbench/consultant-feedback[/consultants]` (Postgres table
`consultant_feedback`, migration 048). Slice 2 adds an optional PDF/DOCX
attachment per entry via the browser-direct staged-upload pattern
(`/api/workbench/consultant-feedback/upload-token` mints, `/finalize` binds),
backed by `lib/services/consultant-feedback-attachment-service.js` and the
`consultant_feedback` scope on the shared `portal_upload_staging` ledger
(migration 049); an attached entry's delete is a three-step supersede-then-PG-delete
(plan §3.6), recovered by a bounded sweep on the section's own list load. See
`docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md`. Slice 3 adds a staff-only
`/api/workbench/consultant-feedback/attachment` proxy: the client sends only
request + feedback-entry identity, and the service proves active Postgres
membership plus one same-request Ready/non-Superseded Consultant Feedback
registry row before Graph. PDFs open inline and DOCX files download. The tab
also has local All / Shared / Not shared filters and a name/affiliation-searchable,
keyboard-first roster combobox; neither adds persistence or roster writes. A
profile link remains deferred because Expertise Finder exposes no stable
consultant deep-link and is separately access-gated.

**Phase 1 LIVE (S326; deployed, browser-drive-verified against live acceptance data; reminder safety production-observed 2026-09-01):** outstanding tracking + manual nudge. The owner lifted the procedural manual reminder freeze after the incident-session deployment/smoke observations and a post-deploy D26 liveness audit of 51 never-reminded sweep candidates found zero blocked rows. The deployment metadata did not expose a source SHA, and the authenticated smoke has no tracked artifact. The DTO
(`reviewers.js` GET) adds `submitted` (accepted-reviewer submission status),
`daysSinceMaterialsSent` (derived from `wmkf_materialssentat`, null until
materials are sent), and passes through `reminderSentAt`/`reminderCount`
(`wmkf_remindersentat`/`wmkf_remindercount`). `ReviewsTab` renders an
"Outstanding" section ABOVE the submitted cards for accepted-but-not-submitted
reviewers, each with a "Send reminder now" button (disabled + tooltip when
materials haven't been sent). The button posts `{ requestId, suggestionId }` to
`POST /api/review-manager/send-review-reminder`
(`requireAppAccess('review-manager', 'reviewers')`, both ids GUID-validated
before any Dataverse selector), which delegates to
`lib/services/reviewer-manual-reminder.js#sendManualReviewDueReminder`. That
service preflights eligibility, loads delivery inputs, then authorizes again
from a fresh row immediately before persistence (accepted, materials sent or
under review, review not received, selected, not token-revoked, and not
applicant-excluded via `isExcluded`). It reuses
`reviewer-reminder-sweep.js`'s exported `loadRequestContext` / `loadReviewer` /
`sendOneReminder` send/template machinery. Before writing, the service
classifies the stored token and effective due date on the initial read, the
fresh authorization read, and the final shared sender; revoked, not-minted,
invalid, expired, insufficient-window, or missing-due-date state refuses
without a write or email. The review-due email is link-free and never mints or rotates token
authority. The manual path writes only `wmkf_remindersentat` +
`wmkf_remindercount` in one PATCH bound to that fresh row's ETag. The email is
attempted only after the atomic write succeeds; a 412 returns conflict without
sending. A read failure and a pre-email preparation failure remain distinct retryable outcomes,
while an email failure after persistence retains the marker. Manual and cron
share the marker, and the implemented contract permits a deliberate staff
manual re-send even when it is already set. The automatic cron remains paused
under the separate scheduling hold.

**Structured staff review rescue:** each accepted, not-yet-submitted reviewer in
the Reviews tab also offers "Enter review manually" for cases where the external
portal cannot be used. `ManualReviewEntryForm` loads the current Dataverse
question set from `GET /api/review-manager/manual-review-entry` and renders it
through the external form's shared `ReviewQuestionFields`, including the same
rich-text editor. `POST` re-reads eligibility and the parent ETag, rejects a
stale question-set version, sanitizes narratives, runs the full external review
validator and `buildReviewSubmission()`, then atomically upserts every answer
row and records the parent receipt/status/affiliation with
`wmkf_reviewuploadedbystaff=true`. Draft cleanup happens only after commit and
is best effort. This is deliberately separate from the legacy partial
`mark-received-no-file` and file-upload paths.

**Thank-you sweep (automated):** `/api/cron/send-review-thankyous` (daily,
`30 10 * * *`; the reviewer reminder cron that formerly ran at 10:00 UTC is paused) →
`lib/services/reviewer-thankyou-sweep.js#sweepReviewThankYous`. Eligibility keys
on `wmkf_reviewreceivedat ne null and wmkf_thankyousentat eq null` (NOT the
`wmkf_reviewstatus` picklist — the submit route stamps status `100000003` at
submission, so the received-at timestamp is the durable "review is in" signal).
Structure + idempotency mirror the reminder sweep: fetch rows WITH `_etag`, fail
closed if missing, claim `wmkf_thankyousentat` via If-Match BEFORE send (412 →
`claimFailed`, skip), and a post-claim send failure is logged (`sendFailed`)
without marker rollback or retry (at-most-once — owner-approved
acceptance-confirmation posture). It reuses the reminder sweep's exported
`loadRequestContext`/`loadReviewer` for the PD sender + signature + reviewer
email, and renders the seeded `thankyou` template via
`reviewer-reminder-email.js#renderThankYou`. The stored body carries a
`{{honorariumNote}}` token (branch `claude/reviewer-thankyou-honorarium-context`,
2026-09-03): the sweep projects `wmkf_honorariumoptout` and the token resolves to
the honorarium follow-up sentence unless that field is strictly `true` (reviewer
declined the honorarium at Stage 2a), in which case the line is omitted — `false`,
`null`, and pre-Stage-2a rows keep it, matching the acceptance drain's
"not opted out unless true" rule. The staff manual thank-you render
(`render-emails-service.js`) resolves the same token from the same field so it can
never reach a reviewer verbatim. The live Production template must be edited by
the owner to contain the token; the seeder skips existing values. It sends the email as the PD
(`createAndSendEmail`, `noFallback:true`) with a **courtesy DOCX copy of the
reviewer's own review** attached as real file bytes (`activitymimeattachments`,
never Blob-staged): `composeSingleReviewCopy` (pure, in
`shared/utils/review-report.js`, reusing the `htmlToBlocks` tokenizer) →
`renderIndividualReviewDocx` (template-backed OOXML renderer returning a Buffer,
in `lib/services/review-documents/docx-renderer.js`), over the answer snapshot read through
the hoisted `lib/services/review-answers.js#fetchAnswersBySuggestion` (shared with
the Reviews-tab GET). Per-row attachment generation happens before the If-Match
claim. A compose/render failure counts `attachmentFailed` and returns without a
marker or email, leaving the complete delivery retryable on the next sweep. The
`wmkf_thankyousentat` marker remains shared with the legacy `thankyou` branch
in `send-emails.js`, so compatibility callers cannot cause the sweep to
double-send. `ReviewerManagePanel` no longer exposes a manual thank-you
composer. Knobs: `?maxBatch=N`, `?dryRun=1`.

**Current source behavior; September 4 deployment-pending checkpoint superseded
by the Session 479 closeout release record above:** thank-you remains a prompt
receipt acknowledgement and retains the current claim-before-send/at-most-once
mechanics. No thank-you path sets Complete or eligibility. The manual
compatibility branch writes only `wmkf_thankyousentat`; the seeded default drops
the honorarium-processing token, and existing stored templates resolve that
legacy token to blank. That runtime release does not establish today’s stored
Dataverse default; any template change still requires a separately authorized
settings write. Existing `wmkf_thankyousentat` values are not
backfilled into either decision field.

**Phase 2 DEPLOYED (S326; unit-tested; populated Compare view NOT browser-verifiable until the first portal submission — zero exist, portal built ahead of the D26 cycle; correct zero-submission absence drive-verified):** schema-free
comparison matrix. `shared/utils/review-matrix.js#deriveReviewMatrix(reviewers,
liveQuestions)` is a pure, DOM/React/Dataverse-free derivation over each
reviewer's `answers[]` — union of question keys, ordered by the LIVE question
set (`review-question-fetcher.js#getActiveQuestionSet()`) with snapshot-only
keys appended after (flagged `retired: true`); per-question cells are
`'answered'|'empty'|'not-asked'` (no row at all = not-asked, distinct from a
blank answer); picklist questions get average/min/max/answeredCount computed
only across reviewers who answered that key (drift-safe). NO hardcoded
question keys and no read of `review-form-schema.js` or the legacy
`reviewerImpact`/`reviewerRisk`/`reviewerOverallRating` projections — labels
come from each row's own `answerText`. `reviewers.js` GET now also returns
`liveQuestions` (`{key, order, text, type}[]`) via a new `fetchLiveQuestions()`
wrapper; it fails SOFT (`liveQuestions: null`, logged) if the fetcher throws —
`getActiveQuestionSet()` itself fails closed for the reviewer-facing form, but
a workbench read of past submissions must not 500 on that basis. `ReviewsTab`
adds a "Cards"/"Compare" toggle above the submitted-reviews area ("Cards" is
the unchanged Phase-1 rendering, default); "Compare" renders a horizontally-
scrollable ratings grid (rows = picklist questions in live order, columns =
reviewers + Average + Spread, retired questions badged "Prior cycle") plus a
per-question narrative browser (richtext questions, all reviewers' `answerHtml`
stacked with attribution, rendered the same way the Cards view's
`NarrativeAnswers` does — already-sanitized server HTML). Duplicate
`questionKey` with differing snapshot text across reviewers: first-reviewer's
text wins (documented in the module header) when the key isn't live; live text
always wins when it is.

**Phase 3 + TEMPLATE-BACKED FORMAT PASS PRODUCTION-LIVE; SIGNED-IN EXPORT
PROVED (2026-09-03):** panel-prep roll-up/export.
`shared/utils/review-report.js#composeReviewReport(...)` is a
pure, DOM/React/Dataverse-free composition over a `deriveReviewMatrix` result
(consumed, not re-derived) plus proposal identity — header, summary
(reviews-submitted count + per-rating-question average/spread), a ratings
table (same rows/columns as the Compare grid), and per-richtext-question
narrative sections (all reviewers' answers, matrix order, `retired` flag
carried through). The same module's `htmlToBlocks(html)` is a small pure
tokenizer scoped to the sanitizer's allowlisted grammar ONLY
(`lib/external/sanitize-review-html.js` `ALLOWED_TAGS`: p, br, strong/b,
em/i, sub/sup, ul/ol/li, h2/h3, blockquote, a — no tables/images/spans/divs), producing
typed blocks with inline runs; an unknown/malformed tag degrades to plain text
(tag stripped, text kept) rather than throwing or dropping content.
`lib/services/review-documents/docx-renderer.js` now applies separate tracked
individual and aggregated templates over that shared semantic model. The
reviewer-facing first-page title is **Proposal Review** and the staff-facing
title is **Aggregated Proposal Reviews**; generated dates and package metadata
are rewritten at render time. Categorical options come from submitted snapshots;
legacy/malformed gaps are explicit, and independent ordered lists restart at one.

The current `ReviewsTab` exposes only "Export: Word (.docx)" once at least one
review is submitted. It calls guarded GET
`/api/review-manager/export-reviews?proposalId=<guid>`; the server authoritatively
rereads the request, submitted reviewer rows, answer snapshots, live questions,
and synthesis before returning private/no-store DOCX bytes. No browser-authored
report DTO, Dataverse roll-up column, or SharePoint retention is introduced.
The legacy generic DOCX and PDF renderers remain in source/tests but have no
Reviews-tab UI consumer. Staff currently convert the downloaded Word document
externally when they need PDF. A server-side canonical-DOCX → temporary
SharePoint drive item → Microsoft Graph `content?format=pdf` workflow is
`[PLANNED]`, not built; its permissions, temporary-file retention/cleanup, and
tenant conversion behavior must be verified before implementation. The format
pass uses Wave 25 `wmkf_questionoptions`, provisioned and read back exact in
Production on 2026-09-03. The compatible code is live on `main` at `3101f067`
in Ready deployment `dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`. Signed-in Request
`1002903` generated a valid 60,586-byte DOCX titled **Aggregated Proposal
Reviews**; focused route logs showed 2xx dependencies and the bounded error scan
was empty. The courtesy-email path was not transport-smoked. Full future
contract: `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.

**Individual-review SharePoint retention (Waves 1–4 Production-live; Wave 5
active for exact D26, 2026-09-03):** the separate dedicated
`/api/cron/file-review-docx` path can render a structured review through the
same individual builder, create-only upload it to request-level
`Reviews/Review-<request>-<sanitized reviewer name>.docx`, and
ETag-conditionally commit the existing suggestion folder/filename pointers.
There are no generated or suggestion-GUID intermediate folders in the current
target; existing legacy pointers remain recognized. It is not part of submission
or thank-you transport. Exact Production `REVIEW_DOCX_SHAREPOINT_WRITE=on` and
`REVIEW_DOCX_SHAREPOINT_CYCLE=D26` were activated in Ready activation-proof
deployment `dpl_E6VKW5Wi8zDTfU1ZRhNsbH9yg9oM` (history). **Current
(2026-10-29, D44, branch `claude/review-filing-by-board-date`):** the cycle pin
is retired; the hourly cron files every cycle whose calendar Board Meeting Date
is today or later (Pacific day). The guarded local
backfill produced a clean full-cycle D26 schema-v2 manifest with 23 eligible
rows plus one visible owner-confirmed test exclusion. The owner selected Request
`1002874` / Agnes Karasik for the one-file proof and separately approved its
exact manifest hash
`8cc5c7821fa515828a2426cde6e800de131a4ab826c240881a97001899e41711`.
Execution created one SharePoint DOCX and committed the exact suggestion
pointers. Independent download/readback matched the governed hash, and the
owner confirmed `Download: Review-1002874.docx` succeeds and looks correct.
Opening the retained item through akoyaGO/Word for the web exposed a tab-layout
defect that split the first-page title. The branch removes those tabs and
directly right-aligns both review-template titles; source tests and rendered
inspection passed. The owner authorized an
exact local repair that created and verified item
`01G4GVMSZZ25YPTP3RGFEK6LCT64W3JPX2` at
`Reviews/Review-1002874-Agnes Karasik.docx` and ETag-conditionally repointed
Dataverse. Independent readback matched the corrected semantic hash; the old
item was retained at that stage and later owner-deleted after the current file
was verified. Owner inspection showed v2 kept the
title together but Word Online pushed it below the floating logo. The v3
templates explicitly change that behind-text shape from `wrapTight` to
`wrapNone`. Exact content-repair manifest hash
`ab98b779b660c77719c317f73b8f1004b08a898f7159971d6f5c97f9bfb2295d`
then replaced the same stable item as SharePoint version `2.0`, retained and
verified version `1.0`, and independently matched v3 governed hash
`gdc1:E3KvF7rvlOaGoxps6DHihILCQlyDlSheguneB0F0ojw` without changing the
Dataverse pointer pair. Owner inspection still rejected the floating-logo
alignment, then supplied an edited header-only DOCX. The v4 templates preserve
that exact fixed two-column Times New Roman text header and remove the
first-page drawing/image relationships. Exact content-repair manifest hash
`18007d495f52ab7abb88c03e6d3099eadb953157e69051b0c4c96898881ef09e`
versioned the same item/name from `2.0` to `3.0`; independent readback matched
v4 governed hash `gdc1:fbIC8o5aWoe_rOjXNK6mAKR6kbNRQ_I6MU60R28Chi4` with
the Dataverse pointer pair unchanged. At the owner's explicit request, a second
guarded generation/upload advanced the same stable item to version `4.0` at
`2026-09-04T00:59:51Z`, retained versions `1.0`–`3.0`, and independently
reverified the same v4 hash with unchanged pointers. The owner visually confirmed
version `4.0` in Word Online and approved the v4 header on 2026-09-03. The
reviewed runtime was then promoted at `3ba2a6ad` in Ready deployment
`dpl_22wUzC1cCi4nhKTSFQftfaycucSh`. Fresh v4 population manifest hash
`9254df9e5e504c79007391efc85d189e89e8b8b2ff80b8e4f11990baca08f4f8` contains
22 eligible missing files at unique destinations plus the same visible test
exclusion, zero blockers, and no completed Request `1002874` candidate. Exact
comparison found no added or removed suggestion IDs versus the prior survey.
The exact owner-approved manifest then completed 22 created / zero failed, and
row-by-row reconciliation matched every reviewed identity, destination,
semantic hash, and unique SharePoint item. Fresh post-write manifest
`f17eae89d00bf1c85301ae7a0b7ad6f3de37ff394030fbb0d66de793d10b1b64`
has zero eligible missing files, zero reconcile candidates, zero blockers, and
only the Request `1003223` test exclusion. The first authenticated enabled
sweep returned HTTP 200, resolved exact D26, and attempted no filing because
that known test row was classified `invalid_snapshot`. Bounded Production logs
showed no Graph mutation, Dataverse PATCH, or runtime error. The scheduled route
is active, and Production maintenance run `70820` subsequently proved its
natural create/pointer path: Manuel Müller's newly received Request `1002959`
review produced `Reviews/Review-1002959-Manuel Müller.docx` at version `1.0`
(43,498 bytes), completed without error, and left the matching complete
Dataverse pointer. The test row is now out of that population through an
ETag-protected one-field `wmkf_selected=false` correction that preserved its
received-review history; the immediate enabled follow-up returned zero
candidates and zero attempts. The owner subsequently deleted Request `1002874`'s
obsolete `Reviewer_Uploads/Generated` tree; Graph returned 404 for the old path
and 200 for the current file, and Dataverse retained the current `Reviews`
pointer. Active
contract: `docs/REVIEW_DOCX_SHAREPOINT_RETENTION_PLAN.md`.

<!-- end-source-lines: 1355-1645 -->
