---
title: Reviewer invitation build — materials on acceptance, calendar due date, review filing and Board dates
domain: reviewers
kind: plan
status: in-progress
summary: "One build before the Feb 24, 2027 J27 invitations (owner, 2026-10-29): the review due date comes from the cycle calendar's Reviews Due Date; reviewers get materials as soon as they accept (D46); per-send, browser-saved and Reviewer Finder record dates go away; review filing follows each cycle's Board date (D44) instead of a Vercel switch; the Board setup reads its dates from the calendar (D47); small calendar-page fixes. Traced from source 2026-10-29. PR 1 (#551) and PR 2 (#552, due date and cycle config from the request's Grant Cycle link) are deployed; PR 3 and PR 4 remain."
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
- **Saved before any invitation goes out (Codex review).** Today the date is
  written after delivery, from a request copy read earlier, and a failed write
  is only logged (`send-emails-service.js:1195-1243`) [VERIFIED by read]. New
  order for an invitation send: read the request with its ETag; if
  `wmkf_reviewduedate` is blank, write the calendar date with `If-Match`; on a
  412 re-read and take the date that won; if the write cannot be confirmed,
  send nothing and say why. The resolved date is in the draft fingerprint, so a
  draft previewed with a different date is stale and must be re-previewed.
  Tests: two first waves at once; a failed initialization sends nothing.
- **Blank Reviews Due:** invitations for that cycle are refused with "Set the
  Reviews Due Date on the cycle calendar first" (§3 blank-date rule). No
  fallback to Admin defaults.
- **Request's cycle is read on the server** from the request's own Grant Cycle
  link, `akoya_request.wmkf_grantcycle` (alignment log T10), and the date from
  that linked calendar row. **Changed 2026-10-29 (owner):** apps stop reading the
  request meeting date, with no meeting-date fallback; a request with no Grant
  Cycle link refuses the invitation (owner-confirmed). The T10 probe found 12 J27
  requests with the link and no meeting date. Any client value is ignored: the
  suggestion's `wmkf_grantcyclecode` is stamped from a caller-supplied code at
  suggestion creation (`reviewer-suggestion.js:537,819,863,972,1160`) [VERIFIED
  by grep], so it must not select whose date applies. Earlier text: the cycle
  came from `meetingDateToCycleCode(akoya_request.wmkf_meetingdate)` and a blank
  meeting date refused the send.
- **Campaign settings editor:** stops editing the due date (shows it read-only
  with "from the cycle calendar"); keeps response days and reviewer quota (D9).
  Its save route rejects a due date server-side, not only in the form
  (`feedback-ui-gates-must-mirror-server-guards`).

### 3.2 Emails read the resolved date

- Today the invitation form substitutes `{{reviewDue}}` into the body in the
  browser before preview and send (`InviteEmailModal.js:89-98,114,460`: "These
  are NOT server placeholders") [VERIFIED by read]. Change: the server's render
  step fills `{{reviewDue}}`, `{{reviewDueDate}}` and `{{reviewDeadline}}` with
  `resolveEffectiveReviewDueDate(override, request date)`, or, for a first
  invitation before the request date exists, the calendar date the send will
  store. The browser stops substituting `{{reviewDue}}` and shows the date
  read-only. The draft fingerprint includes the resolved date, so a calendar
  change between preview and send makes the draft stale instead of sending a
  date that differs from the stored one. (A PD can still hand-edit the body
  text, as today.)
- Remove: the form's due-date field and the `reviewer_invite_timing` due and
  release dates (response days stay); the release form's due date and its
  browser-storage copy; `settings.reviewDueDate` and `cycle.review_deadline` in
  the render order. The draft fingerprint (`draft-fingerprint.js:86-98`) drops
  the removed inputs.

### 3.3 Materials on acceptance

- **New step in the acceptance job**, `release_materials`, which replaces the
  `acceptance_confirmation` email. The one authoritative sequence:
  1. check the proposal PDF is present (the materials preflight's check,
     `materials-preflight-service.js:53-63`); if not, see "Proposal missing";
  2. take the shared release claim (insert the per-engagement row, below);
  3. **re-mint the reviewer's link** with the accepted expiry (`mintAndStore`,
     as manual release does at `send-emails-service.js:996-1001` and the
     reminder sweep does); row → `link_minted`. A link cannot be extended in
     place: expiry is signed into the link and verification checks both the
     signed and the stored expiry (`token-lifecycle.js:164-171`)
     [VERIFIED by read]. The invitation link stops working; the email carries
     the new one, and the accepted screen says to use the link in that email;
  4. send **one** email: "Thank you for agreeing to review. The proposal and
     review form are at your link; your review is due {{reviewDueDate}}", with
     the cycle's review template and additional attachments the materials
     email carries today;
  5. on confirmed delivery, row → `sent` (durable before any Dataverse write);
  6. `recordDeliveredEmail` writes `wmkf_materialssentat` and status
     `materials_sent` (`record-email-outcome.js:65-67`); row → `recorded`.
  **Neither materials-sent marker is written before confirmed delivery.**
  Manual release refuses either marker (`send-emails-service.js:623-634`) and
  the portal locks decline at `materials_sent` (`respond-service.js:227-232`),
  so an early marker would be a false receipt. Tests: a mint failure and a
  dispatch failure each leave both markers unset.
