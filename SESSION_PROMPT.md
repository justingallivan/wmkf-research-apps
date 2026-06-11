# Session 240 Prompt: Reviewer-origination — validated multi-lane direction (NOT-YET to build)

> ⚠️ **PARALLEL WORK STREAM (active, added 2026-06-10).** A separate session (Claude or
> Codex) is working **reviewer onboarding** on its own branch/worktree — do **not** touch
> it from this main tree:
> - **Branch:** `feat/reviewer-onboarding-no-bill-this-cycle` · **Worktree:**
>   `/Users/gallivan/Code/WMKF_onboarding` (own checkout; `node_modules` + `.env.local`
>   symlinked, so no `npm install`). Launch that session with cwd = the worktree so it
>   can't switch this tree's branch (it did, accidentally, via Codex on 2026-06-10).
> - **Status:** 1 commit (`4110c41`, deferred-bill onboarding impl + phone +
>   `docs/REVIEWER_ONBOARDING_FLOW_MOCKUP.md`) ahead of `main`, 27+ behind; **no PR**;
>   drop-onto-`main` was conflict-free (merge-tree clean) but **not yet reviewed/CI'd** →
>   land via a **reviewed PR**, not a fast-forward to prod-`main`.
> - **Ownership split:** the onboarding session owns its branch (`lib/bill/*`,
>   `external/review/*`, `Stage2aView`, the mockup doc). **This main session owns `main`
>   (reviewer-ORIGINATION work) AND shared repo-wide files** — `MEMORY.md`,
>   `SESSION_PROMPT.md`, `package.json`, `docs/CANONICAL_COUNTS`/fact docs. See
>   `.claude/skills/agent-coordination` + `docs/AGENT_COLLABORATION_PLAN.md`.

## Session 239 Summary

All on `main` (auto-deploys to prod). S238 ended by preparing a **rescue dossier** worried
we were circling — patching candidate *handling* while *origination* stayed broken. S239
took the rescue verdict, **empirically validated the origination diagnosis with three
read-only probes + two independent Codex passes**, and landed a **safety-reviewed
validated-direction strategy** (design only — **NOT BUILT**).

### What Was Completed

1. **Rescue verdict verified, not trusted.** The fresh-model rescue review (it agreed
   origination is the diseased layer but pushed *grounded* over the full redesign) made
   live-checkable claims — I verified them: OpenAlex Frebel canonical record = **323 works**
   (the "6" was a name-search stub artifact), and author-aggregation returns real ranked
   people. Corrected the plan's stale §2.3/§6 "OpenAlex disqualified/metrics-unreliable"
   claim (`3dbd3f9`).

2. **Probe #1 — grounded-origination** (`scripts/probe-grounded-origination.mjs`, `3bd5b90`).
   Measured the **disease**: ~92–98% of surfaced candidates are **keyword-reconstructed**
   (Track-B `query_seed`), domain-independent; pure hallucination (`barred_parametric`) ≈ **0**.
   Recall gap: a grounded person-level query recovers real leaders the keyword crawl misses
   (Corkum/Krausz physics; Muir chem-bio; Samson DNA-repair). Findings doc `63db72a`.

3. **Codex falsification pass (origination verdict)** → **SURVIVE-WITH-CAVEATS**. Its one
   correct structural catch: "guess" over-loaded the word — adopted as
   **"keyword-reconstructed"**. Key reframe (Justin): the disease is the keyword *MECHANISM*
   (paper-match + 1-author minting), **not** LLM keywords — keyword→author-*aggregation* is fine.

4. **Probe #2 — Tier-3 applicant trail** (`scripts/probe-applicant-trail-origination.mjs`,
   `fef704b`→`3ad8eb9`). Justin's key inputs drove two findings:
   - **PI identity is STRUCTURED + free:** `akoya_request._wmkf_projectleader_value` → a
     `contact` carrying `wmkf_orcid` → **exact** OpenAlex (no namesake). Supersedes LLM
     extraction (which misresolved "Wen Li" → "Yanping Li"). [[project-reviewer-pi-identity-structured]]
   - **OpenAlex MERGES same-name authors** → use the **ORCID works list** as the corpus,
     not the author cluster (rescued Wen Li: chemistry blob → Keller/Corkum/Krausz).
     [[project-openalex-merge-use-orcid-works]]
   - 3-request map: continuing-line **WIN** (Albanese, Wen Li post-fix); **pivot** (Ted Abel,
     novel DNA-repair hypothesis) covered by **peer-groups + topic-aggregation** (the
     narrative names "Madabhushi and Tsai"), not the PI-trail.

