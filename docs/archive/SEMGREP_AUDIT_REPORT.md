# Semgrep Security Audit Report

**Date:** March 9, 2026
**Tool:** Semgrep v1.154.0 (open source, https://github.com/semgrep/semgrep)
**Target:** WMK Research Review App Suite codebase
**Purpose:** Independent automated verification that Microsoft service principal access tokens cannot leak outside the server runtime

---

## Scans Performed

### 1. Custom Token Exposure Rules (`.semgrep/token-audit.yaml`)

Seven custom rules targeting the specific concern: can the service principal access token reach a browser, log, database, SSE stream, error message, or third-party API?

| Rule ID | What It Detects | Findings |
|---------|----------------|----------|
| `token-leaked-to-console` | `getAccessToken()` result or `tokenCache` flowing to `console.log/error/warn` | **0** |
| `token-leaked-to-response` | `getAccessToken()` result flowing to `res.json/send/write` | **0** |
| `token-stored-in-database` | `getAccessToken()` result or `tokenCache` flowing to SQL queries | **0** |
| `token-leaked-to-sse` | `getAccessToken()` result flowing to SSE `sendEvent()` | **0** |
| `client-secret-exposed` | `DYNAMICS_CLIENT_SECRET` in logs or API responses | **0** |
| `token-in-error-message` | `getAccessToken()` result in `throw new Error()` | **0** |
| `token-sent-to-third-party` | `getAccessToken()` result flowing to non-Microsoft APIs | **0** |

**Result: 0 findings across 104 files.**

### 2. Secrets Detection (`p/secrets`)

Semgrep's built-in rules for detecting hardcoded secrets, API keys, passwords, and credentials in source code.

- **Rules run:** 42
- **Files scanned:** 244
- **Result: 0 findings.**

No hardcoded secrets, API keys, or credentials detected anywhere in the codebase.

### 3. JavaScript/Node.js Security + OWASP Top 10

Combined scan with `p/javascript`, `p/nodejs`, and `p/owasp-top-ten` rule packs.

- **Rules run:** 71 (deduplicated)
- **Files scanned:** 157
- **Result: 3 findings (none token-related)**

| Finding | File | Severity | Token-related? |
|---------|------|----------|---------------|
| GCM authentication tag length not specified | `lib/utils/encryption.js:90` | Warning | No — user preference encryption |
| GCM authentication tag length not specified | `shared/utils/apiKeyManager.js:58` | Warning | No — API key encryption (deprecated) |
| Direct response write from user input | `pages/api/blob-proxy.js:65` | Warning | No — binary file proxy with Content-Type headers |

None of the 3 findings involve Microsoft tokens, service principal credentials, or the Dynamics/Graph authentication flow.

---

## Summary

| Scan | Rules | Files | Total Findings | Token-Related Findings |
|------|-------|-------|---------------|----------------------|
| Custom token audit | 7 | 104 | 0 | **0** |
| Secrets detection | 42 | 244 | 0 | **0** |
| JS/Node + OWASP | 71 | 157 | 3 | **0** |
| **Total** | **120** | **244** | **3** | **0** |

**Conclusion:** Semgrep found zero paths by which the Microsoft service principal access token could leak outside the server runtime. The token is used exclusively in `Authorization` headers on outbound HTTPS requests to Microsoft APIs.

---

## How to Reproduce

Anyone can verify these results by running the following commands from the project root:

```bash
# Install semgrep
brew install semgrep

# Run custom token exposure audit
semgrep --config=.semgrep/token-audit.yaml --exclude='node_modules' --exclude='.next' lib/ pages/

# Run secrets detection
semgrep --config=p/secrets --exclude='node_modules' --exclude='.next' .

# Run JS/Node security + OWASP Top 10
semgrep --config=p/javascript --config=p/nodejs --config=p/owasp-top-ten --exclude='node_modules' --exclude='.next' lib/ pages/ shared/
```

Raw JSON output from each scan is available in `docs/security-audit/`.

---

## Custom Rule Definitions

The 7 custom rules are defined in `.semgrep/token-audit.yaml` and checked into the repository. They can be run as part of CI to prevent future regressions.
