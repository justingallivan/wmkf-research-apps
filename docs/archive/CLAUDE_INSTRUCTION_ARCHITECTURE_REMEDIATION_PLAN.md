# Claude Instruction Architecture Remediation Plan

**Created:** 2026-06-05  
**Status:** Initial implementation complete; blocking-hook rollout and repeated Claude trials pending  
**Scope:** Improve Claude instruction adherence while reducing root `CLAUDE.md` startup load.  
**Inputs:** `docs/archive/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md`, `docs/archive/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md`, and subsequent Codex review.

## Objective

Replace the current instruction architecture with a smaller, clearer, and more enforceable system without weakening important project safeguards.

The target architecture should:

- Keep only session-wide and planning-time rules in root `CLAUDE.md`.
- Give every instruction one authoritative definition.
- Permit concise pointers and mechanical enforcement mirrors where they improve reliability.
- Load file-specific conventions through path-scoped rules.
- Put multi-step procedures in focused skills.
- Put rationale and historical lessons in memory.
- Enforce deterministic invariants through hooks, scripts, and CI gates.
- Avoid blocking work because of changes that predated the current agent session.
- Measure whether the new architecture improves behavior before removing the old prose.

This plan does not implement those changes. It defines the sequence, contracts, and acceptance criteria for doing so safely.

## Reconciled Findings

The cleanup direction is sound, but the original proposal needs the following corrections.

### 1. Enforcement must precede root-file reduction

The rules most often ignored are already present as prose. Moving or shortening them before a reliable replacement exists would reduce adherence further.

No root instruction may be removed until its destination or enforcement replacement has been implemented and passed the relevant evaluation.

### 2. Stop-gate enforcement must be session-scoped

A Stop hook based only on current `git status` would treat pre-existing user changes as the agent's responsibility and could repeatedly block unrelated work.

The Stop verifier must use a session-scoped mutation ledger and a session-start baseline. It must distinguish:

- files already dirty when the session started;
- files successfully changed by the agent during the session;
- pre-existing dirty files that the agent also changed;
- generated or externally changed files not attributable to the agent;
- gates required by the agent-owned changed surfaces.

### 3. Symlink protection must enforce the invariant, not blacklist commands

Blocking only `rm` and `ln` is insufficient. `Write`, `cp`, `git restore`, scripts, and other commands can also replace a symlink.

The protected contract is:

- tracked `AGENTS.md` is a symlink to `CLAUDE.md`;
- per-machine `.agents/skills` is a symlink to `../.claude/skills`;
- the Claude memory-store symlink points to the repository's `.claude-memory`.

Protection should verify those path invariants directly. Command-specific denies may supplement the check but are not the primary protection.

### 4. Instruction ownership is not runtime precedence

Claude Code does not provide a documented precedence ladder in which root instructions override path rules. The architecture must avoid contradictory instructions instead of relying on priority.

Use this ownership model:

> Each instruction has one authoritative definition. Short pointers and enforcement mirrors are allowed when they identify that authority and do not restate mutable details.

### 5. Hooks should block only deterministic, attributable failures

Hooks should not attempt to decide whether a plan was sufficiently thoughtful, whether the whole file was understood, or whether every statement was properly verified. Those are useful reminders and evaluation criteria, but they are not reliably machine-provable.

Blocking hooks are appropriate only when:

- the violated invariant is deterministic;
- the failure is attributable to the current session;
- the recovery action is clear;
- the hook fails safely if its own implementation fails;
- the check is bounded enough not to disrupt normal work.

### 6. Skills must be evaluated, not reorganized by intuition

The current `/contract-reconcile` skill is broad and was not always auto-discovered. Splitting it may improve trigger precision or may increase missed invocation.

Keep it unified initially. Decide whether to split it only after comparing measured activation and outcomes across repeatable evaluation tasks.

### 7. `setup-database.js` needed source-level protection

At review time, the file contradicted itself:

- its header says it is backward-compatible and can run on existing databases;
- its later inline contract says it is fresh-install-only and existing environments must use migrations.

