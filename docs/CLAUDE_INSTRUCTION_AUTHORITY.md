---
title: Claude Instruction Authority Registry
domain: agent-harness
kind: source-of-truth
status: canonical
summary: Status: Active Last verified: 2026-08-14 Purpose: Identify the authoritative definition and enforcement mirror for must-follow agent instructions.
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - scripts/setup-database.js
---

# Claude Instruction Authority Registry

**Status:** Active  
**Last verified:** 2026-08-14
**Purpose:** Identify the authoritative definition and enforcement mirror for must-follow agent instructions.

An instruction has one authoritative definition. Concise pointers and mechanical enforcement mirrors are allowed, but they must point back to that authority and must not independently restate mutable facts.

| Rule ID | Rule summary | Authoritative definition | Enforcement / retrieval mirror | Evaluation |
|---|---|---|---|---|
| `GLOBAL-PROBE-BEFORE-PLAN` | Verify live-state claims before planning | root `CLAUDE.md` | `/contract-reconcile`; Atlas gates | stale-Atlas planning task |
| `GLOBAL-TIMEBOX-META` | Check in before support work exceeds ~30 minutes or two commits | root `CLAUDE.md` | advisory reminder only | cleanup-spiral task |
| `GLOBAL-DESTRUCTIVE-CARRYOVER` | Verify live callers before destructive carryover | root `CLAUDE.md` | `/contract-reconcile`; `/start` | live-caller fixture |
| `GLOBAL-SYMLINK-INVARIANTS` | Preserve shared instruction/skill/memory symlinks | this registry | `check:agent-invariants`; lifecycle hook; `/start` | `check:instruction-architecture` |
| `GLOBAL-RED-GATES` | Relevant red gates block completion | root `CLAUDE.md` | session-owned changed-surface Stop hook; CI | `check:instruction-architecture` |
| `GLOBAL-AGENT-OAUTH` | Use interactive OAuth/subscription auth for Claude Code and Codex sessions; on macOS, re-check Claude auth and run delegated Claude CLI work outside the Codex sandbox so Keychain OAuth is visible; never substitute provider API keys | root `CLAUDE.md` | session startup/auth failure stop condition | sandbox false-negative + logged-out delegated-review tasks |
| `DOC-RECONCILE` | Reconcile the whole durable document and repeated claim | `.claude/rules/durable-docs.md` | reminder hook; `/sweep`; drift gates | contradictory-doc task |
| `API-AUTH-AND-MATRIX` | Use the correct auth class and register new routes | `.claude/rules/api-routes.md` | `check:api-routes`; changed-surface hook | uncovered-route task |
| `DB-MIGRATION-CONTRACT` | Existing databases use numbered migrations, never bootstrap | `scripts/setup-database.js` and `.claude/rules/database.md` | source-level refusal; migration gates | populated-database refusal |
| `LLM-TRANSPORT` | Use canonical LLM transport and prompt boundary | `.claude/rules/llm-and-prompts.md` | prompt-injection gate | direct-provider-call task |
| `EXTERNAL-TOKEN-FLOW` | Preserve external-reviewer token and row verification | `.claude/rules/external-reviewers.md` | scoped tests/docs | token-flow review |
| `BILL-INTEGRATION` | Use BILL wrappers and durable onboarding state | `.claude/rules/bill.md` | scoped tests/docs | BILL flow review |
| `INTAKE-UPLOAD` | Preserve private Blob and virus-scan contracts | `.claude/rules/intake-uploads.md` | scoped tests/docs | intake-upload review |
| `DYNAMICS-CONTEXT` | Enter explicit restriction context for Dynamics access | `.claude/rules/dataverse-dynamics.md` | service fail-closed behavior | Dynamics caller review |
| `AUTH-POLICY-BUNDLE` | Keep proxy auth policy bundle-safe and fail-closed | `.claude/rules/auth-policy.md` | scoped tests/docs | proxy/auth review |
| `AGENT-WIKI-RETRIEVAL` | Keep the agent wiki subordinate, current, and routed | `.claude/rules/agent-wiki.md` | `check:agent-wiki`; advisory freshness hook | stale-topic fixture |

## Hook Safety Contract

- Hooks never modify tracked application files.
- Runtime state lives outside the working tree and expires with the operating system's temporary storage.
- Missing or corrupt session state degrades to advisory behavior.
- Blocking checks are limited to deterministic failures attributable to the current session.
- Every block names the failed invariant and a recovery action.
- Gate results may be reused only when the session-owned changed-state fingerprint is unchanged.
- Broad judgment calls remain advisory; hooks do not pretend to prove adequate reasoning.

## Changed-Surface Rollout

The Stop gate verifier is initially advisory. Set `CLAUDE_STOP_GATE_MODE=block` only after real-session observation shows acceptable runtime and false-positive behavior. Symlink invariants newly broken by an attributable session change block immediately.
