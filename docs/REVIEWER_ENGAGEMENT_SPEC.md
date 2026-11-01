---
title: "Reviewer Engagement Spec — Model B (accept-now) + reminders, quota, token TTL"
domain: reviewer-workbench
kind: source-of-truth
status: canonical
summary: "Reviewer lifecycle and automatic acceptance materials delivery; the separate reminder scheduler remains paused."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - pages/api/review-manager/campaign-config.js
  - pages/api/review-manager/campaign-timeline-defaults.js
  - lib/services/reviewer-campaign-timeline.js
  - lib/external/reviewer-token-ttl.js
  - lib/services/review-upload.js
  - pages/api/cron/reviewer-reminders.js
---

# Reviewer Engagement Spec — Model B (accept-now) + reminders, quota, token TTL

**Status:** The original S275 phases 1–4 remain live. Acceptance-time materials delivery shipped in PR #562 (`fcad0ad53`); the first natural J27 acceptance delivery remains unverified. Phase 3 reminder code remains implemented, but its Vercel schedule was **paused on 2026-09-01** during the reviewer-token incident response and remains absent. **Owner decision 2026-10-24: reminders stay manual for J27 as well; the automatic reminder schedule remains paused.** The separate materials fallback/recovery action is still available. Runtime source at commit `4dd57369` contains the incident remediation and token-liveness guard. Incident-session operations observed Ready deployment `dpl_89s9MzdUnDST6Jm9Vs3cnMLPmUDu` and an authenticated Workbench smoke; the deployment metadata exposed no source SHA, and no tracked smoke artifact was retained. The post-deploy read-only D26 audit examined 51 never-reminded candidates matching the review-due sweep predicate: all 51 were active/eligible and zero were blocked. Rows already carrying `wmkf_remindersentat`, including the morning reminder batch, were outside that audit population. The owner subsequently lifted the procedural manual reminder freeze; that decision does **not** restore the automatic schedule. Phase 1 `pages/api/review-manager/campaign-config.js`; Phase 2 `lib/external/reviewer-token-ttl.js` (via `send-emails-service.js`) + `materials_not_sent` guard in `lib/services/review-upload.js`; Phase 3 code `pages/api/cron/reviewer-reminders.js` + `lib/services/reviewer-reminder-sweep.js`; Phase 4 `lib/services/reviewer-quota.js` (`maybeNotifyQuotaReached` — originally in `respond.js`, since the S350 accept-fast-response build called from the acceptance drain `lib/services/reviewer-acceptance-drain.js` after it re-verifies the committed accept; since S352 the notify actually EMAILS the lead PD, see `REVIEWER_QUOTA_PD_EMAIL_PLAN.md`) + `pages/api/review-manager/withdraw-sufficient.js`. Schema provisioned in prod (§4, 2026-06-21). The original Codex sanity pass (S275, commit `18933df3`) folded its P1/P2 findings in before build (phase reorder so token cap ships with Release; quota count-after-write + If-Match concurrency; `materials_sent` guard; reminder-marker clear on Re-invite; expired-link copy/UI). S277: the manual "Re-invite already-invited" UI affordance was removed (§3.F). Supersedes the interpretation snapshot in `REVIEWER_ENGAGEMENT_PLAN_INTERPRETATION.md`.

**Citation convention:** current-behavior claims carry `[verified <file>::<symbol>]` (read this session). `[LIVE S275]` and `[IMPLEMENTED S275]` both mark additions that shipped in the S275 build; neither implies that an associated scheduler is currently registered. `[SCHEMA]` marks a field backed by a custom Dataverse column — **all of which are now provisioned in prod (see §4, 2026-06-21)**; the tag is a type-marker, not a "still to create" flag. Settled design calls are `[DECISION]`.

---

## 1. Reviewer lifecycle — accept, then send materials automatically

