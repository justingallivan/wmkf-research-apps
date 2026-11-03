# Finish the J27 Test Request Factory

Status: **PLANNED; prepared reviewer-workflow fixtures are the owner-selected starting point.**
Owner: Codex. Date: 2026-11-02 Pacific.
Boundary: finish the Factory for reviewer testing; broader PD workflow stays deferred.

## Owner decision and readiness ownership

[VERIFIED via Justin's 2026-11-02 messages] Start with a fixture that lands at
`wmkf_readyforreview=true`, sufficient for testing reviewer workflow. Revisit
whether earlier-cycle-stage testing is useful later. This replaces the prior
proposal to create a submitted fixture and require a real Power Automate run.

[PLANNED] Copy a completed, suitable package into a fresh marked test request.
The Factory may set readiness true **only on that run-owned test destination,
after its status and required copied-artifact checks pass**. This is a narrow
fixture-finalization operation, not permission to mark ordinary requests ready.
Power Automate continues to own readiness for real intake. The Factory does not
copy a source's readiness value or claim it reran assembly/AI processing.

| Field | Final fixture value |
|---|---|
| `wmkf_phaseistatus` | Invited |
| `wmkf_phaseiistatus` | Phase II Pending Committee Review |
| `akoya_requeststatus` | Derived by Dynamics; verify Phase II Pending by readback |
| `wmkf_readyforreview` | true, written last after required verification |
| Test marker/run identity | Exact Factory-owned destination and run |

Before finalization readiness must be false/unset; a partial fixture must not
become visible prematurely. Factory provisioning success and staff-readiness
are separate facts; do not report a reviewer-ready outcome until the final
readiness write and readback succeed. Keep status changes in the existing
guarded order (Phase I then Phase II), with readback/observation. Determine the
smallest compatible create/status sequence from the existing immutable run
contract; do not bundle both phase updates into an unguarded patch.

## Current evidence and invariants

[VERIFIED via inspected source]
`policy.js` `addProductionFields` and `basic-clone-steps.js` `compileBody` currently
supply Phase II Pending directly as Request Status. `verifyClone` rejects a
non-null Phase II Status. New J27+ runs need the derived-status and final-pair
contract above; existing pre-J27 behavior is outside this bounded correction.
Old reserved manifests, payload hashes and resumed runs must retain their
original meaning and must not gain a readiness write on resume.

The existing status setter restricts writes to marked, run-owned test requests,
resolves live option metadata and uses ETags, effect/replay guards and delayed
observation (`status-change-runner.js`, `status-transitions.js`). Reuse those
contracts; do not introduce a general status or readiness editing endpoint.

[VERIFIED via Connor's relayed answer] External automations do not yet exclude
test requests. The marker is identification, not suppression. Preserve existing
Foundation/synthetic-contact isolation, source preservation, email/payment
observation, ambiguity recovery and interlocks. The readiness-finalization
write is a new write seam whose possible reactions must be checked before an
owner-authorized live test; this does not require running the intake pipeline.

[VERIFIED via earlier read-only evidence] Examples 1003391 and 1003384 were
unready and not test-marked. They do not establish a complete golden package
and must not be modified as Factory destinations. No new live read occurred
for this plan revision.

## Implementation steps

1. **Define the minimum reviewer-test package from actual consumers.** Inventory
   a suitable completed source when read access is authorized. Identify the
   document(s), metadata and any recipe-required saved AI outputs used by reviewer
   discovery, invitations/material release, acceptance and review submission.
   Require only what the chosen test/recipe uses; recreating all intake AI output
   is not a prerequisite. A complete D26 source may be usable if it satisfies the
   destination consumers and its known test limitations are accepted; do not
   insist on a ready J27 source when none is available. Connor's proposed J27
   staff-PDF root/name is not proof of a file. Verify actual source/destination
   naming and preserve provenance, copy/rename rules and byte-integrity checks.
2. **Correct new J27 fixture statuses and verification.** Omit direct Request
   Status writes, resolve the phase options from metadata and verify the final
   pair plus derived status. Adapt the verifier to that pair without weakening
   unrelated checks. Keep readiness unset until finalization. Update preview and
   confirmation copy to say prepared reviewer-workflow fixture, not intake test.
3. **Finalize readiness with a guarded, recoverable operation.** Re-read the
   destination test marker/run identity and the verified package/status inputs.
   Use a concrete ETag and a true-only readiness patch on the exact run-owned
   destination. Record intent/dispatch/outcome durably through the existing run
   journal or a deliberately reviewed extension; an in-memory flag is insufficient.
   If the result is ambiguous, reconcile by reading before retrying. A repeated
   request must not blindly issue another patch. Stale/missing artifacts or
   ownership/status mismatches block finalization. Read back true before declaring
   the fixture ready. Do not expose a client-supplied bypass for these checks.
4. **Prove one prepared reviewer fixture.** Local tests, then owner-authorized
   bounded Production creation/copy/status/readiness writes on a fresh destination.
   Verify source unchanged, copied package correct, phase pair correct, readiness
   true, dashboard/actionable visibility and observed effects. Exercise reviewer
   workflow separately using the existing isolated test pathways. Email sends,
   external actions and cleanup require their own explicit test scope; creation
   is not evidence those later steps succeeded.

## Acceptance, release and deferred scope

[PLANNED]
- Success requires the intended statuses, required artifacts and final readiness
  readback; no true stamp on an ordinary record, another run's fixture or an
  incomplete package. Test false/null/true and stale/missing required artifacts.
- Tests include ambiguous writes, ETag conflicts, ownership mismatch, repeated
  finalization, resumed old manifests and forbidden effects with real negative
  inputs present. Prove no status/readiness write is added to historical runs.
- Preserve earlier-cycle behavior and existing recipes; identify manifest/version
  compatibility changes before editing persisted contracts. No new table, route,
  recipe or background worker is prescribed by this plan.
- Run compiler/runner/status/file/route/UI tests and relevant gates/self-tests
  sequentially (types, Atlas, DAL/OData, route security/boundaries, status parity,
  docs; migrations only if a reviewed durable extension needs one). Independent
  contract review before completion. Runtime work uses a feature PR; merge and
  live operations are separate deliberate actions.

Contract-reconcile path: preview/source package → immutable run → clone and
copied artifacts → guarded phase changes → verification → journaled readiness
finalization → readback → reviewer-workflow consumers. Partial success remains
recoverable and hidden until finalization; missing completion proof is not success.

Deferred: submitted-stage fixtures, triggering Power Automate and verifying its
intake assembly/AI pipeline, broader PD dashboard/state workflow, and real-request
readiness editing. The Power Automate entry trigger is no longer a blocker to
this increment. A suitable source and bounded required-package checklist remain
necessary. This plan records design authorization, not permission to execute
Production writes or send reviewer communications.

Planning verification: independent read-only review found no material issues in
this revised prepared-fixture scope. All nine scoped documentation gate/self-test
commands and diff checks passed. No runtime or Production changes were made.
