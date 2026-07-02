---
title: Agent Harness Style Guide
domain: agent-harness
kind: spec
status: active
summary: "This guide keeps agent-facing instructions precise, confident, and low-noise."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# Agent Harness Style Guide

This guide keeps agent-facing instructions precise, confident, and low-noise.
Historical rationale remains available to maintainers without becoming part of
the normal execution prompt.

## Active Instruction Style

Agent-facing files should lead with the desired expert behavior:

- State the trigger.
- State the procedure.
- State the evidence required.
- State the verification command or gate.

Use prohibitions for hard safety invariants, not as the default shape of a rule.
Good active instructions sound like an experienced operator's checklist:

- Ground current-state claims in source, Atlas, probes, or command output.
- Search the complement set before asserting a scope claim.
- Read the complete durable document before reconciling a fact.
- Complete lifecycle and provenance tracing before delegating review.

Avoid active instructions that cast the agent as habitually defective. Examples:

```text
- "I keep missing..."
- "my recurring failures..."
- "Codex kept catching..."
- "this is the failure mode..."
```

## Rationale Sidecars

The history that explains why a rule exists belongs in a rationale sidecar:

- Skill rationale: `.claude/skills/<skill>/RATIONALE.md`
- Memory rationale: `.claude-memory/rationale/<memory-name>.md`
- Hook rationale: source comments may keep concise maintainer notes, but emitted
  `additionalContext` must remain procedural.
- Backup material: `.harness-backups/<date>-<slug>/`

Active files may link to rationale sidecars, but normal execution should not
require reading them.

## Hook Output

Hook messages are live prompt text. They should emit clean procedure, not the
incident history that motivated the hook.

Preferred shape:

```text
Before committing, complete the staged-surface self-review:
1. Verify existing behavior from source.
2. Check sibling surfaces for the same guard.
3. Name durable-write concurrency and idempotency mechanisms.
```

Maintainer rationale may stay in comments near the hook code, as long as the
runtime message stays focused on expert behavior.

## Durable Memories

Feedback memories should use this structure:

```md
## Recall Trigger

Read when...

## Expert Procedure

- ...

## Evidence Required

- ...

## Related Rules

- ...

## Rationale

Maintainer rationale: `.claude-memory/rationale/<name>.md`.
```

The active memory is the operating rule. The rationale sidecar is the incident
record.

## Verification

Run `npm run check:harness-framing` after changing active harness text. Run its
self-test after changing the checker:

```bash
npm run check:harness-framing
npm run check:harness-framing:self-test
```
