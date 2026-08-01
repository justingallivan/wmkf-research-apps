# Session 392 Prompt: Adjacent-verification evidence pilot

> **READ FIRST:** `docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md` is the
> controlling directive for this session. Implement only its bounded,
> advisory-first pilot. Do not merge Claude's proposed enforcement plan
> wholesale, introduce blocking behavior, rewrite memory, change reviewer
> runtime code, or modify Production state during this pilot.

## Session 391 Summary

The session completed and production-piloted the bounded reviewer address-trust
work through commit `e31cf992`. A later signed-in inspection of Request
`1002912` exposed a separate cross-layer regression: already-engaged applicant
reviewers were resurfacing in Find as unresolved prospects, Christopher Lima's
identity/contact correction returned a dead-end 409, and proposal selection /
reload behavior could unnecessarily gate or re-enrich applicant rows.

The session stopped implementation rather than continuing the patch/review loop.
It established a live/source-backed incident baseline and wrote the canonical
stabilization directive for Session 392. No production data was changed during
that diagnosis.

After the initial stop handoff, Claude's separate agent-harness analysis was
reviewed against the current hooks and official Claude Code hook contract. Its
“adjacent verification” diagnosis was accepted: an agent can inspect genuine
evidence yet assert an unchecked neighboring property. Its proposed
enforcement plan was not accepted as implementation-ready because it overstated
what pasted output and regex-based hooks can prove, omitted privacy controls,
blurred normative and descriptive claims, and treated Claude-only hooks as
general agent enforcement. The owner reprioritized a narrow evidence pilot
ahead of reviewer stabilization.

### What Was Completed

1. **Confirmed authoritative invitation state is intact.**
   - Ralph Isberg's suggestion is selected and invited, with email/token
     timestamps.
   - Rotem Sorek's suggestion is invited and declined; `selected=false` is the
     post-decline state, not evidence that he was never promoted.

2. **Identified the Find projection failure.**
   - Isberg and Sorek each have an older terminal Postgres row under a
     noncanonical `candidate:` key plus a newer canonical active applicant row.
   - The terminal cache recognizes only canonical `suggestion:<id>` saved keys.
   - Applicant enrichment reads every `disposition=recommended` row without
     considering selected/invited/declined engagement.
   - Sorek also has an active roster row whose old pre-merge Dataverse
     suggestion no longer exists.

3. **Diagnosed Lima's failed confirmation.**
   - Two roster PATCH requests returned 409.
   - The current roster row contains no staff confirmation/manual contact, so a
     successful correction was not later erased.
   - The enriched applicant candidate omitted the canonical `candidateKey`
     required by the authoritative confirmation mutation.

4. **Confirmed proposal-selector coupling.**
   - Current default loading requires the exact canonical
     `Reviewer Materials/Proposal_{Request#}.pdf`.
   - The dropdown override is not reload-stable navigation state.
   - Applicant cache/enrichment identity depends on the selected exact file key.

5. **Switched to stabilization mode.**
   - The directive defines the authoritative state contract, five golden
     workflows, a read-only diagnostic harness, a bounded implementation slice,
     dry-run-first data reconciliation, review stop rules, and release criteria.
   - It records the exact legacy `Project Narrative.pdf` fallback as an explicit
     implementation todo without weakening the outbound canonical-file contract.

6. **Established the adjacent-verification pilot directive.**
   - The directive preserves Claude's claim-shape/query-shape insight while
     rejecting wholesale implementation of the proposed enforcement plan.
   - It requires a canonical rule, representative fixtures, an advisory-only
     detector, an observation window, and an explicit retire/advisory/block
     decision before broader harness changes.
   - It prohibits raw-output mandates, privacy leakage, semantic-proof claims,
     and unexplained blockers.

### Recent Runtime Commits

- `e31cf992` — Record reviewer address trust production pilot
- `6bc6d2f5` — Fix verified reviewer email badge precedence
- `87cbb8e5` — Record reviewer conflict review closure
- `974bb64e` — Keep roster email authority address-bound
- `86bf5d11` — Preserve reviewer address blocks on roster refresh

## Next Items

### Verified Open

1. **Execute the adjacent-verification pilot directive in order.**
   Evidence: `docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md`, current hook
   source, and Claude branch commit `848bdb3b` as historical input only.
   Start on a clean feature branch. Build the rule and fixtures before the
   advisory detector. Do not add blockers or broad instruction changes.

2. **Obtain an explicit pilot disposition after observation.**
   Evidence: the controlling directive's acceptance and stop rules.
   Record whether the detector should be retired, remain advisory, or promote
   only named narrow patterns to blocking. Owner approval is required before
   blocking behavior or broader consolidation.

### Owner Decision Needed

1. **Post-observation enforcement posture.**
   Decide whether the pilot is retired, remains advisory, or promotes named
   narrow patterns to blocking. Evidence must include fixture results and the
   observation record.

