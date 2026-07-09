---
name: project-reviewer-holistic-redesign-parallel-build
description: The 2026-07-08 Fable holistic review of reviewer finding + identity produced a full implementation plan (docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md). Owner direction (S349): treat as a MAJOR effort on a DEDICATED testing branch — build the whole plan (P0–P4) out, then compare the finished pipeline head-to-head against state-of-the-art on main before merging. Not started; parked pending owner go.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-07-08 via owner statement (S349) + direct read of the plan + audit docs
---

## Recall Rule

Read this when: planning or starting work on the reviewer-finding pipeline
(`lib/services/discovery/`, discovery-service facade) or reviewer-identity
resolution (`reviewer-identity-resolver.js`, `researcher.js` identity fields),
OR when anyone proposes acting on `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md`.

Do:
- Treat the plan as the agreed direction for a redesign of reviewer finding +
  identity, sourced from `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`.
- Build it on a **dedicated long-lived testing branch**, not incrementally into
  main. The owner (S349) wants the *end product* built out (all of P0–P4) and
  then compared **head-to-head against the current state-of-the-art on main**
  before any merge decision. The comparison is of the finished pipeline, not
  per-phase.
- Use the plan's own eval layers as the comparison harness: **P2.1** frozen
  identity eval fixtures, **P3.2** A/B on 2–3 D26-style proposals, **P3.3**
  per-channel accept-yield report. These are what make "how does it compare"
  answerable rather than a sniff test.
- Still honor every safety invariant in the plan's "Universal invariants"
  block and the [OWNER-GATE] markers on individual phases — a testing branch
  does not waive the sticky/fail-closed identity guards.

Do not:
- Follow the plan's "one phase per PR, ship to main incrementally, do not
  batch" prose literally — that is superseded by the owner's build-on-a-branch,
  compare-the-end-product model (the phase ORDER is still a sensible build
  order within the branch; the ship-to-main-per-phase part is not the plan).
- Start building without an explicit owner go — as of S349 this is parked, not
  green-lit. It is a major effort, not a quick task.
- Let the plan or its source audit go unrouted again — before S349 neither had
  a memory pointer.

Ground truth:
- Plan: `docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` (`status: draft`).
- Source review: `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`
  (§1–§2 rationale + owner constraints; §3–§5 = what the plan implements).
- Owner sourcing constraints that bound the finding half:
  [[project-reviewer-sourcing-constraints]].
- Identity-safety context the P0/P1 phases turn on:
  [[project-reviewer-self-report-orcid-sticky-confirmed]],
  [[project-reviewer-verify-fail-dangerous]].

**Why:** The Fable session (top-level `claude-fable-5`) reassessed the whole
reviewer finding + disambiguation surface and produced a phased plan. The owner
judged it a major effort worth doing as an isolated experiment — build the
redesigned pipeline in full on its own branch and measure it against today's
production pipeline, rather than dripping changes into main where they can't be
compared as a whole.

**How to apply:** When reviewer-finding/identity work comes up, surface this
plan and its branch-build model. Do not silently execute the plan's incremental
sequencing; do not start the build without owner sign-off; when the build does
run, stand up the eval harness (P2.1/P3.2/P3.3) first so the head-to-head
comparison against main is possible.

Related: [[project-reviewer-apps-redesign-direction]] (the Workbench/UI
redesign — a DIFFERENT axis; this memory is the finding/identity *engine*),
[[project-reviewer-recall-over-precision]], [[project-reviewer-count-invariant]].
