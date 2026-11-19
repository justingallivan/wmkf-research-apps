# J27 Step I Review — 2026-11-09

Codex reviews of step I (the offramp as Phase II status 682090001) on `claude/j27-read-model`. Three rounds, recorded verbatim; resolutions are in the plan `J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` §9 (I6, I7).

| Round | Commit reviewed | Verdict | What changed in response |
|---|---|---|---|
| 1 | `1556da9e9` (build) | NEEDS REWORK | `806e7bc6c`: shared `assertNotOfframped` in materials create/invite/remind/preview; invitation send refuses before `store.claim`; I6(a) names `SiteVisitEditor`, `SiteVisitMaterialsCard`, `PresentationInvitationPanel`, `RecordingAndTranscriptCard`; plan C4/C6/C8/§8 reconciled. |
| 2 | `806e7bc6c` | NEEDS REWORK (one required change) | `b0b4f21d9`: `waiveMaterialsItem` and `confirmMaterialsReady` refuse too; regression loop covers them. |
| 3 | `b0b4f21d9` | READY | `591f33267` repinned two integration suites the branch line had turned red; `74f6b8111` recorded the verdict. |

## Round 1 (session 01a1be81… lineage; saved from the Codex task result)

**Verdict: NEEDS REWORK.** The primary guards work, but existing materials collections bypass the offramp refusal. Two documentation gaps and an invitation receipt-write discrepancy also remain.

Reviewed `claude/j27-read-model` at `1556da9e96f00dff64305662bda8a648c81f37d7`. Verification used real modules transpiled and executed in memory, with external I/O replaced by mocks. No Dataverse access, external writes, file edits, or commits occurred. The existing `package-lock.json` modification was untouched.

## Contract surface

- **Change:** Step I’s terminal outcome, presentation refusals, discovery filtering, and strip display.
- **Entry points:** J27 derivation; presentation scheduling, materials, invitation, and transcription services; Reviewer Finder; stage strip.
- **Persistence:** Reads `akoya_request.wmkf_phaseiistatus`; affected operations ordinarily write presentation records, materials collections, email activities, and invitation receipts.
- **Consumers:** Workbench, Meeting Tracker, Reviewer Finder, tests, and the implementation plan.
- **Prior findings:** The six assertions supplied in this review request.

## Findings

1. **PASS — Pure-model outcome and precedence.**  
   [VERIFIED via in-memory reproduction] `682090001` produced `offramped` with zero tasks at initial assessment, peer review with received reviews, deliberations with a presentation, and final assessment. Its blocker covers exactly the four presentation operations plus `send-invitations`. Recording tasks remain unblocked; `decided-award` wins over Offramped.  
   Evidence: [j27-read-model.js:130](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/workbench/j27-read-model.js:130).  
   Residual risk: live metadata was intentionally not reverified.

2. **PARTIAL — All four primary service gates work; alternate-path and no-write requirements fail.**  
   [VERIFIED via in-memory reproduction] All four actual request projections select `wmkf_phaseiistatus`. Each primary gate rejects Offramped with its specified code, admits a live Phase II Pending row, and preserves legacy-check precedence. Primary refusals produced no mocked writes. However, materials re-invitation/reminder paths bypass refusal, and sending a previously prepared presentation invitation changes its receipt before refusing. See New Issues.

3. **PASS — Reviewer Finder membership.**  
   [VERIFIED via real `getMyProposals` execution with mocked reads] The Offramped fixture yielded **0 proposals in `actionable` and 1 in `all`**.  
   Evidence: [my-proposals-service.js:156](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/reviewer-finder/my-proposals-service.js:156).  
   Residual risk: no live query was executed.

4. **PASS — Strip outcome badge and blocker filtering.**  
   [VERIFIED via React static rendering and visibility-matrix assertions] Every terminal outcome renders its label. Offramped renders without a next task. Blockers appear only when they intersect a task reachable by the current phase. `offramped` can therefore appear from peer review onward because it also blocks reviewer invitations.  
   Evidence: [J27StageStrip.js:66](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/J27StageStrip.js:66).  
   Residual risk: browser styling was not exercised.