- **One step, not two.** The materials step replaces the
  `acceptance_confirmation` step's email rather than following it, so a
  reviewer gets exactly one email.
- **One shared release record (Codex review).** Automatic and manual release
  both go through a new Postgres table, one row per reviewer engagement
  (unique on the suggestion id), with states `claimed` → `link_minted` →
  `sent` → `recorded`, plus `uncertain` and `failed`. Whoever inserts the row
  first owns the release; the other path refuses with "materials are already
  being sent". This replaces relying on the job's step claim (which other
  paths cannot see) and on the post-send `wmkf_materialssentat` check (which
  manual release reads before it sends, `send-emails-service.js:605-632`).
- **Each boundary is recorded and recoverable.** After a confirmed send, retries
  only finish the bookkeeping (stamp `wmkf_materialssentat` / `materials_sent`
  through `recordDeliveredEmail`), never resend. A row left at `claimed` or
  `link_minted` past its lease, or an `uncertain` send, is not completed as
  recovered: staff get an alert and a "Send materials again" action that
  re-mints and sends under the same row. Today the job skips any claimed step
  and can complete (`reviewer-acceptance-drain.js:503-506,939-947`) [per Codex,
  re-read at build]; the new step must not. Tests: stop after each boundary;
  manual and automatic release at the same moment.
- **Proposal missing at acceptance:** today's acceptance email goes out
  unchanged, materials are held for manual release, and the lead PD gets one
  alert.
- **Withdraw link:** today's acceptance email carries a decline link built from
  the reviewer's invitation link (`reviewer-acceptance-drain.js:533-535`). It is
  removed from the combined email (dead after the re-mint, and decline is locked
  at `materials_sent`, `respond-service.js:227`). Withdrawal after acceptance
  goes through the PD, as it does today after manual release.
- **Between accepting and the job (about 2 minutes):** the accepted screen says
  the proposal link is on its way by email.
- **Sender:** the acceptance email's existing sender rule (PD, else the
  notification address; `reviewer-acceptance-email.js:98-116`).
- **Applies to every acceptance after deploy** (no per-cycle switch, per
  `feedback-minimize-per-cycle-configuration`). D26 has no open invitations by
  then [ASSUMED — verify at build].
