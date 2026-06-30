# Reviewer Workbench Nice-to-Haves Plan

Planning only. No feature code, migrations, API routes, or schema files were created for this pass.

## Grounding

- [VERIFIED via `docs/agent-wiki/index.md:39-40`] The relevant retrieval hubs are Reviewer Identity and Reviewer Workbench & Lifecycle, followed by `docs/APPLICATION_STATE_ATLAS.md` and the two reviewer Dataverse Atlas pages.
- [VERIFIED via `docs/APPLICATION_STATE_ATLAS.md:40-42`] The active reviewer data model is `wmkf_potentialreviewers` for person-level reviewer data and `wmkf_appreviewersuggestion` for per-request lifecycle.
- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:7-11`] `wmkf_potentialreviewers` uses entity set `wmkf_potentialreviewerses` and adapter `lib/dataverse/adapters/potential-reviewer.js`.
- [VERIFIED via `docs/atlas/dataverse-wmkf-appreviewersuggestion.md:5-10`] `wmkf_appreviewersuggestion` uses entity set `wmkf_appreviewersuggestions` and adapter `lib/dataverse/adapters/reviewer-suggestion.js`.
- [VERIFIED via `docs/API_ROUTE_SECURITY_MATRIX.md:171-176`] Workbench candidate export, manual reviewer add, applicant enrichment, applicant promotion, and roster routes are already documented in the API security matrix.

## 1. Export Candidate Reviewer List To Excel From Workbench Reviewers / Invite Reviewers

**Current State**

- [VERIFIED via `shared/components/reviewers/ReviewersTab.js:40-43`] The Workbench Reviewers surface has `Find`, `Invite Reviewers`, and `Track Reviewers` sub-tabs.
- [VERIFIED via `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md:91-92`] An Excel export already exists for selected Find-tab candidates.
- [VERIFIED via `shared/components/reviewers/ReviewerSearchSection.js:1165-1204`] The Find tab exports selected, selectable candidates by posting a slim candidate DTO to `/api/workbench/export-candidates`.
- [VERIFIED via `pages/api/workbench/export-candidates.js:1-14`] The export route builds an `.xlsx` workbook, reads request metadata server-side, and writes no Dataverse data.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] The current workbook candidate sheet has one `Affiliation` column and no separate title, department, institution, flag, notes, tags, or review-history columns.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:1-20`] The Invite Reviewers tab already receives persisted saved-candidate rows, but it does not currently expose an export control.

**What's Missing**

- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:351-372`] Invite Reviewers has invitation and release actions but no Excel export action.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] The existing workbook shape would need columns added if this wishlist is meant to export title, department, institution, flags, notes, expertise tags, or review-history data.

**Proposed Approach**

- [PLANNED] Reuse the existing `/api/workbench/export-candidates` route and `buildReviewerCandidateWorkbook` service for a first increment.
- [PLANNED] Add an Invite Reviewers export button that maps the persisted `candidates` prop into the same slim DTO shape used by the Find tab.
- [PLANNED] Decide whether Invite Reviewers export should include all saved candidates, only checkbox-selected candidates, only not-yet-invited candidates, or a filtered set such as "invitable only."
- [PLANNED] If exporting persisted CRM fields beyond the current candidate DTO, hydrate them through `my-candidates` first instead of trusting ad hoc client-only values.

**Where It Plugs In**

- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:72-80`] UI plug-in point: `ReviewerInvitePanel`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-246`] Data source: `GET /api/reviewer-finder/my-candidates` candidate DTO.
- [VERIFIED via `pages/api/workbench/export-candidates.js:58-86`] Export route: `/api/workbench/export-candidates`.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:102-158`] Workbook formatter: `buildReviewerCandidateWorkbook`.

**Rough Effort**

S for Invite Reviewers export using existing columns; M if combined with the new columns below.

**Open Decisions For Justin/Connor**

- [ASSUMED] Staff probably expect "candidate reviewer list" to mean the saved Invite Reviewers list, not just the live Find search results; confirm export scope.
- [ASSUMED] Decide whether the export should include removed candidates, accepted candidates, released/no-response candidates, and applicant-suggested provenance.
- [ASSUMED] Decide whether the workbook should preserve the current two-sheet shape or add a richer third "Review History" sheet.

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

**What's Missing**

- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:271-307`] Invite Reviewers displays name, affiliation, email, metrics, rationale, and expertise keywords, but not title or department as distinct fields.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1413-1417`] Track Reviewers displays reviewer name, affiliation, and email, but not title or department.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] The export workbook has no title or department column.
- [ASSUMED] `wmkf_title` population may be sparse for pre-invite candidate rows because the current save-candidates path writes name/email/affiliation/expertise but not title.

**Proposed Approach**

- [PLANNED] Add `wmkf_title` to saved-candidate and Track reviewer person hydration where candidate DTOs are built.
- [PLANNED] Add `wmkf_department` to bibliometric hydration in `my-candidates` and `reviewers`.
- [PLANNED] Surface title and department as separate DTO fields, then render a compact line such as title + department when present.
- [PLANNED] Extend the workbook columns to include `Academic title` and `Department`.
- [PLANNED] Treat engagement-scope `wmkf_reviewertitle` as a Track Reviewers fallback only after the reviewer has self-confirmed; do not use it as evidence for pre-invite candidates unless that row has already accepted.

**Where It Plugs In**

- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-246`] Invite Reviewers DTO projection.
- [VERIFIED via `pages/api/review-manager/reviewers.js:208-245`] Track Reviewers DTO projection.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:225-345`] Invite Reviewers card rendering.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1397-1464`] Track Reviewers table rendering.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-90`] Workbook column definition.

**Rough Effort**

S-M. The field plumbing is small, but data quality and source precedence need explicit decisions.

**Open Decisions For Justin/Connor**

- [ASSUMED] Confirm whether "academic title" means person-level `wmkf_title`, reviewer-self-confirmed engagement `wmkf_reviewertitle`, contact `jobtitle`, or a priority order by workflow stage.
- [ASSUMED] Decide whether blank titles/departments are acceptable or whether staff should get an edit control to populate them.
- [ASSUMED] Decide whether title/department should appear in the on-screen Invite Reviewers cards, the Excel export, Track Reviewers, or all three.

## 3. Institutional Affiliation In A Separate Column

**Current State**

- [VERIFIED via `docs/atlas/dataverse-wmkf-potentialreviewers.md:27-42`] Person-level affiliation fields include `wmkf_organizationname` and canonical `wmkf_primaryaffiliation`.
- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:223-236`] `upsertByEmail` writes affiliation to both canonical `wmkf_primaryaffiliation` and compatibility shadow `wmkf_organizationname`.
- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:259-283`] Person edits also write affiliation to both `wmkf_primaryaffiliation` and `wmkf_organizationname`.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-204`] Invite Reviewers currently emits one `affiliation` value from `wmkf_primaryaffiliation` with fallback to `wmkf_organizationname`.
- [VERIFIED via `pages/api/review-manager/reviewers.js:208-213`] Track Reviewers emits the same single `affiliation` value from `wmkf_primaryaffiliation` with fallback to `wmkf_organizationname`.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:78-81`] The workbook currently has one `Affiliation` column.

**What's Missing**

- [VERIFIED via `lib/dataverse/schema/wave6/02_wmkf_potentialreviewers_bibliometric.json:7-20`] Existing schema separates `wmkf_primaryaffiliation` and `wmkf_department`, but does not define a dedicated institution-only field.
- [ASSUMED] If staff want "Institution" to mean a normalized organization name such as "University of Washington" separate from a full affiliation string, the current model does not have a clean dedicated field for that.

**Proposed Approach**

- [PLANNED] Quick version: add separate export columns for `Department` and `Institutional affiliation`, using existing `wmkf_department` and the current `affiliation` DTO value.
- [PLANNED] Richer version: add a display-only parser that tries to split institution from full affiliation, but label it as derived/approximate unless staff accept that risk.
- [PLANNED] Schema version: add a new person-level Dataverse field only if Justin/Connor want a curated institution-only value that staff can edit and search reliably.

**Where It Plugs In**

- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:199-204`] Saved-candidate DTO currently has only `affiliation`.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:271`] Invite Reviewers currently renders that single affiliation line.
- [VERIFIED via `lib/services/reviewer-candidate-export.js:129-145`] Workbook row construction currently writes that single affiliation value.

**Rough Effort**

S if the separate column reuses the existing affiliation string; M-L if the institution must be normalized or staff-editable as its own Dataverse column.

**Open Decisions For Justin/Connor**

