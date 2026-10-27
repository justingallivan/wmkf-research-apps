---
title: Overlapping Cycles with Minimal Configuration — Proposed Delivery Plan
domain: platform
kind: plan
status: proposed
summary: "Proposed phased delivery of shared cycle context, task-specific defaults, per-cycle reviewer settings, bounded multi-cycle automation and exception-only rollover checks; source investigation complete, live contracts and implementation pending."
canonical: false
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/SYSTEM_MODEL.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/J27_TRANSITION_REGISTER.md
  - docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md
  - docs/CREDENTIALS_RUNBOOK.md
---

# Overlapping cycles with minimal configuration

**Status: [PLANNED], 2026-10-21.** Proposed delivery plan for owner review, replacing this file's October 6 investigation outline. The October 21 read-only investigation covered UI/configuration, backend services, and operations/schema/docs with three agents. No runtime, schema, environment, schedule or external-system change is authorized by this document. The source findings below are verified locally. A later bounded production read-only census verified roles, cycle rows, selected date settings and request/GOApply links; date propagation, portal behavior and deployed environment values remain unverified. See `docs/audits/cycle-foundations-2026-10-21.md`. This plan does not claim an exhaustive live-system sweep or production readiness.

## 1. Outcome and boundaries

[OWNER REQUIREMENT, 2026-10-06 and 2026-10-21] Support simultaneous grant cycles twice each year with as little manual setup as possible. A cycle nearing its board meeting must remain usable while the next receives applications. The owner's October 21 J27/D27 timeline is provisional and subject to change; it is a planning input, not a published operational calendar.

[PLANNED] Routine rollover should require **zero code edits, environment edits, deployments or duplicated date entry**. Staff maintain real operational dates once, preferably in their existing operations record. A single readiness view identifies missing decisions and exceptions. A consolidated confirmation is needed only for unresolved or changed choices, not to turn on each mature feature again.

**[OWNER CLARIFICATION, 2026-10-21] Reviews stop being accepted months before the board meeting.** Post-board review acceptance is not an overlap requirement. Post-board work includes requesting abstracts through the Awardees tab. Preserve the decided cycle for those follow-up tasks while the next cycle progresses; completion/eligibility is task-specific, not a single cycle-wide open/closed switch. Exact review-cutoff storage/enforcement still needs read-only verification; the business boundary itself is resolved.

This work covers cycle identity, discovery, defaults, settings, job scope and rollover visibility. It does not build the J27 assessment/triage product, enable paused reviewer reminders, revive the applicant portal, expand Dossier pilots, approve external sends or authorize model spending. Those remain separate workstreams. Existing authorization, target interlocks, test isolation and production kill switches remain required.

## 2. Evidence and current gaps

Source mechanisms below were verified on 2026-10-21. Current production details are labeled separately; the bounded evidence and remaining external questions are in `docs/audits/cycle-foundations-2026-10-21.md`. Sources are relative to the repository root.

