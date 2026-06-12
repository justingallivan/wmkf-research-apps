# Session 247 Prompt: reviewer-finder origination — direction SETTLED for D26 Phase-I (Claude-assisted wins)

> **GIT.** S246 work is **merged to `main` and pushed** (`d89265b` experiment + tooling,
> `0285e6f` this handoff). The branch `reviewer-origination-experiment` is now redundant
> (can be deleted). Origination direction is SETTLED for the D26 Phase-I cohort — the S245
> "direction OPEN" framing is superseded.

## Session 246 — what happened

S245 left reviewer-finder origination direction **genuinely OPEN** and specced a forward
source-grounded experiment to settle it. **S246 ran that experiment** (as a pilot) and
**settled the practical direction for the D26 Phase-I cohort: Claude-assisted origination
beats the bare grounded arm.** Then verified the write-up with Codex and corrected one overclaim.

### What was completed
1. **Built the experiment harness** (read-only w.r.t. live data; OpenAlex + 2 LLM calls/proposal; NO Dataverse writes):
   - `scripts/probe-grounded-origination.mjs --blinded-sheet` — emits a per-request 3-arm slate (A=current pipeline, B=grounded G1 OpenAlex topic→author agg + G2 cited-DOI, C=applicant `wmkf_potentialreviewer1..5`) + hidden arm key. PI/Co-PI/excluded names (from Dataverse) dropped from A/B not C.
   - `scripts/origination-sniff-sources.mjs` — source-labeled markdown + topic-anchored dossiers (affiliation/field/active-span; flags trainee/deceased/merged).
   - `scripts/origination-sniff-tally.mjs` — per-arm pick-rate from the judged sheets.
2. **Ran 10 D26 Phase-I proposals** (`1002865, 1002878, 1002886, 1002902, 1002904, 1002913, 1002914, 1002967, 1002971, 1003019`). Justin = the PD oracle (sniff test "would I pick this person?" substituting for accept/decline).
3. **Result:** 1002878 blind — A **13/20 (65%)** vs B **8/23 (35%)** vs C 4/5 (80%); across all 10 grounded re-found the applicant's own recs **1/50** vs Claude **11/50** (39/50 found by neither). Grounded pool riddled with wrong-field/deceased/trainee. → **"Claude-assisted wins" gate: keep Claude spine, defer retrieval-first cutover.**
4. **Wrote it up + reconciled** the S245 "OPEN" status: new `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md`; updated `REVIEWER_FINDER_ORIGINATION_PLAN.md` (status + §4), agent-wiki `topics/reviewer-origination.md`, memory `project-reviewer-origination-experiment-result.md` + router.
5. **Codex-verified** the doc claims; corrected the one overclaim Codex caught (don't conflate §12's *valid* topic→author lane with the separate "OpenAlex author-cluster as PI corpus" hazard). All doc/memory gates green.

### Commits
- `d89265b` — docs(reviewer-origination): S246 forward sniff-test experiment result + tooling
- `0285e6f` — docs(session): S247 handoff (both merged to `main`, pushed)

## Potential Next Steps

### 1. Direction-independent ships (what actually helps D26 — the experiment says invest HERE)
- **Recall sampling** — more `analyze` draws / higher candidate count (people are lost to undersampling regardless of arm; 39/50 of the applicant's own recs were found by neither arm).
- **Referral capture** (`project-reviewer-referral-capture`).
- **SerpAPI → free-stack migration** (`project-serpapi-capability-erosion`).

### 2. If grounded is ever revisited
Build the **ORCID-works-anchored multilane** (per §12) with field-routed expansion — NOT bare topic→author aggregation — and judge against **real accept/decline**, not a sniff test. The experiment does NOT license cutover against a properly-built grounded arm.

### 3. Carryover (still open from S242–S245, verify-before-acting)
- Reviewer COI **Chunk 2b** (retire `POTENTIAL_CONCERNS`) — deferred; ⚠️ destructive.
- expense-reporter prod spot-check (low-pri); download proxy is **PARKED**.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md` | The experiment result + caveats + decision |
| `docs/REVIEWER_FINDER_ORIGINATION_PLAN.md` | Plan; §4 reconciled OPEN→result |
| `scripts/probe-grounded-origination.mjs` | `--blinded-sheet` 3-arm emitter |
| `scripts/origination-sniff-{sources,tally}.mjs` | Dossiers + per-arm pick-rate |
| `.claude-memory/project-reviewer-origination-experiment-result.md` | The durable lesson |

## Gotchas
- **`tmp/origination-sniff/` dossiers are degraded** — a regen hit the OpenAlex rate/daily quota (thousands of calls made today). The `*.key.json` files are intact and authoritative; only the `*.sources.md` dossiers are stale. Regenerate with `node scripts/origination-sniff-sources.mjs` once quota resets (~24h). `tmp/` is gitignored (real reviewer names stay local).
- Minor: `scripts/origination-sniff-sources.mjs:11` header comment says "title = field anchor" but the code uses title + Arm-B topics (left unfixed per "just correct the docs").
- Reviewer probes make paid LLM calls + write `api_usage_log`; run unsandboxed (network to Dynamics/SharePoint/OpenAlex/Claude).