This is now resolved: the source declares one fresh-install-only contract and refuses populated databases unless the explicit recovery override is set. The strongest protection belongs inside the script because Claude hooks do not protect humans, CI, or other agents.

## Target Architecture

| Surface | Authoritative responsibility | Allowed mirrors |
|---|---|---|
| Root `CLAUDE.md` | Session-wide and planning-time rules required before task-specific files are read | Short pointers to canonical docs, skills, and gates |
| `.claude/rules/*.md` | File-scoped conventions that become relevant when matching files are read | Pointers to canonical docs and required gates |
| `.claude/skills/*/SKILL.md` | Multi-step workflows and review procedures | Explicit invocation pointers from root/rules/task prompts |
| `.claude-memory/*.md` | Rationale, preferences, historical failures, and recall cues | No must-follow rule may exist only in memory |
| Hooks | Deterministic lifecycle checks, session attribution, and timely reminders | Must link to the authoritative rule or recovery procedure |
| Scripts and CI gates | Repository invariants that apply to all actors | Hook may invoke or verify the relevant scoped gate |
| Canonical docs/source | Mutable architecture and live-state facts | Root and rules contain pointers, not duplicated catalogues |

## Authority Registry

Before moving instructions, create an instruction authority registry. It should be a compact table in the implementation PR or a dedicated durable doc and contain:

| Rule ID | Rule summary | Authoritative surface | Enforcement mirror | Evaluation fixture |
|---|---|---|---|---|
| `GLOBAL-PROBE-BEFORE-PLAN` | Verify live-state claims before planning | root `CLAUDE.md` | advisory planning checklist; `/contract-reconcile` | stale Atlas claim |
| `GLOBAL-TIMEBOX-META` | Check in after approximately 30 minutes or two commits of support work | root `CLAUDE.md` | advisory elapsed-work reminder if feasible | cleanup spiral scenario |
| `GLOBAL-DESTRUCTIVE-CARRYOVER` | Verify live callers before destructive carryover | root `CLAUDE.md` | focused skill; narrow destructive-operation reminder | live caller exists |
| `GLOBAL-SYMLINK-INVARIANTS` | Preserve instruction and skill symlinks | root `CLAUDE.md` | invariant checker | replace each link with a regular file |
| `DOC-RECONCILE` | Read and reconcile the whole durable doc | `durable-docs` rule | reminder hook; `/sweep`; drift gates | repeated contradictory fact |
| `API-SECURITY-MATRIX` | New API routes require security-matrix coverage | `api-routes` rule | `check:api-routes`; scoped Stop verifier | new uncovered route |
| `DB-MIGRATION-CONTRACT` | Existing DBs use migrations, never setup script | `database` rule and script source | source-level refusal; migration gates | populated-DB invocation |
| `LLM-TRANSPORT` | Use canonical LLM transport | `llm-and-prompts` rule | lint/custom gate if justified | direct provider fetch |

The initial registry must cover every rule removed from root `CLAUDE.md`. A rule cannot be removed if its authority or evaluation fixture is blank.

## Phase 0: Baseline And Safety Contract

### Goals

- Establish current behavior before changing instruction routing.
- Define session attribution and blocking-hook safety.
- Reconcile the `setup-database.js` contradiction.

### Work

1. Capture the current root `CLAUDE.md` line count and section inventory.
2. Inventory existing hooks, their matchers, event types, and fail-open behavior.
3. Inventory all `check:*` scripts and map each to the paths it governs.
4. Record the existing symlink invariants and their expected targets.
5. Build the initial authority registry.
6. Define a hook safety contract:
   - hooks never modify tracked application files;
   - hook state lives outside the working tree;
   - a hook implementation error does not wedge the session;
   - blocking output names the failed invariant and exact recovery command;
   - repeated checks are cached when the relevant changed-state fingerprint has not changed;
   - blocking checks have bounded execution time.
