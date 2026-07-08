# Session 348 Prompt: Staff manual-review rescue tool, or next priority

## Session 347 Summary

Reviewer-workbench UX session: verified the long-carried abstract-edit gate live,
then acted on two owner UX asks — surfaced the permanent-delete on active reviewer
rows (discoverability), and cleaned the PDF-email-era holdovers off the Track
Reviewers panel now that reviews are structured (portal `/submit`), not files.

### What Was Completed

1. **Abstract-edit gate + 409 compare-and-set — UI-VERIFIED live (no code change).**
   Drove the real invite modal on real request #1002794 (abstract confirmed still
   hard-wrapped): amber "hard line breaks" banner renders, editor seeds with reflowed
   text, "Revert to original" shows the stored wrapped text, and a stale-`expectedCurrent`
   POST returns 409 with zero write (re-read confirmed abstract unchanged). Did NOT click
   Save (the durable write) per owner's call — its React handler stays unit-covered.
   This closes S347 "Verified Open #1".

2. **"Remove entirely" discoverability fix (Owner Decision, resolved) — `ac549b23`.**
   Added a single **"Remove ▾"** menu to active candidate rows in `ReviewerInvitePanel`
   offering "Remove from this proposal" (recoverable soft-delete) + "Delete permanently…"
   (opens the existing `RemoveEntirelyModal`). Default-expanded the "Removed (N)" list.
   UI-only routing; no service/API change. Verified live on #1002794.

3. **Track Reviewers legacy cleanup — `a1354ed9` + `433d2b42`.** Removed the two
   PDF-email-era holdovers from `ReviewerManagePanel`'s ⋮ menu: **"Staff upload (override)"**
   (file upload) and **"Mark received (no file)"** — a modern review is structured
   `wmkf_appreviewanswer` data via the portal, not a file. Backend routes/services
   (`/upload-review`, `/mark-received-no-file`, `review-upload.js`) RETAINED unchanged.
   Deleted now-orphaned `ReviewFormFields.js` (zero importers; couldn't render rich-text
   anyway). Verified live on #1002365 (⋮ menu now shows only Generate/Revoke link + Remove).

4. **Docs/memory reconciled.** Updated agent-wiki `external-reviewer-portal` +
   `reviewer-workbench-lifecycle`, `project-reviewer-upload-dormant-not-deleted` (staff-side
   removal), dated the stale "today" framing in `project-reviewer-lifecycle-automation`, and
   created `project-staff-review-rescue-tool` (owner action item) + router line. All doc
   gates green; lint 0 errors; `check:types` + 56 route/service tests pass.

### Commits (all on main)
- `ac549b23` feat(reviewers): surface permanent-delete on active rows via Remove menu — **pushed**
- `a1354ed9` refactor(reviewers): remove legacy staff-upload + mark-received from Track Reviewers
- `433d2b42` refactor(reviewers): delete orphaned ReviewFormFields.js

## Next Items

### Verified Open

1. **Build the staff "manual review rescue" tool.**
   Evidence: `project-staff-review-rescue-tool.md`; `project-reviewer-upload-dormant-not-deleted.md`.
   Owner ask (S347): a dedicated edge-case surface (NOT on the Track Reviewers panel) to
   manually enter a full structured review when the portal breaks. Must mirror the FULL
   `ReviewAuthoringForm` (3 rating radios + 8 rich-text answers via `getActiveQuestionSet`),
   not the deleted `ReviewFormFields`. Backend routes already exist — prefer routing a full
   structured entry through the portal's producer `lib/external/build-review-submission.js`
   so a staff-entered review is indistinguishable from a portal one. Needs an owner call on
   placement (admin/superuser surface vs. Reviews tab).

### Owner Decision Needed

1. **Reviewer closeout-payability design.** Evidence: `project-reviewer-closeout-payability.md`
   (owner ask S343). Payable/not-payable flag + potential/invited reset button. Needs build-shape
   decision. (Carried, unchanged.)
2. **Staff rescue tool placement.** Evidence: `project-staff-review-rescue-tool.md`. Where the
   manual-entry surface lives (admin page vs. Reviews tab) — decide before building #1 above.