- [ASSUMED] Decide whether "institutional affiliation" can be the existing full affiliation string or must be institution-only.
- [ASSUMED] Decide whether deriving institution from free text is acceptable, or whether this deserves a new curated Dataverse column.
- [ASSUMED] Decide whether the source of truth should remain `wmkf_primaryaffiliation`, move to a new person field, or eventually link to `account`.

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

- [PLANNED] Add new person-level Dataverse columns on `wmkf_potentialreviewers` if the desired semantics are global: one flag field and one notes field.
- [PLANNED] Keep `wmkf_appreviewersuggestion.wmkf_notes` for request-specific Track Reviewers notes.
- [PLANNED] Add person flag/notes to potential-reviewer hydration, Invite Reviewers/Track DTOs, and any future reviewer-pool/search surface.
- [PLANNED] Add write support through a small reviewer-person update route or an extension of an existing reviewer-person PATCH path, with GUID validation and `requireAppAccess('reviewers')`.
- [PLANNED] Add search/filter support only after deciding whether search should be Dataverse-side, client-side over loaded rows, or a dedicated reviewer pool endpoint.

**Where It Plugs In**

- [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:259-300`] Existing person-level PATCH adapter pattern can update a subset of person fields.
- [VERIFIED via `pages/api/reviewer-finder/my-candidates.js:539-590`] Saved-candidate edit already updates linked person/researcher fields after resolving the suggestion's person id.
- [VERIFIED via `shared/components/reviewers/ReviewerInvitePanel.js:335-343`] Invite Reviewers already has an edit affordance where a person-level flag/notes editor could be linked.
- [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1452-1464`] Track Reviewers already has request-note editing, which should remain distinct from global reviewer notes.

**Rough Effort**

M if using two new person columns and simple filters; L if adding full-text search, audit history, or reusable reviewer-pool browsing.

**Open Decisions For Justin/Connor**

- [ASSUMED] Decide whether the flag is global to the reviewer or scoped to one request/cycle.
- [ASSUMED] Decide flag shape: positive/negative only, neutral/none, severity, reason code, or multiple flags.
- [ASSUMED] Decide whether notes are searchable by all staff and whether Dataverse auditing should be enabled for changes.
- [ASSUMED] Decide whether this is appropriate on `wmkf_potentialreviewers` or should wait for/contact-sync into CRM `contact`.

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
- [PLANNED] Add aggregate fields to `my-candidates` and/or `reviewers` DTOs so Invite Reviewers and Track Reviewers can display "Reviewed N times; last review DATE."
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
- [ASSUMED] Decide whether history should be visible in Invite Reviewers before sending, Track Reviewers after acceptance, Excel export, or a future reviewer-pool surface.

## Suggested Sequencing

**Quick Wins**

1. [PLANNED] Add an Invite Reviewers export button reusing the current workbook path.
2. [PLANNED] Add existing `wmkf_keywords` to the workbook as an `Expertise tags` column.
3. [PLANNED] Add existing title/department fields to DTO hydration and display when present.
4. [PLANNED] Add separate workbook columns for title, department, and affiliation using existing data.

**Schema-Touching Work**

1. [PLANNED] Add global reviewer flag and global searchable notes only after Justin/Connor decide scope, field types, and search behavior.
2. [PLANNED] Add a curated institution-only field only if the existing affiliation string is not acceptable.
3. [PLANNED] Add controlled expertise-tag tables only if free tags in `wmkf_keywords` are insufficient.

**Derived / Medium Work**

1. [PLANNED] Add review-history aggregation from `wmkf_appreviewersuggestion`.
2. [PLANNED] Add optional review-history workbook columns after defining "completed review."
3. [PLANNED] Add drill-down history only if staff need more than count and last date.

## Contract-Reconcile Notes

- [VERIFIED via source files cited above] Caller to persistence to consumer path for the proposed no-schema work is: `ReviewerInvitePanel` or `ReviewerSearchSection` -> existing Workbench/reviewer APIs -> `wmkf_potentialreviewers` / `wmkf_appreviewersuggestion` reads -> DTO -> card/table/export render.
- [PLANNED] Any implementation that adds new Dataverse columns must update schema-as-code, Atlas pages, API route security matrix if routes change, adapters/select lists, DTO projections, UI consumers, tests, and the relevant gates.
- [PLANNED] Any implementation that adds a new persisted field must grep the raw logical field name and update every read projection, not only one adapter map.
- [ASSUMED] No live Dataverse metadata probe was run for this planning doc; field existence claims are grounded in current source and Atlas/schema files, some of which cite prior live probes.
