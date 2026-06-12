# Session 245 Prompt: reviewer-finder origination — direction OPEN, decision plan settled

> **GIT.** Local `main` is **ahead of `origin/main` by 10 commits** (`f17fa3b..d1f7ea8`) —
> **NOT pushed.** Push when ready. One of these is a **live PROD change**: `13800e3`
> reseeded the prod Dataverse `reviewer-finder.analyze` prompt (seniority relaxation).

## Session 244 — what happened

S244 started as "scope the reviewer-finder origination redesign for D26" and turned into
a long **epistemic correction** about what the production data actually supports. Net: the
"demote Claude origination, rebuild on grounded retrieval" premise (§12) is **neither
confirmed nor refuted** by the J26 data — the question is genuinely **OPEN**, and the way
to settle it is a forward experiment, now specced.

### Shipped / committed (10 commits)
- `b848624` docs: reconciled Workbench reviewer-lifecycle status (Phases 0–3 shipped, 5 sub-tabs).
- `42811bc` docs: prompt-decomposition + grounded field-review design (pre-impl; Codex-reviewed).
- `70c9230` memory: **SerpAPI is the largest expense ($150/mo) + value eroded** → free-stack migration path (`project-serpapi-capability-erosion`).
- `61d5659` feat(probe): `probe-grounded-origination.mjs` takes repeatable `--file-key` (cycle-coupled doc concat).
- `13800e3` **feat: relaxed the analyze-prompt seniority de-prioritization — PROD Dataverse reseeded.** Confirmed it recovers good active seniors (Fukuto).
- `82ceb4b` memory: endorsed **referral-capture** feature (`project-reviewer-referral-capture`).
- `f9b7f6c`→`1561179` docs: J26 origination **evidence** doc (v1→v2; Codex found both overstated).
- `c3dfb98`→`d1f7ea8` docs: **`REVIEWER_FINDER_ORIGINATION_PLAN.md`** — Codex-authored, Claude-reviewed, Codex-re-reviewed (SHIP/REVISE, zero reverts).

### The key finding (read the two docs before any reviewer-origination work)
- `docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md` — J26 saved-tag data is **confounded by the save/dedup pipeline** (verified-name dedup pre-resolution `discovery-service.js:246`; top-25 identity budget `:295`; unresolved system-discovered rows rejected at save `save-candidates.js:56,127`). So `scholarly-only saved = 0` is **nearly inevitable by construction** and says nothing reliable about origination. It licenses only "Claude-present survival under historical instrumentation."
- **Instrument lesson:** single/few `analyze` draws *undercount* Claude recall (sampling variance — union grew 12→17→21). The DB is the instrument, not probe re-runs. And even the DB `invited/accepted` booleans "include defaults / are not engagement signals" (`READINESS_AUDIT_2026-05-25.md:406`) — **Justin's own per-proposal confirmations are the real ground truth.**

## Potential next steps

### 1. The decisive build: forward source-blinded experiment
`docs/REVIEWER_FINDER_ORIGINATION_PLAN.md` is settled. It pits **arm 1 (current Claude-assisted)** vs **arm 2 (retrieval-first: Claude plans facets but NEVER names reviewers — the §12 design, NOT "Claude-free")**, optional **arm 3 (deterministic facets)**. Co-equal primaries: accept+referral rate AND coverage/starvation. Reconciles with the redesign plan's build→invert→cutover sequencing. **Before running:** build a blinding transform (the UI shows source today — `ReviewerSearchSection.js:306`), a grounded-lane runner (ORCID-works + OpenAlex + Claude-planned facets), outcome capture; **fill the bracketed thresholds with real numbers first.**

### 2. Direction-INDEPENDENT ships (don't wait on the experiment)
- **Seniority relaxation** — DONE (live).
- **Recall sampling** — bump `analyze` candidate count / multiple draws (real people are lost to undersampling regardless of which direction wins).
- **Referral capture** (`project-reviewer-referral-capture`) for the human/referral tail (free-text→person resolution; reuse manual-add S236 + identity spine).
- **SerpAPI → free-stack cost migration** (`project-serpapi-capability-erosion`): metrics→Semantic Scholar, lit-search→S2/OpenAlex, PubPeer native; downgrade/exit the flat sub (~$1,800/yr → tens).

### 3. Entangled — do NOT ship to prod before the experiment
The prompt-decomposition (read → mini-review/why-now → **facets**) and the grounded one-pager: the *facet/origination* parts are the treatment being tested. The model/legibility parts (staff one-pager prose, ranking text) are separable. See `REVIEWER_FINDER_PROMPT_DECOMPOSITION_DESIGN.md`.

### 4. Carryover (still open from S242/S243, unchanged, verify-before-acting)
- Reviewer COI **Chunk 2b** (retire `POTENTIAL_CONCERNS`) — deferred; ⚠️ destructive.
- expense-reporter prod spot-check (low-pri); download proxy is **PARKED** (not a to-do).

## Gotchas
- `UPLOADS_BLOB_RW_TOKEN` is SENSITIVE (`vercel env pull` returns it empty; already in `.env.local`).
- Reviewer probes are read-only but make **paid LLM calls + write `api_usage_log`**; run unsandboxed (network to Dynamics/SharePoint/OpenAlex/Claude).
- D26 reviewer-finding is the near-term real deadline; the experiment is for settling direction, not a D26 blocker — the direction-independent ships (§2) are what help D26.
