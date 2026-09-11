---
title: "Build A — Admin-editable defaults for the deliberation agenda email"
status: active
owner: Claude Fable (orchestrating); Sonnet builder; Opus reviewer
created: 2026-09-10
---

# Build A — Admin-editable defaults for the deliberation agenda email

## Goal

The session agenda email (Meeting Tracker, D21–D25) currently hard-codes its default subject
and message in the client (`SessionAgendaPanel.js`: `DEFAULT_MESSAGE`, `defaultSubject`).
Move both into the existing admin "Workflow email defaults" catalog so a superuser can edit
them, following the same conventions as every other admin-editable email default.

## Conventions that bind this build

- Catalog: `shared/config/editableTextDefaults.js`. One entry per editable string. Mustache
  `{{token}}` placeholders only. No `[bracket]` aliases.
- Seed text is **init data, not a runtime fallback** (see the header of
  `lib/seed/email-defaults/reviewer-templates.js`). A blank or unavailable admin value renders
  blank in the composer; the staff user sees it and types. Do NOT add a code fallback.
- Settings are read with `getSettingStrict` from `lib/services/settings-service.js` and
  reported as `unavailable` on read failure (see `pages/api/admin/email-defaults.js`).
- Service functions take an injected `dependencies` object (see `DEFAULT_DEPENDENCIES` in
  `lib/services/meeting-tracker/agenda-service.js`) so tests never touch Dataverse.

## Scope

1. **Catalog entries** (append after `email.grantee_reminder.body`, before the `stage.*` block):
   - `email.deliberation_agenda.subject` — label "Deliberation agenda subject", single line,
     placeholders `['{{sessionDate}}']`, not required (`requiredPlaceholders` omitted).
   - `email.deliberation_agenda.body` — label "Deliberation agenda message", multiline,
     placeholders `['{{sessionDate}}']`. This is the opening paragraph only; the agenda block
     (session details plus per-proposal lines) is still rendered by the service and is not
     editable.
   Descriptions must say where the text is used (Meeting Tracker session page, "Agenda email"
   card) and that `{{sessionDate}}` renders as e.g. "Friday, September 11" in the session's zone.
2. **Seed**: new `lib/seed/email-defaults/deliberation-agenda.js` exporting
   `DELIBERATION_AGENDA_SEED_SUBJECT = 'Deliberation session agenda — {{sessionDate}}'` and
   `DELIBERATION_AGENDA_SEED_BODY` = the current `DEFAULT_MESSAGE` text verbatim. Register both
   in `EMAIL_DEFAULT_SEED_TEXT` in `scripts/seed-email-defaults.mjs`. Extend
   `tests/unit/seed-email-defaults.test.js` so the two keys are covered.
3. **Service**: `getAgendaStatus` in `agenda-service.js` also returns
   `defaults: { subject, message, unavailable }`.
   - Add `getSettingStrict` to `DEFAULT_DEPENDENCIES`.
   - Read both keys strictly. `found` and non-blank → resolve `{{sessionDate}}` using the same
     `Intl.DateTimeFormat` options `defaultAgendaSubject` uses today (weekday long, month long,
     day numeric, session zone). Not found or blank → `''`. Read threw → `''` and
     `unavailable: true` (log with `console.error`, do not throw; the receipt and drift data
     must still load).
   - Keep `defaultAgendaSubject` exported if anything else imports it (grep first); if it is
     only used by the client, delete it and its test coverage moves to the new resolver.
   - Export a small pure helper `resolveAgendaDefault(template, session)` and unit-test it
     (token present, token absent, missing session time falls back to the raw template).
4. **Route** `pages/api/meeting-tracker/sessions/[id]/agenda.js`: no behavior change expected
   (GET already returns `getAgendaStatus`). Confirm and leave alone.
5. **Client** `shared/components/meeting-tracker/SessionAgendaPanel.js`:
   - Remove `DEFAULT_MESSAGE` and `defaultSubject`. Store `defaults` from GET in state.
   - All three places that reset the form (`openComposer`, and the two stale/terminal reset
     paths near lines 320 and 338) use `defaults.subject` and `defaults.message`.
   - When `defaults.unavailable` is true, or either default is blank, show one line in the
     composer above the fields: "Default subject or message is not configured. Enter them
     below, or set them in Admin → Workflow email defaults." (role="status", amber style used
     elsewhere in the panel). Do not block the composer.
   - Update `tests/unit/meeting-tracker-agenda-panel.test.js`: the GET fixture gains
     `defaults`; the test that asserts the hard-coded message now asserts the fixture value;
     add one test for the unavailable note.
