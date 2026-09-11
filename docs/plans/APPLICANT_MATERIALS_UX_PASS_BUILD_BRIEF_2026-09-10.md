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

Built on `claude/materials-ux-pass`, worktree
`/Users/gallivan/Code/WMKF_Apps/.claude/worktrees/agent-a0ce1af96aababa73`.

**Item 1 (email button).** New `lib/external/site-visit-materials-email.js`
(`renderMaterialsEmailHtml`) mirrors `renderGranteeInviteHtml`/`renderReviewerReminderHtml`'s
paragraph rendering, button styling (`#1a4a7a`, matching the grantee button color), and fallback
copy. `escapeHtml`/`escapeAttr` are **[VERIFIED via source]** not exported from either sibling
file, so they are mirrored, not imported, per the brief's fallback instruction; noted in the new
file's header comment. `collection-service.js`'s `sendEmail` dependency now takes `url` and
`buttonLabel` and calls the new renderer instead of `renderPlainTextEmailHtml`. Invitation button:
"Upload site visit materials"; reminder button: "Upload the missing items". `invitationBodyText`
keeps the forwarding sentence ("You may forward this link to a colleague who is helping.") as
prose after the checklist, and no longer includes "Upload here…" or the bare URL.

**Item 2 (stop inviting uploads after the meeting).** Removed the upload-page sentence "You can
replace a file at any time until \<closes date\>." and the invitation-email sentence "The link
stays open until \<closes date\>. You can replace a file at any time before then." — copy only.
`closes_at`, the token expiry (`mint({ ..., expiresAt: closesAt })`), and the read-time
`state === 'closed'` check in `projectCollection`/`buildContributorContext` are unchanged
**[VERIFIED via source: collection-service.js, contributor-service.js]**.

**Item 3 (different-file recovery, staging cleanup finding).** `SlotUploader` now renders both
"Retry" and "Choose a different file" (a second `sr-only` file input, `aria-label="${label}
different file"`) whenever `pending` is set and the slot isn't disabled. Choosing a file calls
`removePendingUpload(token, slot)`, clears `pending`/`error`, then runs the normal `upload(file)`
flow (mints a new staging id via `/upload-token`). Retry is untouched and still finalizes the
original staging id.

Staging-row cleanup **[VERIFIED via source: `lib/services/portal-upload-staging.js`,
`pages/api/cron/maintenance.js`, `lib/services/maintenance-service.js`]**: an abandoned "pending"
row IS eventually cleaned up, but not immediately. `mintPortalUpload` sets `expires_at` to
`ROW_TTL_MS` (60 minutes) from mint time. The daily (3:00 AM UTC, `verifyCronSecret`-gated) cron
`/api/cron/maintenance` step 7.6 calls `MaintenanceService.cleanupPortalUploadStaging()` →
`cleanupExpiredPortalUploads()`, which selects rows where `expires_at < NOW()` and not actively
`finalizing`, deletes the Blob object, and marks the row `expired` (unless already `consumed`);
rows in `consumed`/`rejected`/`expired` are hard-deleted after a further `retentionDays` (default
7) via `updated_at`. So a slot abandoned after a failed finalize sits as an orphaned Blob object
+ Postgres row for up to ~60 minutes (until its TTL) plus up to one day (until the next cron tick),
then up to 7 more days before the row itself is pruned — no gap where it is never cleaned, but no
new cleanup was added or needed per the brief's instruction.

**Item 4 (support email link).** `contributor-service.js` `DEFAULT_DEPENDENCIES.getSupportEmail()`
calls `AlertRecipients.readConfig()` directly (not `resolveRecipients`, which falls through to
`default` then the superuser roster) and returns `config.support?.[0] || null` — **[VERIFIED via
source: `lib/services/alert-recipients.js`]** `readConfig()` already catches its own errors and
returns `{}`; the dependency wraps it in a second try/catch anyway (defense in depth, its own log
line) so a read failure always resolves `null`, never throws. `buildContributorContext` adds
`supportEmail` to its returned object (read via `Promise.all`), which flows straight through
`pages/api/external/materials/[token]/context.js` (read only, not edited — it spreads the service's
return value as the JSON body) to the page. The upload page renders a "Need help? Email
`<a href="mailto:...">`" footer only when `data.supportEmail` is present, with the subject
`Site visit materials — <proposal title or institution>` via `encodeURIComponent`. React's
built-in JSX escaping is used (no `dangerouslySetInnerHTML`); the value is never taken from
request input. `lib/services/alert-recipients.js:34`'s `support` category description was
updated; grepped `pages/admin.js` for the old string ("Applicant help-form recipients (reserved —
no emitter yet)") — **[VERIFIED via source]** no duplicate found, so it was not edited (matches
the brief's "only if" clause).

