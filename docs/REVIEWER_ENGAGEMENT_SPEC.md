# Reviewer Engagement Spec — Model B (accept-now) + reminders, quota, token TTL

**Status:** IMPLEMENTED — **all four phases LIVE (S275).** [VERIFIED via source] Phase 1 `pages/api/review-manager/campaign-config.js`; Phase 2 `lib/external/reviewer-token-ttl.js` (via `render-emails.js`) + `materials_not_sent` guard in `lib/services/review-upload.js`; Phase 3 `pages/api/cron/reviewer-reminders.js` + `lib/services/reviewer-reminder-sweep.js`; Phase 4 `lib/services/reviewer-quota.js` (`maybeNotifyQuotaReached` in `respond.js`) + `pages/api/review-manager/withdraw-sufficient.js`. Schema provisioned in prod (§4, 2026-06-21). The original Codex sanity pass (S275, commit `18933df3`) folded its P1/P2 findings in before build (phase reorder so token cap ships with Release; quota count-after-write + If-Match concurrency; `materials_sent` guard; reminder-marker clear on Re-invite; expired-link copy/UI). S277: the manual "Re-invite already-invited" UI affordance was removed (§3.E). Supersedes the interpretation snapshot in `REVIEWER_ENGAGEMENT_PLAN_INTERPRETATION.md`.

**Citation convention:** current-behavior claims carry `[verified <file>::<symbol>]` (read this session). `[LIVE S275]` marks the four additions that were originally tagged `[BUILD]` (planned) and **shipped in the S275 build** — historical "this was the new work" markers, not pending. `[SCHEMA]` marks a field backed by a custom Dataverse column — **all of which are now provisioned in prod (see §4, 2026-06-21)**; the tag is a type-marker, not a "still to create" flag. Settled design calls are `[DECISION]`.

---

## 1. Model — "accept now, proposal later"

A reviewer is invited, **accepts (or declines) the offer with full onboarding at the offer stage** (COI/AI acks + mailing address; honorarium captured), then sits tight until the PD **releases the proposal**, then reviews. There is **one** reviewer decision (accept/decline) — no "agree in principle / finalize" two-step.

> The "hold / agree-in-principle" path (`HoldView`, the `respond.js` hold action, the `proposal-readiness` gate) was **REMOVED** in S279 (commit `a8676af1`). It never fired (the readiness gate was stubbed always-ready; prod had 0 `held` rows), and onboarding now happens at the single Accept. The `held` responsetype value is retained for read-safety; a historical `held` row routes to the accept form.

---

## 2. Verified current state (the spine — already live)

