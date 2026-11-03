# Finish the J27 Test Request Factory

Status: **PLANNED; no implementation or live actions authorized by this plan.**
Owner: Codex. Date: 2026-11-02 Pacific.
Boundary: make usable J27 test requests; broader PD staff workflow stays deferred.

## Readiness path

[PROPOSED approach selected for this plan] Use the actual Power Automate handoff.
The Factory prepares a submitted fixture; Connor's processing performs assembly
and AI analysis and sets `wmkf_readyforreview=true`. The Factory never copies a
source's ready marker or stamps true itself. This follows Connor/Justin's stated
ownership and avoids inventing a second completion mechanism. It does not claim
that a Factory create currently triggers that processing.

Distinguish Factory provisioning `run.status=ready` from the Dataverse readiness
Boolean: the former means the clone operation passed its checks, not that staff
can see the request. A prepared clone can legitimately await external processing.
The UI/receipt must make this distinction without saying staff-ready prematurely.

There are two useful final targets, not two new recipe families:

| Target | Phase I Status | Phase II Status | Handoff |
|---|---|---|---|
| Submitted fixture | Pending Committee Review | null | Ready Boolean remains false/unset until Power Automate finishes |
| Advanced fixture | Invited | Phase II Pending Committee Review | Provision and process first; advance through the existing guarded status setter |

Advanced is an end target, not permission to bypass processing. Preserve the
existing one-field-per-change contract: Phase I first, then Phase II, with
readback/observation between changes. If processing already set a target value,
use existing no-op/readback behavior rather than replaying an effect-producing
transition. For new J27+ runs the Factory does not write
`akoya_requeststatus`; Dynamics derives it. Existing pre-J27 creation behavior
is preserved by this bounded increment; correcting its direct status write is
separate work, not a claim that it follows Connor's latest rule. Do not treat a merely expected derived value as a successful readback.

## Current evidence and invariants

[VERIFIED via source inspection]
`lib/services/test-requests/policy.js` `addProductionFields` and
`lib/services/test-requests/basic-clone-steps.js` `compileBody` currently send a
fixed Phase II Pending Request Status. `verifyClone` rejects non-null Phase II
Status. Both need correction for the J27 targets above. Existing source-bundle,
manifest/hash, journal, ambiguity recovery and source-preservation contracts
must remain intact; changing compiled payloads must not reinterpret existing
reserved manifests or resume an old run under a different contract.

The status setter already writes Phase I/II separately and restricts writes to
marked, run-owned test requests. It uses metadata option resolution, ETags,
effect/replay guards and delayed observation (`status-change-runner.js`,
`status-transitions.js`). Reuse it; do not add a generic status-writing endpoint.
The earlier characterization proves API updates can activate Request Status
Business Rules; verify the new J27 create/update path rather than assuming
create has identical behavior to update.

