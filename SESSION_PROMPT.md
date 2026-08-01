# Session 392 Prompt: Reviewer workflow stabilization

> **READ FIRST:** `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` is the
> controlling directive for this session. The reviewer workflow is stabilizing.
> Do not resume feature development, deploy another local symptom fix, roll back
> blindly, or repair Production data before completing the directive's baseline
> diagnostic and failing golden-workflow tests.

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

### Recent Runtime Commits

- `e31cf992` — Record reviewer address trust production pilot
- `6bc6d2f5` — Fix verified reviewer email badge precedence
- `87cbb8e5` — Record reviewer conflict review closure
- `974bb64e` — Keep roster email authority address-bound
- `86bf5d11` — Preserve reviewer address blocks on roster refresh

## Next Items

### Verified Open

1. **Execute the stabilization directive in order.**
   Evidence: `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md`, current source,
   and the Request `1002912` read-only incident baseline.
   Start with a clean Tier 1–3 branch, build the committed read-only diagnostic
   harness, and write the five failing golden workflows before runtime changes.

2. **Implement the Reviewer Finder proposal compatibility fallback.**
   Evidence: `lib/services/reviewer-finder/load-proposal-service.js` currently
   defaults only to the canonical numbered file; `ReviewerFindPanel.js` keeps a
   deliberate override in component state.
   Required precedence: exact canonical numbered file; otherwise one exact
   legacy `Project Narrative.pdf`; otherwise validated dropdown selection.
   Persist the override across reload, keep cached applicant rows accessible
   while resolving, and do not rerun Claude for the same exact file key.

3. **Prepare, but do not execute, roster reconciliation.**
   Evidence: Request `1002912` has legacy-terminal/canonical-active twins for
   Isberg and Sorek plus one verified missing-suggestion Sorek row.
   The repair must be dry-run-default, backup-producing, Dataverse-validated,
   denominator-printing, and executed only after the recurrence path is closed
   and the owner explicitly authorizes Production writes.

### Owner Decision Needed

1. **Production promotion and data-repair authorization.**
   No new product-policy decision is needed for the five golden workflows.
   Explicit owner authorization is still required before merging/deploying the
   Tier 1–3 stabilization runtime or executing the Production roster repair.

### Parked

1. **Other reviewer feature/policy work.**
   Contact-provenance schema, non-response storage, `reviewer_confirmed`
   provenance, identity-policy expansion, and nice-to-have UI work remain parked
   until stabilization exits successfully.

2. **Remaining Initial Assessment infrastructure gates.**
   SharePoint administrator evidence, Workbench history/admin restore, and
   milestone snapshots remain valid but are not the Session 392 coding priority.

### Verify Before Acting

1. **Do not infer reviewer stage from `wmkf_selected` alone.**
   Rotem Sorek is `selected=false` because he declined after invitation. Inspect
   invitation/response/token/material/review/completion signals together.

2. **Do not assume `savedKeys` covers every historical promotion.**
   The current reader exposes only canonical saved applicant keys; legacy
   terminal rows under `candidate:` keys can coexist with canonical active rows.

3. **Do not assume a missing Find card means the applicant list must be rerun.**
   Separate proposal resolution, durable roster restore, and model enrichment;
   a same-file reload must be a cache restore.

4. **Re-probe Request `1002912` immediately before any write.**
   The incident table records a point-in-time baseline, not standing authority
   for future mutation.

### Do Not Reopen Without New Decision

1. **No blind rollback and no one-symptom production patch.**
   A rollback could restore earlier duplicate-person/missing-email behavior.
   A patch that does not satisfy the five golden workflows is not releasable.

2. **Do not weaken the canonical outbound reviewer package.**
   New packages remain `Reviewer Materials/Proposal_{Request#}.pdf`. The planned
   exact `Project Narrative.pdf` fallback is Reviewer Finder compatibility only;
   do not restore `classifyFile` or best-guess PDF selection.

3. **Do not truncate the unresolved-reviewer paper evidence or replace its
   Scholar name search with a stored profile URL.**
   Those remain load-bearing identity controls.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` | Controlling Session 392 plan, evidence baseline, stop rules, golden workflows, selector fallback todo, and exit criteria |
| `lib/services/workbench/applicant-reviewers-service.js` | Applicant-slot materialization; currently drops adapter-returned selected state from its DTO |
| `lib/services/workbench/enrich-recommended-service.js` | Applicant enrichment; currently processes all applicant-recommended rows regardless of engagement |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Dataverse suggestion reads and lifecycle fields |
| `lib/services/reviewer-roster-store.js` | Postgres Find projection and canonical saved-key behavior |
| `shared/components/reviewers/ReviewerSearchSection.js` | Cache, applicant display, confirmation payload, and terminal filtering |
| `shared/components/reviewers/ReviewerFindPanel.js` | Proposal auto-load and manual selector state |
| `lib/services/reviewer-finder/load-proposal-service.js` | Current strict canonical proposal default and validated override |
| `docs/atlas/postgres-reviewer-find-roster.md` | Authoritative Postgres roster ownership/current gotchas |

## Testing Direction

Do not start with the full suite. First make the five golden workflow tests fail
for the expected current reasons. After the bounded implementation:

```bash
rtk npx jest <focused stabilization suites>
rtk npm run check:types
rtk npm run lint
rtk npx jest tests/unit tests/integration
rtk npm run build
```

Run relevant documentation/gate self-tests sequentially as required by
`docs/CI_GATES_REFERENCE.md`. Finish with the signed-in Request `1002912`
no-send pilot defined in the directive; do not send invitations or promote
contacts during that pilot.
