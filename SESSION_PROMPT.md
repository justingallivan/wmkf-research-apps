# Session 209 Prompt: Request Workbench — Phase 2 (Manage panel)

## ⏰ Standing context / guardrails (carried from S197–S208)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. Authoritative lint counts = `npx eslint . -f json` keyed on `ruleId`/`severity`, NOT grep over the default formatter.
- **Codex stop-time review gate is ENABLED** and was active in S208 — it caught (1) batch/thank-you complete transitions skipping `wmkf_completedat`, (2) the fail-closed boundary leaking, (3) dashboard rows linking to a missing route. Each was a real fix. Reconcile every restatement in the same turn; verify-as-you-go.
- **rtk grep filter STILL corrupts output.** For "does X exist" use `rtk proxy git grep` / `git grep` / write-to-file + Read; never trust a bare `grep`/`rg`. `rtk` also compresses jest — use `rtk proxy npx jest` (or plain `npx jest`).
- **Push deploys to prod.** `main` auto-deploys on Vercel. CI is now GREEN again (S208 fixed a chronically-red `check:doc-currency` step that had masked the real jest signal for ~8 sessions).
- **CI-green ≠ correct for async/effect code.** [[feedback-profile-context-runtime-bugs]]. Manual smoke is mandatory for load-bearing async/UI logic — **the S208 Workbench UI was NOT browser-smoked yet** (data layer was validated headlessly).
- **`/start` gate-list gap:** the start skill only runs `check:atlas` + `check:api-routes`. It does NOT run `check:doc-currency` or `check:fact-consistency` — which is why a red `doc-currency` gate slipped for sessions. **Quick win: add both to `.claude/skills/start`** so this class surfaces at session start.
- **Local-dev auth:** full Azure login can't run on `localhost`. To smoke gated UI: add `AUTH_REQUIRED=false` + throwaway `NEXTAUTH_SECRET` + `NEXTAUTH_URL=http://localhost:3000` to `.env.local`, `npm run dev`, **revert those 3 lines after**.
- **Read-only Dataverse probe pattern (used S208):** load `.env.local` → `DynamicsService.getAccessToken()` → GET `…/api/data/v9.2/…`. Inline `node -e` works; needs `dangerouslyDisableSandbox` for network.

## Session 208 Summary

**Built and shipped Request Workbench Phase 0 + Phase 1 + the per-request shell, fixed a long-standing red CI, all green and on prod.** 4 commits; tree clean. Read `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` first.

### What was completed
1. **Phase 0 — grant + disposition foundation (`79a343d`).** Additive `reviewers` app grant (18 reviewer-finder/review-manager routes now variadic `requireAppAccess(..., 'reviewers')`; legacy keys NOT retired). New **`wmkf_applicantdisposition`** picklist (Recommended=100000000 / Excluded=100000001; null = staff/Claude-discovered) **deployed to prod Dataverse** (wave6, idempotent, verified). Excluded rows filtered from all candidate/count readers via the **null-safe** `notExcludedFilter()` — see [[project-dataverse-odata-null-filter]] (a bare `ne` would have dropped all normal rows). Fail-closed chokepoints: `findById`, `updateLifecycle` (every write, post-Codex), `ensureToken`/`regenerate-token`, `verifySuggestionToken`. `wmkf_completedat` stamped on EVERY complete transition (centralized in adapter `updateLifecycle`, post-Codex). Codex-reviewed; remaining sinks recorded as Phase-3 acceptance criteria in the build plan.
2. **CI fix (`1aff4a3`).** The CI "Tests" job had been red on every push for ~8 sessions — not jest, but `check:doc-currency` exiting 1 (before build/tests ran) on a missed allow-list entry for real schema filenames in `APPRESEARCHER_COLLAPSE_PLAN.md`. Allow-listed; CI green again.
3. **Phase 1 — dashboard + allowlist (`44c10b6`).** `/workbench` tier-2 cycle dashboard + `/api/workbench/{dashboard,resolve-request}`. Additive union: status-gated PD/cycle query ∪ (for D26) the committed allowlist of 35 going-forward request NUMBERS (`shared/config/d26Allowlist.js`). Grounded live: all 35 are Phase I Pending (gate excludes them → allowlist is load-bearing), all Dec-2026 dated (→ D26), 4 PDs. Headless smoke vs prod: scope=all → 35; scope=my partitions cleanly (8+6+13+8). `my-proposals.js` untouched. Reconciled `api-route-file-count` 96→98, `requireappaccess-endpoint-count` 51→53, `app-definition-count` 17→18.
4. **Per-request shell (`eeb5da3`).** `/workbench/[requestId].js` stub (tab strip + placeholder panels) so dashboard rows resolve instead of 404ing (Codex catch).

