---
title: Reviewer invitation build — materials on acceptance, calendar due date, review filing and Board dates
domain: reviewers
kind: plan
status: proposed
summary: "One build before the Feb 24, 2027 J27 invitations (owner, 2026-10-29): the review due date comes from the cycle calendar's Reviews Due Date; reviewers get materials as soon as they accept (D46); per-send, browser-saved and Reviewer Finder record dates go away; review filing follows each cycle's Board date (D44) instead of a Vercel switch; the Board setup reads its dates from the calendar (D47); small calendar-page fixes. Traced from source 2026-10-29; nothing built."
canonical: false
owner: product-engineering
related:
  - docs/plans/CYCLE_DATES_CENTRALIZATION_PLAN_2026-10-29.md
  - docs/audits/date-consumers-audit-2026-10-29.md
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md
  - docs/CURRENT_WORK_QUEUE.md
---

# Reviewer invitation build (before Feb 24, 2027)

## 1. Scope

Owner, 2026-10-29: plan and build these together, plan first.

| Part | What changes | Decision |
|---|---|---|
| A | Review due date comes from the calendar's Reviews Due Date for the request's cycle | Audit risks 1, 2, 4 |
| B | Materials released automatically when a reviewer accepts | D46; work queue item 6 |
| C | Per-send, browser-saved, Admin and Reviewer Finder record dates removed | Centralization plan §2, §2a |
| D | Review filing for every cycle until its Board date, replacing `REVIEW_DOCX_SHAREPOINT_CYCLE` | D44 |
| E | Board setup reads Board Meeting Date and Board Mailing Date from the calendar | D47 |
| F | Calendar page: say plainly when a chosen cycle stops the automatic switch; remove Admin `inviteStartDate` | Audit addendum; risk 6 |

Out of scope: Staff Deliberations prep by calendar (before April), the
grantee-title job (T13), app-side calendar dates (Feb 3 deadline).

## 2. What exists today (traced 2026-10-29)

Provenance: three delegated read-only source traces (due date chain; accept and
materials release; review filing and calendar page). Lines marked
[VERIFIED by read] were re-read directly; the rest are trace findings with
file:line citations, to be re-verified by contract-reconcile before each PR.

### 2.1 Review due date

- **One resolver, used by everything except the emails.**
  `resolveEffectiveReviewDueDate` (`lib/external/reviewer-due-date.js:16-20`):
  per-reviewer override `wmkf_reviewduedateoverride`, else the default passed in
  [VERIFIED by read]. Callers pass `akoya_request.wmkf_reviewduedate`: link
  expiry at send (`send-emails-service.js:988-993`), token lifecycle and
  regeneration, acceptance email and its calendar file
  (`reviewer-acceptance-email.js:51-54,144-146`), reminders
  (`reviewer-reminder-sweep.js`, `reviewer-manual-reminder.js`), reviewer portal
  deadline (`context-service.js:250-253`), Workbench and My Candidates
  [VERIFIED via trace; per-file reads by a delegated search].
- **The request date is written once, from the browser.** First invitation
  send writes `campaignConfig.reviewDueDate` (client-supplied) only when the
  request has none: `if (dueDate != null && reqRec.wmkf_reviewduedate == null)`
  (`send-emails-service.js:1237`) [VERIFIED by read]. The campaign settings
  editor also writes it (`campaign-config-service.js`).
- **The invitation form's date layers** (`InviteEmailModal.js:293-336`): blank,
  then the PD's saved `reviewer_invite_timing` preference, then Admin
  `reviewer.campaign_timeline_defaults`, then the request's date. Send saves it
  back to the preference. The `{{reviewDue}}` token is filled in the browser from
  the form (`InviteEmailModal.js:96`), ignoring the request date and override.
- **Materials email:** the release form starts from the request date, but a value
  saved in browser storage key `review_manager_email_fields` wins
  (`ReleaseMaterialsModal.js:464-471`); rendering then puts the form value ahead
  of the request date: `settings.reviewDueDate || request?.wmkf_reviewduedate ||
  cycle.review_deadline` (`render-emails-service.js:333-337`) [VERIFIED by read].
- **`{{reviewDeadline}}`** reads only the Reviewer Finder cycle record
  `wmkf_reviewreturndeadline` (`grant-cycles-dataverse.js:82`;
  `email-generator.js:444`). Nothing else uses that date.
