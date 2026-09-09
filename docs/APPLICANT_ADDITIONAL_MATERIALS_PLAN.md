---
title: Applicant Additional Materials Plan
domain: applicant-materials
kind: plan
status: active
summary: "Planning contract for secure, staff-requested applicant uploads after proposal submission, with explicit storage and visibility boundaries."
canonical: true
cataloged: 2026-09-08
owner: product-engineering
related:
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/GRANTEE_PORTAL_SPEC.md
  - docs/REVIEWER_MATERIALS_FOLDER_SPEC.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/J27_TRANSITION_REGISTER.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/atlas/postgres-infra-tables.md
---

# Applicant Additional Materials Plan

## 1. Status, recommendation, and labels

**Planning only. No implementation is authorized by this document.**

**Recommendation:** build a narrow, staff-triggered, revocable token-link upload page. A
staff member requests material from a server-resolved request contact; the recipient uses
an expiring bearer link; browser bytes travel to private Blob staging; a JSON-only finalizer
re-verifies the link and staged object, scans the file, writes it to the request's SharePoint
folder, and registers one stable `wmkf_requestdocument` row per accepted file. **[PLANNED]**

This plan uses these labels:

- **[VERIFIED via ...]** describes evidence read from current source, the Atlas, or a
  current canonical document on 2026-09-08.
- **[ASSUMED]** identifies an unresolved operating fact that must not drive a build until
  the owner or Connor confirms it.
- **[PLANNED]** describes the recommended future contract, never built state.

The recommended default is **staff-only visibility**. An applicant upload does not become
reviewer-visible and does not change an Initial Assessment input merely because it exists in
the request folder. **[PLANNED]**

## 2. Problem and actors

After a proposal exists in AkoyaGO, a Program Director (PD) or program coordinator may need
a corrected document, slide deck, letter, or other supplementary material from the applicant.
Email attachments leave receipt, file identity, malware handling, request association, and
downstream visibility to manual judgment. **[ASSUMED — workflow need supplied in the planning
brief; frequency and material mix have not been measured]**

The actors are:

- **Requester:** the request's lead PD, the request's program coordinator, or a superuser.
  The exact authorization rule is an owner decision; the recommendation is in Decision 3.
  **[PLANNED]**
- **Submitter:** the applicant PI (`wmkf_projectleader`) or institutional/primary contact
  (`akoya_primarycontactid`) selected from the request and resolved server-side. These
  request relationships exist today. **[VERIFIED via
  `docs/atlas/dataverse-akoya-request.md`]**
- **Primary consumers:** staff in the Request Workbench. **[PLANNED]**
- **Conditional consumers:** external reviewers only after an explicit staff packaging
  decision; Initial Assessment generation only after its governed canonical input changes.
  **[PLANNED]**

## 3. Evidence-first current state

