---
title: ROR / Works-first Measurement Runs — Codex Brief (2026-09-14)
domain: reviewer-identity
kind: plan
status: active
summary: "Codex brief: independently check the 2026-08-08 ROR strategic assessment against source, then produce the two owner-authorized read-only measurement runs (frozen 40-case works-first benchmark through both institution arms; frozen institution suite plus the five request-1002903 byline strings through the production ROR resolver) and report gate-by-gate against the assessment's go/no-go criteria. No tuning, no mode change, no LLM spend."
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - outputs/ror-reviewer-finding-strategic-assessment-2026-08-08.md
  - docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md
  - docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
  - scripts/evaluate-reviewer-works-first.js
  - benchmarks/fuzzy-matching-falsification/README.md
  - lib/services/reviewer-works-first.js
  - lib/services/ror-institution-identity-resolver.js
  - docs/agent-wiki/topics/reviewer-identity.md
  - docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md
---

# ROR / Works-first Measurement Runs — Codex Brief (2026-09-14)

## 0. Where you are and how to behave

- You are in the worktree `/Users/gallivan/Code/WMKF_Apps-codex` on branch
  `codex/ror-measurement-runs`, created from `origin/main` on 2026-09-14. Run `/start`.
  **Stay on this branch and in this directory.** Another agent works in the main checkout
  `/Users/gallivan/Code/WMKF_Apps`; do not check out other branches, do not touch that
  directory's working tree, and never push to `main`.
- Commit to this branch with descriptive messages and push the branch itself
  (`git push -u origin codex/ror-measurement-runs`). Pushing a feature branch does not deploy.
- Everything in this brief is **read-only measurement**. If a step seems to need a change to
  production code, an env var, or a frozen artifact, stop and report instead.

## 1. Background (verified 2026-09-14 in the main checkout)

- The ROR institution resolver, the request-scoped ROR→OpenAlex identity bridge, and the
  `legacy` / `shadow` / `combined` resolver modes are **already on main and deployed**
  (`444bd781`, 2026-08-08): `lib/services/ror-institution-*.js`,
  `lib/services/reviewer-identity-runtime.js`. Documented production authority is
  `legacy-default` [VERIFIED via `docs/agent-wiki/topics/reviewer-identity.md` and the assessment].
  `REVIEWER_IDENTITY_RESOLVER_MODE` exists in Vercel Production as a **hidden secret set ~2026-07-19**
  whose value the CLI cannot read [VERIFIED via `vercel env ls production` 2026-09-14]; it is absent
  from Preview. The owner confirms the live value; you never read, set, or change it.
- PR #116 (`codex/ror-api-production-shadow`, tip `a847b730`) was closed 2026-09-14 as
  superseded by `444bd781`. Its paths under `lib/services/institution-resolution/` do **not**
  exist on main. Its only unique remainder is a benchmark dedupe (thin wrappers over the
  production core); that is not in scope here.
- The reset brief `docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md` paused promotion because
  a 15-row PubMed-vs-works-first diagnostic conflated three questions (reviewer relevance,
  person identity, institution normalization).
- The assessment `outputs/ror-reviewer-finding-strategic-assessment-2026-08-08.md` (tracked,
  written by a Claude session) decomposes the work into C1 relevance / C2 person identity /
  C3 institution normalization, defines go/no-go gates for C2 and C3 (§3), and asks the owner
  for four decisions (§5). **The owner authorized §5 decision 2 on 2026-09-14: the two bounded
  measurement runs.** Decisions 1, 3, and 4 (promotion target, recall budget, shadow window)
  remain the owner's and are not yours to make or pre-empt.

Two facts that shape the work, so you do not rediscover them:

1. **The C2 rerun is zero code.** `scripts/evaluate-reviewer-works-first.js` already accepts
   `--institution-resolver incumbent|ror` (`INSTITUTION_RESOLVER_ARMS`, line 28) and wires the
   `ror` arm through the production `createRorInstitutionIdentityResolver`. Its default output
   path is the untracked `outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v1.json`;
   pass `--output` so you never overwrite the historical failed artifact.
