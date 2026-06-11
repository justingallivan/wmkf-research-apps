# Security Audit Remediation Plan - 2026-06-11

## Purpose

This plan corrects the deficiencies recorded in `docs/security-audit/SECURITY_AUDIT_2026-06-11.md`. It is a remediation plan, not a claim that the fixes are already implemented.

## Source Findings

| Finding | Source | Status |
|---|---|---|
| Generic uploader creates public Blob artifacts for sensitive document workflows | `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P2 | Open |
| Shared Executor calls Claude with raw `fetch` instead of canonical `LLMClient` | `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P2 | Open |
| `AI_DATA_FLOW_MATRIX.md` is stale for contact enrichment transport | `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P3 | Open |
| API route guard gate warns on intentionally HMAC-protected BILL routes | `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P3 | Open |
| Local scanner lane is blocked by Semgrep CA trust-store failure; `gitleaks`/`trivy` unavailable locally | `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P3 | Open |
| Moderate dependency advisories remain | `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P3 | Open |

## Remediation Invariants

| Invariant | Files likely touched | Verification |
|---|---|---|
| Sensitive document uploads no longer depend on public bearer Blob URLs for new uploads | `pages/api/upload-handler.js`, `shared/components/FileUploaderSimple.js`, new Blob proxy route, one pilot consumer | Unit/integration tests for private upload token + authenticated download proxy; pilot browser smoke |
| Existing public Blob consumers continue working during migration | shared uploader, pilot app, API routes that read Blob URLs | Back-compat tests for existing `blob.url` inputs; migration flag defaults documented |
| Executor keeps cache-control, usage, cache-hit, failure audit, output parsing, and `rawOutputRetention` semantics while using canonical transport protections | `lib/services/execute-prompt.js`, possibly `lib/services/llm-client.js`, Executor tests | Existing Executor tests plus a new transport/cache-control regression test |
| Security docs describe current code, not old findings | `docs/AI_DATA_FLOW_MATRIX.md`, possibly `docs/SECURITY_OPERATING_PLAN.md` | `npm run check:fact-consistency`; targeted stale-wording grep |
| API route guard gate distinguishes documented HMAC routes from truly unguarded routes | `scripts/check-api-route-security-matrix.js`, route-matrix self-test fixtures if present/added | `npm run check:api-routes`; gate self-test or fixture command |
| Scanner lane is either executable locally or explicitly delegated to CI artifacts | local tooling/docs only unless CI changed | Successful Semgrep/Gitleaks/Trivy run, or linked CI evidence in next audit |
| Dependency remediation avoids `npm audit fix --force` downgrades/breaking churn | `package.json`, `package-lock.json`, focused tests | `npm audit --audit-level=high`; route/auth/file-processing focused tests |

## Phase 1 - Private Blob Proof Slice

Goal: close the highest-risk data exposure path without touching all 15+ consumers in one change.

Implementation steps:

1. Add a private-blob mode behind an explicit feature flag or component prop.
2. Update `/api/upload-handler` so the private mode mints tokens for private blobs and records enough metadata for authenticated retrieval.
3. Add an authenticated download proxy for private Blob reads.
4. Choose `expense-reporter` as the first pilot unless a lower-risk consumer is preferred at implementation time.
5. Update the pilot consumer to store and pass a stable Blob pathname/proxy URL instead of relying only on a public `blob.url`.
6. Preserve legacy public URL read compatibility during the pilot so existing saved/public URLs do not break.
7. Update `docs/API_ROUTE_SECURITY_MATRIX.md` if a new proxy route is added.
8. Update `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md` with pilot status and the remaining rollout list.

Contract checks:

- Caller: pilot uploader UI and any API route that consumes the uploaded file.
- Request payload: upload-token request and proxy download request.
- Route auth/validation: upload token requires auth; proxy requires auth/app access.
- Persistence: any stored blob reference must be path/proxy-compatible.
- Consumer: pilot page can upload, process, and re-render/download the file.
- Docs/gates: API route matrix updated; route gate passes.

Validation:

```bash
npm run check:api-routes
npm run check:fact-consistency
rg -n "access: 'public'|access:\\s*\\\"public\\\"|upload-handler|FileUploaderSimple" pages lib shared docs
```

