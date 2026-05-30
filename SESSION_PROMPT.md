# Session 203 Prompt: open board (Explorer Path A complete; soak still traffic-blocked)

## ⏰ Standing context / guardrails (carried from S197–S202)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity words into docs/memory. S202 earned its keep: probing instead of trusting falsified TWO assumptions (the `/$count` bug is total, not filter-only; the prompt's `akoya_folio` "casing inconsistency" never existed).
- **Codex stop-time review gate is ENABLED.** S202 ran an explicit post-impl review + a fix re-review (both folded, final GO). Keep using it.
- **Measure before building** (Explorer). S202 ran the soak first, confirmed the deferral (only +4 calls / +0 errors since S200), then built A3/A4/A5 on the unchanged error *shape* — a deliberate, user-approved override, not a hunch.
- **Push deploys to prod.** `main` auto-deploys on Vercel. S202's commit is pushed (HEAD `bf43cc4`).
- **rtk grep filter: keep it DISABLED.** During S202 the rtk-compressed "PASS (N) FAIL (M)" summary hid *which* tests failed — had to dump jest to a file and Read it. If test/grep output looks compressed or off, write to a temp file and Read it. See `.claude-memory/project-rtk-grep-output-corruption.md`.

## Session 202 Summary

Picked up "item 1" (Explorer soak), which the S201 prompt framed as "leave it / deferred." Ran the soak first — confirmed frozen data (1471 vs 1467 calls / 392 vs 392 errors since S200) — so the deferral held. User then chose to build the deferred **A3/A4/A5** Path A slices anyway, on the unchanged error *shape* (fiscalyear 88 / akoya_grant 30 / date-fns 27). A live probe reshaped the work. All shipped, Codex-reviewed (2 findings folded), pushed.

### A3 — robust counts (`lib/services/dynamics-service.js`)
A live probe (`scripts/probe-akoya-folio-casing.js`) showed `/$count` is broken **both** ways on this instance: caps at 5000 unfiltered AND throws `Edm.Int32` on any filter. `countRecords` REPLACED (not a narrow interim) with `$apply=filter(...)/aggregate(<pk> with countdistinct as value)` — true counts 9120/22580 past the cap. PK from new `getPrimaryIdAttribute` (`PrimaryIdAttribute` added to `getEntityDefinitions` $select; `primaryIdMap` dual-keyed by logical + entity-set name; reset in `clearCaches`). Fails loud past the 50k `$apply` ceiling → **>50k unbounded count is the still-deferred FetchXML/paging tail.**

### A4 — domain guardrails + folio reconciliation (`shared/config/prompts/dynamics-explorer.js`)
New `buildDomainGuardrails()` injects an anti-confabulation block (primary contact = foundation liaison ≠ PI; PI program-conditional; `createdon` ≠ business date; status classes), with lists derived **by reference** from `lib/services/dataverse-export/constants.js` (`ERA_CUTOVER_DATE`, `TERMINAL_NON_AWARD_STATUSES`, `PER_PROGRAM_ANNOTATION`) — no value transcription. Probe **falsified** the prompt's `akoya_folio` casing claim: only `"PAID"` exists, Dataverse `eq` is case-insensitive, `contains()` unnecessary. Reconciled across the prompt, `TABLE_ANNOTATIONS`, and `docs/DYNAMICS_SCHEMA_ANNOTATION.md`.

### A5 — fail-loud typed errors (`pages/api/dynamics-explorer/chat.js`)
New `classifyToolError` turns a Dynamics unknown-field/entity 400 into a typed result (`errorType` + `invalidField` + closest valid field names via `closestFieldNames` + `describe_table` pointer), replacing the bare error string in the `executeOne` catch. Edm.Int32 false-positive guard; normalization inside the try so enrichment never masks the original error.

### Codex review (2 findings, both folded + regression-tested, re-review GO)
- **[MEDIUM]** `count_records` regressed for `systemuser` (the only annotated table missing from `KNOWN_ENTITY_SETS`) → added the mapping + dual-keyed `primaryIdMap` + `getPrimaryIdAttribute` dual lookup.
- **[LOW]** A5 enrichment skipped entity-set aliases (`akoya_requests`) → logical-name normalization in `classifyToolError`.

### Final state
Suite **1544 green** (+11 new), lint **0 errors / 50 warnings**, all 4 CI gates green. Plan doc `docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md` + memory `project-dynamics-explorer-reuse-power-tools.md` updated.

### Commits
- `bf43cc4` — Dynamics Explorer Path A: A3 robust counts + A4 guardrails/folio + A5 typed errors (incl. Codex folds)

## Potential Next Steps

### 1. Explorer soak — STILL traffic-blocked (not effort-blocked)
The real measurement (error-rate drop + validator catch-rate after A3/A4/A5 + the S200 validator deploy) needs accrued traffic. As of 2026-05-30 the aggregate was frozen (+4 calls since S200). **Do not re-measure on thin data.** When traffic accrues, note the soak script (`scripts/analyze-dynamics-explorer-failures.js`) does NOT split pre/post-deploy and the `ODATA_VALIDATOR_REJECT` catch signal lives in Vercel logs, not `dynamics_query_log` — a clean soak needs a date-split or log analysis.

### 2. Explorer A3 >50k tail (deferred)
The unbounded (>50k row) count still needs the OData→FetchXML shim / record-paging. Only matters for the largest tables (most are <50k). Scope as its own sub-phase if a real >50k count question surfaces.

### 3. BILL chunk-5 tail (non-coding / ops) — unchanged from S201
- Office question (open): does BILL.com self-registration capture the remittance address? If yes, Stage 2a address fields come back out (server treats address as optional). See `.claude-memory/project-reviewer-address-collection-provisional.md`.
- Ops before `BILL_ENABLED=true`: migration `017`, probe + set `HONORARIUM_*`/`BILLCOM_ACCOUNT_*`, set `honorarium.default_amount` via `/admin`, Steph's BILL sandbox.

### 4. Parked pre-cycle must-do — unchanged from S201
Intake virus-scan **EICAR e2e through `/apply`** before the next cycle's Phase I intake goes live (reviewer path verified S193; intake path skipped). See `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md`.

### 5. Lint ratchet (optional, low-stakes) — unchanged
50 warnings; the `react-hooks/exhaustive-deps` cluster is where real stale-closure bugs could hide. CI won't block on them.

## Key Files Reference
| File | Purpose |
|------|---------|
| `lib/services/dynamics-service.js` | A3: `countRecords` (countdistinct-on-PK), `getPrimaryIdAttribute`, dual-keyed `primaryIdMap` |
| `shared/config/prompts/dynamics-explorer.js` | A4: `buildDomainGuardrails()` + reconciled `akoya_folio` guidance |
| `pages/api/dynamics-explorer/chat.js` | A5: `classifyToolError` + `closestFieldNames` |
| `lib/services/dataverse-export/constants.js` | A4 source of truth (imported by reference into the prompt) |
| `scripts/probe-akoya-folio-casing.js` | Provenance probe (folio distribution + `/$count` brokenness + eq case-insensitivity) |
| `docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md` | Path A plan — A1+A2 (S200), A3/A4/A5 (S202) all marked shipped |

## Testing
```bash
npx jest                       # 1544 tests
npm run lint                   # 0 errors / 50 warnings (CI blocks on errors only)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:fact-consistency
node scripts/analyze-dynamics-explorer-failures.js   # soak (read-only, prod); leave until traffic accrues
node scripts/probe-akoya-folio-casing.js             # folio/count probe (read-only, prod)
```
