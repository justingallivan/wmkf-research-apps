---
title: Final Writeup Review — Implementation Plan
domain: workbench
kind: plan
status: active
summary: "Final runtime, v2 staffing, and explicit persona dashboard lenses are Production-live; stage transitions and the Slice 6 dashboard filters/cycle scoping remain."
canonical: false
cataloged: 2026-08-28
last_verified: 2026-09-06
owner: product-engineering
related:
  - docs/audits/final-writeup-review-fable-review-2026-08-28.md
  - docs/audits/final-writeup-acknowledgement-wave23-adversarial-review-2026-08-31.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - outputs/final-writeup-review-2026-08-28/final-writeup-review-design-brief.md
---

> **Provenance.** Authored by Codex on branch `codex/staff-deliberations-history-ux`
> (2026-08-28) from the owner-approved design brief and HTML mockups in
> `outputs/final-writeup-review-2026-08-28/`, then revised to incorporate the
> accepted findings of the independent Claude Fable review recorded in
> `docs/audits/final-writeup-review-fable-review-2026-08-28.md`. Copied into the
> repository verbatim at branch closeout so it survives the untracked Codex
> session directory. **Original plan-authorship state:** no runtime, schema,
> route, or Atlas change existed yet. **Owner approval 2026-08-30:** proceed
> code-first after Slice 0 reconciliation, target a superuser-testable
> infrastructure path by 2026-09-04, open Word in its own browser window/tab or
> desktop Word when Microsoft permits, and include the full coordinator review
> matrix under the non-compliance semantics in this plan.

# Final Writeup Review — Implementation Plan

## Plan status

**Verdict: CORE FINAL REVIEW AND PERSONA DASHBOARD LENSES ARE PRODUCTION-LIVE;
LEADERSHIP-STAGE AND PC-BACKUP TRANSITIONS REMAIN STAGED WORK.**

