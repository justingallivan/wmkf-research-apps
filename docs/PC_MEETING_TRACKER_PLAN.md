---
title: PC Meeting Tracker — Deliberation Sessions and Site Visits as the Schedule of Record
domain: workbench
kind: plan
status: active
summary: "A PC-owned app records each proposal's deliberation slot and site visit once, so the Staff Deliberations rail and cycle view read dates from one source."
canonical: false
cataloged: 2026-09-09
last_verified: 2026-09-10
owner: product-engineering
related:
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/atlas/dataverse-wmkf-sitevisit.md
  - lib/services/site-visit/logistics-service.js
  - lib/dataverse/adapters/site-visit.js
  - shared/components/workbench/StaffDeliberationsTab.js
  - shared/components/workbench/StaffDeliberationsPanel.js
  - shared/config/appRegistry.js
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# PC Meeting Tracker — Deliberation Sessions and Site Visits as the Schedule of Record

Owner conversation 2026-09-09 (Session 501). Planning only; nothing below is built unless a
section says so. State claims are labelled `[VERIFIED via …]` or `[PLANNED]`.

## 1. The process this serves (owner, 2026-09-09)

Every advancing proposal now starts at **AI draft ready**: on 2026-09-09 an owner-run batch
generated a Pre-Site Visit Word draft for all 23 advancing D26 requests
`[VERIFIED via outputs/pre-site-drafts-D26.json: 21 generated, 2 reused, 0 errors]`. After the
PD shares that draft (the existing guarded lock, lifecycle Review), two meetings follow:

1. **The internal deliberation session.** Staff plus select Board members discuss the shared
   document, with linked access to the peer reviews and the original proposal. Sessions run
   about weekly during site-visit season, 90 minutes, several proposals per session at roughly
   15 minutes each. A proposal can come back in a later session (a lead PD is out, for example);
   uncommon but not zero, handled case by case.
2. **The site visit.** Scheduled in advance by the Program Coordinator (PC; today Duncan Spore),
   who already knows dates, times, and attendees.

Today neither meeting is visible on the Staff Deliberations tab or the cycle view, and the
only place a visit is recorded is a Dataverse Activity that someone keys in directly. The
owner's direction: build a **PC meeting tracker** — its own app — where the PC sees every
advancing proposal and attaches both meetings to it. That record is the schedule of record;
the rail and the cycle view read it; when a meeting moves, the PC moves it once and the PD
does nothing.

## 2. Owner decisions (2026-09-09)

| # | Decision | Consequence |
|---|---|---|
| D1 | The tracker is **its own app** in the registry, not a Workbench view. The Workbench is PD-centric; this is a different job. Anyone granted the app in Admin sees it (vacation cover is a grant). | New `appRegistry` entry; new page namespace; access via the existing grant table. |
| D2 | **Site visits stay on the existing `wmkf_sitevisit` Activity.** The tracker becomes the editor that record lost on 2026-08-28. Deliberation sessions are a **new** record. | No migration of the calendar invite, recipients, or materials linking. One new schema wave. |
| D3 | Sessions are **squishy by design**: one date/time/duration with N ordered slots; a request may hold slots in more than one session; the rail reads the **latest** slot; 90 minutes and 15 minutes are defaults, not limits (over-full is a quiet warning, never a refusal). | Slot is its own row with a request lookup; no uniqueness constraint on request. |
| D4 | **Grant means edit.** The org-open posture applies (see `project-reviewer-org-open-access-by-design`); the grant controls dashboard visibility, not authority. No PC role. Every write is stamped with the acting user. | One server-side write gate ("holds the grant") that can later tighten without UI change. |
| D5 | **"Shared" means locked** (the Start-sharing transition to lifecycle Review), not "first email sent". "Not yet sent" is a substate. | Rail stop 2 keys on lifecycle; distribution is a substate. |
| D7 | **"Visited" is date-derived.** The visit happened when the Activity's scheduled start is in the past. No confirmation, no Word-version signal. If the PC moves the date, the rail follows. | Stop 3 reads one field; no new status, no write. |
| D8 | **Every advancing D26 request gets a site visit.** Visits are scheduled before the reviews are in this cycle, so "no visit scheduled" is a PC to-do and the cycle view counts it. **J27 changes this:** proposals may go out for review and then not be visited, so stop 3 must be allowed to be absent next cycle. Build the D26 assumption behind one predicate, not scattered. | One `visitExpected(request)` predicate, D26 = always true; a J27 register row binds it. |
| D9 | **No confirmation step.** After the date passes the rail simply says visited. No "awaiting confirmation" interim state. | Simplest display; the tracker's date edit is the only correction path. |
| D6 | Stage **labels are not load-bearing**. Code carries stable stage keys; display labels live in one admin-editable catalog entry per stage (the existing editable-text mechanism, `shared/config/editableTextDefaults.js`), read by both the tab and the cycle view. Placeholders: AI draft ready · Shared · Visit · Final. Adding, merging, or reordering stops is code; the words are free. The `draft` label describes a draft that exists: until one does, the first stop shows code-owned substate text (No draft yet / Generating draft / Draft failed; 2026-09-10). | Parity test: every derivable key has a label. |

