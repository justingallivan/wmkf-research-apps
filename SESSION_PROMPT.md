# Session 377 Prompt: Production synthesis smoke and deadline planning

## Session 376 Summary

Session 376 finished the controlled multiselect production rehearsal, recorded the
owner's review-synthesis lifecycle rule, corrected the `/sweep` workflow so it actually
tests durable claims against source/live state, performed an evidence-first Request
Workbench audit, and replaced the contradictory forward roadmap with a near-term
execution plan.

The production review-synthesis smoke is intentionally the first task next session.
After that, continue the product discussion and calendar the plan using Justin's fixed
dates and minimum required outcome at each date.

### What Was Completed

1. **Controlled Request `1002788` multiselect smoke completed and cleaned up**
   - External draft/submit, canonical multiselect storage, Workbench hydration/matrix,
     panel DOCX/PDF, courtesy DOCX, finality, and cleanup passed.
   - Only `Proposal_1002788.pdf` was exposed to the reviewer.
   - No email was sent; existing email markers and the prior synthesis were preserved.
   - Two `review-synthesis.generate` v2 calls failed before writeback with incomplete
     JSON. This remains a red production gate.

2. **Owner's synthesis lifecycle recorded**
   - Automatic generation must wait until all participating invited reviews are in.
   - Staff may deliberately generate early.
   - Stored synthesis must remain visible independently of current readiness.
   - Current source is manual-only, rejects only zero submitted reviews, and hides the
     synthesis card at zero submitted reviews.
   - Declined/withdrew/released/revoked participation semantics remain undecided.

3. **`/sweep` corrected from procedure to evidence workflow**
   - Added changed-fact and domain-audit modes.
   - Requires source/live truth before prose reconciliation.
   - Requires producer → persistence → consumer evidence and explicit
     `VERIFIED` / `PARTIAL` / `PLANNED` / `STALE-CONFLICT` / `UNKNOWN` labels.
   - Requires structural repairs, semantic contradiction searches, and durable audit
     artifacts for substantial audits.

4. **Fact gate strengthened and independently tested**
   - Workbench tab totals are derived from `pages/workbench/[requestId].js`.
   - Current code-derived truth: 10 total, 6 live, 4 placeholders.
   - Markdown links, bold, underline, and code formatting can no longer hide stale
     numeric claims.
   - The self-test independently derives Workbench counts and includes the exact bolded
     stale-placeholder regression.

5. **Deep Request Workbench truth audit completed**
   - Six live tabs: Overview, Proposal, Reviewers, Reviews, Status, Awardee.
   - Four placeholders: Initial Writeup, Pre Site Visit Writeup, Site Visit,
     Final Writeup.
   - Reviews is live; synthesis exists end to end but is runtime-red.
   - Awardee/grantee deliverables and `/external/grantee/[token]` are live.
   - Proposed `wmkf_ai_initialwriteupurl` and
     `wmkf_ai_presitevisitwriteupurl` fields are absent in production.
   - Proposed `writeup.initial` and `writeup.pre-site-visit` prompt rows are absent.
   - Existing production fields `akoya_sitevisitdate` and `akoya_sitevisitnotes`
     falsify the claim that Site Visit necessarily needs new schema.

6. **Durable roadmap structurally reconciled**
   - The old Workbench build plan is historical implementation chronology.
   - The June Group B writeup document is a historical proposal, not an
     implementation-ready plan.
   - Awardee memory now describes the shipped portal/entity contract.
   - Current queue, strategy, strategy wiki, and docs catalog point to the audit and
     new near-term plan.

7. **Near-term execution plan written**
   - First: production synthesis smoke and reliability diagnosis.
   - Then: close synthesis lifecycle/readiness/visibility.
   - Then: deadline-driven design freeze for the four placeholder tabs.
   - Then: build the first complete deadline-bound writeup slice, provisionally
     Pre Site Visit Writeup.
   - Exact calendar commitments are deliberately deferred until Justin supplies the
     dates and minimum required outcome at each.

### Commits

- `c56071dc` — Record multiselect production smoke outcome
- `95a567dd` — Record review synthesis readiness workflow
- `12f588d3` — Fix sweep to verify facts against source
- `bff2b4ab` — Audit Workbench truth and reset near-term plan

## Next Items

### Verified Open

