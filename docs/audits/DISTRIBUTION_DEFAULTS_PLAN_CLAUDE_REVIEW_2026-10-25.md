---
title: Independent Claude review of distribution-defaults plan
domain: workbench
kind: audit
status: active
summary: "Read-only OAuth Claude review of plan revision f3d9a908c: READY WITH NAMED CHANGES; reopen/recovery, reset, close-path and status corrections required before coding."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
---

# Independent plan-review receipt — 2026-10-25

[VERIFIED via ordinary host Claude CLI using its Claude.ai OAuth session.]
Receipt: `DISTRIBUTION_DEFAULTS_CLAUDE_PLAN_REVIEW_2026_10_25`.
Root checked unchanged reviewed HEAD and SHA256 before recording this report.
Claude was limited to read/search and bounded mocked tests in this worktree;
no edits, live probes, other checkout access or metered review product authorized.
The report below is preserved verbatim. Recommendations are review findings,
not newly adopted product decisions or implementation authorization. In particular,
forced lifecycle discard and any provably-unsent error-code exceptions require
explicit resolution in the plan; the user-required discard warning is not waived.

## Claude report

I found two required plan changes and two smaller ones. Verdict: **READY WITH NAMED CHANGES**. Nothing was edited, committed, pushed or run against live systems.

- **Reviewed HEAD:** `f3d9a908c78a55cddac1e02d8fc860241aea4967` on `codex/distribution-email-defaults-plan`, clean tree
- **Plan:** `docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md`, SHA-256 `144bdf426152e5fa7bc8bd5bd4d267538ee31892d3334ef603cc4b1108bc0e00`, 314 lines
- **Method:** I applied the plan-review mode of `.claude/skills/contract-reconcile/SKILL.md` and read the source directly (there is no `.codegraph/` here).

## Step 0 — Surface
- **Change surface:** each sender's own saved subject/message, used to fill a new "Share for the deliberation session" email before the existing frozen preview.
- **Entry points:** `StaffDeliberationsTab` → `PreSiteDistributionPanel` dialog; a proposed new route `/api/workbench/pre-site-visit/distribution/email-preferences`; the existing `prepare`, `send` and `history` routes.
- **Persistence:** the existing Dataverse `wmkf_appuserpreferences` table (one new key), the existing Postgres `pre_site_distribution_attempts` table (unchanged), and panel memory (React state).
- **Consumers:** panel form/preview/history, the tab's Resend and send-failure line, the two generic `pages/api/user-preferences.js` guards, the route matrix, the Atlas and tests.
- **Prior findings:** none. The two owner decisions (keep the non-empty message rule; fresh reopen with a discard warning) are settled and treated as fixed.

## Findings (checking the plan's §2 baseline)

1. **CONFIRMED — the panel stays mounted (hidden) after Close; reopening does not remount it.**
   - Evidence: `StaffDeliberationsTab.js:1830` (key is request + brief artifact), `:1841-1842` (`composer={composerOpen ? 'dialog' : 'hidden'}`), `PreSiteDistributionPanel.js:969-973`.
   - In hidden mode the briefing card, history load and in-flight prepare/send keep running. Only the dialog unmounts.

2. **CONFIRMED — wording is filled once per request from history unless the form was touched.**
   - Evidence: `PreSiteDistributionPanel.js:356-357`, `:368-380`, `:426-427`.
   - Any field edit marks the whole form touched.

3. **CONFIRMED — the seven shared settings collapse into one `configured`/`unavailable` status.**
   - Evidence: `context.js:29-43`, `:110-111`.
   - Each field already falls back to its built-in text on its own. `readDeliberationShareDefault` is exported (`context.js:502`), so a per-field status for the subject/message pair can be built without touching the aggregate.

4. **CONFIRMED — prepare takes resolved text from the session-authenticated sender; send reads only what was stored.**
   - Evidence: prepare route `:31-47`, validation at `composition.js:176-181` (subject 1–500 after trim, message 1–20,000 after trim), send body allowlist at send route `:27-29`.
   - `send.js:36-40` checks the exact sender and returns the existing receipt for an already-sent attempt. `:91-100` builds the Dynamics email from the stored subject/body.
   - Nothing at send time re-renders from a template. The plan's §4C claim — no schema, store or send change is needed — holds for the server, subject to finding H1.

