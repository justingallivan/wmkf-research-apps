# Session 464 Prompt: Quiet-Period Work While the Reviewer Cron-Reminders Slice Is Parked

## Session 463 Summary

Session 463 finished the small follow-ups, then built and parked the reviewer
cron-reminders ledger slice:

1. **VIP badge + email hygiene items** shipped to production (merge
   `7bba2f8f`): stage-aware dispatch contract for invitation failure routing
   (all pre-SendEmail throws tagged `dispatched:false`; only SendEmail-stage
   throws stay `unconfirmed[]`), `noFallback` on invitation/acceptance sends,
   automation-notice parity on the manual respond reminder, and the ★ VIP
   badge (suppressed under `vipUnknown`, per a Codex re-review finding).
2. **Owner corrections + decisions recorded**: the phantom "day-12 sends
   begin ~Sept 7" deadline was false (abstract requests went out weeks
   earlier; ALL abstracts received — nothing queued, nothing sends this
   cycle); reviewer cron-reminder decisions: both reminder types through the
   ledger, per-message approval, thank-yous stay direct.
3. **Reviewer cron-reminders ledger slice BUILT** on
   `feature/reviewer-cron-reminders-ledger` (pushed to origin), hardened
   through TWO Codex adversarial rounds; the second round's fixes were
   implemented via Codex rescue and Claude-reviewed. **Owner parked the
   branch until the review cycle ends** — see Parked item 2 for the full
   promotion sequence and mid-cycle hazards.
4. **Both open read-only probes run (owner-authorized)** — results in
   "Probe Results" below; the preference-matrix slice is now unblocked.
5. **PD tutorial deferred (owner decision)** until the reminder slice
   finishes — one tutorial covering the full final surface.

### What Was Built on the Parked Branch

- Migration `038` (UNAPPLIED everywhere — still amendable): reviewer
  workflow CHECK values, nullable `deliverable_id` + shape constraint,
  `claim_committed_at`; mirrored in `scripts/setup-database.js`.
- Per-workflow strategy dispatch in `scheduled-email-service.js`
  (`strategyFor`; eligibility verdicts eligible/stop/defer; PD send-now
  `force` overrides timing only).
- `reviewer-reminder-eligibility.js` (shared refusal predicates +
  `loadReminderReviewer`), `reviewer-reminder-workflows.js` (send-time
  config recompute, marker-without-claim stop, marker-gated expiry
  exemption, send-time recipient revalidation → stop `recipient_changed`,
  claim fused with activity creation via one If-Match `mintAndStore`).
- Store lifecycle helpers: `cancelScheduledEmailBySource`,
  `deferScheduledEmailSend` (refusal boundary `send_requested_at` — an
  unsent draft still defers), `reviveStoppedScheduledEmail` (clears claim),
  `refreshUntouchedScheduledEmail`, `recordScheduledEmailClaim`.
- Sweeps converted to ledger row creation (create/revive/reassign/refresh);
  manual nudge cancels its queued copy; the reviewer cron now runs the
  digest/due/finalize pipeline.
