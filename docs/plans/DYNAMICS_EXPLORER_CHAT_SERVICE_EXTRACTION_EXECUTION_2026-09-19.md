---
title: Dynamics Explorer Chat Service Extraction Execution Receipt
domain: dataverse
kind: plan
status: active
summary: Stage-by-stage execution receipts for the Explorer chat service extraction on branch claude/explorer-chat-extraction; companion to the plan.
canonical: false
owner: product-engineering
related:
  - docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_PLAN_2026-09-18.md
---

# Execution receipt: Dynamics Explorer chat service extraction

Branch `claude/explorer-chat-extraction`, worktree `../WMKF_Apps-explorer`, based on
`main` at `bdb2bd00`. Plan sections 1 to 10 hash at S0 start:
`a319418dd3e9c1c99ce3efa340f3c8d8c607d0e6c592c6bd7eb1908daa5ea97e`.
Orchestration: Sonnet builds and scouts, Opus reviews read-only (two rounds
maximum per stage), root (Fable) performs the final review and any last edits.

## S0, Characterize and freeze — ACCEPTED

- Commits: `a24867e3` (tests and four `export` keywords), `85e444be`
  (round-1 tightening), `598ee288` (root: re-arm reset mocks in beforeEach).
- Source change: exactly four declarations in
  `pages/api/dynamics-explorer/chat.js` gained `export`
  (`restrictedFieldsForTable`, `redactRestrictedFieldNames`, `checkRestriction`,
  `splitChatExpandSegments`); file stays 2,983 lines, anchors E1 to E21 hold.
- New suites: `tests/unit/dynamics-explorer-restriction-guard.test.js` (17
  tests, plan §4 items 8 to 10) and
  `tests/unit/dynamics-explorer-chat-characterization.test.js` (18 tests, items
  1 to 7, 4b to 4g, 11) with snapshot
  `tests/unit/__snapshots__/dynamics-explorer-chat-characterization.test.js.snap`.
- SSE census snapshot SHA-256 (requestId normalized to `<REQUEST_ID>`):
  `92a7a16f8a7db11699e00fff902a72f065c096a5adafab371f66efa122fba011`.
- Verification at `598ee288`: six Explorer suites 6/6, 112 tests, 1 snapshot;
  `npm run lint` 0 errors (105 pre-existing warnings, none in touched files);
  `npm run check:types` clean. All 67 `check:*` scripts run sequentially at
  `a24867e3`: 65 green; `check:agent-wiki` went green after the per-machine
  `.agents/skills` symlink was added to the worktree; `check:agent-invariants`
  remains red only for the per-machine memory-store symlink of the worktree
  path, which the same gate passes in the main checkout at identical code.
- Review: Opus round 1 NEEDS REWORK (item 11 vacuous negative, 4c to 4g not
  asserting full finalize arrays, item 3 and 6 non-discriminating, mock
  hygiene); round 2 READY at `85e444be` with two live mutation demonstrations
  (4e caught `errorStage` set after the model call; item 11 caught a
  decorative `withDynamicsContext`). Root final review folded the remaining
  restore into `beforeEach`.
- Frozen for later stages: §3.2 module map and §3.3 `runExplorerChat`
  contract as in the plan at the hash above.
- Known limits: the mocked reads do not evaluate `DynamicsService.checkRestriction`
  semantics; the harness proves scope presence and the local guard only.
- Next permitted stage: S1.

## S1, Gate preparation — ACCEPTED

- Commits: `c617b2ac` (access-layer gate: `lib/services/dynamics-explorer/` in
  `EXEMPT_DIRS`, green self-test fixture), `06d0e98f` (odata-escape gate:
  single-file `EXEMPT_FILES` entry for `tools/get-entity.js`, green and red
  fixtures, narrowed self-test assertion), plus root's wording commit below.
- Nothing removed from either gate; `pages/api/dynamics-explorer/` entries
  remain until S9. No runtime file created.
- Verification: both gate pairs green sequentially; `check:harness-framing`,
  `check:doc-symbol-refs`, lint (0 errors), types clean.
- Review: Opus READY at `06d0e98f`, with two temporary reverted mutations
  proving each exemption is load-bearing (deleting the dir entry turns the
  access-layer self-test red; deleting the file entry turns the odata green
  assertion red). One non-blocking wording finding: comments stated the S8
  importer and the S5 move as present fact; root reworded both to "today …
  moves at S8/S5".
- Next permitted stage: S2.

## S2, Leaf helpers — ACCEPTED

- Commits: `d2bc2c3a` failure-copy, `b95f0de1` conversation, `8383431e`
  result-shaping (record-count test repointed), `13e8dd4b` restriction-guard
  (guard test repointed, auth-mock side-effect import dropped), `056d5a00`
  fix-up (unused route import removed, two header line ranges corrected).
- Route 2,983 → 2,527 lines. Opus reconstructed each region from the baseline
  and found zero non-whitespace differences in all four modules; the route
  equals baseline minus the moved regions plus four import lines and one
  blank line. Twenty moved names have no definition left in the route; route
  exports are now `config`, `handler`, `searchDocuments` only.
- Verification: 14 suites (12 Explorer + 2 S0) 186 tests, 1 snapshot; lint 0
  errors; types clean; 13 gate pairs and docs-catalog green sequentially.
- Plan corrections from this stage: `tool-errors` range is 777–795;
  `result-shaping` includes 641–647 and 796–797 by the marker rule. Applied.
- Notes for later stages: the `// ─── Tool execution ───` marker now lives in
  `result-shaping.js`; S8 locates `executeTool` by name. The call-config test
  slice is temporarily wider until S4 repoints it to `model-call.js` with a
  marker after each function.
- Next permitted stage: S3.

## S3 and S4, Postgres helpers and model calls — ACCEPTED

- Commits: `b0f17125` explorer-store (route drops the `sql` import),
  `1db1e2b1` model-call (route drops `LLMClient`; call-config test path
  repointed, one line), `76c9eff0` header text fix-up.
- Route 2,527 → 2,426 lines; route diff is exactly two added import lines.
  Opus reconstruction: explorer-store identical to baseline 2956–2983 including
  the fire-and-forget 42703 chain with no await; model-call identical to
  596–640 and 2472–2498 apart from the two synthetic slicer markers, now
  declared in plan §3.1. Call-config slices are tight again (one function
  each). Helper-extraction audit clean: nothing shared with roles.js,
  restrictions.js, or lib/utils/auth.js; getUserRole fail-soft,
  getActiveRestrictions fail-closed.
- Verification: 14 suites 186 tests, 1 snapshot; lint 0 errors; types clean;
  13 gate pairs and docs-catalog green sequentially; model-override-warming
  green through the transitive rule.
- Deviation ruled correct: the `AI Batch Processing` marker stays in the
  route until S7; plan §3.2 and §6 corrected accordingly.
- Not followed: the plan's red-first step for the call-config repoint (test
  and move landed in one green commit). Recorded, not repeated as a defect.
- Next permitted stage: S5.
