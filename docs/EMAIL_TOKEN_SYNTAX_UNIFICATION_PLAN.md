---
title: Email Template Token-Syntax Unification Plan v2
domain: email
kind: plan
status: historical
summary: "Historical record of the completed July 2026 mustache-token migration; current template behavior lives in the resolver source and seed defaults."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/migrate-email-token-syntax.mjs
  - scripts/seed-email-defaults.mjs
  - lib/utils/email-generator.js
  - "pages/api/external/review/[token]/respond.js"
---

# Email Template Token-Syntax Unification Plan v2

**Created:** 2026-07-01 (S311)  
**Status:** ✅ EXECUTED 2026-07-01 — build shipped, deployed to prod, and the data migration ran successfully (see "Execution record" below). Plan authored v2 by Codex, reviewed against source by Claude (two strengthenings folded in: whole-token/longest-first matching guard; `fillInviteBody` missing-data fallback spec), owner-confirmed the grantee-invite-subject decision = IMPLEMENT resolution.  

> **Current routing/outcome:** The migration is complete. Use the live email resolvers, seed
> defaults, and `scripts/migrate-email-token-syntax.mjs` for current behavior; this document
> preserves the rollout and migration evidence. Legacy-alias removal, if ever wanted, is a
> separate scoped cleanup.

## Execution record (2026-07-01, S311)

- **Build:** commit `0222a7a0` — dual-syntax resolvers (reviewer acceptance/withdraw/both reminders + grantee invite/reminder), new `fillInviteSubject` subject resolution wired into `AwardeeTab`, seeds + `editableTextDefaults` hints + Profile Settings copy → mustache, and `scripts/migrate-email-token-syntax.mjs`. Full suite green (283 suites / 3571 tests); affected gates green. Codex-built, Claude-reviewed against source.
- **Deploy:** live in prod (`dpl_AE69EEbbTR1wThddNiG8d96TsX5m`, aliased to `reviews.wmkeck.org`) before any data write, so dual-syntax resolvers were serving throughout the migration window. (Pushed to `main`; the GitHub→Vercel webhook did not fire, so the deploy was triggered via `vercel --prod` — root-cause a transient missed webhook, integration itself is connected.)
- **Migration:** `node scripts/migrate-email-token-syntax.mjs --execute` → `adminUpdated=6 preferenceUpdated=2` (the 6 System-B admin bodies + both per-user `grantee_invite_body` rows; 6 admin subjects were no-change, carrying no tokens). Dry-run first validated every transform (copy-preservation reverse-substitution assertion + per-user count-guard = 2). Live admin copy preserved byte-for-byte; only token syntax changed.
- **Verify:** post-migration dry-run reports `adminChanged=0 preferenceChanged=0` — zero bracket tokens remain in any stored value.
- **Outstanding (optional, non-urgent):** (1) after a soak, a cleanup PR to drop the legacy `[bracket]` aliases from the dual-syntax resolvers (§5); (2) `scripts/seed-email-defaults.mjs --execute` is effectively a no-op for prod now (values already migrated) — seeds matter only for a fresh install, and the seed files are already mustache in code.

The sections below are the plan-of-record as authored; the sequencing/"do not run until…" guidance in §3–§7 was followed in the order above and is retained for provenance.
**Owner decisions:** standardize on mustache `{{token}}`; cover all admin-editable reviewer + grantee email templates; plan first, implementation later.  
**Goal:** Replace legacy `[bracket]` tokens with mustache `{{token}}` in admin-editable email templates while preserving live stored copy exactly except for token spelling.

## 1. Corrected Runtime Model

There are two token engines and three legacy resolver families.

