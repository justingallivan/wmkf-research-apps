---
title: Memory Hygiene Best-Practices Review — 2026-08-21
summary: "Evidence-backed evaluation of the repository's memory-hygiene architecture, controls, and audit history against current official documentation and research, with prioritized recommendations and the basis for docs/MEMORY_HYGIENE_RUNBOOK.md."
canonical: false
owner: product-engineering
last_verified: 2026-08-21
---

# Memory Hygiene Best-Practices Review — 2026-08-21

Status: point-in-time evidence report. Re-run the named read-only checks before
relying on any count or size in this document. Companion deliverable:
`docs/MEMORY_HYGIENE_RUNBOOK.md` (the durable operating procedure derived from
this review).

Repo baseline: branch `codex/fable-memory-hygiene-runbook` at `053bd9f9`
(worktree `.claude/worktrees/fable-memory-hygiene`). All commands below were run
in this worktree on 2026-08-21. No memory file, checker, hook, instruction file,
or live system was modified by this review.

## 1. Executive conclusion

The repository has a **coherent, deliberately designed memory architecture** —
not merely accumulated controls. The five-layer model (CLAUDE.md → SESSION_PROMPT
→ router → leaf memories → Atlas/wiki/source) was designed in
`docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md` (2026-06-04) and matches what current
official Anthropic documentation and the research literature independently
recommend: a thin preloaded index, content retrieved on demand, structural truth
held outside memory, and explicit status/supersession metadata.

The controls are structurally strong and semantically weak, by design: the
router gate, write-time guard, and health advisory prove shape, links, and
metadata; semantic freshness has only ever been established by periodic
evidence audits (May, July, and August 2026). Those audits were effective but
ad-hoc — each one reinvented its own method, scope, and reporting.

The load-bearing quantitative finding is a **router sawtooth**: the router
regrows at ~166–200 bytes/day after every diet, and **every enforcement layer is
silent below the 11 KiB warn band**, so the proposed 8 KiB "comfort threshold"
was crossed (on 2026-08-15) with zero signal from any control. Limits are
appropriate as backstops; what is missing is a scheduled, procedural diet
trigger well below them. That, plus a codified deep-audit method (the S154-V2
falsification disciplines), is what the new runbook supplies.

Verdict on the prior snapshot supplied to this review: **confirmed in full**,
with two minor precision corrections (§5, §9).

## 2. Scope and methodology

**Mode:** `/sweep` Mode B — domain truth audit of the memory-hygiene control
surface. This is an evaluation-and-design phase: no memory, checker, hook, or
instruction edits were in scope.

**Claims verified or falsified:**
1. the supplied current-state snapshot (router size, file counts, thresholds,
   guard semantics, drift-report staleness, growth trajectory);
2. the conclusions of the prior audits (2026-05-14 S154 V1/V2, 2026-07-02,
   2026-07-08, 2026-07-22, 2026-07-27, 2026-07-29, 2026-08-15);
3. the proposition that current thresholds and the proposed 8 KiB comfort
   threshold are appropriate;
4. the fourteen evaluation questions in the work order (§10).

**Evidence classes used:** current source of the three checkers and two hooks
(read in full); git history of `.claude-memory/MEMORY.md` (`git log --follow`
plus `git show <commit>:.claude-memory/MEMORY.md | wc -c` at 20+ commits); the
full 57-gate startup battery plus targeted re-runs of the three memory checks;
the committed drift report JSON; whole-file reads of the router, the three
currently flagged leaf memories, the reorganization plan, and all eight prior
memory audits; official Anthropic and OpenAI documentation and primary research
retrieved 2026-08-21 via three parallel web-research passes (citations in §6).

**Excluded:** live Dataverse/Postgres/Vercel probes (documentation task; the
standing owner rule requires explicit authorization for production Dataverse
reads); the mutating `check:memory-drift` path (would dirty the tracked report);
edits to any in-scope control (deferred to owner-approved follow-up).

## 3. Current architecture (as verified)

| Layer | Surface | Role | Control |
|---|---|---|---|
| Operating rules | `CLAUDE.md` (= `AGENTS.md` symlink) | stable cross-agent rules | `check:instruction-architecture`, `check:agent-invariants[:ci]`, `check:harness-framing` |
| Handoff | `SESSION_PROMPT.md` | current session state only | `/start`/`/stop` skills; `check:fact-consistency` scan scope |
| Router | `.claude-memory/MEMORY.md` | startup routing table only — auto-loaded every session | `check:memory-router` (CI + `/start`); PreToolUse `memory-router-guard.js`; SessionStart pressure note |
| Leaf memory | `.claude-memory/*.md` (247 files) | durable lessons, decisions, hazards, historical rationale | frontmatter `status:` enforced by router gate; `check:memory-health` (advisory); `check:doc-symbol-refs`; `check:build-claim-freshness`; `check:fact-consistency` |
| Retrieval hubs | `docs/agent-wiki/` | domain routing + hazards, subordinate to source | `check:agent-wiki` + reminder hook |
| Structural truth | Atlas + source + probes | live-state authority | `check:atlas`, claim-labeling rule, `check:memory-drift` (advisory registry) |

