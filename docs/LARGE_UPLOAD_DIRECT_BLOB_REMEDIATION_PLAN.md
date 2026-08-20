---
title: Large Upload Direct-Blob Remediation Plan
domain: security
kind: plan
status: active
summary: Production-live direct private-Blob staging for large grantee images, with one owner-approved business smoke still open.
canonical: false
cataloged: 2026-08-19
owner: product-engineering
related:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/AUTHENTICATION_SETUP.md
  - docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md
  - docs/INTAKE_PORTAL_DESIGN.md
  - docs/CREDENTIALS_RUNBOOK.md
---

# Large Upload Direct-Blob Remediation Plan

**Status: PRODUCTION-LIVE since commit `1f31afdf` and initial runtime deployment
`dpl_AKWrYmBjCaPy8LCuiwKRzdKoFz9d`.** The private-store adversarial preflight,
migration, external and staff direct-upload flows, durable retry/reconciliation
ledger, exact-path maintenance cleanup, and authenticated sanitized
client-failure events are live. Migration 031 is applied to the Postgres
integration shared by Preview and Production. The exact supplied PNG passed the
runtime-identical private Blob transport/privacy gate, the Production token
route failed closed in a post-deploy probe, and the canonical application domain
served the release. The remaining verification is a controlled full business
smoke on a named owner-approved Production test record. Claude Opus's final
adversarial pass returned **SHIP READY** with no remaining blockers.

State labels are deliberate:

- **[VERIFIED via …]** means current source, a focused test, or a live no-write
  probe established the claim on 2026-08-19.
- **[PLANNED]** is proposed work, not shipped behavior.
- **[PRODUCTION-LIVE]** exists on `main` and the Ready Production deployment;
  any narrower verification limit is stated beside the claim.
- **[ASSUMED]** identifies a proposition that still needs the named probe.

## 1. Decision and outcome

The supplied grantee image is valid, but it cannot reach the current multipart
handler. The fix is **not** a `proxy.js` matcher exclusion. The browser will
upload file bytes directly to the existing private Vercel Blob store with a
short-lived, server-issued token; the browser will then send only a small JSON
finalization request to the application. The server will fetch the staged bytes,
run the existing validation/scanning logic, and execute the existing
SharePoint/Dataverse workflow.

The urgent release covers the two live grantee-image consumers:

1. external grantee submission in
   `shared/components/external/GranteeDeliverableForm.js`; and
2. staff replacement in `shared/components/workbench/AwardeeTab.js`.

The two reviewer multipart endpoints remain an explicitly tracked second slice
until their current consumer contract is established:

- `/api/external/review/[token]/upload`
- `/api/review-manager/upload-review`

**[VERIFIED via repository-wide caller search]** Both reviewer endpoints have
tests and canonical security-matrix rows, but no live source caller was found.
That is not proof that no external/manual consumer exists. Do not silently
change or remove their request contract; complete the consumer-discovery gate in
§8 first.

### Acceptance outcome

Pre-ship evidence proved that the exact supplied 9,564,384-byte PNG crosses the
direct private-Blob transport and passes the runtime's no-redirect privacy
predicate. Preview's Dataverse target interlock intentionally denied the
required Production write, so the remaining full business acceptance smoke must
use a named owner-approved Production test record. That controlled smoke must:

1. obtain an authorized staging token through a small JSON request;
2. upload bytes directly to private Blob without the file crossing Routing
   Middleware or a Vercel Function request body;
3. finalize through a small JSON request;
4. re-download byte-identical content server-side;
5. pass the current grantee image validator and scanner;
6. execute the current SharePoint and conditional/atomic Dataverse workflow;
7. delete or durably schedule deletion of the temporary Blob; and
8. surface a specific, actionable client message and sanitized Operational Event
   for a failure at any of the three stages.

## 2. Root cause and corrected evidence

### 2.1 Incident reconstruction

**[VERIFIED via production request logs]** At approximately 1:49 PM PDT,
shortly before the reporter's 1:53 PM email, the grantee loaded the portal and
its context/session endpoints successfully. No submit POST and no
`[grantee/submit]` or `[grantee-upload]` runtime marker appeared. The earlier
hardening commits were already in the 11:39 AM production deployment.

### 2.2 The exact file is valid under the application contract

