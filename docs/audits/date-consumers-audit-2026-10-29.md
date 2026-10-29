---
title: Business date consumers across the app suite — audit
domain: platform
kind: audit
status: active
summary: "Owner-requested audit 2026-10-29 after finding the calendar's Reviews Due date has no reader. Of the cycle calendar's dates, only the Board date is read (by the landing cycle). Every behavior-driving date comes from somewhere else, and seven dates have two or more independent homes; the review due date has seven. Ranked risks, refuted claims, and items added to the centralization plan."
canonical: false
owner: product-engineering
related:
  - docs/plans/CYCLE_DATES_CENTRALIZATION_PLAN_2026-10-29.md
  - docs/audits/cycle-settings-audit-2026-10-27.md
  - docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md
---

# Business date consumers — audit (2026-10-29)

## 1. Answer

The cycle calendar is the intended single home for cycle dates (D43), but today
**only its Board date is read, and only by the landing cycle**. Every date that
drives an email, reminder, link expiry, archive or default comes from another
store. Seven dates have two or more independent homes that can disagree.

## 2. Method

- Inventory: grep of `lib pages shared` for Dataverse and akoya fields named
  date / deadline / due / offset / lead / expiry / override, Postgres date
  columns in `lib/db/migrations`, JS date properties, app settings keys, env
  vars and `vercel.json` schedules.
- Three read-only traces (reviewer; meetings, Board, writeups and Staff
  Deliberations; intake, grantee, payments, jobs and config), each returning
  source, setter, consumers with file:line, and the gap if the calendar changes.
- The high-risk claims below were re-read in source by the session lead
  (marked VERIFIED). Two agent claims were refuted (§6).
- Excluded as technical: leases, locks, claim markers, upload/session/SAS and
  file-token expiry, retention, createdon/modifiedon, rate-limit windows,
  summary-draft TTLs, model-pricing review dates.

## 3. The calendar's dates and their readers

| Calendar date (`wmkf_grantcycle`) | Read by |
|---|---|
| Board Meeting Date (`wmkf_meetingdate`) | Landing cycle only (`listBoardDates` → `automaticLandingCycle`, `lib/services/landing-cycle-service.js`) [VERIFIED] |
| Proposal Due, Budget Due, Reviews Due, Board Mailing | **Nothing** outside the calendar [VERIFIED: each column name appears only in `shared/config/cycleCalendar.js`] |
| Leadership/Chairs Semi-Finalist Email and Meeting, Offramp Meeting, Leadership/Chairs Finalist Email | **Nothing** [VERIFIED: same grep] |

## 4. Dates with two or more homes

