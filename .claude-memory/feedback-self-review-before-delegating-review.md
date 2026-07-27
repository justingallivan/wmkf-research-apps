---
name: Self-review (verify + fan-out) before delegating a code review
description: Before committing or delegating review, run the verify/fan-out/trust-boundary/concurrency/lifecycle/provenance self-pass and include file evidence in the review prompt.
type: feedback
status: active
scope: workflow
last_verified: S285 (2026-06-24)
---

## Recall Rule

Read before declaring a slice done, committing code, or delegating a review
through Codex, `/code-review`, contract-reconcile, or another reviewer.

## Expert Procedure

1. **Verify existing behavior from source.** Read or grep the producer before
   claiming how a field, helper, return shape, enum, or route behaves.
2. **Fan out new guards.** When adding validation, null checks, scope checks, or
   coercion, grep for structural siblings and apply the same principle where the
   contract matches.
3. **Harden trust boundaries.** Validate untrusted input format, scope it to the
   authorized set, sanitize outbound errors, and type-guard external or LLM data
   before render.
4. **Name durable-write concurrency.** For shared durable state, identify the
   idempotency, locking, ETag, unique key, or retry mechanism.
5. **Trace lifecycle from landed state.** For flags, refs, resources, caches, and
   subscriptions, enumerate transitions into and out of the landed state.
6. **Trace provenance and value semantics.** Identify what produced each value
   and what each side of a cross-layer contract means on success and failure.

## Evidence Required

- Include file:line evidence for each named risk before delegating review.
- Convert any "look for/check whether X" review prompt item into "traced X at
  file:line -> found Y" or "traced X at file:line -> none found".
- Run the relevant contract-reconcile and sibling-grep pass before committing
  code that changes cross-layer behavior.

## Related Rules

- Hooks: `.claude/hooks/pre-commit-self-review.js`,
  `.claude/hooks/pre-review-delegation-trace-guard.js`.
- Skill: `.claude/skills/contract-reconcile/SKILL.md`.
- Related memories: `feedback-symbol-consumer-fanout.md`,
  `feedback-idempotency-name-the-mechanism.md`,
  `feedback-scrutinize-exemptions-and-fallthrough.md`.
- Maintainer rationale:
  `.claude-memory/rationale/feedback-self-review-before-delegating-review.md`.
