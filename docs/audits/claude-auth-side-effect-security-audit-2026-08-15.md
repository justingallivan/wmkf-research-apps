---
title: Claude Auth & Side-Effect Follow-Up Security Audit — 2026-08-15
domain: security-auth
kind: audit
status: complete
summary: "Read-only adversarial confirm/refute of eight still-open Fable security findings (unbounded disabled-account access on bare requireAuth, validateOrigin fail-open, grantee send-invite authority, send-invite/replace-submission idempotency, BILL onboarding replay, authenticated error.message disclosure, non-constant-time cron-secret compare, pricing-refresh NUL bytes). Revised after Codex adversarial review (2026-08-15)."
canonical: false
---

# Claude Auth & Side-Effect Follow-Up Security Audit — 2026-08-15

**Point-in-time audit artifact.** Read-only adversarial re-verification of the eight
still-open Fable findings, on branch `codex/claude-security-followup-audit` off
`origin/main` @ `307a68c8`. No runtime code changed. All 57 `check:*` gates were green
on the tree before this audit began.

**Revision (same day):** corrected after two rounds of Codex adversarial review. Material
corrections: §1 disabled-account exposure is **unbounded for an active user**, not 8h, and
now (round 2) covers the `link-profile` profile-creation revocation gap, the
**both-layers-required** remediation (JWT-clear alone does not block the current bare-auth
request), and the missing-profile-row fail-open in the two heavier helpers; §2 separates
the reachable (`link-profile`) from the latent (`/api/intake/*`, blocked by a `proxy.js`
routing mismatch) direct-session routes; §2's fail-open branches are **already unit-tested
behavior**; §4's verdict wording is de-contradicted (send-invite idempotency gap CONFIRMED,
replace-submission REFUTED) and the false token-supersession claim removed; §6's inventory
is rebuilt with **balanced-expression parsing** (27 sites, not 28 — `campaign-timeline-defaults`
was a sliding-window false positive; the earlier "external trees clean" claim was wrong for
`pages/api/bill`); §8's cosmetic fix now prescribes an escaped NUL, not a printable delimiter.
The `SessionProvider` polling claim in the first revision was overstated and is corrected in §1.

Evidence labels: `[VERIFIED via <source>]` = read in current source this session;
`[ASSUMED]` = not probed. Live production runtime state was **not** probed (standing
rule bars self-authorized prod Dataverse/env reads); read-only probes needed to close a
gap are assigned to Justin in §10.

Scope note: T1 (reviewer-merge authorization) and D4 (staff-wide document reads) are
accepted owner decisions (2026-08-15) and were **not** reopened.

## Verdict summary

| # | Finding | Verdict | Severity | Remediation warranted? |
|---|---------|---------|----------|------------------------|
| 1 | Disabled-account access via bare `requireAuth` (blob/upload/health/api-capabilities) + `link-profile` profile creation | **CONFIRMED — duration unbounded for an active session; revocation not enforced at route, session, or edge layer** | Medium | Yes — Tier 2 revocation-hardening scope |
| 2 | `validateOrigin` fail-open when `NEXTAUTH_URL` absent/invalid; CSRF boundary vs docs | **CONFIRMED (fail-open, unit-tested behavior) / PARTIAL (doc drift; intake gap latent behind a proxy routing mismatch)** | Low (latent Medium at intake launch) | Optional hardening + doc fix; intake launch precondition |
| 3 | Grantee `send-invite` client-controlled recipient/subject/body → email-send primitive | **PARTIAL (owner-decided primitive, one residual)** | Low–Medium | No code change; note residual |
| 4 | Route idempotency: `send-invite` / `replace-submission` | **CONFIRMED for `send-invite` (no idempotency; duplicate mint+send; all minted tokens stay valid) / REFUTED for `replace-submission`** | Low | No change |
| 5 | BILL onboarding replay protection (skew window, nonce, duplicate external effects) | **REFUTED (duplicate external effects) / CONFIRMED (open ±300s HTTP-replay window, harmless)** | Low | No change |
| 6 | Authenticated routes return internal `error.message` | **CONFIRMED — 27 raw-500/502 sites across superuser, cron, staff app-auth, and internal-HMAC audiences** | Low | Optional convention cleanup |
| 7 | Non-constant-time cron-secret compare | **CONFIRMED** | Low | Optional, small (convention parity) |
| 8 | Non-UTF8 bytes in `pricing-refresh.js` blind a route/security gate | **REFUTED (cannot blind any Node-based gate)** | Informational | Cosmetic only (escaped NUL) |

---

## 1. Disabled-account access through bare `requireAuth` — CONFIRMED, duration unbounded for an active session (Medium)

**Trace.** `requireAuth` (`lib/utils/auth.js:136-157`) runs the kill-switch check, then
`validateOrigin`, then `getSession`, and returns the session **without any
`is_active` read**. The revocation check lives only in the two heavier helpers:
`requireAuthWithProfile` (`:204-214`) and `requireAppAccess` (`:295-312`), both of which
re-read `user_profiles.is_active` fresh per request and 403 a disabled account.
`[VERIFIED via lib/utils/auth.js:136-157, 204-214, 295-312]`

**Callers on bare `requireAuth`** (exhaustive; grep for `requireAuth(` minus the
`WithProfile`/`AppAccess`/`Superuser` variants): `pages/api/blob-proxy.js:34`,
`pages/api/upload-handler.js:11`, `pages/api/health.js:23`, `pages/api/api-capabilities.js:21`.
`[VERIFIED via grep over pages/api]`

