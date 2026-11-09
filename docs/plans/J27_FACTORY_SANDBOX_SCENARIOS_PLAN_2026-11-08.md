# J27 Factory sandbox scenarios — implementation plan, revision 2

Date: 2026-11-08. Status: owner approved revision 2 for build; local implementation under verification. No confirm execution authorized.

Implementation addendum: the owner review places ready-run resource SQL in `run-ledger.js`, superseding the original unchanged-file wording below. The 2026-11-08 owner instruction supersedes commit/push with an uncommitted handoff and permits only a dry-run preview. The original numbered plan is retained as the approved design record.

Decision 9 remains approved as Option 1: one sandbox scenario finalizer. This revision applies all seven required changes in the owner-side review. Safety requirements remain; fixture fidelity is deliberately limited. This session changes only this plan: no source edits, Dataverse calls, migrations, or commits.

All implementation statements below are **PLANNED**. Current-code claims are labeled with verified source locations. Owner-reported live probe results are attributed to the review, not presented as independently verified here.

## 1. Reduced scope and file list

Create eight sandbox J27 Research Factory runs, then finalize them through one CLI/service flow. Reuse the existing clone, status setter, readiness journal and resource journal. No new table, column, SQL state, migration, fingerprint change, ledger rollout, shared UI configuration, or separate journal module is needed. There is no `ledger:apply` stop; the remaining authorization is owner build approval.

| File | Planned change |
|---|---|
| `scripts/rehearse-j27-factory-scenarios.mjs` (new) | Sandbox-only preview, digest confirmation, creation/finalization/resume and per-scenario reporting. |
| `lib/services/test-requests/j27-sandbox-scenarios.js` (new; the only new service) | Scenario definitions, sandbox-bound dependency wrapper, guards, existing-table resource operations, memo/readiness orchestration, selected reviewer suggestions and readback. |
| `lib/services/test-requests/readiness-journal.js` | Parameterize the environment predicate, defaulting to Production; explicitly select sandbox only from the new service. |
| `lib/services/test-requests/status-change-runner.js` | Parameterize environment admission/recheck with Production defaults; sandbox-only draft-state validation before completion. Preserve transition, replay, ETag and journal semantics. |
| `lib/services/test-requests/policy.js` | Add a narrow sandbox program/PD input branch, separate from Production additions and without cast/status/readiness additions. |
| `lib/services/test-requests/basic-clone-steps.js` | Resolve and hash-bind sandbox J27, Research and PD inputs in the manifest, compile their bindings and validate on resume; preserve historical manifests and sandbox cast refusal. |
| `lib/services/test-requests/sandbox-clone.js` | Verify sandbox scenario program and PD bindings against the manifest, alongside existing clone checks. |
| `tests/unit/test-request-j27-sandbox-scenarios.test.js` (new) | Scenario matrix, guard/receipt/transport tests, concurrency/resume and Production-default regressions. |
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | One section for preview/confirm, scenarios, tolerated drafts, skips, recovery and accepted limits. |
| `docs/atlas/postgres-test-request-runs.md` | Notes on reuse of existing journals, digest representation and sandbox environment admission. |
| `docs/atlas/dataverse-akoya-request.md` | Notes on sandbox program/PD provisioning and scenario field ownership. |

Keep `production-write-fence.js`, `prepared-fixture-contract.js`, `readiness-finalizer.js`, `status-transitions.js`, `run-ledger.js`, the existing finish plan, Workbench components and discovery code unchanged. No new routes or background workers.

## 2. Citation verification and corrections

The review's main scope conclusions are supported, with these precise corrections and qualifications:

- **No migration:** [VERIFIED via `lib/db/migrations/094_test_request_readiness_finalizations.sql:3`] The readiness table has no environment constraint. [VERIFIED via `lib/services/test-requests/readiness-journal.js:17` and `:38`] Production admission is in JS queries. [VERIFIED via `lib/db/migrations/054_test_request_runs.sql:380`] Numeric phase journaling is run-bound without an environment constraint. [VERIFIED via `lib/services/test-requests/run-ledger.js:128`, `:148`, `:150`, `:367`; `lib/db/migrations/054_test_request_runs.sql:63`] Request IDs, ETags, hashes and the request-patch resource kind are supported by JS and SQL.
- **Program/PD:** [VERIFIED via `lib/services/test-requests/basic-clone-steps.js:653`; `lib/services/test-requests/policy.js:304`] The compiler currently places these bindings in Production additions. The exact sandbox refusal is at `basic-clone-steps.js:701–704`, not the review's `:703–706` for both inputs. Cast refusal is independently retained at `:902–903`. [VERIFIED via `lib/services/workbench/program-scope-service.js:48`] Assignment scoping uses the PD lookup.
- **Transition citations:** The review's spot-check accepted two inaccurate pointers inherited from revision 1. [VERIFIED via `lib/services/test-requests/status-transitions.js:57`] The Invited edge is at `:57–59`; `:63` belongs to the Phase II Recommended edge. [VERIFIED via `lib/services/test-requests/status-transitions.js:41`] Phase I email/tracking effects are at `:41–43`; `:47` starts Phase II effects. Numeric scenario options are already present at `:28–35`.
- **Readiness omission is not a default-value proof:** [VERIFIED via `lib/services/test-requests/basic-clone-steps.js:123`] `CREATE_FIELDS` omits readiness. This proves omission, not that a live create cannot become ready through defaults/automation. Require false/null readback; never repair unexpected true with a false write.
- **Selected candidates:** [VERIFIED via `97f696faf:lib/services/reviewer-rollup.js:79`, `:87`, `:138`] The cited Workbench revision counts selected suggestions, and two candidates with no invitations/acceptances/completions produce `invite`. Local baseline counting is at `lib/services/reviewer-rollup.js:78–90`. [VERIFIED via `lib/services/test-requests/cast-binding-runner.js:75`, `:88`] Existing cast body/check expect false; a sandbox-local variant must expect true.
- **Resource API qualification:** [VERIFIED via `lib/services/test-requests/run-ledger.js:1047`, `:1057`, `:1091`] Generic resource methods require a lease, and their dispatch UPDATE is not itself a planned-only CAS. [VERIFIED via `lib/services/test-requests/run-ledger.js:877`, `:890`] `claimLease` excludes ready runs. Therefore table reuse is valid, but calling these methods unchanged after provisioning is not sufficient. The one new service will provide narrow transactional operations over the existing resource table for ready sandbox runs, reusing receipt validation and existing schema constraints; it will not pretend an unavailable lease exists or reset a ready run to creating.

The review's Research GUID and workflow inventory are live-probe reports, not independently reproducible from the cited source. **[ASSUMED — owner-reported, not re-probed here]** Research is `c247b11a-a7cb-ee11-9078-000d3a341e8f`; the listed sandbox workflows have the stated activation modes. Runtime sandbox preflight must verify the target identities and metadata rather than trusting a copied GUID.

## 3. Provisioning and inputs

Use the existing sandbox clone and foundation test organization. `TEST:` titles provide legible scenario names. Do not create per-row PI contacts, bind cast contacts, rename an organization or require a synthetic institution display label. Report whatever institution/PI fields the clone actually leaves as accepted fidelity limits.

The sandbox scenario manifest must include `grantProgramId`, `programDirectorId`, linked J27 cycle and scenario/version identity. Resolve Research on the classified sandbox and verify its name/active state. Resolve the Workbench caller's sandbox systemuser by their supplied sign-in email, requiring an enabled, unambiguous match. [VERIFIED via `lib/services/program-director-resolver.js:36`, `:47`] The existing resolver maps normalized email to enabled `systemuser`; reproduce that lookup through the pinned sandbox client, not its shared-target adapter/cache. PD assignment is a destination fixture choice, not authentication of the CLI actor.

