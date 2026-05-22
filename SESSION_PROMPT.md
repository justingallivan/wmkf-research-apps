# Session 173 Prompt: security-audit remediation continues (A4–A8); slice-0 still parked

## Session 172 Summary

Continued the S171 security-audit remediation. Shipped the next three items (A1–A3)
from the sequenced plan in `docs/security-audit/SECURITY_AUDIT_2026-05-21.md`, in
order. Slice-0 deploy remains parked exactly where S170/S171 left it.

### What Was Completed

1. **A1 — `middleware.js` → `proxy.js` (Next 16 proxy file convention).**
   - `git mv` preserved history; inner `function middleware()` → `function proxy()`.
   - The deprecated `middleware` convention still worked but warned on build.
   - Proxy defaults to the **Node.js runtime** in Next 16 (the `runtime` config
     option is disallowed for proxy files). All primitives used (jose,
     `crypto.getRandomValues`, `btoa`, `Headers`, `NextResponse`) are Node-safe —
     no functional regression expected.
   - Doc references updated + now-stale "Edge Runtime" claims corrected across
     `CLAUDE.md`, `AUTHENTICATION_SETUP.md`, `SECURITY_ARCHITECTURE.md`,
     `API_ROUTE_SECURITY_MATRIX.md`, `EXTERNAL_REVIEWER_INTAKE_PLAN.md`,
     `lib/utils/auth-policy.js`. No code imports the root module; no test/gate
     references the filename — verified by grep.

2. **A2 — P2-c: `phase-i-dynamics/summarize.js` migrated to `llm-client.js`.**
   - Replaced the direct `fetch(BASE_CONFIG.CLAUDE.API_URL)` (the last direct
     Anthropic fetch in `pages/api/`) with `createLLMClient().complete()`.
   - Gains: SSRF allowlist, abortable timeout, 429/529 retry + fallback,
     API-key redaction, success+failure usage logging (via `appName`).
   - Removed the now-redundant manual `logUsage` call + `usage-logger` import.
   - Both failure-path `tryLogAiRun()` calls now pass explicit
     `rawOutputRetention: 'full'` (was the implicit default — now intentional).
   - Updated the integration test's stale header comment (test still mocks
     `global.fetch`, which `safeFetch` delegates to).

3. **A3 — Omission 1: `EMERGENCY_AUTH_BYPASS` production monitoring.**
   - New `lib/utils/auth-bypass-monitor.js` — shared check: raises a CRITICAL
     `system_alerts` row (+ structured log + admin email) while the lever is
     set in production; `AlertService.autoResolve` once cleared. Best-effort,
     never throws. Node-runtime only — deliberately NOT imported by the
     Edge-bundle-constrained `auth-policy.js`.
   - New `instrumentation.js` — Next `register()` cold-start hook, nodejs-runtime
     guarded, dynamic-imports the monitor.
   - New `pages/api/cron/auth-bypass-check.js` — daily re-assert (07:30 UTC),
     registered in `vercel.json`.
   - Route count 84 → 86: `CANONICAL_COUNTS.md` regenerated; `[84]` pointers in
     `CLAUDE.md` + `docs/atlas/postgres-reviewer-suggestions.md` bumped to `[86]`;
     historical `fact-consistency:ignore` marker added to the S171 audit doc.

### Commits (S172, `main`)

- `30aaa51` Security audit A1–A3: proxy.js rename, llm-client migration, auth-bypass monitor
- (this `/stop`) — Document Session 172 + Session 173 prompt

### Verification status

- 🟢 **All 13 doc/structure CI gates green** (atlas, atlas:self-test, doc-currency
  ×2, api-routes, fact-consistency ×2, canonical-pointers ×2, drain-table ×2,
  prompt-storage ×2).
- 🟢 All new/changed JS files syntax-check clean; AGENTS.md symlink intact.
- 🔴 **`npm run build` and `jest` could NOT run locally** — both hang in the Mac
  SWC native-binding issue (build sat 42 min at 0% CPU; jest hangs in the
  `@swc/jest` transform even on 2 unit files this session — worse than S171's
  "unit tests run fine"). **CI is authoritative.** Confirm on CI: (a) the
  `middleware` deprecation warning is gone and `proxy.js` is picked up,
  (b) `phase-i-dynamics-summarize-payload-boundary.test.js` still passes.

## Potential Next Steps

### A. SECURITY-AUDIT REMEDIATION — A4–A8 still open (continue in order)
- **A4. Omission 3 — `EXTERNAL_LINK_SECRET` rotation.** Dual-secret verification
  window in `lib/services/external-token.js` + runbook cadence + one drill. ~4h.
- **A5. P2-b — generic public-Blob uploads.** `/api/upload-file` IS load-bearing
  (callers: `FileUploaderSimple.js`, `SettingsModal.js`, `review-manager.js`) —
  do NOT retire it. `/api/upload-handler` had no server-side callers found —
  ⚠️ destructive-carryover: grep-verify live callers before retiring. Then add
  `appKey` gating + private-blob mode to `upload-file`. Behind a flag.
