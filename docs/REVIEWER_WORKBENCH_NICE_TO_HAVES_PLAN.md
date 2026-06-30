# Reviewer Workbench Nice-to-Haves Plan

Planning only. No feature code, migrations, API routes, or schema files were created for this pass.

## Grounding

- [VERIFIED via `docs/agent-wiki/index.md:39-40`] The relevant retrieval hubs are Reviewer Identity and Reviewer Workbench & Lifecycle, followed by `docs/APPLICATION_STATE_ATLAS.md` and the two reviewer Dataverse Atlas pages.
- [VERIFIED via `docs/APPLICATION_STATE_ATLAS.md:40-42`] The active reviewer data model is `wmkf_potentialreviewers` for person-level reviewer data and `wmkf_appreviewersuggestion` for per-request lifecycle.
- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:7-11`] `wmkf_potentialreviewers` uses entity set `wmkf_potentialreviewerses` and adapter `lib/dataverse/adapters/potential-reviewer.js`.
- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:5-10`] `wmkf_appreviewersuggestion` uses entity set `wmkf_appreviewersuggestions` and adapter `lib/dataverse/adapters/reviewer-suggestion.js`.
- [VERIFIED via `docs/API_ROUTE_SECURITY_MATRIX.md:171-176`] Workbench candidate export, manual reviewer add, applicant enrichment, applicant promotion, and roster routes are already documented in the API security matrix.

## Recommended Capture-Timing Model

- [VERIFIED via `docs/agent-wiki/topics/reviewer-origination.md:194-199`] Reviewer search intentionally strips unverified honorifics/titles because the finder does not verify professional titles; persisted candidate labels should not fabricate credentials.
- [VERIFIED via `lib/services/discovery-service.js:890-916`] The identity spine can pin a current affiliation/institution string for reviewer identity and COI work, but it does not produce a clean title + institution + department tuple.
- [VERIFIED via `pages/api/reviewer-finder/save-candidates.js:190-216`] Candidate save is designed around contactability, identity gating, affiliation persistence, ORCID/Scholar metrics, and expertise; title is not part of the candidate-save contract.
- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:70-77`] Reviewer acceptance already has engagement-scope contact-correction fields, including `wmkf_reviewertitle`, `wmkf_revieweraffiliation`, `wmkf_revieweremail`, and `wmkf_reviewerorcid`.
- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewanswer.md:34-44`] Review feedback/ratings are not candidate-stage data; completed-review answers and ratings live in review answer snapshots and lifecycle timestamps after review submission/staff receipt.

**Planning Principle**

- [PLANNED] Treat the candidate/invite stage as "can we identify, contact, and safely invite this person?"
- [PLANNED] Treat the acceptance stage as "what reviewer-confirmed identity details should later writeups use?"
- [PLANNED] Treat the post-review stage as "what did this reviewer actually submit, and what should staff remember for future cycles?"

## 1. Export Candidate Reviewer List To Excel From Workbench Reviewers / Invite Reviewers

**Current State**

- [VERIFIED via `shared/components/reviewers/ReviewersTab.js:40-43`] The Workbench Reviewers surface has `Find`, `Invite Reviewers`, and `Track Reviewers` sub-tabs.
- [VERIFIED via `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md:91-92`] An Excel export already exists for selected Find-tab candidates.
- [VERIFIED via `shared/components/reviewers/ReviewerSearchSection.js:1165-1204`] The Find tab exports selected, selectable candidates by posting a slim candidate DTO to `/api/workbench/export-candidates`.
- [VERIFIED via `pages/api/workbench/export-candidates.js:1-14`] The export route builds an `.xlsx` workbook, reads request metadata server-side, and writes no Dataverse data.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] The current workbook candidate sheet has one `Affiliation` column and no separate title, department, institution, flag, notes, tags, or review-history columns.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:1-20`] The Invite Reviewers tab already receives persisted saved-candidate rows, but it does not currently expose an export control.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:271-307`] The Invite Reviewers candidate card already surfaces the fields that matter most before invitation: name, affiliation, email, metrics, rationale, and expertise keywords.

**What's Missing**

- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:351-372`] Invite Reviewers has invitation and release actions but no Excel export action.
- [ASSUMED] The candidate export does not need writeup-quality title/department/review-history fields if Justin/Connor adopt the capture-timing model above.

**Proposed Approach**

- [PLANNED] Reuse the existing `/api/workbench/export-candidates` route and `buildReviewerCandidateWorkbook` service for a first increment.
- [PLANNED] Add an Invite Reviewers export button that maps the persisted `candidates` prop into the same slim DTO shape used by the Find tab.
- [PLANNED] Keep the candidate export focused on invite-stage decisions: reviewer name, affiliation/institution evidence, email/contact status, why selected, potential conflicts, expertise, and provenance.
- [PLANNED] Do not add professional title, departmental affiliation, global flags, or review-history columns to the candidate export unless staff explicitly need those fields before invitation.
- [PLANNED] If staff want a richer report later, create a separate accepted-reviewer or completed-review export instead of overloading the candidate-list workbook.

**Where It Plugs In**

- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:72-80`] UI plug-in point: `ReviewerInvitePanel`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-246`] Data source: `GET /api/reviewer-finder/my-candidates` candidate DTO.
- [VERIFIED via `pages/api/workbench/export-candidates.js:58-86`] Export route: `/api/workbench/export-candidates`.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:102-158`] Workbook formatter: `buildReviewerCandidateWorkbook`.

**Rough Effort**

S for Invite Reviewers export using existing candidate-stage columns; M if paired with a separate accepted-reviewer or completed-review workbook.

**Open Decisions For Justin/Connor**

- [ASSUMED] Staff probably expect "candidate reviewer list" to mean the saved Invite Reviewers list, not just the live Find search results; confirm export scope.
- [ASSUMED] Decide whether the export should include removed candidates, accepted candidates, released/no-response candidates, and applicant-suggested provenance.
- [ASSUMED] Decide whether candidate export is only for pre-invite planning, or whether a later accepted/completed-review export is also needed.

## 2. Academic Title Of Reviewer + Department

**Current State**

- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:21-26`] `wmkf_potentialreviewers` has `wmkf_title` and name fields.
- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:42`] `wmkf_potentialreviewers` also carries `wmkf_department` after the bibliometric sidecar collapse.
- [VERIFIED via `lib/dataverse/schema/wave6/02_wmkf_potentialreviewers_bibliometric.json:14-20`] `wmkf_department` is a 255-character string for the reviewer's department within their institution.
- [VERIFIED via `lib/dataverse/adapters/researcher.js:20-40`] The researcher adapter reads `wmkf_department` and `wmkf_keywords` from the person row.
- [VERIFIED via `lib/dataverse/adapters/researcher.js:100-138`] The researcher adapter can write `department` to `wmkf_department` during bibliometric writeback.
- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:14-27`] The normal potential-reviewer adapter select does not include `wmkf_title` or `wmkf_department`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:332-346`] The saved-candidate DTO person hydration selects `wmkf_name`, `wmkf_emailaddress`, `wmkf_organizationname`, and `wmkf_areaofexpertise`, not `wmkf_title`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:371-385`] The saved-candidate bibliometric hydration selects `wmkf_primaryaffiliation`, profile links, metrics, and `wmkf_keywords`, not `wmkf_department`.
- [VERIFIED via `pages/api/external/review/[token]/context.js:301-320`] After invitation, the reviewer contact prefill can use engagement-scope `wmkf_reviewertitle`, person-level `wmkf_title`, or contact `jobtitle`.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:979-987`] Reviewer self-confirmed title is written to engagement-scope `wmkf_reviewertitle`, not directly to the global person title.
- [VERIFIED via `docs/agent-wiki/topics/reviewer-origination.md:194-199`] Candidate search intentionally avoids persisting unverified professional titles.
- [VERIFIED via `lib/services/orcid-service.js:265-309`] ORCID employment parsing can see `department` and `role`, but the current convenience output used downstream is `currentAffiliation` organization, not a persisted title/department pair.

**What's Missing**

- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:271-307`] Invite Reviewers displays name, affiliation, email, metrics, rationale, and expertise keywords, but not title or department as distinct fields.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1413-1417`] Track Reviewers displays reviewer name, affiliation, and email, but not title or department.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] The export workbook has no title or department column.
- [VERIFIED via `pages/api/reviewer-finder/save-candidates.js:356-360`] The save path can persist `department` only if `candidate.department` or `contactEnrichment.department` exists.
- [ASSUMED] Candidate-stage `wmkf_title` and `wmkf_department` should remain incomplete unless staff add manual review before invitation or enrichment starts assigning `contactEnrichment.department`.

