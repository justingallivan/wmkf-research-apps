---
title: "External Reviewer Intake — Implementation Plan"
domain: architecture
kind: plan
status: active
summary: "Related docs: - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md — file storage model (Connor-shareable) - Memory:..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - lib/services/review-upload.js
  - "pages/api/external/review/[token]/upload.js"
  - pages/api/review-manager/upload-review.js
---

# External Reviewer Intake — Implementation Plan

**Status:** **SHIPPED 2026-05-03** (per memory `project_external_reviewer_file_access`). Token primitive, `/external/*` endpoints, SharePoint upload, event-driven token expiry all live. Reused as the architectural pattern for the intake portal. This doc remains as design reference; treat as historical for the shipped scope.

**Related docs:**
- `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` — file storage model (Connor-shareable)
- Memory: `project_external_reviewer_file_access.md`, `project_reviewer_lifecycle.md`

---

## Context

External reviewers — invited by the foundation but without AzureAD accounts —
need a way to (a) download the proposal materials they've been asked to review
and (b) submit completed reviews back. Both directions are currently broken or
suboptimal:

- **Outbound (proposal access):** invite emails contain SharePoint share links
  that throw expired/auth errors.
- **Inbound (review uploads):** completed reviews land in Vercel Blob via
  `/api/review-manager/upload-review`, orphaned from the canonical document
  graph in SharePoint.

The same architectural primitive solves both: a foundation-owned, backend-mediated
external-intake system using HMAC-signed magic-link tokens. The reviewer never
touches SharePoint directly — our backend authenticates as the app registration
and serves files in/out via Graph API.

This work is also the first concrete step toward eventually replacing GOapply
(the Bromelkamp applicant portal) with foundation-owned applicant intake. The
token primitive, upload pipeline, and SharePoint integration built here all
extend cleanly to applicant submissions later. Reviewer-first because (a) we
own that path today, (b) volume is small (few percent of applications), (c)
flow is async (no due-date stampede), (d) email-and-staff-uploads is a
graceful fallback.

---

## Architecture

### One token, two operations

A reviewer's invitation contains a single HMAC-signed JWT in the URL. That
token authenticates them to **our backend** for two operations against the
assigned proposal:

- `download_proposal` — stream the proposal PDF (and any other attached
  applicant materials) from SharePoint
- `upload_review` — submit 1–5 review files plus structured form data

The reviewer never has direct SharePoint credentials; SharePoint never needs
anonymous-public permissions. Our backend, holding `Sites.Selected` with the
write role on the akoyaGO site, mediates every read and write.

### Shared core, two auth wrappers

```
lib/services/review-upload.js
  └─ writeReviewFiles(suggestionId, files, structuredData, { source, performedBy })
       ├─ writes file bytes to SharePoint via Graph
       ├─ updates wmkf_appreviewersuggestion (folder path, filename, picklists, timestamps)
       └─ logs to audit trail

pages/api/external/review/[token]/upload.js     ← token auth (reviewer self-serve)
  └─ verifies token → calls writeReviewFiles(..., source: 'reviewer_self_token')

pages/api/review-manager/upload-review.js        ← session auth (staff fallback) — REWRITTEN
  └─ requireAppAccess('review-manager') → calls writeReviewFiles(..., source: 'staff_upload')
```

Both endpoints exist as first-class citizens — the staff path is **not** an
emergency-only fallback. Some reviewers will always email files to staff; that
flow needs to land in the same SharePoint location and write the same Dataverse
fields as the self-serve path.

The existing `/api/review-manager/upload-review` URL is preserved (current UI
keeps working) but its body is rewritten to use the shared core function and
write to SharePoint instead of Vercel Blob.

### File storage layout

Files land in the same SharePoint library that already holds the proposal,
under a per-reviewer subfolder:

```
akoya_request/                                                      ← SharePoint library
  └─ 1001289_EEC6F39CE7D4EF118EE96045BD082F70/                       ← request folder (exists, from GOapply)
      ├─ proposal.pdf
      ├─ biosketch.pdf
      └─ Reviews/                                                    ← created on first upload
          ├─ {suggestionGuid-A}/
          │   ├─ review.pdf
          │   └─ supplementary_notes.pdf
          └─ {suggestionGuid-B}/
              └─ review.docx
```