3. **How far to push the TS `check:types` gate.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.
   Optional ratcheting beyond the closed untrusted surface. (Carried, unchanged.)

### Parked

1. "No longer needed" release for ACCEPTED reviewers. Evidence: this session's discussion —
   `withdraw-sufficient` only targets invited-pending reviewers (server-guarded); there is no
   courteous stand-down path for an accepted reviewer, only silent removal. Re-open if the owner
   wants that flow (they paused mid-discussion).
2. Residual prompt-legacy write-path audit ([ASSUMED]). Evidence: `project-prompt-legacy-audit-followup.md`.
3. Spec-audit design-docs recovery (work computer). Evidence: `project-spec-audit-docs-recovery-parked.md`.
4. Product/UX asks: review-output formatting (`project-review-output-formatting.md`), campaign-settings
   UX revisit (`project-campaign-settings-ux-revisit.md`).
5. Project-wide prompt-cache-hit audit. Evidence: `project-cache-hit-rate-review.md`.
6. Dependabot #53 merge once real tests green. Evidence: `gh pr checks 53`.

### Do Not Reopen Without New Decision

1. **Track Reviewers legacy upload/mark-received removal is intentional (S347).** Evidence:
   `project-reviewer-upload-dormant-not-deleted.md`, agent-wiki `external-reviewer-portal`.
   Reviews are structured portal `/submit` data, not files. Don't re-add "Staff upload (override)"
   or "Mark received (no file)" to the panel; the capability returns via the rescue tool (Verified
   Open #1). Backend routes are retained-not-dead — don't delete them.
2. **`ReviewFormFields.js` was deleted (S347).** Evidence: `433d2b42`. It rendered only
   string+picklist (no rich-text). Don't resurrect it for the rescue tool — use `ReviewAuthoringForm`.
3. **"Remove entirely" is now on active rows via the Remove ▾ menu (S347).** Evidence: `ac549b23`,
   `reviewer-workbench-lifecycle.md`. The two-step-behind-Removed-section design was the thing being
   fixed; don't revert it.
4. **Local dev auth is correctly configured (S346).** Evidence: `project-local-dev-auth-setup.md`.
   `AUTH_REQUIRED=true` + `EXTERNAL_LINK_SECRET` in `.env.local`. Don't re-diagnose the
   "wrong user"/`missing_secure_link` symptoms as new bugs.
5. **DynamicsService decomposition COMPLETE (S345); peer-review Executor migration SHIPPED (S344);
   4 PDF-upload apps SUNSET (S344).** Evidence: respective plan docs + memories. Don't re-inline,
   "restore" legacy generators, or re-add sunset app keys.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/ReviewerInvitePanel.js` | Invite tab; `RowRemoveMenu` (Remove ▾) + abstract-edit gate |
| `shared/components/reviewers/ReviewerManagePanel.js` | Track Reviewers tab; `TokenActionsMenu` (Generate/Revoke/Remove after S347 cleanup) |
| `shared/components/external/ReviewAuthoringForm.js` | Live reviewer structured-review form (`/submit`); the model for the rescue tool |
| `lib/external/build-review-submission.js` | Canonical structured-review producer (portal `/submit`); reuse for the rescue tool |
| `lib/services/review-manager/mark-received-no-file-service.js` | Retained structured no-file receipt route (backend for rescue tool) |
| `.claude-memory/project-staff-review-rescue-tool.md` | S348 build target — the rescue-tool action item |

## Testing

```bash
npm run lint && npm run check:types
npx jest mark-received upload-review review-manager   # 56 tests, backends intact
# Local reviewer-workbench UI: REVIEWER_EMAIL_DELIVERY_MODE=capture npm run dev
#   Track Reviewers menu: /workbench/<guid>?tab=reviewers&sub=track
#   Invite Remove ▾ menu:  /workbench/<guid>?tab=reviewers&sub=candidates
# .env.local needs the S346 auth setup (AUTH_REQUIRED=true, EXTERNAL_LINK_SECRET, Azure AD vars)
```
