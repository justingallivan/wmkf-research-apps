---
title: Request Document Attribution Role — Claude Adversarial Review Prompt
domain: dataverse
kind: audit
status: historical
summary: "Executed read-only Claude review brief retained for provenance; the review returned NEEDS REWORK and the owner selected Option B."
canonical: false
cataloged: 2026-08-31
owner: product-engineering
related:
  - docs/REQUEST_DOCUMENT_ATTRIBUTION_ROLE_PLAN.md
  - docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - lib/services/dynamics/write-core.js
  - scripts/apply-security-role.js
  - scripts/probe-write-attribution-census.js
---

# Claude prompt: adversarial review of the Request Document attribution role plan

> **Historical execution record (2026-08-31).** This prompt was run through an
> ordinary OAuth-authenticated Claude CLI session. The resulting review at
> `outputs/request-document-attribution-role-adversarial-review-2026-08-31.md`
> returned `NEEDS REWORK`. The owner accepted its direction and selected
> service-principal writes with explicit actor tracking. Do not rerun or use
> this prompt as authorization for role or Production changes.

Copy everything below the separator into a fresh Claude Code CLI session at the
repository root.

---

Perform a **read-only adversarial review** of
`docs/REQUEST_DOCUMENT_ATTRIBUTION_ROLE_PLAN.md`. The plan proposes a dedicated
Dataverse role and a pilot-first rollout so eligible application writes to
`wmkf_requestdocument` are attributed to staff rather than falling back to the
service principal.

Do not implement fixes. Do not edit source, tests, plans, Atlas, memory,
`SESSION_PROMPT.md`, roles, or Dataverse data. Do not run any command containing
`--execute`, assign/unassign a role, create/update/delete a Dataverse row, change
an environment variable, deploy, commit, or push. Read-only repository commands
and read-only live probes are permitted if they obey the repository's target
interlock and expose no secrets or confidential proposal content.

Use the ordinary OAuth/subscription Claude session only. Do not use a project
API key. Do not invoke Ultrareview or any other metered/credit-consuming review
product; this request authorizes an ordinary Claude adversarial review only.

Begin with `/start`. Then invoke `/contract-reconcile` in review mode because
the plan spans route authorization, Dataverse privilege intersection, role
application, relationship privileges, durable writes, cleanup, and rollback.
Use CodeGraph before grep/find when tracing source. Personally read the
controlling sources and produce the final synthesis; do not treat the plan's
claims as evidence.

## Review boundary and receipt

At the start, record:

```text
git rev-parse HEAD
git status --short --branch
shasum -a 256 docs/REQUEST_DOCUMENT_ATTRIBUTION_ROLE_PLAN.md
```

Include those values in the review so we can prove which plan and tree you
reviewed. Review current working-tree source where it differs from HEAD, but
name that fact explicitly. Preserve unrelated local work.

Write the final review to:

```text
outputs/request-document-attribution-role-adversarial-review-2026-08-31.md
```

The `outputs/` directory is intentionally gitignored. Also print a concise
verdict in the CLI response so the operator knows the file was produced.

## Controlling sources

Read these completely before concluding:

- `CLAUDE.md`
- `.claude/skills/contract-reconcile/SKILL.md`
- `docs/REQUEST_DOCUMENT_ATTRIBUTION_ROLE_PLAN.md`
- `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`
- `docs/CLAUDE_REMEDIATION_PLAN.md`
- `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`
- `docs/APPLICATION_STATE_ATLAS.md`
- `docs/atlas/dataverse-wmkf-requestdocument.md`
- `lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json`
- `lib/dataverse/schema/roles/wave1-staff.json`
- `lib/dataverse/schema/roles/wave23-final-writeup-reviewer.json`
- `scripts/apply-security-role.js`
- `lib/dataverse/role-apply.js`
- `scripts/probe-write-attribution-census.js`
- `lib/dataverse/adapters/request-document.js`
- `lib/services/dynamics/write-core.js`
- `lib/dataverse/core/changeset.js`
- `lib/dataverse/core/interlock.js`