1. **FIRST: run the deliberate production review-synthesis smoke on Request `1002788`.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` and
   `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md`.
   Use the staff-triggered Generate/Regenerate action. Verify complete schema-valid output,
   `wmkf_reviewsynthesisjson` persistence, reload visibility, deliberate overwrite,
   useful logs, and absence of unrelated reviewer/email/materials writes. If it fails,
   stop at a bounded diagnosis; do not add automatic triggering.

2. **Continue the deadline and lifecycle design discussion.**
   Evidence: `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` Calendar Gate and
   Decision Log.
   Obtain each fixed date, the audience at that date, and the minimum artifact/action
   that must work. Convert the relative Week 1/2/3 plan to calendar commitments only
   after those facts are supplied.

3. **Close the review-synthesis contract after the smoke.**
   Evidence: `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` and source-backed audit.
   Diagnose incomplete JSON; add write-on-success characterization; implement one tested
   readiness calculation, one automatic all-in path, one explicit manual early-run path,
   and stored-output visibility independent of readiness.

4. **Finish the remaining review-form pre-exposure gates.**
   Evidence: `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md` §9.
   After synthesis is resolved or deliberately rolled back, complete the remaining
   staff-writer success rehearsal, rollback/republish proof, final smoke, and exposure.
   The recorded target go-live is 2026-08-15; confirm it in the deadline discussion.

### Owner Decision Needed

1. **Fixed deadlines and minimum outcomes.**
   Needed for Reviews/synthesis, Pre Site Visit Writeup, Site Visit, Final Writeup,
   Initial Writeup, and any leadership/editor surface.

2. **Synthesis participation semantics.**
   Decide whether declined, withdrew, released, revoked, duplicate, and cancelled
   invitation rows count toward “all invited reviews are in.”

3. **Pre Site Visit inputs.**
   Decide whether generation consumes raw structured reviews, the stored synthesis,
   or both.

4. **Writeup artifact contract.**
   Decide file naming, SharePoint destination, pointer/version storage,
   regeneration/overwrite behavior, and access.

5. **Site Visit contract.**
   Decide whether existing `akoya_sitevisitdate` and `akoya_sitevisitnotes` are
   sufficient and who owns editing them.

### Parked

1. **Automatic synthesis triggering until readiness semantics are approved.**
   Current source has no automatic caller. Re-open immediately after the participation
   decision and production reliability gate.

2. **Implementation of the four placeholder tabs until the design/calendar gate.**
   The next plan is intentionally contract-first; do not fill placeholders from the
   historical June assumptions.

3. **Reviewer Pool and Executive Dashboard.**
   Re-open only if the deadline discussion establishes a near-term user and required
   outcome.

### Verify Before Acting

1. **Do not use the old Workbench build plan as forward authority.**
   It is historical. Use the 2026-07-26 audit and near-term execution plan.

2. **Do not assume proposed writeup fields or prompt rows exist.**
   Production probes found the URL fields absent, and the live prompt inventory has no
   `writeup.*` rows.

3. **Do not create new Site Visit schema without testing the existing fields against
   the approved product contract.**

4. **Do not describe Awardee as unbuilt or as requiring reviewer `lib/external`
   generalization.**
   The grantee portal and `wmkf_granteedeliverable` persistence are live.

5. **Do not interpret the next manual synthesis smoke as authorization for a
   one-review automatic trigger.**

### Do Not Reopen Without New Decision

1. **Reviewer materials expose only `Proposal_{Request#}.pdf`.**
   The timestamped materials file contains more than reviewers should receive.

2. **Profile Settings → Email Signature was deliberately not changed.**

3. **The question set and compatible multiselect prompt are published.**
   Do not republish or re-key except through the frozen rollback/republish procedure.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md` | Evidence matrix supporting/falsifying Workbench claims |
| `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | Current relative-week critical path and decision gates |
| `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` | Detailed Reviews/synthesis implementation and production-red evidence |
| `docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md` | Frozen remaining pre-exposure release procedure |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical current priority |
| `.claude/skills/sweep/SKILL.md` | Corrected evidence-first reconciliation workflow |
| `scripts/lib/canonical-facts.js` | Code-derived Workbench and repository scalar facts |
| `scripts/check-fact-consistency.js` | Durable scalar drift gate |
| `pages/workbench/[requestId].js` | Canonical Workbench tab dispatch |
| `shared/components/workbench/ReviewsTab.js` | Reviews UI and synthesis card/readiness behavior |
| `pages/api/review-manager/synthesize-reviews.js` | Manual synthesis API entry point |

## Testing

```bash
rtk npm run check:fact-consistency
rtk npm run check:fact-consistency:self-test
rtk npm run check:agent-wiki
rtk npm run check:agent-wiki:self-test
rtk npm run check:build-claim-freshness
rtk npm run check:build-claim-freshness:self-test
rtk npm run check:canonical-pointers
rtk npm run check:canonical-pointers:self-test
rtk npm run check:docs-catalog
rtk npm run check:instruction-architecture
rtk npm run check:agent-invariants
rtk npm run lint
```