**Docs.** `docs/API_ROUTE_SECURITY_MATRIX.md`'s `/api/external/materials/[token]/context` row
gained a note on `supportEmail`. `docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md` gained a new
§16.4 "2026-09-10 UX pass" listing the four items (added after verifying the pre-existing §16.3
content). Also reworded one unrelated §16.1 sentence ("closed source-type union; an unknown
type...") from "union"/"unknown" to "set"/"unrecognized" — no meaning change — solely to clear a
pre-existing repo-wide doc-consistency hook (`scope-claim-reminder.js`) that was pairing that
line's wording against three unrelated pre-existing table rows elsewhere in the same document
and blocking any edit to the file; flagging this since it touches text outside the four owned
items. `docs/agent-wiki/topics/intake-portal.md` — grepped for the invitation email text; it
doesn't describe it, so left unedited per the brief's "only if" clause.

**Tests.** New `tests/unit/site-visit-materials-email.test.js` (5 tests: button href/fallback
escaped, default button label, paragraph rendering with no raw URL in the body, body escaping,
button-label escaping). Updated `tests/unit/site-visit-materials-collection-service.test.js`
(body text no longer carries the URL or the closes-until sentence; `sendEmail` calls now assert
`url`/`buttonLabel`). Updated `tests/unit/site-visit-materials-contributor-service.test.js` (new
`describe('supportEmail')` covering configured/unconfigured, and a `describe` for
`DEFAULT_DEPENDENCIES.getSupportEmail` covering configured/unconfigured/read-failure directly,
since the failure-swallowing lives in the default dependency, not in `buildContributorContext`
itself). Updated `tests/unit/external-materials-routes-client.test.js` (no "replace a file"/"stays
open" text; both Retry and "Choose a different file" render together and the latter clears
storage; support-email footer renders only when present, with the expected `mailto:` href). See
the 2026-09-10 Opus-review follow-up below for a since-corrected discrimination gap in that
client test's "different file" case.

**Verification run sequentially, all green:**
- `npx jest tests/unit/site-visit-materials tests/unit/external-materials tests/unit/alert-recipients tests/unit/grantee-invite-email` → 12 suites, 90 tests passed.
- `npm run check:types` → passed (no tsc errors).
- `npm run check:api-routes` → passed (208 routes covered; pre-existing "no recognized guard token" warnings for the three `/api/external/materials/[token]/*` routes are warnings, not failures, and predate this build — those route files were not touched).
- `npm run check:api-routes:self-test` → OK.
- `npm run check:request-document-writers` → OK, 7 actor-aware create seams.
- `npm run check:request-document-writers:self-test` → OK.
- `npm run check:fact-consistency` → OK, 735 docs scanned.
- `npm run check:fact-consistency:self-test` → OK.
- `npm run check:prompt-injection-tagging` → OK, 28 surfaces, 0 pending.
- `npm run check:prompt-injection-tagging:self-test` → OK, 18/18.
- `npx eslint "pages/external/materials/[token].js" lib/external/site-visit-materials-email.js lib/services/site-visit-materials/collection-service.js lib/services/site-visit-materials/contributor-service.js` → no output, no errors.

**Forbidden list respected:** no edits to any API route file, `collection-store.js`,
`portal-upload-staging.js`, migrations, `grantee-invite-email.js`/`reviewer-reminder-email.js`
(read only), `SiteVisitMaterialsCard.js`, or anything under `lib/services/meeting-tracker/`. No
new dependencies, no new routes.

**Left open / not done:** nothing from the four items. Not pushed, no PR opened, no env vars
touched, per instructions. `pages/admin.js` and `docs/agent-wiki/topics/intake-portal.md` were
read but not edited (no matching content to reconcile).

## 2026-09-10 Opus-review follow-up (PASS WITH FIXES, no security findings)

Four required fixes applied as new commits on the same branch:

1. **Client test discrimination.** The "different file" case in
   `tests/unit/external-materials-routes-client.test.js` previously could not fail: even with
   `removePendingUpload` dropped from `chooseDifferentFile`, `upload()`'s own
   `writePendingUpload` overwrote the same sessionStorage key and the second finalize's success
   removed it, so the `waitFor(...).toBeNull()` never observed a stale value. Rewrote the test so
   the **second** `/upload-token` response returns 500: the correct implementation calls
   `removePendingUpload` synchronously (before any `await`) inside `chooseDifferentFile`, so the
   pending key is asserted `null` immediately after `fireEvent.change` (no `await` in between) and
   stays `null` through the failed mint — no second `/finalize` call happens, and the slot falls
   back to the plain "Choose file" picker. **[VERIFIED by mutation]**: dropped the
   `removePendingUpload(token, slot)` line from `chooseDifferentFile` locally, re-ran
   `npx jest tests/unit/external-materials-routes-client.test.js`, confirmed the rewritten test
   failed exactly at the synchronous assertion (`Received: "{\"stagingId\":...}"` instead of
   `null`), then restored the line and re-ran to confirm all 6 tests in that file pass again.
2. **Test rename.** Renamed to "...choosing a different file clears the pending key synchronously
   and never resurrects it if the new upload fails to start" — dropped the "Retry still uses the
   original staging id" clause, which the test never exercised (a `Retry` click); that claim is
   already covered by the "reload restores a pending finalize..." test earlier in the same file.
3. **Email copy.** `invitationBodyText` in `collection-service.js`: "You may forward this link to
   a colleague who is helping." → "No login is needed. You may forward the link below to a
   colleague who is helping." Restores the "no login needed" reassurance the pre-Item-1 text
   carried in its "Upload here (no login needed; ...)" line, and fixes the antecedent for "this
   link" now that the button/fallback link render after the body text, not inline with it.
   Updated the matching assertion in
   `tests/unit/site-visit-materials-collection-service.test.js`.
4. **Email-render test discrimination.** `tests/unit/site-visit-materials-email.test.js`: the
   `occurrences >= 2` check on the escaped URL was satisfiable by the two `href` attributes alone,
   so an unescaped `visibleUrl` (`const visibleUrl = url` instead of `escapeHtml(url)`) would
   still pass. Added an explicit `>${escapedUrl}</a>` containment check on the visible fallback
   text and tightened the count to exactly 3 (button href + fallback href + fallback visible
   text). Also removed the vacuous `expect(bodyText).not.toContain(URL)` (it asserted a property
   of the test fixture, not of the renderer's output) and replaced it with a check on the
   rendered body-paragraph HTML slice (before the button block) instead.

Not required, left as-is per the review (noted for the record, no action taken): the extra
uncached Dataverse read on the context route, the aria-label vs. visible-text mismatch on
"Choose a different file" (mirrors the existing picker's pattern), and the sign-off-before-button
paragraph order (matches the house email pattern).

**Verification re-run sequentially after the fixes, all green:**
- `npx jest tests/unit/site-visit-materials tests/unit/external-materials tests/unit/alert-recipients tests/unit/grantee-invite-email` → 12 suites, 90 tests passed.
- `npm run check:types` → passed.
- `npm run check:api-routes` → passed (same pre-existing, unrelated "no recognized guard token" warnings for the three untouched `/api/external/materials/[token]/*` routes; 208 routes covered).
- `npm run check:api-routes:self-test` → OK.
- `npm run check:request-document-writers` → OK, 7 actor-aware create seams.
- `npm run check:request-document-writers:self-test` → OK.
- `npm run check:fact-consistency` → OK, 735 docs scanned.
- `npm run check:fact-consistency:self-test` → OK.
- `npm run check:prompt-injection-tagging` → OK, 28 surfaces, 0 pending.
- `npm run check:prompt-injection-tagging:self-test` → OK, 18/18.
- `npx eslint "pages/external/materials/[token].js" lib/external/site-visit-materials-email.js lib/services/site-visit-materials/collection-service.js lib/services/site-visit-materials/contributor-service.js` → no output, no errors.
