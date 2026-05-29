---
name: project-system-model
description: Canonical conceptual model of the whole system at docs/SYSTEM_MODEL.md — the rote/thinking principle, two orthogonal axes, layers, and what's a capability vs a dependency
metadata:
  type: project
---

The whole-system conceptual model is **`docs/SYSTEM_MODEL.md`** (v2, synthesized S197 2026-05-28 with a Codex outside-review pass). Read it before any cross-capability planning or sequencing. This entry holds the durable principles so they don't re-drift.

**Why:** The session that produced it started from chronic "pilot"/phasing nomenclature drift; the user wanted the major capabilities abstracted correctly *before* dependency/sequencing. The model is the anti-drift anchor — where it conflicts with an older doc, the model wins.

**Durable principles (the load-bearing ones):**

- **Organizing principle (leadership):** *automate what is rote (→ Dataverse); encourage thinking (→ Postgres / local device).* This is the **automation/values axis** — do we automate, where's the human — NOT by itself a storage rule.
- **Two orthogonal axes — do not conflate:** (1) **automation** (rote ↔ thinking); (2) **record-maturity** (scratch → draft/staged → workflow-state → accepted record → audit evidence). Storage follows *maturity*; automate-or-not follows *rote/thinking*. An AI summary is rote output that lands as a provisional draft, then human-edited into an accepted record — it moves along both axes independently.
- **An app = (a prompt in Dataverse) × (a thin adapter).** "17 apps" → N prompts + a few adapter shapes (Workbench tab · PA trigger · ad hoc standalone).
- **Backend automation is NOT a capability** — it has no surface; it *produces* artifacts that surface elsewhere. It's a **PA-built dependency workstream**, mostly off our platform. PA and Vercel are **two independent implementations of the Executor contract** (`docs/EXECUTOR_CONTRACT.md`); **neither calls the other** — both read the prompt from Dataverse and call Claude directly, aligned by a byte-identical conformance test. (Corrects a prior wrong belief that "PA calls a Vercel action.")
- **Prompt migration to Dataverse is demand-driven** (a prompt moves when it becomes *shared*, esp. a PA caller) and **barely started — exactly one live route** (`/api/phase-i-dynamics/summarize-v2`) reads from Dataverse via the Executor today; the rest use bundled in-repo prompts (`shared/config/prompts/`). It's a named workstream, not a background detail. *(Open fork: does staff-editability also force a Dataverse home, or only cross-surface sharing?)* Don't use a round "~19/~24" denominator — those collide (canonical app count=17; A7 injection input-surface registry=24; both differ from the prompt-bearing-route count).
- **Prompt resolution is a TARGET layering**, not current code: the Executor (`execute-prompt.js:215`) throws on a missing Dataverse prompt row (NO bundled fallback); the bundled fallback lives only in legacy `prompt-resolver.js` (gated by `PROMPT_RESOLVER_STRICT`); the Postgres per-user tier is unbuilt.
- **Two interaction modes** (orthogonal to origin/destination): **Mode 1 declarative task** (fixed prompt → defined output; Executor/prompt-store applies) vs **Mode 2 interactive session** (open-ended chat/agent loop; no canonical prompt; ephemeral; governed by context-assembly + ephemerality only). "Consult LLM on a proposal" is the Mode-2 exemplar and a good **de-risking first slice** for the Workbench.
- **Document resolution should be a stateful domain service** (TARGET-STATE — today's code is path-based: `GraphService.downloadFileByPath`, `sharepoint-buckets.js`; the index/tiers below are design, not built). Intended: every resolution carries a **provenance tier** — `corrected` > `authoritative` > `heuristic` > `unresolved` — and the **tier gates use**: Mode-1 automation requires authoritative/corrected; heuristic never silently feeds Mode 1; missing = hard stop, not empty input. Store the stable Graph `driveItem` ID, never a path. The Mode-2 consult surface doubles as the **provenance-correction** workflow (human re-point upgrades the tier; legacy corpus hardens through use).
- **The reviewer state machine is the backbone**, not a sub-feature — its absence is the core gap of the reviewer capability. The grant lifecycle is the **stakeholder narrative**, not the architectural axis (modularity-over-pipeline is deliberate per `STRATEGY.md`).

**Capability mis-anchor corrected:** the appresearcher sidecar collapse ([[project-appresearcher-collapse-post-pilot]]) is substrate *under* the Reviewer capability — its real gate is "the reviewer Workbench has stabilized," NOT the intake pilot.

**Still pending (NOT done — surfaced, not reconciled):**
- The **intake "mid-June 2026 Phase II Research pilot" is DEFUNCT** (Phase II submissions are going away; intake is a **Phase I** build for the *next* cycle). The repo-wide sweep of stale "pilot"/"post-pilot" references is **not yet done** — and is delicate: "mid-June 2026" *also* legitimately names the J26 reviewer peer-review deadline, which is real. Don't blanket-replace.
- The dependency/**sequencing** pass (the original goal) — deferred until after persist + drift reconcile.

Linked: [[project-grant-phasing-evolution]], [[project-reviewer-apps-redesign-direction]], [[project-strategy-direction]], [[project-prompt-storage-strategy]], [[project-backend-automation]], [[project-appresearcher-collapse-post-pilot]], [[project-sharepoint-integration]], [[feedback-apply-reconcile-to-fix-work]].