`wmkf_appreviewersuggestion.wmkf_reviewsharepointfolder` stores the path
fragment (`1001289_.../Reviews/{suggestionGuid}`). Library name is constant
(`akoya_request`).

SharePoint conflict behavior is `replace` — re-uploads overwrite cleanly while
SharePoint's built-in document versioning preserves history at no app-side
cost.

---

## Token Model

### Cryptography

- **Algorithm:** HS256 (symmetric) signed JWT
- **Library:** `jose` (already a dependency, used by middleware)
- **Secret:** new env var `EXTERNAL_LINK_SECRET` (32 random bytes), separate
  from `NEXTAUTH_SECRET` to bound blast radius
- **Payload:** `{ sub: suggestionId, req: requestId, ops: ['download_proposal','upload_review'], iat, exp, jti }`

### Storage and revocation

At mint time, the JWT is hashed (SHA-256) and the digest stored on the
suggestion row (`wmkf_externaltokenhash`). Verification requires three things:

1. JWT signature valid against `EXTERNAL_LINK_SECRET`
2. Computed SHA-256 of the presented JWT matches the stored hash
3. `wmkf_externaltokenrevoked` is false and `wmkf_externaltokenexpires` is in
   the future

The hash check is what lets us **revoke individual tokens** (set the flag)
without rotating the global secret. A new token can be minted (replaces the
hash); the old token instantly fails the hash check even if the JWT signature
still validates.

### Lifecycle

- **Minted at acceptance.** When a reviewer accepts the invite (status flips
  on `wmkf_appreviewersuggestion`), the system mints a token, stores its hash,
  records `wmkf_externaltokenissued` and `wmkf_externaltokenexpires`. The
  email-send step later embeds the URL into the materials email body.
  Mint-at-accept (not mint-at-send) lets staff regenerate links without
  re-sending the email.
- **Expiry:** review due date + 4 weeks grace. Configurable per cycle later;
  hard-coded for v1.
- **Multi-use:** yes, until expired or revoked. Reviewer can return to
  re-download proposal materials, replace upload, etc.
- **Auto-revocation triggers** (in addition to manual staff revocation):
  - Suggestion status flips to `declined` or `withdrawn` → revoke
  - New token minted (e.g., staff regenerates the link) → old token revoked
  - Successful upload does **not** revoke immediately — reviewer has a 14-day
    grace window to replace files. After that, expiry handles it.

---

## Form Schema (Structured Data Capture)

The current PDF review form has 11 questions, three of which are single-select
multiple-choice that reviewers regularly violate (forget to check, choose two,
etc.). Those three plus reviewer affiliation are captured as structured form
fields; the remaining free-text questions stay in the uploaded PDF.

### Structured form fields (HTML form, enforced)

| Form field | Dataverse field | Type | Notes |
|---|---|---|---|
| Reviewer Name | (existing on `wmkf_potentialreviewer`) | text, required | Pre-fill from CRM, editable |
| Title & Organization | `wmkf_revieweraffiliation` | string(300), required | Pre-fill from CRM if known, editable |
| Q1 — Impact | `wmkf_reviewerimpact` | picklist, required | 4 values |
| Q3 — Risk | `wmkf_reviewerrisk` | picklist, required | 4 values |
| Q10 — Overall rating | `wmkf_revieweroverallrating` | picklist, required | 5 values |

### In the uploaded PDF (free text — no value in retyping)

Q2 (specific impacts), Q4 (risk details), Q5 (methods), Q6 (questions for PI),
Q7 (personnel/infrastructure), Q8 (alternative funding), Q9 (budget),
Q11 (anything else, optional).

### Picklist values (explicit integer assignments)

**`wmkf_reviewerimpact`**

| Int | Label |
|---|---|
| 1 | Little to no impact |
| 2 | Publications of disciplinary interest |
| 3 | Publications of broad interest |
| 4 | Will rewrite textbooks |

**`wmkf_reviewerrisk`** — note: higher is **not** worse here; Keck's mission is funding risky projects. Document this in the column description.

| Int | Label |
|---|---|
| 1 | Low risk |
| 2 | Medium risk |
| 3 | High risk |
| 4 | Impossible (fatal flaw) |

**`wmkf_revieweroverallrating`** — higher = better for clean averaging.

| Int | Label |
|---|---|
| 1 | Poor |
| 2 | Fair |
| 3 | Good |
| 4 | Very Good |
| 5 | Excellent |

### Form schema config