5. **Validated-direction strategy §12** in `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md`
   (`f842d63`). **Multi-lane harvesters** (cited-DOI · PI-trail · peer-groups ·
   topic-aggregation); **coverage = union, confidence = convergence ON IDENTITY (shared
   ORCID / exact work authorship), never on a name**.

6. **Codex strategy-doc review (2 passes)** → **NOT-YET**; safety corrections applied
   (`ed72b6a`, `8c60585`): retired the unsafe name-convergence claim; scoped ORCID-works
   tradeoffs + inert fallback; COI is broader than the trail (advisor/advisee +
   all-time-collaborator have **no gate today** = net-new); named the integration seams.

7. **Memories captured** (`af2662e`): [[project-reviewer-origination-multilane]] +
   the two gotcha files above. **Parallel onboarding worktree** set up (banner ↑).

### Commits (all on `main`, pushed)
- `0de146f` drain-table fix · `3bd5b90` probe#1 · `63db72a` findings · `3dbd3f9` §2.3 fix ·
  `f1815de` review-request · `fef704b`/`3ad8eb9` probe#2 (Tier-3 ORCID) · `f842d63` §12 ·
  `ed72b6a`/`8c60585` Codex safety fixes · `af2662e` memories · `acebec8` parallel-stream pointer

## Potential Next Steps

### 1. Reviewer-origination — the NOT-YET build work (primary)
Per Codex, the **doc-level safety items are cleared; what remains is design/implementation.**
In rough leverage order:
- **Quick win, broad benefit:** wire the **structured-ORCID PI identity** (request Project
  Leader → contact `wmkf_orcid`) into the live pipeline — it improves PI exclusion + COI
  everywhere, not just the trail. Add an OpenAlex call to `lib/services/openalex-service.js`
  (ORCID→author, ORCID works list); do **not** promote probe raw-`fetch` code as-is.
- **Identity-equality corroboration** — how lanes prove "same person" (shared ORCID / exact
  work authorship); never name overlap. The ranking layer counts corroboration only at
  identity level.
- **Two net-new COI gates** — advisor/advisee + all-time-collaborator (today prompt-text only).
- **Peer-group parsing lane** (designed, unbuilt) — extract "Peer Groups: X and Y" → resolve
  each to a specific identity before promotion.
- **Facet generation** — broader/atomic queries (5-word MeSH strings → OpenAlex corpora of 0–20).
- Wire all lanes INTO `discover()` / `reviewer-provenance` / `save-candidates` / Workbench —
  not a parallel pipeline.
Canonical design: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12. Read
[[project-reviewer-origination-multilane]] first.

### 2. Carryover (still open from S238)
Manual-add dedup **write path** never live-smoked (PR #21); applicant-exclusion breadth
policy (`project-applicant-exclusion-policy-pending`); combined Phase I+II PA doc-assembly.

## Loose ends / gotchas
- `main` auto-deploys to prod on push. No backticks in `git commit -m` (use a message file).
  Codex runs in an ISOLATED worktree off HEAD → commit before delegating.
- **Probe result files are gitignored** (`smoke-results-*.txt`); the probes are read-only +
  reproducible (each makes ≤2 paid LLM calls / public API calls; Tier-3 probe is LLM-free).
- **Identity-equality safety rule** is load-bearing: two lanes agreeing on a NAME is not
  identity proof — would reintroduce the wrong-email/affiliation failure the save-path
  force-null gate exists to prevent. See [[project-reviewer-verify-fail-dangerous]].
- Router `MEMORY.md` is slightly over its soft byte target (under the hard cap) — a trim
  pass is due eventually.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` | **Canonical** — §12 = validated multi-lane origination direction (+ Codex safety corrections) |
| `docs/REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md` | Probe #1 disease-metric + recall-gap writeup |
| `docs/REVIEWER_FINDER_REVIEW_REQUEST.md` | Handoff prompt for a fresh model to review the direction |
| `scripts/probe-grounded-origination.mjs` | Read-only: disease metric + topic-aggregation + reference lane |
| `scripts/probe-applicant-trail-origination.mjs` | Read-only, LLM-free: PI-trail via structured ORCID + ORCID-works |
| `.claude-memory/project-reviewer-origination-multilane.md` | The validated direction (router entry) |

## Testing
```bash
# Read-only origination probes (reproducible):
node --import ./scripts/lib/use-extensionless.mjs scripts/probe-grounded-origination.mjs --request 1002794
node --import ./scripts/lib/use-extensionless.mjs scripts/probe-applicant-trail-origination.mjs --request 1002794   # LLM-free
npx jest reviewer discovery suggestion disposition save-candidates search-logic   # reviewer battery
npm run build && npm run lint                          # green before pushing
# full startup gate set: see .claude/skills/start
```
