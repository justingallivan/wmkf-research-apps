---
title: Final Writeup Review — Implementation Plan
domain: workbench
kind: plan
status: active
summary: "Same-item Final handoff is Production-proved; Slice 2 schema is preflighted with identity cleared and awaits explicit Production apply approval."
canonical: false
cataloged: 2026-08-28
last_verified: 2026-08-31
owner: product-engineering
related:
  - docs/audits/final-writeup-review-fable-review-2026-08-28.md
  - docs/audits/final-writeup-acknowledgement-wave23-adversarial-review-2026-08-31.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
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

**Verdict: OWNER-APPROVED FOR STAGED IMPLEMENTATION WITH NAMED PREREQUISITES.**

This plan translates the approved Final Writeup and group-review experience into the current Request Workbench architecture. Slice 0 is complete. **[PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC]** Slice 1 shipped on `main` at `ebb147bb` in Ready Production deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ`; Wave 22 is 4 exact / 0 absent / 0 divergent and the non-sensitive `FINAL_WRITEUP_SCHEMA_READY` value is literal `on` in Production. The authorized Request `1002788` transition created one Ready/Review Final row, moved the retained current Pre-Site source to lifecycle Final, set the current-Final pointer, recorded Justin Gallivan and `2026-08-31T03:57:20Z`, and reused the exact same SharePoint drive/item, version `1.0`, 38,273-byte file, and governed hash. The distinct SharePoint-file count remained four, proving that no copy or upload occurred. A bounded 30-minute scan found no Production error logs or 5xx responses.

The 2026-09-04 milestone means the underlying handoff, identity, acknowledgement,
dashboard-data, and superuser test path are in place. It does not promise broad
staff rollout by that date. General-role enablement remains gated by verified
identity/persona and SharePoint access; the expected staff-role privilege grant
is currently external and later than the milestone.

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
4. Before Slice 4, settle how the application positively identifies a Program Coordinator or leadership user. Current app access proves access to an application, and each Request identifies its responsible PD and assigned PC, but there is no verified Workbench persona contract for “any PC” or “leadership.” The implementation must not infer those roles from names, email addresses, job titles, or the changing program taxonomy.

Prerequisite 4 does **not** block the responsible-PD handoff or ordinary-PD review slices. Those relationships are already server-verifiable; PC backup actions and leadership-specific queues remain disabled until the broader persona contract exists.

The board-package handoff remains excluded until the PCs describe their downstream process.

The approved audience is all PDs, PCs, the CSO, and the President. The dashboard
must include a full coordinator matrix showing who has reviewed each writeup,
subject to the same caveats as individual acknowledgements: it is tracking, not
approval; blanks are not failures; there is no required count, due date, or
leadership sequence; and a later Word version yields **Updated since review**
rather than erasing the acknowledgement. The responsible PD does not
self-acknowledge their own writeup. Until the broader persona contract exists,
the complete matrix is limited to positively identified PCs and superusers.

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
- **[VERIFIED 2026-08-31]** Wave 23 schema-as-code and its hardened metadata
  preflight now define the proposed acknowledgement entity, six fields, two
  required lookups, and the Final-document + reviewer alternate key. Production
  metadata remains absent and creation-compatible: 11 absent / 0 divergent / 0
  pending / 0 exact in the read-only preflight, and the non-writing apply dry-run
  passed. No adapter, route, service, readiness flag, or live entity exists yet.
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
| Action labels describe intent, not the application | Workbench panels, dashboard, focused page | Responsible PD: **Edit writeup**; non-owner: **Review writeup**; no routine “in Word” button copy |
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

Wave 23 proposes one organization-owned Dataverse child entity,
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
Production schema creation still requires separate explicit authorization.

The schema must be readiness-gated until metadata readback is exact and the alternate key reports `EntityKeyIndexStatus === 'Active'`. The new adapter must expose only named reads/upserts; UI code never talks to Dataverse directly.

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
- SharePoint continues to enforce actual Word-file access; the application must verify those permissions with each representative persona before rollout.
- Superusers may perform responsible-PD transitions, with their actual identity recorded explicitly.
- A Request without a responsible-PD lookup fails closed to superuser-only transition authority.
- A recorded materials distribution is useful context but is not a server-side prerequisite for **Ready for group review**.
- The existing organization-open **Start sharing** authorization remains unchanged in this feature; revisiting it is separate work.

### Persona prerequisite

Add a small, explicit Workbench-persona contract before enabling PC or leadership behavior. It should be administered, reviewable, and server-resolved. Do not overload the Dynamics Explorer `dynamics_user_roles` table, infer role from a job title, or hardcode people.

Before choosing storage, verify whether the assigned Program Coordinator lookup is populated reliably enough to authorize request-scoped backup actions. That lookup may solve the narrow assigned-PC case, but it cannot provide the global “all active writeups” PC dashboard or identify leadership.

The likely implementation is a dedicated Final Writeups app-access capability plus an explicit persona assignment associated with the staff system-user identity. The exact storage mechanism needs one focused design decision because current app-access grants are boolean and do not encode PD/PC/leadership subroles.

Until that exists:

- responsible-PD ownership can be enforced now;
- ordinary PD review can be enabled for existing Workbench users;
- PC backup advancement and leadership-specific default queues remain disabled rather than guessed.

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
- One search field; no filter forest.
- Primary and secondary lists derive from the server-resolved persona.
- Row default for every non-owner: **Review writeup**.
- Responsible-PD rows, if shown in a stewardship context, use **Edit writeup**.
- Do not organize by Science and Engineering / Medical Research terminology.
- Provide the full coordinator matrix for positively identified PCs and
  superusers. It shows every in-scope writeup against the intended reviewer set
  with neutral blank / Reviewed / Updated since review states. It is a tracking
  view, not an approval, completion, or performance report.

### Focused reviewer page

- Task first: document card, **Review writeup**, personal state, Mark reviewed/Mark latest version reviewed.
- Positive review initials remain visible.
- Supporting materials are collapsed and read-only.
- No full Request Workbench tab strip.
- Next-writeup navigation is derived from the caller’s current queue.
- **Review writeup** opens the canonical document in a separate browser
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

### Slice 2 — acknowledgement schema and service

**[IN PROGRESS 2026-08-31.]** Wave 23 schema source and the read-only metadata
preflight are built. Production reports 11 absent / 0 divergent / 0 pending / 0
exact, and the non-writing apply dry-run passed. An OAuth-authenticated Claude
Fable adversarial review's accepted classifier and proof-boundary findings are
fixed. The owner confirmed the 11-person roster is the complete intended
PD/PC/CSO/President audience, clearing the identity-key prerequisite. No live
schema write has occurred.

- **Complete:** record owner attestation that the 11-person sign-in roster
  contains every intended PD, PC, CSO, and President; use `systemuser` as the
  reviewer identity key.
- After separate explicit Production authorization, apply the additive
  Dataverse entity and alternate key; reread exact metadata and require the key
  index to report Active.
- Add readiness gating that requires the alternate key index to be Active, plus a typed adapter.
- Implement single-observation current-version acknowledgement, `If-Match` replacement, and publication-version-based personal states.
- Add positive reviewer initials to the Final tab.

### Slice 3 — focused review page and PD dashboard

- Build the Final Writeups dashboard for ordinary PD reviewers.
- Build the focused review page.
- Add new bounded supporting-material read routes and projection under the Final Writeups capability; update their route-matrix rows and canonical counts.
- Add reviewed history and updated-since-review behavior.
- Add the matrix-ready dashboard projection; show the complete matrix only to
  positively identified PCs and superusers until the persona contract lands.

This slice can ship before the PC/leadership persona model because responsible-PD versus other-PD is already server-verifiable.

### Slice 4 — leadership readiness and persona lenses

- Land the explicit PC/leadership persona contract.
- Add **Ready for leadership review**, moving the Final lifecycle from `REVIEW` to `FINAL` and storing the exact milestone version/hash/time plus explicit actor/time.
- Enable PC all-active view and exceptional backup transition.
- Enable CSO/President leadership-stage queues.
- Verify the President’s reviewed-history behavior and the no-sequence rule.
- Enable the full coordinator matrix for confirmed PC users and preserve its
  non-compliance semantics for all audiences.

### Slice 5 — production proof and rollout

- Use a designated non-sensitive request and internal staff accounts.
- Prove the same drive/item identity across Staff Deliberations and Final Writeup.
- Prove exact handoff retry creates one Final row and one current pointer.
- Prove another PD can review and acknowledge without stage authority.
- Prove a responsible PD cannot mark their own writeup reviewed.
- Prove a routine Word edit changes the personal label without requeueing leadership.
- Prove CSO/President/PC SharePoint access independently; do not equate an app link with file permission.
- Stop before board-package generation or Power Automate integration.

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
  the complete intended audience. The separate Production schema apply remains
  explicitly gated.
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

Proceed with slices 2–3 next. The 2026-09-04 superuser-testable same-item
handoff is already Production-proved; Wave 23 source and preflight are ready,
with the identity prerequisite cleared and explicit Production-apply
authorization still required. The remaining milestone work is to deploy and consume durable review
acknowledgements and land the dashboard data/focused review foundation. All edit/review actions open
the canonical Word document outside the Workbench. PC backup, broad matrix
visibility, leadership-specific lenses, and general rollout follow only after
the explicit persona/access contracts are verified. This sequence advances the
approved experience without guessing role identity or inventing the still-unknown
board-package workflow.
