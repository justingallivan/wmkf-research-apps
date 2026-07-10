# Session 354 Prompt: policy-label UX, remediation decision, and campaign safety foundations

## Session 353 Summary

Architecture/review session. No product code, API, schema, or deployment behavior
changed. Three durable documentation packages were preserved on `main`; the stop
commit and push follow this handoff.

### What Was Completed

1. **Reviewer-finding holistic review package preserved (`2b03e2de`).** Added the
   independent review prompt/output, comparison, implementation plan, and ORCID-spine
   specification as cataloged git-tracked documents. This did not start the redesign;
   the dedicated-branch build remains parked pending explicit owner approval.

2. **Independent whack-a-mole review preserved (`6583e0d2`).** The code-grounded
   review returned **NEEDS REWORK**. `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md` now says
   not to execute its original sequence until the owner reconciles the competing
   recommendations: keep WS0 narrowly; reshape WS1–WS3; reject WS4/WS5; defer WS6;
   keep WS7 as posture.

3. **Campaign release and Dataverse test strategy adopted (`c5151b46`).** Added the
   campaign calendar, risk tiers, Dataverse test modes, external-user rehearsal,
   expand/migrate/contract posture, promotion, and rollback strategy. Reconciled the
   old direct-to-main memory with the new risk-tiered workflow.

4. **Capture-mode boundary corrected (`c5151b46`).** The reviewer rehearsal runbook
   no longer describes capture mode as a sandbox. [VERIFIED from current source]
   capture blocks Dynamics email/contact promotion/ORCID back-propagation, but render
   persists token state and a captured invitation send can stamp lifecycle fields.

5. **Instruction convention reconciled (stop commit follows).** `CLAUDE.md` now points
   to the campaign release strategy: Tier 0 may land on `main`; Tier 1–3 runtime work
   uses a branch and deliberate promotion because pushing `main` deploys production.

### Commits

- `2b03e2de` — docs(reviewer): preserve holistic review synthesis
- `6583e0d2` — docs: preserve independent whack-a-mole review
- `c5151b46` — docs: add campaign release and Dataverse test strategy
- Session 353 stop/handoff commit follows this file.

## Next Items

### Verified Open

1. **Fix the policy-version `label_conflict` UX without weakening immutability.**
   [VERIFIED via `lib/services/admin/policies-service.js:274-292` and
   `shared/components/admin/PoliciesSection.js:25-35`] Publishing changed content
   under an existing label correctly returns `label_conflict`, while the UI only says
   the label exists with different content. Add unique-label guidance or suggestion;
   do not mutate a published version in place. Verify all policy slots.

2. **Make session automation branch-aware.** [VERIFIED via
   `.claude/skills/start/SKILL.md:15` and `.claude/skills/stop/SKILL.md:73`] `/start`
   pulls `origin/main` and `/stop` hard-codes `git push origin main`. Reconcile both
   with the adopted risk tiers before relying on them from feature branches.

3. **Design the fail-closed Dataverse deployment-target/write interlock.** [PLANNED,
   not built] The governing matrix is
   `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` §6. Trace every write entry
   point before implementation; preview/local pointed at production Dataverse must
   deny writes by default, while approved rehearsals remain narrow and auditable.

### Owner Decision Needed

1. **Reconcile the whack-a-mole recommendations.** Choose whether to adopt, modify,
   or reject the changes named in
   `docs/audits/whack-a-mole-independent-review-codex-2026-07-09.md`. Do not execute
   `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md` as written before this decision.

2. **Green-light the reviewer holistic redesign experiment?**
   `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md` records a
   dedicated long-lived testing branch, phased P0–P4 build, and head-to-head comparison
   against `main`; it remains not started and parked pending explicit approval.

3. **Choose the staff manual-review rescue-tool location.** Admin/superuser surface
   versus Reviews tab. [VERIFIED] The retained routes, submission builder, and full
   `ReviewAuthoringForm` still exist; requirements live in
   `.claude-memory/project-staff-review-rescue-tool.md`.