**[VERIFIED via file inspection and focused route/validator smokes]** The file
is a valid non-interlaced RGB PNG, 4755×4615, 9,564,384 bytes (9.12 MiB), with
correct PNG magic bytes and MIME `image/png`. Its SHA-256 is
`1b8663c98764d70af416bfa6a0bf3a0b1b5befc1cfa8ad6cae6f785dea4e8f14`.
`validateGranteeImage` accepted it. The application multipart parser preserved
every byte and accepted it under `MAX_IMAGE_BYTES` (10 MiB) in a local focused
smoke.

### 2.3 The transport rejects the file before application code

**[VERIFIED via `proxy.js` and Vercel Routing Middleware documentation]** The
current submit path crosses Routing Middleware, whose documented request-body
limit is 4 MB:
<https://vercel.com/docs/routing-middleware#limits-on-requests>.

**[VERIFIED via live production no-write probes]** The exact file returned 413
on both:

- a proxy-matched nonexistent path; and
- the existing, proxy-excluded `/api/cron/health-check` Function using `PUT`.

The health-check handler returns 405 before authentication or any side effect,
so this was a no-write discriminator. It uploaded 9,564,603 wire bytes and
returned 413 before the handler. This refutes the earlier inference that a 404
from a nonexistent proxy-excluded path proved Function delivery: an unmatched
path can be rejected by routing without invoking a Function.

**Planning rule:** regardless of contradictory or changing platform-limit
documentation, the deployed project's measured behavior is the release
boundary. A 9.12 MiB body does not reach its Function today.

### 2.4 Disconfirming checks

| Hypothesis | Evidence | Verdict |
|---|---|---|
| The PNG is corrupt or mislabeled | Signature, MIME, validator smoke | Refuted |
| It exceeds the app's 10 MiB cap | 9,564,384 < 10,485,760 bytes | Refuted |
| Multipart parsing corrupts it | Exact parser byte-equality smoke | Refuted |
| Earlier hardening was not deployed | Deployment timestamp | Refuted |
| Route/service logic rejected it | No POST/runtime marker; pre-handler 413 | Refuted |
| Excluding only Routing Middleware fixes it | Proxy-excluded real Function also returned 413 | Refuted |
| Existing direct client upload is unprecedented here | Intake and shared uploader implementations | Refuted |

## 3. Existing proven pattern to reuse

**[VERIFIED via source]** The intake portal implements the two server legs of
the required three-call architecture:

1. `pages/api/intake/draft/upload-token.js` authenticates/authorizes, derives a
   server-controlled private pathname, sets MIME/size/expiry/overwrite limits,
   records pending state, and mints a client token.
2. **[PLANNED for intake; no intake browser caller is currently wired]** The
   browser PUTs bytes directly to Blob using `@vercel/blob/client`.
3. `pages/api/intake/draft/attach.js` reauthorizes, loads only server-recorded
   pending metadata, fetches private bytes, computes size/SHA-256, validates
   magic bytes, scans, promotes durable state, and performs compensating cleanup.

The browser-to-Blob leg is live elsewhere through
`shared/components/FileUploaderSimple.js` and `pages/api/upload-handler.js`.
That different token-issuance variant does not prove a hostile client cannot
request public access with a pre-minted token. The shared uploader uses the
existing `wmkf-uploads-private` store through `UPLOADS_BLOB_RW_TOKEN`; the
credentials runbook records that token in local, Preview, and Production.
**[IMPLEMENTED ON BRANCH; VERIFIED via adversarial store probe]** Portal
staging uses that private store under new server-controlled path namespaces.
A client token minted from the private store rejected a public-mode PUT; an
honest private PUT succeeded and anonymous HEAD returned 403. The probe deleted
both test objects. Portal staging never uses the intake-only
`INTAKE_BLOB_RW_TOKEN`.

Do not directly reuse the generic `/api/upload-handler` authorization contract:
it requires a staff session and permits broader file types/sizes. Reuse the SDK,
private-store helper behavior, and security shape through a portal-specific
service.

## 4. Step 0 — full contract trace

