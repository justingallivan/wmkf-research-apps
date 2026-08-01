# Session 393 Prompt: Fable holistic reviewer-workflow challenge

> **Owner-directed one-session exception:** Justin is handing the reviewer
> workflow to Claude Fable for one fresh Claude Code CLI session. Run `/start`
> first. Do not infer a permanent reordering of `docs/CURRENT_WORK_QUEUE.md`.

## Read First

1. `CLAUDE.md` and the normal `/start` output.
2. `docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md` — the controlling brief for
   this session.
3. `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` — the current proposed
   stabilization contract, **under review rather than accepted as truth**.
4. `docs/atlas/postgres-reviewer-find-roster.md` and
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` for persistence and
   lifecycle routing.

## Ownership and Safety Boundary

- **Active owner:** Claude Fable.
- **Owned surface:** read-only reviewer-workflow investigation, plan challenge,
  and one findings artifact.
- **Codex status:** no active implementation work; the prior Codex session
  prepared this handoff only.
- Start from clean `main` at or after `74247536`. Create a review branch before
  writing the findings artifact; do not work directly on auto-deploying `main`.
- Do **not** edit reviewer runtime code, execute data repair, merge, deploy, send
  email, or perform Production writes in this session.
- Read-only source inspection, tests, logs, and bounded Dataverse/Postgres/
  SharePoint probes are allowed. Never treat the July 31 probe as standing
  authority for a later write.
- Write the requested analysis artifact only. Do not rewrite the controlling
  directive, memory, Atlas, wiki, or `SESSION_PROMPT.md`; Justin will decide
  what to accept after reviewing the findings.

## Why This Session Exists

The original problem was a Reviewer Workbench **Find** regression on Request
`1002912`. The work then detoured into an adjacent-verification agent-harness
pilot. That pilot is now implemented, reviewed, committed, and deployed as an
advisory. It did not repair the reviewer workflow.

The reviewer issue was diagnosed and documented, but no stabilization runtime
patch or Production roster repair followed. Justin now wants Fable's greatest
value applied before implementation: step back, reconstruct the real product
and data contract, question the observations and plans, look for a simpler or
more correct framing, and identify where a bounded implementation session can
help most.

## Current Process State

### Completed

- Reviewer address-trust work reached a no-send production pilot before the
  regression was discovered; latest related runtime record is `e31cf992`.
- The regression received a source/read-only-live diagnosis and a proposed
  stabilization directive in `dbdca6e1`.
- The adjacent-verification advisory pilot was accepted as **Keep advisory** in
  `5e14a811`, `40f6e224`, and `74247536`.
- `main` and Production reached `74247536`; that release changed agent harness
  and documentation surfaces, not Reviewer Workbench runtime behavior.

### Not completed

- No read-only cross-store diagnostic harness for the reviewer incident.
- No baseline-failing versions of the five proposed golden workflows.
- No engagement-aware applicant projection patch.
- No complete applicant `candidateKey`/confirmation correction.
- No exact `Project Narrative.pdf` compatibility fallback or reload-stable
  proposal override.
- No dry-run roster reconciliation tool for this incident.
- No new signed-in no-send `1002912` stabilization pilot.
- No Production roster cleanup or repair.

## Claims Fable Must Verify or Falsify

These are **inputs to investigation**, not premises. Reconstruct the full
caller → persistence → response → consumer path and actively seek contrary
cases.

| Claim inherited from the diagnosis | Current evidence available to re-check | Status entering Fable session |
| --- | --- | --- |
| Applicant enrichment can process already-handled recommendations | `findApplicantRecommendedByRequest` filters disposition but not engagement; `enrichRecommended` consumes its full result | **Source-supported; independently re-verify** |
| Ingestion loses lifecycle information | `ensureApplicantRecommended` returns `selected`; `ingestApplicantReviewers` does not project it | **Source-supported; independently re-verify and test whether `selected` is even the right stage signal** |
| Lima-style correction can dead-end on key mismatch | ordinary SSE applicant DTO branches omit explicit `candidateKey`; confirmation binds to the stored request/key/row | **Source-supported; trace every fallback and authoritative-anchor path before concluding** |
| Proposal/cache identity is unstable across reload | default loader is canonical-only; dropdown override lives in component state; enrichment/cache uses the exact file key | **Source-supported; verify actual navigation/cache consumers and whether the proposed fallback is correct** |
| Isberg and Sorek's Dataverse lifecycle was intact | July 31 read-only probe found invited / invited+declined records | **Time-bounded historical baseline; UNKNOWN current live state until re-probed** |
| Duplicate/noncanonical/orphan Postgres rows caused resurfacing | July 31 probe found legacy terminal twins, canonical active rows, and one missing-suggestion anchor | **Time-bounded historical baseline; UNKNOWN current live state until re-probed** |
| The incident is best framed as a projection/orchestration regression | Proposed directive synthesis | **Hypothesis to challenge** |
| Dataverse lifecycle must always dominate the Find projection | Proposed directive invariant | **Product/architecture hypothesis to challenge, including its edge cases** |

## Fable's Mission

1. **Reframe before recommending.** State the actual staff outcome and failure
   modes in your own terms. Do not begin from the proposed patch list.
2. **Falsify the incident story.** Confirm, refute, or leave unknown each
   inherited claim using current source, tests, and safe read-only evidence.
3. **Trace the whole contract.** Cover Dataverse lifecycle, Postgres projection,
   SharePoint file identity, Blob handoff, applicant enrichment, roster/cache
   identity, staff confirmation, reload, and UI rendering/remedies.
4. **Audit the plan, not just the code.** Identify assumptions, missing
   invariants, unnecessary layers, false authority boundaries, and tests that
   could pass for the wrong reason.
5. **Look for simplification.** Ask whether the working Postgres projection,
   proposal-coupled applicant cache, dual key schemes, and current stage model
   are earning their complexity.
6. **Recommend the smallest high-leverage next slice.** It may differ from the
   current Phase 0–4 sequence. Say what to stop doing as well as what to do.

## Questions the Existing Plan May Be Wrong About

- Is `selected` a lifecycle fact, a curation flag, or both? Which engagement
  signals are monotonic, and which can legitimately reverse?
- Does “Dataverse lifecycle always wins” produce the right UI for declined,
  removed, merged, stale, or partially materialized records?
- Should Postgres continue projecting applicant candidates at all, or can the
  authoritative and working-state responsibilities be reduced?
- Is canonical `suggestion:<id>` the correct action identity, or is the missing
  `candidateKey` merely a symptom of split identity and cache ownership?
- Should applicant recommendations depend on proposal analysis/cache identity
  before staff can see their lifecycle state?
- Is exact `Project Narrative.pdf` fallback the right compatibility rule, and
  what evidence distinguishes it from another filename heuristic?
- Do the five proposed golden workflows cover partial success, concurrent
  enrichment/confirmation, stale reloads, missing anchors, duplicate rows, and
  every terminal engagement path?
- Is “close recurrence, then repair data” sufficient, or can stale data still
  invalidate tests and the proposed projection design?
- What would make this safe for an imminent reviewer campaign, and what remains
  a genuine campaign blocker?

## Required Deliverable

Write `outputs/reviewer-workflow-stabilization-fable-assessment.md` with:

1. Executive verdict and reframe.
2. Claim matrix: **CONFIRMED / REFUTED / PARTIAL / UNKNOWN**, with evidence and
   a disconfirming check for each material claim.
3. Whole-flow map from authoritative lifecycle through staff-visible Find state.
4. Critique of the existing stabilization directive and its five workflows.
5. Revised invariant/golden-workflow set, if needed.
6. Recommended first implementation slice, prerequisites, and explicit non-goals.
7. “Stop doing” list.
8. Remaining unknowns and the exact probes/tests needed to resolve them.

Use `[VERIFIED via file:line or command]`, `[ASSUMED]`, and `[UNKNOWN]`. Cite
current source, not only plans or this prompt. Include denominators for every
clean/complete claim. A green test is evidence only for the behavior it actually
exercises.

## Stop Conditions

Stop and report rather than expanding scope if:

- a needed conclusion requires a Production write;
- current live state materially contradicts the July 31 baseline;
- the plan's authority model cannot be made coherent without a product decision;
- review work turns into runtime implementation;
- a relevant gate is red; or
- roughly one session is consumed without producing an evidence-backed reframe
  and next-slice recommendation.

## Handoff Expected From Fable

```text
Owner: Claude Fable
Branch: <review branch>
Status: review complete | blocked
Changed surfaces: outputs/reviewer-workflow-stabilization-fable-assessment.md only
Commits: <hash or none>
Verification/probes: <exact bounded list>
Dirty worktree: clean | listed
Next owner/action: Justin reviews findings before any implementation authorization
```
