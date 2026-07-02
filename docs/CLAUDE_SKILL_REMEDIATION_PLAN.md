---
title: "Claude Skill Remediation Plan — Whole-Flow Verification"
domain: agent-harness
kind: plan
status: active
summary: Created: 2026-06-05 Audience: Future Claude / skill authors / reviewers Scope: Improve Claude-authored skills and operating checklists so they...
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/CLAUDE_REMEDIATION_PLAN.md
---

# Claude Skill Remediation Plan — Whole-Flow Verification

**Created:** 2026-06-05
**Audience:** Future Claude / skill authors / reviewers
**Scope:** Improve Claude-authored skills and operating checklists so they resist headline-reading, partial fixes, and contract drift.

## Problem Statement

Claude has recurring failure modes that are not primarily knowledge gaps. They are verification-shape gaps:

- Reading a headline, file name, grep hit, or plan claim as if it represents the whole file.
- Fixing the line under review while leaving the same stale fact or invariant elsewhere.
- Accepting a plan's intended state as if the live code already supports it.
- Changing one layer while missing caller, persistence, response, UI, docs, or CI-gate obligations.
- Treating partial success as total success.
- Adding awaited or streamed work without stale-generation or cancellation checks.
- Extracting "shared" helpers while collapsing important differences such as exact-match filtering vs. fuzzy matching.

The remediation should not be "try harder." It should be a small set of mechanical skill patterns that make the common mistakes harder to commit.

## Desired Skill Pattern

Create or update Claude skills around **contract-reconcile verification**. The skill should force a review shape:

1. Read the relevant whole files, not only grep-targeted slices.
2. Trace the full contract from caller to persistence to consumer.
3. Classify claims as verified, assumed, planned, or stale.
4. Check batch and async failure modes explicitly.
5. Check durable-surface obligations before declaring done.
6. Preserve semantic differences when extracting shared helpers.

## Core Skill: `contract-reconcile-review`

### Trigger

Use this skill when any task includes one or more of:

- "review this plan"
- "verify findings"
- "confirm/refute"
- "durable state"
- "new endpoint"
- "new table"
- "migration"
- "dedup"
- "partial save"
- "stream"
- "background"
- "fire-and-forget"
- "stale"
- "contract"
- "docs are drifted"

### Required Inputs

The skill should ask Claude to identify these before making claims:

- **Feature or change surface:** one sentence.
- **Entry points:** UI component, API route, script, command, or doc.
- **Persistence surfaces:** Postgres table, Dataverse entity, Blob path, local storage, memory/doc file, or none.
- **Consumers:** downstream UI, route, service, cron, external flow, docs, tests, or CI gates.
- **Known prior findings:** any review findings being verified.

### Required File-Reading Rule

For every file cited in a claim:

- Read the whole file when it is a durable doc, memory file, instruction file, or compact source file.
- For large source files, read the whole logical region plus every caller/consumer region touched by the claim.
- If a grep hit is used, follow it with adjacent context and the parent directory listing when naming a convention or absence.
- Do not infer from file names alone.

### Claim Labels

Every important state claim in the output should carry one label:

- `[VERIFIED via file:line]` — directly supported by cited code/doc.
- `[VERIFIED via command]` — directly supported by a read-only probe or gate.
- `[PLANNED]` — appears in the plan but is not implemented yet.
- `[ASSUMED]` — plausible but not proven; do not act destructively.
- `[STALE/CONFLICT]` — contradicted by live code or another authoritative source.

## Review Checklist

### 1. Whole-Flow Trace

Claude must trace the flow in this order:

1. User action or caller.
2. Client-side state.
3. API request payload.
4. Route validation/auth/body parser.
5. Service/helper behavior.
6. Persistence write/read.
7. Response shape.
8. Consumer state update/render.
9. Docs/tests/gates.

If any hop is not relevant, mark it `N/A`. Do not silently skip a hop.

### 2. Partial-Success Audit

For any batch operation, answer:

- What is the unit of success?
- Does the endpoint return successful item identifiers, failed item identifiers, or only counts?
- Does the client update state only for successful items?
- Can failed rows remain active/selectable/retryable?
- Is "success: true" possible when every row failed?

### 3. Async/Stale-State Audit

For any `await`, stream, retry, background request, or load-on-mount:

- Identify the stale-generation guard, abort signal, mounted flag, or cancellation path.
- Check every post-await state update.
- Check success and failure paths separately.
- Ensure a context change cannot write stale data into the new request/proposal/user.

### 4. Helper Extraction Audit

Before extracting or sharing helper logic:

- Name what the helper is allowed to do.
- Name what it must not collapse.
- Check whether existing call sites rely on different semantics.

Examples:

- Exact normalized-name exclusion is not fuzzy proposal-author matching.
- UI deduplication is not identity resolution.
- Display pruning is not persistence sanitization unless the persisted DTO is explicitly defined.

### 5. Durable-Surface Audit

For new or changed durable surfaces, check all that apply:

- Migration file.
- Migration manifest.
- Atlas page.
- API route security matrix.
- Source-file header or service catalog entry.
- Cleanup or cap strategy.
- Tests for the new contract.
- Gate that would catch omission.

### 6. Documentation Reconciliation Audit

For durable docs and memory:

- Read the whole target file first.
- Grep the repo for the same fact or phrase.
- Update frontmatter, summary, body, tail, and linked docs in one pass.
- Do not append a correction while leaving the original contradiction in place.

## Implementation Checklist Skill

Use a second skill mode, `contract-reconcile-implementation`, when Claude is implementing a reviewed plan.

### Implementation Steps

1. Re-read the accepted review findings before editing.
2. Convert each finding into an implementation invariant.
3. Edit the smallest set of files that satisfies the invariants.
4. After edits, run a self-review against the same invariants.
5. Run scoped tests/gates, sequentially when gates have self-tests.
6. Report residual risk explicitly.

### Required Invariant Table

Before editing, Claude should write a compact table:

| Invariant | Files likely touched | Verification |
|---|---|---|
| Example: failed batch rows stay selectable | route + client | endpoint returns `savedNames`; client marks only those names |

This table is not a long plan. It is a guardrail against losing the reason for the edit halfway through.

## Output Contracts

### Review Output

Use this format for review passes:

```md
## Findings

1. VERDICT — Finding title
   Evidence: file:line; file:line.
   Reasoning: 1-3 sentences.
   Residual risk: none / named risk.

## New Issues

- SEVERITY — Title
  Evidence: file:line.
  Required change: specific action.

## Final Verdict

READY TO IMPLEMENT | READY WITH NAMED CHANGES | NEEDS REWORK

Required named changes:
- ...
```

### Implementation Output

Use this format after implementation:

```md
Changed:
- file: concise behavior change.

Verified:
- command or manual check.

Residual risk:
- none / named risk.
```

## Anti-Patterns To Block

The skill should explicitly warn on these phrases or behaviors:

- "This should be fine" without file evidence.
- "The plan says..." used as implementation evidence.
- "No callers" without `rg` evidence.
- "Only docs" without whole-file reconciliation.
- "Shared helper" without listing preserved semantic differences.
- "Saved successfully" when the response only returns a count.
- Any post-await state update without a stale-context check in streamed or request-scoped UI.

## Skill Authoring Guidance

Keep the skill short and command-shaped. Claude follows compact checklists better than essays.

Recommended structure:

1. **When to use.**
2. **Files to read.**
3. **Trace the contract.**
4. **Run the six audits.**
5. **Use the output contract.**
6. **Stop if evidence is missing.**

Avoid vague reminders like "be thorough." Replace them with required artifacts:

- "List callers."
- "List consumers."
- "Cite file:line."
- "Label claims."
- "Name preserved semantic differences."
- "Name partial-success behavior."
- "Name stale-state guard."

## Acceptance Criteria

This remediation is working when:

- Review rounds find proposed-work risks, not missed live-code basics.
- Claude stops marking a finding resolved until the caller and consumer contracts are checked.
- Durable doc fixes do not leave contradictory restatements elsewhere in the same file.
- Batch operations preserve failed-item retryability.
- Async UI changes include post-await stale-context checks.
- New routes/tables reliably come with matrix/Atlas/manifest updates.

## Relationship To Existing Remediation

`docs/CLAUDE_REMEDIATION_PLAN.md` addresses the ground-truth gap for live state and data-layer planning.

This document addresses the **skill-shape gap**: how Claude should read, verify, implement, and report so it does not over-trust headlines, grep hits, or plan intent.

Both are required. Ground truth tells Claude what is real; contract reconciliation tells Claude how not to lose the reality while changing it.
