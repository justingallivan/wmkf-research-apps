# Session 207 Prompt: Proposal-lifecycle UI — build the D26 reviewer dashboard (or keep mocking)

## ⏰ Standing context / guardrails (carried from S197–S206)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity words into docs/memory. The authoritative source for lint counts is `npx eslint . -f json` keyed on `ruleId`/`severity`, NOT grep over the default formatter output.
- **Codex stop-time review gate is ENABLED** and was *very* active in S206 — it repeatedly caught over-claims in design docs/memory (assumptions written as final, stale wording after a rename, two grants collapsed into one). Lesson reinforced: when a design decision changes, **reconcile every restatement across mockup + scoping doc + memory + SESSION_PROMPT in the same turn**, and mark unresolved things OPEN, not final.
- **rtk grep filter STILL corrupts output.** For any "does X exist" verification use `rtk proxy git grep` or write-to-file + Read; never trust a bare `grep`/`rg`. `rtk` also compresses `jest` to a useless `PASS (N) FAIL (0)` — use `rtk proxy npx jest`.
- **Push deploys to prod.** `main` auto-deploys on Vercel. (S206 changed only `docs/` + `.claude-memory/` — nothing deployable.)
- **CI-green ≠ correct for async/effect code.** See [[feedback-profile-context-runtime-bugs]].
- **Local-dev auth:** full Azure login can't run on `localhost`. To smoke-test gated UI locally, add `AUTH_REQUIRED=false` + a throwaway `NEXTAUTH_SECRET` + `NEXTAUTH_URL=http://localhost:3000` to `.env.local`, run `npm run dev`, **and revert those 3 lines after**.

## Session 206 Summary

**A design / scoping session — no application code shipped.** Built the proposal-lifecycle UI as a clickable mockup + a Connor/Sarah-shareable scoping doc, and locked a large set of navigation/access decisions through live discussion with Justin. All output is in `docs/mockups/`, `docs/`, and `.claude-memory/`. 33 commits (`3f659a6` → `3e56275`); tree clean; **nothing deployable changed** (no `pages/`, `lib/`, schema, scripts).

### Deliverables
- **`docs/mockups/lifecycle-ui-mockup.html`** — self-contained clickable mockup (open in a browser; "Design notes" toggle overlays rationale + open-question pins; reviewer tab has a 3-tab compare toggle).
- **`docs/REQUEST_WORKBENCH_SCOPING.md`** — the shareable scoping doc. §6 holds the consolidated open questions.