A reviewer accepts (or declines) the invitation with onboarding at the offer stage (COI/AI acks and payment contact; honorarium handling follows §2.3). After acceptance, the durable acceptance job prepares and sends one materials email with a new review link, the proposal, the review due date, and applicable cycle attachments. Staff release from Track Reviewers remains available for recoverable failures and cases held from automatic delivery; it is not the normal J27 release step. There is one reviewer decision (accept/decline), not an "agree in principle / finalize" two-step. This acceptance-delivery flow shipped in PR #562 (`fcad0ad53`); the first natural J27 acceptance delivery remains unverified.

> The "hold / agree-in-principle" path (`HoldView`, the `respond.js` hold action, the `proposal-readiness` gate) was **REMOVED** in S279 (commit `a8676af1`). It never fired (the readiness gate was stubbed always-ready; prod had 0 `held` rows), and onboarding now happens at the single Accept. The `held` responsetype value is retained for read-safety; a historical `held` row routes to the accept form.

---

## 2. Verified current state (the spine — already live)

| # | Behavior | Evidence |
|---|---|---|
| 2.1 | Every reviewer is dispatched to the full Stage-2a accept form. (S279: the readiness gate + hold view were REMOVED; `proposal-readiness.js` deleted.) | `[verified lib/external/review-engagement-state.js::computeEngagementState` (S301 extraction; called by `pages/api/external/review/[token]/context.js`)] routes withdrawn/materials/accepted/declined and **falls through to `stage2a` for everything else** — including a historical `held` value (no `hold-invite` branch remains) |
| 2.2 | A fresh non-opted-out accept requires COI + AI policy acks (400 if missing) and a mailing address + phone (422 if missing); writes `accepted` + acks; lands in `accepted-pre-materials`. | `[verified pages/api/external/review/[token]/respond.js handler]` (policy_ack_required, payment_contact_required, applyStage2aResponse accept) |
| 2.3 | Honorarium onboarding at accept has two gates: capture-only/off mode (`HONORARIUM_ONBOARDING_DEFERRED=true` or missing discriminator GUIDs) captures contact + address but mints no `akoya_request`; the 2026-07-01 no-BILL target unsets that gate and keeps `BILL_ONBOARDING_DEFERRED=true`, so the portal creates the honorarium request while skipping BILL/payment. | `[verified lib/bill/honorarium-onboard-orchestrator.js::ensureHonorariumOnboarding]`; current strategy `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` |
| 2.4 | The invitation is the first-contact email; on acceptance, the durable acceptance drain normally sends one email carrying proposal materials and the review link. Manual Track Reviewers release remains for fallback/recovery and held cases. The reviewer row also exposes a dedicated reminder action, and the daily thank-you sweep sends courtesy copy after submission; its marker and email do not close the review or establish completion/payability. | `[verified shared/components/reviewers/InviteEmailModal.js]` hardcoded `templateType:'invitation'`; `[verified lib/services/reviewer-acceptance-drain.js::releaseMaterialsOnAcceptance]`; `[verified lib/services/reviewer-acceptance-email.js::prepareMaterialsAcceptanceEmail]`; manual recovery `[verified shared/components/reviewers/ReleaseMaterialsModal.js]`; `[verified lib/services/reviewer-manual-reminder.js]`; `[verified lib/services/reviewer-thankyou-sweep.js]` |
| 2.5 | `emailSentAt` is stamped per-suggestion at invite send, re-stamped on Re-invite. | `[verified pages/api/review-manager/send-emails.js]` (invitation/hold branch: `invited:true, emailSentAt:now`); Re-invite via `allowResend` `[verified lib/utils/reviewer-invite.js::shouldSkipDuplicateInvitation]` |
| 2.6 | The secure token is a signed JWT; **only its hash is stored**. A dispatched email explicitly carrying `{{externalLink}}` re-mints at the final send boundary and overwrites the hash ("latest link wins" — prior links stop verifying). Preview rendering is read-only and carries a non-live placeholder. Review-due reminders and ordinary follow-up/thank-you messages are link-free and neither mint nor rotate token authority. | `[verified lib/services/review-manager/render-emails-service.js::renderEmails]` (`buildSendTimeExternalUrlPlaceholder` only); `[verified lib/services/review-manager/send-emails-service.js::sendEmails]` (`computeReviewerTokenExpiry` → `mintAndStore` → JWT-segment substitution for link-bearing drafts); `[verified lib/services/reviewer-reminder-sweep.js::sendOneReminder]` (review-due liveness guard + marker claim with no mint); `[verified lib/external/token-lifecycle.js::mintAndStore]`, `[verified lib/services/external-token.js::mintToken]` (JWT `exp` = `expiresAt`) |
| 2.7 | `verify-suggestion-token` enforces JWT signature/expiry + stored hash + revoked flag + stored `wmkf_externaltokenexpires`. | `[verified lib/external/verify-suggestion-token.js]` |
| 2.8 | Normal J27 delivery sends materials automatically in the acceptance job. The separate Track Reviewers materials action remains available for fallback/recovery and held cases; selection is accepted-reviewer-only, and no selection means all eligible accepted reviewers. No independent scheduled materials cron is used. | `[verified lib/services/reviewer-acceptance-drain.js::releaseMaterialsOnAcceptance]`; manual path `[verified shared/components/reviewers/ReviewerManagePanel.js]` / `ReleaseMaterialsModal`; durable receipt/recovery `[verified lib/services/reviewer-engagement/materials-release-store.js]` |
| 2.9 | `withdrawn_sufficient` (responseType `100000003`) has a portal "no longer needed" view + a respond guard. At spec time **nothing wrote it**; **Phase 4 added the writer** (`POST /api/review-manager/withdraw-sufficient`, §3.C). | view `[verified context.js]` `view='withdrawn-sufficient'`; guard `[verified respond.js]` 409 `withdrawn_sufficient`; writer now `lib/dataverse/adapters/reviewer-suggestion.js::updateLifecycle` via the withdraw-sufficient route |
| 2.10 | `sweep-stale-invites` closes non-responders to `no_response` **after the linked Grant Cycle's calendar Board date** (not respond-by; the request meeting date before meeting-date retirement step 4). | `[verified pages/api/cron/sweep-stale-invites.js]`, `[verified lib/services/reviewer-suggestion-sweep.js]` |
| 2.11 | Invite timing is now split: admin cycle defaults (`reviewer.campaign_timeline_defaults`) pre-fill the modal, `respondOffsetDays` and `reviewDueDate` become request-level campaign config once set, and `proposalSendDate` remains email-only invitation copy. The invite modal overlays request campaign values last so it does not show stale per-user or cycle-default due dates; timing tokens are still client-substituted and line-dropped when blank. | `[verified InviteEmailModal.js]` `campaign-timeline-defaults` fetch, `PREFERENCE_KEYS.INVITE_TIMING`, `campaign-config` fetch, `applyTiming`; request fields in §3.E/§4 |

