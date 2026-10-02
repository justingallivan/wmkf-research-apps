# Session 563 Prompt: choose the next work item; preserve the active Factory lane

## Session 562 Summary — 2026-10-01 PT (Codex refactor lane)

The reviewer duplicate-create-conflict cleanup is complete. [VERIFIED via GitHub PR #397] Owner-authorized squash merge `2cd1987dac6a7e35b0fe87a4c7df2d9ecbfbd7b5` landed on main after all CI checks passed. [OWNER CONFIRMED] Justin reported PR #397 in production. [VERIFIED via GitHub deployment status] Production deployment `6798624722` for that exact commit is successful. This is deployment evidence, not an independent functional production smoke test.

### What Was Completed

1. **Reviewer conflict helper — PR #397.** A private `isSuggestionCreateConflict` now holds the exact shared expression used by `ensureApplicantRecommended` and `ensureStaffManualCandidate`. Recovery blocks, general-upsert classification, potential-reviewer classification, and PATCH retry logic remain unchanged. Thirty-five added caller-level cases cover classification and distinct recovery behavior. Root planned with ordinary Fable OAuth review; Luna built and tested; Sol, root, and Fable approved. No API-key agent usage or metered review substitute.
2. **Earlier work in this chat is merged.** [VERIFIED via main history] Email placeholder extraction #391 (`9505d22b2`), partial reviewer-roster save/reload fix #393 (`abc1d0403`), and grantee-title provider deadline propagation #394 (`7bf0916ac`) are ancestors of main. Their plans contain scope and review records; do not rebuild them from the older survey.
3. **Session close.** Owner directed closing docs to main. This is a Tier 0 documentation update. No new runtime code, provider calls, live Dataverse probes, or data mutations at close. No DEVELOPMENT_LOG milestone entry is required for this bounded maintenance/refactor close; no new capability, architecture, or cutover was introduced by #397.

### Commits for the final refactor

- `c6a6e00af` — initial plan.
- `4cdf596fc` — Fable plan clarifications.
- `850fa8895` — helper and characterization tests.
- `b6890fffa` — review and validation record.
- `2cd1987da` — squash merge of PR #397 to main.

## Next Items

### Verified Open — separate lane, do not duplicate

1. **Factory admin routes: PR #398** (`claude/factory-admin-form-slice2`) is OPEN; **status setter: PR #399** (`claude/factory-admin-form-slice2b`) is OPEN. [VERIFIED via GitHub at close] The previous handoff's instruction to start slice 2 is superseded by these existing PRs. Coordinate with their owner and inspect current heads/reviews before doing anything. This stop did not review or authorize merging either PR.

### Owner Decision Needed

1. Choose whether to resume refactor assessment later. PR #390, “docs: refresh remaining refactor candidate assessment,” is still OPEN but explicitly on hold by Justin. Do not merge it or treat its remaining-candidate list as current without a fresh source check and owner direction. No next refactor is selected or authorized.

### Verify Before Acting

1. **Parallel Factory handoff:** read `4d5a32b40503a1031deab35c0139b8610d5b1948:SESSION_PROMPT.md` for the full S561 handoff, then reconcile with PRs #398/#399 and their current plan. Office-Mac sync, Preview/Production provisioning, browser email verification, parked features, and ledger retirement were not independently revalidated in this refactor close. They are carryover context, not a verified actionable queue.
2. Preserve the prior warning that Requests 1003301–1003303 are tracked Factory runs in `managed-ledger/ledger_prod`, not presumed cleanup residue. Verify ledger and current callers before any destructive work. Do not remove old worktrees or databases merely because the previous handoff suggested cleanup.
3. The claim-evidence observation report could not read local state in this Codex session. No observation count or zero-advisory row was invented, and the pilot directive was not edited.

### Do Not Reopen Without New Evidence or Owner Direction

1. PR #397's two-call-site scope and approvals are complete; no behavior change was intended. Do not consolidate the differing sibling classifiers.
2. PR #390 stays on hold. Its older survey is excluded from this bounded close reconciliation by explicit owner instruction.
3. The established delegated cadence is root/Fable planning, Luna build/reconnaissance, Sol review, root review, and ordinary OAuth-only Fable adversarial review. Bound iterations; root takes over minor churn. Runtime merges still require explicit owner authorization.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/plans/REVIEWER_CREATE_CONFLICT_HELPER_PLAN_2026-10-01.md` | Scope, characterization, approvals and production record |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Private helper and its two create-path callers |
| `tests/unit/reviewer-suggestion-disposition.test.js` | Applicant conflict/recovery characterization |
| `tests/unit/reviewer-adapters-writeback.test.js` | Staff-manual conflict/recovery characterization |
| `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md` | Separate Factory lane; inspect current PR versions before continuation |

## Validation

[VERIFIED via Luna logs and review record] Focused four suites / 275 tests; full Jest 1,196 suites / 18,958 tests / five snapshots passed; six suites / 98 tests skipped. Types, canonical build and lint passed (zero errors; 124 warnings, none in changed files). Dataverse access layer, Dynamics context boundary, route/service boundary, API routes, Atlas, secret scan, doc currency, doc symbol refs, and build claim freshness gates plus available self-tests passed serially; docs catalog passed. PR #397 CI was green on reviewed head `b6890fffa1498f85e22dfe3cc88f222f170bb427` before merge.

[VERIFIED bounded Mode A reconciliation] Scope: #397 merge/deployment and closing handoff. GitHub/source establish the change; code persistence/consumer behavior is unchanged. Updated this handoff and the helper plan. The original survey remains excluded under the explicit hold; no whole-repo current-refactor-menu claim is made. Production functional behavior beyond the user's confirmation remains unprobed.

## Materials feature branch handoff — 2026-10-01 (separate lane)

[SOURCE-BUILT; not merged or enabled] Draft PR [#402](https://github.com/justingallivan/wmkf-research-apps/pull/402), branch `codex/materials-background-processing`, implements applicant Site Visit / Research Presentation background uploads. This appended section preserves the earlier refactor/Factory handoff above; its other-lane statuses were not revalidated here. The user authorized autonomous Luna build/reconnaissance, Sol review, parent review and Fable OAuth review while away. No production migration, flags, merge or provider rehearsal was performed.

[VERIFIED via source and local checks] Private Blob holds bytes; committed Postgres admission owns processing. The worker scans/saves with bounded retries, leases and crash recovery. Per-staging SharePoint folders preserve the previously received file. Applicant/staff state, Ready/reminders and cleanup reflect durable ownership. Consultant Feedback remains synchronous and the shared configurable 500 MB cap is unchanged. Fable reviewed the plan twice; Sol and parent implementation reviews passed. Fable approved the bounded corrections in `e50da1c3c` after Sol and parent review; its verdict is APPROVE FOR PR, conditional on final-head CI. Initial CI passed on `d5fa504e9` (canonical build, 1,199 suites / 19,108 tests).

[VERIFIED via command results] Full Jest: 1,198 suites / 19,095 tests / five snapshots passed; seven required local PostgreSQL suites: 112 tests passed; additional admission-route suite: 13 passed. All 42 CI gate commands passed, lint had zero errors / 134 warnings, production webpack build passed, and all seven 499 MiB memory scenarios passed. Default local Turbopack cannot traverse the worktree dependency symlink; CI verifies a normal installation. No real near-500 MB provider/browser rehearsal has occurred.

Key commits: `b12ba3feb` backend, `2a7267f73` UI/readers, `e2d52000b` parent review fixes, `4cd4fc201` admission regressions, `d5fa504e9` benchmark compatibility. The canonical [background plan](docs/plans/MATERIALS_BACKGROUND_PROCESSING_PLAN_2026-10-01.md) records the contract, tests and release prerequisites. Worktree: `/Users/gallivan/.codex/worktrees/materials-scan-timeout/WMKF_Apps-codex`; preserve unrelated work in other checkouts.

**Next steps for this lane:** verify final-head CI and present the reviewed PR to the owner. Fable review is complete; no material runtime finding remains. Additional real-helper schema-off/cleanup-owner PG regressions in `16f17e5ab` passed all 16 focused tests and were reviewed by the parent. Before production activation, separately authorize the production recovery path and release; deploy additive code, apply migration 060 through the existing runner, verify schema/worker readiness, then enable admission. Both flags default off. Disable admission and drain/resolve jobs before rolling back to ownership-unaware code.

**Operational limitation:** the operator utility remains loopback-only and refuses consumed-receipt retry. Automatic approval review rejected widening remote mutation access and removing that guard as outside local operational scope. Automatic consumed-receipt crash recovery is built, but malformed/pre-fix attention rows require a separately authorized production recovery path. No bypass was attempted.

**Milestone determination:** no DEVELOPMENT_LOG entry is required for this unmerged feature preparation; nothing was shipped to production in this lane. The local claim-evidence report was unavailable and no observation was invented. Automatic approval review rejected replacing this entire session record, so this feature handoff was appended without removing previous content.
