---
title: Reviewer Workflow Stabilization — Holistic Challenge Prompt for Fable
domain: reviewers
kind: audit
status: historical
summary: "Fresh Fable session to reconstruct the Reviewer Workbench Find regression, challenge the stabilization plan, and recommend the next bounded slice."
canonical: false
cataloged: 2026-07-08
last_verified: 2026-08-01
owner: product-engineering
related:
  - docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/REVIEWER_CANDIDATE_PROMOTION_REMEDIATION_PLAN.md
  - docs/atlas/postgres-reviewer-find-roster.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
---

# Holistic challenge request — Reviewer Workbench Find stabilization

> **CLOSED 2026-08-01.** This brief was executed; the pass is complete and its
> findings are owner-accepted. Outputs:
> `outputs/reviewer-workflow-stabilization-fable-assessment.md` (read §0 first —
> it records corrections that supersede the body) and
> `outputs/reviewer-workflow-codex-adversarial-review-2026-08-01.md`.
> Implementation is authorized and specified in `SESSION_PROMPT.md`.
> Retained as the historical record of the review contract.
>
> **Owner correction, 2026-08-01:** references below to a proposed
> `Project Narrative.pdf` fallback preserve the prompt as executed, but the
> actual file needed for the remainder of the current grant cycle is the exact
> `Phase I/ProjectDescription.pdf`. Current guidance lives in the stabilization
> directive and `SESSION_PROMPT.md`.

You are Claude Fable in a fresh, top-level Claude Code CLI session. Justin has
asked you to spend one session on the reviewer workflow because the team has
accumulated many locally correct fixes while the end-to-end staff experience
remains vulnerable to cross-store and cross-layer contradictions.

Your job is **not** to endorse the current diagnosis, execute its phase list, or
produce another broad redesign. Your job is to independently reconstruct the
problem, try to falsify the inherited observations, challenge the architecture
and proposed stabilization plan, and identify the smallest next implementation
slice that would materially improve campaign safety.

`SESSION_PROMPT.md` owns the session boundary and required output. This document
owns the review posture and investigation contract.

## Non-negotiable posture

- **Reframe first.** State the staff problem in your own terms before adopting
  any plan vocabulary such as “projection regression,” “lifecycle always wins,”
  “canonical key,” or “golden workflow.”
- **Plans are claims, not evidence.** Treat
  `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md`, this prompt, memory, and
  prior session summaries as hypotheses to test against current source, tests,
  and safe read-only probes.
- **Seek disconfirmation.** For every material conclusion, name what would make
  it false and perform that check when it is safe and bounded.
- **Trace adjacent properties.** Do not infer invitation stage from `selected`,
  identity from a suggestion ID, cache validity from a Blob URL, or durable
  authority from a UI key without reading the enforcing producer and consumer.
- **Prefer simplification.** The best recommendation may remove or narrow a
  projection, cache, state transition, or repair step rather than adding another
  reconciliation layer.
- **Stay read-only.** No reviewer runtime edits, Production writes, repair
  execution, sends, deploys, or merges. Write only the requested findings
  artifact on a review branch.

## The user outcome to reconstruct

Foundation staff open a request's **Find** tab to understand applicant-named
reviewers, discover additional candidates, verify identity/contact evidence,
and move a person forward without losing or reversing prior lifecycle state.

The same person/request may currently be represented by:

- a Dataverse `wmkf_appreviewersuggestion` lifecycle row;
- a Dataverse potential-reviewer person;
- one or more Postgres `reviewer_find_roster` working rows;
- an applicant-recommendation ingestion DTO;
- proposal-dependent enrichment/cache state;
- a server-generated or legacy candidate key; and
- browser state tied to an exact SharePoint file that has been copied to Blob.

Do not assume all of these representations are necessary, aligned, or owned by
the right layer.

## Why the current diagnosis may be incomplete

The July 31 diagnosis of Request `1002912` reported three visible symptoms:

1. already-engaged applicant reviewers resurfaced as unresolved Find prospects;
2. a Lima-style identity/contact correction ended in HTTP 409; and
3. proposal selection/reload could unnecessarily gate or rerun applicant work.

It synthesized those symptoms as a projection/orchestration regression and
proposed five golden workflows plus a four-phase repair sequence. That is a
plausible account, not an accepted proof.

Challenge at least these possibilities:

- the visible cards may be wrong for more than one independent reason;
- `selected`, invitation, response, token, materials, review, and completion
  signals may not form the simple monotonic ordering assumed by the plan;
- a noncanonical roster key may be a migration artifact, an intentional
  compatibility surface, or a symptom of missing ownership—not merely bad data;
- the confirmation 409 may arise from more than an omitted client key;
- proposal identity may be correctly exact while cache invalidation or UI
  orchestration is wrong;
- the then-proposed filename fallback (now owner-corrected to the exact
  `Phase I/ProjectDescription.pdf`) may be a useful bounded rule or another
  undocumented heuristic;
- cleanup-after-runtime-fix may be insufficient if stale rows affect how the new
  contract is designed or tested; and
- “handled but visible” may not be the right staff experience for every terminal
  or reversible state.

## Required whole-flow trace

Account for every applicable hop; mark a hop N/A rather than silently skipping
it:

1. Request/proposal selection in the Workbench UI.
2. SharePoint bucket/file resolution and exact file-key selection.
3. Blob handoff and proposal-dependent analysis/cache identity.
4. Applicant slot ingestion and Dataverse materialization.
5. Dataverse suggestion/person lifecycle reads.
6. Applicant enrichment and identity/contact evidence.
7. Postgres roster write, restore, terminal ledger, and key normalization.
8. Confirmation/promotion request binding and partial-success behavior.
9. Reload, concurrent enrichment, and stale-generation handling.
10. Staff-visible rendering, actionability, and executable remedies.
11. Tests, diagnostic scripts, Atlas/wiki/docs, and release verification.

For each state transition, identify:

- authoritative producer;
- persistence location;
- stable identity/key;
- consumers;
- monotonic and reversible fields;
- stale/concurrent-write guard;
- behavior when the adjacent store disagrees; and
- a test or probe that would catch regression.

## Plans and assumptions to interrogate

### Authority and lifecycle

- Is Dataverse the correct authority for every lifecycle property, or only
  engagement/outreach facts?
- Is Postgres strictly a disposable working projection in current code, or does
  it own staff confirmation and evidence that Dataverse does not?
- What precisely makes an applicant recommendation “handled”? Enumerate all
  terminal and nonterminal states rather than relying on a single boolean.
- Can declined, removed, withdrawn, merged, released, or re-referred people
  legitimately re-enter Find? If so, through what explicit transition?

### Identity and action binding

- Is `suggestion:<id>` the correct canonical action key everywhere?
- Do server-owned suggestion anchors already provide a safer binding than
  trusting a browser `candidateKey`?
- Which legacy-key fallbacks are deliberate, and which weaken fail-closed
  request/person/suggestion binding?
- Does confirmation preserve only successful fields and remain retryable after
  partial success or concurrent enrichment?

### Proposal and cache coupling

- Which applicant facts genuinely depend on proposal content, and which should
  remain visible while file resolution or model work is unavailable?
- Is `library::folder::filename` sufficient identity if a file's content changes
  in place?
- Should same-key reload reuse enrichment automatically, or must a version/hash
  participate?
- Does the legacy filename fallback solve observed requests, and what exact
  contrary cases make it unsafe?

### Test and repair strategy

- Do the five proposed golden workflows cover the complement of their happy
  paths, including all-failed batches and stale post-await writes?
- Can tests create the bad input they claim to exclude, so they fail if the guard
  is removed?
- Should a read-only diagnostic harness precede the plan review, or is existing
  source/test evidence sufficient for some claims?
- Can data cleanup be defined without assuming the new authority/key model?

## Reading map

Start narrow, then follow actual callers and consumers:

1. `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md`
2. `docs/atlas/postgres-reviewer-find-roster.md`
3. `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
4. `lib/services/workbench/applicant-reviewers-service.js`
5. `lib/dataverse/adapters/reviewer-suggestion.js`
6. `lib/services/workbench/enrich-recommended-service.js`
7. `lib/services/reviewer-roster-store.js`
8. `pages/api/workbench/reviewer-roster.js`
9. `lib/services/workbench/promote-applicant-reviewer-service.js`
10. `shared/components/reviewers/ReviewerFindPanel.js`
11. `shared/components/reviewers/ReviewerSearchSection.js`
12. `shared/components/reviewers/reviewer-search-logic.js`
13. `lib/services/reviewer-finder/load-proposal-service.js`

Then inspect relevant tests, current git history, and these broader contracts:

- `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`
- `docs/REVIEWER_CANDIDATE_PROMOTION_REMEDIATION_PLAN.md`
- `docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md`
- `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md`
- `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`

Use CodeGraph before grep/read when tracing code. For any live probe, record the
target, timestamp, denominator, and why it is read-only. Current source outranks
the July 31 incident table; current live state outranks both for mutable rows.

## What we most need from Fable

The team does **not** need another exhaustive catalog of every reviewer feature.
We most need judgment in four places:

1. **Correct problem boundary:** Is this one stabilization slice or evidence that
   the Find/lifecycle architecture needs a smaller redesign boundary?
2. **Authority simplification:** Which store and key should own each fact, and
   which duplicated representation should stop driving behavior?
3. **Campaign-critical workflow set:** What must be proven before staff can rely
   on Find, and which proposed workflows are distractions?
4. **Smallest safe next slice:** What can one implementation session change and
   verify without reopening the entire reviewer architecture?

Be opinionated. A recommendation is useful only if you state its prerequisite,
the evidence tested, a disconfirming check, and its explicit non-goals.

## Required output

Write only:

`outputs/reviewer-workflow-stabilization-fable-assessment.md`

Use the structure in `SESSION_PROMPT.md`. End with a clear verdict:

- `PLAN SOUND — PROCEED TO BASELINE TESTS`
- `PLAN SOUND WITH NAMED CHANGES`
- `PLAN NEEDS REWORK`
- `INSUFFICIENT EVIDENCE`

Do not edit the plan to make it agree with your findings. Preserve the separation
between independent assessment and accepted durable guidance. Do not run `/stop`;
hand the findings and branch state back to Justin for a decision.
