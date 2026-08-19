# Session 446 Prompt: Review the Institution Shadow Contract and Choose the Next Authority Boundary

## Session 445 Summary

Session 445 shipped the Pre-Site generation and Reviewer Finder remediation,
then moved the institution-affiliation strategy onto
`codex/institution-decision-harness`. The reviewed code tip is `947fb46`; its
new relationship/policy implementation is shadow-only and has no production
caller.

### What Was Completed

1. **Proposal and Pre-Site production workflow refined**
   - Added Reviewer Materials to the Proposal tab and changed the Pre-Site
     institution value to the applicant organization's AKA.
   - Published template v4 with the owner-directed line spacing, 1.5-inch
     metadata label column, and zero value-column indent.
   - Removed brittle narrative length gates, preserved raw/provider diagnostics,
     improved generation failure messages, clarified regeneration as a new AI
     call, and allowed audited prompt-schema/model publication through Admin.

2. **Reviewer identity remediation made actionable**
   - Added durable, request-scoped contact-draft editing with compare-and-swap,
     strict HTTP(S) individual-profile URL validation, and explicit invalidation
     of stale automated/staff identity authority after an ordinary contact edit.
   - Repaired applicant-row error correlation and made malformed response
     correlation fail closed.
   - Reworked reviewer cards so evidence, warnings, status, and the next action
     are not presented as contradictory independent boxes. Held cards now expose
     a relevant confirmation, correction, retry, repair-request, or not-a-fit
     remedy where available.

3. **Institution-affiliation strategy rebuilt around conditional neutrality**
   - Re-adjudicated the 25 unresolved cases with source, currentness,
     author-specificity, typed ROR relationships, and separate relationship and
     consumer-action labels.
   - Added a provenance-preserving ROR assertion resolver and a total five-
     consumer policy evaluator. Unknown enum values fail closed for
     high-authority consumers; sibling organizations never collapse to the same
     entity; historical and additional affiliations remain distinct from current
     conflicts.
   - The frozen Stage 1 artifact passes 25/25 relationship and action decisions,
     1/1 provider-failure copy checks, and 5/5 held-case remedy checks, with zero
     sibling collapses, unsafe clears, or manufactured reviews. The three
     challenged cases are compatible/nonblocking under explicit independent-
     identity sufficiency.
   - A read-only roster audit found 46 source-ready mismatch rows but only two
     with the compact non-affiliation identity anchors inspected. Therefore the
     benchmark's identity-sufficiency value is a counterfactual policy input,
     not production authority.

4. **Promotion-review boundaries hardened**
   - Prevented non-author-specific publication evidence from creating identity
     weight or a current-conflict veto.
   - Made same-parent internal subunits without independent identifiers abstain
     instead of collapsing to parent/child compatibility.
   - Prevented a named organization before an address from being ignored as
     location decoration.
   - Corrected explicit server identity-review reasoning so it cannot render
     beneath the positive `Suggested because:` label.

### Commits

- `45ea7456` — Add reviewer materials to Proposal tab
- `33e8771f` — Use applicant AKA in Pre-Site writeups
- `db9dfef1` — Format Pre-Site Visit template v4
- `a1ea0d01` — Refine Pre-Site template line spacing
- `36a33edb` — Record Pre-Site v4 production release
- `19af2c3e` — Plan Pre-Site generation resilience
- `24decb85` — Harden Pre-Site Visit generation resilience
- `46903bc4` — Allow audited prompt schema publication
- `73d8cb80` — Record Pre-Site resilience production release
- `f9d614ff` — Fix Pre-Site metadata column geometry
- `32b92d51` — Clarify Pre-Site draft regeneration
- `bbde2536` — Remove Pre-Site value-column indent
- `d9c29c7d` — Fix reviewer identity remediation flow
- `c644808d` — Harden reviewer identity remediation
- `f061e08c` — Clarify reviewer evidence and invite actions
- `5fcd913c` — Clarify reviewer identity remediation cards
- `55eafa13` — Add unresolved institution decision smoke harness
- `8723aa9c` — Record unresolved institution smoke results
- `dbafd2ec` — Rework institution compatibility plan
- `23a40e89` — Implement source-aware institution shadow contract
- `0d163998` — Document Session 445 and create Session 446 prompt
- `c8c67aae` — Finalize Session 445 handoff cleanup
- `947fb46` — Harden institution shadow decision boundaries

