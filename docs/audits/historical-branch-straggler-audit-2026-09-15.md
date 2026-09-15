---
title: Historical Branch Straggler Audit — 2026-09-15
domain: agent-harness
kind: audit
status: current
summary: "Git-ref and worktree audit separating merged recent work from historical branch pointers that are superseded, archival, abandoned, or deliberately deferred."
canonical: false
cataloged: 2026-09-15
last_verified: 2026-09-15
owner: product-engineering
related:
  - docs/AGENT_COLLABORATION_PLAN.md
  - docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md
  - docs/plans/CODEX_HANDOVER_TO_CLAUDE_2026-09-08.md
---

# Historical Branch Straggler Audit — 2026-09-15

## Scope and claims

**Sweep mode:** Mode B, bounded repository-ref audit.

**Change surface:** local branches, `origin/*` refs, linked worktrees, and GitHub pull-request
dispositions. Application runtime, live Dataverse/Postgres/Blob state, and Vercel deployment
state are out of scope.

**Claims tested:**

1. recent session work is reachable from fetched `origin/main`;
2. linked worktrees do not contain uncommitted tracked or untracked work;
3. branches reported by ancestry as unmerged are separated into patch-equivalent,
   integrated/superseded, archival, abandoned, and deliberately deferred work; and
4. cleanup does not remove a branch or directory held by a live process.

**Contract surface:** the entry points are Git/GitHub inspection and cleanup commands;
persistence is the local Git object/ref database plus GitHub refs; consumers are worktrees,
agent sessions, pull requests, and future branch recovery. Request/response, database,
background-work, and UI contracts are `N/A`.

## Authoritative census

The audit ran after `git fetch --all --prune` on 2026-09-15 PT.

| Claim | Evidence | Status |
|---|---|---|
| Recent local work is merged | 29 local branch tips dated 2026-09-10 or later; `git merge-base --is-ancestor <tip> origin/main` returned success for all 29 | **VERIFIED** |
| Recent GitHub work is merged | `gh pr list --state merged --search 'merged:>=2026-09-10'` returned 85 PRs | **VERIFIED** |
| No open human PR remains | GitHub returned five open PRs, all Dependabot branches | **VERIFIED** |
| Local branch census | 259 local branches: 216 ancestry-contained in `origin/main`; 43 not ancestry-contained | **VERIFIED** |
| Conservative patch census | Of the 43 non-ancestor branches, `git cherry origin/main <branch>` found 12 with zero `+` patches and 31 with one or more `+` patches | **VERIFIED** |
| Worktree tracked/untracked state | Every linked worktree returned an empty porcelain status before cleanup | **VERIFIED** |
| Initial worktree process ownership | Before cleanup, `lsof -d cwd` found a Claude/Codex toolchain in `WMKF_Apps-codex-tracker` and shell processes in `WMKF_Apps-followups` and `WMKF_Apps-roster` | **VERIFIED** |

`git cherry` is intentionally treated as conservative evidence. A `+` patch proves only that
Git cannot find the same patch-id on `origin/main`; it does not prove that the current product
lacks the behavior. Squash merges, reimplementation, and later superseding work all produce
false-positive “stragglers.”

## The 31 patch-unique historical branches

Disposition vocabulary:

- **INTEGRATED/SUPERSEDED** — do not merge; current `main` or a later merged PR is the source
  of truth. The local ref is a cleanup candidate.
- **ABANDONED/CLOSED** — work was explicitly closed or abandoned; do not revive without a new
  owner decision.
- **ARCHIVE EVIDENCE** — documentary/review evidence not fully present on `main`; do not merge
  into current guidance, and preserve the ref or a private archive before deletion.
- **DEFERRED/UNRESOLVED** — contains a real, intentionally unmerged or undecided change; protect
  the branch until its named decision or prerequisite is resolved.

