---
name: Intake portal — Entra External ID foundation shipped
description: Entra External ID auth foundation and /apply sign-in shell exist. Membership checks, contact bridge, draft persistence, and a submit queue are present in source; applicant form UI remains unfinished, and this pass does not establish a completed submission drain. Owner parked the custom portal and kept J27 intake on GOApply (2026-09-06).
type: project
originSessionId: 5fc8fbcf-cfc0-4f4b-a4d6-5abf1de8d42e
status: active
scope: auth
last_verified: 2026-10-22 via apply UI, membership service, submit route, and intake draft service; tenant configuration and sign-in smoke remain bounded to S129
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
check and sign-in smoke before release reliance. The current `/apply` page is
still a sign-in shell that says form modules and institution selection arrive in
a later release. Backend pieces do exist: the submit route bridges the session
OID to a Dataverse contact, checks approved active Submitter membership, reads a
Postgres draft, and queues a `submission_jobs` row; the draft service persists
the draft. These pieces do not establish a completed applicant portal or an
end-to-end Dynamics submission drain.

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

**Historical S129 follow-up list (not a current build queue):**
The original proposed order was membership/institution-selection UI, form schema
rendering, draft staging, submission-to-Dynamics writes, and staff triage under
`/apply/admin/*`. Later source includes backend primitives for several of these;
this list preserves earlier planning rather than instructing a rebuild.

**Current owner scope:** on 2026-09-06, the owner kept J27 intake on GOApply
until further notice and parked the custom `/apply` portal for a future pilot
([[project-intake-portal-parked]]). Treat the original build sequence in the
earlier version of this note as superseded by that decision; do not describe membership or all Dynamics
submission writes as wholly unbuilt, and do not describe the portal as complete.
The applicant-facing form and institution-selection UI remain unfinished, and
a complete queued submission-to-Dynamics drain was not established by this
bounded review. The broader portal remains parked.

**Watch out:**
- `_app.js` excludes `/apply/*` from `ProfileProvider`/`AppAccessProvider` because those are staff-only; don't accidentally re-include it.
- The old "Run user flow" smoke test inside the External ID portal requires an attached app — applicant sign-up via `/apply` is the better real test.
- Microsoft's External ID portal renames things constantly. "User flows" → "Self-service sign-up" → possibly something else next quarter; navigate by concept, not by label.

**Reference:** `docs/INTAKE_PORTAL_DESIGN.md`, `docs/archive/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`. Foundation commit: `68e4c59`.
