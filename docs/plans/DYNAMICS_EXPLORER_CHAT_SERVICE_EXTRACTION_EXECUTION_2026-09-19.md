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

## S5, Read tools — ACCEPTED

- Commits: `9d23dc2d` composite, `916a24b0` describe-table (multi-span),
  `cc313861` get-entity, `45e87335` tool-errors (multi-span), `21a45727`
  get-related; root header-citation fix below. Route 2,426 → 1,288 lines.
- Opus reconstruction: all five modules identical to baseline regions
  (2728–2866; 920–925 + 1047–1157; 1159–1362; 777–794 + 951–1045;
  1364–1920). The get-entity escape line is byte-identical and the file path
  matches the odata-escape exemption exactly; the gate is green over 1,053
  files with no directory exemption. Import graph is a DAG with exactly the
  two declared edges; no name declared twice; nineteen moved names absent
  from the route; route adds only import lines; tests byte-unchanged.
- Verification: 14 suites 186 tests, 1 snapshot; lint 0 errors; types clean;
  13 gate pairs and docs-catalog green sequentially.
- Corrections: two module headers were off by one code line (fixed by root);
  plan §3.2/§6 `tool-errors` range now 777–794.
- Next permitted stage: S6.

## S6 and S7, Document tools, batch processing, export — ACCEPTED

- Commits: `88f81f9a` documents, `b304507a` batch-processing (with the
  `dynamics-explorer-export` registry `callSiteFiles` repoint in the same
  commit), `fae523b3` export, `ed1747a2` fix-up (Opus round 1: dead
  `callClaudeBatch` route import; three header citations in the wrong line
  frame). Route 1,288 → 503 lines. Accepted at `ed1747a2` (Opus round 2).
- Opus reconstruction: all three modules identical to baseline regions
  (1922–2309; 70–73 + 2470–2471 + 2499–2655; 2311–2468 + 2657–2726).
  `documents.js` has no `sendEvent`; the route still emits `document_links`
  and strips `_files` inside `executeTool`. `file_ready` carries exactly
  `base64, filename, recordCount, totalCount, capped, columns`. All four
  export-path A7 sites are in `batch-processing.js`; the chat-surface wrap
  and preamble remain in the route for S8. Route exports are `config` and
  `handler` only; no unused import remains.
- Verification: 14 suites 186 tests, 1 snapshot (`92a7a16f…` unchanged);
  lint 0 errors; types clean; 13 gate pairs and docs-catalog green
  sequentially; prompt-injection gate then self-test green in that order.
- Corrections: plan §3.2 and §6 ranges for the three rows now end at the
  last code line (1922–2309; 2499–2655; 2311–2468, 2657–2726). Plan §1–§10
  hash at acceptance: `b96538d69994c0bd…`.
- Caveat recorded: the prompt-injection gate's pass at S7 is necessary but
  not sufficient, because the route still holds the chat surface's own
  wrap and preamble; enforcement becomes real at S8 when those move.
- Note for S8: no `// ───` markers remain in the route; locate regions by
  symbol name.
- Next permitted stage: S8.

## S8, Tool executor and chat session — ACCEPTED

- Commits: `da1c47a7` tool-executor, `422043e9` chat-session with the three
  gate-script edits (prompt-injection `dynamics-explorer-chat` callSiteFiles
  → chat-session.js; dynamics-context-boundary header `chat.js:124` →
  `chat.js:150`; access-layer taxonomy comment present tense). Route 503 →
  197 lines, nine import lines, exports `config` and `handler` only.
  Accepted at `422043e9` (Opus round 1, no blocking finding); root header
  nit fix below.
- Opus lifecycle trace: all writes to the six route-side flags map to the
  same positions via `onRoundComplete`/`onStage`/`onTerminal`; both
  terminal paths await `onTerminal` before `response`/`complete`; both
  disconnect polls return without sending and the route finalizes once, so
  the finalize count stays 2; the six finalize call sites are unchanged;
  outer catch and finally byte-identical; no catch-and-wrap in the service.
  `chat-session.js` body verbatim modulo the declared substitutions (170 vs
  170 normalized lines, zero differences); `tool-executor.js` identical to
  baseline 670–775. `withDynamicsContext` propagates the callback's return
  value (`lib/services/dynamics-context.js:45-55`), which the harness mock
  could not have proven. Registry union rule is now genuinely enforced:
  wrap and preamble both live in chat-session.js and the route has none.
- Semantic delta recorded (not a defect): the loop-time disconnect
  finalize now runs just outside the `withDynamicsContext` ALS scope;
  `finalizeRequest` is Postgres-only and reads no Dynamics context.
- Verification: 14 suites 186 tests, snapshot `92a7a16f…` unchanged since
  `a24867e3`; full Jest 973 suites 14,307 tests (builder and Opus
  independently); lint 0 errors; types clean; 13 gate pairs and
  docs-catalog green sequentially; no test file touched. `npm run build`:
  Turbopack refuses this worktree's symlinked `node_modules` ("Symlink
  [project]/node_modules is invalid"); `npx next build --webpack` succeeded
  and compiled the route. The canonical Turbopack build must be evidenced
  on a checkout with a real `node_modules` before merge (owner step).
- Corrections: `tool-executor.js` header and plan §3.2/§6 range now
  670–775 (last code line). Plan §1–§10 hash at acceptance: `5aff8767c2fac9b9…`.
- Next permitted stage: S9.
