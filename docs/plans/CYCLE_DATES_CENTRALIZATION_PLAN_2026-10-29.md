---
title: Cycle dates in one place — centralization plan
domain: platform
kind: plan
status: proposed
summary: "Owner ask 2026-10-29: cycle dates are entered once, on the cycle calendar (operations wmkf_grantcycle, D43), and nobody edits Vercel or any other screen when a cycle rolls over. Inventory of every per-cycle human touch today, what replaces each, the blank-date rule, missing columns to request from Connor, residual human steps, owner decisions and order by deadline. Builds on the rollover plan §3.2/§3.4; nothing built."
canonical: false
owner: product-engineering
related:
  - docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md
  - docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md
  - docs/plans/CYCLE_ROLLOVER_MINIMAL_CONFIGURATION_PLAN_2026-10-06.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/audits/cycle-settings-audit-2026-10-27.md
---

# Cycle dates in one place

## 1. Goal

Every cycle date is typed once, on the cycle calendar, by the Grants Manager or
Program Coordinator. Apps read it from there. Nobody edits Vercel, the Admin
reviewer defaults, the Reviewer Finder cycle record or the Board setup dates when
a cycle rolls over.

This implements the rollover plan's "one editable home per date" (§3.2) and its
multi-cycle jobs rule (§3.4) on the home chosen in D43: Connor's operations Grant
Cycle table, edited from the apps' calendar. Owner guidance that bounds it:
`feedback-minimize-per-cycle-configuration` (no per-cycle allowlists),
`feedback-centralize-over-pd-specific-settings` (D9: anchor dates central; PDs
adjust only the response period and quota).

**What stays human (cannot be removed):** Connor's process creates each cycle's
row; the Grants Manager fills its dates and sets the landing cycle on the
calendar; staff confirm the Board roster. Everything else below is either read
from the calendar or retired.

## 2. Every place a person touches a cycle today

| What a person does today | Where | Replaced by | Owner decision needed |
|---|---|---|---|
| Switch review filing to the new cycle | Vercel `REVIEW_DOCX_SHAREPOINT_CYCLE` (one exact code) [VERIFIED via `lib/services/review-documents/individual-file-service.js:1005-1034`; `lib/dataverse/adapters/reviewer-suggestion.js:1536-1555`] | File each completed review whose cycle's window is open (D11): from invitation start to that cycle's Board date, by Pacific day. Several cycles at once | Which column is "invitation start" (§5); optionally drop the start bound (§7) |
| Add the new cycle to Staff Deliberations prep | Vercel `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` [VERIFIED via `lib/services/pre-site-visit/preparation-config.js:48-51`; re-checked per receipt at `preparation-worker.js:202-204`] | Cycles whose Board date is upcoming, from the calendar, after the old/new cohort diff the rollover plan §3.4 requires | Whether J27 (oral presentations, no site visits) uses Staff Deliberations at all |
| Type the cycle's invitation start, release date and review due date | Admin → Workflows → Reviewer timeline defaults, one app-wide key `reviewer.campaign_timeline_defaults` [VERIFIED via `lib/services/reviewer-campaign-timeline.js:1-27`] | Dates read per cycle from the calendar for the request's own cycle. The panel keeps only the two numbers (response days, reviewer quota) as central defaults (D9) | Column for "proposal release to reviewers" (§5) |
| Type the review deadline and proposal send date into the cycle record | Reviewer Finder cycle record (`wmkf_appgrantcycle`): `reviewDeadline`, custom field `proposalSendDate` used by the invitation email [VERIFIED via `lib/services/grant-cycles-dataverse.js:76-90`; `lib/utils/email-generator.js:443-448`] | Emails read the calendar's Reviews Due Date; the record keeps only the template, attachments and wording | None for the deadline (already planned in rollover §3.2); a column for the send date (§5) |
| A due date saved on each request at first send, then winning over the central value | `akoya_request.wmkf_reviewduedate`, written once from the invitation form [VERIFIED via `lib/services/review-manager/send-emails-service.js:1205-1247`] | The request reads the calendar date; no per-request anchor date (D9). One reviewer's extension stays a PD action | Confirm D9 applies to existing per-request due dates (keep as-is for D26; none for J27) |
| A PD's last-used invitation dates re-applied to the next cycle | Per-user `reviewer_invite_timing` preference (audit RV2) [NOT-READ: `shared/components/reviewers/InviteEmailModal.js` — read in the build] | Stop carrying dates across cycles; keep only the response period if the PD changed it | None |
| Type the Board materials deadline and Board end date | Board cycle setup page, per cycle (`materialsDue`, `boardEnds`) [VERIFIED via `lib/services/board-writeups/model.js:38-48`]; archive and reminders key off `boardEnds` [VERIFIED via `board-writeups/worker.js:49`; `notifications.js:19-20`] | New setups start with the calendar's Board date and materials date filled in. An activated setup is never rewritten by a calendar edit (rollover §3.2) | Which column is "materials due" (§5) |
| Grantee short-title job runs by calendar month | `vercel.json` schedule, months Apr–Jun and Oct–Dec (audit G3) | Retire: Connor's flows now write the short title (D37, T13), after the D26 Board and a check that nothing else depends on it | None (T13 already decided) |
| Pick which cycle each app opens on | Each app's own rule | Done: the landing cycle (PR #547) | None |

