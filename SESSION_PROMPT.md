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

## Materials feature branch handoff — 2026-10-02 (separate lane)

[VERIFIED via owner read-only probes] The base applicant Site Visit / Research Presentation background upload feature is merged in PR #402 and deployed in Ready Production deployment `dpl_HejNdRssKwXEZmjMpGuRXXZ3WBZb` (commit `1ec1d93265fa19357372c5c75fa2dff9501e8406`). Migration 060 was applied at `2026-10-02T17:08:20.197Z`; schema readiness is `on`, admission is `off`, virus scanning is `true`, and the 17:20 UTC worker run found an empty queue. No job was admitted. Keep the synchronous applicant finalize behavior until the owner separately approves activation.

[VERIFIED via source/tests] Activation follow-ups are on branch `codex/materials-activation-readiness`, draft PR #404 open. The guarded Production recovery CLI is source-built in `3fdd04686`/`e5837db5e`; 26 focused operator unit tests and 16 local PostgreSQL tests passed, and Sol approved. Production mode requires the fixed local-shell `MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL`, explicit target/host/database and exact job/action confirmations, verified TLS, read-only inspect, sanitized output, and connected database/public-schema checks inside the resolver transaction. No Production CLI command was run; only the owner runs any Production inspection or recovery.

The exact-root recursive-reader filter and five callers are source-built in `2bfa5f590`. Eight focused suites passed 104 tests and one snapshot; Sol and parent approved. It removes only exact same-request portal-produced Superseded drive/item identities beneath canonical Site Visit materials roots, preserves current/manual identities, and omits affected candidates with a sanitized error when registry/drive evidence is incomplete. Fable approved the runtime through `2bfa5f590` with no required fixes. The dependency-only matcher extraction in `45fc84144` passed 26 focused suites (483 tests, one snapshot), including the prior CI import-failure suites and plain Node CLI; Sol approved the extraction; Fable's bounded follow-up review is pending. PR #404 remains draft pending all required CI on its current head. Neither follow-up is deployed. Do not enable background admissions or run a Production recovery mutation as part of this handoff.

[VERIFIED via prior GitHub Actions] PR #402 final CI passed 1,204 suites, 19,529 tests, five snapshots, and seven PostgreSQL suites with 114 tests. Verify required CI for PR #404 on its current head before merge; do not treat PR #402 results as evidence for these follow-ups. Full provider/browser 500 MB rehearsal remains a separate release task. No production milestone was added on this source branch; deployment, admission, and recovery mutations remain out of scope. Preserve unrelated Factory and reviewer-refactor context above; this handoff replaces only the previous materials-lane section.
