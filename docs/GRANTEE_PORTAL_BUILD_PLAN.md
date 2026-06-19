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
| 3 | **Generate + persist abstract** (split from the original combined chunk 3) | `POST /api/workbench/grantee-deliverables/generate` — generate via chunk-2 service, persist `wmkf_abstractformatted` + status→Drafted (ETag-conditional) | 2 |
| 3b | **Recipient resolution** | resolve TWO contacts — PI (`wmkf_projectleader`) + liaison (`akoya_primarycontactid`); staff confirm. Research-only (no program branching) | 3 |
| 3c | **Send invite** | grantee token mint (chunk 1) + M365 email (action-button + fallback), status→Invited | 1, 3, 3b |
| 3d | **Awardee-tab UI** | wire the empty workbench Awardee tab (`pages/workbench/[requestId].js:41`) | 3, 3b, 3c |
| 4 | **Grantee portal UI** ✅ | edit abstract (in-portal text), upload image, caption, publish-image waiver submit-gate (`GranteeDeliverableForm`) | 1 |
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
  token-verified, returns `{ ok, request:{title,requestNumber,meetingDate}, deliverable:{abstractFormatted,
  abstractApproved,caption,hasImage,status,statusLabel}, editable, view }`. `meetingDate` is included so
  the edit UI can frame the cycle ("for the {meetingDate} cycle"); the raw SharePoint image ref is NEVER
  returned — only `hasImage`.
- Tests: token mint/verify (incl. audience-claim rejection of a reviewer token + array-form aud +
  missing-sub + past-expiry), context fail-closed (status allowlist) + no image-ref leak.

## Chunk 2 — Abstract generation (design)

Owner supplied the editor prompt (third-person, tense-zoned house-style rewrite of the applicant's
abstract). It returns **plain prose** ("return only the rewritten abstract text"), which maps
directly to `wmkf_abstractformatted` (Memo). Mirrors the field-primer Executor precedent exactly.

