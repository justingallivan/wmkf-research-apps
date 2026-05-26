# Session 191 Prompt: BILL portal-extension build (chunks 4–6) — virus-detection alerts deploy

## ⏰ Time-sensitive carryovers

### Action items from S190 user-facing
1. **Configure `virus-detection` category in `/admin → Alert Recipients`** with `alerts@wmkeck.org` as the recipient. Until set, detection emails fall back to the active superuser roster (Justin only). The category appears in the seeded list now so it's discoverable.
2. **Send DFT courtesy email** (drafted in S190 chat) — "we enabled app-side scanning on the public upload paths, here's the architecture, no per-detection emails to you." First-cycle aggregate stats due ~July.
3. **Verify post-deploy** that the Vercel build from `10ea86e` shipped clean and `VIRUS_SCAN_ENABLED=true` is actually live in production. Spot check by uploading an EICAR file through the reviewer flow if a test path is convenient.

### Codex follow-up findings still open
S190 ran two Codex review rounds against the virus-scan detection-alert work. The first round surfaced 9 findings; 6 were fixed in `8070d18`, 3 were deferred or pushed back on:
- **P2 #3 PII in alert metadata** — deferred (justified: internal-audience email, metadata level matches malware-triage forensics). Reconsider if external review pressure mounts.
- **P3 #8 log-on-throw test coverage** — skipped (low value, tests implementation not contract).
- **P2 #6 await vs fire-and-forget** — intentional design choice (await both paths for system_alerts durability under Fluid Compute termination). Codex re-reviewed and ACK'd.

The full review doc lives at `docs/CODEX_REVIEW_CLAUDE_AUDIT_FIXES_2026_05_26.md`. User noted "we are going to have to make some additional changes based on Codex findings in another window" — those are independent of the 9-finding list above and should be addressed when that window catches up.

### Cron verification still pending (S186 Phase 0 — first post-deploy fires)
S188 / S189 / S190 didn't get to this. Verify now:
- **`daily-maintenance`** — fires 03:00 UTC daily. Want: `status='completed'`, no `cleanupExpiredCache` error.
- **`sweep-stale-invites`** — fires 09:00 UTC daily.
- **`pricing-canary`** — first fire 2026-06-01 10:00 UTC.
- **`pricing-refresh`** — first fire 2026-06-01 11:00 UTC; skipped-mode row will appear if `ANTHROPIC_ADMIN_API_KEY` is unset (expected today).
- **`drain-submissions`** — no `maintenance_runs` write; tail Vercel logs if intake traffic appears.

Quick check: `SELECT job_name, status, started_at FROM maintenance_runs WHERE started_at > '2026-05-26' ORDER BY started_at DESC LIMIT 20`.

### BILL reviewer-honorarium build status (unchanged from S190)
- **Slice 1 SHIPPED S188** — `lib/bill/*`, `pages/api/webhooks/bill.js` scaffold, migration `015_bill_webhook_events.sql`.
- **All 7 Connor questions CLOSED S189.** Build can proceed.
- **Connor still owes:** `wmkf_HonorariumRequest` lookup on `wmkf_potentialreviewer` (gates BILL chunk 4 specifically), check-in flag field name, tuition cap rule, post-create PA enrichment flow build.
- **Steph still owes:** BILL.com sandbox access + admin account provisioning.
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

### Q1 sandbox-time discovery (HARD GATES portal slice UX)
Unchanged from S189/S190: when sandbox access lands, day-1 test = create a fresh test vendor with `email` populated for an address we control; observe whether BILL auto-emails. Two hypotheses; portal slice's UX framing depends on which is true.

## Session 190 Summary

Three streams shipped this session — all unrelated to the S190 prompt's "Path A" BILL portal-extension target, which was not touched.

### What was completed

