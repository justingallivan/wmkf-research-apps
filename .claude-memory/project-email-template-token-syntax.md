---
name: project-email-template-token-syntax
description: "All admin-editable email templates were unified on mustache {{token}} syntax (S311, 2026-07-01), replacing legacy [bracket] syntax in the transactional emails. Resolvers are DUAL-SYNTAX during a soak — a cleanup PR to drop the legacy [bracket] aliases is PENDING. Two distinct title tokens: {{proposalTitle}} (bare title) vs {{proposalClause}} (full phrase 'the proposal “X”' with a null-safe fallback) — NOT interchangeable."
metadata:
  node_type: memory
  type: project
  status: active
  scope: dataverse
  last_verified: 2026-07-22 via live resolver source; dual-syntax aliases remain
  originSessionId: b4f727da-b275-4ffe-a50a-250fc68727a9
---

## Recall Rule

Read before changing admin-editable email tokens or removing bracket aliases.
Use mustache for new templates; preserve dual-syntax resolution until the
separate cleanup decision is made.

**DONE 2026-07-01 (S311).** Every admin-editable email template now uses mustache
`{{token}}`. Two token engines existed historically, split by pipeline:
- **System A (already mustache):** the 4 PD-composed reviewer templates (invitation,
  materials, followup, thankyou) — resolved by `replacePlaceholders`
  (`lib/utils/email-generator.js`) via render-emails → send-emails.
- **System B (was `[bracket]`, migrated to mustache):** reviewer acceptance
  (`respond.js`), withdraw (`reviewer-withdraw-email.js`), both reminders
  (`reviewer-reminder-email.js`), grantee invite + reminder (`grantee-invite-email.js`
  + the CLIENT-side composer `fillInviteBody`/`fillInviteSubject` in
  `shared/config/granteeInviteEmail.js`). Each still has its own ad-hoc per-file
  `applyPlaceholders` map (NOT the central resolver).

## What to know before touching email templates
- **Resolvers are DUAL-SYNTAX (accept both `[x]` and `{{x}}`, longest-first order).**
  This is deliberate soak-period belt-and-suspenders. A **cleanup PR to drop the legacy
  `[bracket]` aliases is PENDING** — do not treat the bracket entries as dead/removable
  until that soak-then-cleanup step is explicitly done (plan §5). Don't "tidy" them away.
- **`{{proposalTitle}}` vs `{{proposalClause}}` are NOT interchangeable:**
  `{{proposalTitle}}` = bare title, used
  where the template supplies its own quotes (`review “{{proposalTitle}}”`);
  `{{proposalClause}}` = `titleClause()` → `the proposal “X”` OR a null-safe phrase
  (`a proposal we recently invited you to review`), used in bare prose slots
  (`willingness to review {{proposalClause}} for the Foundation`). Legacy `[title]` was
  OVERLOADED — bare title in most templates but the CLAUSE in withdraw/reminders — which
  is why the migration mapped `withdraw.body`'s `[title]` → `{{proposalClause}}`.
- **Grantee invite SUBJECT resolution is NEW (S311)** — `fillInviteSubject` wired into
  `AwardeeTab` (dirty-ref guards PD edits; send/preview re-resolve). Grantee subjects were
  previously sent raw (tokens never resolved).
- **Storage:** admin defaults in Dataverse `wmkf_appsystemsetting` (12 System-B keys);
  per-PD grantee override in `wmkf_appuserpreferences` key `grantee_invite_body`. The
  S311 migration (`scripts/migrate-email-token-syntax.mjs`) rewrote 6 admin bodies + 2
  per-user rows, PRESERVING live admin copy byte-for-byte (only token syntax changed).

## Related / adjacent
- Stage-aware secure-link button label (S311): `email.reviewer_<type>.button_label` in
  the same Email Defaults panel; resolved at send in `send-emails.js` (invitation→"Respond
  to Invitation", materials→"Start Review", followup→"Go to Review"; thankyou→no button).
- Ground truth: `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` (EXECUTED record),
  `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` (email-templates section),
  `shared/config/editableTextDefaults.js` (the admin-editable catalog + placeholder hints).
