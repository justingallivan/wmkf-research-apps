---
title: Staff Deliberations Briefing and Post-Visit Writeup Rework
domain: workbench
kind: plan
status: implemented
summary: "Source-built request-first Staff Deliberations flow with guarded scheduled-end working-writeup preparation and explicit staff review. Not deployed to production; production automation remains disabled and unscheduled."
canonical: false
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Staff Deliberations: briefing to post-visit writeup

## Purpose and decisions

[OWNER DECISION, 2026-10-04] The lighter pre-site briefing is now the primary pre-presentation circulation document. Leadership wanted preliminary information presented less formally. The full Pre-Site draft remains useful as an optional staff working document before the visit and as the foundation for the final writeup. Findings needed to complete that writeup come from the actual site visit/research presentation.

[OWNER DECISION] At the meeting's **scheduled end time**, automatically prepare the full working writeup for post-visit editing. Preserve an existing document and all staff edits. When no full draft exists, generate its foundation, then prepare it for editing. Staff explicitly decide when their additions are ready for colleague review; leadership review remains a later explicit action.

[OWNER DECISION, 2026-10-04] Respect the selected grant program and grant cycle. “Assigned to me” shows requests for which the signed-in staff member is the lead PD; “All program directors” also shows requests handled by other PDs within that same program and cycle, matching other Workbench surfaces. Both scopes include requests with no briefing or writeup. Changing PD scope never expands the grant-program or cycle scope and never grants additional mutation permissions.

[SOURCE-BUILT 2026-10-04 on `codex/staff-deliberations-rework`; not deployed to production.] The earlier manual “Start Site Visit” prerequisite and read-only-only scope are superseded. The worker and human review guards are implemented behind fail-closed configuration; production automation is off and no cron schedule is registered. Migration 067 is source-only and unapplied. This plan does not authorize production activation, catch-up writes, or AI generation. No production records were read for this implementation; exact D26 counts remain UNKNOWN.

[OWNER DECISION, 2026-10-05] Rehearse on a dedicated marked production test request using existing application and Test Request Factory controls. Do not build out the sandbox or create one-off testing infrastructure. The request number and concrete production writes must be agreed before execution; this decision does not authorize migration, deployment, or broad automation activation.

## Current evidence and implementation boundary

Reviewed runtime checkpoint: `bc638dfe8` on `codex/staff-deliberations-rework`, with documentation reconciliation in `51835eef5`. The source and offline test evidence below do not establish deployment, live schema readiness, or production automation.

| Finding | Source evidence | Consequence for this plan |
|---|---|---|
| [VERIFIED via source] The reworked overview and detail use scheduled **end**, preparation facts and explicit review state independently of the brief lifecycle. | `shared/components/workbench/StaffDeliberationsPanel.js`; `StaffDeliberationsTab.js`; `lib/services/pre-site-visit/preparation-worker.js` | The legacy composite helper is no longer the task-status authority for these surfaces. |
| [VERIFIED via source] The cycle list starts with scoped requests and joins optional document facts. | `lib/services/pre-site-visit/cycle-list-service.js`, `listPreSiteVisitDrafts` | Documentless requests remain visible in the selected program, cycle and PD scope. |
| [VERIFIED] Explicit promotion keeps the same SharePoint item and records a verified version/hash/time; a complete Review milestone returns without re-stamping. | `lib/services/pre-site-visit/site-visit-transition-service.js`, `startSiteVisitStage` | Reuse its document safeguards, but add a scheduled-event fence and honest automation attribution. |
| [VERIFIED] Generation has claims, recovery and pointer fencing, but can regenerate an existing Draft. | `lib/services/pre-site-visit/artifact-service.js`, `generatePreSiteVisitArtifact`; `artifact-lineage.js`, `commitReadyLineage` | Automatic preparation needs a missing-only generation contract; simply calling the existing generator is unsafe for staff edits. |
| [VERIFIED] Starting Final Writeup starts group review and stamps its actor/time, using the same Word item. | `lib/services/final-writeup/transition-service.js`, `startFinalWriteup`; `transition-claims.js`, `activate` | The scheduled worker must NOT call this transition. A prepared working writeup is not a Final/group-review artifact. |
| [VERIFIED] Calendar, session, materials and document actions have additional stage-dependent consumers. | `StaffDeliberationsTab.js`, `StaffDeliberationsPanel.js`, `FinalWriteupTab.js` under `shared/components/workbench/` | Migrate every action condition, not just the rail. Preserve session/materials visibility. |
| [VERIFIED via source] The shell passes the selected program, cycle and ownership scope to Staff Deliberations. | `shared/components/workbench/WorkbenchShell.js`; `pages/api/workbench/staff-deliberations.js` | Server selection validates program/cycle/scope and never broadens a missing caller identity to all PDs. |

