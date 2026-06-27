---
agent_wiki: topic
status: active
last_verified: 2026-06-10
stale_after_days: 60
owner: reviewer-finder
source_files:
  - pages/external/review/[token].js
  - pages/api/external/review/[token]/context.js
  - pages/api/external/review/[token]/proposal.js
  - pages/api/external/review/[token]/respond.js
  - pages/api/external/review/[token]/upload.js
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

## Recurring Hazards

- **Real-prod accept fires a live automation chain — never run automated/unfenced prod accept tests.**
  A reviewer accept CREATEs a honorarium `akoya_request`, which fires AkoyaGo plugins
  + classic workflows + a live Bill.com payment flow + a contact→Business-Central sync.
  **MOCK the data layer** for automated tests; a real-prod accept is a human-supervised
  one-off gated on the Power-Automate owner (Connor) confirming the honorarium/payment
  flows won't act. Read-only probe: `scripts/probe-dataverse-automation.js`. Full
  hazard: memory `project-reviewer-accept-prod-automation`.
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
  generation or response handling can silently break in-flight invitations; see
  memory `project-reviewer-accept-decline-links`.

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
