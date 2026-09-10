---
title: Meeting Tracker slices 1–2 — Codex Brief (2026-09-09)
domain: workbench
kind: plan
status: active
summary: "Codex build brief: the Meeting Tracker app (deliberation sessions with ordered slots, Zoom link, attendees) as the schedule of record, plus the fixed reader contract the Staff Deliberations tab consumes. First session is the week of 2026-09-14."
cataloged: 2026-09-09
last_verified: 2026-09-10
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

- **Commits on `codex/meeting-tracker`.** [VERIFIED via
  `git log --oneline origin/main..HEAD` on 2026-09-10]
  - `052c304b` — Add Meeting Tracker Wave 28 schema.
  - `0ebc8d19` — Record Meeting Tracker slice 1 handoff.
  - `1ba57eb3` — Use registered host for Meeting Tracker preflight.
  - `393ef4bc` — Record Meeting Tracker sandbox baseline.
  - `9a5caae6` — Correct Meeting Tracker sandbox apply command.
  - `1ad7ffee` — Record exact Meeting Tracker sandbox schema.
  - `a7716ecc` — Build Meeting Tracker data services.
  - `249eda35` — Add Meeting Tracker dashboard aggregation.
  - `4643418c` — Add Meeting Tracker API routes.
  - `7f98954b` — Build Meeting Tracker scheduling interface.
  - `28e9437f` — Document Meeting Tracker slice 2 handoff.
- **Files changed.** [VERIFIED via
  `git diff --name-only origin/main...28e9437f`, 51 files]
  - Schema/config: `lib/dataverse/schema/wave28-meeting-tracker/*`,
    `scripts/preflight-meeting-tracker-schema.mjs`,
    `shared/config/meetingTracker.js`, `shared/config/appRegistry.js`, plus the
    required entity-set registrations in `lib/dataverse/core/entity-registry.js`
    and `lib/services/dynamics/constants.js` and the canonical `neRaw` helper in
    `lib/dataverse/core/odata.js`.
  - Persistence/services: `lib/dataverse/adapters/deliberation-session.js`,
    `lib/dataverse/adapters/deliberation-slot.js`, and all five files under
    `lib/services/meeting-tracker/`.
  - Routes/security: seven files under `pages/api/meeting-tracker/` and their
    seven rows in `docs/API_ROUTE_SECURITY_MATRIX.md`.
  - UI: `pages/meeting-tracker/index.js`,
    `pages/meeting-tracker/sessions/[id].js`, all three files under
    `shared/components/meeting-tracker/`, and the readiness-aware tile in
    `pages/index.js`.
  - Tests: the ten `tests/unit/meeting-tracker-*.test.js` files named below.
  - Durable docs: the session, slot, and Site Visit Atlas pages; the main
    application-state Atlas; credentials runbook; product plan; this brief;
    generated canonical counts; current strategy count; and dated annotations
    on three historical count statements.