- **Invitation precondition:** sending an invitation checks the proposal PDF is
  present (blocking, not today's `window.confirm`), so materials are ready when
  invitations go out. Built Session 654 in `send-emails-service.js`
  (`checkInvitationProposalPdf`, once per request per batch, before the
  due-date write): no listed reviewer PDF → `proposal_pdf_missing`; nothing
  listed and one of the request's Dynamics-linked folders unlistable, or the
  listing threw → `proposal_pdf_unavailable` (fail closed, staff retry).
  Speculative archive-folder probes 404 for most requests, so archive-only
  failures count as missing (`listReviewerMaterialsWithAvailability` now also
  returns `unavailableSources`). **Not gated (owner decision needed):** the
  Review Manager `regenerate-token` route can mint a first copyable link for a
  not-yet-invited reviewer whom staff then invite by hand; it applies neither
  this PDF check nor D48's due-date write. The Invite modal's manual-link
  "mark manually sent" control is unreachable today (`render-emails-service.js`
  always sets `manualLink: null`).

**Build notes (2026-10-30, branch `claude/reviewer-materials-on-accept`, PR
#562, not merged).** Built on the branch: migration 091 and its store, the
acceptance job's `release_materials` step with the new template keys, and the
manual-path claim, staff recovery, the invitation PDF precondition and the
accepted-screen copy (Session 654). Still [PLANNED] (follow-up PR): invitation wording and
`{{proposalDelivery}}` / Reviewer Finder date-field retirement. Accept does
not set a review status [VERIFIED via rg: no `reviewStatus` write in
`respond-service.js` or `reviewer-engagement/record-invitation.js`; writers are
`record-email-outcome.js` and `close-review.js`], so a new acceptance is
eligible (blank status). The address check re-reads the reviewer and retries
on a failed read; it never trusts the job's snapshot. A lasting bookkeeping
failure after a confirmed send alerts staff ("sent but not yet recorded").
Transient failures before the claim retry for up to 15 minutes; then the
reviewer gets today's confirmation and staff a "materials held" alert (owner,
2026-10-30). After the claim there is no fallback: the release row's state
rules. Each stuck release keeps one deduplicated staff alert open, re-raised
by every drain run. Invitation wording and the old date-field retirement move
to a follow-up PR (owner, 2026-10-30).

- **Release table, migration 091** (no open branch claims 091, checked
  2026-10-30 against every remote branch; Production `schema_migrations` is an
  owner-run check before merge): `reviewer_materials_releases`, one row per
  engagement, `suggestion_id` unique; `request_id`; `source` (`acceptance` |
  `manual`); `state` (`claimed`, `link_minted`, `sent`, `recorded`,
  `uncertain`, `failed`); `lease_token`, `lease_until`; a timestamp per
  transition; `job_id` (acceptance) or the staff actor (manual); `error_code`;
  `attempts`. The claim is `INSERT … ON CONFLICT (suggestion_id) DO NOTHING
  RETURNING`: whoever inserts first owns the release.
- **Drain step `release_materials`**, skipped on a repeat acceptance as today.
  Everything reversible runs before the claim: fresh suggestion/request reads
  (request select adds `_wmkf_grantcycle_value`, never the meeting date), PDF
  check, cycle configuration from the Grant Cycle link, attachment fetch,
  sender, address-confidence and test-request checks, render. **An attachment
  that cannot be fetched fails the step before the claim and retries** (the
  manual path warns and continues; with no one watching, a missing review
  template must not reach the reviewer silently). Then claim → `mintAndStore`
  with the accepted expiry → `link_minted` → send → `sent` → `recordDeliveredEmail`
  (`templateType: 'materials'`) → `recorded`.
- **Retries act on the row's state:** `recorded` skips; `sent` only records
  (never resends); `claimed` / `link_minted` past the lease, `uncertain` or
  `failed` are never resumed: staff alert and "Send materials again", which
  re-mints and sends under the same row after re-checking accepted and not yet
  released on the server. The job completes; the release alert stays open.
- **Combined email** uses new template keys
  `email.reviewer_materials_acceptance.{subject,body}` (seeded create-only, so
  no rebaseline of the old acceptance keys and no old per-PD acceptance
  overrides apply). The link goes in `{{reviewUrl}}`; a body without it gets a
  standard link paragraph appended, so it is never sent without the link.
  Rendered with the send-time placeholder link; the minted link replaces it
  after the claim. Attachments: the due-date calendar file plus the cycle's
  review template and additional attachments.
- **Fallback (materials held, today's acceptance email instead, staff
  alert):** no proposal PDF (an unlistable folder retries instead), new
  template keys not seeded, a revoked link or a status other than blank /
  accepted,
  address confidence `blocked`, no Grant Cycle link or no cycle
  configuration. All are decided before the claim, so nothing is minted.
- **Step state table** (`job.steps.release_materials`):

  | Release row before the step | Step does |
  |---|---|
  | none | reversible checks → fallback, retry, or claim and send |
  | ours (`acceptance`, this job), `recorded` | nothing; done |
  | ours, `sent` | `recordDeliveredEmail` then `recorded`; never resend |
  | ours, `claimed` / `link_minted` (live or expired lease), `uncertain`, `failed` | alert, step `stopped`; staff "Send materials again" |
  | `manual` (any state) | step `skipped: manual_release_owns`; no acceptance email |
  | `acceptance` from another job | treated like `manual`: never send twice |

  After the claim: mint fails → `failed` (definite: nothing sent; the old
  link may already be dead, so staff resend); send throws → `uncertain` or
  `failed` by the existing dispatch classifier; confirmed send but
  `markMaterialsSent` returns null (staff reclaimed the row) → alert as
  uncertain, no bookkeeping. `MATERIALS_RELEASE_LEASE_MS` (10 min) exceeds the
  job lock (300 s default).
- **Manual release** takes the same claim just before its mint
  (`send-emails-service.js`, materials path); an existing row refuses with a new
  skip reason, "materials are already being sent"
  (`materials_release_in_progress`), or `materials_already_sent` when the row
  is `sent` / `recorded`. Built Session 654: a claim that cannot be checked
  fails closed (`materials_release_unavailable`); mint failure → `failed`;
  dispatch throw → `uncertain` / `failed` by the existing `dispatched`
  classifier; after `recordDeliveredEmail` the row goes to `recorded` and the
  release alert is resolved. Two tightenings: a materials draft without the
  reviewer link now fails closed (`external_link_missing`) instead of sending
  unclaimed, and `markAsSent: false` is refused for materials (both UIs always
  send `true`).
  **Recovery (owner-approved Session 654, after Codex review): built.** A
  `failed` row (definitely unsent) is retaken by any normal send. `uncertain`
  or abandoned rows are resent only through the Release Materials "Send again"
  button (`recoverMaterialsReleaseIds`), after the delivered-marker gates. A
  `sent` row is recorded automatically by the drain's stuck loop (any source,
  from `sent_at`, never resending). A reviewer who closed or withdrew after
  delivery is closed by the drain itself (`reviewer_closed_after_delivery`;
  Codex round 2 found the staff action unreachable for them, since the send
  gates refuse terminal reviewers before the claim). For other unrecordable
  rows (binding changed, lasting ETag problems), staff "Mark as delivered"
  (`POST /api/review-manager/materials-release-delivered`) closes the release
  as `staff_marked_delivered`. Local auth-bypass sessions have no profile id,
  so a manual materials send there fails closed
  (`materials_release_unavailable`); real sessions always carry one
  (`requireAppAccess`).