| Surface | Source and mechanism | Consequence |
|---|---|---|
| Request cycle identity | `lib/utils/cycle-code.js:24,70`; request `wmkf_meetingdate` maps June/December to J/D codes and month query windows | Multiple cycles can coexist. A board-date edit can affect identity if it crosses a month/year boundary. |
| Shared landing defaults | `lib/utils/cycle-code.js:105-146`; `lib/services/workbench/dashboard-service.js:134-215` | Earliest upcoming board meeting is the working default. Exact-date callers roll the following UTC day; code-only callers retain the board cycle through month-end. Workbench takes its date from the latest eligible ordinary request, not an authoritative cycle calendar. |
| Intake discovery | `shared/config/workbenchVisibility.js:11-15`; dashboard cycle discovery uses it | Untriaged Phase I requests do not introduce their cycle into the Workbench catalog or ordinary request list. Fixing navigation alone does not build intake review. |
| Explicit selection | `shared/components/workbench/WorkbenchShell.js:127-146`; `shared/components/meeting-tracker/MeetingTrackerList.js:155-172` | Existing URL cycle selection supports overlap; preserve it. Ranking, Expertise batch, Program Briefing and Discussion Sentiment have separate defaults/state. |
| Reviewer defaults | `lib/services/reviewer-campaign-timeline.js:16,108-123`; `shared/components/reviewers/InviteEmailModal.js:283-325`; `CampaignConfigModal.js:45-65` | One Dataverse settings key holds a free-text cycle label plus dates/quota; consumers do not match that label to the request cycle. Request-specific values override some fields, otherwise another cycle's dates can seed an editor. |
| Reviewer cycle records | `lib/services/grant-cycles-dataverse.js:76-109`; `lib/services/review-manager/cycle-config-loader.js:36-47` | Existing `wmkf_appgrantcycle` has per-code configuration, templates and attachments; runtime reads do not expose its schema-declared meeting date. Retain this record rather than invent a replacement reviewer store. |
| Operations cycle record | `lib/dataverse/schema/wave0-prod-parity-foundation/01_wmkf_grantcycle.json`; `zz_akoya_request.json:503-515` | Production-derived September metadata snapshot defines `wmkf_grantcycle`, CycleCode key, CycleName, MeetingDate and a request lookup. **[VERIFIED live GET]** 143 operations rows, J27 board date June 10, 2027, no D27 row; 20,300 of 25,808 all-program historical requests have a cycle lookup. No extra operational milestone columns found. Propagation and owner workflow remain unknown; see the bounded audit. |
| Board workflow | `lib/services/board-writeups/config.js:30-41,91-117`; `lib/db/migrations/085_board_writeup_runs.sql`; `pages/board-writeups.js:8`; `pages/board-cycle-setup.js:7` | Settings and journals are per-cycle, but page defaults are D26. Final roster confirmation and activation are meaningful actions, not configuration to copy blindly. |
| Staff Deliberations worker | `lib/services/pre-site-visit/preparation-config.js:37-113` | Multiple cycle codes are allowed, but an environment list needs ongoing edits. That list is also the present historical-scan backstop; removing it alone would widen production work. |
| Review DOCX filing | `lib/services/review-documents/individual-file-service.js:1006-1050` | Automatic discovery takes one exact cycle from deployment configuration. Filing eligibility must respect the review workflow; this single-cycle pin is not evidence of a need to accept reviews after the board meeting. |
| Edited-title job | `pages/api/cron/generate-grantee-titles.js:38-44`; `vercel.json` | Selects one conventional cycle and runs in calendar-month windows; does not scan all eligible cycles. Trigger meaning under single submission remains a separate decision. |
| Materials batches | `lib/services/review-manager/send-emails-service.js:389-418,827`; `ReviewerManagePanel.js:510,1431-1441` | API shares first-cycle attachments across a batch. Current UI is single-request; no ordinary-UI cross-cycle send was found. Guard the API before broadening batch selection. |
| Dossier pilot and document conventions | `lib/db/migrations/045_cycle_dossiers.sql:5,16`; `lib/services/cycle-dossier-rollout.js:16`; `shared/config/workbenchProposalDocuments.js:17-36` | Dossier has database and runtime D26 restrictions. Unknown document cycles inherit D26 filenames. These need explicit capability/document contracts, not global rollover switches. |

Existing focused evidence: `cycle-code-defaults.test.js` and `reviewer-campaign-timeline.test.js` passed, 21 tests. Pure helper probes showed J27 as the code-only default on June 7 and June 11, 2027; supplying the June 10 board date changes the June 11 default to D27. These establish current mechanics, not correctness of the proposed UX or live calendars.

## 3. Proposed operating model

### 3.1 One cycle identity; existing records keep distinct responsibilities

[PLANNED] Prefer operations' `wmkf_grantcycle` as the calendar authority **after Slice 0 confirms its data contract with operations and its authority mapping to the Admin role system**. Retain `wmkf_appgrantcycle` for reviewer configuration and `board_writeups.cycle.<code>` for board workflow. Do not merge or delete tables as part of this plan. Build the smallest common read boundary that resolves these sources into explicit cycle context.

**[OWNER DIRECTION, 2026-10-21] Calendar authority is delegated to a role.** The released role contract and current assignments were verified by source at `f6a96a632` and production GETs: Program Coordinator is Duncan Spore and Systems Specialist is Connor Noda. The full shared-role set is recorded in the audit; neither assignment selects the calendar owner. The role-owning workstream owns definitions and assignment. This plan consumes that inspected contract during implementation and does not introduce a parallel role store, invent a role key, or assign authority to named people. Calendar authority means who may maintain/confirm dates; the calendar record remains the data authority.