5. **PASS — Outcome-label parity; PARTIAL — retired blocker removal.**  
   [VERIFIED via execution and repository search] `J27_OUTCOME_LABEL` keys exactly match `J27_OUTCOMES`. No `continue-decision-missing` references remain in runtime code or tests. It still appears as active guidance in the plan, so “gone from every surface” is false.  
   Evidence: [J27StageStrip.js:46](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/workbench/J27StageStrip.js:46); [plan:112](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md:112).

6. **FAIL — I6(a) does not identify every affected control.**  
   [VERIFIED via component/caller tracing] It names the read-only `ResearchPresentationMaterialsCard`, but omits `SiteVisitMaterialsCard`, which owns **Request materials**, **Send reminder**, and **Send invitation again**.  
   Evidence: [SiteVisitMaterialsCard.js:266](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/meeting-tracker/SiteVisitMaterialsCard.js:266); [SiteVisitEditor.js:502](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/shared/components/meeting-tracker/SiteVisitEditor.js:502).

## New Issues

1. **P1 — Existing materials collections bypass the offramp refusal.**  
   [VERIFIED via in-memory reproduction] For an Offramped request with an open collection:

   | Entry point | Observed mocked effects |
   |---|---|
   | `createMaterialsCollection` | Refused; zero writes |
   | `inviteMaterialsContributors` | `updateContacts`, `sendEmail`, `recordInvitation`: once each |
   | `remindMaterialsContributors` | `claimManualReminder`, `sendEmail`, `attachReminderEmailId`: once each |
   | `previewMaterialsEmail` | `create`, `invite`, and `remind` all returned `canSend: true` and a proof |

   These are reachable paths: the authenticated route rebuilds the preview and dispatches directly to the invite/remind functions. Its preview-proof check does not supply the missing status guard.

   Evidence: [collection-service.js:711](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/site-visit-materials/collection-service.js:711), [collection-service.js:766](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/site-visit-materials/collection-service.js:766), [materials route:77](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/pages/api/meeting-tracker/visits/[requestId]/materials.js:77).  
   **Required change:** Apply the refusal to previews and existing-collection send paths before any mutation or dispatch; add regressions with an existing collection.

2. **P2 — Presentation invitation refusal is not write-free for an existing preview.**  
   [VERIFIED via in-memory reproduction] Prepare while live, then set the mocked request to Offramped and send: the service refuses with `presentation_invitation_request_offramped`, but calls `store.claim` and `store.release` once each. Both execute SQL updates and increment the receipt version. Email creation and sending remain blocked.

   Evidence: [invitation-service.js:108](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/meeting-coordination/invitation-service.js:108); [invitation-store.js:21](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/meeting-coordination/invitation-store.js:21).  
   **Required change:** Check Offramped before claiming a prepared send receipt, retaining the subsequent dispatch-time checks and reconciliation behavior.

3. **P2 — UI deferral inventory omits the actual materials action surface.**  
   [VERIFIED via source] I6(a)’s inventory would leave `SiteVisitMaterialsCard` without the outcome needed to mirror server refusal.  
   **Required change:** Name that component and its create/invite/remind controls explicitly, alongside scheduling, `PresentationInvitationPanel`, and recording/transcription controls. UI implementation can remain deferred.

4. **P3 — The current plan still contradicts Step I.**  
   [STALE/CONFLICT] C4 says there is no offramp outcome; C6 retains `continue-decision-missing`; C8 still requires an invariant involving it. The appended build record does not reconcile those contracts.  
   Evidence: [plan:84](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md:84), [plan:112](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md:112), [plan:136](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md:136).  
   **Required change:** Reconcile current sections; retain older review evidence as explicitly historical.

## Audit coverage

- **Whole-flow:** Traced controls → authenticated materials route → preview/proof → service → mocked persistence/dispatch → returned collection.
- **Partial-success:** Exercised materials sends and receipt updates; the bypass completes successfully rather than merely passing an initial check.
- **Async/stale-state:** Exercised live-preview → Offramped-send transition. Broader existing async UI behavior was outside Step I.
- **Helper extraction:** N/A; Step I adds no extracted helper.
- **Durable surfaces:** No new schema. Existing receipt mutations expose the no-write discrepancy.
- **Documentation reconciliation:** Contradictions identified; **CLAIM NOT RECONCILED**, consistent with read-only scope.
- **Symbol-consumer fan-out:** Searched the raw field, outcome vocabulary, label map, and retired blocker; checked the requested projections and consumers.
- **Gates:** Full Jest/CI gates were not run. Results above are bounded in-memory reproductions, not a full-suite pass.

