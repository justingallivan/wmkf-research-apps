---
title: Staff Deliberations Briefing and Post-Visit Writeup Rework
domain: workbench
kind: plan
status: draft
summary: "Owner-directed workflow: lighter briefing before the presentation, automatic working-writeup preparation at scheduled end, and explicit staff initiation of review. Proposed implementation; not deployed."
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

[OWNER DECISION] Show every request in the selected cycle and staff scope, even with no documents. [PROPOSED, scope clarification pending] Also respect the Workbench grant-program selector. The earlier list ignores that selector; that mismatch is not authorization to include all programs in the redesigned list. Do not implement this selector choice until confirmed.

[PLANNED] Replace the earlier plan in this file in full. A manual “Start Site Visit” prerequisite and the earlier read-only-only scope are superseded. Automatic promotion is a durable write, and generating a missing draft consumes application AI resources. This document authorizes neither implementation nor execution of those operations. No production records were read for this revision; exact D26 counts remain UNKNOWN.

## Current evidence and implementation boundary

Source baseline: `9b1a60ed5`, branch `codex/leadership-dashboard-testing`. These are source findings, not new production verification.

| Finding | Source evidence | Consequence for this plan |
|---|---|---|
| [VERIFIED] The composite Visit stage uses scheduled **start** in the past plus a Review stage artifact. | `shared/utils/deliberation-stage.js`, `deriveVisit` and `deriveDeliberationStage` | Replace the clock boundary and stop using brief lifecycle as the visit gate. |
| [VERIFIED] The cycle list starts with brief/Pre-Site document rows and unions owner IDs. | `lib/services/pre-site-visit/cycle-list-service.js`, `listPreSiteVisitDrafts` | Requests without documents disappear today; use request-first selection. |
| [VERIFIED] Explicit promotion keeps the same SharePoint item and records a verified version/hash/time; a complete Review milestone returns without re-stamping. | `lib/services/pre-site-visit/site-visit-transition-service.js`, `startSiteVisitStage` | Reuse its document safeguards, but add a scheduled-event fence and honest automation attribution. |
| [VERIFIED] Generation has claims, recovery and pointer fencing, but can regenerate an existing Draft. | `lib/services/pre-site-visit/artifact-service.js`, `generatePreSiteVisitArtifact`; `artifact-lineage.js`, `commitReadyLineage` | Automatic preparation needs a missing-only generation contract; simply calling the existing generator is unsafe for staff edits. |
| [VERIFIED] Starting Final Writeup starts group review and stamps its actor/time, using the same Word item. | `lib/services/final-writeup/transition-service.js`, `startFinalWriteup`; `transition-claims.js`, `activate` | The scheduled worker must NOT call this transition. A prepared working writeup is not a Final/group-review artifact. |
| [VERIFIED] Calendar, session, materials and document actions have additional stage-dependent consumers. | `StaffDeliberationsTab.js`, `StaffDeliberationsPanel.js`, `FinalWriteupTab.js` under `shared/components/workbench/` | Migrate every action condition, not just the rail. Preserve session/materials visibility. |
| [VERIFIED] Cycle discovery is program-filtered, while this panel currently receives cycle/scope only. | `lib/services/workbench/dashboard-service.js`, `listCycles`; `shared/components/workbench/WorkbenchShell.js` | Make effective program scope explicit and consistent. |

Read-contract references: `docs/atlas/dataverse-wmkf-sitevisit.md` documents UTC scheduled start/end, local display zone, and active-only readers; `docs/atlas/dataverse-wmkf-requestdocument.md` describes document lineage and review checkpoints. Those readers and stored records are foundations, not proof that scheduled automation exists. New worker, receipt, authorization and schedule fencing below are PLANNED and unprovisioned.

## UX brief — Impeccable / Operate

**Audience and job.** Program directors and staff need to circulate preliminary information before a presentation, then finish a substantive writeup afterward without manually reconciling workflow statuses. Leadership must not mistake a polished foundation for a completed assessment.

**Design authority.** Preserve PRODUCT.md and DESIGN.md: Inter, neutral surfaces, compact hierarchy, existing controls and focus treatment. Use Impeccable Shape and Operate guidance. No rebrand, extra dashboard metrics, decorative animation or new navigation framework. The supplied Workbench screenshots are evidence of the confusion, not a template to preserve the rail.

