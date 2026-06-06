# Claude Instruction Architecture Cleanup Plan

**Created:** 2026-06-05  
**Status:** Proposed for Claude architecture review  
**Scope:** Reduce `CLAUDE.md` startup-context load while improving enforcement of important project instructions.

## Objective

Reduce root `CLAUDE.md` from its current 308 lines to approximately 80–120 high-signal lines.

The cleanup must preserve important guidance while moving each instruction to the mechanism best suited to enforce or retrieve it:

- Root `CLAUDE.md` for concise, universal instructions needed in every session.
- Path-scoped `.claude/rules/` for instructions relevant only while touching matching files.
- Skills for multi-step workflows.
- Memory for rationale, user preferences, and historical lessons.
- Hooks and CI gates for behavior that must not depend on Claude remembering instructions.
- Existing canonical docs and source files for live-state catalogues and reference material.

This is not a deletion exercise. It is an instruction-routing and enforcement improvement.

## Problem

Root `CLAUDE.md` currently performs four distinct jobs:

1. Universal agent guardrails.
2. Architecture and operational reference.
3. Mutable live-state catalogue.
4. Documentation router.

Combining these jobs creates three problems:

- Important universal instructions compete with large quantities of task-irrelevant context.
- Mutable facts are duplicated from canonical sources and become drift risks.
- Must-follow procedures are expressed as prose reminders even when hooks or gates could enforce them.

Anthropic's Claude Code documentation states that `CLAUDE.md` is advisory context rather than enforced configuration, that shorter and more specific instructions produce better adherence, and that files over 200 lines may reduce adherence. Mandatory lifecycle behavior should be enforced using hooks.

## Design Principles

1. **Keep startup context scarce.** Root `CLAUDE.md` contains only instructions useful in nearly every session.
2. **Load detail when relevant.** Use path-scoped rules and focused skills for task-specific procedures.
3. **Do not duplicate canonical facts.** Point to the authoritative source instead.
4. **Enforce invariants mechanically.** Use hooks and gates when ignoring a rule would be unsafe or expensive.
5. **Keep rationale separate from enforcement.** Memories explain why; rules, skills, hooks, and gates govern behavior.
6. **Preserve one cross-agent instruction surface.** Keep `AGENTS.md` as the tracked symlink to `CLAUDE.md`.

## Proposed Root `CLAUDE.md`

The reduced root file should contain only:

1. Repository identity and the `AGENTS.md` symlink invariant.
2. Five concise universal operating rules.
3. One-paragraph project overview.
4. Core development commands.
5. Universal security and data-handling invariants.
6. Source-of-truth pointers.
7. A short table of workflows and the skills to invoke.

### Universal Rules To Keep

Keep these rules in concise form because they apply broadly:

- Verify destructive carryover against live callers before acting.
- Time-box cleanup, reconciliation, and audit work; check in after approximately 30 minutes or two commits without project progress.
- Probe live state before making plans; consult the relevant Atlas page.
- Relevant red CI gates block completion.
- Existing databases use `node scripts/apply-migrations.js`, never `scripts/setup-database.js`.
- Never accept user identity/profile identifiers from request input when they can be derived from authenticated context.
- API keys stay server-side.
- Use the canonical LLM transport rather than ad hoc provider fetches.

### Root Content To Compress

| Current content | Proposed root treatment |
|---|---|
| `AGENTS.md` symlink warning | Keep in 2–3 sentences; enforce with SessionStart hook. |
| Git commit policy | Keep as one sentence or move detailed preference to memory. |
| Destructive carryover procedure | Keep one sentence; move procedure to focused skill and hook. |
| Durable-doc reconciliation procedure | Keep one sentence pointing to `/sweep`; enforce elsewhere. |
| Ground-truth requirement | Keep 3–5 lines pointing to Atlas and `/contract-reconcile`. |
| CI gate catalogue | Replace with one rule plus pointer to `docs/CI_GATES_REFERENCE.md`. |
| Development commands | Keep concise command block. |
| Authentication rules | Keep only universal identity rule; move detailed architecture to scoped rules/docs. |

## Content To Remove From Root Startup Context

These sections remain important, but should not be loaded into every session.

### Applications Catalogue

Remove the application table and the long Request Workbench session-history row.

Canonical replacements:

- `shared/config/appRegistry.js` for application definitions and app keys.
- Relevant feature/design docs for history and detailed behavior.

Root replacement:

```md
Application definitions and app keys live in `shared/config/appRegistry.js`.
```

### Environment Variable Catalogue

