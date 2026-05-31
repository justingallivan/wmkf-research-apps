# Session 206 Prompt: Proposal-lifecycle UI navigation model (tier-3) — TOP PRIORITY

## ⏰ Standing context / guardrails (carried from S197–S205)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity words into docs/memory. The authoritative source for lint counts is `npx eslint . -f json` keyed on `ruleId`/`severity`, NOT grep over the default formatter output (which echoes disable-comment text).
- **Codex stop-time review gate is ENABLED** and thorough on async/state code.
- **rtk grep filter STILL corrupts output.** For any "does X exist" verification use `rtk proxy git grep` or write-to-file + Read; never trust a bare `grep`/`rg`. Also: `rtk` compresses `jest` output to a useless `PASS (N) FAIL (0)` — use `rtk proxy npx jest` to see real pass/fail + test names.
- **Push deploys to prod.** `main` auto-deploys on Vercel.
- **CI-green ≠ correct for async/effect code.** See [[feedback-profile-context-runtime-bugs]].
- **Local-dev auth:** full Azure login can't run on `localhost`. To smoke-test gated UI locally, add `AUTH_REQUIRED=false` + a throwaway `NEXTAUTH_SECRET` + `NEXTAUTH_URL=http://localhost:3000` to `.env.local`, run `npm run dev`, **and revert those 3 lines after**.

## Session 205 Summary

Short session. Opened the board, closed out the EICAR question, then surfaced + parked the big lifecycle-UI initiative.

### Start-of-session checks — all green
- CI gates green: `check:atlas` (32 PG / 32 DV), `check:atlas:self-test` (12/12), `check:api-routes` (96 routes; the two BILL routes are *warnings*, not failures). Git clean, up to date, memory store consolidated.

### Item 1 (EICAR intake e2e) — DEFERRED again (browser/ops-gated, by Justin's call)
- Did everything solo-verifiable: **re-verified the live `attach.js` infected-branch path is UNCHANGED** from the S203 memory (`:430` infected branch → `:432-433` delBlob + removePending → `:459`/`:486` `draft.attach_infected` audit + `virus_detection_intake` alert → `:526` `jsonError(422, 'infected')`). Rebuilt the fixture: `/tmp/eicar-test-exe.docx` (34,783 bytes, `PK` magic, embeds `/bin/ls`).
- Residual is the irreducible manual gate only: deployed env with `VIRUS_SCAN_ENABLED=true` + `CLOUDMERSIVE_API_KEY` + a real Entra-authed applicant session through `/apply`. Runbook lives in [[project-intake-portal-virus-scan-e2e-deferred]]. No prod changes made. No code touched.

### Lifecycle UI — NEW TOP PRIORITY, deferred to S206 by Justin
- Discussed "thornier issues about the UI for the proposal lifecycle." Justin scoped it to **tier-3: the whole-lifecycle navigation model** — how launcher → cycle dashboard → per-request Workbench fit together as ONE coherent UI, and how the existing standalone apps fold in. (NOT the reviewer-lifecycle slice; that's a separate, now-lower item.)
- Not started tonight (deliberately). **Bumped to top priority.** Justin wants to **build mockups with a Claude browser session** to explore the navigation model visually before/alongside the scoping doc.
- Captured in [[project-reviewer-apps-redesign-direction]] with a dated S205 reprioritization note.

### Commits
- (memory/docs only — committed at `/stop`; no code commits this session)

## Potential Next Steps

### 1. ⭐ TOP PRIORITY — Proposal-lifecycle UI: tier-3 navigation model + mockups
The thorny initiative Justin wants to hit. **Read [[project-reviewer-apps-redesign-direction]] in full first** — the three-tier architecture (global launcher → cycle-scoped PD dashboard → per-request Workbench at `/workbench/[requestId]/...`) is the LOCKED frame. What's unrendered and genuinely thorny is the **stitching between tiers**: where a PD lives by default, how they move launcher→cycle→request without losing context, how standalone apps (Dynamics Explorer, Power Tools, Literature Analyzer, Grant Reporting) coexist with per-request tabs.
- **Approach Justin wants:** Claude browser session producing **interactive HTML/React mockups** he can click through (flow matters more than static images for a navigation model).
- **Ground truth:** nothing built (`git grep -i workbench` returns nothing in source), no `/workbench` routes, no scoping doc yet. Clean slate past the memory architecture.
- **Reviewer tab structure: DECIDED S206 — 4-tab + status badges** (Find / Invite / Track / Approve & Pay), default landing Track. (Arc: briefly 3-tab w/ "Roster", then reconsidered and locked — "Roster" is a non-action noun, Invite vs Track are distinct modes, white-space worry minor at per-request scale; badges on the tab bar recover Roster's at-a-glance overview, counting work-remaining not totals.) "Closeout" disambiguated: reviewer-level step → "Approve & Pay" (honorarium trigger); request-level endpoint → read-only "Status" (reflects Dynamics `akoya_requeststatus`, board-decided, not PD-editable). Still-open: PD dashboard row content; the approve→payable status field name owed to Connor.
- **Deliverable target:** `docs/REQUEST_WORKBENCH_SCOPING.md` (Connor/Sarah-shareable) — never written. Phasing change matters: J26 is last dual-phase cohort; going forward ONE submission entered as Phase I with "Phase II" as an internal status flip (see [[project-grant-phasing-evolution]]).

### 2. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (browser-gated)
Fixture turnkey (`scripts/build-intake-eicar-fixture.py`), code path verified S205. Needs deployed env + Entra applicant session. [[project-intake-portal-virus-scan-e2e-deferred]].

### 3. BILL chunk-5 tail (ops / non-coding)
Office question (BILL self-registration address capture); ops before `BILL_ENABLED=true`: `HONORARIUM_*`/`BILLCOM_ACCOUNT_*` probe+set (`scripts/probe-honorarium-discriminators.js` is read-only prep), `honorarium.default_amount` via /admin, Steph's sandbox. Migration 017 applied S203.

### 4. Lint ratchet remainder (optional, risky — default: leave)
32 warnings, all React-Compiler-eligibility noise touching the ProfileContext effect hazard. CI won't block. Lowest priority.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | LOCKED three-tier architecture + S205 reprioritization. READ FIRST for the lifecycle UI work. |
| `docs/GRANT_CYCLE_LIFECYCLE.md` | Canonical lifecycle stages/statuses (current cycle); note the cycle-redesign-in-flight banner. |
| `shared/config/appRegistry.js` | Single source of truth for the existing apps that must fold into the navigation model. |
| `shared/components/Layout.js` | Current nav (filtered by app access) — the surface tier-3 reworks. |
| `scripts/build-intake-eicar-fixture.py` | Builds `/tmp/eicar-test-exe.docx` for the parked intake virus-scan e2e. |

## Testing
```bash
rtk proxy npx jest                       # 1549 tests (use `rtk proxy` — bare rtk compresses jest output)
npm run lint                             # 0 errors / 32 warnings (CI blocks on errors only)
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:fact-consistency
```
