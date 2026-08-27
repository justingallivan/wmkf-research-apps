# Session 463 Prompt: Post-Ship Follow-Ups for the Scheduled-Email + Reviewer-Invite VIP Work

## Session 462 Summary

Session 462 shipped BOTH email-personalization slices to production and closed
their full verification loops:

1. the **VIP/digest scheduled-email decision layer** (abstract reminders) was
   adversarially reviewed (three findings fixed, including the digest-run
   ledger and the fail-safe PD-handoff rebuild guard), merged to main
   (`4a743d63`), migration 036 applied to the shared Neon DB and live-probed;
2. the **reviewer invitation VIP preview slice** was designed with the owner
   (synchronous preview; any review-manager staff curate flags stored per the
   request's lead PD; non-VIP drafts collapse to an expandable in-modal
   summary), built on `feature/reviewer-invite-vip`, hardened through TWO
   Codex adversarial rounds plus a Codex rescue with a Claude review pass,
   migration 037 applied + live-probed, owner-run local smoke PASSED
   (2026-08-27), and merged to main (`dc46fa18`, production deployment Ready).

### What Was Completed

1. **Reviewer invitation VIP preview (production).**
   - `scheduled_email_reviewer_vip_flags` (migration 037; keyed on
     `wmkf_potentialreviewersid` — candidates have no CRM contact
     pre-acceptance, S389), service + thin route
     `/api/review-manager/reviewer-vip-flags` (lead PD resolved server-side,
     never client input), star toggle on the Invite Reviewers roster,
     full-card vs collapse routing in `InviteEmailModal`.
   - Always-full safety set: VIP, skipped, quick-check, edited, expanded,
     single-candidate, invalid-link, and linkless drafts. Send payload
     unchanged and pinned by test.
   - Hardening from the reviews: fail-closed `vipUnknown` (load state +
     pending-save), optimistic star with rollback, all stars disabled during
     load/save, 10s timeout + inline Retry on flag-load failure.
2. **Unified invitation-link validation.**
   - `lib/utils/invitation-link-validator.js` shared by modal collapse,
     send-time withholding (new `invalid_secure_link` skip reason with UI
     label), and template-save validation (`{{externalLink}}` required to
     save; legacy templates still load — the send gate protects them,
     client + server-side in `pages/api/user-preferences.js`).
   - Claude review pass reverted two silent tightenings from the rescue:
     repeated IDENTICAL JWT copies dedupe and send (only DISTINCT tokens are
     `external_link_ambiguous`) and trailing prose punctuation after a token
     is accepted; extended/four-segment tokens still rejected. Also closed a
     modal/server mismatch (linkless + `externalLinkExpected:false` drafts
     no longer collapse).
3. **Owner-run local smoke (2026-08-27, PASSED).**
   - Recipe that worked: `REVIEWER_EMAIL_DELIVERY_MODE=capture npm run dev`,
     same-day `DATAVERSE_PROD_WRITE_ACK` line (local-only, dies at UTC
     midnight), and a **local-only throwaway `EXTERNAL_LINK_SECRET`** (the
     mint fails without it; a throwaway is CORRECT — locally minted tokens
     must not verify in prod). DevTools "Block request URL" (not Offline)
     for the fail-closed flag-load check.
   - Verified live: Retry notice, star round-trip + persistence, VIP +
     quick-check full while standard collapsed, capture of all three sends
     including the still-collapsed draft.
