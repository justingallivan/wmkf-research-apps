---
title: Staff Deliberations Status and Coverage Plan
domain: workbench
kind: plan
status: draft
summary: "Proposed separation of scheduled visit timing, brief sharing, and writeup readiness; explicit list coverage and prerequisite-aware actions. Planning only; no runtime or production changes authorized."
canonical: false
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Staff Deliberations status and coverage plan

## Outcome and scope

[PLANNED] Staff should be able to answer three separate questions without clicking into every request: whose scheduled visit date has passed, what has been shared through the app, and which writeup is ready for its next document action. A visit date must never imply that someone advanced a document, completed a visit, or sent an email.

This is a proposed implementation plan, not authorization to change runtime, send messages, advance documents, backfill history, or inspect production records. Source baseline: `9fec71a97` on `codex/leadership-dashboard-testing`; the pre-existing lockfile change is unrelated and must remain untouched. Implement later on a dedicated feature branch based on then-current main. Do not mix this work into the leadership-readiness test changes or Claude's transcription work.

Impeccable direction: **Operate** mode, preserving PRODUCT.md and DESIGN.md's calm, task-focused Workbench. Improve the information model and action hierarchy; no visual rebrand, extra dashboard metrics, decorative animation, or replacement framework.

## Evidence and diagnosis

[VERIFIED via supplied PDFs/screenshots] Request 1002903 simultaneously displays Visit and Start Site Visit. The supplied all-PD screenshot also shows 1002912 and 1002988 under Visit. These are examples, not a verified D26 census. [OWNER-REPORTED] At least ten requests have had visits. [UNKNOWN] The exact request set and persisted document states have not been read from production.

| Mechanism | Evidence | Consequence |
|---|---|---|
| [VERIFIED] Visit is inferred from scheduled start being in the past, conditional on the chosen stage artifact being Review | `shared/utils/deliberation-stage.js:75`, `:108` | A Draft brief keeps a past visit out of the Visit group; the date alone is not proof of attendance/completion. |
| [VERIFIED] Stage prefers the Pre-Research Presentation Brief; Pre-Site writeup has an independent lifecycle | `shared/components/workbench/StaffDeliberationsTab.js:572`, `:649` | A shared brief plus past date can show Visit while the writeup remains Draft. |
| [VERIFIED] Start Site Visit is an explicit writeup transition | `lib/services/pre-site-visit/site-visit-transition-service.js:185`; `StaffDeliberationsTab.js:718` | The button updates the existing document's lifecycle/checkpoint; elapsed time does not perform this write. |
| [VERIFIED] Cycle list starts from document rows, then resolves their requests | `lib/services/pre-site-visit/cycle-list-service.js:283` | Requests without either artifact can be completely absent, not merely in the wrong group. |
| [VERIFIED] Cycle-card destination depends on composite stage | `shared/components/workbench/StaffDeliberationsPanel.js:32` | A date-derived Visit row directs staff to Final even when its writeup prerequisite is incomplete. |
| [VERIFIED] Current scope is cycle plus PD; the shell does not pass program to this panel | `pages/api/workbench/staff-deliberations.js:30`; `shared/components/workbench/WorkbenchShell.js:307` | Do not describe the existing list as program-filtered or silently add a new program contract. |

[VERIFIED via existing local test run] Three suites / 131 tests passed: `deliberation-stage.test.js`, `staff-deliberations-tab.test.js`, and `pre-site-visit-cycle-list-service.test.js`. The tab suite explicitly expects the confusing Visit-plus-Draft combination at line 1031. Passing those tests establishes current behavior, not adequate UX. New acceptance cases below supersede that visual expectation while retaining transition safety.

## Owner decisions and scope

