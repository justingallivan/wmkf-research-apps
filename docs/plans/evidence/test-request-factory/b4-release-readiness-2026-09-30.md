# B4 release readiness — 2026-09-30

**Status: BLOCKED; PR #369 remains draft.** This receipt records preflight work, not runtime promotion or permission for a slot PATCH. The owner explicitly authorized read-only Production Dataverse checks in this chat. No migration, Dataverse write, email, slot PATCH, or Production deployment was performed.

## Source and verification

- Earlier merge candidate and section 13 source: `92ccbd0bd052c3ae49666c8776d3642d26dd53ce`, branch `codex/factory-reviewer-b4-runtime`. This is the clean merge of `origin/main` at `570f53086`; six docs-only main commits were incorporated. The probe and `lib/dataverse/client.js` were committed and clean when read. Current runtime candidate: `40ab24f3e9da5af0259aa481014621cdd7837d37`, fixing the inactive ordinary slot P2. The runtime change triggered a new clean-commit section 13/marker/switch/privilege read. [Fix evidence](b4-inactive-slot-fix-2026-09-30.md). Evidence-only descendants preserve this new runtime/probe/client source.
- Migration 058 SHA-256: `b90730eccebbba2d779cd6ce80b66874fb375307395f83494a6165459e4847b4`.
- [VERIFIED via `/start` output] All 67 package-defined startup gate/self-test runs passed sequentially. Advisory memory checks do not establish live database state.
- [VERIFIED via Jest] Focused Factory/reviewer run: 66 suites, 1,906 tests passed. All B4-changed non-Postgres test files: 44 suites, 1,690 tests passed (overlapping coverage, not additive counts). These include switch/pairing, queued-job pause/release/resumption, person-edit refusal, exact mail binding and concrete `If-Match` slot-fence cases. No new mutation exercise was performed in this readiness session.
- [VERIFIED via `gh pr view/checks 369`] All 12 GitHub checks passed at the runtime candidate, including Jest, the PostgreSQL 16 ledger job, Vercel Preview and automatic Claude review. PR state was draft, `MERGEABLE`, `CLEAN`. The durable check snapshot is [b4-ci-at-runtime-candidate-2026-09-30.json](b4-ci-at-runtime-candidate-2026-09-30.json). The automatic review is distinct from the owner-requested Opus review recorded below.

## Independent Opus review

[VERIFIED via OAuth-authenticated CLI review] The owner requested Claude Opus and explicitly approved usage after the automatic approval notice. Opus 5.5 reviewed `e17b93685b2a367d5da3a7016c366baec3b30d4d` read-only: one P2 inactive ordinary applicant-slot ingestion regression, no P0/P1 findings. [VERIFIED via isolated Jest reproduction] Real capability/service execution confirmed the inactive slot fails before repair hydration and fails again on retry, while an active ordinary control reaches hydration. One suite / two cases passed with mocked live seams. The [report and provenance](b4-claude-opus-review-2026-09-30.md) preserve the exact reviewer output and confirmation. The P2 is now FIXED at `40ab24f3e`: 45 suites / 1,712 tests and 18 source verification commands passed. Fresh OAuth Opus 5.5 verified the fix by source with no P0–P2. [Fix and follow-up evidence](b4-inactive-slot-fix-2026-09-30.md). Operational blockers remain separate.

## Environment and marker preflight

[VERIFIED via authenticated `vercel project ls`, `vercel project inspect`, and PR deployment link] The project is `wmkf_research_apps`, ID `prj_56SJKzNer1aV38kKVoP8tl3X0lf3`, scope `justin-gallivans-projects`. This worktree has no `.vercel/project.json`, so pulls explicitly named the verified project and scope. No Vercel project link was written. Later in this session, owner-directed work enabled only the B4 branch Preview overrides and the private Local file; the other checkout was not modified.

Each Vercel read used `vercel env pull` to a temporary file created/chmodded `0600`; the temporary directory was deleted on success or failure. Preview pulls included `--git-branch=codex/factory-reviewer-b4-runtime`. Only key names and literal-on/off results are retained. Off means non-literal-on; no raw non-on value is disclosed.

**Current Local configuration (19:00 UTC):** owner authorized restoring .env.local → ../WMKF_Apps/.env.local. Both ledger keys resolve present in the Factory CLI and Next.js development loaders. Shared target was not edited. Both isolation switches now resolve off/off, so the Local literal-on release gate is BLOCKED until the B4 process/configuration is explicitly on/on; no live operations ran. [Current link/key/switch receipt](b4-shared-env-link-2026-09-30.json). This link changes no Preview/Production configuration.