| # | Behavior | Evidence |
|---|---|---|
| 2.1 | Every reviewer is dispatched to the full Stage-2a accept form. (S279: the readiness gate + hold view were REMOVED; `proposal-readiness.js` deleted.) | `[verified pages/api/external/review/[token]/context.js::computeEngagementState]` routes withdrawn/materials/accepted/declined and **falls through to `stage2a` for everything else** — including a historical `held` value (no `hold-invite` branch remains) |
| 2.2 | A fresh non-opted-out accept requires COI + AI policy acks (400 if missing) and a mailing address + phone (422 if missing); writes `accepted` + acks; lands in `accepted-pre-materials`. | `[verified pages/api/external/review/[token]/respond.js handler]` (policy_ack_required, payment_contact_required, applyStage2aResponse accept) |
| 2.3 | Honorarium onboarding at accept is **capture-only this cycle** (captures contact + address, mints no `akoya_request`, no per-reviewer alert). | `[verified lib/bill/honorarium-onboard-orchestrator.js::ensureHonorariumOnboarding]` (deferred tier, shipped earlier S274) |
| 2.4 | The invitation is the only sendable first-contact email. | `[verified shared/components/reviewers/InviteEmailModal.js]` hardcoded `templateType:'invitation'`; manage modal exposes only materials/followup/thankyou `[verified shared/components/reviewers/ReviewerManagePanel.js]` |
| 2.5 | `emailSentAt` is stamped per-suggestion at invite send, re-stamped on Re-invite. | `[verified pages/api/review-manager/send-emails.js]` (invitation/hold branch: `invited:true, emailSentAt:now`); Re-invite via `allowResend` `[verified lib/utils/reviewer-invite.js::shouldSkipDuplicateInvitation]` |
| 2.6 | The secure token is a signed JWT; **only its hash is stored**; the send path **re-mints on every email containing `{{externalLink}}` and overwrites the hash** ("latest link wins" — prior links stop verifying). | `[verified pages/api/review-manager/render-emails.js]` (`needsExternalLink` → `mintAndStore`, comment "the email body becomes the canonical link"); `[verified lib/external/token-lifecycle.js::mintAndStore]`, `[verified lib/services/external-token.js::mintToken]` (JWT `exp` = `expiresAt`) |
| 2.7 | `verify-suggestion-token` enforces JWT signature/expiry + stored hash + revoked flag + stored `wmkf_externaltokenexpires`. | `[verified lib/external/verify-suggestion-token.js]` |
| 2.8 | Proposal/materials are sent **manually** today (no auto-send, no release action, no cron). | `[verified]` no cron in `pages/api/cron/` sends materials; materials send is the manual ReviewerManagePanel "Materials" path |
| 2.9 | `withdrawn_sufficient` (responseType `100000003`) has a portal "no longer needed" view + a respond guard. At spec time **nothing wrote it**; **Phase 4 added the writer** (`POST /api/review-manager/withdraw-sufficient`, §3.C). | view `[verified context.js]` `view='withdrawn-sufficient'`; guard `[verified respond.js]` 409 `withdrawn_sufficient`; writer now `lib/dataverse/adapters/reviewer-suggestion.js::updateLifecycle` via the withdraw-sufficient route |
| 2.10 | `sweep-stale-invites` closes non-responders to `no_response` **after the meeting date** (not respond-by). | `[verified pages/api/cron/sweep-stale-invites.js]`, `[verified lib/services/reviewer-suggestion-sweep.js]` |
| 2.11 | Invite timing is now split: `respondOffsetDays` and `reviewDueDate` are request-level campaign config once set, while `proposalSendDate` remains email-only scratch/sticky preference text. The invite modal hydrates request campaign values so it does not show stale per-user due dates; timing tokens are still client-substituted and line-dropped when blank. | `[verified InviteEmailModal.js]` `PREFERENCE_KEYS.INVITE_TIMING`, `campaign-config` fetch, `applyTiming`; request fields in §3.E/§4 |

---

## 3. The build — four additions on top of the spine

**All four shipped (S275) — `[LIVE S275]` below; the prose under each still reads as the build-time plan and remains accurate to what was built.** All four ride on existing mechanisms; none requires a parallel route or a new token primitive.

### 3.A  Release to reviewers `[LIVE S275]`
A PD action that **emails the proposal/materials to the ACCEPTED reviewers**. It is a clean wrapper over the existing manual Materials send — NOT a readiness/hold mechanism.
- **Target:** `wmkf_accepted = true` rows only, enforced **server-side** `[DECISION #10]` (reuse the materials-send recipient gate).
- **Token effect:** the materials email re-mints a fresh, **long-lived** token (§3.D). This is the link accepted reviewers use to review; it supersedes their invite link `[verified §2.6 latest-link-wins]`.

### 3.B  Two reminders (daily cron in `pages/api/cron/`) `[LIVE S275]` `[DECISION #14]`
Each reminder is **off by default** with a configurable "days before."

**Respond-by reminder** — nudge invited non-responders.
- Target: `invited && no response` (not accepted/declined/withdrawn).
- Per-reviewer deadline = **that reviewer's `emailSentAt` + `respondOffsetDays`** (computed in code; OData can't do the arithmetic — same pattern as the sweep). `[verified §2.5 emailSentAt is per-suggestion]`
- Fire **once**, when `today ≥ (deadline − leadDays)`, reviewer still unresponded, token not expired, `wmkf_respondremindersentat` empty. If already past the soft date at first eligibility, send once anyway (a late nudge is fine — respond-by is soft). Never repeat. `[DECISION #3]`
- Marker: new per-suggestion `wmkf_respondremindersentat` `[SCHEMA]`, **separate** from the review-due/follow-up marker. `[DECISION #4]`
- The reminder email contains `{{externalLink}}` → it **re-mints** a fresh token with the SAME invite cap (review-due + grace), invalidating the prior invite link. Reviewers use the most recent link. `[DECISION #13, verified §2.6]` **Required copy fix (Codex P2):** the portal's expired-link error says "most recent **invitation** email" (`pages/external/review/[token].js`) — change to "most recent email," since a reminder (not the invitation) may now carry the live link.
- **Required side-effect (Codex P2):** Re-invite (`allowResend`) MUST clear `wmkf_respondremindersentat` in the **same write** as the `emailSentAt` re-stamp (`send-emails.js` invitation branch), or the fire-once marker from the prior wave blocks the new window's reminder. Build the marker with this in mind from the start.

