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

State claims labeled [VERIFIED via …] or [ASSUMED]. List commits, tests run with counts,
gates run, and anything left open.