Read-contract references: `docs/atlas/dataverse-wmkf-sitevisit.md` documents UTC scheduled start/end, local display zone, and active-only readers; `docs/atlas/dataverse-wmkf-requestdocument.md` describes document lineage and review checkpoints. The source-built worker, receipt, route authorization, UI, and schedule fences are not production-provisioned or live-verified. The automatic writer is deliberately disabled and unscheduled.

## UX brief — Impeccable / Operate

**Audience and job.** Program directors and staff need to circulate preliminary information before a presentation, then finish a substantive writeup afterward without manually reconciling workflow statuses. Leadership must not mistake a polished foundation for a completed assessment.

**Design authority.** Preserve PRODUCT.md and DESIGN.md: Inter, neutral surfaces, compact hierarchy, existing controls and focus treatment. Use Impeccable Shape and Operate guidance. No rebrand, extra dashboard metrics, decorative animation or new navigation framework. The supplied Workbench screenshots are evidence of the confusion, not a template to preserve the rail.

**Primary distinction.** Organize around the staff task: “Before presentation”, “Preparing writeup”, “Post-visit editing”, “Group review”, “Leadership review”, with “Schedule needed” or “Needs attention” where appropriate. These are user-facing projections, not new persisted document enums. Do not use the same green Visit dot for a passed date and a completed document action.

### Cycle list

Every in-scope request appears once. Keep request number/title, institution and PD prominent. Show one concise task status, presentation date/time with timezone, briefing state and working-writeup state. Preserve the deliberation-session line, applicant-materials information and test-record badges. Session scheduling and research-presentation timing are separately named; neither substitutes for the other.

Use one primary navigation action per row. Explicit secondary links say “Open briefing in Word” and “Open working writeup in Word”. Scope appears beside the total: grant program, cycle, and Assigned to me / All program directors. The task-status filter defaults to All (distinct from the PD ownership scope); offer Before presentation, Post-visit work, In review, Needs attention plus text search. Missing/ambiguous schedules remain visible. Define one primary bucket with precedence: confirmed review state, blocking exception, due/preparing/editing, upcoming, unscheduled; counts derive from the same request IDs. Independent dates remain visible after review begins.

Ordinary totals retain test exclusions and separately identify visible test rows. Unknown or capped results never show an unqualified total. “No sharing recorded in this app” is not a claim that staff never emailed the briefing.

### Per-request Staff Deliberations

Before the presentation, lead with **Pre-site briefing** and its existing explicit Share action. Supporting copy: “Preliminary information for the research presentation.” Keep the canonical artifact and external briefing permissions separate from the full working writeup.

Show **Working writeup** below it, marked “Optional before the presentation”. If absent, offer “Prepare working draft”; if present, offer “Open working writeup in Word”. Explain that the fuller document carries forward after the presentation. Do not automatically generate, regenerate or send the briefing as part of this workflow.

