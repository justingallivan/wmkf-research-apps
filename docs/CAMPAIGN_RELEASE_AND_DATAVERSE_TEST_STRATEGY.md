---
title: Campaign Release and Dataverse Test Strategy
domain: engineering-process
kind: decision
status: active
summary: "Campaign-aware release, rehearsal, Dataverse isolation, promotion, and rollback strategy for the twice-yearly proposal-review workflow."
canonical: false
cataloged: 2026-07-09
owner: product-engineering
related:
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
  - docs/CREDENTIALS_RUNBOOK.md
  - docs/AGENT_COLLABORATION_PLAN.md
  - docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md
---

# Campaign Release and Dataverse Test Strategy

**Adopted:** 2026-07-09  
**Scope:** release and test posture for staff applications and external reviewer
flows before, during, and after the Foundation's two annual proposal-review
campaigns.

This is the governing direction for campaign-critical change. It is intentionally
small-team friendly: one developer with another full-time role must be able to run
it without maintaining a permanent release-engineering program.

This strategy does **not** claim that every control below is already implemented.
State labels are load-bearing:

- **[CURRENT]** exists and was verified from current source or a named durable source.
- **[TARGET]** is the adopted operating rule.
- **[PLANNED]** requires implementation before it can be relied on.
- **[CAMPAIGN GATE]** must be satisfied before the named campaign phase or release.
- **[OWNER DECISION]** requires an explicit product/operational choice.

## 1. Why the Release Model Must Change

The application has two very different operating seasons:

1. Long quiet periods in which architectural work and rehearsal are possible.
2. Short campaign periods in which staff and inexperienced external reviewers
   need the system to work, and debugging time is scarce.

The current infrastructure adds two hazards:

- **[CURRENT]** Pushing `main` auto-deploys to production. A merge or push is
  therefore a release action, not only a source-control action.
- **[CURRENT]** Preview/local code can still point at the common production
  Dataverse substrate. A separate application deployment does not by itself
  isolate data writes.

The goal is not a long-lived rewrite branch. It is to keep production continuously
available while replacing risky internals behind stable seams, with old and new
behavior able to coexist until the new path has survived real campaign use.

## 2. Non-Negotiable Invariants

1. **Production availability wins during an active campaign.** Architectural
   cleanup waits unless it is required to resolve an incident.
2. **External users are part of the release contract.** A staff-only happy path
   is insufficient; invitation, link, accept/decline, return, upload, validation,
   retry, and help/error states must be rehearsed as a first-time reviewer sees them.
3. **Deployment isolation is not data isolation.** Any preview or local process
   pointed at production Dataverse is treated as production-capable.
4. **No test sends to unapproved addresses.** Rehearsals use capture mode, browser
   mocks, or a server-side email allowlist containing addresses controlled by staff.
5. **Dataverse changes are expand-first and reversible.** Campaign-critical releases
   do not require an immediate destructive schema change or data cleanup.
6. **Rollback includes data consequences.** Reverting code does not undo Dataverse,
   Postgres, SharePoint, Blob, or email side effects.
7. **One person must be able to operate the release.** Every release has a short
   checklist, a known-good deployment, and a rollback path that does not depend on
   reconstructing context during an incident.

## 3. Campaign Calendar and Change Posture

Use dates relative to each campaign rather than hard-coding a calendar that will
drift. The campaign owner records actual dates for each cycle.

| Window | Default change posture | Required evidence |
|---|---|---|
| Post-campaign, weeks 0-2 | Repair, retrospective, incident follow-up, test gaps | Ranked failure list; production data cleanup accounted for |
| Quiet window | Refactors, additive schema, branch-by-abstraction, shadow comparison | Characterization tests; old path retained; rollback demonstrated |
| T-8 weeks | Feature complete for campaign-critical work | Integrated preview; data contract and migration review complete |
| T-6 weeks | Rehearsal and defect repair only | Staff UAT; naive-user rehearsal; controlled Dataverse rehearsal |
| T-3 weeks | Soft freeze | Only campaign blockers or low-risk isolated fixes; owner approval |
| T-1 week through campaign close | Hard freeze | Incident fixes only; explicit rollback plan; focused regression |
| Post-campaign observation | Stabilize before removing old path | One complete campaign on new behavior plus reviewed telemetry |

