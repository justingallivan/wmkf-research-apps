---
title: Reviewer End-to-End Rehearsal Runbook
domain: reviewer-workbench
kind: runbook
status: active
summary: "Safe reviewer invitation and return rehearsal through browser mocks, capture-mode controlled writes, or an allowlisted live smoke."
canonical: false
cataloged: 2026-07-02
last_verified: 2026-09-01
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/CREDENTIALS_RUNBOOK.md
  - tests/unit/reviewer-invite-panel-invite-capture.test.js
  - tests/unit/invite-email-modal-capture.test.js
  - tests/integration/send-emails-route.test.js
---

# Reviewer End-to-End Rehearsal Runbook

Date: 2026-06-21

Purpose: rehearse the reviewer invitation and return flow while choosing an
explicit side-effect boundary. The browser-mocked path reaches no external data
service. Capture mode blocks real Dynamics email but is **not** a full Dataverse
sandbox.

This runbook covers the current browser-mocked, capture-mode, and allowlisted live
smoke loops. `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` governs which
mode is appropriate; `docs/CREDENTIALS_RUNBOOK.md` remains the source of truth for
environment-variable definitions and rotation guidance.

---

## Safety Boundaries

- `REVIEWER_EMAIL_DELIVERY_MODE=capture` is for non-production rehearsal only.
- The send route refuses capture mode when `VERCEL_ENV=production`.
- Capture mode skips Dynamics email send and returns the rendered email artifact
  in the send result. Contact promotion and ORCID back-propagation are absent
  from every invitation-send mode; they occur later on acceptance.
- Capture mode does **not** suppress every Dataverse write. Rendering a template
  containing the external-link placeholder persists a fresh token hash/expiry, and
  a captured invitation send with `markAsSent=true` still stamps invitation
  lifecycle state. Use only throwaway reviewer suggestions/requests when capture is
  connected to production Dataverse.
- The browser E2E tests mock external-reviewer portal data routes at the browser boundary. They render the real reviewer pages, but they do not reach Dataverse, SharePoint, Dynamics, or Blob storage.
- Do not use a real reviewer or a live production request for manual experiments unless you intend to create real lifecycle records.
- Do not set `EMERGENCY_AUTH_BYPASS=true` for testing. Use normal staff sign-in for live browser smoke tests, or run the local mocked rehearsal in development mode.

---

## Local Environment

Use a local or preview-like environment with these values:

```bash
REVIEWER_EMAIL_DELIVERY_MODE=capture
REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<local throwaway secret>
EXTERNAL_LINK_SECRET=<local throwaway secret>
```

Notes:

- `REVIEWER_PORTAL_BASE_URL` controls the base URL embedded in reviewer invitation links. Use `https://reviews.wmkeck.org` once DNS is live; before then, use the current deployed reviewer portal URL.
- `EXTERNAL_LINK_SECRET` must be present for generated reviewer links. Use a throwaway local value for rehearsals.
- Do not set `REVIEWER_EMAIL_DELIVERY_MODE=capture` in Vercel Production. The route rejects it, but the env should still remain `send` in production.

---

## Fast Local Verification

Run the invitation/capture unit and integration coverage:

```bash
npm test -- --runTestsByPath \
  tests/unit/reviewer-invite-panel-invite-capture.test.js \
  tests/unit/invite-email-modal-capture.test.js \
  tests/integration/send-emails-route.test.js \
  --runInBand
```

Expected:

- Candidates panel lets a program director select a candidate and open the invitation modal.
- The modal previews the rendered invitation.
- Sending in capture mode shows "Captured ... invitation email(s) for rehearsal."
- The result says no Dynamics email was sent.
- The captured artifact includes one paired `Yes, I Can Review` / `No, Not This Time`
  action at the secure-link position. The accept link carries
  `?action=accept`; the decline link carries `?action=decline`.
- The send route returns captured email artifacts and does not call Dynamics.

Run the reviewer portal browser rehearsal:

```bash
npx playwright test \
  tests/e2e/reviewer-accept.spec.js \
  tests/e2e/reviewer-captured-invite.spec.js \
  tests/e2e/reviewer-return-upload.spec.js \
  tests/e2e/program-director-invite.spec.js \
  --project=chromium
```

Expected:

- Stage 2a accept UX works, including policy acknowledgment gates.
- A captured `Yes, I Can Review` button opens the existing Stage 2a accept form,
  while `No, Not This Time` opens the existing decline/referral form.
- Reviewer accept posts the expected payload.
- Stage 2b return flow shows materials, accepts a review file, collects structured ratings, and posts multipart upload data to a browser mock instead of SharePoint/Dataverse.
- The Program Director reviewer-engagement rehearsal drives the real Workbench Reviewers tab through captured invite, campaign-settings edit, accepted-reviewer release, and "no longer needed" withdraw flows with all data routes mocked in the browser.

For just the Program Director reviewer-engagement rehearsal:

```bash
npm run test:e2e:reviewer-engagement
```

