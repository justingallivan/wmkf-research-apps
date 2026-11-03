# Finish the J27 Test Request Factory

Status: **IMPLEMENTED ON REVIEW BRANCH; local checks and Fable reviews passed. Migration 094 is applied to both managed ledgers; bounded prepared-fixture test passed on Request 1003456 after the Fable-reviewed PDF correction. Merge/deployment remain held; authenticated app UI and reviewer-workflow proof remain separate.**
Owner: Codex. Date: 2026-11-02 Pacific.
Boundary: finish the Factory for reviewer testing; broader PD workflow stays deferred.

## Owner decision and readiness ownership

[VERIFIED via Justin's 2026-11-02 messages] Start with a fixture that lands at
`wmkf_readyforreview=true`, sufficient for testing reviewer workflow. Revisit
whether earlier-cycle-stage testing is useful later. This replaces the prior
proposal to create a submitted fixture and require a real Power Automate run.

[VERIFIED via branch source, local tests and bounded 2026-11-03 fixture finalization] The Factory
can copy a completed, suitable package into a fresh marked test request.
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
readiness write and readback succeed. Keep the existing clone recipe unchanged: complete the Factory run first, then
use its guarded status setter for Phase I followed by Phase II, then finalize
readiness through a named owner CLI operation. Internal run `ready` means clone
provisioning is complete; staff readiness remains a separate Boolean. Never
bundle the phase updates into an unguarded patch.

## Current evidence and invariants

[VERIFIED via branch source and regression tests] The legacy compiler path still
supplies Phase II Pending directly as Request Status. New prepared Production
J27+ manifests explicitly omit it and start readiness false. `verifyClone`
retains its non-null Phase II refusal because clone verification precedes phase
advancement. The separate finalizer checks the final pair and derived status.
Existing pre-J27 behavior is outside this bounded correction.
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
and must not be modified as Factory destinations. The later source/metadata inventory below is read-only; neither example is a
Factory destination.

## Implementation contract and remaining live proof

1. **Define the minimum reviewer-test package from actual consumers.** Inventory
   a suitable completed source when read access is authorized. Identify the
   documents and metadata used by reviewer
   discovery, invitations/material release, acceptance and review submission.
   Production supports the Basic recipe only. Require its canonical reviewer
   proposal plus applicant abstract; copy the other
   recognized bundle documents under existing rules. Saved AI outputs and
   completed reviews are not part of this increment. A complete D26 source may be usable if it satisfies the
   destination consumers and its known test limitations are accepted; do not
   insist on a ready J27 source when none is available. Connor's proposed J27
   staff-PDF root/name is not proof of a file. Verify actual source/destination
   naming and preserve provenance, copy/rename rules and byte-integrity checks.
2. **Correct new J27 fixture statuses and verification.** Omit direct Request
   Status writes, resolve the phase options from metadata and verify the final
   pair plus derived status. Keep clone verification before advancement, including the null Phase II
   check. Check the final phase pair in the separate finalizer. Keep readiness unset until finalization. Update preview and
   confirmation copy to say prepared reviewer-workflow fixture, not intake test.
3. **Finalize readiness with a guarded, recoverable operation.** Re-read the
   destination test marker/run identity and the verified package/status inputs.
   Use a concrete ETag and a true-only readiness patch on the exact run-owned
   destination. Add a small typed journal table with immutable `(run_id, attempt)` identity, one open attempt per run, and
   planned/dispatched/applied/complete/needs_attention/abandoned states, before ETag,
   Boolean readback and sanitized error. The operation is owner CLI only, with
   read-only preview and explicit confirmation; no new HTTP route. The managed ledger migration must be applied to BOTH operational ledgers
   before deploying this fingerprint; it affects every Factory mode, not only
   finalization. [VERIFIED 2026-11-03 via the ledger runner and fingerprint check]
   Justin authorized and completed migration 094 on both managed ledgers, accepting
   interruption of the old deployed Factory. Merge/deployment remain held by
   owner instruction; the old code rejects the extra schema until compatible
   code is promoted. Do not bypass the guard.
   Validate readiness update-ability from live metadata. Refuse already-true
   readiness unless a dispatched/applied/completed journal proves this operation.
   Observe jobs and census effects after readiness, rather than assuming no reaction.
   If the result is ambiguous, reconcile by reading before retrying. A repeated
   request must not blindly issue another patch. Stale/missing destination artifacts or ownership/status mismatches block
   finalization. After cloning, provenance comes from the hash-bound saved bundle
   and exact verified destination byte/OOXML-attestation hashes, not from the
   original source revision or export TTL. Recheck request state/ETag after the
   single heavy package pass. A separate exact-destination owner recovery can
   abandon an unready attempt only after all possible senders are stopped; the
   next finalization verifies the package and then plans with a fresh ETag; prior attempts remain durable and every mutation is
   attempt-bound. Already-true unexpected effects remain an inspection stop,
   with observed IDs retained; recovery cannot approve or clear them. Read back true before declaring
   the fixture ready. Do not expose a client-supplied bypass for these checks.
4. **Prove one prepared reviewer fixture.** Local tests, then owner-authorized
   bounded Production creation/copy/status/readiness writes on a fresh destination.
   Verify source unchanged, copied package correct, phase pair correct, readiness
   true, dashboard/actionable visibility and observed effects. Exercise reviewer
   workflow separately using the existing isolated test pathways. Email sends,
   external actions and cleanup require their own explicit test scope; creation
   is not evidence those later steps succeeded.

## Acceptance, release and deferred scope

[VERIFIED locally for code/tests; operational release and live criteria remain open]
- Success requires the intended statuses, required artifacts and final readiness
  readback; no true stamp on an ordinary record, another run's fixture or an
  incomplete package. Test false/null/true and stale/missing required artifacts.
- Tests include ambiguous writes, ETag conflicts, ownership mismatch, repeated
  finalization, resumed old manifests and forbidden effects with real negative
  inputs present. Prove no status/readiness write is added to historical runs.
- Preserve earlier-cycle behavior and existing recipes. An explicit new manifest
  value selects prepared fixtures and a distinct create body (readiness false,
  omitted Request Status), pinned by the reserved body hash. Old manifests
  recompile byte-identically and cannot finalize readiness. One typed journal
  table is required; no new route, recipe or background worker.
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
necessary. The plan alone does not authorize Production writes or reviewer communications.
Justin separately authorized the 2026-11-03 bounded fixture test recorded below;
reviewer sends remain outside that scope.

Planning review: Claude Fable returned READY WITH NAMED CHANGES; this revision
incorporates its sequence, journal, compatibility, metadata and UI corrections.
[Review receipt](evidence/test-request-factory/j27-prepared-fable-plan-review-2026-11-02.md).
Phase I Invited is the first uncharacterized live producing transition; existing
guards allow its draft email and tracking effects. A bounded live test must
explicitly account for them and characterize readiness reactions.

[VERIFIED 2026-11-02 via read-only source inventory](evidence/test-request-factory/j27-prepared-source-inventory-2026-11-02.json):
all six Research J27 requests were unready; six sampled invited D26 sources had
all seven recognized documents. This metadata establishes candidates, not byte
integrity or authorization to create a fixture. The source probe downloaded no
document bodies and made no Production writes.


## Implementation verification

[VERIFIED locally, 2026-11-02] The prepared compiler, destination-only package
verification, typed attempt journal, owner finalization/recovery commands and
preview diagnostics are implemented. Fable reviewed the plan and code; every
blocking finding and the bounded recovery/inspection corrections are closed.
[Final Fable receipt](evidence/test-request-factory/j27-prepared-fable-final-review-2026-11-02.md).
[Whole-flow evidence](evidence/test-request-factory/j27-prepared-implementation-2026-11-02.md).
[VERIFIED 2026-11-03 via the ledger migration runner and `check:factory-ledger`] Migration 094 is applied to both managed ledgers, and both match the 054+058+094 fingerprint. Request 1003456 passed clone verification, both guarded phase transitions and journaled readiness finalization after the narrow Fable-reviewed GOverify PDF replacement correction. Final state: J27, Phase I Invited, Phase II Pending Committee Review, derived Phase II Pending, readiness true; no observed email/tracking/payment effects. Read-only Foundation recheck passes. Authenticated app UI and reviewer invitation/acceptance/submission remain unexercised; marked-test isolation is unchanged. [Live receipt](evidence/test-request-factory/j27-prepared-live-proof-2026-11-03.md).
