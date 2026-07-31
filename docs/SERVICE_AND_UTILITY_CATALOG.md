---
title: "Service & Utility Catalog"
domain: docs-governance
kind: source-of-truth
status: canonical
summary: "If you're touching a service or utility, read its header before this catalog. If a header is sparse or stale, fix it in the same commit as your..."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-07-30
owner: product-engineering
related:
  - lib/services/
  - lib/external/
  - lib/bill/
  - lib/utils/
---

# Service & Utility Catalog

One-line lookup index for files under `lib/services/`, `lib/external/`, `lib/bill/`, and `lib/utils/`. **Source-file headers are authoritative** for per-file contracts, safety posture, storage source-of-truth, and migration/drop history — this doc points there, it doesn't replace them.

If you're touching a service or utility, read its header before this catalog. If a header is sparse or stale, fix it in the same commit as your change rather than rely on this doc.

---

## `lib/services/`

### AI / prompt execution

- **`llm-client.js`** — Canonical Anthropic API wrapper (`complete()` + `stream()`). SSRF allowlist, abortable timeouts, 429/529 retry, single fallback-model swap, usage logging, API-key redaction. **Use this — not ad-hoc `fetch`** for new Anthropic API calls.
- **`model-capabilities.js`** — Reviewed Anthropic model capability registry for request shaping (`temperature`, `output_config.effort`) and response semantics (refusals, retention class, max tokens). Unknown runtime ids fail closed for optional params; configured ids are guarded by `check:model-registry`.
- **`model-review-validation.js`** — Shared write-time validator for tier keys and concrete Claude model ids. Admin model overrides and prompt publishes use it to reject unreviewed concrete Claude ids unless both capability and pricing entries exist.
- **`execute-prompt.js`** — Live prompt-execution Executor implementing `docs/EXECUTOR_CONTRACT.md`. Reads current prompt rows from Dataverse entity set `wmkf_ai_prompts`, rejects unreviewed concrete Claude model ids before execution, and attempts append-only audit rows in `wmkf_ai_runs`. Production consumers include Phase-I Dynamics summary, grantee title/abstract, field primer, peer-review summary, and review synthesis flows; inspect current callers before changing the contract.
- **`prompt-resolver.js`** — Legacy Session 103 holdover. Reads prompts from a scratch row on `wmkf_ai_runs`, 5-min cache, `{{var}}` interpolation, bundled `.js` fallback. `PROMPT_RESOLVER_STRICT=true` disables fallback. Currently used only by scripts; no live API route depends on it.
- **`model-resolver.js`** / **`model-override-loader.js`** — Per-app model overrides for `baseConfig.js`. Resolver computes effective model per app at call time and exposes `resolveModelWithCapabilities()` for coupled concrete-id + reviewed-capability lookup; loader caches DB-backed overrides.
- **`claude-reviewer-service.js`** — Live, legacy-named Reviewer
  Finder/Workbench orchestration service. It now delegates provider calls through
  `llm-client.js`; do not treat it as dead code.

### Dynamics / Dataverse

- **`dynamics-service.js`** — Dynamics 365 / Dataverse client (OAuth, OData, Dataverse Search, email activities, `updateIfEmpty`, `logAiRun`). Impersonation contract documented in `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`.
- **`dynamics-context.js`** — AsyncLocalStorage restriction context. `withDynamicsContext` / `bypassDynamicsRestrictions` for route + library callers; `enterDynamicsBypassForScript` for top-level scripts. **`DynamicsService.checkRestriction()` fails closed** when no context is set — every caller must opt in explicitly.
- **`dynamics-explorer-taxonomy.js`** — Dynamics Explorer A2 layer (S200): 6h-cached, **fail-loud** live resolution of program / grantprogram / type / `wmkf_request_type` / distinct `akoya_requeststatus` over a fixed whitelist, with table-restriction gate + GUID/int/label validation, into a server-resolved system-prompt block (replaces the old hardcoded program GUIDs). Wraps `dataverse-export/live-taxonomy.js`.
- **`dynamics-odata-validator.js`** — Dynamics Explorer OData pre-flight validator (S200): tolerant tokenizer + checks (field/entity name vs live `getEntityAttributes`, restricted-field enforcement in filter/orderby, request-number-as-GUID, unsupported-construct rejects). Reject-with-hint only, **no auto-correct**; unknown shapes pass through (false-reject-averse). Design: `docs/DYNAMICS_EXPLORER_ODATA_VALIDATOR_DESIGN.md`.
- **`dataverse-identity-map.js`** / **`dynamics-identity-service.js`** — `user_profiles` ↔ Dynamics `systemuser` bridge; reconciliation CLI at `scripts/reconcile-dynamics-identities.js`.
- **`program-director-resolver.js`** — Email → Dynamics `systemuser` bridge for Reviewer Finder's PD-filtered picker.
- **`grant-cycles-dataverse.js`** — Dataverse `wmkf_appgrantcycle` adapter (Migrates / Replaced `grant_cycles` at W3 cutover 2026-05-12 — drain-only thereafter). Consumed by Reviewer Finder + Review Manager (`render-emails`, `send-emails`) + `maintenance-service` blob cleanup.

