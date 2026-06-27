---
name: sweep
description: Force a whole-repo reconcile sweep when Claude claims a doc-fix is done. Catches the "fixed-the-line-in-front-of-me" failure mode where stale restatements survive elsewhere.
allowed-tools: Read, Edit, Bash(grep:*, rg:*, git diff:*, git log:*)
---

# /sweep — Whole-Repo Doc Reconcile

**When invoked:** the user just caught me claiming a doc fix is done (or about to be done) and wants to force the reconciliation discipline that the `feedback-reconcile-dont-append-docs` memory entry mandates but I keep skipping.

**Purpose:** turn the per-line-patch failure mode into a structural one. I don't get to call a fact-reconciliation done until every restatement across the repo agrees.

**This skill is BLOCKING.** I cannot claim the originating work complete until I've run every step below and reported the results. Skipping ahead because "I already checked" is the exact failure mode this skill exists to interrupt.

---

## Step 1: State the claim

Write the claim I just made or am about to make, in one sentence. Format:

> Claim: `<fact / state>` is now reconciled across the repo, originally fixed at `<file>:<line>`.

If I can't articulate the claim cleanly, the sweep can't run — go back and reduce it to a single fact statement first.

## Step 2: Identify the search terms

List 3-5 grep terms that would surface restatements of the claim. Include:
- The literal fact value (e.g., the table name, the entity-set name, the model name)
- Likely paraphrases / older names (e.g., the wrong plural, the deprecated alias)
- Adjacent qualifying words (e.g., "deployed", "shipped", "NOT", "retired", "future work")

Example for a B2-F6-shaped claim ("wmkf_appproposalsearch is deployed"):
- `wmkf_appproposalsearch`, `wmkf_appproposalsearches`, `wmkf_appproposalsearchs`
- `NOT DEPLOYED`, `not deployed`, `to deploy`
- `proposal_searches` (the Postgres counterpart that may carry related staleness)

## Step 3: Run the sweep

For each term, run `rg -n` (or `grep -rn`) against `docs/`, `lib/`, `pages/`, `scripts/`, `shared/`, and the relevant subset of `.claude-memory/`. Capture every hit. Don't filter by "probably fine" without reading the line.

Default scope: live docs + code. Archive docs (`docs/archive/`) and auto-generated outputs (`docs/security-audit/*.json`) excluded unless the user opts in.

## Step 4: Triage each hit

For every hit, classify into exactly one of:

| Classification | Action |
|---|---|
| **AGREE** — line already reflects the post-fix state | Leave it |
| **STALE** — line still reflects the pre-fix state | Edit it (or, if structural, batch into a section-level fix) |
| **HISTORICAL** — line is a dated audit doc / changelog entry where the pre-fix state is the historical record | Leave it; note in the sweep report |
| **UNRELATED** — false positive (grep term collided with a different context) | Note in the sweep report |

If I find myself wanting to add a fifth bucket like "probably fine" or "doesn't matter" — that's the failure mode firing. Force into one of the four.

## Step 5: Check for structural-vs-tactical

If STALE-bucket hits exceed ~5 lines OR cluster in one section, the right move is a structural fix (banner, section-level rewrite, doc supersession), NOT per-line edits. Two rounds of per-line patching on the same shape = the wrong tool. Stop and propose a structural fix instead.

## Step 6: Fix the STALE hits

Apply edits. After applying, re-grep the same terms. Any remaining STALE hits are the failure-loop firing again — surface them explicitly rather than declaring victory.

## Step 7: Report

Single concise report:

```
Sweep complete for claim: <claim>
Terms searched: <list>
Hits: N total → AGREE N1 / STALE N2 / HISTORICAL N3 / UNRELATED N4
STALE addressed: N2 line edits OR <structural-fix description>
Remaining STALE after fix pass: 0  ← MUST be 0 to declare done

Memory entries that should have fired pre-claim (and didn't):
- [[feedback-reconcile-dont-append-docs]] — primary
- [[<other relevant entries>]] — secondary
```

If "Remaining STALE after fix pass" is non-zero, the claim is NOT done. Go back to step 6.

## Step 8: Acknowledge the memory-fire failure

Note explicitly which memory entries SHOULD have prevented the need for this sweep. Adding this line is part of the price of needing the user to call `/sweep` — it makes the prophylactic-vs-post-mortem failure (audit pattern §"Cross-cutting observation") visible.

Do NOT turn this into multi-paragraph self-criticism. One sentence: "the X memory entry would have caught this if I'd queried it pre-claim." That's it. Per `feedback-no-performative-contrition`.

---

## What this skill is NOT

- It is NOT a substitute for me running the sweep proactively. The whole point is that I should be doing this without the user typing `/sweep`. The skill exists for when I've failed at that.
- It is NOT a guarantee. If my grep terms (step 2) miss the spot where staleness lives, the sweep won't catch it. The skill is only as good as the term-selection step.
- It is NOT scoped to documentation only. The same shape applies to code (e.g., a constant renamed in one place but referenced by string in another).