This plan translates the approved Final Writeup and group-review experience into the current Request Workbench architecture. Slice 0 is complete. **[PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC]** Slice 1 shipped on `main` at `ebb147bb` in Ready Production deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ`; Wave 22 is 4 exact / 0 absent / 0 divergent and the non-sensitive `FINAL_WRITEUP_SCHEMA_READY` value is literal `on` in Production. The authorized Request `1002788` transition created one Ready/Review Final row, moved the retained current Pre-Site source to lifecycle Final, set the current-Final pointer, recorded Justin Gallivan and `2026-08-31T03:57:20Z`, and reused the exact same SharePoint drive/item, version `1.0`, 38,273-byte file, and governed hash. The distinct SharePoint-file count remained four, proving that no copy or upload occurred. A bounded 30-minute scan found no Production error logs or 5xx responses.

The 2026-09-04 milestone delivered the underlying handoff, identity,
acknowledgement, dashboard data, superuser matrix, and explicit persona lenses.
Representative SharePoint access and the production-data persona projections
passed before enablement. **[OWNER-REPORTED 2026-09-04]** Program Coordinator
Duncan Spore then found Request `1002788` in History, saw the review-status
matrix, and opened the Word document; the natural staff observation is complete.
No broad Request Document staff-role
privilege grant is pending: the owner selected service-principal writes with
explicit actor tracking, a separate attribution effort that does not block the
working acknowledgement role or this milestone.

**[PRODUCTION-LIVE + SIGNED-IN READ/WRITE PROVED 2026-08-31]** Matrix
assignment is program-specific rather than identical to the global
acknowledgement-role roster. Commit `5573bca3` is live in Ready Production
deployment `dpl_5DNuc2BV76RihwuWu8ZFYBgxBXE7`. The published Research audience
contains nine current reviewer-role members and excludes owner-confirmed
Southern California staff Anneli Stone and Saskia Pallais. Signed-in Admin
publication/readback survived a full reload; the coordinator dashboard then
rendered Request `1002788` under Research with exactly those nine reviewer
columns and zero application-console errors. Later signed-in Production
readback from the v2-capable deployment proved the stored v1 setting also
contained a six-person Southern California audience. The 2026-09-01 UTC v2
migration preserved both audiences exactly. The Admin editor
stores separate broad Grant Program GUID → reviewer `systemuser` GUID audiences
in `wmkf_appsystemsettings`, using the request's existing `wmkf_grantprogram`
lookup. Unconfigured request programs are called out explicitly and stale saved
programs/reviewers fail closed. Names remain Dataverse-owned and resolve live.

**[PRODUCTION-LIVE + SIGNED-IN READ SMOKE PASSED 2026-08-31]** commit
`52575761` and Ready deployment `dpl_Frc6fAonyFFYwiWyFJCzzE3UNune` ship the
superuser index with the complete
current-Final × expected-reviewer matrix from the exact enabled `WMKF Final
Writeup Reviewer` role roster. Signed-in Production DOM proof showed the exact
11-person audience and Request `1002788`, with Duncan Spore Reviewed, Justin
Gallivan Responsible PD, every other cell Not reviewed, both direct actions,
and zero browser-console errors. Prior local desktop and 390px browser QA also
passed against Production reads. The source now contains the reviewed GUID-only,
multi-valued v2 staffing contract and consolidated Admin editor. Commit
`213f6c34` enabled the tracked rollout flag in Ready Production deployment
`dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`. The superseded persona-team prototype is removed; the owner
decision and rollout evidence live in
`docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md`.

The named prerequisites are deliberately attached to the slices that need them:

1. **Resolved 2026-08-30:** the owner approved the expanded implementation
   surface and code-first delivery after durable reconciliation.
2. **Resolved and Production-proved 2026-08-30 PT / 2026-08-31 UTC:** Wave 22's explicit group-review and leadership-review actor/time fields are 4 exact / 0 divergent, the readiness flag is literal `on`, and the group-review transition recorded the authenticated actor/time explicitly. Dataverse `modifiedby` remains non-authoritative.
3. **Resolved 2026-08-30 PT / 2026-08-31 UTC:** an owner-authorized read-only Production
   census proved exact, enabled Dataverse `systemuser` link integrity for all 11
   existing active sign-in-capable staff profiles. One active synthetic profile
   without Azure sign-in and one inactive profile were excluded. The owner then
   confirmed that the 11-person roster contains every intended PD, PC, CSO, and
   President. The `systemuser` acknowledgement identity key is therefore
   approved; this does not authorize the separate Production schema apply.
4. **Resolved 2026-08-31:** commit `6659bba2` tracks the dedicated `WMKF Final
   Writeup Reviewer` security-role specification. The owner-approved Production
   apply assigned it to all 11 confirmed audience members, and read-only
   verification proved all 11 directly hold the role and effectively hold its
   six requested Global privileges. Dataverse automatically attached nine App
   Opener baseline privileges when it created the role; none is Delete, Assign,
   Share, or Request Document write.
5. **Architecture superseded and independently reviewed 2026-08-31; rollout
   Production-live 2026-09-03 PT.** The owner rejected the unshipped three-owner-team mechanism
   because it adds a separate privileged onboarding path. The selected
   replacement extends the existing `final_writeup.matrix_audiences` setting to
   a version-2 GUID-only contract containing explicit Program Director, Program
   Coordinator, Leadership, overlap, and **No persona lens** assignments. It
   uses the existing Final Writeup Admin editor, superuser route, one Publish
   action, and optimistic ETag. Allison Keller is owner-confirmed President;
   Beth Pruitt is owner-confirmed CSO and also has responsible-PD requests.
   Claude reviewed the focused replacement plan as **READY WITH NAMED CHANGES**;
   all findings are incorporated in
   `docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md`. The v2 contract, Admin
   editor, and dry-run-first ETag migration/repair/downgrade tooling are live
   at commit `84bf465b` in Ready Production deployment
   `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS`; the superseded team
   source is removed and its failed apply made zero writes. On 2026-09-01 UTC,
   the dry-run-first command upgraded the setting once from ETag
   `W/"96930393"`; exact readback proved v2 at `W/"96944113"`, 11 complete
   assignments, zero stale/unassigned rows, and unchanged nine-person Research
   and six-person Southern California audiences. Signed-in Admin and matrix
   reads passed while the flag remained false. Representative PC/Leadership
   Word access then passed (owner-reported), and commit `213f6c34` enabled the
   source flag in Ready Production deployment
   `dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`. A read-only production-data smoke
   exercised PD, PC, Leadership, overlap, ineligible/unassigned, and superuser
   projections. No name, email, job-title,
   program-taxonomy inference, new team privilege, or outside administrator is
   used.

Prerequisite 5 does **not** block the responsible-PD handoff, ordinary-PD
review slices, or the superuser matrix. Those relationships and the exact
reviewer-role roster are already server-verifiable. Persona-specific dashboard
queues are now enabled; PC backup actions and the transition into Leadership
review remain separate unbuilt authority/workflow slices.

The board-package handoff remains excluded until the PCs describe their downstream process.

The approved role-eligible audience is all PDs, PCs, the CSO, and the President.
The staff expected to review a particular request is the separately configured
audience for that request's broad Grant Program. The dashboard
must include a full coordinator matrix showing who has reviewed each writeup,
subject to the same caveats as individual acknowledgements: it is tracking, not
approval; blanks are not failures; there is no required count, due date, or
leadership sequence; and a later Word version yields **Updated since review**
rather than erasing the acknowledgement. The responsible PD does not
self-acknowledge their own writeup. In Production, the complete matrix is
available to freshly identified superusers and explicitly configured Program
Coordinators. PD, Leadership, and overlapping queue visibility is derived from
the published v2 assignments intersected with the current reviewer-role roster;
no team GUID is involved.

## Independent review disposition

An OAuth-authenticated, read-only Claude Fable review on 2026-08-28 independently reproduced the plan's load-bearing current-state claims and returned **READY WITH NAMED PREREQUISITES** with no P0 findings. This revision adopts its material findings with these explicit dispositions:

- retain `wmkf_CurrentPreSiteVisit` and move its source Pre-Site row to lifecycle `FINAL` at handoff;
- store transition actors explicitly rather than relying on Dataverse `modifiedby`;
- verify staff `systemuser` coverage before committing the acknowledgement key;
- acknowledge one observed publication version and never require two identical Graph reads or derive staleness from eTag alone;
- use the Final row lifecycle, not milestone presence alone, to distinguish group review from leadership review;
- preserve sharing history in the read-only Staff Deliberations receipt and keep the SharePoint filename behind the established File details treatment;
- enumerate the bounded supporting-material routes, transition edge cases, concurrency fences, durable-document sweep, and complete repository gates;
- do not make the global persona contract a Slice 1 blocker;
- do not build backward-stage UI in the first release. An accidental early handoff is non-destructive because the same document remains editable; genuine pointer corruption uses a documented operator recovery path until product evidence justifies a user-facing reversal.

## Contract surface

- **Change surface:** Final Writeup handoff, current-document projection, group/leadership review, personal review acknowledgement, role-specific dashboard, and focused review page.
- **Entry points:** Staff Deliberations, the responsible-PD Final Writeup tab, a cross-request Final Writeups dashboard, and a dedicated reviewer page. Every edit/review action launches the SharePoint Word document outside the Workbench in a separate browser window/tab, with desktop Word available only through Microsoft's own supported affordance.
- **Persistence:** the existing Dataverse Request Document registry and Request current-Final pointer; SharePoint for the single collaborative Word item and its native versions; one new Dataverse child entity for personal review acknowledgements.
- **Consumers:** responsible PDs, other PDs, PCs, CSO, President, Workbench UI, dashboard UI, supporting-material read surface, tests, Atlas, route-security matrix, and service catalogue.
- **Slice 0 baseline findings:** Final was still a placeholder; the Final artifact type and current pointer existed; no review-acknowledgement store existed; current Workbench access did not distinguish PC and leadership personas; and the former plan called for a second editable Final file. The subsequent Slice 1 Production status is recorded below.

## Verified current state

- **[PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC]** `FinalWriteupTab` replaces the former placeholder, reads readiness-gated status, offers the responsible-PD/superuser group-review transition, and opens Word separately after success. Request `1002788` rendered the resulting **Final Writeup is ready** state and the original SharePoint document link.
- **[PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC]** Staff Deliberations retains its fail-closed controls and renders lifecycle `FINAL` as a read-only receipt pointing staff to the Final Writeup tab; other unknown/beyond states remain generic read-only failures.
- **[VERIFIED]** The Request Document registry already defines the Final Writeup artifact type and the generic source-version, source-hash, milestone-version, milestone-hash, and milestone-time fields (`shared/config/requestDocument.js:10-58`; `lib/dataverse/adapters/request-document.js:12-68`).
- **[VERIFIED PRODUCTION STATE 2026-08-31]** `akoya_request.wmkf_CurrentFinalWriteup` has a deployed readiness-gated writer. Request `1002788` points to Final row `b6d6220b-f0a4-f111-b8dd-70a8a59cded0`, whose source lookup is the retained Pre-Site row `7b059a2f-19a3-f111-b8dd-000d3a5bbe46`; both rows reference the same stable SharePoint item and governed content hash (`docs/atlas/dataverse-wmkf-requestdocument.md`).
- **[VERIFIED]** The registry’s durable file identity is the stable Graph drive/item identity, and its only alternate key is the generation key. The schema does not require a different SharePoint item for each Request Document row (`lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:136-160`, `315-330`).
- **[VERIFIED]** The current Graph metadata helper returns stable identity, URL, eTag, publication version, and last-modified time, but not the modifying user (`lib/services/graph-service.js:400-442`).
- **[VERIFIED]** A Request already exposes the lead PD and assigned Program Coordinator as separate system-user lookups (`docs/atlas/dataverse-akoya-request.md:38-47`).
- **[VERIFIED]** The current dashboard is PD/reviewer-lifecycle-specific and derives its “my” scope from the lead-PD relationship (`lib/services/workbench/dashboard-service.js:42-79`, `126-176`). It should not be stretched into the Final Writeups dashboard.
- **[VERIFIED]** The existing `reviewers` app grant opens the whole Request Workbench (`shared/config/appRegistry.js:41-49`). A dedicated occasional-user dashboard needs its own access contract rather than granting leadership the full reviewer-management experience.
- **[PRODUCTION SCHEMA LIVE 2026-08-31]** Wave 23 defines and has provisioned
  the acknowledgement entity, six custom fields, two required lookups, and the
  Final-document + reviewer alternate key. Hardened readback reports 11 exact /
  0 absent / 0 divergent / 0 pending; the key index is Active and the entity set
  is `wmkf_finalwriteupreviewacknowledgements`. The live row count is one after
  the successful colleague proof below.
  **[ROUTE/UI PRODUCTION-LIVE; FIRST ACKNOWLEDGEMENT PROVED 2026-08-31]** A typed adapter,
  separate literal-on readiness interlock, mark/read service, authenticated API
  route, and Final-tab consumer now exist with focused tests. The Production
  readiness value is exact `on`. Signed-in Request `1002788` reads passed with
  zero reviews and responsible-PD exclusion. An eligible colleague's first POST
  then failed at Dataverse with missing acknowledgement Create and left no row.
  The dedicated role is now assigned/effective for all 11 confirmed audience
  members; the colleague's post-role retry succeeded, appeared in review
  history, and independent readback proved one complete acknowledgement row
  (`docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md`).
- **[DASHBOARD/FOCUSED REVIEW PRODUCTION-LIVE 2026-08-31]** The
  ordinary-staff Slice 3 foundation now has a separate bounded dashboard
  service, authenticated read route, cross-request queue, focused review page,
  reviewed history, updated-since-review state, positive initials, and
  external-Word actions. The service caps the current-Final census at 100,
  batches exact document/acknowledgement reads in groups of 25, and limits
  Graph metadata reads to four concurrent calls. It derives responsible-PD
  ownership and every queue/action server-side. The deployed foundation does
  not infer a PC or leadership persona or broaden supporting-material
  authorization. **[PRODUCTION-LIVE + SIGNED-IN READ SMOKE PASSED 2026-08-31]**
  commit `52575761` and Ready deployment `dpl_Frc6fAonyFFYwiWyFJCzzE3UNune`
  ship the complete neutral superuser matrix; ordinary and focused responses
  do not receive it. Production
  acknowledgement readiness is exact `on`; Preview remains unset.
- **[VERIFIED]** A Pre-Site row in `SUPERSEDED` is excluded from the current artifact read model. Clearing its pointer can re-enable draft generation, while retaining the pointer and moving the row to `FINAL` preserves the existing read-only receipt and regeneration lock (`lib/services/pre-site-visit/artifact-service.js:545-577`, `838-859`; `tests/unit/staff-deliberations-tab.test.js:446-464`).
- **[VERIFIED]** Dataverse writes only apply `MSCRMCallerID` when impersonation is enabled and may retry a 403 as the service principal; changesets do not currently expose a no-fallback actor guarantee (`lib/services/dynamics/write-core.js:76-115`; `lib/services/dynamics/changeset.js:85`, `113-125`).
- **[VERIFIED 2026-08-31]** Session `dynamicsSystemuserId` depends on exact-email
  reconciliation to an enabled Dataverse `systemuser`; the Production census
  proved that contract for all 11 active sign-in-capable profiles currently in
  `user_profiles`. **[OWNER-ATTESTED 2026-08-30 PT / 2026-08-31 UTC]** The owner
  confirmed that this roster contains every intended PD, PC, CSO, and President
  (`pages/api/auth/[...nextauth].js:274-286`, `331-335`;
  `lib/services/dynamics-identity-service.js:59-100`).

## Architecture revision: one editable document

The older lifecycle plan says Final creation copies the Pre-Site/Site Visit document into a second SharePoint file. That conflicts with the approved product requirement: users should experience one continuous working document, and an older editable sibling must not silently diverge.

The implementation should instead create a new **Final lineage row** that references the **same stable SharePoint drive/item** as the current Staff Deliberations document:

1. The responsible PD opens Final Writeup and selects **Ready for group review**. Staff Deliberations owns the source workspace before handoff and becomes the receipt afterward; the transition action is not duplicated across tabs.
2. The server independently resolves the current Pre-Site pointer and verifies the exact current SharePoint item, publication version, eTag, and governed content hash before and after reading it.
3. The server claims or reuses a deterministic Final Request Document row whose source is the current Pre-Site row/version/hash.
4. The Final row records the same stable SharePoint file identity. No second editable file is uploaded or copied.
5. One Dataverse changeset makes the Final row Ready/Review, moves the source Pre-Site row to lifecycle `FINAL` (`100000004`), retains `wmkf_CurrentPreSiteVisit`, and sets `wmkf_CurrentFinalWriteup`.
6. Staff Deliberations becomes a read-only receipt and the Final Writeup tab becomes the only in-application entry to the shared document.

This preserves two distinct records without creating two editable documents:

- the Pre-Site row records the earlier lifecycle and exact handoff lineage;
- the Final row is the current Final Writeup record and continues pointing to the one shared Word item.

Retaining the Pre-Site pointer is intentional. It keeps the current distribution history addressable and keeps regeneration locked. The source row's `FINAL` lifecycle makes the existing Staff Deliberations read model choose its beyond-deliberations receipt instead of treating the pointer as invalid or offering a second draft.

The frozen distribution snapshot already preserves what colleagues received. SharePoint native version history preserves subsequent edits. The UI never exposes registry filenames as the document identity.

## Invariant table

| Invariant | Likely surfaces | Verification |
|---|---|---|
| Users have one current editable Word item across Staff Deliberations and Final Writeup | Final handoff service, both panels, Request pointers | Same drive/item before and after; no Graph upload/copy call; Staff Deliberations link removed after success |
| The Final row is bound to the exact source row/version/hash selected at handoff | Final service and Request Document adapter | Stable metadata before/after, governed DOCX hash, deterministic generation key, source lookup/version/hash assertions |
| Exact retry creates no second Final row and performs no second transition | Final service | Generation-key alternate key, completed-state reread, row/file cardinality tests |
| Partial success is never reported as complete | Final service and route | Inject failure before/after claim and changeset; response stays retryable and never returns a false current Final |
| The Pre-Site source remains a valid, locked receipt after handoff | Final handoff service, artifact status service, distribution history | Source lifecycle is `FINAL`; current Pre-Site pointer remains; status projects the receipt; regeneration returns its existing locked conflict; history remains available |
| Only the responsible PD normally advances into group review | Route/service authorization | Server-resolved Request lead-PD lookup equals the session-derived system-user identity; non-owner PD receives 403 |
| PC advancement is enabled only after a positive PC-persona contract exists | Persona resolver and transition service | No job-title/name/email inference; negative tests for ordinary reviewer; actor persisted when backup path is enabled |
| Group review and leadership review do not create approval gates | Final read model and UI | No reviewer denominator, required count, overdue state, or sequence check |
| Every stage transition records the actual initiating staff member | Final row transition fields and services | Explicit actor lookup and timestamp are written from session-derived identity; `modifiedby` and impersonation fallback are not authoritative |
| “Ready for leadership review” records an exact checkpoint but does not create another file | Stage-transition service | Final lifecycle moves from `REVIEW` to `FINAL`; stable version/hash/time and explicit actor are recorded; stable file identity is unchanged |
| Acknowledgement belongs to the signed-in reviewer and the exact current Final document version | Acknowledgement route/service/entity | Reviewer identity absent from request body; server resolves current pointer and Graph version; responsible-PD self-review rejected |
| Later content versions retain the acknowledgement and yield “Updated since your review” | Dashboard/read model | Stored acknowledged publication version differs from current publication version; last-modified is secondary; eTag alone never marks stale; acknowledgement row remains |
| A reviewed document does not return to the President’s open queue after an ordinary edit | Dashboard service | Queue membership uses acknowledgement existence; freshness affects its label only |
| A materially new Final successor has no inherited acknowledgement | Final successor + acknowledgement read model | Acknowledgements key to Final artifact identity; new current artifact begins without rows |
| Other reviewers cannot advance stages | Final transition route/service | Hard server-side owner/approved-PC gate; UI hiding is not treated as authorization |
| Supporting materials are read-only and do not expose reviewer-management controls | Focused review page and supporting-material service | Purpose-built projection; route tests prove only allowlisted request/document data is returned |
| The coordinator matrix is complete without becoming a compliance scorecard | Dashboard service and PC/superuser lens | Every in-scope writeup × intended reviewer cell is present; blank, Reviewed, and Updated since review are neutral states; no denominator, overdue flag, required count, or enforced order |
| Editing remains in Microsoft Word, outside the Workbench | Final tab, dashboard, focused page | Actions open the canonical SharePoint link in a separate browser window/tab; no iframe, embedded editor, or app-native document editor is introduced |
| Action labels distinguish the queue step from the external editor | Workbench panels, dashboard, focused page | Dashboard non-owner: **Open review**; focused document: **Open in Word**; responsible PD: **Edit in Word** |
| Program taxonomy does not control access or primary grouping | Dashboard/persona service | No grant-program/program-area branch in authorization or default lists |
| An early group-review handoff does not lose or freeze work | Final tab and recovery contract | The same file remains editable; there is no first-release backward-stage UI; genuine pointer corruption has a documented operator recovery path |

## Durable data design

### Final lineage — existing identity plus additive transition attribution

The existing schema carries the file and lineage contract:

- artifact type identifies Final Writeup;
- source-document lookup identifies the Pre-Site row;
- source version and source content hash pin the handoff checkpoint;
- stable site/drive/item identity points to the same collaborative file;
- operation status and lifecycle identify a current Ready/Review Final row;
- the Request current-Final lookup selects the canonical row;
- the generation key makes exact retry converge.

Wave 22 defines `wmkf_GroupReviewStartedBy`, `wmkf_GroupReviewStartedAt`, `wmkf_LeadershipReviewStartedBy`, and `wmkf_LeadershipReviewStartedAt`. Runtime selects them only when `FINAL_WRITEUP_SCHEMA_READY=on`. The group-review actor lookup is resolved from the authenticated session and written with its timestamp in the same activation changeset; Dataverse `modifiedby` is informational only. Leadership fields remain schema-only until Slice 4.

For **Ready for leadership review**, move the Final row lifecycle from `REVIEW` to `FINAL` and reuse its existing milestone version/hash/time fields for the exact leadership-ready checkpoint. The lifecycle is the stage discriminator; milestone presence alone never changes stage. Review acknowledgements live elsewhere and therefore do not rewrite the Final row after this transition.

### Personal review acknowledgement — new additive entity

Wave 23 has provisioned one organization-owned Dataverse child entity,
`wmkf_FinalWriteupReviewAcknowledgement`, with pinned relationship schema names
`wmkf_finalwriteupreview_finaldocument` and
`wmkf_finalwriteupreview_reviewer`. Its minimum contract is:

- required lookup to the Final Request Document row;
- required lookup to the reviewing `systemuser`;
- acknowledged SharePoint item identity;
- acknowledged publication version;
- acknowledged eTag and last-modified time;
- acknowledged timestamp;
- alternate key across Final document + reviewer.

The row represents the reviewer’s latest acknowledgement for that Final artifact, not a legal audit trail. Marking the same exact version again is a no-op and must not restamp the time. Marking a later version updates the same row. A later document edit never deletes it.

The read-only staff-identity probe passed for every existing active,
sign-in-capable profile, and the owner confirmed that the 11-person roster is
the complete intended audience. Wave 23 therefore uses the `systemuser` lookup.
The separately authorized Production schema creation completed on 2026-08-31.

Production metadata readback is exact and the alternate key reports
`EntityKeyIndexStatus === 'Active'`. Runtime must still be readiness-gated when
the adapter/service is introduced; the new adapter must expose only named
reads/upserts, and UI code never talks to Dataverse directly.

## Server contracts

### 1. Final status and handoff

A request-scoped Final service owns:

- read current Final state;
- create/reuse the Final lineage row from the current Staff Deliberations document;
- advance the Final row to leadership review;
- project the responsible PD, current stage, current Graph metadata, positive review initials, and caller permissions.

The service derives group review from a current Final row in lifecycle `REVIEW` and leadership review from lifecycle `FINAL`. A named helper rejects unknown or contradictory lifecycle/milestone combinations rather than silently assigning a stage.

The handoff request body contains only expected-value fences such as Request ID and expected current source artifact ID. Request ownership, source pointer, current Final pointer, actor identity, Graph identity, and source version are resolved server-side.

Creation and activation follow the proven claim pattern explicitly:

- pre-check at most one non-Failed Final claim for the Request;
- create or recover the deterministic Final row before activation because the batch helper does not return created IDs;
- define and test claim lease expiry and takeover;
- carry `If-Match` fences for prior source rows, the Final target row, and the Request pointer row;
- retain the Pre-Site pointer while atomically setting the Final pointer;
- reject transition success if explicit actor attribution cannot be written.

### 2. Review acknowledgement

A separate service owns mark/read behavior. The write body contains the Request or expected Final artifact identity only; it never accepts a reviewer ID, reviewer name, role, acknowledged version, or timestamp. The service:

1. resolves the current Final pointer and caller identity;
2. rejects the responsible PD’s self-acknowledgement;
3. reads the current Graph metadata once and records the publication version, eTag, and last-modified values observed at that moment;
4. upserts the caller’s acknowledgement under the alternate key for that observed publication version, using `If-Match` when replacing a prior acknowledgement;
5. returns the derived personal state and updated positive-initial list.

An edit that lands after the observation is simply a later edit: the next read derives **Updated since your review** by comparing publication version first and last-modified time only as a secondary signal. eTag is retained as diagnostic metadata but never marks a review stale by itself. AutoSave or co-authoring activity between the read and upsert does not prevent the acknowledgement. The service must not report a failed acknowledgement after it has already persisted one.

### 3. Cross-request dashboard

Build a new service rather than adding Final logic to the reviewer-finding dashboard. It queries current Final pointer rows for the selected cycle, batches Request context, batches the caller’s acknowledgement rows, and refreshes file metadata with bounded concurrency.

**[PRODUCTION-LIVE; SIGNED-IN READ SMOKE PASSED 2026-08-31]** The ordinary-staff subset now
implements that separate service and its read route with a 100-row fail-closed
census cap, 25-ID exact read batches, four-way Graph concurrency, stable item
deduplication, and server-derived open/history/stewardship queues. Explicit PD,
PC, Leadership, overlap, and no-lens/ineligible projections are now enabled
from the published v2 staffing configuration and current reviewer-role roster.

Every returned row includes:

- Request number and title;
- institution;
- responsible PD name and ID;
- current Final artifact ID;
- stage: group review or leadership review;
- current file URL/version/eTag/last update;
- the caller’s relationship to the Request;
- personal review state;
- allowed actions.

The service, not the client, derives queue membership. Leadership and PC cycle selection uses the artifact-cycle query rather than the lead-PD-derived cycle picker:

- PD reviewer lens: other PDs’ active writeups not yet acknowledged, with reviewed history secondary;
- PC lens: all active writeups, with review as the primary row action and stewardship controls secondary;
- leadership lens: leadership-stage writeups only, with open and reviewed lists;
- President behavior: an acknowledged row stays in reviewed history after later edits and displays **Updated since your review** there.

### 4. Supporting materials

Create bounded, read-only supporting-material routes and a projection for the focused review page. Existing proposal, Initial Assessment, and review routes require the broader Reviewer or Review Manager capabilities and must not simply be exposed to leadership. The new routes may call their lower-level services internally, but they must not reuse interactive React tabs or broaden leadership into write routes. Add every route to the API security matrix and update the canonical route count.

The response exposes only the agreed context:

- Proposal;
- Initial Assessment;
- Reviews;
- later agreed supporting files.

File access must be re-derived server-side from the Request and allowlisted document identity. A quiet **View full request** link is shown only when the caller already has the full Workbench grant.

## Authorization model

### Confirmed rules

- The responsible PD is the Request’s lead-PD system-user lookup, not owner ID, secondary PD, or a client claim.
- Other PDs may review but may not advance the writeup.
- PCs see all active writeups and review like everyone else.
- The responsible PD normally performs both transitions.
- A PC may advance as an exceptional backup only after the application can positively identify the PC role.
- CSO and President can review leadership-stage writeups in either order.
- SharePoint continues to enforce actual Word-file access; representative PC and Leadership access was proved before rollout (owner-reported 2026-09-03).
- Superusers may perform responsible-PD transitions, with their actual identity recorded explicitly.
- A Request without a responsible-PD lookup fails closed to superuser-only transition authority.
- A recorded materials distribution is useful context but is not a server-side prerequisite for **Ready for group review**.
- The existing organization-open **Start sharing** authorization remains unchanged in this feature; revisiting it is separate work.

### Persona prerequisite — complete for dashboard lenses

Use the reviewed explicit Workbench-persona contract before enabling PC or
leadership behavior: version-2 GUID-only staffing assignments in the existing
Final Writeup Admin setting, resolved from the session-linked staff system-user
and current direct reviewer-role roster. Assignments are multi-valued because
leadership and PD responsibility can overlap; an explicit empty-role row means
**No persona lens**. Do not overload the Dynamics Explorer
`dynamics_user_roles` table, infer role from a job title, or hardcode people.

Before choosing storage, verify whether the assigned Program Coordinator lookup is populated reliably enough to authorize request-scoped backup actions. That lookup may solve the narrow assigned-PC case, but it cannot provide the global “all active writeups” PC dashboard or identify leadership.

The replacement storage decision and implementation status are recorded in
`docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md`. Current source implements
the v2 resolver/editor/tooling and removes the team prototype after a caller
census. No team was created. Commit `213f6c34` enabled dashboard persona
resolution in Production after representative Word access; read-only live-data
smoke passed for all six required identity shapes. The no-read rollout-off path
remains test-covered as the rollback behavior, and stale/missing/ineligible
viewers continue to fail closed. This completed identity contract does not by
itself implement PC backup transition authority or the transition into
Leadership review.

## UI surfaces

### Staff Deliberations

- Keep the current document card and mount sharing history in a read-only mode after handoff; do not expose compose controls in the beyond-deliberations state.
- After the site visit and the PD’s post-visit edits, show **Ready for group review** as the deliberate next-stage action. Whether materials were sent remains visible context, not a gate.
- The confirmation explains that the same working document moves to Final Writeup and remains editable; it does not discuss filenames, copies, registry rows, or SharePoint versions.
- On success, refresh state and navigate to the Final Writeup tab.
- Staff Deliberations becomes a read-only receipt with a quiet continuation to Final Writeup; no active document link remains there. The receipt uses the product display label and keeps the raw SharePoint filename behind the established File details disclosure.
- “Materials sent” may affect explanatory copy but does not disable the transition.

### Responsible-PD Final Writeup tab

- Replace the placeholder with the accepted card.
- Primary action: **Edit writeup**.
- Show Group review or Leadership review, last update, and positive-only reviewer initials.
- Do not show a personal Mark reviewed section to the responsible PD.
- During group review, show **Ready for leadership review** to the responsible PD.
- Show any PC backup action only when the server positively returns that permission; render it as secondary/exceptional.
- Do not add board-package controls yet.
- Do not add a backward-stage control in the first release. If the PD advances early, the same document remains editable and ordinary freshness states reflect later changes.

### Final Writeups dashboard

- New route and navigation entry for the approved audience.
- ~~One search field; no filter forest.~~ **SUPERSEDED BY OWNER DECISION 2026-09-06:** the
  shipped queue-only shape is not the end state. Keep the single search field and the persona
  queues, and ADD the contract filters (cycle, program/PD, artifact stage, editing/review state)
  as navigation-only controls; see Slice 6. Inline document preview is retired from the contract.
- Primary and secondary lists derive from the server-resolved persona.
- Row default for every non-owner: **Open review**.
- Responsible-PD rows, if shown in a stewardship context, use **Edit in Word**.
- Do not organize by Science and Engineering / Medical Research terminology.
- Provide the full coordinator matrix for superusers now and positively
  identified PCs only after persona rollout. It shows every in-scope writeup
  against the intended reviewer set for that request's configured broad Grant
  Program
  with neutral blank / Reviewed / Updated since review states. It is a tracking
  view, not an approval, completion, or performance report.

### Focused reviewer page

- Task first: document card, **Open in Word**, personal state, Mark reviewed/Mark latest version reviewed.
- Positive review initials remain visible.
- Supporting materials are collapsed and read-only.
- No full Request Workbench tab strip.
- Next-writeup navigation is derived from the caller’s current queue.
- **Open in Word** opens the canonical document in a separate browser
  window/tab. The page does not embed Word or provide an in-Workbench editor.

## Delivery slices

### Slice 0 — reconcile the durable plan

**[COMPLETE 2026-08-30.]** `/sweep` reconciled the live restatements of the old
“copy to a new editable file” model across the lifecycle plan, Request Document
Atlas, Pre-Site schema design, near-term execution plan, strategy wiki, project
memory, and source headers. The durable contract now records the same-item Final
lineage, **Ready for group review**, staged persona prerequisite, explicit
transition attribution, external-Word-only editing, full coordinator matrix,
2026-09-04 superuser-testable infrastructure milestone, continued board-package
deferral, and first-release no-backward-stage decision. The required documentation
and memory gates passed before Slice 1 implementation began.

### Slice 1 — Final handoff and responsible-PD tab

**[COMPLETE AND PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC.]** Commit `ebb147bb` is on `main`; Production deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ` is Ready with literal-on schema readiness. The owner-authorized Request `1002788` transition proved the deterministic same-item claim/activation service, request-scoped GET/POST route, Final tab, Staff Deliberations receipt, explicit actor/time attribution, retained current Pre-Site pointer, one current Final pointer, and unchanged SharePoint item/version/hash/file cardinality. Focused tests passed 48/48 and the bounded post-transition Production error/5xx scan was clean.

