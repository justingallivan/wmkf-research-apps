# Session 193 Prompt: BILL chunk 5 (Stage 2a address-input UI) — parallel to shipped chunk 6

## ⏰ Time-sensitive carryovers

### Operator-side action items (unchanged from S190–S192)
1. **Configure `virus-detection` category in `/admin → Alert Recipients`** with `alerts@wmkeck.org` as recipient. Until set, detection emails fall back to active superusers (Justin only).
2. **Send DFT courtesy email** (drafted S190) — "we enabled app-side scanning on the public upload paths; no per-detection emails to you." First-cycle aggregate stats due ~July.
3. **Verify post-deploy** `VIRUS_SCAN_ENABLED=true` is live in production via EICAR through reviewer UI.

### BILL reviewer-honorarium build status
- **Chunks SHIPPED:** 2-3 (`lib/bill/`), 7a (webhook scaffold), **6 (S192 — `/api/bill/onboard-reviewer` endpoint + service)**.
- **Chunks PENDING:** 4 (extend respond.js — blocked on Connor), 5 (Stage 2a UI address inputs — independent, **S193 target**), 8 (E2E sandbox test — blocked on Steph).
- **Connor still owes:** `wmkf_HonorariumRequest` lookup on `wmkf_potentialreviewer` (gates chunk 4 only).
- **Steph still owes:** BILL.com sandbox access.
- **`BILL_ENABLED=false` default** in chunk 6 → ships in alert-only fallback mode until sandbox + option-set probe land. See `scripts/probe-bill-option-set-values.js`.
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

### Q1 sandbox-time discovery (HARD GATES portal slice UX)
Unchanged from S189–S192: when sandbox lands, day-1 test = create a fresh test vendor with `email` populated; observe whether BILL auto-emails. Two hypotheses; portal slice UX depends on which is true.

## Session 192 Summary

Two threads. One reactive (maintenance-cron incident + cron-verification close-out + escalation-gap fix), one planned (BILL chunk 6 with full Codex pre-impl + post-impl review cadence).

### What was completed

1. **Maintenance-cron incident response** (`9022ee1`)
   - 03:00 UTC alert email: `daily-maintenance` failed because `bill_webhook_events` table didn't exist in prod (migration 015 added S188 was never applied).
   - User applied migration via `node --env-file=.env.local scripts/apply-migrations.js`.
   - Confirmed the cold-start `migration-drift` check **did** fire at 2026-05-26T10:36Z (alert 153, `severity=warning`) but sat 17h in DB-only state until the cron blew up.
   - **Root cause of escalation gap:** `lib/utils/migration-drift.js` called `AlertService.createAlert` directly instead of `NotificationService.notify` (sibling `auth-bypass-monitor.js` already used the right pattern). Plus `severity=warning` wouldn't have emailed even if it had — NotificationService.notify only emails on error/critical.
   - **Fix:** both drift alert paths now route through `NotificationService.notify` with `category: 'ops'`; `migration_drift` bumped `warning → error` since a missing migration materializes as broken features within hours.

2. **Cron-verification (S186 Phase 0 carryover) closed** (`8099f60`)
   - Walked back an analytical error mid-investigation: my "+7h schedule drift" claim for two crons was actually a read-side bug — `maintenance_runs.started_at/completed_at` were `timestamp` (not `timestamptz`), so the pg driver interpreted stored UTC numbers as local-time on my reading machine (PDT, +7h).
   - All 12 configured crons fire on their actual UTC schedules.
   - One real gap: `reconcile-identities` handler never called `MaintenanceService.startRun`/`completeRun`, so Monday's fire had no audit trail. Patched to match `auth-bypass-check.js` pattern.

3. **BILL chunk 6 SHIPPED** (`6e709cb` + `a343f3e`)
   - Full Codex pre-impl + post-impl review cadence. Design doc → 6 P1/P2 catches folded → implementation → 5 P1 + 1 P2 post-impl catches folded.
   - **Endpoint:** `POST /api/bill/onboard-reviewer`. Internal HMAC auth (`BILL_INTEGRATION_SECRET`, ≥32 chars), raw-body verify, canonical `v1:${timestamp}:${nonce}:${rawBody}` signing string, ±300s skew window.
   - **Status taxonomy:** `onboarded` / `reused_existing` / `no_match` / `ambiguous_match` / `alert_only` / `bill_unavailable` / `partial` (with `intendedStatus` preservation on Dataverse-PATCH failure after BILL-side work).
   - **Failure handling:** phase-tagged (`vendor_create` / `network_search` / `network_invite`); `safeNotify` wrapper so alert-backend failures can't escalate to route 500; contact PATCH gets 1 retry (idempotency primitive); request PATCH gets none.
   - **Default posture:** `BILL_ENABLED=false` → alert-only fallback mode; ships independent of Steph's sandbox.
   - 20/20 unit tests pass. proxy.js allowlist + API matrix entry + tracked-secrets promoted from `forward` → `hmac`.

