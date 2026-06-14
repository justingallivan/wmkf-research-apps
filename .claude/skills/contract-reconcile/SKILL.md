---
name: contract-reconcile
description: Whole-flow contract verification before declaring a review or an implementation done. Use when reviewing a plan / verifying findings / confirm-or-refute, or when implementing across layers — especially with a new table, migration, or API route; cross-run dedup; partial / batch save; streaming, await, background, or fire-and-forget work; shared-helper extraction; or "durable state" / "docs are drifted". Traces caller→persistence→consumer, runs seven audits, and labels every state claim [VERIFIED / PLANNED / ASSUMED / STALE]. Auto-fire on those triggers; also runnable as /contract-reconcile.
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

**Mechanism, not assertion.** "idempotent" / "no-op on repeat" / "only-once" / "no re-stamp" / "dedup" is `[ASSUMED]` until you cite the enforcing guard at `file:line` (early-return before the write, conditional `WHERE … IS NULL` / `ON CONFLICT DO NOTHING`, unique key, generation guard). An unconditional write under an idempotency claim is a defect, not a verified property.

**Extends to EXEMPTIONS and preconditions.** Whenever you *exempt* a path from a safety gate, or claim "this only happens when X" / "X is already true here" / "the caller only sends this for Y", that exemption is `[ASSUMED]` until the precondition is *enforced* at `file:line`. Exemptions are the dangerous direction: *adding* a gate is visibly safe; *carving an exception out of one* (e.g. "finalize skips the confidence gate because its recipient is already engaged") is where fail-open hides — the assumed state must be checked server-side, not trusted from the caller or the intended use.

## Step 3 — Trace the contract (mark N/A explicitly, never silently skip)

1 user/caller → 2 client state → 3 request payload → 4 route auth/validation/body-parser → 5 service/helper → 6 persistence write/read → 7 response shape → 8 consumer state/render → 9 docs/tests/gates.

## Step 4 — Run the seven audits (run the ones in scope; say which are N/A)

1. **Whole-flow** — every hop in Step 3 accounted for.
2. **Partial-success** — unit of success? does the response return success/failure *identifiers* or only a count? does the client update state for *only the successful* items? can failed rows stay retryable? can `success:true` happen when every row failed?
3. **Async / stale-state** — for every `await`, stream, retry, background, or load-on-mount: name the stale-generation guard / abort / mounted-flag. Check *every* post-await state write, success AND failure paths. A context change must not write stale data into the new request/proposal/user.
4. **Helper-extraction** — name what the helper may do and what it must NOT collapse. Check call sites for differing semantics. (Exact normalized-name exclusion ≠ fuzzy author matching; UI dedupe ≠ identity resolution; display pruning ≠ persistence sanitization unless the persisted DTO is explicitly defined + gated.)
5. **Durable-surface** — for a new/changed durable surface, confirm each that applies: migration file · migration manifest (`npm run prebuild`) · Atlas page (`docs/atlas/`, `check:atlas`) · API route security matrix (`check:api-routes`) · `CANONICAL_COUNTS` + `check:fact-consistency` (route/endpoint counts shift) · source-header / service-catalog entry · cap/cleanup strategy · tests for the new contract · the gate that would catch the omission.
6. **Doc-reconcile** — for durable docs/memory, **delegate to `/sweep`** (don't re-implement it): read the whole target, grep the repo for the same fact, fix frontmatter + summary + body + tail + linked docs in one pass; never append a correction beside the old contradiction.
7. **Symbol-consumer fan-out** — for any new/changed enum value, persisted column, or status: grep the SYMBOL (not the flow) and prove every READ surface handles it. A verified write path is half a proof; the defects hide on the read side. **Grep the raw persisted field name (e.g. the column `wmkf_responsetype`), NOT just the mapping-helper variable (`RESPONSE_TYPE_MAP`)** — consumers often read the field directly without the map, so the field name is a superset of the helper hits (S257: a map-symbol grep missed `my-candidates.js`, which emits the raw numeric field).
   - **Maps are symmetric:** a write-map (`X_MAP`) almost always has a reverse read-map (`X_BY_VALUE`). Find both — a value in one but not the other returns `undefined` to consumers.
   - **Select lists come in ≥2:** the same row often has more than one projection/`select` list (e.g. an adapter `FIELD_SELECT` AND a separate token-verifier `SUGGESTION_SELECT`). Grep the field; add it to each, not just the first found.
   - **Boolean guards fail open:** any guard shaped `return v !== 'x'` (denylist) is wrong-by-default for a new value. Read the default branch — "what does this return for the NEW value?" Prefer converting to an allowlist.
   - **Buckets must be total:** every staff filter / count / badge that branches on the status must place the new value in exactly ONE bucket — not zero (row vanishes), not the wrong one (e.g. `pending = !responseType` silently swallows a new status).
   - **State machines are complete only across all terminals:** a row's "done" can be set by a sibling column or a side-channel writer (cron / webhook / bulk update) that bypasses the main guard. Grep every column that signals terminal; confirm the new state is handled in each reader.

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

**Complement & fall-through check (build-side — run it on YOUR OWN new code).** The defects you ship live in the *negative space* — the inputs your new branch doesn't match, not the ones it does. For every branch, type, or gate you add, enumerate the **complement** and state what the system does for it: an `if/else-if` with no final `else` is **fail-open until proven fail-closed**; a new enum value/templateType/status defaults to *whatever the unhandled path does* — verify that's safe (reject/skip), not just "my new value is handled." You scrutinize what you ADD; force yourself to scrutinize what you EXEMPT and what FALLS THROUGH. When you apply a principle to fix one spot (allowlist this gate, map this consumer), immediately ask **"which sibling surfaces have the same shape?"** and sweep them in the same pass — fixing only the instance in front of you is how the same class re-lands next chunk.

**Tests pass for the wrong reason, too.** A negative assertion ("no materials leak", "not called") only means something when the thing-being-excluded is actually PRESENT in the setup — otherwise it proves *absence*, not *exclusion*, and stays green if the guard is deleted. To test a strip/skip/guard, construct the input that WOULD trip it and prove the guard removes it. Before trusting a passing test ask: **"would this still pass if the feature were broken?"** If yes, it's decorative.
```md
Changed: file — concise behavior change.
Verified: command / manual check.
Residual risk: none / named.
```

## Step 6 — Stop if evidence is missing

If a claim has no `file:line` / command behind it, label it `[ASSUMED]` and either go get the evidence or hedge — do not assert. For a substantial review or a multi-layer build, an adversarial second pass via `codex:rescue` is the norm, not a luxury.

## Anti-patterns this skill blocks (say the evidence, not the phrase)

"This should be fine" (no file evidence) · "The plan says…" as implementation evidence · "No callers" (no `rg`) · "Only docs" (no whole-file reconcile) · "Shared helper" (no preserved-difference list) · "Saved successfully" (response returns only a count) · any post-await state write with no stale-context check in streamed/request-scoped UI · "idempotent" (no named guard at `file:line`) · "reuse existing guards" (didn't read the default branch for the new value) · "single source of truth" (didn't grep the literal + map var for other sites) · "backward compatible" (didn't trace the read path) · "added the enum value" (verified the write map only — read map / 2nd select list / filter buckets unchecked) · "staff UI unaffected" (didn't read each status branch) · "this path is exempt because X is already true" (X not enforced server-side at `file:line`) · "handled the new type" (the if/else-if has no final `else` — unknown input falls open).
