# Codex review brief: J27 step E (page recomputation + minimal strip), branch `claude/j27-read-model`

Read-only review. Do not edit, commit, or run writes. Worktree `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`. Commits: `9469c47b5` (step E) and the following program-gate commit (see `git log -3`). Plan: `docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` §2 C7 (request-page paragraph) and §8 (build record). The strip is owner-approved surface the reviewed plan did not include.

## Built
- `shared/utils/j27PageStage.js`: pure composer from the resolve DTO's `j27.input` plus three already-made reads (Overview reviewer rollup, Overview handoffs incl. meeting-roster, Final Writeup state). No fetch.
- `shared/components/workbench/J27StageStrip.js`: phase, primary task, basis note, blockers that touch a task; `continue-decision-missing` (presentation-only) deliberately hidden until step I.
- Callbacks `onJ27Facts(requestId, patch)` from `OverviewTab`, `J27Overview`, `FinalWriteupTab`; the page (`pages/workbench/[requestId].js`) keeps facts keyed by request id and recomputes with `useMemo`.
- Program gate: `deriveJ27ForRow` requires the F1 readiness-only scope; resolve service reads it once (`resolveDiscoveryScope`), failure → no stage.
- Tests: `tests/unit/j27-page-stage.test.js`, `tests/unit/workbench-request-page-j27-strip.test.js`, callback tests in `workbench-j27-overview.test.js` and `final-writeup-tab.test.js`, gate tests in the resolve, dashboard and inputs suites.

## Verify, with the disconfirming case for each
1. Stale-state: a patch reported for request A after navigation to B never shapes B's strip; facts reset on route change; the `useMemo` keys include the route.
2. Mapping fidelity against the server shapes: `useReviewerProgress` state; `J27Overview` loaded object and the meeting-roster service result (`presentation.id`, `roster`, `stale`); `getFinalWriteupStatus` (`phase`, `sourceArtifactId`, `presentationSchedule`, `startCompatibilityReason`). `not_checked` / `unverified` must never become ended or absent.
3. The tier 1 keys the server already decided (memo presence under production guards) are only overridden by a handoff read that actually returned a value; `undefined` leaves the server key.
4. Program gate complement: J27 SoCal row, null program, empty scope, catalog failure → no `j27` and no strip; a J27 Research row still carries it.
5. The strip renders nothing new that could be mistaken for a control; no gating; labels are plain words with no item codes; `unclassified` renders nothing.
6. No new reads anywhere on the page path.

## Known pre-existing
Four unit suites are red on the base commit and untouched: `awardee-tab`, `reviewer-engagement-census`, `reviewer-follow-up`, `workbench-read-coalescing-stage2-characterization`.

Output: `/contract-reconcile` Mode A format with a verdict. Print it in full.