**Primary distinction.** Organize around the staff task: “Before presentation”, “Preparing writeup”, “Post-visit editing”, “Group review”, “Leadership review”, with “Schedule needed” or “Needs attention” where appropriate. These are user-facing projections, not new persisted document enums. Do not use the same green Visit dot for a passed date and a completed document action.

### Cycle list

Every in-scope request appears once. Keep request number/title, institution and PD prominent. Show one concise task status, presentation date/time with timezone, briefing state and working-writeup state. Preserve the deliberation-session line, applicant-materials information and test-record badges. Session scheduling and research-presentation timing are separately named; neither substitutes for the other.

Use one primary navigation action per row. Explicit secondary links say “Open briefing in Word” and “Open working writeup in Word”. Scope appears beside the total: grant program, cycle, and Assigned to me / All program directors. Default filter is All; offer Before presentation, Post-visit work, In review, Needs attention plus text search. Missing/ambiguous schedules remain visible. Define one primary bucket with precedence: confirmed review state, blocking exception, due/preparing/editing, upcoming, unscheduled; counts derive from the same request IDs. Independent dates remain visible after review begins.

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

All entries below are PLANNED. “Due” means a uniquely resolved, noncancelled research-presentation activity has a valid UTC end at or before server time. Invalid/missing end is not replaced by start time or midnight. Read failure is not “not scheduled”.

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

[PLANNED] The cohort uses `cycleCodeToOdataFilter(cycleCode)` (request `wmkf_meetingdate` UTC month window), the confirmed program scope, and `_wmkf_programdirector_value` for “my”. Enforce session-derived identity, app access and Dataverse restrictions. Do not reuse Phase-II/advancing/set-aside visibility filters: all in-scope requests remain discoverable, including Concept, withdrawn and set-aside records. Visibility does not imply eligibility for automatic generation.

[PLANNED] Worker enrollment is narrower than list visibility: use an explicit release-approved cycle/program allowlist, a valid linked research-presentation event, eligible active request state, and test isolation. Reuse verified request business eligibility where applicable; do not infer worker permission from a row appearing in the UI. Withdrawn/cancelled/set-aside and test records remain visible but are not automatically generated in production. Pin the exact stored status values and their mapping in fixture tests before enabling the worker. Requests with no valid cycle association need an explicit reconciliation result; do not invent D26 membership.

The proposed GET projection contains separate `timing`, `brief`, `writeup`, `preparation`, `session`, and `materials` facts, each with availability (`available`, `missing`, `unavailable`, `ambiguous`) and exact source identity. Include server time, scoped count completeness, due time and persisted preparation outcome. This is a projection contract, not permission to add document lifecycle values.

Request-first paginated reads join optional artifacts in bounded batches. Resolve canonical pointers even when artifact cycle stamps differ; report contradictions. Never silently select the newest row over a current pointer. Specify legacy/document-only disposition explicitly. Propagate `capped` from request and document reads; replace the visit reader that drops pagination metadata. Ledger failure must not fail or erase the request list: project sharing history unavailable. Add a bounded ledger projection for latest successful sent time and exact source version; current `sentSourceDocumentIds` provides IDs only.

Resolve duplicates consistently on list, detail and worker: ambiguous schedule, no automation. Include completed noncancelled events as eligible evidence after validating target state/status meanings; active-only readers are insufficient. Preserve the existing session/materials readers' responsibilities, but add availability results where their current null-on-error behavior obscures failure. GET, filtering and navigation stay read-only.

## Scheduled preparation and persistence

[PLANNED architecture] A server-side due-work scan runs independently of browser visits. Proposed polling interval: one minute, subject to deployment validation; the UI changes to “Preparing” at the end boundary and reports actual completion only after readback. Generation may take longer. Never promise the document is ready at an exact second. Scheduled processing catches up after outages and includes already-ended events in the rollout allowlist.

Use an authenticated cron entry point and bounded worker following existing server-worker patterns, with trusted DAL context and the target/write interlock. Do not introduce an external queue/vendor for this task. Cron configuration, endpoint, service and migration names are implementation work, not already provisioned resources.

