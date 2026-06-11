# Claude Memory Reorganization Plan

**Created:** 2026-06-04  
**Audience:** Claude, the project orchestrator  
**Scope:** Reorganize `.claude-memory/` so long-term project memory is easier to retrieve, harder to stale-drift, and cheap enough to load reliably at session start.

---

## Why This Plan Exists

The project currently has a strong memory foundation: one canonical git-tracked store at `.claude-memory/`, a symlink from Claude Code's harness memory directory into that store, a startup index at `.claude-memory/MEMORY.md`, topic files, drift-check scripts, and the Application State Atlas.

The problem is not absence of memory. The problem is density and retrieval.

As of 2026-06-04:

- `.claude-memory/MEMORY.md` is 143 lines and 24,314 bytes.
- Claude Code auto-memory startup load is limited to the first 200 lines or 25KB, whichever comes first.
- The index is therefore very close to the byte limit.
- Many index lines contain operational summaries that compete with the routing function.
- Some topic files are long historical narratives, while others are active invariants.
- "Closed", "stale", "active", and "superseded" memories are mixed in ways that make stale recall likely.

The fix is to make `MEMORY.md` a compact routing table, not the memory itself.

---

## Ground Rules

Do not change the canonical storage architecture.

- Keep the memory of record in `.claude-memory/`.
- Keep it git-tracked.
- Keep the per-machine Claude Code harness memory path symlinked into `.claude-memory/`.
- Do not move the repo into iCloud, OneDrive, Google Drive, Dropbox, or any cloud-synced working tree.
- Do not create a second memory store.
- Do not rely on local `~/.claude` content as durable unless it is symlinked into this repo.

Do not use memory as ground truth for live code, schema, or deployment state.

- Memory captures intent, lessons, hazards, and historical decisions.
- The Application State Atlas captures structural facts about tables, entities, adapters, endpoints, and source-of-truth.
- Source code and live probes override memory.
- If memory conflicts with code, docs, Atlas, or live probes, mark the memory stale or superseded immediately.

Do not rewrite memory casually.

- This plan reorganizes memory for retrieval.
- Preserve useful historical evidence unless it is harmful or false.
- Prefer archiving or marking stale over deleting.
- For destructive cleanup of memory files, list candidates first and verify there are no live references.

---

## Target Model

Use five layers.

### Layer 1: `CLAUDE.md` / `AGENTS.md`

Purpose: stable repo operating rules.

Keep:

- Repository etiquette.
- Required gates.
- Auth and security rules.
- Destructive-action verification rules.
- Pointers to canonical docs.
- "Read the Atlas before data-layer work" rule.

Do not keep:

- Session history.
- App changelogs.
- Long per-feature implementation narratives.
- Detailed state claims that belong in Atlas pages.

Current state: `AGENTS.md` is correctly a symlink to `CLAUDE.md`. Preserve this.

### Layer 2: `SESSION_PROMPT.md`

Purpose: current handoff only.

Keep:

- Current branch and deployment posture.
- The current active task.
- Unmerged branches.
- Immediate next actions.
- Commands needed for the next session.
- Known blockers from the latest session.

Do not keep:

- Permanent architecture.
- Long-term strategy.
- Old session summaries once they are closed.
- Facts that belong in memory or Atlas.

### Layer 3: `.claude-memory/MEMORY.md`

Purpose: startup routing table.

Target budget:

- 60 to 90 lines.
- Under 12KB — this is the **enforced** hard cap as of 2026-06-10 (`check-memory-router.js`); see the Phase 5 note.
- Must stay below 150 lines (also enforced). The 18KB figure is retained only as an unreachable legacy constant — the 12KB cap fails first.

The index should answer:

> "Given this kind of task, which one to three files should Claude read before acting?"

The index should not try to answer:

> "What is the full history and current truth of this topic?"

### Layer 4: `.claude-memory/*.md` topic files

Purpose: durable lessons, decisions, hazards, and project-memory entries.

Each topic file must start with standard metadata and a short summary.

Required header:

```md
---
name: kebab-case-name
description: One sentence saying when this memory matters.
metadata:
  type: feedback | project | user | decision | reference | archive
  status: active | stale | closed | superseded
  scope: reviewer | intake | dataverse | auth | bill | dev-env | docs | global
  last_verified: YYYY-MM-DD via <file/probe/doc/live-check>
---
```

Required first section:

```md
## Recall Rule

Read this when: <specific trigger>.

Do:
- <1-3 concrete behaviors>

Do not:
- <1-3 traps or forbidden assumptions>

Ground truth:
- <source docs, Atlas pages, scripts, or code paths>

Supersedes:
- <optional>

Superseded by:
- <optional>
```

After that, preserve historical details as needed.

### Layer 5: `docs/APPLICATION_STATE_ATLAS.md` and `docs/atlas/*`

Purpose: structural live-state reference.

Memory should point to Atlas pages instead of restating:

- Entity/table schemas.
- Source-of-truth.
- Read paths.
- Write paths.
- Migration/drop status.
- Last live probe result.

When a memory file contains structural claims, either:

- Replace them with an Atlas pointer, or
- Label them historical and non-authoritative.

---

## Proposed New `MEMORY.md` Shape

Replace `.claude-memory/MEMORY.md` with a compact router shaped like this.

```md
# Project Memory Router

## Startup
- Current handoff: ../SESSION_PROMPT.md
- Canonical live-state index: ../docs/APPLICATION_STATE_ATLAS.md
- Ground-truth rules: ../docs/CLAUDE_REMEDIATION_PLAN.md
- Memory storage invariant: memory-store-propagation.md

## Always Read For These Hazards
- Destructive carryover: feedback-verify-before-destructive-carryover.md
- Red gates: feedback-red-gates-are-p0.md
- Scope/count claims: feedback-falsify-not-confirm.md
- Doc fixes: feedback-reconcile-dont-append-docs.md
- External platform claims: feedback-verify-external-platform-claims.md
- Review output: feedback-share-codex-verbatim.md

## Task Routing
- Reviewer workbench/lifecycle: project-reviewer-apps-redesign-direction.md; project-reviewer-workbench-invite-workflow.md
- Reviewer identity/ORCID: project-reviewer-identity-resolution.md; project-reviewer-identity-resolution-phase1.md; project-reviewer-self-report-orcid-sticky-confirmed.md
- Reviewer data migration: project-reviewer-postgres-to-dataverse-migration.md; project-reviewer-finder-dataverse-entry-path.md
- Intake portal: project-intake-portal-skinny-scope.md; project-intake-portal-reviewer-capture.md; project-intake-portal-virus-scan-e2e-deferred.md
- Dataverse schema/probes: project-dataverse-schema-deploy-gotchas.md; project-dataverse-odata-null-filter.md; project-living-taxonomy-principle.md
- Dynamics Explorer: project-dynamics-explorer-details.md; project-dynamics-explorer-schema-diff.md; project-dynamics-explorer-reuse-power-tools.md
- Prompt/Executor work: project-prompt-storage-strategy.md; project-dynamics-as-prompt-ground-truth.md
- BILL/honoraria: project-bill-honorarium-integration.md; akoya-request-honorarium-nomenclature.md; akoya-payment-field-semantics.md
- SharePoint/external reviewer flow: project-external-reviewer-file-access.md; project-sharepoint-integration.md
- App access/auth/admin: project-app-access-control.md; project-admin-dashboard.md; project-dynamics-identity-reconciliation.md
- Dev environment: project-dev-environment.md; project-vercel-sensitive-env-pull-empty.md; env-broken-git-autogc.md; local-jest-build-environment.md
- Strategy/roadmap: project-system-model.md; project-strategy-direction.md; project-app-roadmap-2026-04-25.md

## User Context
- Power Automate familiarity: user-powerautomate.md

## Archive
- Closed shipped work: project-closed-work-archive.md
```

The exact routing entries can change during implementation, but the index must stay compact.

---

## Implementation Plan

### Phase 0: Preflight

Run these checks before editing memory.

```bash
pwd
/bin/ls -la AGENTS.md CLAUDE.md .claude-memory
/usr/bin/wc -l .claude-memory/MEMORY.md SESSION_PROMPT.md CLAUDE.md AGENTS.md
/usr/bin/find .claude-memory -maxdepth 1 -type f -name '*.md' | /usr/bin/wc -l
```

