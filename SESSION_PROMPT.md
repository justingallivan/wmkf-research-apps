# Session 179 Prompt: Intake portal drain build (or Connor batch + doc reconciliation)

## Session 178 Summary

A big session: **slice-0 Dataverse schema deployed to prod** after two
pre-deploy edits, and the **intake-portal architecture pivoted to
single-phase submission**, producing a comprehensive drain plan that
went through two rounds of Codex review.

### What Was Completed

1. **Slice-0 schema deployed to prod Dataverse** (commits `279d556` +
   `7cec6da`). Two pre-deploy edits to the wave-4 specs:
   - `wmkf_proposalbudgetline.wmkf_category` — added `Tuition` at
     `100000005`; cost-share block shifted up by 1 (now a 10-value enum).
     Cap mechanism (fixed $ vs % of budget) recorded as open decision in
     `BUDGET_FORM_SPEC.md`.
   - `wmkf_portal_membership` → `wmkf_portalmembership` — dropped internal
     underscores to match sibling `wmkf_App*` convention. Renamed the
     spec + atlas files, schemaName, 4 relationship schema names, and the
     `targetEntity` contract line in the admin build plan.

   Deploy verified: both new entity sets live (HTTP 200), `@odata.bind`
   nav-keys confirmed from live metadata, all four post-deploy gates
   green.

2. **Architecture pivot — single-phase submission.** Original pilot
   model ("Phase II attaches to an existing `akoya_request`") was killed
   after Justin + Connor decided to move to single-phase for the next
   cycle. The drain now **creates** a new `akoya_request` rather than
   updating one. Rationale: building Phase-II-attach infrastructure for
   one cycle then throwing it away was waste.

3. **Live probe verified the architecture.** Posted `akoya_request` to
   prod with a client-supplied GUID against dummy account "New Cranberry
   Sauce": HTTP 201, server returned identical GUID, DELETE 204.
   Confirms (ii)-refined is viable: no schema changes for idempotency,
   no sentinel field needed. `submission_jobs.request_id` stays
   `NOT NULL`. Required-on-Create fields: just 2 (`akoya_applicantid`
   lookup→`account`, `akoya_fiscalyear` String).

4. **Drain plan v3 produced** (commit `1ee0fd3`,
   `docs/INTAKE_PORTAL_DRAIN_PLAN.md`). Comprehensive build plan: P0–P4
   prerequisites, full state machine, error taxonomy, child Create
   payload shapes, sharpened Connor questions, doc-reconciliation list.

5. **Codex review rounds 1 + 2 fully folded** (32 findings: 7 BLOCKER /
   17 MOD / 8 LOW). All findings spot-verified before folding; Codex was
   consistently precise with file:line references. Round 3 attempted
   twice (background, then foreground re-dispatch) — Codex CLI exceeded
   the agent response window both times, no round-3 findings returned.
   v3 treated as the working plan; first build step (P0) acts as the
   buildability sanity check.

6. **Memory reconciled** (commit `545aaed`):
   `slice0-deactivate-not-delete-recalc` updated from
   "gate OPEN, awaiting Connor" (S165) to "gate CLOSED, schema DEPLOYED"
   (S178).

### Commits (S178, `main`, 4)

- `279d556` Slice-0 schema: add Tuition + rename wmkf_portalmembership
- `7cec6da` Slice-0 schema DEPLOYED to prod Dataverse (S178)
- `545aaed` Memory: reconcile slice-0 entry to DEPLOYED state
- `1ee0fd3` Intake portal drain plan v3 (S178) — Codex rounds 1+2 folded

## Potential Next Steps

The drain plan calls out several pieces of work. They are roughly
independent and can be tackled in any order.

### 1. Connor email — sharpened Q1–Q4

Plan §"Connor questions" has the four sharpened asks. Q1 is the most
load-bearing (which source picklist field + integer + label for the
post-submit status; affects Q4 directly). Q2 covers PI/contact
attribution per the institution-contact-role triad. Q3 covers AkoyaGO
view filters. Q4 needs the exact Option A′ condition expression + P4
evidence artifacts.

Action: draft email content from the plan's §Connor questions, send,
park until Connor responds. Q1 + Q4 gate the drain's `status_flipped`
state only — everything else can build in parallel.

### 2. Doc reconciliation (Phase II → single-phase + deploy state)