- **Build order** (each a stop point): migration + claim service → drain step →
  manual-path claim → recovery action (route + UI) → invitation PDF
  precondition + accepted-screen copy [built through here; #562 complete] → wording seeds, `{{proposalDelivery}}`
  and Reviewer Finder date-field retirement.

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
  `boardEnds` leave the stored setup. `validateCycle` checks the exact key list
  (`model.js:38`), so removing the keys would make every saved setup invalid:
  the read path strips the two legacy keys before validation, and the next save
  writes the new shape.
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

## 4. Contract review (2026-10-29, Mode A)

Surface: invitation send, render, acceptance job, manual release, campaign
settings, review-filing cron, Board setup and worker, landing cycle, external
proposal download. Persistence: `akoya_request.wmkf_reviewduedate`,
suggestion lifecycle and token fields, Postgres `reviewer_acceptance_jobs`
steps, Dataverse settings (`reviewer.campaign_timeline_defaults`,
`board_writeups.cycle.*`, email templates), user preference
`reviewer_invite_timing`, browser storage `review_manager_email_fields`.

- Whole-flow: cycle for the due date and for the materials attachments both come
  from the request's Grant Cycle link (`_wmkf_grantcycle_value` → the linked row's
  code; `cycle-config-loader.js` `cycleCodesByGrantCycleId`), changed on PR 2's
  branch 2026-10-29 (owner). Earlier text: both came from
  `meetingDateToCycleCode(request.wmkf_meetingdate)`.
- Partial success: the combined email's order and fallback are named in §3.3.
- Async: the job re-reads suggestion and request before claiming
  (`reviewer-acceptance-drain.js:514-545`); the new step keeps those re-reads.
- Symbol fan-out to do at build: every reader of `reviewer_invite_timing`,
  `review_manager_email_fields`, `reviewer.campaign_timeline_defaults` fields,
  `wmkf_reviewreturndeadline`, the cycle record's date custom fields,
  `{{proposalDelivery}}`, `materialsDue`/`boardEnds`, and
  `REVIEW_DOCX_SHAREPOINT_CYCLE`; the new job step name in every reader of
  job `steps`.
- Durable surfaces: new migration for the release table (next free number on
  `main` at build time; manifest), Atlas pages for the request due-date writer, the acceptance
  jobs table (new step), Board setup settings; route matrix row for
  `/api/external/review/[token]/proposal`; `docs/CREDENTIALS_RUNBOOK.md`
  (env removed); service catalog entry for the shared reader; the J27
  `docs/J27_TRANSITION_REGISTER.md` rows for review filing and invitation dates.
- **Readiness:** the J27 Reviewer Finder cycle record must exist before Feb 24,
  because the combined email takes its review template and attachments from it
  (`send-emails-service.js:402-421`). Add it to the readiness notice.

Verdict: ready with the named changes above, which are now in §3.

Codex adversarial review (gpt-6.1-sol, 2026-10-29): needs-attention, three
high findings, all accepted and folded into §3.1 and §3.3: the due date must be
saved, conditionally, before invitations go out; a claimed release must be
recoverable at every boundary; automatic and manual release need one shared
claim. Re-review (same day): one high finding, a leftover step that wrote the
materials-sent markers before minting and sending; §3.3 now has one sequence
with the markers written only after confirmed delivery. Accepted.