| Surface | Current syntax | Storage | Runtime resolver |
|---|---|---|---|
| System A reviewer composed emails: invitation, materials, followup, thankyou | Mustache `{{token}}` | Admin defaults in `wmkf_appsystemsetting`; optional per-PD JSON override in `wmkf_appuserpreferences` key `reviewer_email_templates` | `replacePlaceholders` in `lib/utils/email-generator.js`, called by reviewer render/send routes |
| System B reviewer transactional emails: acceptance, withdraw, respond-by reminder, review-due reminder | Legacy brackets | Admin defaults in `wmkf_appsystemsetting` | `pages/api/external/review/[token]/respond.js`, `lib/external/reviewer-withdraw-email.js`, `lib/external/reviewer-reminder-email.js` |
| System B grantee invite | Legacy brackets | Admin default in `wmkf_appsystemsetting`; per-PD body override in `wmkf_appuserpreferences` key `grantee_invite_body` | Client-side `fillInviteBody` in `shared/config/granteeInviteEmail.js`; server route only wraps final body HTML |
| System B grantee reminder | Legacy brackets | Admin default in `wmkf_appsystemsetting` | `lib/external/grantee-invite-email.js` via the reminder cron |

Verified source facts:

- [VERIFIED via `shared/config/granteeInviteEmail.js:33-37`] `fillInviteBody` currently replaces `[Name]`, `[title]`, and whole phrase `COB [date]`.
- [VERIFIED via `shared/components/workbench/AwardeeTab.js:83-87`] the grantee invite body uses the per-PD `grantee_invite_body` preference when present, otherwise the admin default.
- [VERIFIED via `shared/components/workbench/AwardeeTab.js:206-210`] the Workbench derives the body client-side with `fillInviteBody`.
- [VERIFIED via `shared/components/workbench/AwardeeTab.js:255-257`] the Workbench sends raw `subject` and already-composed `bodyText` to the send route.
- [VERIFIED via `pages/api/workbench/grantee-deliverables/send-invite.js:123-132`] the send route appends the server-owned signature and renders HTML, but does not resolve subject/body tokens.
- [VERIFIED via `shared/config/reviewerFinderPreferences.js:46-52`] `grantee_invite_body` is a per-user preference stored in `wmkf_appuserpreferences`.
- [VERIFIED via `pages/profile-settings.js:238-245`] Profile Settings writes `grantee_invite_body`.
- [VERIFIED via `pages/profile-settings.js:389-394`] Profile Settings currently instructs PDs to keep bracket placeholders.

Implementation invariant: deploy tolerant resolvers before mutating stored data. During the transition, every live send path must resolve both old and new syntax so no real email can ship unresolved literal tokens because of deploy/data ordering.

## 2. Complete Canonical Token Map

Canonical tokens should use System A names where semantics match. Distinct phrase-valued tokens stay distinct from bare-title tokens.

| Legacy bracket token | Canonical mustache token | Meaning and resolver notes | Collision / compatibility notes |
|---|---|---|---|
| `[reviewerName]` | `{{reviewerName}}` | Reviewer display name. Acceptance resolver currently supports this. | Distinct from System A `{{greeting}}`; no collision. |
| `[Reviewer Name]` | `{{reviewerName}}` | Reviewer display name. Reminder and withdraw resolvers currently support this casing. | Legacy alias must remain during dual-syntax soak. |
| `[greeting]` | `{{greeting}}` | Full withdraw greeting, e.g. `Dear Name:`. | Name collides intentionally with System A `{{greeting}}`; same semantic category, but value format differs by email family. Document per resolver. |
| `[title]` in acceptance | `{{proposalTitle}}` | Bare proposal title. | Matches System A `{{proposalTitle}}`. |
| `[title]` in grantee invite/reminder | `{{proposalTitle}}` | Bare award/proposal title. | Matches System A `{{proposalTitle}}`. |
| `[title]` in withdraw | `{{proposalClause}}` | Current withdraw resolver maps `[title]` to the same full clause as `[proposal]`. | Legacy alias only; do not advertise for new copy. |
| `[proposal]` | `{{proposalClause}}` | Full clause such as `the proposal "X"` or a neutral fallback. | Do not collapse into `{{proposalTitle}}`; phrase semantics differ. |
| `[proposal title clause]` | `{{proposalClause}}` | Legacy phrase-token alias supported by reminder and withdraw resolvers. | Must stay during dual-syntax soak. |
| `[reviewDueDate]` | `{{reviewDueDate}}` | Acceptance due-date sentence today, not just a date: `Your review is due on ...` or fallback sentence. | Name collides with System A `{{reviewDueDate}}`, which is date-like in reviewer composed templates. For acceptance either keep sentence semantics and document resolver-local behavior, or introduce `{{reviewDueSentence}}`. Recommendation: use `{{reviewDueDate}}` for minimal migration, with tests documenting sentence output. |
| `[review due date]` | `{{reviewDueDate}}` | Review-due reminder formatted date. | Same canonical spelling; resolver-local value is date-only. |
| `[Program Director signature]` | `{{signature}}` | Program Director signature text. | Matches System A `{{signature}}`. |
| `[signature]` | `{{signature}}` | Withdraw legacy alias for signature. | Must stay during dual-syntax soak. |
| `[Name]` | `{{granteeName}}` | Grantee surname in grantee invite/reminder copy. | Distinct from reviewer name tokens. |
| `COB [date]` | `COB {{dueDate}}` | Whole legacy phrase currently resolves to `COB <date>`. New `{{dueDate}}` is date-only. | This avoids `COB COB ...` and preserves current phrase semantics. Do not migrate to bare `{{dueDate}}` unless surrounding copy is also edited. |
| `[requestNumber]` | `{{requestNumber}}` | Internal request number strip token in acceptance confirmation. Current value is always empty. | Keep both aliases resolving to empty during dual-syntax soak; never expose request number externally. Do not advertise this token. |

