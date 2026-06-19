# Grantee Deliverables Portal — Build Plan

Status: **IN PROGRESS (S268).** Implementation plan for the portal whose design is resolved in
`docs/GRANTEE_PORTAL_SPEC.md` and whose Dataverse field wave is LIVE in prod (5 fields on
`akoya_request`). This plan decomposes the build into reviewable chunks (the proven
design→Codex-pre-impl→implement→Codex-post-impl loop) and frames the open decisions per chunk.

Grounding: the reviewer external portal was mapped in full this session (token primitive, lifecycle,
portal pages, upload/scan/SharePoint, invite email, rate-limit). Reuse-vs-fork is settled at the
file level (see `docs/GRANTEE_PORTAL_SPEC.md` "Reuse"): share the true primitives
(`lib/services/external-token.js` mint/verify, `lib/external/rate-limit.js`,
`lib/services/cloudmersive-scan.js`, `lib/utils/file-magic.js`, the Graph/SharePoint upload pattern);
build a **parallel grantee variant** of the lifecycle, pages, submit route, upload writer, and invite
— the reviewer versions are hardcoded to `wmkf_appreviewersuggestions`, `wmkf_reviewer*` fields,
`/external/review/`, `Reviewer_Uploads`, and reviewer form schema.

## Chunk breakdown

| # | Chunk | Surfaces | Depends on |
|---|---|---|---|
| 1 | **Token + auth foundation** | grantee token lifecycle, `verify-grantee-token`, `/external/grantee/[token]` page scaffold, `context` route (fail-closed) | schema (token state — see Q1) |
| 2 | **Abstract generation** | Executor prompt/template: `wmkf_abstract` → `wmkf_abstractformatted` | Executor contract |
| 3 | **Awardee-tab trigger UI** | workbench Awardee tab: list/select grant, program-aware recipient resolve + staff confirm, generate + send invite | 1, 2 |
| 4 | **Grantee portal UI** | edit abstract (in-portal text), upload image, caption, publish-image waiver submit-gate | 1 |
| 5 | **Submit route** | atomic SharePoint image upload + Dataverse PATCH (`wmkf_abstractapproved`, caption, image ref, status) + rollback; image magic-byte validation; virus scan | 1, 4 |
| 6 | **Status/lifecycle + reminders** | status transitions on the Awardee tab, optional reminder send | 3, 5 |

## Chunk 1 — Token + auth foundation (design)

The reviewer portal stores per-reviewer token state (`wmkf_externaltokenhash` / `issued` /
`expires` / `revoked`) on the `wmkf_appreviewersuggestions` row, and `verifyToken` (stateless JWT
verify) is paired with a stored-hash check to enable **single-token revocation** without rotating the
global secret. Our grantee design extends `akoya_request` inline (one deliverable package per grant),
and the **deployed wave has NO token-state fields**. So chunk 1 must resolve where grantee token
state lives — or whether we keep tokens stateless.

### Q1 — Token storage: stateless vs stored-hash (revocable)?
- **Option A — Stateless signed JWT (no new fields).** Mint a short-expiry HS256 token via the shared
  `external-token.js` primitive; verify is signature+expiry only. No Dataverse token fields.
  *Pro:* simplest; no second schema wave; matches this session's simplicity bias. *Con:* no
  revocation — a leaked link is valid until expiry; "regenerate" just mints a new token (old still
  works until it expires). Acceptable for a low-stakes, staff-initiated, one-package flow with a
  modest expiry (e.g. 30 days).
- **Option B — Stored-hash on `akoya_request` (revocable).** Add a small follow-up wave with
  `wmkf_granteetokenhash` / `wmkf_granteetokenissued` / `wmkf_granteetokenexpires` /
  `wmkf_granteetokenrevoked`, mirroring the reviewer lifecycle. *Pro:* single-token revocation +
  regeneration invalidates old links; matches the proven reviewer pattern. *Con:* a second schema
  wave + deploy; more fields on the vendor entity.
- **Recommendation (to confirm):** Option A for v1 (stateless, 30-day expiry), since the grantee flow
  is staff-initiated, low-volume, and non-controversial — add Option B's revocation later if a real
  need appears. Codex to pressure-test this against the leaked-link / re-invite scenarios.