Remove the deployment-variable and optional-flag lists.

Canonical replacements:

- `docs/CREDENTIALS_RUNBOOK.md` for contracts, rotation, defaults, and diagnostics.
- `lib/utils/tracked-secrets.js` for the tracked-secret list.

Root replacement:

```md
Environment-variable contracts live in `docs/CREDENTIALS_RUNBOOK.md`; tracked secret names live in `lib/utils/tracked-secrets.js`.
```

### Database Table Catalogue

Remove the table-purpose and migration-history table.

Canonical replacements:

- `docs/APPLICATION_STATE_ATLAS.md`
- Relevant `docs/atlas/` page
- Migration files and manifest

Root replacement:

```md
Consult `docs/APPLICATION_STATE_ATLAS.md` and the relevant `docs/atlas/` page before data-layer planning.
```

### Extended Documentation Catalogue

Remove the long documentation index.

Replace it with:

- Task routing in `.claude-memory/MEMORY.md`.
- Path-scoped rules that point to the relevant docs.
- Focused skills that load required references.
- Repository search when needed.

### General Architecture Reference

Reduce the directory tree, shared-component list, service catalogue summary, utility catalogue summary, and detailed authentication architecture to short pointers.

Claude can inspect directories and source files on demand. These references should not consume permanent startup context.

## Proposed Path-Scoped Rules

Create `.claude/rules/` and move task-specific instructions into narrowly scoped files.

### `durable-docs.md`

Suggested paths:

```yaml
paths:
  - "docs/**"
  - ".claude-memory/**"
  - "CLAUDE.md"
  - "SESSION_PROMPT.md"
```

Content:

- Read the entire target file before editing.
- Search the repository for repeated claims.
- Reconcile frontmatter, summaries, body, tail, and linked docs.
- Invoke `/sweep` before declaring fact-level reconciliation complete.
- Run relevant drift gates.

### `api-routes.md`

Suggested paths:

```yaml
paths:
  - "pages/api/**"
  - "proxy.js"
  - "lib/utils/auth.js"
  - "shared/config/appRegistry.js"
```

Content:

- Route authentication conventions.
- Derive identity from authenticated context.
- API route security matrix obligation.
- Cron and external-token route exceptions.
- SSE convention.

### `database.md`

Suggested paths:

```yaml
paths:
  - "lib/db/**"
  - "scripts/setup-database.js"
  - "scripts/apply-migrations.js"
  - "scripts/audit-postgres-state.js"
```

Content:

- Authoritative schema sources.
- Existing-database migration procedure.
- Manifest and Atlas obligations.
- Gate sequencing requirements.

### `llm-and-prompts.md`

Suggested paths:

```yaml
paths:
  - "lib/services/llm-client.js"
  - "lib/services/execute-prompt.js"
  - "lib/services/*prompt*"
  - "shared/config/prompts/**"
  - "pages/api/**"
```

Content:

- Use `llm-client.js`, not ad hoc provider fetches.
- Executor contract pointer.
- Prompt resolver restrictions.
- Model configuration pointers.
- Prompt-injection boundary obligations.

### Additional Domain Rules

Create narrow rules for:

- `lib/external/**` and `pages/api/external/**`
- `lib/bill/**`
- Intake Blob and upload paths
- Dataverse adapters and Dynamics restriction context
- `auth-policy.js`, `proxy.js`, and bundle-safety requirements

## Proposed Skills

Skills should hold multi-step workflows rather than static facts.

| Workflow | Skill treatment |
|---|---|
| Destructive carryover verification | Add focused `/verify-destructive-change` skill. |
| Probe-before-plan | Add `/grounded-plan` or split review mode from `/contract-reconcile`. |
| Whole-file document reconciliation | Keep `/sweep`; make durable-doc rule point to it. |
| Migration creation/application | Add `/database-migration` skill. |
| Full gate execution and sequencing | Add `/verify-changes` or consolidate into `/start` and `/stop`. |
| Cross-layer contract review | Keep `/contract-reconcile`, but consider separate review and implementation skills. |

For high-risk work, prompts and task procedures should invoke the relevant skill explicitly rather than relying only on model-initiated skill discovery.

## Proposed Memory Use

Memory should retain rationale and durable user preferences, not must-follow enforcement.

Appropriate memory topics include:

- Why destructive carryover is dangerous.
- Why cleanup and audit work must be time-boxed.
- Why whole-file reconciliation is required.
- Preference for regular commits.
- Historical lessons from S136 and S219.
- Domain-specific semantic distinctions and design decisions.

