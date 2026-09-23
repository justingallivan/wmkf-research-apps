---
title: Concurrent Codex workstream closeout
domain: agent-harness
kind: plan
status: ready
summary: "Evidence-backed closeout plan for preserving the presentation-materials proof and Test Request preview as separate pushed branches, leaving external Preview state intact, and deferring all main integration to explicit owner decisions."
owner: product-engineering
related:
  - docs/plans/POST_RESEARCH_PRESENTATION_MATERIALS_PLAN_2026-09-21.md
  - docs/AGENT_COLLABORATION_PLAN.md
---

# Concurrent Codex workstream closeout

## Decision

Close the two Codex tasks as separate, preserved workstreams. Do not merge or cherry-pick one
branch into the other, and do not promote either branch to `main` without a new explicit owner
decision. Their product purposes are related only by concurrent timing: one is a disposable
presentation-media transport proof, while the other is a read-only Test Request preview.

This is the smallest safe consolidation because both branches forked from the same older main
baseline and both are currently eight commits behind `origin/main`. Their changed-file sets overlap
in four high-conflict surfaces:

- `docs/API_ROUTE_SECURITY_MATRIX.md`
- `docs/CANONICAL_COUNTS.md`
- `docs/SERVICE_AND_UTILITY_CATALOG.md`
- `lib/services/graph-service.js`

A combined branch would force integration choices before either product boundary is ready for
production. Preserve the branches and use this handoff as the cross-branch index.

The Test Request plans and Connor handoff at commit `b334d8a59` on
`origin/codex/test-request-preview-integration` are authoritative for that workstream. Older copies
of Test Request documents visible on `codex/feature-request` predate that handoff and are not
current cross-branch guidance; do not manually reconcile them by copying or cherry-picking around
the owning branch.

## Verified baseline

| Workstream | Git state | Runtime/external state | Completion boundary |
|---|---|---|---|
| Presentation materials | `codex/feature-request`; 14 commits ahead and 8 behind `origin/main` from merge base `0f2f22c469cb0b050a32abc2ef6f8d0a139f44d0`; implementation receipt at `0be2ffdb3`, placeholder-resume fix at `cdc7574e1` | Current-hardening Chrome proof passed on disposable deployment `dpl_2oyHRnNLwuXvuNPK3MLqcKnwNyop`; exact SharePoint item moved to the recycle bin; stable Preview alias restored afterward | Slice 0 remains open for Edge, macOS Safari, iPadOS Safari, reload/reselect resume, expiry recovery, and long-duration/2 GB throughput evidence. The proof harness is not production feature code. |
| Test Request preview | `codex/test-request-preview-integration`; clean and exactly equal to `origin/codex/test-request-preview-integration` at `b334d8a59`; 28 commits ahead and 8 behind `origin/main` from the same merge base | Stable alias `wmkfresearchapps-preview.vercel.app` currently points to Ready Preview deployment `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`; four branch-scoped Preview variable names remain present: `DYNAMICS_URL`, `SHAREPOINT_SITE_URL`, `DATAVERSE_DAL_ENFORCEMENT`, and `NEXTAUTH_URL` | Signed-in read-only sandbox preview only. Create/copy remains blocked by `ownerid`/`owneridtype`, unapproved execution file limits, missing Stage 1 isolation, and no document-bearing sandbox fixture. |

The main checkout was clean and equal to `origin/main` at `72351f91b` when this closeout began. No
branch merge, cherry-pick, main push, Production deployment, schema operation, Request creation,
document copy, or external-state cleanup was performed during consolidation.

## Contract reconciliation

