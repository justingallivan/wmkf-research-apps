---
name: project-intake-portal-ui-todo
description: Intake portal UI/UX bugs surfaced during DR8 verification that are deferred to a dedicated UI-design session, not addressed in S187.
metadata:
  type: project
  status: active
  scope: intake
  last_verified: S203 via memory-content (not re-probed 2026-06-04)
---

> **BUILD PARKED (2026-07-08, S348):** the intake-portal build is on the back burner
> (Connor re-engineering GOApply). These UI todos are deferred, not scheduled. Retained
> for revival. See [[project-intake-portal-parked]].

## Recall Rule

Read this when: working on the `/apply` intake portal sign-out flow or the Entra External ID sign-up / attribute-collection UX.

Do:
- Build a `/apply/signed-out` landing page with a manual sign-in link (no auto-redirect `useEffect`) and also hit Entra's federated logout endpoint to kill the IdP session.
- Trim the Entra user flow's attribute collection (uncheck City, State/Province, Display Name; keep Given Name + Surname) in the Azure portal, not in code.

Do not:
- Assume `signOut({ callbackUrl: '/apply' })` actually signs the user out — it silently re-auths via the still-valid Entra session.
- Touch `/apply` piecemeal across sessions; these are held for a dedicated UI-design session.

Ground truth: `pages/apply/index.js` (~line 73), `pages/api/auth/[...nextauth].js` (contactName/contactEmail/contactOid claims), `proxy.js`; Azure portal External Identities user flow `wmkeckapply-signup-signin`.

Deferred from S187 (intake portal pilot-readiness, mostly backend). Both surfaced while smoke-testing DR8 against `https://wmkfresearch.vercel.app/apply` after the `EXTERNAL_AZURE_AD_*` env vars were provisioned and the `entra-external` provider came online.

## 1. Sign-out doesn't actually sign the user out

`pages/apply/index.js` line ~73:
```js
onClick={() => signOut({ callbackUrl: '/apply' })}
```

Sequence on click: NextAuth clears its local cookie → redirects to `/apply` → page mounts, sees `status==='unauthenticated'` → `useEffect` fires `signIn('entra-external', { callbackUrl: '/apply' })` → Entra's session is still valid → silent re-authentication → user lands back on the same authenticated page with no feedback.

Two-layer fix when this is touched:

- **UX layer**: a `/apply/signed-out` landing page that shows "You've been signed out" with a manual "Sign in again" link — no `useEffect` auto-redirect. Change both Sign out call sites in `pages/apply/index.js` to use this as `callbackUrl`. Verify `proxy.js` allows the new route for unauthenticated visitors.
- **Federated sign-out layer**: also hit Entra's logout endpoint so the IdP session is killed too, not just the local NextAuth cookie. Format: `https://wmkeckapply.ciamlogin.com/{tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=<signed-out-url>`. Matters for shared-device scenarios — research administrators helping multiple PIs apply from one browser will otherwise silently swap into whichever applicant Entra last cached.

## 2. Registration "Add details" page collects irrelevant personal data

The Entra External ID user flow's attribute collection step currently asks for City, State/Province, Display Name, Given Name, Surname. For an institutional grant portal, City + State/Province are personal-address noise and Display Name should auto-derive from Given + Surname, not be prompted separately.

Fix lives in the Azure portal (External Identities → User flows → `wmkeckapply-signup-signin`):
- **User attributes**: uncheck City, State/Province, Display Name. Keep Given Name + Surname.
- **Application claims**: ensure Given Name, Surname, Email Addresses, User's Object ID stay checked (these map to `contactName`, `contactEmail`, `contactOid` in `pages/api/auth/[...nextauth].js`).

Only affects new sign-ups. Existing test accounts will not see the new prompts
unless deleted from the External tenant's Users list and re-registered. Test
account addresses and object identifiers are intentionally not retained in
memory.

## Why deferred

Justin (2026-05-25): "I want to dedicate some future sessions to designing the portal and the associated UI work. Let's deal with this issue then." Both items are UX-domain and pair naturally with the broader S185 intake-portal-UI build still on deck. Holding them avoids touching `/apply` piecemeal across multiple sessions.

## Why it matters

These are visible to the first real applicants the moment the next cycle's Phase I intake opens. The registration page in particular is the very first impression an applicant gets of WMKF. Worth solving before any applicant touches the flow.