Proposed durable operational receipt: one preparation record per request and guarded correction/lineage epoch, with a unique key; event ID/end/revision, state (pending/running/prepared/blocked), lease token/expiry, attempt count/next attempt, exact document ID, completion time, automation actor/provenance, and bounded error reason. Store operational receipts in Postgres; Dataverse document lineage and SharePoint remain authoritative. Add an existing-DB migration, manifest entry, fresh-install parity, Atlas record, retention/cap policy and schema readiness check. Finalize names and types against current migration inventory before code. Do not overload human milestone-actor fields to pretend a PD clicked a button.

Worker sequence:

1. Paginate enrolled requests/events with a durable scan cursor or equivalent completeness-safe scan. Upsert due receipts under the unique key. One request failing must not prevent other due requests from being processed.
2. Claim a bounded batch with an atomic lease. Re-read request eligibility, schedule identity/end/state, current document pointers, pending generations, correction epoch and existing Final state. Unknown or changed facts defer/block; never proceed from the earlier scan alone.
3. If a current full draft exists, preserve it without invoking generation. For genuine absence, use a new missing-only entry contract on the existing producer. Fence activation against the expected absent pointer and schedule revision; concurrent manual generation wins. Recheck before model work and before activation. Recover stored output/uploads rather than rerunning paid generation after uncertain outcomes.
4. For a Ready/Draft, reuse promotion's version/hash validation. Add commit-time current-pointer, schedule-version/end, request eligibility and correction-epoch fences, including an atomic conditional schedule check with the document write where needed. A standalone read just before PATCH is not a cross-record race guarantee. If the platform cannot enforce that contract, resolve the mechanism before enabling automation.
5. Record automatic provenance without impersonation. Retain existing complete milestones without re-stamping. A complete Dataverse handoff is success even if receipt acknowledgement failed: retry reads authoritative state and repairs the receipt, not the document. A successful receipt without a valid document checkpoint is a reconciliation error.
6. Use bounded retries/backoff for transient transport or file-version conflicts. Configuration errors, unchanged invalid inputs, missing files, duplicate events, and incomplete checkpoints become visible blocked outcomes. Authenticated Retry preparation reuses the same receipt and revalidates eligibility; it cannot force regeneration or bypass schedule rules. Return per-request outcomes, not only success counts.

Generation and promotion need separate checkpoints. If a meeting moves during generation, retain the generated foundation safely, defer promotion, and do not repeatedly pay to regenerate it. No current file is overwritten or replaced by automatic work. Missing-only checks must hold at activation, not just at initial load. A background worker must not supersede an existing edited Draft through the current general generation path.

Before enabling writes, resolve a trusted service-principal execution policy and audit representation. Existing promotion's ALLOW_UNATTRIBUTED policy is not sufficient evidence of an acceptable scheduled-actor contract. Do not borrow the PD's identity or weaken app/DAL restrictions. Reuse existing application provider configuration for authorized application generation; no agent API credentials or new provider integration belongs in this change.

## Delivery sequence

1. **Freeze product/read contracts.** Confirm the outstanding program scope, pin event status semantics, cohort predicate, worker eligibility, correction/reopen behavior and review start boundary. Freeze fixture cases. Preserve current source facts in canonical docs until implemented.
2. **Request-first read model.** Add independent facts, completeness and availability while retaining compatibility fields until both consumers migrate. Add program wiring once confirmed. This can be reviewed separately from mutation work.
3. **Durable preparation.** Implement receipt migration, worker, missing-only generation, commit fences, automation audit and recovery. Deploy disabled. Do not call `startFinalWriteup` from the worker.
4. **Coordinated UX changes.** Replace the rail and stage-dependent actions on both surfaces; reorder briefing/writeup by task phase; preserve session/materials and permissions. Update Final prerequisite, confirmation and regeneration copy. Preserve explicit group/leadership review actions. Enforce scheduled-end eligibility server-side as well as in the UI, with legacy review compatibility.
5. **Validate and reconcile.** Update the PC Tracker D7/D8 language, Pre-RP Brief plan, writeup lifecycle plan, Atlas pages/index, route security matrix, service catalogue, J27-083 register and relevant agent wiki/memory routing. Inventory stage-label configuration/defaults/admin readers before retirement; preserve stored-label compatibility. No automatic configuration deletion.
6. **Controlled rollout.** Review a read-only due-work report by cycle/program: already prepared/reviewing, existing draft, missing draft, blocked and excluded. Obtain authorization for production catch-up and AI generation before enabling; use a small allowlisted batch, inspect exact receipts/files, then expand. Enforce a batch and application-generation budget. Monitor age of due work, blocked reasons, duplicates and retries. No email is sent by preparation.