| Layer | Producer / guard | Consumer / effect | Required invariant |
|---|---|---|---|
| Browser form | Selected `File` plus abstract/caption/waiver or staff fields | Token endpoint, Blob, finalizer | File bytes never enter an application request body |
| Token endpoint | Current token/session, lifecycle state, declared file metadata | Private Blob client token + staging row | No token before authorization; pathname is server-owned |
| Private Blob | Short-lived token with path/MIME/size/no-overwrite constraints | Finalizer's server-side fetch | Blob is private, scoped, temporary, and not accepted as trusted evidence |
| Staging table | Server-derived resource/actor/path/limits and lease state | Finalizer and cleanup sweep | Client supplies only opaque staging ID; replay and abandonment are bounded |
| Finalize route | Repeats current auth/lifecycle/ETag/waiver checks | Staging service | Mint-time authorization never substitutes for finalize-time authorization |
| Staging service | Fetch, actual byte count, SHA-256, magic validation, scan | Existing domain service | Declared MIME/size/name are advisory; actual bytes govern |
| Existing domain service | SharePoint upload + conditional/atomic Dataverse logic | Result and notifications | Existing rollback, ETag, status, waiver, and partial-success semantics stay intact |
| Cleanup | Finalizer plus maintenance sweep | Blob and staging row lifecycle | Success/rejection deletes promptly; retryable failures and abandoned uploads expire |
| Client failure report | Closed enum and numeric metadata | Operational Events | Client-reported evidence is labeled untrusted and contains no token/path/content |

## 5. Security feasibility and durable staging contract

### 5.1 Private-by-construction feasibility gate

**[VERIFIED via the installed `@vercel/blob` type/runtime contract]**
`generateClientTokenFromReadWriteToken` can bind pathname, MIME, size, expiry,
overwrite, and cache behavior, but it does not bind the client-supplied
`access: 'public' | 'private'` choice. The installed presigned PUT signature
also omits access. Client cooperation is therefore not a security boundary.

The pre-implementation gate was an isolated, immediately cleaned private-store
adversarial probe:

1. mint a token for one random, server-owned pathname with the private-store
   `UPLOADS_BLOB_RW_TOKEN`;
2. attempt the PUT with `access: 'public'`;
3. prove the store rejects it; and
4. run the honest private PUT and prove anonymous GET/HEAD is denied.

If the public-mode PUT succeeds, **stop**. Do not implement this plan on that
token mechanism and do not accept an unguessable public URL as private storage.
Select a staging store/upload credential that enforces private access in the
server-issued capability itself, then re-review the architecture. If the store
rejects public mode, record that project-specific evidence and retain these
defenses:

- client always requests `access: 'private'`;
- the token pins one random pathname, accepted MIME, maximum bytes, short
  expiry, no overwrite, and the minimum supported cache lifetime;
- finalization verifies the object is not anonymously readable before use and
  rejects/deletes it otherwise; and
- the adversarial public-mode PUT is a required Preview release probe so an
  SDK/store-policy change fails loud.

**[PRODUCTION-LIVE]** Finalization performs an anonymous HEAD against the
exact server-returned Blob URL and accepts only 401/403 before reading bytes;
anonymous success is a terminal rejection and any indeterminate response is a
retryable fail-closed error. **Explicit release-process deviation:** the live
public-mode PUT probe is `scripts/probe-private-blob-client-access.mjs`, not a
normal Jest/CI test, because it intentionally creates and deletes objects in a
credentialed Vercel store. It is mandatory for Preview promotion and performs
its own exact-object cleanup. Unit tests hold the runtime anonymous-read check;
the live probe holds the external store-policy boundary.

### 5.2 New Postgres table

**[IMPLEMENTED ON BRANCH; MIGRATION 031 APPLIED TO SHARED POSTGRES 2026-08-20]**
`portal_upload_staging` is added through
`lib/db/migrations/` and the migrations manifest; do not edit the fresh-install
shape alone. Minimum contract:

| Field | Purpose |
|---|---|
| `id` UUID primary key | Opaque client-visible staging ID |
| `scope` closed enum/check | `grantee_image`, `staff_grantee_image`, later reviewer scopes |
| `resource_id` + `actor_binding` | Server-derived request/suggestion and token fingerprint or staff profile |
| `pathname` unique | Server-controlled private Blob pathname |
| `filename`, `declared_content_type`, `max_bytes` | Sanitized mint-time constraints |
| `status` | `pending`, `finalizing`, `consumed`, `rejected`, `expired` |
| `lease_token`, `lease_expires_at` | Crash-safe single finalizer with retry after lease expiry |
| `result_code`, `sha256`, `actual_bytes` | Idempotent outcome and forensic metadata without file content |
| `candidate_result_ref` | SharePoint locator recorded before Dataverse commit so a crash/response drop can be reconciled without re-upload |
| `created_at`, `expires_at`, `consumed_at` | Retention and sweep boundaries |

