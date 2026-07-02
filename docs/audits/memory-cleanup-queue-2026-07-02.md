# Memory Cleanup Queue - 2026-07-02

Status: queue document only. Do not treat this as a source of application state.

Repo HEAD when drafted: `711f459e9f45fd3c10fde648296b0b9efe619e82`

Claude coordination state when drafted: active nested worktree at `.claude/worktrees/session-314` on branch `claude/session-314`. Do not edit `.claude-memory` from the main checkout until that worktree is merged, abandoned, or explicitly coordinated.

## Purpose

This queue turns the memory-hygiene audits into small follow-up batches. It does not edit, delete, demote, or refresh memory files.

The cleanup goal is retrieval safety:

- keep `.claude-memory/MEMORY.md` as a terse router
- keep active leaf memories small enough to earn active recall
- move historical build diaries and stale carryover out of active paths
- verify structural claims against source, Atlas, tests, or probes before changing current-state wording

## Current Inventory Snapshot

Measured from `.claude-memory/*.md` on 2026-07-02:

| Metric | Current value |
|---|---:|
| Leaf memory files, excluding `MEMORY.md` | 191 |
| Active leaf memories | 177 |
| Closed leaf memories | 11 |
| Stale leaf memories | 2 |
| Superseded leaf memories | 1 |
| Active memories without `## Recall Rule` | 34 |
| Active memories with unknown, memory-content, or not-reprobed verification wording | 83 |
| Total `.claude-memory/*.md` byte size, including router | 828,797 |
| Router size | 5,941 bytes / 57 lines |

The router is no longer the pressure point. The remaining risk is active leaf memory semantics: oversized operational files, old verification bases, and active files without a normalized recall trigger.

## Already Classified

Do not re-triage these unless new source evidence appears.

| Cluster | Result | Evidence |
|---|---|---|
| Router diet | Complete; router reduced to 5,941 bytes / 57 lines | `docs/audits/memory-hygiene-control-audit-2026-07-02.md` |
| Pending filename Batch A | Complete; W6 and Wave 1 renamed, active guardrails retained where still useful | `docs/audits/memory-pending-triage-batch-a-2026-07-02.md` |
| Filename-level slice memories | Complete; slice files are closed/historical, with live invariant moved to intake wiki/schema comments | `docs/audits/memory-slice-triage-2026-07-02.md` |
| Reviewer Postgres-to-Dataverse cluster | Complete; large migration memory demoted, narrower memories retained | `docs/audits/memory-code-grounded-triage-batch-1-2026-07-02.md` |
| Reviewer identity cluster | Complete; old phase memory demoted, current resolver/backprop guardrails retained | `docs/audits/memory-code-grounded-triage-batch-2-2026-07-02.md` |
| Dynamics / Power Tools cluster | Audit complete, memory edits blocked by active Claude worktree | `docs/audits/memory-code-grounded-triage-batch-3-2026-07-02.md` and `docs/audits/memory-trim-package-dynamics-power-tools-2026-07-02.md` |
| Deferred / todo intake and cleanup files | Audit complete; memory edits blocked by active Claude worktree | `docs/audits/memory-pending-triage-batch-b-2026-07-02.md` |

## Ready When Claude Clears

These are the first memory edits to apply after coordination clears, because the code-grounded audit and replacement package already exist.

| Priority | File | Current queue status | Next action |
|---:|---|---|---|
| 1 | `.claude-memory/project-dataverse-power-tools.md` | Ready to trim | Apply the compact active replacement from `docs/audits/memory-trim-package-dynamics-power-tools-2026-07-02.md`; demote the chronological build diary and old probe ledger out of active recall. |
| 2 | `.claude-memory/project-dynamics-explorer-reuse-power-tools.md` | Ready to trim | Apply the compact "reuse, do not rebuild" replacement from the trim package; keep the restriction-boundary and count-helper warnings. |
| 3 | `.claude-memory/project-dynamics-ai-writeback.md` | Classified but not trimmed | Keep active, then create a focused trim package or direct edit preserving nav-prop, choice-value, `createdon`, raw-output, and `updateIfEmpty` warnings. Verify docs/source before touching. |
| 4 | `.claude-memory/dataverse-export-floor-scoping.md` | Classified but not trimmed | Keep active for Phase 3 / AI-on-ramp semantics, but consider moving stable guidance into a canonical guide or wiki topic. |

Do not perform these edits while another agent owns `.claude-memory`.

## Next Small Batches

