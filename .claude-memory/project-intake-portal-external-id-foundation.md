---
name: Intake portal — Entra External ID foundation shipped
description: Tenant provisioned, NextAuth dual-provider wired, /apply route auth round-trip verified end-to-end (S129). Form/membership/Dynamics writes still ahead.
type: project
originSessionId: 5fc8fbcf-cfc0-4f4b-a4d6-5abf1de8d42e
status: active
scope: auth
last_verified: 2026-07-27 via NextAuth/proxy/_app source and intake design; tenant configuration and sign-in smoke remain bounded to S129
---

## Recall Rule

Read this when: touching the dual-provider NextAuth setup, the `/apply` applicant auth path, or the External ID tenant.

Do:
- Branch on `session.user.userType: 'staff' | 'applicant'` — never infer identity from which fields are populated.
- Rely on OID-keyed contact lookup (permanent across email changes); email is bootstrap key only.
- Keep the `entra-external` provider env-gated (registers only when all three `EXTERNAL_AZURE_AD_*` are set).

Do not:
- Re-include `/apply/*` in `ProfileProvider`/`AppAccessProvider` in `_app.js` (it's excluded on purpose).
- Navigate the External ID portal by label (Microsoft renames "User flows"/"Self-service sign-up" constantly) — navigate by concept.

Ground truth: `docs/INTAKE_PORTAL_DESIGN.md`, `docs/archive/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`, commit `68e4c59`; tenant `04a1406b-3878-4286-bd17-b8c8118886f7`.

The External ID auth foundation remains present in current source. The
applicant OTP round-trip and stable Object-ID behavior were verified in Session
129; current tenant/user-flow operation requires a fresh read-only configuration
check and sign-in smoke before release reliance.

**Tenant facts:**
- Tenant ID: `04a1406b-3878-4286-bd17-b8c8118886f7`
- Domain: `wmkeckapply.onmicrosoft.com`
- OAuth endpoint family: `wmkeckapply.ciamlogin.com` (CIAM, not legacy B2C `b2clogin.com` and not staff `login.microsoftonline.com`)
- User flow: `wmkeckapply-signup-signin` (under External Identities → Self-service sign-up; new UX renamed "user flows")
- App registration: `WMKF Grant Application Portal`, single-tenant in the external tenant

**Code shape:**
- Provider id: `entra-external` (NextAuth custom OAuth via `wellKnown`)
- Env vars: `EXTERNAL_AZURE_AD_TENANT_ID`, `EXTERNAL_AZURE_AD_CLIENT_ID`, `EXTERNAL_AZURE_AD_CLIENT_SECRET`. Provider only registers when all three are set, so a staff-only deployment is unaffected.
- Sessions self-identify with `session.user.userType: 'staff' | 'applicant'`. Staff and applicant fields are mutually exclusive — never inspect populated fields to infer identity, branch on `userType`.
- Applicant claims: `contactOid`, `contactEmail`, `contactName`. No DB write at sign-in (contact↔OID lookup is lazy, on first authenticated `/apply` write).
- Middleware enforces non-crossing: staff session hitting `/apply/*` rejects, applicant session hitting any non-`/apply` route rejects. Idle 2h applies to both.
- Sign-in UI auto-dispatches to `entra-external` when `callbackUrl` resolves to `/apply*` — `pages/auth/signin.js` checks both relative and absolute callback shapes.

**Why it matters:**
- The institution-as-identity model the portal needs (multiple collaborators, transferable primary contact, self-service requests) requires per-person persistent identity. OTP-only Entra External ID is the right primitive; HMAC magic links would have baked in person-centric identity instead.
- The OID is permanent across email changes. Email is bootstrap key only — once OID is on a contact, OID-keyed lookup wins forever.

**Out of scope (next sessions, in roughly this order):**
1. Membership / institution selection (search by name+EIN, candidate list, request flow)
2. Form schema rendering (Phase II Research forms-as-code module exists at `shared/forms/phase-ii-research-2026-06/`)
3. Draft staging via `intake-draft-service.js` (Postgres, autosave, attachments)
4. Submission → Dynamics writes (akoya_request + wmkf_portalmembership)
5. `/apply/admin/*` for staff triage (collaborator approval, submitted list)

**Watch out:**
- `_app.js` excludes `/apply/*` from `ProfileProvider`/`AppAccessProvider` because those are staff-only; don't accidentally re-include it.
- The old "Run user flow" smoke test inside the External ID portal requires an attached app — applicant sign-up via `/apply` is the better real test.
- Microsoft's External ID portal renames things constantly. "User flows" → "Self-service sign-up" → possibly something else next quarter; navigate by concept, not by label.

**Reference:** `docs/INTAKE_PORTAL_DESIGN.md`, `docs/archive/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`. Foundation commit: `68e4c59`.