2. **The C3 replay is not zero code.** The benchmark comparator adapter
   `benchmarks/fuzzy-matching-falsification/adapters-ror.js` wires the **benchmark v3 copy**
   (`versions/v3/*`), not the production modules. The assessment's C3 run requires a new
   comparator adapter that calls the production `lib/services/ror-institution-*` modules. The
   comparator (`run-comparator.js`) `require`s the adapter by path, calls
   `institutionResolve(input)` (see `run.js` `ADAPTER_BY_KIND` and the existing adapter for the
   `{ outcome, target: { name, ror_id } }` return shape), and writes
   `benchmarks/fuzzy-matching-falsification/baseline/<slug>.results.jsonl`, refusing to
   overwrite an existing slug. `run.js`, `judge()`, and `cases/` are frozen.

## 2. Phase 0 — Independent review of the assessment (no code, hard stop)

Before building anything, read the assessment and check its **claims** against source. Do not
accept its conclusions; verify them. At minimum:

| Claim in the assessment | Where to check |
|---|---|
| 166-case falsification suite; 141 in-scope institution labels; v3 passed with 0 wrong automatic resolutions | `benchmarks/fuzzy-matching-falsification/cases/*.jsonl` counts; `versions/v3/results/2026-08-07-api-decision-benchmark.md` and the `.summary.json` beside it |
| 40 frozen C2 cases, 25 expected binds / 15 abstains, SHA-pinned | `docs/audits/reviewer-holistic-identity-benchmark-v2.json`; the SHA check in `scripts/evaluate-reviewer-works-first.js` |
| The only recorded C2 run failed all 40 on network | `/Users/gallivan/Code/WMKF_Apps/outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v1.json` (read-only; see §5 hazards) |
| C2 gates: `falseBinds = 0`, `providerFailures = 0`, `rightPersonPolicyBinds ≤ spine`, `correctBindGain ≥ 3`, `misses ≤ 8` | `evaluatePromotion` in `lib/services/reviewer-works-first.js` (around line 572) |
| The eval script has a `ror` institution arm wired to the production resolver | `scripts/evaluate-reviewer-works-first.js` lines 16–28 and the arm construction |
| The benchmark comparator adapter uses the v3 copy, not production | `benchmarks/fuzzy-matching-falsification/adapters-ror.js` `require` lines |
| Five real 1002903 decorated bylines with adjudicated outcomes exist | `/Users/gallivan/Code/WMKF_Apps/outputs/s400-institution-checker-probe-findings.md` and `outputs/s400-verdict-trace-capture-2026-08-04.log` (read-only) |
| C3 gates in §3 are the right gates; the C1 "no gate" stance is right | Your judgement, argued from the sources above and `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` |

Write your findings to a **tracked** file on the branch:
`docs/plans/ROR_MEASUREMENT_RUNS_CODEX_PHASE0_REVIEW_2026-09-14.md`, with frontmatter shaped
like this brief. For each assessment section (§1–§5) record **agree / disagree / cannot
verify**, the evidence, and any proposed change to the plan in §3–§4 below. Commit and push.

**Hard stop:** if you disagree materially with the gates, the two runs as specified, or the
"no tuning" rule, stop after Phase 0 and report. The owner reconciles your review with the
Claude session before Phase 1 starts. If you agree (or your disagreements are minor and
noted), say so and proceed.

## 3. Phase 1 — C2: clean rerun of the frozen 40-case works-first benchmark

1. **Prove network reachability first.** The Codex app sandbox may block egress, and the only
   recorded run died exactly this way. Before any full run, confirm `https://api.openalex.org`
   and `https://api.ror.org` are reachable from your process (a single small request each).
   If they are not, stop and report; do not attempt workarounds.
2. Run the existing script twice, once per arm, writing to new output paths under
   `outputs/reviewer-holistic-m1/` (untracked, local):
   ```bash
   node scripts/evaluate-reviewer-works-first.js --institution-resolver incumbent \
     --output outputs/reviewer-holistic-m1/works-first-w2-rerun-2026-09-14-incumbent.json
   node scripts/evaluate-reviewer-works-first.js --institution-resolver ror \
     --output outputs/reviewer-holistic-m1/works-first-w2-rerun-2026-09-14-ror.json
   ```
   The script reads `.env.local` (symlinked into the worktree) for `OPENALEX_API_KEY`; the ROR
   candidate adapter reads the optional `ROR_CLIENT_ID`, which `.env.local` does not currently
   define (the adapter runs unidentified without it). Do not add, change, or print env values.
3. **A run with any provider failure is void.** Do not report partial results as "mostly
   fine"; rerun or report the failure.
4. Read `evaluatePromotion`'s verdict from each artifact and record it.

## 4. Phase 2 — C3: frozen institution suite + 1002903 strings through the production resolver

