---
title: Session agenda email — Codex Brief (2026-09-10)
domain: workbench
kind: plan
status: active
summary: "Codex build brief: one agenda email per deliberation session, sent by the PC from the Meeting Tracker session page, with per-proposal times and briefing links."
cataloged: 2026-09-10
last_verified: 2026-09-10
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
  - lib/services/pre-site-visit/distribution-service.js
  - lib/services/pre-site-visit/distribution-store.js
  - lib/services/meeting-tracker/session-service.js
  - lib/db/migrations/034_pre_site_distribution_attempts.sql
---

# Session agenda email — Codex Brief (2026-09-10)

## Where you are

You are in `/Users/gallivan/Code/WMKF_Apps-codex` on branch `codex/session-agenda`, cut from
`origin/main` at `6fabefd1` or later. Run `/start` there. Claude works in the main checkout at
the same time; **stay on this branch and directory**, do not check out other branches, touch
the main checkout, merge, deploy, apply any migration, or edit `SESSION_PROMPT.md`. Push after
each meaningful commit (`git push -u origin codex/session-agenda`); pushing a feature branch
does not deploy. Record your handoff at the bottom of this brief.

Use `--model gpt-5.6-luna` if you are asked to choose a model.

## Why (owner, 2026-09-10)

Read `docs/PC_MEETING_TRACKER_PLAN.md` §9 item 5 (D21–D25) first; those decisions are settled
and not yours to reopen. Board members often join a deliberation session for part of it and
need to know when their proposals come up. Today each shared writeup sends a per-proposal
email (the deliberation email, built in `lib/services/pre-site-visit/distribution-service.js`)
that states the session but not the order or times. The PC needs one agenda email per session.

## Goal

From the Meeting Tracker session page (`shared/components/meeting-tracker/SessionEditor.js`),
the PC sends **one agenda email** to the session's attendees:

- Subject default: `Deliberation session agenda — <weekday, month day>` in the session's zone.
- Body: the session date and time in its zone with the zone name, the Zoom "Join meeting"
  link when the session has one (https only), the location when set, then the proposals in
  slot order, each line carrying a computed start–end window, `#<requestnum>`, the title, the
  lead PD's name, and an "Open briefing" link when the request's briefing link is live, else
  the text "briefing link to follow by email".
