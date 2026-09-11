---
title: "Build D — Applicant materials UX pass: email button, closing copy, different-file recovery, support link"
status: active
owner: Claude Fable (orchestrating); Sonnet builder; Opus reviewer
created: 2026-09-10
---

# Build D — Applicant materials UX pass

Owner feedback after the first production smoke of the applicant materials path
(2026-09-10, ZZTEST-03). Four items, one build, one PR.

## Item 1 — Invitation and reminder emails carry an action button plus a fallback link

Today `lib/services/site-visit-materials/collection-service.js` renders both emails through
`renderPlainTextEmailHtml(bodyText)` with the raw contributor URL as a paragraph. The grantee
and reviewer emails instead use a server-injected button plus the "If the button does not
work, copy and paste this secure link into your browser" fallback
(`lib/external/grantee-invite-email.js` `renderGranteeInviteHtml`,
`lib/external/reviewer-reminder-email.js` `renderReviewerReminderHtml`).

- Add `lib/external/site-visit-materials-email.js` exporting
  `renderMaterialsEmailHtml({ bodyText, url, buttonLabel })`, modeled on
  `renderGranteeInviteHtml` (same paragraph rendering, same escaping helpers, same button
  styling, same fallback paragraph). Reuse the shared helpers those files import rather than
  copying them if they are exported; otherwise mirror them and say so.
- `invitationBodyText` and `reminderBodyText` no longer include the URL lines
  ("Upload here …" and the bare URL). Keep the forwarding sentence in the invitation as
  prose: "You may forward this link to a colleague who is helping." placed after the list.
- `sendEmail` dependency in `collection-service.js` gains `url` and `buttonLabel` and calls
  the new renderer. Invitation button: "Upload site visit materials". Reminder button:
  "Upload the missing items".
- Tests: new `tests/unit/site-visit-materials-email.test.js` (button href is the URL,
  escaped; fallback shows the visible URL; body paragraphs escaped; no raw URL paragraph).
  Update `tests/unit/site-visit-materials-collection-service.test.js` for the changed body
  text and the new sendEmail arguments.

## Item 2 — Stop inviting uploads after the meeting

The link technically stays open until the visit plus seven days (`closes_at`), but the
Foundation does not want materials arriving after the meeting.

- Upload page `pages/external/materials/[token].js` line ~234: the sentence becomes
  "Please upload the items below by <due date>." Remove "You can replace a file at any time
  until <closes date>." entirely.
- Invitation email: remove the line "The link stays open until <closes date>. You can
  replace a file at any time before then." entirely. Do not replace it with anything.
- Do not change `closes_at`, the token expiry, or the auto-close behavior. This is copy only.
- Tests: update the page test in `tests/unit/external-materials-routes-client.test.js` if it
  asserts that sentence; update the collection-service email text tests.

## Item 3 — After a failed finalize, allow a different file

When a finalize fails, the slot keeps the pending staging id in sessionStorage and offers
only "Retry", which re-finalizes the same bytes. There is no way to pick a different file
without clearing browser storage.

- In `SlotUploader`, when `pending` is set and the slot is not disabled, render BOTH:
  the existing "Retry" button, and a second control "Choose a different file" that is a file
  input (same `sr-only` input pattern as the normal picker). Choosing a file calls
  `removePendingUpload(token, slot)`, clears `pending` and `error`, then runs the normal
  `upload(file)` flow, which mints a new staging id.
- The abandoned staging row is left alone client-side. Before writing code, verify how
  stale `pending` rows in `portal_upload_staging` are expired or cleaned (grep
  `portal_upload_staging` under `pages/api/cron` and `lib/services/portal-upload-staging.js`
  for a sweep or TTL). Record what you found in the handoff with [VERIFIED via …]. If nothing
  cleans them, say so plainly; do not add a cleanup in this build.
- Keep the guarantee that "Retry" never mints a second upload for the same file.
- Tests: in the client test, a slot with a pending upload shows both controls; choosing a
  different file clears the pending key and POSTs a new upload-token request; Retry still
  POSTs finalize with the original staging id.

## Item 4 — Support email link at the bottom of the upload page

Admin → alert recipients has a `support` category described as "Applicant help-form
recipients (reserved — no emitter yet)" (`lib/services/alert-recipients.js:34`), currently
set to `portalhelp@wmkeck.org` in production. Use it.

- `lib/services/site-visit-materials/contributor-service.js` context builder: add
  `supportEmail` to the returned object, read through a new injected dependency
  `getSupportEmail()` that resolves the first configured address in the `support` category
  via the alert-recipients service (read its exported API first; do not fall back to the
  `default` category, which is for ops alerts). Read failure or no address → `null`,
  logged, never thrown.
- Upload page: below the checklist and the "Other files received" section, render a footer
  paragraph only when `supportEmail` is present: "Need help? Email
  <a href="mailto:…?subject=…">portalhelp@wmkeck.org</a>." The subject is
  `Site visit materials — <proposal title or institution>` URL-encoded. Plain text
  otherwise; no form, no new route.
- `lib/services/alert-recipients.js:34`: change the description to "Applicant support
  address shown on the external materials upload page (first address is displayed)".
  Check `pages/admin.js` for a duplicate of that string and update it too.
- Docs: `docs/API_ROUTE_SECURITY_MATRIX.md` row for `/api/external/materials/[token]/context`
  notes the new `supportEmail` field and its source setting.
- Tests: contributor-service context test covers configured / unconfigured / read-failure;
  client test renders the mailto only when present.

## Owned files

`lib/external/site-visit-materials-email.js` (new),
`lib/services/site-visit-materials/collection-service.js`,
`lib/services/site-visit-materials/contributor-service.js`,
`pages/external/materials/[token].js`, `lib/services/alert-recipients.js` (one string),
`pages/admin.js` (only if the string is duplicated there), the tests named above,
`docs/API_ROUTE_SECURITY_MATRIX.md`, `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` (append a
short "2026-09-10 UX pass" note under §16 listing the four items), and the agent-wiki page
`docs/agent-wiki/topics/intake-portal.md` only if it describes the invitation email text.

## Forbidden

Every API route file, `collection-store.js`, `portal-upload-staging.js`, migrations, the
grantee and reviewer email files (read them, do not edit), `SiteVisitMaterialsCard.js`,
anything under `lib/services/meeting-tracker/`. No new dependencies, no new routes.

## Verification (sequentially, in the worktree)

```bash
npx jest tests/unit/site-visit-materials tests/unit/external-materials tests/unit/alert-recipients tests/unit/grantee-invite-email
npm run check:types
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:request-document-writers && npm run check:request-document-writers:self-test
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npx eslint pages/external/materials/[token].js lib/external/site-visit-materials-email.js lib/services/site-visit-materials/collection-service.js lib/services/site-visit-materials/contributor-service.js
```

## Handoff (builder fills in)

State claims labeled [VERIFIED via …] or [ASSUMED]. Commits, test counts, gates run, the
staging-row cleanup finding from Item 3, anything left open.