- Add the Final contract constants and request/current-Final read model.
- Add and readiness-gate explicit group-review transition actor/time fields.
- Build the deterministic same-item Final-lineage service and request-scoped route.
- Add **Ready for group review** to the Final Writeup tab with a hard responsible-PD gate; do not duplicate the transition action in Staff Deliberations.
- Implement the Final Writeup tab for group review.
- Retain the current Pre-Site pointer, move its source row to `FINAL`, preserve the original source milestone, and make Staff Deliberations a filename-safe read-only receipt with history after success.
- Specify Final-claim cardinality, lease expiry/recovery, create-before-activation, and all three `If-Match` fences.
- Allow superuser transition, fail closed to superuser-only when lead PD is absent, and do not require a recorded materials send.
- Document operator-only recovery for genuine pointer corruption. Do not build a user-facing backward-stage action.
- Do not build acknowledgements, dashboard, PC backup, or leadership queue yet.

This slice proves the document-continuity contract end to end before adding collaborators.

### Slice 2 — acknowledgement schema, service, route, and Final tab

**[PRODUCTION-LIVE; FIRST ACKNOWLEDGEMENT PROVED 2026-08-31.]** Wave 23 schema source, hardened
preflight, Production schema apply, typed adapter, separate readiness interlock,
backend mark/read service, authenticated route, and Final-tab consumer are
complete in source. Exact readback reports 11 exact / 0
absent / 0 divergent / 0 pending, entity set
`wmkf_finalwriteupreviewacknowledgements` and an Active alternate key.
An OAuth-authenticated Claude Fable adversarial review's accepted classifier
and proof-boundary findings are fixed. The owner confirmed the 11-person roster
is the complete intended PD/PC/CSO/President audience. Production readiness is
exact `on`; signed-in read and responsible-PD exclusion proof passed. An
eligible colleague's first write reached Dataverse but failed on missing
acknowledgement Create and left no row. The dedicated reviewer role is now
assigned/effective for all 11 audience members; the post-role retry succeeded,
the UI showed the item in review history, and independent readback proved one
complete row for Request `1002788`.

