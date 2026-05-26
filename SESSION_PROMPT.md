# Session 189 Prompt: Reviewer-honorarium portal extension (or readiness-audit tail)

## ⏰ Time-sensitive carryovers

### Cron verification still pending (S186 Phase 0 — first post-deploy fires)
S186 deploy landed 2026-05-25. S188 didn't get back to this — verify these now:

- **`daily-maintenance`** — fires 03:00 UTC daily. Want: `status='completed'`, no `cleanupExpiredCache` error. First post-deploy fire 2026-05-26 03:00 UTC (i.e., should be visible by S189 start).
- **`sweep-stale-invites`** — fires 09:00 UTC daily. Want: a `maintenance_runs` row exists.
- **`pricing-canary`** — fires Mondays 10:00 UTC. First fire 2026-06-01 10:00 UTC.
- **`drain-submissions`** — no `maintenance_runs` write; tail Vercel logs if intake traffic appears.
- **`pricing-refresh`** — NEW S188 wiring. Now writes `maintenance_runs` (was silent before — B4-F2 fix). First fire 2026-06-01 11:00 UTC. Skipped-mode row will appear if `ANTHROPIC_ADMIN_API_KEY` is unset (expected today).

Quick check: `SELECT job_name, status, started_at FROM maintenance_runs WHERE started_at > '2026-05-26' ORDER BY started_at DESC LIMIT 20`.

### BILL reviewer-honorarium build status
- **Slice 1 SHIPPED S188** — `lib/bill/*`, `pages/api/webhooks/bill.js` scaffold, migration `015_bill_webhook_events.sql`, `cleanupBillWebhookEvents` wired into daily maintenance. 78 unit tests.
- **Connor's 6 questions sent.** Awaiting answers — Q5 (`wmkf_honorariumforrequest` lookup) is the only one blocking the portal-extension slice.
- **Steph operator-side:** BILL.com sandbox access + admin account provisioning in flight.
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

### Q1 sandbox-time discovery (HARD GATES the portal slice's "no separate trip" UX promise)
Per `docs/BILL_LIB_DESIGN.md` Q1: BILL v3 API has no documented "email this person to join the network" path. When sandbox access lands, day-1 test = create a fresh test vendor with `email` populated for an address we control; observe whether BILL auto-emails. Two hypotheses; portal slice's UX framing depends on which is true.

## Session 188 Summary

S188 was two streams of work in one session: (1) the BILL.com reviewer-honorarium integration design + slice 1 build (full Codex pre-impl + post-impl cadence), and (2) burning through the May 25 readiness audit's open findings (17 of 27 closed, was 8 closed pre-S188).

### What was completed

1. **BILL.com integration architecture pivoted + slice 1 shipped** (`280ff5d`, `1663b4f`)
   - Initial Ops-handoff doc proposed a PA-triggered backend integration on top of GOapply. Probe surfaced that the existing Stage 2a reviewer-portal accept endpoint is already shipped (S144) and just needs extension — pivoted to portal-integrated architecture, skipping GOapply entirely going forward.
   - Slice 1 = `lib/bill/{index,session,classify,errors,redact}.js` (BILL.com API wrapper with session caching, BDC error classification, HMAC webhook verification) + `pages/api/webhooks/bill.js` (verify+dedup+log scaffold, zero Dataverse writes deferred until sandbox reveals payload) + migration `015_bill_webhook_events.sql` (compound-key dedup table) + `cleanupBillWebhookEvents` (7d retention) wired into daily maintenance cron.
   - Two Codex pre-impl review rounds caught architectural issues (session-cache failed-promise leak, hourly-vs-concurrent rate-limit split, dedup atomicity, timingSafeEqual conformance, SSRF safe-fetch wiring).
   - Two Codex post-impl review rounds caught implementation drift (exhausted-rate-limit error class, raw-payload PII leak in webhook log, eventId type-check, proxy matcher prefix-match bug, redaction regex JWT/base64 chars, readRawBody listener leak, missing TTL cleanup).
   - 78 unit tests.

2. **Three design docs landed for Connor**
   - `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` (portal-integrated architecture; 6 questions + 1 informational)
   - `docs/BILL_LIB_DESIGN.md` (v3, post-Codex-review)
   - `docs/BILL_integration_handoff.md` (preserved as historical reference; explicitly noted as concept-level, not API-accurate)