Two earlier decisions are **superseded in part** and must be read with this plan:

- **2026-08-28: the visible logistics editor was removed from the Workbench; "scheduling is handled
  by others, directly on the Dataverse Activity"** `[VERIFIED via shared/components/workbench/useSiteVisitContext.js:1-13 and docs/atlas/dataverse-wmkf-sitevisit.md "Consumers"]`.
  Still true for the Workbench. Scheduling returns to the app on a **PC surface**, not the PD's tab.
- **Codex Site Visit Materials plan §2: "Scheduling remains outside the first release… Do not build
  Site Visit scheduling"** `[VERIFIED via origin/codex/applicant-additional-materials:docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §2]`.
  Read as "not in that plan's release", not "not at all". That plan assumes a visit is already on
  the Activity when materials collection starts; this tracker is what puts it there.

## 3. Current state (all [VERIFIED 2026-09-09 via source])

- **The Activity.** `wmkf_sitevisit`, entity set `wmkf_sitevisits`, one active per request, bound
  by `regardingobjectid`. Standard Activity fields (`scheduledstart`, `scheduledend`,
  `scheduleddurationminutes`, subject, description, state) plus Wave 21 fields: `wmkf_visitformat`
  (In person / Virtual / Hybrid), `wmkf_ianatimezone`, `wmkf_locationorlink`,
  `wmkf_attendeerefsjson` (server-owned reference map). Attendees are real ActivityParty rows
  (organizer / required / optional). Production-proved 2026-08-25 on Request 1002379
  (`docs/atlas/dataverse-wmkf-sitevisit.md`). Readiness flag `SITE_VISIT_LOGISTICS_SCHEMA_READY`
  is literal `on` in Preview and Production.
- **The writer.** `lib/services/site-visit/logistics-service.js::saveSiteVisitLogistics` requires a
  mapped staff actor, the readiness flag, **and the request to be an advancing request in a cycle
  with a meeting date** (`assertSchedulableRequest`, error `site_visit_request_not_schedulable`;
  built 2026-09-09, slice 0); permits one active visit;
  resolves organizer and attendees server-side; field edits are ETag-fenced PATCHes; attendee-role
  changes are one atomic same-ID delete-and-recreate changeset because Dataverse rejects direct
  ActivityParty writes. Route: `PATCH /api/workbench/site-visit/logistics`, live, **no in-app caller**.
- **The readers.** `useSiteVisitContext` reads the Activity headlessly for the materials composer
  (calendar `.ics`, linked materials, suggested recipients). A visit created directly in Dynamics
  has no reference map; the read projection falls back to manual refs from ActivityParty emails.
- **The rail today.** `StaffDeliberationsTab.js` derives Draft → Share → Wrap Up; Wrap Up is
  derived from the first transport-accepted materials send (`currentSourceEverSent`), and the
  tab renders **no visit date at all**. The 2026-09-09 cycle view (`StaffDeliberationsPanel.js`)
  shows registry lifecycle/operation only. (Superseded by slice 3, 2026-09-09; see §7.)
- **[SANDBOX SCHEMA EXACT 2026-09-09; SOURCE-BUILT 2026-09-10.]** Wave 28
  provides deliberation session and slot tables in sandbox, and
  `codex/meeting-tracker` provides the readiness-gated runtime and UI. The flag
  remains unset and Production is unapplied, so this is not yet a live app.
- **Recording / transcript / transcript-summary** artifact types exist in the registry but have no
  producer; only distribution and logistics reference them as material categories.

## 4. The conflict the build must resolve first

`assertActiveStage` makes the Activity unwritable until the draft is shared. The process is the
other way round: the PC schedules the visit weeks ahead, while the PD is still editing. The gate
was appropriate when the only writer was the PD's Site Visit tab; it is wrong for a PC surface.