**Earlier configuration history:** this worktree briefly used an authorized private mode-0600 copy to enable Local on/on without editing Claude's target. B4 branch Preview overrides were enabled separately; the 18:31 clean-commit probe verified all three environments on/on. Those receipts remain dated history for Local; the current matrix below reflects the restored shared link. Vercel Development/generic Preview/Production were not edited.

| Configuration | TEST_REQUEST_ISOLATION | SYNTHETIC_REVIEWER_ISOLATION | wave29 / wave30 |
|---|---|---|---|
| Local shared `.env.local` symlink | off | off | present / present at 18:31; not re-probed after link restoration |
| Vercel Development | off | off | not separately probed; Local was probed |
| B4 branch Preview | on | on | present / present |
| Production | on | on | present / present |

[VERIFIED via earlier dated env pulls and nine HTTP-200 metadata reads] Local, B4 branch Preview and Production all resolve to a Production-classified Dataverse target; all three required attributes are present: `akoya_request.wmkf_istestrequest`, `akoya_request.wmkf_testcreationrunid`, `wmkf_potentialreviewers.wmkf_issyntheticreviewer`. The current receipt is [enabled switches and marker reads](b4-environment-switches-enabled-2026-09-30.json), captured from committed source `93447aeacdc22df60b5ad9f4cff0b47cbd55f61e`, with runtime/client unchanged from `92ccbd0bd`. The [initial switch receipt](b4-environment-switches-2026-09-30.json) preserves the earlier off/off Local/Preview observation as history. The [metadata/privilege supplement](b4-dataverse-readiness-supplement-2026-09-30.json) remains the dated effective Process visibility check accompanying section 13.

[VERIFIED via Jest] All six focused switch/capability/acceptance-job suites passed, 145 tests, after the configuration edits. Tests exercised the switch matrix, zero side effects during the all-job pause, matching-lease release and ordinary-job resumption. This is mocked behavior coverage, not a live job drain. No live acceptance job was invoked.

**Preview deployment:** [VERIFIED via Vercel list/inspect and the read-only deployment API] The post-configuration Preview at commit `1a86c10da92b779acaade0bb99ce4fcc2203db24` is Ready, target Preview, and `buildSkipped=false`; see [deployment receipt](b4-preview-deployment-2026-09-30.json). All 12 CI checks passed and PR #369 remained draft/mergeable/clean at that head; see [CI snapshot](b4-ci-after-switches-2026-09-30.json). Direct readback of deployment-captured values is UNKNOWN: CLI 61.1.0 `env pull --id` rejects a Ready deployment because it expects INITIALIZING, and the read-only deployment API lists env key names without values. All attempted pull files were empty, mode-0600 and deleted. Project/branch configuration is verified on/on, but no runtime-value or live job-resumption claim is made. An old deployment does not inherit env edits. Runtime source is unchanged; Production promotion is still owner-gated. Keep the fail-closed bind and all-acceptance-job pause policies. A switch-only rollback after promotion is disallowed; deploy the prior code first.

## Operational ledger checks — blocked: ledger not on this machine

[OWNER-REPORTED, 2026-09-30] Operational wmkf-ledger-pg/ledger_prod and wmkf-ledger-pg/ledger exist only on the home Mac. Tomorrow's snapshot/restore must preserve their existing journal history and compare dump digests/row counts before B4 checks proceed. Every B4 ledger-dependent §6 preflight/apply/record and cast address-digest check is **blocked: ledger not on this machine**. Do not improvise against this Mac's ledger, which the owner confirms is stale residue. No database/tracker/row/migration was created here.

The [earlier local schema receipt](b4-local-ledger-preflight-2026-09-30.json) is a historical read of that residue: ledger_prod absent, ledger only two original Factory tables and an old function. It does not describe either operational ledger. The prior unknown-location blocker is resolved by the owner update; restore and actual ledger/schema/ownership verification remain pending. Its abbreviated source SHA avoids a previously observed scanner false positive; no credential or exemption was introduced.

