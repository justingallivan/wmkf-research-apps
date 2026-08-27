---
title: Public Git History Remediation Plan
domain: security-privacy
kind: plan
status: active
summary: "Owner-gated plan for removing the audited personal and confidential data from public Git history without changing the approved current main tree."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-28
owner: product-engineering
related:
  - docs/audits/public-repository-pii-history-audit-2026-07-27.md
  - docs/audits/local-operational-data-retention-audit-2026-07-27.md
  - docs/CI_GATES_REFERENCE.md
  - docs/CREDENTIALS_RUNBOOK.md
---

# Public Git History Remediation Plan

## Status and authorization boundary

**Status: current-tree disposition and owner decisions pending; no history
rewrite or external deletion is authorized by this plan.**

The initially audited current-tree surfaces and ignored local source scope were
remediated. A later semantic review found a tracked, non-production
`modules/expertise_matching` reference/demo that duplicates the protected
38-person production roster and retains person-linked cycle assignment/usage
findings. Its public-tree disposition is unresolved. Earlier public revisions
also retain personal and confidential operational data. This plan covers the
current-tree prerequisite, a targeted Git history rewrite, GitHub reference
cleanup, local-clone invalidation, and post-rewrite prevention.

The destructive boundary includes force-pushing rewritten refs, deleting
branches or Actions artifacts, closing pull requests, changing repository
visibility, invalidating clones, and asking GitHub Support to remove pull
request refs or cached views. Each requires explicit owner approval.

## Contract surface

| Contract hop | Surface |
|---|---|
| Entry points | `git-filter-repo`, Git push, GitHub refs/API, GitHub Support |
| Persistence | Local and GitHub Git object databases, branches, tags, PR refs, Actions artifacts, forks/clones/caches |
| Consumers | Vercel deployments, GitHub pull requests and diffs, local worktrees, collaborators, automation, future clones |
| Current-tree invariant | The final owner-approved, privacy-safe `main` tree must remain byte-identical during the history rewrite |
| Prior finding | `docs/audits/public-repository-pii-history-audit-2026-07-27.md` |

Application request/response, Dataverse, Postgres, and Blob flows are `N/A`.
This is repository-history and external-reference maintenance.

## Verified live topology

Read-only preflight on 2026-07-27 found:

| Surface | Verified state |
|---|---:|
| Repository visibility | Public |
| Default branch | `main` |
| Direct collaborators | 1, the repository owner |
| Forks | 0 |
| Releases | 0 |
| Branch-protection rules | 0 |
| Repository rulesets | 0 |
| Remote branch refs | 68 |
| Remote tag refs | 1 lightweight tag |
| Pull-request head refs | 91 |
| Pull-request merge refs | 9 |
| Open pull requests | 9 |
| Actions artifacts | 1,942 total: 1,235 active, 707 expired |
| Local linked worktrees | 4 |
| Local worktrees with untracked changes | 2 |

The open pull requests are eight same-repository dependency updates and one
older feature PR. The repository has no direct collaborator other than the
owner, but old local worktrees can still reintroduce rewritten history if they
push or merge after cleanup.

