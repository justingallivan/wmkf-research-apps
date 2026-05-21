# Session 172 Prompt: security-audit remediation in progress; slice-0 still parked

## Session 171 Summary

Security-audit remediation session. Justin supplied `docs/security-audit/SECURITY_AUDIT_2026-05-21.md` (OWASP Top 10 / ASVS 5.0 / LLM Top 10). I reviewed it, spot-verified its claims (all four sampled findings were accurate), produced a sequenced remediation plan, and shipped the first three items. Slice-0 deploy remains parked exactly where S170 left it.

### What Was Completed

1. **P2-a — disabled-account check now fails closed (commit `ba90d41`).**
   - `requireAuthWithProfile()` in `lib/utils/auth.js` previously allowed the request through if the `user_profiles.is_active` revocation query threw ("If DB check fails, allow through"). A transient Postgres blip could therefore honor a disabled-account session, compounded by the 2-min cache TTL.
   - Now responds `503` + returns `null` on DB error; `console.warn` → `console.error`.
   - `requireAppAccess()` was already effective-fail-closed (its `Promise.all` lets DB errors propagate to a 500) — no change needed there.
   - New test helper `mockIsActiveLookupFailure()` in `tests/helpers/auth-mock.js`; new test in `tests/unit/utils/auth.test.js` asserts the 503.

2. **P1 — `next` upgraded 16.1.6 → 16.2.6 (commit `ba90d41`).**
   - `npm audit` confirmed all 7 high-severity advisories genuinely apply to the `16.1.6` pin: 4× middleware/proxy bypass, WebSocket-upgrade SSRF, 2× DoS. One (`GHSA-26hh-7cqf-hhc6`) is only patched at 16.2.6, not 16.2.5.
   - Minor in-major bump, no migration. `npm audit --audit-level=high` now reports **0 high** (9 moderate remain — unrelated transitive deps).
   - `npm run build` passes; CI Tests run `26258381758` is **green** (full integration suite, which the local Mac SWC issue blocks).

3. **P3 — Jest/local hygiene (commit `ba90d41`).**
   - `jest.config.js`: added `*.nosync` paths to `testPathIgnorePatterns` **and** a new `modulePathIgnorePatterns` block (the haste-map collision was a *module*-path scan, not a test-path scan).
   - `.gitignore`: added `*.nosync/`.
   - Result: the `node_modules.nosync/` duplicate-package collision is gone. `test:ci` still fails locally on the **separate, pre-documented Mac SWC binding issue** (integration suites only — unit tests transform fine; 486 pass). CI remains authoritative for the full suite.

4. **Audit doc committed (commit `cc5b676`).** `docs/security-audit/SECURITY_AUDIT_2026-05-21.md` added to the repo.

### Commits (S171, `main`, all pushed)

- `ba90d41` Security: fail-closed account check, next 16.2.6 upgrade, Jest hygiene
- `cc5b676` Docs: add 2026-05-21 security audit report
- (this `/stop`) — Document Session 171 + Session 172 prompt

## Potential Next Steps

### A. SECURITY-AUDIT REMEDIATION — 6 items + 3 omissions still open
The full sequenced plan was produced in S171. Remaining items, in the recommended order:

- **A1. `next` 16.x deprecates `middleware.js` → `proxy.js`.** Build warns (`The "middleware" file convention is deprecated`); middleware still works. Renaming this project's *primary auth gate* deserves its own scoped task — read the Next migration note before touching it. Not a blocker.
- **A2. P2-c — migrate `pages/api/phase-i-dynamics/summarize.js:125` off the direct `fetch(BASE_CONFIG.CLAUDE.API_URL)` to `llm-client.js`.** Verified this is the *only* remaining direct Anthropic fetch in `pages/api/`. Small (2–3h). Also ensure both success + failure `tryLogAiRun()` calls pass explicit `rawOutputRetention`.
- **A3. Omission 1 — `EMERGENCY_AUTH_BYPASS` prod monitoring.** Alert (structured log + `system_alerts` row) at cold-start if set in production; daily cron re-assert. Cheap, ~3h.
- **A4. Omission 3 — `EXTERNAL_LINK_SECRET` rotation.** Dual-secret verification window in `lib/services/external-token.js` + runbook cadence + one drill. ~4h.
- **A5. P2-b — generic public-Blob uploads.** `/api/upload-file` IS load-bearing (callers: `FileUploaderSimple.js`, `SettingsModal.js`, `review-manager.js`) — do NOT retire it. `/api/upload-handler` had no server-side callers found — probe and retire if vestigial. Then add `appKey` gating + private-blob mode to `upload-file`. Behind a flag; touches many apps.
- **A6. P3-b — rate-limit `/api/external/review/[token]/*`.** Pilot-blocking (pilot opens 2026-06-01). Lightweight per-token + per-IP buckets; `system_alerts` on repeated invalid-token attempts.
- **A7. Omission 2 — LLM01 prompt injection** on applicant-supplied docs (Phase I/II writeup, intake extraction). Largest scope: inventory first, then boundary-tagging + system-prompt hardening + output-schema validation. Its own initiative.
- **A8. 9 moderate `npm audit` items** (`exceljs` is a semver-major fix) — separate `npm audit fix` pass when convenient.