The exact week boundaries can move for a cycle. The sequence cannot: build,
integrate, rehearse, freeze, operate, observe, then remove.

## 4. Risk-Tiered Git and Release Workflow

The old default of doing nearly everything directly on `main` is superseded by
this risk-tiered rule.

**[PLANNED]** The current `/stop` skill still hard-codes `git push origin main`.
Until that workflow is made branch-aware, do not use it blindly from a feature
branch; verify and push the current branch explicitly.

### Tier 0 — direct-to-main is acceptable

Examples: documentation, tests that do not change runtime behavior, narrowly
isolated copy changes, and mechanical maintenance with no production side effect.

Requirements: clean diff, relevant gates, descriptive commit. A push still deploys,
so defer even Tier 0 pushes during the hard freeze unless useful to the campaign.

### Tier 1 — short feature branch

Examples: a contained UI fix or internal refactor with a stable public contract.

Requirements: short-lived branch, automated tests, preview deployment where useful,
review of the final diff, deliberate merge/push to `main`.

### Tier 2 — campaign-critical branch and promotion

Examples: authentication, invitation or reminder behavior, external reviewer flows,
Dataverse writes, migrations, email, uploads, background work, or cross-layer refactors.

Requirements:

1. Branch or worktree isolated from `main`.
2. Characterization coverage for current behavior before changing it.
3. Integrated preview or local deployment using one of the approved data modes below.
4. Staff rehearsal and, for external flows, naive-user rehearsal.
5. Recorded last-known-good production deployment and rollback steps.
6. Explicit owner decision to merge and push `main`.

### Tier 3 — major replacement

Examples: broad reviewer workflow redesign or replacement of a shared data-access
layer.

Requirements: all Tier 2 controls plus branch-by-abstraction, deterministic cohort
selection, old/new coexistence, and at least one complete campaign of observation
before the old path or schema is removed.

Long-running branches are integration risks. Keep the architectural branch alive by
regularly bringing in `main`, but deliver it as small, independently safe slices
behind stable seams rather than as one final reintegration event.

## 5. Approved Test and Rehearsal Modes

No single environment answers every testing need. Choose the lowest-risk mode that
can prove the behavior in question.

| Mode | Application | Data target | Writes | Appropriate use |
|---|---|---|---|---|
| A. Isolated automation | Test/local | Fixtures and browser/API mocks | No external writes | Unit, integration, and browser behavior |
| B. Read-only shadow | Preview/local | Production Dataverse | **Denied by target control** | Realistic reads and old/new output comparison |
| C. Sandbox integration | Preview/local | Dataverse sandbox | Allowed | Full write-path and schema rehearsal |
| D. Controlled production rehearsal | Production or approved local | Production Dataverse, dedicated test records only | Narrowly allowlisted | Final end-to-end proof that cannot be reproduced elsewhere |
| E. Campaign production | Production | Production services | Normal authorized behavior | Real staff and reviewer use |

### Mode A — isolated automation

**[CURRENT]** The reviewer browser rehearsal can route-mock the application APIs and
exercise the real pages without reaching Dataverse, SharePoint, Dynamics email, or
Blob. This is the default for frequent development feedback.

### Mode B — production-read shadow

**[TARGET]** A preview may read realistic production data to compare old and new
behavior, but all Dataverse writes are denied at the shared service boundary.
Shadow outputs go to logs or a dedicated non-production comparison store; they never
update the source record or trigger email.

**[PLANNED]** The repository does not yet have the general Dataverse target/write
interlock described in section 6. Until it does, pointing a preview or local app at
production Dataverse is not safely read-only merely because the operator intends it
to be.

### Mode C — Dataverse sandbox

**[CURRENT — documented 2026-06-02; re-probe required]** A reachable Dataverse
sandbox exists, but the recorded state is schema-stale for reviewer Workbench use:
core reviewer entities were absent and policy-version seed rows were missing.
`DYNAMICS_SANDBOX_URL` is used by selected adapters and scripts; the general
application runtime reads `DYNAMICS_URL`.

**[CAMPAIGN GATE]** Before calling the sandbox a reviewer test environment:

1. Re-probe its current schema and permissions.
2. Apply the current custom reviewer schema through the supported schema process.
3. Seed required policy/configuration rows using non-production content.
4. Verify authentication, file, background-job, and email behavior independently.
5. Maintain a reset procedure and a small set of named test personas/requests.

Sandbox email may be disabled. That is acceptable: use capture/allowlisted email for
delivery tests and use the sandbox to prove data behavior.

### Mode D — controlled production rehearsal

Use only when production integration behavior cannot be proven in A-C.

Requirements:

- A dedicated owner-approved test request and throwaway reviewer records.
- Server-side request/record and recipient allowlists.
- A written list of expected writes and cleanup ownership before the test.
- Capture mode unless a real email delivery check is the specific test objective.
- Explicit confirmation for any real send.
- Post-run reconciliation of created/updated records; cleanup failures are recorded,
  not silently ignored.

## 6. Dataverse Target and Write Interlock

**[PLANNED — highest-priority enabling control]** Add a centralized, fail-closed
interlock at the trusted Dataverse write boundary. UI warnings and route-specific
flags are not sufficient.

The decision must combine server-known facts:

1. Deployment class: production, preview, local, test, or cron/worker.
2. Dataverse target classification: production, sandbox, or unknown.
3. Operation class: read, create, update, delete, action, or batch.
4. Rehearsal context: named purpose, approved request/record IDs, and actor.

Minimum policy:

| Deployment / target | Default policy |
|---|---|
| Production app -> production Dataverse | Normal trusted-context enforcement |
| Preview/local -> production Dataverse | Reads allowed only when explicitly configured; writes denied |
| Preview/local -> sandbox Dataverse | Writes allowed through normal trusted context |
| Any deployment -> unknown Dataverse target | Fail closed |
| Approved production rehearsal -> production Dataverse | Only named operation classes and allowlisted records |

An exception must be server-side, narrow, auditable, and time-bounded. Never accept a
client-supplied “test mode” flag as authority to write production data.

Email, SharePoint, Blob, Postgres, and background jobs need their own side-effect
controls. A Dataverse interlock alone does not make a flow harmless.

## 7. Capture Mode Is an Email Control, Not a Sandbox

**[CURRENT — verified from source 2026-07-09]**

- `REVIEWER_EMAIL_DELIVERY_MODE=capture` is refused when `VERCEL_ENV=production`.
- It returns a rendered artifact instead of creating/sending a Dynamics email.
- It skips contact promotion and ORCID back-propagation in the send service.
- Rendering a template that contains an external-review link calls
  `mintAndStore()` and persists a fresh token hash/expiry on the reviewer suggestion.
- A captured invitation send with `markAsSent=true` still stamps the invitation
  lifecycle fields.

Therefore:

- Browser route mocks are the side-effect-free rehearsal path.
- Local/preview capture against live APIs is a **controlled-write rehearsal**.
- Capture against production Dataverse uses Mode D test records only.
- A future true dry-run must explicitly suppress or redirect token and lifecycle
  writes; changing email delivery alone is insufficient.

The concrete reviewer commands and cleanup procedure remain in
`docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md`.

## 8. Refactoring Without a Big-Bang Reintegration

Use branch-by-abstraction:

1. Characterize the existing public behavior at the real seam.
2. Introduce a narrow facade or decision seam without changing behavior.
3. Build the replacement behind that seam.
4. Run old and new paths on the same read input where safe.
5. Compare normalized outputs and record mismatches without changing user-visible
   behavior.
6. Select a deterministic internal cohort: campaign/request/user allowlist, never a
   random percentage for this small user population.
7. Expand only after the error budget and rehearsal evidence are acceptable.
8. Keep the old path available through the next campaign.
9. Remove the old path and compatibility fields in the following quiet window.

Flags must be server-authoritative, have an owner and removal condition, and be
observable in logs. Environment-only flags are appropriate for emergency deployment
controls; Dataverse-backed or otherwise dynamic flags are better for deterministic
request/campaign cohorts that must change without a redeploy.

## 9. Dataverse Schema and Data Evolution

Campaign-safe changes follow expand/migrate/contract:

1. **Expand:** add optional fields/entities/relationships; keep old readers/writers
   valid.
2. **Write compatibility:** dual-write only when necessary and test partial failure;
   otherwise write the new source and derive/bridge deliberately.