### Wave 1 dispatch (Dataverse-default since 2026-05-12)

- **`settings-service.js`** / **`dataverse-settings-service.js`** — Dataverse `wmkf_appsystemsettings`. Legacy Postgres `system_settings` was dropped 2026-05-12 (Migrates / Replaced); dispatch retained as fail-loud opt-out.
- **`app-access-service.js`** / **`dataverse-app-access-service.js`** — Dataverse `wmkf_appuserappaccesses`. Legacy Postgres `user_app_access` was dropped 2026-05-12 (Migrates / Replaced).
- **`dataverse-prefs-service.js`** — Dataverse `wmkf_appuserpreferences`
  adapter. Postgres `user_preferences` was dropped 2026-05-12 and its old
  database-service branch was removed; unsupported Postgres configuration fails
  loudly.
- **`email-signature.js`** — Unified per-user email-signature resolver. Reads the `email_signature` preference from Dataverse user preferences, falls back to legacy reviewer sender info, resolves request-scoped grantee signatures from the assigned Dataverse PD via `dataverse-identity-map`, and appends a Foundation-ending signature block for grantee invite/reminder mail.

### Storage / persistence

- **`database-service.js`** — Vercel Postgres operations; Wave 1 dispatch lives here.
- **`graph-service.js`** — Microsoft Graph (SharePoint files, listing/download, content search, idempotent folder-path creation, stable path-to-item metadata, stable drive/item-ID metadata readback, and upload responses carrying site/drive/item/eTag/version metadata).
- **`initial-assessment/artifact-service.js`** — Governed Initial Assessment producer + shared Workbench/pilot-locator read model. Requires exactly one active `Reviewer Materials/Proposal_{Request#}.pdf` before any registry/AI/upload write, requires a positively resolved Dynamics-tracked request library, converges exact retries through `wmkf_requestdocument`, never overwrites Ready artifacts, and atomically commits replacement Ready + prior supersession (or exact-input reactivation) with the shared `akoya_request.wmkf_CurrentInitialAssessment` ETag fence. It preserves the canonical file while exposing a failed replacement separately, cleans up claim-lost uploads with character-bounded durable cleanup work on delete failure, writes DOCX bytes to the request's `Artifacts/Initial Assessment/` folder, and returns success only after stable SharePoint identity, canonical pointer, and lineage read-back are confirmed in Dataverse. Request `1002788` preserves mechanics-only evidence because it used an old Phase I source. Production commit `9c88a1fa` fixed recovery with a scheme-tagged normalized governed-DOCX hash and passed the request GUID to the Executor. Merge commit `84155a5a` then enforced the canonical source in production; Request `1003109` proved exact-file generation, a non-null AI-run request lookup, Ready/Draft lineage, exact-input reuse, interrupted-finalization recovery, and attributed substantive editing on the stable item. **[VERIFIED DEPLOYED 2026-07-30 via production deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`, commit `68bcb4e8`, and signed-in Request `1003109` checks]** reads refresh current SharePoint name/size/link/version/eTag/last-modified values by stable drive/item ID, deduplicate identical identities, cap Graph concurrency at eight, and enforce a ten-second total cycle-read budget including each caller's token wait. Cold token acquisition is single-flight while callers retain independent wait deadlines. Only a matching file facet can be current, and only Graph's publication version is labeled as a version. Response metadata reports `current`, `missing`, or `unavailable`; missing/error/budget cases preserve the registry snapshot without labeling it current, confirmed-missing files expose no active link, and the read performs no Dataverse write. Both consumers share a renderer for current/missing/unavailable/unchecked display. Both live consumers displayed SharePoint version `2.0` and the same stable document link; target-library controls remain open. The deployed locator is narrower than the planned full Editor Dashboard.
- **`initial-assessment/template.js`** — Versioned `standard_business_brief` DOCX template. AI content is limited to Summary, Significance & Impact, Research Plan, and Team Expertise; Foundation Opportunity is always rendered as staff-required.

