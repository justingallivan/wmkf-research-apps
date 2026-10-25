---
title: Claude re-review of distribution-defaults plan
domain: workbench
kind: audit
status: active
summary: "Historical read-only review of 85ad11acf: original six findings resolved in substance; four named refinements before coding."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
---

# Independent re-review receipt — 2026-10-25

[VERIFIED via ordinary host Claude CLI using Claude.ai OAuth.]
Read-only review in this worktree; no live operations or other checkout changes.
The report below is preserved verbatim and applies to its exact reviewed revision.
Later proposed corrections require their own review; no coding authorization.

# Re-review: personal distribution email defaults plan (revision 2)

**Verdict: READY WITH NAMED CHANGES.** All six first-review findings are addressed in substance, and the owner decisions are intact: non-empty messages, a fresh ordinary reopen, and a warning before discarding edits. Two of the revision's new mechanisms need named changes before coding. Nothing was edited, committed, run live or delegated.

- **Reviewed HEAD:** `85ad11acf51caa12f9b4e2a35ca197cd825dba9f` (`codex/distribution-email-defaults-plan`, clean tree).
- **Plan:** `docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md`, SHA256 `1dd0610427ea3ee5ee849e8f3580b3a19503fef055cec84a92e11b9b72f5a89b`, 438 lines. Both values match the request.
- **Method:** `.claude/skills/contract-reconcile/SKILL.md` Mode A, reading source directly (no `.codegraph/`). I read the historical first review and the whole plan.
- **Tests:** none run. The baseline didn't change, and every planned behavior is not built yet.

## Step 0 — Surface
- **Change surface:** each sender's own subject/message defaults, plus a retained, pausable compose panel. It has an issued-send recovery envelope and a request-page navigation guard.
- **Entry points:** `StaffDeliberationsTab` → `PreSiteDistributionPanel` dialog, the proposed `distribution/email-preferences` route, the existing prepare/send/history routes, and `pages/workbench/[requestId].js`.
- **Persistence:**
  - `wmkf_appuserpreferences`, with one new key.
  - `pre_site_distribution_attempts`, unchanged.
  - Panel memory, which holds the envelope.
- **Consumers:** panel, tab, request page, the two generic preference guards, the route matrix, the Atlas and tests.
- **Prior findings being verified:** H1, M1, M2, L1, L2, L3 (first review at `f3d9a908c`).

## First-review resolution matrix

| Finding | Status | Evidence / residual |
|---|---|---|
| **H1** unresolved-send rule | **RESOLVED for duplicate-send safety; overcorrected (see N1)** | Plan §3.7 (lines 118–141). The retention policy is correct against server recovery for every send outcome the panel can see; detail below. |
| **M1** reopen detection and reset | **RESOLVED (PLANNED)** | Plan §4D lines 236–242 (parent `composeOpenVersion`) and 260–271 (full reset, including `seenSeed`, `autoOwnedRef` and `composerTouchedRef`). It reseeds recipients even when the suggestions are unchanged and keeps the baseline only for auto-owned fields. The tab is added to the file list (§5 line 318). The value-compared seeding it must override is real [VERIFIED via `PreSiteDistributionPanel.js:307-341`]. |
| **M2** close paths, confirm UI, mutation survival | **RESOLVED for in-dialog paths; navigation part needs N2** | Close-path matrix at lines 273–282. The inline confirm is feasible: `EmailDialog.js:30` routes Escape via `onCancel` → `onClose` only when `!busy`, so one guarded handler works and no nested `<dialog>` is needed. Panel-owned mutation state is at lines 299–305. The force-close it replaces exists [VERIFIED via `StaffDeliberationsTab.js:771-773`]. |
| **L1** actor key source | **RESOLVED; key shape needs N3** | `pages/api/auth/[...nextauth].js:355,361` copy `azureEmail` and `dynamicsSystemuserId` into the staff session. The `useSession` precedent is at `SessionAgendaPanel.js:138-140`. |
| **L2** history wording | **RESOLVED** | Lines 136–140 now state the existing gap: Failed + Resend after a reload starts a new compose. This matches `attemptPresentation` at `PreSiteDistributionPanel.js:189-200` and the tab at `StaffDeliberationsTab.js:1498-1500`. |
| **L3** notice source | **RESOLVED (PLANNED)** | §4B lines 196–199: pair-specific status replaces the 7-field aggregate, briefing-copy status is dropped from compose, and the history DTO is unchanged. The history seed it removes is real [VERIFIED via `PreSiteDistributionPanel.js:367-380`]. |

