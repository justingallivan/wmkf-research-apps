# Review submission active-instructions repair — 2026-10-22

## Scope and invariants

Sweep Mode A; contract-reconcile Mode B. First authorized repair batch from the
read-only submission/staff rescue/record-authority audit. Documentation and a
source comment only. No runtime, worktree topology, environment, deployment,
external data, owner policy, question publication, or exposure change.

| Claim / invariant | Source → persistence → consumer evidence | Repair / classification |
|---|---|---|
| Structured staff rescue is implemented, separate from legacy partial receipt paths. | ManualReviewEntryForm → manual-review-entry route/service → canonical atomic answer/parent changeset → Reviews tab. | Upload memory's planned-rescue/unchanged claim replaced with implemented source routing; S347 removal history retained. VERIFIED via source. |
| Staff and reviewer-token writers share receipt finality. | authorizeReviewReceipt rejects received/terminal/unaccepted/declined/missing-ETag rows → authorizing row version used by portal, rescue, upload and no-file conditional writes. | Memory, portal wiki and token upload comment explain shared guards; no staff overwrite exemption. VERIFIED via source. |
| Retained upload mechanics are not authorization to restore retired UI. | Owner-directed structured workflow and existing protected route/service seams. Persistence N/A for guidance. | Old restoration steps preserved as historical mechanics; new owner decision required for re-exposure. No endpoint retired or cleanup performed. |
| Rescue mirrors the live question set instead of a retired three-rating form. | Live question fetcher/shared renderer/canonical builder → answer snapshots; ratingsFromAnswers projects riskLevel and overallAssessment, with impactAreas categorical/multiselect separate. | Rescue memory and lifecycle wiki corrected; original three-rating requirement preserved as history. VERIFIED via source. |
| Automatic synthesis mechanism exists independently of activation/exposure clearance. | Exact-true cron flag → readiness scan/input-bound job enqueue → leased drain rechecks readiness/hash → synthesis service checks automatic job/readiness or manual early confirmation. | Checkbox memory's unbuilt assertion moved to superseded pre-lifecycle history; July rollout/probe and owner holds preserved. VERIFIED via source, live activation UNKNOWN. |

No new enums, tables, routes, async branches or persistence contract. New partial-
success, async/helper and symbol-value fan-out audits are N/A; existing guards and
producer/consumer seams were read as documentation evidence. Durable-surface/doc
checks apply. Upload route's non-comment tokens must remain identical to HEAD.

## Restatement search and historical boundaries

STALE → repaired: three active memory leaves, the two matching wiki restatements,
and token-upload comment. AGREE: shared receipt guard and current writer callers;
canonical two-rating projection; guarded synthesis route/drain. HISTORICAL: S347
UI removal, S302 early guard, July22 common-guard hardening a9ac471c6, original
three-rating requirement, pre-lifecycle synthesis plan, dated July controlled
smoke/cleanup/prompt evidence. UNRELATED: generic 'unaffected' mentions in other
apps. The historical authoring plan already has explicit status/routing boundaries
and is not rewritten as current failure evidence.

Owner decisions preserved: structured review is primary; staff rescue is an edge
case on Reviews rather than restored Track buttons; question keys/types/options
remain controlled; rehearsal/rollback/exposure decisions are not cleared by code
or a successful old smoke. Artifact classification is not deletion authority.
No uploaded or generated file, draft, review row, setting, or schedule was changed.

Disconfirming checks: inspect both token early guard and shared staff service
instead of assuming the local guard exempts staff; compare actual two-key rating
projection to the old three-radio prose; inspect exact-true flag guard and drain
hash checks rather than infer automation absent; distinguish source availability
from hosted activation and exposure approval.

## Validation and limits

All 24 selected checks/self-tests passed: 10 sequential pairs (atlas, doc-currency,
fact-consistency, doc-symbol-refs, build-claim-freshness, canonical-pointers,
drain-table-mentions, prompt-storage-mentions, agent-wiki, memory-router), plus
agent-invariants, docs-catalog, memory-drift, memory-health. The prior eight
advisory memory-health signals remain; this batch introduces no new signal.
Babel non-comment token comparison proves upload.js runtime code unchanged.
`git diff --check` passed. Runtime tests/build were not run for prose/comment-only
changes. Targeted restatement searches found no remaining live stale assertions
for these five scoped claims in the reviewed surfaces.

Fresh reviewer active_instructions_review whole-read both wiki pages, checked
source and reviewed the six-file repair diff; no blockers. The review confirmed
the historical/owner boundaries and that second-batch findings remain untouched.
Source history checks match a9ac471c6 (July22 common receipt guard) and 70956477c
(July28 synthesis lifecycle). Claims: 5 → VERIFIED 5 within source/decision scope.
Verdict: RECONCILED for this active-instructions batch only.
Second-batch draft-payload authority, cached GET/fresh POST wording, combined Word
export ownership, record-authority map, and matching comments remain out of scope.
Current deployments, flags, published question/prompt versions, live population,
and outstanding exposure/rehearsal status were not probed. This is a bounded
repair, not a full runtime or live-system certification.