7. Reconcile `scripts/setup-database.js` so its header, runtime behavior, and documentation agree.
8. Add source-level protection against running the setup script on a populated existing database, with an explicit and documented fresh-install escape path if one is required.

### Acceptance

- Every current root section has an intended authoritative destination.
- Every proposed blocking hook satisfies the safety contract.
- `setup-database.js` has one unambiguous contract and protects itself without relying on Claude.
- No root content has been removed yet.

## Phase 1: Session Attribution Foundation

### Goal

Create the attribution layer required for fair Stop enforcement.

### Session Ledger Contract

At session start, capture a baseline containing:

- repository root and current commit;
- tracked dirty paths and their content fingerprints;
- untracked paths;
- current symlink invariant results;
- timestamp and session identifier.

During the session, record successful agent mutation events when observable:

- successful `Write` and `Edit` paths;
- successful file-mutating tool events supported by Claude hooks;
- pre-existing dirty files subsequently touched by the agent.

At Stop, derive the agent-owned changed surface as:

1. files clean at baseline but changed now;
2. files dirty at baseline whose content fingerprint changed again during the session;
3. files explicitly recorded as successfully mutated by the agent;
4. excluding files that changed externally without an attributable agent mutation when that can be determined.

The ledger must not be stored in the repository. It should be keyed by repository and session, expire automatically, and tolerate a missing or corrupt ledger by degrading to an advisory warning rather than blocking.

### Important Limitation

Bash and external processes can mutate files in ways hooks may not attribute precisely. The first version should prefer under-blocking with a loud advisory over falsely blocking the user for unattributed changes.

### Acceptance

- A fixture with pre-existing dirty API files does not trigger a blocking API gate when the agent changes only an unrelated doc.
- A pre-existing dirty API file changed again by the agent is included in the relevant gate surface.
- A newly created API route is included.
- A missing/corrupt ledger cannot trap the session.

## Phase 2: Deterministic Enforcement

Implement and verify enforcement before reducing root prose.

### 2.1 Symlink Invariant Checker

Create one reusable invariant checker that verifies:

- `AGENTS.md` is a symlink resolving to `CLAUDE.md`;
- `.agents/skills` is a symlink resolving to `.claude/skills`;
- the machine-specific Claude memory path resolves to this repository's `.claude-memory`.

Use it in:

- a non-blocking SessionStart diagnostic;
- a Stop check that blocks only if an invariant changed during the session or the agent touched the protected path;
- CI for the tracked `AGENTS.md` invariant;
- `/start` for per-machine link repair guidance.

Do not rely on matching `rm` or `ln` commands. If preventative PreToolUse checks are added, they should inspect the target path and protected invariant, not only command text.

### 2.2 Scoped Stop Gate Verifier

Create a changed-surface-to-gate mapping from the existing gate definitions and documented scopes.

The Stop verifier should:

1. read the session-owned changed surface;
2. determine only the gates relevant to those paths;
3. reuse a recent successful result when the changed-state fingerprint is identical;
4. otherwise run or require the specific relevant gate;
5. block only on a red relevant gate attributable to the session;
6. report unrelated red gates as advisory context rather than claiming they are the session's regression;
7. never run a gate and its self-test in parallel.

The first version should cover the clearest deterministic mappings:

- `pages/api/**` → `check:api-routes`;
- data-layer and Atlas surfaces → `check:atlas` and `check:migrations-manifest` where applicable;
- registered fact-level durable-doc changes → relevant drift gates;
- prompt-injection surfaces → `check:prompt-injection-tagging`.

Do not begin with every repository gate. Expand only after false-positive and runtime measurements are acceptable.

### 2.3 Advisory Judgment Checks

Keep the following non-blocking:

- whole-file reconciliation completeness;
- whether a plan adequately probed live state;
- whether a claim is assumption or fact;
- whether meta-work has exceeded its useful scope;
- whether a skill should have been invoked.

Use concise reminders tied to high-signal events, plus regression evaluations. Avoid a broad transcript-reading completion judge.

### Acceptance