Add focused tests before broad rollout:

- Private upload-token request returns private-mode metadata.
- Proxy rejects unauthenticated requests.
- Proxy rejects a caller without the relevant app/record scope once record-scoped authorization is available.
- Pilot consumer can still process a legacy public URL.

Phase completion criteria:

- One pilot app uses private Blob upload/read end to end.
- No existing shared uploader consumer is broken.
- Remaining public consumers are listed explicitly for later phases.

## Phase 2 - Executor Transport Convergence

Goal: move the shared Executor off raw Anthropic `fetch` while preserving the exact Executor contract.

Implementation steps:

1. Decide whether `LLMClient.complete()` should support system content arrays with `cache_control`, or whether the Executor should use a narrow `safeFetch` wrapper as an intermediate step.
2. Prefer extending `LLMClient` if it can preserve the existing request shape without weakening its normalized response contract.
3. Update `callClaude()` in `lib/services/execute-prompt.js`.
4. Preserve:
   - prompt-row model resolution;
   - max-token and temperature behavior;
   - system-array `cache_control`;
   - `usage` object access;
   - cache-hit detection;
   - failure audit row behavior;
   - `rawOutputRetention` behavior.
5. Add a regression test proving the Executor transport uses `LLMClient` or `safeFetch` and still sends the expected cache-control payload.

Contract checks:

- Caller: `/api/phase-i-dynamics/summarize-v2` and any direct `executePrompt()` tests/scripts.
- Service/helper: `executePrompt()` and `LLMClient`.
- Persistence: `wmkf_ai_run` rows still written on success/failure; output writes still coalesced.
- Consumers: summarize-v2 UI still receives the same result shape.
- Docs/tests/gates: `docs/EXECUTOR_CONTRACT.md` updated if the implementation detail changes.

Validation:

```bash
npx jest tests/unit/execute-prompt-payload-boundary.test.js tests/unit/execute-prompt-multi-output.test.js tests/unit/execute-prompt-impersonation.test.js --runInBand
rg -n "BASE_CONFIG\\.CLAUDE\\.API_URL|fetch\\('https://api\\.anthropic|fetch\\(\\\"https://api\\.anthropic" lib pages shared modules
```

Phase completion criteria:

- Executor no longer has an unreviewed raw Claude transport path.
- Existing Executor tests remain green.
- New transport regression test pins cache-control semantics.

## Phase 3 - Documentation Reconcile

Goal: remove stale security inventory claims that now contradict source.

Implementation steps:

1. Update `docs/AI_DATA_FLOW_MATRIX.md` rows for contact enrichment:
   - replace the direct-fetch statement with the current `LLMClient` transport;
   - mention untrusted candidate wrapping;
   - keep the real residual risk: candidate identity/contact data goes to Claude web search.
2. Check surrounding summary language so it does not still list contact enrichment as a direct-fetch production path.
3. If Phase 2 lands first, also update Executor transport language in `docs/AI_DATA_FLOW_MATRIX.md` and `docs/EXECUTOR_CONTRACT.md`.

Validation:

```bash
rg -n "ContactEnrichmentService\\.claudeWebSearch|direct fetch|Direct `fetch`|raw `fetch`" docs/AI_DATA_FLOW_MATRIX.md docs/EXECUTOR_CONTRACT.md
npm run check:fact-consistency
```

Phase completion criteria:

- AI matrix no longer contradicts contact-enrichment source.
- Any changed canonical counts/facts still pass fact consistency.

## Phase 4 - HMAC Route Gate Hygiene

Goal: make route-gate warnings actionable by teaching the gate about intentionally sessionless HMAC routes.

Implementation steps:

1. Extend `scripts/check-api-route-security-matrix.js` with a small HMAC guard list, likely:
   - `verifyInternalCall`;
   - `verifyBillWebhook`;
   - future explicit HMAC helpers as needed.
2. Keep the existing failure for routes missing from `docs/API_ROUTE_SECURITY_MATRIX.md`.
3. Keep warnings or failures for routes that have neither a known guard nor an explicit `None` matrix row.
4. Add fixtures/self-tests if the route gate has an existing fixture pattern; otherwise create a narrow self-test script or test cases for:
   - HMAC route passes without warning;
   - truly unguarded route still warns/fails;
   - explicit public metadata route with `None` remains allowed only when documented.