[VERIFIED via Connor's relayed answer] External automations do not yet exclude
test requests. A marker is identification, not external-flow suppression.
Preserve the Foundation/synthetic cast, test-isolation behavior, bounded
observation and payment/email checks. Connor's expectation of no consequential
advancement effects does not authorize bypassing existing safeguards.

[VERIFIED via existing read-only evidence]
1003391 and 1003384 were J27/Phase I Pending, readiness false, test marker false.
They are source examples, not complete golden fixtures or disposable Factory
outputs. Never modify them as part of a clone test. The Production check also
found no ready J27 Research example. No new live read was performed for this plan.

## Four implementation steps

1. **Close the handoff and file contract with Connor.** Identify the actual,
   supported way a marked Factory-created request enters his processing. Record
   any required input fields/trigger and who runs it. Confirm the implemented
   J27 staff PDF path/name and required input/output files, using read-only
   inventory when authorized. His root-folder `{AKA}_{Program Service Area}_Staff
   Version_{Request #}` naming was an intended convention, not a proven file.
   Keep the upstream files-ready trigger distinct from downstream
   `wmkf_readyforreview`. Leave new staff-state/program-at-submission fields
   alone unless this processing requires them; obtain their real schema first.
2. **Fix creation and verification.** Set initial Phase I Pending Committee Review
   and Phase II null from verified metadata; omit direct Request Status writes.
   Preserve earlier-cycle behavior by scoping the new contract to the linked
   J27+ era. Validate derived status by readback, preserve manifest compatibility,
   and update preview/confirmation text so the target and processing dependency
   are explicit. Do not add automatic repeated status PATCHes to force a value.
3. **Complete the document and advancement paths.** Adapt existing discovery,
   copy/rename and verification to the confirmed J27 file contract. Clearly
   separate source inputs copied by the Factory from outputs Power Automate
   owns; do not prepopulate generated destinations that its flows replace unless
   Connor's supported processing contract requires that. Never pre-stamp AI
   completion. After processing, verify the required outputs/readiness and use
   the guarded setter for the advanced target. Report incomplete processing as
   pending external work, not a successful staff-ready advanced fixture. Provisioning
   verification and post-processing verification are separate: the existing
   copied-file census protects the clone operation, while a handoff verifier
   checks the expected PA outputs/replacements. Do not rerun the pre-processing
   exact-file census and report legitimate PA-generated files as clone corruption.
4. **Prove one submitted and one advanced outcome.** Local tests first, then
   owner-authorized bounded Production create/processing/status changes on fresh
   marked destinations, under the normal interlock. Record statuses, output
   files, effects and source preservation. Observe the submitted fixture before
   processing, then its actual readiness handoff, then the advanced fixture's
   visibility in Workbench/Reviewer Finder. No cleanup, deactivation or deletion
   is implicitly authorized by the test plan.

## Acceptance and release

[PLANNED]
- Tests cover both target pairs, no direct Request Status write, metadata option
  failures, readback mismatch, readiness false/null/true, and source marker strip.
- Old manifests/runs retain their payload/hash meaning and cannot gain new writes
  on resume. Existing recipes and pre-J27 fixtures retain their prior semantics.
- Tests include actual missing/extra files, processing failures, ambiguous writes,
  duplicate advancement attempts and forbidden effects. No decorative empty
  fixtures that pass without exercising the exclusion/recovery guard.
- Required files and readback determine fixture validity; metadata/status alone
  does not prove assembly or AI analysis occurred. PA's true value is its handoff;
  accepted rare-rerun risk still needs no new polling or rerun protocol.
- Re-run Factory compiler/runner/status/file/route/UI suites and relevant sequential
  gates/self-tests (types, migrations if needed, Atlas, DAL/OData, status parity,
  route security/boundaries and docs). Update the Factory owning contracts/Atlas
  with the implementation, coordinate durable-file ownership, and obtain an
  independent contract review. Runtime changes use a feature PR; promotion and
  live operations are separate deliberate actions.

Contract-reconcile: caller preview/target → immutable run payload → clone/file
provisioning → external PA handoff → status setter → readback → staff/reviewer
consumers. Partial success and ambiguous outcomes remain journaled; external
completion is not inferred from Factory run success. No new persistence is
prescribed; use the existing run/status journals and determine any required
manifest/version compatibility change before editing them.

## What blocks finishing, and what does not

The external integration question is specific: **how does a Factory-created
request enter the real Power Automate processing, with which required inputs?**
The implemented file contract and a completed processing run are also needed
for end-to-end proof. These are finite Factory dependencies. Until answered,
local status/compiler work can proceed, but the complete handoff is unverified.
If no supported processing path exists yet, report that dependency; do not
silently switch to a Factory-owned readiness stamp.

The broader PD state model, dashboard redesign and rare-rerun behavior do not
block this Factory increment. This plan does not authorize starting Power
Automate, generating AI outputs, or writing any Production record.

Planning verification: independent read-only review resolved the J27-only
no-direct-status-write scope and the separate post-processing file verifier.
All nine scoped documentation gate/self-test commands and diff checks passed.
No runtime code, external flow or Production data was changed.