- Deterministic fixtures are blocked when red and pass when green.
- Pre-existing unrelated dirty work does not block completion.
- Hook failure or timeout degrades safely.
- Each block identifies one actionable invariant and recovery step.
- Median Stop overhead and worst-case gate runtime are measured and accepted before expansion.

## Phase 3: Add Path-Scoped Rules And Refine Skills

### Path-Scoped Rules

Create narrowly scoped rules for:

- durable docs and memory;
- API routes and authentication;
- database and migrations;
- LLM and prompt surfaces;
- external reviewer/token flows;
- BILL integration;
- intake Blob/upload flows;
- Dataverse/Dynamics restriction context;
- auth-policy/proxy bundle safety.

Each rule should:

- contain conventions for matching files only;
- name its authoritative docs or source;
- name relevant gates;
- avoid mutable catalogues;
- remain short enough to scan;
- avoid duplicating a session-wide rule from root.

Because path rules load when matching files are read, obligations that apply before creating a new file must also be covered by an explicit skill, task prompt, or deterministic gate.

### Skills

Keep `/contract-reconcile` unified for the initial rollout. Tighten its trigger description only if evaluation shows a specific discovery failure.

Add focused skills only where the workflow is distinct and repeatable, likely:

- destructive-change verification;
- grounded planning;
- database migration;
- scoped verification.

Do not duplicate `/sweep` logic inside other skills; invoke it as the authoritative whole-repo reconciliation procedure.

### Acceptance

- Every path rule has at least one positive-load and one negative-load evaluation.
- Creating a new API route or migration still triggers its obligation without relying on the new file having been read first.
- No rule has conflicting authoritative definitions across root, rules, skills, or memory.

## Phase 4: Reduce Root `CLAUDE.md`

### Root Content To Keep

Keep concise versions of rules needed before task-specific files are read:

- repository identity and the `AGENTS.md` symlink invariant;
- destructive-carryover verification;
- probe-before-plan and Atlas consultation;
- time-boxing support/meta-work;
- relevant red gates block completion;
- universal security invariants;
- existing databases use migrations, never the setup script;
- explicit high-risk skill invocation guidance;
- source-of-truth pointers;
- core development commands.

### Root Content To Remove Or Compress

Remove mutable or task-specific catalogues only after their destinations pass evaluation:

- application catalogue → `shared/config/appRegistry.js`;
- environment catalogue → `docs/CREDENTIALS_RUNBOOK.md` and `lib/utils/tracked-secrets.js`;
- database table catalogue → Application State Atlas and migration sources;
- long documentation catalogue → memory router, scoped rules, and repository search;
- detailed auth/service/utility reference → scoped rules and canonical docs;
- historical Request Workbench narrative → feature docs and history.

### Deletion Protocol

For each root section:

1. identify every rule and mutable fact it contains;
2. validate the proposed destination against an independent authoritative source;
3. confirm enforcement and evaluation coverage;
4. remove the root section;
5. run the relevant evaluations and drift gates;
6. restore the section if behavior regresses.

Do not treat the current root catalogue as the completeness baseline because it may already be stale.

### Target

Aim for 80–120 lines, but do not sacrifice a genuinely session-wide guardrail to meet the numeric target. Staying below Anthropic's approximately 200-line guidance is the hard objective; 80–120 is a working target.

## Phase 5: Regression Evaluation

### Evaluation Suite

Create repeatable tasks representing known failures:

1. Plan against a stale Atlas claim.
2. Destructive carryover item with a live caller.
3. Durable doc containing the same contradictory fact in multiple sections.
4. New API route missing security-matrix coverage.
5. New table missing migration manifest or Atlas coverage.
6. Partial batch save where only successful identifiers should update client state.
7. Awaited or streamed UI flow with a stale-generation write.
8. Shared-helper extraction that must preserve distinct semantics.
9. Attempt to replace each protected symlink with a regular file.
10. Session beginning with unrelated dirty gated files.
11. New-file creation before any matching path rule could load.
12. Meta-work spiral that should trigger a check-in rather than continue indefinitely.