## 5. Risks

1. **Withdraw window disappears** (§2.2). Mitigated by wording; owner confirms.
2. **Materials auto-sent to a reviewer with an unresolved address or COI
   concern.** The step applies the materials path's address-confidence and
   test-request checks; COI is screened at invitation and acknowledged at
   accept, as today.
3. **Pre-accept PDF access:** neither `verifySuggestionToken` (expiry,
   revocation, exclusion only; `verify-suggestion-token.js:175-197`) nor
   `proposal.js:53-66` (operation and file membership) checks acceptance
   [VERIFIED by read]. An invited, not-yet-accepted reviewer holding a valid
   link and a file id could stream the PDF; the portal only hides the list
   before release. **Fix in this build (PR 1):** `proposal.js` requires
   accepted, COI acknowledged and materials released.
4. **Board archive on a calendar edit:** a moved Board date moves the archive.
   Intended (D47); the readiness notice should flag a request-meeting-date
   mismatch (Connor question open).
5. **D26 continuity:** D26 requests keep stored due dates; D26 filing continues
   until Dec 10 by calendar; D26's Board setup reads the same date it typed.

## 6. Owner decisions

1. Calendar date is copied at first invitation and then fixed (§3.1), rather
   than read live. **Decided (owner, 2026-10-29; D48).**
2. One acceptance email that carries the materials, instead of two emails.
   **Decided (owner, 2026-10-30; D49).**
3. Reviewers withdraw by emailing the PD after accepting. **Decided (D48).**
4. Invitations refused when Reviews Due is blank or the proposal PDF is missing.
   **Decided (D48).**
5. Final wording of the three emails: drafted in the PR for the owner's
   review there (owner, 2026-10-30; D49); live text changes only with a
   later owner-approved rebaseline (`--force-keys`).

## 7. Build order and tests

Branch `claude/reviewer-invitation-calendar`; Tier 2 (reviewer emails and
Dataverse writes). Separate PRs, each with focused unit tests:

1. **Done (PR #551, merge `caf318983`, Production-deployed 2026-10-29):** review filing by Board date (D), using the
   adapter's existing `listBoardDates` rather than the shared reader; calendar
   page note and `inviteStartDate` removal (F); proposal download requires
   released materials (risk 3). Codex found and the PR fixed cross-cycle scan
   starvation and unreported undated cycles.
   The shared calendar reader moves to PR 2.
2. **Done (PR #552, merge `54070863f`, deployed to Production 2026-10-29 per Vercel commit status):** due date
   from the calendar on the server (A) and the due-date part of C.
   `lib/services/review-due-date-service.js` (the shared reader for this date,
   `getCycleDatesById` in the adapter, reading the row the request's Grant Cycle
   link names, `CYCLE_CALENDAR_MEANINGS` in `shared/config/cycleCalendar.js`; no
   link refuses, no meeting-date fallback); render fills `{{reviewDue}}` /
   `{{reviewDueDate}}` / `{{reviewDeadline}}` from the request date or the calendar and
   refuses an invitation preview with no date; send stores the date with `If-Match`
   before dispatch (new skip reason `review_due_date_unavailable`) and no longer takes
   the browser's date; the invite modal, Campaign settings and the materials modal show
   the date read-only (Campaign settings route refuses a write); the browser-saved
   materials date and the Admin "Reviews due" default are gone. **Left for PR 4** (they
   travel with the new wording): the proposal-release date fields and
   `{{proposalDelivery}}`, and the Reviewer Finder record's `proposalSendDate` /
   `commitDate` custom fields; the Reviewer Finder `reviewDeadline` is no longer read
   for email text but still feeds the draft fingerprint. **Also moved to the Grant
   Cycle link (owner, 2026-10-29):** render and send pick the cycle configuration
   (review template, attachments, program name) from the linked row's code
   (`cycleCodesByGrantCycleId`; June/December codes only), and the draft
   fingerprint binds the Grant Cycle id instead of the meeting date. The reviewer
   email path no longer reads `akoya_request.wmkf_meetingdate`; other app reads
   stay with the meeting-date removal plan (work queue item 6a).
3. Board setup from the calendar (E).
4. Materials on acceptance (B) + wording.

Gates: `check:api-routes`, `check:atlas`, `check:j27-register`,
`check:dataverse-access-layer`, `check:route-service-boundary`,
`check:reviewer-engagement-boundary`, `check:status-enum-parity`, plus jest for
touched services. Contract-reconcile before each PR; Codex review of this plan
and of each PR.