1. **F-001 + F-002 from the 2026-05-26 third-party LLM audit** (`f841013`)
   - F-001: Added `this.checkRestriction(tableName)` to `DynamicsService.getEntityRelationships` so it has parity with `getEntityAttributes`. Closes the relationship-metadata leak gap.
   - F-002: Completed the Dynamics restrictions AsyncLocalStorage migration. Added `enterDynamicsBypassForScript` (ALS `enterWith` for single-process scripts; JSDoc-flagged SCRIPT-ONLY). Migrated 32 scripts off the deprecated `DynamicsService.bypassRestrictions`. Deleted module-level globals + static shims. `checkRestriction()` now fails closed when no ALS context is set.
   - New tests at `tests/unit/dynamics-service-restrictions.test.js` (4 tests pin F-001 parity + fail-closed + bypass-scope contract).
   - 50/50 affected-area tests pass.

2. **Audit cycle artifact docs** (`d1c4620`)
   - Kept the four durable artifacts: corrected findings packet, augmented audit prompt, follow-up prompt, practice-improvement prompt. Discarded three first-pass + amended + self-improvement reports as superseded.

3. **Virus-scan detection alerts** (`ab38b03`, `052f85e`, `8070d18`, `10ea86e`)
   - DFT confirmed WMKF tenant has NO MDO / no Safe Attachments for SharePoint; only workstation Defender + Huntress on staff devices. App-side Cloudmersive is the **primary** defense for public upload paths (reviewer, intake), not defense-in-depth.
   - Server: on `scan_result === 'infected'` either path, write a `system_alerts` row and send an email. Recipients are the union of (a) category-routed recipients configured in `/admin → Alert Recipients` under category `virus-detection`, and (b) per-event explicit recipients — the PD on the related `akoya_request` for the reviewer path (when resolvable via suggestion → request → wmkf_programdirector → systemuser). Intake path has no per-event PD because drafts are pre-submission.
   - `NotificationService.sendAdminEmail` now unions category + explicit recipients and dedupes. Was "explicit-bypasses-category" pre-S190.
   - Reviewer client UX: dedicated banner on `reason:'infected'` ("file rejected, your typed review is preserved, please scan your machine and try a clean copy"). External token page + staff review-manager modal both updated.
   - Intake UI doesn't exist yet (`pages/apply/index.js` is smoke-test only); UX contract documented in `docs/INTAKE_PORTAL_DESIGN.md` § "Scanner returns infected" for the future builder.
   - Both detection paths await the notify call so the `system_alerts` row is durable before the client response (Fluid Compute can terminate the function after response, killing a fire-and-forget promise mid-write).
   - HTML-escapes user-controlled values (filenames especially) in the email body — closes a Codex-flagged injection vector.
   - 149/149 tests pass across affected files.
   - **EICAR smoke test passed locally** (7/7 — clean returns clean, EICAR detected as `Eicar-Test-Signature`, ~1.3s round-trip). API key + flag already in Vercel env.

### Commits this session
```
10ea86e Save Codex audit-fix review doc for follow-up work
8070d18 Codex 2026-05-26 review followups on virus-detection alerts
052f85e Route virus-scan alerts via admin category config, not hardcoded const
ab38b03 Wire virus-scan detection alerts on reviewer + intake paths
d1c4620 Audit cycle artifacts: spec pointer + reusable next-round prompts
f841013 Ship F-001 + F-002 from 2026-05-26 audit
```

All pushed to `origin/main`.

## Potential next steps for S191

### Path A — BILL portal-extension build (the deferred S190 target, most leverage)
Chunks 4–6 of the BILL build. Chunk 4 (extending `respond.js` accept path) needs Q5's lookup field from Connor (`wmkf_HonorariumRequest` on `wmkf_potentialreviewer` → `akoya_request`). Chunks 5 (UI) and 6 (`/api/bill/onboard-reviewer`) can ship in parallel and just wire the lookup binding once Connor adds the field.