---

## 3. The build — four original additions plus acceptance delivery

**The four original S275 additions shipped.** Acceptance-time materials delivery was added separately in PR #562 (`fcad0ad53`), with a durable shared claim and staff recovery. Reminder code remains implemented while its Vercel schedule stays paused.

### 3.A  Release to reviewers `[LIVE S275]`
A staff action that emails proposal/materials to eligible accepted reviewers when automatic delivery was held or needs recovery. Routine J27 delivery occurs in the acceptance job; this is not a separate scheduled release or a readiness/hold mechanism.
- **Target:** `wmkf_accepted = true` rows only, enforced **server-side** `[DECISION #10]` (reuse the materials-send recipient gate).
- **Token effect:** manual materials recovery re-mints a fresh, long-lived token (§3.D), subject to the durable release claim and delivery state. It supersedes the invite link only when the email is dispatched.

### 3.E Acceptance-time materials delivery `[IMPLEMENTED; PR #562, merge fcad0ad53]`

After the accept is committed, the durable acceptance drain verifies that the reviewer remains accepted, prepares the email and attachments, claims the shared materials-release row, mints the accepted-reviewer token, sends the acceptance email with materials, then records delivery. A retry follows the durable release row; it does not blindly send a second email. The release store's unique `suggestion_id` claim is shared with manual release, preventing the two paths from independently dispatching the same materials.