[OWNER-REPORTED, matched to pinned PR #374 plan] The separate Neon Marketplace project wmkf-factory-ledger (no Vercel project connection) has managed-ledger/ledger_prod and managed-ledger/ledger, with 054+058 applied. Operational records still need the managed restore; this agent did not connect or migrate them. This B4 CLI's blanket Neon refusal is expected, not a new blocker. After tomorrow's local restore, use only the shell-scoped local override; never commit a URL/password or bypass the guard. [Current ledger update / remote brief / integration obligations](b4-ledger-location-update-2026-09-30.md).

Follow §6 against the restored operational copy: preflight/classify actual schema, owner-run explicit 058 apply only when required/permitted, then record ledger label/database, source SHA, file hash, UTC and post-apply shape. Never run the app all-migrations runner on local ledgers or create a tracker containing only 058. Existing historical migration rows govern whether a tracker can be extended. Shared Production remains owner-run and separate; its 058 application is not a runtime prerequisite. Any future Factory run/cast/status evidence must name its actual ledger beside the run ID.

## Production 054 owner query

The [owner checklist](b4-owner-next-actions-2026-09-30.md) provides read-only recovery commands and the six-item disposition worksheet. It grants no write authorization.

The query is drafted, not run against Production by this session:

```bash
psql -X "$POSTGRES_URL" -v ON_ERROR_STOP=1 \
  -f docs/plans/evidence/test-request-factory/b4-schema-preflight.sql
```

It opens a read-only transaction, inspects `test_request_*` columns/constraints/indexes and every installed `test_request_receipt_ok` overload through `pg_get_functiondef`, then rolls back. If its first result confirms the tracker exists, the owner separately reads all `schema_migrations(name, applied_at, applied_by)` rows using the query in its final comment. Review both the physical shape and tracker before applying 058. Stop for any conflicting shape or unexpectedly missing historical migration rows.

**Owner action pending:** run that read-only query on the intended Production target and return sanitized schema/tracker output, then apply 058 through the existing-database versioned migration process from a named commit and return a post-apply receipt. This agent will not apply Production migrations. Shared Production/Preview tracked-migration consistency remains UNKNOWN for this readiness session; shared 058 application is not a B4 runtime prerequisite (§6). The rotated local Neon credential was not exercised because the Production query remains owner-run.

## Production section 13 and visibility

[VERIFIED via committed `printReviewerSlotReadiness` and interlocked GET-only client] The current [section 13 receipt](reviewer-slot-readiness-receipt-2026-09-30T18-31-30-343Z.json) at `40ab24f3e` records the exact source commit, clean probe/client flags and branch. The exported committed section was invoked directly; unrelated history/contact/record sections were not run. Its receipt contains names, types, filters, counts and booleans, with no record IDs, raw definitions or credentials.

[VERIFIED via HTTP 200] One enabled application user was found by the configured application ID. `RetrieveUserPrivilegeByPrivilegeName(PrivilegeName='prvReadWorkflow',ExcludeTeamBasic=false)` returned `Global`. This confirms effective organization-wide Process read for this probe identity at 2026-09-30T18:31:30Z. At that dated probe Local/B4 Preview/Production pulls also read both flags on/on (Local is now off/off after symlink restoration) and all nine marker reads present/HTTP 200; [current supplement](b4-dataverse-fix-supplement-2026-09-30.json). The parameter and returned `RolePrivileges` contract were checked against [Microsoft's function documentation](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/retrieveuserprivilegebyprivilegename?view=dataverse-latest). The sanitized supplement retains only counts/enabled state/privilege/depth/status, not identity IDs.

The probe read 68 activated Request workflows/rules, 34 Request write steps, 1,227 global write steps (1,224 hidden Microsoft platform steps), and 14 activated cloud flows. Every visible activated flow's trigger summary and every listed Request/global custom step's message/filter metadata is in the receipt. Request auditing is enabled; Potential Reviewer 1–5 auditing is disabled. There are zero unreadable definitions or hard `incompleteReasons`, but `complete` is **false** because these six owner dispositions remain open:

1. `AkoyaGo.CalculatedFieldsAsync: Update of akoya_request` — custom Request any-column step.
2. `AkoyaGo.RequestPreOperation: Update of akoya_request` — custom global any-entity/column step.
3. `AkoyaGo.RequestPostOperation: Update of akoya_request` — custom global any-entity/column step.
4. `GOapply Add Request to Review Group (Deprecated) / manual` — manual API-connection trigger.
5. `Bill.com - Push Payments / manual` — manual API-connection trigger.
6. `GOapply AutoFill Next Phase (Deprecated) / When_a_row_is_added,_modified_or_deleted` — Request/slot actions outside its classified trigger.

Names such as “Deprecated” do not establish deactivation or safety. No owner disposition was inferred from old receipts. For both manual triggers, the owner still needs separate recorded trigger parameter values, absence of a Dataverse subscription, invocation path and Request/slot action evidence. The actual indirect effects of custom steps and other-column Request workflows/steps remain unverified; review all listed custom steps and all 14 flow definitions, not only the six direct disposition messages. No raw flow definitions were saved here.

**Slot gate: BLOCKED.** At the first eventual slot PATCH, recheck every activated flow/definition, indirect custom-step chains, effective Process visibility, exact marked Request/person/run, cast address digest and concrete ETag. No slot PATCH is authorized by this receipt.

## Earlier configuration contract and reconciliation (historical through e17b93685)

`/contract-reconcile` scope is release evidence, Local/branch Preview switch configuration and owner handoff. Runtime implementation was not changed. Entries are PR #369, the B4 plan, Vercel env pulls, local SQL preflight and committed section 13; persistence is repository evidence, the private ignored Local env file, branch-scoped Vercel config and read-only Dataverse metadata; consumers are the CLI/Next.js env loaders, future Preview builds, the owner, future branch sessions and relevant documentation gates. Prior claims verified were the clean branch/CI, environment/marker readiness, ledger parity, Process visibility and slot automation readiness.

- Whole-flow: source candidate → probes/CI → sanitized receipts → release checklist/handoff traced above. App UI/request payload/response-render hops are N/A to this evidence-only change. Local copy → CLI/Next.js literal-on reads and branch-specific Vercel edit → private pull → sanitized marker/switch receipt are verified; the new Preview Ready/build provenance is verified, but direct captured-value readback is unavailable through these supported reads. Current runtime invariants are exercised by the focused/changed-test runs; no new runtime correctness verdict is claimed.
- Partial success: readiness remains blocked despite passing markers, Production switches and CI. Ledger/apply/owner dispositions/email-digest evidence remain distinct; a successful metadata read does not settle them.
- Async/stale state: each receipt has a UTC timestamp and source SHA; environment/automation evidence must be rechecked after configuration or runtime changes. No client async state or background job was added.
- Helper extraction and symbol-consumer fan-out: N/A; no helper, enum, column or runtime contract changed.
- Durable surface: only the B4 plan, branch handoff, owner query and evidence changed. No schema, manifest, fresh-install block, route or Atlas catalogue change was made in this session.
- `/sweep` Mode A: changed readiness facts searched in the B4 plan, `SESSION_PROMPT.md`, Factory Atlas, evidence and memory. The initial unavailable-credentials/not-re-probed claims and subsequent Local/Preview off/off blocker statements were replaced with the current evidence. The initial JSON receipts retain explicitly dated historical results; current report/plan/handoff point to the enabled-switch receipt. Historical S548/S552 probes remain dated history; Atlas claims that operational ledger application/Preview consistency remain unverified still agree. Cross-workstream scheduled-email files, 059/V58 and the other checkout are excluded by explicit owner scope.
- Disconfirming checks: exact marker metadata returned present; initial literal-on comparison falsified Local/Preview readiness; a later authorized edit and fresh pulls verified both are now on; actual `pg_database`/catalog reads falsified assumed local ledger availability/parity; section 13's nonempty disposition array falsified clearance despite zero hard reasons.

Evidence capture is complete for the checks run; **release readiness is not complete**. The inactive ordinary slot P2 is FIXED on branch, verified by permanent regression tests and fresh OAuth Opus source review; the fix report records its bounded contract audits/complement checks. Local literal-on readiness is now BLOCKED after the shared-link restoration. Remaining unknowns are deployment-captured switch readback, tomorrow's operational-ledger snapshot/restore and ownership-history verification, owner pre/post-apply schema receipts, Production/Preview migration consistency, cast address-digest match, automation dispositions/indirect chains and eventual promotion/post-deploy job resumption. [VERIFIED via local gate output] All 20 relevant documentation/Atlas/secret/scaffolding/harness/agent-invariant gate/self-test runs passed after the evidence files were staged. JSON receipts parsed, staged whitespace check passed, and no temporary credential directories remained. Final branch/CI status is reported in the handoff/chat. The advisory claim-evidence pilot report was unavailable (local state unreadable); no observation row was fabricated.