- **Complete:** record owner attestation that the 11-person sign-in roster
  contains every intended PD, PC, CSO, and President; use `systemuser` as the
  reviewer identity key.
- **Complete:** apply the additive Dataverse entity and alternate key under
  explicit Production authorization; reread exact metadata and require the key
  index to report Active.
- **Production-live:** add a distinct readiness gate whose
  literal-on rollout requires the alternate-key index to be Active, plus a
  typed adapter registered under the metadata-confirmed entity-set name.
- **Production-proved:** implement single-observation
  current-version acknowledgement, responsible-PD rejection, enabled
  `systemuser` validation, same-version no-restamp, `If-Match` replacement,
  ambiguous-write reread, publication-version-based personal states, and
  positive reviewer projection. Focused suites pass 26/26.
- **Production-live; GET smoke passed:** add the app-authenticated GET/POST route
  with session-only reviewer identity and exact current-Final fencing.
- **Production-live; responsible-PD smoke passed:** consume the projection in the Final tab,
  show positive reviewer initials and non-PD personal state/action, keep the PD
  self-review section absent, isolate tracking failures from Word launch, and
  suppress the expected schema-off response. Desktop and narrow-width visual
  review passed; reviewer initial targets meet the 44px interaction floor.
- **Verified locally:** the seven bounded Final transition, acknowledgement
  readiness/adapter/service/route, and tab suites pass 58/58; lint and type
  checking pass; the webpack production build includes the new route. The
  native Turbopack build remains locally blocked by its known internal-port
  sandbox restriction, not by a source compile error.

