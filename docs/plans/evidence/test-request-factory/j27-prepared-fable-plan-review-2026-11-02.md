# Prepared J27 Factory — Fable plan review

Owner authorized source disclosure and possible subscription usage on 2026-11-02. Host CLI, OAuth only, environment whitelist, Read/Grep/Glob, safe mode, empty MCP configuration. Model: claude-fable-5-1. Permission denials: 0. No live services or writes.

**Verdict: READY WITH NAMED CHANGES.** The owner-approved fixture shape (Phase I Invited, Phase II Pending Committee Review, derived Request Status, readiness true last, Power Automate owns real intake) is consistent with the source. Six plan statements need correction before code review, and the plan is silent on two things the source forces: the finalization must be a post-ready owner operation, and it needs a migration.

## Whole-flow trace against source

- **Immutable run and manifest binding hold.** Every advance recomputes the plan digest and refuses a manifest whose create-body hash or bundle hash differs from the ledger row (`lib/services/test-requests/run-runner.js:427-465`, `basic-clone-steps.js:847-866`). Old manifests keep their digests only if the compiler still reproduces their bodies. See correction 3.
- **Terminal steps are fixed per recipe.** Only the last step of a recipe may mark the run ready (`run-runner.js:1079-1087`, `:2210-2216`, `:3276-3283`, `:4125-4130`). Adding a readiness step to the basic order would make verify advance instead of marking ready, which changes every in-flight basic run.
- **Status changes require a ready run.** Both the runner and the admin service refuse unless the ledger status is ready (`status-change-runner.js:97`, `admin-run-service.js:864`). The lease claim excludes ready runs (`run-ledger.js:890`). So the sequence the plan asked to "determine" is forced: run to ready, then Phase I Invited, then Phase II Pending Committee Review, then readiness. The plan should state this instead of deferring it.
- **Phase order is correct.** Invited is allowed only while Phase II is null (`status-transitions.js:56-60`), so Phase I must go first. Pending Committee Review produces no effects (`:47-49`).
- **Request Status derivation is evidenced.** A Phase II PATCH set Request Status to Phase II Pending by business rule on Request 1003302 (`docs/plans/TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md:25,98`). The plan's "verify by readback" is the right posture. The census already records a digest of the readback (`status-change-runner.js:227`), which the finalization can corroborate.
- **Reviewer consumers will see the fixture.** My Proposals requires readiness, Phase II Pending, PD ownership, and Phase II null or Pending Committee Review for J27 and later (`lib/services/reviewer-finder/my-proposals-service.js:142-149`). It does not exclude test rows. The clone's PD is the cloning admin (`basic-clone-steps.js:590-600`), so the fixture lands in that admin's list.

## Partial success, retries, ambiguous writes

- **Reusable contracts.** The resume rule is value-agnostic and works for false or null to true (`status-transitions.js:156-160`). The dispatch compare-and-set and "never re-send a dispatched change" posture are the model to copy (`status-change-runner.js:123-156`, `run-ledger.js:1256-1263`). The census reader is exported. The job wait, change-ability gate and interlock preflight are module-private (`status-change-runner.js:94-121`, `:158-196`) and need an export or a minimal duplicate.
- **Status fence cannot be reused.** It hard-requires an integer option equal to the fenced value (`production-write-fence.js:190`). The basic-run fence refuses every PATCH (`:119-134`). A readiness write needs its own narrow fence admitting exactly one boolean field on the destination path with a concrete If-Match and the source-name refusal.
- **Readiness is never read today.** Neither the clone readback projection (`basic-clone-steps.js:139-170`) nor the status runner's selects (`status-change-runner.js:57-58`, `:84`) include the readiness column. The plan's "must be false/unset before finalization" is unverifiable until the pre-read selects it. An already-true value must refuse unless this run's own journal row is complete.

## Async and observed effects

- **Phase I Invited is uncharacterized in production.** The only recorded Factory status changes are Phase II (Requests 1003302 and 1003310, `docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md:299`). The transition table expects Invited to create a draft email and a status-tracking row (`status-transitions.js:41-45`), and the replay guard will refuse a repeat without rerun (`:115-127`). The plan must name this as the first live producing transition and must treat those two allowed effects as expected, not as finalization failures.
- **Readiness PATCH reactions are unknown.** The automation inventory is lexical and explicitly cannot rule out indirect flows (`docs/plans/evidence/test-request-factory/b4-automation-evidence-2026-09-30.md:60,75`). The plan already requires a reaction check before the live test. Reuse the job-quiet wait and census after the readiness write so the result is observed, not assumed.

## Helper and durable surfaces