| Surface | Current state | Planning consequence |
|---|---|---|
| Applicant intake | The `/apply` foundation has applicant sessions, membership checks, draft persistence, direct-to-private-Blob upload, server-side byte verification, and submit/drain pieces, but the intake product is parked. The historical June 2026 pilot is not an operating applicant portal. **[VERIFIED via `docs/agent-wiki/topics/intake-portal.md`, `docs/INTAKE_PORTAL_DESIGN.md`, `pages/api/intake/draft/upload-token.js`, `pages/api/intake/draft/attach.js`, and `pages/api/intake/submit.js`]** | Reuse verified security ideas, not the draft or submission lifecycle. Do not revive the parked product incidentally. |
| Applicant identity | NextAuth supports an `entra-external` applicant session carrying server-issued `userType: 'applicant'`, `contactOid`, and contact email; the intake routes bridge that identity to Dataverse and check `wmkf_portalmembership`. **[VERIFIED via `pages/api/auth/[...nextauth].js` and the intake routes]** | A signed-in approach is technically possible but would make this small workflow depend on the parked portal's onboarding and membership model. |
| Intake attachments | Mint derives the opaque pathname and constrains content type, maximum bytes, overwrite, and expiry. Finalize re-downloads private bytes, recomputes size/hash, validates magic bytes, and scans before atomic pending-to-clean promotion. When virus scanning is disabled, the current dormant intake path records `scanner: 'skipped'` and treats the file as clean. **[VERIFIED via `pages/api/intake/draft/upload-token.js`, `pages/api/intake/draft/attach.js`, and `docs/API_ROUTE_SECURITY_MATRIX.md`]** | Preserve the direct-upload and verification pattern. A public launch of this new feature must instead fail closed when scanning is disabled or unavailable. |
| Portal staging | `portal_upload_staging` provides actor/resource/scope ownership, a finalize lease, staged-byte facts, a downstream candidate receipt, terminal replay, exact-path cleanup, and no raw external-token storage. Its deployed scope constraint admits only `grantee_image` and `staff_grantee_image`; the current service admits only PNG/JPEG/WebP. **[VERIFIED via `lib/db/migrations/031_portal_upload_staging.sql`, `lib/services/portal-upload-staging.js`, and `docs/atlas/postgres-infra-tables.md`]** | Reuse the ledger and lease/idempotency design, but an implementation needs an additive document scope and a document verifier. It cannot call the image-only flow unchanged. |
| External grantee link | The grantee portal uses an audience-scoped 30-day JWT but intentionally stores no token hash and offers no revocation. Its finalize route independently re-verifies the token, package state, staging ownership, exact private object, and write preconditions. **[VERIFIED via `lib/external/grantee-token-lifecycle.js`, `pages/api/external/grantee/[token]/upload-token.js`, and `pages/api/external/grantee/[token]/submit.js`]** | Reuse the audience/op and independent-finalize pattern. Do not reuse its stateless lifecycle for requested proposal materials, where staff need revocation and reissue. |
| Request document registry | `wmkf_requestdocument` already defines `Applicant Slides` and `Other Applicant Materials`, plus stable SharePoint identity, hashes, content facts, operation/lifecycle state, request binding, and producer provenance. Production rows currently exercise Initial Assessment, Pre-Site, and Final Writeup—not applicant capture. **[VERIFIED via `shared/config/requestDocument.js` and `docs/atlas/dataverse-wmkf-requestdocument.md`]** | Register each accepted applicant file using the existing applicant artifact kinds. Treat the producer and applicant-attribution shape as new contract work. |
| Workbench documents | The Proposal listing finds historical Phase I slots, all Phase II files, the exact reviewer package, and exact AI Materials. It does not read generic additional-material registry rows. **[VERIFIED via `lib/services/workbench-proposal-documents.js` and `shared/components/workbench/ProposalTab.js`]** | Add a registry-backed Additional materials panel/list; do not depend on accidental folder enumeration. |
| Reviewer package | The external reviewer allow-set exposes only exact `Reviewer Materials/Proposal_{Request#}.pdf`; every other file, even in that folder, is rejected. **[VERIFIED via `lib/external/reviewer-materials.js`, `pages/api/external/review/[token]/proposal.js`, and `docs/REVIEWER_MATERIALS_FOLDER_SPEC.md`]** | Keep supplemental uploads out of `Reviewer Materials`. Reviewer inclusion means deliberately rebuilding the canonical package, not widening folder access. |
| Initial Assessment | Generation reads and fingerprints only exact `AI Materials/ProposalNarrative_{Request#}.pdf`; it fails closed rather than substituting the reviewer package, Phase I display document, archive copy, or another file. **[VERIFIED via `lib/services/workbench-proposal-documents.js` and `lib/services/initial-assessment/artifact-service.js`]** | A new upload must not silently enter an Initial Assessment. Any inclusion requires a governed narrative rebuild and then explicit generation/reuse behavior. |
| J27 | GOApply remains the J27 intake system until further notice; every J27 proposal is expected to receive a mostly AI-generated Initial Assessment before advancement; broader applicant capture through `wmkf_requestdocument` and the exact J27 proposal path remain open work. **[VERIFIED via `docs/J27_TRANSITION_REGISTER.md` rows J27-060, J27-061, and J27-063]** | Keep this capability independent of a custom J27 form, and make its Initial Assessment interaction an explicit policy decision. |

### 3.1 Reuse boundary

