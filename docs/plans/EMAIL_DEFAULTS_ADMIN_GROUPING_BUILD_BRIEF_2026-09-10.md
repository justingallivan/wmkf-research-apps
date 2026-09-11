---
title: "Build B — Group the Workflow email defaults admin panel by audience"
status: active
owner: Claude Fable (orchestrating); Sonnet builder; Opus reviewer
created: 2026-09-10
---

# Build B — Group the Workflow email defaults admin panel by audience

## Goal

Admin → Governance → "Workflow email defaults" renders one flat card per catalog entry
(now 20+ cards: every subject and every body separately). Make it scannable: group by
audience, and pair each email's subject, body, and button label into one card. The catalog
header in `shared/config/editableTextDefaults.js` already describes this as the intended
follow-up. Behavior (per-key save, blank vs unavailable states, placeholder hints, required
placeholder validation) does not change.

**Sequencing:** this build starts after Build A merges, so the catalog already contains
`email.deliberation_agenda.subject` and `email.deliberation_agenda.body`. Rebase on `main`
before starting.

## Scope

1. **Catalog** (`shared/config/editableTextDefaults.js`): add two fields to every entry:
   - `group`: one of `'reviewers' | 'grantees' | 'internal' | 'labels'`.
     - reviewers: every `email.reviewer_*`
     - grantees: `email.grantee_invite.*`, `email.grantee_reminder.*`
     - internal: `email.deliberation_agenda.*`
     - labels: `stage.deliberations.*` (these are display labels, not emails)
   - `emailKey`: the pairing key, i.e. the key with its last segment removed
     (`email.reviewer_invitation`, `stage.deliberations`), and `emailLabel`: the human name
     for the card ("Reviewer invitation", "Grantee invite", "Deliberation agenda",
     "Staff Deliberations stage labels").
   - Export `EDITABLE_TEXT_GROUPS`: ordered array of `{ id, title, description }` in the order
     reviewers, grantees, internal, labels, with titles "Reviewer emails", "Grantee emails",
     "Internal emails", "Staff labels".
   - Add a unit test (`tests/unit/editable-text-defaults-catalog.test.js`) asserting every
     entry has a valid `group`, `emailKey`, `emailLabel`, and that `emailKey` is a prefix of
     `key`.
   - Replace the FUTURE paragraph in the file header with a short description of the shape.
2. **Section** (`shared/components/admin/EmailDefaultsSection.js`):
   - GET response is unchanged (the route spreads the catalog entry, so `group`/`emailKey`/
     `emailLabel` already arrive). Group client-side by `EDITABLE_TEXT_GROUPS` order, then by
     `emailKey` in catalog order.
   - Render: `<h3>` per group with its description, then one card per `emailKey` titled
     `emailLabel`. Inside the card, one field per entry in catalog order with the entry's
     existing `label` as the field label (keep the field labels, admins search by them),
     placeholder hints, blank/unavailable messaging, per-field Save button and status exactly
     as today. Keep the existing per-key PUT; do not batch saves.
   - Empty groups are not rendered.
   - Keep the component free of new dependencies.
3. **Admin page** (`pages/admin.js`): the `workflow-email-defaults` panel description becomes
   "Edit shared default copy for reviewer, grantee, and internal email workflows, plus staff
   display labels." Nothing else in `admin.js` changes.
4. **Tests**: update `tests/unit/email-defaults-section.test.js` fixtures with the new fields
   and add assertions for: group headings in order, subject and body of one email inside the
   same card, and that saving one field still PUTs only that key. Keep the existing blank/
   unavailable assertions.
5. **Docs**: `docs/API_ROUTE_SECURITY_MATRIX.md` `/api/admin/email-defaults` row: note the
   response entries carry `group`/`emailKey`/`emailLabel` (display metadata). If any wiki page
   describes the flat layout, update it (grep `EmailDefaultsSection` under `docs/`).

## Owned files

`shared/config/editableTextDefaults.js`, `shared/components/admin/EmailDefaultsSection.js`,
`pages/admin.js` (one string), `tests/unit/email-defaults-section.test.js`,
`tests/unit/editable-text-defaults-catalog.test.js` (new), `docs/API_ROUTE_SECURITY_MATRIX.md`,
and any wiki page found by the grep.

## Forbidden

`pages/api/admin/email-defaults.js` (no route change needed), `scripts/seed-email-defaults.mjs`,
anything under `lib/seed/`, every meeting-tracker file. No new dependencies.

## Verification (sequentially, in the worktree)

```bash
npx jest tests/unit/email-defaults tests/unit/editable-text-defaults-catalog tests/unit/seed-email-defaults
npm run check:types
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
```