- 143 tests green across the 5 core slice suites at final state (verified
  2026-08-27); accepted residuals recorded in
  `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 8–10.

### Commits

Main: `7bba2f8f` (merge: hygiene + VIP badge, incl. `1a76e526`/`26e0a899`),
`72e7ee1d`/`048ac13a` (owner corrections/decisions), `3be6dbd9` (park),
`29e25dbe` (tutorial deferral), `991209f0` (probe results), plus this
handoff commit.
Branch `feature/reviewer-cron-reminders-ledger` (pushed): `7c29fac7` (slice
build), `17333c78` (discriminating tests + catalog), `f138f0f2`/`4b971473`
(doc recheck markers), `ab524feb` (claim ownership + defer boundary),
`059e51f9` (recipient revalidation + marker-gated exemption).

## Next Items

### Verified Open

1. **PD onboarding / posture seeding — before the NEXT solicitation cycle,
   no current deadline.**
   Evidence: `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` rollout checklist;
   `approval_required` freezes ONCE at ledger-row creation
   (`grantee-deliverable-reminders-service.js:270`), so posture must exist
   BEFORE the next batch of abstracts is stamped Invited, and (via the
   parked slice) before its post-merge first sweep. Nothing is queued this
   cycle (owner-corrected S463: all abstracts received).
2. **Preference-matrix slice is now plannable** (UNBLOCKED S463:
   `wmkf_preferencevalue` is Memo/100,000 — Probe Results below). Also
   still open from the plan doc "Broader effort": async PD approval for
   staff-triggered "sent as me" mail. Thank-yous stay direct (owner
   decision S463).

### Owner Decision Needed

(none — the tutorial decision moved to Parked item 0.)

### Parked

0. **PD tutorial refresh + distribution — DECIDED S463 (2026-08-27): wait
   until the reviewer cron-reminders build is finished/promoted.**
   Evidence: artifact "Email Autopilot for PDs"
   (https://claude.ai/code/artifact/11586fac-9e0f-4784-833c-58bb4d0e118f);
   owner deferred twice — now until the parked slice merges, so one
   tutorial covers abstract digest + reviewer invitations + cron reminders.
   Re-open trigger: promotion step (e) of Parked item 2.
1. **Post-cycle invitation-link strictness (tighten vs ratify).**
   Evidence: `docs/CURRENT_WORK_QUEUE.md` Audit follow-ups entry +
   `project-invitation-link-strictness-open-decision.md`. Re-open trigger:
   the current reviewer cycle ends. Do not tighten or ratify silently.
2. **Reviewer cron-reminders ledger slice — BUILT, HELD on
   `feature/reviewer-cron-reminders-ledger` (owner parked it S463 until the
   review cycle ends).** Commits `7c29fac7`..`059e51f9`; migration 038
   UNAPPLIED everywhere (amendable until applied). Promotion sequence when
   the cycle ends: (a) owner runs `node scripts/apply-migrations.js` (038),
   (b) seed PD posture — review-all override on for all PDs is the safe
   default; posture freezes into rows at the first sweep after merge, and
   revive/reassign are the only runtime recomputes, (c) capture-mode local
   smoke (`reviewer-invite-capture-mode-not-full-sandbox.md`), (d) merge,
   (e) PD onboarding + tutorial before the next cycle's invitations.
   Merging mid-cycle without (a) is a reminder OUTAGE (the new cron
   replaces direct send; inserts fail the 036 CHECK); without (b) the
   backlog freezes `approval_required=false` under un-onboarded PDs.
   Accepted residuals: plan-doc items 8–10. Also tracked in
   `docs/CURRENT_WORK_QUEUE.md` Audit follow-ups.

### Verify Before Acting

1. **Remove the three throwaway smoke candidates** (Test Homer, Francesco
   Cisco, Justin Test2) from the owner's test request — they are stamped
   Invited with locally-minted (prod-invalid) tokens. Preflight: confirm the
   request with the owner and that no real workflow references those rows;
   removal is a prod Dataverse write (works from the deployed app; local
   needs a fresh same-day ack).

### Do Not Reopen Without New Decision

1. **Blanket per-PD review of all automated mail.** Evidence: plan doc owner
   decision 10 — a single miss does not reopen blanket review.
2. **Reviewer flags keyed on contact.** Evidence: S389 + Atlas — candidates
   have no CRM contact pre-acceptance; person-keying is deliberate.
3. **Write-permission asymmetry between flag stores** (contact flags PD-only;
   reviewer flags any review-manager staff). Evidence: owner decision
   2026-08-26, recorded in the route header and plan doc.
4. **Merging the parked slice mid-cycle.** Evidence: owner decision S463
   ("Let's park this until after the review cycle"); hazards in Parked
   item 2. A deliberate mid-cycle promotion is possible with the (a)+(b)
   sequencing but requires a new owner decision.

## Probe Results (owner-authorized read-only, 2026-08-27)

- `wmkf_potentialreviewerses`: 4,526 total rows (4,516 active); only
  **183** have the `wmkf_contact` lookup set (all on active rows) — ~4%
  linkage, consistent with contact-on-acceptance-only.
- `wmkf_appuserpreference.wmkf_preferencevalue`: **Memo, MaxLength
  100,000** — a per-email-type JSON preference matrix fits with huge
  margin (the `email_automation` JSON preference already lives in this
  column).

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/scheduled-email-service.js` | Ledger delivery skeleton + `strategyFor` dispatch (branch adds reviewer strategies) |
| `lib/services/scheduled-email-store.js` | Ledger SQL + lifecycle helpers (branch adds claim/defer/revive/refresh/cancelBySource) |
| `lib/services/reviewer-reminder-workflows.js` | (branch) reviewer delivery strategies — the sharp edges live here |
| `lib/services/reviewer-reminder-eligibility.js` | (branch) shared refusal predicates + reviewer-email resolver |
| `lib/services/reviewer-reminder-sweep.js` | Reviewer sweeps (branch: ledger row creation instead of direct send) |
| `lib/db/migrations/038_reviewer_reminder_ledger_workflows.sql` | (branch) UNAPPLIED — apply before merge |
| `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` | Canonical plan/status; items 7–10 = slice decisions + residuals |

## Testing

```bash
# Parked-slice suites (run on the branch):
npx jest tests/unit/reviewer-reminder-workflows.test.js \
  tests/unit/reviewer-reminder-sweep.test.js \
  tests/unit/reviewer-manual-reminder.test.js \
  tests/unit/scheduled-email-service.test.js \
  tests/unit/scheduled-email-schema-parity.test.js
# Local smoke recipe (for promotion step (c)): capture mode + same-day
# DATAVERSE_PROD_WRITE_ACK + throwaway EXTERNAL_LINK_SECRET — see
# .claude-memory/reviewer-invite-capture-mode-not-full-sandbox.md
```