[PLANNED] Resolve calendar editing/confirmation permissions and readiness recipients from the configured role assignment, with server-side checks on each mutation. Changing the assignee should transfer responsibility without cycle-by-cycle edits or a redeploy. Do not hardcode Connor, Sarah or Justin as the permission or notification fallback. Role scope, multiple assignees/backups and escalation are mapped to the delivered role contract before implementation; no extra roles are assumed. An unassigned/unresolvable role is a visible setup exception and blocks affected calendar changes/confirmations, while reads and already-authorized unrelated workflows continue. A calendar role assignment does not itself grant board release, pilot activation or model-spend authority.

Proposed rules:

- A verified request-to-cycle lookup supplies stable identity. For legacy records without it, use the existing request meeting-date derivation, visibly marked as fallback. Never assign identity from a screen default or from today's date.
- Resolve records by exact code/lookup, not display label or free-text program name. Current reviewer shortcode uniqueness is per cycle; add program-specific settings only where an actual consumer needs them, without duplicating the authoritative calendar.
- A lookup/date/code disagreement is an exception. Reads show the issue; automated writes for that request pause. A board date adjustment within the same cycle must not refile historical records. A cross-month/year change requires deliberate correction, not automatic reclassification.
- The resolved context includes code, label, authoritative date source, date precision/confirmation, program scope where relevant, configuration revision and capability readiness. Missing optional dates do not disable unrelated activities.
- Do not use a single exclusive phase enum to authorize work. Intake, review follow-up, presentations and board preparation can overlap, even within one cycle. Show activity windows; authorize each action from its own data and lifecycle prerequisites.
- Keep raw request-date and fiscal-label readers in the inventory until migrated. Updating the cycle record alone does not establish that existing request date filters have updated. Slice 0 must choose and test a propagation or lookup-query strategy before changing calendar authority.

### 3.2 Minimal calendar and configuration

[PLANNED] Store only dates actually consumed by our apps: submission/open-close information when available, reviewer dates, presentation windows, board/materials dates and operational closure or late-work policy. Slice 0 identifies existing fields; a later schema proposal names only missing fields needed by the first consumer. Do not create columns for every entry in the supplied timeline.

| Item | Proposed rollover behavior | Human involvement |
|---|---|---|
| Cycle identity, label, request membership | Read existing authoritative records; J/D convention supplies suggestions only | Resolve missing/conflicting identity |
| Application deadline | Suggest from the owner-reported holiday rule; accepted date comes from operations/GOApply | Confirm exceptions in the existing operations workflow |
| Board date and operational milestones | Read confirmed dates once; show provisional dates as provisional | Operations sets real dates |
| Reviewer response interval, quota and unchanged template policy | Inherit the last confirmed compatible policy, recording source/revision | Review changes only; do not copy old absolute dates |
| Reviewer deadlines, release dates, materials | Resolve for the selected request cycle; verify compatible material references | Supply changed content or missing date; never inherit request-specific proposal files |
| Mature automations | Apply the approved standing policy to qualifying records across eligible cycles | No routine per-cycle activation |
| New paid/sending capability or pilot | Preserve explicit feature/program/production authorization | Separate approval; inherited policy cannot enable a dormant product or expand a pilot |
| Board finalist roster, release and archive | Derive a candidate roster from the agreed business signal, show changes, preserve existing confirmations | Confirm the actual slate and retain release/archive actions |

