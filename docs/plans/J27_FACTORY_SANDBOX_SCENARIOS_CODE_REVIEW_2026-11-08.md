# Code review: J27 Factory sandbox scenarios (uncommitted working tree on `codex/j27-factory-scenarios`)

Reviewer: Claude Fable 5.1 for Justin Gallivan, 2026-11-08. Reviewed the full working-tree diff against `53066edc1`: 3 new files (`lib/services/test-requests/j27-sandbox-scenarios.js`, `scripts/rehearse-j27-factory-scenarios.mjs`, `tests/unit/test-request-j27-sandbox-scenarios.test.js`), 8 modified Factory modules, runbook and two Atlas pages. Codex reports 78 suites / 2,622 tests and 28/28 gates green; not re-run here.

## Verdict: READY WITH NAMED CHANGES (two blocking, both small)

Safety design matches the approved plan: sandbox origin classified before any read; single-process fetch guard refusing other Dataverse origins and redirects; every write journaled with CAS before dispatch; the only PATCH path is a one-field allowlist bound to the scenario's exact value and a concrete ETag (`scenarioClient`); readiness through the unchanged true-only `fenceReadinessClient`; numeric phases through the existing status setter with sandbox admission parameterized and production defaults retained; suggestions created selected, uninvited, and verified field-by-field; emails must be Draft with no sent timestamp; no triage, request-status, or readiness-false write exists anywhere. Ready-run resource operations live in `run-ledger.js` per the addendum, with an advisory transaction lock on a dedicated connection and ownership rechecked on every fenced operation.

### Blocking

1. **The end-to-end flow cannot run: nothing produces a sandbox source bundle.** `scripts/rehearse-j27-factory-scenarios.mjs` requires `--bundle` carrying `sandboxScenarioSource: true` (readSourceBundle at the CLI's `sandbox_source_bundle` probe), but the only exporter, `scripts/export-test-request-source-bundle.mjs`, is production-only (`:56` imports `PRODUCTION_HOSTS`; `:140` reads `DYNAMICS_URL`). `buildSourceBundle` has no caller outside `source-bundle.js`. The owner would have to hand-write bundle JSON. Required change: give the exporter an explicit `--target=sandbox` branch that reads the sandbox source row and applicant abstract with GETs only, writes a bundle with `sandboxScenarioSource: true` and no documents, and refuses a production host on that branch; or have the J27 CLI build that bundle in-process from the already-read source row and save it under `--manifest-dir`. Either way, one documented command must produce the input the next command needs.

2. **Enforcement guard uses the wrong resolver and refused the preview.** `assertSandboxOrigin` (`j27-sandbox-scenarios.js`) requires the literal `DATAVERSE_DAL_ENFORCEMENT === 'on'`. The repository contract is `isDalEnforcementOn()` (`lib/services/dynamics-context.js:124-129`): literal `on` or `off`, otherwise on outside production. Local `.env.local` leaves it unset (verified: zero matches), so the guard refused before authentication. Required change: call `isDalEnforcementOn()` and refuse only when it returns false; keep `DATAVERSE_TARGET_INTERLOCK === 'on'` literal, since that flag is documented as explicit per environment. Test: unset with `NODE_ENV` not production passes; `off` refuses; both existing refusal tests stay.

### Non-blocking, fix before merge if cheap

3. **Ambient sentinel on the transport object.** `basic-clone-steps.js:512,569` widen preflight when `client.j27Scenario === true`, set by the CLI with `Object.assign` on the Dataverse client. It only unlocks reads, but a behavior switch on a mutable property of a transport object is easy to set by accident. Prefer an explicit `{ j27Scenario: true }` option through `runPreflight` and `buildCompilerMetadata`.

4. **Owner confirm covers the pre-provisioning plan only.** After confirm, the CLI provisions each run with `advanceRun`, then calls `previewScenario` and confirms the finalizer with that internal digest. This is by design (ETags and request numbers do not exist before create) and the plan said so, but the runbook must say that one confirm authorizes provisioning plus finalization for every selected scenario, and the report should include each internal finalizer preview so the owner sees what was written.

5. **`recheckStatusChange` lets `validateEffects` throw; `complete` catches and records a failure.** Asymmetric but acceptable for an owner-run recheck. Note only.

6. **Test mocks.** The service suite mocks `validateCloneManifest` and `verifyCloneRequestReadback` to no-ops, so `assertScenarioRow`'s manifest checks are exercised only by the three `requireActual` tests at the end. Acceptable since those validators have their own suites; negative tests do carry the unsafe input they reject, and the resource SQL test asserts the real `outcome='planned' AND dispatched_at IS NULL` fence.

### Verified contracts the new code depends on

- Receipt keys `kind`, `field`, `inputFingerprint`, `eTagBefore`, `eTagAfter`, `contentHash`, `suggestionId`, `destinationPersonId`, `index`, `exists`, `outcome` are all allowlisted in `run-ledger.js` `KEY_RULES` / numeric / boolean sets, and `planned_identity`, `source_provenance`, `readback` carry the same SQL CHECK (`054:263-268`), so no schema change was needed.
- `sandboxGetPersonById` honors `select` (`reviews-sandbox-deps.js:170-177`), so the `_wmkf_contact_value` check is real.
- `createReadinessJournal` and `assertChangeable` default to production and require an explicit `sandbox` argument; a sandbox status change without the J27 lock is refused (`status-change-runner.js` runStatusChange guard), tested with `requireActual`.
- Advisory lock key is per run; `assertJ27Lock` queries the lock connection, so a lost connection fails closed.

### Process notes

- Codex could not commit or push from its sandbox (worktree git metadata lives under the main checkout). After the two blocking fixes, the owner-side agent commits and pushes `codex/j27-factory-scenarios`.
- `package-lock.json` carries a pre-existing modification unrelated to this work; it is not to be committed with it.
- `check:agent-invariants` is red in this worktree for the missing per-machine symlink only.