### Intake portal

- **`intake-draft-service.js`** — CRUD over `intake_drafts`. Drafts are Postgres-only; submission goes via `submission_jobs` drain queue; pending-attachments JSONB ops; 2h sweep. See header for state-machine summary + `docs/INTAKE_PORTAL_DRAIN_PLAN.md`.
- **`intake-audit-service.js`** — Append-only sha256-hashed audit; swallow-on-failure posture.

### Reviewer / honorarium

- **`review-receipt-guard.js`** — Shared terminal/finality/accepted/ETag authorization for every request-time review-receipt sink; classifiers turn a lost If-Match race into `engagement_ended`, `review_received_locked`, or `conflict`.
- **`review-manager/terminal-transition-service.js`** — Dedicated fail-closed post-accept `withdrew`/`released` transition. Fresh per-row eligibility read, explicit partial-success statuses, and ETag-conditional writes so a concurrent submission wins. Staff-recorded `withdrew` also corrects the response to declined, atomically deletes the exact linked honorarium request, and cancels acceptance follow-up; `released` remains a status-only WMKF outcome.
- **`review-manager/manual-review-entry-service.js`** — Staff rescue for recording a complete structured review from the Workbench Reviews tab. Reuses the external review question set, sanitizer, validator, canonical submission producer, and atomic ETag-guarded parent/answer-row changeset; deletes a stale external draft only after commit.
- **`review-upload.js`** — Shared `writeReviewFiles` core for staff + reviewer-self upload paths; shared receipt authorization, unique per-attempt SharePoint folders persisted on the winning row, and an ETag-bound Dataverse write. Ordinary Dataverse failures clean up the caller's attempt; every 412 race loser is orphaned and never deleted because winner ownership cannot be inferred safely.
- **`reviewer-campaign-timeline.js`** — Dataverse `wmkf_appsystemsettings` reader/writer for current-cycle reviewer invitation timeline defaults (`reviewer.campaign_timeline_defaults`); admin-editable, read by `InviteEmailModal` before request-level campaign config.
- **`external-token.js`** — HS256 HMAC JWT primitive for external-reviewer magic links; hash-only storage for cheap revocation. 32+ char `EXTERNAL_LINK_SECRET`; rotation supported via `EXTERNAL_LINK_SECRET_PREVIOUS`.

### Multi-LLM panel (Virtual Review Panel)

- **`multi-llm-service.js`** — Claude / OpenAI / Gemini / Perplexity wrappers with normalized responses + retry/fan-out. Claude request shaping uses `model-capabilities.js`; Fable-style refusal metadata is surfaced in normalized results.
- **`panel-review-service.js`** — VRP pipeline: optional pre-review intelligence → optional claim verification → structured review → synthesis. Persistence in `panel_reviews` / `panel_review_items`. See `docs/VIRTUAL_REVIEW_PANEL.md`.
- **`literature-search-service.js`** — Stage 0 academic search orchestration; normalized results.

### Research-database clients

- **`pubmed-service.js`**, **`openalex-service.js`**, **`arxiv-service.js`**, **`biorxiv-service.js`**, **`chemrxiv-service.js`**, **`orcid-service.js`**, **`serp-contact-service.js`** — external research-DB clients (API shapes, rate limits, and tier positioning in each header). Europe PMC is queried by the scholarly-email helper rather than a standalone client.

### Reviewer Finder pipeline

- **`reviewer-finder/load-proposal-service.js`** — Default proposal ingestion
  requires the exact active
  `Reviewer Materials/Proposal_{Request#}.pdf`; zero or multiple matches fail
  before download/Blob write. An explicit authenticated, server-listed
  `fileKey` remains for deliberate historical/ad-hoc staff overrides.
