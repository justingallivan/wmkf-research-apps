# Session 367 Prompt: Documentation ground-truth reconciliation

## Current objective

Bring the live documentation surface back to code-supported ground truth after a fresh semantic
inspection. The current branch is `codex/documentation-code-reconciliation`; this is Tier 0
documentation work and changes no runtime behavior or external data.

## Evidence base

- `docs/audits/semantic-documentation-inspection-2026-07-22.md` records the independent semantic
  findings that initiated this pass.
- Source, Atlas pages, canonical count generation, route matrices, and targeted tests/gates take
  precedence over prose plans.
- `/contract-reconcile` Mode B and `/sweep` govern this change: every repaired fact must agree across
  current docs, instructions, wiki routing, and the generated catalog.

## Reconciliation in this branch

1. **Grantee deliverables** — replace the obsolete UI-only waiver and flat request-field model with
   the live signed-version consent flow and split ownership between `akoya_request` and
   `wmkf_granteedeliverable`.
2. **System model** — identify Workbench as live, Reviewer Pool as planned, intake as parked,
   automated BILL onboarding as dormant, and Vercel as the only current Executor implementation.
3. **Reviewer docs** — describe Workbench direct Dynamics/M365 invitation as the primary flow,
   retain `.eml` generation only as legacy compatibility, and remove the dropped
   `wmkf_appresearcher` sidecar from current diagrams.
4. **Historical status** — mark the March 2026 security report, cancelled intake-pilot design, and
   BILL chunk-6 pre-implementation design as historical snapshots with current-authority pointers.
5. **Smaller drift** — route API counts through `CANONICAL_COUNTS`, correct the Dynamics email-helper
   source path, state the Dataverse interlock's unset=`off` behavior, and make page-email production
   enablement a dated external-state attestation.

## Previously stale reviewer-evaluation handoff

The F1/F2 manifest/validator hardening described by the prior Session 366 handoff was completed in
commit `89401759`, and `codex/m1-evaluation-foundation` has been merged. Do not treat its former
19-commit merge decision or F1/F2 items as open work. Broader reviewer-holistic production cutover
remains separately gated by the active implementation plan and owner decisions.

## Completion checks

- Run the relevant documentation, count, symbol-reference, wiki, Atlas, route, and instruction
  gates with each required self-test sequentially.
- Regenerate `docs/DOCS_CATALOG.md` and any code-derived canonical count artifact through their
  supported scripts; do not hand-edit generated files.
- Run `git diff --check`, inspect the final scope, and commit the coherent documentation change set.
- Any remaining dated audit/design records must be visibly historical rather than silently presented
  as current instructions.
