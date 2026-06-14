# Session 255 Prompt: COI Chunk 2b shipped end-to-end + a write-time MEMORY.md placement guard

> **GIT.** All S254 work is on `main`. Working tree clean. 4 commits (3 feature/fix + this doc commit).
> Verify push state at startup; the memory-placement hook commit was the last one made.

## Session 254 — what happened

Two threads, both finished and verified: (1) **COI Chunk 2b** — retired the AI `POTENTIAL_CONCERNS`
amber advisory across code + prod, after a verify-callers pre-flight and a Codex adversarial review;
(2) a new **write-time MEMORY.md placement hook** so adding a router line forces a route-it-properly
decision instead of bloating the auto-loaded router.

### What was completed

1. **COI Chunk 2b — retire `POTENTIAL_CONCERNS` (`da6fb70`).** The last substantive in-repo build of the
   S240 COI policy. Removed the model-emitted PD-unverifiable amber advisory from the **prompt** (both
   byte-parity files), **parser** (`parseAnalysisResponse` capture + `isNoConcernText` deleted),
   **validator** (`prompt-validators.js` required label), **repair prompt** (`claude-reviewer-service.js`),
   **both card renders** (`pages/reviewer-finder.js` + `ReviewerSearchSection.js`), and the
   **roster-prune persist** (`reviewer-search-logic.js`). Reworded REASONING to fitness-only/no-COI (kills
   the original S229 COI-into-REASONING bug) and softened the institution line so the model no longer
   pre-adjudicates COI (it's deterministic server-side now). **Key safety call:** the parser KEEPS
   `POTENTIAL_CONCERNS` as a REASONING terminator only — a lingering emission (e.g. before prod reseed) is
   parse-and-discarded, never bled into reasoning. Verify-callers pre-flight first (ruled out
   integrity-screener as a false positive). Full suite **2384 green**, lint/build/A7 clean.

2. **Codex adversarial review folded in (`e3ee80c`).** Codex: *no blocking defect* on the code path (all
   6 attack vectors held, incl. the deploy→reseed-window parse-and-discard). Two LOW gaps fixed:
   `scripts/validate-reviewer-analyze.mjs` (a `.mjs` eyeball harness that fell outside the `*.js` grep —
   still read `s.potentialConcerns`; removed dead refs, kept+corrected the REASONING-no-COI check as the
   surviving invariant) and the stale SESSION_PROMPT next-step.

3. **Prod Dataverse reseed — DONE (Justin ran it).** `seed-reviewer-finder-prompts.js --execute
   --only=analyze`. Read-only audit confirms the live `reviewer-finder.analyze` row now: `POTENTIAL_CONCERNS`
   **absent**, new fitness-only REASONING + new institution wording present, body **4502 B** (was 4637).
   Code + tests + docs + live prompt are all consistent.

4. **Durable docs/memory reconciled** (in `da6fb70`): Chunk2 design banner + §1/§6 → shipped (doc now
   historical), ENFORCEMENT_CONTRACTS, D26 flowchart, AI_PROMPTS_OVERVIEW (also cleared adjacent S253
   search-query debt), reviewer-identity wiki, PI-identity plan, and both COI memories
   (`project-reviewer-coi-concern-surfacing` classified historical; `…-rely-on-self-disclosure` build-status
   → shipped). All drift gates green.

5. **Write-time MEMORY.md placement hook (`2eeb3da`).** New PreToolUse Write|Edit hook
   `.claude/hooks/memory-placement-reminder.js` fires advisory context when an edit ADDS a `- ` router line
   to `.claude-memory/MEMORY.md`, forcing the "wiki topic vs leaf file vs existing home" decision. Fills the
   gap: `agent-wiki-reminder` skips MEMORY.md, and `memory-router-guard` only blocks AFTER over-budget.
   Net-neutral/shrinking edits stay silent. Pipe-tested; wired in `.claude/settings.json` (7 PreToolUse
   entries now); instruction-architecture + agent-invariants green.

### Commits (this session)
`da6fb70` retire POTENTIAL_CONCERNS (Chunk 2b) · `e3ee80c` apply Codex review · `2eeb3da` memory-placement
hook · (+ this S255 doc commit).

## ⚠ Continuity guardrails — READ before reviewer/prompt/memory work

- **COI Chunk 2 is fully shipped (2a S240 + 2b S254).** `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` is now
  HISTORICAL design rationale. Current COI policy: `project-reviewer-coi-rely-on-self-disclosure`; live
  gates: `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`.
- **`POTENTIAL_CONCERNS` parser terminator is intentional.** `parseAnalysisResponse` still lists it in the
  REASONING terminator alternation purely to parse-and-discard a stray field. Do NOT remove it unless you're
  certain no prompt (prod row, per-user override) can still emit it.
- **If you edit `SCORE_CANDIDATES_USER_PROMPT_TEMPLATE`,** reseed its prod row too
  (`--execute --only=score-candidates`) — it was NOT reseeded this session (unchanged, fine).
- **New memory-placement hook is now live.** When you add a line to MEMORY.md you'll get a placement nudge —
  honor it: route domain detail to a `docs/agent-wiki/topics/*.md` page, durable lessons to a leaf
  `.claude-memory/<slug>.md` (MEMORY.md = terse pointers only), and update an existing home rather than
  appending. memory-router-guard still hard-blocks over-budget growth.
- Memory router stays **hub-link form**; `grep`/`rg` may corrupt identifiers+digits
  (`project-rtk-grep-output-corruption`) — use Read for exact content.

## Potential Next Steps

### ★ CYCLE OBJECTIVE — park a confirmed reviewer slate before Phase II (the "hold" step)
Main thread for the coming cycle (next few days); lead with it. Full plan + code finding:
memory `project-reviewer-hold-step-decouple`.

**The plan (Justin, S256 — confirmed):** this is the LAST cycle with a delay before Phase II
proposals arrive — exploit it. Build a **pre-accept "hold/soft-confirm" step** so the flow is
find → validate → invite → **hold** → calendar invite → park. A reviewer agrees in principle now,
sits tight, and is told when proposals will land. **Defer** COI/AI policy acks + honorarium payment
+ proposal delivery to a later "finalize" (weeks out, when Phase II ships).

**Why a build, not a run (code finding, verified S256):** the current Stage-2a accept
(`pages/api/external/review/[token]/respond.js`) hard-requires BOTH policy acks (`reviewer-coi` +
`reviewer-ai-use`) AND a full payment contact at accept time, and runs honorarium onboarding —
there is no confirm-without-commitment path today. The hold step is the gap; it also keeps the
Connor-gated honorarium/Bill.com prod automation (`project-reviewer-accept-prod-automation`) from
firing this cycle.

**Design constraint — merge-forward:** model "hold" as a real engagement state that "finalize"
transitions out of (hold → finalize), so in steady state the two run back-to-back through a short
staff-QA window (the gap shrinks but never hits zero — see readiness trigger). No throwaway
scaffolding. Mechanics delegated to us; pick what's easiest this cycle that still merges. Chosen:
option 1 (new pre-accept hold) over splitting accept or staff-side-only.

**Readiness trigger (resolved S256):** hold→finalize is gated on **proposal readiness** behind a
single `isProposalReadyForReviewers(request)` predicate. **"Phase II submitted" ≠ "ready to send" —**
staff run a QA pass (figures render? shareable?) between receipt and release that Justin expects to
persist, so readiness = the staff **"release to reviewers" after QA** (likely a PERMANENT staff
control, not interim). `wmkf_phaseiisubmittedat` (written by
`shared/forms/phase-ii-research-2026-06/map-to-dynamics.js`) marks RECEIPT / a precondition, not
readiness. **Justin todo (w/ Connor):** identify the post-QA staff-release/visibility signal (or
confirm we add an explicit "release to reviewers" control). **Still open:** ICS calendar-invite scope
(net-new; build-now vs save-the-date email fast-follow). Full design: `project-reviewer-hold-step-decouple`.

**Next concrete step:** scope the build — trace the engagement state machine (`respond.js` +
`lib/dataverse/adapters/reviewer-suggestion.js` `applyStage2aResponse`, the `wmkf_reviewstatus` /
`wmkf_responsetype` states), find/confirm the calendar-invite mechanism, and the portal UX for hold.
Three-stage deeper maps: `reviewer-origination.md`, `reviewer-identity.md`,
`external-reviewer-portal.md`, `reviewer-workbench-lifecycle.md`.

### Deferred / externally-blocked (do NOT lead with these; verify before acting)
- Recall padding-ceiling live check before raising count >15 (needs API key + a real proposal).
- SerpAPI Hobby-tier downgrade eval (Justin, out-of-repo billing dashboard).
- `score-candidates` prod prompt reseed — only if you edit its template (unchanged S254).
- `affiliationHistory` producers — COI-inert dead code, deferred (`project-deferred-code-cleanup`).

## Parked — do NOT surface in startup summaries
> These are user-recall-only. Do not echo them into `/start`'s Potential Next Steps
> or any unprompted output; act only when the named un-park trigger actually fires.
> See `feedback-dont-resurface-parked-items`.
- **PubPeer migration off SerpAPI** — contingent on a sanctioned-API reply from PubPeer
  (Justin emailed them S251; suspects no reply). Full context + un-park trigger live in
  `docs/agent-wiki/topics/integrity-screener.md` and `project-serpapi-capability-erosion`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/config/prompts/reviewer-finder{,-dynamics}.js` | analyze prompt — POTENTIAL_CONCERNS removed S254 (byte-parity pair) |
| `shared/config/prompts/reviewer-finder.js` | `parseAnalysisResponse` keeps POTENTIAL_CONCERNS as a parse-and-discard terminator |
| `lib/utils/prompt-validators.js` · `lib/services/claude-reviewer-service.js` | required-label + repair prompt (token dropped) |
| `scripts/validate-reviewer-analyze.mjs` | read-only eyeball harness — updated for the retirement |
| `docs/REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` | design owner — now HISTORICAL (both chunks shipped) |
| `.claude/hooks/memory-placement-reminder.js` | NEW write-time MEMORY.md placement nudge |

## Testing
```bash
npx jest --testPathPatterns "reviewer|discovery|prompt"   # 622 green
npm test && npm run lint && npm run build                 # full suite 2384 green
# read-only audit of the live analyze prompt row (needs prod approval + bypass ctx):
#   enterDynamicsBypassForScript(...) then fetchCurrentPrompt('reviewer-finder.analyze')
```