## Handoff (builder fills in)

**Branching note (deviation from brief text):** the brief says "starts after Build A merges…
rebase on main." The launching instruction directed branching `claude/email-defaults-grouping`
from the still-unmerged `claude/agenda-email-defaults` directly instead, so this branch was
never rebased onto `main`. [VERIFIED via `git log`] the branch contains Build A's two catalog
entries (`email.deliberation_agenda.subject`/`.body`) and this build's commits sit on top.

**Catalog count:** the brief's header said "20+ cards, growing"; [VERIFIED via
`EDITABLE_TEXT_DEFAULTS.length` printed at runtime] the catalog has **29 entries**, grouped
into **13 cards** (11 in `reviewers`/`grantees`/`internal`, plus one 4-field `labels` card for
`stage.deliberations.*`).

**Scope implemented exactly as specified:**
- `group`/`emailKey`/`emailLabel` added to all 29 entries in
  `shared/config/editableTextDefaults.js`; `EDITABLE_TEXT_GROUPS` exported in the required
  order (reviewers, grantees, internal, labels); FUTURE header paragraph replaced.
- `tests/unit/editable-text-defaults-catalog.test.js` added: asserts every entry has a valid
  `group`, non-empty `emailKey`/`emailLabel`, and that `emailKey` is a prefix of `key`; also
  checks `EDITABLE_TEXT_GROUPS` order/shape.
- `EmailDefaultsSection.js` now groups client-side by `EDITABLE_TEXT_GROUPS` order, then by
  `emailKey` in catalog order; renders `<h3>` group heading + description, one `<section>`
  card per `emailKey` titled `emailLabel` (`<h4>`), one field per entry inside (field label
  demoted to `<h5>` for a clean h3→h4→h5 hierarchy — not required by the brief, a small
  readability improvement, no behavior change). Per-field markup (placeholder hints,
  blank/unavailable messaging, per-key PUT, Save/Reload, char count, status) is unchanged,
  only re-nested. No new dependencies; GET/PUT route untouched.
- `pages/admin.js`: only the `workflow-email-defaults` panel `description` string changed, to
  "Edit shared default copy for reviewer, grantee, and internal email workflows, plus staff
  display labels."
- `tests/unit/email-defaults-section.test.js` updated: fixtures carry `group`/`emailKey`/
  `emailLabel`; new assertions for group-heading order, subject+body of one email inside the
  same `<section>`, and that saving one field PUTs exactly once with only that key. Existing
  blank/unavailable assertions preserved.
- `docs/API_ROUTE_SECURITY_MATRIX.md`: `/api/admin/email-defaults` row now notes the response
  carries display-only `group`/`emailKey`/`emailLabel` metadata (GET spreads the catalog
  entry — [VERIFIED via reading `pages/api/admin/email-defaults.js:15-22`], unchanged by this
  build). Wiki grep (`grep -rn "EmailDefaultsSection" docs/`) found one other mention,
  `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md:1439-1441`; it describes storage/
  read paths, not the flat-vs-grouped layout, so it needed no edit. It does call the panel
  "Email Defaults" while the actual admin panel title is "Workflow email defaults" —
  pre-existing naming drift, out of scope, left alone.
- Consumer check: [VERIFIED via `grep -rln "EDITABLE_TEXT_DEFAULTS\|EDITABLE_TEXT_GROUPS" --include=*.js --include=*.mjs .`]
  hits are: this file, `EmailDefaultsSection.js`, `pages/api/admin/email-defaults.js`,
  `scripts/seed-email-defaults.mjs` (all untouched, still read the array as before), and four
  test files (`email-defaults-routes`, `seed-email-defaults`, `deliberation-stage`,
  the new catalog test) — all pass.

**Owned/Forbidden respected:** only files in the Owned list were touched (plus this Handoff
section, which is not in Owned but is explicitly requested by the task instruction — noting
the deviation here rather than doing it silently).
`pages/api/admin/email-defaults.js`, `scripts/seed-email-defaults.mjs`, `lib/seed/`, and
meeting-tracker files were not modified. No new dependencies added.

**Tests run:**
- `npx jest tests/unit/email-defaults tests/unit/editable-text-defaults-catalog tests/unit/seed-email-defaults`
  → 4 suites / 47 tests passed (glob matched `email-defaults-section`, `email-defaults-routes`,
  `editable-text-defaults-catalog`, `seed-email-defaults`; two expected `console.error` lines
  from routes tests exercising the strict-read failure path, not failures).