Key verified mechanics:

- **Router gate** (`scripts/check-memory-router.js`): hard caps 12,288 B
  (`TARGET_BYTES`) and 150 lines; warn band above 11,264 B (`WARN_BYTES`);
  200-char per-line prose cap with `.md` refs stripped; link resolution; leaf
  frontmatter `status:` ∈ {active, stale, closed, superseded}. Enforced in
  GitHub CI (`.github/workflows/test.yml:29-30`) and `/start`.
- **Write-time guard** (`.claude/hooks/memory-router-guard.js`): PreToolUse on
  Write|Edit of the router only; blocks an edit only when it makes an over-cap
  dimension *strictly worse* (monotonic comparison); **fails open** on any
  internal error; **cannot see** harness/auto-memory writes or non-Claude
  writers (Codex, direct edits). Thresholds are imported from the gate script —
  single-sourced.
- **Health advisory** (`scripts/check-memory-health.js`): read-only, never
  fails; regex heuristics per active leaf — `no-recall-rule` (heading absence),
  `weak-basis` (structural vocabulary + missing/weak `last_verified`, with a
  documented `feedback-*` exemption), `oversize-routed` (routed + >5,120 B),
  `shadow-atlas` (structural vocabulary with no grounding pointer),
  `stale-routed` (retired but routed). Not in CI; `/start` only.
- **Drift check** (`scripts/check-memory-drift.js`): evaluates the committed
  `docs/RECONCILIATION_REPORT.json`; blocks on spec-without-entity, >50%
  row-count drift, doc-label collisions, probe errors. The regeneration path
  (`reconcile-memory-claims.js`) loads `.env`/`.env.local` and performs live
  probes — which is why routine audits must use `--no-write`. Its claim
  registry is narrow by design (Wave 2 specs, Atlas row counts, a fixed
  historical audit anchor).
- **Session lifecycle hook** (`.claude/hooks/session-lifecycle.js`): SessionStart
  emits the wiki-routing note and a router-pressure note **only above the 11 KiB
  warn band** — note this hook hardcodes its own 11/12 KiB constants
  (`session-lifecycle.js:286-287`) rather than importing the checker's exports,
  so a threshold change must touch it separately (see R3); Stop runs
  changed-surface gates (advisory by default), enforces
  same-session doc-staleness markers and adversarial-review receipts for
  high-risk docs.
- **Storage invariant:** durable memory lives in git-tracked `.claude-memory/`;
  the harness auto-memory path is symlinked into it per machine/worktree
  (verified in this worktree: the slug path resolves to this worktree's
  `.claude-memory`). This predates — and is consistent with — the officially
  documented auto-memory layout (§6.1).

## 4. Historical evolution

Router size trajectory, measured directly from git (`git show
<commit>:.claude-memory/MEMORY.md | wc -c`):

| Date | Commit | Bytes | Event |
|---|---|---:|---|
| 2026-06-04 08:53 | `91f75975` | 26,173 | peak — **above the documented 25 KB harness load truncation** (§6.1) |
| 2026-06-04 09:13 | `ba105f78` | 24,314 | first trim ("index under harness limit") |
| 2026-06-04 10:22 | `4cb926d8` | 7,331 | reorganization → router model |
| 2026-06-12 | `d89265bd` | 11,322 | regrowth ~500 B/day; guard hardened 2026-06-10 mid-window |
| 2026-07-02 | (audit) | 11,255 → 5,941 | Slice 1 router diet (control audit) |
| 2026-07-08 | (S348) | 8,149 | +~368 B/day since diet |
| 2026-07-29 | `813da56a` | 11,298 → 5,175 | semantic reconciliation diet (~198 B/day regrowth over 27 days) |
| 2026-08-21 | `053bd9f9` | 8,991 | +3,816 B in 23 days (~166 B/day); 66 lines; passed 8 KiB on 2026-08-13 (`840d082d` = 8,193 B) |

Leaf store and advisory-signal trajectory (from the prior audits, each verified
against its own document):