| Workstream | Entry point | Persistence/source of truth | Consumers | Status |
|---|---|---|---|---|
| Presentation proof | Preview-only Meeting Tracker proof harness and external proof page | Encrypted browser permit in session storage; proof-prefixed `external_rate_limit` counters; temporary SharePoint DriveItem during a run; no durable feature row | Staff proof harness, external Watch/Download page, Graph/SharePoint media host, tests and durable plan | **PARTIAL.** Chrome transport is verified, including same-page pause/resume through a live Graph placeholder, finalize, playback, seek, byte/hash-identical download, and exact cleanup. Cross-browser/reload/expiry/throughput requirements remain open. |
| Test Request preview | Administration Test Requests Preview UI; `GET`/`POST /api/admin/test-requests/preview` | Read-only sandbox Dataverse request/account/metadata and shared akoyaGO SharePoint inventory/file bytes; no application write | Superuser preview UI, policy/file-plan compiler, tests, route matrix and Test Request plans | **PARTIAL.** The read-only surface is deployed and live-smoked. Stage 1 guards, execution ledger, create/copy executor, provisioning contract and document fixture do not exist or remain blocked. |

The Test Request route requires a superuser, exact request/query bodies and trusted DAL context.
The service rejects Production/unknown Dataverse targets and unregistered SharePoint sites before
source reads, re-resolves trusted values server-side, strips executable request/file plans, and
returns `executionEnabled: false`. The UI exposes only **Build read-only preview**, aborts stale
requests, and contains no create/copy control. Those source contracts agree with the branch handoff;
they do not close the missing operational stages.

## Closeout sequence

1. Preserve and push `codex/feature-request`; establish its upstream without changing `main`.
2. Leave `codex/test-request-preview-integration` at pushed head `b334d8a59`.
3. Leave the stable Preview alias, its Ready deployment and its four branch-scoped variables intact.
   Another session may rely on them, and the owner has not decided whether to retain the preview.
4. Record this two-branch handoff in `SESSION_PROMPT.md`; keep each feature's detailed evidence in
   its own branch plan.
5. Run the documentation, fact and instruction gates; commit and push the closeout documentation.
6. Verify both worktrees are clean and equal to their upstream branches. The Codex tasks may then be
   archived; the branches, worktrees and Preview resources remain deliberately retained.

## Owner decisions before any continuation

### Presentation materials

- Decide whether to complete the remaining Slice 0 browser/expiry/throughput matrix or park the
  proof and move directly to a production design revision.
- Before any `main` integration, remove the Preview-only harness or convert only reviewed pieces
  into the production architecture. Do not merge the disposable proof as the finished feature.
- A future live upload requires a newly approved disposable target and cleanup authority; the prior
  Request 1003222 run is complete and its item is already in the recycle bin.

### Test Request preview

- Decide whether the stable read-only Preview should remain available. Inspect alias/config state
  again immediately before any change or removal.
- Resolve the authoritative `ownerid`/`owneridtype` create contract, approve file count/per-file/
  total-byte/MIME limits, implement and verify Stage 1 isolation, and obtain a document-bearing
  sandbox fixture before create/copy work resumes.
- The earlier one-create authorization is spent. Another sandbox Request needs a new manifest and
  separate authorization. Production is not an allowed provisioning or copy experiment.

### Main integration

- Review and integrate each branch separately from a fresh `origin/main` baseline. Re-run the
  branch-specific tests and current full gate census after resolving overlaps.
- Treat the route matrix, canonical counts, service catalog and Graph facade as deliberate manual
  reconciliations, not “ours/theirs” conflict choices.
- `main` auto-deploys; every merge remains an explicit release decision with a current Preview and
  rollback plan.

## External Preview state retained

Read-only Vercel inspection on 2026-09-22 verified project
`justin-gallivans-projects/wmkf_research_apps` (`prj_56SJKzNer1aV38kKVoP8tl3X0lf3`). The stable
Preview alias points to immutable Ready deployment
`wmkfresearchapps-cuuzzf2jk-justin-gallivans-projects.vercel.app` /
`dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`. The Test Request branch's four named scoped variables are
present. Values were not copied into this record. No Vercel state was changed during closeout.

## Archive readiness

It is safe to archive both Codex **tasks** after the final closeout push and upstream comparison.
Archiving the tasks is not authorization to delete branches, worktrees, deployments, aliases,
configuration, the shared proof folder, or recycle-bin evidence. Reopen from the exact branch and
plan named above when an owner decision supplies the next bounded scope.

No `DEVELOPMENT_LOG.md` entry is required: neither workstream shipped a Production capability,
production cutover, new live architecture, incident outcome, or removal of a deprecated feature.