- **`discovery-service.js`** — Multi-database literature search orchestration.
- **`deduplication-service.js`** — Name matching, duplicate merge, COI filtering, ranking.
- **`institution-identity-resolver.js`** — W0 OpenAlex institution resolver with per-run settled caching, unique-strongest name/country selection, structured associated-institution output, and `null` on ambiguity or provider failure. W1 callers use it to narrow pre-existing COI matches and corroborate affiliation consistency.
- **`institution-affiliation-consistency.js`** — W1 direct-id or one-hop-associated institution consistency helper for identity corroboration and mismatch alerts. It is intentionally separate from COI and must never widen the hard-drop set.
- **`reviewer-identity-runtime.js`** — Server-owned W2 runtime seam for non-biomedical/PubMed-off Track-A verification and server-computed enrichment reconciliation. Default and unknown modes return the legacy identity result exactly; `shadow` returns legacy after hard-bounded redacted comparisons; explicit owner-gated `combined` adapts W2 decisions with a `probable` ceiling. Default observers await the non-throwing durable logger so normal inserts settle before function completion.
- **`reviewer-identity-shadow-log.js`** — Best-effort Postgres persistence for resolver comparisons (`reviewer_identity_shadow_log`, migration 026). Whitelisted data-minimized scalars only (pseudonymous hashed candidate key, decisions, reason, anchors-agree, error code); awaited inserts are capped at 2 seconds, always resolve, and circuit-break after repeated failure. Non-authoritative: no application decision reader; the canonical operator report is `scripts/report-reviewer-identity-shadow-log.js`, and retention/cap cleanup runs in the daily maintenance cron.
- **`reviewer-works-first.js`** / **`reviewer-works-first-authoritative.js`** — Shared works-first resolver, exact sparse-fragment/byline-ORCID equivalence, W4.1 evidence-bundle builder/parser, and authoritative-result adapter used by the frozen evaluator and runtime seam. Uses byline-filtered works plus W0 institution identities; same-ORCID fragments may collapse, every distinct-ORCID set goes to review, and automated rescues cap at `probable`.
- **`contact-enrichment-service.js`** — Tiered contact lookup with identity anchoring, structured scholarly-email evidence, and Dataverse writeback.
- **`reviewer-contact-reconciliation.js`** — Read-only, sequential exact-email/ORCID reconciliation for enriched search cards. Produces bounded staff-facing Dataverse evidence only; provisional ORCID hits can require review but never establish a known identity or grant save authority.
- **`contact-enrichment/scholarly-email.js`** — Free NCBI PubMed + Europe PMC author-affiliation email resolver; requires full-forename or exact-ORCID identity plus affiliation corroboration, deduplicates the same work across providers, and abstains on tied addresses.
- **`reviewer-roster-store.js`** — Postgres operational roster for
  request-scoped Find state and server-owned promotion finalization. Stores
  actor-bound staff identity confirmation; only the successful Dataverse
  promotion service can finalize exact keys as `saved`, while authoritative
  applicant-excluded collisions become `blocked`.
- **`reviewer-candidate-attestation.js`** — `NEXTAUTH_SECRET`-signed
  request/candidate receipt. Projection v3 binds the exact canonical contact
  projection in addition to identity/eligibility; v1/v2 remain verifiable
  against their historical projections but are never contact-authoritative.
- **`reviewer-finder/save-candidates-service.js`** — Server-owned Find→Invite
  promotion boundary: canonical contact projection, v3/staff authority,
  exact-email owner reuse and race convergence, per-row result contract,
  bounded new-person compensation, and exact roster finalization.
- **`reviewer-promotion-repair-classifier.js`** — Pure read-only historical
  classifier (`D/C/U/E/N`) and redacted canonical manifest/hash builder.
  Classification D requires one active exact-email owner, independent
  same-person confirmation, and an unblocked ETag-complete merge plan; it does
  not execute repairs.
- **`capture-self-reported-orcid.js`** — Self-reported ORCID persistence seam. Accept-drain calls with a stable acceptance timestamp use the Wave 13 binding writer before contact fill; only typed `legacy_classification_required` falls back to the transitional person writes. Older/decline calls without a stable event retain the transitional path.
- **`reviewer-identity-binding-writer.js`** — Server-owned Wave 13 person-binding transition seam: fail-closed snapshot + ETag read, strict UTC timestamp normalization, lineage/source precedence, one complete conditional PATCH, and bounded 412 reread/recompute. Its first production caller is live since PR #57 / `00ffb09c`: acceptance-drain self-report only. Dirty legacy rows, revocation, unauthorized human correction, policy-reader migration, and automated writer migration remain blocked or deferred.