Lives in code (v1):

```js
// lib/external/review-form-schema.js
export const reviewFormSchema = {
  fields: [
    { key: 'affiliation', dataverseField: 'wmkf_revieweraffiliation',
      label: 'Title & Organization', type: 'string', maxLength: 300, required: true,
      prefillFromCrm: true },
    { key: 'impact', dataverseField: 'wmkf_reviewerimpact',
      label: 'If the proposed project is successful in its entirety, how will it impact the field?',
      type: 'picklist', required: true,
      options: [
        { value: 1, label: 'Little to no impact' },
        { value: 2, label: 'Will result in publications of disciplinary interest' },
        { value: 3, label: 'Will result in publications of broad interest' },
        { value: 4, label: 'Will rewrite textbooks' },
      ] },
    // ...risk, overallRating identically structured
  ],
};
```

Both upload endpoints (token and staff) validate posted values against this
schema before PATCHing to Dataverse. Single source of truth.

The "Unable to answer" sentinel (99) was removed from all three picklists, so
every stored rating is a real point on the scale. Any pre-removal `99` should be
treated as "not provided" (it decodes to null), not averaged in.

---

## Schema Additions to `wmkf_appreviewersuggestion`

11 new columns total. All applied via the existing toolchain:
`lib/dataverse/schema/wave2-existing/wmkf_appreviewersuggestion-extensions.json`,
mirroring the existing `wmkf_potentialreviewers-extensions.json`. Run with:

```bash
node scripts/apply-dataverse-schema.js --target=sandbox --wave=2  # dry-run
node scripts/apply-dataverse-schema.js --target=sandbox --wave=2 --execute
node scripts/apply-dataverse-schema.js --target=prod --wave=2 --execute
```

| # | Field | Type | Purpose |
|---|---|---|---|
| 1 | `wmkf_externaltokenhash` | String(64) | SHA-256 of issued JWT |
| 2 | `wmkf_externaltokenissued` | DateTime | When minted |
| 3 | `wmkf_externaltokenexpires` | DateTime | Hard expiry |
| 4 | `wmkf_externaltokenrevoked` | Boolean | Revocation flag (default false) |
| 5 | `wmkf_proposalfirstaccessed` | DateTime | First click-through to landing page |
| 6 | `wmkf_reviewsharepointfolder` | String(500) | Per-reviewer folder path under `Reviews/` |
| 7 | `wmkf_reviewuploadedbystaff` | Boolean | True if staff did the upload |
| 8 | `wmkf_revieweraffiliation` | String(300) | Reviewer's title & org at review time |
| 9 | `wmkf_reviewerimpact` | Picklist | Q1 — values above |
| 10 | `wmkf_reviewerrisk` | Picklist | Q3 — values above |
| 11 | `wmkf_revieweroverallrating` | Picklist | Q10 — values above |

### Existing fields reused (not recreated)

- `wmkf_emailsentat` — invitation email send timestamp
- `wmkf_emailopenedat` — email pixel/open event
- `wmkf_reviewreceivedat` — when latest upload landed (set by `writeReviewFiles`)
- `wmkf_reviewfilename` — primary filename (kept for back-compat with existing UI)
- ~~`wmkf_reviewbloburl`~~ — retired 2026-05-03 (zero rows pointing at Blob storage at retirement; field can be removed from CRM by Connor)

---

## Endpoints

### Public (token-authenticated)

All under `/external/*` and `/api/external/*`. Middleware allowlists these
paths the same way `/api/cron/*` is excluded today.

- `GET /external/review/[token]`
  - Public landing page. Verifies token; on success shows: proposal title,
    reviewer name, due date, current status, download buttons for proposal
    materials, upload form (file dropzone + structured fields), submit button.
  - Sets `wmkf_proposalfirstaccessed` if not already set.
  - On verification failure: friendly error page differentiating expired /
    revoked / malformed.

- `GET /api/external/review/[token]/proposal?file={fileId}`
  - Streams a proposal-related file (proposal, biosketch, budget, etc.) from
    SharePoint via Graph. Backend authenticates as the app registration;
    reviewer never sees a SharePoint URL.
  - Validates the requested file is part of the request's document set
    (defense against arbitrary path injection).