| Date | Homes | What actually drives behavior | Risk |
|---|---|---|---|
| **Review due date** | (1) calendar Reviews Due; (2) Admin reviewer defaults `reviewDueDate` (one app-wide value); (3) PD preference `reviewer_invite_timing`; (4) request `akoya_request.wmkf_reviewduedate`; (5) per-reviewer extension `wmkf_reviewduedateoverride`; (6) Reviewer Finder cycle record `wmkf_reviewreturndeadline`; (7) the release form's value, including one saved in the PD's browser | Links, reminders, portal, overdue flag, acceptance email + calendar invite, extensions: extension (5) else request (4) [VERIFIED `lib/external/reviewer-due-date.js`]. Request (4) is written once, at first send, only if blank [VERIFIED `send-emails-service.js:1236-1237`], from the form, pre-filled by (2) or (3). Materials emails: the per-send/form value beats (4) [VERIFIED `render-emails-service.js:334-337`; `ReleaseMaterialsModal.js:466-471`] | **Highest.** J27 invitations on Feb 24 store whatever (2)/(3) show, permanently per request. A stale date shifts link lifetimes: not-yet-accepted reviewers due + 2 days, accepted reviewers due + 90 days, no usable future date now + 90 [VERIFIED `reviewer-token-ttl.js:33-40`], flags everyone overdue, and blocks extensions that don't beat it. Emails and the portal can show different dates |
| **Board date** | (1) calendar `wmkf_meetingdate`; (2) each request's `akoya_request.wmkf_meetingdate`; (3) Board setup `boardEnds`; (4) the June/December convention in `cycle-code.js` | (1) landing cycle only. (2) cycle membership for Board, prep and filing; stale-invite expiry (daily 09:00 sweep, grace 0) [VERIFIED `vercel.json`]; honorarium fiscal year (refuses without it) [VERIFIED `honorarium-onboard-orchestrator.js:147-172`]; fallback default cycle. (3) Board archive at 09:00 Pacific after it, cleanup at +7 days, Board pages' default [VERIFIED by trace] | **High.** A moved Board meeting changes (1) but not (2) or (3). Whether Connor's process keeps (2) in step with (1) is unknown |
| **Board materials due** | (1) calendar Board Mailing; (2) Board setup `materialsDue` | (2): shown in the progress email and setup screen; required to activate; no reminder | Medium. (1) is unread |
| **Proposal release to reviewers** | (1) Admin `proposalReleaseDate`; (2) PD preference `proposalSendDate`; (3) Reviewer Finder record custom field `proposalSendDate` | Email text only ("we will send the full proposal by") | Medium. Three homes, two template tokens |
| **Respond-by** | (1) request/Admin/PD `respondOffsetDays`; (2) Reviewer Finder record custom field `commitDate` | (1): respond-by in the email and the respond reminder; (2): a fixed date in legacy email text | Low–medium: two answers in the same email family |
| **Reviewer invitation start** | (1) calendar Chairs Semi-Finalist Meeting (D44 mapping); (2) Admin `inviteStartDate` | Neither: `inviteStartDate` is typed and never read [VERIFIED grep] | Low today; a dead field that looks live |
| **Cycle membership / current cycle** | request date month; Vercel `STAFF_DELIBERATIONS_AUTO_PREPARE_CYCLE_CODES`, `REVIEW_DOCX_SHAREPOINT_CYCLE`; landing cycle; `conventionalCycles` fallbacks | Prep, filing, defaults | Already in the centralization plan |

## 5. Single-home dates (no calendar conflict)

Site-visit / research-presentation times (Dynamics activity) drive Staff
Deliberations prep start, the final-writeup group-review gate and materials
dates. Materials `due_at` / `closes_at` are computed once at send (visit start
minus N business days; end + 7) and never recomputed if the visit moves.
Grantee deliverables have no stored due date, but the invitation and reminder emails promise "COB" 14 days after the invitation (`lib/external/grantee-invite-email.js:61-66`) and the reminder is scheduled 12 days after it [VERIFIED; corrected 2026-10-29 by the Codex comparison, §8]. `akoya_decisiondate`,
grant begin/end, submit/payment/posting dates, the AI-policy effective date and
withdrawal dates are historical or display-only for this purpose. No env var or
runtime code literal holds a business date. The only business-calendar cron is
the grantee-title job (months Apr–Jun, Oct–Dec).

## 6. Corrections to agent findings

- **Refuted:** "the site-visit materials reminder cron isn't scheduled, so reminders may never run." It is unscheduled on purpose: the owner retired it on 2026-09-17 (`pages/api/cron/site-visit-materials-reminders.js` header; `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` §16.6).
- **Context, not a gap:** the reviewer reminder cron is likewise held by decision (unscheduled; J27 reminders manual), so the reminder lead-day fields are inert today.

## 7. Ranked risks and actions