**Review-due reminder** — nudge accepted reviewers who haven't submitted.
- Target: `accepted && materials-sent && not-submitted` — never an accepted-pre-materials reviewer who hasn't received the proposal. `[DECISION #11]`
- Deadline = the fixed review-due date − leadDays.
- This automates today's manual `followup` template `[verified §2.4]`; do not also keep a manual review-due reminder.
- **Implemented (Phase 3):** fire-once via the existing `wmkf_remindersentat`. **Known residual (Codex P3, deferred):** the cron claims that marker BEFORE send (If-Match) but the manual followup stamps it AFTER send, so a manual followup in the same daily window (or one whose post-send stamp fails) can leave a row cron-eligible → one extra nudge. Accepted low-risk; a future tightening would reorder the manual followup to claim-first.

### 3.C  Quota → notify PD → selective decline `[LIVE S275]`
**Not automatic.** Reaching the desired count notifies the PD, who decides who (if anyone) to decline — so a wanted-but-slow senior reviewer is never auto-shut-out.
- Count = `wmkf_accepted = true` rows for the request (any downstream stage), queried **AFTER** the accept PATCH commits (`applyStage2aResponse` runs first in `respond.js`; a pre-write count is off by one) `[DECISION #1, Codex P2]`. Reuse the existing accepted-reader filter shape (`lib/dataverse/adapters/reviewer-suggestion.js::findAcceptedByPD` uses `wmkf_accepted eq true`).
- **Concurrency mechanism (named, Codex P1):** the notify must be a **conditional null→set** of `wmkf_quotanotifiedat` `[SCHEMA]` via an `If-Match`/ETag update (`DynamicsService.updateRecord` supports `ifMatch`), so only the first writer past the threshold succeeds and notifies; concurrent accepts that lose the race do not double-notify. Notify the PD on that single false→set transition. (Without the conditional write, concurrent accepts can both notify, and a stale count read can miss the threshold until a later accept — so the conditional set is required, not optional.)
- PD action (Workbench): select pending invitees and send the polite "no longer needed" decline → sets `withdrawn_sufficient` + `wmkf_withdrawnsufficientat` (the missing writer from §2.9) + sends the decline email + clears those reviewers' `wmkf_respondremindersentat` so no reminder fires.
- `withdrawn_sufficient` is settable **only on still-pending rows** (`invited && !accepted && !declined`), server-guarded; it never touches an accepted/honorarium row. `[DECISION #8]`

### 3.D  Token TTL — non-responders expire early, accepted keep ~90 days `[LIVE S275]`
No JWT "extension" (a signed JWT can't be extended in place; the raw token isn't stored). We use the existing latest-link-wins re-mint:
- **Invite send** (and respond-by reminder re-mint): mint with **expiry = review-due + grace** (default grace 1–2 days). This is the non-responder cap — their link dies at review-due. `[DECISION #5]`
- **Release/materials send**: mints a fresh, **long-lived** token (expiry ≈ review-due + ~90 days) for the review window + late returns. Only ACCEPTED reviewers ever receive this, so non-responders never get the long token. `[DECISION #1 late-returns-OK]`
- Requires `render-emails` to pick the expiry by template/config (it currently hardcodes `now + 90`); the review-due date must be available at mint (→ §4 persistence). `[verified §2.6 render-emails mints]`
- `sweep-stale-invites` (meeting-date) and the token cap (review-due) are **different gates** and both stay: the token cap is the **access** gate (link stops working at review-due); the sweep is **status** bookkeeping (`no_response` at meeting date). No conflict — but note a **staff-UI gap (Codex P2):** between review-due and meeting-date a row reads "pending/invited" in the UI while its link can no longer respond. Surface "link expired" state in the staff view, or tighten the sweep toward review-due. `[DECISION #9]`
- **"Accepted but never released" window (Codex P1):** an accepted-pre-materials reviewer holds only the **invite** token (review-due cap). If the PD never sends materials, that link dies at review-due with no self-serve path. Mitigation: (a) the Release action MUST ship with the cap (see §5 reordering) so the long-lived materials link normally exists before the cap bites; (b) the existing **regenerate-token** staff endpoint (`lib/external/token-lifecycle.js`) is the recovery path for any stranded reviewer.
- **Cap is "going forward" only (Codex P2):** `mintToken` fixes `exp` at mint time; changing `reviewDueDate` in the config later does NOT re-cap already-minted tokens. Acceptable — recovery is a re-invite / materials send / regenerate-token, all of which re-mint.

