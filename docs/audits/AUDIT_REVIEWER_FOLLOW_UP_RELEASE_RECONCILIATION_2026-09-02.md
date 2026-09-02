---
title: "Reviewer Follow-up Production release documentation reconciliation"
domain: audits
kind: audit
status: historical
summary: Evidence-first sweep reconciling the 2026-09-02 Reviewer Follow-up Production release across current plans, Atlas, memory, queue, and session handoff.
canonical: false
cataloged: 2026-09-02
owner: product-engineering
related:
  - docs/REVIEWER_FOLLOW_UP_ORG_CYCLE_VISIBILITY_PLAN.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/atlas/dataverse-akoya-request.md
---

# Reviewer Follow-up Production Release Documentation Reconciliation

## Scope and mode

**Sweep mode A — changed fact.** The organization-wide Reviewer Follow-up cycle
projection and request-bound lead-PD/superuser mutation boundary moved from an
implementation branch and read-only Preview to reviewed, merged, authenticated
Production operation. This audit reconciles current guidance that still described
Preview verification or promotion as pending. Dated design and implementation
chronology remains historical.

## Authoritative evidence

- **Source:** runtime merge
  `acf40fb85a36ab2d481869c706a069abea52c087`; later documentation commits do
  not change this runtime evidence anchor.
- **Authorization contract:** request-bound Reviewer Follow-up mutations resolve
  the target request server-side and permit its lead PD or a superuser; authorized
  non-lead staff retain organization-wide reads.
- **Review and verification:** two independent Claude reviews returned APPROVE;
  17 focused suites / 241 tests, relevant gates, lint, types, and build passed for
  the merged candidate.
- **Deployment:** runtime deployment
  `dpl_7ToPKYtpXhyW3WmPmn1WiY9wz2iv` reached Ready in Production.
- **Authenticated Production read proof:** D26 My 10 → All 44, picker 44 active +
  184 set aside; J26 My 0 → All 5. No write action was exercised.
- **Rollback:** `dpl_3SJebjL3tPTdv89o5dVzR1dBS3Y2` at `39413e3d`.
- **Priority authority:** `docs/CURRENT_WORK_QUEUE.md` order 2 remains Final
  Writeup persona access proof and deliberate rollout.

## Restatement classification

| Surface | Classification before fix | Resolution |
|---|---|---|
| `SESSION_PROMPT.md` | STALE | Replaced the merge/Preview/promotion handoff with the actual Production result and the canonical next item. |
| `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | STALE | Replaced the branch-only status block with Production release and authenticated evidence. |
| `docs/atlas/dataverse-akoya-request.md` | STALE | Changed branch/deployment-pending cycle projection to Production-live. |
| `.claude-memory/project-reviewer-org-open-access-by-design.md` | STALE | Recorded the deployed narrow write exception while preserving T1/D4 org-open decisions. |
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | STALE | Added the Production checkpoint and corrected current picker status. |
| `docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md` | STALE current-routing note in a historical plan | Updated only the current-routing supersession note; preserved S261 chronology. |
| `docs/CURRENT_WORK_QUEUE.md` | SEMANTIC OMISSION | Added the completed release and retained Final Writeup personas as order 2. |
| `docs/REQUEST_WORKBENCH_SCOPING.md` | HISTORICAL | Preserved the dated open questions because the document explicitly routes readers to current sources. |
| `.claude-memory/project-vercel-cli-deploy-preview-auth.md` | HISTORICAL/AGREE | Preserved exact dated Preview callback and UAT evidence; it does not claim current release status. |
| `docs/REVIEWER_FOLLOW_UP_ORG_CYCLE_VISIBILITY_PLAN.md` | AGREE/HISTORICAL | Already records completion, Production evidence, deployment, and rollback. |

## Semantic reconciliation

The sweep preserves three distinct facts:

1. organization-wide access applies to the eligible Reviewer Follow-up read
   projection for authorized `reviewers` users;
2. request-bound Reviewer Follow-up mutations are lead-PD/superuser-only at the
   server boundary; and
3. the separate Final Writeup persona rollout remains disabled until
   representative Program Coordinator and Leadership Word access is proved.

The release does not reactivate automatic reviewer reminders, broaden SharePoint
permissions, infer personas from profile attributes, or authorize a write smoke.

## Verdict

**RECONCILED.** The post-edit contradiction and semantic searches found no
remaining current STALE hit. Fact consistency and self-test, document currency
and self-test, document-symbol references and self-test, docs catalog, Atlas
and self-test, memory drift, agent wiki and self-test, and tracked agent
invariants passed. Memory health
reported its pre-existing advisory-only routed-file findings and no stale-routed
memory. The ordinary agent-invariants command cannot validate the external
Claude-memory symlink inside a temporary git worktree; its tracked/CI form passed.
