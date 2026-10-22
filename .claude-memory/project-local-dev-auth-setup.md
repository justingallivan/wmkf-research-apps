---
name: project-local-dev-auth-setup
description: Local `npm run dev` needs three separate things to behave like real staff auth (Azure AD creds, AUTH_REQUIRED=true, EXTERNAL_LINK_SECRET) — missing any one produces a confusing, NOT auth-error-shaped failure
metadata:
  type: project
  status: active
  last_verified: 2026-07-27 via auth source and key-only local .env.local inspection
---

## Recall Rule

Read this when: localhost appears signed in as the wrong person, Azure sign-in
loops, or reviewer invite minting reports `missing_secure_link`.

Do:
- Check presence/configuration of the Azure/NextAuth variables,
  `AUTH_REQUIRED=true`, and `EXTERNAL_LINK_SECRET`, then restart the dev server.
- Inspect only key presence for secrets; never print secret values.

Do not:
- Debug browser cookies before checking the auth kill switch.
- Reuse a production signing secret for local-only testing.

Ground truth: `lib/utils/auth-policy.js`, `shared/components/ProfileSelector.js`,
and `lib/services/external-token.js`. [VERIFIED 2026-07-27 via source plus a
key-only local `.env.local` check: `AUTH_REQUIRED=true` and
`NEXTAUTH_URL=http://localhost:3000`.]

S346 lost most of a session to what looked like three unrelated bugs (a "wrong
user" logged in with no sign-out button, then a `missing_secure_link` invite
skip) that were actually one root cause: `.env.local` on this machine was
missing local-dev auth plumbing that a stale memory claimed was already there
(see [[project-vercel-cli-deploy-preview-auth]], corrected S346).

**Checklist for local `npm run dev` to behave like a real signed-in staffer:**

1. **`AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` / `AZURE_AD_TENANT_ID` +
   `NEXTAUTH_URL=http://localhost:3000` + `NEXTAUTH_SECRET`** — without these,
   NextAuth's Azure provider can't complete a real sign-in.
2. **`AUTH_REQUIRED=true`** — this is the one that actually produced the
   confusing symptom. In non-production-mode dev/test, `lib/utils/auth-policy.js`
   requires both literal `AUTH_REQUIRED=true` and Azure credentials to enforce auth.
   Without them, auth is disabled and
   `shared/components/ProfileSelector.js` (dev-mode only, `AUTH_REQUIRED=false`
   gate per its own header comment) lets you silently pick any existing
   Postgres `user_profiles` row — including a real staffer's profile. This
   looks exactly like "I'm signed in as the wrong person and there's no
   sign-out button," and neither an app-level sign-out nor an Incognito window
   fixes it, because no real session was ever established. Restarting Chrome,
   clearing cookies, or hunting for a Microsoft SSO conflict are all dead
   ends for that historical configuration — check the current policy first.
   Production-mode processes, including `next start`, enforce auth unless the
   explicit emergency-bypass condition applies; missing `AUTH_REQUIRED` alone
   does not disable their auth. [VERIFIED via `lib/utils/auth-policy.js`, 2026-10-22]
3. **`EXTERNAL_LINK_SECRET`** (32+ chars) — needed to mint the reviewer
   accept/decline token. It's a purely internal HMAC key (sign+verify both
   happen in the same process, per `lib/services/external-token.js` header;
   never sent anywhere external), so **any throwaway 32+ char string works for
   local-only testing** — it does not need to match the real prod secret.
   Without it, `mintAndStore` fails silently and the invite send-safety gate
   correctly refuses with `missing_secure_link` (working as designed — see
   [[external-reviewer-portal]] topic page) rather than shipping a broken link.

**How to apply:** before debugging an auth-shaped symptom on `localhost:3000`
(wrong user, redirect loop, a send skipped for a "missing link"), check the
non-secret settings and secret-key presence above without printing credentials,
rather than assuming a browser/cookie/SSO
problem. Editing `.env.local` while `next dev` is already running does NOT
reach an existing process for these server-only settings — after an authorized
change, coordinate restarting the specific server with its owner; do not kill
another session's process.

Related: [[project-vercel-cli-deploy-preview-auth]], [[reviewer-invite-capture-mode-not-full-sandbox]].
