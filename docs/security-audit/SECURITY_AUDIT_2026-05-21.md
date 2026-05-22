# Security Audit - 2026-05-21

## Scope

This audit reviewed the codebase security posture against the repo's existing security controls and current OWASP guidance:

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP ASVS 5.0: https://github.com/OWASP/ASVS
- OWASP Top 10 for LLM Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/

Reviewed surfaces included:

- Authentication and middleware: `middleware.js`, `lib/utils/auth.js`, `lib/utils/auth-policy.js`, `pages/api/auth/[...nextauth].js`
- API route authorization inventory: `docs/API_ROUTE_SECURITY_MATRIX.md`
- AI/data minimization: `docs/AI_DATA_FLOW_MATRIX.md`, `lib/utils/ai-payload-boundary.js`, LLM call paths
- File/blob upload and download paths
- External reviewer token routes
- CI/security tooling: CodeQL, Gitleaks, Trivy, Semgrep token rules, Jest/security tests

## Automated Checks

Commands run:

```bash
npm run check:api-routes
npm run check:atlas
npm run check:atlas:self-test
npm run test:ci
npm audit --audit-level=high
```

Results:

- `npm run check:api-routes` passed: API route security matrix covers 85 route files. <!-- fact-consistency:ignore fact=api-route-file-count as-of=2026-05-21 -->
- `npm run check:atlas` passed: Atlas coverage OK for 28 Postgres tables and 29 Dataverse entity sets.
- `npm run check:atlas:self-test` passed: 12/12 coverage patterns detected.
- `npm run test:ci` did not execute tests because local untracked `node_modules.nosync/` caused Jest haste-map package-name collisions. This appears to be a local worktree/environment issue, not an app-code test failure.
- `npm audit --audit-level=high` reported 9 total vulnerabilities: 1 high, 8 moderate.
- Local `gitleaks`, `semgrep`, and `trivy` binaries were not installed in this workspace. CI workflows for all three are present.
- A lightweight local secret-pattern sweep found no obvious real committed secret; matches were examples, tests, docs placeholders, or redaction patterns.

## Findings

### P1 - Upgrade `next` for active high-severity advisories

`npm audit --audit-level=high` reports a high-severity bucket against `next`, including middleware/proxy bypass, cache poisoning, CSP nonce/XSS, image optimization DoS, and SSRF-related advisories.

Evidence:

- `package.json` pins `next` as `^16.1.6`.
- Audit output identifies `next` versions through `16.3.0-canary.5` as affected.

Risk category:

- OWASP A06 Vulnerable and Outdated Components
- OWASP A05 Security Misconfiguration, where middleware/CSP bypasses affect deployed controls

Recommendation:

- Upgrade `next` to a patched release.
- Rerun `npm audit --audit-level=high`.
- Run the full test suite after excluding/removing local `node_modules.nosync/` artifacts.

### P2 - Generic upload endpoints still create public Blob artifacts for any authenticated user

`/api/upload-file` and `/api/upload-handler` are authenticated and enforce content type and size controls, but they are generic upload surfaces rather than app-specific or record-scoped upload flows.

Evidence:

- `pages/api/upload-file.js` calls `requireAuth()`, accepts allowed MIME types, and writes Vercel Blob objects with `access: 'public'`.
- `pages/api/upload-handler.js` calls `requireAuth()` and mints client-upload tokens for any authenticated user with allowed content types and a 50 MB limit.
- `docs/API_ROUTE_SECURITY_MATRIX.md` already marks both routes as Medium risk.

Risk category:

- OWASP A01 Broken Access Control
- OWASP A05 Security Misconfiguration

Recommendation:

- Prefer app-specific upload routes tied to the consuming workflow and access class.
- For sensitive or user-owned content, use private blobs plus record-aware download proxies.
- Keep generic public uploads only for explicitly shared organizational assets.

Remediation status (A5, 2026-05-21):

- **Partially addressed.** The two generic endpoints were consolidated to one: `SettingsModal` migrated off the legacy server-multipart `/api/upload-file` to the `/api/upload-handler` client-token flow, and `/api/upload-file` was retired. This removes the weaker `access: 'public'` server endpoint flagged for removal in `docs/SECURITY_ARCHITECTURE.md`.
- **Open residual.** The surviving `/api/upload-handler` still mints tokens for `access: 'public'` blobs, and the shared `FileUploaderSimple` (used by 15+ document-processing apps — proposals, peer reviews, expense receipts, research papers) uploads them publicly. Grant proposals are not "explicitly shared organizational assets", so the core P2 concern persists. Genuinely closing it requires private blobs + an authenticated record-aware download proxy, with all 15+ consuming apps updated to read through it — a scoped initiative tracked at `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md`.

### P2 - `requireAuthWithProfile()` fails open if disabled-account DB check errors

`requireAuthWithProfile()` checks `user_profiles.is_active`, but allows the request if that database check fails.

Evidence:

- `lib/utils/auth.js` queries `user_profiles.is_active`.
- In the catch block, it logs `Failed to check is_active for profile` and allows the request to continue.

Risk category:

- OWASP A01 Broken Access Control
- ASVS session revocation / account deactivation expectations