**[OWNER DECISION, 2026-10-24] Central, not per-PD.** Reviewer campaign values (review deadline, respond-by offset, reviewer quota) are to be handled centrally at cycle level under the calendar authority (§7), replacing the per-request campaign settings PDs set today (`CampaignConfigModal`). Owner: the PD-specific campaign settings "were a clunky distraction." Individual reviewer deadline changes remain a PD action. Whether any per-request exception survives, and who may set it, is open in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` (A4). Slice 1 is scheduled for November 2026 (owner, 2026-10-24), now unblocked: reviewer deadline email slice 2 shipped as PR #521. Scope excludes email wording, where per-user customization over central seeds is the intended design. This supersedes "request-specific overrides remain strongest" below and in Slice 1 for campaign-level values pending A4; per-reviewer overrides are unaffected.

**One editable home per date.** Use the existing `wmkf_appgrantcycle.wmkf_reviewreturndeadline` as the proposed initial canonical reviewer deadline default. Invitation editors, campaign editors and email renderers must resolve that same value; do not create a per-cycle copy of `reviewer.campaign_timeline_defaults.reviewDueDate`. Operations' calendar view should reference that authority. If Slice 0 establishes an existing operations-owned equivalent as authoritative instead, bind all readers to that one field and make the old field a read-only compatibility projection; never leave two editable defaults. Preserve reviewer-specific overrides, committed request deadlines and explicit per-send edits, with their provenance visible.

Apply the same rule to board materials/board-end dates: use calendar defaults for new setup and retain explicit version-bound workflow snapshots/overrides where the existing approval contract requires them. Updating a calendar must not silently rewrite an activated board configuration or reset its roster/release state. Any required reconfirmation is one visible exception, not duplicate routine date entry. Define operational date-only values and new windows in Foundation Pacific time; explicitly test UTC-day versus Pacific-day boundaries and daylight-saving changes before replacing the existing helper semantics.

Unchanged shared templates may be referenced by identity/version after validation; do not duplicate bytes every cycle. The previous cycle is a policy source, not a source of deadlines, rosters, tokens, receipts or operational completion flags. Store derived suggestions separately from confirmed operational values.

### 3.3 Screens: preserve explicit choice, make defaults task-aware

[PLANNED] Explicit valid cycle URLs always win; preserve selection through navigation and in-flight work. Each app shows the full cycle label. Do not silently switch an open page at midnight or after a board meeting. Offer a notice/link if another cycle becomes a better default. Keep historical access and empty-cycle views available.

| Task | Proposed first-entry behavior when no cycle is selected |
|---|---|
| Intake assessment and assignment | Prefer the cycle with an open/recently closed submission window requiring initial work; if more than one qualifies, present a choice rather than guess |
| Reviewers, deliberations, ranking and meeting coordination | Retain next-board default initially, show other cycles with relevant work, and preserve explicit links; refine defaults only against demonstrated workflow needs |
| Final/board writeups | Prefer the cycle with relevant pending board work, with next-board fallback; never hardcode D26 |
| Awardees | Keep the shell's explicit cycle; when empty, retain the existing last-decided-cycle link |
| Admin cycle setup | List concurrent and upcoming cycles with separate readiness; never edit an unnamed global current cycle |

Before changing a first-entry rule, test it against the existing owner-approved September navigation policy. A task-based default is a proposed UX change, not an assertion that the current behavior is a bug. URL persistence for currently state-only views is part of the bounded navigation slice, not a global saved preference that unexpectedly changes every app.

The cycle catalog must discover incoming cycles independently of reviewer eligibility. That is read-only discovery; it must not make an unadvanced request eligible for outside reviewers, scheduling or automated sends. The J27 assessment workstream still owns its actual intake list and triage behavior.

### 3.4 Jobs: process eligible work in several cycles safely

[PLANNED] Replace recurring single-cycle pins with bounded per-cycle/request eligibility only after the replacement is proven. Continue to enforce existing feature switches, program restrictions, request statuses, TEST exclusions, fences, quotas and target interlocks at scan, claim and execution time.

- Discover all cycles with work eligible for a given mature capability. Use explicit lifecycle/event evidence plus a bounded operational window; a date window alone never approves a send, paid generation, board release or archive.
- Preserve post-award follow-up after the board meeting, including abstract requests through Awardees, while the next cycle proceeds. Review acceptance closes months before the board meeting per owner direction; verify its existing cutoff mechanism rather than design a post-board late-review window. Define completion/eligibility for each post-award task from its own workflow. Undefined policy blocks expansion of that capability while retaining its approved legacy scope.
- Before removing Staff Deliberations' cycle list, prove an equivalent historical boundary using lifecycle/event dates and exact allowed states. Publish a read-only old/new cohort diff, including previously eligible rows that would be excluded and newly admitted historical rows.
- Schedule review filing and title discovery across eligible cycles, with bounded pages, a time budget and fair progress so one busy cycle cannot starve the next. Reuse existing leases/idempotency and progress machinery; add durable cursors only if required to prove completion within those bounds.
- Resolve the target request's cycle again before writes; key state/leases by the real unit of work, never by a global current-cycle variable. Old completed work must not restart when a calendar or policy revision changes.
- Calendar edits affect future scheduling; preserve sent invitations, agreed request/reviewer deadlines and published artifacts. Existing deadline-edit workflows remain authoritative. Cancel/reschedule only unsent work under the affected policy and revalidate after each await/claim.
- Reject mixed-cycle materials batches before dispatch as the smallest initial fix. Keep the current single-request UI; per-recipient attachment generation is only needed if a later bulk product explicitly requires it.

### 3.5 One readiness view; exception-only notifications

[PLANNED] Extend the existing Admin workflow/cycle surfaces with one consolidated view: what was derived, where dates came from, what is confirmed, missing configuration, conflicting records and remaining pilot pins. Show each affected capability separately. A missing board-packet date should not hide intake or stop reviewer follow-up.

Run a recurring readiness check over an explicit registry of cycle-dependent consumers. Check when a new operational cycle appears or milestones/configuration change; a scheduled fallback detects missed updates. Notification cadence and recipient/escalation role mappings are confirmed in Slice 0 against the Admin role contract; unresolved recipients are shown as setup exceptions rather than falling back to named individuals. Notify only for a new actionable issue, a changed issue or a required decision; deduplicate by cycle/capability/issue/revision, record delivery outcome, and leave a durable in-app warning if mail fails. Do not send routine unchanged-status emails.

The check reports its denominator and unsupported consumers. It must catch missing dates, conflicting lookup/date identities, stale global defaults, forgotten cycle pins, unreachable settings and incomplete/capped discovery. Unverified or unavailable data is not a green result. A proposed offline contract gate should catch new unregistered runtime cycle literals and missing policy coverage, with explicit exceptions for historical compatibility/tests/pilots; it cannot verify deployment values or external flows.

## 4. Delivery slices and exit evidence

All slices below are **[PLANNED]**. Implement in bounded feature branches; this plan authorizes no deployment or live write.

| Slice | Deliverable and relevant surfaces | Exit evidence |
|---|---|---|
| **0. Establish authority** | Owner-run read-only census of operations/reviewer cycle rows, request/Apply lookups, GOApply windows and relevant PA flows; deployed pins checked without exposing secrets. Map calendar authority and notification/escalation to the other agent's Admin role contract; agree stable identity, post-award task eligibility and date propagation; verify the existing review cutoff. | Field/source/role/consumer map, including unassigned-role handling; complete paginated counts and listed open gaps; resolve J27/D27 mappings without assuming snapshot equals live state. This blocks authority cutover, not independent local UI/date-isolation work. |
| **1. Isolate reviewer settings** | Per-cycle timeline resolution through existing reviewer cycle/settings surface; request-specific overrides remain strongest. Stop applying singleton/sticky absolute dates across cycles; enforce single-cycle materials batches. | One canonical deadline edit reaches invitation, campaign and render consumers without a second edit. Two cycles with different dates/materials; one lacks a field; no fallback to another cycle. Historical configured requests unchanged. Send rejected before dispatch on mixed cycles. |
| **2. Make context explicit** | Minimal shared cycle read contract, independent catalog, URL-preserving app selectors/defaults; remove D26 landing defaults. Inventory every date-filter/fiscal-label reader and resolve disagreement policy. | Concurrent intake/board views remain independently bookmarkable; cycle switch races cannot update the wrong view; untriaged intake is discoverable without reviewer authorization widening. Calendar revision does not reclassify existing work silently. |
| **3. Remove routine job rollover** | Migrate mature preparation, review filing and title discovery one capability at a time. Decide title trigger separately. Preserve the review cutoff and post-award task eligibility; add bounded multi-cycle scans; retain all existing production guards. | Old/new cohort diff reviewed; fixtures for prior-cycle Awardees follow-up alongside new-cycle work; repeat runs and mid-flight revisions produce no duplicates, missed tails or starvation. Cutover/rollback verified per worker. |
| **4. Consolidate readiness** | Admin readiness view, exception digest, non-secret status reporting and bounded offline policy gate; seed/inherit compatible policy once from verified records. | Missing/unavailable inputs are visible; repeated unchanged checks do not resend; concurrent checks cannot double-notify; staff can resolve a real exception in one place. No permanent new per-cycle environment edit. |
| **Separate pilot decision** | Dossier D26 database restriction, document naming/registration, paused reminders and first-use capabilities | Remain explicit in the J27 register. Broader support needs its own scope and evidence; do not silently generalize or delete them during rollover work. |

Before implementation of each slice: select exact files, schema/migration needs and route authorization; run contract-reconcile and relevant fresh review. No new table or route name is committed by this outline. New routes require the security matrix; new persistence requires Atlas/migration/catalog coverage and cleanup/retention contracts. Existing databases use the migration runner, never fresh-install setup.

## 5. Migration and rollback constraints

[PLANNED] Add per-cycle resolution before replacing legacy sources. Inventory the old singleton timeline's actual applicability; a free-text cycle label alone is insufficient evidence for bulk backfill. Preview the mapping, confirm it once, then copy only verified configuration. Ambiguous existing values become named exceptions. New-cycle requests must not fall back to the legacy singleton.

Use shadow/read-only resolution and cohort comparison before worker activation. Cut over consumers in small groups with known rollback versions. Remove an old pin only after its replacement handles legacy, late and concurrent-cycle work. A source rollback must not broaden a worker cohort or reactivate an email; retain kill switches and hold affected jobs on ambiguous rollback state. Data rollback is explicit per migration and cannot undo sent messages or business decisions. No deletion/drop is proposed here.

## 6. Acceptance scenarios

[PLANNED] Required tests use offline fixtures and mocked transports first; production acceptance is a separate owner-authorized bounded exercise.

1. December intake/board overlap and June intake/board overlap: two cycles readable and actionable according to their own lifecycle; neither displaces the other.
2. On June 7, 2027, D27 intake and J27 board preparation coexist; June 10/11 and June month-end illustrate exact-date versus month-only resolution. Use the supplied provisional dates as fixtures, not live commitments.
3. Staff request abstracts for the decided cycle through Awardees while the next cycle receives applications. The board meeting does not hide or disable that follow-up, and repeated job runs do not duplicate requests/receipts. Review acceptance remains closed after its pre-board cutoff; no post-board late-review behavior is introduced. Historical completed work does not replay.
4. One canonical reviewer deadline edit appears in invitation, campaign and render defaults without a second save. Different cycle dates/templates, missing new-cycle config, stale user-sticky dates and request/reviewer overrides: no wrong-cycle fallback, no silent overwrite of an agreed deadline.
5. Cycle A fetch/save pending while the user selects B: A's result cannot change B's state; server identity comes from the request. Partial batch success keeps failed identifiers retryable in the correct cycle.
6. Board-date reschedule, missing lookup, lookup/date disagreement, provisional date, and unavailable/capped upstream discovery: identity preserved or affected writes paused with a specific exception.
7. Jobs run twice, overlap, time out or restart after a policy edit: state remains isolated, scans progress fairly and completed work is not replayed.
8. Mixed-cycle materials send rejects before any email dispatch; ordinary single-request sending retains the existing behavior.
9. Routine D27-to-J28 rollover adds verified operational records without code/env/deployment edits. Changed dates/template/roster appear as exceptions; no old-cycle absolute dates, proposal files or confirmation flags are inherited.
10. A pilot, paused reminder schedule, unapproved program or Factory TEST request never enters a mature automation merely because a new cycle exists.
11. Reassign the calendar role: the new assignee can maintain dates and receives applicable readiness notices; the former assignee loses delegated calendar authority unless authorized through another valid assignment. No cycle settings or code change. Missing/unavailable assignments surface a setup exception without blocking unrelated reads/workflows; changes are authorized again at save time.

Verification per slice: relevant unit/integration/browser tests plus type/build where runtime changes require them; affected route, Atlas, migration, status, document and J27 gates with sequential self-tests. Test both admitted and excluded populations. Current planning-doc checks do not establish this acceptance.

## 7. Decisions to resolve once

**OWNER DECISION — calendar responsibility (2026-10-24).** Calendar authority is the **Grants Manager** role (`board_writeups.grants_manager`), with the **Program Coordinator** role (`board_writeups.program_coordinator`) as fallback. Authority binds to the role, not the assignee. **Fallback semantics decided 2026-10-27 (alignment log D7):** both roles may edit at any time, and the calendar shows who last edited each value and when. **No second approver (2026-10-27, log D8):** one person can change any date; responsibility defaults to the Grants Manager, and the Program Coordinator edits when necessary. Still open: readiness-recipient/escalation mapping. These are tracked for the owner's meeting with the role holders in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`.