COB decision: migrate the literal phrase `COB [date]` to `COB {{dueDate}}`; `{{dueDate}}` must be date-only. [VERIFIED via `shared/config/granteeInviteEmail.js:37`] the client invite currently matches `COB [date]`, and [VERIFIED via `lib/external/grantee-invite-email.js:53-61` and `:81-84`] the reminder helper creates a `COB ...` deadline and replaces the whole phrase.

## 3. Complete Implementation Site List

Resolvers to update for dual syntax:

- `shared/config/granteeInviteEmail.js` — add `{{granteeName}}`, `{{proposalTitle}}`, and `COB {{dueDate}}` support to `fillInviteBody`. Keep `[Name]`, `[title]`, and `COB [date]` until cleanup. This is the missing client-side grantee invite resolver. **Missing-data fallback (preserve current behavior):** today `fillInviteBody` re-inserts the LITERAL token when data is absent (`.replaceAll('[Name]', surnameFromName(piName) || '[Name]')`, `granteeInviteEmail.js:35`). The dual-syntax version must mirror this per-token — a missing `{{granteeName}}` leaves `{{granteeName}}` (its own mustache form), a missing `{{proposalTitle}}` leaves `{{proposalTitle}}` — so absent-data behavior is unchanged and never silently blanks. Add a unit test asserting the missing-data fallback for both syntaxes.
- `lib/external/grantee-invite-email.js` — update grantee reminder placeholder map for `{{granteeName}}`, `{{proposalTitle}}`, `COB {{dueDate}}`, and `{{signature}}`; keep legacy aliases.
- `lib/external/reviewer-reminder-email.js` — update respond-by and review-due maps for `{{reviewerName}}`, `{{proposalClause}}`, `{{reviewDueDate}}`, and `{{signature}}`; keep `[proposal title clause]`.
- `lib/external/reviewer-withdraw-email.js` — update withdraw map for `{{reviewerName}}`, `{{greeting}}`, `{{proposalClause}}`, and `{{signature}}`; keep `[greeting]`, `[signature]`, `[proposal title clause]`, and other legacy aliases.
- `lib/services/reviewer-acceptance-email.js` — update acceptance confirmation map for `{{reviewerName}}`, `{{proposalTitle}}`, `{{reviewDueDate}}`, `{{signature}}`, and `{{requestNumber}}`; keep legacy aliases.

Subject-resolution decision:

- DECISION (owner-confirmed 2026-07-01): implement grantee invite subject resolution in the Workbench/send path, not by dropping the token hint.
- Rationale: [VERIFIED via `shared/config/editableTextDefaults.js:16-20`] the admin hint advertises a grantee invite subject placeholder today, but [VERIFIED via `shared/components/workbench/AwardeeTab.js:122-130` and `:255-257`] the subject is copied to state and sent raw, and [VERIFIED via `pages/api/workbench/grantee-deliverables/send-invite.js:130-132`] the server sends it unchanged. Keeping a placeholder hint without resolution is a live product bug. The implementation should add subject resolution for both `[title]` and `{{proposalTitle}}` before preview/send, ideally next to `fillInviteBody` as a small shared grantee invite composer.
- Scope: grantee invite subject only. Grantee reminder subject currently has no placeholders advertised [VERIFIED via `shared/config/editableTextDefaults.js:163-167`] and is sent as stored by the cron [VERIFIED via `pages/api/cron/grantee-deliverable-reminders.js:218-220`].