Compile metadata-verified `wmkf_grantprogram` and `wmkf_programdirector` bindings outside the Production additions. Include them in create-body hashing and verify `_wmkf_grantprogram_value` and `_wmkf_programdirector_value` after creation and on resume. [VERIFIED via `lib/services/test-requests/sandbox-clone.js:160`] These checks currently run only for Production. Preserve old manifests byte-for-byte; opt into the new sandbox inputs explicitly.

Proposed CLI interface, not executable yet:

```text
node --import ./scripts/lib/use-extensionless.mjs scripts/rehearse-j27-factory-scenarios.mjs --target=sandbox --all --batch-key=<key> --director=<workbench-sign-in-email>
# After inspecting the preview:
... --target=sandbox --all --batch-key=<key> --director=<email> --confirm=<preview-digest>
# Existing run, explicitly named and reverified:
... --target=sandbox --scenario=7 --run-id=<factory-run-guid> --director=<email>
```

Derive one deterministic run/destination identity per batch/scenario and use existing reserve-or-return semantics. Do not adopt the hand-created fixtures. Named runs must satisfy the same markers, program/PD/cycle, actor and baseline-state checks. Do not repurpose a run for a different scenario.

## 4. Guard chain

1. **Closed CLI inputs and actor.** Reject unknown scenarios, arbitrary field payloads, duplicate destinations and Production targets. Derive actor using `cliActorId`; require the run's actor to match for this bounded CLI so the existing run row provides durable actor attribution without a new actor column. [VERIFIED via `lib/services/test-requests/run-ledger.js:393`] The helper derives a digest from OS username. Explicit run IDs do not bypass ownership checks.
2. **Sandbox before any access.** Require a bare HTTPS registered sandbox origin; reject missing, unknown, Production, userinfo/path/port variants and cross-origin redirects before authentication or reads. Reuse `classifyTarget` and the origin-pinning pattern from the sandbox dependency. [VERIFIED via `lib/dataverse/core/interlock.js:56`; `lib/services/test-requests/reviews-sandbox-deps.js:96`] No environment-name-only classification or Production fallback.
3. **Enforcement and persistence target.** Require literal interlock and DAL enforcement `on`. Open only `TEST_REQUEST_SANDBOX_LEDGER_URL` through existing target/schema checks; no Production inspection. [VERIFIED via `lib/dataverse/core/interlock.js:77`] Unset interlock is off, hence the explicit prerequisite.
4. **Trusted sandbox dependencies.** Establish `withDalContext` after CLI verification. [VERIFIED via `lib/dataverse/core/context.js:46`] This establishes context, not authentication. Use sandbox-bound dependencies rather than the shared `grant-request` adapter. [VERIFIED via `lib/services/test-requests/reviews-sandbox-deps.js:284`, `:295`] The existing frozen dependency exposes a trusted-context changeset path and suggestion creation. The new service can adapt a single ETag-bound request PATCH to that existing path, preserving the status/readiness runners' expected response shape and treating uncertain per-operation results as ambiguous. [VERIFIED via `lib/dataverse/core/changeset.js:96`] Operation construction forwards `ifMatch`. Do not create an unguarded raw writer or scanner exemption.
5. **Row and run verification.** Require completed sandbox provisioning, exact destination/test/run markers, immutable manifest hash, J27, resolved Research and PD, foundation binding, disabled reminder flags and no unresolved conflicting operation. Re-read after waits and before every write. Do not let expired locks authorize a stale sender.
6. **Metadata and preview.** Resolve phase options live and validate readiness updateability. Probe memo metadata separately: only confirmed absence is a skip; permission/network/type errors block. Preview every intended write/no-op/skip, prior/target value, actor, known IDs/ETags, candidate bodies, expected derived status and draft/tracking effects. Mark future server-generated values as unknown. Compute a canonical digest; confirmation must match it. Preview writes nothing, including no ledger reservation. Meaningful input/state drift requires a new preview; expected changes caused by already-journaled steps are reconciled on resume.
7. **Journal and fence.** Persist intent before dispatch, win planned-to-dispatched CAS, then recheck target/ownership/ETag. Reuse `assertWritePermitted` and interlock at transport. [VERIFIED via `lib/services/test-requests/status-change-runner.js:112`] Its missing-base-URL shortcut makes the new strict origin precondition necessary. Numeric phases use the existing status fence; readiness uses unchanged true-only `fenceReadinessClient`. [VERIFIED via `lib/services/test-requests/production-write-fence.js:364`] It requires exact destination, one true field and concrete ETag. Memo gets an equally narrow one-field sandbox fence in the new service. Never write false readiness, null phase, triage or request status.
8. **Readback, effects and readiness last.** Finish memo, phase and roster operations before readiness. Check all expected fields and effects, then stamp true only for scenarios 1–7. Scenario 8 remains untouched and must read false/null. A completed journal permits read-only reconciliation, not another PATCH. Ambiguity, ETag conflict, unsafe email state, unexpected payments or unresolved jobs stop the batch with per-scenario identities; no blind retry, rollback or cleanup.