### Slice 3 — focused review page and PD dashboard

**[ORDINARY-STAFF FOUNDATION PRODUCTION-LIVE 2026-08-31.]** The
separate dashboard service/read route, ordinary-review queue, responsible-PD
stewardship queue, focused review page, reviewed history, updated-since-review
state, positive initials, search, and current-queue navigation are built. The
read model is explicitly capped, batched, concurrency-limited, and fail-closed
on ambiguous current artifacts or acknowledgement state. Focused unit and
visual checks cover desktop and narrow widths. Production readiness is exact
`on`; signed-in dashboard and focused Final reads passed on Request `1002788`.
The original signed-in smoke wrote no acknowledgement because its user is the
responsible PD. A later eligible colleague attempt exposed the missing role
privilege without partial persistence; after remediation, the colleague retry
succeeded and the resulting review-history state and complete Dataverse row
were independently verified.

- **Production-live; signed-in read-smoked:** Final Writeups dashboard for ordinary
  existing Workbench users and focused review page.
- **Production-live; empty-state/Word-action smoke passed:** reviewed history,
  updated-since-review behavior, positive initials, and external Word actions.
- **Deliberately deferred:** new leadership-safe supporting-material
  projections. The ordinary-staff page links only to existing Workbench read
  surfaces under their existing authorization; it does not broaden access.
