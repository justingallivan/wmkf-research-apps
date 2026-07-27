---
title: "Request Workbench — near-term execution plan"
domain: architecture
kind: plan
status: canonical
summary: "Evidence-backed critical path for stabilizing review synthesis and designing the remaining Workbench lifecycle before implementation."
canonical: true
cataloged: 2026-07-26
last_verified: 2026-07-26
owner: product-engineering
related:
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
---

# Request Workbench — near-term execution plan

## Outcome

Over the next few weeks, turn the Workbench from a mixture of mature reviewer
functionality, partial AI synthesis, and old design assumptions into a deliberately
sequenced lifecycle product. The immediate goal is not to fill every placeholder. It is
to make the current review stage reliable, lock the contracts for the next deadline-bound
stage, and then build only the smallest complete slice needed on time.

This plan is grounded in the 2026-07-26 truth audit. Runtime truth still belongs to source,
the Atlas, tests, and live probes.

## Calendar gate

The work is ordered below, but exact calendar dates cannot be assigned until the owner
provides:

1. each fixed deadline;
2. the audience using the system at that deadline; and
3. the minimum artifact or action that must work by that date.

Until then, “Week 1/2/3” are relative execution windows, not delivery promises.

## Immediate next task — parked at this session boundary

### Production review-synthesis smoke

Use Request `1002788` and a deliberate staff-triggered Generate/Regenerate action.
This is an authorized test and must not be interpreted as authorization for an automatic
one-review trigger.

Pass criteria:

1. the endpoint returns a complete object matching the synthesis schema;
2. `wmkf_reviewsynthesisjson` is written on the intended request;
3. a reload renders the persisted synthesis card;
4. regenerate deliberately overwrites the same request memo without creating a second
   durable artifact;
5. logs identify the model, prompt version, request, and failure/success state without
   exposing review content;
6. no reviewer email, materials dispatch, review-answer mutation, or unrelated Dataverse
   write occurs.

If it fails, stop at diagnosis. Do not proceed to automatic triggering.

## Week 1 — close the current Reviews contract

### 1. Make synthesis generation reliable

- Reproduce and diagnose the incomplete-JSON failure.
- Decide whether the fix belongs in the prompt, model/output settings, structured parsing,
  bounded retry/repair, or a combination.
- Preserve the shared Executor contract and audit trail.
- Add characterization tests for malformed/truncated output and write-on-success only.

Exit: repeated controlled runs produce valid, persisted synthesis or a clean failure with no
memo write.

### 2. Implement the owner-approved lifecycle

- Generation readiness: automatic only when every participating invitation is complete.
- Manual staff override: allow an early run with explicit confirmation.
- Stored-output visibility: show an existing synthesis independently of current readiness.
- Regeneration: always deliberate and auditable.
- Decide the participation set for declined, withdrew, released, revoked, duplicate, and
  cancelled rows before coding the automatic trigger.

Exit: one documented state machine, one tested readiness calculation, one automatic trigger
path, and one manual override path.

### 3. Finish Reviews observability

- Surface last-generated time and generation state.
- Keep generation errors visible and actionable without hiding returned reviews.
- Record the production-smoke evidence in the Reviews buildout plan.

## Week 1–2 — lifecycle design freeze

Hold one focused product/engineering review for each remaining placeholder. Every tab must
leave the review with this contract:

| Contract field | Required answer |
| --- | --- |
| User and moment | Who uses it, and at what lifecycle event? |
| Inputs | Exact Dataverse fields, SharePoint files, reviews, synthesis, or staff entry used. |
| Producer | Manual staff action, app action, Power Automate, or status event. |
| Persistence | Exact Dataverse column/child row and SharePoint path/file contract. |
| Consumer | Workbench tab, Word, executive view, downstream automation, or board material. |
| Readiness | The condition under which generation/editing is allowed. |
| Regeneration | Overwrite/version/history behavior. |
| Access | Who may read, generate, edit, and approve. |
| Failure recovery | What staff sees and how the operation is retried safely. |
| Deadline | Fixed date and minimum viable outcome. |

Decision order:

1. **Pre Site Visit Writeup** — likely next operational slice because returned reviews are
   now present, but confirm the deadline and whether it consumes raw reviews, synthesis, or both.
2. **Site Visit** — decide whether existing `akoya_sitevisitdate` and
   `akoya_sitevisitnotes` satisfy the real workflow.
3. **Final Writeup** — define only after the Site Visit input and writeup artifact contract
   are settled.
4. **Initial Writeup** — schedule from the next-cycle deadline; do not inherit the obsolete
   D26 pilot assumption.

Explicit non-goals during design freeze:

- no Executive Dashboard build without a near-term user/deadline;
- no Reviewer Pool build without observed need and owner priority;
- no new writeup URL fields merely because the June proposal named them;
- no automatic status-driven workflow until its event, idempotency, retry, and ownership
  contracts are explicit.

## Week 2–3 — build the first complete writeup slice

The default candidate is Pre Site Visit Writeup, subject to the calendar gate.

Build in producer-to-consumer order:

1. approve the input contract and prompt identity;
2. approve/provision the persistence contract;
3. implement a request-bound server producer with idempotent retry behavior;
4. write the Word artifact to the approved SharePoint destination;
5. persist a durable pointer/version reference;
6. render current state and “Open in Word” in the Workbench;
7. add audit/observability and failure recovery;
8. run contract, security, Atlas, and browser/API verification;
9. perform a narrow production smoke with a designated test request.

Exit: one real request can move from ready inputs to a durable, editable Word artifact and
back to a visible Workbench state without filename guesswork or silent partial success.

## Week 3+ — dependent lifecycle slices

- **Site Visit:** build the smallest staff notes/date surface only if the existing fields
  satisfy the approved contract.
- **Final Writeup:** reuse the proven writeup artifact path and add the approved site-visit
  input.
- **Initial Writeup:** reuse the same path when the next-cycle trigger and deadline require it.
- **Overview:** add next-action/writeup signals only after their underlying state exists.

Do not parallelize these dependent slices merely to fill tabs. A proven shared writeup
contract should be reused; unproven assumptions should not be multiplied.

## Completion controls

For every slice:

- use `/contract-reconcile` across caller → persistence → consumer;
- use the evidence-first `/sweep` in domain-audit mode before changing durable truth claims;
- update the Atlas and route security matrix when contracts change;
- require write-on-success behavior and explicit partial-failure handling;
- run the relevant gate and then its self-test sequentially;
- promote to production deliberately under the campaign release strategy;
- record live-smoke evidence before changing status from planned/partial to verified.

## Decision log to obtain from the owner

The next planning conversation needs:

1. fixed deadlines and minimum outcomes;
2. review-synthesis participation semantics;
3. Pre Site Visit inputs;
4. writeup file/pointer/version contract;
5. Site Visit field sufficiency;
6. leadership/editor access timing.