## 5. Existing ledger surfaces only

Reuse these three surfaces with unchanged SQL schemas and enums:

| Operation | Existing durable representation |
|---|---|
| Numeric Phase I/II changes | `test_request_status_changes`: before/after option, ETag, run ID and existing CAS/resume/effects. Parameterize JS environment guards with Production defaults. |
| Readiness true | `test_request_readiness_finalizations`: false/null prior value, concrete ETag, attempt identity, true readback and existing CAS. Parameterize JS environment checks only. |
| Memo, skips, selected suggestion creates and scenario receipts | `test_request_run_resources`: existing request-patch or reviewer-suggestion kind, allowed step/receipt keys and existing outcomes. |

For memo operations use `step='verify'`, `resource_kind='dataverse_request_patch'`. Store `requestId`, `field`, `eTagBefore` and desired digest in `planned_identity`; store prior digest in `source_provenance.contentHash`; store observed digest and `eTagAfter` in `readback`. Hash a typed canonical representation so null and empty string remain distinguishable. Actor is the checked parent run actor. No rationale text enters Postgres. The review approves digests as satisfying the prior/new-value requirement.

Use `kind` to distinguish `j27_scenario`, `j27_memo`, `j27_memo_skip` and related bounded receipts; use `index` for scenario number and `inputFingerprint` for the confirmed plan digest. These are values under existing receipt keys, not new SQL event enums. [VERIFIED via `lib/services/test-requests/run-ledger.js:158`, `:181`; `lib/db/migrations/054_test_request_runs.sql:66`] These keys/grammars already exist. A confirmed memo-absent skip is an undispatched resource with outcome `verified` and readback `exists=false`, `outcome='memo_absent'`; preview only announces it. No fictitious `skipped` SQL state or ETag is introduced.

The one new service will serialize ready-run resource planning by locking the parent row, checking sandbox/actor/run identity, finding an existing exact operation before allocating the next sequence, and validating receipts with `assertLedgerReceipt`. Dispatch updates must match resource/run identity, `outcome='planned'` and `dispatched_at IS NULL`; only the returned row authorizes sending. Commit dispatch before the remote write. Reconciliation never reissues a dispatched operation solely because its old value remains visible. Preserve ambiguous and failed evidence using existing outcomes/error codes. This is bounded reuse of the resource table, not a second ledger abstraction or a change to `run-ledger.js`.

Serialize the scenario invocation per run with a database lock held on a dedicated connection, including phase/readiness calls; release on exit. Durable dispatch records remain authoritative after a crash or connection loss. Revalidate lock ownership before dispatch and stop on loss. Do not permit an alternate sandbox status invocation to interleave with a scenario-owned run. Production paths retain their existing behavior. Unit tests must cover these conditions rather than assuming a process-local mutex is sufficient.