- **Verification run and results.** Every result in this list was run in this
  Codex session.
  - [VERIFIED via `node scripts/preflight-meeting-tracker-schema.mjs --self-test`]
    PASS: Wave 28 specs and metadata classifiers are valid. Node also emitted
    the existing module-type warning for `target-registry.js`.
  - [VERIFIED via `npx jest --runInBand --silent` with the following ten paths]
    PASS: 10/10 suites, 40/40 tests, 0 snapshots:
    `meeting-tracker-adapters.test.js`, `meeting-tracker-attendees.test.js`,
    `meeting-tracker-config.test.js`, `meeting-tracker-dashboard-service.test.js`,
    `meeting-tracker-pages.test.js`, `meeting-tracker-read-routes.test.js`,
    `meeting-tracker-schedule-reader.test.js`,
    `meeting-tracker-session-routes.test.js`,
    `meeting-tracker-session-service.test.js`, and
    `meeting-tracker-slot-service.test.js`, all under `tests/unit/`.
  - [VERIFIED via `npx jest --runInBand`] PASS: 838/838 suites, 12,195/12,195
    tests, 0 snapshots. The first sandboxed attempt failed only because
    `selftest-fixture.test.js` could not create its fixture directory; the
    required host rerun passed with those totals.
  - [VERIFIED via `npm run lint -- --quiet`] PASS with 0 errors emitted.
    [VERIFIED via `npm run check:types`] PASS.
  - [VERIFIED via sequential gate/self-test commands] PASS:
    `check:api-routes` (197 route files) + self-test;
    `check:atlas` (42 Postgres tables, 36 Dataverse entity sets) + self-test
    (12/12 patterns); `check:trust-boundary-guid` (197 routes, two client-ID
    selector routes both guarded, zero ignores) + self-test (28 cases);
    `check:dataverse-access-layer` + self-test; `check:route-service-boundary`
    + self-test; `check:route-lifecycle-auth` (four namespace entries) +
    self-test; `check:odata-escape` (884 files, zero hand-rolled escapes) +
    self-test; `check:status-enum-parity` (eight invariants) + self-test
    (17/17); `check:doc-symbol-refs` (1,630 references resolved) + self-test;
    and `check:secret-scan` (3,446 tracked text files, no real secret-shaped
    values) + self-test.
  - [VERIFIED via direct commands] PASS: `check:docs-catalog` (297 top-level
    docs), `check:build-claim-freshness` + self-test,
    `check:fact-consistency`, `check:doc-currency` + self-test (13/13), and
    `git diff --check`.
  - [VERIFIED via `npm run build` host rerun] PASS: Next production build
    compiled in 3.1 seconds and generated 28/28 static pages. It emitted one
    Turbopack whole-project-tracing warning and Node localStorage experimental
    warnings. The first sandboxed attempt was blocked when prebuild could not
    rewrite the unchanged migration manifest.
  - [VERIFIED via `npm run check:fact-consistency:self-test`] **FAIL**: its
    “known miss: web-based tools” fixture uses 13 as the intentionally stale app
    count, but 13 is now the live count. The live `check:fact-consistency` gate
    passes; the fixture needs a non-live sentinel in a separate code/test commit.
  - [VERIFIED via the command inventory above] No check required by this brief
    was skipped. [VERIFIED via session action log] No production preflight,
    schema apply, environment change, authenticated Preview/Production smoke,
    or Claude Opus review was run. `check:docs-catalog` has no self-test script.
- **Slice 1 apply/readback handoff.** [VERIFIED via owner-provided command output
  on 2026-09-10] The target is **sandbox** and the owner-run post-apply readback
  is already 22 exact / 0 absent / 0 divergent, so no further sandbox apply is
  required. The read-only command is
  `node scripts/preflight-meeting-tracker-schema.mjs --target=sandbox`; the
  required post-apply result is **22 exact / 0 absent / 0 divergent**.
  [VERIFIED via session action log] Codex ran no apply and set no
  `*_SCHEMA_READY` value. [ASSUMED] Production remains unapplied because no
  production metadata probe was run in this session.
- **Open questions and recommendations.** [VERIFIED via
  `docs/PC_MEETING_TRACKER_PLAN.md:223-235`] Promotion still requires the Tier 2
  owner decision, production Wave 28 apply/readback, security-role verification,
  and the readiness flip. [ASSUMED] The application/impersonated staff role has
  the needed Read/Create/Write/Append/Append To privileges; verify it against
  both new entities and lookup targets before enabling the flag. [VERIFIED via
  `npm run check:fact-consistency:self-test`] Repair that fixture collision
  before treating the entire repository self-test battery as green. [VERIFIED
  via `docs/CURRENT_WORK_QUEUE.md:45`] Reconcile its stale “slices 1–3 not built”
  row when these branches are promoted. [VERIFIED via the attempted review
  command] Claude Opus has not reviewed this branch; automatic approval review
  blocked the run because explicit authorization after the credit-use notice
  was not received.

### State for the next session

- **Slice 0.** [VERIFIED via `docs/PC_MEETING_TRACKER_PLAN.md:222`] Built on the
  separate `claude/site-visit-schedulable-gate` branch; it is not part of this
  branch's diff.
- **Slice 1.** [VERIFIED via the two Wave 28 JSON specs and owner-provided
  sandbox readback] Built on this branch: two organization-owned entities,
  required session/request/Updated By lookups, optional lead-PD lookup, no
  alternate keys, read-only preflight, and literal-on readiness contract.
  [VERIFIED via owner-provided output] Sandbox is 22 exact / 0 absent / 0
  divergent. [ASSUMED] Production is unapplied/unverified.