Rollback: disable enrollment/worker writes first, retain readable receipts and documents, and keep the UI able to show committed preparation. Do not reverse checkpoints, delete files or roll back staff edits. Review transitions already committed remain authoritative.

## Acceptance and verification

- Same past event with brief Draft, Review, missing or externally circulated: request visible and preparation eligibility identical; no sharing inference/resend.
- Existing Word file contains a distinctive staff edit: automatic promotion retains item identity and exact content. The test fails if the edit disappears. General generation is never called for an existing current draft.
- Missing draft: one foundation and handoff despite duplicate ticks, concurrent manual generation, worker crash, upload timeout or receipt-ack failure. Recovery does not pay for a second model run after persisted output exists.
- Future, exact-end boundary, DST/timezone, missing end, cancelled, completed, duplicate and rescheduled events: UI and server agree. Change the event during generation/promotion to test the commit fence.
- An existing correction/reopen epoch is not automatically consumed; stale receipts cannot promote replacement documents. Already-final/reviewing artifacts are untouched.
- Meeting ended but preparation blocked: show Needs attention with a safe retry/repair explanation and verified existing file link; never show Ready or require Start Site Visit.
- Automatic preparation cannot set group/leadership review timestamps, expose a new Final item to leadership, send mail, or mark anyone reviewed. Explicit review start records the real staff actor and requires current readiness.
- Program/cycle/my/all, missing identity, restrictions, Concept/set-aside/withdrawn/test fixtures, empty documents, pointer contradictions and caps: correct visibility, separate worker eligibility, no false total.
- Ledger/session/materials failures leave request identity and other facts visible. Successful send for a different source version does not label the current briefing sent.
- Rapid program/cycle/scope/request switches: fence every late success/error and action response. Verify Share/Resend and Final navigation independent of brief-derived stage.
- Desktop/narrow layout, long titles, keyboard flow, active composer during timed refresh, screen-reader feedback and loading/error states. Inspect both widths once, fix in one batch, confirm once; use Impeccable craft-floor/detector only when implementing UI.

Run affected unit/integration tests, migration/schema and cron-auth tests, type/lint and canonical build; scoped route, Atlas, status parity, J27 register and document gates, each gate/self-test sequentially. Do not run broad startup checks that may load live configuration. Use sandbox fixtures for cross-store races and catch-up before authorized production verification. Live schema, exact counts and scheduler latency remain UNKNOWN until those bounded probes.

## Review and open items

Fable's earlier review was of the superseded display-only plan. Its valid findings are incorporated here: program/cohort precision, every stage-dependent action, explicit Final behavior, preserved session/materials, read completeness, duplicate semantics, sent-date projection and J27 register. Its suggestion about pre-visit Final navigation is superseded by the owner's scheduled-end information boundary.

This is an implementation proposal, not an implementation-ready schema receipt. Product workflow is decided; program scope confirmation, exact event-state mapping, trusted scheduled actor, atomic schedule fence, migration layout and deployment timing validation are explicit pre-enable dependencies. A fresh contract review must cover request selection → scheduled worker → document persistence → both UIs → explicit review, including partial success and unknown outcomes.

[VERIFIED via local checks] Documentation currency, fact consistency, symbol references, their sequential self-tests, and docs catalogue checks passed for this revision. [VERIFIED via fresh read-only contract review] Reviewer found no material blocker for this planning deliverable and confirmed that scheduled automation remains unimplemented; the correction-handoff clarification was incorporated. No runtime tests, production calls or UI implementation were performed. The original sandbox self-test attempt could not create a fixture; the authorized host rerun passed. The unrelated `package-lock.json` change remains untouched. Impeccable context was loaded earlier in this session; its stale generated design-metadata warning was reported separately and is not repaired by this task.
