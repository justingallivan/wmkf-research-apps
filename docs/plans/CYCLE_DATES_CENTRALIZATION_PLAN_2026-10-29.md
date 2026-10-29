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
row; the Grants Manager fills its dates (the landing cycle now switches by itself, D45) on the
calendar; staff confirm the Board roster. Everything else below is either read
from the calendar or retired.

## 2. Every place a person touches a cycle today

| What a person does today | Where | Replaced by | Owner decision needed |
|---|---|---|---|
| Switch review filing to the new cycle | Vercel `REVIEW_DOCX_SHAREPOINT_CYCLE` (one exact code) [VERIFIED via `lib/services/review-documents/individual-file-service.js:1005-1034`; `lib/dataverse/adapters/reviewer-suggestion.js:1536-1555`] | File each completed review until its cycle's Board date, by Pacific day (D11 as amended by D44). Several cycles at once | None |
| Add the new cycle to Staff Deliberations prep | Vercel `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES` [VERIFIED via `lib/services/pre-site-visit/preparation-config.js:48-51`; re-checked per receipt at `preparation-worker.js:202-204`] | Cycles whose Board date is upcoming, from the calendar, after the old/new cohort diff the rollover plan §3.4 requires | None: Staff Deliberations is a stage in every cycle (owner, 2026-10-21 vocabulary; `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`). Check before April: prep starts from a site-visit event in Dynamics; confirm J27's Zoom research presentations are recorded the same way |
| Type the cycle's invitation start, release date and review due date | Admin → Workflows → Reviewer timeline defaults, one app-wide key `reviewer.campaign_timeline_defaults` [VERIFIED via `lib/services/reviewer-campaign-timeline.js:1-27`] | Dates read per cycle from the calendar for the request's own cycle. The panel keeps only the two numbers (response days, reviewer quota) as central defaults (D9) | None (§5) |
| Type the review deadline and proposal send date into the cycle record | Reviewer Finder cycle record (`wmkf_appgrantcycle`): `reviewDeadline`, custom field `proposalSendDate` used by the invitation email [VERIFIED via `lib/services/grant-cycles-dataverse.js:76-90`; `lib/utils/email-generator.js:443-448`] | Emails read the calendar's Reviews Due Date; the record keeps only the template, attachments and wording | None (§5) |
| A due date saved on each request at first send, then winning over the central value | `akoya_request.wmkf_reviewduedate`, written once from the invitation form [VERIFIED via `lib/services/review-manager/send-emails-service.js:1205-1247`] | The request reads the calendar date; no per-request anchor date (D9). One reviewer's extension stays a PD action | Confirm D9 applies to existing per-request due dates (keep as-is for D26; none for J27) |
| A PD's last-used invitation dates re-applied to the next cycle | Per-user `reviewer_invite_timing` preference (audit RV2) [NOT-READ: `shared/components/reviewers/InviteEmailModal.js` — read in the build] | Stop carrying dates across cycles; keep only the response period if the PD changed it | None |
| Type the Board materials deadline and Board end date | Board cycle setup page, per cycle (`materialsDue`, `boardEnds`) [VERIFIED via `lib/services/board-writeups/model.js:38-48`]; archive and reminders key off `boardEnds` [VERIFIED via `board-writeups/worker.js:49`; `notifications.js:19-20`] | New setups start with the calendar's Board date and materials date filled in. An activated setup is never rewritten by a calendar edit (rollover §3.2) | None (§5) |
| Grantee short-title job runs by calendar month | `vercel.json` schedule, months Apr–Jun and Oct–Dec (audit G3) | Retire: Connor's flows now write the short title (D37, T13), after the D26 Board and a check that nothing else depends on it | None (T13 already decided) |
| Pick which cycle each app opens on | Each app's own rule | Done: the landing cycle (PR #547), automatic from Board dates (D45) | None |

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

## 2a. Added by the date-consumer audit (2026-10-29)

`docs/audits/date-consumers-audit-2026-10-29.md` found more homes for the same
dates; each is now in scope:

- **Per-send and browser-saved due dates.** The release form's due date
  (including a value saved in the PD's browser) beats the request date in
  materials emails. Remove these so every email reads the same resolved date as
  links and reminders.
- **Extensions need a per-request due date.** With D9 removing per-request anchor
  dates, extensions use the calendar due date as their base; per-reviewer
  overrides stay.
- **Reviewer Finder cycle record dates.** Besides the review deadline, its custom
  fields hold proposal send, proposal due and commit (respond-by) dates used in
  legacy email text. Retire them; templates read the calendar.
- **Board date in three stores** (calendar, each request's meeting date, Board
  setup end date). Ask Connor whether request meeting dates follow a Board-date
  change; add a mismatch check to the readiness notice.
- **`inviteStartDate` in Admin is never read.** Remove it.

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

## 5. Which column holds which date

Owner, 2026-10-29:

| App needs | Calendar column |
|---|---|
| Review due date | Reviews Due Date |
| Board date | Board Meeting Date |
| Reviewer invitation start | Chairs Semi-Finalist Meeting Date (invitations go out at the Chairs meeting) |
| Board materials due | Board Mailing Date (materials go out then, on paper or by email) |

Dates with no Grant Cycle column **stay in the apps** (owner, 2026-10-29): one
small per-cycle record of app dates, edited on the same calendar page beside the
eleven Dynamics dates, so Sarah sees one calendar. It records who changed each
date. A documented divergence from D43's single home, chosen by the owner.

- Staff recommendation deadline (Feb 3; the D40 "still Under consideration" warning).
  Added together with the triage list that reads it, never as an unread field.

Proposal release to reviewers is **not** a date for J27 (D46): reviewers get the
materials as soon as they accept. The release-date fields in the Admin defaults,
the PD preference and the Reviewer Finder record go away with materials-on-acceptance.

The January triage meetings are on the J27 timeline but no app feature, built or
planned, reads their dates, so they get no field (corrected 2026-10-29).

## 6. Order by deadline

| By | Item |
|---|---|
| Nov 15 | App-side dates on the calendar page |
| Before Feb 3 | Staff recommendation deadline filled in (D40 warning reads it) |
| Before Feb 24 | **One reviewer-invitation build (owner, 2026-10-29):** materials on acceptance (D46; work queue item 6) together with the review due date from the calendar — shared reader; invitation and stored due date from Reviews Due; per-send and browser-saved due dates removed; extensions based on the calendar date; Reviewer Finder record dates retired. Separately: review filing by window (replaces the Vercel switch) |
| Before April | Confirm J27 research presentations trigger prep; prep by calendar after the cohort diff |
| Before J27 Board prep | Board setup dates default from the calendar |
| After Dec 10 | Retire the grantee-title job (T13, verify first) |

## 7. Owner decisions

Decided 2026-10-29 (alignment log D44): column meanings (§5); missing dates stay
in the apps (§5); Staff Deliberations is a stage in every cycle (§2); review
filing has no start bound — a completed review files until its cycle's Board
date, then operator backfill (amends D11).

Open: per-request due dates already saved on D26 requests stay as they are.