Then trace every current Request Document create, update, and changeset caller.
At minimum cover Initial Assessment generation and controls, Pre-Site generation
and distribution, guarded reopen, Site Visit transition, and Final Writeup
transition. Read each relevant API route's authorization and validation, not
only the service function.

## Mission

Try to disprove that the plan is the safest practical way to obtain staff
attribution. Compare its Option A (native staff privileges) with Option B
(service-principal writes plus explicit app-controlled actor evidence). Do not
prefer Option A merely because it is less code. Determine whether the built-in
`createdby`/`modifiedby` value is worth organization-wide direct Dataverse write
authority for the intended users.

## Required adversarial audits

### 1. Least-privilege and organization-scope audit

- Verify the live/schema ownership type and the actual meaning of privilege
  depth for this table.
- Determine whether Create/Write/Append without Read is sufficient for the
  proposed no-fallback create/update proof. If source cannot settle it, label it
  unverified and specify the safest test; do not guess.
- Check whether role combinations—especially Request Document `AppendTo` from
  the Final Writeup reviewer role—create a relationship-manipulation capability
  broader than the plan acknowledges.
- Identify what an assignee could do through a direct Dataverse client or Web
  API outside the Workbench.
- Confirm Delete, Assign, Share, and Read are unnecessary, or identify the exact
  operation that requires one. Do not recommend adding a privilege without
  naming its direct-access consequence.

### 2. Writer and audience fan-out audit

- Enumerate every direct and indirect Request Document create/update/batch
  writer.
- For each, trace user → route auth → validated payload → service → adapter or
  changeset → Dataverse relationships → response/readback.
- Derive the legitimate writer audience from enforced server-side gates.
- Test the plan's assertion that the 11-person Final Writeup acknowledgement
  audience must not automatically become the writer-role audience.
- Look for unattended/cron writers and paths with no acting user; they must not
  influence the human role cohort.

### 3. Companion-privilege matrix

Build an explicit matrix for every write flow, including all tables and
relationship directions touched by create payloads and atomic changesets.
Check Request, source Request Document, AI Prompt, AI Run, User, request-pointer
updates, and any additional target revealed by source. Distinguish:

- table CRUD privilege;
- `Append` on the row being associated;
- `AppendTo` on the relationship target;
- privileges already effective from another role;
- privileges absent for a minimally privileged intended writer.

Determine whether granting only Request Document Create/Write/Append can
actually eliminate fallback for each flow or merely move the 403 to another
table in the same changeset.

### 4. Role-applier and exact-verification audit

- Verify that `AddPrivilegesRole` is additive and that the current applier
  cannot remove an accidental privilege.
- Check name collision, business-unit resolution, solution membership,
  platform-added App Opener baselines, duplicate assignment handling, and
  partial failure.
- Determine how an exact verifier can distinguish the three intended table
  privileges from platform baselines and unrelated extras.
- Verify that the proposed role filename/name fits repository conventions
  without falsely implying a schema wave.
- Confirm that modifying neither the broad staff role nor the Final Writeup
  reviewer role is the correct containment boundary.

### 5. Pilot validity audit

- Confirm a pilot with preexisting effective Create/Write/Append would make the
  test invalid.
- Determine the exact before/after evidence needed to prove the dedicated role,
  rather than another role, supplied the privilege.
- Check whether using app-user impersonation of the pilot proves the same
  privilege intersection as a normal authenticated Workbench request.
- Identify any license, disabled-user, business-unit, team-role, or cached-role
  issue the plan omits.

### 6. Sentinel safety and cleanup audit

Treat the proposed Production sentinel as hostile until proved otherwise.

- Verify every required field and relationship for a minimally populated row.
- Determine whether any artifact type/producer combination is truly invisible
  to all current readers, dashboards, lifecycle calculations, cleanup jobs,
  or future retry logic. Grep raw persisted fields and producer values across
  every consumer.
- Verify `noFallback:true` survives adapter/facade dispatch on both Create and
  Write and cannot silently retry as the app.