- **A migration is required, and the plan's wording conflicts with that.** The status-change table admits only the two phase columns with integer options (`lib/db/migrations/054_test_request_runs.sql:384-386`; mirrored at `run-ledger.js:688,1241`). The resource-kind CHECK is closed (`054:253-260`) and resource journaling needs a lease a ready run cannot hold. Line 108 of the plan says no new table is prescribed. Line 113 allows a migration for a reviewed extension. These must be reconciled by prescribing the migration.
- **Receipt grammar cannot carry a boolean before/after.** The value keys are date-shaped (`run-ledger.js:160`) and the boolean allowlist has no readiness key (`:182-185`). A typed column is cleaner than a new receipt key.
- **Update-ability of the readiness column is not evidenced.** The probe selected the update flag but the receipt does not record it (`scripts/probe-j27-readiness-contract.cjs:21`, `docs/plans/evidence/j27-readiness-production-2026-11-02.json`). Add a metadata preflight on the pattern of the create-ability check (`policy.js:145-172`) before the first PATCH.

## Symbol fan-out and UI meaning

- **"Ready" means ledger-complete everywhere today.** The run label (`shared/config/testRequestFactory.js:26`), the not-ready copy (`shared/components/admin/test-request-factory-copy.js:36`) and runbook step 4 (`docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md:42`) all describe the run, not staff readiness. The plan's copy change must split the two meanings in the run panel and status control rather than rename the run status.
- **Entry point is unstated.** The status route body is closed to field, option label and change id (`pages/api/admin/test-requests/runs/[runId]/status/index.js:50-57`), and the CLI has only set-status, recheck and abandon (`scripts/rehearse-test-request-sandbox.mjs:458-460`). The plan says no new route, so the finalization needs a named CLI mode.

## Required plan corrections

1. **State the forced sequence.** Replace "determine the smallest compatible create/status sequence" with: run to ready, Phase I Invited, Phase II Pending Committee Review, then readiness, as a post-ready owner operation. Do not add a recipe step.
2. **Prescribe the migration.** Rewrite line 108 to require one small typed journal table on the 058 cast-slot precedent (`docs/atlas/postgres-test-request-runs.md:338-340`): unique run id, ETag before, planned to dispatched to applied to complete or needs attention, boolean readback, sanitized error. Note it must be applied by hand to the managed ledger before the live test and that the schema fingerprint and parity tests change.
3. **Define the manifest discriminator for the status omission.** The source fence step recompiles the body and compares its hash (`run-runner.js:561-564`), and the compiler injects Phase II Pending unconditionally for production (`basic-clone-steps.js:649-658`, `policy.js:295-299`). The omission must key on an explicit new manifest value so pre-existing manifests recompile byte-identically, and the compiler must accept the explicit-omit form. Keep the status column in the fence's allowed columns (`production-write-fence.js:51-55`) so old bodies still POST.
4. **Narrow the verifier change.** The Phase II null check in clone verification stays (`basic-clone-steps.js:1482`) because verify always precedes status changes. Only the production status branch of the readback check needs to tolerate an absent body status (`sandbox-clone.js:160-165`). The final-pair check belongs in the finalization precondition.
5. **Rescope step 1.** Production admits only the basic recipe from a bundle (`basic-clone-steps.js:676-679`, `:883-889`), so "recipe-required saved AI outputs" cannot be part of a production fixture. The package is bundle documents plus metadata within the preview limits (runbook line 39).
6. **Add the missing preconditions and evidence items.** Select and refuse already-true readiness; metadata update-ability preflight; Phase I Invited named as uncharacterized with expected draft email and tracking row; readiness-write reaction check reusing the job wait and census.

## Smallest safe integration

- One migration adding the typed finalization table with a unique run id.
- One sibling runner beside the status runner that reuses the resume rule, the census, the interlock preflight and the ready-run marker gate, with the job wait and gate exported from the status runner.
- One new narrow fence in the production write fence module admitting only the readiness boolean on the destination with a concrete If-Match.
- One compiler discriminator for new manifests, plus the readback-check tolerance.
- One owner-run CLI mode with a read-only preview and an explicit confirm, on the abandon and slot-binding precedent. No new route in this increment.
- Copy split for run-complete versus reviewer-ready in the run panel, status control and runbook.

Gate the finalization on the live pair and readiness read, no open or needs-attention status change on the run, the journaled Request Status digest matching Phase II Pending, and the copied-file re-verification from the ledger's file receipts. Word the gate on live state corroborated by the journal, not on "two complete journal rows", since a no-op refusal (`status-transitions.js:100`) means a phase already set by automation leaves no row.