Admin hints and user-facing copy to update:

- `shared/config/editableTextDefaults.js` — update placeholders and descriptions for every System B admin-editable subject/body entry: grantee invite, grantee reminder, reviewer acceptance, reviewer withdraw, reviewer respond-by reminder, reviewer review-due reminder.
- `pages/profile-settings.js` — update the Request Abstract Email instructions from `[Name]`, `[title]`, `COB [date]` to `{{granteeName}}`, `{{proposalTitle}}`, `COB {{dueDate}}`.

Seed/default files to update after resolver deployment:

- `lib/seed/email-defaults/reviewer-actions.js`
- `lib/seed/email-defaults/reviewer-reminders.js`
- `lib/seed/email-defaults/grantee-invite.js`
- `lib/seed/email-defaults/grantee-reminder.js`
- `lib/seed/email-defaults/reviewer-templates.js` is already mustache System A seed copy [VERIFIED via `lib/seed/email-defaults/reviewer-templates.js:14-19`] and should not be rewritten except if tests need fixture normalization.

Named-source discrepancy: `lib/external/reviewer-invite-email.js` and `pages/api/workbench/reviewer/respond.js` were requested as likely files, but this checkout does not contain them. The acceptance resolver is in `pages/api/external/review/[token]/respond.js`; reviewer invitation System A rendering uses the existing `replacePlaceholders` path.

## 4. Data Migration Plan

Live probe ground truth to preserve:

- [VERIFIED via provided live probe, 2026-07-01] Admin layer: exactly 12 System B `wmkf_appsystemsetting` keys are in scope; all 6 subjects match seed; all 6 bodies differ from seed via intentional admin edits but use the same bracket token set.
- [VERIFIED via provided live probe, 2026-07-01] Per-user layer: exactly 2 `wmkf_appuserpreferences` rows with key `grantee_invite_body` contain `[Name]`, `[title]`, and `[date]` bracket syntax; owner ids are `29b0de0d` and `b53a3bf8`.
- [VERIFIED via provided live probe, 2026-07-01] `reviewer_email_templates` has 1 row and is already all-mustache; legacy keys `reviewer_finder_email_template` and `email_reviewer_template` have zero rows; `email_signature` rows have no tokens.

Admin migration:

- Add a one-off script, e.g. `scripts/migrate-email-token-syntax.mjs`, but do not run it until dual-syntax code is deployed.
- Enumerate the 12 System B keys explicitly:
  - `email.grantee_invite.subject`
  - `email.grantee_invite.body`
  - `email.grantee_reminder.subject`
  - `email.grantee_reminder.body`
  - `email.reviewer_acceptance.subject`
  - `email.reviewer_acceptance.body`
  - `email.reviewer_withdraw.subject`
  - `email.reviewer_withdraw.body`
  - `email.reviewer_reminder_respond_by.subject`
  - `email.reviewer_reminder_respond_by.body`
  - `email.reviewer_reminder_review_due.subject`
  - `email.reviewer_reminder_review_due.body`
- For each stored value, replace only complete legacy tokens/phrases from the canonical map. Preserve all other bytes, including whitespace, punctuation, line endings, and intentional live copy edits.
- **Whole-token, longest-first matching (REQUIRED — substring-collision guard).** A shorter bracket token can be a substring of a longer phrase — notably `[date]` ⊂ `COB [date]`. Replacement MUST match whole delimited tokens and process the map **longest-key-first**, so `COB [date]` is consumed before any bare `[date]` rule could fire (there is no bare `[date]` rule in the map — do not add one). This rule also applies to the dual-syntax RESOLVERS, not just the migration script: the existing bracket resolvers use naive insertion-order `String.split(token).join(value)` (`reviewer-withdraw-email.js:16-22`), so when legacy + mustache aliases coexist, order the map longest-first and never let a token that is a prefix of another be processed first. Note (advantage of the target state): once values are mustache, `{{}}` delimiting eliminates this class of collision — a shorter `{{x}}` cannot be a substring of a longer `{{xy}}` — so the hazard exists only for the legacy-bracket half during the soak window.
- Dry-run output must show key, token diff, and before/after token inventory. It must fail if any unknown bracket token remains or if non-token copy changes.
- Copy-preservation assertion: after replacing canonical tokens back to their legacy equivalents, the dry-run result must equal the original byte-for-byte. For `COB [date]`, reverse `COB {{dueDate}}` to `COB [date]`.