3. **Memory entries (3 from BILL work, 3 from process):**
   - `project-bill-honorarium-integration.md`, `akoya-request-honorarium-nomenclature.md`, `akoya-payment-field-semantics.md` (project knowledge)
   - `feedback-cite-ground-truth.md` (after user caught me restating Codex's Neon numbers without the URL)
   - `feedback-no-performative-contrition.md` (after user called out my self-flagellating "this is exactly the failure mode X warns about" pattern)
   - Plus updates to existing entries

4. **Readiness audit progress: 8 → 17 of 27 closed**
   - `67f9967` audit batch 1: B2-F2 delete schema-v2.sql + B2-F5 backup/restore doc + B3-F1 secret-check TRACKED_SECRETS + B7-F4 unskipped apiKeyManager test
   - `474b3f0` tracked-secrets refactor (extracted to `lib/utils/tracked-secrets.js`; consumers + runbook reconciled) + Neon doc accuracy + cite-ground-truth feedback
   - `78c198f` B5-F2 invert proxy idle-timeout to fail-closed
   - `44a2c3a` audit batch 2: B3-F5 model_override probe + B4-F2 pricing-refresh observability + B6-F2 EXECUTOR_CONTRACT.md drift
   - `bb1a3c7` audit batch 3 closeouts: B1-F5, B4-F1, B7-F1, B7-F2, B7-F3
   - `d3ffce3` B2-F6 Dataverse entity re-sweep + doc reconcile
   - `2477042` B5-F1 closeout (External Entra OTP exercised S187)
   - Plus four rounds of fold-after-Codex-sweep commits (`431844a`, `9ce1576`, `85fe919`, `0bf5935`, `577679b`, `30097c6`) — see audit conversation below

5. **Audit of recurring failure modes + `/sweep` skill** (`92b7ffa`)
   - Late in the session: a long doc-reconcile cleanup required 6 Codex rounds before converging. Drift kept surviving my self-checks.
   - User pushed for a comprehensive audit of why mistakes kept accumulating. Audit identified 6 root patterns (the dominant: "I read the obvious location ≡ I verified the claim" and "I fixed the line in front of me ≡ I fixed the issue").
   - User flagged my framing — "what you can do to help" — as a cop-out: rules are mine, enforcement is mine. Their concession: a callable skill rather than them having to remind me.
   - Built `/sweep` — user-invokable doc-reconcile discipline check. Forces a whole-repo grep, classifies every hit, blocks "done" claim until all stale restatements are addressed. Lives at `.claude/skills/sweep/SKILL.md`.

### Commits (newest first)
- `92b7ffa` — Add /sweep skill
- `30097c6` — Fold Codex round-6 (cleanup-cron wording + banner accuracy)
- `577679b` — Fold Codex round-5 (banner-revision review)
- `0bf5935` — Section-level HISTORICAL banners in REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md (structural fix after per-line patching kept failing)
- `85fe919` — Fold Codex round-3 sweep — 7 drift sites
- `9ce1576` — Fold Codex sweep round 2 — 3 drift artifacts
- `431844a` — Codex sweep folds — 4 sites
- `2477042` — B5-F1 closeout
- `d3ffce3` — B2-F6 Dataverse entity re-sweep + doc reconcile
- `bb1a3c7` — Audit batch 3 closeouts (B1-F5, B4-F1, B7-F1, B7-F2, B7-F3)
- `44a2c3a` — Audit batch 2 (B3-F5, B4-F2, B6-F2)
- `78c198f` — B5-F2 invert proxy idle-timeout
- `474b3f0` — TRACKED_SECRETS shared source + Neon doc accuracy + cite-ground-truth feedback
- `67f9967` — Audit batch 1 (B2-F2, B2-F5, B3-F1, B7-F4)
- `1663b4f` — BILL slice 1: lib/bill.js + webhook scaffold + dedup table
- `280ff5d` — BILL design + probe

## Open user-action items from S188

- **Connor:** answer Q1–Q7 in `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`. Q5 (`wmkf_honorariumforrequest` lookup) blocks the portal-extension slice. Others can be answered async.
- **Steph (Director of Operations):** complete BILL.com sandbox access + admin account provisioning.
- **Justin:** check Neon billing tier (per S188 Neon doc cleanup — current docs are tier-aware, but WMKF's actual tier wasn't verified during the session). Operator-side.
- **Justin:** if `ANTHROPIC_ADMIN_API_KEY` should be set in prod for `pricing-refresh` to actually do drift checks, set it. Currently absent → cron will fire monthly, write a 'skipped' maintenance_runs row, no-op.

## Potential next steps for S189

### Path A — BILL portal-extension slice (chunk 4 of the BILL build)

Highest-leverage if Connor's answered Q5. The extension to `pages/api/external/review/[token]/respond.js`:
1. Add address fields to `contactEdits` schema
2. PATCH `contact.address1_*` from accept body
3. Create honorarium `akoya_request` with `wmkf_honorariumforrequest` provenance
4. Trigger `/api/bill/onboard-reviewer` inline

Followed by chunk 5 (Stage 2a UI address inputs), chunk 6 (the onboard-reviewer endpoint itself), chunk 7b (webhook→Dataverse PATCH once sandbox payload shape is known).

### Path B — Readiness-audit tail (10 of 27 still open)

Mostly operator-side or M-effort:
- **Operator-side:** B3-F2 INTAKE_BLOB_RW_TOKEN prod verify, B3-F3 virus scanning enable, B3-F4 DYNAMICS_IMPERSONATION_ENABLED
- **M-effort, needs staging:** B2-F4 migration idempotency probe
- **B8 dry-runs:** B8-DR1 intake smoke, B8-DR7 npm/depcheck, others
- **Out of scope per audit:** B6-W1, etc.

### Path C — Backend backlog (deferred multi-session work)

- **Staged Review Pipeline** (`docs/STAGED_PIPELINE_IMPLEMENTATION_PLAN.md`) — explicitly dormant pending cycle-redesign signal; don't start.
- **Proposal Context Extraction** (`docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`) — explicitly deferred until concrete deep-dive workflow needs it.
- **Interim Report Automation** — unblocked technically; needs Connor field decision before code.

## Key files reference

| File | Purpose |
|------|---------|
| `lib/bill/index.js` | BILL.com API wrapper public surface |
| `lib/bill/session.js` | Module-level session cache with cold-start serialization |
| `lib/bill/classify.js` | BDC error classification (rate-limit hourly vs concurrent, session-expired, etc.) |
| `pages/api/webhooks/bill.js` | Webhook scaffold — verify+dedup+log; no Dataverse writes in slice 1 |
| `lib/db/migrations/015_bill_webhook_events.sql` | Dedup table with UNIQUE(subscription_id, event_id) |
| `lib/utils/tracked-secrets.js` | NEW — canonical source for cron+admin TRACKED_SECRETS |
| `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` | Connor question doc + portal-integrated architecture |
| `docs/BILL_LIB_DESIGN.md` | v3 design for lib/bill — gets you up to speed if continuing the build |
| `.claude/skills/sweep/SKILL.md` | NEW — `/sweep` user-invokable doc-reconcile discipline |
| `.claude-memory/feedback-cite-ground-truth.md` | NEW — every external fact gets a citation |
| `.claude-memory/feedback-no-performative-contrition.md` | NEW — when caught in a mistake, lead with the fix not the analysis |
| `.claude-memory/project-bill-honorarium-integration.md` | NEW — project status + 7 Connor questions tracked |

## Testing

```bash
# Session-start sanity gates
npm run check:atlas                       # 31 PG / 32 DV ✓
npm run check:api-routes                  # 94 ✓
npm run check:fact-consistency            # 222 docs scanned ✓
npm run check:migrations-manifest         # 14 files ✓

# S188 new test suites
npx jest tests/unit/bill.test.js          # 50 pass
npx jest tests/unit/webhook-bill.test.js  # 28 pass

# Full unit suite
npx jest tests/unit                       # 1234 pass, 1 skipped → 0 skipped (apiKeyManager test unskipped S188)

# Dataverse probes (read-only)
node scripts/audit-dataverse-state.js     # verifies wmkf_appproposalsearchs deployed (was 404 pre-S188 fix to entity-set name)
node scripts/probe-bill-vendor-fields.js  # surveys contact/account/akoya_request BILL fields
```
