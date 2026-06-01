# Session 210 Prompt: Request Workbench — Phase 3 (Find panel + applicant-reviewer ingestion)

## ⏰ Standing context / guardrails (carried from S197–S209)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. Authoritative lint counts = `npx eslint . -f json` keyed on `ruleId`/`severity`, NOT grep over the default formatter.
- **Codex stop-time review gate is ENABLED.** In S209 it caught the Workbench `canManage` gate hiding controls from superusers/unresolved viewers (real fix). Reconcile every restatement in the same turn; verify-as-you-go.
- **rtk grep filter STILL corrupts output.** For "does X exist" use `git grep` / write-to-file + Read; never trust a bare `grep`/`rg`. rtk is an explicit CLI (`rtk grep`/`rtk proxy`), NOT a transparent interceptor — plain `git grep`/`Grep`/`Read` are unaffected. Just never route through `rtk`.
- **Push deploys to prod.** `main` auto-deploys on Vercel. All S209 work is pushed (`9006857`).
- **CI-green ≠ correct for async/effect/UI code.** Manual smoke is mandatory for load-bearing UI ([[feedback-profile-context-runtime-bugs]]).
- **Local-dev auth bypass for gated UI:** pass inline (cleaner than editing `.env.local`) — `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Under bypass, `/api/app-access` returns ALL apps + `isSuperuser:true`, so gated pages render. **BUT** any endpoint that resolves a PD from the session email (`/api/workbench/dashboard`, `/api/review-manager/reviewers` no-proposalId, `reviewer-finder/my-proposals`) hard-fails ("Could not determine your email") — the **email-independent per-request path** (`reviewers.js?proposalId=`, `resolve-request?requestId=`) works. To smoke the Workbench locally, go straight to `/workbench/<guid>?tab=reviewers`.
- **`npm run` glitches the Bash tool intermittently this env** — call binaries directly (`./node_modules/.bin/next build`, `npx jest`) when `npm run X` errors with an `H.replace`-type message.

## Session 209 Summary

**Shipped Workbench Phase 2 (browser-smoked + Codex-reviewed), closed the /start gate gap, ran a full memory-vs-state audit, and did a 14-entry memory hygiene pass. 9 commits, all pushed, tree clean, all gates green.**

### What was completed
1. **Workbench Phase 2 — Manage panel (`64f694f` + fixes `3096f3b`, `c820f2b`, `bfa1fac`).** Extracted Review Manager's reviewer-management substance into **`shared/components/reviewers/ReviewerManagePanel.js`** (both `review-manager.js` and the Workbench import it — markup-identical regression). New **`ReviewersTab.js`** (Find placeholder + Invite/Track/Completed sub-tabs, `?sub=` deep-links, state-aware landing), **`SubTabBadges.js`**, and pure **`reviewer-modes.js`** (status-bucketing / default-landing / `computeCanManage`) with **24 unit tests** pinning the "no reviewer falls through the sub-tabs" invariant. Wired the shell's Reviewers tab. **Codex caught 2 real bugs (folded):** `canManage` failed closed for superusers/unresolved viewers → now fails open; and a direct/bookmarked GUID link rendered a blank panel → `resolve-request` now accepts `?requestId=<guid>` and the shell resolves context by GUID. **Browser-smoked** (populated panel #1002379 + empty-state D26 #1002836). Full suite 1605 green, 0 lint errors.
2. **`/start` gate-list gap closed (`efd56fd`).** Added `check:doc-currency` (+ self-test) and `check:fact-consistency` to the start skill (this is how an 8-session-old red gate slipped). Updated [[feedback-red-gates-are-p0]].
3. **D26 reviewer-inputs probe (`000f271`).** `scripts/probe-d26-reviewer-inputs.js`: all 35 D26 reqs have **0 existing candidates** (Workbench Manage tabs empty for D26 → smoke via Review Manager / older cycles), **5/5 legacy reviewer slots populated** (~175 recommended persons for Phase 3 to ingest), excluded free-text heterogeneous + mostly "N/A" noise. See [[project-d26-reviewer-inputs-probe]].
4. **MEMORY.md trimmed (`936472d`)** 29.0KB → 23.0KB (was over the load limit), all 110 entries + links preserved.
5. **Memory hygiene pass (`9006857`).** 110-entry audit (14-agent workflow) → Codex re-verified the 17 code-claims (0 refuted) → live Dataverse probes (`scripts/probe-memory-audit-verify.js`). **14 entries corrected, 0 deletions** (nothing obsolete). Notable: `reviewers` grant memory said "not built" (→ shipped); "no live code reads `wmkf_potentialreviewer1..5`" was **false** (read in `my-proposals.js` + `chat.js handleReviewerRequests` — **relevant to Phase 3 premise**); `wmkf_HonorariumRequest` field-name fix; VRP migration `003`. The `akoya_folio` payment memory was **re-confirmed correct** (folio is on the child `akoya_requestpayment`, not the parent — my probe had checked the wrong entity).

### Commits
- `efd56fd` /start gate-list gap · `64f694f` Phase 2 panel · `3096f3b` canManage fail-open · `000f271` D26 probe · `c820f2b` resolve-by-GUID + blank-panel + selection-count · `bfa1fac` reviewer-modes + 24 tests · `936472d` MEMORY.md trim · `3daf3fc` reconciliation-report refresh · `9006857` memory hygiene pass

## Potential Next Steps

### 1. ⭐ Phase 3 — Find panel + applicant-reviewer ingestion (the long pole; own session)
**Read build plan §Phase 3 first** — now well-grounded by the S209 D26 probe. Build `pages/api/workbench/applicant-reviewers.js` (idempotent materialize of `wmkf_appreviewersuggestion` from the request's legacy slots + excluded free-text; race-safe alternate-key upsert; excluded-wins collision). Then `ReviewerFindPanel.js` (relocate `NewSearchTab`, request-preselected, auto `load-proposal`, drop PDF-upload + `summaryPages`). Has the deferred fail-closed residuals (token-revocation-on-exclusion, `mintAndStore` sink, staff post-acceptance paths). **Decisions needed from Justin:** confident-match thresholds for excluded-name → person resolution. NB the probe found excluded text is heterogeneous (structured "Name:/Reason:" vs prose) + mostly "N/A" noise → parser must handle both + treat N/A as empty.

### 2. Ops + prod validation of Phase 1/2 (manual, quick)
- **Grant `reviewers`** to the 4 pilot PDs via `/admin` → App Access (the registry key grants no one).
- **Validate the dashboard tier in prod** — `/workbench` couldn't be smoked locally (PD-email gate needs a real Azure session). Now deployed; confirm the 35 D26 rows + My/All with a real login.

### 3. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (browser + Entra-gated)
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | Build plan — §Phase 3 (+ S209 ground-truth note) is next. READ FIRST. |
| `shared/components/reviewers/ReviewerManagePanel.js` | Shared Manage panel (both review-manager + Workbench). |
| `shared/components/reviewers/{ReviewersTab,SubTabBadges,reviewer-modes}.js` | Sub-tabs / badges / pure logic (`reviewer-modes` is unit-tested). |
| `pages/workbench/[requestId].js` | Per-request shell; Reviewers tab live, 8 placeholder tabs. |
| `pages/api/workbench/{dashboard,resolve-request}.js` | Dashboard feed + number/GUID resolver (`resolve-request` takes `requestId` or `requestNumber`). |
| `scripts/probe-d26-reviewer-inputs.js` / `probe-memory-audit-verify.js` | Re-runnable read-only Dataverse probes (S209). |

## Testing
```bash
npx jest                                 # 1605 tests
npm run lint                             # 0 errors (warnings don't gate)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:doc-currency && npm run check:fact-consistency
./node_modules/.bin/next build           # confirms routes compile (npm run build glitches the Bash tool this env)
# Workbench local smoke: inline-bypass next dev, open /workbench/<guid>?tab=reviewers (per-request path is email-independent).
```
