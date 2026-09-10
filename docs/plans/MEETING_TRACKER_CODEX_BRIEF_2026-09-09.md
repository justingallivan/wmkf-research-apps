---
title: Meeting Tracker slices 1–2 — Codex Brief (2026-09-09)
domain: workbench
kind: plan
status: active
summary: "Codex build brief: the Meeting Tracker app (deliberation sessions with ordered slots, Zoom link, attendees) as the schedule of record, plus the fixed reader contract the Staff Deliberations tab consumes. First session is the week of 2026-09-14."
cataloged: 2026-09-09
last_verified: 2026-09-09
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md
  - lib/services/site-visit/logistics-service.js
  - lib/services/site-visit/recipient-directory-service.js
  - lib/dataverse/schema/wave3-grantee-deliverable-table/wmkf_granteedeliverable.json
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Meeting Tracker slices 1–2 — Codex Brief (2026-09-09)

## Where you are

Create your own worktree from `origin/main` (tip `d7096fa9` or later) and stay in it:

```
cd /Users/gallivan/Code/WMKF_Apps
git fetch origin
git worktree add ../WMKF_Apps-codex-tracker -b codex/meeting-tracker origin/main
cd ../WMKF_Apps-codex-tracker && npm ci
mkdir -p .agents && ln -s ../.claude/skills .agents/skills
```

Run `/start` there. Claude works in the main checkout on the Staff Deliberations tab redesign
at the same time; the seam between you is the reader contract in §4 below. Do not check out
other branches, touch other directories, or push to `main`. Push after each meaningful commit
(`git push -u origin codex/meeting-tracker`); pushing a feature branch does not deploy. Do not
merge, deploy, apply schema to any Dataverse target, or edit `SESSION_PROMPT.md`. Record your
handoff at the bottom of this brief.

## Why (owner, 2026-09-09)