Add only the indexes needed for ID lookup, unique pathname, and expiry/status
sweeps. Update `scripts/setup-database.js`, `docs/APPLICATION_STATE_ATLAS.md`
and the relevant `docs/atlas/` page in the same change.

### 5.3 State transitions and retry semantics

```text
authorized mint -> pending -> finalizing -> consumed
                         |          |----> rejected
                         |          |----> pending (retryable failure / lease release)
                         |----> expired (maintenance sweep)
```

- Claim `pending` with an atomic lease update. A second live finalizer receives
  409/retry. An expired `finalizing` lease is never blindly replayed: compare
  fresh domain state with `candidate_result_ref` and the original ETag/ref
  snapshot first. If the committed ref equals the candidate, mark consumed and
  return idempotent success; otherwise clean only an unreferenced candidate and
  apply the existing stale/retry contract.
- `consumed` is idempotent: a response-drop retry returns the recorded success
  after rechecking resource/actor binding.
- Invalid, oversized, or infected bytes become `rejected` and are deleted
  immediately. Log only hashes/size/type/detection metadata.
- A transient Blob/scanner/SharePoint/Dataverse error releases or expires the
  lease without losing the staged bytes, so the user can retry finalization.
- Success marks `consumed` only after the existing domain service establishes
  its committed outcome; then delete the staging Blob. A delete failure is an
  Operational Event and maintenance-sweep obligation, not a reason to roll back
  an already-committed submission.
- The maintenance service deletes expired pending/rejected/consumed leftovers
  and records failures. Because `wmkf-uploads-private` is shared with durable
  staff files, it may delete **only exact pathnames loaded from
  `portal_upload_staging` rows**—never a store/prefix listing. No temporary
  sensitive Blob is retained indefinitely.

## 6. Urgent implementation slice — grantee images

### Phase A — shared staging service

Create one portal-staging service responsible for:

1. sanitized filenames and closed content-type/size contracts;
2. server-owned path namespaces with random UUIDs;
3. private client-token minting using `UPLOADS_BLOB_RW_TOKEN`;
4. staging-row creation and lease transitions;
5. private Blob fetch/delete;
6. actual-size and SHA-256 calculation; and
7. cleanup-sweep queries limited to exact table-recorded pathnames.

Keep domain-specific token/session, lifecycle, waiver, ETag, magic validation,
scanner, SharePoint, and Dataverse behavior in their existing domain layers.
Do not create a generic endpoint that trusts the client to select `scope`,
resource ID, pathname, access mode, limit, or validator.

### Phase B — external grantee token endpoint

Add a small JSON endpoint under the existing signed-token route family, for
example `/api/external/grantee/[token]/upload-token`.

Order is mandatory:

1. POST method and request-size cap;
2. existing per-token/per-IP rate limit;
3. `verifyGranteeToken`;
4. `recordTokenOutcome` parity so invalid-token spike monitoring covers the new
   attack surface;
5. fresh editable-status/resource guard;
6. closed request shape: filename, declared content type, declared size only;
7. PNG/JPEG/WEBP and 10 MiB mint constraints;
8. staging row, then short-lived private client token.

The response returns `stagingId`, exact pathname, client token, and expiry. It
never returns a store RW token and never accepts a client pathname.

### Phase C — external grantee finalizer

Convert the existing submit call from multipart to a small JSON contract:

`{ stagingId?, editedAbstract, caption, waiverToken }`.

The handler must repeat—not inherit—the current rate limit, signed-token
verification, editable-status check, waiver render-token binding, and text
validation. It then claims the staging row by `scope + resource + actor`, fetches
the private Blob, and passes the actual bytes into the current
`writeGranteeDeliverables` path. Preserve:

- magic-byte validation and server-derived extension/content type;
- Cloudmersive posture and operator alerts;
- server-controlled SharePoint filename;
- atomic request/package Dataverse changeset and ETags;
- response-drop reread and safe SharePoint compensation;
- post-200 Program Director notification via `keepAlive`.

Do not mark the staging row consumed before the domain service's committed
success is known.

`stagingId` remains optional because the current route permits an abstract /
caption resubmission that keeps an already-stored image. If it is absent, the
fresh deliverable must already contain an image reference or the request fails
exactly as it does today.