4. **Forget-proofing + docs.**
   - Post-cycle invitation-link strictness decision mechanized:
     `docs/CURRENT_WORK_QUEUE.md` (Audit follow-ups) +
     `.claude-memory/project-invitation-link-strictness-open-decision.md`.
   - Plan doc, Atlas, security matrix, service catalog, agent wiki
     (invitation gate section) all reconciled; outbound email inventory
     (18 types) recorded in `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md`.
   - PD tutorial artifact built ("Email Autopilot for PDs",
     https://claude.ai/code/artifact/11586fac-9e0f-4784-833c-58bb4d0e118f)
     but deliberately NOT sent (owner: abstracts just solicited, would fall
     on deaf ears); needs a scope update now that the reviewer slice landed.

### Commits (this session, all on main via merges)

- `4a743d63` - Merge: VIP/digest scheduled-email decision layer (abstract)
- `2ab40bda` - feat: reviewer invitation VIP preview slice
- `5704ebc5` / `8dc60d40` - fail-closed + race/body-integrity hardening
- `ff156f3d` - Codex rescue (3 second-round findings) + Claude review pass
- `22ec7c39` - mechanize post-cycle strictness decision
- `de6122ea` / `92831a0c` - migration 037 applied; owner smoke recorded
- `dc46fa18` - Merge feature/reviewer-invite-vip to main (production Ready)

## Next Items

### Verified Open

1. **PD onboarding / posture seeding for the abstract-reminder digest —
   before the NEXT solicitation cycle, no current deadline.**
   Evidence: `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` rollout checklist
   (procedural guarantee: onboard every active PD and seed override/VIP state
   before meaningful sends). Owner-corrected S463: the abstract requests went
   out weeks before 2026-08-26 and ALL solicited abstracts have been
   received, so no deliverable is in Invited status — the cron's filter
   matches nothing, and any stale ledger row self-cancels at send time via
   the `sourceStillEligible` recheck (`lib/services/scheduled-email-service.js:239`,
   `stoppedNoLongerEligible`). Nothing is queued and nothing will send this
   cycle. The binding sequencing constraint for next cycle:
   `approval_required` is frozen ONCE at ledger-row creation
   (`grantee-deliverable-reminders-service.js:270`), so PD posture must be
   seeded BEFORE the next batch of abstracts is stamped Invited — seeding
   after invitation does not protect that batch. Onboarding + the tutorial
   refresh (Owner Decision Needed below) should complete before the next
   solicitation.
2. **VIP badge on full cards (small UX polish, owner-noted during smoke).**
   Evidence: plan doc smoke paragraph — a full card doesn't show WHY it's
   full (VIP vs quick-check indistinguishable). Add a "★ VIP" badge to the
   card header in `InviteEmailModal`. No behavior change.
3. **Email hygiene items from the outbound inventory.**
   Evidence: `docs/OUTBOUND_EMAIL_INVENTORY_2026-08-26.md` cross-cutting
   findings — `noFallback` absent on invitation (#1) and acceptance
   confirmation (#10); automation-notice divergence on the manual respond
   reminder (#7 vs #5); PD-attributed mail sent by other staff (#1,7,8,11,12).
4. **Later slices (owner-recorded direction, not yet planned).**
   Evidence: plan doc "Broader effort" section — cron reviewer
   reminders/thank-yous through the ledger + digest (note
   `filterVipFlaggedReviewers` in `scheduled-email-store.js` was built for
   exactly this and has no callers yet); per-PD per-email-type preference
   matrix (blocked on the `wmkf_preferencevalue` MaxLength live probe);
   async PD approval for staff-triggered "sent as me" mail.

### Owner Decision Needed

1. **PD tutorial send timing + scope refresh.**
   Evidence: artifact exists (link above); owner deferred sending for the
   abstract-only sliver. Now that reviewer invitations shipped, refresh the
   artifact to cover both and ask the owner when to distribute.

### Parked

1. **Post-cycle invitation-link strictness (tighten vs ratify).**
   Evidence: `docs/CURRENT_WORK_QUEUE.md` Audit follow-ups entry +
   `project-invitation-link-strictness-open-decision.md`. Re-open trigger:
   the current reviewer cycle ends. Do not tighten or ratify silently.

### Verify Before Acting

1. **Remove the three throwaway smoke candidates** (Test Homer, Francesco
   Cisco, Justin Test2) from the owner's test request — they are stamped
   Invited with locally-minted (prod-invalid) tokens. Preflight: confirm the
   request with the owner and that no real workflow references those rows;
   removal is a prod Dataverse write (works from the deployed app; local
   needs a fresh same-day ack).
2. **Open live probes** (both read-only): `wmkf_contact` population across
   the 4,474 person rows; `wmkf_preferencevalue` MaxLength (blocks the
   preference-matrix slice).

### Do Not Reopen Without New Decision

1. **Blanket per-PD review of all automated mail.** Evidence: plan doc owner
   decision 10 — a single miss does not reopen blanket review.
2. **Reviewer flags keyed on contact.** Evidence: S389 + Atlas — candidates
   have no CRM contact pre-acceptance; person-keying is deliberate.
3. **Write-permission asymmetry between flag stores** (contact flags PD-only;
   reviewer flags any review-manager staff). Evidence: owner decision
   2026-08-26, recorded in the route header and plan doc.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/invitation-link-validator.js` | Shared invitation-link contract (modal collapse, send gate, template save) |
| `lib/services/review-manager/reviewer-vip-flags-service.js` | Per-(lead PD, person) flag service; PD server-side |
| `pages/api/review-manager/reviewer-vip-flags.js` | Thin GET/PUT shell for the flags |
| `shared/components/reviewers/ReviewerInvitePanel.js` | Star toggle, optimistic save, fail-closed load + Retry |
| `shared/components/reviewers/InviteEmailModal.js` | Full-card vs collapse routing (`requiresFullCard`) |
| `lib/services/scheduled-email-store.js` | Ledger + contact/reviewer flag helpers + digest runs |
| `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` | Canonical plan/status for both slices |

## Testing

```bash
npx jest tests/unit/invitation-link-validator.test.js \
  tests/unit/invite-email-modal-vip-collapse.test.js \
  tests/unit/reviewer-invite-panel-vip-toggle.test.js \
  tests/unit/reviewer-vip-flags-route.test.js \
  tests/unit/send-emails-service.test.js
# Local smoke recipe: see Session 462 Summary item 3 (capture mode + same-day
# DATAVERSE_PROD_WRITE_ACK + throwaway EXTERNAL_LINK_SECRET).
```