**Exposure duration — NOT bounded by the 8-hour JWT `maxAge`.** (Correction from the
first draft of this audit, per Codex review; each link verified in source.)

1. The JWT `maxAge` is 8h (`pages/api/auth/[...nextauth].js:310-313`), **but next-auth v4
   re-encodes the JWT session cookie with a fresh `now + maxAge` expiry on every session
   read**: the session route computes `newExpires = fromDate(sessionMaxAge)` and re-issues
   the cookie `[VERIFIED via node_modules/next-auth/core/routes/session.js:60-79]`. The
   SPA's `SessionProvider` is configured `refetchOnWindowFocus={true}` with **no
   `refetchInterval`** `[VERIFIED via pages/_app.js:40]`, so it refreshes the session on
   mount and on window-focus (and any authenticated API call also rolls the token) — it
   does **not** continuously poll merely because a tab is left open. The unbounded-session
   conclusion does not rest on background polling: any repeated `getServerSession` — a
   focus refetch, a navigation, or ordinary authenticated API activity — rolls
   `lastActivity` and the cookie expiry, so a user who keeps working never lets either
   window close.
2. The 2-hour idle timeout also rolls: the `jwt` callback stamps
   `token.lastActivity = Date.now()` on **every** invocation that passes the idle check
   `[VERIFIED via pages/api/auth/[...nextauth].js:236-242]`, and `proxy.js` only rejects
   when `Date.now() - lastActivity > 2h` `[VERIFIED via proxy.js:125-129]`.
3. Disablement never invalidates the token: the `jwt` callback's staff profile lookup
   filters `WHERE azure_id = ... AND is_active = true`, and on **zero rows it simply skips
   the claim refresh — it does not clear the token's existing `profileId`/staff claims or
   return an empty token** `[VERIFIED via pages/api/auth/[...nextauth].js:248-268]`.
   `proxy.js`'s authorized callback checks only idle + `token.azureId` presence
   `[VERIFIED via proxy.js:140-143]`.

**Net effect:** a staff account disabled mid-session keeps a *valid, indefinitely
self-renewing* session as long as the user stays active within every 2-hour idle window.
Every route on `requireAuthWithProfile`/`requireAppAccess`/`requireSuperuser` still blocks
them per-request via the fresh `is_active` read — but the four bare-`requireAuth` routes
remain available **indefinitely**, not for ≤8h:

- `blob-proxy.js` — GET any allowlisted `*.public.blob.vercel-storage.com` asset
  (shared org templates/attachments; host-allowlist is the only boundary, by design
  `[VERIFIED via blob-proxy.js:8-18, 26, 51]`).
- `upload-handler.js` — POST to mint a Vercel Blob client-upload token (public store, or
  private store if `UPLOADS_BLOB_RW_TOKEN` set); 50MB, content-type allowlisted
  `[VERIFIED via upload-handler.js:42-70]`.
- `health.js` / `api-capabilities.js` — service-health detail + boolean availability of
  ORCID/NCBI/SerpAPI keys (never the values `[VERIFIED via api-capabilities.js:24-28]`).

**A fifth route: `/api/auth/link-profile` can create a fresh active profile for a disabled
session.** (Round-2 addition.) This route is proxy-exempt (the `api/auth/*` matcher
exemption `[VERIFIED via proxy.js:173]`) and uses `getServerSession` directly. Its only
gate beyond a session is `if (!session.user.needsLinking) return 403`
`[VERIFIED via link-profile.js:29-31]`. But `needsLinking` is a **token claim**, and the
`jwt` callback only refreshes it from a `WHERE ... AND is_active = true` lookup — a disabled
account's lookup returns zero rows, so the **stale `needsLinking = true` claim is retained**
`[VERIFIED via [...nextauth].js:248-268]`. A disabled session that was mid-linking therefore
still passes the gate and reaches the `createNew` branch, which **DELETEs the temp profile
and INSERTs a new `user_profiles` row without setting `is_active`**
`[VERIFIED via link-profile.js:42-58]` — and the column's DB default is `true`
(`is_active BOOLEAN DEFAULT true` `[VERIFIED via scripts/setup-database.js:106]`). So a
just-disabled account can mint itself a brand-new *active* profile. This is a
revocation-hardening item (immediate scope), not merely a CSRF discussion point.

**Severity.** Medium. Realistic prerequisites: a disabled-for-cause account (offboarding /
compromise response) whose holder **keeps a session active** — exactly the adversarial
case revocation exists for. The bare-auth surfaces are staff-wide-by-design assets plus an
upload-token mint (persistence of low-privilege access, not escalation); the `link-profile`
path is worse in kind — it re-establishes a *durable* active identity — but needs a
mid-linking (`needsLinking = true`) session, a narrower precondition. The common root is
that **revocation is enforced at none of the three layers except the per-request
route-helper `is_active` read**: not the session/JWT layer, not the proxy edge, and not the
bare-`requireAuth`/`getServerSession`-direct routes. The *indefinite* duration defeats the
purpose of disablement for all five routes.

**What tests/gates prove / don't.** `check:api-routes` proves guard-token presence only —
it does not distinguish `requireAuth` from the revocation-aware variants. No unit test
exercises a disabled account against bare `requireAuth`, and no test pins the
jwt-callback behavior that stale staff claims survive a zero-row active-profile lookup.
`[VERIFIED via scripts/check-api-route-security-matrix.js:96-104; tests/unit/utils/auth.test.js
covers validateOrigin branches, not is_active]`