**H1 checked against server recovery and freshness ordering** [VERIFIED via `lib/services/pre-site-visit/distribution/send.js`]:
- `distribution_send_persist_failed` (`:71`, `:135`, `:180`) always happens after Dynamics accepted the email. An exact retry reconciles it at `:67-73` before any freshness check.
- `distribution_send_lease_lost` (`:154-161`) happens after `recordSendRequested` (`:146`). `dynamics_email_id` is already set by then, so a retry reconciles at `:67` if the email went out.
- `distribution_send_unconfirmed` (`:167-176`) returns `pendingSend` with the same operation ID. The panel adopts it at `PreSiteDistributionPanel.js:643-649`.
- `distribution_send_request_persist_failed` (`:147-153`) happens before the send intent is recorded. Retaining the envelope there is conservative but harmless.
- `sendEmail` has exactly one call site, `send.js:163` [VERIFIED via `rg`]. It runs only after an email activity has been persisted (`:87`, `:104`, `:109`), the send intent recorded (`:146`) and the lease renewed (`:154`).
- Limit: if the source changed and Dynamics hasn't marked the email accepted, an exact retry falls through to the freshness checks at `:75-76` and stays stale. The plan accepts this at lines 256–258 ("remains blocked/unresolved"). That is consistent, but it feeds N1.

## New findings

### N1 — MEDIUM: the envelope locks staff out after send refusals that provably sent nothing, and an existing green test will fail
**Plan:** §3.7 lines 118–133, §7 line 378 ("existing stale-input and transport-acceptance tests remain green") and line 377.

**Evidence (checkable now, not a planned behavior):**
- `tests/unit/pre-site-distribution-panel.test.js:595-625`: the first send returns `distribution_material_stale`. The test then expects the preview to be cleared and **Create preview** to work again.
- Under §3.7, that first call creates an envelope. Create preview is blocked while the envelope exists, and only `transportAccepted` clears it. A retry returns the same stale code, because the source is still changed. "Do not unlock a new send automatically" then applies, so staff can't create a new preview for that request until they leave the page. They also see a "reconcile the original email" notice for an email that was never created.
- The plan contradicts itself: §7 line 378 says this suite stays green.
- The same trap follows any designed refusal before an email exists:
  - the checks before the send lease (`send.js:26-51`): identity, not found, `preview_changed`, actor mismatch, `not_prepared`, impersonation 503;
  - the `brief_regeneration_in_progress` refusal (panel `:658-667`), after which the source has changed and retry goes stale.

**Why a non-allowlist fix exists:** the server already separates "never reached Dynamics" from "might have" by whether an email activity exists, not by error code. The panel encodes this at `PreSiteDistributionPanel.js:180-200`: stale with no `dynamicsEmailId` shows as Superseded, stale with one shows as unconfirmed. The ordering backs it: the staleness checks at `send.js:75-76` run before `createEmailActivity` at `:92`, and `sendEmail` (`:163`) needs a persisted activity. Stale error bodies carry no attempt data (`pages/api/.../send.js:42-43`), so the proof must come from history. `projectDistributionAttempt` already exposes `dynamicsEmailId`, `sendRequestedAt`, `lastErrorCode` and `transportAccepted` (`model.js:198-209`).

**Minimal correction (choose one; both keep the warning and add no error-code allowlist):**
- **(a) Release from server state.** Release the envelope only if:
  - every send call issued for that operation got a complete server JSON response (no network failure, abort, `inProgress` or `distribution_send_unconfirmed`), so no call can still be running on the server; and
  - a fresh history read shows that exact operation ID with `transportAccepted === false` and `dynamicsEmailId == null`.

  Anything else keeps the envelope. This keeps the first review's concern intact: an earlier call that never answered still blocks release.