The existing planned Site Visit Materials Upload contract describes a closely related but
unbuilt surface, including the existing applicant artifact kinds and governed Site Visit
folders. **[VERIFIED via `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, “Site Visit Materials
Upload contract”]** This plan does not claim those routes or state exist, and it does not
silently broaden a Site Visit link into a proposal-wide link. **[PLANNED]**

Implementation should reuse common reviewed primitives only after the first additional-
materials slice proves its narrower contract. A later design review may consolidate the two
link workflows if their recipient, expiry, replacement, category, and large-file rules truly
match. **[PLANNED]**

## 4. Goals and non-goals

### Goals **[PLANNED]**

1. Let authorized staff create, send, inspect, resend, and reissue a request-bound material
   request without accepting a client-supplied request identity or recipient address.
2. Let an external recipient upload allowed files without a staff account or SharePoint access.
3. Make every successful file a stable, request-bound record with byte hash, SharePoint identity,
   applicant-link provenance, and an auditable staff-visible receipt.
4. Preserve retry safety across Blob, scanning, SharePoint, Dataverse, and email boundaries.
5. Make staff/reviewer/AI visibility deliberate and legible.

### Non-goals **[PLANNED]**

- Replacing GOApply or reviving the parked intake portal.
- A general applicant account, draft form, or institution-membership administration surface.
- Letting an applicant browse a request, Dataverse, SharePoint, staff history, or reviewer data.
- Uploading directly into `Reviewer Materials` or `AI Materials`.
- Automatically regenerating the canonical proposal package or an Initial Assessment.
- Large-file/resumable upload, delete/replace, and multi-recipient collaboration in the first
  thin slice.

## 5. Candidate approaches

| Approach | What it reuses | What it must build | Benefits | Costs/risks | Verdict |
|---|---|---|---|---|---|
| **A. Staff-triggered token link** | Audience/op JWT pattern; external rate limits; actor-bound private staging state machine; Blob-to-SharePoint verification; request-document registry; Dynamics email transport patterns. **[VERIFIED reuse candidates via the sources in §3]** | Revocable material-request ledger; document staging scope/verifier; external page and routes; Workbench request/status panel; applicant-contact provenance; email template/composer. **[PLANNED]** | Lowest applicant friction; request and authorization remain server-bound; narrow surface; supports exact audit/reissue. | Bearer links can be forwarded; cross-store recovery and scanning must be correct; recipient identity is link-level unless sign-in is added. | **Recommend.** |
| **B. Revive the intake portal draft/attach flow** | `entra-external` login, contact bridge, membership checks, private intake Blob, draft attachment workflow, submit/drain machinery. **[VERIFIED via intake source]** | Post-submission request binding; staff invitation; reactivation of parked onboarding/membership UX; a new non-draft lifecycle; SharePoint/registry writer. **[PLANNED]** | Stronger account continuity and person attribution; suitable if a broad applicant portal returns. | Couples a narrow need to a parked product and draft/submission semantics; higher support and identity-administration cost; J27 remains in GOApply. | Do not choose for this feature alone. Reconsider only with a separately authorized portal revival. |
| **C. Staff-mediated upload** | Existing staff auth, Workbench access, SharePoint writer patterns, request-document registry, and staff image-replacement staging pattern. **[VERIFIED via `pages/api/workbench/grantee-deliverables/replacement-upload-token.js` and registry source]** | A staff document upload UI and document verifier; an operating procedure for applicant email; manual provenance/receipt capture. **[PLANNED]** | Smallest external attack surface and fastest emergency fallback. | Applicant attachments still travel through email; staff become a bottleneck; sender/consent and exact applicant provenance are weaker; the existing replacement flow is image-specific, not a ready document uploader. | Keep as manual fallback, not primary product. |

## 6. Recommended end-to-end contract

### 6.1 Staff request and link lifecycle **[PLANNED]**

1. Workbench loads the request and server-resolved PI, primary contact, lead PD, and program
   coordinator. Missing or duplicate recipient addresses fail closed.
2. An authorized staff user selects one eligible recipient, material category, bounded
   instructions, a business deadline, and allowed file policy. The server re-reads the request
   and contacts before preview and again before send.
3. The service creates a durable pending request/link record before any external send. The record
   owns the request GUID, recipient Contact GUID, initiating staff system-user GUID, sender,
   deadline, link expiry, allowed types/count/bytes, token digest, audience/ops, and lifecycle.
   The implementation name for this new Postgres ledger is deliberately not chosen in this plan.
4. The raw token exists only long enough to render the recipient email. It is never stored in
   Postgres, Dataverse, logs, query strings in staff UI, or analytics.
5. The link becomes active only after Dynamics accepts the email send. A send failure leaves a
   retryable unsent record and no falsely active link.
6. Resend reuses an active link and its original expiry. Reissue stages a replacement; only after
   its email is accepted does the service revoke the old link and activate the new one. An expired
   or revoked link cannot mint or finalize uploads.

### 6.2 Applicant upload and finalization **[PLANNED]**

1. The external context route verifies signature, audience, operation, expiry, stored digest,
   active ledger state, request binding, and deadline before returning a minimal request label,
   staff instructions, allowed file policy, and current successful uploads for that link.
2. The upload-token route repeats those checks. The browser may supply only a filename, declared
   type, and byte count. The server supplies the staging UUID, exact private pathname, scope,
   resource/link binding, byte cap, allowed type, token TTL, and no-overwrite policy.
3. Browser bytes go directly to the private store governed by `UPLOADS_BLOB_RW_TOKEN`; the client
   never chooses or echoes an authoritative pathname.
4. The JSON-only finalizer repeats link authorization and claims staging by staging UUID plus
   exact scope, link resource, and SHA-256 token binding. It downloads only the persisted private
   pathname and verifies object privacy, declared versus actual type, extension, magic bytes,
   actual size, hash, and malware result.
5. Scanner disabled, missing, or unavailable is a fail-closed retryable error for this public
   surface. “Skipped” never becomes an accepted Request Document.
6. The server resolves exactly one active `akoya_request` SharePoint parent and a dedicated
   additional-materials subfolder. The exact folder/filename convention is held for Decision 6;
   neither the client nor a token claim supplies it.
7. SharePoint upload identity is written to the staging candidate receipt before the Dataverse
   registry write. The new `wmkf_requestdocument` row binds the verified request, stable Graph
   site/drive/item/version/eTag, filename, size, content type, content hash, applicant artifact
   type, operation/lifecycle state, and provenance.
8. The finalizer marks staging consumed and stores the durable response before exact-path Blob
   cleanup. A response-drop retry returns the same result. If SharePoint committed but Dataverse
   did not, the candidate receipt drives reconciliation or exact orphan cleanup; it never uploads
   a blind duplicate.
9. Each file finalizes independently. One failed file does not roll back accepted siblings, and
   the UI shows per-file truth. “Request complete” is a separate server transition allowed only
   when no upload is in flight and at least one accepted file exists.

### 6.3 First-slice file policy **[PLANNED]**

- PDF and PPTX only, because the existing applicant artifact categories and Site Visit design use
  those formats and both can receive magic-byte checks. **[VERIFIED precedent via
  `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`; limit choice remains planned]**
- Recommended first-slice cap: **25 MiB per file, 10 accepted files per active request**. This is
  a deliberately conservative product proposal, not a current platform limit. It limits first-
  slice memory and scanning exposure while the real applicant material mix and scanner limits are
  measured.
- A later resumable Graph-upload slice may adopt a larger cap only with a streaming/chunked
  malware contract, crash recovery, and target-library proof. Raising a constant on an in-memory
  writer is not acceptable.
- Pending staging expires after the same short operational window used by the reviewed staging
  primitive; terminal staging metadata and exact bytes follow its existing cleanup contract.
  The durable request/link ledger retention remains Decision 10. SharePoint and Request Document
  retention follow the governed request-record policy, not staging TTL.

## 7. File model and downstream visibility

### 7.1 SharePoint and `wmkf_requestdocument` **[PLANNED]**

- Durable bytes live in the active request's `akoya_request` SharePoint library. Private Blob is
  transit only.
- Generic review-stage uploads live in a dedicated request-root additional-materials folder whose
  exact path is selected with Connor. They do not land under `Reviewer Materials`, `AI Materials`,
  or the governed Site Visit paths by default.
- One file equals one `wmkf_requestdocument` row. Slides use the existing Applicant Slides kind;
  all other first-slice files use the existing Other Applicant Materials kind.
- Use the registry's existing request binding, operation/lifecycle, stable SharePoint identity,
  file facts, content hash, generation key, and producer fields. A deterministic key derived from
  the material-request identity and staging identity makes a retry converge on one row.
- Do not add a current pointer to `akoya_request`: supplementary material is inherently one-to-many.
- Add one nullable applicant Contact relationship to `wmkf_requestdocument`, subject to schema
  review, so settled provenance survives Postgres operational-retention cleanup. The logical and
  schema names are intentionally deferred to implementation review. If the owner declines this
  attribute, the plan must explicitly accept link-level—not person-level—provenance after ledger
  expiry.

The Request Document operation should become Ready only after SharePoint identity and byte facts
are recorded. Its initial lifecycle should be Review, meaning available for staff review, not
reviewer-visible. Those are existing option values, but their applicant-material semantics still
require an implementation-time schema/Atlas review. **[PLANNED]**

### 7.2 Staff visibility **[PLANNED]**

The Proposal tab gains an Additional materials panel backed by Request Document rows plus link
status—not by a raw folder scan. It shows requester, intended recipient, deadline/link state,
instructions, material kind, filename, size, received time, submitter Contact when available,
scan receipt, and a request-scoped download action. Staff can distinguish pending, expired,
revoked, partially received, complete, and failed requests.

### 7.3 Reviewer visibility **[PLANNED]**

Default: **staff-only**. Existing reviewer delivery exposes one exact canonical PDF, so placing a
supplement beside it would not make it visible and widening the allow-set would weaken a proven
security boundary. **[VERIFIED via `lib/external/reviewer-materials.js`]**

If the owner chooses reviewer inclusion, staff explicitly marks an accepted file for package
assembly. The existing/updated Power Automate packaging process must create a new exact canonical
`Proposal_{Request#}.pdf`; preflight, send history, and external download continue to expose only
that file. The feature must never expose a supplementary folder wholesale. **[PLANNED]**

### 7.4 Initial Assessment visibility **[PLANNED]**

Default: no automatic inclusion or regeneration. The Initial Assessment producer's exact
Proposal Narrative input remains authoritative. **[VERIFIED via
`lib/services/initial-assessment/artifact-service.js`]**

If staff decide a new material changes proposal analysis, the governed upstream assembly process
must publish a new exact Proposal Narrative version. Only then may staff explicitly generate or
reuse an Initial Assessment under its existing input-fingerprint/lineage rules. The additional-
materials finalizer must not write `AI Materials` or call the producer itself.

For J27, Workbench may show “additional material requested/received” as a pre-advancement fact.
Whether an unresolved request blocks advancement is Decision 9; it cannot be inferred from file
arrival alone. **[PLANNED]**

## 8. Security contract

### 8.1 Trust boundaries **[PLANNED]**

- Staff endpoints require `requireAppAccess('reviewers')`, an active profile, a current Dynamics
  system-user identity, and the request-level authorization in Decision 3.
- External tokens use a distinct audience and narrow operations. Verification checks signature,
  audience, expiry, operation, token digest, link lifecycle, request/link binding, and deadline.
- A bearer link proves possession of a recipient-specific link, not the human at the keyboard.
  UI and audit language must say “link issued to” unless an applicant session is later added.
- Recipient Contact, recipient email, request GUID, SharePoint library/folder/item, staging scope,
  pathname, submitter identity, sender, and registry bindings are server-derived. Request JSON
  containing any of those authority fields is rejected.
- Mint and finalize independently authorize. A successful mint is not authority to finalize after
  revocation, expiry, deadline, request reassignment, or policy change.
- External context, mint, finalize, and failure-report routes use Postgres-backed per-token and
  per-IP rate limits before expensive work. Invalid-token outcomes remain observable without
  logging tokens.
- Tokens and client upload credentials are redacted from logs and operational events. External
  responses never include private Blob URLs or SharePoint credentials.
- Filename normalization is display-only input. Stable Graph item identity and registry identity,
  never filename/path alone, anchor the accepted record.
- MIME, extension, magic, size, count, malware, and staging privacy checks all fail closed.
- All Dataverse writes run inside an explicit DAL context and the Dataverse target/write interlock;
  external input cannot select or bypass either target.

### 8.2 Proposed route inventory and matrix-row shape **[PLANNED — do not add yet]**

Every implementation route must be registered in `docs/API_ROUTE_SECURITY_MATRIX.md` in the same
change that creates it, using the existing columns **Route | Methods | Auth | Guard | Data scope |
Persistence | Risk | Notes**. The public paths also require an explicit `proxy.js` allow rule.

| Proposed route | Methods | Auth | Guard | Data scope | Persistence | Risk | Notes |
|---|---|---|---|---|---|---|---|
| `/api/workbench/additional-materials` | GET, POST | App | `requireAppAccess('reviewers')`; GET request-scoped read; POST action allowlist plus current request-level staff authorization | One validated `akoya_request` and server-resolved contacts | GET reads request/link ledger + `wmkf_requestdocument`; POST creates/previews/sends/resends/reissues link ledger rows and Dynamics email activity | High | POST never accepts free-form recipient or sender; send receipt controls link activation; idempotency key/action version required. |
| `/api/external/additional-materials/[token]/context` | GET | External token | Dedicated verifier + per-token/IP rate limit | One active recipient-specific link and its request label/material policy | Reads link ledger/request and current accepted registry rows; writes rate-limit counters | Low | No SharePoint URL, staff history, contact details, or raw token persistence. |
| `/api/external/additional-materials/[token]/upload-token` | POST | External token | Dedicated verifier repeated; active/deadline/op checks; closed body allowlist | One link; filename/type/declared size only | Inserts actor/link/scope-bound `portal_upload_staging`; returns one short-lived exact-path private client token | Medium | No client request/path/scope; no overwrite/random suffix. |
| `/api/external/additional-materials/[token]/upload-failure` | POST | External token | Dedicated verifier + rate limit + closed diagnostic enum | One link and bounded client stage/category/status | Best-effort redacted Operational Event | Low | No raw error text, filename, pathname, URL, token, instructions, or bytes. |
| `/api/external/additional-materials/[token]/finalize` | POST | External token | Dedicated verifier repeated; active/deadline/op checks; staging ownership/lease; fail-closed byte policy | One link plus one opaque staging UUID | Reads/deletes private Blob; writes SharePoint candidate, `wmkf_requestdocument`, link receipt, staging terminal result, rate-limit counters | High | JSON-only; durable candidate-before-registry recovery; consumed retry returns same result. |

## 9. Proposed data model

### 9.1 Postgres request/link ledger **[PLANNED]**

Add one operational coordination ledger; choose its table and column identifiers during the
implementation design so this planning document does not fabricate schema. It needs to represent:

- immutable UUID identity and the bound `akoya_request` GUID;
- initiating staff profile/system-user identity and server-resolved recipient Contact identity;
- sender identity and accepted Dynamics email activity/transport receipt;
- bounded instructions, category, deadline, expiry, allowed MIME/extensions, per-file byte cap,
  and file-count cap;
- token identifier and SHA-256 digest, never the raw token;
- pending/active/expired/revoked/complete/failed lifecycle with optimistic version, reissue
  lineage, timestamps, and bounded failure evidence;
- accepted Request Document identities and a completion receipt, or a normalized relationship
  that can list them without storing bytes;
- idempotency keys for create/send/action retries and a lease or equivalent single-writer fence
  around cross-system send/reissue transitions.

Postgres owns expiring-link workflow and recovery only. It is not the long-term file or proposal
record. **[PLANNED]**

### 9.2 `portal_upload_staging` **[PLANNED]**

Reuse the current table and status/lease/candidate/result fields through an additive migration:

- add one controlled document-upload scope value;
- bind `resource_id` to the exact request/link-ledger UUID, not a client-selected request;
- bind `actor_binding` to a SHA-256 digest of the raw external token with a surface-specific
  prefix;
- generalize allowed content types through a document-specific verifier while preserving the
  current image callers byte-for-byte;
- keep existing expiry, lease, candidate-before-Dataverse, durable replay, and exact cleanup
  contracts.

This is reuse with an additive contract, not evidence that the current image-only service already
accepts documents. **[VERIFIED limitation via `lib/db/migrations/031_portal_upload_staging.sql`
and `lib/services/portal-upload-staging.js`]**

### 9.3 Dataverse **[PLANNED]**

- Reuse `wmkf_requestdocument`; use existing Applicant Slides and Other Applicant Materials kinds.
- Propose one nullable lookup from Request Document to the submitting applicant Contact. Exact
  logical/schema names require the normal schema review, schema-as-code, adapter projection,
  Atlas, and live-readiness sequence.
- Do not add fields to `akoya_request` for this one-to-many file set.
- Do not store token state or file bytes in Dataverse.

## 10. Staff workflow and email voice

### 10.1 Workbench flow **[PLANNED]**

1. Staff opens a request's Proposal tab and chooses **Request additional material**.
2. Workbench displays server-resolved eligible contacts and current email addresses. Staff chooses
   one recipient, category, instructions, deadline, and allowed file policy.
3. Staff previews the exact email and link-expiry statement. The server re-resolves request,
   recipient, sender, authorization, and policy at send.
4. On accepted transport, Workbench shows Active with recipient, deadline, expiry, requester,
   sender, and resend/reissue actions.
5. Each successful finalize appears immediately in Additional materials with scan/identity facts
   and a request-scoped download. Failures remain visible and retryable without false success.
6. Staff reviews each file, decides whether the request is complete, and separately decides whether
   the material belongs in a reviewer package or a governed Proposal Narrative rebuild.
7. Completion closes new uploads for that link. Reopening requires a deliberate new/reissued link.

### 10.2 Email contract **[PLANNED]**

Use mustache syntax for a new editable template and keep the existing dual-syntax resolvers intact.
That is the current template rule. **[VERIFIED via
`.claude-memory/project-email-template-token-syntax.md`]**

The message should be concise, personal, deadline-driven, and read as coming from the named PD,
not a generic Foundation mailbox. If that sender cannot be resolved, block rather than fall back.
That is the current grantee-message voice precedent. **[VERIFIED via
`.claude-memory/project-grantee-deliverable-email-voice.md`]**

Recommended copy shape, using existing token vocabulary where it already fits:

> **Subject:** Additional material requested for {{proposalTitle}}
>
> {{greeting}}
>
> I am writing to request additional material for “{{proposalTitle}}.” Please use the secure
> link below to submit the requested material by {{reviewDueDate}}.
>
> [Bounded staff instructions rendered by the server]
>
> {{externalLink}}
>
> Please contact me if you have questions or need additional time.
>
> Thank you,
> {{signature}}

The implementation must add only the template/resolver entries it actually supports, validate
required placeholders before send, inject the secure link at send rather than preview, and avoid
exposing the internal request number. **[PLANNED]**

## 11. Failure, idempotency, and async contract

| Failure edge | Required behavior **[PLANNED]** |
|---|---|
| Ledger create succeeds; email fails | Row remains unsent/retryable; link is not active; no success UI. |
| Replacement email fails | Prior active link remains active; replacement never supersedes it. |
| Client token minted; browser PUT fails | Pending staging expires and exact-path cleanup runs; bounded client failure evidence is best effort. |
| Browser PUT succeeds; finalize never arrives | Staging expires; cleanup selects only the persisted exact pathname. |
| Scan unavailable or scanner disabled | No SharePoint/Dataverse write; staging remains retryable or rejects according to error permanence; staff sees degraded state. |
| SharePoint upload succeeds; registry write fails | Candidate identity is durable before registry write; retry reconciles or deletes only the exact unreferenced candidate. |
| Registry write succeeds; response drops | Deterministic registry key plus candidate/terminal readback returns the same accepted file; no second row or upload. |
| One of several files fails | Successful siblings remain accepted; request stays partial; no aggregate false success. |
| Completion races a finalize | Version/lease fence allows one ordering; completion refuses while staging is pending/finalizing. |
| Link revoked/expired after mint | Finalize reauthorization rejects; a minted client credential is not sufficient authority. |
| Filename collision | Server-controlled destination naming and stable registry identity avoid overwrite; no client overwrite flag. |
| Dataverse target/context unknown | Target interlock/DAL enforcement fails closed before registry write. |

No notification or cleanup promise may be fire-and-forget unless the function lifetime is explicitly
held and the durable state already makes retry safe. Email acceptance, SharePoint candidate identity,
registry identity, staging terminal state, and request completion are separate receipts. **[PLANNED]**

## 12. Owner decisions

1. **Primary access model.** Choose token link, applicant sign-in, or staff-only handling.
   **Recommendation:** token link; do not revive intake for this feature alone.
2. **Recipient default and attribution.** Decide PI versus primary/institutional contact and whether
   two recipients ever need access. **Recommendation:** one server-resolved recipient per link in
   the first slice; issue separate links later rather than one shared bearer link. Audit says
   “link issued to,” not “person submitted.”
3. **Who may request and whose mailbox sends.** **Recommendation:** lead PD, request program
   coordinator, and superuser may initiate; email sends from the lead PD with no fallback, while
   history records the initiating staff member. If coordinators must send as themselves, approve
   that as a separate sender rule before build.
4. **Material kinds.** **Recommendation:** first slice accepts PDF/PPTX and maps slides to Applicant
   Slides, everything else to Other Applicant Materials. Defer bespoke categories.
5. **Limits.** **Recommendation:** start at 25 MiB/file and 10 accepted files per active request;
   measure real usage before authorizing resumable large-file work.
6. **SharePoint path and naming.** **Recommendation:** a dedicated generic request-root folder,
   outside Reviewer Materials, AI Materials, and Site Visit; settle the exact name and collision
   convention with Connor before implementation. Do not reuse J27's still-open canonical proposal
   path decision.
7. **Reviewer visibility.** **Recommendation:** staff-only by default; reviewer inclusion only
   through explicit canonical package rebuild and existing one-file allow-set.
8. **Initial Assessment interaction.** **Recommendation:** no automatic regeneration. Require an
   explicit governed Proposal Narrative rebuild followed by the existing fingerprinted producer.
9. **Advancement/completion policy.** Decide whether an unresolved additional-material request
   blocks a J27 advancement. **Recommendation:** informational by default; staff may explicitly
   mark a request blocking when they create it, and Workbench must display that state before the
   advancement action.
10. **Link and audit retention.** **Recommendation:** expiry is the business deadline plus seven
    days, capped at 30 days from send; retain terminal workflow/audit metadata for one year, retain
    no raw token, and let SharePoint/Dataverse record retention govern accepted files. Confirm with
    records/security owners before migration.
11. **First-slice mutation scope.** **Recommendation:** additive upload plus staff completion only.
    Defer applicant delete/replace until replacement lineage, recycle behavior, and audit UX are
    explicitly designed.
12. **Scanner launch gate.** **Recommendation:** scanning enabled and positively exercised is a
    hard launch gate; the intake path's current skipped-clean posture is not inherited.
13. **Applicant Contact provenance.** **Recommendation:** add the nullable Request Document lookup
    proposed in §9.3. If declined, record the deliberate loss of durable person attribution after
    Postgres retention.

## 13. Build slicing and release tier

The **plan document itself is Tier 0**. The eventual feature is **Tier 2** because it combines
authentication/authorization, external links, email, uploads, Postgres coordination, SharePoint,
Dataverse writes, and cross-layer recovery. **[VERIFIED tier definition via
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`]**

### Slice 0 — decisions and contracts **[PLANNED]**

- Resolve Decisions 1–13, especially authorization, recipient, path, limits, visibility, and
  retention.
- Confirm representative material sizes/types and scanner constraints without a production write.
- Complete schema/API/security designs: ledger migration + manifest/fresh-install mirror/Atlas;
  additive staging scope; Request Document Contact lookup; route matrix; proxy allowlist; env and
  retention contracts.
- Characterize the current staging image callers before changing their shared primitive.

### Slice 1 — one-request thin slice **[PLANNED]**

- One staff-created request, one server-resolved recipient, one active link, one PDF no larger than
  25 MiB, one successful finalize, one dedicated SharePoint destination, one Other Applicant
  Materials registry row, one Workbench receipt/download, and staff-only visibility.
- Include send failure, invalid/expired/revoked token, browser failure, scan rejection/unavailable,
  SharePoint-before-Dataverse recovery, response-drop replay, and completion/finalize race tests.
- No delete/replace, PPTX, multiple recipients, reviewer-package rebuild, Initial Assessment
  regeneration, digest, or large-file upload.
- Rehearse in an isolated branch and integrated Preview/local approved-data mode; then run one
  owner-approved request smoke with a naive external user. Record last-known-good deployment and
  rollback before any deliberate Production promotion. This plan does not authorize that smoke or
  promotion.

### Slice 2 — practical workflow **[PLANNED]**

- PPTX, multiple files, resend/reissue, staff blocking flag, applicant Contact provenance, bounded
  staff notifications, and operational/admin recovery.
- If owner-approved, explicit reviewer-package inclusion and explicit governed Proposal Narrative
  refresh hooks, each with separate acceptance tests and history.

### Slice 3 — measured expansion **[PLANNED]**

- Delete/replace lineage, multi-recipient access, resumable large files, and possible consolidation
  with the planned Site Visit Materials Upload—only after observed need and a fresh contract review.

## 14. Contract reconciliation review

### 14.1 Caller → persistence → consumer trace

| Stage | Contract **[PLANNED]** |
|---|---|
| Caller | Authorized Workbench staff creates/sends one request; recipient-specific external link mints/finalizes one file. |
| Operational persistence | New Postgres request/link ledger owns expiry, revocation, send/reissue, policy, partial state, and recovery. `portal_upload_staging` owns private-byte transit, leases, candidates, and replay. |
| Settled persistence | SharePoint owns bytes/version history; `wmkf_requestdocument` owns stable identity/type/request/provenance; optional applicant Contact lookup preserves submitter reference. |
| Consumers | Workbench reads link + registry truth. Reviewer portal remains exact-package-only. Initial Assessment remains exact-Proposal-Narrative-only. |

### 14.2 Prior-findings ledger

| Prior finding | Disposition |
|---|---|
| Parked intake product must not be described as live | Preserved: Approach B is explicitly not recommended. |
| `portal_upload_staging` is image-only today | Preserved: additive scope/verifier required; current callers stay unchanged. |
| Grantee token is stateless/no revocation | Preserved as precedent only; new ledger-backed verifier required. |
| Reviewer folder allow-set exposes one exact PDF | Preserved: staff-only default and package rebuild for inclusion. |
| Initial Assessment exact input is one Proposal Narrative | Preserved: no silent supplemental ingestion. |
| J27 proposal path and applicant capture remain open | Preserved: exact destination is Decision 6; no custom J27 intake dependency. |
| Public launch cannot inherit scanner-skipped acceptance | Converted into Decision 12 and a hard thin-slice gate. |

### 14.3 New issues found during review

1. The closest shared staging primitive cannot accept documents without both a database constraint
   change and service generalization. **[VERIFIED via migration/service source]**
2. Existing Request Document explicit actor fields describe staff system users, not an applicant
   Contact. Durable person attribution therefore needs the proposed lookup or an explicit accepted
   loss after operational-ledger retention. **[VERIFIED via
   `lib/dataverse/adapters/request-document.js`; schema change remains planned]**
3. A folder-only Workbench change would miss the typed registry and could conflate D26 Phase II
   documents, generic additional materials, and Site Visit materials. **[VERIFIED via current
   Proposal listing source; conclusion is planned design]**
4. “Received” and “included for reviewers/AI” are separate events. Collapsing them would bypass two
   existing fail-closed exact-file contracts. **[VERIFIED via reviewer-materials and Initial
   Assessment source]**

### 14.4 Recommendation evidence and verdict

| Recommendation | Evidence |
|---|---|
| Token link over portal revival | Narrow external patterns are live; full intake is parked; GOApply remains J27 intake. **[VERIFIED via §3]** |
| Stateful/revocable link | Existing grantee JWT is intentionally stateless and cannot meet staff reissue/revocation needs. **[VERIFIED via §3]** |
| Extend staging rather than invent byte transit | Existing staging already solves actor binding, leases, candidate reconciliation, replay, and cleanup, but its scope/type contract must be extended. **[VERIFIED via §3]** |
| Registry row per file | Existing applicant artifact kinds and stable SharePoint identity fields match a one-to-many settled file record. **[VERIFIED via §3]** |
| Staff-only default | Reviewer and Initial Assessment consumers both enforce exact canonical inputs today. **[VERIFIED via §3]** |

**Final verdict: READY WITH NAMED CHANGES.** The token-link approach is ready for owner scope
selection, not implementation. Implementation remains blocked on Decisions 1–13 and must include
the additive staging, durable link, applicant-provenance, route-security, recovery, and downstream-
visibility contracts above.

## 15. Sweep reconciliation report

- **Mode:** evidence-first planning sweep, limited to the new canonical plan and the brief's owned
  documentation surface. No production probe or write was run.
- **Authoritative evidence read:** current intake/auth/upload source; staging migration/service;
  external token routes; Request Document schema/constants/adapter/Atlas; SharePoint file model;
  reviewer allow-set; Workbench Proposal and Initial Assessment consumers; J27 register; release
  strategy; email memories.
- **Contradictions reconciled:** intake foundation exists but product is parked; Site Visit upload
  is planned but not built; Applicant Slides/Other Applicant Materials option values exist but
  applicant capture does not; current portal staging is reusable in shape but not document-ready.
- **Durable surfaces intentionally unchanged:** source, schemas, API matrix, Atlas, wiki, memory,
  work queue, session prompt, and implementation files. Their changes belong to a separately
  authorized build/sweep.
- **Residual unknowns:** the numbered owner decisions, Connor's exact SharePoint convention, real
  material sizes/types, scanner limits, and whether requested material should ever block J27
  advancement.
