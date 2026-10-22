---
name: project-system-model
description: Canonical conceptual model of the whole system at docs/SYSTEM_MODEL.md — the rote/thinking principle, two orthogonal axes, layers, and what's a capability vs a dependency
metadata:
  type: project
  status: active
  scope: strategy
  last_verified: 2026-10-22 against docs/SYSTEM_MODEL.md and the owner intake decision; no live PowerAutomate or intake deployment check
---

## Recall Rule

Read this when: doing any cross-capability planning, sequencing, or resolving "pilot"/phasing nomenclature.

Do:
- Read `docs/SYSTEM_MODEL.md` first; where it conflicts with an older doc, the model wins.
- Keep the two axes separate — storage follows record-maturity; automate-or-not follows rote/thinking.
- Treat the app/prompt/adapter relation as a target design. Current source model: the Vercel Executor is implemented; the PowerAutomate child-flow remains deferred. Do not claim two deployed, byte-identical implementations.

Do not:
- Use a round "~19/~24" prompt denominator, or hardcode an app count here (it drifts). The app-definition count and the A7 input-surface registry both differ from the prompt-bearing-route count — read the live values from `docs/CANONICAL_COUNTS.md` (app-definition-count) and `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md` (A7 registered surfaces), not from this file.
- Treat the three-tier prompt-resolution ordering or the provenance-tier document service as current code — both are TARGET state.
- Treat the old "mid-June 2026 Phase II Research pilot" as live or the custom portal as an active next-cycle build. The owner decision (2026-09-06) parks the custom portal; J27 intake remains on GOApply until further notice. Retain the design for a possible future pilot.

Ground truth: `docs/SYSTEM_MODEL.md` (v2), `docs/EXECUTOR_CONTRACT.md`; `execute-prompt.js:215`.

The whole-system conceptual model is **`docs/SYSTEM_MODEL.md`** (v2, synthesized S197 2026-05-28 with a Codex outside-review pass). Read it before any cross-capability planning or sequencing. This entry holds the durable principles so they don't re-drift.

**Why:** The session that produced it started from chronic "pilot"/phasing nomenclature drift; the user wanted the major capabilities abstracted correctly *before* dependency/sequencing. The model is the anti-drift anchor — where it conflicts with an older doc, the model wins.

**Durable principles (the load-bearing ones):**

- **Organizing principle (leadership):** *automate what is rote (→ Dataverse); encourage thinking (→ Postgres / local device).* This is the **automation/values axis** — do we automate, where's the human — NOT by itself a storage rule.
- **Two orthogonal axes — do not conflate:** (1) **automation** (rote ↔ thinking); (2) **record-maturity** (scratch → draft/staged → workflow-state → accepted record → audit evidence). Storage follows *maturity*; automate-or-not follows *rote/thinking*. An AI summary is rote output that lands as a provisional draft, then human-edited into an accepted record — it moves along both axes independently.
- **Target design:** an app can be modeled as (a prompt in Dataverse) × (a thin adapter), with app surfaces mapping to prompts and adapter shapes (Workbench tab · PA trigger · ad hoc standalone). This is not a claim that each surface or adapter is currently deployed.
- **Backend automation is NOT a capability** — it has no surface; it *produces* artifacts that surface elsewhere. It remains a target dependency workstream, with PowerAutomate intended to handle some triggers. Current model in `docs/SYSTEM_MODEL.md`: the Vercel JavaScript Executor is implemented and the PowerAutomate child-flow remains deferred. Do not claim two deployed, byte-identical Executor implementations or a current conformance test.
- **Prompt migration to Dataverse is demand-driven** (a prompt moves when it becomes *shared*, esp. a PA caller) and **early — a small, growing set of routes** read from Dataverse via the Executor today (e.g. `/api/phase-i-dynamics/summarize-v2`, and `process-peer-reviews.js` since S344 [VERIFIED via pages/api/process-peer-reviews.js:11]); the rest use bundled in-repo prompts living in three places per the A7 surface taxonomy (`shared/config/prompts/`, route-local, service-local). It's a named workstream, not a background detail. Staff editability is also a sufficient trigger (owner, 2026-10-12): a prompt may move so staff can edit it and its model without a redeploy, per-prompt and not as a sweep, and editability alone may use the prompt-resolver seam rather than the Executor (`docs/plans/AI_TOOL_APPS_EXECUTOR_CONVERGENCE_PLAN_2026-10-11.md` §8). Don't hardcode an app or surface count here — the app-definition count and the A7 input-surface registry both differ from the prompt-bearing-route count; read live values from `docs/CANONICAL_COUNTS.md` and `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md`.
- **The three-tier prompt-resolution *ordering* (Postgres override → Dataverse → bundled) is TARGET, not current code.** *Current reality:* the Executor (`execute-prompt.js:215`) throws on a missing Dataverse prompt row (NO bundled fallback); the bundled fallback lives only in legacy `prompt-resolver.js` (gated by `PROMPT_RESOLVER_STRICT`); the Postgres per-user tier is unbuilt.
- **Two interaction modes** (orthogonal to origin/destination): **Mode 1 declarative task** (fixed prompt → defined output; Executor/prompt-store applies) vs **Mode 2 interactive session** (open-ended chat/agent loop; no canonical prompt; ephemeral; governed by context-assembly + ephemerality only). "Consult LLM on a proposal" is the Mode-2 exemplar and a good **de-risking first slice** for the Workbench.
- **Document resolution should be a stateful domain service** (TARGET-STATE — today's code is path-based: `GraphService.downloadFileByPath`, `sharepoint-buckets.js`; the index/tiers below are design, not built). Intended: every resolution carries a **provenance tier** — `corrected` > `authoritative` > `heuristic` > `unresolved` — and the **tier gates use**: Mode-1 automation requires authoritative/corrected; heuristic never silently feeds Mode 1; missing = hard stop, not empty input. Store the stable Graph `driveItem` ID, never a path. The Mode-2 consult surface doubles as the **provenance-correction** workflow (human re-point upgrades the tier; legacy corpus hardens through use).
- **The reviewer state machine is the backbone**, not a sub-feature. The core reviewer lifecycle is implemented in Workbench/external-review flows; automated BILL onboarding remains owner-tabled. Preserve the backbone as an architectural principle without describing the state machine as absent. The grant lifecycle is the **stakeholder narrative**, not the architectural axis (modularity-over-pipeline is deliberate per `STRATEGY.md`).

**Capability mis-anchor corrected:** the appresearcher sidecar collapse ([[project-appresearcher-collapse-post-pilot]]) is substrate *under* the Reviewer capability — its real gate is "the reviewer Workbench has stabilized," NOT the intake pilot.

**Historical record and pending work (the intake item below is owner-resolved):**
- **Historical intake pilot record (S197):** the "mid-June 2026 Phase II Research pilot" was defunct. The subsequent owner decision (2026-09-06) parks the custom portal and keeps J27 intake on GOApply until further notice. `INTAKE_PORTAL_DESIGN.md` remains a superseded design record; no active portal build follows from this history. Preserve the design and the owner’s parked decision.
- The dependency/**sequencing** pass (the original goal) — deferred until after persist + drift reconcile.

Linked: [[project-grant-phasing-evolution]], [[project-reviewer-apps-redesign-direction]], [[project-strategy-direction]], [[project-prompt-storage-strategy]], [[project-backend-automation]], [[project-appresearcher-collapse-post-pilot]], [[project-sharepoint-integration]], [[feedback-apply-reconcile-to-fix-work]].