4. **Scope reviewer closeout payability.** The owner-endorsed direction is an additive
   payability disposition at review closeout, not deletion of financial records.
   Evidence: `.claude-memory/project-reviewer-closeout-payability.md`.

5. **Choose the desired end state for `check:types`.** Evidence and fail-open limits:
   `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.

### Parked

1. Reviewer holistic redesign branch build — explicit owner go required.
2. Accepted-reviewer “no longer needed” stand-down flow — current
   `withdraw-sufficient` scope was previously limited to invited-pending; re-verify
   before design.
3. Review rendition formatting —
   `.claude-memory/project-review-output-formatting.md` remains active.
4. Campaign-settings prominence/defaults UX — owner-reported behavior needs source
   verification before scope; `.claude-memory/project-campaign-settings-ux-revisit.md`.
5. Project-wide prompt-cache-hit audit —
   `.claude-memory/project-cache-hit-rate-review.md` remains deferred.
6. Reviewer acknowledgment provenance parity — minor follow-up in
   `.claude-memory/project-reviewer-ack-provenance-parity-followup.md`.
7. Dependabot PR #53 — [VERIFIED 2026-07-09 via `gh`] still OPEN; six checks green;
   mergeability reported UNKNOWN. Merge remains a deliberate owner action.

### Verify Before Acting

1. **Whack-a-mole workstreams are recommendations, not an approved worklist.** The
   independent review disputes WS4/WS5/WS6 and reshapes WS1–WS3.
2. **`label_conflict` is partly working as designed.** Fix guidance/label selection,
   not the version immutability and consent/audit model.
3. **Sandbox reviewer readiness is stale evidence.** The last durable probe says the
   sandbox exists but lacked reviewer schema/policy seeds. Re-probe schema,
   permissions, policies, and email behavior before treating it as usable.
4. **Quota-PD email runtime preconditions remain unverified this session.** The path
   depends on Dynamics credentials, `NOTIFICATION_EMAIL_FROM`, and a synced sender.
   Confirm the first real quota email or run a specifically approved read-only
   configuration check; do not infer delivery from code alone.

### Do Not Reopen Without New Decision

1. **The two broad reviews are complete.** Do not dispatch another whack-a-mole or
   holistic reviewer review; resolve their recommendations instead.
2. **Campaign strategy is adopted, but its mechanical controls are not built.** Do
   not describe the Dataverse interlock, sandbox parity, deterministic rollout, or
   branch-aware session skills as current infrastructure.
3. **Capture mode is not a sandbox.** Use browser route mocks for side-effect-free
   rehearsal or approved throwaway records for live-API capture.
4. **Quota-PD-email and grantee waiver work remain shipped.** Do not rebuild or
   restore their superseded paths without new evidence/decision.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` | Adopted campaign-aware release/test/rollback direction |
| `docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md` | Concrete mocked, capture, and allowlisted live reviewer rehearsal |
| `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md` | Original proposal; execution paused for owner reconciliation |
| `docs/audits/whack-a-mole-independent-review-codex-2026-07-09.md` | Independent NEEDS REWORK verdict and replacement operating model |
| `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` | Parked reviewer-finding/identity redesign plan |
| `lib/services/admin/policies-service.js` | Immutable policy publish state machine and `label_conflict` outcome |
| `shared/components/admin/PoliciesSection.js` | Current policy status copy and label input UX |
| `.claude/skills/start/SKILL.md` / `.claude/skills/stop/SKILL.md` | Session automation that still assumes `main` |

## Testing

No product code changed, so product tests were not rerun. Documentation work passed:

```bash
npm run check:agent-invariants
npm run check:instruction-architecture
npm run check:docs-catalog
npm run check:fact-consistency && npm run check:fact-consistency:self-test
npm run check:memory-router && npm run check:memory-router:self-test
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:canonical-pointers && npm run check:canonical-pointers:self-test
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test
npm run check:build-claim-freshness && npm run check:build-claim-freshness:self-test
npm run check:memory-drift:no-write
```