### 3.E  Per-request campaign config + panel change `[LIVE S275]` `[SCHEMA]`
Persist, on the request, what the cron and quota logic need (today these are throwaway `[verified §2.11]`):
- `respondOffsetDays` (default 7), `reviewDueDate` (fixed), `respondReminderEnabled` + `respondReminderLeadDays`, `reviewDueReminderEnabled` + `reviewDueReminderLeadDays`, `desiredCount`, `quotaNotifiedAt`.
- Written on first invite-batch send; **editable later** from the Reviewers tab; read live by the cron. Edits apply going forward, not retroactively. `[DECISION #7]`
- **Panel change:** the respond-by input becomes **"days to respond" (offset)**, not a fixed date `[DECISION — fixes the multi-wave bug where a fixed day-0 date shortchanges later waves]`; review-due stays a fixed date; proposal-delivery stays informational email text only (no reminder — `[DECISION]` dropped).
- Multi-wave / Re-invite: a new wave is a normal first-time invite (its own `emailSentAt`); a Re-invite re-mints (review-due cap), re-stamps `emailSentAt`, and **clears `wmkf_respondremindersentat`**; request-level config is untouched. `[DECISION #6]`
- **No manual "Re-invite already-invited" UI affordance (`[DECISION]` Justin, S277).** The automated respond-by reminder (§3.B, Phase 3 LIVE) is the nudge for invited non-responders, so the Candidates-panel button was removed (`shared/components/reviewers/ReviewerInvitePanel.js`, formerly `CandidatesPanel.js`). The server-side `allowResend` re-mint + marker-clear contract (lines above, §2.5, §4) is **retained** for programmatic re-mint paths (e.g. `regenerate-token`); a new wave still goes out as a normal first-time invite via "Send invitation" on not-invited rows.

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
- **Phase 2 — Release + token TTL (ship together):** the accepted-only Release action (mints the long-lived materials token) **and** the invite/reminder token cap (review-due + grace), landed in the same release so the long-lived materials link always exists before the cap can bite. **Also here:** add the missing `materials_sent` server-side guard on the upload endpoint (Codex P2 — `pages/api/external/review/[token]/upload.js` → `lib/services/review-upload.js` accept any valid token today without checking `wmkf_reviewstatus`, so an accepted-pre-materials reviewer could upload).
- **Phase 3 — Reminders:** the two-reminder daily cron + the `wmkf_respondremindersentat` marker (with Re-invite clearing it, §3.B).
- **Phase 4 — Quota:** count-after-write + conditional null→set notify + the PD selective-decline Workbench action (writes `withdrawn_sufficient`).

**Model-B invitation copy — DONE (S275).** The default invitation template (`shared/components/reviewers/email-template-store.js` `DEFAULT_TEMPLATES.invitation`) now says the COI/AI acknowledgements + honorarium are confirmed *when you accept*, with the full proposal following on release — no longer the Model-A "no commitment today, all comes later." (The `hold`/`finalize` templates were REMOVED in S279 — the template set is now `invitation` + `materials` + `followup` + `thankyou`. A PD who saved a customized invitation template keeps their own wording — only the default changed.)

---

## 6. Risks / notes

- **Honorarium stays capture-only** this cycle `[verified §2.3]`; none of this changes that.
- **Token cap depends on a sane review-due date** in the config; if absent, fall back to the current `now + 90` (don't silently mint a past-dated/expired token).
- **Latest-link-wins is now explicit** `[verified §2.6]`: every reminder/materials email supersedes prior links; reviewer-facing copy already corrected (S275) to "use the link in this email."
- **Quota count runs in the external accept path** (`respond.js`) — a Dataverse count query per accept, **after** the accept write; acceptable (low volume); the notify is a conditional null→set on `wmkf_quotanotifiedat` (§3.C).
- **Pre-existing upload soundness gap (Codex P2):** `/upload` accepts any valid token without a `materials_sent` check — an accepted-pre-materials reviewer could upload before release. Closed in Phase 2 (§5).
- **Expired-but-still-pending window (Codex P2):** between review-due (token dies) and meeting-date (sweep closes), a non-responder reads "pending" in staff UI but can't respond. Surface "link expired" in the staff view, or tighten the sweep (§3.D).
