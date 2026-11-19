# Codex review brief: J27 discovery build (step F), branch `claude/j27-read-model`

Read-only review. Do not edit, commit, or run writes. Worktree `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, commits `f75704137` and `62855a91b` on top of the step C/D work (base `97f696faf`). Plan: `docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` §3 (F1–F3) and §7 (build record with four stated deviations and the sandbox probe result). Owner decision D1 is the contract: a J27-or-later Research row is discoverable by `wmkf_readyforreview = true` alone; everything else keeps today's composition byte-for-byte.

## Built
- `shared/config/workbenchVisibility.js`: `DISCOVERY_FIELDS`, `withDiscoverySelect`, `buildDiscoveryFilter`, `assertDiscoveryQuery`, `isReadinessOnlyRow`, `isDiscoverableRequestRow`. Existing two functions untouched.
- `lib/services/workbench/program-scope-service.js`: `readinessOnlyProgramIds`, `resolveDiscoveryScope`, `assignmentQueryOptions`; `resolveWorkbenchProgramScope` returns `discoveryScope`; assignment discovery opted in.
- Opted in: `workbench/dashboard-service.js` (cycle list and proposals), `pre-site-visit/cycle-list-service.js`, `review-panel-rollout.js` + `review-panel-service.js`, `meeting-tracker/program-briefing-service.js` (SE/MR membership kept), `reviewer-finder/my-proposals-service.js` (own predicate).
- Unchanged with a one-line comment: `final-writeup/dashboard-service.js`, `cycle-dossier-rollout.js`, four presentation services, four scripts. Followers (`meeting-tracker/dashboard-service.js`, `discussion-sentiment-candidates.js`) commented.
- `scripts/probe-j27-readiness-visibility.cjs`: sandbox branch, cohorts A/B, superset assertions. Ran green against the sandbox (plan §7).
- Tests: `tests/unit/workbench-discovery-predicate.test.js` (new), fixture and pin updates in the seven caller suites.

## Verify, with the disconfirming case for each
1. **Pre-2027 and non-Research composition is unchanged.** For every opted-in caller, a D26 row or a SoCal row must pass or fail exactly as `isVisibleRequestRow && isRequestReadyForStaff` did. The empty-scope path must equal today's filter apart from the outer parentheses.
2. **Fail-open sweep on `isDiscoverableRequestRow`**: null program, program outside scope, malformed or padded or lowercase cycle code, missing or null expansion, year 2026, readiness null/false/absent, empty scope, non-GUID scope. None may land on the readiness-only branch.
3. **OData superset ⊇ exact** for both views, including a D26 Research ready Set-aside row (admitted by OData, dropped by exact in the default view) and a J27 Research ready Set-aside row (visible in the default view by D1).
4. **Paging**: every opted-in caller still refuses a capped or paged result before filtering (503 or the assignment fallback), never a partial list.
5. **Reviewer Finder**: `actionable` and `all` send the same admission filter; the phase rule is a post-filter; an unready non-Research Phase II Pending row stays hidden; a ready J27 Research intake row shows in both modes; a ready Research row with a post-review disposition is hidden in `actionable` and shown in `all`.
6. **Briefing**: both program fields present; the `_akoya_programid_value` membership filter still gates; discovery adds, never replaces.
7. **Projection**: each opted-in caller's real `select` passes `assertDiscoveryQuery` with its real `expand`. Sparse rows do not throw.
8. **Scope resolution**: two programs named Research → empty scope; catalog read failure in the briefing or Reviewer Finder → error, not silent legacy.

## Known pre-existing
Four unit suites are red on the base commit and untouched: `awardee-tab`, `reviewer-engagement-census`, `reviewer-follow-up`, `workbench-read-coalescing-stage2-characterization`. `package-lock.json` drift is uncommitted.

Output: `/contract-reconcile` Mode A format with a verdict. Print it in full.