**A compounding fail-open in the two "heavier" helpers themselves.** (Round-2 addition.)
The helpers that *do* check `is_active` still pass a **missing** profile row:
`requireAuthWithProfile` only 403s when `rows.length > 0 && !rows[0].is_active`, so a
**zero-row** lookup falls through to success `[VERIFIED via lib/utils/auth.js:205-209]`;
`requireAppAccess` maps zero rows to active **explicitly**:
`isActive = profileResult.rows.length === 0 || profileResult.rows[0].is_active !== false`
`[VERIFIED via lib/utils/auth.js:300]`. Both **contradict their own fail-closed comments**
(`auth.js:201-203, 286-292`, which say the check refuses rather than honor a doubtful
session). A *deleted* staff profile (or any lookup that returns no row) therefore passes the
revocation gate on every route, not just the bare-auth ones. The intended posture — disabled,
deleted, or otherwise missing staff profiles all **fail closed** — is a one-line change in
each helper (treat `rows.length === 0` as not-active for a token that carried a `profileId`).

**Disconfirming check.** If `requireAuth` gains an `is_active` read, the `jwt` callback
clears staff claims on a zero-row lookup, `link-profile` re-checks live `is_active` before
`createNew`, and the two helpers treat a missing row as not-active, the finding closes.
Re-grep `requireAuth(` callers, re-read `[...nextauth].js:248-268`, `link-profile.js:29-58`,
and `auth.js:205-209, 300` after any fix.

**Remediation — behavioral invariants, not a fixed implementation.** This is broader than
"add one read" and belongs in a dedicated Tier-2 revocation-hardening effort (see §11).
Note that the two candidate fixes are **complementary, not interchangeable**: clearing the
JWT to `{}` blocks *subsequent* proxy-gated requests, but the **current** bare-auth request
already holds a session object, and NextAuth's session read still constructs a **non-null**
session from a token even after a same-request clear — `requireAuth` checks only that the
session object *exists* `[VERIFIED via lib/utils/auth.js:149-156]`, so that in-flight request
would still proceed. Durable + immediate revocation therefore needs **both** a
current-request route-level `is_active` guard (blocks the present request) **and** the
JWT-claim invalidation (blocks the next request through the proxy). Neither alone closes the
window.

**Required regression tests for any implementation:**
- `requireAuth` returns 403 for a session whose profile row has `is_active = false` (and
  still passes for profile-less `needsLinking` sessions).
- `requireAuthWithProfile` and `requireAppAccess` fail **closed** on a zero-row lookup for a
  token that carried a `profileId` (deleted/missing profile).
- jwt callback: a token with existing staff claims + a zero-row `is_active = true` lookup
  does **not** retain `profileId`/staff claims.
- `link-profile`: a disabled (`is_active = false`) session with a stale `needsLinking = true`
  claim **cannot** create (`createNew`) or claim (`profileId`) a profile.
- Route-level: disabled account + valid session cookie → `blob-proxy` and `upload-handler`
  respond 403.
- Idle/rolling: a disabled account remains blocked even when requests arrive inside the 2h
  idle window (guards against reintroducing the rolling-session bypass).
- Non-regression: active `needsLinking` sessions, applicant sessions, and the
  `AUTH_REQUIRED=false` dev bypass all remain functional; a DB lookup **failure** (not a
  zero-row result) still fails closed (503), not open.

**Residual risk after fix.** One PG read per bare-auth request (low-QPS routes); none
otherwise.

---

## 2. `validateOrigin` fail-open + CSRF boundary vs docs — CONFIRMED fail-open / PARTIAL doc drift; intake gap latent (Low now; Medium at intake launch if unfixed)

**Trace of `validateOrigin` (`lib/utils/auth.js:56-102`):**
1. GET/HEAD/OPTIONS → `{valid:true}` (state-changing only). `[VERIFIED :59-61]`
2. No Origin **and** no Referer → allowed **iff no cookie** (server-to-server); a
   cookie-bearing headerless request is rejected. `[VERIFIED :69-73]`
3. **`NEXTAUTH_URL` unset → `{valid:true}` (SKIP).** `[VERIFIED :75-79]` — fail-open #1.
4. `NEXTAUTH_URL` present but unparseable as URL → `catch` → `{valid:true}`. `[VERIFIED :81-86]` — fail-open #2.
5. Source Origin/Referer unparseable → `{valid:false}`. `[VERIFIED :91-95]`
6. Origin mismatch → `{valid:false}`. `[VERIFIED :97-99]`

**Fail-open confirmed — and it is deliberate, unit-tested behavior, not an unnoticed
gap.** `tests/unit/utils/auth.test.js` explicitly pins both branches: "skips validation
(allows) when NEXTAUTH_URL is unset, even on an Origin mismatch" and the unparseable-URL
skip, alongside the malformed-Origin/Referer rejections `[VERIFIED via
tests/unit/utils/auth.test.js:130-236]`. Moreover, unset is not exclusively a
misconfiguration: the runbook states **Preview intentionally carries no fixed
`NEXTAUTH_URL`** (host-derived), so `validateOrigin` is by-policy inactive in Preview
`[VERIFIED via docs/CREDENTIALS_RUNBOOK.md:45]`. Production's value was verified live on
2026-06-23 per the runbook; that is **dated evidence — current production state is
`[ASSUMED]`** (not probed this session; see §10).

