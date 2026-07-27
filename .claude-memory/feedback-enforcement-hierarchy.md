---
name: feedback-enforcement-hierarchy
description: Safeguards are strongest when they eliminate duplicated claims or gate stored claims against source in CI. Use advisory hooks only for judgment-shaped friction and label ungated claims `[ASSUMED]`.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S291 via incident (process-legacy ownerAppKey) + Codex review
---

## Recall Rule

Read this when proposing or building a safeguard against a class of mistake: a
gate, hook, reminder, review step, or "be careful to X" rule.

## Expert Procedure

Apply the enforcement hierarchy, strongest first:

1. **Eliminate duplicated claims.** Derive the value from source so it cannot
   drift.
2. **Gate stored claims against source in CI.** Store the right contract and
   compare it to the source of truth with a fail-closed gate and self-test.
3. **Use friction for judgment-shaped checks.** Keep advisory hooks and prose
   small, scoped, and explicitly non-enforcing.

For any safeguard, ask whether it depends on the same actor it constrains. If it
does, classify it as friction and either move it up the hierarchy or label the
remaining claim `[ASSUMED]`.

[VERIFIED via `scripts/check-route-lifecycle-auth.js` and
`scripts/check-scaffolding-tokens.js` as current examples.] The hierarchy itself
is an engineering rule; each proposed enforcement still needs its own source and
self-test evidence.

## Evidence Required

- Name the source of truth being derived from or gated against.
- Name the CI gate and self-test that prove the stored claim stays in sync.
- For advisory-only checks, state why no machine-readable ground truth exists.

## Related Rules

- Worked examples: `check:route-lifecycle-auth`, `check:scaffolding-tokens`.
- Related memories: `feedback-red-gates-are-p0.md`,
  `feedback-self-review-before-delegating-review.md`,
  `feedback-behavior-claims-cite-the-producer.md`,
  `feedback-scrutinize-exemptions-and-fallthrough.md`.
- Maintainer rationale:
  `.claude-memory/rationale/feedback-enforcement-hierarchy.md`.