**Decision for the build:** replace the stage precondition with a **request precondition** — the
request must be an advancing request in a cycle with a meeting date (the same visibility
predicate the Request list uses, `shared/config/workbenchVisibility.js`). Keep every other
guard: actor required, readiness flag, one active visit, ETag fence, server-side recipient
resolution. The Workbench route keeps working unchanged; the tracker's route is a sibling that
calls the same service.

**Built 2026-09-09 on `claude/site-visit-schedulable-gate` (slice 0).** Review note (Opus): the gate applies to the **write** path only; `getSiteVisitLogistics` is not gated on schedulability, so a visit recorded while a request was advancing stays readable (calendar invite, materials) after a later triage change.

## 5. Target model

### 5.1 App

- `appRegistry` entry, key `meeting-tracker` (placeholder; rename freely before build), name
  "Meeting Tracker", href `/meeting-tracker`, category `phase-ii`. Grant through the existing
  Admin app-access panel.
- One list page per cycle: every advancing request (Request-list predicate), one row each, showing
  PD, share state, deliberation slot (session date · order · minutes · link present or missing), site visit (date · time ·
  format · location), and a "needs scheduling" cue when either is missing. Sort by next meeting.
- One session page: date, time, duration, location, **meeting link** (the Zoom URL the PC pastes
  in; validated as an https URL, shown as a "Join" link on the page and carried into the Share
  email per §5.6; owner 2026-09-09), attendees (staff and Board, using the existing recipient
  directory), and the ordered slot list with per-slot minutes and lead PD. Add, remove, reorder,
  and move a slot to another session in place. Since 2026-09-11 the lead PD is display-only on
  the row (seeded from the request's PD when the proposal is added; owner: reassignment at this
  point is rare and a second editable copy invites drift). The slot field and the agenda email's
  "Lead PD:" line are unchanged; correcting a wrong lead PD means remove and re-add. Since
  2026-09-11 each row also shows the applicant institution under the title (owner request),
  read from the session detail (`getDeliberationSession` attaches `institution` to every slot
  from one bounded `akoya_request` read of the formatted Applicant lookup, fail-open null; the
  cycle dashboard's `institution` is the fallback). The agenda email carries the same name
  after each proposal's title (owner request, 2026-09-11).
- One visit editor per request: the fields the Activity already has, written through the existing
  logistics service.

### 5.2 Schema (new wave, `kind: new-entity`)

Two tables, Dataverse, following the wave conventions under `lib/dataverse/schema/`:

- `wmkf_deliberationsession`: `scheduledstart`, `scheduledend` (or duration), `wmkf_ianatimezone`,
  `wmkf_locationorlink`, `wmkf_meetinglink` (owner, 2026-09-09: the PC saves the Zoom link here;
  the Share email carries it the way it carries the site-visit calendar entry, see §5.6),
  `wmkf_notes`, status (planned / held / cancelled). Attendees: **decide in
  the build** between ActivityParty (make it an Activity, visible on timelines) and a reference map
  like `wmkf_attendeerefsjson` (simpler, already has a resolver). Recommendation: a plain table with
  the reference map; a session is not "regarding" one request, so the Activity timeline gains little.
- `wmkf_deliberationslot`: N:1 to session, N:1 to `akoya_request`, `wmkf_order` (int),
  `wmkf_minutes` (int, default 15), N:1 lead PD (`systemuser`), `wmkf_notes`. **No** uniqueness
  on request (D3).

Both carry the Wave 24 explicit-actor convention if the build finds it applies (check
`lib/services/request-document-actor-service.js` for the pattern before copying it).

### 5.3 Writers

| Write | Path | Guard |
|---|---|---|
| Site visit create/edit | tracker route → `saveSiteVisitLogistics` (stage gate replaced, §4) | grant + actor + readiness + one-active + ETag |
| Session create/edit/cancel | new service | grant + actor + ETag |
| Slot add/move/reorder/remove | new service; a move is a PATCH of the session lookup and order | grant + actor + ETag on the slot; an over-full session warns in the response, never refuses |

No client-supplied identity anywhere; request and session ids are GUID-validated at the edge
and re-read server-side (`check:trust-boundary-guid`).

### 5.4 Readers

**Reader contract the Workbench consumes (owner 2026-09-09; built by the tracker, consumed by
the Staff Deliberations tab, the cycle view, and the Share email):**

`lib/services/meeting-tracker/schedule-reader.js` →
`getDeliberationScheduleByRequests(requestIds: string[]) → Map<requestId, DeliberationSchedule | null>`
where `DeliberationSchedule = { sessionId, scheduledStartIso, scheduledEndIso, ianaTimeZone,
meetingLink, location, order, minutes, attendees: [{ name, email }] }` taken from the request's
**latest** slot by session start (D3). Fail-open: when `MEETING_TRACKER_SCHEMA_READY` is not
literal `on`, or the read fails, every entry is `null` and the caller renders "not yet
scheduled". One Dataverse read per 25 requests, no party expand, same shape as the cycle
view's visit join. This contract is fixed so the two tracks can build in parallel.

- **Staff Deliberations tab (rail).** Stops keyed `draft | shared | visit | final`; labels from
  the catalog (D6). Stop 3 shows the **site visit** date from the Activity and the **deliberation**
  date from the latest slot, as two lines under one stop or two sub-stops — a form decision. "Not
  scheduled" is a normal state that names the PC as the actor, not a warning. **[BUILT 2026-09-10,
  S503, tab redesign]** Both the tab and the cycle view render a "Deliberation session: …" line
  under the stage sentence at draft/shared, fed by this reader: the per-request GET
  `/api/workbench/pre-site-visit` payload carries `session` via the briefing seam
  (`lib/services/deliberation-briefing/session-reader.js`), and the cycle list batches
  `getDeliberationScheduleByRequests` once per list. Both read null ("not yet scheduled") until
  `MEETING_TRACKER_SCHEMA_READY` is on.