**Defense-in-depth under a validateOrigin skip:** next-auth v4.24.15
`[VERIFIED via package.json]` uses `SameSite=Lax` session cookies by default (no cookie
override found — `grep sameSite` over `pages`/`lib` is empty `[VERIFIED]`), so a
cross-site top-level POST does not carry the session cookie. `validateOrigin` is the
*second* CSRF layer; SameSite=Lax is the first. This matches the historical M8 note
`[VERIFIED via docs/SECURITY_ARCHITECTURE.md:1202-1210]`.

**Cookie-authenticated state-changing routes outside `validateOrigin`** — five routes
call `getServerSession` directly rather than through the auth helpers `[VERIFIED via grep
getServerSession over pages/api]`. Their reachability differs materially (Codex
correction), so they must be characterized separately:

**(a) Reachable today: `pages/api/auth/link-profile.js`.** The `proxy.js` matcher exempts
`api/auth/*` entirely `[VERIFIED via proxy.js:173]`, so this POST is reachable with a
staff session and relies on **SameSite=Lax alone** for CSRF. Mitigations: gated to the
first-login `needsLinking` window and all identity is session-derived
`[VERIFIED via link-profile.js:29-37]`. Low.

**(b) Latent, NOT currently reachable by their intended callers: the four
`/api/intake/*` routes** (`draft`, `submit`, `draft/attach`, `draft/upload-token`).
`proxy.js` classifies only `/apply` and `/api/apply` as applicant surfaces
`[VERIFIED via proxy.js:131]`; **everything else — including `/api/intake/*` — is staff
surface, where applicant tokens are explicitly rejected**
(`if (token?.userType === 'applicant') return false`) `[VERIFIED via proxy.js:140-143]`.
The intake handlers themselves accept only applicant sessions
(`userType === 'applicant'`) `[VERIFIED via pages/api/intake/submit.js:98-103]`. So an
applicant session is bounced by the proxy before the handler runs, and a staff session
reaching the handler is 401'd by the handler — the missing Origin validation on these
routes is **latent**, not exploitable today. The applicant UI is the identity-only
`/apply` smoke page (`pages/apply/index.js` is the sole page `[VERIFIED via ls
pages/apply]`) and the intake flow is pre-pilot.

**(c) The dormant functional defect that (b) exposes:** the proxy's
applicant-path classification (`/apply`, `/api/apply`) does not include the implemented
applicant APIs (`/api/intake/*`). **This routing mismatch must be fixed before the intake
flow can launch** — and the fix that makes the routes reachable is exactly the change
that makes their missing Origin validation live. The proxy mismatch is a blocking bug for
intake, **not** an acceptable CSRF control, and the two must be remediated together:
extend the applicant-surface classification AND add Origin validation (or route intake
through a helper that includes it) in the same change.

**Docs delta.** `docs/SECURITY_ARCHITECTURE.md:931` (a labeled historical snapshot)
describes Origin validation as covering state-changing methods via
`requireAuth`/`requireAppAccess`; that is accurate about the helpers but does not surface
that the five direct-session routes rely on SameSite alone, and its M8 remediation text
("missing headers are allowed through") predates the current cookie-bearing-headerless
rejection `[VERIFIED via auth.js:69-73 vs SECURITY_ARCHITECTURE.md:1210]`.

**Verdict:** fail-open branches CONFIRMED (deliberate, tested, by-policy active in
Preview; production state ASSUMED-set from dated evidence). Doc-vs-effective-boundary
PARTIAL. The intake CSRF gap is real but latent behind the proxy routing mismatch, which
is itself a launch-blocking functional finding.

**What tests/gates prove / don't.** The fail-open branches ARE unit-pinned (see above) —
the tests document the behavior; they do not make it safe. No test covers the proxy's
applicant-surface classification against the intake routes (the latent mismatch), and no
gate asserts CSRF coverage.

**Disconfirming check.** For (b): with an applicant session, POST to
`/api/intake/draft` on a deployed environment — expect a proxy-level rejection/redirect,
not a handler response. If it reaches the handler, the latency claim here is wrong and
the CSRF gap is live, not latent.

**Smallest remediation.** (a) Make branches 3–4 fail **closed** when
`NODE_ENV === 'production'` and no valid `NEXTAUTH_URL` exists (Preview can stay
permissive by deriving the allowed origin from `VERCEL_URL`), updating the two unit tests
that pin the skip. (b) One-line doc correction for the direct-session routes. (c) At
intake launch: fix the proxy applicant-surface classification and add Origin validation
to the intake routes in the same change (owner-scheduled; pre-pilot today).

**Residual risk.** CSRF for direct-session routes ultimately rests on SameSite=Lax; that
is the accepted platform posture.

---

## 3. Grantee `send-invite` recipient/subject/body authority — PARTIAL (Low–Medium)

**Question:** can client-controlled fields create an *unintended* email-send primitive?

**Trace.** `pages/api/workbench/grantee-deliverables/send-invite.js`: guard
`requireAppAccess('reviewers')` `[VERIFIED :38]`; `fromEmail` is **server-derived** from
`session.user.azureEmail` (400 if absent) `[VERIFIED :41-44]`; `requestId` GUID-validated
`[VERIFIED :47-50]`; `toEmail`/`ccEmail` regex-validated as single addresses,
`subject` required, `bodyText` ≥10 chars `[VERIFIED :52-67]`. Service
`send-invite-service.js`: refuses if the outgoing subject/body contains the internal
request number `[VERIFIED :40-43, 67-69]`; requires deliverable status ≥ DRAFTED and
< SUBMITTED `[VERIFIED :83-89]`; **mints the magic-link server-side and injects it — never
from body** `[VERIFIED :91-97]`; sends via `DynamicsService.createAndSendEmail` from the
staff mailbox with `regardingId=requestId` `[VERIFIED :99-110]`. The send path asserts a
trusted DAL context first (`assertTrustedDalContext`) `[VERIFIED via lib/services/dynamics/email.js:77,
149, 187]`.