5. Update `docs/CI_GATES_REFERENCE.md` if the gate behavior changes materially.

Validation:

```bash
npm run check:api-routes
```

Phase completion criteria:

- `/api/bill/onboard-reviewer` and `/api/webhooks/bill` no longer generate false-positive guard warnings.
- A deliberately unguarded route would still be detected.

## Phase 5 - Scanner Lane Repair

Goal: make scanner evidence refreshable instead of carrying stale prior scan reports.

Implementation options:

1. Local-first:
   - fix Semgrep CA trust-store configuration;
   - install `gitleaks`;
   - install `trivy`;
   - document exact install/run commands if they differ from `SECURITY_AUDIT_RUNBOOK.md`.
2. CI-first:
   - confirm current CI runs Semgrep, Gitleaks, and Trivy;
   - document where to find the artifacts;
   - update the runbook so local audits can cite CI scanner evidence when local tooling is unavailable.

Validation:

```bash
semgrep --config=.semgrep/token-audit.yaml --exclude=node_modules --exclude=.next lib/ pages/
semgrep --config=p/secrets --exclude=node_modules --exclude=.next .
semgrep --config=p/javascript --config=p/nodejs --config=p/owasp-top-ten --exclude=node_modules --exclude=.next lib/ pages/ shared/
gitleaks detect --source .
trivy fs .
```

Phase completion criteria:

- The next security audit can include current scanner results or current CI artifact links.
- Scanner failures are real findings, not local-tooling ambiguity.

## Phase 6 - Dependency Advisory Review

Goal: resolve or explicitly accept the current moderate advisories without forced downgrade/breaking churn.

Implementation steps:

1. Inspect the current dependency graph for:
   - `postcss <8.5.10` through `next`;
   - `uuid <11.1.1` through `exceljs` and `next-auth`.
2. Check whether newer compatible releases of `next`, `next-auth`, or `exceljs` address the advisory chain.
3. Avoid `npm audit fix --force` unless the proposed changes are reviewed and acceptable.
4. Run focused tests around:
   - auth/session flows for `next-auth`;
   - upload/file-processing or export flows for `exceljs`;
   - app build/dev smoke for `next`.

Validation:

```bash
npm audit --audit-level=high
npm run check:api-routes
npm run check:fact-consistency
```

Add focused Jest/browser checks based on the package actually updated.

Phase completion criteria:

- `npm audit --audit-level=high` is clean, or each remaining moderate advisory is explicitly documented with rationale and owner acceptance.

## Recommended Order

1. Phase 3 doc reconcile can land immediately because it is low risk and removes stale audit guidance.
2. Phase 4 gate hygiene can land immediately after or alongside Phase 3.
3. Phase 2 Executor transport convergence should be next because it is a shared high-consequence AI path but bounded to one service and tests.
4. Phase 1 private Blob proof slice should be planned as its own implementation session because it touches UI, API, Blob storage, consumers, and compatibility.
5. Phase 5 scanner repair can happen opportunistically or in CI/tooling time.
6. Phase 6 dependency review should be a separate dependency-maintenance pass, not mixed into feature/security code unless an advisory becomes high severity.

## Stop Conditions

Stop and re-plan if any of these appear:

- Private Blob migration requires changing all consumers at once.
- Executor transport changes break cache-control or `usage`/cache-hit semantics.
- A route-gate change suppresses warnings for routes that are merely undocumented rather than intentionally HMAC/public.
- Dependency updates require a major Next/Auth migration.
- Scanner installation requires broad machine-level changes outside the repo without explicit approval.

## Tracking Checklist

- [ ] Phase 1 private Blob proof slice implemented and verified.
- [ ] Phase 2 Executor transport convergence implemented and verified.
- [ ] Phase 3 AI data-flow matrix reconcile complete.
- [ ] Phase 4 HMAC route gate hygiene complete.
- [ ] Phase 5 scanner lane repair complete or delegated to CI evidence.
- [ ] Phase 6 dependency advisory review complete.
