---
name: sweep
description: Whole-repo reconcile sweep for fact-level doc or memory changes. Verifies that every live restatement of a changed fact agrees before completion is claimed.
allowed-tools: Read, Edit, Bash(grep:*, rg:*, git diff:*, git log:*)
---

# /sweep — Whole-Repo Doc Reconcile

**When invoked:** a fact-level doc or memory change needs repo-wide reconciliation before completion is claimed.

**Purpose:** prove that every live restatement of the changed fact agrees across the repo.

**Blocking semantics:** the originating fact-level change is complete only after every step below has run and the report shows zero remaining live stale restatements.

Maintainer rationale lives in `RATIONALE.md`; normal execution should use the procedure below.

---

## Step 1: State the claim

Write the claim being reconciled, in one sentence. Format:

> Claim: `<fact / state>` is now reconciled across the repo, originally fixed at `<file>:<line>`.

If the claim cannot be articulated cleanly, reduce it to a single fact statement first.

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

For each term, run `rg -n` (or `grep -rn`) against `docs/`, `lib/`, `pages/`, `scripts/`, `shared/`, and the relevant subset of `.claude-memory/`. Capture every hit. Read each hit before classifying it.

Default scope: live docs + code. Archive docs (`docs/archive/`) and auto-generated outputs (`docs/security-audit/*.json`) excluded unless the user opts in.

## Step 4: Triage each hit

For every hit, classify into exactly one of:

| Classification | Action |
|---|---|
| **AGREE** — line already reflects the post-fix state | Leave it |
| **STALE** — line still reflects the pre-fix state | Edit it (or, if structural, batch into a section-level fix) |
| **HISTORICAL** — line is a dated audit doc / changelog entry where the pre-fix state is the historical record | Leave it; note in the sweep report |
| **UNRELATED** — false positive (grep term collided with a different context) | Note in the sweep report |

Use exactly these four buckets. If a hit does not fit cleanly, read more context until it does.

## Step 5: Check for structural-vs-tactical

If STALE-bucket hits exceed ~5 lines OR cluster in one section, use a structural fix (banner, section-level rewrite, doc supersession) rather than scattered per-line edits. After two tactical passes on the same shape, stop and propose a structural fix instead.

## Step 6: Fix the STALE hits

Apply edits. After applying, re-grep the same terms. Report any remaining STALE hits explicitly.

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

## Step 8: Record relevant prior guidance

Note which memory entries or rules were relevant to this sweep.

Keep this to one concise sentence. Per `feedback-no-performative-contrition`, the report should stay focused on the fix and evidence.

---

## What this skill is NOT

- It is NOT a substitute for proactive reconciliation during normal doc work.
- It is NOT a guarantee. If my grep terms (step 2) miss the spot where staleness lives, the sweep won't catch it. The skill is only as good as the term-selection step.
- It is NOT scoped to documentation only. The same shape applies to code (e.g., a constant renamed in one place but referenced by string in another).