**This shape is an explicit owner decision, not an accident.** The build plan records:
"**Send UX: staff confirm recipients + preview/edit the email body, then send** (owner
choice)" `[VERIFIED via docs/GRANTEE_PORTAL_BUILD_PLAN.md:286]`; recipient resolution
surfaces PI + liaison for staff to confirm/override `[VERIFIED via :42]`; and the
stateless 30-day no-revocation token design was decided at Q1 → Option A
`[VERIFIED via :60-72, 90]` and implemented as such
`[VERIFIED via lib/external/grantee-token-lifecycle.js:9-20, 54-69]`.

**Assessment.** The controls that keep this from being an *arbitrary* mailer: (1) the
caller must hold `reviewers` app access; (2) `From` is the caller's own mailbox —
attributable, cannot spoof a third party; (3) `To` must be a single valid address (no
bulk list); (4) the request-number leak guard blocks the one internal identifier that
must not egress; (5) body HTML is escaped before render
`[VERIFIED via lib/external/grantee-invite-email.js:20-28, 36-50]`.

**Residual (the "unintended" edge):** an authenticated `reviewers`-app staffer can send a
foundation-branded email containing a **live 30-day grantee magic link** for any request
GUID with a Drafted..<Submitted deliverable to **any single address they type** — there
is no server-side recipient↔request binding, per the owner's confirm/override decision
above. A mistaken or malicious staffer can therefore mail a valid portal link to a wrong
recipient. This is an insider/authorization-trust concern consistent with the accepted
org-open trust model, not an unauthenticated primitive.

**Verdict:** PARTIAL — the primitive is owner-decided and reasonably fenced; the residual
is the absent recipient binding, accepted-risk-adjacent.

**What tests prove.** `grantee-send-invite-route.test.js` +
`grantee-send-invite-workbench-service.test.js` exercise the validation/status gates
`[VERIFIED via tests/unit listing]`; there is no recipient↔request binding to assert.

**Disconfirming check.** If product ever wants the binding, verify `toEmail`/`ccEmail`
against the request's stored PI/liaison addresses before mint/send — today's absence is
the documented staff-override affordance, so its "absence" cannot be read as a defect
without a new owner decision.

**Remediation.** None recommended without an owner decision — a binding would break the
documented override affordance. Flag as an insider-trust residual only.

---

## 4. Route idempotency — CONFIRMED for `send-invite`, REFUTED for `replace-submission` (Low)

**`send-invite`: the original finding is CONFIRMED.** There is no route- or
service-level idempotency: two identical POSTs while status is DRAFTED/INVITED each mint
a fresh magic-link and each send an email — the only gate is `status < SUBMITTED`
`[VERIFIED via send-invite-service.js:87-89; no dedup/claim exists anywhere in the
service]`. **Token semantics: a newly minted token does NOT supersede earlier ones.**
Grantee tokens are stateless signed JWTs with no stored hash and no revocation
`[VERIFIED via lib/external/grantee-token-lifecycle.js:9-16]`, so **every previously
minted token remains independently valid until its own 30-day expiry**; the durable
backstop is package status — the submit route refuses writes once the deliverable is
complete/submitted (the compensating guard named in the token-lifecycle design note
`[VERIFIED via grantee-token-lifecycle.js:14-17]`). Each resend therefore *widens* the
set of live links rather than rotating them. This is within the accepted Q1 stateless
design (§3), and resend is an intended affordance, so severity stays Low — but the
duplicate-send behavior itself is confirmed, not refuted.

Partial success is handled correctly and non-dangerously: a send that succeeds but whose
status PATCH fails returns **200 with `statusPersisted:false`** and the *actual*
persisted status, never falsely reporting INVITED `[VERIFIED via
send-invite-service.js:116-138]`.

**`replace-submission`: the dangerous reading is REFUTED.** It requires a client etag
(fail-closed without one `[VERIFIED via replace-submission-service.js:95-101]`), does a
conditional `ifMatch` PATCH `[VERIFIED :210]`, and on a thrown PATCH distinguishes
412-stale (409 to client, SharePoint upload cleaned up) from a possible **response-drop
after commit**: it re-reads and compares every requested field, returning success if the
write actually committed, cleaning up the orphan upload only when `not_committed`, and
leaving the upload on `unknown` rather than risk deleting a referenced image
`[VERIFIED :211-254]`. A duplicate replace with a stale etag 409s; with a fresh etag it
is a legitimate second edit. Concurrency, partial success, and ambiguous-write are
explicitly handled.

**What tests prove.** `grantee-replace-submission-service.test.js` +
`grantee-deliverables-replace-submission-route.test.js` cover the etag/stale/commit paths;
send-invite tests cover validation and the `statusPersisted:false` branch but do **not**
assert single-send behavior (there is none to assert) `[VERIFIED via tests/unit listing]`.

**Disconfirming check.** POST send-invite twice in the DRAFTED window against a test
request and count `emails` activities — expect two, and expect both mailed links to
verify successfully until expiry.

