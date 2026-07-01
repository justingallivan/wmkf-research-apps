# Session 312 Prompt: (open — pick from Next Items)

## Session 311 Summary

Two email-surface features shipped end-to-end (build → prod deploy → verified), plus a
stale-carryover reconcile at session start. Heavy Codex collaboration on the token
unification: Codex authored the migration plan, Claude reviewed it against source, Codex
built the code, Claude reviewed the build. Both prod-writing actions (deploy, migration
`--execute`) were run by Justin in-session — the auto-mode classifier (correctly) blocks
agent-initiated prod deploys/migrations.

### What Was Completed

1. **W6 drain-table-drop carryover reconciled** (`036564ec`). The `/start` prompt
   resurfaced a "drop the 4 drain tables" P0 — but memory `[[w6-table-drop-pending]]` was
   already CLOSED (tables DROPPED 2026-06-04, S219, migration 018). The plan doc had never
   been reconciled, so it kept regenerating the stale prompt. Fixed the live plan rows +
   neutralized the memory trigger. Destructive-carryover trap avoided.
2. **Stage-aware reviewer secure-link button label** (`9372a75d`, `3817944e`). The email
   button was hardcoded "Start Review" for every stage — wrong at the invitation/commit
   stage. Now resolved per `templateType` from admin setting `email.reviewer_<type>.button_label`
   (invitation→"Respond to Invitation", materials→"Start Review", followup→"Go to Review",
   thankyou→no button), editable in `/admin` → Email Defaults, HTML-escaped, thankyou button
   suppressed. Codex-reviewed (both findings folded). Seeded to prod.
3. **Email template token-syntax unification** (`0222a7a0`; plan `ae475d57`/`c6304232`/
   `25f4f8fb`). All admin-editable email templates now use mustache `{{token}}`, replacing
   legacy `[bracket]` in the transactional emails (reviewer acceptance/withdraw/reminders +
   grantee invite/reminder). Resolvers are DUAL-SYNTAX during a soak; new grantee-invite
   SUBJECT resolution. Migration (`scripts/migrate-email-token-syntax.mjs`) rewrote 6 admin
   bodies + 2 per-user `grantee_invite_body` rows, preserving live copy byte-for-byte;
   verified 0 brackets remain. See `[[project-email-template-token-syntax]]`.

### Commits
- `036564ec` — Reconcile W6 drain-table-drop plan/memory: mark DONE, kill stale P0 trigger
- `9372a75d` — Reviewer emails: stage-aware secure-link button label (admin-editable)
- `3817944e` — Fold Codex review: escape button label + suppress thankyou button
- `ae475d57` / `c6304232` — email token-syntax unification plan (draft → v2.1)
- `0222a7a0` — Unify email templates on mustache {{}} syntax (dual-syntax transition)
- `25f4f8fb` — Mark email token-syntax plan EXECUTED (2026-07-01)

## Next Items

### Verified Open

1. **Bracket-alias cleanup PR (email templates).** The token unification (S311) left the
   System-B resolvers DUAL-SYNTAX (accept both `[x]` and `{{x}}`) deliberately, for a soak.
   After confidence, a cleanup PR should drop the legacy `[bracket]` aliases so only mustache
   remains. Do NOT remove them before this is greenlit — they're intentional, not dead code.
   Evidence: `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` §5; `[[project-email-template-token-syntax]]`.
2. **Surface the 3 board-identity fields on Track Reviewers (read-only) + Excel export.**
   Carried S308→S311, still NOT built. my-candidates DTO emits
   `academicRank`/`primaryDepartment`/`mainInstitution` (`my-candidates.js:214-216`) and
   `CandidateEditModal` edits them, but Track Reviewers cards + the workbook don't show them.
   Evidence: `docs/REVIEWER_STAGE2A_IDENTITY_CAPTURE_BUILD_PLAN.md` §C step 9.
3. **Optional invite-modal follow-up: collapse the campaign-timeline block** into a
   `<details>` for more message-body room. Offered S310, not greenlit. Low effort.
   Evidence: `shared/components/reviewers/InviteEmailModal.js` (timeline block ~L294-319).
