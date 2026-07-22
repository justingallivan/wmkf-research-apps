# Session 368 Prompt: Execute the current work queue in order

## Current objective

Execute the owner-approved sequence in `docs/CURRENT_WORK_QUEUE.md` without turning optional or
parked plans into implied commitments. The current branch is
`codex/documentation-code-reconciliation`; `main` auto-deploys, so runtime stages remain isolated
from the documentation stage and require their named promotion decisions.

## Ordered stages

1. **Documentation ground truth — in progress.** Publish the reconciled documentation branch,
   establish `docs/CURRENT_WORK_QUEUE.md` as the priority authority, and route strategy/catalog
   readers to it. Documentation status describes document lifecycle, not backlog priority.
2. **Dataverse interlock — next.** Inspect `warn` observations from normal staff use and cron
   execution. Do not flip `DATAVERSE_TARGET_INTERLOCK` to `on` without the explicit decision in the
   plan.
3. **Reviewer operational safety tools.** Build the full structured staff review-entry rescue
   surface first, then the closeout payability/did-not-serve disposition. Use `/contract-reconcile`
   for both; keep pre-accept reset and post-accept financial annotation separate.
4. **Campaign evidence window.** Keep the legacy reviewer resolver authoritative. Prepare durable,
   bounded observation of W2 disagreements, identity/email outcomes, staff corrections, and
   downstream invitation/review results. No automatic cutover.
5. **Optional reviewer UX triage.** Select only work supported by observed staff friction; do not
   automatically build the entire nice-to-haves plan.

## Controlling evidence

- Current priority: `docs/CURRENT_WORK_QUEUE.md`.
- Current architecture/state: source, `docs/APPLICATION_STATE_ATLAS.md`, `docs/SYSTEM_MODEL.md`,
  live probes, and tests.
- Dataverse interlock: `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`.
- Reviewer identity/finding gates: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` and
  `docs/REVIEWER_IDENTITY_CONTACT_PLAN.md`.
- Reviewer operational asks: `.claude-memory/project-staff-review-rescue-tool.md` and
  `.claude-memory/project-reviewer-closeout-payability.md`.

## Guardrails

- Run `/sweep` for priority/status fact changes and `/contract-reconcile` for runtime or durable
  reviewer changes.
- Preserve legacy-authoritative reviewer behavior through the campaign evidence window.
- Do not resurface intake, BILL automation, whack-a-mole workstreams, reviewer institution linking,
  or destructive cleanup without their named owner/dependency gates.
- Commit each independently working stage. A documentation merge does not authorize a runtime
  production promotion or Dataverse schema execution.