## Recommendation Evidence

| Recommendation | Current prerequisite / execution point | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|
| Guard materials preview and resend/remind | Request already loaded before effects | Offramped preview and both sends succeeded | Live create succeeds; Offramped create refuses | VERIFIED need; fix untested |
| Refuse before invitation claim | Request read precedes receipt claim | Offramped send called claim/release | No email created or sent | VERIFIED need; fix untested |
| Correct I6(a) inventory | Materials controls exist in `SiteVisitMaterialsCard` | Component and parent traced | Named Workbench card is read-only | VERIFIED |
| Reconcile plan contracts | Current C4/C6/C8 contradict implementation | Source and prose compared | Runtime/tests contain no retired blocker | VERIFIED |

## Final Verdict

**NEEDS REWORK**

Required named changes: close the materials bypass, enforce write-free refusal before invitation claim, correct I6(a)’s control inventory, and reconcile the stale plan sections.

Codex session ID: 01a1c1ca-6053-7f70-aa83-a437c1aa9e78
Resume in Codex: codex resume 01a1c1ca-6053-7f70-aa83-a437c1aa9e78


## Round 2

## Findings

Reviewed `git diff 1556da9e9..806e7bc6c` on `claude/j27-read-model`. No edits or commits made.

**Change surface:** Offramped refusal in materials and presentation-invitation services, regression tests, and plan corrections.

**Entry points:** Meeting Tracker materials and invitation API routes and their UI controls.

**Persistence:** Dataverse request status and email activities; Postgres `site_visit_material_collections` and `meeting_presentation_invitations`.

**Consumers:** Materials cards, invitation receipts, the J27 stage strip, tests, and the plan.

### 1. RESOLVED — The three reported materials paths now refuse Offramped requests

[VERIFIED via `collection-service.js:504,723,779,902`]

The shared `assertNotOfframped(request)` checks `wmkf_phaseiistatus === PHASE_II_OFFRAMPED`.

- **Create:** checks after request loading, identity matching, and legacy eligibility; before collection creation or dispatch.
- **Invite/remind:** check immediately after `loadContext` and `assertMatchingRequestIds`, before `getOpenCollection`, recipient updates, reminder claims, or dispatch.
- **Preview:** checks after request loading and before `getOpenCollection`.

The production request projection includes `wmkf_phaseiistatus` at lines 71–74 and is used by `DEFAULT_DEPENDENCIES.getRequest` at line 102.

**Residual risk:** The broader assertion that every collection-mutating entry point is covered is false; see New Issues.

### 2. RESOLVED — Invitation send refuses before receipt access or claim

[VERIFIED via `invitation-service.js:28,32,99–113`]

`requestForActor` returns the fetched request row after validating its ID. The production `request` dependency explicitly selects `wmkf_phaseiistatus`.

`actOnInvitation` now checks Offramped for `action === 'send'` after authorization and `requestForActor`, before both `store.get` and `store.claim`.

**Non-send actions should remain available:**

- `reconcile` reads the transport result and updates the existing receipt; it does not create or resend email.
- A prepared receipt returns immediately on reconciliation.
- `release` is internal lease cleanup in `finally`, not a public action. Blocking it would interfere with cleanup.
- There is no public `discard` action here: the service accepts only `send` and `reconcile`; the route additionally accepts `prepare`.
- Retention cleanup should remain independent of Offramped admission.

Evidence: `invitation-service.js:91–97,100,108–114,140–149`; invitation route `:12–15`.

**Residual risk:** These are request-time checks, not an atomic transaction with external changes to the Dataverse status. The later `context()` rechecks remain intact.

### 3. VERIFIED BY SOURCE — Both regression additions detect removal of their guards

[VERIFIED via test fixtures and execution paths; deletion experiments NOT EXECUTED]

**Materials loop, `site-visit-materials-collection-service.test.js:285–300`:**

The fixture contains an actual open collection, missing required items, recipients, a scheduled visit, and a readable contributor token. Each iteration requires the specific `site_visit_materials_request_offramped` rejection.