Per-user migration:

- The same script must enumerate `wmkf_appuserpreferences` where preference key equals `grantee_invite_body`.
- In dry-run, print the owner/profile id and token inventory for all matching rows. The expected execution set is exactly 2 rows from the live probe; if the count differs, stop and require a fresh read-only probe before execution.
- Write only rows whose value changes after token replacement. Preserve copy bytes outside tokens using the same reverse-substitution assertion.
- No per-user grantee invite subject key exists per live probe, so subject migration is admin-only. Future subject resolution handles admin default and any manually edited compose-state subject at send time.

No migration is needed for `reviewer_email_templates` because the only live row is already mustache, and no legacy reviewer single-template rows exist.

## 5. Dual-Syntax Transition and No-Unresolved-Token Proof

Sequence safety:

1. Deploy dual-syntax resolvers and grantee invite subject resolution first. Stored values are still brackets, so behavior remains compatible.
2. Run dry-run migration for admin and per-user layers. Do not write if unknown tokens, count drift, or copy-preservation assertions fail.
3. Execute migration only after dry-run passes.
4. Update seeds and UI hints in the same code rollout as, or after, the tolerant resolvers. Fresh installs and admin/user instructions then advertise only mustache.
5. Keep legacy aliases through a soak period. Cleanup is a separate follow-up after read-only probes show no bracket tokens remain in `wmkf_appsystemsetting` System B keys and `wmkf_appuserpreferences.grantee_invite_body`.

No ordering/partial-failure window:

- If code deploys before data migration, bracket templates still resolve because every resolver keeps legacy aliases.
- If data migration partially succeeds, migrated mustache rows resolve and unmigrated bracket rows resolve because every resolver is dual-syntax.
- If a PD has an open Workbench tab with an old bracket body, send still resolves because `fillInviteBody` remains dual-syntax for newly derived bodies and the server-side send route does not depend on template syntax after body composition.
- If a PD has an open Profile Settings tab and saves bracket syntax during the transition, the Workbench still resolves it because `grantee_invite_body` remains dual-syntax until cleanup.
- The acceptance `[requestNumber]` strip remains active for both `[requestNumber]` and `{{requestNumber}}`, resolving to empty so the internal number never leaks.

Cleanup prerequisites:

- A read-only probe confirms zero legacy bracket tokens in the 12 admin keys and zero legacy bracket tokens in all `grantee_invite_body` preference rows.
- Profile Settings and admin hints have shown only mustache for at least one soak period.
- Tests for mustache-only resolvers are added or updated in the cleanup PR.

## 6. Test Plan

Resolver parity tests:

- `fillInviteBody` resolves legacy and mustache grantee invite bodies identically: `[Name]` equals `{{granteeName}}`; `[title]` equals `{{proposalTitle}}`; `COB [date]` equals `COB {{dueDate}}`.
- Grantee reminder builder resolves both syntaxes identically and keeps `{{dueDate}}` date-only while surrounding copy supplies `COB`.
- Reviewer reminder builders resolve `[Reviewer Name]`, `[proposal]`, `[proposal title clause]`, `[review due date]`, `[Program Director signature]` and their canonical mustache forms.
- Reviewer withdraw builder resolves all current legacy aliases: `[Reviewer Name]`, `[reviewerName]`, `[greeting]`, `[proposal]`, `[proposal title clause]`, `[title]`, `[Program Director signature]`, `[signature]`, plus canonical forms.
- Acceptance confirmation resolves `[reviewerName]`, `[title]`, `[reviewDueDate]`, `[Program Director signature]`, `[requestNumber]`, plus canonical forms. Assert request number resolves to empty.
- Grantee invite subject resolution test proves `[title]` and `{{proposalTitle}}` both render to the same subject, and unknown tokens are left untouched or surfaced according to the implementation's chosen validation rule.