**Proposed Approach**

- [PLANNED] Do not treat title/department as candidate-list requirements.
- [PLANNED] Make the acceptance flow the trusted capture point for title and affiliation used by writeups, because the reviewer is present and can confirm/correct them.
- [PLANNED] For title, continue to prefer engagement-scope `wmkf_reviewertitle` after acceptance; writeup/read surfaces should use that before person-level `wmkf_title` or contact `jobtitle`.
- [PLANNED] For department, decide whether Stage 2a needs a new engagement-scope field such as reviewer department, or whether department can remain embedded in the free-form `wmkf_revieweraffiliation` string.
- [PLANNED] If writeups need a clean title + department + institution tuple, capture those as separate acceptance-stage fields instead of trying to infer them from candidate-search affiliation text.

**Where It Plugs In**

- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:54-64`] Engagement-scope reviewer identity fields are selected on `wmkf_appreviewersuggestion`.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:979-987`] Stage 2a contact edits already map `title` and `affiliation` into engagement-scope fields.
- [VERIFIED via `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md:145-146`] Stage 2a's planned prefill precedence is engagement title/affiliation first, then person/contact fallbacks.
- [VERIFIED via `lib/services/sync-reviewer-name-title-to-contact.js:51`] Accepted reviewer title can also feed contact `jobtitle` sync after acceptance.

**Rough Effort**

S if writeups only need existing accepted-reviewer title + affiliation; M if adding a separate accepted-reviewer department field; L if also syncing/normalizing department into CRM contact/account structures.

**Open Decisions For Justin/Connor**

- [ASSUMED] Decide whether writeups need department as a separate structured field or whether the reviewer-confirmed affiliation line is enough.
- [ASSUMED] Decide whether Stage 2a should label the field as "Title" and "Institution/department" or split it into title, department, and institution.
- [ASSUMED] Decide whether accepted-reviewer title/department should remain engagement-scoped, promote to `wmkf_potentialreviewers`, sync to `contact`, or use a priority order by consumer.

## 3. Institutional Affiliation In A Separate Column

**Current State**

- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:27-42`] Person-level affiliation fields include `wmkf_organizationname` and canonical `wmkf_primaryaffiliation`.
- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:223-236`] `upsertByEmail` writes affiliation to both canonical `wmkf_primaryaffiliation` and compatibility shadow `wmkf_organizationname`.
- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:259-283`] Person edits also write affiliation to both `wmkf_primaryaffiliation` and `wmkf_organizationname`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-204`] Invite Reviewers currently emits one `affiliation` value from `wmkf_primaryaffiliation` with fallback to `wmkf_organizationname`.
- [VERIFIED via `pages/api/review-manager/reviewers.js:208-213`] Track Reviewers emits the same single `affiliation` value from `wmkf_primaryaffiliation` with fallback to `wmkf_organizationname`.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-81`] The workbook currently has one `Affiliation` column.
- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:67-77`] After acceptance, `wmkf_revieweraffiliation` is the engagement-scope reviewer affiliation field and remains the review-context affiliation prefill source.

**What's Missing**

- [VERIFIED via `lib/dataverse/schema/wave6/02_wmkf_potentialreviewers_bibliometric.json:7-20`] Existing schema separates `wmkf_primaryaffiliation` and `wmkf_department`, but does not define a dedicated institution-only field.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-204`] Candidate-stage DTOs have only one `affiliation` value, so candidate export cannot honestly split institution and department without either derivation or new capture.
- [ASSUMED] If staff want writeup-quality institution separate from department, acceptance is the better capture moment than reviewer search.

**Proposed Approach**

- [PLANNED] Candidate stage: keep one affiliation/institution-evidence column for identity and COI review.
- [PLANNED] Acceptance stage: if writeups need a clean institution column, add or relabel accepted-reviewer capture so the reviewer confirms institution separately from title/department.
- [PLANNED] Avoid parsing candidate affiliation into department/institution for official writeups unless the parsed value is clearly marked derived and staff accept the risk.
- [PLANNED] Prefer engagement-scope accepted-reviewer affiliation for request-specific writeups, because it represents the reviewer's affiliation at review time.

**Where It Plugs In**

- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-204`] Saved-candidate DTO currently has only `affiliation`.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:271`] Invite Reviewers currently renders that single affiliation line.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:129-145`] Workbook row construction currently writes that single affiliation value.
- [VERIFIED via `shared/components/workbench/ReviewsTab.js:51-60`] Completed-review UI already prefers reviewer engagement affiliation over candidate/person affiliation when rendering review cards.