---

## Manual Director-Side Rehearsal

For the safest browser-first rehearsal, use the headed local mock harness:

```bash
npm run rehearse:reviewer-invite:browser
```

Expected:

- A headed browser opens the real Workbench `Reviewers -> Candidates` UI.
- The test candidate, a pending invitee, and an accepted reviewer are route-mocked in the browser.
- `campaign-config`, `withdraw-sufficient`, `render-emails`, `send-emails`, and external reviewer portal API routes are route-mocked in the browser.
- Selecting the candidate, sending the invitation, editing campaign settings, releasing accepted reviewers, releasing a pending invitee as "no longer needed", and opening the local reviewer link create no Dataverse records and send no Dynamics email.

Suggested click paths while the browser stays open:

1. `Candidates`: select `Dr. New Candidate (not invited)` -> `Send invitation` -> fill dates -> send.
2. `Campaign settings`: edit `Days to respond` / `Review due date` -> save.
3. `Invite`: `Release to reviewers` -> preview -> send.
4. `Candidates`: select `Dr. Pending Invitee (already invited)` -> `Release as no longer needed`.

There is no manual `Re-invite already-invited` button. The respond-by reminder mechanism remains implemented at `/api/cron/reviewer-reminders`, but its Vercel schedule has been paused since 2026-09-01. The staff reminder action also remains callable but is under a procedural production freeze because it rotates token authority. Rehearsals must not send a live reminder or substitute another link-bearing resend during the hold. For a pending invitee you want to drop, use `Release as no longer needed`.

Stop the rehearsal with `Ctrl-C` in the terminal that launched it.

For a capture-mode rehearsal against local/live APIs instead of browser route mocks:

1. Start the app locally with `REVIEWER_EMAIL_DELIVERY_MODE=capture`.
2. Open the Workbench request.
3. Go to `Reviewers` -> `Candidates`.
4. Select a candidate with an email address.
5. Click `Send invitation`.
6. Review the preview and timeline dates.
7. Click `Send ... invitation` and confirm.
8. Verify the modal shows a captured rehearsal result, not a normal sent result.
9. Expand the captured artifact and inspect:
   - recipient
   - subject
   - HTML body
   - one paired `Yes, I Can Review` / `No, Not This Time` action at the secure-link position
   - `?action=accept` / `?action=decline` destinations
   - assigned Program Director name and clickable email in the secure-link footer
   - fallback full URL

Expected: no real Dynamics email is sent. The captured artifact is the testable
email output. This path may still persist the token and invitation lifecycle fields
described under Safety Boundaries.

---

## Live Email Smoke

Use this only with test addresses you control. The smoke wrapper reuses
`scripts/smoke-test-candidate.mjs`, which creates a throwaway reviewer candidate
and records the GUIDs needed for cleanup.

1. Save a normal browser auth state for the deployed app:

```bash
npm run smoke:reviewer-invite:auth -- --base-url https://applications.wmkeck.org
```

Sign in in the opened browser, return to the terminal, and press Enter. The
state file is written under `.auth/`, which is gitignored.

2. Prepare a throwaway candidate on the dedicated test request:

```bash
TEST_REVIEWER_EMAIL_ALLOWLIST=your.test.address@example.org \
LIVE_REVIEWER_EMAIL_SMOKE=true \
npm run smoke:reviewer-invite:live -- prepare \
  --email your.test.address@example.org \
  --confirm-live-email
```

The wrapper refuses to run unless the target email is in
`TEST_REVIEWER_EMAIL_ALLOWLIST`.

3. Open the real Workbench in a headed browser:

```bash
TEST_REVIEWER_EMAIL_ALLOWLIST=your.test.address@example.org \
LIVE_REVIEWER_EMAIL_SMOKE=true \
npm run smoke:reviewer-invite:live -- open \
  --base-url https://applications.wmkeck.org \
  --auth-state .auth/reviewer-invite-smoke.json \
  --confirm-live-email
```

Review the candidate, preview the email, then manually click the real send
button. The final click sends a real Dynamics email to the allowlisted test
address.

4. Check the inbox and exercise the reviewer link.

   2026-06-21 live-smoke finding (now mitigated): accepting while taking the
   honorarium reached the post-accept honorarium path and sent a
   `honorarium_onboard_failed` alert because the deployed environment did not have
   `HONORARIUM_PROGRAM_ID`, `HONORARIUM_GRANTPROGRAM_ID`, or `HONORARIUM_TYPE_ID`
   configured. As of the **capture-only** change (same day), an unconfigured
   environment — or `HONORARIUM_ONBOARDING_DEFERRED=true` — now AUTO-DEFERS: the
   reviewer's contact + mailing address are still captured, but no `akoya_request`
   is minted and **no per-reviewer `honorarium_onboard_failed` email fires** (a
   single non-emailing `honorarium_capture_only` notice is recorded instead). So
   smoke reviewers no longer need to opt out to avoid alert spam. For the
   2026-07-01 no-BILL creation path, run
   `scripts/probe-honorarium-discriminators.js` against the target Dataverse
   environment, set those Vercel env vars (and clear any
   `HONORARIUM_ONBOARDING_DEFERRED`), and keep `BILL_ONBOARDING_DEFERRED=true`.
   That re-enables honorarium-record creation without firing BILL onboarding.