**Remediation.** None required. If duplicate-invite suppression is ever wanted, a short
idempotency window keyed on `(requestId, status)` would do it, but the reminder-resend
affordance argues against it; token rotation would require abandoning the accepted
stateless design and is a separate owner decision.

---

## 5. BILL onboarding replay protection — REFUTED duplicate external effects / CONFIRMED open HTTP-replay window (Low)

**Transport replay (`lib/bill/internal-call-auth.js`).** HMAC-SHA256 over
`v1:${timestamp}:${nonce}:${rawBody}` with `crypto.timingSafeEqual` (padded, length-checked)
`[VERIFIED :42-46, 92-109]`, a **±300s skew window**, and **no nonce store** — the header
comment states the skew window is the actual replay defense because Vercel instances don't
share memory `[VERIFIED :20-21, 27, 88-90]`. **Confirmed:** within ±300s an identical signed
body can be replayed at the HTTP layer and will pass `verifyInternalCall`.

**But the duplicate-effect question resolves at the orchestrator.** `onboardReviewer`
(`lib/bill/onboard-reviewer-service.js`) **reserves durable Postgres state before any BILL
side effect**: `reserveOnboarding` does `INSERT ... ON CONFLICT (honorarium_request_id)
DO NOTHING` `[VERIFIED via lib/bill/onboarding-state.js:25-29]`. A replayed/concurrent
second call loses the PK race → `reserved:false` → short-circuits to `in_progress` or an
**idempotent resume** (re-runs only the idempotent contact PATCH; explicitly **never
replays terminal BILL side effects** like network invitation) `[VERIFIED :128-179]`.
Vendor creation is further guarded by a staged-vendor-id pre-read so a retry reuses the
existing vendor `[VERIFIED :181-238]`. The idempotency key (`honorarium_request_id`) is
inside the signed body, so a byte-identical replay necessarily targets the same
reservation row.

**Verdict:** "repeat valid requests cause duplicate external effects" is **REFUTED** at
the effect layer; the transport's ±300s replay window is **CONFIRMED but harmless** given
that dedup.

**What tests prove.** `bill-onboard-reviewer.test.js` covers skew>300s rejection
(`:523-524`), signature verification (`:500-505`), and the **stranded-row resume that
does NOT replay BILL side effects** (`:384-397`); `bill-onboarding-state.test.js` covers
the reservation store `[VERIFIED via tests/unit listing]`. Gap: no test drives a
**within-window byte-identical HTTP replay** end-to-end through the route; the dedup is
unit-proven at the orchestrator layer only.

**Disconfirming check.** Replay a captured valid signed request within 300s against a
test deployment and assert exactly one `bill_onboarding_state` row and zero second
vendor/invite calls.

**Remediation.** None required — effect-layer dedup is the right defense for a
multi-instance serverless deployment where a shared nonce store is impractical.

---

## 6. Authenticated routes return internal `error.message` — CONFIRMED, four audience classes (Low)

**Reproducible inventory.** (Rebuilt in round 2 — the first-revision "5-line sliding
window" wrongly associated one response's status with a different response's message; see
the `campaign-timeline-defaults` correction below.) Method: enumerate every
`res.status(500|502).json(` call, **balance parentheses to capture that call's exact
argument expression**, and flag only if *that expression* contains a raw
`error.message`/`err.message`/`e.message`/`msg`, EXCLUDING (i) `ServiceHttpError` default
bodies (`err.body ?? { error: err.message }`), and (ii) development-only details
(`NODE_ENV === 'development' ? error.message : ...`). Result: **27 raw
unhandled-error disclosure sites** `[VERIFIED via balanced-expression scan of `pages/api`
this session]`, by audience:

- **Superuser (7):** `admin/policies.js:43`, `admin/prompts/[name].js:61`,
  `admin/prompts/index.js:31`, `admin/reconcile-identities.js:41`,
  `admin/review-questions.js:65`, `admin/users.js:51`, `test-email.js:60` — all
  `requireSuperuser` `[VERIFIED per-file; test-email.js:32 is requireSuperuser, not the
  requireAppAccess named in a comment]`.
- **Cron principal (17):** `auth-bypass-check:59`, `drain-review-syntheses:57`,
  `drain-reviewer-acceptances:59`, `drain-submissions:130`, `health-check:129`,
  `log-analysis:177`, `maintenance:279`, `pricing-canary:67`, `pricing-refresh:114`,
  `reconcile-identities:53`, `refresh-irs-bmf:85`, `reviewer-email-reconcile:62`,
  `reviewer-reminders:63`, `secret-check:128`, `send-review-thankyous:65`,
  `spend-check:58`, `sweep-stale-invites:59` — all `verifyCronSecret`.
- **Ordinary staff app-auth (2):** `reviewer-finder/contact-history.js:49`,
  `reviewer-finder/prompt-override.js:56` — both `requireAppAccess` `[VERIFIED per-file]`.
- **Internal HMAC caller (1):** `bill/onboard-reviewer.js:107-110` returns
  `error: { code: 'unhandled', message: msg }` to the HMAC-authenticated internal caller
  `[VERIFIED]`. **The first draft's claim that `pages/api/bill` was clean is retracted** —
  it rested on a single-line grep that missed this multiline body.

