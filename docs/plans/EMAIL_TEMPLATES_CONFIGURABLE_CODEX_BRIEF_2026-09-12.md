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
(created from `origin/main` at `9fbc2243` or later; the branch is pushed). Run `/start` there. Claude works in the main checkout
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
  the catalog; a new catalog entry appears there with no UI change.
- **Seeding (corrected 2026-09-12 after Codex's read-only survey):** `scripts/seed-email-defaults.mjs`
  is also a catalog consumer. It walks `EDITABLE_TEXT_DEFAULTS` and **throws
  `No seed text registered for <key>`** for any catalog key without a seed map entry, and the seed
  texts live in `lib/seed/email-defaults/*.js` (one module per family, e.g. `grantee-reminder.js`).
  A new family therefore needs a new `lib/seed/email-defaults/site-visit-materials.js` exporting
  the subject/body seeds, and the seed script's import/map extended. Both are in your surface (§3).

## 2. Inventory — what is hard-coded (convert these)

| Sender | File | Literal today | Target keys |
|---|---|---|---|
| Site-visit materials invitation | `lib/services/site-visit-materials/collection-service.js` `sendInvitation` (~L339–360) + `invitationBodyText` (~L224) | subject `Site visit materials requested — <title>`; multi-paragraph body with checklist | `email.site_visit_materials_invite.subject/.body` |
| Site-visit materials reminder | same file, `sendReminderEmail` (~L412) + `reminderBodyText` (~L237) | subject `Reminder: site visit materials — <title>`; body with missing items | `email.site_visit_materials_reminder.subject/.body` |

The survey of other `subject:` literals is already done (Codex, read-only, 2026-09-12) and
needs no further conversion: `lib/services/scheduled-email-service.js:431` (internal daily summary)
and `lib/services/notification-service.js:122` (internal ops alert) stay hard-coded by the owner's
rule; `lib/utils/email-generator.js:489` is a legacy `DEFAULT_TEMPLATE` with no live importer,
flagged for a separate cleanup; `lib/services/review-manager/render-emails-service.js:231` holds
`subject: ''` sentinels, not copy; nothing under `pages/api`. **Rule:** convert applicant-,
reviewer-, and grantee-facing mail; leave internal ops/alert mail hard-coded.

## 3. Owned file surface (the safety boundary)

You may edit only:
- `shared/config/editableTextDefaults.js` (append entries; keep existing keys and order)
- `lib/services/site-visit-materials/collection-service.js` (the two senders and their body builders)
- any *new* helper under `lib/services/site-visit-materials/` you need
- `lib/seed/email-defaults/site-visit-materials.js` (new) and the import/map lines in
  `scripts/seed-email-defaults.mjs` (plus its test if one exists: `grep -rl seed-email-defaults tests`)
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

### 2026-09-12 — implementation on feature branch

The first pass stopped at the automatic claim-before-send conflict and recorded it in commit
`0d73bf2a`. The owner then approved §3's narrow sweep/test extension and specified that
`{{uploadLink}}` means the server-minted contributor URL and `{{signature}}` means the sending
PC's signature. No other file-surface expansion was authorized.

Commit `e578d6f2` adds four catalog/seed keys, reads them through
`readRequiredEmailDefaults`, and renders the invitation and reminder subjects/bodies from
the stored text. The seed bodies reproduce the prior wording; the list tokens remain
server-built. The HTML renderer still owns the button and fallback link, and escapes an
optional `{{uploadLink}}` in edited body copy. The PC signature uses the sending systemuser's
saved email-signature preference, falling back to the PC's name and Foundation line.
Both manual and automatic reminders prepare defaults/link/signature before the unchanged
conditional claim, so a configuration error leaves the row retryable. An invitation failure
leaves the existing collection without a new email receipt, as before.

The internal daily summary (`scheduled-email-service.js`) and ops alert
(`notification-service.js`) remain hard-coded by the owner's §2 rule. The unimported legacy
`DEFAULT_TEMPLATE` in `email-generator.js` remains a separate cleanup item.

Validation: 14 site-visit/catalog/seed suites (112 tests), two Admin email-defaults suites
(19 tests), `check:types`, changed-file ESLint, and `git diff --check` passed. The production
`npm run build` passed with one path-tracing warning in the untouched Pre-Site DOCX renderer. Post-edit
`check:doc-currency`, `check:prompt-injection-tagging`, `check:fact-consistency`,
`check:build-claim-freshness`, `check:dataverse-access-layer`, `check:dynamics-context-boundary`,
`check:route-service-boundary`, and `check:atlas` passed with their self-tests; `check:docs-catalog`
passed. The full 67-command `/start` gate set passed before implementation. At this
implementation handoff, the new settings had not yet been written to Dataverse; the
production seed receipt below supersedes that state. The branch was not merged or deployed.

Outside the owned surface, `docs/API_ROUTE_SECURITY_MATRIX.md`'s materials route descriptions
do not yet name the settings reads, and
`.claude-memory/project-site-visit-materials-planning-handoff.md` retains an older claim that
the PC manual reminder has no claim (already stale before this work). Claude should reconcile
those durable restatements with the branch on promotion.

### 2026-09-12 — Opus review fixes on the same branch

The invitation body now requires `{{checklist}}` and the reminder body requires
`{{missingItems}}` on Admin saves, so an edited template cannot silently omit the
server-built item list. A retry of an invitation with missing/blank settings
returns the actionable 503 instead of a generic transport 502; a transport
failure still leaves the collection retryable and reports 502. Invite and
manual reminder reject an unlinked staff actor with the same 403 as create,
before any context read or reminder claim. The automatic sweep reads the two
reminder defaults at most once per run, before any claim, while handling failures for
each eligible row. Its dry-run eligibility count is explicitly provisional:
dry runs skip settings resolution because that read can notify operations.

The focused site-visit, catalog, seed, and Admin suites now pass (16 suites,
135 tests); types, changed-file lint, and diff check pass. At this review-fix
handoff, the four settings were still unseeded; see the later receipt below.
The branch remains unmerged and undeployed.

### 2026-09-12 PT / 2026-09-13 UTC — production Dataverse seed receipt

The local checkout targeted `wmkf.crm.dynamics.com` with
`DATAVERSE_TARGET_INTERLOCK=on` and no sandbox URL. A read-only dry run of
`node scripts/seed-email-defaults.mjs` found exactly four missing keys and
25 existing non-empty email defaults. The owner-authorized `--execute` run
used a single-invocation, UTC-dated `DATAVERSE_PROD_WRITE_ACK`; it created
`email.site_visit_materials_invite.subject`, `.body`,
`email.site_visit_materials_reminder.subject`, and `.body`, while skipping
the 25 existing values. A separate `getSettingStrict` readback found all
four rows and compared each value byte-for-byte with the tracked seed text;
all four matched. No email was sent. The feature branch remains unmerged and
undeployed, so this receipt establishes stored copy, not production runtime.
