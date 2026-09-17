---
name: project-ops-meeting-2026-09-16-agenda
description: Closed outcome record for the owner's Wednesday 2026-09-16 operations meeting; the last open item, the applicant-materials reminder cron, was retired 2026-09-17 in favour of manual monitoring.
metadata:
  type: project
  status: closed
  closed: 2026-09-17 (S519) — owner retired the automatic reminder cron; staff monitor arrivals manually
  created: 2026-09-11 (S507)
  last_verified: 2026-09-17 via vercel.json crons, collection-service.js claimManualReminder call, and cycle-dossier-worker.js drainCycleDossiers (S518)
---

## Recall Rule

Read when a session touches the applicant-materials reminder cron schedule (`/api/cron/site-visit-materials-reminders`), or before restating any 2026-09-16 ops-meeting outcome.

Do: treat every item as decided; the automatic reminder cron is retired (owner, 2026-09-17) because the staff member monitoring materials arrivals does that follow-up manually.
Do not: add `/api/cron/site-visit-materials-reminders` to `vercel.json` or reopen items 1–6 without a new owner decision.
Ground truth: `vercel.json` (crons), `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.6, `docs/CYCLE_DOSSIER_PILOT_DESIGN.md` (five-minute drain cadence).

The original Monday 2026-09-14 meeting did not occur. The operations meeting
was held on **Wednesday 2026-09-16**. Items 2–6 below were decided or recorded
at the meeting; item 1 was decided on 2026-09-17, so this memory is `status: closed`.

**Why:** the cron route (`/api/cron/site-visit-materials-reminders`, PR #252,
merged 2026-09-11) is live and callable in production but deliberately has no
`vercel.json` schedule (owner M5). Ops owns the cadence and the downstream
effects on applicants and PCs, so the decision is theirs, not an agent's.

**How to apply:** history only. The decision is recorded in
`docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.6 item 1; the route stays in the
tree, unscheduled.

## Outcomes

1. **DECIDED 2026-09-17 — cron retired.** The staff member who monitors whether
   materials came in will do that follow-up manually, so no automatic reminder
   cron is scheduled. `/api/cron/site-visit-materials-reminders` stays built and
   callable with `CRON_SECRET` but absent from `vercel.json`. Dry run verified in
   prod 2026-09-11 (HTTP 200, 0 scanned). Evidence:
   `pages/api/cron/site-visit-materials-reminders.js` header; plan §16.6 item 1.
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
