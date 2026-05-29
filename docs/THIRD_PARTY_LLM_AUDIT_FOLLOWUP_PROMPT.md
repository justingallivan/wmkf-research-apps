---
fact_consistency: point-in-time
---
# Third-Party LLM Audit Follow-Up Prompt

Use this prompt as a response request to the third-party LLM after its `AUDIT_REPORT_2026_05_26.md` review. The goal is to make it correct its prior mistakes, re-verify high-impact claims, and produce a tighter amended report.

````markdown
You previously produced `docs/AUDIT_REPORT_2026_05_26.md`.

Please produce an amended audit response. This is not a fresh vibes-based pass. Your task is to correct your prior report, explicitly account for mistakes and oversights, and re-verify the high-impact findings against live source files.

## Required Correction Standard

For every amended claim, use one of:

- `[VERIFIED]` with exact file path and line reference
- `[INFERRED]` with the evidence chain
- `[CONFLICT]` where repo docs/code disagree
- `[RETRACTED]` where your prior report was wrong or stale
- `[NEEDS OWNER]` where the project owner must answer before action

Do not say "perfect", "fully", "all", "none", "zero", "dead", "safe", or "unblocked" unless you have performed and cited the exact repo search or source read proving it.

If a finding involves destructive cleanup, deletion, dropping tables, removing env vars, retiring files, or removing APIs, you must perform caller analysis and cite the cleanup checklist or blockers. Do not recommend immediate destructive action based only on prior plan text.

## Prior Mistakes And Oversights To Address

Your prior report had several issues that must be corrected:

1. **Incomplete Dynamics write-method analysis**
   - You flagged `DynamicsService.updateRecord()` as missing `checkRestriction()`, but did not analyze sibling write helpers such as `createRecord()` and `deleteRecord()`.
   - Re-read `lib/services/dynamics-service.js` and inventory every method that performs a Dataverse fetch/write, including `_writeFetch()` callers.
   - Determine whether the restriction model is intended to apply only to Dynamics Explorer read/query surfaces or universally to all `DynamicsService` read/write methods.
   - If you recommend adding checks to write helpers, specify whether to check the logical table name or entity set name. Existing read methods resolve entity sets before checking restrictions; do not propose a fix that silently checks the wrong identifier.

2. **Too-narrow fix for `getEntityRelationships()`**
   - Re-verify whether this metadata method should call `checkRestriction(tableName)`.
   - Compare it to `getEntityAttributes()`.
   - Assess whether relationship metadata can reveal restricted table names or fields through navigation metadata.

3. **Overconfident route/auth conclusion**
   - You claimed the API route matrix was perfectly synchronized and that there were no unauthenticated blind spots.
   - Run or inspect the actual route-matrix gate.
   - Note that a passing route inventory gate may only prove coverage, not semantic correctness.
   - If the gate reports warnings, include them and inspect the route(s) involved.

4. **Incorrect or stale Atlas finding**
   - You claimed `docs/atlas/postgres-other-reviewer-tables.md` still said the `proposal_searches` JOIN was load-bearing.
   - Re-read the current file. If the current file already marks the JOIN as retired, retract that finding.
   - Explain whether your prior report was based on stale context, misreading, or insufficient readback.

5. **Unsafe table-drop recommendation**
   - You recommended dropping drain-only reviewer Postgres tables if the pilot is complete.
   - Re-read the relevant cleanup section in `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`.
   - Identify the exact earliest allowed date, required pre-drop probes, backup requirements, restore-script requirement, docs updates, and gates.
   - Do not mark the drop as "ready" unless those conditions are verified satisfied.

6. **Incorrect app-count statement**
   - You said there are 16 active apps and that this matches `CANONICAL_COUNTS.md`.
   - Re-read `shared/config/appRegistry.js` and `docs/CANONICAL_COUNTS.md`.
   - Distinguish "APP_REGISTRY application definitions" from any concept of "active", "retired", or "default-granted" apps.
   - Retract or correct the count statement.