No migration, manifest/fingerprint edit, new run state, integration-test file or migration approval is proposed.

## 6. Eight scenarios and scenario 7 sequence

Common end state: J27 link; resolved Research program and caller PD bindings; exact Factory test/run markers; foundation institution; both reminder flags false; scenario title prefixed `TEST:`. No cast contacts or triage write. No artificial PI/institution fidelity requirements.

| ID | Title after `TEST: J27` | Phase I | Readiness | Memo when field exists | Reviewer candidates |
|---|---|---|---|---|---|
| 1 | `01 Intake` | Preserve clone value | true | Leave empty | 0 |
| 2 | `02 Rationale saved` | Preserve clone value | true | M2 | 0 |
| 3 | `03 First Cut Not Scored` | Not Scored 100000005 | true | M3 | 0 |
| 4 | `04 First Cut Scored` | Scored 100000004 | true | M4 | 0 |
| 5 | `05 Semi-finalist No` | Recommended Do Not Invite 707510006 | true | M5 | 0 |
| 6 | `06 Semi-finalist Yes` | Recommended Invite 707510005 | true | M6 | 0 |
| 7 | `07 Chairs approved` | Invited 100000003 | true | M7 | 2 selected, uninvited |
| 8 | `08 Unready control` | Preserve clone value | false/null, no write | Leave empty | 0 |

Mn is fixed synthetic text: `TEST: Synthetic J27 scenario n rationale for Factory rehearsal; not a real assessment.` No generation. Memo absence is a successful scenario with a recorded skip, not a provisioning request. Unexpected existing human memo text blocks overwrite.

Document the observed Phase I clone value for scenarios 1, 2 and 8; do not normalize it to null. An unexpectedly advanced clone state is an inspection stop rather than an instruction to erase history. Phase II stays at its unadvanced clone baseline for scenarios 1–6 and 8; require null before proceeding. Request status is observed, not patched. Scenario 8 must be invisible under readiness-only J27 discovery; if it is already true, stop without repairing it.

For scenario 7:

1. Require a ready provisioning run, sandbox/test/run identity and Research program. [VERIFIED via `lib/services/test-requests/status-change-runner.js:94`] These are existing setter checks except its current Production-only predicate, which will be parameterized.
2. Call `runStatusChange` with sandbox environment and live-resolved Phase I Invited. [VERIFIED via `lib/services/test-requests/status-change-runner.js:249`, `:314`] It resolves options, checks transitions/replay and journals before dispatch. Its Invited precondition is Phase II null and Phase I null, Pending Committee Review, Scored, Not Scored or Recommended Invite. [VERIFIED via `lib/services/test-requests/status-transitions.js:57`]
3. Set Phase II Pending Committee Review (100000002) through the same setter in a separate journaled change with fresh ETag, after Phase I settles. Retain one-dispatch/resume semantics. [VERIFIED via `lib/services/test-requests/status-change-runner.js:123`]
4. Require readback of Invited / Phase II Pending Committee Review / derived `akoya_requeststatus='Phase II Pending'`. [VERIFIED via `lib/services/test-requests/status-change-runner.js:199`] The setter reads derived status; it does not write that string. **[ASSUMED]** Sandbox derivation yields the required string. If it does not, stop unready; no direct status write or explicit workflow dispatch.
5. Create exactly two suggestions using verified synthetic reviewer people, preallocated suggestion IDs and the existing sandbox dependency. Build the cast-shaped payload but set `wmkf_selected=true`; no invitation, token, email, response or review writes. Put the sandbox binding/readback variant in the one new service, leaving the Production cast helper unchanged. Verify exact person/request/cycle bindings, selected=true, uninvited/no sent timestamp and no token. Journal before POST; resume by exact GUID, never duplicate or adopt foreign suggestions.
6. Verify memo or skip, roster and effect census, then readiness true. Verify counts (candidates 2, invited/accepted/completed 0) and `workRemaining='invite'` through the existing rollup contract. Verify the actual Workbench row later in the owner-approved sandbox integration run, without modifying Workbench.