**Would it pass if its corresponding guard were deleted? No.** No other Offramped check supplies that error on these paths. Invite/remind can proceed toward their side effects; preview can proceed toward composing the email. Even an unrelated downstream failure would fail the required error-code assertion.

The negative assertions are meaningful:

- Invite: `updateContacts` and `sendEmail`.
- Remind: `claimManualReminder` and `sendEmail`.
- Preview: no mutation or dispatch.

**Invitation test, `meeting-presentation-invitation-service.test.js:117–120`:**

It first prepares a valid invitation, then changes the mocked request to Offramped before sending.

**Would it pass if the new early guard were deleted? No.** The later `context()` guard would still reject with the same error and prevent `createEmail`, but only **after `store.claim`**. The new `store.claim` negative assertion is what detects the original ordering defect.

**Execution limitation:** The requested Jest suites could not start. Next configuration loading attempted to write a Workflow-generated temporary route file and received `EPERM` under the read-only sandbox. I do not claim a passing Jest run.

### 4. RESOLVED — I6(a) names the correct controls

[VERIFIED via plan `:286` and component sources]

The inventory now names:

- `SiteVisitEditor`
- `SiteVisitMaterialsCard`
- `PresentationInvitationPanel`
- `RecordingAndTranscriptCard`

It correctly identifies materials request, reminder, repeat invitation, and preview operations. UI mirroring remains explicitly deferred; the controls expose server failures through their existing error paths.

### 5. RESOLVED — The requested plan sections describe the implemented outcome

[VERIFIED via plan `:84,112,136,241,286`; read model `:29,67,134,222,240`; `J27StageStrip.js`]

- **C4:** includes `offramped` as a terminal outcome.
- **C6:** replaces the unconditional `continue-decision-missing` blocker with conditional `offramped`, covering the four presentation operations and reviewer invitations.
- **C8 item 6:** distinguishes absence of `start-group-review` from membership in the blocker’s `blocks` list. An Offramped outcome produces no tasks.
- **§8:** describes the Offramped outcome badge.
- **§9 I6(a):** records the correct controls and deferred UI behavior.

These requested corrections agree with source. This is not a claim that every historical statement elsewhere in the plan has been reconciled.

## Materials export inventory

[VERIFIED via every export in `collection-service.js` and runtime caller search]

| Export | Guard requirement and result |
|---|---|
| `canonicalFilename` | No: pure filename helper. |
| `matchReceivedFiles` | No: matches existing attachment records. |
| `DEFAULT_DEPENDENCIES` | Dependency bundle, not an admission endpoint; its transport function has no independent Offramped check. |
| `resolveCurrentMaterialsContacts` | No: resolves contacts without saving or sending. |
| `projectCollection` | No: projects existing collection/attachment state. |
| `summarizeCollection` | No: summarizes the projection. |
| `invitationBodyText` | No: text rendering. |
| `reminderBodyText` | No: text rendering. |
| `getMaterialsCollection` | No: reads existing collection, attachment receipts, and upload status. |
| `createMaterialsCollection` | Yes; present at `:580`. |
| `inviteMaterialsContributors` | Yes; present at `:723`. |
| `remindMaterialsContributors` | Yes; present at `:779`. |
| `prepareMaterialsReminderEmail` | No independent mutation/dispatch guard required: prepares content only. |
| `sendReminderEmail` | Dispatches without its own guard. Current live manual caller is guarded; automatic delivery is explicitly retired. |
| `previewMaterialsEmail` | Yes under the requested preview contract; present at `:902`. |
| `missingRequiredItems` | No: pure checklist calculation. |
| `waiveMaterialsItem` | **Mutates without a guard**, at `:957–965`. |
| `confirmMaterialsReady` | **Mutates without a guard**, at `:969–976`. |

The `sendReminderEmail` exception has an enforced caller boundary: the manual service guards before claiming and calling it, while `sweepMaterialsReminders` returns `automatic_reminders_retired` for default dependencies before processing rows (`reminder-sweep.js:95`). Its default sender resolver also returns `null` (`:73`). This is not a currently reachable automatic-send bypass.

## New Issues

### P2 — Waive and Ready remain reachable collection mutations after Offramped

[VERIFIED via [collection-service.js:957](/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model/lib/services/site-visit-materials/collection-service.js:957), materials route `:85–86`, and an in-memory execution probe]