Migration tests:

- Fixture each of the 12 admin keys with live-like copy and assert token-swap changes only canonical tokens.
- Fixture the 2 per-user `grantee_invite_body` rows and assert copy-preservation via reverse substitution.
- Negative fixture with an unknown bracket token must fail dry-run without writing.
- Count-guard test for per-user migration: expected live count mismatch stops execution unless an explicit override is passed after a new probe.

Integration/route tests:

- Workbench grantee invite compose path uses per-PD override before admin default and resolves mustache placeholders.
- Send/preview routes still append server-owned signature and do not require body tokens to be present after client composition.
- Grantee reminder cron renders a mustache migrated body without literal `{{...}}` in the HTML.
- Acceptance confirmation, reviewer withdraw, and reviewer reminders render migrated mustache templates without literal unresolved tokens.

Gates:

- Run the narrow unit/integration tests for the touched resolver and migration script surfaces.
- Run the relevant project gates from `docs/CI_GATES_REFERENCE.md` for changed source files. Because this v2 task is document-only, no gates are run now.

## 7. Sequencing, Rollback, and Blast Radius

Recommended implementation sequence:

1. Code commit: add dual-syntax resolver support and grantee invite subject resolution. Include resolver parity tests.
2. Code commit: update admin hints, Profile Settings instructions, and seed files to mustache. Include fixture tests for advertised tokens.
3. Script commit: add the dry-run-first migration script covering admin and per-user layers.
4. Deploy code with dual-syntax support.
5. Run migration script dry-run. Review token inventories and copy-preservation assertions.
6. Run migration script execute mode only after dry-run passes.
7. Run a read-only post-migration probe to confirm no legacy tokens remain in the 12 admin keys and the 2 per-user `grantee_invite_body` rows.
8. After soak, plan a separate cleanup to remove bracket aliases.

Rollback:

- Code rollback is safe while data is partially migrated only if the previous deployed version is dual-syntax. Do not roll back to bracket-only code after data migration unless data is also reverted.
- Data rollback can be done by the migration script in reverse or from Dataverse audit/backups. Reverse mode must preserve copy bytes and only swap mustache tokens back to legacy forms.
- If migration execution fails mid-run, leave dual-syntax code deployed, fix the script/data issue, rerun dry-run, then execute only changed rows.

Blast radius:

- External outbound emails to reviewers and grantees can expose literal tokens if resolver coverage is incomplete.
- Stored admin and per-user copy can be damaged if migration rewrites more than tokens.
- No schema change is planned. No product migration is to run as part of this document authoring task.
- Existing route security, sender resolution, magic-link minting, and signature appending are out of behavioral scope except where subject/body token resolution is explicitly added.

## 8. Prior Findings Reconciliation

- ADDRESSED — BLOCKER 1: Section 1 adds `fillInviteBody` as the third resolver family with source evidence; Sections 3, 5, and 6 require dual-syntax support and tests for it.
- ADDRESSED — BLOCKER 2: Sections 1 and 4 add the `wmkf_appuserpreferences.grantee_invite_body` layer and require migration of the exactly 2 live rows; Section 5 keeps dual syntax for future/stray saved preferences through soak.
- ADDRESSED — SHOULD-FIX COB token: Section 2 defines `COB [date]` to `COB {{dueDate}}` with date-only `{{dueDate}}`; Sections 4 and 6 require migration and tests for that exact phrase.
- ADDRESSED — SHOULD-FIX grantee invite subject: Section 3 marks the subject behavior as a decision point and chooses to implement subject resolution rather than drop the hint.
- ADDRESSED — SHOULD-FIX omitted live tokens: Section 2 includes `[proposal title clause]`, `[greeting]`, `[signature]`, and `[requestNumber]`; Sections 3 and 6 require resolver support and tests.
- ADDRESSED — NIT Profile Settings instructions: Section 3 includes the `pages/profile-settings.js` instruction update from bracket syntax to mustache.