At scheduled end, move the working-writeup section into the primary position. The briefing stays accessible below with its sharing history; reordering must not steal keyboard focus or close an active composer. Display “Preparing working writeup…” until the durable operation is confirmed. Then display **Post-visit editing** with “Add findings from the research presentation, then mark the writeup ready for group review.” Opening Word stays the primary action. A secondary “Review readiness” link takes the user to the existing Final Writeup surface; it does not start review.

On Final Writeup, retain the explicit **Ready for group review** confirmation, actor restrictions, and later **Ready for leadership review** confirmation. Update prerequisite copy to point to preparation progress or a recoverable error, not “Start Site Visit”. Before scheduled end, do not offer group-review initiation for this workflow. The matching server rule must agree with the UI. Already-started legacy reviews remain usable; no automatic downgrade.

Illustrative states (not production readbacks):

```text
Before presentation · Sep 28, 10:00–11:00 AM [meeting timezone]
Pre-site briefing    Draft                         [Review briefing]
Working writeup      Optional · Draft available     Open working writeup in Word
Deliberation session [recorded session or explicit availability state]

Post-visit editing · Scheduled presentation ended Sep 28, 11:00 AM
Working writeup      Ready for your visit findings  [Open working writeup in Word]
Pre-site briefing    [actual sharing receipt]       Open briefing in Word
Add your findings, then review readiness.            Review readiness →
```

Use neutral styling for elapsed time; green confirms prepared availability or an actual recorded review state. Never claim attendance or completion from the clock. Keep errors inline and actionable. On narrow screens stack facts and actions under each request; no horizontal progress rail. Long titles wrap, status text remains readable, and document links name their destination. Use existing touch targets, visible focus, labeled controls, semantic headings and polite announcements for background preparation; avoid repeated announcements on each poll.

## State and action contract

The state and action contract below is source-built and fixture-tested. “Due” means a uniquely resolved eligible research-presentation activity has a valid UTC end at or before server time. Invalid/missing end is not replaced by start time or midnight. Read failure is not “not scheduled”.

| Condition | Display / next action | Automatic effect |
|---|---|---|
| Future end; no full draft | Before presentation; briefing primary, optional Prepare working draft | None |
| Future end; current full draft | Before presentation; optional Word editing | Preserve file and lifecycle |
| End passed; current Ready/Draft | Preparing, then Post-visit editing | Record handoff on the same Word item after fresh checks |
| End passed; genuinely no full draft | Preparing working writeup | Generate foundation once; then promote after Ready readback |
| Generation already in flight | Preparing working writeup | Join/reconcile existing work; never launch a competing generation |
| Complete existing Review handoff | Post-visit editing | Reuse, no re-stamp or regeneration |
| Existing Final/group/leadership review | Corresponding review state | No generation or downgrade |
| Failed input, broken pointer, incomplete milestone, duplicate schedule | Needs attention; existing file link remains if verified | Stop affected operation, explain repair/retry; never infer missing |
| Cancelled, missing, future-moved or invalid schedule before promotion | Before presentation / Schedule needed / Needs attention | No promotion; cancel or defer pending work |
| Schedule moved/cancelled after promotion | Preserve editable file; show schedule changed | No rollback or re-generation; block new review until current eligibility is resolved |

“Prepared” means ready for staff editing, not that visit findings were automatically written. The generator uses its governed foundation inputs; it must not invent observations or imply that it incorporated a transcript. Transcript extraction/augmentation and changes to briefing content are out of scope.

### Replace every composite-stage condition