- **(b) Owner-visible escape.** Add "Discard this attempt and start a new preview" to the recovery view, behind the same inline warning. Its copy should say the original email may have gone out. This needs an owner decision because it is a user-confirmed release.

In both cases the plan must say what happens to `pre-site-distribution-panel.test.js:621`: either it stays green under (a), or it is consciously changed. Add a planned test that a `brief_regeneration_in_progress` → retry-goes-stale sequence never leaves the panel permanently blocked when no email activity exists.

### N2 — MEDIUM: the navigation guard is feasible, but the plan omits the in-repo mechanism and the signal path, and promises a router capability that doesn't exist
**Plan:** §4D lines 280–293 and §5 line 318.

**Mechanism exists and is proven feasible at source level:**
- `shared/components/board-writeups/useBoardUnsavedChanges.js:7-53` already combines:
  - a `routeChangeStart` handler that throws a `{cancelled: true}` error;
  - `beforePopState`, which re-pushes the edited URL with `pushState` when Back is cancelled;
  - `beforeunload` while dirty;
  - an approval tracked per destination, so one confirmed navigation passes without a second prompt.
- In the installed Next (16.3.8), `routeChangeStart` fires for shallow pushes too; only `isQueryUpdating` skips it (`node_modules/next/dist/shared/lib/router/router.js:1064-1066`). So the tab strip's `router.push(..., {shallow: true})` (`[requestId].js:165-171`) is covered. The cancellation handling and the `_bps` hook are also present (`router.js:531`, `:1579`).

**What is missing, precisely:**
1. **Signal path.** `StaffDeliberationsTab` unmounts on any tab switch (`[requestId].js:282-289`), and the panel is rendered only under `showDistributionPanel &&` (`StaffDeliberationsTab.js:1821`). Two things need a dirty/retention signal from the panel:
   - the tab's new "keep mounted while dirty, mutating or holding an envelope" condition (line 247);
   - the page-level guard (line 284).

   The plan names neither the prop nor the callback. Name one callback, for example `onRetentionChange({ dirty, mutationPending, envelope })`, from the panel to the tab and, if the page owns registration, on to the page. Alternatively, register the guard hook inside the panel or tab: it is still mounted when `routeChangeStart` fires, before navigation commits. That would let `[requestId].js` leave the §5 file list.
2. **"Restore prior router hooks" (line 291) can't be done with public APIs.** `beforePopState` holds a single callback and there is no public getter (the slot is private `_bps`). The precedent resets it to `() => true` (`useBoardUnsavedChanges.js:50`). No other `beforePopState` user exists outside tests [VERIFIED via `rg`]. Change the line to "reset to allow-all on cleanup, matching the precedent".
3. **No real-router compatibility proof exists anywhere in the repo.** `jest.setup.js:17` stubs `beforePopState`, and `tests/unit/board-unsaved-changes.test.js:6` mocks `next/router` entirely. Line 292's "verify actual Next router integration in tests" therefore can't be met with Jest. Name one of:
   - a Playwright spec (`playwright.config.js` and `tests/e2e/` exist) on `/workbench/<id>?tab=staff-deliberations` covering four cases:
     - cancelling a tab click keeps the panel state;
     - cancelling a Layout `Link` does the same;
     - Back with cancel restores the URL and state;
     - confirming navigates once with no second prompt;
   - or an explicit statement that mocked-router unit tests plus a manual browser check are the accepted bound for this slice, as they evidently were for the board precedent.
4. **Known side effect, to record.** Throwing from `routeChangeStart` rejects the `router.push` promise, and `selectTab` doesn't catch it. The precedent has the same behavior. State it as accepted, or catch the cancellation error in `selectTab`.

This is planned acceptance work, not evidence needed now, except item 2, which is an impossible promise to correct in the text.

### N3 — LOW: transient auth `status` shouldn't be part of the panel's key
**Plan:** §4D lines 244–245 and 295–296. The plan copies the agenda key `status:dynamicsSystemuserId:azureEmail` and makes it the panel's mount key. The agenda panel holds no unrecoverable state; this panel holds the envelope.
- next-auth v4 `update()` sets `loading` (`node_modules/next-auth/react/index.js:498`), which would remount the panel and silently drop the envelope.
- No app caller of `update()` exists today [VERIFIED via `rg`], so this is latent.