### Batch B - Deferred / Todo Intake And Cleanup Files

Status: audit-classified. Do not re-triage unless new source evidence appears.

These were already queued in the pending/finished-work triage plan. They are good small candidates because their filenames suggest carryover, but they are not as sprawling as the largest active memories.

| File | Classification | Next action |
|---|---|---|
| `.claude-memory/project-intake-portal-ui-todo.md` | `ACTIVE_NEEDS_PROBE` | Keep active; source confirms the `/apply` sign-out loop risk, but Azure user-flow settings and browser logout behavior need portal/browser verification before memory edit. |
| `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md` | `ACTIVE_NEEDS_LIVE_E2E` | Keep active; source/tests cover the infected branch, but the deployed applicant-session EICAR upload remains the residual go-live gate. |
| `.claude-memory/project-deferred-code-cleanup.md` | `KEEP_ACTIVE` | Keep active as the destructive-cleanup registry; its named guard still exists and is still called. |

Evidence: `docs/audits/memory-pending-triage-batch-b-2026-07-02.md`. Do not delete in this batch.

### Batch C - Oversized Active Planning Files

These are high-value but should be handled one at a time. They are more likely to contain mixed historical and current behavior.

| File | Size | Reason to inspect |
|---|---:|---|
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | 35,149 bytes | Largest active file; likely a blend of current UI direction and completed build narrative. |
| `.claude-memory/project-honorarium-payment-landscape.md` | 14,191 bytes | Large payment-domain memory; high operational risk if stale. |
| `.claude-memory/project-bill-honorarium-integration.md` | 12,180 bytes | Large active memory; prior wiki audit flagged pending webhook/Event/DataVerse PATCH claims to keep precise. |
| `.claude-memory/project-dataverse-schema-deploy-gotchas.md` | 9,230 bytes | Active Dataverse deployment memory; should be compact hazards, not old incident log. |
| `.claude-memory/akoya-payment-field-semantics.md` | 8,357 bytes | Payment-field semantics are useful but need clear source/probe anchors. |

Recommended output for each file: a batch report or trim package before editing memory. The report should say exactly which current behaviors are source-backed and which historical paragraphs should be demoted.

### Batch D - Active Memories Missing Recall Rules

There are 34 active files without `## Recall Rule`. Do not normalize all of them mechanically. Start with files that are either large, routed, or operationally risky:

| File | Size | Why first |
|---|---:|---|
| `.claude-memory/project-branded-domains.md` | 6,149 bytes | Active production-domain memory with live probe history but no normalized recall trigger. |
| `.claude-memory/project-reviewer-duplicate-merge.md` | 4,935 bytes | Reviewer identity/merge behavior can affect persistence decisions. |
| `.claude-memory/project-email-template-token-syntax.md` | 3,710 bytes | Recently verified migration; likely easy to normalize. |
| `.claude-memory/project-jsdom-serverless-esm-incompat.md` | 3,045 bytes | Environment/test behavior memory; low-risk normalization candidate. |
| `.claude-memory/project-dataverse-settings-audit-enablement.md` | 2,283 bytes | Dataverse settings/audit behavior should have explicit source/probe pointers. |

For feedback-only memories, add recall rules only if they still drive agent behavior. Otherwise leave them alone until a separate feedback-memory pass.

### Batch E - Memory Health Gate Design

After the next one or two cleanup batches, add a read-only advisory script such as `scripts/check-memory-health.js` and a package script such as `check:memory-health:no-write`.

Initial report-only checks:

- active memory missing `## Recall Rule`
- active memory with empty, unknown, memory-content, or not-reprobed `last_verified`
- stale or superseded memory referenced directly from `.claude-memory/MEMORY.md`
- active memory over a byte threshold, for example 8KB
- structural-state terms without nearby source, Atlas, doc, test, or probe pointers

Keep this advisory at first. Do not make it fail-closed until the existing active memory set is cleaner.

## Suggested Next Move

If Claude is still active, do Batch C as another doc-only package or read-only audit. If Claude has cleared `.claude-memory`, apply the two ready trim edits from the Dynamics / Power Tools package first.

## Verification For Queue-Only Doc Changes

For this doc-only queue, run:

```bash
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
git diff --check
```

For future memory edits, also run:

```bash
npm run check:memory-router
npm run check:memory-router:self-test
```

If a wiki topic changes, add:

```bash
npm run check:agent-wiki
npm run check:agent-wiki:self-test
```