- Times: slot N starts at session start plus the sum of `wmkf_minutes` of slots 1..N-1 and
  ends after its own minutes; format like the session line in the deliberation email
  (`sessionLineText` in `distribution-service.js`, `Intl.DateTimeFormat('en-US', …)` with the
  session's `ianaTimeZone`). If the sum exceeds the session length, still compute; do not fail.
- The session page shows the last agenda: "Agenda sent <when> to <n> recipients", and when
  the session start, the slot order, or any slot's minutes differ from the snapshot the last
  agenda was computed from, "Schedule changed since the last agenda." A "Send agenda…" action
  opens a composer; after a send it reads "Send agenda again…".

## Current state you are building on (all [VERIFIED 2026-09-10 via source])

- **Session read:** `getDeliberationSession({ sessionId })` in
  `lib/services/meeting-tracker/session-service.js` returns `{ session, slots }`; `session` has
  `sessionId, etag, scheduledStartIso, scheduledEndIso, ianaTimeZone, location, meetingLink,
  attendees: [{ name, email }], attendeeRefs, attendeeIssues`; each slot row carries
  `wmkf_deliberationslotid, wmkf_order, wmkf_minutes, _wmkf_request_value, _wmkf_leadpd_value`,
  the expands `wmkf_Request { akoya_requestnum, akoya_title }` and `wmkf_LeadPd { fullname }`
  (`DELIBERATION_SLOT_DETAIL_EXPAND` in `lib/dataverse/adapters/deliberation-slot.js`), and
  since S503 `briefing: { url, expiresAt } | null` (one `getLiveBriefingLink` read per request).
- **Email transport:** `DynamicsService.createEmailActivity({ subject, body, from, to, cc,
  correlationKey, actingUserSystemId, noFallback })` then `DynamicsService.sendEmail(emailId,
  { actingUserSystemId })`; `regardingId`/`regardingType` are optional
  (`lib/services/dynamics/email.js:119` binds them only when both are present). The
  correlation key lands on the activity `subcategory` and `findByCorrelation(correlationKey)`
  in `lib/dataverse/adapters/email-activity.js` recovers it. The deliberation email's send
  sequence (claim lease → create activity → record activity id → final rechecks → record send
  intent → renew lease → SendEmail → record sent, with `SEND_ACCEPTED_STATUS_CODES` 3/6/7 and a
  retry that reconciles Dynamics status first) is in `sendPreSiteDistribution`
  (`distribution-service.js`) with its store in `distribution-store.js`. Mirror that shape; do
  not import or call the distribution service.
- **Recipient normalization:** `normalizeDistributionRecipients(toInput, ccInput)` is exported
  from `distribution-service.js` (syntax check, lowercase, de-dup, To/Cc conflict). You may
  import that one function.
- **Actor:** every tracker route derives the Dynamics actor from the session
  (`actorRefFromSession(access.session)` in `pages/api/meeting-tracker/sessions/[id].js`) and
  ignores any body identity. The sender's address comes from the session user's email the way
  the distribution routes derive `fromEmail` (read `pages/api/workbench/pre-site-visit/distribution/send.js`).
- **Route conventions:** `pages/api/meeting-tracker/*` routes check `requireAppAccess(req, res,
  'meeting-tracker')`, then `isMeetingTrackerSchemaReady()` (503 only to authenticated
  grantees), exact body allowlists, `withDalContext(label, …)`. Every new route needs a row in
  `docs/API_ROUTE_SECURITY_MATRIX.md` (`npm run check:api-routes`) and the canonical route count
  refresh (`npm run check:fact-consistency -- --write`, then commit `docs/CANONICAL_COUNTS.md`).
- **Migrations:** `lib/db/migrations/NNN_*.sql` plus the mirrored fresh-install shape in
  `scripts/setup-database.js`; `node scripts/build-migrations-manifest.js` regenerates the
  manifest; `tests/unit/pre-site-distribution-schema-parity.test.js` shows how a migration and
  the fresh-install text are pinned together. The latest is `040_pre_site_distribution_session_snapshot.sql`; yours is 041.
- **Atlas:** Postgres tables are documented in `docs/atlas/postgres-infra-tables.md`
  (`npm run check:atlas`).
- **Composer UI precedent:** `PreSiteDistributionPanel.js` (To/Cc textareas, "Add from
  directory" via `CuratedRecipientPicker`, subject, message, fixed preview, confirmation
  checkbox, send, receipt). Build a standalone agenda composer for the session page; do not
  reuse `PreSiteDistributionPanel` (it is request-scoped) and do not modify it.

## Owned file surface

You own these and nothing else:

- `lib/db/migrations/041_deliberation_agenda_sends.sql`, the mirrored block in
  `scripts/setup-database.js`, `lib/db/migrations-manifest.json` (regenerated).
- `lib/services/meeting-tracker/agenda-service.js` (new), `lib/services/meeting-tracker/agenda-store.js` (new).
- `pages/api/meeting-tracker/sessions/[id]/agenda.js` (new: GET last agenda + drift flag; POST
  prepare; PATCH or a sibling route for send — your call, documented in the matrix).
- `shared/components/meeting-tracker/SessionAgendaPanel.js` (new) and the minimal mount point in
  `SessionEditor.js` (one import and one JSX element below the proposal order; nothing else in
  that file changes).
- Tests: `tests/unit/meeting-tracker-agenda-*.test.js` (new) plus one added case in
  `tests/unit/pre-site-distribution-schema-parity.test.js` or a new parity test for 041.
- Docs: `docs/API_ROUTE_SECURITY_MATRIX.md` (new rows), `docs/CANONICAL_COUNTS.md`
  (regenerated), `docs/atlas/postgres-infra-tables.md` (one paragraph for the new table),
  `docs/PC_MEETING_TRACKER_PLAN.md` (mark D21–D25 built in §9 item 5 with file paths), and this
  brief's Handoff section.

Do not touch `distribution-service.js`, `distribution-store.js`, `SessionEditor.js` beyond the
mount point, `Layout.js`, `appRegistry.js`, `MeetingTrackerList.js`, the schedule reader, the
briefing services, or any migration below 041.

## Contracts that must hold

- **Ledger row = the exact email.** `deliberation_agenda_sends`: `operation_id UUID PK`,
  `session_id UUID NOT NULL`, `agenda_snapshot JSONB NOT NULL` (session start/end/zone/link/
  location plus the ordered slot list with request id, number, title, lead PD name, minutes,
  computed start/end ISO, briefing url or null), `to_recipients JSONB NOT NULL`, `cc_recipients
  JSONB NOT NULL DEFAULT '[]'`, `subject TEXT NOT NULL`, `body_text TEXT NOT NULL`, `body_html
  TEXT NOT NULL`, `from_email TEXT NOT NULL`, `acting_user_system_id UUID`, `state TEXT NOT NULL`
  in `prepared | activity_created | send_requested | sent | failed`, `dynamics_email_id UUID`,
  `dynamics_statecode INTEGER`, `dynamics_statuscode INTEGER`, `send_requested_at`, `sent_at`,
  `attempt_count INTEGER NOT NULL DEFAULT 0`, `lease_token UUID`, `locked_until TIMESTAMPTZ`,
  `last_error_code TEXT`, `last_error_message TEXT`, `last_failed_at`, `created_at`,
  `updated_at`; CHECK constraints named `deliberation_agenda_state_check`,
  `deliberation_agenda_recipient_shape` (To is a non-empty array, Cc an array), and
  `deliberation_agenda_lease_shape` (lease token and lock set together or not at all). Index on
  `(session_id, created_at DESC)` plus unique partial index
  `uq_deliberation_agenda_one_unresolved` on `session_id` where state is
  `send_requested`.
- **Prepare then send, with a fixed preview.** POST prepare computes the snapshot from the live
  session and slots, normalizes recipients, renders body text and HTML, inserts the row
  (`ON CONFLICT (operation_id) DO NOTHING`, then read back; a different session or subject under
  the same operation id is a 409; JSONB object-key order does not affect exactness), refuses a
  different operation while a durable send is unresolved, and returns the projection. Send takes `{ sessionId,
  operationId }`, claims the lease, creates the activity with correlation key
  `wmkf-deliberation-agenda:<operation_id>` (recover an existing activity by that key before
  creating another), records the activity id, records send intent, renews the lease, calls
  SendEmail, reads the status, records sent when the status is in 3/6/7. A retry on a row with
  a durable activity id reconciles the Dynamics status first and never creates a second
  activity. Accepted status closes the receipt; confirmed Draft resumes SendEmail on the same
  activity for the same sender; known closed status 2/4/5/8 records terminal `failed` and
  permits a new preview; unknown or unreadable status remains unresolved and never sends.
  Failures record `last_error_*` and release the lease. Prepare and send both refuse a sibling
  operation while one send is unresolved; the partial unique index closes the concurrent race.
- **Body HTML escapes every value** (`escapeHtml` pattern in `distribution-service.js`) and
  carries only https links (the Zoom link and briefing URLs are already https-validated
  upstream; re-check with `new URL(...).protocol === 'https:'` and drop anything else).
- **Briefing URLs in the body are the unsealed live links** exactly as the deliberation email
  carries one; do not persist them anywhere except the ledger's `body_html`/snapshot (owner D18
  in the briefing plan accepts that the token appears in transport artifacts).