| # | Risk | Action | By |
|---|---|---|---|
| 1 | J27 review due date taken from the app-wide Admin default and frozen per request | Build first: the invitation form and the stored request date come from the calendar's Reviews Due for the request's cycle. Stopgap: set Admin `reviewDueDate` to 2027-03-10 | Before Feb 24 |
| 2 | Emails and system behavior can use different due dates (per-send and browser-saved values) | Remove the per-send and browser-saved due-date overrides; emails read the same resolved date as links and reminders | With #1 |
| 3 | Board date in three stores | Ask Connor whether his process updates request meeting dates when a Board date moves. Default new Board setups from the calendar (plan §2); add a mismatch check to the readiness notice (D12) | Ask now; build before J27 Board prep |
| 4 | Extensions require a per-request due date, while D9 removes per-request anchor dates | Extensions read the calendar due date as the base; per-reviewer overrides stay | With #1 |
| 5 | Reviewer Finder cycle record holds review deadline, proposal send, proposal due and commit dates | Retire its date fields; templates read the calendar; the record keeps template, attachments and wording | Before Feb 24 |
| 6 | Dead or unread date fields that look live (`inviteStartDate`, calendar columns with no use) | Remove `inviteStartDate` from Admin; label unused calendar columns as reference-only | Low priority |
| 7 | Materials due/close dates not recomputed when a visit moves | Owner decision whether this matters (reminder is manual) | Note only |

## 8. Independent Codex audit — comparison (2026-10-29)

Codex (`gpt-6.1-sol`, read-only task, same scope, no access to these findings)
audited the suite independently. Every Codex-only or disputed claim below was
re-read in source.

**Both found:** only the Board date is read from the calendar (landing cycle);
the eleven other columns have no reader; the review due date has many homes and
is frozen per request at first send; emails resolve the due date differently
from the portal and reminders (per-send / browser values first); the Board date
lives in the calendar, each request and the Board setup; `inviteStartDate` is
never read; the Reviewer Finder record's custom date fields; the Vercel cycle
pins; the reviewer and materials reminder crons are unscheduled by decision.

**Codex found, Claude missed (all VERIFIED):**

| Finding | Evidence | Effect |
|---|---|---|
| Grantee deliverable deadline is promised as invitation + 14 days in emails | `lib/external/grantee-invite-email.js:61-66` | Corrects §5 ("no due date") |
| Accepted reviewers' links run to due + 90 days, not-yet-accepted to due + 2 | `lib/external/reviewer-token-ttl.js:33-40` | Corrects §4 wording |
| After a successful review upload the stored link expiry is set to now + 7 days (absolute; can shorten a longer window) | `lib/external/token-lifecycle.js:166-192` | New reviewer-access date |
| Briefing and presentation links expire a fixed 60 days after issue | `deliberation-briefing/briefing-link-service.js:86-90`; `post-presentation-materials/presentation-link-service.js:49-51` | Not calendar-tied; a long gap between issue and meeting could expire a link |
| Grantee portal links last 30 days | `lib/external/grantee-token-lifecycle.js:25` | Not calendar-tied |
| Deliberation session start time drives computed per-slot agenda times, not only display | `meeting-tracker/agenda-service.js:225-226` | Event date, not cycle |
| A manual landing-cycle override stops the automatic rollover until cleared | `landing-cycle-service.js` | Design consequence worth showing on the calendar |
| Signed link expiry and the stored expiry field both constrain access | `token-lifecycle.js` (Codex citation; mint path read, constraint not re-traced) | PLAUSIBLE |

**Claude found, Codex did not report:** honorarium creation refuses a request
with no meeting date (`honorarium-onboard-orchestrator.js:147-172`); extensions
refuse when the request has no stored due date (`reviewer-due-extension.js:169`);
the grantee-title job's month schedule; the Staff Deliberations cycle list.

**Disagreements:** one, resolved for Codex (grantee deadline). An earlier
Claude-side agent claim about the materials reminder cron was already refuted
(§6); Codex independently reached the same conclusion from the handler header.

**Effect on the risk ranking:** unchanged at the top (review due date, Board
date). Added for the centralization plan: show on the calendar when a manual
override is holding the landing cycle; note that link lifetimes derive from the
request due date, so fixing that date (risk 1) also fixes link expiry for links
issued afterwards; existing links keep their signed expiry.

