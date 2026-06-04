# Session 219 Prompt: Open — new feature work or carried tails

## ⏰ Standing context / guardrails (carried S197–S218)
- **`main` auto-deploys to prod on push.** Commit/push only when asked. Feature branches do NOT deploy — use one for anything touching a live prod-write path, smoke it, then merge.
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`) + a PreToolUse reminder on durable-doc scope claims. Run the *disconfirming* query before asserting scope/quantity; derive denominators independently. (S218: the IRS memory's "SHIPPED + runs as scheduled" self-claim was wrong — a live Postgres/maintenance_runs probe caught it. **Don't trust a memory file's own SHIPPED/closed self-label; probe live state.**)
- **Local-dev hits the SAME prod Dataverse + prod Postgres** — no isolated test store. `POSTGRES_URL` IS in `.env.local`, so read-only PG probes work (the `.env.local`-loading + `pg.Pool({ssl:{rejectUnauthorized:false}})` pattern). Dataverse probes: client-credentials token + `EntityDefinitions(LogicalName='x')` for set names (note `wmkf_potentialreviewer`'s set is the double-plural `wmkf_potentialreviewerses`; metadata `$filter` rejects `startswith`/`contains`). `queryAllRecords` caps at 5000.
- **ORCID/NCBI + EXTERNAL_LINK_SECRET are "Sensitive" in Vercel** → `vercel env pull` returns them EMPTY; hand-enter in `.env.local` ([[project-vercel-sensitive-env-pull-empty]]).
- **Memory is now a ROUTER.** `.claude-memory/MEMORY.md` routes "for THIS task → read these 1–3 files." Read the routed topic files in full before acting. New gate `npm run check:memory-router` (+ `:self-test`) keeps it ≤150 lines/18KB with valid links + statuses. Spec: `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`.

## Session 218 Summary

No app-code changes. Entire session was **memory-system work** + a Codex audit response. All committed + pushed; tree clean.

### What was completed
1. **Confirmed PR4 already landed.** Pulled 19 commits at session start; verified the reviewer self-reported ORCID work (sticky-`confirmed` invariant) was merged (`876dd88`) + headless e2e runner (`015aad6`) on prod. Wrote the deferred `project-reviewer-self-report-orcid-sticky-confirmed` memory.
2. **Reorganized `.claude-memory/` into a router** (per `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`). `MEMORY.md` 24.3KB/143 lines → **~7.7KB/78 lines**. Normalized **all 118 topic files**: added `status`/`scope`/`last_verified` + a `## Recall Rule` (additive only — zero body deletions, verified). New `project-closed-work-archive.md` holds closed/point-in-time entries. New gate `scripts/check-memory-router.js` (+ self-test), wired into `package.json` + `.github/workflows/test.yml`.
3. **Acted on the Codex reorg audit** (`docs/MEMORY_REORG_AUDIT_2026-06-04.md`):
   - **P1 (verified vs code, fixed):** `intake-portal-reviewer-capture` — separated CURRENT Workbench (option B: recommended→junction rows; **excluded→soft-block only, NO rows**) from FUTURE intake design; `reviewer-workbench-invite-workflow` — per-user signature **IS** wired (`pages/workbench/[requestId].js` reads `SENDER_INFO`), replaced stale "not yet wired."
   - **P2:** split all 6 over-full routes to ≤3 files; convention = a task-routed file must be `active`/`stale`, never `closed` → reclassified 12 routed files closed→active.
   - **IRS reality-check:** live probe showed `irs_exempt_orgs` **does** hold 1,264,156 rows, BUT the quarterly cron **has never fired** (0 `maintenance_runs` rows) and **nothing built consumes** verify-EIN. Rewrote `project-irs-exempt-verification` from "SHIPPED + running" → "code+data shipped, **DORMANT**."
4. **Spot-probed every other closed/SHIPPED memory** against live Postgres/Dataverse/repo. **IRS was the only overstatement** — Wave-1 tables dropped ✓, W6 drain tables present ✓, appresearcher entities dropped ✓, 6 `wmkf_identity*` fields deployed ✓, slice-0 schema deployed ✓, BILL chunks + Q5 lookup + honorarium setting all present ✓. Upgraded `last_verified` on 9 verified files to real `via live probe` provenance.

### Commits
- `91f7597` — memory: PR4 sticky-confirmed entry (checkpoint before trim)
- `ba105f7` — memory: trim MEMORY.md under harness limit (archive + merge duplicate feedback)
- `4cb926d` — Reorganize Claude project memory routing (router + 118 normalized files + gate)
- `b8fd81c` — docs: add Claude memory reorganization plan
- `9e501f0` — memory: act on Codex reorg audit (P1 fixes + router cleanup + IRS reality-check)
- `eea0bc9` — memory: spot-probe closed/SHIPPED files vs live state — stamp last_verified
- (this session-doc commit follows)

## Potential Next Steps

Everything below the memory work is open — no forced priority. Pick from carried tails or new features.

### 1. Carried reviewer/intake tails (operator / live-session work — not code)
- Grant `reviewers` app access to pilot PDs + validate `/workbench` with a real PD login (`/admin` → `wmkf_appuserappaccesses`).
- **Intake virus-scan EICAR e2e** — still parked pre-cycle must-do ([[project-intake-portal-virus-scan-e2e-deferred]]); needs deployed env + Entra applicant session.

### 2. ORCID capture residual (from S215)
Lone-ORCID + clean-Scholar (~4.4%) — a second backfill pass running Scholar would catch them (SerpAPI cost), or let normal enrichment pick them up. Cost decision, not code.

### 3. Optional memory follow-ons (low priority, documented as deferred in the audit)
- P2 — 47 topic files use flat top-level frontmatter vs nested `metadata:` (cosmetic; gate-clean). Normalize if touched.
- P3 — regenerate `docs/RECONCILIATION_REPORT.json` via the non-`--no-write` drift path (needs live probe).

### 4. New features
Roadmap memories: route via `MEMORY.md` → "Strategy / system model", "Planned: …" rows. ([[project-app-roadmap-2026-04-25]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]]).

## Key Files Reference
| File | Purpose |
|------|---------|
| `.claude-memory/MEMORY.md` | The router — read it, follow task routes to topic files |
| `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md` | Router spec + layer model + operating rules |
| `scripts/check-memory-router.js` (+ `-self-test`) | The new gate (≤150 lines/18KB, links resolve, valid statuses) |
| `docs/MEMORY_REORG_AUDIT_2026-06-04.md` | Codex audit (P1/P2/P3 findings, now addressed) |
| `.claude-memory/project-irs-exempt-verification.md` | Corrected: code+data shipped but DORMANT (no consumer, cron never fired) |

## Testing
```bash
npx jest                                    # full suite (eslint is CI-only, not local)
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency && npm run check:doc-currency
```
