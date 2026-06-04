# Session 220 Prompt: Open — reviewer-workflow validation + carried tails

## ⏰ Standing context / guardrails (carried S197–S219)
- **`main` auto-deploys to prod on push.** Commit/push only when asked. Feature branches do NOT deploy — use one for anything touching a live prod-write path, smoke it, then merge. (Note: one-shot operator *scripts* and SQL *migrations* run against prod directly when executed locally — they are not gated by deploy; treat them with the same care.)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`) + a PreToolUse reminder on durable-doc scope claims. Run the *disconfirming* query before asserting scope/quantity; derive denominators independently. (S218 lesson still holds: don't trust a memory file's own SHIPPED/closed self-label — probe live state. S219 reinforced it: a memory's "drain table still present / drop pending" survived a session past the actual drop.)
- **Local-dev hits the SAME prod Dataverse + prod Postgres** — no isolated test store. `POSTGRES_URL` IS in `.env.local`, so read-only PG probes work (`.env.local`-load + `pg.Pool({ssl:{rejectUnauthorized:false}})`). Dataverse probes: client-credentials token + `EntityDefinitions(LogicalName='x')` for set names (`wmkf_potentialreviewer`'s set is the double-plural `wmkf_potentialreviewerses`; metadata `$filter` rejects `startswith`/`contains`). `queryAllRecords` caps at 5000 and requires a `$filter`.
- **ORCID/NCBI + EXTERNAL_LINK_SECRET are "Sensitive" in Vercel** → `vercel env pull` returns them EMPTY; hand-enter in `.env.local` ([[project-vercel-sensitive-env-pull-empty]]). `SERP_API_KEY` + `BLOB_READ_WRITE_TOKEN` ARE in `.env.local`.
- **Memory is a ROUTER.** `.claude-memory/MEMORY.md` routes "for THIS task → read these 1–3 files." Read the routed topic files in full before acting. Gate `npm run check:memory-router` (+ `:self-test`) keeps it ≤150 lines/18KB with valid links + statuses. Task-routed files must be `active`/`stale`, never `closed`.

## Session 219 Summary

Three pieces, all committed + pushed; tree clean. No app *runtime* code changed — this was data-layer + doc/memory work.

### 1. Lone-ORCID Scholar backfill — closed the S215 ORCID residual (commit `c734356`)
- `scripts/backfill-lone-orcid-scholar.js`: ran Google Scholar over the 454 lone-ORCID reviewers (name-only ORCID match, left `unresolved` by the S215 backfill). Where Scholar was clean, fed both weak anchors (lone ORCID + clean Scholar) through the live `resolveIdentity` gate → `probable` → wrote the ORCID.
- **Result (verified vs live Dataverse): 240 written, 144 rejected (correctly gated), 70 no-Scholar.** Pool: ORCID **1,533→1,773**, `probable` **1,532→1,772** (+240 each, triangulated). Scholar used as corroborating evidence only — `wmkf_googlescholarid` NOT persisted. Cost $0 (454 of 14,647 monthly SerpAPI headroom). Two Codex rounds + a SerpAPI-`data.error`="no results"→`sch_none` fix.

### 2. Dropped the reviewer-finder Postgres drain tables (commit `e6a339d`, migration 018)
- Done **early** at Justin's direction (he'd removed reviewer-finder/review-manager from other users + stopped using them), ahead of the old ≥2026-07-01 trigger.
- **5 tables dropped** (`migration 018`, guarded + tracked, Wave-1 precedent): `researchers`, `researcher_keywords`, `publications`, `proposal_searches`, **`reviewer_suggestions`**. Verified gone from the pg catalog; no dangling FKs. Scope grew from 4→5 once an FK probe showed `reviewer_suggestions.researcher_id → researchers` and re-verification confirmed `reviewer_suggestions` had no live app SQL.
- **`search_cache` EXCLUDED** — 0 rows but has live callers (`DatabaseService.checkCache`/`cacheSearch` in pubmed/biorxiv/arxiv/chemrxiv + the maintenance cron). The verification rule caught this.
- Pre-drop backups (331 / 1,028 / 337 rows) → local JSONL + Vercel Blob `cleanup-backup/2026-06-04/` (`scripts/w6-drop-backup.js` + `w6-drop-restore.js`). Neon PITR 7-day = secondary.

### 3. Doc/memory reconciliation audit (this commit)
- At Justin's request, audited CLAUDE.md + SESSION_PROMPT + all ~118 memory topic files (3 parallel auditor agents) for currency vs reality. Fixed the staleness the S219 changes introduced: ~7 memory files (drop "pending"/"drain-only" → DROPPED; old ORCID counts annotated; `017`→`018`; PromptResolver→Executor; explorer Search pointer), the Atlas index + 4 atlas pages (incl. the missed `postgres-publications.md`), CLAUDE.md schema row. All gates + self-tests green.

## Potential Next Steps (no forced priority)

### 1. Reviewer-workflow validation — the longest-deferred debt
- **Manual PD smoke of the identity resolver + `/workbench`** — shipped + CI-green since S214 but never exercised by a real PD login (CI-green ≠ correct for an outward-facing match-quality surface). Grant `reviewers` to pilot PDs via `/admin` (`wmkf_appuserappaccesses`) and walk Find→Invite→Track→Completed. **Highest-value next step.**
- **Intake virus-scan EICAR e2e** — still parked pre-cycle must-do ([[project-intake-portal-virus-scan-e2e-deferred]]); needs a deployed env + Entra applicant session.

### 2. Finish the reviewer-app consolidation
- Retire the legacy `reviewer-finder` / `review-manager` appRegistry keys now that Workbench has Find-tab parity — **destructive**, grep live callers first (the 18 routes accept `reviewers` variadically; both old keys still live). See [[project-reviewer-apps-redesign-direction]] (Option B).

### 3. ORCID residual tail (cost decision, low priority)
- 70 no-Scholar + 144 Scholar-rejected reviewers stay correctly `unresolved` (the safety wins). Separately, lone-Scholar/no-ORCID people aren't ORCID-captured — a different bucket, no action planned.

### 4. New features / next cycle
- J27 triage dashboard + automation tier (Dec 2026 runway); roadmap memories via MEMORY.md "Planned: …" / "Strategy" rows.

## Open audit note (outside the S219 scope, flagged not fixed)
- `requireAppAccess(` appears in **56** `pages/api` files but `docs/CANONICAL_COUNTS.md` + the fact-consistency gate say **55** (gate is green). Likely `pages/api/test-email.js` is intentionally excluded as a non-app endpoint — worth a 5-min confirm that the canonical count's derivation is deliberate, not a 1-off drift.

## Key Files Reference
| File | Purpose |
|------|---------|
| `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql` | The S219 table drop (guarded, tracked) |
| `scripts/w6-drop-backup.js` / `w6-drop-restore.js` | Pre-drop backup + break-glass restore |
| `scripts/backfill-lone-orcid-scholar.js` | The lone-ORCID Scholar backfill (resumable) |
| `docs/APPLICATION_STATE_ATLAS.md` + `docs/atlas/` | Canonical live-state; reconciled S219 |
| `.claude-memory/project-w6-table-drop-pending.md` | Now `status: closed` — the drop's authoritative record |

## Testing
```bash
npx jest                                    # full suite (eslint is CI-only, not local)
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency && npm run check:doc-currency
npm run check:memory-router && npm run check:migrations-manifest && npm run check:drain-table-mentions
```