### Phase D — external grantee client

Update `GranteeDeliverableForm` to:

1. retain current local type/size checks;
2. request the staging token;
3. PUT the image directly with upload progress;
4. POST the small finalization JSON;
5. prevent double-submit across all three stages; and
6. distinguish token, Blob-transfer, validation/scan, stale-state, and finalize
   failures without exposing internals.

On a retry after successful Blob PUT, reuse the unexpired `stagingId` and retry
finalization rather than uploading bytes again. Clear it after terminal success
or rejection.

### Phase E — staff grantee replacement

Apply the same staging service to `AwardeeTab` and the staff replacement route.
The token endpoint must call `requireAppAccess('reviewers')`, and the finalizer
must repeat that guard (which includes Origin validation), fresh status check,
request GUID validation, deliverable ETag requirement, and caption rules. Keep the current
service contract that never changes waiver fields, abstract, or deliverable
status.

The staff JSON contract preserves two current shapes: `stagingId` is optional
for a caption-only replacement, and caption **absence** means "leave unchanged"
while a present-but-blank caption remains invalid. Do not coerce an absent
caption to `null` or an empty string.

Because `proxy.js` remains unchanged, the proxy's missing/stale `lastActivity`
defense-in-depth continues to apply to both staff JSON endpoints. No matcher
security exception is needed.

## 7. Failure visibility and user messaging

The direct Blob leg does not execute application code. Avoid recreating the
same Operational Events blind spot:

1. Add a small, rate-limited failure-report endpoint for each authenticated
   surface or a shared service behind surface-specific routes.
2. Reauthorize with the same external token or staff session.
3. Accept only closed enums (`token_request`, `blob_put`, `finalize`) and stable
   error categories/status, plus declared byte count/content type.
4. Reject raw exception text, URLs, Blob pathnames, signed tokens, captions,
   abstracts, filenames, and file bytes.
5. Record the event as `client_reported: true`; it is diagnostic evidence, not
   authoritative proof of server failure.
6. Keep server-side finalize failures and cleanup failures authoritative and
   alertable through the existing operational pipeline.

Retain a specific fallback for HTTP 413 even when the response is non-JSON. It
should say the upload was rejected before submission and direct the user to
support; do not advertise a precise limit that an upstream layer may change.

## 8. Reviewer uploads and other oversized contracts

### 8.1 Consumer-discovery gate

Before changing either reviewer endpoint:

1. search source, generated HTML/templates, email links, docs, deployment logs,
   and known external/manual integrations for callers;
2. classify each route as live, dormant-but-supported, or retired only with
   evidence; and
3. obtain an owner decision before a breaking request-contract change when a
   caller cannot be updated atomically.

If live/supported, extend the same staging table/service with reviewer scopes.
Stage each file independently, then finalize a small ordered array of staging
IDs. Fetch/validate/process sequentially so five files do not require one large
inbound request or an unnecessary 125 MiB in-memory aggregate. Preserve token
operation/finality checks, staff app access, ETag-conditional receipt writes,
attempt-folder isolation, and losing-attempt cleanup.

The current five-files-at-25-MiB contract is not deliverable through the
multipart endpoints. Do not continue documenting it as an effective transport
contract until direct-upload Preview smokes prove one 25 MiB file and a five-file
finalization.

### 8.2 Known residue outside multipart routes

**[VERIFIED via route configuration census]** Other proxied JSON routes declare
body-parser ceilings at or above the measured transport boundary, including
`process-peer-reviews`, reviewer-finder email/analyze routes,
`review-manager/send-emails`, and `expertise-finder/match`. This plan does not
assume they all carry file bytes or fail in normal use. Create a bounded follow-up
audit that compares actual client payload shapes and logs before changing any of
them. Do not describe the four multipart routes as the complete body-limit
inventory.

## 9. Test and verification plan

### 9.1 Unit/integration contracts

- Token endpoints: method, JSON cap, rate limit, auth, `recordTokenOutcome`,
  lifecycle/status, closed shape, content type, declared size, server path,
  token expiry/no-overwrite/cache floor, pending-row ordering, and token-mint
  compensation.
- Staging state: ownership/scope binding, atomic lease, concurrent finalizers,
  expired lease recovery, consumed idempotency, rejected terminal state, and
  expiry sweep.
- Finalizers: reauthorization before Blob fetch, server-recorded path only,
  actual size/hash, magic/scan outcomes, existing domain-service inputs,
  response-drop success, retryable failures, and cleanup ordering.