1. **[OWNER DECISION] Show every request in the selected cycle and PD scope, including requests with no generated documents.** Source the list from requests, not document presence. Do not apply the Workbench reviewer-finding selector's Phase II/advancing/set-aside filters: they would narrow the owner's chosen cohort. Preserve actual access restrictions and test-record handling. Make the scope explicit: this Staff Deliberations list is cycle/PD scoped; it does not currently apply the shell's grant-program filter. Do not silently add one.
2. **[OWNER CONTEXT] Leadership requested the lighter briefing document because the full Pre-Site Visit drafts were too formal.** Keep the Pre-Research Presentation Brief (the source's current name for this lighter document) separate from the full Pre-Site Visit writeup that seeds Final. Do not merge their files, permissions, publishing actions, sharing state, or lifecycle. In user-facing instructions always name which document is being opened or circulated.
3. **[PLANNED recommendation] No new external-sharing record in the core fix.** “No sharing recorded in this app” means lack of app evidence, not “not shared with leadership.” Existing external attachments must never cause an automatic resend or a document transition. An optional later “Record brief shared outside the app” action could capture staff attribution and evidence without sending mail, but it requires a separately approved persistence/audit contract and is not authorized by this plan.

[PLANNED] Display scheduled timing, not claimed completion; retain explicit writeup transitions. No new visit-completion storage or delivery date is proposed.

## Proposed screen and language

[PLANNED] Replace the four-stop AI draft → Shared → Visit → Final rail on the cycle cards and per-request Staff Deliberations header with independently labeled facts. A rail implies a single ordered process that the system does not enforce.

- **Visit timing:** Not scheduled; Scheduled — date; Scheduled date passed — date; or Schedule unavailable. Never label an elapsed date Visited/Completed without separate authoritative evidence.
- **Presentation brief:** Not generated; Generating; Generation failed; Draft; or Working brief. Show sharing separately: Sent through app — recorded date, No send recorded for this brief, or Sharing history unavailable. A Review lifecycle alone is a locked working document, not proof of email delivery; a sent receipt is transport acceptance, not inbox confirmation.
- **Pre-Site writeup:** Not generated; Generating; Generation failed; Draft; Site Visit workspace started; or Handed off to Final. Broken pointers, incomplete checkpoints and unrecognized states read Status needs checking; never guess from a newer draft or the calendar.

Do not overload the screen with identical pills. Each request row/card has request number/title/institution and PD first; visit timing and the two named document lines next; one primary navigation action and an explicitly named Word link last. Use green only for recorded affirmative state, neutral text for time passing, amber for a genuine prerequisite/problem. Text carries every distinction without relying on dot color. Preserve existing test badges and ordinary-count exclusions.

Illustrative rendering for the supplied 1002903 screen (not a new live read):

```text
1002903 · Multiplexed Ultrasound Decoding for Gene Programs in Living Cells
University of Southern California · PD: Justin Gallivan

Visit timing       Scheduled date passed · Sep 28, 2026
Presentation brief Working brief · [sharing receipt loaded separately]
Pre-Site writeup   Draft

Review the draft and start its Site Visit workspace before creating Final Writeup.
[Review writeup]   [Open Pre-Site writeup in Word]
```

The bracketed sharing explanation is specification notation, not UI copy. Render the actual receipt state from the list above. Do not infer it from the green rail in the screenshot. Open-document links must identify which document they open; a brief's file link must not masquerade as the Pre-Site writeup link.

### List organization and counts

[PLANNED] Default to one request list with an **All / Date passed / Upcoming / Not scheduled** timing control and request/title search. A failed/ambiguous schedule stays visible under All with explicit unavailable status; do not count it as Not scheduled. Retain the existing cycle and Assigned to me / All program directors controls; label the effective scope beside counts. Do not change the user's scope automatically or call an Assigned to me count D26 total.

Timing filters are independent of sharing, writeup state, and Final handoff. A request whose date has passed remains in Date passed even after its document advances to Final. All requests in the agreed cycle/PD scope are included, regardless of document presence. Missing or invalid meeting dates cannot be invented into a cycle; state the cycle-association rule explicitly and provide a reconciliation indication for contradicting recorded evidence.

Counts and visible rows use the same scoped request identities. Ordinary totals exclude marked test records per existing policy; show their separate presence so a visible test card does not look like a count error. Unknown/capped data must not produce a confident complete total. Keep grouping and counts simple; document state remains on each row rather than adding another forest of filters.

### Next action and effects

| Verified document state | Cycle-list navigation | Per-request action/copy |
|---|---|---|
| Missing brief and/or writeup | Open Staff Deliberations | Each named document card retains its own generation action, subject to existing eligibility and permissions. Never direct staff to generate or circulate the full writeup as a substitute for leadership’s lighter brief. |
| Ready Draft | Review writeup → Staff Deliberations | Proposed button label: Start Site Visit workspace. Explain: records this Word version for the writeup workflow; does not schedule a meeting or send an email. |
| Complete Site Visit workspace handoff | Open writeup → Staff Deliberations | Edit current Word document; existing Continue in Final Writeup navigation is available. Navigation is not a claim that all Final eligibility checks pass. |
| Final handoff confirmed | Open Final Writeup | Existing Final status/review controls remain authoritative. |
| Missing identity, failed read, invalid pointer/checkpoint | Check writeup status → Staff Deliberations | Explain the failed read or reconciliation condition; no mutation offered from guessed state. |

All cycle-list controls remain navigation/read-only. A mutation happens only through the existing per-request action with fresh server authorization and fences. Date passing changes timing copy/filter membership only. Keep Share's preview, recipient choice and explicit send intact. Rename matching prerequisite/error/success messages in FinalWriteupTab consistently if the Start Site Visit button label changes.

### Loading, errors and responsive behavior

[PLANNED] Keep the request identity visible while secondary status loads. Display unavailable status for failed secondary reads; do not substitute No document, Not scheduled, Not shared, or zero. Suppress old-cycle/old-scope data immediately on a context switch; fence success and failure responses. Refresh after a confirmed action without claiming success when only the navigation completed.

At desktop width use compact aligned facts and a clear action column; at narrow width stack facts beneath the request heading and keep the primary action adjacent. No horizontal progress rail or color-only meaning. Use existing focus styles, labeled controls, accessible status/error feedback and at least the surface's existing touch target size. Verify long titles, missing dates, no documents, test rows, permission-limited staff and a populated cycle.

## Read contract and implementation sequence

[PLANNED] Trace: Workbench cycle/scope controls → authenticated staff-deliberations GET → request cohort → exact document pointers and distribution receipts plus visit summaries → explicit status DTO → cycle list and per-request consumers. Persistence owners remain Dataverse request/document/activity rows, existing distribution ledger, and SharePoint; no new write or migration is required by the recommended core scope.

1. **Freeze cohort and source baseline.** Apply the owner decisions above. Inspect current callers, cycle association, access restrictions, test isolation, request caps and duplicates. Do not narrow the cohort using document presence or reviewer-finding eligibility. Source tests, not the reported count of ten, define offline fixtures. Production verification needs separately authorized bounded reads; never run all startup checks blindly because the factory-ledger gate loads live configuration itself.
2. **Add independent read projections.** Retain the existing authenticated route/service facade. Project separate brief, writeup and timing states plus availability and exact document links. Resolve canonical pointers independently; legacy no-brief fallback must not hide the existence or absence of a Pre-Site writeup. Preserve compatibility fields until every consumer is switched. Do not make one generic lifecycle mapping serve two different documents.
3. **Fix coverage.** Select all requests in the chosen cycle/PD scope first and join documents optionally. Read current pointer targets even if artifact cycle stamps differ from the request cycle; classify contradictions rather than silently choosing a row. Retain any legacy/document-only rows through an explicit reviewed disposition so narrowing eligibility cannot erase them. Never use one document per-request network waterfall to populate a cycle. Propagate request/document pagination completeness; capped results fail visibly or present explicitly incomplete counts. Evaluate existing `findActiveSummariesByRequests` for bounded paginated visit reads, retaining a visible duplicate/ambiguous-visit indication. It reads active states only: verify how completed/cancelled activities are represented before claiming a complete visit census; no unchecked active-only filter or earliest-row guess.
4. **Update cycle and request surfaces together.** Replace composite stage grouping/rail, align status terminology and exact Word links, route actions by writeup readiness. Changes are limited to StaffDeliberationsPanel, StaffDeliberationsTab, relevant helpers, shell wiring, and FinalWriteupTab prerequisite copy. Calendar/materials/transcript readers keep their existing responsibilities. A shared pure presentation helper is appropriate only after both callers' input/availability differences are enumerated.
5. **Reconcile documentation and verify.** Update the PC Meeting Tracker D7/date language, Pre-RP Brief plan §3.5/B11, route security row, service catalogue and relevant Atlas read contracts to the implemented behavior. Inventory `DELIBERATION_STAGE_KEYS`, editable stage-label settings, their defaults/admin readers, counts and tests before retiring any stage vocabulary. Preserve saved configuration compatibility; no automatic deletion, migration, or repurposing of labels. Release as a reviewed feature branch with explicit promotion and rollback; no data repair should be necessary.

Candidate files: `lib/services/pre-site-visit/cycle-list-service.js`, `pages/api/workbench/staff-deliberations.js`, `shared/utils/deliberation-stage.js`, `shared/components/workbench/StaffDeliberationsPanel.js`, `StaffDeliberationsTab.js`, `WorkbenchShell.js`, and `FinalWriteupTab.js`. Cohort/source changes may require a bounded request selector or adapter extension after inspection; a full Workbench/dashboard refactor is outside scope. Reusing the Meeting Tracker selection entry point without checking its lifecycle/set-aside/program filters is not accepted proof of coverage.

## Acceptance and verification

[PLANNED] Add discriminating fixtures using existing fixture conventions, never invented production records:

- Past scheduled date with brief Draft, brief Review, no brief, no writeup, and Final handoff: each remains discoverable under Date passed in the complete cycle/PD cohort.
- Same past date plus Pre-Site Draft: exact draft state and Review writeup link; no implication that the Site Visit workspace or Final was started.
- Shared/locked brief without successful send, successful send for a different version, external attachment unknown, and history read failure: distinguish each; never mark Sent or trigger resend to fix a status.
- Not-generated document versus failed read, broken pointer, newer failed attempt, mismatched cycle stamp, malformed lifecycle and incomplete handoff: missing/unknown/reconciliation semantics are not conflated.
- Scope my/all, missing caller identity, Concept/Phase II/advancing/set-aside/withdrawn requests in the selected cycle, current cycle vs artifact stamp, test exclusions, duplicate visits, completed/cancelled activity policy, pagination/caps: no disappearing requests or false complete count.
- Date boundary, timezone display, moved future date and invalid date: time only alters timing state; no document POST is issued. Declare server timing reference and refresh policy so browser/server clocks cannot disagree on filter counts.
- Valid handoff and Final navigation, failed/unknown-outcome action and retry: existing identity/ETag/actor/readback safeguards remain. No email, generation or transition caused by filtering, opening a card, or loading the page.
- Rapid cycle/scope/request changes and late success/failure responses: no stale request facts/actions. Keyboard, narrow screen and long-title layouts remain usable.

Run affected existing and new unit suites, scoped type/lint and route/Atlas/status parity gates with each self-test sequentially. Run doc-currency, fact-consistency, doc-symbol-refs and their self-tests after documentation edits. For implementation, run canonical build and a bounded browser fixture pass at desktop/narrow widths. Impeccable: inspect both widths once, fix findings as one batch, confirm once; run its detector only after UI edits. A fresh contract reviewer must trace selection→persistence reads→DTO→both UIs and test exclusions before promotion. A before/after production count remains [UNKNOWN] until separately authorized and measured.

## Plan review boundary

[PLANNED] Whole-flow, stale-state, partial read failure, enum/count fan-out and durable-document reconciliation are required. New persistence and new mutation contracts are N/A for the recommended core fix. External-share recording, visit-completion confirmation, automatic document advancement, backfills and bulk sends are outside that core. Adding the optional external-sharing record or altering the owner-approved cohort requires a bounded plan amendment before code.


## Planning verification

[VERIFIED via local documentation gates] doc-currency, fact-consistency and doc-symbol-refs plus each self-test, and docs-catalog passed. These checks validate document conventions, not the proposed runtime behavior. No implementation, browser mockup, production read or state change occurred during planning.

[VERIFIED via fresh read-only contract reviewer `/root/status_plan_review`] READY for planning scope; source review confirmed the current date/lifecycle mix, document-first omission, separate pointers, premature Final navigation, active-only visit-summary limitation and cycle/PD-only shell contract. The reviewer ran no tests or live calls. Implementation must verify cycle association, completed/cancelled/duplicate visit treatment and receipt version/date projection before asserting complete counts or sharing facts.