- **Production-live; signed-in read-smoked:** the complete neutral matrix ships
  on the superuser index only in Ready deployment
  `dpl_Frc6fAonyFFYwiWyFJCzzE3UNune`, deriving the expected
  audience from exact enabled membership in `WMKF Final Writeup Reviewer`.
  Signed-in Production proof showed the exact 11-person roster and correct
  Request `1002788` cell/action states with zero browser-console errors.
  Ordinary/focused responses do not receive the matrix.
- **Production-live + signed-in read/write proved:** commit `5573bca3` and Ready
  deployment `dpl_5DNuc2BV76RihwuWu8ZFYBgxBXE7` ship independent broad Grant
  Program audiences. The published Research configuration contains nine current
  reviewer-role members and excludes owner-confirmed Southern California staff
  Anneli Stone and Saskia Pallais. Admin publish/readback survived reload, and
  Request `1002788` rendered under Research with exactly those nine columns and
  zero application-console errors. Later signed-in Production readback proved
  the stored v1 setting also contained a six-person Southern California audience;
  the 2026-09-01 UTC v2 migration preserved both audiences exactly.
- **Production-live behind the enabled resolver:** PD users receive group-review
  rows plus their own writeups, PC users receive all rows plus the complete
  neutral matrix, leadership receives leadership-stage rows, overlapping
  memberships receive the union, and unassigned users fail closed. The v2
  staffing configuration, representative Word-access proof, tracked enablement,
  and read-only production-data persona smoke are complete. Owner-reported
  natural use by Program Coordinator Duncan Spore then proved History discovery,
  matrix visibility, and Word open for Request `1002788`.