### Trial Design

- Run each task multiple times before and after the architecture change.
- Separate automatic skill discovery trials from explicitly invoked skill trials.
- Record required reads, searches, rule/skill activation, hook interventions, false blocks, missed blocks, and final repository outcome.
- Keep evaluation prompts stable across comparisons.
- Use results, not preference, to decide whether `/contract-reconcile` should split.

### Success Metrics

- Fewer unsupported state claims.
- Fewer missed whole-flow consumers.
- Fewer incomplete durable-doc reconciliations.
- Deterministic omissions blocked before completion.
- No false blocks caused solely by pre-existing user changes.
- No increase in premature completion.
- Improved or unchanged correct skill activation.
- Root `CLAUDE.md` reduced without evaluation regression.

## Phase 6: Rollout And Maintenance

### Rollout

1. Ship baseline, source-level setup-script protection, and evaluation fixtures.
2. Ship session ledger and invariant checker in advisory mode.
3. Observe at least several real sessions and record false positives/negatives.
4. Enable blocking only for proven deterministic checks.
5. Add path rules and skills.
6. Reduce root `CLAUDE.md` section by section.
7. Re-run the full evaluation suite.

### Rollback Criteria

Disable or downgrade a blocking hook to advisory if:

- it blocks because of pre-existing or unattributed user changes;
- it cannot name a clear recovery action;
- it repeatedly times out or crashes;
- it materially disrupts unrelated work;
- its false-positive rate exceeds the agreed threshold.

Restore removed root guidance if post-removal evaluations show a meaningful adherence regression and no equivalent enforcement replacement exists.

### Ongoing Maintenance

- Review the authority registry when adding a new rule, skill, hook, or gate.
- Require evaluation coverage for new blocking behavior.
- Keep enforcement mirrors concise and linked to their authoritative definition.
- Periodically audit path-rule scopes and skill activation.
- Remove stale reminders once deterministic enforcement is proven.
- Revisit the `/contract-reconcile` split only with evaluation evidence.

## Named Implementation Deliverables

The implementation should produce, in order:

1. Reconciled and self-protecting `scripts/setup-database.js`.
2. Instruction authority registry.
3. Hook safety contract and session-ledger design.
4. Session-scoped mutation ledger.
5. Reusable symlink invariant checker.
6. Advisory SessionStart diagnostics.
7. Scoped Stop gate verifier, initially advisory and then selectively blocking.
8. Path-scoped rule set.
9. Any evaluation-justified focused skills.
10. Reduced root `CLAUDE.md`.
11. Repeatable instruction-architecture regression suite and results report.

## Final Acceptance Criteria

The remediation is complete only when:

- root `CLAUDE.md` is below 200 lines and near the 80–120 working target;
- every removed instruction has an authoritative destination;
- intentional mirrors identify their authority and contain no independently mutable detail;
- deterministic high-risk omissions are mechanically detected;
- blocking hooks use session attribution and do not punish pre-existing user work;
- symlink protection checks invariants rather than only command names;
- hook failures degrade safely;
- `setup-database.js` has one source-level contract and protects all callers;
- path-scoped rules load correctly for their intended workflows;
- regression trials show no material loss of important behavior;
- the decision to keep or split `/contract-reconcile` is supported by measured results.

## Implementation Decisions

1. The authority registry lives in `docs/CLAUDE_INSTRUCTION_AUTHORITY.md`.
2. Stop-hook gate execution is bounded to 120 seconds per gate and 130 seconds at hook wiring.
3. Initial changed-surface mappings are implemented but remain advisory pending real-session observation.
4. Any demonstrated block caused solely by pre-existing or unattributed user changes requires immediate downgrade to advisory.
5. The setup script refuses populated databases and supports only the explicit `ALLOW_POPULATED_DATABASE_SETUP=true` recovery override.
6. Root prose was reduced after automated architecture fixtures passed. Repeated Claude behavior trials remain required before enabling blocking gate mode or splitting `/contract-reconcile`.
