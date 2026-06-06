# Session 225 Prompt: Topic #3 (Perplexity in reviewer disambiguation) + roster follow-ups

## ⭐ Top of the agenda — Topic #3: Perplexity's role in reviewer finding/disambiguation
The last open item from the EOD-S222 reviewer-finder list ([[project-reviewer-finder-next-topics]] §3 — now the ONLY open one; #1 timeout + #2 recency/affiliation both SHIPPED). Untouched. Web-grounded "where are they now" disambiguation dovetails with the current-affiliation work that just shipped. **Confirmed S222:** Perplexity is wired ONLY into the Virtual Review Panel (`lib/utils/vrp-providers.js`, `multi-llm-service.js`, `panel-review-service.js`), NOT reviewer-finder; no `PERPLEXITY_*`/`PPLX` key set. **Decide:** web-grounded disambiguation (current affiliation, "is this the same person") vs candidate discovery vs none — compare against the existing SerpAPI/Scholar/ORCID enrichment path. This is scoping/discussion, not yet specced. See [[project-reviewer-identity-resolution-phase1]].

## Session 224 Summary — SHIPPED 3 reviewer features + a verification skill

**1. Topic #2 pieces 3–6 — current-affiliation pinning (SHIPPED + DEPLOYED, `6f91bac`).** Completes recency-weighting. ORCID always-fetches the full profile (current affiliation), strictly a no-end-date employment (no stale postdoc fallback); Scholar `author.affiliations`/`email` now parsed; identity-gated `_finalize` override pins the current affiliation (authority ORCID > Scholar > PubMed-recency) with `affiliationSource` provenance shown in the cards. Two Codex post-impl rounds (HIGH: ORCID ended-employment fallback; MEDIUM: Scholar no-table author block — both fixed). `docs/REVIEWER_RECENCY_WEIGHTING_PLAN.md` now marked SHIPPED.

**2. "Several minutes" Find-tab copy fix (`a28771e`).** Both progress lines said "a minute"; the search budget is up to ~10 min (S223). Now "several minutes — please keep this tab open."

**3. ⭐ Durable per-request Find roster + cross-run search dedup (SHIPPED + DEPLOYED, `dee37aa`).** The headline. Workbench Reviewers→Find candidates are no longer ephemeral: every surfaced candidate is recorded per-request and **suppressed from future searches for that request** — enforced **server-side in `/discover` before the per-candidate Claude reasoning**, so re-runs find NEW people instead of re-spending tokens. Durable roster = active selectable list (persists across reload) + a collapsed, recoverable **Excluded** section; **Exclude** sets aside (never deletes), **Promote back** restores. New name-keyed Postgres table `reviewer_find_roster` (status active|excluded|saved). **Migration 020 was applied to prod** (verified live: table + 3 indexes, 0 rows). Went through **2 Codex plan-review rounds + 2 Codex post-impl rounds** (HIGH: roster-reloaded save could bypass the identity-resolver guard — fixed via persist-flags in the pruned DTO; 3 MEDIUM all fixed). Plan: `docs/REVIEWER_RECENCY_WEIGHTING_PLAN.md`'s sibling `~/.claude/plans/cosmic-yawning-starlight.md`; Atlas: `docs/atlas/postgres-reviewer-find-roster.md`.

**4. `/contract-reconcile` verification skill + surface hook (`06fa2df`).** Operationalizes `docs/CLAUDE_SKILL_REMEDIATION_PLAN.md` (Justin-authored, a retrospective on this session's Codex catches). One skill, two modes (Review/Implementation): whole-flow trace + six audits + `[VERIFIED/PLANNED/ASSUMED/STALE]` labels. Auto-fires on migration/new-table/new-route/dedup/partial-save/stream/verify-findings; also `/contract-reconcile`. Backed by a PreToolUse hook (`.claude/hooks/contract-surface-reminder.js`) nudging durable-surface obligations on a migration / new route / non-md CREATE TABLE.

### Commits (4 this session; first 3 pushed+deployed, `06fa2df` pushed at session end)
- `6f91bac` — affiliation pinning (Topic #2 pieces 3–6)
- `a28771e` — "several minutes" copy fix
- `dee37aa` — durable Find roster + cross-run dedup
- `06fa2df` — contract-reconcile skill + surface hook

## Roster follow-ups (deferred from `dee37aa`, all OPTIONAL)
- TTL cleanup cron for `reviewer_find_roster` rows on closed requests (mirror `DatabaseService.cleanupExpiredCache`). v1 uses a per-request row cap (300) only.
- Split the "filtered out" UI counter into applicant-exclusion vs cross-run-dedup.
- Durable read-only "previously surfaced (N)" / unverified sections.
- Standalone `pages/reviewer-finder.js` parity (the roster is Workbench-Find-only).

## Standing context / guardrails (carried S197–S224)
- **`main` auto-deploys to prod on push. Commit/push only when asked.** Local scripts + SQL migrations hit prod directly (`.env.local` → prod). A NEW migration must be applied (`node scripts/apply-migrations.js`) before the code that reads its table runs — 020 is already applied.
- **`reviewer_find_roster` is operational/pre-save state (Postgres), NOT canonical reviewer identity (Dataverse).** Do not "drop a reviewer Postgres table" carryover it — it's live (S224). Same class as the retained `search_cache`.
- **NEW: use `/contract-reconcile`** before declaring a review or multi-layer build done — it auto-fires on the triggers above. The surface hook will nudge migration/route obligations.
- **`rtk` FULLY UNINSTALLED** (S221) — do NOT prefix commands with `rtk`. [[project-rtk-grep-output-corruption]].
- **Codex loop** (plan→pre-impl→impl→post-impl) ran 4 times this session and caught real bugs each time. Keep it for anything non-trivial.
- Memory frontmatter: valid `status:` = active/stale/closed/superseded only; run `npm run check:memory-router` after memory edits.

## Key Files Reference (durable Find roster)
| File | Purpose |
|------|------|
| `lib/db/migrations/020_reviewer_find_roster.sql` | the table (applied to prod) |
| `lib/services/reviewer-roster-store.js` | CRUD (recordSurfaced/setExcluded/promote/markSaved/listForRequest) |
| `pages/api/workbench/reviewer-roster.js` | GET/POST/PATCH route |
| `lib/utils/reviewer-name-match.js` | shared CJS normalize + exact-exclude (server+client) |
| `shared/components/reviewers/reviewer-search-logic.js` | `pruneCandidateForRoster` (+ persist flags), re-exports name-match |
| `shared/components/reviewers/ReviewerSearchSection.js` | the displayCandidates refactor + roster UI |
| `pages/api/reviewer-finder/discover.js` | server-side `excludedNames` dedup (before reasoning) |
| `docs/atlas/postgres-reviewer-find-roster.md` | Atlas page |

## Testing
```bash
npx jest reviewer-roster-store reviewer-roster-endpoint reviewer-name-match reviewer-search-logic   # roster suites
npx jest                                                                                            # full suite (1988 at S224)
for g in migrations-manifest api-routes atlas doc-currency fact-consistency canonical-pointers drain-table-mentions prompt-storage-mentions prompt-injection-tagging memory-router; do npm run check:$g; done
# verify the prod table exists (manual env parse — no dotenv pkg):
node -e "const fs=require('fs');for(const f of['.env','.env.local']){try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^['\"]|['\"]$/g,'')}}catch{}}const{sql}=require('@vercel/postgres');sql\`SELECT count(*) FROM reviewer_find_roster\`.then(r=>console.log('rows',r.rows[0].count))"
```