This slice can ship before the PC/leadership persona model because responsible-PD versus other-PD is already server-verifiable.

### Slice 4 — leadership readiness and persona lenses

- **Dashboard persona lenses Production-live 2026-09-03 PT:** the v2 staffing
  configuration and current reviewer-role roster are the only persona
  authority. Representative Word access and all six read-only production-data
  projections passed; no team exists or is required.
- Add **Ready for leadership review**, moving the Final lifecycle from `REVIEW` to `FINAL` and storing the exact milestone version/hash/time plus explicit actor/time.
- **Complete for dashboard visibility:** enable the PC all-active view; the
  exceptional backup transition remains unbuilt.
- **Complete for dashboard visibility:** enable CSO/President leadership-stage
  queues; the transition that creates Leadership-stage work remains unbuilt.
- Verify the President’s reviewed-history behavior and the no-sequence rule.
- **Complete:** extend the already-built complete coordinator matrix to
  configured PC users and preserve its non-compliance semantics for all
  audiences.

### Slice 5 — production proof and rollout

- Use a designated non-sensitive request and internal staff accounts.
- Prove the same drive/item identity across Staff Deliberations and Final Writeup.
- Prove exact handoff retry creates one Final row and one current pointer.
- Prove another PD can review and acknowledge without stage authority.
- Prove a responsible PD cannot mark their own writeup reviewed.
- Prove a routine Word edit changes the personal label without requeueing leadership.
- **Complete for President and PC:** **[OWNER-REPORTED 2026-09-03]** Representative Word access is proved: President Allison Keller (Leadership) opened the canonical Word item through the signed-in Final Writeups experience and marked it reviewed on 2026-09-03, and Program Coordinators Duncan Spore and Sarah Hibler did the same (dates not recorded). The owner saw Allison's acknowledgement on the dashboard; no independent Dataverse readback was run. CSO access is not yet separately proved.
- Stop before board-package generation or Power Automate integration.

### Slice 6 — cycle scoping, filters, and dashboard residuals