2. **Later Production promotion and data-repair authorization.**
   When reviewer stabilization resumes, explicit owner authorization remains
   required before merging/deploying Tier 1–3 runtime changes or executing the
   Production roster repair.

### Parked

1. **Reviewer workflow stabilization.**
   `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` remains canonical and is
   the first application priority after the evidence pilot reaches its stop
   decision. Its diagnostic harness, five golden workflows, proposal-selector
   fallback, and dry-run reconciliation requirements remain open.

2. **Other reviewer feature/policy work.**
   Contact-provenance schema, non-response storage, `reviewer_confirmed`
   provenance, identity-policy expansion, and nice-to-have UI work remain parked
   until stabilization exits successfully.

3. **Remaining Initial Assessment infrastructure gates.**
   SharePoint administrator evidence, Workbench history/admin restore, and
   milestone snapshots remain valid but are not the Session 392 coding priority.

### Verify Before Acting

1. **Do not treat command output as semantic proof.**
   Verify that the query shape answers the actual claim. Model-authored pasted
   output is reviewable provenance, not an incorruptible receipt.

2. **Do not confuse requirements with current-state assertions.**
   Normative, hypothetical, historical, and quoted language needs explicit
   handling before any detector can be considered safe.

3. **Do not infer reviewer stage from `wmkf_selected` alone when stabilization
   resumes.**
   Rotem Sorek is `selected=false` because he declined after invitation. Inspect
   invitation/response/token/material/review/completion signals together.

4. **Do not assume `savedKeys` covers every historical promotion.**
   The current reader exposes only canonical saved applicant keys; legacy
   terminal rows under `candidate:` keys can coexist with canonical active rows.

5. **Do not assume a missing Find card means the applicant list must be rerun.**
   Separate proposal resolution, durable roster restore, and model enrichment;
   a same-file reload must be a cache restore.

6. **Re-probe Request `1002912` immediately before any later write.**
   The incident table records a point-in-time baseline, not standing authority
   for future mutation.

### Do Not Reopen Without New Decision

1. **No wholesale implementation of Claude's enforcement proposal.**
   In particular, do not require raw output in durable documents, claim hooks
   provide semantic proof, consolidate memory, or introduce blocking behavior
   before the pilot evidence and owner decision.

2. **No blind reviewer rollback and no one-symptom production patch.**
   A rollback could restore earlier duplicate-person/missing-email behavior.
   A patch that does not satisfy the five golden workflows is not releasable.

3. **Do not weaken the canonical outbound reviewer package.**
   New packages remain `Reviewer Materials/Proposal_{Request#}.pdf`. The planned
   exact `Project Narrative.pdf` fallback is Reviewer Finder compatibility only;
   do not restore `classifyFile` or best-guess PDF selection.

4. **Do not truncate the unresolved-reviewer paper evidence or replace its
   Scholar name search with a stored profile URL.**
   Those remain load-bearing identity controls.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md` | Controlling Session 392 pilot, safety constraints, phases, fixtures, observation, and stop rules |
| `.claude/hooks/lib/document-guards.js` | Existing transcript/read-evidence and newly-introduced-text helpers; does not prove semantic support |
| `.claude/hooks/plan-named-source-read-guard.js` | Current plan-doc named-source read enforcement |
| `.claude/hooks/scope-claim-reminder.js` | Current broad-quantifier advisory behavior |
| `.claude/hooks/design-doc-assertion-guard.js` | Current narrow design-claim enforcement and advisories |
| `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` | Parked but canonical reviewer stabilization plan, golden workflows, selector fallback todo, and exit criteria |
| `lib/services/workbench/applicant-reviewers-service.js` | Applicant-slot materialization; currently drops adapter-returned selected state from its DTO |
| `lib/services/workbench/enrich-recommended-service.js` | Applicant enrichment; currently processes all applicant-recommended rows regardless of engagement |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Dataverse suggestion reads and lifecycle fields |
| `lib/services/reviewer-roster-store.js` | Postgres Find projection and canonical saved-key behavior |
| `shared/components/reviewers/ReviewerSearchSection.js` | Cache, applicant display, confirmation payload, and terminal filtering |
| `shared/components/reviewers/ReviewerFindPanel.js` | Proposal auto-load and manual selector state |
| `lib/services/reviewer-finder/load-proposal-service.js` | Current strict canonical proposal default and validated override |
| `docs/atlas/postgres-reviewer-find-roster.md` | Authoritative Postgres roster ownership/current gotchas |

## Testing Direction

Start with the fixture corpus and focused hook enforcement tests. Run the gate
and its self-test sequentially where one exists. After the bounded pilot:

```bash
rtk npx jest .claude/hooks/hook-enforcement.test.js
rtk npm run check:instruction-architecture
rtk npm run check:agent-invariants
rtk npm run check:docs-catalog
```

Run every additionally relevant documentation/gate self-test sequentially as
required by `docs/CI_GATES_REFERENCE.md`. Do not perform the signed-in reviewer
pilot or any Production writes during the adjacent-verification work.
