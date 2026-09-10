---
title: PC Meeting Tracker — Deliberation Sessions and Site Visits as the Schedule of Record
domain: workbench
kind: plan
status: active
summary: "A PC-owned app records each proposal's deliberation slot and site visit once, so the Staff Deliberations rail and cycle view read dates from one source."
canonical: false
cataloged: 2026-09-09
last_verified: 2026-09-09
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
| D6 | Stage **labels are not load-bearing**. Code carries stable stage keys; display labels live in one admin-editable catalog entry per stage (the existing editable-text mechanism, `shared/config/editableTextDefaults.js`), read by both the tab and the cycle view. Placeholders: AI draft ready · Shared · Visit · Final. Adding, merging, or reordering stops is code; the words are free. | Parity test: every derivable key has a label. |

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
  shows registry lifecycle/operation only.
- **Deliberation sessions** exist nowhere in the system.
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
  PD, share state, deliberation slot (session date · order · minutes), site visit (date · time ·
  format · location), and a "needs scheduling" cue when either is missing. Sort by next meeting.
- One session page: date, time, duration, location, attendees (staff and Board, using the existing
  recipient directory), and the ordered slot list with per-slot minutes and lead PD. Add, remove,
  reorder, and move a slot to another session in place.
- One visit editor per request: the fields the Activity already has, written through the existing
  logistics service.

### 5.2 Schema (new wave, `kind: new-entity`)

Two tables, Dataverse, following the wave conventions under `lib/dataverse/schema/`:

- `wmkf_deliberationsession`: `scheduledstart`, `scheduledend` (or duration), `wmkf_ianatimezone`,
  `wmkf_locationorlink`, `wmkf_notes`, status (planned / held / cancelled). Attendees: **decide in
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

- **Staff Deliberations tab (rail).** Stops keyed `draft | shared | visit | final`; labels from
  the catalog (D6). Stop 3 shows the **site visit** date from the Activity and the **deliberation**
  date from the latest slot, as two lines under one stop or two sub-stops — a form decision. "Not
  scheduled" is a normal state that names the PC as the actor, not a warning.
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

## 6. Security contract [PLANNED — do not add matrix rows until the routes exist]

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
| 1 | Schema wave for session + slot; Atlas pages; readiness flag; sandbox apply and readback per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. | 2 |
| 2 | App registry entry, grant, list page, session page, slot moves; site-visit editor via the existing service. | 2 |
| 3 | **[BUILT 2026-09-09 on `claude/deliberations-stage-rail`.]** Rail and cycle view read both dates; stage-key catalog with editable labels; parity test. Deliberation-session line pending slice 1 (no session table exists yet; the rail's visit stop shows the site visit only, with a TODO comment naming this plan). | 1 |
| 4 | (Retired 2026-09-09: §5.5 decided; stop 3's three displays fold into slice 3.) | — |

Slices 0 and 3 can start before 1 and 2 land: 3 degrades to "not scheduled" when the tables do
not exist yet, gated on the readiness flag.

## 8. Explicitly out of scope

- Site visit **scheduling automation** (calendar negotiation with applicants).
- The external briefing room and applicant-materials collection (Codex plan; the deliberation
  session is where its bundle will eventually be opened from, nothing more).
- Distribution email and logistics copy edits (owner: "noting for later").
- Recording / transcript producers.
- A PC role. D4 stands until evidence says otherwise.
- J27 differences (the auto-generation trigger and the narrative source path; register J27-082).

## 9. Open questions for the owner

1. ~~§5.5, the three "visited" questions.~~ Decided 2026-09-09: D7–D9.
2. Who attends deliberation sessions by default: a fixed staff list plus per-session Board members,
   or per-session only?
3. Should the session page open the review bundle (shared document, reviews, proposal) directly, or
   link to each request's Workbench tabs? (Affects whether slice 2 needs a read model beyond links.)
4. App key and name.