7. **Insufficient deliverable depth**
   - Your prior route/auth matrix collapsed 94 routes into one row. That did not satisfy the requested audit format.
   - Your prior data ownership matrix was also too high-level.
   - In this amended response, provide either a real matrix or explicitly say you are not doing a full route-by-route audit and limit your conclusions accordingly.

## Required Re-Verification Tasks

Perform these checks and cite results:

1. Count route files under `pages/api/**/*.js`.
2. Run or inspect `npm run check:api-routes`.
3. Inspect `scripts/check-api-route-security-matrix.js` and explain what it proves and what it does not prove.
4. Inspect `docs/API_ROUTE_SECURITY_MATRIX.md` around its purpose and automation notes.
5. Inspect `lib/services/dynamics-service.js`:
   - every `checkRestriction()` call
   - every `_writeFetch()` call
   - `createRecord()`
   - `updateRecord()`
   - `deleteRecord()`
   - `getEntityAttributes()`
   - `getEntityRelationships()`
   - `queryRecords()`
   - `getRecord()`
   - `countRecords()`
   - `aggregateRecords()`
   - `queryAllRecords()`
   - `searchRecords()`
6. Inspect `lib/services/dynamics-context.js` and all remaining callers of `DynamicsService.bypassRestrictions()` and `DynamicsService.setRestrictions()`.
7. Inspect `docs/atlas/postgres-other-reviewer-tables.md`.
8. Inspect `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` around the post-pilot table-drop checklist.
9. Inspect `shared/config/appRegistry.js` and `docs/CANONICAL_COUNTS.md`.

## Required Output Format

Produce this amended response:

### 1. Correction Summary

List each prior mistake or overstatement, with:

| Prior claim | Current status | Correction | Evidence |
|---|---|---|---|

### 2. Amended Findings

For each still-valid finding:

```markdown
### F-###: Title

Severity: P0/P1/P2/P3
Status: VERIFIED / INFERRED / CONFLICT / NEEDS OWNER
Prior-report status: unchanged / narrowed / expanded / retracted / split

Evidence:
- `path/to/file.js:123` - exact support

What changed from prior report:
Explain how this finding changed after re-verification.

Risk:
Concrete risk, not abstract concern.

Recommended fix:
Precise implementation guidance. If code identifiers matter, name the exact one.

Validation:
Commands, tests, greps, or gate additions that prove the fix.
```

### 3. Dynamics Restriction Decision Point

Answer these explicitly:

- Are restrictions intended to protect only Dynamics Explorer user-query methods, or all generic `DynamicsService` methods?
- Should write helpers call `checkRestriction()`?
- If yes, how should bypass contexts be established for trusted service paths such as prompt execution, review upload, cron, external token flows, and admin/policy actions?
- Should `checkRestriction()` receive entity set names or logical table names?
- What tests should be added before changing this?

If the repo does not answer one of these, mark it `[NEEDS OWNER]`.

### 4. Route/Auth Matrix Scope

State exactly what you verified:

- route count
- matrix coverage
- guard-token warnings
- whether you did or did not inspect every route semantically

Do not claim "no unauthenticated blind spots" unless you inspected every route's actual guard and data boundary.

### 5. Drain-Table Cleanup Status

State whether the reviewer-domain Postgres table drop is:

- blocked
- not yet due
- ready after checklist
- ready now

Include the earliest date and required checklist items from the repo docs.

### 6. Revised Action Plan

Separate into:

1. Immediate code/security work
2. Near-term migration hygiene
3. Deferred destructive cleanup
4. Documentation corrections
5. Suggested mechanical gates

Every action must cite the finding ID it addresses.

## Quality Bar

- Prefer narrower, correct findings over broad confident claims.
- If you did not inspect something, say so.
- If you found a warning rather than a failure, call it a warning.
- If a doc is already corrected, retract the finding instead of repeating it.
- If a recommendation depends on an owner decision, do not present it as ready-to-implement.
- Avoid "grep-only proof" when behavior depends on wrappers, imports, or semantic guards. Read the files.
````