Coverage check (2026-10-29): grep of `lib pages shared` for env names containing
CYCLE, DEADLINE, MEETING or _DATE finds only the two Vercel rows above, the
D26-only Cycle Dossier pilot (`CYCLE_DOSSIER_*`) and Meeting Tracker access
switches (not cycle-scoped); grep for cycle- or campaign-keyed setting names finds
only `board_writeups.cycle.*` and `reviewer.campaign_timeline_defaults`, both
above. The full source inventory is `docs/audits/cycle-settings-audit-2026-10-27.md`.

Also per cycle today: someone creates the Reviewer Finder cycle record for its
template and attachments. Under rollover §3.2 that copies the previous cycle's
template and policy automatically; dates are never copied.

Not per-cycle and out of scope: Staff Deliberations' other Vercel switches
(on/off, Production, fence, statuses, batch size) are one-time safety settings;
the Cycle Dossier and the ranking cutoff are D26-only by design; single-phase,
no-site-visit and file-name differences are about the *kind* of cycle, not its
dates, and need a separate decision.

## 3. Blank dates

Today a Vercel pin is always set. A calendar date can be blank. For every
automation that reads a date: **a blank date means that automation does nothing
for that cycle, and the readiness notice (D12) tells the Grants Manager which
date is missing.** It never falls back to an env value, a code literal or the
previous cycle's date. A blank date on a screen shows "Not set" and the form
asks for it.

## 4. Shared reader

One service reads a cycle's dates from the calendar for a cycle code, with the
landing cycle's safeguards: bounded deadline, Pacific-day comparisons, an
explicit "missing" result rather than a guess. Every consumer above uses it, so
the column-to-meaning map lives in one place (`shared/config/cycleCalendar.js`).

## 5. Dates with no column yet

Proposed mappings for existing columns, pending the owner's timeline decision
(Sarah, Beth, Duncan; Connor for field meaning):

| App needs | Proposed column | Confidence |
|---|---|---|
| Review due date | Reviews Due Date | High (rollover §3.2 already names it) |
| Board date | Board Meeting Date | Already used |
| Reviewer invitation start | Chairs Semi-Finalist Meeting Date (invitations go out at the Chairs meeting, Feb 24) | Medium |
| Board materials due | Board Mailing Date | Low: may mean the books mailing, not the writeup deadline |

Missing, to request from Connor as Grant Cycle columns (D43 home; app-side
storage only as a documented fallback):

- Staff recommendation deadline (Feb 3; D40 warning)
- Triage meetings (Jan 6 AI triage; Jan 13–14 PD triage)
- Proposal release to reviewers (feeds the invitation email's send date)

## 6. Order by deadline

| By | Item |
|---|---|
| Nov 15 | Owner decides column meanings; Connor adds the missing columns |
| Before Feb 3 | Staff recommendation deadline column in place (D40 warning reads it) |
| Before Feb 24 | Shared reader; reviewer dates from the calendar; emails read Reviews Due Date; per-request anchor dates stop; review filing by window (replaces the Vercel switch) |
| Before April | Staff Deliberations decision for J27; prep by calendar after the cohort diff |
| Before J27 Board prep | Board setup dates default from the calendar |
| After Dec 10 | Retire the grantee-title job (T13, verify first) |

## 7. Owner decisions

1. Column meanings (§5), including whether Board Mailing Date is the materials deadline.
2. Ask Connor for the three missing columns, or keep them in the apps.
3. Review filing window: keep D11's start bound (invitation start), or file any completed review until the Board date. Reviews exist only after invitations, so the start bound changes nothing in practice; dropping it removes one dependency. D11 stands unless changed.
4. Whether J27 uses Staff Deliberations.
5. Per-request due dates already saved on D26 requests stay as they are.