**Rough Effort**

S if writeups can use existing `wmkf_revieweraffiliation`; M if Stage 2a splits institution from department; L if normalized institution requires account matching or CRM account writes.

**Open Decisions For Justin/Connor**

- [ASSUMED] Decide whether official writeups need institution-only, full affiliation, or both.
- [ASSUMED] Decide whether accepted-reviewer affiliation should stay engagement-scoped or be promoted/synced into person/contact records after acceptance.
- [ASSUMED] Decide whether account matching is worth the risk/cost; prior reviewer/contact work treated affiliation mismatch as alert-only rather than auto-linking.

## 4. Positive / Negative Flag And Searchable Notes After Reviewer Is Added

**Current State**

- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:24-32`] `wmkf_appreviewersuggestion` has `wmkf_notes`, but it is on the per-request junction.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:15-40`] The suggestion adapter selects `wmkf_notes`.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:870-893`] `updateLifecycle` maps `notes` to `wmkf_notes`.
- [VERIFIED via `pages/api/review-manager/reviewers.js:208-218`] Track Reviewers reads `notes` from `wmkf_notes`.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1180-1195`] Track Reviewers can save notes through `PATCH /api/review-manager/reviewers`.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1390-1464`] Track Reviewers renders editable notes in its table.
- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:21-42`] The documented person fields do not include a reviewer-level positive/negative flag or reviewer-level staff notes field.
- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:14-27`] The normal person adapter select does not include any flag or person-note field.

**What's Missing**

- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:45-47`] Existing `wmkf_notes` is request-scoped, so it does not follow the reviewer as a global person-level note.
- [ASSUMED] A positive/negative reviewer flag is intended to be global reviewer history, not just a note for one proposal.
- [ASSUMED] A searchable Notes field likely requires either Dataverse searchable columns/views or an application-level search endpoint; no existing Workbench route provides person-note search today.

**Proposed Approach**

- [PLANNED] Do not make global reviewer flag/notes a candidate-export requirement.
- [PLANNED] Keep `wmkf_appreviewersuggestion.wmkf_notes` for request-specific Track Reviewers notes during the active review cycle.
- [PLANNED] If staff want durable positive/negative reviewer memory for future selection, capture it after meaningful interaction: accepted, declined, completed, or staff-reviewed outcome.
- [PLANNED] Add new person-level Dataverse columns on `wmkf_potentialreviewers` only if the desired semantics are global across cycles: one flag field and one notes field.
- [PLANNED] Add search/filter support only after deciding whether search should be Dataverse-side, client-side over loaded rows, or a dedicated reviewer pool endpoint.

**Where It Plugs In**

- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:259-300`] Existing person-level PATCH adapter pattern can update a subset of person fields.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:539-590`] Saved-candidate edit already updates linked person/researcher fields after resolving the suggestion's person id.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:335-343`] Invite Reviewers already has an edit affordance where a person-level flag/notes editor could be linked.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1452-1464`] Track Reviewers already has request-note editing, which should remain distinct from global reviewer notes.

**Rough Effort**

M if using two new person columns and simple filters; L if adding full-text search, audit history, or reusable reviewer-pool browsing. Candidate export remains S/no-op if this is deferred to post-interaction reviewer memory.

**Open Decisions For Justin/Connor**

- [ASSUMED] Decide whether the flag is global to the reviewer or scoped to one request/cycle.
- [ASSUMED] Decide flag shape: positive/negative only, neutral/none, severity, reason code, or multiple flags.
- [ASSUMED] Decide whether notes are searchable by all staff and whether Dataverse auditing should be enabled for changes.
- [ASSUMED] Decide which workflow moment creates the flag: after acceptance, after review completion, during staff closeout, or manually at any time.

## 5. Expertise Keywords / Tags

**Current State**

- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:27-42`] Existing person-level expertise fields include `wmkf_areaofexpertise` and `wmkf_keywords`.
- [VERIFIED via `lib/dataverse/schema/wave6/02_wmkf_potentialreviewers_bibliometric.json:83-89`] `wmkf_keywords` is a Memo field with max length 50000.
- [VERIFIED via `lib/dataverse/adapters/researcher.js:20-40`] The researcher adapter reads `wmkf_keywords`.
- [VERIFIED via `lib/dataverse/adapters/researcher.js:170-186`] The researcher adapter update map can write `keywords` to `wmkf_keywords`.
- [VERIFIED via `pages/api/reviewer-finder/save-candidates.js:213-216`] Save-candidates derives `expertiseForDv` from `candidate.expertiseAreas` or `candidate.expertise`.
- [VERIFIED via `pages/api/reviewer-finder/save-candidates.js:285-292`] Save-candidates writes `expertiseForDv` to person-level `wmkf_areaofexpertise`.
- [VERIFIED via `pages/api/reviewer-finder/save-candidates.js:339-360`] Save-candidates writes the same expertise string to `wmkf_keywords`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:214-219`] Saved candidates emit `keywords` from `wmkf_keywords`.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:304-307`] Invite Reviewers already displays `keywords` as "Expertise" when present.

**What's Missing**

- [VERIFIED via `shared/components/reviewers/CandidateEditModal.js:1-17`] The saved-candidate edit modal covers name, affiliation, email, website, and h-index, not expertise tags.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] The export workbook does not currently include expertise keywords.
- [ASSUMED] Current `wmkf_keywords` is free text, not a controlled tag model.

**Proposed Approach**

- [PLANNED] Free-tag increment: reuse `wmkf_keywords` as a semicolon/comma-delimited editable tag field and add it to the edit modal, DTOs, search/filter UI, and export.
- [PLANNED] Controlled-taxonomy increment: create a tag vocabulary and reviewer-tag junction only if Justin/Connor need normalized cross-reviewer reporting.
- [PLANNED] Keep `wmkf_areaofexpertise` as a compatibility/display field unless a later schema decision deprecates it.

**Where It Plugs In**

- [VERIFIED via `lib/dataverse/adapters/researcher.js:170-207`] Person bibliometric update support can already write `keywords`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:539-575`] `my-candidates` PATCH already has a person/researcher edit section where `keywords` could be added.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:304-307`] Invite Reviewers already has a display location.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] Workbook columns would need an `Expertise tags` column.

**Rough Effort**

S-M for free tags; L for controlled taxonomy or multi-select reporting.

**Open Decisions For Justin/Connor**

- [ASSUMED] Decide free tags versus controlled list.
- [ASSUMED] Decide whether tags should be staff-editable only or also generated/refreshed by enrichment.
- [ASSUMED] Decide whether search should match `wmkf_keywords`, `wmkf_areaofexpertise`, or both.

## 6. Review History: How Often And Last Completed Review

**Current State**

- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:36-43`] The suggestion junction stores outreach and review lifecycle timestamps, including `wmkf_reviewreceivedat` and `wmkf_completedat`.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:15-40`] The adapter selects `wmkf_reviewreceivedat`.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:85-90`] The adapter selects `wmkf_completedat`.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:870-893`] The adapter can write `reviewReceivedAt` and `completedAt` through `updateLifecycle`.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:930-936`] When review status transitions to complete, the adapter stamps `wmkf_completedat` and, if empty, `wmkf_reviewreceivedat`.
- [VERIFIED via `pages/api/review-manager/reviewers.js:208-245`] Track Reviewers returns per-request lifecycle values including `reviewReceivedAt`, but only for reviewers in the current response scope.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1397-1429`] Track Reviewers displays a per-row last action based on lifecycle timestamps.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:287-302`] A merge-support helper can query all suggestions for one potential reviewer, proving the junction can be queried by `_wmkf_potentialreviewer_value`.

**What's Missing**

- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-246`] Saved candidate rows do not include aggregate review counts or last completed/submitted review date.
- [VERIFIED via `pages/api/review-manager/reviewers.js:208-245`] Track reviewer rows do not include cross-request aggregate history.
- [ASSUMED] "Completed a review" needs a business definition: reviewer submitted a review (`wmkf_reviewreceivedat`) versus PD closed it out (`wmkf_completedat` / `reviewStatus=complete`).

**Proposed Approach**

- [PLANNED] Derive review history from `wmkf_appreviewersuggestion` rather than adding storage for the first version.
- [PLANNED] Add a read helper that queries suggestions by potential reviewer id and computes count plus last date.
- [PLANNED] Decide whether count means accepted, review submitted, or PD completed; expose the label accordingly.
- [PLANNED] Keep review history out of candidate capture; it is derived after review lifecycle events exist.
- [PLANNED] Add aggregate fields to `my-candidates` only if staff need prior-review history while deciding whom to invite; otherwise prefer Track Reviewers, completed-review views, or a reviewer-pool surface.
- [PLANNED] Consider caching only if the cross-reviewer query volume is too high for a request with many candidates.

**Where It Plugs In**

- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:630-649`] Existing request-scoped reads use the suggestion adapter.
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:287-302`] Existing reviewer-scoped query shape can be adapted into a history-specific read helper.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:127-136`] `my-candidates` already batches person/researcher hydration; history aggregation could be added in the same server-side DTO build.
- [VERIFIED via `pages/api/review-manager/reviewers.js:169-173`] `reviewers` already batches person/researcher hydration; history aggregation could be added there too.

**Rough Effort**

M for derived counts and last-date display; L if staff need drill-down history rows, filtering by cycle/program, or export of every prior engagement.

**Open Decisions For Justin/Connor**

- [ASSUMED] Choose the definition of "completed a review": reviewer-submitted, PD-completed, or both as separate metrics.
- [ASSUMED] Decide whether declined/no-response invitations count anywhere in history.
- [ASSUMED] Decide whether the UI should show only a summary or a drill-down list of prior requests.
- [ASSUMED] Decide whether prior-review history is useful before invitation, or whether it belongs only in completed-review/reviewer-pool reporting.

## Suggested Sequencing

**Quick Wins**

1. [PLANNED] Add an Invite Reviewers export button reusing the current workbook path.
2. [PLANNED] Keep candidate export columns scoped to invite-stage fields: contact, affiliation/COI evidence, rationale, provenance, metrics, and expertise.
3. [PLANNED] Add existing `wmkf_keywords` to the workbook as an `Expertise tags` column if staff want that in the candidate export.
4. [PLANNED] Document for staff that title/department become reliable after reviewer acceptance, not during reviewer search.

**Acceptance-Stage Work**

1. [PLANNED] Audit Stage 2a copy/UI to ensure reviewers are clearly asked for writeup-quality title and affiliation.
2. [PLANNED] Decide whether to split accepted-reviewer affiliation into title, department, and institution fields; add a new engagement-scoped department/institution column only if needed.
3. [PLANNED] Make downstream writeup/export readers prefer engagement-scope accepted-reviewer identity fields over candidate-stage affiliation.

**Post-Review / Reviewer-Memory Work**

1. [PLANNED] Add review-history aggregation from `wmkf_appreviewersuggestion`.
2. [PLANNED] Add optional review-history workbook/report columns after defining "completed review."
3. [PLANNED] Add global reviewer flag/notes only after deciding the closeout moment, scope, and search behavior.
4. [PLANNED] Add controlled expertise-tag tables only if free tags in `wmkf_keywords` are insufficient.

## Contract-Reconcile Notes

- [VERIFIED via source files cited above] Caller to persistence to consumer path for the proposed no-schema work is: `ReviewerInvitePanel` or `ReviewerSearchSection` -> existing Workbench/reviewer APIs -> `wmkf_potentialreviewers` / `wmkf_appreviewersuggestion` reads -> DTO -> card/table/export render.
- [PLANNED] Revised caller to persistence to consumer path for trusted title/affiliation is: external reviewer Stage 2a acceptance/edit -> `wmkf_appreviewersuggestion` engagement fields -> review/writeup readers prefer engagement fields.
- [PLANNED] Revised caller to persistence to consumer path for review feedback/history is: external reviewer submit or staff received/no-file/upload -> `wmkf_appreviewanswer` and `wmkf_appreviewersuggestion` lifecycle fields -> completed-review/reviewer-history readers.
- [PLANNED] Any implementation that adds new Dataverse columns must update schema-as-code, Atlas pages, API route security matrix if routes change, adapters/select lists, DTO projections, UI consumers, tests, and the relevant gates.
- [PLANNED] Any implementation that adds a new persisted field must grep the raw logical field name and update every read projection, not only one adapter map.
- [ASSUMED] No live Dataverse metadata probe was run for this planning doc; field existence claims are grounded in current source and Atlas/schema files, some of which cite prior live probes.