- **Cycle view (`staff-deliberations`).** One row per advancing request, the same rail, the date
  that matters for its stop, edit-check count, and one next-action link; grouped by stop with a
  lead line; Scope control as on Request list. Reads the same two records.
- **Materials composer.** Unchanged; it already reads the Activity.

### 5.5 "Visited" — decided 2026-09-09 (D7–D9)

Date-derived from the Activity's scheduled start; every advancing D26 request is visited; no
confirmation step and no Word-version signal. Stop 3 therefore has exactly three displays:
"Visit not scheduled" (PC to-do), "Visit <date>" (future), "Visited <date>" (past). The
`visitExpected` predicate is the single place J27's "reviewed but not visited" case will land;
register it under the J27 transition register when slice 3 builds it.

### 5.6 What the Share email reads from the tracker (owner, 2026-09-09)

The Staff Deliberations tab's Share action becomes one step: lock the draft, then send the
deliberation email (brief: `docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md`).
That email already carries the draft, the request's material links, and the site-visit
calendar entry. From this tracker it additionally reads, for the request's latest slot:
the session date and time (`scheduledstart`, `wmkf_ianatimezone`), the Zoom link
(`wmkf_meetinglink`), and the attendee list as the default recipients. **[BUILT 2026-09-10,
S503]** Prepare snapshots the request's latest slot (`sessionSnapshotOf` in
`lib/services/pre-site-visit/distribution-service.js`, persisted as `session_snapshot`,
migration 040) into the email body ("Deliberation session: …" with an https-only Join link, or
"not yet scheduled"), the draft hash, and the preview hash; send rechecks the live slot and
refuses with `distribution_session_stale` if it moved, appeared, or was removed. The status
payload carries `sessionAttendees`, which the tab hands the composer as the default To once a
slot exists (the site-visit party remains the default before that). The composer shows the
slot read-only. The email also carries the
request's deliberation briefing link (`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`, built S502):
that link is the carrier for reviews and the proposal narrative, which are never attached.

## 6. Security contract [SOURCE-BUILT 2026-09-10 on `codex/meeting-tracker`]

- All tracker routes: `requireAppAccess('meeting-tracker')`, `withDalContext`, actor from session.
- Reads are org-open by posture (D4) but still behind the grant.
- No route accepts SharePoint identity, attendee emails as authority, or a session id that is not
  re-read; attendee references resolve through the existing recipient directory.
- Matrix rows and the Atlas pages (`dataverse-wmkf-sitevisit.md` gains the tracker as a writer;
  two new Atlas pages for the session and slot tables) are part of the build's docs slice.

## 7. Build slices and tiers

