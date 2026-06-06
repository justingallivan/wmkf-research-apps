# Session 226 Prompt: Review Codex's enforcement harnesses + web-discovery increment 2

## ⭐ Top of agenda — you likely woke to NEW Codex-written harnesses
Justin said Codex would author **enforcement harnesses** (hooks) while this session slept, based on the instruction-architecture work below. **Before building anything: check `git log` / `git status` / `.claude/hooks/` / `.claude/settings.json` for new Codex commits, and review them against `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md` — specifically its §4 (re-scoped) and the verified hook facts.** Do NOT trust the first-draft recommendations: a second review corrected real errors (see below). [[project-claude-instruction-architecture]] has the load-bearing facts so you don't re-derive them wrong.

## Session 225 Summary

This was a long, churn-heavy session with two threads. Justin flagged the working pattern as **unacceptable** mid-session: Claude repeatedly asserted state as built/feasible that the code contradicted (the no-3-pub-gate premise, the "promote reuses an existing input" claim that didn't exist, the credential-crossing bug, a wrong SessionStart fact), leaning on Codex to catch real bugs each round. Root-cause framing → the instruction-architecture initiative.

### Thread 1 — Reviewer web-discovery (Topic #3), backend increment 1 SHIPPED (`f842c22`)
Perplexity Search API as a web-grounded **candidate-discovery lead source** (counter Claude's training-cutoff + fame bias → surface currently-active mid-career researchers). After a `/contract-reconcile` whole-flow trace proved every *pipeline-integration* approach generated HIGHs, scope was cut to a **READ-ONLY web-suggestions panel** (separate path; no merge/rank/COI/roster/save). Built (backend only, **inert in prod — nothing imports it yet**): `lib/services/web-discovery-service.js`, `createWebExtractionPrompt`, `api-capabilities.reviewerWebSearch`, prompt-injection gate entry. **15 unit tests green; A7 gate + lint green.** Went through a `/contract-reconcile` review + a Codex post-impl review that caught a **HIGH** (Perplexity key was being passed to Anthropic — fixed: keys now strictly separate). Plan: `docs/REVIEWER_WEB_DISCOVERY_PLAN.md` (v7). Memory: [[project-reviewer-finder-next-topics]] §3.

### Thread 2 — Claude instruction-architecture cleanup (`1c40a13`)
Justin authored `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md` (route CLAUDE.md's 4 jobs to the right mechanism; 308→~80-120 lines; enforce with hooks not prose). Claude produced `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md` (Phase-1 AGREE/MODIFY/OBJECT review), **corrected after a second review** (SessionStart canNOT block; precedence→ownership-policy; Stop "judge" split into deterministic gate-check + advisory; `setup-database.js` self-contradiction flagged). **Codex authoring the harnesses next.**

### Commits
- `f842c22` — web-discovery backend core (Track C v1, read-only) + 15 tests
- `1c40a13` — instruction-architecture cleanup plan + Phase-1 review response
- (this doc commit) — Session 225 docs + memory

## Potential Next Steps

### 1. ⭐ Review Codex's enforcement harnesses (if present)
Review against the corrected review response. Watch: a symlink/setup guard must NOT be a `SessionStart` block (it can't block — use `PreToolUse` deny / external / in-script). Stop verifier should be deterministic changed-surface gate checks, not a broad "completion judge." Reconcile `setup-database.js` (`:12` "backwards-compatible on existing DBs" vs `~:600` "fresh-install only") **in source** before any enforcement leans on it.

### 2. Web-discovery increment 2 (route + UI)
- Route `pages/api/reviewer-finder/web-suggestions.js` (`requireAppAccess('reviewer-finder','reviewers')`, key-gated, calls `WebDiscoveryService.search`) + **API_ROUTE_SECURITY_MATRIX entry** (`check:api-routes` will go red without it).
- Read-only "Web suggestions" panel + capability-gated `searchWeb` toggle on both surfaces (standalone `ReviewerSearchSection.js` + Workbench `ReviewerFindPanel.js`).
- **Live Perplexity contract test before enabling** — no `PERPLEXITY_API_KEY` set yet; `search_after_date_filter` format (M/D/YYYY) is unconfirmed against the real API. Deferred-v2 (full pipeline integration) contracts live in the plan §10.

### 3. (Deferred) the "Add as candidate" manual-add path
The verified mechanism (append `{name, manualAdd:true}` to `analysisResult.reviewerSuggestions` + discover-only re-run + bypass the 3-pub gate for manual adds) is parked — Codex's v6 review found it carries real contracts. Not in read-only v1.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked.** The web-discovery service is committed but **inert** (no caller) — safe in prod.
- **Behavior note (S225):** probe-before-plan, time-box meta-work, falsify-don't-confirm, don't-assert-unverified-state — all violated this session. The instruction-architecture work is the structural fix; until the harnesses land, *be the discipline manually*: verify against code before asserting, label [VERIFIED/ASSUMED].
- **`/contract-reconcile`** paid off this session (it found the whole-flow integration HIGHs in one pass vs Codex's one-per-round). Use it before declaring multi-layer work done.
- Codex post-impl review on the actual diff caught what prose review couldn't — keep the impl→post-impl loop.

## Key Files Reference
| File | Purpose |
|------|------|
| `lib/services/web-discovery-service.js` | Perplexity Search → A7 extraction → WebLead[] (read-only v1, inert until a route calls it) |
| `tests/unit/web-discovery-service.test.js` | 15 tests (key-routing, provenance, fail-soft, caps, cache) |
| `shared/config/prompts/reviewer-finder.js` | `createWebExtractionPrompt` (static, A7-registered) |
| `docs/REVIEWER_WEB_DISCOVERY_PLAN.md` | v7 read-only scope + deferred-v2 integration contracts |
| `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md` | Justin's plan |
| `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md` | Claude's corrected Phase-1 review |

## Testing
```bash
npx jest web-discovery-service                     # 15 tests
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
for g in migrations-manifest api-routes atlas doc-currency fact-consistency canonical-pointers drain-table-mentions prompt-storage-mentions prompt-injection-tagging memory-router; do npm run check:$g; done
```
