---
title: Reviewer Holistic Redesign — Adversarial Implementation Review Prompt
domain: reviewer-identity
kind: audit
status: active
summary: "Read-only Claude review brief for the hybrid redesign plan and the B0/C0/I1 implementation through commit 75d26a22."
canonical: false
cataloged: 2026-07-12
owner: product-engineering
related:
  - docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/audits/reviewer-holistic-review-comparison-2026-07-09.md
  - lib/services/reviewer-identity-binding-contract.js
  - lib/services/reviewer-identity-binding-writer.js
  - lib/services/reviewer-finder/save-candidates-service.js
---

# Claude prompt: adversarial review of the reviewer holistic redesign

Use this prompt in a fresh Claude session at the repository root.

## Mission

Perform a **read-only adversarial review** of the reviewer holistic redesign plan
and the implementation produced in Session 358. Determine whether the design is
internally coherent, whether the code actually enforces it across the complete
flow, and whether the implementation is safe to promote or use as the foundation
for the next slice.

Do not implement fixes. Do not edit source, tests, plans, memory, Atlas, or
`SESSION_PROMPT.md`. Your only write may be the requested review artifact under
`outputs/`.

Begin with `/start`. Then invoke `/contract-reconcile` because this review spans
routes, services, adapters, Dataverse persistence, partial batch success,
concurrency, durable state, and documentation claims. Use CodeGraph before text
search when locating code or tracing symbols. You may use subagents to inspect
disjoint surfaces, but personally read the controlling sources and produce the
final synthesis yourself.

## Branch and review boundary

The latest implementation is on:

```text
codex/reviewer-holistic-i1-binding-writer
```

Verify that branch and working-tree state before reviewing. Do not assume it has
already been merged to `main`.

Review the complete Session 358 range:

```text
base: 43220961fb84f04d193832524c74391453867748
head: 75d26a22
diff: git diff 43220961fb84f04d193832524c74391453867748..75d26a22
```

The range contains these intended increments:

1. B0 evaluation manifest and freeze gate.
2. C0.1 partial-save containment, server-signed automated identity receipts,
   stable row keys, and generation-scoped client state.
3. C0.2 fail-closed identity-origin enforcement and automated-confirmed
   downgrading.
4. Wave 13 additive Dataverse schema and preflight contracts.
5. Pure identity-binding and institution-COI contracts.
6. An inert, ETag-protected identity-binding writer and narrow adapter seam.

Do not limit the review to the final commit or accept commit messages as proof.
Inspect the full diff, current callers, and current-tree behavior.

## Controlling sources

Read these before forming conclusions:

- `CLAUDE.md`
- `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`
- `docs/audits/reviewer-holistic-review-comparison-2026-07-09.md`
- `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`
- `docs/REVIEWER_DATA_MODEL.md`
- `docs/atlas/dataverse-wmkf-potentialreviewers.md`
- `docs/atlas/dataverse-wmkf-appreviewersuggestion.md`
- `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`
- `docs/CI_GATES_REFERENCE.md`

Then read every changed production file and its relevant tests in the review
range. At minimum, trace these anchors:

- `lib/services/reviewer-finder/save-candidates-service.js`
- `pages/api/reviewer-finder/save-candidates.js`
- `shared/components/reviewers/ReviewerSearchSection.js`
- `lib/services/reviewer-candidate-attestation.js`
- `lib/utils/reviewer-manual-confirmation.js`
- `lib/dataverse/adapters/researcher.js`
- `lib/services/capture-self-reported-orcid.js`
- `lib/services/reviewer-identity-binding-contract.js`
- `lib/services/reviewer-identity-binding-writer.js`
- `lib/services/institution-coi-context.js`
- `scripts/preflight-reviewer-identity-binding-fields.mjs`
- `lib/dataverse/schema/wave13-reviewer-identity-binding/`

## Required adversarial audits

### 1. Plan and state-claim audit

- Classify material plan and documentation claims as **VERIFIED**, **PLANNED**,
  **ASSUMED**, or **STALE** using current source, callers, schema artifacts, and
  probes where safe.
- Identify promises that the code does not enforce and behavior that exists but
  the plan misdescribes.
- Distinguish deliberate inactivity from missing implementation. In particular,
  the new identity-binding writer is intended to have **no production caller**,
  Wave 13 suggestion fields are intended to have no application reader/writer,
  and legacy/null binding state is intended to remain non-authoritative. Verify
  those facts independently.

### 2. Whole-flow contract audit

Trace caller → route → validation → service → adapter → persistence → response →
client consumer for candidate saving and identity decisions. Check all direct and
indirect callers rather than representative examples.

Prove or refute:

- malformed rows cannot contaminate valid siblings;
- only successful rows graduate in the client;
- duplicate display names cannot graduate one another;
- stale success and failure completions cannot mutate a newly selected request;
- client-supplied identity state cannot manufacture staff confirmation,
  self-report, binding provenance, or action eligibility;