If preparation keeps failing before the release claim, the job retries for about 15 minutes, then sends the existing acceptance confirmation and alerts staff to release materials manually. After a claim, an uncertain/failed send is surfaced for staff recovery; staff can resend only through the explicit recovery action. Confirmed-sent bookkeeping retries record state without resending. The email uses separate seeded acceptance-with-materials wording and includes only attachments actually present. **Release-date copy cleanup:** PR #586 (2026-11-01) removes the invitation's `{{proposalDelivery}}` promise and the invite-dialog date (the live-text rebaseline still needs owner OK); the legacy Reviewer Finder date fields remain open. No natural J27 acceptance has yet exercised this flow.

### 3.B  Two reminders (scheduler paused 2026-09-01) `[IMPLEMENTED S275]` `[DECISION #14]`

**Operational hold:** `/api/cron/reviewer-reminders` remains implemented and cron-secret protected, but it is not registered in the production Vercel cron schedule. `scripts/check-reviewer-reminder-hold.js` fails the Vercel prebuild and CI if that exact route is re-registered or if the cron registry becomes unreadable. The owner lifted the separate procedural manual reminder freeze after production deployment, authenticated smoke, and the post-deploy D26 token-liveness audit; manual resumption does not weaken or retire the cron hold.

**Materials one-time-delivery rule:** the server refuses Materials for a reviewer with a durable materials receipt, a post-materials lifecycle status, explicit token revocation, or any terminal/unknown status; the staff modal also omits Materials when the selected reviewer is no longer awaiting first delivery. There is no resend override. Replacement-link recovery remains a separate explicit action so an ordinary Materials retry cannot invalidate a link already in use.

**Remediated runtime contract (production-observed 2026-09-01):** review-due reminders and ordinary follow-up/thank-you templates are link-free and cannot mint or carry a reviewer URL. Both manual and scheduled review-due paths fail closed before marker claim or transport unless the stored token is active and covers the effective review deadline; the Reviews tab exposes the same eligibility separately from the generic token state. Respond-by reminders may still mint and deliver the short pre-acceptance link; invitation and first Materials delivery are the other ordinary link-bearing sends. `POST /api/review-manager/regenerate-token` is the explicit replacement-link recovery action and preserves the matching Postgres `review_drafts` row. Review-due extension/resend does not rotate token authority. For a non-null override save with a stored token hash, preflight rejects revoked authority and requires an active token to cover the requested date; otherwise it fails before the date write with `token_recovery_required`. With no stored hash, the token check is skipped; null restore also skips this preflight. Staff must use explicit replacement-link recovery and retry when the active token does not cover the requested date. Email dispatch follows the date commit; a dispatch failure can therefore leave the date saved with an explicit partial-success result. Evidence and limits: source commit `4dd57369`; incident-session observation of Ready deployment `dpl_89s9MzdUnDST6Jm9Vs3cnMLPmUDu` whose metadata did not expose a source SHA; authenticated browser smoke with no retained tracked artifact; and `outputs/reviewer-reminder-token-liveness-D26-postdeploy-2026-09-01.json` (51 never-reminded D26 sweep candidates examined; zero blocked).

**Reactivation prerequisites:** item (1)—review-due reminders no longer invalidate an active reviewer link/session—is complete and production-verified. Do not restore the schedule until the remaining items are complete and verified together: (2) per-request enabled and lead-day settings are visible and editable in the staff UI; (3) new-request defaults fail closed; (4) an owner-approved value is applied to the existing armed rows before the first run; (5) the incident hold guard is deliberately retired in the same reviewed change that restores the schedule; and (6) the restored sweep first runs with `?dryRun=1` and its `maintenance_runs` evidence is reviewed before a live send. The prior manual freeze is closed; no code/UI kill switch was added.

