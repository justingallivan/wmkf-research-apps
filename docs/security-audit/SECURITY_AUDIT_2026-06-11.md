# Security Audit - 2026-06-11

## Scope

This audit used `docs/security-audit/SECURITY_AUDIT_RUNBOOK.md` as the checklist and re-checked the current security posture against the May 2026 audit shape. It focused on:

- API route authorization inventory and guard warnings.
- Atlas/fact consistency gates.
- Dependency advisories.
- Generic Blob upload residuals.
- AI/model transport, payload-boundary, and raw-output retention paths.
- External reviewer token rate limiting.
- BILL webhook/internal HMAC routes.
- Previously open May 2026 audit findings where current source could confirm closure or residual risk.

Out of scope:

- Live Vercel/Dataverse/SharePoint permission probing.
- Full browser smoke testing.
- Full semantic review of all 108 API routes.
- Code remediation; this report records findings and validation evidence only.

## Automated Checks

Commands run:

```bash
npm run check:api-routes
npm run check:atlas
npm run check:atlas:self-test
npm run check:fact-consistency
npm audit --audit-level=high
semgrep --config=.semgrep/token-audit.yaml --exclude=node_modules --exclude=.next lib/ pages/
env SEMGREP_SEND_METRICS=off semgrep --config=.semgrep/token-audit.yaml --exclude=node_modules --exclude=.next lib/ pages/
npx jest tests/unit/external-rate-limit.test.js --runInBand
npx jest tests/unit/webhook-bill.test.js tests/unit/bill-onboard-reviewer.test.js --runInBand
npx jest tests/unit/execute-prompt-payload-boundary.test.js tests/unit/execute-prompt-multi-output.test.js tests/unit/execute-prompt-impersonation.test.js --runInBand
```

Results:

- `npm run check:api-routes` passed and covered 108 route files. It warned on two routes without recognized guard tokens: `/api/bill/onboard-reviewer` and `/api/webhooks/bill`.
- `npm run check:atlas` passed: 34 Postgres tables and 32 Dataverse entity sets covered.
- `npm run check:atlas:self-test` passed: 12/12 coverage patterns detected.
- `npm run check:fact-consistency` passed: 343 live doc/memory files scanned; canonical facts current (`app-definition-count=18`, `requireappaccess-endpoint-count=60`, `api-route-file-count=108`).
- `npm audit --audit-level=high` required network access, then passed with no high-severity failures but reported 5 moderate vulnerabilities: `postcss <8.5.10` through `next`, and `uuid <11.1.1` through `exceljs` and `next-auth`. (Re-confirmed exactly on 2026-06-11 primary dev machine: `{moderate:5, high:0, critical:0}`.)
- `semgrep` was installed but did not execute in the original run. Both normal and metrics-disabled runs failed before scanning with `Failed to create system store X509 authenticator: ca-certs: empty trust anchors`. **This blocker was environment-specific** — Semgrep 1.165.0 ran cleanly when re-run on the primary dev machine (see Addendum); results are recorded there.
- `gitleaks` and `trivy` were not installed locally (still uninstalled on the primary dev machine).
- Focused Jest passed:
  - `tests/unit/external-rate-limit.test.js`: 18/18.
  - `tests/unit/webhook-bill.test.js` + `tests/unit/bill-onboard-reviewer.test.js`: 52/52.
  - `tests/unit/execute-prompt-payload-boundary.test.js` + `tests/unit/execute-prompt-multi-output.test.js` + `tests/unit/execute-prompt-impersonation.test.js`: 21/21.

## Findings

### P2 - Generic uploader still creates public Blob artifacts for sensitive document workflows

Status: VERIFIED

Evidence:

- `shared/components/FileUploaderSimple.js:49`-`52` calls `upload(file.name, file, { access: 'public', handleUploadUrl: '/api/upload-handler' })`.
- `pages/api/upload-handler.js:10`-`12` requires authentication before minting upload tokens, and `pages/api/upload-handler.js:18`-`37` validates content type and max size, but it does not make the upload record-scoped or private.
- `docs/API_ROUTE_SECURITY_MATRIX.md:143` records `/api/upload-handler` as authenticated, medium risk, and notes that blobs are public.
- `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md:8`-`12` describes the residual: uploaded URLs are auth-free once known and can leak through logs, history, referrers, or persisted app state.
- `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md:14`-`23` lists 15+ document-processing consumers, including sensitive grant and reviewer workflows.

Risk category:

- OWASP A01 Broken Access Control.
- OWASP A05 Security Misconfiguration.
- Sensitive document exposure by bearer URL leakage.

Recommendation:

- Continue treating `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md` as the implementation plan.
- Build a private-blob upload mode plus authenticated, preferably record-scoped, download proxy.
- Migrate one low-risk consumer first, then roll through the shared uploader consumers.

Validation:

- `rg -n "access: 'public'|access:\\s*\\\"public\\\"|upload-handler|FileUploaderSimple" pages lib shared docs`.
- New route tests proving private blob retrieval requires auth/app access and rejects unauthorized records.
- Consumer smoke test proving stored blob paths render through the proxy rather than raw public Blob URLs.

### P2 - Shared Executor still calls Claude with raw `fetch` instead of the canonical `LLMClient`

Status: VERIFIED → ✅ RESOLVED 2026-06-11 (remediation Phase 2). `callClaude()` (`execute-prompt.js`) now calls `LLMClient.complete()` and re-shapes the normalized response back to the raw Anthropic shape the Executor consumes; the `cache_control` system array is preserved verbatim. 23 Executor tests pass (incl. 2 new regression pins on cache_control + cache-hit); build + lint clean. `EXECUTOR_CONTRACT.md` step 6 + `AI_DATA_FLOW_MATRIX.md` row updated. Design: `docs/security-audit/PHASE_2_EXECUTOR_TRANSPORT_DESIGN_2026-06-11.md`.

Evidence:

- `lib/services/llm-client.js:1`-`20` defines `LLMClient` as the canonical Anthropic wrapper and lists the protections it adds: `safeFetch`, abortable timeout, 429/529 retry/fallback, usage logging, and error redaction.
- `lib/services/execute-prompt.js:402`-`441` implements `callClaude()` with raw `fetch(BASE_CONFIG.CLAUDE.API_URL, ...)`.
- `docs/EXECUTOR_CONTRACT.md:13`-`20` describes the Executor as the shared contract between Vercel and PowerAutomate prompt execution.
- `docs/EXECUTOR_CONTRACT.md:71`-`73` states the Executor should write a `wmkf_ai_run` row even on failure.
- `docs/AI_DATA_FLOW_MATRIX.md:128`-`129` marks `/api/phase-i-dynamics/summarize-v2` and `lib/services/execute-prompt.js` as high-risk, shared AI/data-flow surfaces.

Risk category:

- OWASP LLM05 Supply Chain Vulnerabilities.
- OWASP LLM06 Sensitive Information Disclosure.
- OWASP A09 Security Logging and Monitoring Failures.

Reasoning:

The current Executor has strong payload-boundary and retention tests, but the transport path bypasses the wrapper that the repo documents as canonical for app-side Claude calls. Because the Executor is intended to be a shared prompt invocation surface, transport inconsistency is higher leverage than a one-off route.

Recommendation:

- Migrate `callClaude()` to `LLMClient` or extend `LLMClient` so it can preserve the Executor's system-array cache-control payload semantics.
- Preserve current output parsing, `usage`, cache-hit metadata, and failure/audit behavior.
- Add a regression test proving Executor Claude calls go through the canonical wrapper or `safeFetch` while preserving cache-control.

Validation:

- `rg -n "BASE_CONFIG\\.CLAUDE\\.API_URL|fetch\\('https://api\\.anthropic|fetch\\(\\\"https://api\\.anthropic" lib pages shared modules`.
- Existing Executor tests plus a new transport test.

### P3 - AI data-flow matrix is stale for contact enrichment's Anthropic transport

Status: CONFLICT

Evidence:

- `docs/AI_DATA_FLOW_MATRIX.md:87`-`93` says `ContactEnrichmentService.claudeWebSearch` still uses direct `fetch`.
- `docs/AI_DATA_FLOW_MATRIX.md:117` and `docs/AI_DATA_FLOW_MATRIX.md:138` repeat the direct-fetch note for contact enrichment.
- `lib/services/contact-enrichment-service.js:1077`-`1094` now routes the call through `LLMClient`, preserving the web-search tool via `complete()`'s `tools` passthrough.

Risk category:

- Security inventory drift.
- Reviewers may chase a remediated risk while missing current ones.

Recommendation:

- Update `docs/AI_DATA_FLOW_MATRIX.md` contact-enrichment rows to reflect `LLMClient`, untrusted-content wrapping, and the remaining real risk: candidate identity/contact data leaves the app through Claude web search.