### Integrity Screener

- **`integrity-service.js`** — Retraction Watch + PubPeer + News + Haiku summarization.
- **`integrity-matching-service.js`** — Multi-tier name matching + Retraction Watch optimization.

### Admin / monitoring

- **`feedback-service.js`** — `dynamics_feedback` thumbs + auto-detected failures.
- **`alert-service.js`** — `system_alerts` rows; health/maintenance/secret/log alerts; dedupe.
- **`notification-service.js`** — System-alert row + category-routed email;
  explicit-recipients union and HTML-escaped body. Callers must establish the
  trusted ambient Dataverse context; the service no longer creates a hidden
  bypass around its Dynamics email transport.
- **`maintenance-service.js`** — Cleanup operations; audit trail; Dataverse-configured retention.

### Other

- **`irs-bmf-service.js`** — IRS Business Master File 501(c)(3) lookup for EIN verification. Used by `/api/irs/verify-ein` (PowerAutomate-callable via `IRS_VERIFY_SECRET`).
- **`dataverse-export/`** (subdirectory) — Dataverse Bulk Export (Track B) services. Deterministic QuerySpec→FetchXML translation, paging, trust-bounded Excel emission. See `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md`.

---

## `lib/external/` — external-reviewer flow

- **`token-lifecycle.js`** — `mintAndStore` / `revoke` / `ensureToken` (idempotent) / `extendForPostSubmissionWindow` / `buildExternalUrl`.
- **`verify-suggestion-token.js`** — Combined JWT + suggestion-row check; discriminated result with reason codes.
- **`reviewer-materials.js`** — Enforces the exact reviewer-visible SharePoint contract at list + download: `Reviewer Materials/Proposal_{Request#}.pdf`. The folder is matched case-insensitively; the request-bound filename is exact. Neighboring files, including timestamped raw application exports, remain invisible.
- **`review-form-schema.js`** — static seed/shape source for affiliation plus the staged 11-question form: 2 core picklist ratings, the `impactAreas` multiselect, and 8 rich-text narratives. Only affiliation is parent-column-bound; structured and narrative answers map to `wmkf_appreviewanswer`. `validateReviewForm` supports partial legacy upload validation and delegates multiselect normalization to the canonicalizer.
- **`review-multiselect.js`** — authoritative pure canonicalizer for multiselect request values. Accepts numeric values only, rejects unknowns, deduplicates and orders by live options, constructs server-owned `{value,label}` pairs, and derives joined snapshot text.
- **`review-multipart-fields.js`** — strict Busboy field accumulator for review upload routes. Preserves scalar fields and repeated `field[]` values while rejecting ambiguous mixed scalar/array encodings before review validation.
- **`policy-fetcher.js`** — Policy-document fetcher with `bypassDynamicsRestrictions` wrapper.

---

## `lib/bill/` — BILL.com integration (S188+ slice)