- **Extensions** (`lib/services/reviewer-due-extension.js`) use the request date
  as the base, refuse with `original_due_date_missing` when it is blank (:169),
  and write only the per-reviewer override. **No change needed** if the request
  date is filled from the calendar (§3.1).
- **The calendar's `wmkf_researchreviewsduedate` is read nowhere** except the
  column map (`shared/config/cycleCalendar.js:18`).

### 2.2 Acceptance and materials

- **Accept** (`pages/api/external/review/[token]/respond.js` →
  `lib/services/external-review/respond-service.js`): writes accepted/response
  fields, stages a Postgres `reviewer_acceptance_jobs` row, returns the
  `accepted-pre-materials` view. It does not change review status or token
  expiry.
- **Acceptance job** (`pages/api/cron/drain-reviewer-acceptances.js`, every 2
  minutes; `lib/services/reviewer-acceptance-drain.js`): contact promotion,
  identity, honorarium, then the acceptance email once
  (`sendAcceptanceConfirmationOnce`, claim step `acceptance_confirmation`). Leases,
  retries, step claims and a pause switch already exist.
- **Materials release is manual** (`ReleaseMaterialsModal.js` → `send-emails` →
  `send-emails-service.js`): per reviewer; requires accepted; one time only
  (`wmkf_materialssentat`); checks token not revoked, address confidence, test
  request, request-number leak; attaches the cycle record's review template and
  additional attachments (`send-emails-service.js:402-421,474-499`); **re-mints
  the reviewer's link** (:996-1001) with the accepted expiry (due date + 90
  days); sends from the staff member's mailbox; then writes
  `wmkf_materialssentat` and status `materials_sent`
  (`record-email-outcome.js`).
- **The reviewer reads the PDF in the portal**, streamed by
  `pages/api/external/review/[token]/proposal.js`. The invitation link already
  carries the `download_proposal` operation (`token-lifecycle.js:26`).
- **Withdrawing:** the portal refuses a decline once status reaches
  `materials_sent` (`respond-service.js:227`). Auto-release therefore removes the
  self-service withdraw window between accepting and materials.

### 2.3 Email wording

Live text is in Dataverse settings `email.reviewer_<type>.{subject,body}` and
`email.reviewer_acceptance.*`, with per-PD overrides in user preferences
(`email-template-store.js`). Seeds are create-only
(`scripts/seed-email-defaults.mjs`); `scripts/rebaseline-email-defaults.mjs
--force-keys` overwrites. **Editing a seed file does not change live email
text.** Today's invitation seed promises "We send the full proposal — around
{{proposalDelivery}}" (`reviewer-templates.js:56`); `{{proposalDelivery}}` is
filled in the browser from the form's release date.

### 2.4 Review filing

Hourly cron `pages/api/cron/file-review-docx.js` → 
`sweepMissingIndividualReviewFiles` with the one code in
`REVIEW_DOCX_SHAREPOINT_CYCLE` (`individual-file-service.js:42,1006`). Discovery
filters suggestions by that code (`reviewer-suggestion.js:1536-1556`); each row's
cycle is its stamped code, else its request meeting date
(`individual-file-service.js:224-230`); mismatches are skipped. The SharePoint
folder does not depend on the cycle. Skipped reviews are recovered by the
operator backfill script. `listBoardDates`
(`lib/dataverse/adapters/operations-grant-cycle.js:91-113`) already returns every
modern cycle's Board date in one bounded request.

### 2.5 Board setup and calendar page

Board setup stores typed `materialsDue` and `boardEnds`
(`lib/services/board-writeups/model.js:38-48`); archive and reminders key off
`boardEnds` (`worker.js:49`, `notifications.js:19`); the landing cycle's Board
rule reads `boardEnds` (`landing-cycle-service.js:245-256`). The calendar's
landing box marks a chosen cycle "(chosen)" and says what Automatic would pick
(`LandingCyclePanel.js:101-106`) but not that apps stop switching on their own.
Admin `inviteStartDate` has no reader outside its form, validation and tests
[VERIFIED via grep of lib pages shared scripts tests].

## 3. Design

### 3.1 One calendar reader, one stored due date