| Date | Leaf files | Health signal | Source |
|---|---:|---|---|
| 2026-05-14 | 63 (audit counted 64 incl. the index) | pre-advisory; V1/V2 audits found the dangerous class: false negative claims ("not built", "still load-bearing") | `docs/AUDIT_S154_MEMORY{,_V2}.md` |
| 2026-07-02 | 191 | 179 active; 102 weak verification basis; 34 without recall rule | `docs/audits/memory-hygiene-control-audit-2026-07-02.md` |
| 2026-07-08 | 211 | 129 → 124 flagged (advisory shipped this day) | `docs/audits/memory-triage-2026-07-08.md` |
| 2026-07-22 | — | 117 → 97 flagged | `docs/audits/memory-health-evidence-triage-2026-07-22.md` |
| 2026-07-27 | 223 | 97 → 0 flagged (full-queue sweep; the report itself warns the zero is structural, not semantic) | `docs/audits/documentation-memory-hygiene-sweep-2026-07-27.md` |
| 2026-08-15 | 243→245 (intra-day, `dc15f0bb`→`614f05be`) | 8 → 0 flagged; checker's feedback exemption implemented | `docs/audits/memory-housekeeping-2026-08-15.md` |
| 2026-08-21 | 247 | 3 files flagged (§5) | this review |

Two structural readings of this history:

1. **The sawtooth is a control-design outcome, not an anomaly.** Every layer
   (hard cap, warn band, write guard, SessionStart note) activates only near
   11–12 KiB. Below that, growth is free. With a durable-fact write rate of
   ~166–500 B/day, a diet to ~5 KiB buys roughly 3–5 weeks of silence, then the
   warn band and a reactive diet. The 2026-07-02 audit's <8 KiB acceptance
   criterion and the 07-29 audit's "below the 8 KB target" were both one-time
   statements with no recurring trigger attached — which is exactly why 8 KiB
   was crossed silently this cycle.
2. **Advisory-count resets do not persist.** 97→0 (07-27) and 8→0 (08-15)
   were each followed by new findings within days-to-weeks, because new leaves
   arrive continuously (63 → 247 in ~14 weeks). A hygiene process must assume a
   steady inflow, not a clearable backlog.

## 5. Current check results (2026-08-21, this worktree)

Startup battery: **all 57 registered `check:*` scripts and self-tests passed**,
run sequentially per the fixture-race rule (`check:migrations-manifest` through
`check:types`; log retained in the session scratchpad). Relevant details:

```
npm run check:memory-router
→ memory-router OK — MEMORY.md 8991 bytes / 66 lines; 247 topic file(s),
  all links resolve + all carry a valid status.

npm run check:memory-health -- --json
→ counts: {filesScanned:247, flagged:3, no-recall-rule:1, weak-basis:1,
  oversize-routed:2, shadow-atlas:0, stale-routed:0}

npm run check:memory-drift:no-write
→ note: --no-write — evaluating the committed report read-only; it is >24h old
  and was NOT regenerated (drift_buckets/probe data may be stale).
→ memory drift clean: 5 live drift findings; 0 spec/entity blockers; 0 large
  row-count drifts; 0 doc collisions; 0 probe errors.
```

The committed drift report was generated 2026-08-17T14:27:54Z; its five
`stale_row_count` entries are small deltas — three alias variants of the
reviewer suggestion entity at 793→794 (one row) and two alias variants of the
potential-reviewer entity at 4,474→4,478 (four rows) — far below the 50%
blocking threshold. So the snapshot claim holds: **blocking criteria pass, and the
committed report is stale** (4 days old against a 24-hour freshness contract);
the checker discloses this itself.

**Prior-snapshot verification** — every supplied number reproduced: 8,991 B;
247 topic files; 3 advisory findings; 12 KiB/11 KiB/150-line/200-char caps; the
guard's monotonic-below-cap + fail-open semantics (read in source); growth
5,175 B (2026-07-29) → 8,991 B. Two precision notes: (a) the checker reports 66
lines by `split('\n').length` — the file has 65 newline-terminated lines; (b)
"three findings" is three *files* carrying four flag instances.

**Treating the three advisory findings as a worklist** (files read in full; no
edits made, per scope):

| File | Flags | Classification | Recommended disposition |
|---|---|---|---|
| `feedback-clear-jest-cache-in-shared-worktrees.md` | `no-recall-rule` | **Formatting debt only.** The content already contains a trigger and "How to apply"; only the literal `## Recall Rule` heading is absent. No factual claim at risk. | Add the heading during the next routine housekeeping pass. |
| `project-dynamics-explorer-socal-campaign.md` | `weak-basis`, `oversize-routed` (6,899 B) | **Metadata gap + acceptable size for an active campaign hub.** Body evidence is fresh and probe-dated ([VERIFIED 2026-08-20/21] tags); the flag fires because frontmatter has `modified:` but no `last_verified:` key. Not semantically stale. | Add a `last_verified` frontmatter key; compress the Phase A/B production narrative into the campaign plan when the observation windows close. |
| `project-prompt-governance.md` | `oversize-routed` (5,214 B) | **Marginal (94 B over threshold), fresh (2026-08-18), routed and load-bearing.** | Accept; compress opportunistically at next touch. |

None of the three is a factual defect. This validates the advisory's design
intent (worklist, not verdict) — and illustrates why a runbook must require
classification rather than mechanical silencing.

## 6. Comparison with current best practices