Runtime eligibility requires each reminder flag to be exactly `true`. The current Dataverse schema defaults both flags to `true` on a bare new request, while the current Campaign settings modal exposes neither flag nor lead-day control. Older rows may be `null`, which the sweep treats as disabled. This schema/UI mismatch is a configuration gap, not an intentional operator-controlled default. A 2026-09-01 read-only production probe found **92 current-cycle active requests with both flags true**; 8 also had the date/offset inputs used by the sweep and 4 had a future review-due date. Those are armed rows, not proof that every row is immediately send-eligible, but they make the removed schedule—not null legacy data—the present containment control. `[VERIFIED via read-only Dataverse probe, 2026-09-01]`

**Respond-by reminder** — nudge invited non-responders.
- Target: `invited && no response` (not accepted/declined/withdrawn).
- Per-reviewer deadline = **that reviewer's `emailSentAt` + `respondOffsetDays`** (computed in code; OData can't do the arithmetic — same pattern as the sweep). `[verified §2.5 emailSentAt is per-suggestion]`
- Fire **once**, when `today ≥ (deadline − leadDays)`, reviewer still unresponded, token not expired, `wmkf_respondremindersentat` empty. If already past the soft date at first eligibility, send once anyway (a late nudge is fine — respond-by is soft). Never repeat. `[DECISION #3]`
- Marker: new per-suggestion `wmkf_respondremindersentat` `[SCHEMA]`, **separate** from the review-due/follow-up marker. `[DECISION #4]`
- The reminder email contains `{{externalLink}}` → it **re-mints** a fresh token with the same nonaccepted expiry rule (effective due instant at 23:59:59 UTC + 2 days), invalidating the prior invite link. Reviewers use the most recent link. `[DECISION #13, verified §2.6]` The portal copy fix is complete: expired-link guidance says "most recent email," not "most recent invitation email."
- **Required side-effect (Codex P2):** Re-invite (`allowResend`) MUST clear `wmkf_respondremindersentat` in the **same write** as the `emailSentAt` re-stamp (`send-emails.js` invitation branch), or the fire-once marker from the prior wave blocks the new window's reminder. Build the marker with this in mind from the start.

**Review-due reminder** — nudge accepted reviewers who haven't submitted.
- Target: `accepted && materials-sent && not-submitted` — never an accepted-pre-materials reviewer who hasn't received the proposal. `[DECISION #11]`
- Deadline = the fixed review-due date − leadDays.
- Staff may deliberately send a row-level reminder from Track Reviewers or Reviews without entering a generic batch composer; there is no active generic `followup` batch UI.
- **Implemented (Phase 3; manual path subsequently unified):** manual and scheduled review-due paths claim `wmkf_remindersentat` with `If-Match` before sending, preserve the existing review token, and instruct the reviewer to use the secure link in the original Materials email or contact the Foundation for an explicit replacement. A concurrency loser sends nothing. The scheduled path is fire-once; the direct staff action deliberately permits a later manual resend. `[verified lib/services/reviewer-reminder-sweep.js::sendOneReminder; lib/services/reviewer-manual-reminder.js]`