### Q2 — Secret: reuse `EXTERNAL_LINK_SECRET` or a separate `GRANTEE_LINK_SECRET`?
- Reusing keeps one secret to rotate; a separate secret blast-isolates the two surfaces. Lean: reuse
  `EXTERNAL_LINK_SECRET` (already provisioned, rotation-aware via `_PREVIOUS`) but scope the token
  with a distinct claim (e.g. `aud: 'grantee'`) so a reviewer token can't be replayed on the grantee
  surface and vice-versa. Codex to confirm the audience-claim guard is sufficient.

### Q3 — Token payload shape.
- Reviewer JWT: `{ sub: suggestionId, req: requestId, ops, iat, exp, jti }`. Grantee analog:
  `{ sub: requestId, aud: 'grantee', ops: ['edit_abstract','upload_image'], iat, exp, jti }` — `sub`
  is the `akoya_requestid` itself (the package lives on the request; no per-grantee child row).
  Confirm `ops` set and whether `jti` is needed without stored-hash revocation.

### RESOLVED (S268, owner + Codex pre-impl review)
- **Q1 → Option A (stateless JWT), 30-day expiry.** No token-state fields, no 2nd schema wave.
  **Mandatory compensating guard (chunk 5):** the submit route re-loads `wmkf_granteedeliverablestatus`
  and **refuses to write once status is `Complete`** (protects finalized packages from a leaked/stale link).
- **Q2 → reuse `EXTERNAL_LINK_SECRET`** (rotation-aware) **+ an `aud:'grantee'` claim.** Codex confirmed
  the shared primitive neither mints nor surfaces `aud` today, so we additively extend
  `lib/services/external-token.js`: a new `mintScopedToken({subject,audience,ops,expiresAt})` (leaves
  reviewer `mintToken` untouched) and surface `aud`/`subject` on verify. The grantee verifier rejects
  any token whose `aud !== 'grantee'` — including reviewer tokens (which have no `aud`). Absent `aud`
  is NOT legacy-compatible on the grantee surface.
- **Q3 → `sub = akoya_requestid`** (deliverable lives inline on the request). `jti` kept (audit
  correlation, harmless). `ops = ['edit_abstract','upload_image']` carried for primitive compatibility
  but NOT relied on for authz in chunk 1 — the route + status allowlist are the real guards.
- **Fail-closed:** unknown/missing `wmkf_granteedeliverablestatus` must NOT default to editable; use an
  explicit editable-status allowlist. Route ordering: method → `checkRateLimit` → verify →
  `recordTokenOutcome` → fail-fast → only then fetch request context.
- **Base URL:** new `getGranteePortalBaseUrl()` = `GRANTEE_PORTAL_BASE_URL || NEXTAUTH_URL` (independent
  of the reviewer branded domain); URL path `/external/grantee/${jwt}`.

### Chunk 1 deliverables
- `lib/external/grantee-token-lifecycle.js` — `mintForRequest({ requestId, expiresAt })` →
  `{ jwt, url }`; `buildGranteeUrl(jwt)` → `${REVIEWER_PORTAL_BASE_URL or NEXTAUTH_URL}/external/grantee/${jwt}`.
  (Option B would add store/verify-hash/revoke.)
- `lib/external/verify-grantee-token.js` — wraps shared `verifyToken`, enforces `aud:'grantee'`,
  loads the `akoya_request` + the 5 deliverable fields, fail-closed.
- `pages/external/grantee/[token].js` — page scaffold: reads token from URL, fetches
  `/api/external/grantee/[token]/context`, fail-closed render on invalid/expired.
- `pages/api/external/grantee/[token]/context.js` — rate-limited (reuse `checkRateLimit`),
  token-verified, returns `{ ok, request:{title,requestNumber}, abstractFormatted, status, ... }`.
- Tests: token mint/verify (incl. audience-claim rejection of a reviewer token), context fail-closed.

## Open (later chunks)
- Chunk 2: the exact abstract-generation prompt/template + Executor wiring + style guide source.
- Chunk 5: image accepted formats/size; `file-magic.js` needs image magic-byte support (PNG/JPEG/…).
- Chunk 6: reminder cadence/deadline.

## Pointers
- Design: `docs/GRANTEE_PORTAL_SPEC.md`. Reviewer portal map: `docs/agent-wiki/topics/external-reviewer-portal.md`.
- Shared primitives: `lib/services/external-token.js`, `lib/external/rate-limit.js`, `lib/services/cloudmersive-scan.js`, `lib/utils/file-magic.js`.
- Reviewer variants to fork (do NOT mutate): `lib/external/token-lifecycle.js`, `pages/external/review/[token].js`, `pages/api/external/review/[token]/*`, `lib/services/review-upload.js`, `pages/api/review-manager/send-emails.js`.
