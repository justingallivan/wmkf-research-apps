# Service & Utility Catalog

One-line lookup index for files under `lib/services/`, `lib/external/`, `lib/bill/`, and `lib/utils/`. **Source-file headers are authoritative** for per-file contracts, safety posture, storage source-of-truth, and migration/drop history — this doc points there, it doesn't replace them.

If you're touching a service or utility, read its header before this catalog. If a header is sparse or stale, fix it in the same commit as your change rather than rely on this doc.

---

## `lib/services/`

### AI / prompt execution

- **`llm-client.js`** — Canonical Anthropic API wrapper (`complete()` + `stream()`). SSRF allowlist, abortable timeouts, 429/529 retry, single fallback-model swap, usage logging, API-key redaction. **Use this — not ad-hoc `fetch`** for new Anthropic API calls.
- **`model-capabilities.js`** — Reviewed Anthropic model capability registry for request shaping (`temperature`, `output_config.effort`) and response semantics (refusals, retention class, max tokens). Unknown runtime ids fail closed for optional params; configured ids are guarded by `check:model-registry`.
- **`model-review-validation.js`** — Shared write-time validator for tier keys and concrete Claude model ids. Admin model overrides and prompt publishes use it to reject unreviewed concrete Claude ids unless both capability and pricing entries exist.
- **`execute-prompt.js`** — Live prompt-execution Executor implementing `docs/EXECUTOR_CONTRACT.md`. Reads current prompt rows from Dataverse entity set `wmkf_ai_prompts`, rejects unreviewed concrete Claude model ids before execution, and writes audit rows to `wmkf_ai_runs`. Used in production by `/api/phase-i-dynamics/summarize-v2`.
- **`prompt-resolver.js`** — Legacy Session 103 holdover. Reads prompts from a scratch row on `wmkf_ai_runs`, 5-min cache, `{{var}}` interpolation, bundled `.js` fallback. `PROMPT_RESOLVER_STRICT=true` disables fallback. Currently used only by scripts; no live API route depends on it.
- **`model-resolver.js`** / **`model-override-loader.js`** — Per-app model overrides for `baseConfig.js`. Resolver computes effective model per app at call time; loader caches DB-backed overrides.
- **`claude-reviewer-service.js`** — Legacy Claude wrapper with retry/fallback (new code uses `llm-client.js`).

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
- **`dataverse-prefs-service.js`** — Dataverse `wmkf_appuserpreferences` adapter. Postgres `user_preferences` was dropped 2026-05-12 (Migrates / Replaced). See header KNOWN HAZARD re: dead Postgres branches in `database-service.js`.
- **`email-signature.js`** — Unified per-user email-signature resolver. Reads the `email_signature` preference from Dataverse user preferences, falls back to legacy reviewer sender info, resolves request-scoped grantee signatures from the assigned Dataverse PD via `dataverse-identity-map`, and appends a Foundation-ending signature block for grantee invite/reminder mail.

### Storage / persistence

- **`database-service.js`** — Vercel Postgres operations; Wave 1 dispatch lives here.
- **`graph-service.js`** — Microsoft Graph (SharePoint files, listing/download, content search).

### Intake portal

- **`intake-draft-service.js`** — CRUD over `intake_drafts`. Drafts are Postgres-only; submission goes via `submission_jobs` drain queue; pending-attachments JSONB ops; 2h sweep. See header for state-machine summary + `docs/INTAKE_PORTAL_DRAIN_PLAN.md`.
- **`intake-audit-service.js`** — Append-only sha256-hashed audit; swallow-on-failure posture.

### Reviewer / honorarium

- **`review-upload.js`** — Shared `writeReviewFiles` core for staff + reviewer-self upload paths; SharePoint write + Dataverse PATCH + rollback.
- **`external-token.js`** — HS256 HMAC JWT primitive for external-reviewer magic links; hash-only storage for cheap revocation. 32+ char `EXTERNAL_LINK_SECRET`; rotation supported via `EXTERNAL_LINK_SECRET_PREVIOUS`.

### Multi-LLM panel (Virtual Review Panel)