- **`index.js`** — Public API: `createBillVendor`, `searchBillNetwork` (name + zip per BILL constraint, NOT email), `sendNetworkInvitation`, `verifyBillWebhook`. See `docs/BILL_LIB_DESIGN.md` + `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.
- **`session.js`** — Module-level session cache with cold-start serialization + failed-promise clearing. 30-min TTL ceiling under BILL's 35-min inactivity timeout.
- **`classify.js`** — BDC error classification (BDC_1144 hourly = fail-loud, BDC_1322 concurrent = retry, BDC_1109 session-expired = internal reauth-and-retry).
- **`errors.js`** — `BillError` + public subclasses (`BillAuthError` / `BillRateLimitError` / `BillValidationError` / `BillServerError`) + internal `BillSessionError`.
- **`redact.js`** — devKey / password / sessionId / JWT / base64 token sweep.

---

## `lib/utils/`

### Auth / cron

- **`auth-policy.js`** — proxy-bundle-safe `isAuthRequired()` shared between `proxy.js` (Node.js runtime in Next 16) and `lib/utils/auth.js`. Reads only `process.env`, no Node-only / `@vercel/postgres` / `next-auth` imports. **`NODE_ENV=production` fails closed** unless `EMERGENCY_AUTH_BYPASS=true`; the predicate is not a Vercel environment-name check and applies to production-mode Preview and Production runtimes. Misconfig warnings memoized once per process.
- **`cron-auth.js`** — Vercel cron `CRON_SECRET` verification (Bearer header). Dev-mode bypass.

### Health / files

- **`health-checker.js`** — Reusable health-check logic spanning all currently-monitored upstream services (incl. Microsoft Graph). Source file is the live list.
- **`file-loader.js`** — Shared FileRef loader (upload/SharePoint → PDF/DOCX text) used by Grant Reporting and Phase I Dynamics.
- **`sharepoint-buckets.js`** — `getRequestSharePointBuckets(requestId, requestNumber)` — walks active + archive libraries for a request.
- **`cycle-code.js`** — Grant cycle code helpers (`Jxx`/`Dxx` from June/December meeting dates). Helpers: `meetingDateToCycleCode`, `parseCycleCode`, `cycleCodeToOdataFilter`.

### Upload validation

- **`file-magic.js`** — Magic-byte sniffing + extension/MIME validation. `validateReviewFile` (PDF/DOCX/DOC) for reviewer uploads; `validateIntakeAttachment` (PDF/DOCX/XLSX, parameterized per field `accept[]`) for the intake-portal three-call dance. **Shape only, not malware**: app-side Cloudmersive is primary defense — tenant has no MDO/Safe Attachments.
- **`blob-filename.js`** — `sanitizeBlobFilename` for intake-portal applicant-supplied filenames. NFKC normalize, reject `..` segments (incl. fullwidth), strip control + path separators, 200-codepoint cap.
- **`intake-blob.js`** — `getIntakeBlobToken()` reads `INTAKE_BLOB_RW_TOKEN` (**NOT** the shared `BLOB_READ_WRITE_TOKEN`). Single source of truth for the four intake Blob call sites; fail-loud on missing/whitespace.

### Form schema

- **`form-schema.js`** — Intake-portal form schema loader. Static import map (`SCHEMAS[formKey]`); `findFileField` walker; `countFieldEntries` cardinality helper.

### Collections

- **`chunk.js`** — Canonical array-chunk helper: `chunk(array, size)` → in-order sub-arrays of ≤ size. Fail-closed: non-array → `TypeError`, non-positive-integer size → `RangeError`; `[]` → `[]`; input never mutated. Import under the alias `chunked` at call sites (per-iteration variables are commonly named `chunk`). **Use this — not a hand-rolled `for (i += N) slice` loop** (consolidated S331-332, `docs/CHUNK_CONSOLIDATION_PLAN.md`).
- **`reviewer-save-key.js`** — Shared browser/server partial-save correlation key; explicit client ids win, otherwise normalized submitted anchors distinguish same-name rows. Never use it for person merging.
- **`reviewer-identity-fields.js`** — Literal seven-field authority for resolver-sourced reviewer identity values that require durable lineage; shared by the legacy resolver and Wave 13 binding contract.
- **`reviewer-manual-confirmation.js`** — Canonical name/contact projection and exact matcher for request-scoped staff identity confirmation records.
- **`reviewer-vetted-email.js`** — Canonical pure reviewer contact projection
  shared by attestation mint/save, Find selectability, applicant backfill, and
  legacy reconciliation. Produces `ready`,
  `needs_identity_confirmation`, or `missing_email` with exact
  email/source/persistence authority; `pickVettedEmail` is its compatibility
  wrapper.

### Secrets

- **`tracked-secrets.js`** — Canonical `TRACKED_SECRETS` list for rotation/expiration alerting. Consumed by `pages/api/cron/secret-check.js` + `pages/api/admin/secrets.js`. **`docs/CREDENTIALS_RUNBOOK.md` mirrors this list by hand — this file is the canonical source.**

---

## Maintenance contract

- New service / utility files: add a one-line entry here in the same commit.
- Renaming or removing a service: edit / remove the line here in the same commit.
- A "load-bearing fact" (storage SoT, fail-loud behavior, env-var separation, auth boundary, drain posture, migration history) must live in the **source-file header**, not just here. This catalog is an index; the source header is the contract.
- This catalog is NOT auto-generated. Manual edits only.