**[OWNER-DIRECTED 2026-09-06; PLANNED, NOT BUILT.]** On 2026-09-06 the owner reviewed the
Editor Dashboard contract (`docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` "Final Writeups
Dashboard" and `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` "Cycle-wide Editor Dashboard contract")
against the shipped Final writeups dashboard and decided: **keep the filters requirement and build
it; retire inline "direct preview" from the contract; keep the remaining residuals as tracked work.**
This supersedes the earlier "one search field; no filter forest" line above.

Current-state boundary [VERIFIED 2026-09-06 via source]:

- `lib/services/final-writeup/dashboard-service.js` loads **every** request with a current Final
  across all cycles (`_wmkf_currentfinalwriteup_value ne null`, no cycle constraint) and throws
  `final_writeups_dashboard_scope_exceeded` (503) once more than
  `FINAL_WRITEUPS_DASHBOARD_MAX_ROWS` (100) current rows exist. Each row already carries
  `cycleCode`/`cycleLabel`, `stage`, `responsibleProgramDirector`, `bucket`, `personalState`, and
  `document.publicationVersionId`/`lastModified`.
- `shared/components/final-writeups/FinalWriteupsViews.js` renders one free-text search over
  request number, title, institution, project leader, and PD name; it renders neither the cycle nor
  the publication version and offers no filter controls. Its header comment records the superseded
  "review queue replaces a metrics-and-filters dashboard" thesis.
- No "has edits" hint exists anywhere in the Final Writeup service or components.
- Pre-Site / Site Visit documents have no cycle-wide list; the Initial Assessment locator
  (`/workbench/artifacts`) is a separate cycle-scoped list without Reviewed tracking.

Build order (each step reviewable on its own; `/contract-reconcile` applies to 6A because the
read model's scope, cap, and fail-closed behavior change):

- **6A — server-side cycle scoping (dated: before D26 Final writeups exist).** The 100-row cap is
  global, so a second cycle of Finals eventually takes the whole dashboard down rather than
  degrading. Scope the request query by the selected cycle (artifact-cycle query from the current
  Final rows' requests, per the persona section above — not the lead-PD-derived picker), return the
  available cycle list with the payload, default to the newest cycle with any current Final, and
  keep the per-cycle cap and fail-closed behavior. The cycle selector is the first filter and lives
  in the API contract; add `cycleCode` validation to the GET route and the route-security matrix
  row. The persona queues, matrix, and focused page keep their semantics inside the selected cycle.
- **6B — client-side filters over the loaded cycle.** Program/PD (responsible PD), artifact stage
  (Group review / Leadership review), and editing/review state (Not reviewed / Reviewed / Updated
  since review / My writeups) as navigation-only controls beside the search field, applied to the
  open, history, and stewardship queues and to the coordinator matrix. Counts shown on a filter
  are navigation counts, never denominators; no program-taxonomy grouping or authorization branch
  (contract rows "coordinator matrix is complete without becoming a compliance scorecard" and
  "program taxonomy does not control access or primary grouping" still hold). Filters persist in
  the URL query so a filtered view is bookmarkable. Replace the header thesis comment in
  `FinalWriteupsViews.js` with the amended direction.
- **6C — current-version context.** Preview is retired; in its place render the observed
  SharePoint publication version that acknowledgements key to, next to last-modified, so
  "Updated since review" is explainable without opening Word. No embedded editor, no iframe.
- **6D — "has edits" secondary hint (product call, unscheduled).** SharePoint revision or
  tracked-changes evidence as a secondary hint only; it never replaces the explicit Reviewed
  marker. Requires a Graph read contract and a freshness posture before build.
- **6E — other writeup stages (product call, unscheduled).** Decide whether Pre-Site / Site Visit
  documents need a cycle-wide list or the per-request Staff Deliberations tab suffices; the Initial
  Assessment locator stays separate unless that decision says otherwise.

Explicitly unchanged: no approval gates, denominators, due dates, or leadership ordering; Word
opens outside the Workbench; the responsible PD does not self-acknowledge; PC backup and the
Leadership-stage transition remain the separate slices named above.

## Likely file surface

The first implementation will require an explicitly expanded surface including:

- existing Request Workbench shell and Staff Deliberations component;
- a new Final Writeup component;
- new Final services and routes;
- Request Document and Request adapters/projections;
- Graph metadata projection if modifier display is retained;
- new dashboard and focused-review pages/components;
- app-access registry/persona resolution;
- one additive Dataverse schema wave, readiness guard, adapter, and Atlas page for acknowledgements;
- focused unit tests for each service, route, component, and role state;
- API route security matrix, service catalogue, Application State Atlas, lifecycle plan, canonical route counts, and current work queue as required by the repository gates.

No implementation should start under the original two-file ownership restriction.

## Test and gate plan

### Focused unit tests

- Final handoff service and route: happy path, same-item proof, exact retry, stale source, changed Graph version, unknown lifecycle, pointer mismatch, duplicate active Final, claim lease expiry/takeover, missing ETag, claim loss, three `If-Match` fences, changeset failure, response-loss recovery, non-owner 403, superuser success, missing-lead fail-closed behavior, explicit actor persistence, and no false success after impersonation fallback.
- Final tab and Staff Deliberations: stage copy, source row `FINAL`, retained Pre-Site pointer, regeneration-locked response, history continuity, filename-safe read-only source receipt, one active document link, intent-based labels, responsible-PD-only transition, materials-send non-gate, loading/error/retry states, stale-request cancellation.
- Acknowledgement adapter/service/route: caller-derived identity, responsible-PD rejection, same-version no-restamp, later-version update with `If-Match`, AutoSave between observation and persistence, eTag-only change remains reviewed, publication-version change becomes updated, wrong-current-artifact rejection, alternate-key convergence and Active-index readiness.
- Dashboard: persona filtering, positive review states, no reviewer denominator, President non-requeue behavior, no program-taxonomy grouping, search, empty/error states, stale response guards.
- Focused review page: task-first hierarchy, supporting-material collapse, capability-bounded read routes, read-only projection, Mark reviewed state changes, accessible buttons and initials.

### Repository gates

Run each gate and its self-test sequentially where applicable:

1. focused Jest suites for every changed component/service/route;
2. existing Staff Deliberations and distribution suites;
3. `npm run lint`;
4. `npm run prebuild`, then `npm run check:migrations-manifest` if a Postgres migration is introduced (none is currently recommended);
5. `npm run check:api-routes`, then `npm run check:api-routes:self-test`;
6. `npm run check:atlas`, then `npm run check:atlas:self-test`;
7. `check:route-lifecycle-auth`, then its self-test;
8. `check:trust-boundary-guid`, `check:route-service-boundary`, `check:dataverse-access-layer`, `check:dynamics-context-boundary`, and `check:odata-escape`;
9. `check:status-enum-parity`, `check:docs-catalog`, `check:types`, `check:fact-consistency`, and the service-catalog/schema gates named by `package.json` for the touched surface;
10. `check:doc-currency`, `check:memory-drift`, instruction, and agent-invariant gates for the durable reconciliation;
11. production build;
12. signed-in browser verification at desktop and narrow widths for each persona.

## Contract audits

- **Whole-flow:** covered from user action through client state, route auth, service, Dataverse/Graph, response projection, and UI consumer.
- **Partial success:** material for Final handoff and acknowledgement; covered by deterministic claim/retry, atomic pointer activation, exact byte-lineage fencing at Final handoff, and one-observation acknowledgement with conditional update.
- **Identity and attribution:** material for both transitions and
  acknowledgements; transition actor fields fail closed when the session
  identity is unavailable. Link integrity is Production-proved for the 11
  existing active sign-in profiles, and the owner confirmed that they comprise
  the complete intended audience. The Production schema apply is complete; the
  separate Wave 23 runtime flag is exact `on` in Production. The signed-in read
  path and responsible-PD exclusion are proved. The dedicated reviewer role is
  assigned/effective for all 11 audience members; an eligible colleague's
  pre-role failure left no partial row, and their post-role retry/readback
  proved the first exact cross-user acknowledgement.
- **Async/stale state:** material in all pages; every load/write needs abort or monotonic request guards before success and failure state updates.
- **Helper extraction:** do not reuse the guarded-reopen service as the Final service. Reuse only lower-level Graph/hash/adapter primitives because reopen and Final have different source eligibility, lifecycle effects, and retry semantics.
- **Durable surface:** new acknowledgement entity requires schema-as-code, exact metadata/alternate-key verification, Atlas, service catalogue, tests, readiness flag, and applicable gates.
- **Doc reconciliation:** the current lifecycle plan conflicts with the same-item decision and must be reconciled before code is described as ready.
- **Symbol/consumer fan-out:** any new acknowledgement fields, persona values, or readiness flag must be searched across every read projection, filter bucket, dashboard count, and route select list.

## Explicitly deferred

- Board-package state, file naming, destination, batching, and Power Automate trigger.
- Required reviewer counts or formal approvals.
- CSO-before-President or President-before-CSO sequencing.
- Edit notifications for routine Word changes.
- Program-taxonomy-based permissions or grouping.
- Final “regeneration” until a concrete recovery case is defined. SharePoint version recovery and exact idempotent handoff should cover the first release; creating another current Final would reintroduce the editable-sibling problem unless archival permissions are designed first.
- User-facing reversal of group-review or leadership-review readiness. The same file stays editable after an early transition; document an operator recovery procedure for corrupted pointers and revisit backward-stage controls only when a real workflow requires them.

## Final recommendation

Proceed with the reviewed v2 staffing-configuration implementation and access
proof on top of the
Production-proved Slices 2–3 foundation and the Production-live complete
neutral superuser matrix. The 2026-09-04 same-item
handoff is already Production-proved; Wave 23 is exact and Active in Production,
with the identity and schema prerequisites cleared. The acknowledgement
adapter/service, authenticated route, Final-tab consumer, ordinary-staff
dashboard data path, and focused-review surface are Production-live behind the
exact `on` flag. Signed-in dashboard/Final reads and responsible-PD exclusion
passed, and the dedicated six-privilege reviewer role is effective for all 11
confirmed audience members. The first colleague acknowledgement succeeded,
appeared in review history, and passed exact independent readback. All
edit/review actions open the canonical Word document outside the Workbench.
The superuser matrix is live in Ready deployment
`dpl_Frc6fAonyFFYwiWyFJCzzE3UNune`; signed-in Production DOM proof showed the
exact 11-person roster and correct Request `1002788` states/actions with zero
browser-console errors. Non-superuser persona visibility is now Production-live
at `213f6c34` / `dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`; its v2 configuration,
representative Word access, and six-case read-only production-data smoke passed.
PC backup and the Leadership-stage transition remain separate work. This sequence advances the
approved experience without guessing role identity or inventing the still-unknown
board-package workflow.