- **Shared reader** `lib/services/cycle-calendar-dates.js`:
  `getCycleDates(code, {timeoutMs})` and `listCycleDates({timeoutMs})` returning
  `{code, reviewsDue, boardDate, boardMailing, chairsSemiFinalistMeeting}` as
  `YYYY-MM-DD` or `null`, from the operations Grant Cycle table through the
  existing adapter (extend `listBoardDates`' select rather than add a second
  query). Pacific-day helpers move out of `landing-cycle-service.js` into it.
  Read failures return an explicit error, never a guessed date.
- **Stored date stays; its source changes.** The first invitation send writes
  `wmkf_reviewduedate` **from the calendar on the server** for the request's
  cycle, not from the browser. Every existing consumer (links, reminders,
  portal, extensions, acceptance file) keeps reading the request date and needs
  no change.
- **Why stored, not read live:** the invitation tells the reviewer a date. If
  the calendar date later moves, invited reviewers keep the date they were
  promised; a change for one reviewer is an extension. Reading live would
  silently move every reviewer's deadline and link expiry.
- **Existing values win** (as today, :1237): D26 requests keep their saved
  dates (plan §7 open item, proposed). A J27 request has none, so it gets the
  calendar date.
- **Blank Reviews Due:** invitations for that cycle are refused with "Set the
  Reviews Due Date on the cycle calendar first" (§3 blank-date rule). No
  fallback to Admin defaults.
- **Request's cycle:** its stamped grant cycle code, else
  `meetingDateToCycleCode(wmkf_meetingdate)` (the filing rule's resolution,
  `individual-file-service.js:224-230`).
- **Campaign settings editor:** stops editing the due date (shows it read-only
  with "from the cycle calendar"); keeps response days and reviewer quota (D9).

### 3.2 Emails read the resolved date

- `{{reviewDue}}`, `{{reviewDueDate}}` and `{{reviewDeadline}}` are all filled
  **on the server** with `resolveEffectiveReviewDueDate(override, request date)`;
  for a first invitation before the request date exists, the calendar date the
  send is about to store.
- Remove: the form's due-date field and the `reviewer_invite_timing` due and
  release dates (response days stay); the release form's due date and its
  browser-storage copy; `settings.reviewDueDate` and `cycle.review_deadline` in
  the render order. The draft fingerprint (`draft-fingerprint.js:86-98`) drops
  the removed inputs.

### 3.3 Materials on acceptance

- **New step in the acceptance job**, after the acceptance email claim:
  `release_materials`, claimed once like `acceptance_confirmation`. It:
  1. checks the proposal PDF is present (the materials preflight's check,
     `materials-preflight-service.js:53-63`);
  2. writes `wmkf_materialssentat` and status `materials_sent` through the
     existing lifecycle writer (ETag-conditional);
  3. extends the reviewer's existing link to the accepted expiry **without
     re-minting**, so the link in their hand keeps working (the invitation link
     already allows `download_proposal`);
  4. sends **one** email: the acceptance confirmation becomes "Thank you for
     agreeing to review. The proposal and review form are at your link; your
     review is due {{reviewDueDate}}", with the cycle's review template and
     additional attachments the materials email carries today.
- **Proposal missing:** the step holds (retries on the job's schedule), the
  reviewer sees today's accepted screen, and the lead PD gets one alert. The
  manual release button stays as the fallback and for these held cases.
- **Sender:** the acceptance email's existing sender rule (PD, else the
  notification address; `reviewer-acceptance-email.js:98-116`).
- **Applies to every acceptance after deploy** (no per-cycle switch, per
  `feedback-minimize-per-cycle-configuration`). D26 has no open invitations by
  then [ASSUMED — verify at build].