- Clients: three-stage happy path, progress, double-click protection,
  Blob-PUT retry/finalize retry, non-JSON 413, client-reported telemetry
  sanitization, and stale-state messaging.
- Security negatives: another resource/token/profile cannot claim a staging ID;
  client-selected pathname/scope/resource/max is rejected; expired token or
  staging row fails closed; private Blob URL is not anonymously readable; and a
  deliberate `access: 'public'` PUT is rejected rather than merely noticed
  after exposure.
- JSON-shape parity: no-new-image grantee resubmit, caption-only staff replace,
  and staff caption absent versus present-but-blank.
- Crash reconciliation: simulate SharePoint success and Dataverse commit
  followed by failure before staging consumption; lease reclaim must return the
  committed result without a second SharePoint upload.

Use generated fixtures for automated tests. Do not commit the supplied image.

### 9.2 Release evidence and remaining Production smoke

The branch build, private-store adversarial probe, exact-payload transport,
migration, focused failure paths, full regression suite, Preview deployment, and
Production promotion are complete; §§14–15 record the evidence.

One controlled business smoke remains. After the owner names and approves a
Production test record:

1. upload the exact supplied 9.12 MiB PNG through the appropriate external or
   staff browser flow;
2. confirm the application receives only the small token/finalize JSON requests;
3. confirm staged and downloaded SHA-256 match the supplied file;
4. confirm image validation and scanning complete;
5. confirm the expected SharePoint/Dataverse result and notification behavior;
6. confirm the staging row reaches `consumed` and the temporary Blob is gone;
7. confirm no duplicate business write or notification occurs; and
8. inspect Operational Events and runtime logs for sanitized, actionable truth.

Do not ask the affected grantee to retry. A no-write transport smoke proves the
transport/privacy boundary, not the cross-system business commit.

### 9.3 Repository gates

Run each gate and its self-test sequentially when both apply:

1. focused endpoint, service, client, migration, maintenance, and existing
   grantee/replacement suites;
2. `npm run check:migrations-manifest` (there is no manifest self-test script);
3. `npm run check:atlas` and `npm run check:atlas:self-test`;
4. `npm run check:api-routes` and `npm run check:api-routes:self-test`;
5. route-service/lifecycle/auth gates and their self-tests for new routes;
6. `npm run check:docs-catalog`, `check:doc-currency`, and
   `check:fact-consistency` after durable doc edits;
7. relevant lint/type checks and focused Jest suites; and
8. canonical `npm run build`.

## 10. Durable documentation and release

Update in the same implementation series:

- `docs/API_ROUTE_SECURITY_MATRIX.md`: new token/failure endpoints, JSON
  finalizers, staging ownership, Blob fetch, and unchanged domain guards.
- `docs/AUTHENTICATION_SETUP.md`: token/session checks occur at mint and
  finalize; direct Blob possession does not authorize finalization.
- `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md`: distinguish pre-function 413,
  direct-Blob client-reported failures, and authoritative server failures;
  reconcile its stale log-drain activation statement against live state.
- `docs/CREDENTIALS_RUNBOOK.md`: `UPLOADS_BLOB_RW_TOKEN` gains the portal
  staging namespace; preserve the intake-token prohibition.
- Atlas, setup, migration manifest, service catalog, and maintenance docs for
  `portal_upload_staging` and its cleanup owner.
- `SESSION_PROMPT.md` at handoff: narrow the overbroad statement that all
  grantee upload failures appear automatically in Operational Events.

This is a cross-layer runtime/security/persistence change. Use a branch,
Preview, deliberate Production promotion, and `/contract-reconcile` again on
the implementation diff.

## 11. Rollback and containment

- Keep the old multipart server code available only until the new Preview flow
  passes; do not offer it as a large-file fallback because it is transport-
  broken. Remove it atomically with the client switch.
- A code rollback restores the previous client/route contract. The staging
  table is additive and may remain temporarily; do not drop it during incident
  rollback.
- Disable token issuance first if a security or Blob incident occurs. Existing
  pending rows then expire through the sweep; finalization policy must be an
  explicit operator choice (allow safe drain or block all).
- No rollback may delete a SharePoint file already referenced by committed
  Dataverse state.
- A failed temporary-Blob deletion is retried by maintenance and surfaced; it
  never reverses an already-committed business submission.