### Decisions locked (all in [[project-reviewer-apps-redesign-direction]] S206 block + scoping doc)
1. **Tier-2 = a family of per-person role *lenses* over one cycle request list** (proposed framing; surfaces are real): **reviewer** (mocked; build now), **triage** (J27 spreadsheet-replacement winnowing ~200→32→28 / up to ~300), **editor** (writeup "Reviewed" tracker). Default landing = your primary lens.
2. **Reviewer tab = 4-tab + work-remaining badges**: Find / Invite / Track / **Completed**. State-aware default landing. Panels + badges are data-driven (no drift).
3. **"Closeout" disambiguated**: reviewer-level → **"Completed"** (sets `wmkf_reviewstatus=complete` + `wmkf_completedat` — **record-keeping, no trigger, no drop-off**; existing reviewer-submission + Steph remit payment path untouched); request-level → read-only **"Status"** (`akoya_requeststatus`, board-decided).
4. **D26 patch** = a **committed allowlist of the ~28 going-forward request numbers**; dashboard shows them regardless of `akoya_requeststatus` (avoids the 'Phase II Pending' PA trigger). **No Connor needed.** Verified only `pages/api/reviewer-finder/my-proposals.js` gates visibility on status.
5. **Access = Option B**: mint ONE new `reviewers` grant replacing `reviewer-finder` + `review-manager` (build-time migration + retire two appRegistry keys). Visibility filters by per-user app-access (`hasAccess()`), extended to Workbench tabs.
6. **Visibility model**: reading is **team-open** (Phase II *content* is collective); only the **Reviewers management tab** is lead-PD-gated. Scope My/All = personal filter. Plus the **request dossier** (click a request # → read-only request view).
7. **Captured future features**: **post-award Awardee stage** (GAL → abstract approval + artwork + release form; reuses the `lib/external` primitive — reviewer is instance #1, awardee #2) — see [[project-awardee-onboarding]]; **collaborative writeup editing** (PDs + CSO + President, lean = embed SharePoint co-authoring); **editor "Reviewed" dashboard** (tracking not a gate; resolves the track-changes silent case).

### Commits
33 commits `3f659a6`..`3e56275` (mockup build + iterative decisions + several Codex-driven reconciliations). Representative: `9f5e03f` lock 4-tab; `5cb06f4` Approve&Pay→Completed; `4cf9183` scoping doc; `29e9037` access Option B; `e4849cf` partial-silo scope + dossier; `72cb4b9` editor dashboard; `ba63f38` Reviewed-marker.

## Potential Next Steps

### 1. ⭐ Proposal-lifecycle UI — design is done; choose: build vs keep mocking
**Read [[project-reviewer-apps-redesign-direction]] (S206 block) + `docs/REQUEST_WORKBENCH_SCOPING.md` first.** Two forks:
- **(a) Build the D26 reviewer dashboard** — the near-term, real-deadline piece (D26 Phase II peer review ~mid-June 2026). **Blocked on Justin handing over the ~28 going-forward request numbers** for the committed allowlist. URL pattern `/workbench/[requestId]/...`; nothing built yet (no `/workbench` routes). One bit of schema groundwork IS live: `wmkf_appreviewersuggestion.wmkf_completedat` (S196, prod).
- **(b) Keep mocking** — the triage lens, the editor "Reviewed" lens, and the dossier (modal-for-peek + full-page) are not yet drawn; sketching them would pressure-test the lens-family framing before code.
- **Open questions to resolve before/at build** (full list = scoping doc §6): PD dashboard **row content / `isActionableForPD`** (reviewer-centric for v1); **access boundaries** (exact team-open read set; backup/co-PD reviewer-management; writeup-collaborator enforcement via SharePoint perms vs app capability + whether CSO/President get a light request-view entry); **editor dashboard** granularity (per request vs writeup-stage) + personal-vs-coordinator matrix; **J27 phase trigger** (Connor); **Awardee** GAL status value (findable via probe) + abstract-automation scope + document-routing fields + tab name.

### 2. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (browser-gated)
Fixture turnkey (`scripts/build-intake-eicar-fixture.py`), code path verified S205. Needs deployed env + Entra applicant session. [[project-intake-portal-virus-scan-e2e-deferred]].

### 3. BILL chunk-5 tail (ops / non-coding)
Office question (BILL self-registration address capture); ops before `BILL_ENABLED=true`: `HONORARIUM_*`/`BILLCOM_ACCOUNT_*` probe+set (`scripts/probe-honorarium-discriminators.js` is read-only prep), `honorarium.default_amount` via /admin, Steph's sandbox. Migration 017 applied S203.

### 4. Lint ratchet remainder (optional, risky — default: leave)
32 warnings, all React-Compiler-eligibility noise touching the ProfileContext effect hazard. CI won't block. Lowest priority.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | LOCKED architecture + the full S206 decisions block. READ FIRST for the lifecycle UI work. |
| `docs/REQUEST_WORKBENCH_SCOPING.md` | S206 Connor/Sarah-shareable scoping doc: tier-2 lens family, reviewer tab structure, D26 allowlist patch, access model, dossier, §6 open questions. |
| `docs/mockups/lifecycle-ui-mockup.html` | S206 clickable navigation mockup (open in browser; "Design notes" toggle). |
| `.claude-memory/project-awardee-onboarding.md` | Captured post-award awardee-onboarding feature (GAL → abstract/artwork/release; reuses `lib/external`). |
| `shared/config/appRegistry.js` | Source of truth for the apps that fold into the navigation model (Option B will retire `reviewer-finder`/`review-manager` keys). |
| `shared/components/Layout.js` | Current nav (filtered by `hasAccess()`) — the chrome the new global bar replaces; ~23/24 pages render through it. |
| `pages/api/reviewer-finder/my-proposals.js` | The only place that gates dashboard visibility on `akoya_requeststatus='Phase II Pending'` (verified S206) — the allowlist augments this. |

## Testing
```bash
rtk proxy npx jest                       # use `rtk proxy` — bare rtk compresses jest output
npm run lint                             # 0 errors / warnings only (CI blocks on errors only)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:fact-consistency
# Mockup is non-functional: open docs/mockups/lifecycle-ui-mockup.html in a browser; no test harness.
```