4. **Memory hygiene** (`bef76bd`)
   - User caught me breaking `feedback-share-codex-verbatim` on BOTH Codex round-trips this session — paraphrased into bullets, dropped `agentId:` footer, prepended framing.
   - Strengthened memory entry with S192 recurrence + diagnostic ("rule breaks when folding catches feels more salient than delivery format") + mitigation ("paste is a mechanical tool-result copy, folding happens in the next turn").
   - User invoked `/sweep` to force reconciliation; surfaced the pre-impl Codex output retroactively (the post-impl was already pasted in the acknowledgment turn).

5. **maintenance_runs → timestamptz** (`89233ba`, migration 016)
   - The cosmetic fix from the cron-verification investigation. Both columns now `timestamptz`; existing UTC values retagged via `AT TIME ZONE 'UTC'` — metadata-only conversion. `/admin` maintenance dashboard now shows correct wall-clock for non-UTC operators.

### Commits this session (6, all pushed)
```
89233ba maintenance_runs timestamps → timestamptz
bef76bd Strengthen feedback-share-codex-verbatim with S192 recurrence
a343f3e Fold Codex post-impl review on BILL chunk 6: 5 P1 + 1 P2
6e709cb BILL chunk 6: /api/bill/onboard-reviewer endpoint + service
8099f60 Add maintenance_runs audit trail to reconcile-identities cron
9022ee1 Route migration-drift alerts through NotificationService
```

## Potential next steps for S193

### Path A — BILL chunk 5 (Stage 2a UI with address inputs) [RECOMMENDED]
Chunk 6 design context is still fresh. Chunk 5 is independent of Connor's pending field. Touches `pages/external/review/[token]/*` to add address form fields that respond.js will pass through to chunk 6's endpoint in chunk 4. Few-hundred-LOC build; Codex pre+post review cadence applies.

### Path B — Verify virus-scan alerts in production
EICAR through live reviewer UI; confirm rejection UX, `system_alerts` row, email reaches `alerts@wmkeck.org`. ~15 min if deploy is live and the alert category is configured.

### Path C — Codex-authors / Claude-reviews audit
Pattern worked twice in S191 (CLAUDE.md slim + memory audit). Candidates: `docs/` (90+ docs, several likely stale), `scripts/`, `lib/dataverse/` schema specs.

### Path D — Readiness-audit tail (10/27 items)
Mostly operator-side.

## Key files reference

| File | Purpose |
|------|---------|
| `pages/api/bill/onboard-reviewer.js` | NEW S192 — BILL onboarding route, HMAC auth, raw-body verify |
| `lib/bill/onboard-reviewer-service.js` | NEW S192 — pure orchestrator with phase-tagged failure handling + safeNotify wrapper |
| `lib/bill/internal-call-auth.js` | NEW S192 — sign/verify helpers for the internal HMAC call |
| `lib/bill/option-set-values.js` | NEW S192 — env-driven option-set ints with fail-loud assertion |
| `scripts/probe-bill-option-set-values.js` | NEW S192 — one-off Dataverse probe; run before flipping `BILL_ENABLED=true` |
| `docs/BILL_CHUNK_6_ENDPOINT_DESIGN.md` | NEW S192 — design doc with Codex pre-impl review folded |
| `lib/utils/migration-drift.js` | Drift check now routes through NotificationService; both alert types are `severity: error` |
| `pages/api/cron/reconcile-identities.js` | Now writes maintenance_runs audit trail |
| `lib/db/migrations/016_maintenance_runs_timestamptz.sql` | NEW S192 — column type fix |
| `.claude-memory/feedback-share-codex-verbatim.md` | Strengthened with S192 recurrence + mitigation |

## Testing (sanity gates)

```bash
npm run check:atlas                       # 31 PG / 32 DV ✓
npm run check:api-routes                  # 95 ✓ (was 94 — chunk 6 added)
npx jest tests/unit/bill                  # 79/79 ✓ (was 75 — chunk 6 added 4 over S188's 75)
```

## Codex cadence notes (continued from S191)

Two more clean rounds this session, both pre-impl + post-impl. The inversion holds for design review (Codex catches architectural gaps Claude's optimism would have shipped). **But:** `feedback-share-codex-verbatim` failed twice mid-cadence; the memory entry now records this specifically. For S193's chunk 5 cycle: paste each Codex stdout verbatim as the ENTIRE turn (no prefacing), then fold in a separate turn.