5. **CONFIRMED — the existing preference substrate and the agenda precedent work as described.**
   - Evidence: `user-preference.js:67-74` (complete owner+key listing; throws when results are capped).
   - `agenda-personalization.js:17-29` keeps absent, invalid and unavailable distinct. `:43-57` reads back after Save. `:58-67` handles duplicate-aware Clear.
   - `actorRefFromSession` uses the same `dynamicsSystemuserId` that prepare/send use (`actor-ref.js:12`; prepare route `:46`), so the preference owner is the actual sender.

6. **CONFIRMED — none of the proposed symbols exist yet.**
   - `rg` for `deliberation_share_template`, `DELIBERATION_SHARE_TEMPLATE`, `distribution-personalization`, `DistributionWordingDefault` and `distribution/email-preferences` outside `docs/` returned nothing.
   - The distribution route directory contains only `history.js`, `prepare.js` and `send.js`.

7. **CONFIRMED — privacy fan-out is limited to the two generic guards.**
   - Evidence: `user-preferences.js:24-48`, `:110`, `:131`, and `:154/:208` (writes).
   - The other callers of the broad `getUserPreferences` read only their own keys. `email-automation-preferences.js:31-36`, for example, returns only `EMAIL_AUTOMATION`. The plan's two-set guard is sufficient.

8. **PARTLY CONFIRMED — "Preserve history warnings after full page reload" (plan line 122) overstates what history shows.**
   - On `distribution_send_unconfirmed`, `send.js:183` records a failure. History then shows that attempt as a red **Failed** pill, because the code is not in `STALE_PREVIEW_CODES` (`PreSiteDistributionPanel.js:17-24`, `:189-200`).
   - The tab then offers **Resend** (`StaffDeliberationsTab.js:1498-1500`; `latestSendFailure` at panel `:389-391`).
   - This is existing behavior, not caused by the plan. See L2.

## New Issues

### H1 — HIGH: fresh reopen (requirement 6) conflicts with keeping unresolved sends (requirement 7), and the plan gives no rule to tell them apart

Today the panel keeps state across Close, which is what makes an exact retry possible within the session:
- After an unconfirmed send, the panel keeps the pending preview and an "uncertain" notice (`PreSiteDistributionPanel.js:643-649`).
- After any other non-OK send response, the preview and `confirmed` stay in place and the outcome is labeled `body.outcome || 'failed'` (`:675-678`, `:695-698`).
- Close is enabled once sending finishes (`:970`).

Some of the cases the UI labels "failed" can actually have gone out:
- **Send went out but was not recorded:** `distribution_send_persist_failed` (`send.js:71,135,180`) happens after Dynamics accepted the email. Its body has no `outcome`, so the UI shows **failed**.
- **Lease lost:** `distribution_send_lease_lost` (`send.js:155-159`).
- **Network/5xx failure:** a transport-level failure comes through as "uncertain".

**Failure scenario:**
1. Staff send, Dynamics accepts, then the Postgres write of the result fails. The panel shows "failed" with the preview still there.
2. Staff close the dialog and click **Resend** (`openComposer` at `StaffDeliberationsTab.js:1182-1185` ignores `latestSendFailure.operationId`).
3. If the implementation treats "failed" as resolved, the fresh reopen clears the preview and fills new wording. Staff create a new preview (a new operation ID), and a second email goes out.
4. Today, the same Close → Resend reopens the kept preview, and re-sending the same operation reconciles to "sent" via `send.js:67-72`.

The plan's terms "locally pending, transport-unconfirmed or in-progress" (line 118) do not say which panel state counts.

