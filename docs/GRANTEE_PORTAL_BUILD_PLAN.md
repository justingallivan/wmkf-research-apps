# Grantee Deliverables Portal — Build Plan

Status: **IN PROGRESS (S268; chunks 7–8 designed S269, pending Codex pre-impl review).** Implementation plan for the portal whose design is resolved in
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
| 3b | **Recipient resolution** ✅ | resolve TWO contacts — PI (`wmkf_projectleader`) + liaison (`akoya_primarycontactid`); staff confirm. Research-only (no program branching). `GET .../recipients` | 3 |
| 3c | **Send invite** ✅ | grantee token mint (chunk 1) + M365 email (PI `To`, liaison `Cc`, action-button + fallback), status→Invited. `POST .../send-invite` | 1, 3, 3b |
| 3d | **Awardee-tab UI** ✅ | `AwardeeTab` wired into the workbench tab dispatch — generate → confirm recipients → preview → send | 3, 3b, 3c |
| 4 | **Grantee portal UI** ✅ | edit abstract (in-portal text), upload image, caption, publish-image waiver submit-gate (`GranteeDeliverableForm`) | 1 |
| 5 | **Submit route** ✅ | `POST .../submit`: atomic SharePoint image upload + ETag-conditional Dataverse PATCH (`wmkf_abstractapproved`, caption, image ref, status→Submitted) + rollback; image magic-byte (`validateGranteeImage`) + virus scan; `grantee-upload` service | 1, 4 |
| 6 | **Status/lifecycle + reminders** | status transitions on the Awardee tab, optional reminder send | 3, 5 |
| 7 | **Edited-title generator (S269)** ✅ | Sonnet prompt (`grantee-title.generate`, title+abstract) + cron-poll on `wmkf_phaseistatus=Invited` → writes the EXISTING `wmkf_wmkfprojectdescription` when empty (research-only, idempotent; no new schema). Prompt/service/seed/A7 BUILT; prompt seeded to prod v1 (S269); cron **deployed + registered in the Vercel cron registry (S270)** | Executor contract |
| 8 | **Document assembly + export (S269 design; S270–271 build)** | server-side template (structured header + edited title + body/caption) → portal preview · website HTML · cycle-level export. **Foundation + outputs (b) website HTML & (c) cycle export BUILT (S270); (a) portal preview BUILT (S271, title display-only)** | 7, 5 |

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
  config-pin test guards. **Seed governance (S269): create-only via `lib/services/prompt-seed.js`** —
  a plain re-run of `--execute` now REFUSES (the row exists); edits go through `/admin` (versioned), and
  `--execute --force` publishes a version-preserving recovery. (Was: "re-run is an idempotent in-place
  update" — superseded.)
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
- Email the **PI in `To`** and the **liaison in `Cc`** (owner S268) from the PD mailbox via the Dynamics
  email-activity send (reuse the reviewer `send-emails` M365 pattern); action-button + copy-paste
  fallback link (the email-button URL matcher must include `/external/grantee/`, not just
  `/external/review/`). Both addressees share the one magic-link.
- **Send UX: staff confirm recipients + preview/edit the email body, then send** (owner choice).
- Requires the abstract generated first (status ≥ Drafted). On send → status → `Invited`
  (non-downgrade). Optional reminder is chunk 6.

### Chunk 3d — Awardee-tab UI ✅ (S268)
`shared/components/workbench/AwardeeTab.js`, wired into the workbench tab dispatch
(`pages/workbench/[requestId].js`). Staff orchestration over the existing endpoints: Generate/Regenerate
abstract (chunk 3, reuse-path doubles as load) → recipients auto-resolved on mount (3b, PI in To +
liaison in Cc, editable) → subject/body preview/edit → Send (3c) → status reflected. Action-driven (no
new endpoints). 4 RTL tests. (Self-reviewed + tested like chunk 4; a Codex pass can run later.)

### Codex post-impl folded (3b/3c, S268)
CLEAN on security (server-minted link injection, body HTML-escaped, GUID validation, no log/header
injection, render escaping). Three REAL issues fixed: (1) **NaN bypass** — a non-numeric
`wmkf_granteedeliverablestatus` made every guard comparison false and would mint/send; now a
non-null `NaN` status → 500 (fail loud). (2) **False status report** — a failed status write after a
successful send used to return `status: Invited`; now returns the ACTUAL durable status (stays
Drafted) + a `statusPersisted:false` flag. (3) added tests for NaN-bypass, numeric-string coercion,
the write-failure body, and `cc:undefined`. Two CONCERNs **documented as deliberate, not changed**:
(a) To/Cc are staff-confirmed and trusted (the owner asked for confirm/**override** — hard-restricting
to the request's PI/liaison would break override; the route is staff-authed outbound); (b) no
server-side Research-only gate (staff only run this from research Awardee tabs; a program gate reopens
the deferred polymorphic-program-field question — revisit if the surface widens).

## Chunk 5 — Submit route (design)

Closes the round-trip: `POST /api/external/grantee/[token]/submit` (the contract the chunk-4 UI
already posts to). Mirrors `lib/services/review-upload.js` (atomic upload→PATCH→rollback) but is a
PARALLEL grantee variant — not a mutation of the reviewer path.

- **Auth/order:** token-authed (NOT app-authed). method → `checkRateLimit` → `verifyGranteeToken`
  (chunk 1, `aud` guard) → `recordTokenOutcome` → fail-fast → parse → validate → scan → upload → PATCH.
  `config.api.bodyParser = false` (busboy needs the raw stream).
- **Status guard (fail-closed):** refuse unless the request's `wmkf_granteedeliverablestatus` is in the
  EDITABLE allowlist (Drafted / Invited / Reminder Sent / Revision Requested) — same set the context
  route renders editable. This subsumes the chunk-1 carried **Complete guard** (Submitted / Staff
  Review / Complete / Closed / null / unknown all refuse → 409). On success → status `Submitted`.
- **Multipart (busboy):** fields `editedAbstract` (text, required, min length), `caption` (text,
  required); ONE `image` file (≤ a sane cap, e.g. 15 MB; `limits.files: 1`). Image is required UNLESS
  one is already on file (`wmkf_granteeimagefileref` present) — then a new upload replaces it.
- **Image validation:** add image magic-byte support to `lib/utils/file-magic.js`
  (`validateGranteeImage` — PNG/JPEG/GIF/WEBP signatures + extension match) — the gap Codex flagged in
  chunk 1. Then virus-scan via `scanBytes` (Cloudmersive, gated on `VIRUS_SCAN_ENABLED`), same
  fail-closed posture as review-upload.
- **SharePoint:** upload to the `akoya_request` library under
  `{requestNumber}_{guidNoHyphensUpper}/Grantee_Uploads/` (parallel to `Reviewer_Uploads/`). Track the
  uploaded item for rollback.
- **Atomic PATCH + rollback:** `updateRecord('akoya_requests', requestId, { wmkf_abstractapproved,
  wmkf_granteeimagecaption, wmkf_granteeimagefileref, wmkf_granteedeliverablestatus: Submitted })`. On
  PATCH failure, `cleanupSharePointItems` (delete the just-uploaded image) so no orphan file. No
  `actingUserSystemId` (external/grantee, no staff identity) — runs in `bypassDynamicsRestrictions`.
- **Service:** `lib/services/grantee-upload.js` (`writeGranteeDeliverables`) holds validate→scan→
  upload→PATCH→rollback; the route does token+status+multipart. Keeps the service text/buffer-testable.
- **Tests:** image magic accept/reject; status allowlist (Complete/Submitted → 409, Drafted → ok);
  edited-abstract/caption required; image required when none on file / optional when one exists;
  SharePoint-fail → no PATCH; PATCH-fail → rollback (image deleted); token aud-reject; happy path
  writes all four fields + Submitted.

### RESOLVED (S268, Codex pre-impl — READY WITH NAMED CHANGES)
1. **ETag/If-Match on the submit PATCH** (TOCTOU: staff could change status between the guard read and
   the write). Re-read `_etag`; PATCH with `ifMatch`; on 412 → roll back the newly uploaded image →
   409. Fail closed (503) if no `_etag`.
2. **Old-image cleanup on replace:** upload new → conditional PATCH → ON SUCCESS best-effort delete the
   PRIOR image (log on failure; orphan, not data loss). NEVER delete the old image before the PATCH
   succeeds (an upload/PATCH failure must leave a usable image).
3. **Deterministic server filename:** ignore the attacker-supplied filename; store as
   `{requestNum}_grantee_image.{ext}` where `ext` comes from the VALIDATED magic type. Upload
   Content-Type also derives from the validated type, not the browser MIME.
4. **WEBP needs an offset check** (`RIFF`@0 + `WEBP`@8) — `validateGranteeImage` checks bytes at
   arbitrary offsets, not just `startsWith`.
5. **Extract `cleanupSharePointItems`** to a shared `lib/services/sharepoint-cleanup.js` (review-upload
   imports it from there — behavior identical; no duplication) and the grantee service reuses it.
6. Busboy: `files:1`, image cap a named constant (15 MB), `fieldSize` ~64 KB (4 KB would truncate the
   abstract), `fields` ~5. Order: magic-byte → scan (soft-pass when `VIRUS_SCAN_ENABLED=false`) →
   upload. No raw Graph/Dataverse error / SharePoint path / item-id / file-ref leaked to the client.

### Codex post-impl folded (S268)
CLEAN on all seven substantive items (extraction safety, rollback, stale-prune, guard/order + TOCTOU
via ETag, image validation incl. WEBP offset, security, context refactor). One self-found fix during
test: prune now excludes the just-uploaded file by **item id** (not the random nonce name), so a
replace can never delete the new image. Two test gaps closed: SharePoint-upload-failure → no PATCH;
route busboy `FILE_TOO_LARGE`/`TOO_MANY_FILES` → 400. Full parallel suite 2802/2802.

## Awardee discovery + eligibility (S268) ✅

The reviewer-finding **dashboard does not surface awardees** (it filters
`akoya_requeststatus='Phase II Pending'` OR `wmkf_triagestatus=Advancing` — the pre-decision pipeline).
Awardees are post-decision, so a separate surface was needed.

**Eligibility (owner-validated against live J26 = 12 awardees):** a research awardee is
`akoya_requeststatus = 'Active'` AND `akoya_programid` ∈ a research-program set AND `wmkf_projectleader`
present (the PI requirement excludes the standing endowment #985674; the program set excludes
Active-with-a-PI civic grants like #1002650). NOTE: `wmkf_phaseistatus = Invited` is NOT "awarded" — it
means "invited into the competition" (205 J26 rows, mostly Phase I Declined). Probe pagination matters:
the J26 query is **685 rows** (a `$top=500` truncates it).

- **Config (NOT hard-wired — owner: program names may change):**
  `shared/config/granteeResearchPrograms.js` — `GRANTEE_RESEARCH_PROGRAM_IDS` (GUID-keyed per the Atlas
  duplicate-name caution; seeded with Science & Engineering Research + Medical Research) +
  `GRANTEE_AWARDED_STATUS='Active'`. Single edit point when programs change.
- **Endpoint:** `GET /api/workbench/grantee-deliverables/awardees?cycleCode=J26` — returns the cycle's
  awardees with formatted PI/liaison/program names + deliverable status. App-authed; no client GUID
  reaches a selector.
- **UI:** `pages/workbench/awardees.js` — cycle picker (defaults to the current board cycle) → table →
  each row links to `/workbench/{requestId}?tab=awardee`. 6 tests (endpoint filter + mapping; page render + links).

**PD access:** a superuser grants each PD the **`reviewers`** app in `/admin` (Users; `api/admin/users.js`
is `requireSuperuser`-gated). That's all a PD needs for the Awardee tab + this list.

## Chunk 7 — Edited-title generator (S269, design)

Generates the house-style **edited title** (the italic one-line objective on the PD's award document)
**once, at the Phase I→II `Invited` flip**, and stores it for reuse by the Board Book (external) and
the later abstract assembly (chunk 8). Independent of the abstract flow — a different trigger, model,
and field. Grounding: `docs/GRANTEE_PORTAL_SPEC.md` D7 + the `project-phaseistatus-decision-lifecycle`
memory. `[VERIFIED S269 via live probe: request 1002852 + `wmkf_phaseistatus` option-set metadata]`

**Trigger (verified):** `wmkf_phaseistatus = 100000003 (Invited)`. The staff recommendation that
precedes the board is `Recommended Invite` (707510005) on the same field; the official promotion is
`Invited`. NOT `akoya_requeststatus`, NOT `wmkf_phaseiistatus` (Phase **II**, a separate field).

**Target field — EXISTING `wmkf_wmkfprojectdescription` (NO new schema wave).** `[VERIFIED S269 via
live probe: field metadata + all 12 J26 awardees]` The edited title already has a home: the staff
curate it manually into `wmkf_wmkfprojectdescription` today (Memo, maxLen 2000, display "WMKF Project
Description"). The cron **writes this existing field when empty**; staff can edit afterward. This
supersedes the earlier "new `wmkf_ai_editedtitle` wave" plan — no wave, no preflight, no Atlas-add
(the field already exists; update the Atlas field DESCRIPTION to note it is now AI-written-when-empty).
- ⚠️ **`wmkf_projecttitle1` is a DIFFERENT field** — slot 1 of a numbered `wmkf_projecttitle1..3`
  family (String 500, "Project Title N"; slots 2/3 empty on the sampled record), a vendor-style
  multi-slot pattern like `wmkf_copi1..5`. It carries a **hypothesis/question** phrasing (e.g. 1002238:
  *"To determine if electrical signals … represent organized communication or incidental activity"*),
  distinct from the **aim/method** phrasing in `wmkf_wmkfprojectdescription` (*"To visualize … using
  genetically-encoded voltage indicators"*). **No repo code reads or writes `wmkf_projecttitle*`**
  (verified via grep) — **do NOT read or write it.** `[VERIFIED S269 via live probe + repo grep]`
- **Provenance — empirical findings `[VERIFIED S269 via live probe]`:** the field is
  **program-polymorphic**. In **SoCal** `wmkf_projecttitle1` is populated at the concept stage (100% of
  Concept Done). In **Research** BOTH title fields are **empty pre-Invited** (0/179 Pending Committee
  Review; 0/202 Phase I Pending) and only populate at **Invited/decided** (`wmkf_wmkfprojectdescription`
  15/15 Invited, `wmkf_projecttitle1` 11/15). So in Research both are **late, staff/board-era** fields,
  not intake fields (e.g. D26 #1002952, pre-Invited → both empty; intake = "# BCO akoyaGO Integration").
- **Provenance — working hypothesis `[UNVERIFIED — owner emailed Connor + Sarah S269; confirm + document]`:**
  `wmkf_wmkfprojectdescription` is **authored by the PD at the END of the process** (our target field);
  `wmkf_projecttitle1` may be the **staff's earlier best-guess title**, used upstream (e.g. building a
  Phase I board book). Treat as ASSUMED until Connor/Sarah confirm — see the Open-items entry.
- ✅ **PA verification — RESOLVED (S270): no AkoyaGO/PA flow fires on a `wmkf_wmkfprojectdescription`
  write; safe for the cron.** This is/was a chunk-7 acceptance criterion (we write an EXISTING,
  board-facing, human-curated field — a flow could have been watching it). Closed via field-level
  audit-trail analysis across J26/D25/J25/D24: the field is **exclusively human-curated** — every dated
  set-event is a named staff member (Sarah Hibler / Kevin Moses / Jean Kim / Thomas Rieker / Melissa Gage
  / Connor Noda), **no service-principal / flow writer**, with human-paced gaps (seconds within a sitting
  → days/months across a cycle; multiple editors; multi-edit revisions) — the opposite of a flow's
  single-identity burst; and **no service-account audit follows the human edits** (no read/react
  trigger-flow). **Owner confirmed S270: no trigger-flow watches the field.**
- **Write-when-empty only** protects the manual curation: the cron never overwrites a populated value
  (the empty-field predicate), so staff edits and pre-existing manual titles are safe.

**Prompt (`grantee-title.generate`) — BUILT (S269, `d36e0459`).** `shared/config/prompts/grantee-title.js`
+ `scripts/seed-grantee-title-prompt.js` (mirror the abstract seed; the prod row is REQUIRED — no
bundled fallback). Source = **applicant TITLE (`akoya_title`) + ABSTRACT (`wmkf_abstract`)** as **two
untrusted** override variables (`source_title` + `source_abstract`, both `untrusted:true` + `dataClass`
+ `maxChars`, A7-wrapped). Output `parseMode:'raw'`, single output `edited_title`, `target.kind:'none'`
(returned, caller persists). **Model: Sonnet, temp 0.1** (validated S269 against 12 J26 answer keys +
held-out exemplars — Sonnet materially beat Haiku on this distillation, and the Opus tier rejects the
`temperature` param the Executor sends). Registered in `check:prompt-injection-tagging` (A7, inv:27).
**SEEDED to prod (v1, S269)** — re-running `--execute` now correctly REFUSES (create-only governance,
`lib/services/prompt-seed.js`); edit via `/admin` (versioned) or `--execute --force` (version-preserving).

**Service — BUILT (S269).** `lib/services/grantee-title-service.js` — `generateGranteeTitle({ sourceTitle,
sourceAbstract, runSource })`, thin Executor wrapper returning the cleaned one-liner. Input guards
(no paid call on short/empty); `cleanTitle` (fence strip → first `To …` line → quote strip →
abbreviation-safe trailing-period strip); fail-closed output guard requiring a non-empty `To …` line
(rejects refusals). ⚠️ The cron MUST pass a **valid `runSource`** picklist value (e.g. `Vercel User` /
`PowerAutomate Auto`) — `executePrompt` throws on unknown values.

**Trigger surface — cron-poll (owner: preferred).** `pages/api/cron/generate-grantee-titles.js`,
`verifyCronSecret`-guarded, scheduled in `vercel.json`. Each run, **scoped to the current open board
cycle** (Codex pre-impl BLOCKER — without this, first deploy reprocesses years of historical `Invited`
rows): build the filter from `cycleCodeToOdataFilter(currentCycle, 'wmkf_meetingdate')` (the exact
pattern the awardees endpoint uses, `pages/api/workbench/grantee-deliverables/awardees.js:43`) **AND**
`wmkf_phaseistatus eq 100000003` **AND** `wmkf_wmkfprojectdescription` empty **AND** research program
(`GRANTEE_RESEARCH_PROGRAM_IDS`, `shared/config/granteeResearchPrograms.js`). For each row: read
`akoya_title` + `wmkf_abstract` → `generateGranteeTitle` (Sonnet) → **ETag-conditional persist** to `wmkf_wmkfprojectdescription`
(no bare last-write PATCH; chunk-3 idempotency discipline). Idempotent + re-runnable (the slate
reshuffles; already-filled rows fall out of the empty-field predicate, protecting manual curation).

**Paginated query — REQUIRED (Codex pre-impl BLOCKER, verified).** `DynamicsService.queryRecords`
hard-caps `$top` at 100 (`Math.min(top||25,100)`, `lib/services/dynamics-service.js:435`) — the
awardees endpoint is safe only because J26 had 12 awardees. Research `Invited` rows for a cycle can
exceed 100, so the cron MUST use the paginated `DynamicsService.queryAllRecords` (returns
`{ records, totalCount, capped }`) and **act on `capped`** (log + alert rather than silently drop the
tail). `[VERIFIED: dynamics-service.js queryRecords cap vs. queryAllRecords nextLink pagination]`

**Per-row failure contract (Codex pre-impl CONCERN).** A row whose `wmkf_abstract` is missing/too-short,
or whose generation repeatedly fails, must NOT be retried every run forever. Mirror the abstract
service's fail-closed input guard (`lib/services/grantee-abstract-service.js:45-48`): on an
unprocessable row, **skip + report** (structured log line per skipped requestId; the cron summary
returns counts: generated / skipped-no-source / failed). A model failure leaves the field empty (so it
retries next run) but is surfaced; a missing-source row is reported so staff can fix `wmkf_abstract`.
(A persistent-failure cap can be added later if needed — out of v1 unless Codex pushes.)

**The just-finished cycle (J26) needs NO title backfill.** `[VERIFIED S269: all 12 J26 research
awardees already have `wmkf_wmkfprojectdescription` populated]` Staff hand-curated every J26 edited
title for the June board books, so there is nothing to generate or backfill this cycle — the empty-field
predicate skips all 12 automatically, which is exactly the owner's "don't regenerate" instruction. The
**4 S&E awardees** (#1002132/1002238/1002305/1002365) keep their existing manual titles and serve as
the Track-B abstract-portal trial (run the S268 flow on them). A cycle-scoped one-off invocation remains
available as a general safeguard for any FUTURE cycle whose titles weren't pre-filled, but J26 does not
exercise it.

### RESOLVED (Codex pre-impl review, S269)
- **Cycle bound** — go-forward cron scoped to the current open cycle via `cycleCodeToOdataFilter` on
  `wmkf_meetingdate`. Closes the unbounded-historical-rows BLOCKER. (J26 needs no backfill — already
  fully populated; see above.)
- **Pagination** — `queryAllRecords` (paginated), honor `capped`. Closes the >100-cap BLOCKER.
- **Target field** — the EXISTING `wmkf_wmkfprojectdescription` (Memo 2000), written when empty; NO new
  wave (supersedes the earlier `wmkf_ai_editedtitle` plan). `wmkf_projecttitle1` is unrelated — leave it.
- **Atlas + PA verification** — update the existing field's Atlas description (now AI-written-when-empty);
  PA run-history verification on a `wmkf_wmkfprojectdescription` write is an acceptance criterion.
- **Per-row failures** — skip + report contract (above).
- **Re-generation on reshuffle** — empty-field predicate means **once filled, never auto-redone**;
  a deliberate re-edit is a manual staff regenerate (out of the cron). This is the intended semantics.
- **Idempotency mechanism** — ETag-conditional write is sufficient (no concurrent writer; the
  empty-field predicate + ETag guard re-entrancy across runs). No heavier lease needed.

## Chunk 8 — Document assembly + export (S269, design)

Server-side template assembling the award document from structured Dataverse fields + the generated
content, replacing the PD's manual DOCX build and the staff member's manual website-HTML coding.
Grounding: `docs/GRANTEE_PORTAL_SPEC.md` D8/D9.

**Assembly inputs (per request):** institution name (`akoya_applicantid` → account; **bold**),
institution city/state (account address; *italic*), **PI = `wmkf_projectleader`; Co-PIs = the existing
`fetchCoPIs(requestId)` helper** (`lib/services/proposal-participants.js`, `wmkf_apprequestperson`
junction role=Co-PI **only** — NOT a UNION with `wmkf_projectleader`; the UNION is the PI-history
pattern, a different thing — Codex pre-impl catch) (*italic*), award amount (`akoya_grant` /
`akoya_originalgrantamount`, currency-formatted; **never** `akoya_request`), edited title
(`wmkf_wmkfprojectdescription`, chunk 7; *italic*), body (`wmkf_abstractapproved ||
wmkf_abstractformatted`, markdown→HTML), and for the
website, caption + image. All **structural formatting lives in the template** (keyed on field
identity); only body/caption carry inline markdown (D8). `[VERIFIED co-PI read: proposal-participants.js
fetchCoPIs, role=Co-PI 100000001]`

**Outputs (owner: "output will vary"):**
- **(a) Portal review preview** ✅ *BUILT S271* — the assembled, styled document (`renderAwardBlock`)
  shown in the grantee portal above the editable body; ALL header fields display-only, including the
  edited title (owner decision S271: title is staff-owned/fixed, NOT PI-editable → no title write-back
  path). The external grantee-token context route (`pages/api/external/grantee/[token]/context.js`)
  assembles the model WITHOUT the private image ref (`includeImageRef:false`) and renders WITHOUT the
  image figure (`includeImage:false`), keeping that surface `hasImage`-only; the preview is fail-soft
  (assembly/render failure → `preview:null`, never breaks the form-bearing core response) and computed
  only for the `edit`/`submitted` views. Rendered on the page via `AwardPreview` (server-sanitized HTML).
- **(b) Website HTML** ✅ *BUILT S270* — clean controlled HTML for the staff member to drop into the
  site, replacing manual coding. `GET /api/workbench/grantee-deliverables/website-html?requestId=<guid>`.
- **(c) Cycle-level export** ✅ *BUILT S270* — all of a cycle's awarded abstracts assembled together
  (replaces today's "compile all into one PDF and post it"). **Format = combined HTML** (owner decision
  S270; reuses the same renderer as (b), print-to-PDF in the browser).
  `GET /api/workbench/grantee-deliverables/cycle-export?cycleCode=J26`.

### RESOLVED (Codex pre-impl review, S269)
- **One canonical assembly model (Codex ISSUE).** A single shared service
  (`lib/services/grantee-document-assembly.js`) reads every field ONCE and returns a structured model
  `{ institution, location, pi, coPIs[], amount, editedTitle, bodyHtml, caption, image }`; all three
  outputs (portal preview, website HTML, cycle export) consume that model — no per-output field
  re-reads. Closes the copy-paste-drift risk across PI/co-PI/amount/title/markdown.
- **One markdown subset + render policy (Codex ISSUE).** Canonical inline subset = **bold, italic,
  super/subscript** (D8); rendered by ONE shared renderer to a tight allowlist (`em/strong/sub/sup`)
  at assembly time. The **edited title is plain text** (a single line, italicized structurally by each
  consumer) so **no raw markdown reaches the Board Book** (the title is the only field the Board Book
  consumes from us). Body/caption render identically across portal preview, website HTML, and export —
  no surface ever shows unrendered `*…*`.
- **Co-PI read (Codex ISSUE).** PI = `wmkf_projectleader`; Co-PIs = `fetchCoPIs(requestId)` (junction
  role=Co-PI only). Name-join "A and B" / "A, B, and C". (See Assembly inputs above.)
- **Website/cycle image + auth boundary (Codex ISSUE).** The website + cycle export are **staff-authed,
  server-side** (`requireAppAccess('reviewers')`), so they read `wmkf_granteeimagefileref` directly —
  the portal context route's `hasImage`-only rule is a constraint on the **external grantee-token**
  surface, not on staff exports. State this boundary explicitly in the route headers.
- **Cycle export scope + access** — keyed by `cycleCode` (`cycleCodeToOdataFilter` on `wmkf_meetingdate`,
  awardees-endpoint pattern), **awarded research only** (`Active` + `GRANTEE_RESEARCH_PROGRAM_IDS` + PI
  present), `requireAppAccess('reviewers')`. On-demand v1 (cron-prebuilt only if volume warrants).

### BUILT (S270)
- **Foundation (commit `221da226`).** Three output-agnostic modules:
  - `shared/utils/grantee-markdown.js` — the ONE inline renderer. Subset = **bold/italic** (CommonMark
    `**`/`*`) + **super/subscript** via the **pandoc convention** (`^x^` superscript, `~x~` subscript —
    decided S270; the WYSIWYG buttons in D8 serialize to this). Private `Marked` instance so the sub/sup
    extensions never leak into the global `marked` that `policy-markdown` uses; DOMPurify allowlist (body:
    `p/br/strong/em/sub/sup`; caption inline: `strong/em/sub/sup/br`); no attrs, no links, no raw HTML.
  - `lib/services/grantee-document-assembly.js` — `assembleGranteeDocument(requestId, { includeImageRef })`
    reads every field once → the canonical model. **Amount = full-number USD, no cents** (`$1,200,000`,
    decided S270). `includeImageRef` gates the private SharePoint ref to staff surfaces.
  - `lib/services/grantee-document-html.js` — `renderAwardBlock` (structural formatting per field) +
    `renderCyclePage` (standalone printable page). Image → `<figure>` placeholder (ref in a comment),
    NEVER a fabricated public `<img src>` (public image serving is a separate follow-up).
- **Outputs (b) + (c) (commit `ac72f96b`).** Both staff-authed routes above; matrix rows + counts added;
  49 unit tests; `npm run build` green (the renderer's server-side jsdom path compiles).
- **Canonical owner template (S270)** — the assembled award structure, per field → format:

  | Line | Field | Source | Format |
  |---|---|---|---|
  | Oregon State University | institution | `akoya_applicantid` → account `name` | **bold** |
  | Corvallis, OR | location | account `address1_city`, `address1_stateorprovince` | *italic* |
  | Kristen Buck and Mya Breitbart | PI + Co-PIs | `wmkf_projectleader` + `fetchCoPIs()` join "A and B" | *italic* |
  | $1,200,000 | award amount | `akoya_grant` ‖ `akoya_originalgrantamount` | plain, full number, no cents |
  | To determine whether… | edited title | `wmkf_wmkfprojectdescription` | *italic*, runs into the body |
  | In nearly half… | body | `wmkf_abstractapproved` ‖ `wmkf_abstractformatted` | prose; inline subset when present |

### RESOLVED (S271)
- **Title PI-editability — RESOLVED: staff-owned/fixed, NOT PI-editable (owner decision S271).** The
  edited title (`wmkf_wmkfprojectdescription`) renders display-only in the award-stage portal preview;
  there is **no** PI write-back path for it (no ETag-conditional title PATCH on the external surface).
  This unblocked and shipped output (a) above. The grantee still edits the body / caption / image.

## Open items (circle back)
- **[PENDING Connor + Sarah] Confirm title-field provenance, then document.** Owner emailed Connor +
  Sarah (S269) to verify the working hypothesis: `wmkf_wmkfprojectdescription` is PD-authored at the
  END of the process (our target), and `wmkf_projecttitle1` is a staff earlier best-guess title used
  upstream (e.g. Phase I board book). Empirically verified so far (S269 probe): in Research both are
  empty pre-Invited and populate only at Invited/decided; the field is program-polymorphic (SoCal fills
  `projecttitle1` at concept). Once Connor/Sarah confirm, fold the authoritative provenance into the
  chunk-7 caveat + the `project-phaseistatus-decision-lifecycle` memory and drop the `[UNVERIFIED]`
  label. Does NOT block chunk-7 build (the write-when-empty target is settled either way).

## Open (later chunks)
- Chunk 6: reminder cadence/deadline + exact waiver/T&C and email-body wording.
- Optional **auto-on-award cron** (PA-free) — a `pages/api/cron/*` route on the awardee eligibility
  filter (`granteeResearchPrograms.js`) that pre-generates **abstracts** for newly-`Active` research
  awardees; idempotent. (Distinct from the chunk-7 title cron, which fires earlier on the `Invited`
  flip — abstracts are post-award, titles are at board-invite.)

## Pointers
- Design: `docs/GRANTEE_PORTAL_SPEC.md`. Reviewer portal map: `docs/agent-wiki/topics/external-reviewer-portal.md`.
- Shared primitives: `lib/services/external-token.js`, `lib/external/rate-limit.js`, `lib/services/cloudmersive-scan.js`, `lib/utils/file-magic.js`.
- Reviewer variants to fork (do NOT mutate): `lib/external/token-lifecycle.js`, `pages/external/review/[token].js`, `pages/api/external/review/[token]/*`, `lib/services/review-upload.js`, `pages/api/review-manager/send-emails.js`.