`waiveMaterialsItem` loads the request but ignores its Phase II status before `updateChecklist`. It permits both waiving and restoring requirements.

`confirmMaterialsReady` reads the collection and calls `markReady` without checking the request’s Phase II status.

The API routes these actions directly; neither goes through the guarded preview path. An in-memory probe executing these actual function bodies with injected dependencies recorded:

```json
{"offramped":true,"calls":["updateChecklist","markReady"]}
```

This prevents confirming the requested “no other exported collection-mutating entry point lacks the guard” condition.

**Required change:** Guard both mutations before their writes, or establish an explicit exception for post-Offramped collection maintenance and test that exception. They cannot be classified as read-only paths.

During review, an external working-tree edit added an **uncommitted I7 paragraph** describing these operations as intentionally allowed closeout. That text is **not part of `806e7bc6c`** and is excluded from this commit’s verdict. Also, restoring a waived requirement is broader than closing out a collection.

## Contract audits

| Audit | Result |
|---|---|
| Whole-flow | Traced UI → authenticated/validated routes → services → stores/email → response/error consumers. Two mutation exceptions remain unresolved. |
| Partial-success | New guards precede the affected writes and claims. Existing dispatch uncertainty handling remains unchanged. |
| Async/stale-state | Invitation’s later source checks remain intact. Materials checks do not guarantee atomicity against a subsequent external status change. |
| Helper extraction | Shared helper preserves the prior create refusal and supplies the same refusal to invite, remind, and preview. |
| Durable surfaces | No new schema, table, route, or DTO shape in this diff; migration requirements N/A. |
| Doc reconciliation | Requested sections checked against source. No edits; no whole-repository sweep completion claim. |
| Symbol/consumer fan-out | Both affected request projections include the raw field; model blocker/outcome and strip rendering checked. No new enum introduced by this rework. |

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Resolve the Waive/Ready guard exception | Offramped request with an existing collection | Waive already loads the request; Ready needs to retain/read its status | In-memory function-body probe reached both writes | Route inspection found no upstream Offramped check for either action | VERIFIED gap; policy exception unresolved |
| Preserve reconciliation and lease cleanup | Existing receipt requiring status reconciliation | Receipt and transport state available | Source inspection; runtime NOT TESTED | Checked for create/send fall-through: prepared reconciliation returns early; other states use reconciliation | VERIFIED by source |

## Final Verdict

The four original findings are resolved, and the new regression assertions target the reported failures. The requested export-wide mutation check exposes two remaining unguarded actions whose exception is not established in the reviewed commit.

Required named change: resolve and test the Offramped policy for `waiveMaterialsItem` and `confirmMaterialsReady`.

**NEEDS REWORK**

Codex session ID: 01a1c1de-70c3-7fd3-be7c-124a4285d393
Resume in Codex: codex resume 01a1c1de-70c3-7fd3-be7c-124a4285d393


## Round 3 (targeted re-verification)

[VERIFIED via HEAD, diff, source and caller inspection] Reviewed `b0b4f21d9` on `claude/j27-read-model` against `806e7bc6c`.

- **(a) Confirmed:** waive and ready guards precede every write—`updateChecklist` at line 964 and `markReady` at line 976.
- **(b) Confirmed by source analysis:** deleting the waive guard permits the update; deleting the ready guard produces `site_visit_materials_incomplete` instead of the asserted Offramped error. Both regressions therefore fail. The ready fixture’s no-write assertion alone would not detect deletion.
- **(c) Confirmed for active runtime paths:** create, invite, remind, waive and ready are guarded. Exported `sendReminderEmail` relies on its guarded caller; its other caller is the explicitly retired automatic sweep, whose dry run skips dispatch.
- **(d) Confirmed:** `getMaterialsCollection` remains open to Offramped requests. Email preview remains intentionally blocked. Plan I7 records the policy.

No new blocking findings. Jest execution was blocked before tests ran because Workflow initialization attempted a filesystem write prohibited by the read-only sandbox. No files edited; the existing `package-lock.json` modification remains.

Recommendation evidence: N/A.

READY

Codex session ID: 01a1c1e1-5fb7-7723-836d-8f364303c46c
Resume in Codex: codex resume 01a1c1e1-5fb7-7723-836d-8f364303c46c
