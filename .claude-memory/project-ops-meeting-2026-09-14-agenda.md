---
name: project-ops-meeting-2026-09-14-agenda
description: Running agenda for the owner's Monday 2026-09-14 meeting with the operations team — set up the applicant-materials reminder cron and define all its effects; add items here as the remaining list is worked through in S507+.
metadata:
  type: project
  status: active
  created: 2026-09-11 (S507)
---

The owner meets the operations team on **Monday 2026-09-14** to decide how the
applicant-materials reminder cron is set up and to define all of its effects.
The owner asked (S507, 2026-09-11) that this meeting be tracked and that agenda
items be appended as the remaining work list is processed.

**Why:** the cron route (`/api/cron/site-visit-materials-reminders`, PR #252,
merged 2026-09-11) is live and callable in production but deliberately has no
`vercel.json` schedule (owner M5). Ops owns the cadence and the downstream
effects on applicants and PCs, so the decision is theirs, not an agent's.

**How to apply:** when a session surfaces a question that belongs to this
meeting (cron behavior, applicant/PC-facing side effects, reminder policy),
append it below rather than deciding it; keep each item one line with its
evidence pointer. After the meeting, record the decisions in
`docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16 and mark this memory
`status: closed`.

## Agenda (append as items arise)

1. **Cron schedule.** Add the route to `vercel.json` (suggested `0 15 * * *`,
   8am PT) or leave it manual. Dry run verified in prod 2026-09-11 (HTTP 200,
   0 scanned). Evidence: `pages/api/cron/site-visit-materials-reminders.js`.
2. **Define the effects.** One automatic reminder per collection, on the first
   run after `due_at` with a required item missing and no reminder (PC or
   automatic) recorded on/after `due_at`; sent from the creating PC's mailbox
   to the PI/liaison snapshot; skips closed/ready, nothing-missing, no
   recipient, unreadable link, disabled sender. Evidence:
   `lib/services/site-visit-materials/reminder-sweep.js` header.
3. **PC manual reminder race.** `remindMaterialsContributors` sends without a
   claim; a PC click during the daily run could double-send. Guard (reuse
   `claimAutomaticReminder`'s shape) or accept. Evidence: PR #252 residuals.
4. **Optional "other" upload hidden** (PR #253, 2026-09-11): confirm ops agrees
   it stays hidden for this cycle; the cron never reads that slot either way.
5. **Noted, no ops action: per-user Dataverse role gap on email create** (found 2026-09-11
   on ZZTEST-03). The 2026-09-10 21:19 UTC deliberation send by a colleague who has not
   fully onboarded (systemuser `73d32260-aa8b-f111-ab0f-70a8a59cded0`; one role, 15
   privileges) failed 403 `0x80040220`: the Customer Voice plugin on email create needs
   `prvCreateActivity` on `msfp_alert`, evaluated under the impersonated sender. Owner
   (2026-09-11): onboarding/role setup is in the works and owned by someone else; the
   colleague will not send system emails until onboarded. Record only. Observation for
   later: at send time the failure was quiet (no email in the Dynamics chain, no loud
   error); the red "last send failed" line appears on the next tab load. Evidence:
   read-only ledger probe of `pre_site_distribution_attempts`, S507.
