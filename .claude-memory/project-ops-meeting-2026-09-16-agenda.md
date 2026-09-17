---
name: project-ops-meeting-2026-09-16-agenda
description: Outcome record for the owner's Wednesday 2026-09-16 operations meeting; the applicant-materials reminder-cron schedule remains the sole open item.
metadata:
  type: project
  status: active
  created: 2026-09-11 (S507)
---

The original Monday 2026-09-14 meeting did not occur. The operations meeting
was held on **Wednesday 2026-09-16**. Items 2–6 below are decided or recorded;
the applicant-materials reminder-cron schedule in item 1 is the only open line,
so this memory remains `status: active`.

**Why:** the cron route (`/api/cron/site-visit-materials-reminders`, PR #252,
merged 2026-09-11) is live and callable in production but deliberately has no
`vercel.json` schedule (owner M5). Ops owns the cadence and the downstream
effects on applicants and PCs, so the decision is theirs, not an agent's.

**How to apply:** do not close this memory until item 1 is decided. Record that
future schedule decision in `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16
and `vercel.json` if it adds a schedule; then mark this memory `status: closed`.

## Outcomes

1. **OPEN — cron schedule.** The owner still needs to talk with the team. Do not
   add `/api/cron/site-visit-materials-reminders` to `vercel.json` or change its
   documented schedule posture. Dry run verified in prod 2026-09-11 (HTTP 200,
   0 scanned). Evidence: `pages/api/cron/site-visit-materials-reminders.js`.
2. **RECORDED — define the effects.** No additional decision is needed beyond
   the existing contract: one automatic reminder per collection, on the first
   run after `due_at` with a required item missing and no reminder (PC or
   automatic) recorded on/after `due_at`; sent from the creating PC's mailbox
   to the PI/liaison snapshot; skips closed/ready, nothing-missing, no
   recipient, unreadable link, disabled sender. Evidence:
   `lib/services/site-visit-materials/reminder-sweep.js` header.
3. **DECIDED AND ALREADY BUILT — guard the PC manual-reminder race.** Commit
   `90641978` (S507) made `remindMaterialsContributors` claim through
   `claimManualReminder` before sending and attach the email id afterward; the
   conditional claim serializes a PC click against the automatic sweep. Evidence:
   `lib/services/site-visit-materials/collection-service.js`,
   `lib/services/site-visit-materials/collection-store.js`, and their focused unit tests.
4. **CONFIRMED — optional "other" upload stays hidden this cycle.** The §16.5
   gate remains unchanged, and the cron never reads that slot either way.
   Evidence: `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.5.
5. **RECORDED — no ops action: per-user Dataverse role gap on email create** (found 2026-09-11
   on ZZTEST-03). The 2026-09-10 21:19 UTC deliberation send by a colleague who has not
   fully onboarded (systemuser `73d32260-aa8b-f111-ab0f-70a8a59cded0`; one role, 15
   privileges) failed 403 `0x80040220`: the Customer Voice plugin on email create needs
   `prvCreateActivity` on `msfp_alert`, evaluated under the impersonated sender. Owner
   (2026-09-11): onboarding/role setup is in the works and owned by someone else; the
   colleague will not send system emails until onboarded. Record only. Observation for
   later: at send time the failure was quiet (no email in the Dynamics chain, no loud
   error); the red "last send failed" line appears on the next tab load. Evidence:
   read-only ledger probe of `pre_site_distribution_attempts`, S507.
6. **DECIDED — Cycle Dossier drain runs every five minutes.**
   `/api/cron/drain-cycle-dossiers` is configured as `*/5 * * * *` in `vercel.json`.
   `CYCLE_DOSSIER_ENABLED=true` is live in Production smoke mode, so the former
   "invoked while disabled" framing was stale. Each tick claims one run and advances
   at most three queued entries, so the slower cadence lengthens dossier wall-clock
   completion as well as initial pickup. Evidence: `lib/services/cycle-dossier-worker.js`
   `drainCycleDossiers` and `docs/CYCLE_DOSSIER_PILOT_DESIGN.md`.
