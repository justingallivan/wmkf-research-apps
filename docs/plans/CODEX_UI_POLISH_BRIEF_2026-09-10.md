---
title: "Codex brief — UI polish pass (parallel to Claude's applicant-materials and tracker work)"
status: active
owner: Justin Gallivan (tasks); Codex (implementer); Claude Fable (integration)
created: 2026-09-10
---

# Codex brief — UI polish pass, 2026-09-10

## Where you are

You are in `../WMKF_Apps-codex` on branch `codex/ui-polish-2026-09-10`, cut from
`origin/main` at the commit shown by `git log --oneline -1`. Run `/start`. **Stay on this
branch and in this directory.** Another agent (Claude) is working in the main checkout on
other surfaces; do not check out other branches, do not touch `../WMKF_Apps`, and do not
merge or push to `main`.

## Tasks

The owner will paste the UI issues here or in the chat. For each one, before editing,
confirm the file is not in the "surfaces reserved for Claude" list below. If it is, stop
and say so instead of editing.

1. Change the deliberation briefing schedule label from “Site visit” to “Research Presentation.”
2. Polish the deliberation briefing content: use the Research Presentation naming throughout,
   show the lead PI and lead PD, expose only the DOCX staff brief under a friendly label, expose
   only PDF review files in a new tab, and rename “Deliberation session” to “Pre-discussion.”
3. _(owner fills in)_

## Surfaces reserved for Claude today — do not edit

Claude has open or in-flight branches on these files. Editing them here guarantees a merge
conflict.

- `shared/components/meeting-tracker/SessionEditor.js`, `SessionAgendaPanel.js`
- `lib/services/meeting-tracker/agenda-service.js`
- `shared/config/editableTextDefaults.js`, `shared/components/admin/EmailDefaultsSection.js`,
  the "Workflow email defaults" panel in `pages/admin.js`
- `lib/seed/email-defaults/*`, `scripts/seed-email-defaults.mjs`
- `lib/services/site-visit-materials/*`, `lib/external/site-visit-materials-email.js`
- `pages/external/materials/[token].js`, `pages/api/external/materials/**`
- `lib/services/alert-recipients.js`
- `docs/PC_MEETING_TRACKER_PLAN.md`, `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`,
  `docs/plans/*BUILD_BRIEF_2026-09-10.md`
- Migrations, `scripts/setup-database.js`, anything under `lib/db/`

If a task requires one of these, report it and wait; do not work around it.

## Guardrails

- Read `CLAUDE.md` first. Universal rules apply: probe before planning, simplest solution,
  do not touch unrelated code, ask rather than assume.
- Do not modify shared primitives (`shared/components/Layout.js`, `Button`, `Card`) unless
  the task is explicitly about them; build standalone changes.
- Derive every field, identifier, route path, and setting key from the real source (the
  matching `pages/api/**` route, the service, or `docs/APPLICATION_STATE_ATLAS.md`). Never
  fabricate identifiers or literals; this repo hard-fails on fabricated values.
- Prefer no new API route. If one is unavoidable, register it in
  `docs/API_ROUTE_SECURITY_MATRIX.md` and run `npm run check:api-routes` and its self-test
  sequentially.
- UI gates must mirror server guards: do not show an action the server would refuse.
- User-facing copy: plain, specific, no exclamation marks, no "Oops"; say what happened and
  what to do next.
- For each task, run the unit tests that cover the files you changed, then
  `npm run check:types`, then `npx eslint <changed files>`. Run any gate whose surface you
  touched (see `docs/CI_GATES_REFERENCE.md`), each gate and its self-test sequentially.
- Commit per task with a descriptive message. Push the branch itself
  (`git push -u origin codex/ui-polish-2026-09-10`); pushing a feature branch is safe and
  does not deploy. Never push to `main`.
- Do not run any seed, migration, or script against production credentials. Do not set or
  change environment variables.

## Handoff (fill in at the end)

For each task: files changed, what changed, tests run with counts, gates run, and
anything left open. Label state claims `[VERIFIED via …]` or `[ASSUMED]`.

### Task 1 — Research Presentation label

- **Files changed:** `pages/external/briefing/[token].js`,
  `tests/unit/external-briefing-page.test.js`.
- **What changed:** [VERIFIED via source and regression test] The schedule label now reads
  “Research Presentation” instead of “Site visit”; the scheduled date and empty-state
  behavior are unchanged.
- **Tests:** [VERIFIED via Jest] `tests/unit/external-briefing-page.test.js` — 10 passed,
  1 suite passed.
- **Gates:** [VERIFIED via commands] `npm run check:types`, `check:doc-currency` plus its
  self-test, `check:fact-consistency` plus its self-test, and `check:docs-catalog` passed;
  ESLint passed for both changed JavaScript files.
- **Open:** None.

### Task 2 — Deliberation briefing content polish

- **Files changed:** `lib/services/deliberation-briefing/briefing-page-service.js`,
  `pages/api/external/briefing/[token]/document.js`, `pages/external/briefing/[token].js`,
  `tests/unit/deliberation-briefing-page-service.test.js`,
  `tests/unit/external-briefing-page.test.js`, and
  `tests/unit/external-briefing-routes.test.js`.
- **What changed:** [VERIFIED via source and regression tests] The page now shows lead PI and
  lead PD beneath the applicant; labels the schedule “Pre-discussion” and “Research
  Presentation”; labels the materials section “Research presentation materials”; labels the
  former Writeup section “Staff brief and notes”; exposes only its pinned DOCX under the link
  text `Staff Brief {Request#}.docx`; and exposes only PDF review files, inline in a new tab.
  The retired staff-brief PDF member returns 404 before a file read. DOCX review files retain
  their structured answers but have no file link; a PDF-named review must also carry a PDF byte
  signature.
- **Commit:** `b8fa01ac` — `Polish deliberation briefing content`.
- **Tests:** [VERIFIED via Jest] Three focused suites — 31 passed, 3 suites passed.
- **Gates:** [VERIFIED via commands] `npm run check:types`; ESLint across all six implementation
  and test files; `check:api-routes` plus its self-test; and `check:route-service-boundary` plus
  its self-test passed. The API-route gate retained three pre-existing external-materials guard
  warnings and covered 208 routes.
- **Open:** [VERIFIED via owner browser report] Visual review is incomplete. The localhost
  attempt ended at “This link is malformed,” so it did not verify the rendered changes. Claude
  must review this branch in a working preview with a valid briefing link, or review it in
  production after deliberate integration and deployment.