Read `docs/PC_MEETING_TRACKER_PLAN.md` §1 and §2 in full first; decisions D1–D12 are settled and
are not yours to reopen. The short form: every advancing D26 proposal gets two meetings, a
weekly internal deliberation session (staff plus select Board, ~15 minutes per proposal, on
Zoom) and a PC-scheduled site visit. Nothing records the session today. **The first session is
the week of 2026-09-14.** The Program Coordinator needs, by then, to create a session, paste
the Zoom link, pick attendees, and put proposals in order. The Staff Deliberations tab and the
Share email (Claude's track) read that record through §4.

## Goal

Slice 1 and slice 2 of plan §7, in this order, each a separate PR-sized commit series:

1. **Schema wave** for `wmkf_deliberationsession` and `wmkf_deliberationslot` with a preflight
   script and a readiness flag. No apply by you (see "Verify before acting").
2. **The app**: registry entry `meeting-tracker` / "Meeting Tracker", grant via the existing
   Admin app-access panel, one list page per cycle, one session page, slot operations, and the
   §4 reader. The site-visit editor and the briefing-room link (slice 2b) are **not** in this
   brief; render the slot's briefing link as "Briefing not yet available."

## Current state you are building on (all [VERIFIED 2026-09-09 via source])

- **Schema waves** live under `lib/dataverse/schema/<waveN-name>/*.json`; the latest is
  `wave27-reviewer-due-date-extension-event`, so yours is `wave28-meeting-tracker`. The
  new-entity shape to mirror is `wave3-grantee-deliverable-table/wmkf_granteedeliverable.json`
  (`"kind": "new-entity"`, `ownershipType`, `primaryNameAttribute`, picklists with numeric
  `100000000+` values that mirror a `shared/config/*.js` map). Apply tooling is
  `scripts/apply-dataverse-schema.js`; readback is `scripts/dynamics-schema-diff.js`. Each
  wave ships a `scripts/preflight-<name>-schema.mjs --target=<target>` that reports
  exact / absent / divergent (copy the shape of `preflight-request-document-explicit-actor-schema.mjs`).
- **Readiness flags** are non-sensitive env values, literal `on` only; see the rows in
  `docs/CREDENTIALS_RUNBOOK.md:197-201` and their names in `lib/utils/tracked-secrets.js`.
  Yours is `MEETING_TRACKER_SCHEMA_READY`. Runtime fails closed: routes return 503 before
  Dataverse work and the §4 reader returns all-null while it is not `on`.
- **Site visits** stay on the `wmkf_sitevisit` Activity (D2); the writer is
  `lib/services/site-visit/logistics-service.js` `saveSiteVisitLogistics` (actor required, schema
  gate, request precondition `assertSchedulableRequest`, one-active, ETag). You do not write
  site visits in this brief; the list page **reads** them through `getSiteVisitLogistics` or
  `lib/dataverse/adapters/site-visit.js` `findActiveByRequests` (the cycle view's join).
- **Attendee references** resolve through `lib/services/site-visit/recipient-directory-service.js`
  (`getSiteVisitRecipientDirectory`, `resolveSiteVisitRecipientRefs`). Reuse the same reference
  map shape the Site Visit Activity stores (`wmkf_attendeerefsjson` on Wave 21) rather than
  inventing another; plan §5.2 recommends a plain table with a reference map, not an Activity.
- **The advancing-request predicate** is `shared/config/workbenchVisibility.js`
  (`buildVisibilityFilter` for OData, `isVisibleRequestRow` for rows). The list page lists
  exactly those rows for the selected cycle, the same set the Workbench Request list shows.
- **Cycle and program selection** follow the Workbench shell: `wmkf_meetingdate` is the single
  temporal axis; cycle codes come from `lib/services/workbench/` (see how
  `GET /api/workbench/dashboard` resolves `cycleCode` and `programId`).
- **Explicit actor convention** (Wave 24): see `lib/services/request-document-actor-service.js`
  before deciding whether session/slot rows carry explicit created-by fields; the plan says
  apply it if it fits.
- **App registry**: `shared/config/appRegistry.js` entries carry `key`, `name`, `href`,
  `description`, `category`; grants are keyed by `key` and checked by `requireAppAccess(key)`.
- **Release tier**: Tier 2 (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:119-131`):
  branch, characterization coverage, preview rehearsal, recorded rollback, explicit owner merge.

## Owned file surface

You may create or change:

- `lib/dataverse/schema/wave28-meeting-tracker/` (two entity JSONs), `scripts/preflight-meeting-tracker-schema.mjs`.
- `shared/config/meetingTracker.js` (status picklist map, defaults such as 15 minutes).
- `lib/dataverse/adapters/deliberation-session.js`, `lib/dataverse/adapters/deliberation-slot.js`
  (named operations only; no raw `DynamicsService` outside adapters — `check:dataverse-access-layer`).
- `lib/services/meeting-tracker/` (session service, slot service, `schedule-reader.js`).
- `pages/api/meeting-tracker/*` thin route shells; `pages/meeting-tracker/*` pages;
  `shared/components/meeting-tracker/*`.
- `shared/config/appRegistry.js` (one entry), `lib/utils/tracked-secrets.js` (one flag name).
- Docs: two new Atlas pages (`docs/atlas/dataverse-wmkf-deliberationsession.md`,
  `dataverse-wmkf-deliberationslot.md`), `docs/atlas/dataverse-wmkf-sitevisit.md` (tracker as a
  reader), `docs/API_ROUTE_SECURITY_MATRIX.md` rows for every route you add,
  `docs/CREDENTIALS_RUNBOOK.md` row for the flag, plan §7 status cells, and this brief's handoff.
- Tests for all of the above.

Do **not** touch: `StaffDeliberationsTab.js`, `StaffDeliberationsPanel.js`,
`DeliberationStageRail.js`, `deliberation-stage.js`, `PreSiteDistributionPanel.js`, the
logistics service and site-visit adapter (read them, do not edit), the external portal, email
templates, anything under `lib/dataverse/schema/wave1..27`.

## Contracts that must hold

1. **Schema (plan §5.2, D3, D10, Zoom).** `wmkf_deliberationsession`: `wmkf_scheduledstart`,
   `wmkf_scheduledend`, `wmkf_ianatimezone`, `wmkf_location`, `wmkf_meetinglink` (String, format
   Url, max 1000; the Zoom link), `wmkf_attendeerefsjson`, `wmkf_notes`, `wmkf_status` picklist
   (planned / held / cancelled). `wmkf_deliberationslot`: N:1 session (required), N:1
   `akoya_request` (required), `wmkf_order` (int), `wmkf_minutes` (int, default 15), N:1 lead PD
   `systemuser`, `wmkf_notes`. **No** alternate key or uniqueness on request. Primary name
   attributes are synthetic.
2. **Default attendees (D10).** A new session starts with the fixed staff list plus nothing; the
   PC adds Board members per session. The fixed list is an admin-editable setting read through
   the existing editable-text/settings mechanism, never a code constant. Attendees are stored
   as recipient references resolved through the recipient directory; the page never stores
   free-text emails as authority.
3. **Grant means edit (D1, D4).** `requireAppAccess('meeting-tracker')` on every route; reads and
   writes share the grant; actor from session via `withDalContext`; every write carries the
   acting user. No client-supplied identity. Session and slot ids GUID-validated at the edge and
   re-read server-side (`check:trust-boundary-guid`).
4. **Slot operations.** Add, remove, reorder within a session, and move to another session are
   each one ETag-guarded write on the slot; reorder is a batch of order PATCHes. An over-full
   session (sum of minutes > session duration) **warns** in the response and the UI; it never
   refuses. A request may appear in more than one session (D3).
5. **The reader (plan §5.4), fixed.** `lib/services/meeting-tracker/schedule-reader.js` exports
   `getDeliberationScheduleByRequests(requestIds)` returning a `Map` keyed by every input id, value
   `{ sessionId, scheduledStartIso, scheduledEndIso, ianaTimeZone, meetingLink, location, order,
   minutes, attendees: [{ name, email }] }` for the request's latest slot by session start, or
   `null`. Fail-open: flag not `on`, adapter error, or no slot → `null`, never a throw. Batched 25
   ids per Dataverse read, no party expand, cancelled sessions excluded. Claude's tab and the
   Share email consume this exact shape; do not rename fields.
6. **Fail closed while the schema is absent.** With `MEETING_TRACKER_SCHEMA_READY` unset, every
   tracker route returns 503 before any Dataverse call, the app tile still renders with a
   "not yet enabled" state, and the reader returns all-null. Pin this with tests.
7. **Zoom link.** Validated server-side as an absolute `https:` URL, max 1000 chars, stored
   verbatim; rendered as a "Join" link with `rel="noopener noreferrer"`; never interpolated into
   HTML unescaped. The list row shows a "no link" cue when the session has none.

## User-facing shape (plan §5.1; owner copy rules apply)

- **List page** (`/meeting-tracker`): program and cycle controls as in the Workbench shell; one
  row per advancing request: request number and title, PD, share state (read from the current
  Pre-Site artifact via the existing request-document adapter, display only), deliberation slot
  (session date · order · minutes · link present or missing), site visit (date · time · format ·
  location), and a "Needs scheduling" cue when either is missing. Sort by next meeting.
- **Session page** (`/meeting-tracker/sessions/[id]`): date, time, duration, timezone,
  location, Zoom link, attendees (staff chips pre-filled from the setting, add Board members from
  the directory), and the ordered slot list with per-slot minutes and lead PD, drag or
  up/down reorder, "Move to…" another session, remove. New-session form is the same page empty.
- Copy: sentences, not labels with colons; no exclamation marks; voice per
  `.claude-memory/feedback-user-facing-error-copy-voice.md`. Use the incumbent Workbench visual
  language (DESIGN.md: white cards, gray structure, one dark primary per view).

## Decisions that are the owner's, not yours

- Whether a PC role should exist (D4 says no; grant means edit).
- The briefing-room link content and access model (Site Visit Materials plan).
- Whether the tracker writes site visits (slice 2b).
- Any production apply or flag flip.

## Method

1. `/start`, then read in full: plan §1–§7, the Wave 3 and Wave 21 schema JSONs, the logistics
   service, the recipient directory service, `workbenchVisibility.js`, the dashboard route.
2. Slice 1 first: schema JSONs, preflight script, flag name, runbook row, Atlas pages. Commit and
   push; tell the owner it is ready for a sandbox apply (they run it and report the readback).
3. Slice 2 in small commits: (a) config + adapters + services + reader with tests; (b) routes
   with matrix rows and tests; (c) pages and components with tests; (d) docs.
4. Before calling it done: `npm run lint` (0 errors), `npm run check:types`, and sequentially
   with self-tests: `check:api-routes`, `check:atlas`, `check:trust-boundary-guid`,
   `check:dataverse-access-layer`, `check:route-service-boundary`, `check:route-lifecycle-auth`,
   `check:odata-escape`, `check:status-enum-parity`, `check:docs-catalog`,
   `check:doc-symbol-refs`, `check:secret-scan`; `git diff --check`. Run the full `npx jest` once
   at the end and record the totals.
5. Do not run `/stop`. Fill in the handoff below and push.

## Verify before acting

- **No Dataverse apply from your session.** Slice 1 ends at "ready for apply"; the owner runs
  `scripts/apply-dataverse-schema.js` against sandbox, then the preflight readback, then decides
  on production. Never set `DATAVERSE_ALLOW_PROD_READS`, `DATAVERSE_PROD_WRITE_ACK`, or any
  `*_SCHEMA_READY` value yourself.
- `check:agent-wiki` fails in a fresh worktree unless `.agents/skills` is symlinked (the
  `ln -s` above); that failure is not a code failure.
- The Site Visit Materials plan and its briefing room live on `origin/codex/applicant-additional-materials`,
  not on `main`; read with `git show`, do not check it out.

## Tests

Add, with the discriminating fixture in each:

- Reader: flag off → all-null without a Dataverse call; two sessions for one request → the
  later session wins; cancelled session ignored; batch of 30 ids → two reads.
- Slot service: move to another session is one PATCH carrying the target session and new order
  with `If-Match`; over-full session returns the warning and still writes; a stale ETag → 409.
- Routes: 503 before any adapter call while the flag is off; 400 for a non-GUID id before any
  read; 403 without the grant; identity from session only (a body `actingUserSystemId` is
  ignored, assert the exact service argument).
- Zoom link: `http:` and `javascript:` rejected with 400; a valid `https:` link stored verbatim
  and rendered with `rel="noopener noreferrer"`.
- Session create: attendees default to the admin setting's list; the setting missing → empty
  list and a visible notice, never a throw.
- Pages: list row shows "Needs scheduling" when either meeting is missing; session page reorder
  posts the full order.

## Handoff (fill in at the end)

- Commits on `codex/meeting-tracker`:
  - `052c304b` — Add Meeting Tracker Wave 28 schema.
- Files changed: Wave 28 session/slot specs; the read-only preflight; shared
  readiness/status/default config; focused config/schema tests; the two new
  Atlas pages; the readiness runbook row; plan §7 status.
- Verification run and results: `/start` all green; Wave 28 preflight self-test
  PASS; focused Jest 3/3 PASS; lint 0 errors (86 pre-existing warnings);
  `check:types`, `check:atlas` + self-test, `check:docs-catalog`,
  `check:doc-symbol-refs` + self-test, `check:build-claim-freshness` +
  self-test, `check:fact-consistency` + self-test, `check:doc-currency` +
  self-test, `check:status-enum-parity` + self-test, `check:secret-scan` +
  self-test, and `git diff --check` all PASS.
- Ready-for-apply statement for slice 1: **ready for an owner-run sandbox
  preflight and apply; no apply was run by Codex.** Run
  `node scripts/preflight-meeting-tracker-schema.mjs --target=sandbox`; on an
  untouched sandbox expect 20 absent / 2 exact no-alternate-key checks / 0
  divergent. After an explicitly approved
  `node scripts/apply-dataverse-schema.js --target=sandbox --wave=28-meeting-tracker --execute`,
  rerun the preflight and require **22 exact / 0 absent / 0 divergent** before
  setting `MEETING_TRACKER_SCHEMA_READY=on`. The Codex worktree could not run
  the live sandbox preflight because its inherited local environment has no
  `DYNAMICS_SANDBOX_URL`.
- Open questions / recommendations for the owner: confirm the sandbox apply
  and exact readback before asking Codex to start slice 2. Before runtime
  promotion, verify the application/impersonated staff security role has the
  required Read/Create/Write/Append/Append To privileges on both new entities
  and their lookup targets; the brief did not authorize a role manifest.