- `POST /api/external/review/[token]/upload`
  - Multipart form: 1–5 files + structured form data.
  - Validates: token, file count, file types (PDF/DOCX/DOC), per-file size cap
    25MB, magic-byte sniffing matches declared MIME, structured values against
    form schema.
  - Calls `writeReviewFiles(suggestionId, files, structuredData, { source: 'reviewer_self_token', performedBy: null })`.
  - Returns success + summary; landing page shows thank-you state with option
    to replace.

### Staff (session-authenticated)

- `POST /api/review-manager/upload-review` *(rewritten — keeps existing URL)*
  - Auth: `requireAppAccess('review-manager')`.
  - Body includes `suggestionId` (token endpoint reads it from the JWT;
    staff endpoint takes it from the body).
  - Same validation rules as the token endpoint.
  - Calls `writeReviewFiles(suggestionId, files, structuredData, { source: 'staff_upload', performedBy: session.profileId })`.
  - Sets `wmkf_reviewuploadedbystaff = true`.

- New staff-only operations (separate small endpoints, all under `/api/review-manager/*`):
  - `POST /regenerate-token` — revoke old token, mint new one, returns new URL
  - `POST /revoke-token` — set `wmkf_externaltokenrevoked = true`
  - `POST /mark-received-no-file` — sets `wmkf_reviewreceivedat` and a status flag without uploading bytes (for paper / lost-file cases)

---

## Email Integration

The existing `/api/review-manager/send-emails` already renders + sends. Changes:

1. At mint-time (suggestion accept), generate the JWT, store hash + timestamps.
2. Render-emails templates get a new variable, `{externalLink}`, populated
   from the constructed URL: `${BASE_URL}/external/review/${token}`.
3. Email body template updated to embed the link with clear "Click here to
   download materials and submit your review" framing.
4. Sender path is unchanged (Dynamics-bound `SendEmail`).

---

## Migration / Cutover — completed 2026-05-03

- **New uploads:** all routes — token and staff — write to SharePoint via
  the shared `writeReviewFiles` core. Done since Phase 5.
- **Legacy Blob fallback:** retired 2026-05-03. The audit at retirement
  found 0 rows still pointing at Blob storage (one dual-set row that had
  the redundant Blob URL cleared, plus one `test-review.txt` artifact whose
  Blob/received fields were cleared). The download endpoint now returns 404
  when `wmkf_reviewsharepointfolder` is unset rather than redirecting to a
  Blob URL.
- **No migration script needed:** zero real reviews lived only in Blob at
  retirement time — the original "everything migrates to SharePoint
  organically as new uploads land" plan absorbed all live data.
- **Vercel Blob retirement (remaining):** Connor can drop `wmkf_reviewbloburl`
  from the CRM schema when convenient. Code stopped reading the field
  2026-05-03 so a schema-side removal is no longer load-bearing.

---

## Implementation Phases

### Phase 1: Foundation (~1 day)

- Apply schema additions to sandbox via `apply-dataverse-schema.js`.
- Verify with `scripts/probe-reviewer-suggestion-schema.js` that all 11
  attributes are present.
- Add `EXTERNAL_LINK_SECRET` to `.env.local` (random 32 bytes), document in
  `.env.example` and `docs/CREDENTIALS_RUNBOOK.md`.

### Phase 2: Token primitive + middleware (~half day)

- `lib/services/external-token.js` — `mintToken()`, `verifyToken()`,
  `hashToken()`. Uses `jose` for JWT.
- `proxy.js` (formerly `middleware.js`) — add `/external/*` and `/api/external/*`
  to the auth-bypass matcher (alongside `/api/cron/*`).
- Tests: signature failure, expired, revoked, hash mismatch, wrong-secret,
  malformed.

### Phase 3: Shared upload core (~half day)

- `lib/services/review-upload.js` — `writeReviewFiles(suggestionId, files, structuredData, opts)`.
- Validates files (count, type, size, magic bytes).
- Validates structured data against form schema.
- Writes files to SharePoint at `akoya_request/{requestFolder}/Reviews/{suggestionId}/{filename}`
  (creates `Reviews/` and `{suggestionId}/` subfolders as needed via Graph).
- PATCHes Dataverse: folder, filename, received-at, picklists, affiliation,
  upload-source flag.
- Tests: happy path, file-too-large, bad type, picklist out of range,
  SharePoint write fail, partial-failure rollback.

### Phase 4: External endpoints + landing page (~1 day)