Plan §"Doc reconciliation" lists 10 docs/memory files carrying stale
Phase II framing or pre-deploy-posture language. **Important catch from
Codex round 2:** `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` still says
"deploy is pending Justin's explicit go-ahead" even though we deployed.
Mechanical search-and-replace pass; commit as one batch.

### 3. Build P0 — `submission_jobs` status CHECK migration

Smallest, most isolated build step. Migration `010_submission_jobs_states.sql`
+ matching update to `scripts/setup-database.js:609` inline block. Adds
`request_created`, `akoya_requestnum` column, `locked_until` column, and
the new partial unique index. ~30-minute task. Acts as a "v3 is
buildable" confirmation.

### 4. Build P1 — broadened structured-error shape

Half-day. Patch `dynamics-service.{create,update,get,queryRecords}` +
`graph-service.{upload,search}` to throw errors with `.status`,
`.serviceName`, `.dataverseCode`. Shared `buildServiceError` helper.
Small test suite. Cross-cutting but mechanical; unblocks the drain's
error taxonomy classification.

### 5. Build P2 — `contact.wmkf_portal_oid` mini-deploy

Schema follow-up: add the field + alternate key to `contact` via
`apply-dataverse-schema.js --wave=4-followup`. Was a doc-vs-catalog gap
that slipped slice-0; load-bearing for the auth→contact bridge.

### 6. Build P3 — `intake_drafts` uniqueness rework

Migration `011_intake_drafts_uniqueness.sql` + matching patch to
`lib/services/intake-draft-service.js:68` upsert. The schema-only path
would break autosave; must be bundled. Codex round 2 caught this.

### 7. Build P4 — private Blob store provisioning

Provision `intake-applicant-private` Blob store via Vercel CLI, set
`INTAKE_BLOB_RW_TOKEN` per environment, update CREDENTIALS_RUNBOOK.
Manual provisioning per the Vercel-CLI gotcha documented for DVX.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/INTAKE_PORTAL_DRAIN_PLAN.md` | v3 working plan — covers everything below |
| `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json` | Budget-line entity spec (Tuition added S178) |
| `lib/dataverse/schema/wave4/wmkf_portalmembership.json` | Membership entity (renamed S178) |
| `lib/db/migrations/009_submission_jobs.sql` | Queue table; status CHECK needs migration 010 update |
| `lib/services/intake-draft-service.js` | Draft autosave; upsert needs P3 patch |
| `lib/services/dynamics-service.js` | Throw sites need P1 patch |
| `lib/services/graph-service.js` | Throw sites need P1 patch |
| `shared/forms/phase-ii-research-2026-06/validate.js` | Form validator (uses `scan_result === 'clean'`) |
| `scripts/setup-database.js` | Lines 609 + 687 need updates with P0/P3 migrations |
| `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` | Still has stale pre-deploy language (Codex 6.1) |

## Known Open Items (architectural)

These are explicitly **not** drain-blockers, but flagged for awareness:

- **Tuition cap rule** — fixed-$ vs %-of-budget decision (TBD), parked
  in `BUDGET_FORM_SPEC.md`. Affects validation rule only.
- **`status_flipped` target value** — depends on Connor Q1; the build
  can scaffold up to `dynamics_patched` without it.
- **Option A′ recompute flow on real schema** — Connor's P4
  re-verification post-deploy; gates PA-flow-live only, not the
  deployed schema.

## Codex Review Trail

Round 1: 21 findings (4 BLOCKER / 11 MOD / 6 LOW) — fully folded into v2.
Round 2: 11 findings (3 BLOCKER / 6 MOD / 2 LOW + 1 NIT-confirming-clean) — fully folded into v3.
Round 3: inconclusive (Codex CLI exceeded agent response window twice). v3 treated as the working plan.

Convergence rate (21 → 11) suggests v3 is likely cleaner than v2, but
nothing's perfect. The first build step (P0) is intentionally small +
isolated so any structural surprises surface cheaply.

## Testing

```bash
# Verify the deployed slice-0 schema is still healthy
npm run check:atlas && npm run check:atlas:self-test
npm run check:api-routes
npm run check:fact-consistency

# Probe the deployed entities live (read-only)
node -e "/* see Bash transcript S178 for the GUID/entity-set probes */"
```