### B. SLICE-0 SCHEMA DEPLOY — still parked, unchanged from S169/S170 (destructive carryover, pre-flight verify)
Justin go-ahead + Connor review-of-`SLICE0_FIELD_REVIEW.md` still pending. Sequence per `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` §5 steps 1–6. Pre-flight: `node scripts/probe-apprequestperson-role-data.js` + `node scripts/probe-slice0-attr-collision.mjs` must be CLEAR **at deploy time**, not just historically. Grep for live callers. No autonomous action; explicit in-session go-ahead required.

### C. CONNOR P4 — after schema deploys. Unchanged.

### D. CONNOR FIELD-REVIEW RESPONSE on `SLICE0_FIELD_REVIEW.md` — passive watch. Unchanged.

### E. ENV-0 — Other-Mac memory propagation still unverified. Unchanged from S168–S170.

### F. Cross-cycle Reviewer Finder dedup — observed-only, no fix yet. Unchanged from S170 §F.

## Calendar Checkpoints (soft — report factually, not "overdue")
- **2026-05-19** slice-0 deploy target — missed. **2026-05-26** dry-run / Connor field-review window. **2026-05-30** go/no-go. **2026-06-01** pilot opens (A6 rate-limiting should land before this). **≥2026-07-01** post-pilot drain-table drop.

## Gotchas (current)

- 🟢 **CI green on `main`.** Tests run `26258381758` (commit `cc5b676`) passed — `next@16.2.6` confirmed safe on the full integration suite.
- 🟢 **`requireAuthWithProfile()` now fails closed.** A Postgres blip will 503 every route using it until the DB recovers — correct trade vs. honoring a disabled-account session. The 503 message tells the client to retry.
- 🟡 **`next@16.2.6` deprecates `middleware.js`.** Build emits a deprecation warning; still functional. Plan item A1 — don't rename casually.
- 🔴 **`test:ci` still fails locally** on the Mac SWC binding issue (`Failed to load bindings`) — pre-existing, integration suites only, NOT introduced this session. Unit tests run fine (`npx jest tests/unit` → 486 pass). CI is authoritative.
- 🔴 **All S170 slice-0 gotchas still hold**: AGENTS.md symlink, slice-0 destructive-carryover classification, drain-table + prompt-storage gates, memory two-stores. Connor field-review + Justin go-ahead still gate `--execute`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/auth.js` | `requireAuthWithProfile()` is_active check now fails closed (503) on DB error |
| `tests/helpers/auth-mock.js` | New `mockIsActiveLookupFailure()` helper |
| `tests/unit/utils/auth.test.js` | New test: 503 on is_active DB error |
| `jest.config.js` | `*.nosync` excluded from `testPathIgnorePatterns` + new `modulePathIgnorePatterns` |
| `.gitignore` | `*.nosync/` added |
| `package.json` | `next` → `16.2.6` |
| `docs/security-audit/SECURITY_AUDIT_2026-05-21.md` | The audit report driving the A-series next steps |

## Testing

```bash
# 13 sequential gates (run in order, never parallel):
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

# Unit tests (transform fine locally; integration blocked by Mac SWC issue):
npx jest tests/unit                          # 486 pass
npm run test:ci                              # full suite — CI is authoritative

# Security re-checks:
npm audit --audit-level=high                 # should report 0 high

# At slice-0 deploy time (BOTH must be CLEAR):
node scripts/probe-apprequestperson-role-data.js && node scripts/probe-slice0-attr-collision.mjs
```