## 12. Recommendation evidence and residual risks

| Recommendation | Evidence | Confidence | Residual risk / gate |
|---|---|---|---|
| Use direct private Blob staging | Exact 9.12 MiB body returned 413 even on real proxy-excluded Function; exact-payload direct transport and private-store behavior passed; implementation is Production-live | High | Controlled Production business smoke on an owner-approved record remains |
| Keep `proxy.js` unchanged | Matcher bypass failed the decisive Function probe and would drop staff idle-session defense-in-depth | High | None for urgent architecture; JSON remains well below limits |
| Reuse `UPLOADS_BLOB_RW_TOKEN` only if public mode is impossible | Live disposable preflight proved the provisioned store rejects public-mode PUT, accepts private PUT, denies anonymous HEAD, and allowed exact cleanup | High | Controlled Production business smoke remains |
| Add durable staging state | Cross-request ownership, retry, idempotency, and orphan cleanup cannot rely on client descriptors | High | Migration 031 is live; controlled terminal-state/cleanup observation remains |
| Reauthorize at mint and finalize | Long-running upload creates a state-change window | High | Focused tests passed; controlled smoke must confirm current status/ETag/waiver behavior |
| Add sanitized client failure reporting | Direct Blob PUT otherwise bypasses application observability | High | Client evidence is forgeable; label and rate-limit it |
| Stage reviewer work after consumer discovery | No source caller found; route/tests still exist | Medium | External/manual caller may exist |
| Audit non-multipart oversized contracts separately | Configuration census found additional >4 MB declarations | High | Declared cap alone does not prove real payload failure |

## 13. Claude Opus review disposition

Claude Opus performed a read-only `/contract-reconcile` Mode A review using the
repository's interactive OAuth session. Its verdict on the original matcher-
exclusion plan was **NEEDS REWORK**.

| Opus finding | Disposition in this revision |
|---|---|
| Function delivery of 9.12 MiB was unproven and likely still capped | **Accepted and independently confirmed** with the exact file against the real proxy-excluded health-check Function: 413 |
| The nonexistent `/api/cron/...` 404 control did not prove Function invocation | **Accepted**; the evidence claim is withdrawn |
| Matcher exclusion drops a proxy-only missing-`lastActivity` staff gate | **Accepted**; no matcher exclusion is proposed |
| Direct client upload already exists in this repo | **Accepted**; the intake three-call design is the implementation model |
| Only two of the four routes have located live clients | **Accepted**; urgent grantee slice and reviewer consumer-discovery gate are separate |
| Reviewer five-by-25-MiB contract is not transportable today | **Accepted**; it cannot be called fixed until direct-upload boundary smokes pass |
| Other non-multipart routes declare oversized body limits | **Accepted as a named residual audit**, not silently pulled into this fix |
| Method-mismatch smoke may reset rather than return a clean 405 | **Accepted generally**; the decisive production probe returned a clean 413, and future probes key on handler evidence rather than status alone |
| Intake's pre-minted browser leg was described as live without a caller | **Accepted**; only its server legs are verified, while the generic browser direct-upload path is the live precedent |
| Client token does not bind public/private access | **Accepted as a pre-implementation security gate**; a public-mode PUT must fail or the storage mechanism changes |
| Shared-store cleanup could delete durable staff files | **Accepted**; sweeps use exact staging-row pathnames, never prefix listings |
| Lease reclaim could replay a committed staff replacement | **Accepted**; candidate ref plus fresh domain reconciliation is required before reclaim |
| JSON conversion could lose no-image and absent-caption shapes | **Accepted**; both compatibility contracts are explicit and tested |
| Manifest self-test was named but does not exist | **Accepted**; removed |
| Recorded SHA-256 was truncated | **Accepted**; corrected from the supplied file |
| New token endpoint omitted invalid-token outcome monitoring | **Accepted**; `recordTokenOutcome` parity is required |

**Post-review contract-reconcile verdict:** **READY WITH NAMED CHANGES**. The
mechanism is now direct private Blob staging, not matcher exclusion. Before
implementation is declared ready for Production, the owner must approve the
new staging table/retention contract, reviewer routes must remain unchanged
until their consumers are classified, the private-by-construction gate in §5.1
must pass, and the implementation diff must pass the cross-layer and Preview
gates above.

### Implementation review rounds