**Corrected false positive (round 2):** `review-manager/campaign-timeline-defaults.js` is
**removed** from the app-auth list. Its `res.status(500)` at `:36-37` is a **generic**
message (`'Failed to save reviewer campaign timeline defaults'`, no `error.message`); the
`{ error: error.message }` at `:41` is a **separate 400** on the `requireSuperuser` PUT
catch path, not a raw 500 to an app-auth caller `[VERIFIED via
review-manager/campaign-timeline-defaults.js:25-41]`. The sliding window had merged the
two. This is why the total is 27, not 28.

The external **token-authenticated** trees (`pages/api/external/*`, `pages/api/webhooks/*`)
show no raw-message sites under the same scan `[VERIFIED via the balanced-expression scan —
zero hits in those trees]`.

**Logging note.** Each of the 27 retained catch paths was checked individually for a
`console.error`/`warn` on the same catch: all 27 log the underlying error server-side
(including `cron/maintenance.js:261` and `cron/drain-submissions.js:119`, whose log sits at
the top of a long catch above the response line) `[VERIFIED per-hit this session]`. So
generalizing the response bodies loses no diagnostic signal.

**Verdict:** CONFIRMED, Low. All 27 sites sit behind authentication, but the audience is
broader than "superuser/cron": two routes disclose to any staffer with the relevant app
grant, and one to the internal HMAC principal. The `ServiceHttpError` convention shows the
codebase already has the disciplined alternative; these 27 are drift from it.

**What gates prove / don't.** No gate asserts response-body hygiene.

**Disconfirming check.** Re-run the balanced-expression scan after any cleanup; any site
outside the two excluded categories is a regression.

**Smallest remediation (optional).** Return a generic reason and keep `error.message` in
the existing `console.error` at each site (all 27 log, verified above). Priority order: the
2 `requireAppAccess` staff routes, then the HMAC route, then superuser/cron.

**Residual risk.** None once messages are generalized; logging retains detail.

---

## 7. Non-constant-time cron-secret compare — CONFIRMED (Low)

**Trace.** `lib/utils/cron-auth.js:36` compares with `authHeader !== \`Bearer ${secret}\``
— a short-circuiting string compare, not constant-time `[VERIFIED]`. Two sibling verifiers
use `crypto.timingSafeEqual`: `lib/bill/internal-call-auth.js:99-108` and
`pages/api/irs/verify-ein.js:51,58` `[VERIFIED]`. This is a **convention violation** on
the guard for **19** cron routes (`grep verifyCronSecret` over `pages/api` → 19 files
`[VERIFIED]`), including maintenance/bulk-delete crons.

**Practical threat.** Very low over HTTP: remote timing side-channels against a
per-request string compare are swamped by network/TLS/serverless variance, and
`CRON_SECRET` is a high-entropy env secret with no attacker-influenced comparison input.
The finding's weight is **consistency**, not an exploitable channel.

**Verdict:** CONFIRMED (real inconsistency), Low practical severity; the sibling
conventions justify the small fix.

**What gates prove / don't.** No gate checks comparison style; `check:api-routes`
recognizes `verifyCronSecret` regardless of its internals.

**Smallest remediation (optional).** Replace the `!==` with the pad-to-longest
`timingSafeEqual` pattern already written in `internal-call-auth.js:99-108`. ~6 lines,
one file, covers all 19 routes.

**Residual risk.** None.

---

## 8. Non-UTF8 bytes in `pricing-refresh.js` blinding a route/gate — REFUTED (Informational)

**What the bytes actually are.** `file(1)` reports `pages/api/cron/pricing-refresh.js` as
`data` `[VERIFIED]`. The cause is **three literal NUL (`0x00`) bytes** at lines 131, 138,
160 — each a composite-Map-key delimiter written as a raw byte inside a template literal
(`` `${model}<NUL>${tokenType}` ``) — plus benign UTF-8 punctuation
`[VERIFIED via byte-offset inspection: NULs at offsets 5345/5721/6784]`. The file **is
valid UTF-8** (`python3 .decode('utf-8')` succeeds `[VERIFIED]`); `file(1)` says `data`
only because embedded NULs trip binary heuristics.

**Can it blind a gate?** No.
- The route **is** guarded: `verifyCronSecret` imported (`:26`) and called (`:82`)
  `[VERIFIED]`, with a matrix row `[VERIFIED via API_ROUTE_SECURITY_MATRIX.md:117]`.
- `check:api-routes` reads every file with `fs.readFileSync(file, 'utf8')` and substring
  matching `[VERIFIED via check-api-route-security-matrix.js:97, 100]`; Node's UTF-8
  reader is NUL-tolerant, so `source.includes('verifyCronSecret')` is `true`
  (`/verifyCronSecret\s*\(/.test(fs.readFileSync(...,'utf8'))` → `true` `[VERIFIED]`).
- The gate enumerates by `fs.readdirSync` directory walk, not grep, so the file cannot be
  skipped `[VERIFIED via check-api-route-security-matrix.js:32-38]`.
- The only tools degraded are **NUL-naive line greps**: BSD `grep` still *matches*
  (exit 0) but prints "Binary file … matches" instead of the line unless `-a` is passed
  `[VERIFIED]`. That bit this very audit: a `grep -o` guard-classification pass printed
  empty for this one file. Human/agent-tooling ergonomics, not a gate blind spot — no
  security gate depends on NUL-naive grep.

**Verdict:** REFUTED — the NULs cannot blind any current Node-based route enumeration or
security gate. Informational.

**Disconfirming check.** Drop a NUL-containing, guard-less fixture under `pages/api` and
run `check:api-routes` — expect it flagged. (Not run here; the gate's self-test already
exercises the walker.)

