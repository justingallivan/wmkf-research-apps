# Session 340 Prompt: Fable orchestration — Closeable-Class Invariant Map, then the execution queue

## Session 339 Summary

Two independent streams landed on `main` this session:

- **Stream A — the *planned* S339 work, executed in a parallel worktree/agent:** DynamicsService
  decomposition **Checkpoint A COMPLETE** (`auth.js`, `restrictions.js`, `annotations.js` extracted
  behavior-freeze; batched Codex review PASSED — `abc77d75`), and the **Q9 prefs/app-access DAL migration
  landed** (PR #49 `c0fea717`, Stages 1/2.5/3). **Checkpoint B (read path) is now unblocked.**
- **Stream B — this session (a detour the owner initiated, then drove to completion):** server-side
  reviewer-finder save-time **institution-COI enforcement**, from the chunk-1 analyze-prompt fix through a
  structural reframe that closes the bypass class *by construction*; merged to `main` and deployed. Plus the
  parked `codex/minor-fixes` branch merged, and a Fable orchestration brief authored.

### What Was Completed (Stream B)

1. **Reviewer-finder save-time institution-COI enforcement — merged `a1d3049f`, deploy READY (prod).**
   Chunk-1 prompt fix (deterministic exclusion block, scientific-only PART 1, applicant institution name
   variants, A7-wrapped decoupled top-up) + F2/F4 server recompute + ~6 adversarial-review hardening cycles +
   a Fable structural **discovery-recorder reframe** (`4070728`) that makes the referenced-identity declaration
   a total function of every adapter row fetched, so no lookup branch can drop a discovery. Closes the "server
   can discover a candidate is at the applicant/PI institution but writes it unscreened" class. PI-resolver
   outage now a retryable 503; request-context errors keep 400/404. Docs: `docs/REVIEWER_FINDER_COI_SAVE_RECOMPUTE_PLAN.md` §§1-20.
2. **`codex/minor-fixes` merged — `61fe97bc`, deploying (prod).** Campaign timeline defaults (+ route/admin UI),
   honorarium require-state for US/CA payment addresses (shared validator; accept UI already collects it), bill
   onboarding-warning email suppression, prefs fixture. Fixed the parked blocker (stale external-review address
   fixtures — added `state`; a fixture fix, not a rule change).
3. **Fable orchestration brief — `683a7ed`.** `docs/INVARIANT_MAP_ORCHESTRATION_BRIEF.md`: the primary next
   objective (below).
4. **Branch cleanup.** Deleted merged local + remote `codex/reviewer-coi-build`, `codex/minor-fixes`, local
   `codex/q9-prefs-appaccess`; parked `~/Code/WMKF_Apps-codex` on `codex/parked` with skeleton intact.

### Commits (Stream B, selected)
- `683a7ed` docs: Fable orchestration brief (invariant map + queue)
- `61fe97bc` Merge codex/minor-fixes
- `a1d3049f` Merge reviewer-finder save-time institution-COI enforcement
- `4070728` refactor(reviewer-finder): discovery-recorder reframe (§19)
- `f324a503` refactor(reviewer-finder): close save-COI class by construction (§15)
- `0630c279` feat(reviewer-finder): F2 server-side institution-COI recompute at save

## Next Items

### Verified Open

1. **PRIMARY — Fable orchestration: the Closeable-Class Invariant Map.**
   Evidence: `docs/INVARIANT_MAP_ORCHESTRATION_BRIEF.md` (`683a7ed`). The owner gives Fable a **charter at
   session start** (charter governs; the brief scopes). Produce the evidence-backed map — every
   security/correctness surface classified on the enforcement ladder (impossible-by-construction > fail-closed
   gate > advisory gate > review), with the smallest structural move that lifts each toward rung 1, ranked by
   blast radius, implementable by a later session. Fable directs; subagents execute. Worked example: the COI
   discovery-recorder story.

2. **Execution queue (after the map; owner priority order — let the map's ranking override):**
   a. **Project-wide prompt-caching audit + standardized remediation.** Evidence:
      `.claude-memory/project-cache-hit-rate-review.md` (Anthropic flagged low cache-hit rate). Holistic, from
      `lib/services/llm-client.js` consumers.
   b. **Holistic prod-safety review of everything that shipped today** — reviewer-finder COI (`a1d3049f`), Q9
      prefs/app-access DAL (PR #49, auth hot path), DynamicsService Checkpoint A. All security/correctness-
      critical, only incremental/diff review so far.
   c. **DynamicsService decomposition Checkpoint B (read path).** Evidence: `abc77d75` ("Checkpoint B
      unblocked"); `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md`. B carries the token/schema cache seam.

### Owner Decision Needed

1. **Fable retirement (last-night access).** Owner is handing Fable the invariant-map brief + a charter this
   session. No decision for the next actor — context only.

### Parked

1. **Spec-audit design-docs recovery** (work computer). Evidence: `project-spec-audit-docs-recovery-parked.md`.
2. **Product/UX owner asks:** review-output formatting (`project-review-output-formatting.md`), campaign-
   settings UX revisit (`project-campaign-settings-ux-revisit.md`). Not orchestrator-shaped.

### Verify Before Acting

1. **`main` moved ~5 commits under this session (Stream A: DAL/dynamics) in parallel.** Any mental model built
   on pre-detour `main` is stale — `/start` (pull) and re-read `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md`
   before touching Checkpoint B.
2. **DAL Stage 9 enforcement status moved.** The Q9 migration (PR #49) touched the prefs/app-access write entry
   points Stage 9 was going to wrap; re-verify what is already `withDalContext`-wrapped before scoping the
   warn→wrap→enforce work. Evidence: `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` Stage 9.
3. **Reviewer-finder COI shipped to prod with heavy-but-incremental review + one structural reframe.** Treat as
   "shipped, pending the whole-system review" (queue item 2b), not as fully independently validated end-to-end.

### Do Not Reopen Without New Decision

1. **Reviewer-finder save-COI enforcement architecture** (discovery-recorder + single save-time choke point +
   input-side invariant test). Evidence: `docs/REVIEWER_FINDER_COI_SAVE_RECOMPUTE_PLAN.md` §§15-20; `f324a503`,
   `4070728`. Closed the bypass class by construction across ~6 review cycles; do not re-litigate the design
   without new evidence — extend it.
2. **Honorarium require-state on external-review accept is intended.** Evidence: `lib/external/required-address.js`
   header (accept guard + honorarium backfill must enforce the SAME completeness); `Stage2aView` collects it;
   `61fe97bc`. The address-fixture updates were stale-fixture fixes, not a behavior change to relitigate.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/INVARIANT_MAP_ORCHESTRATION_BRIEF.md` | **The Fable brief** — primary next objective + execution queue |
| `docs/REVIEWER_FINDER_COI_SAVE_RECOMPUTE_PLAN.md` | Save-time COI plan §§1-20 (F2/F4 → recorder reframe) |
| `lib/services/reviewer-identity-lookup.js` | Producer: discovery recorder + single-exit `referenced*` stamping |
| `lib/services/reviewer-finder/save-candidates-service.js` | The save-time COI choke point (consumer) |
| `lib/external/required-address.js` | Shared address-completeness validator (accept guard + honorarium backfill) |
| `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` | Decomposition plan — Checkpoint A done, B (read path) next |
| `.claude-memory/project-cache-hit-rate-review.md` | Prompt-caching audit context (queue item 2a) |

## Testing

```bash
# Full suite + the gates most relevant to what shipped this session
npm test                                   # baseline (was 5082 green at S339 wind-down)
npm run lint                               # 0 errors expected
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
npm run check:trust-boundary-guid && npm run check:trust-boundary-guid:self-test
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:docs-catalog
```
