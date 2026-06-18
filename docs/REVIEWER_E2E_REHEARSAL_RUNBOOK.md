# Reviewer End-to-End Rehearsal Runbook

Date: 2026-06-18

Purpose: rehearse the reviewer invitation and return flow without sending real Dynamics email, without writing test review files to SharePoint, and without polluting production Dataverse data.

This runbook covers the current no-send local rehearsal loop. It complements `docs/CREDENTIALS_RUNBOOK.md`, which remains the source of truth for environment-variable definitions and rotation guidance.

---

## Safety Boundaries

- `REVIEWER_EMAIL_DELIVERY_MODE=capture` is for non-production rehearsal only.
- The send route refuses capture mode when `VERCEL_ENV=production`.
- Capture mode skips Dynamics email send, skips contact promotion/back-propagation, and returns the rendered email artifact in the send result.
- The browser E2E tests mock external-reviewer portal data routes at the browser boundary. They render the real reviewer pages, but they do not reach Dataverse, SharePoint, Dynamics, or Blob storage.
- Do not use a real reviewer or a live production request for manual experiments unless you intend to create real lifecycle records.

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
  tests/unit/candidates-panel-invite-capture.test.js \
  tests/unit/invite-email-modal-capture.test.js \
  tests/integration/send-emails-route.test.js \
  --runInBand
```

Expected:

- Candidates panel lets a program director select a candidate and open the invitation modal.
- The modal previews the rendered invitation.
- Sending in capture mode shows "Captured ... invitation email(s) for rehearsal."
- The result says no Dynamics email was sent.
- The captured artifact includes the HTML body with the `Start Review` link.
- The send route returns captured email artifacts and does not call Dynamics.

Run the reviewer portal browser rehearsal:

```bash
npx playwright test \
  tests/e2e/reviewer-accept.spec.js \
  tests/e2e/reviewer-captured-invite.spec.js \
  tests/e2e/reviewer-return-upload.spec.js \
  --project=chromium
```

Expected:

- Stage 2a accept UX works, including policy acknowledgment gates.
- A captured `Start Review` button opens the real external reviewer portal page.
- Reviewer accept posts the expected payload.
- Stage 2b return flow shows materials, accepts a review file, collects structured ratings, and posts multipart upload data to a browser mock instead of SharePoint/Dataverse.

---

## Manual Director-Side Rehearsal

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
   - `Start Review` button/link
   - fallback full URL

Expected: no real Dynamics email is sent. The captured artifact is the testable email output.

---

## Manual Reviewer-Side Rehearsal

Use the captured artifact from the director-side rehearsal:

1. Copy the `Start Review` link from the captured HTML.
2. Open it in a browser.
3. Confirm the domain shown in the address bar is the intended reviewer domain.
4. Accept the invitation.
5. Acknowledge the COI and AI-use policies.
6. Confirm the post-accept state.
7. For a Stage 2b test token/context, upload a small PDF/DOCX test file and complete the structured rating fields.

Expected: the reviewer-facing UX is understandable, links are branded as expected, and upload/structured-review controls behave correctly.

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
| Workbench candidate selection -> invitation modal -> captured artifact | `tests/unit/candidates-panel-invite-capture.test.js` |
| Invitation modal capture result rendering | `tests/unit/invite-email-modal-capture.test.js` |
| Send route capture mode and production refusal | `tests/integration/send-emails-route.test.js` |
| Captured email button -> reviewer portal accept | `tests/e2e/reviewer-captured-invite.spec.js` |
| Reviewer Stage 2a accept UX | `tests/e2e/reviewer-accept.spec.js` |
| Reviewer Stage 2b return/upload UX | `tests/e2e/reviewer-return-upload.spec.js` |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Captured artifact uses the Vercel URL | `REVIEWER_PORTAL_BASE_URL` is unset or still points at Vercel | Set `REVIEWER_PORTAL_BASE_URL` to the intended reviewer domain and redeploy |
| Capture mode errors in production | `REVIEWER_EMAIL_DELIVERY_MODE=capture` with `VERCEL_ENV=production` | Use capture only in local/preview; production should be `send` |
| Playwright cannot launch Chromium | Browser binary is missing | Run `npx playwright install chromium` |
| Playwright cannot bind the test server port | Another server is using `3100` or sandbox blocked the bind | Stop the existing server or set `E2E_PORT=<free port>` |
| Reviewer link says invalid signature | `EXTERNAL_LINK_SECRET` differs between minting and verification | Use the same secret for the rehearsal environment |