Recommendation:

- Decide whether availability or revocation correctness is the priority for this helper.
- For admin, profile-scoped, and write routes, prefer fail-closed behavior when the revocation check cannot be completed.
- If read-only low-risk endpoints need a softer behavior, split the helper or add an explicit low-risk variant.

### P2 - Some production Anthropic paths still bypass the canonical `LLMClient`

Most high-volume model paths use `LLMClient` and `safeFetch`, but some production paths still call Anthropic directly.

Evidence:

- `pages/api/phase-i-dynamics/summarize.js` calls `fetch(BASE_CONFIG.CLAUDE.API_URL)` directly.
- On Claude failure, it logs `err.message` to `wmkf_ai_run` via `tryLogAiRun()` without an explicit `rawOutputRetention` argument in the failure path.
- `docs/AI_DATA_FLOW_MATRIX.md` already notes remaining direct Anthropic fetch paths as a partially addressed P2.

Risk category:

- OWASP A09 Security Logging and Monitoring Failures
- OWASP LLM05 Supply Chain Vulnerabilities
- OWASP LLM06 Sensitive Information Disclosure

Recommendation:

- Migrate remaining production Anthropic callers to `LLMClient` or `safeFetch`.
- Ensure all failure and success audit writes use deliberate `rawOutputRetention` semantics.
- Keep direct fetch only for clearly low-risk health checks, and document the exception.

### P3 - Public external-reviewer token endpoints are well scoped, but not rate-limited

The external reviewer routes have strong authorization design, but they are public token endpoints and would benefit from lightweight abuse controls.

Evidence:

- `lib/services/external-token.js` uses HMAC JWTs with expiry, algorithm pinning, a separate `EXTERNAL_LINK_SECRET`, and SHA-256 token hashing.
- `lib/external/verify-suggestion-token.js` verifies signature, expiry, stored hash, revocation status, and Dataverse row state.
- `pages/api/external/review/[token]/proposal.js` re-lists allowed request files and requires the requested `(library, fileId)` tuple to be in the reviewer-materials set.
- `pages/api/external/review/[token]/upload.js` enforces per-file size, file count, structured form validation, magic-byte validation through shared upload core, and SharePoint rollback.

Risk category:

- OWASP A01 Broken Access Control, mitigated by strong token/request scoping
- OWASP A04 Insecure Design, residual abuse/noise risk

Recommendation:

- Add lightweight rate limiting to `/api/external/review/[token]/*`.
- Track repeated invalid-token attempts and consider alerting if volume spikes.

### P3 - Local test/scanner environment needs cleanup

Local security tooling could not fully mirror CI because of missing binaries and untracked local artifacts.

Evidence:

- `gitleaks`, `semgrep`, and `trivy` were not available locally.
- `npm run test:ci` failed before running tests because Jest scanned `node_modules.nosync/` and found duplicate package names.
- Current untracked items include `.next/`, `.next.nosync/`, `node_modules.nosync/`, and `docs/INTAKE_PORTAL_ITEM_6_CONNOR_EMAIL.md`.

Risk category:

- OWASP A06 Vulnerable and Outdated Components, if local scans are skipped
- Operational hygiene risk

Recommendation:

- Exclude `.next.nosync/` and `node_modules.nosync/` from Jest and local scan paths, or remove them before running security checks.
- Keep CI as the source of truth for Gitleaks/Semgrep/Trivy unless those tools are installed locally.

## Strong Controls Observed

- Middleware applies server-side auth and per-request CSP.
- Production auth policy fails closed unless `EMERGENCY_AUTH_BYPASS=true`.
- API routes use shared guard helpers (`requireAuth`, `requireAuthWithProfile`, `requireAppAccess`, `requireSuperuser`).
- State-changing authenticated routes have CSRF origin/referer checks through the shared auth helpers.
- API route matrix is CI-gated.
- Atlas coverage is CI-gated.
- External reviewer tokens use a separate secret, short-lived JWTs, stored hashes, revocation checks, and request-bound file access.
- Reviewer uploads validate extension and magic bytes, cap file count/size, write through a shared core, and roll back SharePoint writes on Dataverse failure.
- Server-side user-supplied URL fetches generally use `safeFetch` with host allowlisting and redirect validation.
- Markdown/HTML render paths use DOMPurify-based sanitizers and explicit scheme allowlists.
- Dataverse export artifacts use a private Blob store plus short-lived signed download tokens.
- AI payload-boundary and retention patterns are well documented in `docs/AI_DATA_FLOW_MATRIX.md`.

## Recommended Next Steps

1. Upgrade `next` and rerun `npm audit --audit-level=high`.
2. Fix local test hygiene so `npm run test:ci` ignores/removes `node_modules.nosync/`.
3. Decide whether generic public Blob upload endpoints should be retired, app-gated, or converted to private/scoped storage.
4. Change disabled-account DB-check failure behavior to fail closed for higher-risk routes.
5. Migrate remaining direct Anthropic fetch paths to `LLMClient`.
6. Add lightweight rate limiting to external reviewer token routes.
7. Confirm CI Gitleaks/Semgrep/Trivy runs are green after the dependency upgrade.

