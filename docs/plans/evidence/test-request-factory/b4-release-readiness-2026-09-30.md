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

After the owner asked to finish the remaining session work, both Local and B4 branch Preview switches were enabled. Local `.env.local` was a symlink into Claude's checkout: it was replaced **in this worktree only** with a mode-0600 private copy, preserving unrelated configuration and modifying only the two switches. The former target file was not changed. The CLI's `loadEnvLocal` and Next.js `@next/env` development loader both resolve the Local switches to literal `on`. This private copy will need its own future credential synchronization. Vercel Development and the generic Preview configuration were not changed; the branch overrides apply only to B4. Production was read, not modified.

| Configuration | TEST_REQUEST_ISOLATION | SYNTHETIC_REVIEWER_ISOLATION | wave29 / wave30 |
|---|---|---|---|
| Local private `.env.local` | on | on | present / present |
| Vercel Development | off | off | not separately probed; Local was probed |
| B4 branch Preview | on | on | present / present |
| Production | on | on | present / present |

[VERIFIED via fresh env pulls and nine HTTP-200 metadata reads] Local, B4 branch Preview and Production all resolve to a Production-classified Dataverse target; all three required attributes are present: `akoya_request.wmkf_istestrequest`, `akoya_request.wmkf_testcreationrunid`, `wmkf_potentialreviewers.wmkf_issyntheticreviewer`. The current receipt is [enabled switches and marker reads](b4-environment-switches-enabled-2026-09-30.json), captured from committed source `93447aeacdc22df60b5ad9f4cff0b47cbd55f61e`, with runtime/client unchanged from `92ccbd0bd`. The [initial switch receipt](b4-environment-switches-2026-09-30.json) preserves the earlier off/off Local/Preview observation as history. The [metadata/privilege supplement](b4-dataverse-readiness-supplement-2026-09-30.json) remains the dated effective Process visibility check accompanying section 13.

[VERIFIED via Jest] All six focused switch/capability/acceptance-job suites passed, 145 tests, after the configuration edits. Tests exercised the switch matrix, zero side effects during the all-job pause, matching-lease release and ordinary-job resumption. This is mocked behavior coverage, not a live job drain. No live acceptance job was invoked.

**Preview deployment:** [VERIFIED via Vercel list/inspect and the read-only deployment API] The post-configuration Preview at commit `1a86c10da92b779acaade0bb99ce4fcc2203db24` is Ready, target Preview, and `buildSkipped=false`; see [deployment receipt](b4-preview-deployment-2026-09-30.json). All 12 CI checks passed and PR #369 remained draft/mergeable/clean at that head; see [CI snapshot](b4-ci-after-switches-2026-09-30.json). Direct readback of deployment-captured values is UNKNOWN: CLI 61.1.0 `env pull --id` rejects a Ready deployment because it expects INITIALIZING, and the read-only deployment API lists env key names without values. All attempted pull files were empty, mode-0600 and deleted. Project/branch configuration is verified on/on, but no runtime-value or live job-resumption claim is made. An old deployment does not inherit env edits. Runtime source is unchanged; Production promotion is still owner-gated. Keep the fail-closed bind and all-acceptance-job pause policies. A switch-only rollback after promotion is disallowed; deploy the prior code first.

## Local ledger §6 preflight / apply / record

[VERIFIED via Colima/Docker and read-only `pg` queries] The existing `wmkf-ledger-pg` PostgreSQL 16 container was stopped and was started without recreation. Its databases at `127.0.0.1:5433` are `ledger` and `postgres`.

- `ledger_prod`: connection refused by PostgreSQL with `3D000` (database absent). The owner does not know its location. No production cast journal was available here to establish ownership or perform the server-read email-digest comparison.
- `ledger`: only `test_request_runs` and `test_request_run_resources` are present among Factory tables. No `schema_migrations`, reviewer assignments, status journal, cast members, cast bindings or slot journal is present. The installed `test_request_receipt_ok(jsonb)` body differs from current 058. This is an earlier incomplete 054 shape; full 054/058 parity is not established. It is not established that this is the owner's operational sandbox ledger rather than the historical scratch database.
- **Apply: NOT RUN. Record: preflight only.** No new database, tracker, row, or migration was created. Do not infer cast ownership from a Dataverse name/email or recreate its missing journal. The owner cannot check the other Mac for approximately nine hours after this chat decision. A read-only inventory here found one Colima profile, one Postgres container and its single volume; no spare ledger was found in that inventory. The owner must locate the actual operational ledgers (and recover their existing audit records if needed), then run §6 preflight before an explicit 058 apply. 058 carries forward cast tables/function, not every missing earlier 054 table; it alone does not establish full 054 parity on this `ledger`.

Gitleaks initially matched the full candidate Git SHA as a external provider token because the installed function contains an item-identifier keyword, which activates that scanner rule for the file. The receipt therefore uses the unambiguous abbreviated candidate SHA; full provenance remains at the top of this report and in the metadata/section-13 receipts. No credential was introduced and no scanner exemption was added.

The [full local schema receipt](b4-local-ledger-preflight-2026-09-30.json) records columns, constraints, indexes and installed function definition/body, the candidate SHA and migration hash. The read-only [SQL query](b4-schema-preflight.sql) was executed against `ledger`; its SHA-256 is recorded in the receipt.

Once actual ledgers are identified and their shape is compatible, **the owner**, from a named source commit, runs §6's explicit single-transaction 058 command and re-reads the shape. Preserve database name, UTC time, source SHA, file hash and post-apply schema. Extend a tracker only if it already has the historical migration rows; never create a tracker containing only 058. Never point `scripts/apply-migrations.js` at the local ledgers.

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

[VERIFIED via HTTP 200] One enabled application user was found by the configured application ID. `RetrieveUserPrivilegeByPrivilegeName(PrivilegeName='prvReadWorkflow',ExcludeTeamBasic=false)` returned `Global`. This confirms effective organization-wide Process read for this probe identity at 2026-09-30T18:31:30Z. Fresh Local/B4 Preview/Production pulls also read both flags on/on and all nine marker reads present/HTTP 200; [current supplement](b4-dataverse-fix-supplement-2026-09-30.json). The parameter and returned `RolePrivileges` contract were checked against [Microsoft's function documentation](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/retrieveuserprivilegebyprivilegename?view=dataverse-latest). The sanitized supplement retains only counts/enabled state/privilege/depth/status, not identity IDs.

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

Evidence capture is complete for the checks run; **release readiness is not complete**. The inactive ordinary slot P2 is FIXED on branch, verified by permanent regression tests and fresh OAuth Opus source review; the fix report records its bounded contract audits/complement checks. Remaining unknowns are deployment-captured switch readback, operational ledger location/ownership, owner pre/post-apply schema receipts, Production/Preview migration consistency, cast address-digest match, automation dispositions/indirect chains and eventual promotion/post-deploy job resumption. [VERIFIED via local gate output] All 20 relevant documentation/Atlas/secret/scaffolding/harness/agent-invariant gate/self-test runs passed after the evidence files were staged. JSON receipts parsed, staged whitespace check passed, and no temporary credential directories remained. Final branch/CI status is reported in the handoff/chat. The advisory claim-evidence pilot report was unavailable (local state unreadable); no observation row was fabricated.
