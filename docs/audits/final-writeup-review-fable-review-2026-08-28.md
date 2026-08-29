---
title: Final Writeup Review — Claude Fable adversarial review (2026-08-28)
domain: workbench
kind: audit
status: active
summary: Read-only Fable review of the Final Writeup Review implementation plan at branch commit 1fde64f9 — READY WITH NAMED PREREQUISITES; four P1 findings (source lifecycle/pointer, transition actor, systemuser coverage, single-observation acknowledgement) and eight P2 plan corrections, all incorporated into the revised plan.
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
---

# Final Writeup Review — Claude Fable Adversarial Review

**Reviewed:** 2026-08-28  
**Branch:** `codex/staff-deliberations-history-ux` at `1fde64f9`  
**Mode:** Read-only, OAuth-authenticated Claude Fable review. No files changed and no live probes run.

## Verdict

**READY WITH NAMED PREREQUISITES.**

The same-SharePoint-item Final lineage holds against the current schema, the reopen interlock, and the Dataverse changeset transport. Four material issues must be resolved before the relevant implementation slices, followed by several plan-text corrections in Slice 0.

## Verified foundations

Fable independently reproduced the plan's principal current-state claims:

- Final Writeup is the only placeholder tab.
- Staff Deliberations fails closed outside its active Draft/Review lifecycle.
- The Final artifact type, source fields, milestone fields, and `wmkf_CurrentFinalWriteup` pointer exist.
- The Final pointer has no runtime writer.
- The generation key is the registry's only alternate key; the SharePoint item ID is not unique.
- The Graph metadata helper exposes eTag, version, and last-modified time, but not modifier identity.
- Lead-PD and PC lookups exist on the Request, although the PC lookup has no current runtime consumer.
- The current dashboard is lead-PD scoped.
- The `reviewers` grant opens the entire Workbench.
- No review-acknowledgement store currently exists.

Fable also confirmed that:

- The reopen interlock already blocks when a Final pointer exists and does not create a hole in the same-item design.
- Atomic Dataverse changesets with per-operation `If-Match` are already proven.
- Two-lookup alternate keys are production-precedented.
- The existing durable plan's instruction to copy Final Writeup into a new SharePoint file genuinely conflicts with the newly accepted continuous-document direction.

## Material findings

### P1-1 — Name the source Pre-Site lifecycle and retain its pointer

The implementation plan says the source Pre-Site row moves “beyond the deliberation lifecycle” without naming the value or defining the disposition of `wmkf_CurrentPreSiteVisit`.

Two plausible choices break the current UI or its regeneration lock:

- `SUPERSEDED` with the pointer retained filters the source row out of the read model and yields a pointer-invalid error.
- `SUPERSEDED` with the pointer cleared makes Staff Deliberations offer **Generate Word Draft** again and permits a second editable Pre-Site lineage.
- `FINAL` or `BOARD_READY` with the pointer retained preserves the read-only receipt, regeneration lock, transition ineligibility, and distribution history.

**Fable's remediation:** specify that the source pointer remains and the source row moves to `FINAL` (`100000004`). Reserve `BOARD_READY` because it already has a frozen-distribution meaning and may later be useful on the Final row. Add tests proving the read-only receipt, regeneration rejection, and preserved distribution history.

Evidence: `lib/services/pre-site-visit/artifact-service.js:545-577`, `:838-859`; `shared/components/workbench/StaffDeliberationsTab.js:633-646`; `tests/unit/staff-deliberations-tab.test.js:446-464`; `lib/services/pre-site-visit/site-visit-transition-service.js:188-193`; `lib/services/pre-site-visit/distribution-service.js:414-425`, `:1557-1595`.

### P1-2 — Dataverse modified-by does not guarantee the actual transition actor

The plan relies on Dataverse standard modified-by identity. The current write path only supplies `MSCRMCallerID` when impersonation is explicitly enabled and silently retries a 403 under the service principal. The changeset path has no `noFallback` option, and later patches would overwrite modified-by anyway.

**Fable's remediation:** before Slice 1, choose either:

1. Explicit actor lookup and timestamp fields for each transition on the Final row; or
2. A fail-closed, no-fallback transition write, including changeset support, that cannot report success when impersonation falls back.

Evidence: `lib/services/dynamics/write-core.js:76-115`; `lib/services/dynamics/changeset.js:85`, `:113-125`; fail-closed precedents in `lib/services/dynamics/email.js:218-221` and `lib/services/pre-site-visit/distribution-service.js:1385`.

