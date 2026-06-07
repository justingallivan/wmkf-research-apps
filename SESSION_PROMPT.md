# Session 231 Prompt: Validate the reviewer-finder UI/COI changes on a real request; pick up open threads

## Session 230 Summary

Started as a quick Workbench UI tweak and turned into a full reviewer-finder pass: two UI consolidations, a recurring prod-bug class fixed + permanently gated, and the web-discovery feature evaluated on real proposals and **abandoned + removed**. All work committed and pushed; build + all `check:*` gates green.

### What Was Completed

1. **Workbench Find-tab UI consolidation**
   - **Merged the applicant-recommended list into the bottom "Optional: verify the applicant's suggested reviewers" card** (`954fd91`) — removed the standalone top card from `ReviewerFindPanel`.
   - **Folded the "Applicant-excluded reviewers" card into the Search card** (`e7fc59b`) — the parsed names already prefill the Exclude box; moved the "Applicant's original text" disclosure under it and deleted the redundant card.
   - **Not visually confirmed in-browser** (the session's local-auth detour ate that) — see Next Step #2.

2. **Fixed the "forgot `loadModelOverrides()` → Anthropic 404 on tier alias" bug class + a CI gate to end it**
   - Root cause that surfaced as "Mya Breitbart couldn't parse": `applicant-reviewers` (excluded-reviewer extraction) and `integrity-screener/screen` resolved a model without warming overrides → 404. Fixed both + regression test (`545ba0e`). Same class as S229's web-suggestions fix.
   - Built **`check:model-override-warming`** — an AST gate (`@babel/parser`) that fails any route reaching a model resolver without an awaited `loadModelOverrides()` first (`dbc5060`). Hardened across **two Codex review rounds** (`2fe4472`, `d560a0d`): ordering + await enforcement, alias resolution, `Promise.all`-wrap handling, transitive-only ignore marker. Wired into `package.json`, CI, `/start` gate list, `docs/CI_GATES_REFERENCE.md`.

3. **Web-grounded reviewer discovery — EVALUATED → ABANDONED → REMOVED**
   - v1.1 quality pass first (`62445ec`, COI matcher tightening `35b8b03`): individual-targeted queries, per-person rationale, COI filter (proposal PI/Co-Is), per-URL cap.
   - **Evaluated on 3 real proposals** (1002794 / 1002238 / 1002204) and **PubMed/ORCID-verified every name**: it reliably finds a few real experts but **fabricates** — invented people, invented emails (inconsistent), and **real people given fabricated affiliations/expertise**. Confidence self-report unreliable; fabrication scales with topic obscurity.
   - **Recorded as a failed experiment** (`202bcfc`: plan-doc OUTCOME banner + `project-reviewer-web-discovery-abandoned` memory) and **fully removed** (`502154d`, −1,194 lines): route, service, prompt, capability, UI, tests. `PERPLEXITY_API_KEY` kept (VRP sonar still uses it). Eval probes kept as evidence.

### Commits
- `954fd91` merge applicant-recommended into the verify card
- `545ba0e` warm model overrides in applicant-reviewers + integrity screen (+test)
- `dbc5060` / `2fe4472` / `d560a0d` add + harden `check:model-override-warming`
- `e7fc59b` fold applicant-excluded card into the search exclude box
- `62445ec` / `35b8b03` web-discovery v1.1 quality pass + COI matcher
- `202bcfc` record web-discovery as evaluated→abandoned
- `502154d` remove the abandoned web-discovery feature

## Potential Next Steps

### 1. Validate the S229 COI/concern + reseeded analyze prompt on a REAL request (the still-open original goal)
This was Session 230's *intended* first task and never happened. **#1002788 is a dummy corner case** (real project description pasted into a test request, dummy PIs, no abstract — confirmed S230) — don't use it. Pick a real request with a populated abstract + real PI/Co-Is and confirm: the model leans currently-active/mid-career over field founders, and conflicts land in POTENTIAL_CONCERNS → the amber advisory, with REASONING fitness-only. Per-user prompt override caveat still applies (override → dataverse → code-fallback).

### 2. Eyeball the two Find-tab UI changes in the browser
`954fd91` + `e7fc59b` changed the Find tab layout but were never visually verified (local Azure auth wasn't set up; `.env.local` now has the secrets — `npm run dev`, sign in via Microsoft). Confirm: the merged "Optional: verify…" card renders correctly at the bottom, and the exclude box prefills + shows the "Applicant's original text" disclosure with the excluded card gone.

### 3. `reset-request-reviewers --include-slots` still unexercised live (carryover from S229)
The slot-clearing path ($ref disassociation, nav-property `wmkf_PotentialReviewer{N}`) hasn't run live; watch its output + confirm the nav-property resolves the first time.

### 4. Reviewer web-discovery v2 — only if revisited
Deprioritized. If ever resumed, grounding is mandatory: agent/web as a discovery source ONLY, then verify a topical PubMed/ORCID record, derive affiliation+contact from the verified record (never the model), drop the ungroundable. Full rationale: `[[project-reviewer-web-discovery-abandoned]]`.

## Standing context / guardrails
- **`main` auto-deploys to prod on push. Commit/push only when asked.** Stage by explicit path (not `-A`).
- **`.env.local` points at the same prod Dataverse + Postgres.** Scripts that mutate hit prod — dry-run first.
- Dataverse-querying scripts need `enterDynamicsBypassForScript(label)`; the reviewer-agent probe (`scripts/probe-perplexity-reviewer-agent.mjs`) is read-only (`--request` pulls title/abstract/PI from Dynamics; `--dry-run` skips the paid call).
- `/contract-reconcile` + Codex review before declaring multi-layer work done (caught real defects again this session).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/ReviewerSearchSection.js` | The shared Find/standalone search UI — now owns the merged verify card + the exclusion box/disclosure |
| `shared/components/reviewers/ReviewerFindPanel.js` | Workbench Find sub-tab; ingests applicant reviewers, passes state to the search section |
| `scripts/check-model-override-warming.js` | CI gate: routes resolving a model must warm overrides first (+ `-self-test.js`) |
| `pages/api/workbench/applicant-reviewers.js` | Excluded-reviewer extraction; now warms overrides |
| `pages/api/integrity-screener/screen.js` | Integrity screening; now warms overrides |
| `docs/REVIEWER_WEB_DISCOVERY_PLAN.md` | Web-discovery design doc — now headed by the ABANDONED OUTCOME banner |
| `scripts/probe-perplexity-reviewer-agent.mjs` | Read-only eval probe kept as the abandoned-experiment evidence |

## Testing

```bash
npx jest reviewer applicant-reviewers          # reviewer-finder + COI/concern + warming regressions
npm run check:model-override-warming && npm run check:model-override-warming:self-test
# full startup gate set: see .claude/skills/start
```