### 3.C  Quota → notify PD → selective decline `[LIVE S275]`
**Not automatic.** Reaching the desired count notifies the PD, who decides who (if anyone) to decline — so a wanted-but-slow senior reviewer is never auto-shut-out.
- Count = `wmkf_accepted = true` rows for the request (any downstream stage), queried **AFTER** the accept PATCH commits (`applyStage2aResponse` runs first in `respond.js`; a pre-write count is off by one) `[DECISION #1, Codex P2]`. Reuse the existing accepted-reader filter shape (`lib/dataverse/adapters/reviewer-suggestion.js::findAcceptedByPD` uses `wmkf_accepted eq true`).
- **Concurrency mechanism (named, Codex P1):** the notify must be a **conditional null→set** of `wmkf_quotanotifiedat` `[SCHEMA]` via an `If-Match`/ETag update (`DynamicsService.updateRecord` supports `ifMatch`), so only the first writer past the threshold succeeds and notifies; concurrent accepts that lose the race do not double-notify. Notify the PD on that single false→set transition. (Without the conditional write, concurrent accepts can both notify, and a stale count read can miss the threshold until a later accept — so the conditional set is required, not optional.)
- PD action (Workbench): select pending invitees and send the polite "no longer needed" decline → sets `withdrawn_sufficient` + `wmkf_withdrawnsufficientat` (the missing writer from §2.9) + sends the decline email + clears those reviewers' `wmkf_respondremindersentat` so no reminder fires.
- `withdrawn_sufficient` is settable **only on still-pending rows** (`invited && !accepted && !declined`), server-guarded; it never touches an accepted/honorarium row. `[DECISION #8]`

