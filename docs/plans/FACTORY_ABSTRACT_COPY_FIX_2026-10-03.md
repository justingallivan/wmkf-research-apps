---
title: Test Request Factory Abstract Copy Fix
domain: test-request-factory
kind: execution-plan
status: complete
summary: Abstract copying shipped in PR 425; the separately authorized Request 1003303 backfill is verified. New-clone production smoke remains unperformed.
canonical: false
cataloged: 2026-10-03
owner: product-engineering
related:
  - docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md
  - docs/plans/TEST_REQUEST_FACTORY_ADMIN_FORM_PLAN_2026-10-01.md
  - docs/atlas/postgres-test-request-runs.md
---

# Test Request Factory: copy applicant abstract on ordinary clones

Status: **MERGED AND DEPLOYED.** [VERIFIED via GitHub and Vercel] PR #425 merged as `ed14e90a4` after all checks passed. Production deployment `dpl_Ac2a21TX57PXgTcMJ57FSCrTJpKF` is Ready and serves `applications.wmkeck.org`. The separately authorized backfill below is verified; a new-clone production smoke has not been performed.

## Problem and evidence

At the pre-change baseline (`d1eae6fd3`), the ordinary Factory `basic` clone copied the source purpose and requested amount but omitted the applicant-authored abstract. The compiler body in `lib/services/test-requests/policy.js` then contained `akoya_purpose` and `akoya_request` only; its allowlist, expected-type map, metadata validation, and value validation were the enforcement points for request fields. `compileBody` in `lib/services/test-requests/basic-clone-steps.js` was called both when preparing a manifest and when rebuilding it before the first write. `verifyCloneRequestReadback` in `lib/services/test-requests/sandbox-clone.js` checked copied purpose and amount but had no abstract assertion. The clone source projection and source-change fence in that file likewise omitted `wmkf_abstract`.

At the pre-change baseline (`d1eae6fd3`), the source exporter read `wmkf_abstract` only through the `--with-pre-site` dependency, which emitted bundle v4 with a sibling `abstract` field. Ordinary exports were v2 or v3 and omitted it. `source-bundle.js` validated `abstract` only for v4, and historical P4 said the field remained outside the basic projection and create body. This describes the baseline before the change; v2-v4 behavior and hashes remain compatibility contracts.

`[HISTORICAL: pre-repair live probe]` Source Request 1003222 (`e43ae6ea-698f-f111-8076-6045bd018a07`) has a 2,476-character `wmkf_abstract`; `wmkf_abstractformatted` and `wmkf_abstractapproved` are empty. Clone Request 1003303 (`2d58a2a4-5c77-4193-b249-cc37b85b8040`) has all three abstract fields empty. The owner clone receipt is run `e33fa857-4b00-4c60-94da-77d4406d4027`; its evidence is in the Factory ledger, not the shared `POSTGRES_URL` database.

## Contract

An ordinary basic clone copies the exact source `wmkf_abstract` string, including whitespace and line breaks, to the new Request's `wmkf_abstract`. Empty or null source abstract remains null/omitted under the existing Dataverse create convention. The clone does not copy or synthesize `wmkf_abstractformatted` or `wmkf_abstractapproved`; those have separate grantee-deliverable ownership and provenance. The field is source content, so it must come from the server-resolved source/bundle and never from browser input. The existing source revision fence must cover it, and post-create verification must compare the exact value.

## Implemented contract (PR #425)

