# Session 200 Prompt: Continue from the S199 BILL chunk-4 build

## ⏰ Standing context / guardrails (carried from S197–S199)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Fires a non-blocking reminder on scope/quantity words written into `docs/`, `.claude-memory/`, `CLAUDE.md`, `SESSION_PROMPT.md`, `AGENTS.md`. Run the *disconfirming* query before asserting.
- **Codex stop-time review gate is ENABLED.** S199 ran Codex pre-impl + post-impl + TWO stop-time rounds as active reviewer (design → implement → test → Codex → fold → commit). The loop caught: 3 pre-impl P1s, a post-impl opt-out regression + stranding class, and TWO stop-time correctness bugs (permanently-stranded retries, replayed BILL invite). All folded.
- **Run `check:fact-consistency` after ANY guard/route/count change.** S199 added `/api/admin/honorarium-amount` → api-route-file-count 95→96; regenerated `CANONICAL_COUNTS.md` + reconciled the 3 stale `[95]` restatements (CLAUDE.md ×2, postgres-reviewer-suggestions.md).
- **Phasing locked:** one applicant submission entered as Phase I; "Phase II" = internal status flip. The "mid-June 2026 Phase II Research pilot" is **defunct**. Canonical: `docs/SYSTEM_MODEL.md`.

## Session 199 Summary

Built **BILL chunk-4** — the reviewer-honorarium portal-accept extension — end to end through the design→Codex→fold loop. 6 commits, suite 1425→**1479 green**, all CI gates green throughout. The flow is **inert until `BILL_ENABLED=true`** + operational setup (below), so nothing is live yet.

