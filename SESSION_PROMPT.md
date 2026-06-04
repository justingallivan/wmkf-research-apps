# Session 220 Prompt: PIVOT TO PROJECT WORK — reviewer-workflow validation

## ⚠️ Read first
S219 was **~6 hours of cleanup with zero feature progress** (table drop → ORCID backfill → a doc/memory reconciliation that took 3 Codex rounds → a start-gate fix → guardrails). Justin called it out. New rule now in CLAUDE.md + [[feedback-timebox-metawork]]: **time-box meta-work (~30 min / 2 commits) and check in before it balloons.** Next session: start on the *project*, not another tidy-up loop.

## ⏰ Standing context / guardrails (carried S197–S219)
- **`main` auto-deploys to prod on push.** Commit/push only when asked. Feature branches do NOT deploy. One-shot operator *scripts* and SQL *migrations* hit prod directly when run locally — same care.
- **Two PreToolUse hooks are LIVE** (`.claude/settings.json`): (a) `scope-claim-reminder.js` — disconfirm before asserting scope/quantity; derive denominators independently; (b) **NEW `doc-edit-reconcile-reminder.js`** — fires on every `Edit` of `docs/`, `.claude-memory/`, `CLAUDE.md`, `SESSION_PROMPT.md`: **read the WHOLE file (not a grep slice) + grep the repo + fix every instance.** S219 proved the lever is the hook, not prose (the "patch the flagged line, leave residuals" error recurred 3× even while watched for).
- **`/start` now runs the COMPLETE gate set** (all 11 `check:*`, not a subset) — `check:prompt-storage-mentions` had been red & unnoticed because it wasn't in the old short list.
- **Local-dev hits the SAME prod Dataverse + prod Postgres** — no isolated test store. `POSTGRES_URL` IS in `.env.local` (read-only PG probes work: `.env.local`-load + `pg.Pool({ssl:{rejectUnauthorized:false}})`). Dataverse: client-credentials token + `EntityDefinitions(LogicalName='x')` for set names (`wmkf_potentialreviewer`'s set is the double-plural `wmkf_potentialreviewerses`). `queryAllRecords` caps at 5000 + requires a `$filter`.
- **ORCID/NCBI + EXTERNAL_LINK_SECRET are "Sensitive" in Vercel** → `vercel env pull` returns them EMPTY; hand-enter in `.env.local`. `SERP_API_KEY` + `BLOB_READ_WRITE_TOKEN` ARE in `.env.local`.
- **Memory is a ROUTER.** `.claude-memory/MEMORY.md` routes "for THIS task → read these 1–3 files" (in full). Task-routed files must be `active`/`stale`, never `closed`.

## Session 219 Summary (two real prod changes, then a long cleanup tail)

### 1. Lone-ORCID Scholar backfill — closed the S215 ORCID residual (`c734356`)
`scripts/backfill-lone-orcid-scholar.js` ran Google Scholar over the 454 lone-ORCID reviewers (name-only match, left `unresolved` by S215); clean Scholar = second weak anchor → live `resolveIdentity` → `probable` → wrote the ORCID. **240 written, 144 rejected (correctly gated), 70 no-Scholar.** Pool: ORCID **1,533→1,773**, `probable` **1,532→1,772** (triangulated). Scholar NOT persisted (corroboration only). Cost $0. Two Codex rounds + a SerpAPI `data.error`="no results"→`sch_none` fix.

### 2. Dropped the reviewer-finder Postgres drain tables (`e6a339d`, migration 018)
Done early at Justin's direction. **5 tables dropped** (guarded, tracked migration — Wave-1 precedent): `researchers`, `researcher_keywords`, `publications`, `proposal_searches`, `reviewer_suggestions`. Verified gone from pg catalog; no dangling FKs. Scope grew 4→5 once an FK probe showed `reviewer_suggestions.researcher_id → researchers`. **`search_cache` EXCLUDED** (0 rows but live callers: `DatabaseService.checkCache`/`cacheSearch` + maintenance cron). Pre-drop backups (331/1,028/337 rows) → local JSONL + Vercel Blob `cleanup-backup/2026-06-04/` (`w6-drop-backup.js`/`w6-drop-restore.js`); Neon PITR 7-day secondary. This **closes the W3–W6 Postgres→Dataverse migration.**

### 3. Doc/memory reconciliation + Codex verification (`fa11d47`, `f9344d0`, `eb12d0a`, `d2eff0e`, `6b42461`)
Audited CLAUDE.md + SESSION_PROMPT + all ~118 memory files (3 parallel agents) for currency, then had **Codex independently screen + verify against code — across 3 rounds.** Codex earned its keep: caught a **red gate** (`prompt-storage-mentions`), a count the gate missed in prose (`app count=17`→18), a `status:` that lied about its body, stale "live" entity refs, and — twice — that my own fixes were *incomplete* (I patched flagged lines and left residuals: the exact failure mode). Also reconciled the Atlas index + atlas pages (incl. the missed page for the dropped `publications` table) and CLAUDE.md schema row. <!-- drain-table:ignore reason=atlas-page-filename-reference -->

### 4. Process guardrails so this doesn't recur (`4fc5194`, `1385a65`, `bc9da28`)
`/start` runs the full gate set; new doc-edit reconcile **hook** + time-box meta-work rule (CLAUDE.md + [[feedback-timebox-metawork]] + strengthened [[feedback-reconcile-dont-append-docs]]); deleted the untracked `.agents/skills/` tree (corrupted `migrate-to-codex` `s/Claude/Codex/` copies). Fixed the ambiguous "read the line, not the file" phrasing.

## Potential Next Steps (lead with PROJECT work, not cleanup)

### 1. Reviewer-workflow validation — the longest-deferred debt (TOP)
**Manual PD smoke of the identity resolver + `/workbench`** — shipped + CI-green since S214 but never exercised by a real PD login (CI-green ≠ correct for an outward-facing match-quality surface). Grant `reviewers` to pilot PDs via `/admin` (`wmkf_appuserappaccesses`) and walk Find→Invite→Track→Completed. Operator/live work, not code.

### 2. Finish the reviewer-app consolidation
Retire the legacy `reviewer-finder` / `review-manager` appRegistry keys now that Workbench has Find-tab parity — **destructive**, grep live callers first (18 routes accept `reviewers` variadically; both old keys still live). See [[project-reviewer-apps-redesign-direction]] (Option B).

### 3. Intake virus-scan EICAR e2e — parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]; needs a deployed env + Entra applicant session.

### 4. New features / next cycle
J27 triage dashboard + automation tier (Dec 2026 runway); roadmap memories via MEMORY.md "Planned: …" / "Strategy" rows. [[project-staged-review-pipeline]], [[project-proposal-context-extraction]].

## Resolved audit note (S219)
`requireAppAccess` 56-vs-55 is RESOLVED (Codex): `pages/api/test-email.js:19` names the gate in a *comment* but uses `requireSuperuser`; `scripts/lib/canonical-facts.js` counts AST call-sites = **55**, correct. Not a drift.

## Key Files Reference
| File | Purpose |
|------|---------|
| `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql` | The S219 table drop (guarded, tracked) |
| `scripts/w6-drop-backup.js` / `w6-drop-restore.js` | Pre-drop backup + break-glass restore |
| `scripts/backfill-lone-orcid-scholar.js` | The lone-ORCID Scholar backfill (resumable) |
| `.claude/hooks/doc-edit-reconcile-reminder.js` | NEW — read-whole-file reminder on durable-doc edits |
| `.claude-memory/feedback-timebox-metawork.md` | NEW — time-box cleanup/audit/verify loops |

## Testing
```bash
npx jest                                    # full suite (1,842 tests; eslint is CI-only, not local)
# full gate set (now matches /start):
for g in migrations-manifest api-routes atlas doc-currency fact-consistency canonical-pointers drain-table-mentions prompt-storage-mentions prompt-injection-tagging memory-router; do npm run check:$g; done
```