4. **Reviewer nice-to-haves #4 & #5 unbuilt.** #4 reviewer-memory flag + searchable notes;
   #5 controlled expertise-tag taxonomy / editable tags (free-text export shipped S308).
   Evidence: `docs/REVIEWER_WORKBENCH_NICE_TO_HAVES_PLAN.md` §4, §5.
5. **Optional `wmkf_firstname` trailing-whitespace second pass.** Low-priority hygiene; the
   `wmkf_name` cleanup did NOT cover it. Evidence: `docs/agent-wiki/topics/dataverse-dynamics.md`.

### Owner Decision Needed

1. **Writeup-generator tab + reviewer-database browse.** On the docket (S308); board-identity
   fields feed them. Needs scope/prioritization. Evidence: `.claude-memory/project-workbench-consolidation-rollout.md`.
2. **Remit-flag on review-completion** — wire `wmkf_authorizationtoremitpaymentflag` on submit?
   Carried S304/S305. Evidence: `.claude-memory/project-honorarium-payment-landscape.md`.

### Parked

1. **Honorarium payment pipeline enablement.** Capture-only in prod (S309):
   `HONORARIUM_ONBOARDING_DEFERRED` + 3 discriminator GUIDs absent force `isCaptureOnly()`.
   Re-open trigger: leadership decision. Evidence: `lib/bill/honorarium-onboard-orchestrator.js:47-56`.
2. Longer carried list (BILL API access, PNI self-report, workbench access boundaries,
   applicant-exclusion, Dataverse settings audit, nomenclature/app-sunset sweep).
   Re-open trigger: owner prioritization. Evidence: `.claude-memory/MEMORY.md` router.

### Do Not Reopen Without New Decision

1. **thankyou email has NO secure-link button (S311).** thankyou has no fallback label →
   the button is suppressed (a body with a review link renders a plain link). Intentional.
   Evidence: `pages/api/review-manager/send-emails.js` `DEFAULT_REVIEW_BUTTON_LABELS`; `3817944e`.
2. **`{{proposalTitle}}` vs `{{proposalClause}}` are distinct, not interchangeable (S311).**
   Bare title vs full null-safe clause. Don't "consolidate" them. Evidence: `[[project-email-template-token-syntax]]`.
3. **Email template dual-syntax `[bracket]` aliases are intentional (S311), not dead code.**
   Don't remove until the cleanup PR (Verified Open #1) is greenlit.
4. **h-index is NOT staff-editable in edit modals (S310).** Server route still accepts `hIndex`
   from other callers — intentional. Evidence: `CandidateEditModal.js`; `204086ec`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/EMAIL_TOKEN_SYNTAX_UNIFICATION_PLAN.md` | Token-unification plan + EXECUTED record (S311). |
| `scripts/migrate-email-token-syntax.mjs` | Dual-layer token migration (dry-run-first; already executed S311). |
| `shared/config/editableTextDefaults.js` | Admin-editable email catalog + placeholder hints (all mustache). |
| `lib/external/{reviewer-reminder,reviewer-withdraw,grantee-invite}-email.js` | Dual-syntax System-B resolvers. |
| `pages/api/external/review/[token]/respond.js` | Acceptance-confirmation resolver (dual-syntax). |
| `shared/config/granteeInviteEmail.js` | `fillInviteBody` + new `fillInviteSubject` (client-side grantee composer). |
| `pages/api/review-manager/send-emails.js` | Stage-aware button label (`DEFAULT_REVIEW_BUTTON_LABELS`, `resolveReviewButtonLabel`). |

## Testing

```bash
npx jest tests/unit/email-token-resolvers.test.js \
  tests/unit/migrate-email-token-syntax.test.js \
  tests/integration/send-emails-route.test.js
npm test   # full suite (283 suites / 3571 tests green as of S311)
node scripts/migrate-email-token-syntax.mjs   # dry-run: expect adminChanged=0 (already migrated)
```