Validation:

- Re-run `npm run check:fact-consistency` after the doc update.
- Add a targeted grep in the doc update review for stale `ContactEnrichmentService.claudeWebSearch` direct-fetch wording.

### P3 - API route guard gate warns on intentionally HMAC-protected BILL routes

Status: VERIFIED → ✅ RESOLVED 2026-06-11 (remediation Phase 4). `check-api-route-security-matrix.js` now recognizes `verifyInternalCall`/`verifyBillWebhook` as guards when the route's matrix row documents a shared-secret/HMAC boundary; both BILL routes no longer warn, truly unguarded routes still do. Added `check:api-routes:self-test` (5 fixtures + missing-route hard-fail).

Evidence:

- `scripts/check-api-route-security-matrix.js:10`-`19` recognizes shared auth/helper tokens but not HMAC helpers such as `verifyInternalCall` or `verifyBillWebhook`.
- `scripts/check-api-route-security-matrix.js:80`-`86` emits warnings rather than failures for routes without recognized guard tokens.
- `pages/api/bill/onboard-reviewer.js:31`-`40` fails closed on missing/short `BILL_INTEGRATION_SECRET` outside development.
- `pages/api/bill/onboard-reviewer.js:55`-`61` verifies `verifyInternalCall()` before processing.
- `lib/bill/internal-call-auth.js:58`-`96` checks secret presence/length, required headers, timestamp skew, and HMAC signature.
- `pages/api/webhooks/bill.js:45`-`52` fails closed on missing `BILL_WEBHOOK_SECRET` outside development.
- `pages/api/webhooks/bill.js:66`-`72` verifies `x-bill-sha-signature` with `verifyBillWebhook()`.
- `docs/API_ROUTE_SECURITY_MATRIX.md:147`-`148` documents both routes as shared-secret/HMAC protected.
- Focused tests passed: 52 BILL HMAC/onboarding/webhook tests.

Risk category:

- Gate false-positive / warning fatigue.

Recommendation:

- Teach `check-api-route-security-matrix.js` to recognize explicit HMAC guard helpers or add a narrow route allowlist with self-test fixtures.
- Keep warnings if the route is absent from the matrix or lacks a documented shared-secret boundary.

Validation:

- Add a fixture route with HMAC guard token that passes.
- Add a fixture route with no guard and no explicit `None` matrix row that still warns/fails as intended.

### P3 - Local scanner lane is blocked by Semgrep CA trust-store failure

Status: PARTIALLY RETRACTED — the Semgrep blocker was environment-specific (see Addendum). `gitleaks`/`trivy` still uninstalled.

Evidence (original audit run):

- `semgrep --config=.semgrep/token-audit.yaml --exclude=node_modules --exclude=.next lib/ pages/` failed before scanning with `Failed to create system store X509 authenticator: ca-certs: empty trust anchors`.
- Retrying with `SEMGREP_SEND_METRICS=off` produced the same failure.
- `gitleaks` and `trivy` are not installed locally.
- Prior checked-in scanner precedent exists at `docs/security-audit/SEMGREP_AUDIT_REPORT.md`, but this audit did not refresh those scan results.

Correction (2026-06-11, primary dev machine — see Addendum below):

- Semgrep 1.165.0 executes cleanly here; the CA trust-anchor failure did NOT reproduce. The blocker is machine/environment-specific, not a repo defect.
- `gitleaks` and `trivy` remain uninstalled on this machine — that part stands.

Risk category:

- Local verification gap (now narrowed to the originating machine's Semgrep install + missing gitleaks/trivy).

Recommendation:

- Fix Semgrep CA/trust-store setup on the machine that failed, or run scanners in CI/devcontainer where trust anchors are present.
- Install or rely on CI for `gitleaks` and `trivy`.
- Do not mark scanner lanes green until actual current scans execute (now satisfied for Semgrep on this machine — see Addendum).

Validation:

- Current successful Semgrep, Gitleaks, and Trivy outputs, or linked CI run artifacts.

### P3 - Semgrep OWASP/js/node ruleset surfaces 5 unreviewed hardening findings

Status: VERIFIED via Semgrep `p/javascript`+`p/nodejs`+`p/owasp-top-ten` (Addendum re-run) → ✅ ALL 5 RESOLVED 2026-06-11 (Phase 7). OWASP re-scan returns 0 findings on the five files.

These were not visible in the original audit because Semgrep did not execute there. Triaged live against source (each `setAuthTag`/disposition/validation path read):

- **ERROR — `lib/utils/encryption.js:90`** `createDecipheriv` GCM without `authTagLength`. Mitigated: `setAuthTag()` is called (`:91`) and the tag is sliced at a fixed `AUTH_TAG_LENGTH` offset (`:87`), so caller cannot truncate it. **Low**. ✅ **RESOLVED** — threaded `{ authTagLength: AUTH_TAG_LENGTH }` into `createCipheriv` + `createDecipheriv` (defense-in-depth).
- **ERROR — `shared/utils/apiKeyManager.js:58`** `createDecipheriv` GCM without `authTagLength`. `setAuthTag()` called (`:64`) but the tag is client-supplied hex (`Buffer.from(authTag,'hex')`), so its byte length is not enforced. **Low-moderate** (client-encrypted API-key path; client attacking its own stored data). ✅ **RESOLVED 2026-06-11** — pinned `AUTH_TAG_LENGTH = 16` via `authTagLength` on both `createCipheriv`/`createDecipheriv` and a reject-if-not-16-bytes guard before `setAuthTag`; regression tests added (truncated + oversized tag). Semgrep re-scan: file clean.
- **WARNING — `pages/api/blob-proxy.js:78`** forwards upstream `Content-Type` verbatim (`:69`) then `res.send(buffer)`. A blob stored as `text/html` could render inline under the app origin → reflected/stored XSS surface. Auth-gated, `private` cache. **Low-moderate**. ✅ **RESOLVED** — `X-Content-Type-Options: nosniff` always + forced `attachment` disposition for inline-renderable types (html/svg/xml); `res.send` annotated `nosemgrep` (binary proxy, accepted residual).
- **WARNING — `pages/api/dynamics-explorer/download-document.js:86`** `res.send(buffer)` but with `Content-Disposition: attachment` (`:82`, forces download not inline), SharePoint-derived mimeType, and upstream folder/request-GUID validation (`:60`-`72`). **Low / near-false-positive.** ✅ **RESOLVED** — added `X-Content-Type-Options: nosniff`; `res.send` annotated `nosemgrep` (accepted residual).
- **WARNING — `shared/components/admin/PoliciesSection.js:138`** `dangerouslySetInnerHTML` on `renderPolicyMarkdown(slot.activeVersion.body)`. Admin-only component, admin-authored content. **Low / false-positive** — `renderPolicyMarkdown` (`shared/utils/policy-markdown.js:83`) already sanitizes via a strict DOMPurify allowlist and the server validator rejects raw HTML. ✅ **RESOLVED** — both sites (`:138`,`:269`) annotated `nosemgrep` with rationale.

Risk category:

- OWASP A03 Injection (XSS class) for the response-write / `dangerouslySetInnerHTML` warnings.
- OWASP A02 Cryptographic Failures (GCM tag-length hardening).

Recommendation:

- ✅ Done as a single low-priority hardening pass (remediation plan Phase 7, 2026-06-11). All 5 cleared; OWASP re-scan 0 findings on the five files.
- Real hardening: GCM `authTagLength` (×2), `nosniff` + forced-download on the two binary proxies. False positive: `PoliciesSection` (already DOMPurify-sanitized). Two binary `res.send` sites annotated as accepted residuals.

Validation:

- `semgrep --config=p/javascript --config=p/nodejs --config=p/owasp-top-ten --exclude=node_modules --exclude=.next --exclude=docs lib/ pages/ shared/` returns 0 findings after fixes (or documented accepted residuals).

### P3 - Moderate dependency advisories remain

Status: VERIFIED via `npm audit --audit-level=high`

Evidence:

- `npm audit --audit-level=high` reported 5 moderate vulnerabilities and exited successfully.
- Advisory set:
  - `postcss <8.5.10` via `next`.
  - `uuid <11.1.1` via `exceljs` and `next-auth`.
- `package.json` currently has `next: ^16.2.9`, `next-auth: ^4.24.14`, and `exceljs: ^4.4.0`.

Risk category:

- OWASP A06 Vulnerable and Outdated Components.

Recommendation:

- Plan dependency updates deliberately rather than using `npm audit fix --force`, which proposed breaking/downgrade-like changes.
- Prioritize `next`, `next-auth`, and `exceljs` update review in the next dependency-maintenance pass.

Validation:

- `npm audit --audit-level=high` returns zero advisories or only accepted documented residuals.
- Focused auth/file-processing smoke after dependency updates.

## Prior May Findings Rechecked

- `requireAuthWithProfile()` DB revocation-check failure is now fail-closed: `lib/utils/auth.js:191`-`204` returns 503 on DB error. `requireAppAccess()` also checks `is_active` fresh and fails closed on status/role query errors at `lib/utils/auth.js:286`-`305`.
- External reviewer token routes now have rate limiting documented in `docs/API_ROUTE_SECURITY_MATRIX.md:98`-`101`, implemented through `lib/external/rate-limit.js`, and covered by 18 passing unit tests.
- `/api/phase-i-dynamics/summarize` now uses `LLMClient` at `pages/api/phase-i-dynamics/summarize.js:126`-`144` and logs successful summaries with `rawOutputRetention: 'hash'` at `pages/api/phase-i-dynamics/summarize.js:194`-`209`.
- Grant Reporting intentionally keeps full raw output because the audit row is currently the only durable copy: `pages/api/grant-reporting/extract.js:576`-`587`. This remains a watch item if a save-to-Dynamics path is added.

## Strong Controls Observed

- API route matrix coverage is current for 108 route files.
- Atlas and fact-consistency gates passed.
- External reviewer token rate limiting has explicit per-token/per-IP behavior, invalid-token spike alerting, degraded-limiter alerting, and focused tests.
- BILL webhook/internal routes use raw-body HMAC verification, fail closed on missing production secrets, cap body size, and have focused tests.
- Executor payload-boundary, output validation, raw-output retention, and acting-user threading are covered by focused tests.
- Contact enrichment now wraps untrusted candidate identity content and routes through `LLMClient`.
- Phase I Dynamics summarize uses `LLMClient`, optimistic writeback, and hash retention for successful summaries.

## Recommended Next Steps

1. Keep the private Blob migration as the top open security initiative for sensitive document exposure.
2. ✅ Done 2026-06-11 (Phase 2) — Executor Claude transport migrated to `LLMClient.complete()`; cache-control semantics preserved and regression-pinned.
3. Update `docs/AI_DATA_FLOW_MATRIX.md` for contact enrichment's current transport and current residual risk.
4. Add HMAC-aware recognition or fixtures to `check-api-route-security-matrix.js` to avoid recurring false-positive warnings.
5. Fix Semgrep CA/tooling on the machine that failed (it works on the primary dev machine — see Addendum) and install `gitleaks`/`trivy`, or rely on CI scanner artifacts for the scanner lane.
6. Review moderate dependency advisories in a dependency-maintenance pass; do not run `npm audit fix --force` blindly.
7. ✅ Done 2026-06-11 — all 5 Semgrep OWASP/js/node hardening findings (Addendum) cleared in a single Phase 7 pass; OWASP re-scan returns 0 findings on the five files.

## Addendum - 2026-06-11 scanner re-run (primary dev machine)

The original audit ran where Semgrep was blocked by a CA trust-store failure. Re-run on the primary dev machine (Semgrep 1.165.0); network/registry reachable:

| Command | Result |
|---|---|
| `semgrep --config=.semgrep/token-audit.yaml … lib/ pages/` | ✅ 9 rules, 283 files, **0 findings** |
| `semgrep --config=p/secrets … .` | ✅ 43 rules, 917 files, **0 findings** |
| `semgrep --config=p/javascript --config=p/nodejs --config=p/owasp-top-ten … lib/ pages/ shared/` | ⚠️ **5 findings** (2 ERROR, 3 WARNING) |
| `npm audit --audit-level=high` | 5 moderate, 0 high/critical (matches original) |
| `gitleaks` / `trivy` | not installed — not run |

Not entirely new: the checked-in `docs/security-audit/general-security-results.json` (Semgrep 1.154.0, 2026-05-22) already recorded 3 of these 5 — both GCM `gcm-no-tag-length` sites and the `blob-proxy.js` direct-response-write. The `p/owasp-top-ten` ruleset added the `download-document.js` direct-response-write and the `PoliciesSection.js` `dangerouslySetInnerHTML`. They were latent because the June audit did not re-run Semgrep.

The 5 OWASP-ruleset findings are detailed in the finding "Semgrep OWASP/js/node ruleset surfaces 5 unreviewed hardening findings" above and tracked as Phase 7 in the remediation plan. None is a release blocker; all triaged Low / Low-moderate with mitigating controls already present (`setAuthTag` called at both GCM sites; `attachment` disposition on the document download; admin-only policy editor).