6. **Tests to update or add**: `meeting-tracker-agenda-service.test.js` (status returns
   defaults; read failure → unavailable), the panel test, the seed test.
7. **Docs**:
   - `docs/API_ROUTE_SECURITY_MATRIX.md`: the `/api/admin/email-defaults` row mentions the
     `email.deliberation_agenda.*` keys; the agenda route row's GET description notes it also
     reads the two admin defaults from `wmkf_appsystemsettings` (DV).
   - `docs/PC_MEETING_TRACKER_PLAN.md`: add **D27** under the agenda section: "Agenda subject
     and opening message are admin-editable defaults (`email.deliberation_agenda.*`), seeded
     from the previous hard-coded text; blank renders blank per the email-defaults
     convention." (D26 is `visitExpected()`; check numbering before writing.)
   - If `check:atlas` or `check:fact-consistency` complain about the new keys, fix the page
     they point at. Do not edit `docs/CANONICAL_COUNTS.md` unless a gate names it.

## Owned files

`shared/config/editableTextDefaults.js` (append entries only; no reformatting of existing
entries), `lib/seed/email-defaults/deliberation-agenda.js` (new),
`scripts/seed-email-defaults.mjs` (map entry + import only),
`lib/services/meeting-tracker/agenda-service.js`,
`shared/components/meeting-tracker/SessionAgendaPanel.js`, the four tests named above,
`docs/API_ROUTE_SECURITY_MATRIX.md`, `docs/PC_MEETING_TRACKER_PLAN.md`, and any atlas page a
gate names.

## Forbidden

`shared/components/admin/EmailDefaultsSection.js` and `pages/admin.js` (Build B owns them),
`SessionEditor.js` (Build C), any migration, `agenda-store.js`, the agenda route's auth or
body allowlists, `docs/plans/SESSION_AGENDA_EMAIL_CODEX_BRIEF_2026-09-10.md` (historical).
No new dependencies. No new API routes.

## Verification (run in the worktree, sequentially)

```bash
npx jest tests/unit/meeting-tracker-agenda tests/unit/seed-email-defaults tests/unit/email-defaults-routes tests/unit/meeting-tracker
npm run check:types
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:atlas && npm run check:atlas:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npm run check:secret-scan && npm run check:secret-scan:self-test
```

## Rollout (owner, after merge)

Production Dataverse has no value for the two keys until seeded. Either the owner runs
`node scripts/seed-email-defaults.mjs` (dry run) then `--execute` with production settings
credentials, or pastes the text into the two new Admin fields (PUT upserts). Until then the
composer shows the "not configured" note and blank fields.

## Handoff (builder fills in)

**Branch/worktree:** `claude/agenda-email-defaults`, created from `main` at `af50dd97`
(this repo's `HEAD` at task start, `57bf6d07`, predated the commit that added this brief
file — `[VERIFIED via git log HEAD..main]` showed exactly one commit, `af50dd97`, ahead;
branched from `main` instead of the stale `HEAD` so the brief file existed to read).

**Commits:**
- `620e2ca7` — Admin-editable defaults for the deliberation agenda email (catalog entries,
  seed file + script registration, service `getAgendaStatus`/`resolveAgendaDefault`, client
  `SessionAgendaPanel.js`, all four named tests, both docs).
- `515eb4be` — filled in this Handoff section (first pass).
- `5d466d41` — Opus review fixes (PASS WITH FIXES): panel-test fixture discrimination
  (`DEFAULTS` changed to values unrelated to the deleted hard-coded text so a regression to
  the old constants can no longer pass; terminal-retry test now asserts Subject and Message,
  not just To), service-test body-side `{{sessionDate}}` proof, a `statusLoaded` load gate on
  the "Send agenda…" button (new disabled-before/enabled-after test), `resolveAgendaDefault`
  no longer requiring a valid end time (new missing-end unit case), the two `getSettingStrict`
  reads hoisted into `getAgendaStatus`'s first `Promise.all`, and the API matrix wording for
  the three read outcomes.