[PLANNED] Recommended defaults for owner review:

- **Calendar authority:** a configured Admin role, per owner direction, using existing Grant Cycle records once verified. Consume the role work owned by the other agent; the verified shared-role keys are available; the owner selected Grants Manager with Program Coordinator fallback on 2026-10-24. Apps consume dates and current role assignments, without a competing calendar or person list.
- **Standing policy:** inherit unchanged approved operational policy with provenance; require action for missing/changed dates, content and business approvals. Never treat silence as authorization for a new capability or wider paid/sending scope.
- **Readiness recipient and escalation:** resolve the configured roles through the same Admin role system; confirm the mapping and delivery channel once. No named-person fallback or per-cycle recipient list.
- **Rollover UX:** a new cycle is visible as soon as a verified cycle record or actual request establishes it; readiness is capability-specific. No global current-cycle switch or single readiness checkbox controlling every app.

Still unresolved before the relevant cutover: the readiness recipient mapping, board-date propagation, intended J27 Research opportunity/publication and lookup assignment, future operations-row creation and milestone ownership. Table population, lookup coverage and shared-role keys/assignments are now verified in the bounded audit. Post-award task completion and technical review-cutoff enforcement remain per-slice checks; their business separation is already decided. These are a bounded contract check, not reasons to build a second calendar or ask staff to enter everything twice.