| Branch | Evidence and disposition | Status |
|---|---|---|
| `claude/adversarial-applicant-identity-gate` | Three document-only review commits; the added adversarial audit is absent from `main`. Preserve as historical evidence, not current implementation. | **ARCHIVE EVIDENCE** |
| `claude/adversarial-applicant-identity-gate-fix-review` | Six document-only review passes; the final adversarial audit is absent from `main`. | **ARCHIVE EVIDENCE** |
| `claude/adversarial-page-email-ownership-review` | Two document-only commits; audit and handoff files are absent from `main`. | **ARCHIVE EVIDENCE** |
| `claude/adversarial-reviewer-identity-architecture` | Three historical prompt/handoff/audit files absent from `main`. | **ARCHIVE EVIDENCE** |
| `claude/adversarial-reviewer-identity-final-coherence` | Three historical prompt/handoff/audit files absent from `main`. | **ARCHIVE EVIDENCE** |
| `claude/adversarial-serpapi-resolver` | One prompt-only remainder; `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md` says the later audit content is already on `main` and the prompt requires archive/integrate disposition. | **ARCHIVE EVIDENCE** |
| `claude/final-writeup-persona-smoke` | Six documentation commits. Current persona plans/queue contain the resulting access-proof and smoke outcomes, while the branch-only runbook is absent. | **ARCHIVE EVIDENCE** |
| `claude/reviewer-identity-shadow-logger` | All six files added by the branch exist on current `main`; later reviewer-identity work owns the live implementation. | **INTEGRATED/SUPERSEDED** |
| `codex/UI-audit` | PR #192 closed unmerged. The authoritative 2026-09-08 handoff says PR #193 rebuilt and merged the wanted fix from clean `main`; wholesale promotion is forbidden. | **INTEGRATED/SUPERSEDED** |
| `codex/admin-model-clarity` | One unmerged UI/test commit. Current `main` still lacks the proposed “App Model Defaults” labels and its focused test; no PR or durable disposition was found. Product decision required. | **DEFERRED/UNRESOLVED** |
| `codex/applicant-additional-materials` | The plan and Codex brief now exist on `main`; subsequent applicant-materials PRs implemented the current workflow. The only added path absent from `main` is an ignored/output PPTX copy. | **INTEGRATED/SUPERSEDED** |
| `codex/c0-4-action-policy-foundation` | PR #62 was closed unmerged on 2026-09-10. The 2026-09-08 handoff records it as inert, old-base scaffolding with no release approval. | **ABANDONED/CLOSED** |
| `codex/compact-ror-index-experiment` | Exact branch head was merged through PR #114; all 26 branch-added paths exist on `main`. Patch-id divergence is squash/history noise. | **INTEGRATED/SUPERSEDED** |
| `codex/cycle-dossier-pilot-design` | The branch-added design exists on `main`; the later dossier implementation and follow-up PR sequence supersede this design-only ref. | **INTEGRATED/SUPERSEDED** |
| `codex/dependabot-security-rollup` | Exact branch head merged through PR #93; all five added paths exist on `main`. | **INTEGRATED/SUPERSEDED** |
| `codex/final-writeup-personas-enable` | One branch-only request-review-receipt probe script. Current durable docs contain the resulting persona/access proof, but no explicit disposition for the script was found. | **DEFERRED/UNRESOLVED** |
| `codex/hotfix-valid-v2-selection` | The same change subject exists in `origin/main` history and current reviewer-find code/tests have moved beyond the old branch. | **INTEGRATED/SUPERSEDED** |
| `codex/institution-resolution-evaluation-plan` | Old nested `lib/services/institution-resolution/*` experiment and offline-eval scaffolding. Current main uses flat `lib/services/ror-institution-*`; the 2026-09-14 ROR brief explicitly treats the old PR #116 lineage as superseded. | **INTEGRATED/SUPERSEDED** |
| `codex/institution-source-plan` | One planning document absent from `main`; later main commits implemented applicant-institution display and identity work. Preserve only as historical planning evidence. | **ARCHIVE EVIDENCE** |
| `codex/local-main-preserved-20260728` | Three old main-preservation/documentation commits duplicated across later review-synthesis lineages; current main contains newer reconciliation. | **INTEGRATED/SUPERSEDED** |
| `codex/q9-app-access-stage4` | Real Stage 4 adapter migration. Current `.claude-memory/project-app-access-control.md` says Q9 is not complete and `dataverse-app-access-service.js` still uses raw transport. This branch must not be deleted or merged without the Stage 4 contract/release work. | **DEFERRED/UNRESOLVED** |
| `codex/review-synthesis-automatic-fix` | Exact head merged through PR #98; its added file exists on `main`. | **INTEGRATED/SUPERSEDED** |
| `codex/review-synthesis-lifecycle` | PR #96 merged the pushed lifecycle head; the local-only tail is covered by later PR #98/current implementation. All 13 added paths exist on `main`. | **INTEGRATED/SUPERSEDED** |
| `codex/reviewer-analysis-sonnet-refusal-fallback` | Real behavior change: retry a formal primary-model refusal on the fallback model. Current `main` explicitly tests that formal refusals fail closed without retry/fallback. No PR or owner decision was found, so this is a policy choice, not cleanup. | **DEFERRED/UNRESOLVED** |
| `codex/reviewer-closeout-eligibility` | Old combined implementation branch. Later current-main commits `2631c914` and `75b8ffab` built and recorded the reviewer-closeout workflow; branch-only obsolete migration/test paths should not be promoted. | **INTEGRATED/SUPERSEDED** |
| `codex/reviewer-ui-surfacing` | The authoritative handoff records the original changes as stale/conflicting; subsequent clean-main PRs #207–#211 landed the surviving cycle/request-search behavior. | **INTEGRATED/SUPERSEDED** |
| `codex/ror-api-decision-benchmark` | Exact branch head merged through PR #115; all 14 added paths exist on `main`. | **INTEGRATED/SUPERSEDED** |
| `codex/ror-api-production-shadow` | PR #116 closed as superseded. Current ROR brief says commit `444bd781` landed the production core under the current flat paths; only an obsolete benchmark-wrapper dedupe remains. | **INTEGRATED/SUPERSEDED** |
| `codex/sharepoint-storage-policy-questions` | Four documentation/evidence commits; the memory/output artifacts are absent from `main`, with no current implementation contract to merge. | **ARCHIVE EVIDENCE** |
| `feature/reviewer-cron-reminders-ledger` | Current work queue explicitly marks commits `7c29fac7..059e51f9` owner-parked until the current reviewer cycle ends. This is wanted work with a release prerequisite. | **DEFERRED/UNRESOLVED** |
| `reviewer-find-outcome-contract` | `DEVELOPMENT_LOG.md` and the incident report explicitly call the forward-fix branch abandoned. | **ABANDONED/CLOSED** |

