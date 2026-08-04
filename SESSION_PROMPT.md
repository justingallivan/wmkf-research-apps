# Session Prompt: Reviewer Find production incident handoff (Session 394)

> **Owner-directed handoff, 2026-08-03.** The Reviewer Find warm-revisit
> performance rollout is deployed but remains regressed. Do not treat earlier
> “implemented,” “green,” or narrow adversarial-review results as proof that the
> production workflow is fixed. Run `/start` first.

## Read first

1. `CLAUDE.md` and the normal `/start` output.
2. `docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md` — the
   current incident assessment and next-orchestrator priorities.
3. `docs/REVIEWER_FIND_PERFORMANCE_PLAN.md` — design intent and implementation
   history; its new incident notice supersedes old branch-only status text.
4. `docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md` — producer contract; compare its
   outcome semantics against the incident before changing code.
5. `docs/atlas/postgres-reviewer-find-roster.md` and
   `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` for persistence and
   UI lifecycle context.

## Current state

- **[VERIFIED via Git]** branch is `main`; `main` and `origin/main` were at
  `7072d52a` before the handoff documentation commit.
- **[VERIFIED during deployment]** `7072d52a` reached a Ready production
  deployment and was served at `https://applications.wmkeck.org`.
- **[BROKEN]** the core owner requirement is not satisfied: an existing warm
  roster can still expose per-candidate **Refresh contact evidence**, and a
  request-level **Continue reconciliation** can loop on a deterministic
  staff-action condition.
- **[VERIFIED narrow recovery]** Request `1002903` / Katherine Ferrara regained
  a selection checkbox after the final GUID/stage-order fixes. She was not
  promoted or invited during verification.
- **[VERIFIED remaining incident]** the same request's Kanaka Rajan row remains
  retryable/queued even though the persistent institution/identity mismatch
  requires a staff decision. Repeating reconciliation cannot change that
  condition.
- **[SAFETY]** no reviewer was selected, promoted, invited, or emailed in the
  live verification. Preserve that no-send boundary.

## Work completed in the closed session

The warm performance/reconciliation implementation spans 50 commits,
`5b6757df..7072d52a`, and 142 files. Major delivered surfaces:

- cached-then-reconciled roster reads;
- per-candidate/per-stage evidence receipts and freshness planning;
- server-owned stage producers and targeted refresh route;
- request-level bounded reconciliation and continuation;
- fresh promotion-authority preflight;
- legacy receipt/identity compatibility bridges;
- deterministic, live-read, and no-send browser/test tooling; and
- five production hotfixes ending at `7072d52a`.

Final focused verification passed 60 tests, scoped ESLint,
`check:reviewer-find-warm-observation` plus self-test,
`check:reviewer-find-cold-no-send` plus self-test, `check:types`, and the build.
The final Opus 4.8 review covered only the stage-order hotfix; it was not a
whole-feature approval.

## Root cause still open

`projectReviewerContact` treats `institutionMismatch === true` as unresolved
identity even with probable/exact-ORCID evidence. The contact producer records
that as incomplete `missing_required_input`; reconciliation classifies it as
retryable and queues it; `CandidateCard` renders the individual refresh action.
This is an end-to-end outcome-contract defect, not a button-only problem and not
something Dataverse latency will cure.

## Next work — status labeled

1. **[P0 / NOT STARTED]** Add a production-shaped Kanaka regression fixture and
   prove the current code fails by returning retryable/queued.
2. **[P0 / NOT STARTED]** Reconcile producer → receipt → planner → reconciler →
   route → client outcome semantics. Deterministic missing input that requires a
   person/institution decision must be `action_required`, not `retryable`.
3. **[P0 / NOT STARTED]** Hide per-card refresh controls when no transient
   server action can succeed; show only the exact staff workflow.
4. **[P0 / DECISION REQUIRED]** Decide whether the Harvard Medical School /
   Harvard University relationship is normalized as hierarchy-equivalent or
   remains a staff confirmation. Either outcome must be terminal, not queued.
5. **[P0 / VERIFY]** Run focused tests and no-send production read-only smoke on
   Request `1002903`. Do not cold-search, promote, or email.
6. **[P1 / NOT STARTED]** Remove misleading `Omitted — see note below`, clarify
   topical-match percentage, and correct evidence-date semantics.
7. **[P2 / DEFERRED]** Resume latency/background-continuation work only after
   the outcome taxonomy is coherent and production-shaped acceptance cases pass.

## Do not do

- Do not instruct staff to refresh every reviewer.
- Do not rerun searches to repair existing roster evidence.
- Do not blindly revert the hotfix chain; Katherine-shaped recovery depends on
  parts of it.
- Do not treat Request `1002903` as a mutation fixture.
- Do not send external emails. Request `1002914` remains the owner-designated
  no-send Reviewer Find fixture if a later exact authorization permits its use.

## Handoff summary

```text
Previous owner: Codex orchestrator
Branch/source head before handoff docs: main @ 7072d52a
Status: production incident open; partial recovery only
Primary incident case: Request 1002903 / Kanaka Rajan retry loop
Known recovered case: Request 1002903 / Katherine Ferrara checkbox
Production mutations in final verification: none
Email sent: none
Next owner/action: repair and test the outcome taxonomy before any further rollout
```