- Brief Share/Resend conditions currently involving `stage === 'shared'` and `substate`: use the brief's exact file, lifecycle, regeneration state, send receipt and existing preview/recipient permissions. A passed visit never hides an otherwise valid sharing action.
- The draft prerequisite currently under `stage === 'visit'`: use due/preparation state and the full writeup checkpoint. Replace manual-start instructions with preparation/recovery copy.
- Continue in Final Writeup currently under `stage === 'visit' && preSiteShared`: use confirmed post-visit preparation and current schedule eligibility. Never initiate review from navigation.
- Rail hiding under `beyond`, `visitExpected()` counts, session/materials visibility: replace with independent total projections; keep session/materials lines and their actual availability states across all task phases.
- The generic Word link and “Not the current draft” warning: bind to a named brief or full-writeup identity independently. A stale brief must not mislabel the writeup.
- Reopen/correction cycles, group/leadership review, acknowledgements and Final dashboards retain their contracts. Automation must not re-promote a staff-opened correction cycle. Retain a clearly labeled human “Finish corrections” handoff for the resulting Ready/Draft, using existing correction authorization, current-pointer, version and milestone fences. This exception is not the ordinary manual Start Site Visit prerequisite; it prevents a corrected draft from becoming stranded.

## Request selection and read model

[SOURCE-BUILT] The request-first cohort uses the UTC cycle window, selected grant program, and authenticated lead-PD identity for “my”. “All” omits only the lead-PD predicate; program, cycle and access restrictions remain. List visibility includes documentless and otherwise non-enrolled requests; worker eligibility is separate.

[SOURCE-BUILT, DISABLED] Worker enrollment is narrower than list visibility and uses explicit program/cycle/status allowlists, known Site Visit event classification, and `TEST_REQUEST_ISOLATION=on`. Exact request statuses are compared as Dataverse strings. Withdrawn, cancelled, set-aside, and test records are not automatically generated. Configuration fails closed unless all readiness flags, including guarded correction schema, test isolation, and explicit atomic-fence confirmation, are present. No production allowlist or status mapping has been activated.

The source-built GET projection contains separate `timing`, `brief`, `writeup`, `preparation`, `session`, and `materials` facts, with availability and source identity. It includes server time, scoped count completeness, due time and persisted preparation outcome. This remains a projection contract, not a new document lifecycle value.

Request-first paginated reads join optional artifacts in bounded batches. Resolve canonical pointers even when artifact cycle stamps differ; report contradictions. Never silently select the newest row over a current pointer. Specify legacy/document-only disposition explicitly. Propagate `capped` from request and document reads; replace the visit reader that drops pagination metadata. Ledger failure must not fail or erase the request list: project sharing history unavailable. Add a bounded ledger projection for latest successful sent time and exact source version; current `sentSourceDocumentIds` provides IDs only.

Resolve duplicates consistently on list, detail and worker: ambiguous schedule, no automation. Include completed noncancelled events as eligible evidence after validating target state/status meanings; active-only readers are insufficient. Preserve the existing session/materials readers' responsibilities, but add availability results where their current null-on-error behavior obscures failure. GET, filtering and navigation stay read-only.

## Scheduled preparation and persistence

The source-built server-side due-work scan runs independently of browser visits. It reports completion only after authoritative readback; generation may take longer than the end boundary. No polling interval is registered in deployment, so there is no production catch-up processing.

The authenticated cron entry point and bounded worker use trusted DAL context and the target/write interlock. No external queue/vendor was added. The route exists in source but is not registered as a deployment schedule.

Operational receipts use `staff_deliberations_preparations` with a unique request/event/end/correction-epoch key, bounded leases/retries, exact document ID, service provenance and bounded errors. Migration 067 is in the manifest and fresh-install schema but has not been applied. Dataverse lineage and SharePoint remain authoritative. No human milestone actor is impersonated.

Worker sequence:

1. Paginate enrolled requests/events with a durable scan cursor or equivalent completeness-safe scan. Upsert due receipts under the unique key. One request failing must not prevent other due requests from being processed.
2. Claim a bounded batch with an atomic lease. Re-read request eligibility, schedule identity/end/state, current document pointers, pending generations, correction epoch and existing Final state. Unknown or changed facts defer/block; never proceed from the earlier scan alone.
3. If a current full draft exists, preserve it without invoking generation. For genuine absence, use a new missing-only entry contract on the existing producer. Fence activation against the expected absent pointer and schedule revision; concurrent manual generation wins. Recheck before model work and before activation. Recover stored output/uploads rather than rerunning paid generation after uncertain outcomes.
4. For a Ready/Draft, the worker reuses promotion's version/hash validation and commit-time current-pointer, schedule/end, request-eligibility and correction-epoch fences. It conditionally patches the observed event in the same Dataverse changeset as request/document writes. The assumed same-value event PATCH semantics still require an owner-authorized, bounded production test-request proof before general production enablement; a standalone read just before PATCH is not a cross-record race guarantee.
5. Record automatic provenance without impersonation. Retain existing complete milestones without re-stamping. A complete Dataverse handoff is success even if receipt acknowledgement failed: retry reads authoritative state and repairs the receipt, not the document. A successful receipt without a valid document checkpoint is a reconciliation error.
6. The worker uses bounded retries/backoff for transient transport or file-version conflicts. Configuration errors, unchanged invalid inputs, missing files, duplicate events, and incomplete checkpoints become visible blocked outcomes. Authenticated Retry preparation reuses the same receipt and revalidates eligibility; it cannot force regeneration or bypass schedule rules. Cron returns per-request outcomes, not only success counts.

Generation and promotion need separate checkpoints. If a meeting moves during generation, retain the generated foundation safely, defer promotion, and do not repeatedly pay to regenerate it. No current file is overwritten or replaced by automatic work. Missing-only checks must hold at activation, not just at initial load. A background worker must not supersede an existing edited Draft through the current general generation path.

Before enabling writes, resolve a trusted service-principal execution policy and audit representation. Existing promotion's ALLOW_UNATTRIBUTED policy is not sufficient evidence of an acceptable scheduled-actor contract. Do not borrow the PD's identity or weaken app/DAL restrictions. Reuse existing application provider configuration for authorized application generation; no agent API credentials or new provider integration belongs in this change.

## Delivery record

1. **Complete in source:** product/read contracts, request-first list and per-request status, program/cycle and lead-PD/all-PDs scopes, fixture-pinned schedule eligibility, correction behavior, and explicit review boundary.
2. **Complete in source:** durable receipt migration 067, missing-only generation contract, worker/recovery, atomic Dataverse event/request/document fence, cron and authorized retry routes. Never call `startFinalWriteup` from the worker.
3. **Complete in source:** both Workbench surfaces, independent briefing/writeup facts, preserved session/materials, explicit group/leadership review actions, and Final scheduled-end GET/POST guards with legacy complete-review handling.
4. **Documentation and offline verification: complete on this branch.** Migration remains unapplied. Inventory/canonical-doc updates and scoped gates are recorded below.
5. **Production rollout: not started.** Requires separate owner authorization for migration, readiness flags/allowlists, catch-up and AI generation, with the activity-write rehearsal completed before rollout even when automation remains off. No production writes or email are part of this change.

Rollback: disable enrollment/worker writes first, retain readable receipts and documents, and keep the UI able to show committed preparation. Do not reverse checkpoints, delete files or roll back staff edits. Review transitions already committed remain authoritative.

## Acceptance and verification