- Check target-interlock/trusted-context requirements.
- Verify the plan's prerequisite that the service principal can delete the
  exact sentinel row; do not infer cleanup authority from Create/Write access.
- Test the lost-response cases: create committed but response lost; readback
  failed; update committed but response lost; delete committed but response
  lost.
- Verify alternate-key recovery cannot select an unrelated row and that cleanup
  is exact-ID only.
- Examine whether a create-then-delete proof destroys useful Dataverse audit
  evidence or makes the later census unable to prove attribution.
- Decide whether a transaction intentionally rolled back, a sandbox proof, an
  approved natural workflow, or another method is materially safer than a
  temporary Production row.
- Require a hard stop if cleanup or postconditions fail.

### 7. Full-flow proof and fallback audit

- Verify that a sentinel proves only table privileges, not a complete
  application changeset.
- Evaluate whether one natural application-flow proof is sufficient and which
  existing flow gives the best coverage with the least business impact.
- Confirm historical service-principal rows make an aggregate census
  non-binary; define the exact new-row evidence needed.
- Check whether fallback warnings are durable/observable enough to support the
  rollout and future regression detection.
- Consider whether `noFallback:true` should eventually be required on selected
  human-attributed operations, but do not broaden this plan unless the safety
  tradeoff is justified.

### 8. Rollback and partial-success audit

- Inspect the exact Dataverse association-removal contract needed for a safe
  unassignment script.
- Evaluate the proposed assign → verify → unassign → verify → reassign rollback
  proof, including privilege-propagation delay and loss of a response during
  any association change.
- Check absent association, duplicate assignment, wrong role, wrong business
  unit, partial cohort assignment, network loss, and retry behavior.
- Verify rollback restores the previous availability/attribution behavior but
  does not falsely claim to undo business data writes.
- Identify every point where the rollout could be partially applied and the
  evidence needed to resume or reverse safely.

### 9. Alternative-design audit

Compare the proposed role with service-principal writes plus explicit actor
evidence. Consider:

- security and confidentiality;
- integrity and audit quality;
- number of writers and schema fields/events needed;
- deadline and implementation risk;
- historical/backfill expectations;
- whether event-specific existing actor fields already cover part of the need;
- whether built-in Dataverse audit requirements make Option B insufficient.

Give a reasoned recommendation, not merely a list of tradeoffs.

Also judge the plan against the September 4, 2026 product deadline. This work
is attribution hardening rather than an availability blocker because fallback
already preserves writes. Flag any portion that should be deferred instead of
displacing deadline-critical Final Writeup/dashboard work.

### 10. Test-quality and negative-space audit

For every planned guard, ask whether its test would still pass if the guard
were broken. Require fixtures that contain the dangerous condition: an extra
role privilege, a pilot with preexisting rights, multiple alternate-key rows,
an unexpected consumer of the sentinel producer, a fallback retry, a cleanup
failure, and a partially removed cohort.

## Required output

Use this structure:

```markdown
# Request Document Attribution Role — Adversarial Review

## Review receipt
- HEAD:
- Working tree:
- Plan SHA-256:
- Read-only probes run:

## Findings
1. BLOCKER | HIGH | MEDIUM | LOW — title
   - Evidence: file:line / read-only probe
   - Failure scenario:
   - Required plan change:
   - Residual risk:

## Companion privilege matrix
| Flow | Request Document ops | Other table/relationship privileges | Current evidence | Fallback risk |

## Recommendation evidence
| Recommendation | Prerequisite | Evidence actually tested | Disconfirming check | Status: VERIFIED/ASSUMED/STALE |

## Option A vs. Option B verdict

## Required revisions before implementation

## Final verdict
READY TO IMPLEMENT | READY WITH NAMED CHANGES | NEEDS REWORK
```

Lead with findings, ordered by severity. If there are no findings, explain the
specific disconfirming checks you performed; a green test suite alone is not a
review. Label every material current-state claim `VERIFIED`, `ASSUMED`, or
`STALE`. Do not make any repository or external-state change.