Full suite **1581 green**, 0 lint errors, all CI gates green, build passes, CI run green each push.

### Commits
- `79a343d` — Phase 0: reviewers grant + applicant-disposition foundation (hardened)
- `1aff4a3` — Fix chronically-red CI: allow-list real schema filenames in doc-currency
- `44c10b6` — Phase 1: cycle dashboard + D26 allowlist
- `eeb5da3` — per-request shell so dashboard rows resolve

## Potential Next Steps

### 1. ⭐ Phase 2 — Manage panel (the real Reviewers-tab content)
**Read the build plan §Phase 2 first.** Extract Review Manager's reviewer-management substance + inline deps (`StatusBadge`, `TokenStateBadge`, `TokenActionsMenu`, `StatusSummary`, `EmailModal`, `UploadReviewModal`, `StatusDropdown`) from `pages/review-manager.js` → **`shared/components/reviewers/ReviewerManagePanel.js`** (props `{ proposal, reviewers, loading, onRefresh, mode∈{invite,track,completed} }`). Strip the proposal-selector dropdown + standalone proposal info card + per-app signature bar. Both `review-manager.js` AND the Workbench shell import it; Workbench feeds one request via `reviewers.js?proposalId=<guid>`. Also `ReviewersTab.js` (4 sub-tabs, `canManage` gate) + `SubTabBadges.js`. **Regression budget:** verify `review-manager.js` still renders/sends/uploads identically against the shared module.

### 2. Ops to make the Workbench actually usable (manual, quick)
- **Grant `reviewers`** to the 4 pilot PDs via `/admin` → App Access (the registry key grants no one).
- **Browser-smoke `/workbench`** under the local auth bypass (data layer validated headlessly; the UI itself wasn't rendered).

### 3. Quick tooling win — close the `/start` gate-list gap
Add `check:doc-currency` (+ self-test) and `check:fact-consistency` to `.claude/skills/start` so a red drift gate surfaces at session start (this is how the 8-session-old red CI slipped). Update [[feedback-red-gates-are-p0]] accordingly.

### 4. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (browser-gated)
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session.

### 5. Phase 3 — Find panel + applicant-reviewer ingestion (own session; the long pole)
Also where the deferred fail-closed residuals land (token-revocation-on-exclusion, `mintAndStore` sink, staff post-acceptance paths). See build plan §Phase 3 + §"Excluded-row fail-closed boundary".

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | The build plan — phases, signatures, Phase-3 fail-closed criteria. READ FIRST. |
| `pages/workbench.js` / `pages/workbench/[requestId].js` | Tier-2 dashboard / tier-3 per-request shell (Phase 1). |
| `pages/api/workbench/{dashboard,resolve-request}.js` | Dashboard feed (additive allowlist union) + number→GUID. |
| `shared/config/d26Allowlist.js` | 35 going-forward D26 request numbers (throwaway). |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `notExcludedFilter()`, `isExcluded()`, `findById` throw, `updateLifecycle` every-write guard + complete-stamp. |
| `pages/review-manager.js` | Source of the reviewer-management substance to extract in Phase 2. |
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | Locked architecture + S208 build status. |

## Testing
```bash
npx jest                                 # 1581 tests; or `rtk proxy npx jest`
npm run lint                             # 0 errors (warnings don't gate)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:doc-currency && npm run check:doc-currency:self-test && npm run check:fact-consistency
npm run build                            # confirms /workbench routes compile
# Phase 1/2 smoke: AUTH_REQUIRED=false + throwaway NEXTAUTH_* in .env.local, npm run dev, open /workbench (revert after).
```