### Path B — Verify virus-scan alerts in production
After Vercel deploy of `10ea86e` lands, run an end-to-end EICAR test by uploading through the live reviewer UI. Confirm the rejection UX renders correctly, `system_alerts` row appears in admin dashboard, email reaches `alerts@wmkeck.org` (assuming user has configured the category).

### Path C — Address Codex follow-up findings (in the "other window")
User mentioned additional Codex findings to address in a separate window. When that converges, fold the fixes back. The 9-finding round-1 + 8-PASS round-2 lineage lives in `docs/CODEX_REVIEW_CLAUDE_AUDIT_FIXES_2026_05_26.md`.

### Path D — Cron verification (S186 Phase 0 carryover)
~5 minutes. Just run the SQL check above and confirm the post-deploy fires landed clean.

### Path E — Readiness-audit tail
10 of 27 items still open (B3-F2 INTAKE_BLOB_RW_TOKEN prod verify, B3-F3 virus scanning enable — this is now PARTIALLY DONE, B3-F4 DYNAMICS_IMPERSONATION_ENABLED, etc.). Mostly operator-side decisions.

## Key files reference

| File | Purpose |
|------|---------|
| `lib/services/dynamics-context.js` | Restriction context: `withDynamicsContext` (callback-scoped, route-safe) + `enterDynamicsBypassForScript` (ALS `enterWith`, SCRIPT-ONLY). `getDynamicsContext()` consumed by `DynamicsService.checkRestriction` which fails closed without it. |
| `lib/services/notification-service.js` | `notify` + `sendAdminEmail` now accept `explicitRecipients`, unioned with category-routed recipients. `_formatEmailBody` HTML-escapes user-controlled fields. |
| `lib/services/program-director-resolver.js` | Adds `resolveProgramDirectorEmailForRequest(requestId)` — Dataverse chain akoya_request → systemuser → email. 10-min cache. |
| `lib/services/review-upload.js` | `fireReviewDetectionAlert` helper fires on `infected`, routes to PD when resolvable. `runVirusScans` now returns `infectedErrors` on every failure envelope (decoupled from response-reason precedence). |
| `pages/api/intake/draft/attach.js` | Detection alert at the end of step 18; awaits notify for durability. |
| `shared/components/external/MaterialsView.js`, `pages/review-manager.js` | Client UX for `reason:'infected'` — preserves form text, shows actionable banner. |
| `lib/services/alert-recipients.js` | `virus-detection` added to `SEED_CATEGORIES` for admin-UI discoverability. |
| `docs/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md` | Spec the F-001 + F-002 commit points to. |
| `docs/CODEX_REVIEW_CLAUDE_AUDIT_FIXES_2026_05_26.md` | Codex review of `ab38b03` + `052f85e`. 9 findings; 6 addressed in `8070d18`; 3 deferred (justified above). |
| `.claude-memory/project-virus-scanning-it-context.md` | DFT context + locked S190 design decisions for future-session lookup. |

## Testing

```bash
# Session-start sanity gates
npm run check:atlas                       # 31 PG / 32 DV ✓
npm run check:api-routes                  # 94 ✓
npm run check:fact-consistency            # 228 docs scanned ✓

# Virus-scan unit tests touched this session
npx jest tests/unit/review-upload.test.js                          # 45 pass
npx jest tests/unit/intake-attach-endpoint.test.js                 # 61 pass
npx jest tests/unit/notification-service-explicit-recipients.test.js  # 7 pass
npx jest tests/unit/alert-recipients.test.js                       # asserts virus-detection in seeds

# F-001 / F-002 tests
npx jest tests/unit/dynamics-service-restrictions.test.js          # 4 pass (F-001 parity + fail-closed)
npx jest tests/unit/dynamics-context.test.js                       # 5 pass
npx jest tests/unit/dynamics-service-caller-id.test.js             # 14 pass

# EICAR smoke test (round-trips Cloudmersive)
node scripts/smoke-virus-scan.mjs                                  # 7/7 pass
```