## 7. Automation policy and resolved questions

The owner review resolves all seven revision-1 questions:

1. **Migration scope:** moot; reuse existing tables, no migration or `ledger:apply` stop.
2. **Memo audit:** prior/new digests are accepted; preserve no-text ledger rules.
3. **Automation:** passive platform-created drafts and expected tracking are tolerated and censused. The CLI never creates/sends email or dispatches workflows. Every newly observed email must remain Draft with no sent timestamp; Pending Send, Sending, Sent, unknown or unreadable status stops execution. Resolve state/status meanings from sandbox metadata; do not fabricate enum values.
4. **Provisioning:** existing sandbox clone provisioning is in scope; the finalizer's field allowlist does not prohibit the necessary guarded create/program/PD bindings.
5. **Identity fidelity:** reuse the sandbox foundation organization; no per-row PI contacts or institution renaming. Reuse verified synthetic reviewer people for scenario 7; a missing safe reviewer is a failed prerequisite, not permission to use a real person.
6. **Slate ready:** two selected=true, uninvited suggestions, yielding `invite`, not unselected applicant suggestions.
7. **Transport:** use the existing sandbox dependency pattern, not the shared-target grant-request adapter. No separate adapter-target approval question remains.

**[ASSUMED — owner-reported sandbox probe in review finding 7]** Auto-triggered sandbox workflows include `WMKF_Rsrch Advance to Proposal Phase` and `WMKF_Phase II Not Invited Draft Email`; `WMKF_Research Phase II Invite` is on-demand; Phase I/II request-status business rules are active. Preview must identify scenario 5's possible draft and scenario 7's possible GoApply tracking, and disclose the transition table's permitted draft effects for scenarios 6/7 without promising they will occur. No on-demand workflow is invoked.

[VERIFIED via `lib/services/test-requests/status-change-runner.js:207`] The existing census returns email IDs, not draft-state validation. [VERIFIED via `lib/services/test-requests/basic-clone-steps.js:337`] Email reads include state/status and sent time but cap at 50. The sandbox census must inspect the complete relevant set, following pagination or failing closed on incompleteness, and verify each email's state before marking completion. Add this sandbox-only behavior within the listed status runner/new service; retain Production defaults. Recheck draft states at final verification and resume. Observation is not a guarantee that external automation will never change later; retain that limitation in the report.

## 8. Tests, gates and acceptance

One new unit test file will cover:

- All eight exact end states, retained clone values, true-only readiness and scenario 8 false/null; no null-clearing or false PATCH.
- Sandbox refusal before access for Production/unknown/malformed URLs, redirect/mixed-target attempts, disabled enforcement and absent trusted context.
- Non-test/wrong-run/wrong-actor rows, program/PD/cycle mismatch, stale manifests and enabled reminders fail before writes.
- Program/PD sandbox creation and readback; cast remains refused; Production/default and old-manifest behavior remain unchanged.
- Read-only preview, confirm digest mismatch/drift, deterministic retry identities and per-scenario partial success.
- Present/absent memo, null-vs-empty digests, legal JS/SQL receipt shapes, skip without dispatch; errors are not misclassified as absence.
- Existing status/readiness journal environment defaults and CAS; ready-run resource locking, concurrent invocation, lost connection, failed ledger write, ambiguous PATCH/POST and ETag conflicts cannot cause duplicate dispatch or false success.
- Scenario 7 selected candidates and `invite`; unselected, invited, token-bearing, real-person or foreign suggestion rows fail; no paid/AI/screening/email/workflow call.
- Allowed drafts and tracking; Pending Send/Sending/Sent/unknown email states, late draft transition, incomplete census, payments or unsettled jobs block completion. Existing transitions remain unmodified.