## Next Items

### Verified Open

1. **Complete owner review of the revised Stage 1 artifact before promotion.**
   Evidence: `947fb46`, the unchanged frozen v1 report, and the caller search in
   `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Engineering promotion
   review is complete and its four falsified boundaries are covered; owner
   acceptance and the Stage 2 authority decision remain open.

2. **Run a staff acceptance smoke of the reviewer identity-remediation flow.**
   Evidence: `docs/REVIEWER_CONTACT_LEADS_SPEC.md` records the durable edit and
   renewed confirmation contract; commits `d9c29c7d` through `5fcd913c` are on
   `origin/main`. Use Peter Reiners or another reviewer who is genuinely intended
   for an invite list; confirm that the card names the problem and exposes the
   exact next action before performing a durable promotion.

3. **Close the previously verified operational smokes.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` still marks the signed-in
   Site Visit handoff and Phase II live-folder display smokes open;
   `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` still records the
   passive Track A closeout separately from the already-passed Stage 2 baseline.

### Owner Decision Needed

1. **Authorize or decline Stage 2 institution rollout.**
   Evidence: the Stage 1 report passes only `GO_FOR_SHADOW_CONTRACT`.
   Stage 2 is limited to notifications and explanatory card UI, with no identity,
   selectability, or Dataverse-write authority. It still requires an explicit
   owner decision and a rollback-preserving implementation plan.

### Parked

1. **Stage 3 institution identity authority.**
   Evidence: the production roster audit found sparse machine-verifiable
   non-affiliation identity inputs. Candidate selectability, write vetoes, and
   identity-anchor weighting remain blocked until that execution-point contract
   exists and the owner approves each consumer separately.

2. **Site Visit dossier/logistics and Final copy transaction.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`. Inventory the existing
   Dataverse fields and registered SharePoint categories before proposing more
   schema or upload paths.

### Verify Before Acting

1. The frozen ROR snapshot contains explicit manual adjudication overlays for
   internal subunits that ROR does not model independently. Do not lower the
   production resolver threshold or overwrite the snapshot; use a new versioned
   capture and re-adjudication.
2. `origin/main` was `e82dfba4` when the review fixes were committed. The feature
   branch was seven commits ahead and three commits behind; fetch and verify both
   tips before merging or making a production release.
3. Stop cleanup verified that the two 162-byte Word lock artifacts had no open
   handles, then moved them out of the worktree to
   `/private/tmp/wmkf-word-locks-session-445-20260819/`. No template content was
   changed, and the repository ended clean.

### Do Not Reopen Without New Decision

1. Another string-side institution checker or a rule that treats UCLA/UCSD-style
   siblings as the same organization.
2. Any production identity/selectability/write flip based only on the 25-case
   shadow pass.
3. A separate Site Visit Writeup or Dataverse staff-observations memo.

## Key Files Reference

| File | Purpose |
|---|---|
| `benchmarks/institution-affiliation-compatibility/v1/results/source-aware-25-shadow-2026-08-19c.md` | Readable Stage 1 before/after report |
| `benchmarks/institution-affiliation-compatibility/v1/cases/source-aware-25.json` | Frozen relationship/action adjudications |
| `lib/services/institution-affiliation-assessment.js` | Typed relationship and total consumer policy |
| `lib/services/ror-affiliation-assertion-resolver.js` | Source/canonical ROR resolution with partial success |
| `scripts/audit-institution-affiliation-shadow-cases.js` | Read-only, PII-bounded roster inventory |
| `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` | Authority stages, gates, and current status |
| `docs/REVIEWER_CONTACT_LEADS_SPEC.md` | Durable contact edit and identity-remediation contract |

## Testing

```bash
npx jest tests/unit/institution-affiliation-assessment.test.js \
  tests/unit/ror-affiliation-assertion-resolver.test.js \
  tests/unit/benchmarks/institution-affiliation-shadow-v1.test.js --runInBand
npm run check:doc-symbol-refs
npm run check:fact-consistency
npm run check:docs-catalog
npm run check:secret-scan
npm run check:types
```

The expanded institution and reasoning suites passed 59/59; targeted ESLint,
TypeScript, documentation/fact/memory/secret gates, and their required self-tests passed.
The webpack production build passed. The default Turbopack build could not bind
its local worker port on this host and failed before compiling application code.