### 3.D  Token TTL — non-responders expire early, accepted keep ~90 days `[LIVE S275]`
No JWT "extension" (a signed JWT can't be extended in place; the raw token isn't stored). Link-bearing sends use the existing latest-link-wins re-mint. `computeReviewerTokenExpiry` uses the effective due date at `23:59:59 UTC`: accepted reviewers expire 90 days later, and invitees/non-responders expire 2 days later. If no sane future due date exists, either status falls back to now + 90 days. `[DECISION #5; current source contract]`
- **Invite send** (and respond-by reminder re-mint): mint with expiry at the effective due instant + 2 days. This is the non-responder cap.
- **Acceptance materials send and manual materials recovery**: mint a fresh, **long-lived** token (expiry = effective review-due instant + 90 days) for the review window + late returns. Only ACCEPTED reviewers receive this, so non-responders never get the long token. Acceptance delivery uses the shared durable release claim; manual recovery follows the same release record. `[DECISION #1 late-returns-OK]`
- `send-emails-service` picks the expiry from fresh recipient/request state at the final mint boundary; the review-due date is available there via the hydrated request (→ §4 persistence). `[verified §2.6 send-time mint]`
- `sweep-stale-invites` (cycle Board date) and token expiry are **different gates**: token expiry controls access and the sweep is **status** bookkeeping (`no_response` at the linked cycle's Board date). The historical plan's UI gap note concerned the period when an invitee's link was expired but the row still read pending/invited. `[DECISION #9; historical rationale]`
- **Acceptance materials are held or delivery is uncertain:** the durable acceptance flow records the hold/uncertainty and alerts staff. The Review Manager provides manual release or explicit resend recovery. The separate **regenerate-token** staff endpoint remains a replacement-link action and preserves any saved Postgres review draft; it is not a substitute for recording a materials release.
- **Extension and signed-token boundary:** there is no fixed calendar maximum for the accepted-row due-date override. For a non-null override save with a stored token hash, preflight rejects a revoked token and requires an active token to cover the requested date; otherwise it returns `token_recovery_required` before writing the date. With no stored hash, the token check is skipped; null restore also skips it. Extension does not rotate token authority; use explicit replacement-link recovery, then retry. Email/calendar dispatch follows the date commit, so a dispatch failure can return partial success with the date already saved.

### 3.F  Per-request campaign config + panel change `[LIVE S275]` `[SCHEMA]`
Persist, on the request, what the cron and quota logic need:
- `respondOffsetDays` (default 7), `reviewDueDate` (fixed), `respondReminderEnabled` + `respondReminderLeadDays`, `reviewDueReminderEnabled` + `reviewDueReminderLeadDays`, `desiredCount`, `quotaNotifiedAt`.
- Timing and quota values are written on first invite-batch send and editable later from the Reviewers tab. The backend campaign-config API can read/write the reminder enabled/lead pairs, but the current Campaign settings modal does **not** expose those controls. The reminder schedule must not be restored until that operator surface and fail-closed defaults are built. `[DECISION #7; operational hold 2026-09-01]`
- **Panel change:** the respond-by input becomes **"days to respond" (offset)**, not a fixed date `[DECISION — fixes the multi-wave bug where a fixed day-0 date shortchanges later waves]`; review-due stays a fixed date; proposal-delivery stays informational email text only (no reminder — `[DECISION]` dropped). As of 2026-07-06, `/admin` also stores current-cycle defaults (invitation start, response offset, proposal release, review due) in `wmkf_appsystemsettings` key `reviewer.campaign_timeline_defaults`; `InviteEmailModal` uses them before request-level overrides and renders the timeline editor collapsed by default.
- Multi-wave / Re-invite: a new wave is a normal first-time invite (its own `emailSentAt`); a Re-invite re-mints (review-due cap), re-stamps `emailSentAt`, and **clears `wmkf_respondremindersentat`**; request-level config is untouched. `[DECISION #6]`
- **No manual "Re-invite already-invited" UI affordance (`[DECISION]` Justin, S277).** It was removed when the automated respond-by reminder was introduced. The automatic respond-by scheduler remains held (§3.B); the sanctioned nudge for an invited non-responder is the manual "Send reminder" action on Invite Reviewers (`RespondReminderModal` via `ReviewerInvitePanel.js`), which re-mints a fresh link the same way the automated respond-by reminder would (§2.6). The server-side `allowResend` re-mint + marker-clear contract (lines above, §2.5, §4) remains implemented but is part of the token-safety remediation surface. A new wave still goes out as a normal first-time invite via "Send invitation" on not-invited rows.

---

## 4. Schema additions — PROVISIONED ✓ (2026-06-21, prod)

> **Status: DONE.** All 9 fields were created in **production** (`wmkf.crm.dynamics.com`) on 2026-06-21 via `scripts/apply-dataverse-schema.js --target=prod --wave=7-reviewer-engagement --execute` (schema-as-code in `lib/dataverse/schema/wave7-reviewer-engagement/`), published, and verified in live metadata. No longer a build blocker. Discrete columns (NOT a JSON blob) so the Phase-3 cron / Phase-4 sweep can OData `$filter` server-side (Codex P2). New columns carry no Power Automate trigger.

On `akoya_request` — schema name (→ logical name) · type:
- `wmkf_RespondOffsetDays` → `wmkf_respondoffsetdays` · Integer (≥0)
- `wmkf_ReviewDueDate` → `wmkf_reviewduedate` · DateTime (**DateOnly** — calendar deadline, no tz drift in cron date math)
- `wmkf_RespondReminderEnabled` → `wmkf_respondreminderenabled` · Boolean (default **true**)
- `wmkf_RespondReminderLeadDays` → `wmkf_respondreminderleaddays` · Integer (≥0)
- `wmkf_ReviewDueReminderEnabled` → `wmkf_reviewduereminderenabled` · Boolean (default **true**)
- `wmkf_ReviewDueReminderLeadDays` → `wmkf_reviewduereminderleaddays` · Integer (≥0)
- `wmkf_DesiredCount` → `wmkf_desiredcount` · Integer (≥0)
- `wmkf_QuotaNotifiedAt` → `wmkf_quotanotifiedat` · DateTime (DateAndTime/UserLocal) — Phase-4 concurrency marker, conditional null→set via If-Match/ETag

On `wmkf_appreviewersuggestion`:
- `wmkf_RespondReminderSentAt` → `wmkf_respondremindersentat` · DateTime (DateAndTime/UserLocal) — Phase-3 fire-once marker; Re-invite MUST clear it in the same write as the `emailSentAt` re-stamp (§3.B).

---

## 5. Sequencing

> **All four phases shipped (S275)** — this section is the historical build order, now complete. [VERIFIED via source — see the §Status header citations.]

> **Reordered (Codex P1):** the token cap must NOT ship before the Release action, or an accepted reviewer's invite link can die at review-due before any built mechanism exists to send them the long-lived materials link.

- **Phase 1 — Persistence + panel:** campaign config (discrete columns, §4) on the request; panel "days to respond" (offset) change. **No token-behavior change yet** — invite keeps minting `now + 90`. Pure foundation.
- **Phase 2 — Release + token TTL (historical rollout plan):** the accepted-only Release action (mints the long-lived materials token) **and** the invite/reminder token cap landed in the same release so the long-lived materials link existed before the cap could bite. The current cap is the effective due instant at 23:59:59 UTC + 2 days. **Also here:** add the missing `materials_sent` server-side guard on the upload endpoint (Codex P2 — `pages/api/external/review/[token]/upload.js` → `lib/services/review-upload.js` accepted any valid token at that earlier checkpoint without checking `wmkf_reviewstatus`, so an accepted-pre-materials reviewer could upload).
- **Phase 3 — Reminders:** the two-reminder cron code + the `wmkf_respondremindersentat` marker shipped in S275; its Vercel schedule is paused as of 2026-09-01 (§3.B).
- **Phase 4 — Quota:** count-after-write + conditional null→set notify + the PD selective-decline Workbench action (writes `withdrawn_sufficient`).

**Model-B invitation copy — DONE (S275).** The default invitation template (`shared/components/reviewers/email-template-store.js` `DEFAULT_TEMPLATES.invitation`) now says the COI/AI acknowledgements + honorarium are confirmed *when you accept*, with the full proposal following on release — no longer the Model-A "no commitment today, all comes later." (The `hold`/`finalize` templates were REMOVED in S279 — the template set is now `invitation` + `materials` + `followup` + `thankyou`. A PD who saved a customized invitation template keeps their own wording — only the default changed.)

---

## 6. Risks / notes

- **Honorarium payment stays offline/deferred** this cycle `[verified §2.3]`; request creation is controlled separately by the `HONORARIUM_ONBOARDING_DEFERRED` config gate.
- **Token cap depends on a sane review-due date** in the config; if absent, fall back to the current `now + 90` (don't silently mint a past-dated/expired token).
- **Incident remediation — routine follow-up is link-free:** accepted-reviewer review-due reminders and generic follow-up/thank-you messages cannot mint or carry a reviewer URL. Invitation/materials delivery and the explicit regenerate recovery action retain latest-link-wins behavior; regeneration preserves saved draft state.
- **Latent automatic-send exposure:** 92 current-cycle active requests had both reminder flags true on 2026-09-01, including 8 with the sweep's date/offset inputs. Reactivation requires an owner-approved backfill/disarm decision, not only UI and token-code fixes (§3.B).
- **Manual reminders resumed after verified remediation:** review-due follow-up and due-date resend are non-rotating and link-free; review-due sends fail closed on token liveness/runway before claiming the marker. Respond reminders, invitation/first Materials delivery, and explicit regeneration still replace token authority by design and deliver the replacement link when applicable. The automatic schedule remains independently paused.
- **Quota count runs in the acceptance drain** (`lib/services/reviewer-acceptance-drain.js`; was `respond.js` until the S350 accept-fast-response build) — a Dataverse count query per drained accept, after the drain re-verifies the accept committed; acceptable (low volume); the notify is a conditional null→set on `wmkf_quotanotifiedat` (§3.C).
- **Pre-existing upload soundness gap (Codex P2):** `/upload` accepts any valid token without a `materials_sent` check — an accepted-pre-materials reviewer could upload before release. Closed in Phase 2 (§5).
- **Expired-but-still-pending window (Codex P2):** between review-due (token dies) and meeting-date (sweep closes), a non-responder reads "pending" in staff UI but can't respond. Surface "link expired" in the staff view, or tighten the sweep (§3.D).

## 7. Deferred public-documentation follow-up

After the runtime token policy, draft-preservation behavior, and reminder controls are fixed and production-verified, audit and update the public/user-facing reviewer guidance, staff help text, onboarding materials, and link-bearing email instructions to match the final behavior. Do not let this documentation work delay incident containment or publish the temporary incident workaround as the permanent reviewer workflow.