During implementation, run gates sequentially, each immediately followed by its existing self-test; inspect current package scripts first:

1. New unit file and existing Factory compiler/runner/status/readiness/CLI/isolation suites.
2. `check:atlas` and self-test.
3. `check:dataverse-access-layer` and self-test.
4. `check:dynamics-context-boundary` and self-test.
5. `check:route-service-boundary` and self-test.
6. `check:reviewer-engagement-boundary`, then self-test; `check:script-suggestion-writers`, then self-test.
7. `check:odata-escape`, then self-test; `check:status-enum-parity`, then self-test.
8. `check:factory-ledger` with sandbox-only configuration; require an actual matching inspection, not a skip. No Production connection or schema application.
9. `check:types`.
10. Relevant documentation gates and their self-tests: `check:doc-currency`, `check:fact-consistency`, `check:canonical-pointers`, `check:doc-symbol-refs`; then `check:secret-scan` and self-test.

No route changes are planned; run `check:api-routes` and its self-test if that scope changes. No migration checks or new integration-test files are required by this revision. Relevant red gates block implementation completion; do not change a scanner exemption to make the sandbox writer pass.

After owner build approval and implementation verification, perform a sandbox preview, report it, and only then execute the explicit confirmation under the authorized sandbox scope. Report scenario/run/request IDs and request numbers, observed retained values, memo skips, drafts/tracking, confirmed candidate/visibility outcomes and any blocked remainder. Never turn partial success into an eight-scenario success claim.

## 9. Accepted limits and remaining stop conditions

Part 1's per-row synthetic PI/institution fidelity and unset Phase I for every untouched case are superseded by the review: titles identify scenarios; retained clone values are documented. The existing status options already cover the numeric scenarios. No triage, request-status patch, AI artifact generation, screening, sends or explicit workflow dispatch is added.

Memo field/service availability and actual sandbox status derivation remain unverified here. Missing memo metadata is a recorded skip; failed derivation is a scenario-7 stop. Missing safe identities, unexpected readiness, incorrect program/PD, unsafe effects, ambiguous operations and failed guards remain runtime stops, not new pre-build owner decisions.

[VERIFIED via `97f696faf:shared/config/workbenchVisibility.js:11`] The cited Workbench snapshot still contains the legacy status/triage visibility predicate. Readiness-only J27 discovery is an owner decision and integration dependency, not proved shipped by that snapshot. The Factory must never set Advancing to compensate. Verify visibility with the Workbench owner's intended build and report the dependency if unavailable.

All seven required named changes are incorporated. No unresolved design permission question is carried forward from revision 1. The next authorization is the owner's build approval; this document does not itself authorize building or running the scenarios.

## Implementation evidence and dependency correction (2026-11-08)

[VERIFIED via source] The CLI and single scenario service are implemented locally, with resource planning/CAS in `run-ledger.js`. This is not a deployment or live eight-scenario receipt. The owner will review and commit the working tree. No confirmation has been run.

One additional source dependency was discovered: `source-bundle.js` only accepted production-origin bundles, while the bounded clone runner requires a bundle and this task prohibits production access. A narrowly explicit `sandboxScenarioSource: true` discriminator now permits only a registered sandbox basic source (no reviewer/pre-site sections). Default bundle validation still requires a production source, and Production clone construction explicitly refuses sandbox-origin bundles. No bundle version, migration, fingerprint or SQL schema changed. The CLI requires a private local `--bundle`; it never calls the production exporter or fabricates source documents. Missing bundle input is a preview prerequisite diagnostic.

The CLI additionally accepts `--source-request-number`, `--reviewers=<guid,guid>`, `--bundle=<private path>` and `--manifest-dir=<absolute private directory>`. Deterministic identities and actual candidate bodies enter the preview digest. A named ready run can reconcile its saved manifest without expiring its completed copy on the source export TTL. Effect metadata resolves the Draft status reason and its associated email state; it does not assume the state label itself is Draft.
