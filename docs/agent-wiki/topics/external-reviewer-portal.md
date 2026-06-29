---
agent_wiki: topic
status: active
last_verified: 2026-06-29
stale_after_days: 60
owner: reviewer-finder
source_files:
  - pages/external/review/[token].js
  - pages/api/external/review/[token]/context.js
  - pages/api/external/review/[token]/proposal.js
  - pages/api/external/review/[token]/respond.js
  - pages/api/external/review/[token]/upload.js
  - pages/api/external/review/[token]/draft.js
  - pages/api/external/review/[token]/submit.js
  - lib/external/build-review-submission.js
  - lib/external/review-question-fetcher.js
  - lib/external/review-form-schema.js
  - shared/components/external/ReviewAuthoringForm.js
  - shared/components/external/RichReviewEditor.js
  - shared/components/external/MaterialsView.js
  - lib/external/sanitize-review-html.js
  - lib/services/review-draft-service.js
  - lib/external/review-engagement-state.js
  - pages/api/review-manager/send-emails.js
  - pages/api/review-manager/regenerate-token.js
  - pages/api/review-manager/revoke-token.js
  - lib/utils/reviewer-invite.js
  - lib/utils/sharepoint-buckets.js
  - tests/e2e/reviewer-accept.spec.js
canonical_docs:
  - docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - tests/e2e/README.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - pages/external/review/**
  - pages/api/external/review/**
  - pages/api/review-manager/**
  - shared/components/external/**
  - tests/e2e/**
  - playwright.config.js
  - .github/workflows/e2e.yml
update_triggers:
  - external reviewer accept / decline / upload flow changes
  - review token issuance, regeneration, or revocation changes
  - reviewer-accept E2E harness or its mocks change
  - SharePoint file-bucket routing for review materials changes
---

# External Reviewer Portal

Use this page before work on the token-authed external reviewer surface: the
accept/decline flow, the materials/upload views, review-token lifecycle, the
Playwright E2E harness, and the live prod automation that an accept triggers.

## Ground Rules

- The external surface is **token-authed**, not user-authed: `pages/external/review/[token].js`
  + `pages/api/external/review/[token]/*` resolve a reviewer from an opaque token,
  not from a session identity. Preserve fail-closed token validation; never accept
  a reviewer/contact identity from request input.
- Token issuance/rotation lives in `pages/api/review-manager/` (`send-emails`,
  `regenerate-token`, `revoke-token`). A revoked/regenerated token must invalidate
  the old link.
- Review materials and uploaded files route through SharePoint buckets
  (`lib/utils/sharepoint-buckets.js`); confirm the bucket model in
  `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` before changing file paths.
- Invite-confidence gating (LOW-confidence recipients require per-recipient
  acknowledgement) is enforced in `send-emails.js` via `lib/utils/reviewer-invite.js` —
  see the [Reviewer Identity](reviewer-identity.md) page for the full gate semantics.

## Operating Notes

- **The stage2b "submit your review" surface is now in-browser authoring, not file upload (S301, Phase 2).**
  `MaterialsView` renders `ReviewAuthoringForm` (controlled) with the staff-editable
  question set (seeded as the 11 questions — 3 rating radios + 8 `RichReviewEditor`
  (tiptap) narrative answers + the affiliation field; now Dataverse-sourced, see the
  staff-editable-questions note below) — autosaving to
  Postgres `review_drafts` via the `GET/PUT /api/external/review/[token]/draft` route
  (`ReviewDraftService`). Reviewer HTML is UNTRUSTED: the draft PUT server-sanitizes
  every rich-text answer with `lib/external/sanitize-review-html.js` (DOM-free
  `sanitize-html`, never DOMPurify+jsdom) before persisting, and the staff render must
  re-sanitize. The file-upload route/infra (`upload.js`, `review-upload.js`) is RETAINED
  server-side but no longer surfaced in the UI (plan §7). **Final submit is LIVE (S302,
  Phase 3):** the wired Submit button POSTs to `pages/api/external/review/[token]/submit.js`,
  which finality-prechecks (409 if `wmkf_reviewreceivedat` set), server-sanitizes + validates
  (`lib/external/build-review-submission.js`: `validateReviewSubmission` + the single producer
  `buildReviewSubmission`), then writes ONE atomic `DynamicsService.executeChangeset`: the 11
  `wmkf_appreviewanswer` snapshot rows upserted by the **`_wmkf_appreviewersuggestion_value=<guid>`**
  alternate-key form (NOT the bare logical name — memory `reference-dataverse-altkey-lookup-upsert-url`)
  + the parent ratings/affiliation/receivedat PATCH guarded fail-closed by `If-Match`. Submit is
  FINAL — the form locks read-only, and both `/draft` PUT and the reviewer-token `upload.js` 409
  post-submit (P0-1). The engagement gate is the shared pure helper
  `lib/external/review-engagement-state.js::computeEngagementState`.
  **Phase 4 (read-back):** `/api/review-manager/reviewers` attaches the re-sanitized `answers[]`
  snapshot per submitted reviewer (keyed child read on `wmkf_appreviewanswers`), rendered by
  `ReviewsTab`. **Phase 5 (draft lifecycle):** the `review_drafts` scratchpad is deleted on submit,
  on token **revoke/regenerate** (`revoke-token.js`/`regenerate-token.js` — NOT `mintAndStore`,
  which runs on benign resends), and GC'd at 90d by the maintenance cron. The hidden-not-deleted
  file-upload path: memory `project-reviewer-upload-dormant-not-deleted`.
  **The whole epic (Phases 0–5) is COMPLETE (S302).**
  Full plan: `docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md`.
- **The review question SET is staff-editable (Dataverse `wmkf_reviewquestion`), not hardcoded — Phase A+B LIVE (S303–S304).**
  `lib/external/review-question-fetcher.js::getActiveQuestionSet()` (cached, single-flight,
  **fail-closed** — context/draft/submit 500 if the set can't load) is the runtime source. The
  reviewer routes read it: `context.js` attaches `questions` + `questionSetVersion` (stage2b only);
  `ReviewAuthoringForm` renders from `data.questions` as a prop (no static import); `submit.js`
  echoes `setVersion` back and 409s `set_changed` if the staff set changed mid-edit (client shows a
  distinct reload prompt). Draft load reconciles type-aware — a draft value whose shape ≠ the current
  field type is discarded. `lib/external/review-form-schema.js` is RETAINED as the field-shape +
  seed + helper source (`reviewParentColumnByKey` dual-write binding, label decoders) and the
  dormant default param; the seeded set is byte-identical to it, so behavior is unchanged. Staff
  upload (`ReviewFormFields`/`ReviewerManagePanel`) + the two legacy `validateReviewForm` paths
  stay on the static default until Phase C/D. Plan: `docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md`.
- **Prod accept triggers a live automation chain — keep automated tests mocked/fenced.**
  A reviewer accept CREATEs a honorarium `akoya_request`, which fires AkoyaGo plugins
  + classic workflows + a live Bill.com payment flow + a contact→Business-Central sync.
  **MOCK the data layer** for automated tests; a real-prod accept is a human-supervised
  one-off gated on the Power-Automate owner (Connor) confirming the honorarium/payment
  flows won't act. Read-only probe: `scripts/probe-dataverse-automation.js`. Full
  detail: memory `project-reviewer-accept-prod-automation`.
- **Accept now writes reviewer self-reported identity onto the linked CRM contact (2026-06-27).**
  On accept, `respond.js` syncs corrected first/last/title/nickname → `contacts.firstname/lastname/
  jobtitle/nickname` (OVERWRITE, reviewer-self-report-wins, silent; `lib/services/sync-reviewer-name-title-to-contact.js`,
  fail-closed `trusted:true`), and raises staff alerts (NO write) when the accept email differs from
  `contacts.emailaddress1` (`reviewer_contact_email_mismatch`; `lib/services/alert-reviewer-email-mismatch.js`)
  or the reported affiliation differs from the contact's institution (`reviewer_contact_affiliation_mismatch`;
  `lib/services/alert-reviewer-affiliation-mismatch.js`).
  These contact writes feed the same Business-Central sync as above — mock the data layer in tests.
  Full decision record: `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` §"Increment 2a".
- **E2E harness runs against a real build, not `next dev`.** The Playwright
  reviewer-portal harness (`tests/e2e/`, `npm run test:e2e`) mocks the data layer and
  runs against `next build --webpack && next start` — NOT `next dev`. It is CI-gated
  by `.github/workflows/e2e.yml`. Setup + mock conventions: `tests/e2e/README.md` and
  memory `project-e2e-playwright-harness`.
- **External reviewers get scoped file access.** Confirm the access path and
  expiry model before widening what an external token can read; see memory
  `project-external-reviewer-file-access` and `project-sharepoint-integration`.
- **Accept/decline links are durable, signed surfaces.** Changes to link
  generation or response handling need an in-flight invitation compatibility check;
  see memory `project-reviewer-accept-decline-links`.

## Durable Memory

- File access and SharePoint: `project-external-reviewer-file-access`, `project-sharepoint-integration`.
- Accept/decline links and prod automation: `project-reviewer-accept-decline-links`, `project-reviewer-accept-prod-automation`.
- E2E harness: `project-e2e-playwright-harness`.

## Standard Probe

```bash
rg -n "regenerateToken|revokeToken|reviewToken|emailConfidence|akoya_request|honorarium" lib pages tests docs
```

Then read the relevant `pages/api/external/review/[token]/*` route and its
review-manager counterpart in full before changing token or file behavior.