- **A6. P3-b — rate-limit `/api/external/review/[token]/*`.** Pilot-blocking
  (pilot opens 2026-06-01). Per-token + per-IP buckets; `system_alerts` on
  repeated invalid-token attempts.
- **A7. Omission 2 — LLM01 prompt injection** on applicant-supplied docs.
  Largest scope: inventory first, then boundary-tagging + system-prompt
  hardening + output-schema validation. Its own initiative.
- **A8. 9 moderate `npm audit` items** (`exceljs` is a semver-major fix) —
  separate `npm audit fix` pass when convenient.

### B. SLICE-0 SCHEMA DEPLOY — still parked (destructive carryover, pre-flight verify)
Unchanged from S169–S172. Justin go-ahead + Connor review-of-`SLICE0_FIELD_REVIEW.md`
still pending. Sequence per `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` §5 steps 1–6.
Pre-flight `node scripts/probe-apprequestperson-role-data.js` +
`node scripts/probe-slice0-attr-collision.mjs` must be CLEAR **at deploy time**.
No autonomous action; explicit in-session go-ahead required.

### C. CONNOR P4 — after schema deploys. Unchanged.
### D. CONNOR FIELD-REVIEW RESPONSE on `SLICE0_FIELD_REVIEW.md` — passive watch. Unchanged.
### E. ENV-0 — Other-Mac memory propagation still unverified. Unchanged.
### F. Cross-cycle Reviewer Finder dedup — observed-only, no fix yet. Unchanged.

## Calendar Checkpoints (soft — report factually, not "overdue")
- **2026-05-19** slice-0 deploy target — missed. **2026-05-26** dry-run / Connor
  field-review window. **2026-05-30** go/no-go. **2026-06-01** pilot opens (A6
  rate-limiting should land before this). **≥2026-07-01** post-pilot drain-table drop.

## Gotchas (current)

- 🔴 **Local `npm run build` and `jest` hang** on the Mac SWC binding issue —
  worse this session than S171 documented (jest hangs even on unit tests).
  `jest --listTests` works (fast); running tests hangs in the transform. Do NOT
  burn time re-running locally — CI is authoritative. Confirm CI green before
  treating A1/A2 as fully verified.
- 🟡 **`30aaa51` build unverified.** If CI shows the build still warns or fails,
  `proxy.js` may need attention — but the rename is mechanical and the proxy
  doc was followed exactly.
- 🟢 **`proxy.js` runs on the Node.js runtime now** (Next 16 proxy default), not
  Edge. No functional change expected — all primitives are Node-safe.
- 🟡 **`.next/` is untracked and not gitignored.** Build artifact; S171 added
  `*.nosync/` to `.gitignore` but not `.next`. Harmless (untracked doesn't
  propagate) but worth a one-line `.gitignore` fix.
- 🟡 **`docs/INTAKE_PORTAL_ITEM_6_CONNOR_EMAIL.md`** — untracked since before
  S172, not this session's work. Left alone (carryover hygiene). Decide whether
  to commit or discard.
- 🔴 **All slice-0 gotchas still hold**: AGENTS.md symlink, slice-0
  destructive-carryover classification, drain-table + prompt-storage gates,
  memory two-stores. Connor field-review + Justin go-ahead still gate `--execute`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `proxy.js` | Server-side auth gate — renamed from `middleware.js` (Next 16 proxy convention) |
| `instrumentation.js` | Next `register()` cold-start hook — runs the EMERGENCY_AUTH_BYPASS monitor |
| `lib/utils/auth-bypass-monitor.js` | Shared raise/auto-resolve logic for the bypass alert (cold-start + cron) |
| `pages/api/cron/auth-bypass-check.js` | Daily cron — re-asserts the bypass lever, auto-resolves when cleared |
| `pages/api/phase-i-dynamics/summarize.js` | Claude call now routed through `llm-client.js` (A2) |
| `lib/utils/auth-policy.js` | Header comment updated for the proxy rename |
| `docs/security-audit/SECURITY_AUDIT_2026-05-21.md` | The audit driving the A-series; A4–A8 remain |

## Testing

```bash
# 13 sequential gates (run in order, never parallel — all green as of S172):
npm run check:atlas && npm run check:atlas:self-test && \
npm run check:doc-currency && npm run check:doc-currency:self-test && \
npm run check:api-routes && \
npm run check:fact-consistency:self-test && npm run check:fact-consistency && \
npm run check:canonical-pointers:self-test && npm run check:canonical-pointers && \
npm run check:drain-table-mentions:self-test && npm run check:drain-table-mentions && \
npm run check:prompt-storage-mentions:self-test && npm run check:prompt-storage-mentions

# Quick invariants:
test -L AGENTS.md && readlink AGENTS.md     # must be: CLAUDE.md
git rev-parse HEAD && git status --porcelain # iCloud .git-corruption tripwire

# Build / tests — DO NOT rely on local runs (Mac SWC hang). CI is authoritative.
npm run test:ci                              # CI authoritative
npm audit --audit-level=high                 # should report 0 high (A8 = 9 moderate)
```