- **Invitation precondition:** sending an invitation checks the proposal PDF is
  present (blocking, not today's `window.confirm`), so materials are ready when
  invitations go out.

### 3.4 Wording

New invitation, acceptance and (fallback) materials text: no proposal-release
promise, due date from the calendar, withdraw instructions that fit the new flow
(the reviewer can no longer decline in the portal after accepting; they email
the PD). Seeds updated; live keys rebaselined with `--force-keys` after the
owner approves the text; per-PD overrides that contain `{{proposalDelivery}}`
listed for the PDs to update (read-only probe; owner-run in Production).

### 3.5 Retired date homes

- Admin reviewer timeline defaults: `inviteStartDate`, `proposalReleaseDate`,
  `reviewDueDate` removed; response days and reviewer quota stay.
- Reviewer Finder cycle record: the app stops reading and writing
  `wmkf_reviewreturndeadline` and the date custom fields (`proposalSendDate`,
  `proposalDueDate`, `commitDate`); template, attachments and wording stay. No
  Dataverse column is dropped. Every reader listed in §2.1 and the legacy
  template tokens are rewritten or removed after a fresh caller grep.
- `{{proposalDelivery}}` removed from token lists and previews.

### 3.6 Review filing by Board date (D44)

- The cron builds the set of **filing cycles**: modern cycles whose calendar
  Board date is today or later by Pacific day (`listCycleDates`). A cycle with no
  Board date is not filed and is named in the run's event.
- Discovery takes a list of codes (OData `or` over the set);
  `loadCandidate` checks membership instead of equality.
- `REVIEW_DOCX_SHAREPOINT_CYCLE` is removed from code, Vercel (all environments,
  owner-run) and docs. `REVIEW_DOCX_SHAREPOINT_WRITE` stays.
- After a Board date passes, late reviews are the operator backfill's job
  (D44, unchanged script).
- Calendar read failure: the run does nothing and records the error.

### 3.7 Board setup from the calendar (D47)

- The Board setup shows Board date and materials date read-only from the
  calendar, with "Not set" and the column name when blank; `materialsDue` and
  `boardEnds` leave the stored setup (validation accepts old rows and ignores
  them).
- Archive, reminders and the materials-before-Board check read the calendar
  dates. Activation requires both calendar dates.
- **Archive timing must not move on a failed read:** if the calendar read fails,
  the worker skips that hour (no archive, no reminder) and records it.
- Landing cycle Board rule: candidates are cycles with a setup row whose
  calendar Board date is set (D47 amendment).
- D26's activated setup: the calendar's D26 Board date must equal its typed
  `boardEnds` (2026-12-10) before deploy [check at build; owner-run read].

### 3.8 Calendar page

- With a chosen cycle, the landing box adds: "Apps stay on {cycle} until you
  switch back to Automatic. Automatic would switch to {next} on {date}."
- Remove `inviteStartDate` (§3.5).

## 4. Risks

1. **Withdraw window disappears** (§2.2). Mitigated by wording; owner confirms.
2. **Materials auto-sent to a reviewer with an unresolved address or COI
   concern.** The step applies the materials path's address-confidence and
   test-request checks; COI is screened at invitation and acknowledged at
   accept, as today.
3. **Pre-accept PDF access** [UNCONFIRMED]: `proposal.js` checks the token's
   operation and file membership but not acceptance (`proposal.js:53-66`); the
   portal hides files before release. Verify at build whether an invitation
   link can stream the PDF before accept; if so, require accepted and COI-acked.
4. **Board archive on a calendar edit:** a moved Board date moves the archive.
   Intended (D47); the readiness notice should flag a request-meeting-date
   mismatch (Connor question open).
5. **D26 continuity:** D26 requests keep stored due dates; D26 filing continues
   until Dec 10 by calendar; D26's Board setup reads the same date it typed.

## 5. Owner decisions

1. Calendar date is copied at first invitation and then fixed (§3.1), rather
   than read live. **Proposed.**
2. One acceptance email that carries the materials, instead of two emails.
   **Proposed.**
3. Reviewers withdraw by emailing the PD after accepting. **Proposed.**
4. Invitations refused when Reviews Due is blank or the proposal PDF is missing.
   **Proposed.**
5. Final wording of the three emails (drafted at build for approval).

## 6. Build order and tests

Branch `claude/reviewer-invitation-calendar`; Tier 2 (reviewer emails and
Dataverse writes). Separate PRs, each with focused unit tests:

1. Shared calendar reader + review filing by Board date (D) + calendar page (F).
2. Due date from the calendar on the server (A, C).
3. Board setup from the calendar (E).
4. Materials on acceptance (B) + wording.

Gates: `check:api-routes`, `check:atlas`, `check:j27-register`,
`check:dataverse-access-layer`, `check:route-service-boundary`,
`check:reviewer-engagement-boundary`, `check:status-enum-parity`, plus jest for
touched services. Contract-reconcile before each PR; Codex review of this plan
and of each PR.