Confirm:

- `AGENTS.md` is a symlink to `CLAUDE.md`.
- `.claude-memory/MEMORY.md` exists.
- The memory store is in the repo.
- No untracked regular `AGENTS.md` replacement exists.

If the harness memory symlink may be broken, verify it before continuing. Use the slug logic from `.claude-memory/memory-store-propagation.md`.

### Phase 1: Classify Existing Memory Files

Create a temporary inventory table in a scratch doc or terminal output. Do not commit the scratch file unless useful.

For every `.claude-memory/*.md` file except `MEMORY.md`, classify:

- `type`: feedback, project, user, decision, reference, archive.
- `status`: active, stale, closed, superseded.
- `scope`: reviewer, intake, dataverse, auth, bill, dev-env, docs, global, etc.
- `index-worthy`: yes/no.
- `ground-truth source`: Atlas page, source file, doc, probe script, user assertion, or historical-only.

Suggested command:

```bash
/usr/bin/find .claude-memory -maxdepth 1 -type f -name '*.md' -not -name 'MEMORY.md' -print | /usr/bin/sort
```

Use existing audits as prior art, not as final truth:

- `docs/AUDIT_S154_MEMORY.md`
- `docs/AUDIT_S154_MEMORY_CODEX.md`
- `docs/AUDIT_S154_MEMORY_V2.md`
- `docs/HOME_MAC_MEMORY_SYNC_FIX.md`
- `.claude-memory/memory-store-propagation.md`

### Phase 2: Define the Router

Draft a replacement `.claude-memory/MEMORY.md` with:

- One `Startup` section.
- One `Always Read For These Hazards` section.
- One `Task Routing` section.
- One `User Context` section.
- One `Archive` section.

Rules:

- No task route should include more than three memory files.
- Prefer the most current memory entry over older overlapping entries.
- Closed/shipped entries should move to `project-closed-work-archive.md` unless they contain an active invariant.
- Keep descriptions short enough that each line is a pointer, not a paragraph.
- The index must stay under 12KB after editing.

### Phase 3: Normalize High-Value Topic Files

Do not normalize all topic files in one pass unless time permits. Start with index-worthy active files.

Priority order:

1. Always-read guardrails.
2. Reviewer identity and Workbench memories.
3. Intake portal memories.
4. Dataverse schema/probe memories.
5. BILL/honoraria memories.
6. Dev environment memories.

For each priority file:

- Add or correct the YAML metadata header.
- Add the `Recall Rule` section.
- Replace stale structural claims with Atlas pointers.
- Mark superseded details clearly.
- Keep historical evidence below the recall section.

Do not turn a topic file into a second index. If it needs subrouting, split it or point to a canonical doc.

### Phase 4: Archive or Mark Stale

For stale or closed files:

- If the memory contains no active invariant, move its useful facts into `project-closed-work-archive.md` or mark it `status: closed`.
- If the memory is false, mark it `status: stale` or `status: superseded` at the top.
- If the memory is actively dangerous, add a first-line warning and route away from it.

Do not delete stale files in this phase unless:

- There is an explicit duplicate.
- The newer file fully supersedes it.
- Grep confirms no live references remain.

Before deleting any memory file, run:

```bash
/usr/bin/grep -R "filename-without-extension\\|filename.md" .claude-memory docs CLAUDE.md SESSION_PROMPT.md
```

### Phase 5: Add Drift Controls

Update or extend the memory drift workflow so memory reorganization stays durable.

Minimum:

- Keep `scripts/check-memory-drift.js`.
- Keep `scripts/reconcile-memory-claims.js`.
- Run `npm run check:memory-drift -- --no-write` if the package script exists.
- If no package script exists, run the node script directly.

Suggested new lightweight check:

- `MEMORY.md` line count must be <= 150.
- `MEMORY.md` byte size must be <= 18KB.
- Every linked `.md` file in `MEMORY.md` must exist.
- Every active topic file should have `metadata.status`.