1. Add one new comparator adapter file, e.g.
   `benchmarks/fuzzy-matching-falsification/adapters-ror-production.js`, that implements
   `institutionResolve(input)` (and `institutionPairConsistent` if the existing adapter's
   contract requires it) by calling the production modules under `lib/services/ror-institution-*`.
   Follow the existing adapter's header conventions: provenance is recorded, never judged. PR #116
   tip `a847b730` shows one wrapper shape as an example only; its module paths are not on main.
2. Run it under a **new slug**:
   ```bash
   cd benchmarks/fuzzy-matching-falsification
   node run-comparator.js ./adapters-ror-production ror-production-2026-09-14
   ```
   Frozen cases, `run.js`, `judge()`, and existing result files stay untouched.
3. Replay the **five 1002903 decorated byline strings** (from the untracked S400 probe findings
   in the main checkout) through the same production adapter. Record outcomes **without** the
   strings or any person names in tracked files; the adjudicated per-string results stay in a
   local file under `outputs/`.
4. Compare against the frozen incumbent baseline
   (`baseline/incumbent-2026-08-06.results.jsonl`) and the v3 result
   (`versions/v3/results/ror-claim-resolver-2026-08-07-v14.results.jsonl`).

## 5. Report

Write `docs/plans/ROR_MEASUREMENT_RUNS_REPORT_2026-09-14.md` (tracked) containing, for C2 and
C3 separately, every §3 gate from the assessment with **pass / fail / not measurable** and the
number behind it, plus provider-failure counts, request counts, and wall time. Keep it
**PII-free**: aggregates only. Anything with row-level names, affiliation strings, or the
1002903 bylines stays in `outputs/` locally and is referenced by path, never quoted.

Make **no recommendation on §5 decisions 1, 3, 4** beyond stating which gates passed. If a gate
fails, name the failing cases by benchmark case id and stop; do not tune, patch, or propose a
patch inline (assessment §4 keeps patches closed until a gate fails and names the failure, and
even then it is an owner call).

## 6. Allowed and forbidden surfaces

**You may create or edit:**
- `docs/plans/ROR_MEASUREMENT_RUNS_CODEX_PHASE0_REVIEW_2026-09-14.md`
- `docs/plans/ROR_MEASUREMENT_RUNS_REPORT_2026-09-14.md`
- `benchmarks/fuzzy-matching-falsification/adapters-ror-production.js` (new)
- `benchmarks/fuzzy-matching-falsification/baseline/ror-production-2026-09-14.results.jsonl`
  (new, produced by the comparator)
- a unit test for the new adapter under `tests/unit/benchmarks/` if you add one
- local, untracked files under `outputs/`

**You may not edit:** anything under `lib/services/` (including every `ror-institution-*.js`,
`reviewer-identity-runtime.js`, `reviewer-works-first.js`, `institution-identity-resolver.js`),
`scripts/evaluate-reviewer-works-first.js`, `benchmarks/fuzzy-matching-falsification/run.js`,
`adapters-ror.js`, `adapters-incumbent.js`, anything under `cases/` or `versions/`, existing
result files, `docs/audits/reviewer-holistic-identity-benchmark-v2.json`, any `.env*` file, any
Vercel configuration, `SESSION_PROMPT.md`, `.claude-memory/`, or the agent wiki. No Dataverse or
Postgres reads or writes of any kind. Never set `REVIEWER_IDENTITY_RESOLVER_MODE` anywhere.

**Spend:** live OpenAlex and ROR API calls only, staying under the burst bound the assessment
cites (about 2,000 requests per 5 minutes per IP for ROR). No LLM calls, no Claude reviewer
search, no paid tools.

## 7. Hazards specific to this setup

- **`outputs/` is gitignored.** The S400 capture, the probe findings, and the failed W2 v1
  artifact exist only in the main checkout's working tree. Read them by absolute path from
  `/Users/gallivan/Code/WMKF_Apps/outputs/` and do not copy them into tracked locations.
- **Do not fabricate identifiers.** Every case count, threshold, SHA, and file path in your
  review and report must come from a source you opened. This repo's gates fail on fabricated
  literals.
- **Gates for what you touch:** before your final commit run `npm run check:types`,
  `npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test`,
  `npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test`,
  `npm run check:secret-scan && npm run check:secret-scan:self-test`, and
  `npx jest tests/unit/benchmarks`. A gate and its self-test run sequentially, never in parallel.
- When done, push the branch and stop. The owner and the Claude session review the branch from
  the main checkout; merging is their call.
