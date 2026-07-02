# Memory Pending/Finished-Work Triage Plan - 2026-07-02

Status: Batch A completed 2026-07-02; later batches remain plan only. Do not
treat any remaining candidate below as stale, closed, or safe to delete until the
candidate file has been read in full and its references have been checked.

Repo HEAD when drafted: `138cb6f96b7b177956e17c0c2bc570291b3784f2`

## Purpose

Clean up `.claude-memory/` entries whose filenames or bodies suggest old
carryover state: `pending`, `deferred`, `todo`, `planned`, `done`, `complete`,
`shipped`, `closed`, `stale`, `superseded`, `legacy`, or `abandoned`.

The goal is not to make the folder look tidy. The goal is to make retrieval safe:
an agent should not treat historical carryover as active work, and should not
miss an active warning just because its filename sounds old.

## Non-Negotiable Rules

1. Read each candidate file in full before changing it.
2. Grep for every direct reference before deleting, renaming, or marking a file
   closed/stale/superseded.
3. If the file mentions tables, entities, routes, fields, source-of-truth,
   migration/drop state, row counts, or live platform state, verify against
   source, Atlas, or a probe before changing a current-state claim.
4. Do not delete in the first pass unless the file is a pure duplicate and all
   references are removed in the same commit.
5. Prefer status demotion plus a clear `Recall Rule` over deletion when the file
   still carries a useful historical warning.
6. Keep batches small enough that gates can run and the commit can be reviewed.

## Classification Labels

Use exactly one primary label per candidate:

| Label | Meaning | Allowed action |
|---|---|---|
| `KEEP_ACTIVE` | Operationally relevant now; an agent should still read it for a live task | Refresh `last_verified`, add/fix `## Recall Rule`, point to source/Atlas/probes |
| `ACTIVE_NEEDS_PROBE` | Still plausibly operational but current state cannot be proven from files alone | Keep active, add a visible `NEEDS-PROBE` note and required probe |
| `CLOSE_HISTORICAL` | Work finished or decision expired; useful as history only | Change status to `closed`, adjust recall rule to historical-only, remove router links |
| `MARK_STALE` | Contradicted by current source/Atlas/probe and unsafe if followed | Change status to `stale`, add first-line warning, route to current source |
| `MARK_SUPERSEDED` | Replaced by a newer memory/doc/source | Change status to `superseded`, add `Superseded by` pointer |
| `DELETE_DUPLICATE` | Fully duplicated by another file with no unique historical value | Delete only after reference grep and same-commit pointer cleanup |

## Candidate Discovery

Run these before each triage slice:

```bash
find .claude-memory -maxdepth 1 -type f -name '*.md' | sed 's#^\\.claude-memory/##' | sort | rg -i '(^|[-_])(pending|deferred|todo|not-built|unbuilt|planned|done|complete|shipped|closed|archive|stale|supersed|legacy|abandoned)([-_.]|$)'
rg -n '\\b(pending|deferred|todo|not built|unbuilt|planned|done|complete|completed|shipped|closed|stale|superseded|legacy|abandoned)\\b' .claude-memory/*.md
```

These commands identify candidates only. They do not prove stale state.

## Initial Filename Candidate Queue

The initial filename scan found these 11 files:

| File | Current status | Initial reason to inspect |
|---|---|---|
| `project-applicant-exclusion-policy-pending.md` | active | Filename says pending |
| `project-closed-work-archive.md` | closed | Archive health check; should not be in active routes except archive pointer |
| `project-deferred-code-cleanup.md` | active | Filename says deferred |
| `project-dynamics-explorer-archive-libs.md` | closed | Archive/closed file; verify no active route depends on it |
| `project-dynamics-explorer-serializer-deferred.md` | closed | Deferred title but already closed |
| `project-dynamics-feedback-admin-shipped.md` | active | Filename says shipped while status is active |
| `project-intake-portal-ui-todo.md` | active | Filename says todo |
| `project-intake-portal-virus-scan-e2e-deferred.md` | active | Filename says deferred |
| `project-reviewer-web-discovery-abandoned.md` | active | Filename says abandoned while status is active |
| `project-w6-table-drop-closed.md` | closed | Batch A renamed from pending title |
| `project-wave1-closeout-role-tail.md` | active | Batch A renamed from pending title; migration closed, role tail needs probe |

Do not process `project-closed-work-archive.md` as a normal candidate unless a
direct stale claim is found; it is allowed to contain historical closed work.

## High Body-Marker Queue

After the filename queue, inspect high-signal body-marker files where old-state
terms occur frequently. Start with the first 10:

| File | Current status | Why inspect early |
|---|---|---|
| `project-reviewer-apps-redesign-direction.md` | active | Very large active file with many done/planned/shipped markers |
| `project-bill-honorarium-integration.md` | active | Large active file; payment workflow risk |
| `project-reviewer-finder-next-topics.md` | active | "Next topics" files often rot |
| `project-reviewer-postgres-to-dataverse-migration.md` | closed 2026-07-02 | Code-grounded triage demoted it; live routing now uses narrower reviewer Dataverse/appresearcher memories plus source/Atlas |
| `project-dataverse-power-tools.md` | active | Large Dataverse memory with old verification basis |
| `project-nomenclature-and-app-sunset-sweep.md` | active | Cleanup/sunset domain has high stale-risk |
| `project-dynamics-explorer-reuse-power-tools.md` | active | Large Dynamics memory with old verification basis |
| `project-intake-portal-pilot-decisions-2026-05-06.md` | superseded | Verify it is not still referenced as current |
| `feedback-thoroughness-default.md` | active | Meta-rule contains pending/stale process language; likely keep but verify |
| `project-reviewer-finder-dataverse-entry-path.md` | active | Migration/retirement markers; verify current routing |

## Per-File Procedure

For each candidate:

1. Read the whole file with line numbers.
2. Record current frontmatter: `status`, `last_verified`, `scope`, and whether
   `## Recall Rule` exists.
3. Grep references:

```bash
rg -n 'candidate-slug|candidate-file.md' .claude-memory docs CLAUDE.md SESSION_PROMPT.md
```

4. If any claim is structural/live-state, inspect the source of truth:
   - Atlas: `docs/APPLICATION_STATE_ATLAS.md` and relevant `docs/atlas/*`
   - Source code paths named by the memory
   - Existing probe scripts or evidence files
   - Live probe only when file/source cannot prove the claim and the change
     would otherwise affect current-state wording
5. Assign one classification label.
6. Make the smallest safe edit:
   - frontmatter status
   - `last_verified`
   - `Recall Rule`
   - stale/superseded warning
   - direct reference cleanup
7. Record the decision in a short batch report or commit message.

## Batch Plan

### Batch A - Filename contradictions

Read and classify:

- `project-w6-table-drop-closed.md`
- `project-wave1-closeout-role-tail.md`
- `project-dynamics-feedback-admin-shipped.md`
- `project-reviewer-web-discovery-abandoned.md`
- `project-applicant-exclusion-policy-pending.md`

Expected output: likely status/routing cleanup only. Do not delete unless a
reference grep proves a file is duplicate/no-longer-referenced.

### Batch B - Deferred/todo intake files

Read and classify:

- `project-intake-portal-ui-todo.md`
- `project-intake-portal-virus-scan-e2e-deferred.md`
- `project-deferred-code-cleanup.md`

Expected output: mark active only if the carryover is still a real owner-backed
future task; otherwise close/historical or supersede to current plans/wiki.

### Batch C - Migration/completed-work memories

Read and classify:

- `project-reviewer-postgres-to-dataverse-migration.md` - triaged/demoted 2026-07-02
- `reviewer-identity-fragmentation.md` - triaged/kept active 2026-07-02
- `project-reviewer-finder-dataverse-entry-path.md`
- `project-appresearcher-collapse-post-pilot.md`

Expected output: move structural state to Atlas pointers and close or narrow
memories whose engineering work is complete.

### Batch D - Large active planning files

Read and classify:

- `project-reviewer-apps-redesign-direction.md`
- `project-bill-honorarium-integration.md`
- `project-dataverse-power-tools.md`
- `project-dynamics-explorer-reuse-power-tools.md`

Expected output: split active hazards from historical narrative; add
`ACTIVE_NEEDS_PROBE` where live platform state is still required.

## Verification Commands

Run after every batch:

```bash
npm run check:memory-router
npm run check:memory-router:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:memory-drift:no-write
```

If a wiki topic is edited, also run:

```bash
npm run check:agent-wiki
npm run check:agent-wiki:self-test
```

## Acceptance Criteria

The triage is complete when:

- Every filename candidate has a recorded classification.
- Every high body-marker candidate in the first queue has a recorded
  classification.
- No stale/superseded/deleted file is referenced from `.claude-memory/MEMORY.md`.
- Any deleted file has zero unresolved references.
- Active files that remain operational have a `## Recall Rule` or an explicit
  reason they do not.
- Historical files no longer present old work as current action.
- All verification commands for the edited surfaces pass.

## Recommended First Commit

Do Batch A only. It is small enough to review carefully and will prove the
workflow before touching large, narrative-heavy memories.
