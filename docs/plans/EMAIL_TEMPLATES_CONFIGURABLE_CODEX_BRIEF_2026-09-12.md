---
title: Email Templates Configurable — Codex Brief (2026-09-12)
domain: email-templates
kind: brief
status: active
summary: "Move hard-coded email subjects and bodies into the admin-editable email defaults system; owned surface and contracts for a parallel Codex branch."
cataloged: 2026-09-12
owner: product-engineering
last_verified: 2026-09-12
related:
  - shared/config/editableTextDefaults.js
  - lib/services/email-defaults.js
  - lib/services/site-visit-materials/collection-service.js
  - .claude-memory/project-email-template-token-syntax.md
---

# Email Templates Configurable — Codex Brief (2026-09-12)

## Where you are

You are in `/Users/gallivan/Code/WMKF_Apps-codex` on branch `codex/email-templates-configurable`
(created from `origin/main` at `b8e1499b`). Run `/start` there. Claude works in the main checkout
on the Cycle Dossier at the same time; your file surfaces are disjoint (§3). Do not check out
other branches, touch the main checkout, or push to `main`. Commit after each meaningful step and
push the branch (`git push -u origin codex/email-templates-configurable`); pushing a feature
branch does not deploy. Do not merge, deploy, or edit `SESSION_PROMPT.md`. Record your handoff at
the bottom of this brief.

## Why (owner, 2026-09-12)

"I see some [email templates] that are hard coded that should be configurable." Staff edit every
reviewer and grantee email in Admin → Email defaults; a few newer senders bypassed that and carry
their subject and body as code literals, so the copy can only change by commit and deploy.

## 1. The existing contract (all [VERIFIED 2026-09-12 via source])

- **Catalog:** `shared/config/editableTextDefaults.js` — `EDITABLE_TEXT_DEFAULTS` entries with
  `key` (`email.<family>.subject` / `.body` / `.button_label`), `label`, `description`,
  `multiline`, `placeholders`, `group`, `emailKey`, `emailLabel`, and the default text.
  `EDITABLE_TEXT_GROUPS` orders the Admin panel. Read the grantee reminder pair
  (`email.grantee_reminder.*`) as the model.
- **Storage/read:** values live in Dataverse `wmkf_appsystemsettings`; senders read them with
  `readRequiredEmailDefaults([keys])` in `lib/services/email-defaults.js`, which fails closed
  (no send, ops notification `email_default_misconfigured`) when a required key is missing or
  blank. Never fall back to a literal inside a sender.
- **Tokens:** mustache `{{token}}` only (memory `project-email-template-token-syntax`); dual
  bracket aliases are resolved by the shared resolver for legacy rows — do not add new bracket
  tokens. Look at how `withdraw-sufficient-service.js` and the grantee reminder path interpolate
  and escape before reusing a helper.
- **Admin surface:** `pages/api/admin/email-defaults.js` + the Admin "Email defaults" panel read
  the catalog; a new catalog entry appears there with no UI change. Seeding: a catalog default is
  the fallback the Admin panel shows and saves; confirm whether any script seeds Dataverse rows
  before assuming one does (grep `EDITABLE_TEXT_DEFAULTS` consumers; only the admin route today).

## 2. Inventory — what is hard-coded (convert these)

| Sender | File | Literal today | Target keys |
|---|---|---|---|
| Site-visit materials invitation | `lib/services/site-visit-materials/collection-service.js` `sendInvitation` (~L339–360) + `invitationBodyText` (~L224) | subject `Site visit materials requested — <title>`; multi-paragraph body with checklist | `email.site_visit_materials_invite.subject/.body` |
| Site-visit materials reminder | same file, `sendReminderEmail` (~L412) + `reminderBodyText` (~L237) | subject `Reminder: site visit materials — <title>`; body with missing items | `email.site_visit_materials_reminder.subject/.body` |

Also **survey and list** (do not convert without listing first in your handoff, and skip if the
owner's rule below excludes them): `lib/services/scheduled-email-service.js` (daily summary
subject, internal ops mail), `lib/services/notification-service.js` (`[SEVERITY] title`, ops
alerting), `lib/utils/email-generator.js` (`Invitation to Review: {{proposalTitle}}` — check
whether this is a live default or a dead legacy path), and any other `subject:` literal you find
with `grep -rn "subject: [\`'\"]" lib pages/api`. **Rule:** convert applicant-, reviewer-, and
grantee-facing mail; leave internal ops/alert mail hard-coded and say so.

## 3. Owned file surface (the safety boundary)

You may edit only:
- `shared/config/editableTextDefaults.js` (append entries; keep existing keys and order)
- `lib/services/site-visit-materials/collection-service.js` (the two senders and their body builders)
- any *new* helper under `lib/services/site-visit-materials/` you need
- `tests/unit/site-visit-materials-collection-service.test.js`, `tests/unit/editable-text-defaults-catalog.test.js`
- `docs/agent-wiki/topics/intake-portal.md` or the site-visit materials plan
  (`docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`) — one paragraph naming the new keys
- this brief (handoff section)

Do **not** touch `lib/services/email-defaults.js`, `lib/services/settings-service.js`, the Admin
components, `pages/api/**`, `lib/services/cycle-dossier*`, `pages/cycle-dossier.js`, `next.config.js`,
or any migration. If the conversion needs a change outside this surface, stop and write it in the
handoff instead of making it.

## 4. Contracts that must hold

1. **Fail closed, no literal fallback.** A missing/blank default blocks the send via
   `readRequiredEmailDefaults`; the collection row and claim logic are unchanged (read the S507
   claim-before-send test at ~L175 of the service test before editing the reminder).
2. **Tokens are the checklist, not prose.** Expose `{{proposalTitle}}`, `{{institution}}`,
   `{{visitDate}}`, `{{dueDate}}`, `{{checklist}}` (invitation) / `{{missingItems}}` (reminder),
   `{{uploadLink}}`, `{{signature}}` as documented placeholders; the list/link tokens are built
   by code and must be escaped exactly as the existing body builders escape them. Keep the
   existing default text as the catalog default so a fresh install sends the same words.
3. **Every consumer of the old body builders still works.** `grep -rn invitationBodyText\|
   reminderBodyText` (tests import them); keep exports or update the tests in your surface.
4. **Discriminating tests.** For each converted sender: the subject/body come from the settings
   read (mock returns distinctive text and assert it reaches `createAndSendEmail`); a blank
   default blocks the send and the row is unchanged; tokens resolve; the catalog test covers the
   new keys (group, placeholders, mustache-only).
5. **Gates you own:** `npx jest tests/unit/site-visit-materials tests/unit/editable-text`,
   `npm run check:types`, `npm run check:doc-currency`, and `npm run check:prompt-injection-tagging`
   if the catalog test asks for it. Run each gate and its `:self-test` sequentially, never in
   parallel.

## 5. Out of scope

Redesigning the Admin panel; changing token syntax; touching reviewer/grantee templates that are
already configurable; the Cycle Dossier; anything that needs a migration or a new API route.

## Handoff (Codex writes this)

_(commits, what was converted, what was surveyed-and-left with reasons, tests/gates run, anything
outside the owned surface that needs Claude.)_