- **Drift note and pending recovery (D22):** GET returns the latest sent row for the receipt and
  separately the latest unresolved `send_requested` row. Failed rows remain audit history but
  do not mask the sent receipt or block a new preview. `scheduleChanged: boolean` compares
  the current session start as an instant plus the current ordered `(requestId, minutes)` list
  against the sent snapshot. The panel pins an unresolved operation for exact retry rather than
  allowing a new preview.
- **Never read identity from the body.** Session id from the path, actor from the session, from
  address from the session user.
- **Fail closed** on: flag off (503 after auth), session not found (404), no slots (409 with a
  clear message), empty To (400), lease held (409 `agenda_send_in_progress`), stale operation
  (409).

## User-facing shape

On the session page, below "Proposal order": a card "Agenda email". Before any send: one
sentence ("Send the agenda to the session's attendees so Board members know when their
proposals come up.") and a dark "Send agenda…" button. After a send: "Agenda sent <date, time>
to <n> recipients." plus the drift note when applicable, and an outlined "Send agenda again…".
The composer (a dialog, same visual language as the Share dialog in
`PreSiteDistributionPanel.js`): To and Cc textareas pre-filled from the session's attendees,
"Add from directory" using the tracker's `/api/meeting-tracker/recipients` payload (staff and
board names with emails), Subject, Message (default: "Here is the agenda for our deliberation
session. Each proposal's briefing page opens without a login."), a read-only agenda preview
(the ordered lines with times), Create preview → fixed preview with a confirmation checkbox →
Send → receipt "Sent — Dynamics accepted this exact email for transport. This receipt does not
assert inbox delivery." Close at both top and bottom. Voice: plain, short sentences, no
exclamation marks, name the actor; see `.claude-memory/feedback-user-facing-error-copy-voice.md`.

## Decisions that are the owner's, not yours

Anything not in D21–D25: per-recipient agendas, calendar invitations, automatic resends on
reorder, attachments, a Board-facing agenda page. Leave a note in the handoff if one seems
needed; do not build it.

## Method

1. Read the plan §9 item 5, `session-service.js`, `distribution-service.js` from
   `sendPreSiteDistribution` to the end, `distribution-store.js`, migration 034, and
   `pages/api/workbench/pre-site-visit/distribution/{prepare,send}.js` before writing code.
2. Migration and store first, with tests that pin the SQL text against the fresh-install text.
3. Service: pure `computeAgenda(session, slots, now)` (times, lines) as an exported function
   with its own tests; then prepare/send with an injected dependency object like every service
   here (`DEFAULT_DEPENDENCIES` + `dependencies` parameter).
4. Route(s), matrix rows, canonical counts.
5. Panel and mount point, with jsdom tests that pin the prepare payload, the confirmation gate,
   the stale-preview notice, and the receipt.
6. Run the gates for the surfaces you changed, sequentially, each with its self-test:
   `check:migrations-manifest`, `check:types`, `check:api-routes`, `check:atlas`,
   `check:fact-consistency`, `check:route-service-boundary`, `check:dataverse-access-layer`,
   `check:trust-boundary-guid`, `check:doc-currency`, `check:doc-symbol-refs`,
   `check:docs-catalog`. Fix reds; do not skip.
7. Commit in PR-sized steps with descriptive messages; push the branch.

## Verify before acting

- Never set `DATAVERSE_ALLOW_PROD_READS`, `DATAVERSE_PROD_WRITE_ACK`, or any `*_SCHEMA_READY`.
  Do not apply migration 041 anywhere; the owner applies it to the shared Neon database before
  merge.
- Do not run `vercel`, do not merge, do not push to `main`.
- Every field and identifier comes from source you read, never from memory; this repo fails on
  fabricated literals.

## Tests

Unit tests under `tests/unit/`, jsdom for components (`/** @jest-environment jsdom */`), node
for services and routes. Minimum: `computeAgenda` (order, cumulative times, zone formatting,
over-length sessions, missing lead PD, missing briefing → "to follow" text, https-only links);
prepare (snapshot content, recipient normalization, empty To refused, no slots refused,
operation conflict, unresolved sibling refused); send (happy path call order, recovery by
correlation key, lease held, sibling operation refused, unknown status stays `send_requested`,
known closed status becomes `failed`, Draft retry reconciles); routes (id validated before auth,
allowlists, 503 after auth, actor from session, separate sent/pending GET projection); panel
(defaults, prepare payload, confirmation gate, receipt, pending recovery, stale reset, drift note).

## Handoff (fill in at the end)

### Codex handoff — 2026-09-10

- **[VERIFIED via source commit `2c08222c`, three Claude Opus adversarial passes,
  remediation commits `81f417c9`, `ee25264b`, and `3f0f6f8e`, and 43 focused
  tests]** The complete
  source feature is built: migration/fresh-install schema, exact-email ledger,
  session agenda calculation and HTML/text rendering, drift read, lease-fenced
  Dynamics create/recovery/send, guarded GET/prepare/send route, fixed-preview
  composer, directory recipient picker, receipt, and the minimal session-editor
  mount.
- **[VERIFIED via commit `35f2cef8` and documentation gates]** The API security
  matrix, canonical counts, Postgres Atlas, and Meeting Tracker plan describe the
  built source and its runtime boundary. Canonical counts are 125 guarded API
  endpoints and 203 API route files.
- **[VERIFIED via local execution]** The 17 Meeting Tracker/parity suites passed
  after final remediation (106 tests); every gate named in this brief passed after
  remediation, with each available self-test run sequentially. Type checking,
  status-enum parity, secret scan, targeted lint, and the production build also
  passed. The build retains the pre-existing Turbopack dynamic-filesystem-access
  warning for `pre-site-visit/docx-renderer.js`; the existing
  `MeetingTrackerList` missing-key React warning still appears in its
  pre-existing page test. Both are outside this brief's owned files.
- **[VERIFIED via the final Claude Opus acceptance pass]** Verdict `PASS`: no
  P0/P1/P2 defects. Its five non-blocking P3 observations were closed in
  `3f0f6f8e` and this handoff: normal stale sends retain PC edits, sent receipts
  hide editable fields, failed rows cannot be claimed, the fresh-install index
  summary is exact, and the constraint readback uses `pg_constraint`.
- **[VERIFIED by this Codex session]** No migration was applied, no readiness or
  production-acknowledgement environment variable was set, and no deployment or
  merge was performed. **[ASSUMED externally]** Migration 041 remains unapplied
  until the owner performs the controlled apply/readback below.
- **[VERIFIED via `gh repo view`]** `origin` is the public repository
  `justingallivan/wmkf-research-apps`. The branch has not been pushed because
  publishing the new source/history to a public remote requires the owner's
  explicit approval after that risk is stated.

Open questions: none within D21–D25. An unresolved durable `send_requested`
row remains visible and blocks a competing operation. A retry closes an accepted
receipt, resumes SendEmail only when Dynamics confirms the same activity is
still Draft and the same sender acts, records a known closed status as `failed`,
and does not send when status is unknown or unreadable.

After reviewing the branch, the owner should apply through the existing-database
runner and read back the tracker row, all 24 columns, four constraints (primary
key plus the three named checks), and three indexes (primary key, session
history, and one-unresolved partial unique index):

```bash
node scripts/apply-migrations.js
psql "${POSTGRES_URL:-$DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT name, applied_at, applied_by
FROM schema_migrations
WHERE name = '041_deliberation_agenda_sends.sql';

SELECT ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'deliberation_agenda_sends'
ORDER BY ordinal_position;

SELECT conname AS constraint_name, contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'public.deliberation_agenda_sends'::regclass
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'deliberation_agenda_sends'
ORDER BY indexname;
SQL
```

Expected exact names: constraints `deliberation_agenda_sends_pkey`,
`deliberation_agenda_state_check`, `deliberation_agenda_recipient_shape`, and
`deliberation_agenda_lease_shape`; indexes `deliberation_agenda_sends_pkey` and
`idx_deliberation_agenda_session_history`, and
`uq_deliberation_agenda_one_unresolved`.