## 8. Evidence limits and reconciliation record

2026-10-21: source inventory completed; this proposal supersedes the investigation-only outline. The work queue pointer and owner feedback memory are updated in the same pass. Priority relative to other work is not changed. The subsequent bounded production census resolves role/table/link population questions. It does not establish full integration readiness; propagation, portal behavior and deployed environment values remain UNVERIFIED.

Historical operator report retained as dated evidence: on 2026-10-07 the owner reported setting Production `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES=["D26","J27"]` and redeploying (J27 register J27-084). It was not read back this session; D27 support is not implied. The wiki still describes D26-only eligibility; this is an unresolved deployment-documentation discrepancy for Slice 0, not evidence of the current value.

The October 7 note described an operations cycle table as planned/unverified. September's production-derived schema snapshot provides stronger evidence that the entity and lookup existed at capture time. The later production census verifies rows and current metadata: J27 exists, D27 is absent from operations, and additional milestone columns were not found. Integration/propagation remains unverified. No schema deletion or correction is inferred.

Independent read-only plan review (2026-10-21) returned READY WITH NAMED CHANGES as an outline: make the existing duplicate reviewer deadline defaults converge on one authority. The canonical-field rule and single-edit acceptance scenario above address that finding. This is a source-based plan review, not approval of live state, implementation, notifications or deployment.