- `pages/external/review/[token].js` — landing page (Next.js page, public).
- `pages/api/external/review/[token]/proposal.js` — file streaming endpoint.
- `pages/api/external/review/[token]/upload.js` — upload endpoint.
- `lib/external/review-form-schema.js` — form config.
- `shared/components/external/ReviewFormFields.js` — form renderer (reusable
  for staff path).

### Phase 5: Staff endpoint rewrite (~half day)

- Rewrite `pages/api/review-manager/upload-review.js` to call shared core.
- Add `regenerate-token`, `revoke-token`, `mark-received-no-file` endpoints.
- Update Review Manager UI: add structured form fields when uploading on
  behalf, show token state per row.

### Phase 6: Email integration (~half day)

- Update `pages/api/review-manager/send-emails.js`: at suggestion-accept
  trigger, mint token. At send-emails time, fetch token + embed in body.
- Update email body template to include `{externalLink}` and explain the new
  flow to reviewers.

### Phase 7: Cutover + monitoring (~half day)

- Deploy.
- Enable for one cycle as trial; coordinate with staff before send-out.
- Monitor: how many reviewers use the link vs. email staff; any token
  verification failures; SharePoint write errors.

**Total estimate:** 4–5 working days for a clean v1.

---

## Security Considerations

- **Token leakage:** mitigated by HMAC + expiry + per-token revocation. A
  forwarded email link can be revoked by staff if reported.
- **Path traversal:** `validatePath` already used in `graph-service.js`;
  `writeReviewFiles` constructs paths from controlled values (suggestion
  GUID, sanitized original filename) only.
- **File-type abuse:** allowlist by extension AND magic-byte sniff. Reject
  `.exe`, `.zip`, scripts, etc.
- **Resource abuse:** per-token rate limit (60 requests/min generous default),
  size cap 25MB per file, file count cap 5.
- **Audit trail:** every token-authenticated request logged. Either a new
  Postgres `external_access_log` table or a Dataverse audit table — to
  decide. Captures: token jti, suggestion ID, IP, user agent, operation,
  timestamp, success/failure.
- **Sensitive data in URLs:** the JWT itself is the sensitive part; no other
  PII in the URL. Browser history retention is the residual risk; reviewer
  closes tab when done.
- **Secret rotation:** `EXTERNAL_LINK_SECRET` rotation invalidates all
  outstanding tokens. For graceful rotation, support an array of valid
  secrets (e.g., `EXTERNAL_LINK_SECRETS` comma-separated) — verify against
  any, mint with the first. Defer to v2 if not needed in v1.

---

## Out of Scope (v1)

- **Per-cycle / per-program-area form variants.** Single global form schema
  in v1. Move to a Dataverse-stored config table when the foundation actually
  needs different rubrics.
- **Multi-dimensional NIH-style scoring** (significance / innovation /
  approach / etc.). The current 3 picklists cover today's PDF form.
- **Reviewer accounts / authenticated sessions.** Token-only for v1. If
  applicants ever come to this system, real accounts via Microsoft Entra
  External ID become relevant — that's the next architectural step.
- **Replacing GOapply for applicants.** Connor's longer-term direction;
  reviewer system is the proving ground. Schema and code patterns built
  here should be reusable but the applicant build is its own project.
- **Vercel Blob migration script.** Existing reviews coexist; one-shot script
  is post-launch cleanup.

---

## Open Questions for Implementation

1. **Audit log destination:** new Postgres table vs. Dataverse audit table.
   Postgres is faster to query and own; Dataverse keeps it inside the
   canonical data system and is more discoverable. Lean: Dataverse, new
   `wmkf_externalaccesslog` entity.
2. **Email body template wording.** Connor and/or Justin to draft the new
   reviewer-facing language explaining the link, the form, the deadline.
3. **Staff "regenerate token" UI placement.** Per-row button in Review
   Manager grid? Modal with confirmation? Defer to UI design pass.
4. **Rate limit storage.** In-memory (fast, lost on deploy) vs. Postgres
   (persistent, slightly slower). For 60/min generous limits, in-memory is
   probably fine — defer until traffic patterns are known.

---

## Memory Updates (after this plan is acted on)

- `project_external_reviewer_file_access.md` — point at this plan as the
  resolved direction.
- `project_reviewer_lifecycle.md` — note that token-based external upload is
  the foundation for reviewer-side automation triggers.
- New note: token primitive in production, available for future external
  flows (applicant intake, etc.).