3. **Backfill:** idempotent, resumable, observable, and scoped to explicit records.
4. **Switch reads:** enable by deterministic cohort, with old-path fallback only when
   fallback semantics are safe and visible.
5. **Observe:** keep both schema generations through a full campaign.
6. **Contract:** remove old code/data only in a quiet window after a live-caller and
   data-retention audit.

No deployment during the freeze should require a destructive Dataverse operation to
restore service. If code rollback would make the current schema/data unreadable, the
release is not campaign-safe.

## 10. Promotion and Rollback

For every Tier 2/3 release, record:

- branch and commit
- preview/rehearsal environment and Dataverse target
- gates and human scenarios completed
- approved production deployment
- last-known-good production deployment
- flags/cohorts enabled
- expected durable writes
- rollback command/path and the person authorized to use it

Preferred sequence:

1. Build and verify the candidate away from `main`.
2. Rehearse against Mode A, then C or D only as needed.
3. Merge/push `main` deliberately.
4. Verify staff sign-in and one read-only critical path.
5. Enable the smallest deterministic cohort if the feature is flagged.
6. Observe before expanding.

Rollback order:

1. Disable the feature/cohort when that restores the old path safely.
2. Roll back/promote the last-known-good deployment.
3. Stop background jobs or sends that could continue producing side effects.
4. Reconcile durable writes and queue explicit repair if needed.

Never describe code rollback as data rollback.

## 11. External-User Rehearsal

At T-6 weeks, recruit at least two people who did not build the feature. Give them
only the instructions a real reviewer receives. Observe rather than coach.

Minimum scenarios:

- invitation comprehension and link opening
- accept and decline paths
- policy acknowledgment
- return later on the same and a different device/browser
- materials access
- structured review entry and file upload
- validation and recovery from an error
- double-click/double-submit
- two tabs or an older link
- deployment while a form is open
- expired/revoked link and help path

Use synthetic proposal content and staff-controlled identities. Record confusion as
a product defect even when the software technically behaves as designed.

## 12. Campaign Readiness Gate

Before the soft freeze, the campaign owner and developer review this checklist:

### Environment and access

- [ ] Production and preview deployment targets are named and reachable.
- [ ] Dataverse target classification is verified, not inferred from a variable name.
- [ ] Required auth redirect/domain settings are verified.
- [ ] Required credentials and sender mailbox are present; values are not copied into
      the checklist.
- [ ] Backup operator has deployment, rollback, and log access.

### Data and side effects

- [ ] Required Dataverse schema, policy rows, and permissions are present.
- [ ] Every rehearsal mode's expected writes are documented.
- [ ] Test request, personas, recipient allowlist, and cleanup owner are named.
- [ ] Email, file, Blob, Postgres, cron, and background side effects are accounted for.
- [ ] No destructive migration is required during the campaign.

### Product and operations

- [ ] Automated critical-path tests pass.
- [ ] Staff UAT passes.
- [ ] Naive external-user rehearsal passes or accepted defects have workarounds.
- [ ] Last-known-good deployment and rollback steps are recorded and rehearsed.
- [ ] Health signals and incident severity/contact rules are written down.
- [ ] Campaign freeze dates and exception authority are announced.

Any unchecked item is an explicit risk acceptance, not an implied pass.

## 13. Minimal Implementation Sequence

The strategy can begin without waiting for a platform rebuild:

1. **Now — operating discipline:** adopt risk tiers, campaign windows, the readiness
   checklist, named test records, recipient allowlists, and rollback records; make
   `/start` and `/stop` branch-aware before treating them as feature-branch automation.
2. **Next — fail-closed Dataverse interlock:** implement and characterize the
   deployment-target/write matrix in section 6.
3. **Then — sandbox parity:** re-probe, provision reviewer schema/config, and maintain
   a resettable integration dataset.
4. **Then — deterministic rollout:** add the smallest server-authoritative cohort
   seam needed for the first major refactor and capture old/new comparison results.
5. **Later — campaign health view:** expose a small operational funnel using existing
   durable lifecycle signals, adding new signals only where an incident question
   cannot otherwise be answered.

The first success criterion is not “complete the refactor.” It is: **the next risky
change can be rehearsed, promoted, observed, and reversed without gambling the
campaign.**