**Required plan change:**
- Define "unresolved" by what the panel can observe, and fail closed. Any preview whose operation had a send call issued is unresolved unless the result was `transportAccepted`, or the code is on an explicit list of provably-unsent outcomes (the stale codes, `distribution_preview_changed`, `distribution_not_prepared`, `distribution_actor_mismatch`, `distribution_impersonation_required`, identity 400/403). Every other outcome, including unknown ones, keeps the state.
- State that while a preview is unresolved, reopen (including Resend) skips the refresh and the discard warning, and shows that same preview.
- State explicitly that after a page reload nothing is rehydrated. That is an existing limit; see L2.
- Add acceptance tests for `persist_failed`, `lease_lost`, a network error, and an unknown 5xx code, each followed by Close → Resend.

This needs no DTO or schema change: `projectDistributionAttempt` already exposes `state`, `dynamicsEmailId`, `sendRequestedAt`, `transportAccepted` and `lastErrorCode` (`model.js:198-209`).

### M1 — MEDIUM: nothing currently detects a reopen, and recipient re-seeding won't re-run on its own

- **How a reopen is detected:** the panel has no transition detector, and the tab changes only `composer`. The plan's "compose generation" (line 186) doesn't say who increments it.
- **Recipient re-seeding:** recipient seeding compares by value (`PreSiteDistributionPanel.js:304-341`). If the attendee suggestions haven't changed, a reset form won't be re-seeded unless `seenSeed` and the per-field ownership flags (`autoOwnedRef`) are reset too. The result would be a blank To field despite "reseeds recipient suggestions".
- **What baseline the warning compares against:** suggestions can arrive after the dialog opens, so the comparison baseline must follow auto-filled fields, or a later auto-fill will raise a false warning.

**Required plan change:**
- Name the mechanism. Either the panel tracks its previous `composer` value, or the tab passes an open counter. If the tab passes it, add `StaffDeliberationsTab.js` and its test to §5; it is currently missing.
- Require the reset to clear `seenSeed`, `autoOwnedRef`, `composerTouchedRef`, preview, confirmation, `staleInputs`, notices and `sendFeedback`, all except under H1.
- Define the baseline as the loaded wording plus the latest auto-filled values.
- Test both cases: unchanged suggestions on reopen, and suggestions arriving after open.

### M2 — MEDIUM: the close paths and the confirm UI aren't listed; one close path skips the panel entirely

Close paths today:
- the header and footer **Close** buttons (`PreSiteDistributionPanel.js:230-248`);
- Escape through the native `onCancel` (`EmailDialog.js:30`), which is blocked while the recipient picker is open (`:970`);
- the tab's forced close when a brief regeneration is found (`StaffDeliberationsTab.js:771-773`), which bypasses `onCloseComposer`;
- a remount when the artifact key changes (`:1830`);
- `showDistributionPanel` becoming false, which unmounts the panel (`:1290`).

There is no discard-confirm precedent in this dialog family: the agenda `closeComposer` simply resets the form (`SessionAgendaPanel.js:268-274`). A nested native `<dialog>` for the confirm interacts with the outer `onCancel` and focus trap.

If the default editor follows the agenda pattern, its abort-on-unmount (`AgendaWordingDefault.js:19`) would drop the message from a forced close during a Save/Clear that may already have committed.

**Required plan change:**
- List every close path.
- Make forced close and remount discard without a warning, and say so; the next open is fresh.
- Pick one confirm presentation. I recommend an inline confirm row in the dialog footer, which is desktop-appropriate and avoids a nested dialog. State that Escape on that row means Cancel.
- Require the editor's mutation result to survive the dialog unmounting: keep the state in the panel, or after any interrupted mutation show "reload to confirm" on the next open.

### L1 — LOW: where the actor key comes from, and what an actor switch does to recovery

- The tab and panel don't read the session today. The precedent is `SessionAgendaPanel.js:138-140`, a wrapper keyed on `status:dynamicsSystemuserId:email`.
- If the actor changes, an unresolved send can't be retried by the new actor (`send.js:36-38` returns 403 `distribution_actor_mismatch`).
- **Change:** say the panel (or a thin wrapper) reads `useSession` for the key, and that an actor change drops local state, including unresolved-send state. History remains the record. This narrows requirement 7's "keep their original sender".

### L2 — LOW: correct the history wording (plan line 122)