> **Implemented + hardened (2026-06-10).** This suggested check became
> `scripts/check-memory-router.js`, which is now the authority over the
> thresholds above. It hard-caps `MEMORY.md` at **12KB** (the old 12KB comfort
> target was promoted from warn-only to a hard failure; the 18KB ceiling above is
> retained only as an unreachable legacy constant), still enforces the 150-line
> cap, and additionally fails any `- ` router entry whose prose (file refs
> stripped) exceeds 200 chars — pushing dense domain detail into the agent wiki
> (`docs/agent-wiki/`). Per `docs/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md`.

Do not block this reorganization on writing a perfect CI gate. The first deliverable is a better memory structure.

### Phase 6: Validate

Run:

```bash
/usr/bin/wc -l .claude-memory/MEMORY.md
/usr/bin/stat -f '%z bytes' .claude-memory/MEMORY.md
/usr/bin/grep -o '[A-Za-z0-9._-]*\\.md' .claude-memory/MEMORY.md | /usr/bin/sort -u
node scripts/check-memory-drift.js --no-write
```

Then manually verify:

- Every linked memory file exists.
- `MEMORY.md` is under 150 lines and 18KB (the implemented gate now hard-caps at 12KB — see the Phase 5 note).
- Top active routes point to current files.
- Stale files are not in the task-routing hot path unless the line says they are closed/archive reference only.
- No structural live-state claim is presented as memory-only ground truth.

If editing facts in docs or memory, also run the relevant drift gates from `CLAUDE.md`, especially:

```bash
npm run check:fact-consistency
```

### Phase 7: Commit

Commit the reorganization separately from feature work.

Suggested commit message:

```text
Reorganize Claude project memory routing
```

Commit should include:

- `.claude-memory/MEMORY.md`
- Any normalized priority memory files
- Any drift-check script/package updates
- This plan only if it was changed during implementation

Do not mix with app code changes.

---

## Acceptance Criteria

The reorganization is complete when all are true:

- `.claude-memory/MEMORY.md` is a compact router, not a prose encyclopedia.
- `MEMORY.md` is under 150 lines and 18KB (the implemented gate now hard-caps at 12KB — see the Phase 5 note).
- The startup index has clear routing for the major active domains:
  - reviewer workbench/lifecycle
  - reviewer identity/ORCID
  - intake portal
  - Dataverse/schema
  - prompt/executor
  - BILL/honoraria
  - dev environment
  - strategy
- Active high-value topic files have metadata headers and recall rules.
- Closed/stale/superseded memories are labeled as such.
- Memory points to Atlas/source/live probes for structural facts.
- `node scripts/check-memory-drift.js --no-write` runs clean or any failure is documented and intentionally deferred.
- The final commit contains no app behavior changes.

---

## Operating Rule After This Lands

When starting a future task:

1. Read `SESSION_PROMPT.md`.
2. Read `.claude-memory/MEMORY.md`.
3. Select the task route.
4. Read the routed memory files in full.
5. If touching data-layer state, read the relevant Atlas page before making state claims.
6. If acting on destructive carryover, grep-verify live callers before acting.

When writing a new memory:

1. Prefer updating an existing topic file over creating a near-duplicate.
2. Add metadata.
3. Add a recall trigger.
4. Add ground-truth pointers.
5. Add it to `MEMORY.md` only if it should be startup-routable.

When closing work:

1. Move detailed session state out of `SESSION_PROMPT.md`.
2. Preserve only durable lessons in `.claude-memory/`.
3. Archive shipped history that no longer changes behavior.
4. Keep the router small.

---

## Notes From External Research

Current Claude Code documentation says:

- `CLAUDE.md` is always loaded for the project and should stay concise and specific.
- Auto-memory uses a `MEMORY.md` entrypoint plus topic files.
- Only the first 200 lines or first 25KB of `MEMORY.md` are loaded at session start.
- Topic memory files are read on demand.
- `.claude/rules/` can be used for path-scoped instructions, but this project already has strong repo-level instructions in `CLAUDE.md`; do not introduce rules unless there is a clear path-scoped need.

The practical conclusion for this repo:

- `MEMORY.md` should be a router.
- Topic files should contain the actual memory.
- Atlas and source should remain the authority for live state.