- **Slice 2.** [VERIFIED via `git diff --name-only origin/main...28e9437f` and
  the focused 40-test run] Source-built on this branch: registry/grant surface,
  advancing-request dashboard with current share and active Site Visit joins,
  session editor, staff-plus-Board attendee references, HTTPS meeting links,
  ETag-fenced slot add/edit/move/delete, complete atomic reorder, capacity
  warnings, seven routes, and the fixed schedule reader. [VERIFIED via
  `shared/config/meetingTracker.js:8-11`, `pages/api/meeting-tracker/sessions/index.js:21-38`,
  and `pages/index.js:10-20`] Runtime fails closed and the tile remains disabled
  unless the readiness value is literal `on`.
- **Slice 2b.** [VERIFIED via `docs/PC_MEETING_TRACKER_PLAN.md:225` and absence
  from `git diff --name-only origin/main...28e9437f`] Not built: no Site Visit
  editor and no briefing-room link. Slots render “Briefing not yet available”
  at `shared/components/meeting-tracker/SessionEditor.js:83-87`.
- **Slice 3.** [VERIFIED via `docs/PC_MEETING_TRACKER_PLAN.md:226`] Built on the
  separate `claude/deliberations-stage-rail` branch, but this branch has not
  integrated its deliberation-session seam.
- **Slice 4.** [VERIFIED via `docs/PC_MEETING_TRACKER_PLAN.md:227`] Retired by
  the owner; no work remains under that slice number.
- **Reader contract.** [VERIFIED via
  `lib/services/meeting-tracker/schedule-reader.js:37-109`] The exact source
  export is
  `export async function getDeliberationScheduleByRequests(requestIds, dependencies = DEFAULT_DEPENDENCIES)`.
  The second optional argument is test injection; a production caller uses
  `getDeliberationScheduleByRequests(requestIds)` and receives
  `Promise<Map<inputRequestId, { sessionId, scheduledStartIso, scheduledEndIso, ianaTimeZone, meetingLink, location, order, minutes, attendees: [{ name, email }] } | null>>`.
  [VERIFIED via `schedule-reader.js:25-27,42-47,87-108` and
  `tests/unit/meeting-tracker-schedule-reader.test.js`] This matches §5.4 for
  one-argument callers: every input key is present, cancelled sessions are
  excluded, the latest session wins, reads batch at 25, and readiness/adapter/
  attendee failures return the complete all-null map rather than throwing.
- **Readiness flag.** [VERIFIED via
  `shared/config/meetingTracker.js:8-11`] The exact name is
  `MEETING_TRACKER_SCHEMA_READY`; only literal `on` enables runtime access.
- **Departures from the brief.** [VERIFIED via source] The reader exposes the
  optional dependency-injection argument described above, while preserving the
  required one-argument contract. [VERIFIED via `lib/utils/tracked-secrets.js:1-31`
  and `shared/config/meetingTracker.js:8-11`] The brief allowed a
  `tracked-secrets.js` edit, but none was made because that registry governs
  secret rotation and this readiness value is explicitly non-sensitive; the
  flag instead lives in shared config and `docs/CREDENTIALS_RUNBOOK.md`.
  [VERIFIED via `SessionEditor.js:73-80`] Reorder uses accessible up/down
  controls rather than drag, which the brief expressly allowed.
- **Files outside the stated owned surface.** [VERIFIED via
  `git diff --name-only origin/main...28e9437f`] Runtime necessities were
  `lib/dataverse/core/entity-registry.js`, `lib/dataverse/core/odata.js`,
  `lib/services/dynamics/constants.js`, and `pages/index.js`. Gate-driven
  durable reconciliation also changed `docs/APPLICATION_STATE_ATLAS.md`,
  `docs/CANONICAL_COUNTS.md`, `docs/SECURITY_ARCHITECTURE.md`,
  `docs/STRATEGY.md`, `docs/audits/memory-triage-2026-07-08.md`, and
  `.claude-memory/project-vercel-cli-deploy-preview-auth.md`. [VERIFIED via
  session action log] No file in the main checkout was edited; all changes are
  confined to this worktree/branch.
- **Main-branch seam.** [VERIFIED via
  `git show origin/main:lib/services/deliberation-briefing/session-reader.js`]
  `lib/services/deliberation-briefing/session-reader.js:4-12` on `origin/main`
  is the all-null placeholder that says to wire this reader after it lands.
  [VERIFIED via file absence plus repository `rg`] That file is absent from this
  older branch base, and the real reader is currently consumed only by the
  Meeting Tracker dashboard and its tests. It was **not wired** here because it
  belonged to Claude's concurrent Slice 3 surface; the next integration owner
  must replace the null seam with the real reader while preserving fail-open
  behavior.