**Remediation (cosmetic only).** Replace each literal NUL byte with the **escape sequence
`'\u0000'` (or `'\x00'`) in source** — the runtime string, and therefore the composite-key
semantics and collision behavior, are byte-identical, while the file becomes NUL-free for
`file(1)` and line-greps. Do **not** substitute a printable delimiter: that changes the
runtime key format and would require proving no model id / token type can contain the new
delimiter. Zero security impact; do not prioritize.

---

## 9. Cross-cutting observations (not new findings)

- The **effect-layer dedup pattern** (Postgres reservation before external side effect;
  etag-claim-before-send; re-read-and-compare on response drop) is applied consistently
  and well in BILL onboarding and grantee replace-submission. Send-invite deliberately
  opts out (resend is a feature). Mature partial-success posture.
- **Revocation is enforced per-request at the route-helper layer only — and even there it
  fails open on a missing profile row.** Neither the session layer (`jwt` callback keeps
  stale staff claims on a zero-row active lookup, `[...nextauth].js:248-268`) nor the edge
  (`proxy.js` checks idle + claim presence only) participates in disablement, and sessions
  self-renew indefinitely with activity (§1). Worse, the two helpers that *do* read
  `is_active` treat a **missing** row as active (`auth.js:205-209, 300`), and
  `link-profile` can mint a fresh active profile for a disabled-but-`needsLinking` session.
  No single layer is authoritative for revocation; §1's behavioral-invariant set (current
  request blocked + subsequent claims invalidated + missing-row-fails-closed +
  link-profile covered) is what makes the layers agree.
- Two D1-class **config-regression fail-opens** recur: DAL enforcement (documented) and
  `validateOrigin`'s `NEXTAUTH_URL` skip (§2) — the latter deliberate and unit-tested,
  but still silent-on-regression in production. The target/write interlock's
  invalid-value-fails-closed posture is the better pattern to converge on.
- The **proxy applicant-surface classification** (`/apply`, `/api/apply`) has drifted
  from the implemented applicant API namespace (`/api/intake/*`) — currently a launch
  blocker for intake rather than a security hole, but it must be fixed jointly with
  intake CSRF (§2c).

## 10. Owner recommendations & read-only production probes

**Recommended owner decisions (to record):**

1. **Authorize a separate Tier-2 revocation-hardening worktree after this audit merges.**
   §1 is now a class of related gaps (bare-auth routes, `link-profile` profile creation,
   session-claim staleness, missing-row fail-open in the two helpers), too broad for a
   one-line patch and worth its own scoped effort.
2. **Authorize behavioral invariants, not a prematurely fixed implementation.** The
   worktree must satisfy, and add regression tests for:
   - a disabled **or missing** staff profile blocks the **current** request;
   - stale JWT claims are invalidated for **subsequent** requests;
   - all four bare-auth routes **and** `link-profile` are covered;
   - active linking sessions, applicant sessions, and the `AUTH_REQUIRED=false` dev bypass
     remain functional;
   - a DB lookup **failure** (not a zero-row result) still **fails closed** (503).
3. **Intake proxy + CSRF stays deferred but is a mandatory joint launch prerequisite** —
   the proxy applicant-surface classification and intake Origin validation must ship
   together before the intake flow goes live (§2c).
4. **Recipient override (§3) and stateless grantee tokens (§4) remain accepted risks** —
   no change without a new owner decision.
5. **The `NEXTAUTH_URL` fail-closed change (§2) can fold into the next release
   preflight** — it does not block this audit.

**Read-only production probes (owner-executed; none block the source-level verdicts):**

1. Confirm current Production `NEXTAUTH_URL` is set and equals the branded staff host
   (e.g. via the existing `/api/health` check used for the 2026-06-23 verification).
   Until then, §2's "active in prod" status for the Origin layer is **`[ASSUMED]` on
   dated (June 2026) evidence** — the code path, either way, is verified.
2. Nothing else — findings 1 and 3–8 are fully source-decided.

## 11. What would change these verdicts

- §1 → closes only when **all four** invariants in §10.2 hold: a current-request
  `is_active` guard on the bare-auth routes, JWT-claim invalidation for subsequent
  requests, missing-row-fails-closed in `requireAuthWithProfile`/`requireAppAccess`, and a
  live `is_active` re-check in `link-profile` before `createNew`. Any single fix leaves a
  window (JWT-clear alone does not block the in-flight bare-auth request; a route guard
  alone does not stop the next proxy-gated request).
- §2 → fail-open closes if branches 3–4 fail closed in prod (tests updated); the intake
  CSRF item converts from latent to live the moment the proxy applicant-surface
  classification is extended — fix both together at intake launch.
- §4 → send-invite CONFIRMED status would change only with an idempotency window or a
  token-rotation redesign (separate owner decisions).
- §5 → the replay window becomes moot if a nonce store is added; already harmless via
  reservation dedup.
- §6 → the count/audience holds unless a route's guard or response body changes; re-run the
  balanced-expression scan to re-verify.
- §8 → stays REFUTED unless a gate is ever rewritten onto a NUL-naive read path (none
  today).

---

*Prepared read-only; revised same-day across two Codex adversarial-review rounds. No
runtime code, tests, `SESSION_PROMPT.md`, or plan/observability surfaces were modified.
Branch `codex/claude-security-followup-audit`. Do not merge; Codex performs the final
bounded read-only verification.*