Owner clarification (2026-10-21): calendar authority must be role-based. The Admin-role contract is an integration dependency; its files and role definitions remain with the owning workstream. The owner subsequently reported additional roles added and retained the decision on the calendar role/responsible party as open (§7). This update changes the proposed ownership contract only, not runtime authorization.

Owner workflow correction (2026-10-21): removed the hypothetical post-board late-review scenario from the operating rules and acceptance criteria. Reviews close months before the board meeting; requesting abstracts through Awardees is the concrete post-board overlap case. This records the business boundary without claiming its current technical enforcement has been verified.

Foundational checks (2026-10-21): `docs/audits/cycle-foundations-2026-10-21.md` and its bounded evidence replace the earlier table/role population unknowns. This is read-only evidence, not implementation or calendar-role assignment.

Stop-time owner context (2026-10-21): Justin believes Connor is currently building the J27 application; treat Connor's ownership of that setup as the working assumption, not confirmation that GOApply opportunity 001024 is final or published. Justin still needs to choose the calendar role/responsible party. Clarify backup/escalation coverage and whether that role may publish date changes directly or needs approval for selected changes. These ownership choices and Connor's external calendar contracts do not block preparing an independent reviewer-default isolation slice; implementation itself has not been requested or started.

Owner decision (2026-10-24, Session 639): calendar authority is the Grants Manager role with Program Coordinator fallback (§7). Fallback semantics, recipients and approval rules remain open and are tracked with Connor's contract questions in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`. No role assignment, permission or runtime change was made. Update 2026-10-27: fallback semantics decided (both roles edit at any time; last editor and time shown; log D7) and no second approver (log D8). Recipients remain open.