1. Add a new additive source-bundle version (v5) that carries a required `abstract` member for every newly exported ordinary basic bundle as well as preserving any existing reviewers and Pre-Site sections. The member must be present, with JSON `null` representing Dataverse null or empty source text, or a non-empty string preserving all characters exactly (including whitespace-only strings). Export the abstract from the same source Request snapshot; enforce the current Memo metadata length ceiling and the existing bounded text policy. Keep v2-v4 bundle parsing and projection byte-compatible: v2/v3 bundles remain abstract-free; v4 keeps its existing Pre-Site and abstract meaning. Existing stored bundle hashes and reserved run manifests are immutable.
2. Keep abstract separate from `source.request`, whose shape and revision semantics are already embedded in historical bundle hashes. In the new manifest, bind the abstract through the bundle digest and the compiled create-body digest. Require v5 for **every new run reservation** that starts from the basic clone, including any derived recipe that uses the basic `create_request` step, and enforce this at both the admin form's Confirm path and CLI reserve path. The admin form must reject a still-unconfirmed v2-v4 draft at Confirm and require a fresh export. Preserve ledger-first idempotent return/replay for already-reserved v2-v4 runs; their manifest/body hashes, source fence, and verification must continue under the legacy contract.
3. Extend the strict server-side draft compiler allowlist, `POLICY_FIELDS`, expected field type, createability/metadata checks, and string length checks for `wmkf_abstract`. `compileBody` supplies it only from the validated bundle. Map a missing or empty source abstract to JSON `null` and omit it from the Dataverse create body; preserve every non-empty string exactly, including whitespace-only strings, and verify null readback for the omitted case. During pre-create source fencing, re-read the source abstract, compare its normalized null/empty or exact string value to the bound v5 bundle member, and refuse on drift; do not alter the v2-v4 fence contract. Bound each target by its own live Memo metadata rather than a hard-coded Pre-Site limit.
4. Add the exact field to the source read select(s) needed for v5 and ensure export/readback uses the expected response key. The bundle remains private to the existing Factory artifact path; the ledger continues to store hashes/identifiers only.
5. Extend `verifyCloneRequestReadback` so v5 manifests require destination abstract equality under the null/empty normalization above. For v2-v4 manifests, preserve the old expectation that the field is not part of the body. Add regression coverage for absent/null/empty and non-empty source values, whitespace preservation, metadata too short/not createable/unknown/wrong type, source drift between export and create, destination mismatch, rejection of a new reservation from a v2-v4 draft, preservation of an already-reserved legacy run, and v2-v4 fixture/hash compatibility. Tests must include an actual would-be-copy abstract so a missing guard or projection cannot pass vacuously. Existing standalone sandbox `--prepare` from a source GUID or v2-v4 bundle remains a legacy rehearsal flow; it is sandbox-only and cannot create a new production reservation.

Expected focused files: `source-bundle.js`, `export-test-request-source-bundle.mjs`, `admin-preview-service.js` if its source bundle/read contract requires a matching projection, `policy.js`, `basic-clone-steps.js`, `sandbox-clone.js`, and focused Factory unit tests (`test-request-source-bundle`, exporter CLI, policy, basic clone steps, and sandbox clone tests). Confirm every concrete caller of `compileBody`, source fencing, and `verifyCloneRequestReadback` before implementation. No migration is expected because `akoya_request.wmkf_abstract` already exists.

## Compatibility and scope boundaries

Do not rewrite the historical P4 record in `TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md`; add a dated correction/reference after implementation that says the copy policy changed and names the new bundle version. Keep old bundles/read paths accepted and their hashes unchanged. Do not change the formatting/approved abstract workflows, status, owner, contact, request amount, or unrelated clone policy. Do not generate abstract content with AI or send email. Do not write live Dataverse records during build or verification.

## Authorized one-record backfill — completed October 3

[VERIFIED via guarded PATCH and exact readback] The owner separately approved copying the source applicant abstract into Request 1003303. Fresh checks pinned the exact source/destination/run, the Ready ledger receipt, source revision `98622844`, the 2,476-character source value and SHA-256, empty destination, updateable Memo metadata and fresh destination ETag. One `If-Match` PATCH wrote only `wmkf_abstract`, returned HTTP 204, and readback matched the full string and SHA-256 exactly. Destination revision became `101913598`; the Factory run remained Ready. The source was not modified; no email was sent. This one-off repair ran outside the Factory runner with the normal production write interlock enabled and a task-specific, current-day acknowledgment.

The redacted durable receipt is `docs/plans/evidence/FACTORY_AND_EMAIL_REPAIR_CHECKPOINT_2026-10-03.json`; the private local execution receipt is `/tmp/factory-abstract-repair-receipt.json`. Full abstract text and credentials are not included in this document. Downstream automation effects were not comprehensively audited; the approved bounded verification establishes the intended field result, identity and retained run state. No additional backfill is authorized by this record.

## Contract-reconcile surface and verification