- Same past event with brief Draft, Review, missing or externally circulated: request visible and preparation eligibility identical; no sharing inference/resend.
- Existing Word file contains a distinctive staff edit: automatic promotion retains item identity and exact content. The test fails if the edit disappears. General generation is never called for an existing current draft.
- Missing draft: one foundation and handoff despite duplicate ticks, concurrent manual generation, worker crash, upload timeout or receipt-ack failure. Recovery does not pay for a second model run after persisted output exists.
- Future, exact-end boundary, DST/timezone, missing end, cancelled, completed, duplicate and rescheduled events: UI and server agree. Change the event during generation/promotion to test the commit fence.
- An existing correction/reopen epoch is not automatically consumed; stale receipts cannot promote replacement documents. Already-final/reviewing artifacts are untouched.
- Meeting ended but preparation blocked: show Needs attention with a safe retry/repair explanation and verified existing file link; never show Ready or require Start Site Visit.
- Automatic preparation cannot set group/leadership review timestamps, expose a new Final item to leadership, send mail, or mark anyone reviewed. Explicit review start records the real staff actor and requires current readiness.
- Program/cycle/my/all: include fixtures owned by the caller and another PD in the same program/cycle, plus requests in another program and another cycle. “My” includes only the caller’s lead-PD requests; “all” adds other PDs only within the selected program/cycle. Both include documentless requests and preserve access restrictions. Missing identity must not fall back to “all”. Concept/set-aside/withdrawn/test fixtures, pointer contradictions and caps retain correct visibility, separate worker eligibility and honest totals.
- Ledger/session/materials failures leave request identity and other facts visible. Successful send for a different source version does not label the current briefing sent.
- Rapid program/cycle/scope/request switches: fence every late success/error and action response. Verify Share/Resend and Final navigation independent of brief-derived stage.
- Desktop/narrow layout, long titles, keyboard flow, active composer during timed refresh, screen-reader feedback and loading/error states. Inspect both widths once, fix in one batch, confirm once; use Impeccable craft-floor/detector only when implementing UI.

Run affected unit/integration tests, migration/schema and cron-auth tests, type/lint and canonical build; scoped route, Atlas, status parity, J27 register and document gates, each gate/self-test sequentially. Do not run broad startup checks that may load live configuration. Use offline fixtures for cross-store races and catch-up; live acceptance uses the owner-selected production test request and existing controls. Live schema, exact counts and scheduler latency remain UNKNOWN until those bounded probes.

## Production test-request rehearsal — current execution gap

[VERIFIED via source, 2026-10-05] The deployed Factory form creates a Basic recipe (`lib/services/test-requests/admin-run-service.js`, `confirmRun`); the CLI also requires Basic for production reservation (`scripts/rehearse-test-request-sandbox.mjs`, argument validation). The `pre_site_visit` recipe in `run-runner.js` finishes at `verify_presite`; it does not invoke scheduled preparation. The new worker's scan, fresh eligibility reads, automatic promotion helper and retry path exclude marked test requests (`preparation-worker.js`, `site-visit-transition-service.js`). There is no existing Factory operation that demonstrates the new automatic worker end to end on a marked production request.

Existing staff actions can exercise request visibility, program/cycle/PD scope, separate briefing/writeup facts, draft creation, preservation of staff edits through manual promotion, and explicit review initiation. A group-review transition with a verified configured event map can exercise the same-value event PATCH fence; the legacy absent-map compatibility path cannot prove that fence. Manual promotion does not prove scheduled discovery, durable worker retries, or missing-only automatic generation.

Execution order:

1. **Completed in source, 2026-10-05:** merges `259bbc961` and `bcf594ecd` reconcile PR #432 with main at `90ab246b5`; migration 067 remains alongside 068 and 069. The combined code retains PR #434's presentation-only external transcript restrictions and PR #435's staff-only discussion transcript/current-boundary feed filtering. The first merge passed 20,689 tests across 1,270 suites (157 tests / 11 suites skipped), plus the production build (`/tmp/deliberations-oct5-full-tests.log`). After PR #435 landed during verification, its bounded follow-up passed 254 integration tests across 11 suites (`/tmp/deliberations-pr435-integration.log`); final combined build and remote CI are tracked on PR #432.
2. Select an owner-approved production test request that is not already reserved by another workstream. Do not assume request 1003222 is available; Claude's transcript acceptance uses it.
3. Inspect that request, its event, current Word artifacts, schema/configuration, and allowed actors read-only. Record the exact expected writes before seeking release or execution approval. Keep the recurring worker unscheduled and disabled.
4. After explicit authorization and required deployment/schema readiness, rehearse the existing manual/UI paths and the event fence. Preserve the test marker and staff file contents; no email send is required. Do not present this as automatic-worker acceptance.
5. The automatic-worker test path remains an owner decision: existing controls cannot exercise it on a marked request. Do not silently remove the marker, disable isolation, add a hidden bypass, or build a separate rehearsal system. Automatic activation remains pending until the execution gap is resolved and its behavior is proved.

