# Session 447 Prompt: Observe Stage II and Close Signed-In Smokes

## Session 446 Summary

Session 446 resolved the grantee upload failure reporting gap, put durable
operational observability into Production, completed the source-aware
institution decision harness, passed signed-in synthetic Preview acceptance,
and promoted Stage II low-authority presentation to Production.

### What Was Completed

1. **Grantee upload failures became actionable**
   - Submit failures now preserve their failure class and present clearer
     feedback instead of collapsing image, SharePoint, virus-scan, and
     Dataverse failures into one generic message.
   - Error-severity notifications are mirrored into the durable operational
     event store shipped later in the session.

2. **Operational observability shipped and activated**
   - PRs #123 and #124 added the `operational_events` Postgres store, best-effort
     redacted recording, recovery/supersede handling, Vercel Log Drain ingest,
     admin visibility, and bounded retention.
   - Migration 030 is applied to Production. The signed drain, environment
     configuration, deduplication, storage, admin smoke, and recovery paths were
     verified live. Do not rerun `scripts/setup-database.js` against Production.

3. **The institution decision contract was rebuilt and adversarially reviewed**
   - Added source/currentness-aware affiliation assertions, typed organization
     relationships, a total five-consumer policy, and a frozen 25-case shadow
     evaluation with zero sibling collapses or unsafe clears.
   - Stage II remains low authority: it changes notification and explanatory
     reviewer-card presentation only. Candidate selectability, person identity,
     COI, and Dataverse-write authority still use incumbent contracts.
   - Claude Fable's pre-enable findings were fixed and its post-fix review
     approved the implementation with no P0/P1/P2 findings.

4. **Signed-in Stage II Preview acceptance passed**
   - The Preview-only `/workbench/institution-stage2-smoke` page renders the real
     `CandidateCard` with six projector-pinned synthetic cases and no
     persistence path.
   - The owner confirmed all six states and completed the local action check;
     automated coverage exercised all eight notice actions with zero network
     calls. The focused institution matrix passed 202/202 across 11 suites.
   - The harness was synthetic because the pre-enable Production audit found
     952 roster rows and zero persisted Stage II presentation DTOs.

5. **Stage II merged and became Production-live**
   - PR #126 merged at `8c64ec76`; all GitHub, security, test, review, and
     deployment checks passed.
   - A repeated read-only Vercel probe verified
     `NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION="on"` in Production.
   - Production deployment `dpl_HXZrU8Y4wyEW4BbQiJ974byqGryh` is Ready on all
     application aliases. The exact unset/`off` path remains the rollback.
   - Durable documentation was reconciled in `1173d086` after an earlier stale
     claim incorrectly described the Production flag as off.

6. **Vercel update reminders were retired as routine chatter**
   - PR #125 records the lasting owner preference: do not mention routine
     Vercel CLI updates unless a concrete version incompatibility blocks work.

### Key Commits

- `3554b91f` / `c6c1f088` - clarify and persist grantee upload submit failures
- `9de8b348` / `8e92c9e8` - merge operational observability PRs #123 and #124
- `23a40e89` - implement the source-aware institution shadow contract
- `6b2f2595` / `0089822f` - implement and harden Stage II presentation
- `80f2d739` - add the signed-in Preview smoke page
- `41f08d9f` - merge the lasting Vercel-reminder preference
- `8c64ec76` - merge institution decision harness PR #126
- `1173d086` - reconcile Stage II Production enablement documentation

## Next Items

### Verified Open

1. **Observe Stage II Production outcomes through 2026-09-02.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` and exact-on
   Production probe. Sample naturally produced Stage II DTOs for false-clear
   risk, informational-alert volume, and whether compatible/historical copy
   reduces manual review. Do not manufacture shared-roster rows.

2. **Run a staff acceptance smoke of reviewer identity remediation.**
   Evidence: `docs/REVIEWER_CONTACT_LEADS_SPEC.md`; commits `d9c29c7d` through
   `5fcd913c` are on `main`. Use a reviewer genuinely intended for an invite
   list and confirm the card names the problem and exposes the exact next action
   before any durable promotion.

3. **Finish the read-only Phase II document display smoke.**
   Evidence: `83b9c68a` and the signed-in Workbench session demonstrated a real
   Phase II PDF read, but did not formally record filenames plus both View and
   Download end to end. This smoke must remain read-only.

4. **Re-probe and close Track A passive safety.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` still
   marks the 48-hour watch open. Its retained statement that no Log Drain exists
   is now stale because operational observability is live; establish a current
   collection method before treating the old export procedure as actionable.

### Owner Decision Needed

1. **Choose an approved request for the Site Visit handoff smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` marks the signed-in
   handoff smoke open. The action records a durable Draft-to-Review milestone
   and locks Pre-Site regeneration, so do not click it without explicit request
   approval.

2. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: Stage II is Production-live behind an exact-on public build flag.
   A reminder is scheduled. If behavior is stable and Stage II is the intended
   default, remove the temporary flag from code and Vercel configuration and
   rely on deployment rollback.

### Parked

1. **Stage III institution identity authority.**
   Evidence: the Production roster audit found sparse machine-verifiable
   non-affiliation identity inputs. Selectability, write vetoes, and identity
   weighting remain blocked until the execution-point contract exists and each
   consumer is separately approved.

2. **Site Visit dossier/logistics and Final copy transaction.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`. Inventory existing
   Dataverse fields and registered SharePoint categories before proposing
   schema or upload changes.

### Verify Before Acting

1. Re-probe the live Stage II environment and replacement deployment before
   changing or removing the rollout flag; `NEXT_PUBLIC_` changes require a new
   build.
2. Treat the Stage II 25-case gate as low-authority presentation evidence only;
   it does not authorize identity, selectability, COI, or durable-write changes.
3. Reconcile the Track A plan with the now-live Log Drain before collecting or
   interpreting its closeout evidence.

### Do Not Reopen Without New Decision

1. Another string-side institution checker or a rule that collapses sibling
   institutions such as UCLA and UCSD.
2. Any Stage III authority flip based only on the 25-case Stage II benchmark.
3. A separate Site Visit Writeup or Dataverse staff-observations memo.
4. Routine Vercel CLI update reminders when no concrete incompatibility exists.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` | Stage II authority, evidence, rollout, and remaining gates |
| `shared/utils/institution-stage2-presentation.js` | Exact rollout flag and versioned DTO activation |
| `pages/workbench/institution-stage2-smoke.js` | Signed-in Preview-only synthetic presentation harness |
| `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md` | Durable event and Vercel Log Drain contract |
| `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md` | Site Visit handoff and Final lifecycle |
| `shared/components/workbench/ProposalTab.js` | Phase II document display |
| `docs/REVIEWER_CONTACT_LEADS_SPEC.md` | Reviewer identity-remediation acceptance contract |

## Testing

The institution matrix passed 202/202 across 11 suites. PR #126 also passed
Jest, Playwright, Claude review, Semgrep, Trivy, Gitleaks, and Vercel checks.
The Production flag/documentation correction passed document symbol, currency,
fact-consistency, catalog, secret-scan, and agent-invariant gates plus required
self-tests. Claim-evidence reporting was unavailable because local advisory
state could not be read; no observation row was added.
