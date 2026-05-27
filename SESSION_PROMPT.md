# Session 192 Prompt: BILL portal-extension build (chunks 5+6) — pick up where S190 deferred

## ⏰ Time-sensitive carryovers (unchanged from S191; S191 didn't touch these)

### Operator-side action items still owed
1. **Configure `virus-detection` category in `/admin → Alert Recipients`** with `alerts@wmkeck.org` as the recipient. Until set, detection emails fall back to active superusers (Justin only). Seeded in the admin dropdown.
2. **Send DFT courtesy email** (drafted S190 chat) — "we enabled app-side scanning on the public upload paths; no per-detection emails to you." First-cycle aggregate stats due ~July.
3. **Verify post-deploy** that `VIRUS_SCAN_ENABLED=true` is actually live in production. Spot check with EICAR through the live reviewer flow.

### Cron verification still pending (S186 Phase 0 — first post-deploy fires)
S188–S191 didn't get to this. ~5-min SQL check:

```sql
SELECT job_name, status, started_at
FROM maintenance_runs
WHERE started_at > '2026-05-26'
ORDER BY started_at DESC LIMIT 20;
```

Want: `daily-maintenance` 03:00 UTC + `sweep-stale-invites` 09:00 UTC both `status='completed'` daily. `pricing-canary`/`pricing-refresh` first fire 2026-06-01. `drain-submissions` no row written.

### BILL reviewer-honorarium build status
- **Slice 1 SHIPPED S188**, all 7 Connor questions CLOSED S189.
- **Memory entry now CORRECT post-S191 audit**: `project-bill-honorarium-integration.md` shows chunks 2-3 + 7a SHIPPED; chunks 4-6 + 8 still pending.
- **Connor still owes:** `wmkf_HonorariumRequest` lookup on `wmkf_potentialreviewer` (gates chunk 4 specifically; chunks 5 + 6 can ship in parallel).
- **Steph still owes:** BILL.com sandbox access.
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.

### Q1 sandbox-time discovery (HARD GATES portal slice UX)
Unchanged from S189–S191: when sandbox lands, day-1 test = create a fresh test vendor with `email` populated; observe whether BILL auto-emails. Two hypotheses; portal slice UX depends on which is true.

## Session 191 Summary

Three workstreams shipped this session, all reactive to Codex review rounds — none of the original S191-prompt "Path A" (BILL chunks 4-6) was touched.

### What was completed