[UNKNOWN] The selected production test request, current live configuration/schema for this feature, and actual event PATCH behavior have not been probed in this reconciliation. No live rehearsal or production mutation has been performed.

## Review and open items

Fable's earlier review was of the superseded display-only plan. Its valid findings are incorporated here: program/cohort precision, every stage-dependent action, explicit Final behavior, preserved session/materials, read completeness, duplicate semantics, sent-date projection and J27 register. Its suggestion about pre-visit Final navigation is superseded by the owner's scheduled-end information boundary.

## Review and local evidence

Sol's final source-level review approved the five material implementation fixes. Fable (`claude-fable-5-1`, authenticated through the user's OAuth subscription) returned changes required on 2026-10-04. The five material findings were accepted and fixed: inactive automation state in detail, missing-only generation conflict reconciliation, correction-epoch completion/retry behavior, cycle receipt-to-pointer identity, and the narrowly scoped legacy Final schedule fallback. Fable's targeted OAuth-only follow-up approved the disabled branch and verified all five fixes with covering tests. The review used `claude-fable-5-1`; no API-key authentication or metered review product was used. One low-severity edge remains: a duplicate-cancel receipt may require authenticated manual retry.

Fable's review discussed a hypothetical deployed rollout; this branch is not deployed to production. The feature-branch push triggered the repository's automatic Vercel preview build, which passed; it is not a production rollout or live workflow acceptance. Its analysis does not establish live schema, environment flags, schedule delivery, or production outcomes.

The implementation is source-built, not production-ready. Before rollout, require owner authorization, migration 067 application and schema readback, verified event-state mapping, and a targeted Dataverse rehearsal proving conditional same-value activity PATCH behavior, including completed-activity writability. This activity-write proof is a pre-rollout requirement even with automation disabled: human group-review initiation also writes the event in its changeset. Automatic activation additionally requires `TEST_REQUEST_ISOLATION=on` and guarded-reopen readiness verification, deployment flag/allowlist review, and explicit approval to schedule/catch up work. No live environment acceptance or scheduler-latency evidence exists. A fresh contract review must cover request selection → scheduled worker → document persistence → both UIs → explicit review, including partial success and unknown outcomes.

[VERIFIED via local offline checks, 2026-10-04] The final integrated feature/UI/security run passed 279 tests across 15 suites; log: `/tmp/deliberations-integrated-tests-final.log`. The focused cron/retry authorization suite passed 4/4, scoped ESLint passed, and canonical Turbopack build passed (`/tmp/deliberations-build-reviewed.log`). API route, Atlas, docs-catalog, doc-currency, fact-consistency, symbol-reference, and canonical-pointer gates/self-tests passed; the API route gate retains three existing warnings for external materials token routes. No live application Dataverse, Postgres, Graph, model-generation, migration, production deployment, or production schedule operation was performed; the development-agent reviews used subscription OAuth.

[VERIFIED via final offline CI-equivalent run, 2026-10-04] After correcting the writer gate, canonical OData use, route/service boundaries, and older integration fixtures, the full suite passed 20,555 tests across 1,264 suites (157 tests / 11 suites skipped); log: `/tmp/deliberations-full-ci-tests-final.log`. The production build passed again (`/tmp/deliberations-build-ci-repair.log`). Sol approved the bounded repair, including trusted retry authorization and its lead-PD adapter projection. The affected writer, OData, route-service gates and self-tests, documentation catalog, and scoped lint passed. These repairs preserve the workflow previously approved by Fable.