- read failures remain fail-closed at every identity write seam.

### 3. Identity-binding state-machine audit

Treat `reviewer-identity-binding-contract.js` and
`reviewer-identity-binding-writer.js` as a state machine, not a collection of
helpers. Build or inspect a transition matrix covering:

- legacy/unbound, automated, staff-confirmed, and self-reported state;
- initialize, refresh, same-person rebind, different-person rebind, replay,
  stale event, equal-time collision, malformed state, and read failure;
- source precedence and authorized/unauthorized replacement;
- canonical ORCID and Scholar anchors and pair atomicity;
- seven-field lineage completeness and binding-version agreement;
- preservation of independently attested/manual fields;
- invalidation of identity-derived and proposal-specific state;
- unsupported revocation and legacy-dirty classification.

Look specifically for mixed-generation records, silent null pruning, accidental
manual-field erasure, stale automated results replacing human bindings,
same-timestamp ambiguity, malformed evidence being normalized into validity, and
transitions that become eligible without durable provenance.

### 4. Atomicity and concurrency audit

Verify the actual Dynamics/Dataverse contract, not merely mocked behavior:

- the read returns the real ETag used by the conditional write;
- the complete binding bundle is written in exactly one PATCH with explicit
  nulls where required;
- the adapter cannot silently omit a required field;
- only a typed 412 concurrency conflict is retried;
- every retry rereads and recomputes from current state;
- retry exhaustion and non-412 failures remain fail-closed;
- there is no read/write seam that can restore the C0.2 attestation-overwrite
  race once production callers are added.

Check whether existing tests drive the real adapter/service contract or merely
repeat implementation-owned constants and mocks.

### 5. COI and downstream-action audit

Trace binding generation into institution-COI context, suggestion currency, and
future action eligibility. Determine whether the current contracts are sufficient
to prevent a stale binding, affiliation set, or proposal context from being
treated as current when later callers are connected.

Verify that nothing in this range changes the established “surface, do not gate”
COI policy. Flag any design that conflates displaying COI evidence with permitting
identity-dependent writes or sends.

### 6. Schema and migration audit

Cross-check both Wave 13 artifacts, schema inventory, Atlas, preflight script,
field types, nullability, ranges, ownership, and deployment claims. Verify that:

- fresh/absent, exact, partially present, and divergent states are classified
  correctly;
- additive deployment cannot be mistaken for runtime activation;
- null deployed fields cannot grant eligibility;
- the planned conservative legacy classification is actually possible with the
  durable evidence available—or is clearly blocked where it is not.

### 7. Test-quality and negative-space audit

Run focused tests and any relevant gates, but do not equate a green suite with a
correct design. Look for circular assertions, fixtures that bypass real entry
points, missing complements, untested direct callers, and tests that cannot fail
when a required field or fan-out path is omitted.

At minimum, scrutinize tests for:

- partial and total candidate-save failure;
- identity-origin matrices and read failures;
- canonical anchor/value mismatch;
- source-precedence complements;
- delayed and equal-time events;
- dirty legacy rows and malformed lineage;
- complete atomic PATCH shape and explicit nulls;
- 412 reread/recompute and concurrent higher-trust state;
- retry exhaustion and non-412 errors containing misleading text.

## Review standard

Be skeptical of the plan, implementation, tests, and prior agent conclusions.
Prefer direct evidence over narrative. A finding must include:

1. severity (`P0`–`P3`);
2. concise title;
3. exact `file:line` evidence;
4. the violated invariant or contract;
5. a concrete failure trace from input/caller to persisted or user-visible harm;
6. why existing tests do not catch it;
7. the smallest safe remediation direction, without implementing it.

Do not report style preferences, speculative future features, or known deliberate
gates as defects. Do report a future integration hazard when the supposedly safe
foundation makes correct integration impossible or misleading.

For every suspected issue, actively try to refute it before keeping it. If no
actionable findings remain, say so explicitly and list the strongest invariants
you verified plus the residual risks that are intentionally deferred.

## Required output

Write the final review to:

```text
outputs/reviewer-holistic-redesign-adversarial-review-2026-07-13.md
```

Use this structure:

1. **Verdict:** `READY`, `READY WITH FIXES`, or `NOT READY`.
2. **Scope and evidence:** branch, SHAs, files/callers read, commands run.
3. **Findings:** ordered by severity; no summary-only findings.
4. **Contract reconciliation:** caller → persistence → consumer, including
   partial success, concurrency, stale async state, durable state, helper
   semantics, documentation, and symbol fan-out.
5. **Confirmed invariants:** claims independently proven from current state.
6. **Residual gates:** deliberate open work versus defects.
7. **Promotion recommendation:** whether `75d26a22` is safe to merge and what
   must happen before the first production caller is added.

Do not run `/stop`, do not commit, do not push, and do not modify any file other
than the single output artifact.