- **`multi-llm-service.js`** — Claude / OpenAI / Gemini / Perplexity wrappers with normalized responses + retry/fan-out. Claude request shaping uses `model-capabilities.js`; Fable-style refusal metadata is surfaced in normalized results.
- **`panel-review-service.js`** — VRP pipeline: optional pre-review intelligence → optional claim verification → structured review → synthesis. Persistence in `panel_reviews` / `panel_review_items`. See `docs/VIRTUAL_REVIEW_PANEL.md`.
- **`literature-search-service.js`** — Stage 0 academic search orchestration; normalized results.

### Research-database clients

- **`pubmed-service.js`**, **`openalex-service.js`**, **`arxiv-service.js`**, **`biorxiv-service.js`**, **`chemrxiv-service.js`**, **`orcid-service.js`**, **`serp-contact-service.js`** — external research-DB clients (API shapes, rate limits, and tier positioning in each header).

### Reviewer Finder pipeline

- **`discovery-service.js`** — Multi-database literature search orchestration.
- **`deduplication-service.js`** — Name matching, duplicate merge, COI filtering, ranking.
- **`contact-enrichment-service.js`** — 5-tier contact lookup; header documents Dataverse writeback migration.

### Integrity Screener

- **`integrity-service.js`** — Retraction Watch + PubPeer + News + Haiku summarization.
- **`integrity-matching-service.js`** — Multi-tier name matching + Retraction Watch optimization.

### Admin / monitoring

- **`feedback-service.js`** — `dynamics_feedback` thumbs + auto-detected failures.
- **`alert-service.js`** — `system_alerts` rows; health/maintenance/secret/log alerts; dedupe.
- **`notification-service.js`** — System-alert row + category-routed email; explicit-recipients union (S190); HTML-escaped body; Dynamics email transport wrapped in `bypassDynamicsRestrictions` (S191).
- **`maintenance-service.js`** — Cleanup operations; audit trail; Dataverse-configured retention.

### Other

- **`irs-bmf-service.js`** — IRS Business Master File 501(c)(3) lookup for EIN verification. Used by `/api/irs/verify-ein` (PowerAutomate-callable via `IRS_VERIFY_SECRET`).
- **`dataverse-export/`** (subdirectory) — Dataverse Bulk Export (Track B) services. Deterministic QuerySpec→FetchXML translation, paging, trust-bounded Excel emission. See `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md`.

---

## `lib/external/` — external-reviewer flow

- **`token-lifecycle.js`** — `mintAndStore` / `revoke` / `ensureToken` (idempotent) / `extendForPostSubmissionWindow` / `buildExternalUrl`.
- **`verify-suggestion-token.js`** — Combined JWT + suggestion-row check; discriminated result with reason codes.
- **`reviewer-materials.js`** — Enforces "files outside `Reviewer_Downloads/` are invisible to reviewers" at list + download. Case-insensitive segment matching; env override available.
- **`review-form-schema.js`** — 4 structured fields (affiliation, impact, risk, overallRating); supports `{ partial: true }` validation.
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

- **`auth-policy.js`** — proxy-bundle-safe `isAuthRequired()` shared between `proxy.js` (Node.js runtime in Next 16) and `lib/utils/auth.js`. Reads only `process.env`, no Node-only / `@vercel/postgres` / `next-auth` imports. **Production fails closed** unless `EMERGENCY_AUTH_BYPASS=true`. Misconfig warnings memoized once per process.
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

### Secrets

- **`tracked-secrets.js`** — Canonical `TRACKED_SECRETS` list for rotation/expiration alerting. Consumed by `pages/api/cron/secret-check.js` + `pages/api/admin/secrets.js`. **`docs/CREDENTIALS_RUNBOOK.md` mirrors this list by hand — this file is the canonical source.**

---

## Maintenance contract

- New service / utility files: add a one-line entry here in the same commit.
- Renaming or removing a service: edit / remove the line here in the same commit.
- A "load-bearing fact" (storage SoT, fail-loud behavior, env-var separation, auth boundary, drain posture, migration history) must live in the **source-file header**, not just here. This catalog is an index; the source header is the contract.
- This catalog is NOT auto-generated. Manual edits only.
