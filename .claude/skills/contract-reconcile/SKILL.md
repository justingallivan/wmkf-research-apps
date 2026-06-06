---
name: contract-reconcile
description: Whole-flow contract verification before declaring a review or an implementation done. Use when reviewing a plan / verifying findings / confirm-or-refute, or when implementing across layers — especially with a new table, migration, or API route; cross-run dedup; partial / batch save; streaming, await, background, or fire-and-forget work; shared-helper extraction; or "durable state" / "docs are drifted". Traces caller→persistence→consumer, runs six audits, and labels every state claim [VERIFIED / PLANNED / ASSUMED / STALE]. Auto-fire on those triggers; also runnable as /contract-reconcile.
allowed-tools: Read, Grep, Glob, Edit, Bash(grep:*, rg:*, git diff:*, git log:*, git status:*, ls:*, npm run check\:*)
---

# /contract-reconcile — Whole-Flow Contract Verification

**Why this exists:** my recurring failures aren't knowledge gaps, they're *verification-shape* gaps — reading a headline/grep-hit/plan-claim as the whole file, fixing the flagged line while leaving the same fact stale elsewhere, taking a plan's intended state as already-built, changing one layer and missing the caller/persistence/response/UI/docs/gate, treating partial success as total, adding awaited/streamed work without a stale-generation guard, and extracting a "shared" helper that quietly collapses exact-vs-fuzzy. Full rationale: `docs/CLAUDE_SKILL_REMEDIATION_PLAN.md`.

**This skill is BLOCKING for the claim it guards.** I do not get to say "ready", "done", "confirmed", or "no issues" until the relevant audits below have run with cited evidence. "I already checked" is the exact failure this interrupts.

Two modes — pick by task:
- **Mode A — Review** (reviewing a plan / verifying findings / confirm-refute).
- **Mode B — Implementation** (building a reviewed plan).

---

## Step 0 — Name the surface (both modes)

Write these before any claim. If I can't fill one, I haven't read enough yet.
- **Change surface:** one sentence.
- **Entry points:** UI component / API route / script / command / doc.
- **Persistence:** Postgres table / Dataverse entity / Blob / localStorage / memory-doc / **none**.
- **Consumers:** downstream UI / route / service / cron / external flow / docs / tests / CI gates.
- **Prior findings being verified:** list them, or "none".

## Step 1 — File-reading rule

- Read the **whole file** for any durable doc, memory, instruction file, or compact source file I cite.
- For large source files, read the **whole logical region plus every caller/consumer region** the claim touches.
- A grep hit must be followed by adjacent context + the parent dir listing before I claim a convention or an absence ("no callers" needs `rg` evidence, not a guess).
- Never infer from a file name.

## Step 2 — Label every state claim

`[VERIFIED via file:line]` · `[VERIFIED via command]` · `[PLANNED]` (in the plan, not yet built) · `[ASSUMED]` (plausible, unproven — never act destructively on it) · `[STALE/CONFLICT]` (contradicted by live code/another source).

## Step 3 — Trace the contract (mark N/A explicitly, never silently skip)

1 user/caller → 2 client state → 3 request payload → 4 route auth/validation/body-parser → 5 service/helper → 6 persistence write/read → 7 response shape → 8 consumer state/render → 9 docs/tests/gates.

## Step 4 — Run the six audits (run the ones in scope; say which are N/A)

1. **Whole-flow** — every hop in Step 3 accounted for.
2. **Partial-success** — unit of success? does the response return success/failure *identifiers* or only a count? does the client update state for *only the successful* items? can failed rows stay retryable? can `success:true` happen when every row failed?
3. **Async / stale-state** — for every `await`, stream, retry, background, or load-on-mount: name the stale-generation guard / abort / mounted-flag. Check *every* post-await state write, success AND failure paths. A context change must not write stale data into the new request/proposal/user.
4. **Helper-extraction** — name what the helper may do and what it must NOT collapse. Check call sites for differing semantics. (Exact normalized-name exclusion ≠ fuzzy author matching; UI dedupe ≠ identity resolution; display pruning ≠ persistence sanitization unless the persisted DTO is explicitly defined + gated.)
5. **Durable-surface** — for a new/changed durable surface, confirm each that applies: migration file · migration manifest (`npm run prebuild`) · Atlas page (`docs/atlas/`, `check:atlas`) · API route security matrix (`check:api-routes`) · `CANONICAL_COUNTS` + `check:fact-consistency` (route/endpoint counts shift) · source-header / service-catalog entry · cap/cleanup strategy · tests for the new contract · the gate that would catch the omission.
6. **Doc-reconcile** — for durable docs/memory, **delegate to `/sweep`** (don't re-implement it): read the whole target, grep the repo for the same fact, fix frontmatter + summary + body + tail + linked docs in one pass; never append a correction beside the old contradiction.

## Step 5 — Output contract

**Mode A (Review):**
```md
## Findings
1. VERDICT — title
   Evidence: file:line; file:line.
   Reasoning: 1–3 sentences.
   Residual risk: none / named.
## New Issues
- SEVERITY — title. Evidence: file:line. Required change: specific action.
## Final Verdict
READY TO IMPLEMENT | READY WITH NAMED CHANGES | NEEDS REWORK
Required named changes: ...
```

**Mode B (Implementation):** first write the **invariant table** (a guardrail, not a plan) —

| Invariant | Files likely touched | Verification |
|---|---|---|
| e.g. failed batch rows stay selectable | route + client | route returns `savedNames`; client marks only those |

then: re-read the accepted findings → convert each to an invariant → edit the smallest file set → self-review against the invariants → run scoped tests/gates (gate + its `:self-test` **sequentially**) → report:
```md
Changed: file — concise behavior change.
Verified: command / manual check.
Residual risk: none / named.
```

## Step 6 — Stop if evidence is missing

If a claim has no `file:line` / command behind it, label it `[ASSUMED]` and either go get the evidence or hedge — do not assert. For a substantial review or a multi-layer build, an adversarial second pass via `codex:rescue` is the norm, not a luxury.

## Anti-patterns this skill blocks (say the evidence, not the phrase)

"This should be fine" (no file evidence) · "The plan says…" as implementation evidence · "No callers" (no `rg`) · "Only docs" (no whole-file reconcile) · "Shared helper" (no preserved-difference list) · "Saved successfully" (response returns only a count) · any post-await state write with no stale-context check in streamed/request-scoped UI.