### What was completed (3 threads + Codex fixes)
1. **Thread 1 — `respond.js` accept-path extension** (`7cb8bc4`). New `lib/bill/honorarium-onboard-orchestrator.js`: promote-on-accept contact fallback → `contact.address1_*` PATCH → idempotent honorarium `akoya_request` create (DETERMINISTIC uuidv5 GUID per suggestion id → retry collides on PK, no second honorarium; does NOT over-dedup a reviewer reviewing two proposals) → `wmkf_HonorariumRequest` junction PATCH → in-process `onboardReviewer()` call. `lib/bill/honorarium-discriminators.js` (env-driven program/grantprogram/type GUIDs, fail-loud, `scripts/probe-honorarium-discriminators.js`). reviewer-suggestion adapter: `_wmkf_honorariumrequest_value` in FIELD_SELECT + `setHonorariumRequest()` + schema JSON (eval #8).
2. **Thread 2 — honorarium amount as single Dataverse ground-truth** (`7cb8bc4`). `honorarium.default_amount` in `wmkf_appsystemsettings`; `lib/services/honorarium-config.js`; `getSettingStrict` distinguishes absent-key (→ $250 fallback) from fetch-failure (→ throws, never silently mints). `render-emails.js` injects the amount server-side; per-user preference removed from `SettingsModal` + Review Manager. `/api/admin/honorarium-amount` (superuser) + admin UI section.
3. **Thread 3 — Full-real-fix hardening** (`7cb8bc4`). `bill_onboarding_state` table (migration `017`): reserve-before-create (PK race), persist `vendor_id` before the contact PATCH (no dup vendor on retry), `dynamics_pending` torn-state marker. `onboard-reviewer-service.js` rewire + request-PATCH retry+backoff. `MaintenanceService.sweepBillOnboarding` resume sweep (fails closed on NULL `pending_match`) + stuck-row reconcile + `cleanupBillOnboardingState` TTL; wired into daily cron.
4. **Codex post-impl folds** (`290ba68`): F2 (re-accept now honors PERSISTED opt-out, not just the body) + stranding reconcile + non-fatal address PATCH + terminal-only TTL.
5. **Stop-time #1** (`529bb65`): re-accept retries no longer loop on `in_progress` — a row with a staged `vendor_id` RESUMES.
6. **Stop-time #2** (`696706b`): the resume must NOT replay terminal BILL side effects — it now re-applies ONLY the idempotent contact PATCH (`resume_reconciled`), never re-`searchBillNetwork`/`sendNetworkInvitation`. Recovery split: torn writebacks → cron sweep; contact-PATCH strands → re-accept reconcile; abandoned/invite-never-fired → stuck-reconcile ops alert.
7. **Validation-drift close** (`b1d030a`): one shared `validateOnboardInput()` used by BOTH the HTTP route and the in-process `onboardReviewer()`. The **in-process call (vs the design's HTTP POST) is a CONSCIOUS choice** (self-HTTP is a Vercel anti-pattern; base-URL fragility; redundant HMAC) — documented in `docs/BILL_CHUNK_4_DESIGN.md` "In-process onboarding call" + the API-matrix row. Endpoint stays for external callers.

### Commits
- `7cb8bc4` — chunk-4 core (3 threads + pre-impl P1 fixes)
- `290ba68` — Codex post-impl folds
- `8da3414` — memory: chunk-4 shipped + Q1/Q5 closeout
- `529bb65` — stop-time #1: stranded retries resume
- `696706b` — stop-time #2: resume doesn't replay BILL side effects
- `b1d030a` — shared validateOnboardInput (validation parity) + doc reframe

## Potential Next Steps

### 1. Chunk 5 — Stage 2a address UI (the main remaining build)
`respond.js` accepts + validates `body.address` server-side already (optional — honorarium row + provenance create without it; BILL onboard `invalid_input`-alerts on missing). Build the reviewer-facing address inputs in the Stage 2a accept form (country picker, validation, prefill from existing `contact.address1_*`). UI work; see `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` chunk 5.

### 2. Operational setup before `BILL_ENABLED=true` (NOT a build task — needs prod creds)
- Apply migration `017_bill_onboarding_state.sql` to prod.
- Run `scripts/probe-honorarium-discriminators.js` → set `HONORARIUM_PROGRAM_ID` / `_GRANTPROGRAM_ID` / `_TYPE_ID`; run `scripts/probe-bill-option-set-values.js` → set `BILLCOM_ACCOUNT_*_VALUE`. (All fail-loud until set; flow inert.)
- Set `honorarium.default_amount` via `/admin` → "Reviewer Honorarium Amount" (else $250 fallback).
- Steph's BILL sandbox provisioning (blocks chunk 8 e2e).

### 3. Chunk 7b + 8 (deferred)
Webhook `vendor.updated` → flip `wmkf_exisitngbillcomaccount` to "Recently Confirmed" (lands once sandbox reveals payload shape). End-to-end test against BILL sandbox.

### 4. Parked initiatives (unchanged)
Appresearcher collapse (gated on reviewer Workbench), dependency/sequencing pass, intake virus-scan EICAR e2e before Phase I intake goes live.

## Key Files Reference
| File | Purpose |
|------|---------|
| `docs/BILL_CHUNK_4_DESIGN.md` | The chunk-4 design + ALL Codex fold notes (pre-impl, post-impl, both stop-time, the in-process-call rationale) |
| `lib/bill/honorarium-onboard-orchestrator.js` | Accept-path orchestrator (contact/address/create/junction/onboard) |
| `lib/bill/onboard-reviewer-service.js` | BILL flow + reserve/persist/resume hardening + `validateOnboardInput` |
| `lib/bill/onboarding-state.js` | `bill_onboarding_state` data layer (reserve, vendorId, torn marker, stuck/cleanup) |
| `lib/services/honorarium-config.js` | Single Dataverse ground-truth amount reader (strict) |
| `pages/api/external/review/[token]/respond.js` | Accept path: honorarium step (persisted-opt-out gate, non-fatal) |
| `lib/services/maintenance-service.js` | `sweepBillOnboarding` (resume + stuck reconcile) + `cleanupBillOnboardingState` |

## Testing
```bash
npx jest                       # 1479 tests
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency && npm run check:migrations-manifest
# After ANY guard/route/count change: also run check:fact-consistency (count drift).
```