| Slice | Content | Tier |
|---|---|---|
| 0 | **[BUILT 2026-09-09 on `claude/site-visit-schedulable-gate`.]** Replace `assertActiveStage` with the request precondition; keep the Workbench route green; tests for both preconditions. | 1 (branch + PR) |
| 1 | **[BUILT AND VERIFIED IN SANDBOX 2026-09-09 on `codex/meeting-tracker`.]** Wave 28 declares session + slot with no alternate keys, required explicit Updated By actor lookups, a read-only 22-check preflight, Atlas pages, and the literal-on readiness flag contract. The owner-run post-apply readback reported 22 exact, 0 absent, and 0 divergent. The readiness flag remains unset pending deliberate runtime promotion. | 2 |
| 2 | **[SOURCE-BUILT 2026-09-10 on `codex/meeting-tracker`; promotion pending.]** App registry/grant, advancing-request cycle list, session editor, staff-plus-Board attendee picker, Zoom link, ordered slot add/remove/reorder/move, Site Visit and share-state joins, and the fixed §5.4 reader. Routes fail 503 and the tile says **Not yet enabled** while the readiness flag remains unset. | 2 |
| 2b | **[BUILT 2026-09-10, S503]** Site-visit editor in the tracker via the existing logistics service (`pages/meeting-tracker/visits/[requestId].js`, `shared/components/meeting-tracker/SiteVisitEditor.js`, route `/api/meeting-tracker/visits/[requestId]` guarded by the tracker grant; "Schedule visit" / "Edit visit" on every list row). The slot's briefing link no longer waits on this slice: read it with `getLiveBriefingLink({ requestId })` from `lib/services/deliberation-briefing/briefing-link-service.js` (built S502 on `feature/deliberation-briefing-page`, `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`; null until the owner sets `DELIBERATION_BRIEFING_SCHEMA_READY=on`). | 2 |
| 3 | **[BUILT 2026-09-09 on `claude/deliberations-stage-rail`; Meeting Tracker reader source-built 2026-09-10.]** Rail and cycle view read both dates; stage-key catalog with editable labels; parity test. The deliberation-session line remains safely empty until both branches are promoted and the Wave 28 readiness flag is enabled. | 1 |
| 4 | (Retired 2026-09-09: §5.5 decided; stop 3's three displays fold into slice 3.) | — |

**Deadline (owner 2026-09-09):** the first deliberation session is the week of 2026-09-14; the
first site visit is roughly three weeks out. Slices 1 and 2 are source-built on
`codex/meeting-tracker`; deliberate Tier-2 promotion, Production schema apply/readback, security-role
verification, and the readiness flip remain. Slice 2b follows separately.

Slice 3 remains safely degraded to "not scheduled" until the Wave 28 runtime is promoted and the
readiness flag is enabled for that target.

## 8. Explicitly out of scope

- Site visit **scheduling automation** (calendar negotiation with applicants).
- The applicant-materials collection (Codex plan). The deliberation briefing page itself is
  built separately (`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`); the tracker only reads its live link.
- Distribution email and logistics copy edits (owner: "noting for later").
- Recording / transcript producers.
- A PC role. D4 stands until evidence says otherwise.
- J27 differences (the auto-generation trigger and the narrative source path; register J27-082).

## 9. Open questions for the owner

1. ~~§5.5, the three "visited" questions.~~ Decided 2026-09-09: D7–D9.
2. ~~Who attends deliberation sessions by default?~~ **Decided 2026-09-09 (D10):** a fixed staff
   list plus per-session Board members. The staff list is an admin-editable setting, not code.
3. ~~Should the session page open the review bundle directly, or link to Workbench tabs?~~
   **Decided 2026-09-09 (D11):** neither. Each slot carries one link, the request's **external
   briefing room** from the Site Visit Materials plan (one read-only page per request behind a
   shared expiring link; Board members and consultants have no Dataverse login). The same link
   goes in the Share email. Staff who want the full request open the Workbench themselves. Built
   S502 as the deliberation briefing page (`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`, D13–D16);
   the slot reads `getLiveBriefingLink({ requestId })` (wired 2026-09-10, S503: the session read
   attaches `briefing` to every slot, one link read per request, fail-open per slot) and renders
   "Open briefing" or "Briefing not yet shared — the lead PD shares the writeup from Staff
   Deliberations." for null.
4. ~~App key and name.~~ **Decided 2026-09-09 (D12):** key `meeting-tracker`, name "Meeting Tracker".
5. **Session agenda email — decided 2026-09-10 (D21–D25, S503).** Board members often join for
   part of a session and need to know when their proposals come up; the per-proposal Share email
   does not say. So:
   - **D21 One agenda email per session**, sent by the PC from the session page. Body: the
     session date and time in its zone, the Zoom "Join meeting" link, location if any, then the
     proposals in slot order, each with a computed start–end window (session start plus the
     cumulative minutes of earlier slots), request number, title, applicant institution (since
     2026-09-11, when known), lead PD, and "Open briefing"
     when the request's briefing link is live, else "briefing link to follow by email".
   - **D22 The email is a snapshot.** Times are computed at send from the slots as they are then.
     The session page shows "Agenda sent <when> to <n> recipients" and, when the start, order,
     or minutes have changed since, "Schedule changed since the last agenda"; the PC sends again.
     No automatic resend, no staleness enforcement beyond that note.
   - **D23 Transport and ledger** mirror the deliberation email: a Dynamics email activity plus
     SendEmail from the PC's mailbox with the session-minted actor, no regarding record (the
     session entity has no activities), no attachments, a correlation key on the activity
     subcategory, and a Postgres ledger row (`deliberation_agenda_sends`, migration 041) with a
     lease-fenced send so a retry reconciles instead of double-sending.
   - **D24 Recipients** default to the session's attendees (staff plus the Board members added
     to that session); the PC can edit To/Cc before sending; the server normalizes and
     de-duplicates as the deliberation email does; an empty To refuses.
   - **D25 One agenda for everyone.** No per-recipient filtering; Board members find their
     proposals by the times.
   **[SOURCE-BUILT 2026-09-10 by Codex on `codex/session-agenda`; migration 041
   not applied by Codex.]** The session-page card/composer is
   `shared/components/meeting-tracker/SessionAgendaPanel.js`, mounted below the
   proposal order in `SessionEditor.js`. The guarded GET/prepare/send endpoint
   is `pages/api/meeting-tracker/sessions/[id]/agenda.js`; exact rendering,
   drift detection, correlation recovery, and lease-fenced transport live in
   `lib/services/meeting-tracker/agenda-service.js` and `agenda-store.js`.
   Migration `041_deliberation_agenda_sends.sql` plus fresh-install v46 provide
   the ledger. GET keeps the last sent receipt separate from any unresolved
   send; the composer pins that unresolved operation for retry and prepare
   and send block a competing operation, with a partial unique index as the
   concurrency backstop. Retry records an accepted status, lets the same sender
   resume a confirmed Draft on the same Dynamics activity, records a known
   closed status as terminal `failed`, and never sends when status is unknown
   or unreadable. **[VERIFIED via the focused agenda schema/service/route/panel
   suites; external schema state remains ASSUMED until the owner applies and
   reads back migration 041.]** Build brief:
   `docs/plans/SESSION_AGENDA_EMAIL_CODEX_BRIEF_2026-09-10.md`.
   - **D26 Agenda subject and opening message are admin-editable defaults**
     (`email.deliberation_agenda.*`), seeded from the previous hard-coded
     text; blank renders blank per the email-defaults convention. Build brief:
     `docs/plans/AGENDA_EMAIL_DEFAULTS_BUILD_BRIEF_2026-09-10.md`.
