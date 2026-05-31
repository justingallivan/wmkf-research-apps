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

### 1. ⭐ TOP PRIORITY — Proposal-lifecycle UI: design DONE (S206), build next
**S206 produced the design artifacts.** Clickable mockup at `docs/mockups/lifecycle-ui-mockup.html` (open in a browser; toggle "Design notes" for rationale + the 3-tab compare). Shareable scoping doc at `docs/REQUEST_WORKBENCH_SCOPING.md`. **Read [[project-reviewer-apps-redesign-direction]] (S206 decisions block) + the scoping doc before continuing.** Note: there are still no `/workbench` UI/routes/write-paths; one piece of schema groundwork IS deployed — `wmkf_appreviewersuggestion.wmkf_completedat` (PD-closeout stamp, S196, prod 2026-05-28).
- **Tier-2 = a family of per-person role lenses over one cycle request list (S206):** (a) **reviewer lens** = the mocked *post-shortlist* surface (request queue → per-request Workbench; Reviewers tab = v1) — replaces Reviewer Finder + Review Manager; (b) **triage lens** (J27) = upstream spreadsheet-replacement winnowing funnel (D26 ~200→32→28; J27 up to ~300), NOT yet mocked; (c) **editor lens** (future) = writeup "Reviewed" tracker for PDs + CSO + President (President only looks at writeups); tracking not a gate — explicit per-editor "Reviewed" marker resolves the track-changes silent case (no-edits = reviewed-or-not-looked). Default landing = your primary lens. Lens-unification is a proposed framing; surfaces are real.
- **D26 (current, dual-phase) patch — the near-term build:** reviewer dashboard fits D26 as-is (Phase II = already-winnowed set). Pre-populate via a **committed allowlist of the ~28 going-forward request numbers** — dashboard shows them regardless of `akoya_requeststatus` (avoids the 'Phase II Pending' PA trigger; **no Connor needed**). Verified [2026-05-31]: only `pages/api/reviewer-finder/my-proposals.js` gates visibility on status; invite/external/honorarium paths don't. Justin supplies the ~28 as a one-shot batch (advanced as a group, no trickle).
- **Reviewer tab structure: DECIDED S206 — 4-tab + status badges** (Find / Invite / Track / Completed), state-aware default landing (earliest funnel step with outstanding work: Invite if shortlisted-unsent, Track if invited, Completed if reviews back awaiting sign-off, Find if nothing). (Arc: briefly 3-tab w/ "Roster", then reconsidered and locked.) Badge note: every tab surfaces work-remaining (attention); Completed shows **"# to review"** (amber, returned-not-marked) + **"# completed"** (green progress) — Justin asked S206 that attention stay visible, not just a done-count. "Closeout" disambiguated: reviewer-level step → **"Completed"** (sets `wmkf_reviewstatus=complete` + `wmkf_completedat`; **record-keeping only — no trigger, no drop-off**; honorarium is a SEPARATE staff-gated path on the reviewer-submission signal); request-level endpoint → read-only "Status" (reflects Dynamics `akoya_requeststatus`, board-decided, not PD-editable). Scoping doc written: `docs/REQUEST_WORKBENCH_SCOPING.md`.
- **Phasing:** **D26 is the current/last dual-phase cohort**; **J27** is the first single-submission cycle (one doc entered as Phase I, "Phase II" = internal status flip; full proposals ~Dec 2026, up to ~300, most never reviewed). See [[project-grant-phasing-evolution]].
- **Next-build open items:** (1) PD dashboard **row content / `isActionableForPD`** (reviewer-centric for v1). (2) **J27 phase trigger** (Connor). *(Payment-gate question CLOSED S206 — option a: tab named "Completed", no trigger, no drop-off, existing reviewer-submission + staff-remit payment path untouched.)*

### 2. Intake virus-scan EICAR e2e — STILL the parked pre-cycle must-do (browser-gated)
Fixture turnkey (`scripts/build-intake-eicar-fixture.py`), code path verified S205. Needs deployed env + Entra applicant session. [[project-intake-portal-virus-scan-e2e-deferred]].

### 3. BILL chunk-5 tail (ops / non-coding)
Office question (BILL self-registration address capture); ops before `BILL_ENABLED=true`: `HONORARIUM_*`/`BILLCOM_ACCOUNT_*` probe+set (`scripts/probe-honorarium-discriminators.js` is read-only prep), `honorarium.default_amount` via /admin, Steph's sandbox. Migration 017 applied S203.

### 4. Lint ratchet remainder (optional, risky — default: leave)
32 warnings, all React-Compiler-eligibility noise touching the ProfileContext effect hazard. CI won't block. Lowest priority.

## Key Files Reference

| File | Purpose |
|------|---------|
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | LOCKED three-tier architecture + S206 decisions block. READ FIRST for the lifecycle UI work. |
| `docs/REQUEST_WORKBENCH_SCOPING.md` | S206 Connor/Sarah-shareable scoping doc: tier-2 lens family (reviewer/triage/editor), reviewer tab structure, D26 allowlist patch, access model, dependencies, scope fences. |
| `docs/mockups/lifecycle-ui-mockup.html` | S206 clickable navigation mockup (open in browser; "Design notes" toggle). The reviewer dashboard rendered. |
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