**Current-delta note (2026-07-28):** the table and branch classification above
remain the dated preflight baseline, not a current execution census. PRs
#83–#91 (excluding nonexistent #88) were closed as superseded, security rollup
#93 merged, and Dependabot then opened routine update PR #94. Read-only
re-enumeration found two open PRs (#62 and #94). Every ref, PR, worktree, and
artifact count still requires a fresh freeze-time probe.

The active retention branch is diverged from fetched public `main`. It contains
the completed local-retention work plus this remediation planning and must be
deliberately integrated or preserved before the rewrite; exact ahead/behind
counts must be re-read at the freeze rather than treated as durable policy.

### Remote branch disposition preflight

Patch-equivalence and ancestry analysis classified the 67 non-`main` remote
branches:

| Classification | Count | Default handling |
|---|---:|---|
| Already ancestry-merged into `main` | 51 | Private backup, then public deletion candidate |
| Patch-equivalent to `main` | 2 | Private backup, then public deletion candidate |
| Open-PR branch | 9 | Close/reconcile PR first |
| Unintegrated patches without an open PR | 5 | Explicit review below |

The five unintegrated branches are:

| Branch | Verified delta | Required decision |
|---|---|---|
| `codex/claude-bug-fixes` | Eleven pushed reviewer-email commits; the original worktree is tracked-clean with two known untracked handoff artifacts | Preserve the original branch until the isolated cleanup branch is integrated; include its excess staff/operational-identity documentation and test revisions in the final rewrite scope |
| `claude/adversarial-serpapi-resolver` | One patch-unique review-prompt commit; later audit content already exists on `main` | Review the remaining prompt-only value, then integrate or archive |
| `feat/workbench-manual-add-dedup` | One patch-unique code/test commit touching the manual reviewer dedup flow | Semantic review against current code before integrate/archive decision |
| `add-claude-github-actions-1756252797067` | Legacy 2025 lineage with 59 patch-unique commits | Preserve in private bundle; archive-only candidate, never merge automatically |
| `New-Branch` | Legacy 2025 root lineage with 14 patch-unique commits | Preserve in private bundle; archive-only candidate, never merge automatically |

This classification does not authorize branch deletion. Squash merges and
later evolution can make patch comparison conservative; the two current-code
review candidates stay protected until explicitly classified.

## Targeted rewrite dry run

A disposable mirror included all public branches and tags plus GitHub pull
request head and merge refs. The dry run used the official
`git-filter-repo` 2.47.0 sensitive-data-removal workflow.

This simulation predates discovery of the tracked
`modules/expertise_matching` roster duplicate and the later pushed
reviewer-email documentation/test revisions containing excess staff and
alert-sender operational metadata. It validates the rewrite mechanics, PR-ref blast radius,
and parity checks, but it is no longer a scope-complete removal specification.
Its counts are retained as a planning baseline only.

The privacy-safe exact specification:

- scoped 65 audited current/history paths;
- selected 694 non-current historical blob IDs for removal;
- preserved every blob present in current public `main`;
- replaced three history-only contact values in commit-message bodies; and
- retained raw paths, values, and row-level receipts only in private temporary
  files.

Results:

| Verification | Result |
|---|---:|
| Rewritten commits | 3,385 of 3,400 |
| Changed refs | 169 |
| Changed branch refs | 68 |
| Changed tag refs | 1 |
| Changed PR head refs | 91 |
| Changed PR merge refs | 9 |
| Selected historical blobs still reachable | 0 |
| Selected commit-message contacts still present | 0 |
| Current `main` tree changes | 0 |
| Git object-integrity failures | 0 |

The earliest affected history includes a signed root commit. Because
`git-filter-repo` removes invalidated commit signatures, almost the complete
commit graph changes even though the final tree remains identical. All 91 pull
request head refs are affected. GitHub marks PR refs read-only, so a force-push
cannot remove those references by itself.

These counts are a planning baseline, not the execution receipt. The final
specification must add every approved current and historical
`modules/expertise_matching` removal/redaction target and the bounded
reviewer-email documentation revisions identified by the privacy audit, then be
regenerated from a fresh mirror after all approved work is integrated and the
repository is frozen.

**Added to the pending removal scope 2026-08-27 (S464):**

- `outputs/phantom-copi-incident-2026-08-12.md` — tracked and public from
  2026-08-12 (`f9defa6d`) through 2026-08-27 (`7851e913`); names real
  people with personal email addresses (the phantom co-PI incident's
  duplicate-contact table). Untracked from the current tree 2026-08-27
  (`git rm --cached`; the file remains local-only under the gitignored
  `outputs/`). Its historical blobs across those revisions must join the
  removal set when the final specification is regenerated.
- `outputs/reviewer-workflow-stabilization-fable-assessment.md` — owner
  decided 2026-08-27: the one real personal email address was **redacted in
  place** (the file stays tracked; the reference graph from the memory
  router and `docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md` is intact).
  Its pre-redaction revisions join the historical removal scope.

## Options

### A. Targeted rewrite — recommended

Remove the audited historical blobs and commit-message values while preserving
the complete, approved privacy-safe tree and as much commit structure as
possible. Commit hashes, signatures, PR diffs, and downstream references still
change.

This is the smallest remediation that closes the audited public-history class.
It remains dependent on GitHub Support for PR refs and cached views and on
recloning or carefully cleaning every old local clone.

### B. Clean-root public reset

Replace public history with a new root commit containing only the approved
current tree. This is easier to reason about but discards all public commit
history, blame, tags, and branch topology. PR refs and caches still require
GitHub-side cleanup. Use only if the owner explicitly prefers a minimal public
history over preserving sanitized history.

### C. Immediate private containment

Change the repository to private before completing either rewrite. This limits
new casual access but does not remove existing clones, cached views, or prior
copies. It may affect public integrations and does not reconcile the audit by
itself.

## Execution invariants

1. **Freeze before filtering.** No pushes, merges, Dependabot updates, or agent
   work may continue after the final mirror snapshot.
2. **Preserve all wanted work first.** Integrate or privately preserve all
   retention work and every wanted change from the linked worktrees.
3. **Private rollback copy.** Create a complete pre-rewrite mirror bundle in
   the established owner-only organizational archive, mode `0600`, with a
   privacy-safe tracked aggregate receipt.
4. **Exact current-tree parity.** The rewritten `main^{tree}` must equal the
   frozen, owner-approved privacy-safe `main^{tree}`.
5. **Exact historical removal.** Every selected blob and message value must
   have zero reachable refs in the rewritten mirror.
6. **All refs accounted for.** Every branch, tag, PR head, and PR merge ref must
   be classified as rewritten, deleted, GitHub-Support-owned, or intentionally
   retained.
7. **No old-clone merges.** Old worktrees must be archived or removed and
   replaced with fresh clones; later work must rebase/cherry-pick sanitized
   patches, never merge old history.
8. **Deployment verification.** A rewritten `main` push can trigger production
   deployment despite identical content; verify the resulting Vercel
   deployment before reopening normal work.

## Recommended sequence

### Phase 1 — reconcile active work

1. Finish, commit, or privately preserve the two dirty linked worktrees.
2. Decide the current-tree disposition of `modules/expertise_matching`:
   preserve any required identifiable source in the established owner-only
   archive, then remove or sanitize the public roster, embedded duplicate, and
   person-linked cycle report while retaining an aggregate design/findings
   record. Do not alter the protected production roster or its app/API.
3. Reconcile the retention branch with current public `main`.
4. Integrate every wanted branch before the freeze.
5. Re-enumerate and close or reconcile every freeze-time open PR. The original
   nine-PR count is a dated baseline; as of 2026-07-28 the open set was #62 and
   routine dependency PR #94. Dependency PRs may be regenerated after cleanup.
6. Decide whether to retain rewritten remote feature branches or delete them
   after private backup. Pruning non-`main` branches reduces recontamination
   and unnecessary Vercel preview activity.

### Phase 2 — freeze and private backup

1. Announce a push freeze.
2. Fetch all branches, tags, and PR refs into a fresh mirror.
3. Record the exact ref/object census and frozen `main` tree.
4. Create and verify the owner-only rollback bundle.
5. Inventory Actions artifacts and retain only any owner-required private
   evidence before deletion.

### Phase 3 — final targeted dry run

1. Regenerate the private exact path/blob/message specification, including the
   approved `modules/expertise_matching` current-tree disposition and every
   earlier revision of its identifiable roster/assignment content, plus the
   bounded reviewer-email documentation/test revisions containing excess staff
   and alert-sender operational metadata.
2. Run `git-filter-repo --sensitive-data-removal` in a disposable mirror.
3. Verify current-tree parity, selected-object absence, message redaction,
   ref accounting, object integrity, and current secret/privacy gates.
4. Record the final first-changed commits, affected PR count, and any orphaned
   LFS objects. The current mirror has no observed LFS use.

### Phase 4 — destructive promotion

1. Force-push only the explicitly approved rewritten branch/tag set.
2. Verify fresh anonymous-clone reachability and current-tree parity.
3. Delete approved Actions artifacts and obsolete remote branches.
4. Submit a GitHub Support request with the repository name, final affected-PR
   count, first-changed commits, and LFS result; request PR-ref dereferencing,
   server garbage collection, and cached-view removal.
5. Confirm whether GitHub classifies the retained contact, payment-context,
   proposal, and access-topology data as eligible sensitive-data removal.

### Phase 5 — clone and deployment recovery

1. Archive or remove every pre-rewrite local worktree.
2. Reclone the repository and recreate only needed branches from sanitized
   commits or patches.
3. Verify `main`, CI, Vercel production, and required preview workflows.
4. Reopen normal pushes only after the old refs cannot be reintroduced.

### Phase 6 — prevention

Add a privacy gate distinct from secret scanning. It should enforce reserved
domains in tests by default, reject person-specific contacts without an
explicit public exception, flag person-level exports/payment/access rosters,
scan hidden tracked backup surfaces, and keep raw values out of tracked audit
receipts. Gate design must be based on synthetic fixtures, not a tracked list
or reversible hash set of real contacts.

## GitHub Support request template

Complete this only after the final frozen rewrite and force-push:

```text
Subject: Sensitive-data history cleanup for a public repository

Repository: justingallivan/wmkf-research-apps
Affected pull-request head refs: <FINAL_COUNT>
First changed commit(s) reported by git-filter-repo:
- <FINAL_FIRST_CHANGED_COMMIT>
- <FINAL_ADDITIONAL_ROOT_IF_ANY>
Orphaned LFS objects: <NONE or attach the generated orphan list>
Forks referencing the old history after cleanup: <FINAL_VERIFIED_COUNT>

The repository previously retained person-level contact data, reviewer/payment
context, confidential proposal context, access-topology mappings, and related
operational identifiers in reachable public revisions. No probable live
credential was identified. The current tree was remediated before the history
rewrite.

We used git-filter-repo's sensitive-data-removal workflow, force-pushed every
approved writable ref, verified that the selected objects and message values
are no longer reachable from those refs, and coordinated replacement of old
local clones.

Please:
1. dereference or delete the affected pull-request refs;
2. run server-side garbage collection for the removed objects; and
3. remove cached views that retain the old revisions.
```

GitHub Support eligibility is still `UNKNOWN`: GitHub states that Support
removal is limited to data it classifies as sensitive and may decline when
risk can be mitigated another way. The final request must describe the actual
data classes and verification without copying raw values.

## Required owner decisions

Before Phase 4, record explicit decisions for:

1. whether to privately archive and remove the retired expertise-matching
   duplicate or retain a sanitized public design/findings record, and the exact
   files covered;
2. targeted rewrite versus clean-root reset;
3. whether to make the repository private during remediation;
4. which, if any, non-`main` remote branches and the lightweight backup tag
   should survive in rewritten form;
5. approval to close every freeze-time open PR and delete the freshly
   re-enumerated Actions-artifact set (the original 9 / 1,942 counts are dated
   baselines);
6. approval to invalidate and replace every pre-rewrite local worktree;
7. approval to force-push the frozen rewritten refs and accept a production
   redeployment; and
8. whether historically exposed payment-network identifiers require separate
   notification or replacement.

Until those decisions are recorded and Phases 1–3 are repeated against the
frozen repository, the public-history audit remains `CLAIM NOT RECONCILED`.
