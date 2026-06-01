# Session 208 Prompt: Build the Request Workbench — Phase 0 (foundation)

## ⏰ Standing context / guardrails (carried from S197–S207)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity words into docs/memory. Authoritative lint counts = `npx eslint . -f json` keyed on `ruleId`/`severity`, NOT grep over the default formatter.
- **Codex stop-time review gate is ENABLED** and was *very* active in S207 — four review rounds on the build plan caught a too-narrow scope claim, an incomplete junction-reader audit, an allowlist `scope=my` bug, race/resolution gaps, and an internal contradiction. Lesson reinforced: reconcile every restatement in the same turn; mark unresolved things OPEN; verify-as-you-go.
- **rtk grep filter STILL corrupts output.** For "does X exist" use `rtk proxy git grep` or write-to-file + Read; never trust a bare `grep`/`rg`. `rtk` also compresses `jest` — use `rtk proxy npx jest`.
- **Push deploys to prod.** `main` auto-deploys on Vercel. (S207 changed only `docs/` + `.claude-memory/` — nothing deployable.)
- **CI-green ≠ correct for async/effect code.** See [[feedback-profile-context-runtime-bugs]]. Manual smoke is mandatory for load-bearing async logic.
- **Local-dev auth:** full Azure login can't run on `localhost`. To smoke gated UI locally, add `AUTH_REQUIRED=false` + throwaway `NEXTAUTH_SECRET` + `NEXTAUTH_URL=http://localhost:3000` to `.env.local`, `npm run dev`, **and revert those 3 lines after**.
- **Read-only Dataverse probe pattern (used S207):** load `.env.local` → client-credentials token (`DYNAMICS_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET`/`URL`) → GET `…/api/data/v9.2/…`. Inline `node -e` works without writing a script; needs `dangerouslyDisableSandbox` for network.

## Session 207 Summary

**A design / pre-implementation session — no application code shipped.** Justin handed over the 35 going-forward D26 request numbers, which unblocked the Request Workbench build. Output: a complete, Codex-vetted implementation plan + one memory entry + a deferral note. 2 commits (`0e4ac04`, `4099778`); tree clean; **nothing deployable changed.**