- **Change surface:** Factory export → private bundle → strict create-body compiler → pre-write source fence → destination readback verification for `akoya_request.wmkf_abstract`.
- **Entry points:** exporter CLI and admin form source lookup/Confirm/advance; Factory runner's pre-create fence and `verify` step.
- **Persistence:** Dataverse `akoya_request.wmkf_abstract`; private Factory Blob bundle/manifest. No schema change.
- **Consumers:** Factory clone readback verifier, the ledger's create-body/bundle digests, old v2-v4 bundle readers, and the existing grantee-deliverable abstract flow (which must keep formatted/approved fields separate).
- **Prior finding:** ordinary clone omits the source abstract; live source/destination facts above are task-provided and marked accordingly.
- **Partial success:** one Request create is the unit; if write outcome is ambiguous, existing preallocated-GUID recovery and readback rules remain. A missing/mismatched abstract makes verification fail and parks the run for attention; never silently mark ready.
- **Async/stale state:** exporter must retain its parent Request revision fence; execute re-reads under the existing source fence immediately before create. No browser-supplied text or new background work.
- **Helper semantics:** extend the existing explicit allowlist/compiler and source projection. Do not generalize to other abstract fields or change the v2-v4 read projection.
- **Durable surface:** no migration, manifest, Atlas schema update, or API security route change is expected. Update the Factory plan/history and the Factory ledger Atlas only if its durable description of copied fields currently enumerates the basic create body; verify with a literal-field search before editing. Historical plan language about P4 remains intact and receives a dated superseding note.
- **Symbol fan-out:** search `wmkf_abstract` plus compiler/source-bundle symbols through all readers and projections. Confirm the grantee portal still reads/writes formatted/approved fields with their present semantics.
- **Scoped verification after build go:** focused source bundle, exporter CLI, policy, sandbox clone, basic clone runner and Factory admin tests; relevant Factory/read/write boundary gates per `docs/CI_GATES_REFERENCE.md`. Do not run a live write, AI generation, email, deploy, merge, or backfill.

## Review and implementation status

Sol reviewed the original implementation and the bounded Fable follow-up. Fable's accepted findings are addressed: the preview path does not fetch unused abstract metadata; v2-v4 Confirm rejection and CLI reserve guard have explicit coverage; tests exercise v5 manifest compilation and the runner's source-fence recompile; UI copy asks for a fresh lookup; and the missing Pre-Site error reports the actual bundle version. Standalone sandbox `--prepare` remains its legacy rehearsal path and cannot create a production reservation. The feature is merged and deployed as recorded above; only the one-record backfill has live write/readback proof, not a new-clone rehearsal.

`[VERIFIED via read-only Dataverse metadata probe by root, 2026-10-03]` Production `wmkf.crm.dynamics.com` exposes `akoya_request.wmkf_abstract` as a createable, optional Memo with `MaxLength=5000`. Sandbox `orgd9e66399.crm.dynamics.com` exposes the same field as createable, optional Memo with `MaxLength=2000`. Compiler validation reads the active target's metadata, so a v5 clone fails before create if its exact source text exceeds that target's maximum; the task-provided 2,476-character source fits Production and exceeds Sandbox. These are field metadata facts, not a new read of the cited Requests or proof of a live clone.

## Fact reconciliation evidence

**Mode A — changed fact.** Source trace: the exporter selects `wmkf_abstract` from the source Request row and fences the parent revision; `buildSourceBundle` writes it as required v5 `abstract`; `buildCloneManifest` passes only the validated bundle value to `compileBody`; `fenceSource` compares the live source and body against the bundle; `verifyCloneRequestReadback` checks the destination. The admin preview and run paths load the field's metadata, and both admin Confirm and CLI `runReserve` require v5 for new reservations. Existing same-key admin reservations return before reading a draft; old bundle projection/hash tests remain in place. Dataverse stores the copied field, the private Factory blob holds the source bundle/manifest, and the ledger receives digests only.

Durable search: old exporter/version/copy-policy phrases were searched across `docs`, `scripts`, `lib`, and tests. The remaining v2-v4 statements are dated historical recipe records; the earlier P4 sentence is explicitly superseded by the dated current-policy amendment. The current ledger Atlas now states v5 bundle contents and digest-only ledger persistence. No other current copy-policy contradiction was found. The source and clone were freshly re-probed for the authorized backfill. Deployment and exact backfill readback are recorded above; no new-clone production verification is claimed.

Disconfirming checks: v5 source drift and destination readback mismatch tests fail closed; unconfirmed v2-v4 drafts are rejected before run artifacts are written; an already-reserved same-key run returns before bundle access; v2/v3 golden bundle digests remain pinned. Final follow-up verification: focused Factory suites **9 passed, 412 tests passed**; `check:types` passed; ESLint passed for all changed JavaScript files; `check:doc-currency` and its self-test passed (13/13 fixtures); `git diff --check` passed. The original implementation gates also passed `check:dataverse-access-layer` and its self-test sequentially, and both Factory CLIs loaded under plain Node. Those implementation checks performed no live write, migration or deployment; the later owner-authorized merge and backfill are recorded above.