Three source classes, kept distinct per the work order. All web sources
retrieved 2026-08-21.

### 6.1 Product-specific documented behavior (Anthropic)

From the current official memory documentation
(https://code.claude.com/docs/en/memory, no visible dated stamp, retrieved
2026-08-21):

- **The auto-memory load truncation is currently documented**: "The first 200
  lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at
  the start of every conversation." Topic files "are read on demand." This
  confirms the figure the 2026-06-04 reorganization plan relied on — it is
  current product behavior, not just a historical assertion. The repo's
  150-line/12 KiB caps sit inside it with ~25/50% headroom. The June 4 peak of
  26,173 B was **above** the documented truncation point — the original incident
  was real tail-loss, not just bloat.
- CLAUDE.md loads in full up to 4 MiB; the "under 200 lines" figure for
  CLAUDE.md is a recommendation, distinct from the MEMORY.md load limit.
- The harness itself nudges memory hygiene: near-limit writes trigger a
  "one line per entry, move detail into topic files, merge or drop stale
  entries" reminder; over-limit writes succeed but return an error. Newer
  builds stamp a `modified` ISO timestamp on memory writes — an official
  staleness affordance this repo can exploit (the SoCal campaign leaf already
  carries one).
- Memory files are "context, not enforced configuration"; deterministic
  enforcement belongs in PreToolUse hooks
  (https://code.claude.com/docs/en/hooks-guide) — precisely this repo's
  guard-plus-gate division.
- Official conciseness guidance
  (https://code.claude.com/docs/en/best-practices): "For each line, ask:
  'Would removing this cause Claude to make mistakes?' If not, cut it. Bloated
  CLAUDE.md files cause Claude to ignore your actual instructions" — the same
  rationale as the router-prose cap.

**Codex comparison** (official pages retrieved 2026-08-21 via
developers.openai.com redirects): AGENTS.md merges root-down with a default 32
KiB cap; official best practice is "a short, accurate AGENTS.md is more useful
than a long file full of vague rules… keep the main file concise and reference
task-specific markdown files"; the newer Codex memories feature is explicitly
positioned as "a helpful recall layer, not… the only source for rules that must
always apply." Cross-agent conclusion: both vendors converge on
small-always-loaded-index + referenced detail, which this repo already
implements (and must keep working for both agents, since `AGENTS.md` symlinks
to `CLAUDE.md`).

### 6.2 General memory-system and retrieval findings

- **Thin preloaded identifiers + just-in-time retrieval** is the recommended
  hybrid (Anthropic, "Effective context engineering for AI agents",
  2025-09-29). The router is exactly this pattern.
- **Irrelevant preloaded content actively harms recall**, not merely wastes
  tokens: the "Context Rot" study (Chroma Research, 2025-07-14) measured
  non-uniform degradation with input length, worsened by distractors. Every
  byte of stale or status-narrative router content is therefore a small
  accuracy tax on every session that auto-loads it — the quantitative argument
  for the diet cadence.
- **Temporal validity is the known hard problem**: plain retrieval serves
  superseded values 15–40% of the time absent an explicit supersession
  mechanism (arXiv:2606.26511, 2026); agents are measurably poor at noticing
  implicit invalidation (STALE benchmark, arXiv:2605.06527). The repo's
  explicit `status:` vocabulary, `stale-routed` signal, supersession pointers,
  and live-source-wins rule are the correct mitigations; the literature
  supports **marking superseded rather than deleting** (audit trail retained) —
  which is the repo's existing practice.
- **Consolidation at write time beats read-time cleanup** (LangMem docs/blog,
  Feb 2025; practitioner consolidation literature): everything admitted to the
  index must be re-judged forever. The write-time guard and the
  prefer-update-over-new-file rule implement this; the observed sawtooth shows
  write-time discipline alone does not stop slow accretion.
- **Memory evaluation exists as benchmarks (LoCoMo, arXiv:2402.17753;
  LongMemEval, arXiv:2410.10813)** measuring exactly the failure classes this
  repo's audits chase: temporal reasoning, knowledge updates, abstention.
  Team-level analogues (inference, labeled as such): preloaded-router
  footprint, routed-file usefulness, staleness rate at audit, supersession
  latency. §11 adopts these as trend metrics.

### 6.3 Inference for this repository

The architecture already matches the strongest documented patterns. The deltas
best practice suggests are operational, not architectural: (1) a scheduled
diet/audit trigger below the enforcement band; (2) codified audit method with
falsification discipline (the repo invented a strong one in S154-V2 — it was
simply never promoted from an audit artifact to a procedure); (3) trend metrics
kept across audits instead of per-audit snapshots.

## 7. Strengths (retain)

1. **Single git-tracked store with per-machine symlinks** — durable,
   cross-machine, worktree-aware; verified live in this worktree.
2. **Router-as-index with enforced budget**, single-sourced thresholds, CI +
   write-time + session-start layering, and a monotonic guard that can never
   wedge a cleanup. This is a better-engineered version of what both vendors
   recommend.
3. **Explicit status vocabulary + `stale-routed` detection** — currently 0
   retired-but-routed leaves; the store retains history without routing to it.
4. **The advisory/blocking split is principled.** Structural proofs block;
   semantic heuristics advise. The 07-27 sweep explicitly refused to let a
   zeroed checker stand in for semantic closure.
5. **A real falsification method exists in-repo** (S154-V2's five disciplines:
   every identifier checked; negative claims grepped for the negated thing;
   memory date as upper bound; Atlas cross-read; re-justified CLEANs). V2
   measurably outperformed V1 with the same evidence available — the method,
   not the model, was the variable.
6. **The wiki pressure valve works**: growth there is free, router growth costs
   every session; the 07-29 diet demonstrated large reductions with no content
   loss (leaves untouched, routing redirected through hubs).
7. **Complementary lifecycle gates** (`check:doc-symbol-refs` +
   `check:build-claim-freshness`) close both directions of the
   path-reference lifecycle in CI — a genuinely semantic (if narrow) staleness
   control most memory systems lack.

## 8. Gaps and failure modes

Ordered by severity × likelihood.

1. **No trigger between "healthy" and "nearly at cap" (the sawtooth gap).**
   All signals sleep below 11 KiB; regrowth is ~166–500 B/day; the 8 KiB
   comfort line was crossed silently on 2026-08-13. Failure mode: each cycle
   ends in a reactive, larger, riskier diet near the cap — or in the write-time
   guard blocking a legitimate edit mid-task. (Addressed procedurally by the
   runbook's routine-audit trigger; optionally by a lower warn band, §10 Q4.)
2. **Router lines re-accrete status narrative.** Current router text includes
   "Phase -1 done, findings accepted", "RESOLVED S396", "implementation and
   production smoke are complete", "org-open reviewer/document access accepted
   by-design 2026-08-15" — release-log claims duplicating SESSION_PROMPT / the
   queue / plans, which will go stale in place. The 07-29 audit removed exactly
   this class; it is back within four weeks. Failure mode: the auto-loaded
   surface asserts stale status to every future session.
3. **Semantic staleness has no recurring owner.** The deep audits that catch
   it were each self-initiated with bespoke methods. Failure mode: the S154
   class of dangerous negative claims ("not built", "do not drop", "still
   load-bearing") reappears and sits unchallenged between ad-hoc audits.
   (The runbook's cadence + falsification section is the fix.)
4. **`status: active` remains near-unfalsifiable at write time.** 221/247
   (89%) of leaves are active; demotion happens almost exclusively inside big
   audits. Mitigated by the 70 `feedback-*` behavioral leaves that are
   legitimately evergreen, but "active" still under-discriminates. Failure
   mode: retrieval cost and false authority accumulate in the long tail.
5. **Advisory checks are invisible outside `/start`.** `check:memory-health`
   and `check:memory-drift:no-write` are not in CI and produce no trend; a
   regression between sessions surfaces only if the next session starts with
   the full battery and someone reads the advisory block. Failure mode:
   findings accumulate silently; the drift report quietly exceeds its 24-hour
   contract for days (observed: 4 days).
6. **Write-time guard blind spots are real but bounded**: fail-open error
   path, harness/auto-memory writes, and non-Claude writers all bypass it. CI
   catches the result at the next push (verified: the gate is in
   `test.yml`), so the exposure is bounded to cap breaches landing red in CI
   rather than being blocked locally — acceptable, but worth stating in the
   runbook rather than relying on the hook's reputation.
7. **Health heuristics have known measurement artifacts.** `weak-basis` keys
   on a `last_verified` frontmatter key; a leaf carrying only the
   harness-stamped `modified` timestamp plus in-body `[VERIFIED date]` tags
   still flags (observed on the SoCal leaf). Failure mode: alarm fatigue and
   mechanical-silencing pressure — the exact behavior the 07-27 sweep
   invariants forbid.
8. **Drift registry narrowness can be over-read.** "Memory drift clean" means
   the narrow registered claims pass against a possibly-stale committed
   report; it is not a memory-wide freshness statement. The 07-02 audit said
   this; the runbook must keep saying it.

## 9. Disconfirming evidence and falsification attempts

- **"The router keeps regrowing" — could the growth be legitimate?** Checked:
  the 07-29→08-21 delta includes genuinely new routing (SoCal campaign,
  stabilization directive, new guardrail lines) *and* status narrative (§8.2).
  Partially legitimate growth is the honest reading — which is why the
  recommendation is a scheduled review, not a freeze.
- **"All controls green" — tried to break them:** ran the full 57-gate battery
  sequentially (all green); re-ran the three memory checks individually and
  reproduced every number; read both hooks' failure paths in source rather
  than trusting their descriptions (confirmed fail-open in
  `memory-router-guard.js` catch block; confirmed the Stop-hook's advisory
  default via `CLAUDE_STOP_GATE_MODE`).
- **"The 25 KB harness limit is historical" — falsified:** the limit is present
  in the current official memory documentation (retrieved 2026-08-21), so
  carrying it forward is legitimate; conversely, the reorganization plan's
  "24,314 bytes as of 2026-06-04" understates the true same-day peak (26,173 B
  at `91f75975`, before the first trim commit) — a minor precision correction
  to the plan's narrative.
- **"Three advisory findings are defects" — falsified:** all three classified
  as formatting/metadata/threshold debt after whole-file reads (§5); none is a
  stale factual claim.
- **"The 07-27 zero meant the store was semantically clean" — not supported and
  not claimed by that audit itself**; its own text bounds the zero to
  structural signals. Findings recurred by 08-15 and today, confirming the
  steady-inflow model over the clearable-backlog model.
- **"Guard prevents bloat" — falsified as stated:** the router grew 3,816 B in
  23 days *through* the guard era, entirely legally (below-cap growth passes by
  design). The guard prevents cap breaches, not accretion — the distinction the
  runbook encodes.
- **Checked for a newer audit superseding the 08-15 housekeeping** (per the
  brief's "search for newer evidence than each historical audit"): git log over
  `docs/audits/` and `.claude-memory/` shows none newer than 2026-08-15 before
  this review; the 08-21 router-trim commit `053bd9f9` is routing-only.

## 10. Answers to the evaluation questions

**Q1 — coherent architecture or accumulated controls?** Coherent (§3, §6): a
designed five-layer model with controls attached to each layer. What was
missing is an operating procedure over the controls — now
`docs/MEMORY_HYGIENE_RUNBOOK.md`.

**Q2 — clear, non-overlapping responsibilities?** Largely yes and documented
(reorg plan Layers 1–5; wiki operating contract; Atlas claim rules). The one
recurring boundary violation is status/release narrative entering the router
(§8.2) and occasionally leaves duplicating Atlas structure (the `shadow-atlas`
signal exists for this; currently 0).

**Q3 — router: retrieval guidance or status catalogue?** Predominantly a real
router (terse trigger → hub/leaf lines), with measurable status-catalogue
creep quoted in §8.2. The creep class, not the routing class, drives sawtooth
regrowth.

**Q4 — are the limits right; evaluate the 8 KiB comfort threshold.** The hard
caps (12 KiB/150 lines vs the documented 25 KB/200-line load truncation) are
appropriate backstops with sensible headroom — retain. The 200-char prose cap
demonstrably pushes detail to the wiki — retain. The warn band at 11 KiB is
too late to change behavior (~1–2 weeks of margin at observed growth). The
**8 KiB comfort threshold is directionally right but inert as a number alone**:
it was already stated twice (07-02 acceptance criterion, 07-29 result) and
still crossed silently, because nothing fires at 8 KiB. Adopt it as the
**routine-audit diet trigger** (procedural, runbook-owned, no code change), and
*optionally* also lower the warn threshold to ~9 KiB — 9,216 B. Caveat found in
adversarial review: the SessionStart pressure note does NOT import
`WARN_BYTES` — it hardcodes its own 11 KiB/12 KiB constants at
`.claude/hooks/session-lifecycle.js:286-287`; only the write-time guard
imports the checker's exports. A warn-band change must therefore touch both
`scripts/check-memory-router.js` (+ self-test) and `session-lifecycle.js` (or,
better, make the session hook import the constant) to deliver the earlier
signal (proposed change, owner decision; cost: occasional earlier warnings +
two files touched; benefit: signal precedes the runbook trigger; failure mode
addressed: silent crossing).

**Q5 — should leaf-reference count / leaf-to-hub ratio become a metric?** Yes,
as an advisory trend metric, not a gate. Measured today: 113 total `.md` refs
(103 unique) = 62 unique leaf refs + 41 unique hub/doc refs; the 07-29 diet
landed at 41 unique leaf refs. Unique-leaf-refs is cheap to compute, tracks
exactly the growth class that regrows (§8.2 lines carry leaf lists), and gives
the diet a measurable target (return toward ~45). Adding it to the router
gate's OK line is a proposed low-cost checker change (owner decision); until
then the runbook computes it with a one-liner.

**Q6 — do health checks detect semantic staleness?** No — structural smells
only, by documented design; the narrow exceptions are `check:doc-symbol-refs` /
`check:build-claim-freshness` (path-existence lifecycle, in CI) and the drift
registry (registered scalars). Semantic staleness detection is and will remain
an audit activity; the runbook's deep audit codifies it.

**Q7 — are write-time hooks sufficient given fail-open and bypasses?** For
their actual job (stopping cap breaches at the cheapest moment) — yes, with CI
as the verified backstop. They are not, and should not be advertised as,
semantic or shape controls. No change recommended beyond honest documentation;
re-evaluate only if a cap breach ever lands red in CI (that would evidence the
bypass path mattering in practice).

**Q8 — are recall rules specific and discriminative?** The standard shape
(trigger / do / do-not / ground truth) is good and matches
progressive-disclosure practice (§6.2); sampled leaves show genuinely
discriminative triggers. But only heading *presence* is checked, so quality is
unaudited; the sampled miss (`feedback-clear-jest-cache…`) had substance
without the heading — the inverse (heading without substance) would also pass.
The runbook adds recall-rule quality criteria to the audit sampling step.

**Q9 — are status classifications reliable?** The vocabulary is enforced and
`stale-routed` is clean; distribution today: 221 active / 19 closed / 4
superseded / 3 stale. Demotions overwhelmingly happen in bulk audits, so
"active" over-claims between audits (§8.4). Reliable enough to trust
negatively (stale/superseded are real), weaker positively (active ≠ verified).
The runbook's classification decision rules and per-audit demotion quota
address this without a mass re-labeling.

**Q10 — do audits falsify negative claims?** The best ones do — S154-V2's
discipline list exists precisely because V1 missed the dangerous negative
claims ("researchers endpoint still load-bearing" nearly blocked legitimate
cleanup; "accept/decline not built" was false). Later audits inherited the
practice unevenly. The runbook promotes the five disciplines from audit
artifact to mandatory procedure.

**Q11 — how should facts be promoted out of memory?** Along the existing
authority gradient: structural live-state → Atlas (with probe label); domain
mechanism/hazard detail → wiki topic; enforceable rules → CLAUDE.md /
`.claude/rules/` / hooks / gates; derivable scalars → the canonical-facts
registry; the leaf then keeps intent/lesson plus a pointer. Codified with
decision rules in the runbook (§ promotion/demotion).

**Q12 — cadence and triggers?** Evidence-based: routine audit every ~2 weeks
*or* on triggers (router ≥8 KiB; health flagged-files ≥5; drift report older
than its contract at a session start that relies on it; ≥25 new leaves since
last audit — roughly the observed monthly inflow); deep audit quarterly *or* on
events (schema/migration wave touching remembered facts, incident traced to a
stale memory, model/harness change altering memory behavior, or before relying
on memory for destructive work). Rationale: routine cadence at half the
observed diet period keeps the router permanently below the warn band; deep
audits at the historical ad-hoc frequency (~6–8 weeks) formalized to quarterly
plus triggers.

**Q13 — recording findings, unknowns, exceptions, ownership?** Continue the
existing convention — dated report under `docs/audits/` with a point-in-time
banner, evidence matrix, explicit `UNKNOWN`s naming their probe, owner-decision
sections — now standardized by the runbook's template, plus a cumulative trend
table so metrics stop living only in per-audit snapshots.

**Q14 — retain / tighten / replace / remove?** Retain everything (§7); nothing
merits removal — each control catches a distinct, evidenced failure class.
Tighten (all owner-decision proposals, none implemented here): (a) `WARN_BYTES`
→ 9,216 B; (b) advisory unique-leaf-ref count in the router gate output; (c) a
`weak-basis` refinement accepting a harness `modified:` stamp plus in-body
dated `[VERIFIED]` tags as a non-weak basis (kills the §8.7 artifact); (d)
consider a CI advisory step printing health counts so trends are visible
between sessions. Replace/remove: none.

## 11. Metrics and trend table (baseline for future audits)

| Metric | 06-04 | 07-02 | 07-08 | 07-29 | 08-15 | **08-21** | Direction |
|---|---:|---:|---:|---:|---:|---:|---|
| Router bytes | 26,173→7,331 | 11,255→5,941 | 8,149 | 11,298→5,175 | 8,517 | **8,991** | sawtooth, ~166–500 B/day regrowth |
| Router lines (`wc -l`; 07-02 as reported by its audit) | 154→69 | 100→57 | — | 84→55 | 64 | **65** (checker prints 66 by newline-split) | stable-ish |
| Unique leaf refs in router | — | — | — | 41 (post-diet) | — | **62** | +21 since diet |
| Leaf files | 118 | 191 | 211 | 226 | 243 | **247** | +~1.3/day, decelerating |
| Active share | — | 179/191 | — | — | — | **221/247** | ~90–94% |
| Health files flagged | — | (pre-tool) | 129→124 | 3→0 | 8→0 | **3** | resets don't persist |
| Drift blocking findings | — | — | — | — | — | **0** (report 4 d old) | green, stale report |

## 12. Recommendations (priority × effort; all changes to controls are proposals)

| # | Recommendation | Priority | Effort | Cost | Benefit / failure mode addressed |
|---|---|---|---|---|---|
| R1 | Adopt `docs/MEMORY_HYGIENE_RUNBOOK.md`: routine audit (~2-weekly or triggered at router ≥8 KiB / ≥5 flagged files / ≥25 new leaves) + quarterly-or-event deep audit with the S154-V2 falsification disciplines | P0 | done (this branch) | ~30–60 min per routine run; hours per deep audit | closes §8.1–8.4; converts ad-hoc audits into a procedure with completion criteria |
| R2 | Router-diet procedure: strip status/release narrative to SESSION_PROMPT/queue/plans; target ≤ ~6 KiB and ~≤45 unique leaf refs after each diet (matching runbook §10 — landing at 8 KiB would immediately re-fire the audit trigger) | P0 | procedural | one focused commit per cycle | §8.1–8.2; keeps the auto-loaded surface below the silent zone permanently |
| R3 | Owner decision: lower the warn threshold to 9,216 B in `scripts/check-memory-router.js` (+ self-test) AND in the SessionStart pressure note, which hardcodes its own copy at `.claude/hooks/session-lifecycle.js:286-287` (preferably by importing the checker constant there) | P1 | ~30 min | earlier, occasionally noisier warnings; two files | signal precedes the 8 KiB procedural trigger instead of trailing it (§8.1); removes a threshold duplication found in adversarial review |
| R4 | Owner decision: emit advisory unique-leaf-ref count from the router gate | P2 | ~30 min | none material | makes the Q5 metric self-updating |
| R5 | Owner decision: refine `weak-basis` to accept harness `modified:` + in-body dated `[VERIFIED]` as basis | P2 | ~30 min + care | small recall loss for genuinely weak leaves | kills the observed false-positive class (§8.7); reduces silencing pressure |
| R6 | Fix the three current advisory findings per §5 dispositions at next housekeeping (out of scope for this branch) | P2 | ~15 min | trivial | clears the worklist honestly, not mechanically |
| R7 | Keep drift regeneration owner-run only; routine audits stay `--no-write`; record report age whenever citing "drift clean" | P1 | procedural | none | prevents over-reading a stale committed report (§8.8) and accidental live probes |
| R8 | Do not add new blocking memory gates now | — | — | — | every candidate (health, drift) has documented false-positive classes; blocking would invite mechanical silencing, the failure mode the 07-27 invariants exist to prevent |

## 13. Open questions and explicit unknowns

- **UNKNOWN — routed-file usefulness.** No data exists on whether routed
  leaves are actually read/useful in sessions (the "hit rate" analogue from
  §6.2). Measuring it needs harness-side instrumentation that does not exist;
  the runbook leaves it as an explicit non-metric rather than a proxy.
- **UNKNOWN — live drift beyond the registry.** "Drift clean" covers the
  narrow registry against a 4-day-old report; a fresh regeneration requires
  owner-run live probes (standing rule) and was deliberately not performed.
- **Owner decisions pending:** R3–R5 threshold/checker changes; whether the
  routine audit lands as a skill (`/memory-audit`) or stays a runbook
  procedure; whether to schedule the first deep audit under the new runbook or
  fold it into the next natural trigger.
- **ASSUMED (labeled):** the ~166–200 B/day regrowth rate persists; it is
  derived from two inter-diet windows and one partial window and may change
  with project phase. The trigger design (size-based, not calendar-only)
  tolerates rate error in either direction.

## 13a. Adversarial review record

Both deliverables received a fresh-context adversarial review (read-only, at
commit `312224ee`) instructed to refute rather than confirm. Verdict: **SOUND
WITH FIXES** — no architecture, control-behavior, CI, or classification claim
failed; both embedded runbook procedures executed as written. Six findings (one
MAJOR: the original R3 scoped the warn-band change to the checker only, while
the SessionStart note hardcodes its own thresholds; plus five precision issues:
the 8 KiB crossing date was 2026-08-13 not -15; R2's diet target contradicted
runbook §10; the drift-entry description omitted the second entity; two
line-count cells mixed commits/conventions; one leaf-count cell was imprecise
across intra-day commits). All six were independently re-verified and are
corrected in this version.

## 14. Proposed adoption plan

1. This branch: land this review + `docs/MEMORY_HYGIENE_RUNBOOK.md` +
   regenerated docs catalog (done here); owner merges when satisfied.
2. Next session in the main checkout: run the runbook's **routine audit** once
   end-to-end (it will fire on the ≥8 KiB trigger immediately) — this both
   validates the procedure and performs the overdue router diet (R2), including
   the §5 dispositions (R6).
3. Owner decides R3–R5; implement approved checker changes with self-tests in
   a separate commit per the gate-modification contract in
   `docs/CI_GATES_REFERENCE.md`.
4. First deep audit: at the next trigger event or 2026-Q4 start, whichever
   comes first; append its row to §11's trend table and the runbook's metrics
   log.