### What was completed
1. **`docs/REQUEST_WORKBENCH_BUILD_PLAN.md` (new, v3) — implementation-ready.** Complements the S206 scoping doc with the *how*: phases, file paths, signatures. Cleared **four Codex review rounds** (final verdict: implementation-ready, no contradictions).
2. **Grounded against live state:** verified the `'Phase II Pending'` gate, variadic `requireAppAccess`, the reviewer-suggestion adapter, `Stage2aView` rendering `wmkf_abstract`, and **a live Dataverse probe confirming `wmkf_abstract` is populated for all 35 D26 requests** (lengths 918–2,478 chars).
3. **Find modernization decided with Justin** (not a verbatim port): Find defaults to the request's documents (drop PDF upload); applicant **recommended + excluded** reviewers unify on `wmkf_appreviewersuggestion` via a **new `wmkf_applicantdisposition` picklist** (`recommended`/`excluded`), per-request scoped; recommendations enriched on equal footing on the PD's search run; excludes kept free-text-raw + mirrored to structured rows on confident match; `summaryPages`/`summaryBlobUrl` removed (abstract replaces it). Stale-UI retirements: "My Candidates" → Invite, legacy `.eml` path, three email-config fragments, RM Overview/Proposal-Detail tabs.
4. **`canManage` resolved (S207):** soft UI gate for v1, server stays **org-open** (today's behavior; emails are attributed, field/file writes are service-account-attributed). The **system-wide `DYNAMICS_IMPERSONATION_ENABLED` flip is DEFERRED to a future session** (env-wide change; needs its own privilege audit). Recorded in the build plan + `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`.
5. **Memory:** created [[project-intake-portal-reviewer-capture]] — the new intake portal writes applicant reviewers to the junction + disposition flag (not the legacy slots/free-text).

### Commits
- `0e4ac04` — Request Workbench build plan (v3) + memory + identity-doc deferral note
- `4099778` — fix Codex round-3 finding (line-34 "just unread" contradiction)

## Potential Next Steps

### 1. ⭐ Build Phase 0 — foundation (low-risk, no UI). **Read `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` first.**
Phase 0 is the safe starting slice (no UI, easily testable):
- Add the `reviewers` app grant to `appRegistry.js` (additive; not in DEFAULT_APP_GRANTS).
- Make the 18 reviewer-finder/review-manager API routes accept `, 'reviewers'` (variadic).
- Admin label + guide + baseConfig entries.
- **Deploy the new `wmkf_applicantdisposition` picklist** on `wmkf_appreviewersuggestion` (delegated creator privileges; idempotent script; doc in `INTAKE_PORTAL_SCHEMA_CHANGES.md` + atlas). NB: `wmkf_completedat` is already deployed — adapter wiring only.
- Adapter: add `wmkf_completedat` + `wmkf_applicantdisposition` to FIELD_SELECT/maps; stamp `completedAt` on complete in `reviewers.js`.
- **Junction-reader filter audit** (load-bearing): `disposition ne excluded` on all candidate/count readers incl. `grant-cycles-dataverse` aggregate + the upsert lookup + a shared chokepoint for the findById/token-mint action paths; excluded rows `wmkf_selected=false`.
- Tests: `ALL_APP_KEYS`, genuinely-wrong `wrongApp` key, excluded-filter unit test.
Then Phase 1 (dashboard + allowlist + grant assignment), Phase 2 (Workbench shell + Manage panel), Phase 3 (Find panel + applicant ingestion — the long pole). Phases are sized one-per-session.

### 2. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (browser-gated)
Fixture turnkey (`scripts/build-intake-eicar-fixture.py`), code path verified S205. Needs deployed env + Entra applicant session. [[project-intake-portal-virus-scan-e2e-deferred]].

### 3. BILL chunk-5 tail (ops / non-coding)
Office question (BILL self-registration address capture); ops before `BILL_ENABLED=true`: `HONORARIUM_*`/`BILLCOM_ACCOUNT_*` probe+set, `honorarium.default_amount` via /admin, Steph's sandbox. Migration 017 applied S203.

### 4. DEFERRED — system-wide impersonation flip (future session, NOT this build)
`DYNAMICS_IMPERSONATION_ENABLED=true` is the path to per-person attribution on Dataverse field/file writes, but it's env-wide (all app-driven writes). Needs a privilege audit across every write path + the outstanding `/phase-i-dynamics overwrite=true` smoke. See `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`. Do NOT couple it to the Workbench build.

### 5. Lint ratchet remainder (optional, low priority — default: leave)
React-Compiler-eligibility noise; CI won't block.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | **v3, implementation-ready.** The build plan: phases, file paths, signatures, CI-gate doc updates, verification. READ FIRST. |
| `docs/REQUEST_WORKBENCH_SCOPING.md` | S206 Connor/Sarah scoping doc (the *what/why*). |
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | Locked architecture + S206 decisions. |
| `.claude-memory/project-intake-portal-reviewer-capture.md` | Applicant reviewers → junction + `wmkf_applicantdisposition` (going-forward). |
| `shared/config/appRegistry.js` | Add the `reviewers` grant here (Phase 0). |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Adapter to extend (completedAt + applicantdisposition + reader filters). |
| `pages/api/reviewer-finder/my-proposals.js` | Status-gate + `fetchReviewerCounts` reused by the dashboard endpoint. |
| `pages/api/review-manager/reviewers.js` | Mark-complete PATCH (stamp both timestamps); single-request fetch path. |
| `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` | Deferred impersonation flip + privilege-intersection contract. |

## Testing
```bash
rtk proxy npx jest                       # use `rtk proxy` — bare rtk compresses jest output
npm run lint                             # 0 errors / warnings only (CI blocks on errors only)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:fact-consistency
# Phase 1 smoke: AUTH_REQUIRED=false + throwaway NEXTAUTH_* in .env.local, npm run dev, open /workbench (revert after).
```