Claude Opus then reviewed the implementation diff adversarially on the feature
branch. Its first implementation pass required three material reconciliation
fixes and three bounded hardening changes: status-aware candidate
reconciliation, notification-skipped reconciliation, explicit crash-window
tests, terminal-failure client recovery, private-Blob response-shape probing,
and staging-failure alert coverage. Commit `0dd3d80` implements those changes.

The second pass re-read the fixes, re-ran the focused test surface, and returned
**SHIP READY**. Its only residual notes were non-blocking: one staff validation
error may require an explicit reselect, and the private-Blob HEAD check is
deliberately fail-closed if the provider response shape changes.

After the shared migration, Preview deployment, and exact-payload probe, Opus
performed a final release-disposition review. It found one material mismatch:
the probe followed redirects while runtime rejects them. The probe was changed
to use `redirect: 'manual'` and the runtime-identical 401/403-only predicate,
then rerun successfully against the exact PNG with a direct anonymous 403.
Opus re-read the fix, reported no remaining blockers, and returned **SHIP
READY**. The controlled full business commit is post-deploy verification, not a
waiver of the Preview write interlock.

## 14. Preview release evidence

**[VERIFIED 2026-08-20 via Vercel CLI and signed-in Chrome]** Preview deployment
`dpl_A8JPHtBc8ApPtYJ3kzxDYLjsffE9` completed the canonical Next.js 16.3
Turbopack build and reached Ready. The Azure-registered stable alias
`wmkfresearchapps-preview.vercel.app` points to it and completed SSO. Its route
inventory includes the external and staff token/failure endpoints plus both
JSON finalizers. A protected CLI request to the external token endpoint matched
the dynamic route and failed closed with `401 malformed` for an intentionally
invalid token.

**[VERIFIED 2026-08-20 via the canonical migration runner and
`scripts/audit-postgres-state.js`]** Owner-approved migration 031 applied
transactionally to the Postgres integration shared by Preview and Production;
`portal_upload_staging` exists and started with zero rows.

**[VERIFIED 2026-08-20 via signed-in Preview and Vercel runtime logs]** The
Dataverse target interlock denies Preview reads of Production without
`DATAVERSE_ALLOW_PROD_READS=yes` and denies Preview writes regardless. The
release did not weaken or bypass that boundary. A successful
SharePoint-plus-Dataverse business commit therefore remains a controlled
post-promotion Production smoke.

**[VERIFIED 2026-08-20 via
`scripts/probe-private-blob-client-access.mjs --file`]** The exact 9,564,384-byte
PNG (`SHA-256 1b8663c98764d70af416bfa6a0bf3a0b1b5befc1cfa8ad6cae6f785dea4e8f14`)
passed the direct client-token transport. Public-mode PUT was rejected; private
PUT succeeded; the runtime-identical manual-redirect anonymous HEAD returned a
direct 403; the disposable object was deleted.

**[VERIFIED 2026-08-19 via Jest]** The post-review full regression run passed
669 suites and 8,636 tests. The recorded last-known-good Production rollback
target before the Preview deployment is
`wmkfresearchapps-erymyonv3-justin-gallivans-projects.vercel.app` at commit
`7d20afddf7d2d6d73722829066e26a72990a4b27`.

## 15. Production release evidence

**[VERIFIED 2026-08-20 via Git and Vercel CLI]** `main` advanced from
`7d20afdd` to `1f31afdf`; Production deployment
`dpl_AKWrYmBjCaPy8LCuiwKRzdKoFz9d` reached Ready and acquired all application
aliases. `applications.wmkeck.org/auth/signin` returned 200 from the canonical
domain.

**[VERIFIED 2026-08-20 via Vercel environment metadata]** Production contains
the required sensitive `UPLOADS_BLOB_RW_TOKEN` and `CLOUDMERSIVE_API_KEY`
variables plus the explicit virus-scan configuration. No values were printed or
persisted in release evidence.

**[VERIFIED 2026-08-20 via fail-closed route probe]** A deliberately malformed
external token matched `/api/external/grantee/[token]/upload-token` on the new
Production deployment and returned `401 {"ok":false,"reason":"malformed"}`.

**[VERIFIED 2026-08-20 via Postgres audit and Vercel error-log query]**
`portal_upload_staging` remained present with zero rows immediately after
promotion, and no Production error logs were present in the release window. The
zero-row state is expected because no unapproved business record was used for a
write smoke.