Existing relevant memories already include:

- `feedback-verify-before-destructive-carryover.md`
- `feedback-timebox-metawork.md`
- `feedback-reconcile-dont-append-docs.md`

Root `CLAUDE.md` should reference these only when the lesson supports a universal rule.

## Proposed Hooks And Gates

Important instructions that Claude must not ignore should be enforced mechanically.

| Requirement | Proposed enforcement |
|---|---|
| Preserve `AGENTS.md` and `.agents/skills` symlinks | SessionStart hook that blocks or loudly fails on mismatch. |
| Read and reconcile whole durable docs | PostToolUse or Stop verifier; current reminder-only hook is insufficient. |
| New API route has matrix coverage | Existing `check:api-routes`; optional Stop hook based on changed paths. |
| New table has migration manifest and Atlas coverage | Existing gates plus Stop hook based on changed paths. |
| Relevant red gates block completion | Stop hook verifies required gates for changed surfaces. |
| Destructive change has caller verification | Narrow PreToolUse prompt/agent hook or explicit approval workflow. |
| Existing DB never uses setup script | Bash PreToolUse deny hook. |
| No direct Anthropic/provider fetches | ESLint or custom CI gate. |
| Correct API auth guard | Strengthen API route gate to validate guard class, not only matrix presence. |

The current hooks mostly return `additionalContext` and explicitly fail open. They improve awareness but do not enforce compliance.

## Recommended Sequencing

### Phase 1 — Architecture Review

Ask Claude to review this proposal specifically for:

- Whether `.claude/rules/` path-scoped behavior works as assumed.
- Whether instructions remain available after compaction and directory changes.
- Whether any proposed hook event cannot enforce the named behavior.
- Whether splitting `/contract-reconcile` would improve or weaken automatic skill discovery.
- Whether any root instruction must remain globally loaded for Claude architecture reasons.
- Any precedence, conflict, or loading-order concerns.

Do not move instructions until this review is reconciled.

### Phase 2 — Add Enforcement Before Removing Prose

Implement and verify:

1. SessionStart symlink check.
2. Blocking or continuation-based Stop verifier.
3. Narrow protection against running `setup-database.js` on existing environments.
4. Required path-scoped rules.
5. Focused skills needed to replace detailed root procedures.

This avoids deleting reminders before their replacements exist.

### Phase 3 — Reduce Root `CLAUDE.md`

Remove duplicated catalogues and move detailed procedures to their accepted destinations.

Target: 80–120 lines.

### Phase 4 — Evaluate

Create small regression tasks representing known failures:

- Durable doc with contradictory repeated facts.
- Destructive carryover with a live caller.
- New API route missing matrix coverage.
- New table missing Atlas or manifest coverage.
- Partial batch save.
- Post-await stale-state write.

Run multiple trials and measure:

- Correct skill/rule activation.
- Required reads and searches.
- Hook intervention.
- Final repository outcome.
- Premature completion rate.

## Claude Architecture Review Questions

Claude should answer each question with `AGREE`, `MODIFY`, or `OBJECT`, with evidence:

1. Is 80–120 lines a reasonable root `CLAUDE.md` target for this repository?
2. Which proposed root instructions must remain globally loaded, and why?
3. Will the suggested `.claude/rules/` paths load at the correct time and survive the relevant workflows?
4. Which proposed rules should instead be skills because path-scoped rules would load too late?
5. Which proposed hooks can reliably block or continue work at the named lifecycle point?
6. Are there risks in replacing reminder-only hooks with deny/block behavior?
7. Should `/contract-reconcile` be split? If so, what trigger descriptions minimize missed invocation?
8. What instruction-precedence or conflict risks does this proposal introduce?
9. What should be tested before deleting each corresponding root section?
10. What important behavior would become less reliable under this proposal?

## Acceptance Criteria

The cleanup is successful when:

- Root `CLAUDE.md` is approximately 80–120 lines.
- Universal rules remain visible in every session.
- Task-specific instructions load only when relevant.
- Must-follow behavior is enforced by hooks or gates rather than prose alone.
- Mutable live-state catalogues have one authoritative source.
- Claude can identify the relevant workflow skill without relying on a large root file.
- Regression tasks show improved adherence across multiple trials.
- No important existing behavior becomes less reliable.

## Non-Goals

- Rewriting all project documentation.
- Deleting historical rationale.
- Moving mutable live-state facts into memory.
- Creating broad blocking hooks that interfere with unrelated work.
- Depending exclusively on automatic skill invocation for high-risk tasks.