### Disposition totals

| Classification | Count |
|---|---:|
| Integrated/superseded | 15 |
| Abandoned/closed | 2 |
| Archive evidence | 9 |
| Deferred/unresolved | 5 |
| **Total** | **31** |

## Protected work requiring a decision

The five protected branches are not cleanup candidates:

1. `codex/q9-app-access-stage4` — planned DAL migration; current contract says incomplete.
2. `feature/reviewer-cron-reminders-ledger` — owner-parked until the reviewer cycle ends.
3. `codex/reviewer-analysis-sonnet-refusal-fallback` — unresolved fail-closed versus fallback policy.
4. `codex/admin-model-clarity` — small, still-absent admin labeling/test improvement.
5. `codex/final-writeup-personas-enable` — branch-only operational probe whose results are documented but whose script disposition is undecided.

## Cleanup receipt and blockers

Completed on 2026-09-15:

- removed clean, inactive worktrees `WMKF_Apps-consultant`, `WMKF_Apps-meeting-tracker`, and
  `WMKF_Apps-codex`;
- copied all 68 files (5.1 MB) from `WMKF_Apps-codex/outputs/` into ignored local archive
  `outputs/worktree-archive/WMKF_Apps-codex-2026-09-15/`; an `rsync -nrc --delete` comparison
  reported no content differences (one preserved `node_modules` symlink was skipped by the
  verifier as a non-regular file);
- detached `WMKF_Apps-followups` from stale local `main`; and
- switched the primary checkout to `main` and fast-forwarded it from `5b25c006` to fetched
  `origin/main` `d83c8a9e`; and
- after exact owner approval and a fresh fetch/revalidation, deleted all 214 eligible local
  ancestry-merged non-`main` branch refs. The post-delete census is 45 local branches: current
  `main`, retained `claude/explore-2026-09-14`, and the 43 conservative non-ancestor branches
  (31 patch-unique plus 12 patch-equivalent-only); and
- after the owner removed the final three stale directories, verified that all three paths were
  absent and no process retained them as its current working directory, then pruned their stale
  Git worktree registry entries. `git worktree list --porcelain` now reports only the primary
  checkout.

Not removed:

- the `claude/explore-2026-09-14` branch. Its former worktree is gone and its commits are
  reachable from `origin/main`, but branch-ref deletion was not included in the owner's exact
  approval.

Remote branch deletion, force-pushes, history rewrites, open-PR changes, the 31 branches in the
matrix, and the 12 patch-equivalent-only non-ancestor branches were not authorized by this
cleanup and were not changed.

## Contract-reconciliation audit

| Audit | Result |
|---|---|
| Whole-flow | Git ref → worktree/process consumer → cleanup consequence traced; no application flow applies. |
| Partial success | Cleanup reports removed versus retained worktrees explicitly; no aggregate “success” hides retained directories. |
| Async/stale state | Fresh fetch preceded reachability checks; process ownership was re-read before mutation. |
| Helper extraction | `N/A` — no source helper changed. |
| Durable surface | This tracked audit is the receipt; no schema, route, registry count, or runtime catalog changed. |
| Documentation reconciliation | Newer authoritative sources override the dated 2026-09-08 handoff where PR state changed; dated history remains historical. |
| Symbol/consumer fan-out | `N/A` — no runtime symbol changed. |

## Falsification and verdict

Disconfirming checks included branch ancestry, patch equivalence, exact added-path presence on
`origin/main`, GitHub PR state/head OIDs, current durable-plan status, per-worktree porcelain
status, and live current-working-directory ownership. These checks falsified the raw inference
that all 31 `git cherry` `+` branches represent missing product work.

**Verdict:** recent-session integration is **VERIFIED**. The owner-approved ancestry-merged
local branch cleanup is **COMPLETE**: all 214 eligible refs were deleted after revalidation.
Historical non-ancestor disposition remains **PARTIAL**: 26 branches are classified as
non-release lineages, nine of those retain historical evidence, and five contain protected
deferred/undecided work. Worktree cleanup is **COMPLETE**: only the primary checkout remains
registered.