5. Clean up the smoke candidate:

```bash
npm run smoke:reviewer-invite:live -- cleanup
```

Cleanup removes the test person and suggestion rows recorded by the helper.
If a promoted CRM contact cannot be deleted due app-user permissions, the helper
reports the contact ID for manual cleanup.

2026-06-21 live-smoke cleanup note: the helper deleted suggestion
`91197773-aa6d-f111-ab0d-000d3a3064b7` and person
`8e197773-aa6d-f111-ab0d-000d3a3064b7`, but the app user lacked delete access
for promoted contact `c98806cf-aa6d-f111-ab0d-000d3a3065b8`
(`ZZZ Smoke Test (DELETE)` / `berets.eyeful-0f@icloud.com`). A Dataverse admin
should delete that contact manually before reusing the same smoke email.

---

## Manual Reviewer-Side Rehearsal

Use the captured artifact from the director-side rehearsal:

1. Copy the `Yes, I Can Review` link from the captured HTML.
2. Open it in a browser.
3. Confirm the domain shown in the address bar is the intended reviewer domain.
4. Accept the invitation.
5. Acknowledge the COI and AI-use policies.
6. Confirm the post-accept state.
7. For a Stage 2b test token/context, upload a small PDF/DOCX test file and complete the structured rating fields.

Expected: the reviewer-facing UX is understandable, links are branded as expected, and upload/structured-review controls behave correctly.

Repeat with `No, Not This Time` and confirm the existing decline form still
offers the optional referral field. Merely fetching either email URL must not
record a response; the existing portal POST remains the only state-changing
step.

---

## Deployed Smoke Checks

After DNS is live and Vercel env vars are deployed:

1. Confirm `REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org` in the relevant Vercel environment.
2. Generate a non-production captured invitation.
3. Verify the captured HTML contains `https://reviews.wmkeck.org/external/review/...`.
4. Open the link and confirm the page loads through `reviews.wmkeck.org`.
5. Confirm production still has `REVIEWER_EMAIL_DELIVERY_MODE=send`.

Do not run capture mode in Vercel Production. For production, the smoke check should be limited to verifying env configuration and link base URL before real invitations are sent.

---

## Relevant Automated Coverage

| Surface | Test |
|---|---|
| Workbench candidate selection -> invitation modal -> captured artifact | `tests/unit/reviewer-invite-panel-invite-capture.test.js` |
| Invitation modal capture result rendering | `tests/unit/invite-email-modal-capture.test.js` |
| Send route capture mode and production refusal | `tests/integration/send-emails-route.test.js` |
| Program Director reviewer-engagement rehearsal: captured invite, campaign settings, release to reviewers, no-longer-needed withdraw | `tests/e2e/program-director-invite.spec.js` |
| Captured email button -> reviewer portal accept | `tests/e2e/reviewer-captured-invite.spec.js` |
| Reviewer Stage 2a accept UX | `tests/e2e/reviewer-accept.spec.js` |
| Reviewer Stage 2b return/upload UX | `tests/e2e/reviewer-return-upload.spec.js` |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Captured artifact uses the Vercel URL | `REVIEWER_PORTAL_BASE_URL` is unset or still points at Vercel | Set `REVIEWER_PORTAL_BASE_URL` to the intended reviewer domain and redeploy |
| Capture mode errors in production | `REVIEWER_EMAIL_DELIVERY_MODE=capture` with `VERCEL_ENV=production` | Use capture only in local/preview; production should be `send` |
| Auth bypass warning email appears | `EMERGENCY_AUTH_BYPASS=true` was used in a production-mode process | Stop the process, verify the variable is absent from Vercel env, and use normal auth or the local development-mode mock harness |
| `WARNING — honorarium onboard failed` after reviewer accept | Reviewer accepted without opting out AND honorarium-create reached the discriminator assert — only possible when the GUIDs ARE configured but a later step failed (an UNconfigured env now auto-defers to capture-only, no alert) | Investigate the specific failure in the alert metadata. To intentionally suppress honorarium creation entirely, set `HONORARIUM_ONBOARDING_DEFERRED=true` (capture-only, no alert email; one non-emailing `honorarium_capture_only` notice per accept) |
| Playwright cannot launch Chromium | Browser binary is missing | Run `npx playwright install chromium` |
| Playwright cannot bind the test server port | Another server is using `3100` or sandbox blocked the bind | Stop the existing server or set `E2E_PORT=<free port>` |
| Reviewer link says invalid signature | `EXTERNAL_LINK_SECRET` differs between minting and verification | Use the same secret for the rehearsal environment |