- Change "preserve history warnings" to "preserve existing history presentation".
- Note the existing gap: an unconfirmed attempt shows as **Failed**, and after a reload the tab offers **Resend**, which starts a new compose.
- Leave fixing it out of scope.

### L3 — LOW: where the briefing-copy status comes from once history no longer fills the wording

- Requirement 4 says the five briefing-copy settings must be kept separate. But the only status source today is the seven-field aggregate in history (`context.js:110-111`).
- If history keeps driving the existing notice (`PreSiteDistributionPanel.js:725-734`), an outage on the shared subject would still display "Built-in wording is shown" while personal wording is actually shown.
- **Change:** say the existing aggregate notice is replaced. The new endpoint reports pair status, and history gains an additive briefing-copy-only status, or briefing-copy status is dropped from compose because prepare re-reads it anyway (`prepare.js:54,63`).

### Optional, not required
- A `beforeunload` guard.
- Cross-tab locking.
- Fixing the history label for unconfirmed sends.
- Rebuilding recovery state from history after reload.
- Rejecting the literal `wmkf-briefing-link://` in saved bodies. `composition.js:70` replaces that literal in stored body text; saved defaults would make it recur on every send, but the risk is low.

## Recommendation Evidence

| Recommendation | Current prerequisite | Available at the point needed | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| Fail-closed "unresolved" rule (H1) | Panel keeps preview/feedback (`PreSiteDistributionPanel.js:643-649,675-698`); `send.js:67-72` reconciles an exact retry | Yes: projection fields at `model.js:198-209`; local `sendFeedback` | Source trace; existing 9 suites green | If `distribution_send_persist_failed` could only occur before transport, H1 would downgrade. But `send.js:71,135,180` all follow an accepted status | VERIFIED source; behavior PLANNED |
| Explicit reopen detection and reset of `seenSeed`/`autoOwnedRef` (M1) | Value-compared seeding at `PreSiteDistributionPanel.js:327-341` | Yes, panel-local | NOT TESTED; source reasoning only | A test showing To re-seeds after a reset with unchanged suggestions would refute it | ASSUMED risk, source-backed |
| Inline confirm row; forced close discards silently (M2) | `EmailDialog.js:30` `onCancel`; tab force-close at `StaffDeliberationsTab.js:771-773` | Yes | NOT TESTED | A nested-dialog prototype that handles Escape/focus correctly would make this preference only | Recommendation (UX), not a defect |
| No schema/store/send change (plan §4C) | Prepare takes resolved text; send reads stored (`send.js:91-100`) | Yes | Source trace | Holds unless H1 required a new DTO field; it doesn't | VERIFIED |

## Final Verdict

**READY WITH NAMED CHANGES**

- **Required changes:**
  - **H1** — a fail-closed "unresolved" rule and the Resend/reopen exception.
  - **M1** — the reopen-detection mechanism and the full reset list, including recipient seeding and the warning baseline; add the tab to §5 if it supplies the open signal.
  - **M2** — the close-path list, the confirm presentation, and mutation results that survive the dialog unmounting.
- **Named corrections:** L1, L2, L3.
- **Settled, not reopened:** the server-side contract (key, route, both privacy guards, exact-owner service, validation bounds, 256 KB parser cap) holds as planned.

## Limits
- **Evidence:** source and mocked tests only. No live preference rows, tenant permissions, `.env`, database, deploys or other checkouts were touched.
- **Tests run:** 9 suites / 345 tests passed (`npm test -- --runInBand`). That covers the plan's 5 distribution suites plus the agenda personalization and route, reserved-keys and Staff Deliberations tab suites. I did not re-run the plan's 5 suites separately, so I can't confirm its 180 figure.
- **Not reviewed:** I didn't read `retained-snapshot.js` or `email-recovery.js` in full; they are outside the paths this plan changes. I didn't check whether `dynamicsSystemuserId` reaches the client session beyond the `SessionAgendaPanel` precedent, so treat that as an assumption until checked at implementation time.
- **Not authorization:** this review doesn't authorize coding or release.