- `npx jest tests/unit/seed-email-defaults tests/unit/meeting-tracker-agenda` (Build A
  protection, per instruction) → 5 suites / 55 tests passed.

**Gates run (sequentially, all passed):**
- `npm run check:types` → clean.
- `npm run check:api-routes` → 208 routes covered; 3 pre-existing unrelated warnings
  (`/api/external/materials/[token]/*`), not failures, not touched by this build.
- `npm run check:api-routes:self-test` → OK.
- `npm run check:fact-consistency` → OK, 734 files scanned.
- `npm run check:fact-consistency:self-test` → OK.
- `npm run check:status-enum-parity` → OK, 8 invariants.
- `npm run check:status-enum-parity:self-test` → OK, 17/17.

**Left open:** nothing from Scope. Rebase onto `main` is deferred to whoever merges Build A
first, per the launching instruction's explicit branch setup (not this builder's call).

---

### Post-review fixes (Opus review: PASS WITH FIXES)

Review found the original `email-defaults-section.test.js` fixture (one email per group, its
only sibling field `unavailable`) let three mutants pass: (1) grouping by `group` only and
ignoring `emailKey`, (2) batch-saving every available field in a card, (3) swapping the
`reviewers`/`labels` group order. No production-code change was required by the review; fixed
by extending the fixture per the review's spec (a-d) plus one optional hardening change.

**Test changes** (`tests/unit/email-defaults-section.test.js`):
- Fixture extended to 7 entries: `email.reviewer_invitation.subject` (reviewers),
  `email.grantee_invite.subject`/`.body` (grantees, body still `unavailable: true`),
  `email.grantee_reminder.subject` (grantees, added after both invite entries),
  `email.deliberation_agenda.subject`/`.body` (internal, both available), and
  `stage.deliberations.draft` (labels).
- Heading-order assertion now checks all four group titles:
  `['Reviewer emails', 'Grantee emails', 'Internal emails', 'Staff labels']`.
- Pairing test asserts `within(inviteCard).queryByLabelText('Grantee reminder subject')` is
  `null` (kills the "group-only" mutant) and pins grantees card order to
  `['Grantee invite', 'Grantee reminder']` via the level-4 heading sequence.
- New test saves `email.deliberation_agenda.subject` inside a card whose sibling
  (`.body`) is available, and asserts exactly one PUT with
  `{ key: 'email.deliberation_agenda.subject', value: … }` (kills the "batch-save" mutant).
- Existing blank/unavailable assertions kept passing unchanged.

**Mutation-kill verification** [VERIFIED via manual mutation]: applied each of the three
named mutants directly to `EmailDefaultsSection.js` in a scratch copy, ran
`npx jest tests/unit/email-defaults-section` against each, confirmed a failing assertion for
all three, then restored the file (`diff` against a pre-mutation copy showed no residual
change) before committing:
- Mutant 1 (group-by-`group`-only, all entries in one card): failed on the
  `queryByLabelText('Grantee reminder subject')` assertion.
- Mutant 2 (batch-save every available sibling field): failed on the single-PUT
  `toHaveBeenCalledWith`/count assertion (the mutation as applied also threw a `ReferenceError`
  inside the click handler since `card` isn't in `renderField`'s scope — either way, the test
  suite would catch a batch-save regression here; it did not pass silently).
- Mutant 3 (reversed `EDITABLE_TEXT_GROUPS` order): failed on the four-group heading-order
  `toEqual` assertion.

**Optional hardening applied** (`shared/components/admin/EmailDefaultsSection.js`): the
per-group/per-card grouping logic was factored into a `buildCards` helper; entries whose
`group` does not match any `EDITABLE_TEXT_GROUPS` id now render in a trailing "Other" group
(`id: 'other'`, title "Other") instead of silently disappearing if a catalog entry's `group`
is misspelled. No existing behavior changed (all defaults have valid known groups today, so
this path is currently inert; `tests/unit/editable-text-defaults-catalog.test.js` already
asserts every entry's `group` is one of the four valid ids, so this is a defense-in-depth
guard, not a currently-exercised path).

**Re-run verification (sequential, as requested):**
- `npx jest tests/unit/email-defaults tests/unit/editable-text-defaults-catalog` →
  **3 suites / 42 tests passed** (`email-defaults-section`, `email-defaults-routes`,
  `editable-text-defaults-catalog`; two expected `console.error` lines from the routes test's
  strict-read-failure path, not failures).
- `npm run check:types` → clean.

**Commits:**
- `4cc383fd` — original Build B implementation (grouping, catalog metadata, tests, docs).
- `<fill in below>` — post-review fixes (fixture hardening + Other-group fallback).