### P1-3 — Confirm every intended reviewer has a Dataverse systemuser

The proposed acknowledgement key assumes each PD, PC, CSO, and President resolves to an enabled Dataverse `systemuser`. Current session identity derives that value from `user_profiles.dynamics_systemuser_id`, populated by exact-email reconciliation. A person without an enabled systemuser cannot acknowledge under the proposed schema.

**Fable's remediation:** before Slice 2 schema review, run an owner-authorized read-only identity probe for every intended persona and define fail-closed behavior. If any intended persona cannot resolve, reconsider the acknowledgement key before creating the entity.

Evidence: `pages/api/auth/[...nextauth].js:274-286`, `:331-335`; `lib/services/dynamics-identity-service.js:59-100`; `pages/api/workbench/reopen.js:58-61`.

### P1-4 — Use a single observation for acknowledgement; compare content version, not eTag alone

The plan's two-identical-Graph-reads fence is too strict during concurrent Word co-authoring. AutoSave can change eTag and last-modified metadata between reads even though an acknowledgement is advisory rather than a byte-lineage milestone. Deriving staleness from eTag also risks reporting metadata-only changes as “Updated since your review.”

**Fable's remediation:** record one observed item/version/eTag/last-modified snapshot, derive staleness primarily from `publication.versionId`, use last-modified only as a secondary signal, and never use eTag alone. Use `If-Match` when updating an existing acknowledgement row. Add a test showing that AutoSave between observations does not prevent acknowledgement.

Evidence: `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:86`, `:899-904`; `lib/services/graph-service.js:415`, `:437-439`; the stricter lineage-milestone fence in `lib/services/pre-site-visit/site-visit-transition-service.js:134-142`.

## P2 plan corrections

1. **Make the leadership-stage derivation explicit.** Milestone presence currently has a “Sharing began” meaning in Staff Deliberations. Add a named, fail-closed helper or a dedicated Final lifecycle value.
2. **Correct the Staff Deliberations receipt design.** The sharing-history panel currently mounts only while shared and the receipt exposes the raw SharePoint filename. The implementation must preserve read-only history and use the established display-label/File-details pattern.
3. **Enumerate new supporting-material read routes.** Existing routes require broad Reviewer/Review Manager grants. Leadership needs bounded routes under the new capability, plus route-matrix and canonical-count updates.
4. **Decide transition edge cases.** Specify superuser behavior, null-lead-PD behavior, whether Start sharing remains organization-open, and whether “materials sent” is a server precondition or only a UI hint.
5. **Define accidental-handoff recovery.** The existing reopen route is blocked by a Final pointer and Final regeneration is deferred. Specify either a superuser-only undo or an explicit operator-only recovery procedure before Slice 1 ships.
6. **State Final claim cardinality and fences.** Define lease expiry, the at-most-one active Final rule, prior-row/target/request `If-Match` fences, and the separate create-before-activation operation. Leadership cycle selection must not depend on lead-PD ownership.
7. **Broaden Slice 0 reconciliation.** The obsolete copy-to-new-file rule appears across the lifecycle plan, Atlas, schema design, near-term plan, wiki, memory, and source headers. Use `/sweep` and run the durable-fact gates.
8. **Complete the gate list.** Add route lifecycle auth, trust-boundary GUID, route-service boundary, Dataverse access-layer, Dynamics-context boundary, OData escaping, status-enum parity, docs catalog, types, and fact-consistency gates. Readiness must also confirm the alternate key has become Active.

## Unverified assumptions

- Live population of `wmkf_programcoordinator` on Requests.
- Dataverse systemuser coverage for the CSO, President, and PCs.
- The live `DYNAMICS_IMPERSONATION_ENABLED` value.
- SharePoint M365-group membership for leadership personas.
- Content-version creation cadence during concurrent co-authoring.
- Whether PCs may move a document backward between review stages.

## Required sequencing

Before Slice 1:

- Expand the authorized file surface.
- Resolve the persona contract sufficiently for the transitions being shipped.
- Adopt P1-1: retain the Pre-Site pointer and explicitly use the `FINAL` lifecycle for its source row.
- Adopt P1-2: choose a reliable, fail-closed actor-recording mechanism.

Before Slice 2:

- Complete the systemuser identity probe in P1-3.
- Replace the acknowledgement double-read/eTag design as described in P1-4.

During Slice 0:

- Incorporate every P2 plan correction and reconcile the obsolete copy-to-new-file direction across durable sources.