**Correction:** mount only while `status === 'authenticated'`, and key on `requestId + dynamicsSystemuserId` (email as fallback). Treat `loading` as a pause, not a new scope. Real identity changes still clear state, as line 282 requires.

### N4 — LOW: name every async lane, including prepare/send/reissue, and gate result writes by operation
**Plan:** §4B lines 206–207 and §6 line 339. Today one `sequence`/`controllerRef` is shared by history, prepare, send and reissue (`PreSiteDistributionPanel.js:354-355`, `:397-399`, `:464`, `:580`, `:625`). Send's `finally` skips `setSending(false)` when the sequence has moved (`:699-704`).

Under the new source-change history reload (lines 251–253), a shared lane would do two things:
- abort the in-flight send fetch on the client, while the server keeps running;
- drop the send result, leaving `sending` stuck.

That fails toward safety (the envelope is retained), but it would make the panel stick. Line 339 states the intent. Line 206 lists only the history, initialization and preference lanes. Add the prepare/send/reissue lane explicitly, and require envelope result writes to be gated by operation ID + actor rather than the history generation. Add a planned test: an artifact change while a send is in flight records the send result.

### Scope note (no change required)
The lifecycle rework replaces a remount that an earlier Codex adversarial review required (`StaffDeliberationsTab.js:1823-1830`). The plan does list the obligations that replace it at lines 251–255:
- bump the source generation;
- reload history;
- clear the cached sent flag;
- invalidate the preview.

It also requires a test rather than just deleting the key. This is the dominant risk surface of the slice and should get first attention in implementation review. It doesn't block the plan. Beyond N1–N4 I found no other scope creep: the server, store and send contracts are untouched (§4C, §5 lines 322–325).

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| N1(a) release from history when no email activity exists | `send.js:75-76` staleness checks run before `:92` create; single `sendEmail` call at `:163`; panel rule at `:189-200` | Yes: history DTO fields at `model.js:198-209` | Source trace + `rg`; test `:595-625` read. NOT executed | A path that calls `sendEmail` or Dynamics send without first persisting `dynamics_email_id` would refute it; none found (`send.js:87/104/109` precede `:146/:163`) | VERIFIED prerequisite; behavior PLANNED |
| N2 reuse the board guard hook | `useBoardUnsavedChanges.js:7-53`; `router.js:1064-1066` | Yes in Next 16.3.8 source | Source read only; repo tests mock the router | A Playwright run where a cancelled shallow tab push still unmounts the tab would refute it | VERIFIED source; browser behavior ASSUMED |
| N3 key without `status` | `SessionAgendaPanel.js:138-140` precedent; next-auth `:498` | Yes | Source read; `rg` shows no `update()` callers | A next-auth path that flips `status` during normal use would raise the severity; none found | VERIFIED latent |
| N4 separate send lane | Shared `sequence`/controller at panel `:354-355`, `:625`, `:699-704` | Yes | Source read; NOT TESTED | A test where an artifact change mid-send still records the result under the current code would refute it | VERIFIED source risk |

## Final Verdict
**READY WITH NAMED CHANGES**

Required named changes:
- **N1:** add a release path for envelopes where no email activity exists, via (a) history or (b) an owner-approved confirmed escape. Reconcile the §7 line 378 claim with `pre-site-distribution-panel.test.js:621`.
- **N2:**
  - cite `useBoardUnsavedChanges.js` as the mechanism;
  - name the retention/dirty callback from the panel to the tab (and to the page, if the page registers the guard);
  - replace "restore prior router hooks" with "reset to allow-all";
  - name the acceptance bound: a Playwright spec, or mocked tests plus a manual check as the accepted limit.
- **N3:** take `status` out of the panel's key.
- **N4:** add the prepare/send/reissue lane and gate envelope writes by operation ID.

Settled and not reopened: the owner decisions, the server contracts (key, route, both privacy guards, exact-owner service, validation bounds) and the history DTO.

**Limits:** source and test files only. No tests run, no live probes, `.env`, database or other checkouts; Claude's database work was not touched. Browser behavior of the navigation guard is not proven here (see N2.3). This review does not authorize coding.