1. **S190 F-002 fail-closed regression closure** (`b5b5e7f`)
   - Codex review of S190's `f841013` flagged 1 P1 + 2 P2 regressions: trusted Dynamics reads in intake routes, staff sign-in `reconcileProfile`, and drain duplicate-PK recovery were calling `DynamicsService.queryRecords/getRecord` without an ALS context, hitting the new fail-closed `checkRestriction()`.
   - Wrapped 6 call sites in narrow `bypassDynamicsRestrictions('label', () => ...)`. New regression test `tests/unit/intake-routes-dynamics-context.test.js` (6 spy-based assertions). Codex follow-up review caught 2 more indirect misses (`NotificationService.sendAdminEmail`'s `resolveSystemUser` + `pages/api/test-email.js`); folded into the same fix.

2. **3 doc/code contradictions fixed** (`b5b7f3a` + `9eb31a6`)
   - `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md` claimed `/run` emits a short-lived public Blob URL; code actually emits an authenticated `/download` proxy URL backed by a private Blob store. Fixed across 5 sections.
   - `lib/services/intake-draft-service.js` header described an obsolete synchronous submit→Dynamics→delete-draft flow; actual flow is via `submission_jobs` drain queue.
   - `docs/INTAKE_PORTAL_DRAIN_PLAN.md` state-machine section described `dynamics_patched` + `status_flipped` as if shipped; both are in `BUILD_PENDING_STATES`. Annotated as TARGET + added a "Currently shipped" subsection.
   - Bonus: `dataverse-prefs-service.js` header KNOWN HAZARD wording (Codex follow-up found citation-line drift, fixed).

3. **CLAUDE.md slim** (`f92b1c0` + `ddfa5b4` + `dbbbe29` + `7204ce4` + `666fac7` + `538a0ff`)
   - 41,395 → 25,031 bytes (**−40%**), 321 → 283 lines.
   - New durable reference docs: `docs/CI_GATES_REFERENCE.md` (gate mechanics), `docs/SERVICE_AND_UTILITY_CATALOG.md` (~50-entry index), `docs/VIRTUAL_REVIEW_PANEL.md` (thin design doc to receive the trimmed app-table row's load-bearing facts).
   - Cuts 4 + 1 + 5 → Cuts 2 + 3 + 6 → Codex final-pass folding. "Codex authors plan, Claude reviews" inversion worked — Codex's audit precision caught the structural misses my optimism would have shipped.
   - Latent `file-magic.js` security-claim contradiction fixed in the same commit (MDO/Defender claim contradicted live tenant posture).

4. **Wave 1 dispatch cleanup** (`cd735c0` + `5c366fc`)
   - Closed the KNOWN HAZARD flagged in the prefs header: setting `WAVE1_BACKEND_PREFS=postgres` silently swallowed the dropped-table SQL error and returned `{}`. Theatrical fail-loud (the dispatch comment claimed loud, the catch blocks didn't).
   - Real fix in `database-service.js`: `assertWave1PrefsBackend()` module-load guard + delete all 6 dead Postgres prefs branches (−107 lines).
   - Discovered parallel bug in `settings-service.js` mid-fix; swept same pattern through both `settings-service.js` and `app-access-service.js` (−94 lines combined).
   - All three Wave 1 services now match the `grant-cycles-dataverse.js` W3 fail-loud pattern.

5. **Memory audit cycle** (`c27d677` + `a21114b` + `ffd5146`)
   - Codex audited 94-entry `.claude-memory/` store; 28 entries patched across 3 rounds.
   - **Round 1**: 19 stale claims + 3 broken wiki-links.
   - **Round 2**: 2 PARTIAL→CORRECT + 4 second-pass findings + systemic underscore-vs-hyphen sweep (12 references across 9 files).
   - **Round 3**: 6 P2 closures — post-S178 framing rot in intake-portal cluster (the slice-0 deploy made several "Connor in good-faith progress" / "naming alignment open" / "doc to be drafted" claims stale).
   - Notable: the very memory entry Codex caught first (`project-wave1-pending` claiming dead branches still existed) was made stale by THIS SESSION'S `cd735c0`/`5c366fc` 90 minutes earlier. Calibration win for the audit pattern.

### Commits this session (14, all pushed to `origin/main`)
```
ffd5146 Fold Codex memory-audit verification round 3 (closure)
a21114b Fold Codex memory-audit verification round 2
c27d677 Fold Codex memory audit: 19 stale claims + 3 broken wiki-links
5c366fc Wave 1 dispatch cleanup sweep: settings + app-access services
cd735c0 Clean up Wave 1 prefs dispatch: real fail-loud + delete dead Postgres branches
538a0ff Fold Codex final-pass findings: 7 P1 corrections
666fac7 Slim CLAUDE.md Cut 6: trim 3 verbose app-table rows + add VRP doc
7204ce4 Slim CLAUDE.md Cuts 2 + 3: Service + Utility catalogs extracted
dbbbe29 Add docs/SERVICE_AND_UTILITY_CATALOG.md
ddfa5b4 Port 2 service-header facts + fix file-magic.js security claim
f92b1c0 Slim CLAUDE.md: Cuts 4 + 1 + 5 + Codex citation fix
9eb31a6 Fold Codex S191 follow-up: 3 missed sites + 1 overclaim
b5b7f3a Fix 3 doc/code contradictions surfaced by Codex S191 review
b5b5e7f Wrap trusted Dynamics reads in ALS context per Codex S191 review
```

## Potential next steps for S192

### Path A — BILL portal-extension chunks 5 + 6 (the still-deferred original S190 target)
Chunk 4 (extend `respond.js` accept path) needs Connor's `wmkf_HonorariumRequest` lookup field on `wmkf_potentialreviewer`. Chunks 5 (Stage 2a UI with address inputs) and 6 (`/api/bill/onboard-reviewer` endpoint) can ship in parallel and wait for chunk 4 only at the wire-up step. **Three sessions deferred now — this is overdue if the 2026-06-10 ready date matters.**

### Path B — Verify virus-scan alerts in production
After Vercel deploy of `10ea86e`+ has landed, EICAR upload through live reviewer UI. Confirm rejection UX, `system_alerts` row in admin dashboard, email reaches `alerts@wmkeck.org` (assuming user has configured the category).

### Path C — Cron verification (S186 Phase 0 carryover)
~5 min SQL check. Just close it out.

### Path D — Apply the audit pattern to another surface
The "Codex authors plan, Claude reviews" inversion worked twice this session (CLAUDE.md slim + memory audit). Candidate next targets: the `docs/` directory (90+ docs, several likely stale), `scripts/` directory (audit/probe scripts may reference deleted entities), or `lib/dataverse/` schema specs.

### Path E — Readiness-audit tail (10/27 items still open)
Mostly operator-side decisions.

## Key files reference

| File | Purpose |
|------|---------|
| `docs/CI_GATES_REFERENCE.md` | NEW S191 — gate mechanics extracted from CLAUDE.md |
| `docs/SERVICE_AND_UTILITY_CATALOG.md` | NEW S191 — one-line index for `lib/services/`, `lib/external/`, `lib/bill/`, `lib/utils/` |
| `docs/VIRTUAL_REVIEW_PANEL.md` | NEW S191 — thin design doc for VRP (access posture, pipeline stages, provider policy, persistence) |
| `lib/services/dynamics-context.js` | `bypassDynamicsRestrictions` / `withDynamicsContext` — every trusted Dataverse read must enter one explicitly (header now carries the safety contract). |
| `lib/services/database-service.js` | Wave 1 prefs dispatch deleted; `assertWave1PrefsBackend()` at module load. |
| `lib/services/settings-service.js` | Same shape as prefs: `assertWave1SettingsBackend()` + delegate-only. |
| `lib/services/app-access-service.js` | Same shape: `assertWave1AppAccessBackend()` + delegate-only. |
| `lib/utils/file-magic.js` | Header now correctly states tenant has no MDO; Cloudmersive is PRIMARY defense, not DiD. |
| `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md` | `/run` delivery model now correctly describes authenticated `/download` proxy + private Blob store. |
| `docs/INTAKE_PORTAL_DRAIN_PLAN.md` | State-machine section now annotates shipped vs. TARGET handlers. |
| `lib/services/intake-draft-service.js` | Header now describes async submit→drain flow. |

## Testing (sanity gates)

```bash
npm run check:atlas                       # 31 PG / 32 DV ✓
npm run check:atlas:self-test             # 12/12 ✓
npm run check:api-routes                  # 94 ✓
npm run check:fact-consistency            # 231 docs scanned ✓
npm run check:prompt-storage-mentions     # 232 scanned ✓
npm run check:canonical-pointers          # 9 pointers verified ✓

# Pre-existing red (NOT this session): check:drain-table-mentions
# 7 fails in 3 unrelated audit docs (READINESS_AUDIT_*, THIRD_PARTY_LLM_*).
# Not in P0 gate set; doesn't block data-layer commits.
```

## Codex collaboration pattern (worth repeating)

Three rounds this session converged on this loop:
1. **Claude drafts the prompt** describing scope + constraints + skip list.
2. **Codex authors the plan/audit** (per-entry verdict + evidence + proposed fix).
3. **Claude reviews and pushes back** on judgment calls Codex can't make (e.g., "merge memos" vs. "keep as historical records").
4. **Claude implements** lifted from Codex's recommendations verbatim where safe.
5. **Codex verifies the implementation** independently; flags missed sites + new staleness introduced.

The inversion (Codex authors, Claude reviews) is structurally right for any task where my failure mode is overconfidence on "X already lives in Y" — i.e., doc audits, memory audits, codebase-wide sweeps. Codex caught real misses in every round.