- **Source input:** the existing `wmkf_abstract` (applicant-authored) — passed to the Executor as an
  **override variable** `source_abstract` (the caller reads the field; the service stays text-only and
  unit-testable, exactly like field-primer's `proposal_text`). It is **untrusted** (applicant text):
  declared `untrusted:true` + `dataClass:'abstract'` + `maxChars` so the Executor wraps it in nonce
  sentinels and injects the A7 preamble. NOT concatenated raw.
- **Prompt config:** `shared/config/prompts/grantee-abstract.js` — `SYSTEM_PROMPT` = owner's editor
  prompt verbatim; `USER_PROMPT_TEMPLATE` references the `{{source_abstract}}` slot. No A7 markers in
  the file itself (Executor-driven; injected by execute-prompt.js).
- **Output:** `parseMode:'raw'`, exactly one output `abstract_formatted`, `target.kind:'none'` → the
  text is RETURNED (`result.parsed.abstract_formatted`), not written by the Executor. The caller does
  the `wmkf_abstractformatted` write + status→Drafted (chunk 3, idempotent + lease — like field-primer's
  route). Raw mode does NOT strip markdown fences, so the service defensively strips any stray fence.
- **Seed:** `scripts/seed-grantee-abstract-prompt.js` (mirror `seed-field-primer-prompt.js`) writes the
  `grantee-abstract.generate` row into `wmkf_ai_prompts`. **executePrompt has NO bundled fallback** —
  the prod row is REQUIRED. **[SEEDED to prod 2026-06-18 — row `462c08ae-896b-f111-a826-000d3a3065b8`,
  verification checks passed.]** The seed imports its variable/output declarations from the prompt
  config (`PROMPT_VARIABLES`/`PROMPT_OUTPUT_SCHEMA`), so the live row cannot drift from the file the
  config-pin test guards; re-running `--execute` is idempotent (updates the current row).
- **Model:** `sonnet` (the Opus tier rejects the `temperature` param the Executor always sends — same
  constraint field-primer hit); `temperature` 0.3; `maxtokens` ~4096 (an abstract is ~1 page).
- **A7 registration:** add a `SURFACES` entry in `scripts/check-prompt-injection-tagging.js`
  (id `grantee-abstract-generate`, `promptFiles:['shared/config/prompts/grantee-abstract.js']`,
  Executor-driven) so the unregistered-prompt-file check passes.
- **Service:** `lib/services/grantee-abstract-service.js` — `generateGranteeAbstract({ sourceAbstract })`
  → `executePrompt({ promptName:'grantee-abstract.generate', overrideVariables:{ source_abstract },
  forceOverwrite:true })` → return the stripped text. Min-length guard on input + output.
- **Tests:** service happy path (mock executePrompt), defensive fence strip, empty/short input + output
  throw, untrusted var passed through. (The seed is a script; the prompt-injection gate covers registration.)
- **Codex pre-impl folded (S268):** seed uses NO `jsonSchema.required` (raw mode ignores it — raw/none
  precedent `scripts/seed-phase-ii-prompts.js`); SURFACES entry MUST carry
  `callSiteFiles:['lib/services/execute-prompt.js']` (`inv:26`) or the A7 marker check fails; service
  guards input (`< ~50` chars) and surfaces the Executor's `<20`-char short-output throw clearly.
- **Codex post-impl folded (S268):** CLEAN on items 1–4, four LOW. Addressed: (#5) lifted the variable/
  output schema into the config as the single source of truth + a `grantee-abstract-prompt-config` test
  that fails closed if `source_abstract` ever loses `untrusted:true`/`dataClass`/`maxChars` (the A7 gate
  alone can't catch that drift); (#6) added tests for `runSource` passthrough, language-tagged fences,
  and a defensive non-string-output guard in the service.

> **Chunk-3 REQUIREMENT carried from chunk-2 review (Codex 6a/6c):** chunk 2 returns text only
> (`target.kind:'none'`), so a generation that succeeds in chunk 2 but is never persisted is silently
> lost, and two concurrent generations would last-write-win. Chunk 3 (the Awardee-tab trigger that
> writes `wmkf_abstractformatted`) MUST own idempotency the way field-primer's Workbench mode does:
> reuse an existing value → acquire an ETag/lease → verify ownership → conditional persist
> (`pages/api/field-primer/generate.js:92-126,172-215`). Do NOT ship chunk 3 with a bare last-write PATCH.

## Chunk 3 — Generate + persist abstract (design)

The original chunk 3 (resolve recipient + generate + persist + send invite + Awardee-tab UI) is too
big for one reviewable slice, so it is split. **Chunk 3 = the generate-and-persist-abstract backend
route only** — it discharges the carried idempotency requirement and is self-contained/testable.
Recipient-resolution, send-invite (token mint + M365 email), and the Awardee-tab UI become chunks 3b+.

- **Route:** `POST /api/workbench/grantee-deliverables/generate` — `requireAppAccess(req, res, 'reviewers')`
  (matches the triage workbench-write precedent), `requestId` GUID-validated straight off `req.body`
  (trust-boundary gate), optional `regenerate`. Register in the security matrix.
- **Flow:** reuse-existing → (idempotency guard) → read `wmkf_abstract` source → `generateGranteeAbstract`
  (chunk-2 service) → persist `wmkf_abstractformatted` + `wmkf_granteedeliverablestatus` → `Drafted`,
  conditionally on a fresh ETag → return the abstract. `bypassDynamicsRestrictions` (external/trusted read).

### Q1 — Idempotency: full lease/nonce vs reuse + ETag-conditional write?
Field-primer stores its lease sentinel IN its result field because that field is a JSON envelope.
`wmkf_abstractformatted` is human-readable PROSE, so a transient lease sentinel there is awkward (and
the chunk-1 context route surfaces that field).
- **Option A — Full field-primer lease/nonce:** store a JSON lease sentinel in `wmkf_abstractformatted`
  during generation (parse helper distinguishes sentinel vs prose); strongest single-flight. Cost:
  overloads a prose field; the context route must learn to ignore a sentinel.
- **Option B (recommended) — reuse-existing + ETag-conditional write (no sentinel):** if
  `wmkf_abstractformatted` already populated and `!regenerate` → return it (no paid call); else read the
  row's `_etag`, generate, then `updateRecord` with `ifMatch` — a concurrent write 412s. Prevents
  corruption/last-write-win; the only downside is a rare double cold generation on a rapid double-click
  (one wasted paid call, no data harm). Fits a low-volume, single-staff-initiated action and keeps the
  prose field clean. The status flip to `Drafted` rides the same conditional update.
- **Recommendation:** Option B. Frame for Codex pre-impl to confirm it satisfies the carried
  "no bare last-write PATCH" requirement (it does: the write is ETag-conditional).

### RESOLVED (S268, Codex pre-impl — Option B approved, READY WITH NAMED CHANGES)
Six required behaviors baked into the route:
1. **No write without `_etag`** — `getRecord` surfaces `_etag`; if absent, fail closed (503), never a bare PATCH.
2. **412 handling** — on `err.status === 412`, re-read `wmkf_abstractformatted`; if now populated → 200
   `{reused:true, concurrent:true}`; if still empty → 409 (retryable). Never surface raw 412.
3. **Status non-downgrade** — read current `wmkf_granteedeliverablestatus`; include `Drafted` in the
   patch ONLY when current is null/empty or already Drafted; for Invited/Reminder/Submitted/Staff
   Review/Revision/Complete/Closed, preserve status and update only the abstract field.
4. **Missing source** — validate `wmkf_abstract` after the read; missing/too-short → 400 (not a 500).
5. **`actingUserSystemId`** passed on the write (caller attribution, like triage).
6. **GUID-validate off `req.body.requestId`** (trust-boundary gate) + **register in the security matrix**.
`regenerate` is honored only when strictly `=== true` (a string `"false"` must not force overwrite).
No restore-on-failure needed (Option B writes nothing before the final PATCH).

### Codex post-impl folded (S268)
CLEAN on all six required behaviors (etag fail-closed before the paid call, 412→re-read, status
non-downgrade incl. numeric-string coercion, missing-source 400, actingUserSystemId, GUID off body).
Two ISSUEs: (#5) `loadModelOverrides()` ran before the reuse check → moved onto the generation path
only (reuse/early-return paths skip it; test asserts it). (#6) no row-level auth gate — this is the
*deliberate, pre-impl-approved* decision (draft generation is non-authoritative, unlike triage's
visibility write; app-level `reviewers` matches the workbench norm); the `bypassDynamicsRestrictions`
scope spanning generation is safe because `executePrompt` re-enters bypass internally. Added tests:
numeric-string status non-downgrade, non-412 update→500, 503-skips-generation, null `_etag`.
- **Tests:** reuse-existing skips generation; first write succeeds + sets Drafted; a stale-ETag write
  412s and does NOT clobber; GUID/method/auth guards; missing-source 400; regenerate overwrites.

## Chunk 4 — Grantee portal edit UI (DONE, S268)

`shared/components/external/GranteeDeliverableForm.js`, rendered in the `view==='edit'` branch of
`pages/external/grantee/[token].js`. Abstract editor (prefilled from `abstractApproved || abstractFormatted`),
image upload, caption, and the **publish-image waiver checkbox as a client-side submit gate**: the
submit button is disabled until the waiver is checked AND abstract + caption + an image (new upload or
one already on file) are present. The waiver is NEVER sent — a submitted package is the consent record.
On success the form renders a thank-you state. 5 RTL tests (waiver gate, image-required, multipart
contract, thank-you, error re-enable). The waiver wording is interim (exact legal text = open item).

**Submit contract (defined here; chunk 5 implements it):**
`POST /api/external/grantee/{token}/submit` — `multipart/form-data` with `editedAbstract` (text),
`caption` (text), `image` (File; optional only if one is already on file). Returns `{ ok: true }` on
success, else `{ error }`. The route MUST: verify the grantee token (chunk 1, `aud` guard);
**refuse once status is `Complete`** (the chunk-1 carried guard); image magic-byte validate (file-magic.js
needs image support added) + virus-scan; upload the image to SharePoint and PATCH Dataverse
(`wmkf_abstractapproved`, `wmkf_granteeimagecaption`, `wmkf_granteeimagefileref`, status→`Submitted`)
**atomically with rollback** (mirror `lib/services/review-upload.js`).

## Chunk 3b/3c — Recipient resolution + send invite (design RESOLVED, owner S268)

**Scope: RESEARCH grants only.** The deliverable (publication abstract + graphical abstract) is a
research-output thing; staff simply don't run the workflow on non-research grants. This removes all
program-family branching — no SoCal/Discretionary logic needed.

**Recipients: TWO, both legible on `akoya_request` as contact lookups (owner-confirmed):**
- **PI** = `wmkf_projectleader` → `contact` (the principal investigator; Research native fill ~90–98%).
- **Liaison** = `akoya_primarycontactid` → `contact` — the institution's WMKF **foundation liaison /
  grant steward** (NOT the PI; documented in `lib/services/dataverse-export/constants.js:362` + the
  dynamics-explorer prompt). 
Resolve each contact's `emailaddress1` + `firstname`/`lastname` (read the two `_*_value` lookups off
the request, then load the contacts — or `$expand`). Return both with a missing-email flag.

### Chunk 3b — recipient resolution
- `GET /api/workbench/grantee-deliverables/recipients?requestId=<guid>` — `requireAppAccess('reviewers')`,
  GUID-validated. Returns `{ pi: {contactId,name,email,hasEmail}, liaison: {…} }`. Read-only.
- Staff confirm/override both addresses on the Awardee tab before send (no auto-send).

### Chunk 3c — send invite
- **One stateless magic-link** per request (chunk-1 `mintForRequest`); BOTH recipients get the SAME
  link (one package per request — the token's `sub` is the requestId). 
- Email **both** (PI + liaison) from the PD mailbox via the Dynamics email-activity send (reuse the
  reviewer `send-emails` M365 pattern); action-button + copy-paste fallback link (the email-button URL
  matcher must include `/external/grantee/`, not just `/external/review/`).
- **Send UX: staff confirm recipients + preview/edit the email body, then send** (owner choice).
- Requires the abstract generated first (status ≥ Drafted). On send → status → `Invited`
  (non-downgrade). Optional reminder is chunk 6.

### Chunk 3d — Awardee-tab UI
- Wire the empty workbench Awardee tab (`pages/workbench/[requestId].js:41`): Generate (chunk 3) →
  show recipients (3b) → confirm + preview → Send (3c); reflect status.

## Open (later chunks)
- Chunk 5: image accepted formats/size; `file-magic.js` needs image magic-byte support (PNG/JPEG/…).
- Chunk 6: reminder cadence/deadline + exact waiver/T&C and email-body wording.

## Pointers
- Design: `docs/GRANTEE_PORTAL_SPEC.md`. Reviewer portal map: `docs/agent-wiki/topics/external-reviewer-portal.md`.
- Shared primitives: `lib/services/external-token.js`, `lib/external/rate-limit.js`, `lib/services/cloudmersive-scan.js`, `lib/utils/file-magic.js`.
- Reviewer variants to fork (do NOT mutate): `lib/external/token-lifecycle.js`, `pages/external/review/[token].js`, `pages/api/external/review/[token]/*`, `lib/services/review-upload.js`, `pages/api/review-manager/send-emails.js`.