6. **D27 Proposal order supports drag-and-drop** (native HTML5; since 2026-09-11 the handle is
   a full-height rail on the row's left edge, and the position number renders once in the row
   header) and, since the 2026-09-10 row redesign, a keyboard-accessible position select in
   place of the arrow buttons (removed). The select moved behind the row's `OverflowMenu` as
   "Change position…" on 2026-09-11 (owner: the gutter's number + select read as a doubled
   number). Reorder is optimistic since 2026-09-11: the row moves on drop, the save and the
   ETag-refreshing detail reload run behind the busy guard, and a failed save restores the
   previous order. Both paths persist through the same full-order reorder route
   (`reorderSessionSlots` → `PATCH /api/meeting-tracker/slots/reorder`). Move-to-another-session
   and Remove sit in the same menu with inline confirm panels (no browser dialog).
   Built 2026-09-10 in `shared/components/meeting-tracker/SessionEditor.js` (`moveSlot`,
   `ProposalOrderList`). Build briefs: `docs/plans/AGENDA_SLOT_DRAG_REORDER_BUILD_BRIEF_2026-09-10.md`
   (original drag-and-drop, historical) and
   `docs/plans/PROPOSAL_ORDER_ROW_REDESIGN_BUILD_BRIEF_2026-09-10.md` (row redesign). Renumbered
   from D28 to D27 (per orchestrator review): Build A took D26.
