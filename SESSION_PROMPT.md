# Session 190 Prompt: BILL portal-extension build (chunks 4–6) — Connor sign-off complete

## ⏰ Time-sensitive carryovers

### Cron verification still pending (S186 Phase 0 — first post-deploy fires)
S186 deploy landed 2026-05-25. S188 and S189 didn't get back to this — verify these now:

- **`daily-maintenance`** — fires 03:00 UTC daily. Want: `status='completed'`, no `cleanupExpiredCache` error.
- **`sweep-stale-invites`** — fires 09:00 UTC daily. Want: a `maintenance_runs` row exists.
- **`pricing-canary`** — fires Mondays 10:00 UTC. First fire 2026-06-01 10:00 UTC.
- **`drain-submissions`** — no `maintenance_runs` write; tail Vercel logs if intake traffic appears.
- **`pricing-refresh`** — NEW S188 wiring. Now writes `maintenance_runs` (was silent before — B4-F2 fix). First fire 2026-06-01 11:00 UTC. Skipped-mode row will appear if `ANTHROPIC_ADMIN_API_KEY` is unset (expected today).

Quick check: `SELECT job_name, status, started_at FROM maintenance_runs WHERE started_at > '2026-05-26' ORDER BY started_at DESC LIMIT 20`.

### BILL reviewer-honorarium build status (post-S189)
- **Slice 1 SHIPPED S188** — `lib/bill/*`, `pages/api/webhooks/bill.js` scaffold, migration `015_bill_webhook_events.sql`, `cleanupBillWebhookEvents` wired into daily maintenance. 78 unit tests.
- **All 7 Connor questions CLOSED S189 (live walkthrough 2026-05-26).** Answers folded into `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`. Status banner flipped to "build can proceed."
- **Q5 final shape:** lookup `wmkf_HonorariumRequest` on `wmkf_potentialreviewer` → `akoya_request` (junction → honorarium direction; per Connor's refinement).
- **Connor adds Q1 (`akoya_isvendor=true` flip), Q5 lookup field, and a post-create PA enrichment flow** — non-gating except Q5 gates BILL chunk 4 specifically.
- **Steph operator-side:** BILL.com sandbox access + admin account provisioning still in flight.
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

### Q1 sandbox-time discovery (HARD GATES the portal slice's "no separate trip" UX promise)
Per `docs/BILL_LIB_DESIGN.md` Q1: BILL v3 API has no documented "email this person to join the network" path. When sandbox access lands, day-1 test = create a fresh test vendor with `email` populated for an address we control; observe whether BILL auto-emails. Two hypotheses; portal slice's UX framing depends on which is true.

### Intake portal handoff Q1–Q4 status (post-S189)
- **All 4 questions CLOSED S189 (live walkthrough 2026-05-26).** Answers folded into `docs/INTAKE_PORTAL_CONNOR_Q1_Q4_DRAFT.md`. Email was never sent — superseded by walkthrough.
- **Q1:** `wmkf_phaseistatus = 100000000` (Pending Committee Review). Existing.
- **Q2:** Three contact-role fields (`wmkf_projectleader`, `akoya_primarycontactid`, `wmkf_researchleader`) all `contact` entity, all required at submission, all sourced from project-team form, no fallback (submission validation blocks).
- **Q3:** N/A — existing PA flow handles visibility via a separate check-in flag. Portal does NOT touch any view filter or the flag at create.
- **Q4:** Recompute flow not built yet; non-gating. Evidence TBD post-build.

### Field Set D label collision RESOLVED S189
Connor walkthrough 2026-05-26: canonical Field Set D = PD Assignment; fit-assessment pair (`wmkf_ai_fitassessment` + `wmkf_ai_fitrationale`) relabeled to **Field Set E**. Fields and deployment unchanged — only the label moved. `check:memory-drift` now runs green.

## Session 189 Summary

Two-stream walkthrough session with Connor in the room:

### What was completed

1. **BILL honorarium design — all 7 Connor questions closed** (`923339d`)
   - Q1 yes + flip `contact.akoya_isvendor=true` at onboarding
   - Q2 yes (PNI write on portal-created rows)
   - Q4a yes (`wmkf_exisitngbillcomaccount` status writes)
   - Q4b leave `wmkf_vendorverified` + `wmkf_paymentcontactconfirmed` untouched
   - Q5 yes WITH refinement: lookup `wmkf_HonorariumRequest` lives on the junction `wmkf_potentialreviewer`, target `akoya_request` (junction → honorarium direction). Body example + chunk-1 build entry updated.
   - Q6 yes (adopt grant-vs-honorarium terms internally)
   - Q7 GOapply form JSON folded — full field-by-field mapping shows our portal already subsumes the form
   - Plus: discriminator expanded to include `wmkf_request_type = Individual (682090001)`, confirmed by the GOapply hidden-field default
   - Plus: new section + chunk 1b for Connor's post-create PA enrichment flow (non-gating; field list TBD)

2. **Intake portal Q1–Q4 walkthrough — all closed** (`611787c`)
   - Q1 `wmkf_phaseistatus = 100000000` (Pending Committee Review), existing picklist (verified live via `probe-picklist.js`)
   - Q2 uniform across all three contact-role fields: contact / required / project-team-row / submission blocks if missing
   - Q3 moot — Connor's existing PA flow handles staff visibility via a separate check-in flag
   - Q4 recompute flow not built yet, non-gating; evidence captured post-build

3. **Field Set D label collision resolved** (`bc35d1f`)
   - Canonical Field Set D = PD Assignment (per v3 spec)
   - Fit-assessment pair relabeled to Field Set E
   - Updated: atlas page (banner + line), v3 spec (new Set E section), `CLAUDE.md` gate note, `dataverse-export-floor-scoping.md` memory
   - `check:memory-drift` now runs green (was red-by-design for ~1 month)
   - Gates verified green post-edits

### Commits
- `bc35d1f` — Resolve Field Set D label collision (Connor walkthrough)
- `611787c` — Fold Connor's Q1-Q4 answers into intake-portal handoff draft
- `923339d` — Fold Connor's answers into BILL honorarium design doc

## Open user-action items from S189

### Connor (in priority order)
1. **Add `wmkf_HonorariumRequest` lookup** on `wmkf_potentialreviewer` → `akoya_request` — gates BILL chunk 4 specifically. Field name + direction locked in design doc.
2. **Field name of the check-in flag** on `akoya_request` that gates staff visibility — defensive only (portal needs to explicitly leave it unset).
3. **Tuition cap rule** — fixed-$ vs % of budget decision (recorded in `BUDGET_FORM_SPEC.md`).
4. **Build post-create PA enrichment flow** on honorarium `akoya_request` (field list TBD; non-gating).
5. **Build prod Option A′ recompute flow** against real `wmkf_proposalbudgetline` (post-deploy P4; non-gating for portal).
6. **Q4 verification evidence** after #5 (flow run IDs, SdkMessage, parent GUIDs, affected children).

### Steph
- Complete BILL.com sandbox access + admin account provisioning.

### Justin
- Check Neon billing tier (carried from S188).
- If `ANTHROPIC_ADMIN_API_KEY` should be set in prod for `pricing-refresh` drift checks, set it (carried from S188).

## Potential next steps for S190

### Path A — BILL portal-extension build (most leverage)
Chunks 4–6 of the BILL build. Chunk 4 (extending `respond.js` accept path) needs Q5's lookup field from Connor. Chunks 5 (UI) and 6 (`/api/bill/onboard-reviewer`) can ship in parallel and just wire the lookup binding once Connor adds the field.

### Path B — Readiness-audit tail (10 of 27 still open)
Mostly operator-side or M-effort:
- **Operator-side:** B3-F2 INTAKE_BLOB_RW_TOKEN prod verify, B3-F3 virus scanning enable, B3-F4 DYNAMICS_IMPERSONATION_ENABLED
- **M-effort, needs staging:** B2-F4 migration idempotency probe
- **B8 dry-runs:** B8-DR1 intake smoke, B8-DR7 npm/depcheck, others

### Path C — Backend backlog (deferred multi-session work)
- **Staged Review Pipeline** — explicitly dormant pending cycle-redesign signal; don't start.
- **Proposal Context Extraction** — explicitly deferred until concrete deep-dive workflow needs it.
- **Interim Report Automation** — unblocked technically; needs Connor field decision before code.

## Key files reference

| File | Purpose |
|------|---------|
| `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` | Connor answers + portal-integrated architecture (all 7 Qs closed) |
| `docs/INTAKE_PORTAL_CONNOR_Q1_Q4_DRAFT.md` | Connor answers folded; email never sent |
| `docs/atlas/dataverse-akoya-request.md` | Field Set D collision banner now ✅ resolved |
| `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` | New "Field Set E — Fit Assessment" section |
| `lib/bill/index.js` | BILL.com API wrapper public surface (shipped S188) |
| `pages/api/webhooks/bill.js` | Webhook scaffold (shipped S188; no Dataverse writes yet) |

## Testing

```bash
# Session-start sanity gates
npm run check:atlas                       # 31 PG / 32 DV ✓
npm run check:api-routes                  # 94 ✓
npm run check:fact-consistency            # 223 docs scanned ✓
npm run check:memory-drift                # CLEAN ✓ (was red, now green)

# Live picklist probe (used in S189 to verify Q1)
node scripts/probe-picklist.js akoya_request.wmkf_phaseistatus

# Existing BILL test suites
npx jest tests/unit/bill.test.js          # 50 pass
npx jest tests/unit/webhook-bill.test.js  # 28 pass
```
