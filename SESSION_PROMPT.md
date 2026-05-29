# Session 199 Prompt: Continue from the S198 eval-triage / hardening pass

## ⏰ Standing context / guardrails (carried from S197–S198)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Fires a non-blocking reminder on scope/quantity words written into `docs/`, `.claude-memory/`, `CLAUDE.md`, `SESSION_PROMPT.md`, `AGENTS.md`. Run the *disconfirming* query before asserting. It paid off twice in S198 (two Explore over-claims caught — see below).
- **Codex stop-time review gate is ENABLED.** S198 also ran Codex per-item as an active reviewer (implement → test → Codex → fold → commit); that loop caught a P1 in the optimistic-locking work.
- **Run `check:fact-consistency` after ANY guard/route change, not just `check:api-routes`.** S198 lesson: switching `test-email` to `requireSuperuser` dropped the code-derived `requireappaccess-endpoint-count` (52→51); committing without refreshing `CANONICAL_COUNTS.md` turned the gate red. Caught + fixed same session, but avoidable.
- **Phasing locked:** one applicant submission entered as Phase I; "Phase II" = internal status flip. The "mid-June 2026 Phase II Research pilot" is **defunct**. Canonical: `docs/SYSTEM_MODEL.md`.

## Session 198 Summary

Triaged the S197 codebase evaluation (`docs/CODEBASE_EVALUATION_2026-05-29.md`) — drove every **actionable, in-my-hands** finding to a tested + Codex-reviewed fix. 11 commits, suite 1359→1425 green, all 7 CI gates green throughout.

### What was completed (by eval finding)
1. **Test-coverage gaps** (`be432ae`) — first direct `proxy.js` test (CSP nonce + `authorized` callback), CSRF referer-fallback, executor impersonation threading. +29 tests. (The audit's "tests failing in sandbox" premise was falsified — suite was already green; the gaps were *missing* tests.)
2. **#3 drain telemetry** (`9993fd5`) + **maintenance_runs retention** (`15513c5`) — drain now writes `maintenance_runs` (idle ticks skipped to avoid ~720 rows/day flood; failures always recorded), and a new `cleanupMaintenanceRuns` daily step bounds the table.
3. **#5 is_active TTL** (`8931bb8`) — `is_active` + superuser role now read **fresh every request** (only app grants cached); a deactivated account loses access on the next request, not after 2 min. Reconciled the stale "is_active cached" claims across `SECURITY_ARCHITECTURE.md`, `AUTHENTICATION_SETUP.md`, `CLAUDE.md`.
4. **#2 intake orphan race** (`5b188d2`) — `promoteToClean` gained `request_id IS NULL`; `submit.js` freeze gained an optimistic count-guard (timestamptz µs-vs-ms ruled out an `updated_at` guard) → `409 draft_changed_retry`. Closes the attach-after-submit orphan both windows.
5. **#6/#7/#9 legibility** (`9a4d38b`) — README re-anchored to the multi-app system; SYSTEM_MODEL.md glossary gained drain/slice-0/Mode 1·2; CLAUDE.md surfaces SYSTEM_MODEL.md.
6. **#11 test-email** (`f2a5e96`) — tightened `requireAppAccess('dynamics-explorer')` → `requireSuperuser` (it could send mail from the caller's Dynamics identity). +6 tests.
7. **Deep-pass** (`8032793`) — wired reviewer **optimistic locking** end-to-end (etag was dead code: surfaced `_etag`, client sends `If-Match`, 412 handled; Codex P1 caught — first-access stamp staleness → post-stamp re-read) + `contactEdits` validation.
8. **#10 Atlas drift** (`3dd9937`) — execute-prompt citations → symbol anchors; stripped 16 drift-prone `≈line` hints; reconciled the count P0.
9. **BILL hardening prep** (`efd38c1`) — verified `POST /v3/vendors` has **no idempotency-key header**; wrote the durable-vendorId + resume-marker design into the findings doc for chunk-4.

### Codex caught (folded): role-failure test gap (#5), the optimistic-locking first-access-stamp P1, cron-wiring test gap (retention), README accuracy (thin-adapter/api-capabilities/env), + two pre-existing CLAUDE.md contradictions. Two Explore **false positives** rejected on verification: BILL "PII leak" (ops needs that data to onboard manually) and respond.js "locking missing" (it was wired server-side, just never exercised).

## Potential Next Steps

### 1. Verify-live-first (eval #1 — needs prod creds, NOT a build task)
- Migrations 011 + 013 are almost certainly **already applied** (DEV_LOG S186) — probe prod for `submission_jobs.locked_until` + `intake_drafts.pending_attachments`, confirm, close. Do NOT re-apply blindly.
- `vercel env ls production` — confirm `INTAKE_BLOB_RW_TOKEN` set + `VRP_ALLOWED_PROVIDERS` includes `claude`.

### 2. BILL chunk-4 (the real build the prep is for)
Create honorarium `akoya_request` + PATCH junction `wmkf_HonorariumRequest` + call onboard, building in the **idempotent-create + resume-marker** design from `docs/REVIEWER_BILL_HARDENING_FINDINGS.md` (the deferred P1s: duplicate-vendor-on-retry, torn cross-system state). Money-adjacent; flow goes live for reviewers ≥ 2026-06-17. Also: `wmkf_honorariumrequest` is documented-deployed but absent from schema-as-code + `reviewer-suggestion.js` FIELD_SELECT (eval #8).

### 3. Deferred lower-severity reviewer/BILL opens (`docs/REVIEWER_BILL_HARDENING_FINDINGS.md`)
no-match PATCH retry, notify()-failure escalation, contact-PATCH backoff. Deliberate tradeoffs (rate-limit fail-open, HMAC 5-min skew) left as-is with in-code rationale.

### 4. Parked initiatives (unchanged)
Appresearcher collapse (gated on reviewer-Workbench), dependency/sequencing pass, intake virus-scan EICAR e2e before Phase I intake goes live.

## Key Files Reference
| File | Purpose |
|------|---------|
| `docs/CODEBASE_EVALUATION_2026-05-29.md` | The eval this session triaged (point-in-time) |
| `docs/REVIEWER_BILL_HARDENING_FINDINGS.md` | Deep-pass findings + chunk-4 BILL hardening design (NEW S198) |
| `lib/utils/auth.js` | `requireAppAccess` — is_active/superuser now fresh-per-request |
| `pages/api/intake/submit.js` + `lib/services/intake-draft-service.js` | Freeze optimistic guard + `promoteToClean` request_id guard |
| `pages/api/external/review/[token]/{context,respond}.js` + `shared/components/external/{Stage2aView,DeclineFormView}.js` | Reviewer optimistic-locking wiring |

## Testing
```bash
npx jest                       # 1425 tests, 91 suites
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency
# After ANY guard/route change: also run check:fact-consistency (count drift).
```
