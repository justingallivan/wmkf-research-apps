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

State claims labeled [VERIFIED via …] or [ASSUMED]. List commits, tests run with counts,
gates run, and anything left open.
