---
agent_wiki: topic
status: active
last_verified: 2026-10-31
verification_scope: "Bounded source/Git backlog reconciliation for materials acceptance and product follow-ups; other dated history retained, no live probes"
stale_after_days: 90
owner: product-strategy
source_files:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - DEVELOPMENT_LOG.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md
  - outputs/institution-resolution-handoff-to-codex-2026-08-07.md
  - benchmarks/compact-ror-index/results/v2.11-2026-08-03.md
  - benchmarks/fuzzy-matching-falsification/versions/v2/results/2026-08-07-api-candidate-benchmark.md
  - benchmarks/fuzzy-matching-falsification/versions/v3/results/2026-08-07-api-decision-benchmark.md
  - lib/services/reviewer-identity-runtime.js
  - lib/services/pre-site-visit/distribution-service.js
  - lib/services/ror-institution-candidate-adapter.js
  - lib/services/ror-institution-decision.js
  - lib/services/ror-institution-identity-resolver.js
canonical_docs:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - DEVELOPMENT_LOG.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
watch_paths:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - DEVELOPMENT_LOG.md
  - docs/**/*ROADMAP*.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
  - benchmarks/compact-ror-index/**
  - benchmarks/fuzzy-matching-falsification/versions/v2/**
  - benchmarks/fuzzy-matching-falsification/versions/v3/**
  - lib/services/reviewer-identity-runtime.js
  - lib/services/pre-site-visit/distribution-*.js
  - lib/services/ror-institution-*.js
update_triggers:
  - roadmap or phasing changes
  - cross-capability architecture changes
  - backend automation/post-award planning changes
---

# Strategy & Roadmap

Use this page for system model, roadmap, grant-cycle phasing, planned review
pipeline/proposal extracts, backend automation, interim reports, post-award work,
and broad AI capability planning.

Start with `docs/CURRENT_WORK_QUEUE.md` for ordered commitments. The catalog is a
document inventory, and individual implementation plans do not establish priority.

## Current direction and owner holds

- **Final writeups dashboard:** cycle scoping, review views, bookmarkable PD filtering,
  and publication-version context are implemented and have dated September 2026
  release/smoke evidence. Queue item 5 is a completed release record, not a current
  recommendation to build filters. This pass verified source/merge ancestry, not current
  Production configuration.
- **Reviewer materials on acceptance:** implemented on main via PR #562
  (`fcad0ad53`). The acceptance drain and manual send share the durable release
  row; fallback/recovery remain explicit. Dated Production release is recorded
  in Session657, not freshly probed here. First natural J27 send observation and
  separately scoped invitation wording/date-field work remain; do not queue
  another automation build. Follow queue item 6 and the lifecycle hub.
- **Unfinished product threads:** the [bounded backlog audit](../../audits/product-backlog-reconciliation-2026-10-31.md)
  separates J27 intake/triage, corpus extraction/browsing, cycle readiness,
  calendar-event agendas and Chairs-specific work from existing foundations.
  Grant Reporting integration and Literature Analyzer disposition remain owner
  decisions. Bulk Export and corpus indexing partly supersede the historical
  retrospective plan; concept eligibility and the successor Review Panel do not
  implement the old staged proposal pipeline. The canonical queue retains priority.
- **S2AFF:** retained as a possible comparator after the prior skip recommendation was
  withdrawn, but it is not an active queue commitment or execution authorization. Owner
  decision and a pinned Python environment are prerequisites.
- **Applicant-materials and briefing roadmap:** use the current work queue and their
  implementation plans for shipped boundaries and residuals. The dated entries below
  preserve research history and must not be treated as current build instructions.
- **Reviewer identity and origination:** preserve recall-oriented, human-curated
  origination. Use the [Reviewer Origination & Retrieval hub](reviewer-origination.md)
  for lane posture and the [Reviewer Identity hub](reviewer-identity.md) plus
  [enforcement contracts](../../REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md) for identity,
  COI, save, and invitation boundaries. Historical ROR and S2AFF comparisons do not
  authorize promotion or create queue commitments; use the canonical [work queue](../../CURRENT_WORK_QUEUE.md)
  and [strategic reset brief](../../ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md).

## Durable Memory

The reviewer-matching research and decision record is preserved in the dated archive
linked below; the remaining dated subsections retain implementation and release history.
Current direction and work priority are summarized above and in the canonical queue.

### Dated reviewer-matching research and decision history

The dated research and decision record is preserved verbatim in the [historical archive](../../archive/REVIEWER_INSTITUTION_RESEARCH_HISTORY_2026-10-22.md); its benchmark figures, withdrawn conclusions, and owner decisions remain intact there. Treat that record as historical, not as current sequencing or release authority.

For current constraints and source contracts, see the reviewer identity/origination
direction bullet above and the linked hubs there. This historical record does not set
current sequencing or release authority.

### Dated implementation and owner-decision history

The entries below are historical implementation and release snapshots. Use
`docs/CURRENT_WORK_QUEUE.md` for current priorities. Queue item 5 records the
Final Writeup dashboard's implemented contract and dated 2026-09-06–07 release
smokes; it does not call for another filter build. Queue item 6 now records the
implemented automated materials-on-acceptance email and its remaining observation
and wording work. Its shared claim/manual-fallback boundary is summarized above. The detailed reviewer lifecycle and
release evidence below is retained as history.

Review-DOCX release complete 2026-09-03: the formatting work is Production-live
at `3101f067` in Ready deployment `dpl_AjT5FeDh5wkdeFSoZWJsVDM5oBqs`.
  The existing Reviews-tab action remains one combined, server-authoritative
  download, and the thank-you sweep produces the separate individual courtesy
  attachment. No SharePoint export registry/upload is part of this phase. New
  categorical rows snapshot the complete option set. Production Wave 25 was
  owner-approved, applied, and read back exact. Signed-in Request `1002903`
  generated a valid 60,586-byte aggregated DOCX with 2xx route dependencies and
  no post-deploy error logs. The courtesy path is deployed/tested but was not
  transport-smoked. Final Writeup persona access proof, tracked enablement, and
  the six-case read-only production-data smoke completed 2026-09-03 PT.
  **[OWNER-REPORTED 2026-09-04]** Program Coordinator Duncan Spore then found
  Request `1002788` in History, saw the matrix, and opened the Word document.
- **Most recent owner-directed release (S470, 2026-08-30 PT / 2026-08-31 UTC):**
  Final Writeup Slice 1 is Production-proved on `main` at `ebb147bb` in Ready
  deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ`; Wave 22 is exact and
  `FINAL_WRITEUP_SCHEMA_READY` is literal `on`. Signed-in Request `1002788`
  retained its current Pre-Site pointer, moved that row to lifecycle Final,
  created one current Ready/Review Final row, recorded Justin Gallivan at the
  transition time, and retained the exact same SharePoint item/version/hash/
  size. File cardinality did not change. Version-aware acknowledgements and the
  bounded ordinary-staff dashboard/focused-review foundation are now
  Production-deployed through PR #140 merge `ce229778` / Ready deployment
  `dpl_P7xay61LHnxohad9FEtSniBAosuY`; the acknowledgement readiness value
  is exact `on` in Ready deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo`.
  Signed-in reads and responsible-PD exclusion passed. An eligible colleague's
  first POST then isolated a missing acknowledgement Create privilege without
  persisting a row. Commit `6659bba2` tracks the dedicated reviewer role; its
  approved Production apply and independent readback proved direct assignment
  and all six requested Global privileges effective for the full 11-person
  audience. The colleague's post-role retry succeeded, appeared in review
  history, and produced the independently verified first complete row.
  **[PRODUCTION-LIVE + SIGNED-IN READ SMOKE PASSED 2026-08-31]** commit
  `52575761` and Ready deployment `dpl_Frc6fAonyFFYwiWyFJCzzE3UNune` ship the
  complete neutral current-Final × exact reviewer-role matrix. Signed-in
  Production DOM proof showed the exact 11-person roster and correct Request
  `1002788` states/actions with zero browser-console errors. The version-2 Final
  Writeup staffing contract and consolidated Admin editor are
  Production-deployed at `84bf465b` in Ready deployment
  `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS`. Signed-in
  readback initially proved the stored v1 setting contained nine Research and
  six Southern California reviewers. On 2026-09-01 UTC, the dry-run-first
  command upgraded the setting once; exact readback proved v2 at
  `W/"96944113"`, all 11 assignments, zero stale/unassigned rows, and unchanged
  9/6 audiences. Representative Word-access proof passed 2026-09-03 (President
  Allison Keller; PCs Duncan Spore and Sarah Hibler; owner-reported). Commit
  `213f6c34` then enabled persona lenses in Ready Production deployment
  `dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`; read-only production-data smoke passed
  for PD, PC, Leadership, overlap, ineligible/unassigned, and superuser
  projections. The unshipped
  no-privilege-team prototype is removed from current source and created no
  Production teams.
- **Prior owner-directed release (S469, 2026-08-30):** durable Executor
  budgets are Production-deployed; the owner published the first revision
  `executor.budgets.v000001` on 2026-09-07 (S493), pinning the reviewed code defaults.
  Initial Assessment superuser restore and exact byte-copy Board snapshots are
  Production-deployed through PR #138 (`c519daf6`); the relevant gates, full
  9,205-test suite, webpack build, and post-merge checks passed. Signed-in
  Request `1003109` passed the artifact/control/version-history read smoke.
  Restore and first-snapshot writes remain unexercised and deferred to an
  explicitly authorized pre-J27-scale checkpoint.
- **Staff Deliberations tab (S466, 2026-08-28, production):** the Pre Site
  Visit Writeup + Site Visit tabs are merged into one stage-aware workspace
  (`shared/components/workbench/StaffDeliberationsTab.js`, rail
  Draft → Share → Wrap Up; legacy `pre-site-visit`/`site-visit` tab keys
  alias in). Wrap Up derives from the server's per-source-document
  `currentSourceEverSent`; the in-app logistics editor and calendar UI were
  removed by owner decision (headless `useSiteVisitContext` +
  ActivityParty fallback keep the composer fed). The production-proof
  entries below describe the pre-merge two-tab UI; their document-lifecycle
  guarantees are unchanged. (Rail superseded by PC Meeting Tracker slice 3,
  2026-09-09 — four keyed stops with admin-editable labels; see
  `docs/PC_MEETING_TRACKER_PLAN.md` §7.) A prior session handoff linked a
  Site Visit Workspace proposal artifact; that link is not available in the
  current workspace.
- **Curated Site Visit recipient directory (S468, 2026-08-29, production):**
  superusers curate at most 50 active app-staff/existing-Contact references for
  the materials composer's Consultant/Board menu. The Dataverse setting stores
  references/categories only; names/email resolve live; search never writes a
  Contact. Configured people are choices, never automatic draft recipients.
  Name search performs one bounded 51-row probe, returns at most 50, and tells
  the UI when more matches exist. Owner verified the broad `smith` warning in
  Production after merge `c5efa770`.
- **Institutional Funding History filled from Dataverse (S467, 2026-08-28,
  production):** `lib/services/pre-site-visit/funding-history.js` renders the
  `AI:InstitutionalFundingHistory` placeholder sentence from the account rollups
  `wmkf_countofprogramgrants`/`wmkf_sumofprogramgrants`, fail-closed against
  the live rows matching the rollups' predicate (`wmkf_typeforrollup eq
  'Program' and akoya_grant gt 0`); the cited award is the newest
  **Research**-program grant by `akoya_decisiondate ?? wmkf_meetingdate`
  (owner decision). Snapshot schemaVersion 3 at S467; Reviews Tab Slice 4 (PR #296, merged
  b9ad64eb, production `wmkfresearchapps-adp2hh965` Ready 2026-09-15 UTC)
  bumped it to schemaVersion 4 to add `request.refereeSection` — **production
  now writes v4; v2/v3 Ready rows remain readable and carry a
  `referee_section_manual` warning until regenerated** (see
  `docs/atlas/dataverse-wmkf-requestdocument.md`). Pre-S467 Ready rows carry a
  `funding_history_manual` warning. Proven on `1002379` (zero-count branch);
  the positive branch is probe/test-proven only. Hazard: `akoya_mostrecentgrant`
  is NOT type-filtered — never cite it. Request `1002379`'s writeup state was
  then fully cleaned (2026-08-29 UTC; `docs/audits/request-1002379-test-mutation-inventory-2026-08-28.md`).
- **Production-proved Site Visit handoff (2026-08-21):** after exact owner
  approval, signed-in Request `1002379` moved the current Pre-Site Word
  workspace Draft→Review, kept the same SharePoint Edit/Download identity,
  recorded the complete milestone under the service's post-write readback, and
  locked Pre-Site regeneration. The later Site Visit dossier remains separate;
  the same-item Final transaction was subsequently Production-proved on Request
  `1002788` on 2026-08-30 PT / 2026-08-31 UTC.
- **Production-proved post-handoff receipt (2026-08-21):** commit `b3bb0ef6` first reached Production in Ready deployment
  `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi` and makes Pre-Site controls Draft-only.
  Review displays a read-only receipt with one Site Visit continuation action;
  later, unknown, and missing-link states fail closed. Signed-in Request
  `1002379` verified zero Pre-Site work controls, one continuation action, and
  the expected same-item Site Visit Edit/Download workspace and handoff time.
  No document or write action was invoked; the request showed no warning panel.
- Current Workbench truth and contradictions:
  `docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md`.
- Historical Workbench execution details remain in
  `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`; they do not override the
  current sequence in `docs/CURRENT_WORK_QUEUE.md`.
- Writeup artifact direction (owner-decided 2026-07-28): SharePoint Word is the
  canonical editable narrative; Dataverse is the typed document
  registry/workflow/structured-decision authority; Microsoft Search supplies
  body search; version recovery, retention, least-privilege editing, and frozen
  Board milestones are required parts of the design. Initial Assessment is
  distinct; Pre-Site, Site Visit, and Final share one
  stable Word item across distinct registry/lifecycle rows. The Pre-Site Word item
  remains the PD workspace during the Site Visit stage, with observations
  preserved through native SharePoint versions. **Ready for group review**
  records the exact current Pre-Site row/version/hash in a Final lineage row
  that references the same drive/item; it creates no editable sibling and the
  first release has no regeneration or backward-stage UI. The Initial Assessment registry
  and request pointer are live in Production, governed prompt v1 is
  provisioned, and the application is deployed as of 2026-07-30.
  The controlled Request `1002788` rehearsal proved generation, registry and
  pointer lineage, both consumers, native version creation, and exact-input
  retry. It exposed a recovery-hash mismatch and a null AI-run request lookup.
  Production commit `9c88a1fa` has normalized DOCX hashing and future-run
  request linkage. Request `1003109` production-proved the canonical proposal,
  exact-input reuse, and a new AI run with the correct request lookup.
  A controlled interrupted-finalization retry then restored the same
  row/run/SharePoint item and version without another model call or upload.
  An attributed substantive edit then advanced that same stable item to
  SharePoint version `2.0`, replaced the Foundation Opportunity marker, and
  remained reachable through both consumers. Response-only Graph-current
  refresh and display in both consumers are deployed and live-verified on
  Request `1003109` via deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`;
  native previous-version inspection/restore and signed-in first-stage
  recycle recovery also passed in the production Request library.
  Administrator evidence closed version limits and second-stage recovery
  (2026-08-10 / 2026-08-20; Members hold Edit on a Public M365 group site);
  retention and the Edit level's Delete flags stay owner-accepted-open.
  **[PRODUCTION-DEPLOYED + SIGNED-IN READ-SMOKED 2026-08-30; WRITES NOT
  PRODUCTION-EXERCISED]** Workbench history, superuser native-version restore,
  and immutable Board milestone snapshots are live through PR #138. Board snapshots copy the
  exact canonical version bytes into a distinct Request Document / SharePoint
  item and never move the request's editable pointer. Relevant gates,
  adversarial review, promotion, and signed-in read proof are complete.
  Restore and first-snapshot write proof remain owner-gated. See
  `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and the near-term
  plan.
- Pre-Site persistence schema (owner-approved and Production-live 2026-08-17):
  Wave 19 adds 12 `wmkf_requestdocument` fields and the optional
  `akoya_request.wmkf_CurrentPreSiteVisit` / `wmkf_CurrentFinalWriteup`
  lookups. Independent post-apply metadata readback reported 14 exact and zero
  divergent; the immediate post-apply row inventory remained three Initial
  Assessments and no Pre-Site artifact. **[VERIFIED IN PRODUCTION 2026-08-17]**
  commit `abfe5529` deployed the adapter/writer, registry-returning route, and
  stable Word-link UI. Request `1002379` then created Ready/Draft row
  `aeb223a2-849a-f111-b8db-70a8a59cded0`, governed v3 run
  `ba0f42b9-849a-f111-b8db-6045bd008868`, stable Word item
  `01G4GVMS3Q5BJ65S7DDZDKFTSQLIQAIPER`, and the then-current request pointer. Exact
  Ready retry reused the same identities; the dated 2026-08-17 inventory was
  four Request Documents, including one Pre Site Visit. The 2026-08-21
  signed-in handoff proves the current pointer is now Ready/Review; it did not
  refresh the aggregate count or expose the current row GUID.
- Pre-Site input direction (owner-decided 2026-08-17; source/test contract
  revised 2026-08-17): draft factual material from the exact AI Materials
  narrative only through governed `pre-site-visit.proposal-core.generate`;
  supply authoritative request metadata from Dataverse; use
  `review-synthesis.generate` over all currently submitted reviews; and allow
  distribution with zero reviews because the Site Visit date controls timing.
  Late reviews regenerate only the synthesis and mark the review-derived
  section stale; they do not silently replace staff-edited Word prose or
  regenerate the factual core. Use a versioned prompt/template pair based
  initially on the supplied examples. The guarded proposal-core service and
  version-1 template renderer are Production-live; Request `1002379` proved
  exact narrative resolution, governed generation, registry persistence,
  stable Word upload, current pointer activation, and no-duplicate Ready retry.
  The authenticated Workbench route returns a registry DTO; the tab exposes its
  stable Word link and retains stale-request cancellation. Prompt v4
  `74409f95-509b-f111-b8db-6045bd008868` (reviewed `claude-sonnet-4-6`,
  exact-readback verified 2026-08-18) was later re-published as sole-current
  v5 — unattributed, content-identical per the runtime exact-match preflight.
  The controlled signed-in generation proof PASSED 2026-08-27 (Request
  `1002852`: Ready-with-warning under v5 + exact no-duplicate retry;
  hard-failure smoke skipped by owner decision, test-proven; see
  `docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md` §Status). The bibliography remains reserved
  for next-cycle Reviewer Finder. The latest audited Executor evidence is the
  completed governed v3 Request `1002379` run
  `ba0f42b9-849a-f111-b8db-6045bd008868`. A prior direct exact-v3 model/render QA
  correctly applied the revised personnel rules and roster-name underlining,
  but Methodology's final sentence spilled to page 4; the direct QA created no
  `wmkf_ai_run`. The Production render now fits Background and Methodology on
  page 3 and passes the agreed personnel layout. The initial long browser call
  displayed `Failed to fetch` after durable server completion; exact retry
  recovered the existing Ready link. **[DEPLOYED TO PRODUCTION 2026-08-17;
  SIGNED-IN FEATURE SMOKE OPEN]** read-only current/pending status loading plus bounded GET polling
  now recover a lost POST response without repeating POST. Production template
  v2 added Recommendation-cell padding and created a distinct Ready artifact,
  but Word Online exposed a width-sensitive Recommendation-label alignment
  defect. **[INFERRED FROM SCREENSHOT + OOXML WIDTH]** implicit wrapping was
  the remaining layout variable. **[DEPLOYED TO PRODUCTION 2026-08-17;
  SIGNED-IN FEATURE SMOKE OPEN]** template v3 makes that label explicitly
  non-wrapping under another generation identity. The public sign-in/auth
  boundary passed; signed-in current-status, compact actions/download, and Word
  Online v3 proof remain open. The older `phase-ii.summarize` row still drives no
  route, while the legacy retained PDF route still uses
  `createSummarizationPrompt()`.
- Frozen Pre-Site distribution (**owner-decided and Production-proved
  2026-08-24 on Request `1002379`**; Pre-RP Brief slice 4 is now on `main` in the
  PR #307/#308/#309 merge history; queue item 12 records the dated 2026-09-17
  release smoke; the distributed document is the Pre-Research Presentation Brief, not the Pre-Site writeup — `docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md`): the send is explicit and
  informational, never a handoff side effect. It first retains an exact Word
  snapshot, optionally derives PDF from that immutable item, and lets staff
  attach DOCX, PDF, or both. Recipients are known staff/consultants entered by
  staff, so syntax/dedupe/To-Cc conflict checks apply without a separate
  identity-confidence/directory gate. Postgres migration 034 supplies the
  exact-preview/recovery ledger; granular Dynamics activity/attachment/send-
  intent state and status readback prevent duplicate retry. PDF-only operation
  `85f52fc5-fb48-4ceb-84d6-0f246af0b6fb` retained exact Ready/Board Ready DOCX
  and PDF rows, persisted one `sent` ledger row, and produced a Dynamics Sent
  activity with actor attribution and one hash-matching attachment to
  `jgallivan@wmkeck.org`. Workbench history surfaced the receipt and a bounded
  Production error-log scan was clean. Dynamics appended its CRM tracking token
  after preview acceptance; inbox delivery remains unverified.
- Site Visit direction (owner-decided 2026-07-28): the tab is a dossier, not a
  fourth writeup. Its logistics are date, time/time zone, format,
  location/link, lead PD, WMKF staff, applicant participants, and
  Board/consultant participants; no separate visit-status field is needed.
  **[PRODUCTION-PROVED 2026-08-25]** the
  existing `wmkf_sitevisit` Activity now owns that schedule, IANA zone,
  format, location/link, organizer/attendee parties, and server-owned recipient
  reference map. Wave 21 is exact in sandbox and Production; migration 035
  extends the existing distribution ledger and the legacy roster email mapping; the
  readiness flag is literal `on` in Preview/Production. Reversible sandbox
  write/cleanup proof passed. Signed-in Request `1002379` created and
  round-tripped one active Site Visit with five ActivityParty rows; calendar/
  material operation `f497643a-2e9e-4032-a323-1e40874d16f1` reached `sent` with
  the saved visit, one governed material, and no final error. Calendar semantics
  remain informational `METHOD:PUBLISH`, not RSVP/update/cancellation
  scheduling; `sent` proves Dynamics transport acceptance rather than
  independent inbox/calendar-client delivery. Production UX follow-ups split
  date/time controls, hide the daylight-saving panel, force the organizer into
  `To`, fix false JSONB material-staleness, and add a time-zone dropdown that
  defaults new visits to US Pacific.
  Its file categories are applicant slides, other applicant materials,
  recording, transcript, and transcript summary. Staff observations are direct
  edits in the existing Pre-Site Word workspace; do not add a separate
  Dataverse notes area or Site Visit Writeup. Do not add a general material-revision
  workflow absent observed need, but the applicant surface explicitly supports
  recoverable delete/replace rather than inferring replacement from duplicate
  files. Pre-Site distributions and Final remain linked writeups, not material
  categories. A narrow expiring applicant-material upload link is in scope
  without reopening the parked general intake product; it accepts PDF/PPTX and
  additional uploads while active, capped at 1 GB per file and 20 current
  applicant files per request. Files land inside the request's governed
  SharePoint folder under the flat `Site Visit - Slides`,
  `Site Visit - Participant Bios`, or `Site Visit - Other` folder.
  Successful uploads, replacements, and deletions are batched into a short
  automated digest to the lead PD plus the still-to-be-defined relevant staff
  audience. A program coordinator may be among the recipients, but the design
  must not hard-code that role as the only additional recipient. An authorized
  staff user manually triggers the
  request; a visit-date change never sends it automatically. Recipient choices
  are the Dataverse-linked liaison and PI—normally liaison in To, or PI in To
  with liaison optionally copied. Missing, invalid, or duplicate selected
  addresses block sending until staff corrects Dataverse; there is no free-form
  bypass. To and CC share one request-scoped link and may manage the same file
  list; without sign-in or personalized links, the audit does not promise
  PI-versus-liaison attribution. Applicants see current files and operation
  confirmations only. Staff sees action/file/category/size/time/request/link
  metadata and uses native SharePoint recovery; no custom applicant or
  Workbench restore control is required initially. Visits are scheduled
  promptly after advancement around reviewer invitations; once the date is
  recorded, staff may send without waiting for reviews, synthesis, or a
  Pre-Site Writeup. Expiration is automatically 60 days after successful send,
  requires no staff-entered date, and is unaffected by visit rescheduling.
  Resend preserves the active link and original expiry; Reissue/restart stages
  a replacement and revokes the old link only after the new invitation is
  accepted for sending, so a failed replacement does not destroy a still-active
  link. No standalone Revoke action is needed in the minimum product. Any
  staff member with Workbench Site Visit
  access may send, resend, or reissue. Exact sender/reply-to and lead-PD copy
  behavior remain open pending the owner's staff discussion; historically,
  non-PD staff sent these requests without PD involvement, but that is not yet
  the future contract. The large-file scanner contract and the additional
  notification audience/digest window remain open. SharePoint
  remains the byte store; a new
  resumable Graph upload-session path is required because the current buffered
  helper stops at 60 MB. Dataverse holds the artifact registry and Postgres only
  the expiring-link/resumable-session workflow state.
  Prefer an acceptable
  transcription-platform summary before a deliberate suite LLM fallback.
  Transcript provider, handoff, timing, and ownership details remain pending
  coordination with a program coordinator.
  Exact token, schema/read model, validation, folder, retention,
  summary-quality, and partial-failure contracts remain planned.
- Final Writeups Dashboard direction (owner-confirmed 2026-08-30; pilot list implemented
  in source 2026-07-29): preserve Allison's
  former single-folder editing workflow with a staff-wide cycle list of
  governed writeups, direct Open in Word, and an explicit per-editor Reviewed
  tracker. The pilot cycle list/direct Word entry uses the existing `reviewers`
  app grant; live SharePoint permission verification remains pending. All PDs
  are expected eventually to evaluate the materials and designated staff
  proofreaders also need access. The global role-eligible audience is all PDs,
  PCs, CSO, and President; per-request matrix assignment is configured by the
  request's broad Grant Program. Anneli Stone and Saskia Pallais are
  owner-confirmed Southern California staff and should not appear on Research
  requests. It reuses the typed registry and canonical SharePoint file;
  every edit/review action opens Word in a separate window/tab and it is not a
  second editor. Acknowledgements key to Final artifact + observed publication
  version. The full coordinator matrix is required, with neutral blank,
  Reviewed, and Updated since review states and no compliance semantics.
  **Source status 2026-08-31:** the ordinary-staff queue and focused review
  foundation are Production-live behind the exact `on` acknowledgement gate.
  Signed-in dashboard and Request `1002788` Final reads passed with zero
  reviews, external Word access, and correct responsible-PD exclusion. The
  first eligible POST then failed on missing acknowledgement Create and left no
  partial row. The dedicated role is now assigned/effective for all 11 confirmed
  audience members; the post-role retry succeeded and its review-history state
  and complete acknowledgement row passed independent readback. The services derive
  ownership/actions server-side and cap and batch reads. Persona-specific
  responses use explicit v2 assignments and never infer from names, titles, or
  program audiences; configured PCs and fresh superusers receive the full
  matrix on the index, while focused responses do not. **Production-live + signed-in
  read/write proved 2026-08-31:** commit `5573bca3` is live in Ready deployment
  `dpl_5DNuc2BV76RihwuWu8ZFYBgxBXE7`. The published Research audience contains
  nine current reviewer-role members and excludes owner-confirmed Southern
  California staff Anneli Stone and Saskia Pallais. Admin publication/readback
  survived reload; Request `1002788` rendered under Research with exactly those
  nine columns and zero application-console errors. A later signed-in readback
  from the v2-capable Production deployment proved the stored v1 setting also
  contained a six-person Southern California audience. The 2026-09-01 UTC v2
  migration preserved both audiences exactly at ETag `W/"96944113"`.
- **Historical calendar and pilot direction (owner-confirmed 2026-07-28):** the
  first human-in-the-loop Initial Assessment pilot had an internal 2026-08-10
  buffer before the expected 2026-08-18 proposal arrivals. The owner explicitly
  said the buffer was early and not an external commitment (2026-08-10 / S412);
  it is not a current deadline or queue item. The 2026-07-29 environment choice
  was a controlled Production rehearsal with colleague-created representative
  requests, not an integrated sandbox application/file environment. The dated
  Request `1002788` and `1003109` rehearsal results and owner-gated restore and
  Board-snapshot proof are preserved in
  `.claude-memory/project-j27-doc-capture-history.md`; consult the current
  queue and transition register for present sequencing and release authority.
- **2026-09-07 note (J27: J27-051):** the 2026-08-18 date above was the D26
  Phase II proposal due date, not J27 intake. J27 proposals arrive in early
  December 2026, exact date TBD (owner, 2026-09-06). See
  `docs/J27_TRANSITION_REGISTER.md` row J27-051.
- Strategy/system model: `project-system-model`, `project-strategy-direction`.
- Virtual Review Panel (legacy, retired 2026-10-04): `project-virtual-review-panel`.
- Roadmap snapshots: `project-app-roadmap-2026-04-25`, `project-phase-i-summary-app-winddown`.
- Phasing/cycle scoping: `project-grant-phasing-evolution`, `feedback-cycle-vs-executor-scope`, `feedback-concepts-vs-phase-i`. Every J27-sensitive site (retire / persist / change / build / scale) lives in `docs/J27_TRANSITION_REGISTER.md`; add there, not here.
- J27 document-capture & Proposal-tab evolution (document identity/metadata →
  typed Dataverse registry; file bytes and editable narrative remain in
  SharePoint; D26 filename-match is interim; near-term planning):
  `project-j27-doc-capture-evolution`.
- Historical Group B writeup proposal: `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md`. Its proposed
  URL fields and `writeup.*` prompt rows are not live, and its D26 pilot timing is obsolete.
- Historical staged-review design and deferred proposal-context decisions: `project-staged-review-pipeline`, `project-proposal-context-extraction`. Neither is a ready-to-execute architecture.
- Planned automation/reports/post-award/AI: `project-backend-automation`, `project-interim-report-automation`, `project-awardee-onboarding`, `project-new-ai-capabilities`.
- IRS verify-EIN: `project-irs-exempt-verification`.

## Standard Probe

```bash
rg -n "roadmap|phase|cycle|interim|post-award|proposal extract|review pipeline|EIN" docs .claude-memory DEVELOPMENT_LOG.md
```
