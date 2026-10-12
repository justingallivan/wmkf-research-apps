---
title: Largest unplanned refactor — candidate census and staged plan
domain: architecture
kind: plan
status: draft
summary: "Census of the refactors this codebase still needs that no plan covers, with the decision records that already block the obvious ones; the owner picks one candidate, then §2+ become a staged, green-between-stages migration plan a cheaper model can execute."
canonical: false
owner: product-engineering
related:
  - docs/plans/REFACTOR_CANDIDATES_SURVEY_2026-09-30.md
  - docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md
  - docs/plans/WORKBENCH_RESPONSIVENESS_MIGRATION_PLAN_2026-09-18.md
  - docs/plans/USER_PERCEIVED_PERFORMANCE_PLAN_2026-10-02.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/SYSTEM_MODEL.md
---

# Largest unplanned refactor — candidate census and staged plan

Source baseline: `origin/main` at `b3135037c` (2026-10-11, worktree `claude/refactor-scope-plan`).
Every `[VERIFIED]` label below was probed against that revision with the command named; `[ASSUMED]`
items are estimates. Nothing in this document is built state or approved work. §1 is a proposal
for an owner decision; §2 onward is written only after that decision.

## 1. Candidate census and decision

### 1.1 How the census was run

Read-only probes over `origin/main` (no edits, no gates run in the occupied main checkout):
module size and state density (`wc -l`, `grep -c useState`), import-edge counts, the LLM call seams
(`llm-client` vs `execute-prompt` importers under `pages/api`), route guard shapes, the
`APP_LIFECYCLE_REGISTRY`, and — most importantly — the **decision records** already on file:
`docs/plans/REFACTOR_CANDIDATES_SURVEY_2026-09-30.md` (disposition, exclusions, "explicitly not
recommended"), `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md` Stage Log, the Workbench responsiveness
execution receipt, the October 4 performance disposition, and the latency postmortem memory.

The finding that shapes everything else: **most "obvious" large refactors have already been planned
and either executed or declined on evidence.** A candidate only qualifies here if no plan covers it
and no owner decision blocks it.

### 1.2 Already decided — do not re-propose without a new owner decision

| Tempting refactor | Decision record | What it would take to reopen |
|---|---|---|
| Shared API route shell / handler kernel (296 routes; 246 hand-rolled `req.method` checks, 143 identical `ServiceHttpError` catch blocks `[VERIFIED via grep over pages/api]`) | Owner: **NO shared shell helper — divergence is real** (byte-pinned 405 asymmetries, per-verb error mapping ruled not shareable, streaming/binary shells share no boilerplate). `[VERIFIED via docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:638-643]` | A new decision reversing the 2026-07-05 ruling. Not recommended: the five AST gates (`check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:model-override-warming`, `check:api-routes`, `check:route-service-boundary`) match literal in-file guard calls and would all need rework. |
| Workbench per-tab code splitting (`pages/workbench/[requestId].js` statically imports 11 tabs; zero `next/dynamic` in the repo `[VERIFIED via grep]`) | Trial run and **rejected**: 0.7135 % initial gzip reduction against a predeclared 5 % gate; import restored. `[VERIFIED via docs/plans/WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md:37,212]` | A new production bundle measurement showing a different picture. |
| Shared client data cache (TanStack Query) | **Omitted** — S1–S3 removed the observed refresh waterfalls; no justified resource. `[VERIFIED via WORKBENCH_RESPONSIVENESS_EXECUTION_2026-09-18.md:36]`; October 4 disposition: "no new measurement justifies admitting either experiment" `[VERIFIED via USER_PERCEIVED_PERFORMANCE_PLAN_2026-10-02.md:28]` | A measured revisit problem. See also `feedback-latency-plan-scope-accretion-postmortem`. |
| Splitting `StaffDeliberationsTab` (2051 lines, 41 `useState`), `AwardeeTab` (1519, 42), `material-service.js` (2468, was 1,953 when surveyed) for size | Survey (its own label: `[ASSUMED]`): "Do not split the just-released … material service or broadly rewrite StaffDeliberations/Awardee panels solely for size." `[VERIFIED via REFACTOR_CANDIDATES_SURVEY_2026-09-30.md:177]` | A behavioral or UX reason, not size. `RecordingAndTranscriptCard.js` (3748 lines, 86 `useState`) is additionally under active edit by another session today. |
| Pages Router → App Router / prompt, storage-tier or provider-SDK migration as a side effect | Survey (`[ASSUMED]` label): "Do not migrate prompts, storage tiers, the Pages Router, provider SDKs or application architecture as incidental refactoring." `[VERIFIED via :181]` Candidate A below is a *deliberate* prompt migration, which this sentence does not cover but the owner should read it before choosing A. | A separate program decision. |
| TypeScript conversion | Assessment recommends a scoped `checkJs` gate on the selector core via `// @ts-check` pragmas, not file renames `[VERIFIED via docs/TYPESCRIPT_OPTION_ASSESSMENT.md:6,126]`. Current pragma coverage: 18 of ~1,350 `.js` files under `lib/`, `pages/`, `shared/` `[VERIFIED via grep '^// @ts-check']`. | A separate program decision. |
| Factory `run-runner.js` (4261 lines), scheduled-email engine | Survey: blocked by active ownership `[VERIFIED via :164-165]` | Ownership release. |
| Email placeholder dedup (4 copies), request-document claim-reset dedup (3+ domains) | Survey: blocked by decision / active ledger ownership `[VERIFIED via :137-138]` | Ledger work closes. |

### 1.3 Live candidates — nothing plans these today

Ranked by (size of change) × (value) with the owner decisions each one needs. Effort is `[ASSUMED]`.

| # | Candidate | Size (verified) | Streamlines | Performance / UX | Blocks or decisions needed |
|---|---|---|---|---|---|
| **A** | **Converge the standalone AI tool apps onto the Executor and one shared "upload → run → results" page shell.** Eleven handler files under `pages/api` still construct `LLMClient` directly and assemble prompts from bundled modules; only two use `executePrompt` `[VERIFIED via grep -l llm-client / execute-prompt pages/api]`. Exactly one app (peer-review summarizer) was migrated, as a one-off, in S344 `[VERIFIED via .claude-memory/project-peer-review-executor-migration.md]`. | Routes: `evaluate-multi-perspective` 870, `analyze-funding-gap` 497, `process-phase-i` 499, `process` 463, `process-expenses` 432, `analyze-literature` 334, `process-phase-i-writeup` 284, `qa` 283, `expertise-finder/match` 237, `cron/log-analysis` 193, `refine` 114 lines. Prompt modules `shared/config/prompts/*.js` 6,386 lines. Pages: 17 standalone `pages/*.js` tool pages, 11,133 lines in total (of which 10 are LLM upload tools; `dynamics-explorer` and `dataverse-bulk-export` are not), each hand-built on `RequireAppAccess` + `FileUploaderSimple` + `ErrorAlert` `[VERIFIED via wc -l; grep imports]`. Route tests: 3 of 11 routes are imported by any `tests/unit` file (`qa`, `evaluate-multi-perspective`, `cron/log-analysis`); 7 more appear in `tests/integration`; `analyze-literature` and `expertise-finder/match` are imported by no test at all `[VERIFIED via fresh-context grep over tests/, 2026-10-11]`. | Removes bespoke prompt assembly and per-route LLM plumbing; one page shell replaces ~10 near-identical pages. | **Staff UX:** prompts become editable/versioned in `/admin` (`PromptTemplatesSection`, already live for Executor-backed rows) instead of code deploys; every tool inherits the Executor's payload caps (`dataClass`/`maxChars`), A7 assertions, usage logging, model-override warming and provider seam for free. Consistent progress/error UX across tools. | (1) Executor contract excludes streaming `[VERIFIED via docs/EXECUTOR_CONTRACT.md:58,536]`, and **8 of the 11 routes stream** — 3 as SSE (`analyze-funding-gap`, `qa`, `process-expenses`) and 5 as chunked `text/plain` via `res.write` (`evaluate-multi-perspective`:92, `process`:52, `process-phase-i`:53, `process-phase-i-writeup`:54, `analyze-literature`:58) `[VERIFIED via fresh-context grep, 2026-10-11]`. Of the five live apps, four stream; only `expertise-finder/match` returns one JSON body. **However** (second fresh-context pass, 2026-10-11): all of those routes stream *progress frames between* ordinary unary `LLMClient.complete()` calls — none of the five uses `LLMClient.stream()` (`grep '\.stream(' → 0` across them; only the sunset `qa.js` does). Route-owned progress framing is already the contract shape the Route→Service plan accepted (Decision 1a), so the Executor's "does not stream" rule is **not** a blocker. The real contract gaps are (i) three **multimodal** call sites the Executor cannot express — PDF `document` blocks in `evaluate-multi-perspective.js:660-668` and `analyze-literature.js:226-232`, an `image` block in `process-expenses.js:229-245` (`execute-prompt.js:736` sends a string body only) — and (ii) the Executor writes a `wmkf_ai_run` row per call (`execute-prompt.js:300,334`), which for the 6-calls-per-concept evaluator is a volume decision. (2) Executor runs one prompt per call; `evaluate-multi-perspective` is a fan-out/fan-in chain `[VERIFIED via route header :13-14]` — the route stays the orchestrator (contract-conformant) but is the largest single conversion. (3) 4 of the calling pages are `sunset-candidate` since 2026-07-08 (`batch-phase-i-summaries`, `batch-proposal-summaries`, `phase-i-writeup`, `phase-ii-writeup`) `[VERIFIED via shared/config/appRegistry.js:280-321]` — exclude them, or sunset them first. `/api/process`, `/api/qa`, `/api/refine` and `/api/process-phase-i` are called **only** by sunset pages `[VERIFIED via fresh-context grep of pages/*.js, 2026-10-11]`, so excluding the sunset pages also removes those four routes and `process-phase-i-writeup` from scope. (4) SYSTEM_MODEL open fork: staff-editability vs cross-surface sharing as the prompt→Dataverse trigger `[VERIFIED via docs/SYSTEM_MODEL.md:375]`; recorded memory policy is that migration is **demand-driven** (a prompt moves when shared, especially to a PA caller) and that Executor scope follows the automation contract rather than every LLM-calling app `[VERIFIED via .claude-memory/project-system-model.md:37; .claude-memory/feedback-cycle-vs-executor-scope.md]` — so Candidate A proposes a policy change, which is its first owner decision. Survey rule: not as *incidental* refactoring `[:181]` — this would be deliberate. Tier 2 runtime work (branch + promotion). |
| **B** | **Relocate the 176 flat `lib/services/*.js` files into the 34 domain directories.** Route→Service Decision 2 fenced this off ("Existing flat services are NOT moved — out of scope") and its Non-goals repeat it; nothing has planned it since. `[VERIFIED via docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:76-78,113]` | 176 files. Literal path references that must move with them: **1,565 (652 distinct files) test-file references**, **1,609 (795) source/script importer references**, **1,266 (434) docs/memory path references** — ledger sums with distinct files in parentheses — plus 265 flat-to-flat import edges `[VERIFIED via the fresh-context move ledger and its verifier, 2026-10-11]`. Heaviest: `dynamics-service` (207 test files), `dynamics-context` (112), `service-http-error` (75), `graph-service` (62). | The whole point: one layout rule for the service layer; domain ownership visible from the path; the "which file is the live one" question stops recurring. | None for end users. Developer/agent navigation only. | No owner decision blocks it. Cost is mechanical but wide: `jest.mock` string specifiers, `scripts/` importers, the recorded sets in `check:reviewer-engagement-boundary` and `check:script-suggestion-writers` (stale entries fail), exempt-dir lists in `check:route-service-boundary` / `check:dataverse-access-layer`, and `check:doc-symbol-refs` (goes red on every move until docs/memory are reconciled). Tier 0/1: no runtime behavior changes. Concurrency hazard: every other active worktree (there are 21 today) rebases across the moves. |
| **C** | **Finish the admin page decomposition.** `pages/admin.js` is 3,649 lines with 99 `useState`, 18 `useEffect` and 27 top-level components defined inline — 16 `*Section` components, 5 workspace components, 6 helpers — while 14 `*Section.js` components (25 files in all) already live in `shared/components/admin/` `[VERIFIED via grep '^(export )?function [A-Z]'; ls shared/components/admin]`. Half-done migration nobody scheduled. | 3,649 lines → ~22 files following the existing `*Section.js` pattern (existing ones are 100–900 lines). 6 test files import from `pages/admin.js` (they render workspaces and two exported sections directly). | Yes — admin becomes the same shape throughout. | Staff UX: the admin page is one bundle for all six workspaces; per-workspace loading becomes possible *after* a measurement (same 5 % gate the Workbench used). Modest. | No decision blocks it. Tier 0/1. Smaller than A or B. |
| **D** | **Workbench Stage 4 remainder — smaller request context for non-content tabs.** `resolveWorkbenchRequest` still selects `wmkf_ai_summary` and awaits Co-PIs for every resolution `[VERIFIED via lib/services/workbench/resolve-request-service.js:43,83]`; one route caller (`pages/api/workbench/resolve-request.js:49`) and one page consumer (`pages/workbench/[requestId].js`). The October 4 disposition says: "Remaining proposal, not authorized … reassess benefit and consumers before adopting a new plan." `[VERIFIED via USER_PERCEIVED_PERFORMANCE_PLAN_2026-10-02.md:26]` | One service, two callers, the request page. | Little. | Potentially real for the most-used staff page, but **unmeasured** — the baseline audit "does not establish page latency" `[:31]`. | Needs a Stage 0 production measurement before any stage; postmortem memory applies. Small; could ride along with C, not a program on its own. |

### 1.4 Recommendation (proposal, not a decision)

- **If "better yet performance/user experience" governs: Candidate A.** It is the largest body of
  unplanned work with user-visible payoff (staff-editable prompts, consistent tool UX, uniform AI
  safety boundaries), it follows the architecture's own stated target (SYSTEM_MODEL realization 1:
  "N prompts + a few adapter shapes"), and there is a proven in-repo template for one conversion
  (`docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`, S344). **But it proposes a policy change:** recorded
  memory says prompt migration is demand-driven, so Plan A's Stage 0 cannot start until the owner
  adopts staff editability as a sufficient trigger (Plan A decision D7). Its other rulings are the
  multimodal seam (D2), the retry/fallback semantics change (D4), audit-row volume (D3), and where staff
  pick the model (D8) — nine in all, listed in Plan A §2. Scope by default: the 5 live apps
  (`multi-perspective-evaluator`, `literature-analyzer`, `funding-gap-analyzer`, `expense-reporter`,
  `expertise-finder`) plus the shared page shell as a conditional late stage; sunset pages and
  `cron/log-analysis` excluded (D1).
- **If "streamline code" governs and risk appetite is low: Candidate B.** Purely mechanical, no
  runtime behavior change, and exactly the shape of "order of file moves" — but zero end-user
  value and a wide literal-path blast radius across tests, gates, scripts and memory, with a
  rebase cost on every concurrent worktree (22 non-main worktrees on 2026-10-11).
- **Smaller alternative: C (+ D as a measured rider).** Finishes a migration that is visibly
  half-done, low risk, modest payoff.

Owner direction (2026-10-11): write all three. The staged plans are:

- **A** — `docs/plans/AI_TOOL_APPS_EXECUTOR_CONVERGENCE_PLAN_2026-10-11.md`
- **B** — `docs/plans/FLAT_SERVICES_RELOCATION_PLAN_2026-10-11.md` (+ `docs/plans/data/FLAT_SERVICES_MOVE_LEDGER_2026-10-11.tsv`, `…_NOTES_2026-10-11.md`)
- **C** — `docs/plans/ADMIN_PAGE_DECOMPOSITION_PLAN_2026-10-11.md`

Each carries its own owner-decision table, stages with prerequisite tests, green gates, and a
fresh-context self-check log. None is authorized by this document. Candidate D is folded into C as a
measured, optional rider and has no plan of its own.

### 1.5 Self-check applied to this section

- 2026-10-11: fresh-context verifier (Explore agent, no conversation history, read-only at
  `b3135037c`) re-checked every `[VERIFIED]` claim. 6 mismatches, all folded in above: streaming
  count 3→8 of 11; `/api/process` callers are all sunset; route-test count; admin component
  counts; two survey citations that did not support their claims; three off-by-one line numbers.
  Also corrected: the "~1,000 source files" denominator, the "2 callers" wording, and the
  worktree count (point-in-time; now stated as "21 today" in §1.3 B — treat as approximate).
- Known limits of this census: usage per app is not known from source. `api_usage_log.app_name`
  (Postgres) can rank the standalone tools by real use, but reading it is a Production read the
  owner runs, not the agent. Candidate A's scope should be re-cut against that ranking.
