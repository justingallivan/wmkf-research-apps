# Request Document Explicit Actor Plan — Adversarial Review Reconciliation

**Point-in-time artifact, 2026-08-31.** This records the coordinating owner's
source-verified disposition of the read-only Claude adversarial review of
`docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md`. The review returned **APPROVE
WITH CONDITIONS** against `b658b91d`; it ran no live probes and changed no
repository or external state.

| Finding | Disposition | Source verification | Plan change |
|---|---|---|---|
| HIGH — Site Visit response-loss reconciliation would reject legacy rows or valid concurrent commits if it required the current actor | **ACCEPT** | `site-visit-transition-service.js` has a legacy already-Review reuse path plus catch/post-write confirmation paths. Existing milestone completeness is version/hash/time only. | Legacy already-Review rows remain reusable with “Not captured.” A readiness-era attempt that entered Draft requires actor presence, not equality with the current caller. |
| HIGH — Missing/disabled/stale identity behavior and readiness-off detection were not priced | **ACCEPT WITH CORRECTION; OWNER GATE** | Current behavior is mixed: Final and distribution paths fail closed; ordinary profile-backed Board/reopen paths block missing actors; Initial Assessment, Pre-Site, and Site Visit currently permit a null actor. The system-user adapter supports exact fresh reads including `isdisabled`. | Recommend preserving each flow's present availability posture, validating the exact enabled user before bind, emitting durable evidence for allowed null attribution, and adding a red Production readiness health check. Universal fail-closed remains an explicit owner alternative. |
| MEDIUM — Initial Assessment Board provenance still labels service-principal `createdby`, with an “Administrator” fallback | **ACCEPT** | `InitialAssessmentTab.js` renders `milestone.provenance?.createdBy || 'Administrator'`; the artifact projection sources that value from `_createdby_value`. | Replace this consumer, alongside guarded reopen, with the explicit actor projection and the honest “Not captured” label. |
| MEDIUM — Immutability was narrative rather than enforced across every writer | **ACCEPT** | Six Request Document create paths and multiple later PATCH/reclaim paths exist. Narrative-only discipline would not prevent a later raw writer or recovery PATCH from overwriting origin. | Make `requestDocumentAdapter.create` the required stamping seam; reject origin fields at update/change-set seams and add a focused writer-inventory/source gate. |
| LOW — Wave 22 proves a system-user bind on PATCH, not on create | **ACCEPT** | The existing Production proof is the Final activation changeset PATCH. | Relabel create bind support as derived and require the first natural Stage 4 create/readback to close the evidence gap. |
| LOW — Distribution snapshot origin could be mistaken for sender authority | **ACCEPT IN PART** | The same operation cannot be resumed by another actor: actor identity is in the immutable draft hash and send enforces exact actor ownership. A later, distinct operation can still reuse a retained snapshot created by someone else. | Define `InitiatedBy` as snapshot-row origin only; the actor-bound Postgres ledger and Dynamics email remain sender authority. |
| LOW — `wmkf_InitiatedAt` DateTime behavior was unspecified | **ACCEPT** | The plan named a timestamp but not Dataverse behavior. | Pin it to `UserLocal`: stored in UTC and rendered in the viewer's local zone. |

## Contract-reconcile verdict

Mode A over the revised plan: **READY WITH ONE NAMED OWNER POLICY GATE**. The
schema and attribution architecture remain sound. Implementation must not begin
until the owner chooses between:

1. the recommended current-posture policy, where existing strict flows stay
   strict while Initial Assessment, Pre-Site, and Site Visit remain available
   with null actor/time plus durable operational evidence; or
2. universal fail-closed behavior, which blocks those actions until Admin
   identity reconciliation succeeds.

No schema, role, environment, deployment, Production, or historical-data change
is authorized by this review or reconciliation.
