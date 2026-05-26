# Third-Party LLM Audit Practice Improvement Prompt

Use this prompt to help the third-party LLM improve its audit methodology after reviewing its original and amended reports.

````markdown
You produced two audit reports for this repository:

- `docs/AUDIT_REPORT_2026_05_26.md`
- `docs/AUDIT_REPORT_AMENDED_2026_05_26.md`

The amended report improved over the first report, but it still contained avoidable mistakes, overcorrections, weak citations, and imprecise action guidance. Your task now is not to audit the repo again. Your task is to analyze your own audit process, explain what went wrong, and produce best practices you will follow in future audits of this codebase.

## What Went Wrong

Address these shortcomings directly:

1. **Overcorrection on Dynamics write-helper semantics**
   - Your first report said `DynamicsService.updateRecord()` should call `checkRestriction()` directly.
   - Your amended report retracted too far and said write-helper restriction enforcement is intentionally delegated to route layers.
   - The cited evidence supports a narrower statement: Track A write endpoints must explicitly enforce table+field restrictions before calling `updateRecord()`. It does not conclusively prove the universal policy for all generic `DynamicsService` write helpers.
   - Correct practice: mark this kind of architectural intent as `[NEEDS OWNER]` unless the repo has a direct policy document or multiple implementation patterns proving it.

2. **Unverified quantitative claim**
   - You repeated a claim that there were "60+ test references" to deprecated `bypassRestrictions`.
   - The remaining deprecated callers are mostly scripts, with only a small number of test mocks/comments.
   - Correct practice: when making a count or quantity claim, run and cite the exact command and distinguish scripts, tests, app code, docs, and comments.

3. **Weak or incorrect line citations**
   - You cited the wrong line range for the drain-table earliest date/checklist. The conclusion was directionally correct, but the evidence pointer was sloppy.
   - Correct practice: after citing a line, re-open the cited range and verify that the line actually contains the claim.

4. **Overbroad gate recommendation**
   - You recommended a gate flagging any module-scope variable declarations in `lib/services/`.
   - That would be noisy and likely harmful because many module-level constants and caches are legitimate.
   - Correct practice: mechanical gates must target the specific risky pattern, have a low false-positive profile, and include fixture/self-test ideas.

5. **Dangling finding reference**
   - Your amended action plan referenced `F-003`, but no amended `F-003` existed.
   - Correct practice: after editing findings, run an internal consistency pass over finding IDs, action plans, and cross-references.

6. **Insufficient distinction between evidence and interpretation**
   - Some statements were treated as `[VERIFIED]` when the evidence only supported `[INFERRED]` or `[NEEDS OWNER]`.
   - Correct practice: code proves behavior; docs prove documented intent; neither alone always proves system policy. Be explicit about the difference.

## Required Output

Produce a self-improvement report with the following sections.

### 1. Acknowledged Mistakes

Create a table:

| Mistake | Why it happened | Correct classification | Better evidence needed |
|---|---|---|---|

Include every issue listed above. Add any additional issues you notice in your own reports.

### 2. Revised Audit Principles

Write 8-12 concrete principles you will follow in future codebase audits.

Each principle must be operational, not vague. For example:

- Bad: "Be careful with evidence."
- Good: "Before using `all`, `none`, `zero`, `perfect`, or `safe`, run a repo-wide search and cite the command or avoid the absolute."

Your principles must cover:

- evidence classification
- count claims
- line citations
- destructive recommendations
- semantic vs mechanical gate coverage
- architectural intent vs implementation behavior
- action-plan consistency
- avoiding overcorrection after feedback

### 3. Pre-Submission Checklist

Create a checklist you will apply before submitting future audit reports.

The checklist must include:

- Did I re-open every cited line range?
- Did I classify every major claim as `[VERIFIED]`, `[INFERRED]`, `[CONFLICT]`, `[RETRACTED]`, or `[NEEDS OWNER]`?
- Did I run exact searches before making count claims?
- Did I avoid destructive recommendations unless caller analysis and timing/checklist gates were verified?
- Did I distinguish route-matrix coverage from semantic auth correctness?
- Did I check that all finding IDs referenced in the action plan exist?

Add any other checks you think would have prevented your mistakes.

### 4. Better Mechanical Gates

Propose better gates than the overbroad "no module-scope variables in services" idea.

For each gate, include:

| Gate | Detects | False-positive risk | Self-test fixture idea |
|---|---|---|---|

Include at least:

- deprecated `DynamicsService.bypassRestrictions` / `setRestrictions` usage outside `dynamics-service.js`
- missing `checkRestriction(tableName)` in `getEntityRelationships`
- route-matrix warning escalation or explicit HMAC-webhook allowlist
- finding/action-plan cross-reference consistency for audit docs

### 5. How You Would Rewrite The Amended Report

Do not produce a full new audit. Instead, rewrite only the flawed statements from your amended report.

Use this format:

```markdown
Original:
> quote or summarize the flawed statement

Replacement:
> improved statement

Why:
explain the evidence/classification improvement
```

### 6. Future Audit Contract

End with a short contract you will follow in future repo audits:

- What you will verify before making strong claims
- What you will mark as owner decisions
- What you will never recommend without destructive-action proof
- How you will handle corrections without overcorrecting

## Constraints

- Do not defend the previous mistakes.
- Do not re-audit the entire repository.
- Do not produce generic LLM safety advice.
- Keep the report specific to the errors in `AUDIT_REPORT_2026_05_26.md` and `AUDIT_REPORT_AMENDED_2026_05_26.md`.
- The goal is to improve future audit quality, not to win an argument.
````