**Discrepancies between brief and source:**
- Item 3's claim "`defaultAgendaSubject`... if it is only used by the client" is imprecise:
  `[VERIFIED via grep for defaultAgendaSubject across the repo]` — nothing imported the
  service's `defaultAgendaSubject` at all, including the client (the client had its own
  separate, duplicate synchronous implementation named `defaultSubject`, not an import of
  the service function). Followed the brief's fallback instruction anyway: deleted the
  unused service export; its date-formatting behavior is now covered by
  `resolveAgendaDefault`'s tests. The client's own local `defaultSubject` function was also
  removed (superseded by the `defaults` state from GET).
- **D27 vs D26**: the brief says "D26 is `visitExpected()`; check numbering before writing"
  and asks for **D27**. `[VERIFIED via grep '\*\*D[0-9]' docs/PC_MEETING_TRACKER_PLAN.md]`:
  the bolded decision sequence for this plan is D21–D25 (the session agenda email section);
  there is no bolded `**D26**` decision anywhere in the file. The "D26" the brief's author
  saw is an unrelated grant-cycle label (e.g. "23 advancing D26 requests", a table cell
  referencing `visitExpected()`) that coincidentally strings-matches "D26" — not a decision
  number in this doc's `**Dn**` sequence. Followed the source: added the new decision as
  **D26** (not D27), immediately after D25 in the agenda section.

**Tests run — first pass (before Opus review)** (`npx jest tests/unit/meeting-tracker-agenda
tests/unit/seed-email-defaults tests/unit/email-defaults-routes tests/unit/meeting-tracker`):
19 suites, **125/125 passed**.

**Tests run — after Opus review fixes, same command:** 19 suites, **127/127 passed**
`[VERIFIED via test run output]`. The +2 over the first pass are the new
`statusLoaded` disabled/enabled panel test and the `resolveAgendaDefault` missing-end unit
case. Also includes: 3 agenda-service tests (defaults resolution — now with `{{sessionDate}}`
in both the subject and body fixtures — blank/unset default, strict-read failure →
`unavailable:true`), 4 `resolveAgendaDefault` unit tests (token present, token absent, invalid
start/zone falls back to raw template, valid start with missing end still resolves), 1
seed-email-defaults test (both new keys registered), and 2 panel tests (unavailable note +
blank fields; load-gate disabled/enabled), plus fixture updates across the panel suite:
`DEFAULTS` is now `{subject: 'Admin subject ZZZ', message: 'Admin opening message ZZZ'}`
(unrelated to the deleted hard-coded text, so a regression to the old constants cannot pass),
and the terminal-retry test now asserts Subject and Message, not just To.

**Gates run, all clean (re-run after the Opus review fixes):**
- `npm run check:types` — clean (no tsc errors).
- `npm run check:api-routes` && `:self-test` — 208 route files covered, only the
  pre-existing 3 unrelated `/api/external/materials/[token]/*` warnings; self-test OK.
- `npm run check:atlas` && `:self-test` — 45 Postgres tables / 36 Dataverse entity sets
  covered; self-test 12/12.
- `npm run check:fact-consistency` && `:self-test` — 734 docs scanned, canonical facts
  current; self-test OK.
- `npm run check:status-enum-parity` && `:self-test` — 8 invariants in sync; self-test 17/17.
- `npm run check:secret-scan` && `:self-test` — 3534 files scanned, clean; self-test OK.

**Left open / not run:**
- `npm run check:agent-invariants` fails in this worktree
  (`.agents/skills` and `.claude-memory` report "not a symlink / missing") but
  `[VERIFIED via git stash]` this failure is pre-existing and unrelated to this build: it
  reproduces identically with every change from this branch stashed out, i.e. against the
  same `main`-derived tree this branch started from. Not in the brief's Verification block
  and not caused by this diff; left for the owner/environment to address, not attempted here
  (outside Owned files and outside the stated Verification list).
- Rollout (seeding the two new keys against production Dataverse) is explicitly the owner's
  step per the brief; not run here, no credentials used.
- `check:agent-wiki` was flagged as advisory (non-blocking) by the pre-edit hooks on
  `scripts/seed-email-defaults.mjs` and `docs/API_ROUTE_SECURITY_MATRIX.md` changes; not run,
  since neither edit changes a durable-behavior fact the wiki topic pages state (mechanical
  new-key registration and a matrix-row description of code written in this same session).
