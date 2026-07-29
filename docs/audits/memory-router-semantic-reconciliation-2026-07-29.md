# Memory Router Semantic Reconciliation — 2026-07-29

Status: point-in-time evidence report. Re-run the named checks and inspect live
source before relying on these counts or implementation claims.

Repo baseline: `813da56a`

## Scope and contract

This audit reconciled `.claude-memory/MEMORY.md` against source, the agent wiki,
the application-state Atlas, `docs/CURRENT_WORK_QUEUE.md`, canonical plans, and
leaf-memory metadata. It used the `/sweep` and `/contract-reconcile` workflows.

The router is a startup retrieval surface, not a second backlog, release log, or
leaf-memory catalogue. Current task routes should lead first to a canonical hub,
Atlas page, current queue, or authoritative plan. Closed and shipped detail
belongs in `.claude-memory/project-closed-work-archive.md`; parked work remains
discoverable through the current queue and domain hubs. No leaf-memory file was
deleted.

## Before and after

| Measure | Before | After |
|---|---:|---:|
| Router bytes | 11,298 | 5,175 |
| Router lines | 85 | 56 |
| Markdown references | 141 | 76 |
| Leaf-memory references | 103 (102 unique) | 41 (41 unique) |
| `check:memory-health` findings | 3 | 0 |

The after-state is below the earlier audit's 8 KB target as well as the enforced
12 KB hard cap.

## Reconciliation decisions

| Router subject | Evidence checked | Decision |
|---|---|---|
| Whack-a-mole review | `docs/CURRENT_WORK_QUEUE.md`, `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md`, independent review, `.github/workflows/test.yml`, and current reviewer source | Removed from startup routing. The initiative remains parked and unapproved in the canonical queue; several observations are already resolved in source, while three proposed WS0 checks are still absent from CI. The plan and review remain intact for deliberate future retrieval. |
| Review-form multiselect | `lib/external/review-multiselect.js`, `lib/external/build-review-submission.js`, `lib/dataverse/adapters/review-answer.js`, external-reviewer wiki, and the build plan | Replaced the stale “not started” claim with the verified state: implementation and production smoke complete; broader exposure and rollback rehearsals held. Routed through the domain hub and build plan instead of the oversized leaf. |
| Prompt legacy, peer-review Executor migration, spec recovery, manual-review rescue, and grantee waiver | Prompt/Executor and external-reviewer hubs, live service/adapters, canonical plans/specs, and closed-memory metadata | Removed shipped/resolved status lines from startup routing. Added the missing closed-work pointers for prompt legacy and spec recovery; existing hubs/specs carry the live contracts. |
| Intake, BILL API, and reviewer-institution redesign | Current queue plus intake and finance hubs | Removed direct parked-project leaves. Their parked/tabled status remains canonical in the queue or domain hub and should not be resurfaced as current work by startup memory. |
| Reviewer nomenclature and app sunset | `shared/config/appRegistry.js`, lifecycle strategy, memory body, and current route users | Corrected the leaf from `active` to `closed`, rewrote its recall rule as historical-only, and indexed it in closed work. Borrowed API namespaces remain live contracts. |
| Returning-machine setup | Leaf evidence and dev-environment hub | Moved the operational trigger into the dev hub, removed the direct startup route, and retained the detailed active lesson as supporting memory. |
| J27 document capture | `shared/config/workbenchProposalDocuments.js`, `lib/services/grant-reporting/classify-file.js`, `lib/services/reviewer-finder/load-proposal-service.js`, and current queue | Removed the shadow-Atlas startup route and added an explicit verified basis to the leaf. The typed Dataverse registry is still planning direction, not a built table. |
| Vercel plugin and private-repo CI notes | Dev-environment hub and workflow configuration | Removed separate startup lines; the dev hub remains the routing surface for tool enablement, CI, local build, and deploy concerns. |

## Verification

The required structural and semantic checks were run after reconciliation:

- `npm run check:memory-router`
- `npm run check:memory-router:self-test`
- `npm run check:memory-health`
- `npm run check:agent-wiki`
- `npm run check:agent-wiki:self-test`
- `npm run check:doc-symbol-refs`
- `npm run check:doc-symbol-refs:self-test`
- `npm run check:build-claim-freshness`
- `npm run check:build-claim-freshness:self-test`
- `npm run check:fact-consistency`
- `npm run check:fact-consistency:self-test`
- `npm run check:docs-catalog`

See the implementing commit for the captured gate output. The advisory
`check:memory-health` result after reconciliation was zero findings across 226
leaf-memory files.
