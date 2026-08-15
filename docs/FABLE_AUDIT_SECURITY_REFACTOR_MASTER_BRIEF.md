---
title: Fable Production Audit, Security, and Refactor Master Brief
domain: engineering-process
kind: plan
status: draft
summary: "Fable-led brief for current-state audit, safe production and security probes, evidence-based refactor selection, and staged migration planning."
canonical: false
cataloged: 2026-08-14
last_verified: 2026-08-14
owner: product-engineering
related:
  - docs/SECURITY_OPERATING_PLAN.md
  - docs/security-audit/SECURITY_AUDIT_RUNBOOK.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/CLAUDE_REMEDIATION_PLAN.md
  - docs/AGENT_COLLABORATION_PLAN.md
---

# Fable Production Audit, Security, and Refactor Master Brief

## How to use this brief

Give this entire document to Claude Fable in a fresh session. Fable is the lead
architect and evidence owner. It may delegate bounded, read-only reconnaissance to
lower-tier models, ask Sonnet to implement a later approved stage, and ask Opus for
fresh-context adversarial reviews. Delegate output is evidence to inspect, not a
decision Fable may accept without verification.

This brief has two authorization boundaries:

1. **Authorized by default:** repository inspection, local read-only checks,
   low-volume read-only production-state probes that satisfy the safety contract
   below, audit documents, and the final staged refactor plan.
2. **Not authorized by this brief alone:** runtime code changes, schema changes,
   data repair, production writes, email sends, deployment, merging, or pushing to
   `main`. Stop after the corrected plan unless the owner explicitly authorizes an
   implementation phase. If implementation is separately authorized, follow the
   Sonnet/Opus stage loop in this document.

The exercise is successful if it produces a narrower and more reliable decision,
including a well-supported decision to defer the proposed refactor. It is not
successful merely because it produces a large report or recommends a rewrite.

## Mission

Establish current truth across three connected questions:

1. **What is actually running and storing state now?** Reconcile source, deployed
   configuration, live integration shape, operational jobs, documentation, memory,
   and tests.
2. **Where are the material security and operational risks now?** Go beyond route
   inventory coverage to trace authorization, identity, side effects, tokens,
   background work, file boundaries, and fail-open behavior end to end.
3. **Which refactor, if any, offers the best verified return?** Measure the slow UI
   paths, separate Dataverse latency from avoidable application work, compare
   candidates, and produce a staged migration plan that remains green and
   reversible after every stage.

The working refactor hypothesis is a **Request Workbench Data Plane**: observable,
request-scoped read models; deduplicated Dataverse reads; authoritative mutation
responses; selective invalidation; and client state that can show server-confirmed
data immediately while revalidating. This is a candidate, not a predetermined
conclusion. Fable must select it, narrow it, replace it, or reject it based on the
audit evidence.

## Non-negotiable operating rules

1. Begin with `/start` and obey `CLAUDE.md`, `SESSION_PROMPT.md`, the current work
   queue, and any matching rule files. Verify the worktree and branch before any
   action.
2. Use CodeGraph before grep or direct file traversal when locating or
   understanding code. Use source, Git history, Atlas, and live probes as
   authorities; use docs and memory as claims to reconcile.
3. Read `docs/CLAUDE_REMEDIATION_PLAN.md` before data-layer, integration, or
   migration planning. Read `docs/APPLICATION_STATE_ATLAS.md` and the relevant
   `docs/atlas/` pages before asserting data ownership.
4. Apply `/contract-reconcile` to every cross-layer finding and to the final
   refactor plan. Trace caller -> authentication/authorization -> service ->
   adapter/transport -> durable state -> consumer/cleanup.
5. Apply `/sweep` when reconciling a changed or disputed fact across code, live
   state, docs, memory, wiki, and instructions. Do not update only the first stale
   restatement found.
6. Label every material claim `[VERIFIED via ...]`, `[INFERRED from ...]`,
   `[CONFLICT]`, `[UNKNOWN]`, or `[NEEDS OWNER]`. A gate proves only its documented
   detection contract. A passing route inventory gate does not prove semantic
   authorization.
7. Before using an absolute such as “all,” “none,” “safe,” “dead,” or “fully,” run
   and cite the exact census that supports it. Re-open every cited line range before
   submission.
8. Do not propose deletion, retirement, migration, or consolidation until live
   callers, durable data, retention, rollback, and cleanup obligations are traced.
9. Production probes are read-only, low-volume, and non-destructive. Never invoke a
   script merely because its name contains `audit` or `probe`; inspect its source
   first and prove that every external operation is a read.
10. Never expose secrets, OAuth material, access tokens, raw reviewer links, private
    proposal content, personal data, or unredacted production records in agent
    prompts, logs, or committed artifacts. Record secret presence and provenance,
    never secret values.
11. Do not send email, mint or revoke reviewer tokens, trigger crons, mutate flags,
    create “temporary” rows, or run self-cleaning write smokes during this audit.
    “It deletes afterward” is still a production write.
12. One agent owns each writable surface. Reconnaissance delegates are read-only.
    Fable alone edits the master evidence matrix and final plan. Parallel future
    implementation uses separate branches/worktrees.
13. `main` auto-deploys. No agent merges or pushes `main` without a fresh explicit
    owner instruction. Treat reviewer, auth, email, upload, background-job,
    Dataverse-write, and cross-layer refactors as Tier 2 or Tier 3 work under the
    campaign release strategy.
14. The August 2026 reviewer performance incident is a design constraint: do not
    turn a latency project into a new authority, receipt, or durable-state system.
    Default to measure -> deduplicate -> cache only server-confirmed snapshots ->
    invalidate. Any proposal for new durable workflow state is a separate owner
    decision with its own contract and migration.

## Model and responsibility contract

| Role | May do | Must not do | Required return |
|---|---|---|---|
| Fable, lead architect | Set scope; issue briefs; inspect source; run safe checks/probes; maintain evidence; choose architecture; adjudicate reviews; produce the final plan | Treat delegate summaries as proof; silently expand scope; implement during the planning authorization | Decisions tied to evidence, disposition of every material finding, and the corrected master plan |
| Lower-tier reconnaissance scout | One bounded inventory or trace; read-only commands; exact source citations; list unknowns and follow-ups | Edit files; make architecture decisions; run external writes; claim repo-wide completeness outside its brief | Scope searched, commands used, evidence table, unknowns, confidence, and next best probe |
| Sonnet implementer, only after owner authorization | Implement one approved green stage on an isolated branch/worktree; add tests; run scoped gates; prepare a handoff | Redesign the plan; combine stages; push `main`; suppress red gates; touch unrelated surfaces | Commit(s), complete diff summary, tests/gates, residual risks, rollback instructions |
| Opus adversarial reviewer | Fresh-context, read-only review of an audit, plan, or implementation diff; trace high-risk contracts; challenge missing evidence | Edit the reviewed surface; broaden into unrelated cleanup; approve from summaries alone | P0-P3 findings with evidence, confirm/refute table, verdict `approve` / `changes required` / `reject` |

Fable may re-delegate when a result is incomplete, but each follow-up brief must be
narrower and name the missing evidence. Do not ask multiple agents to write competing
versions of the same artifact.

## Progress, timeout, and recovery cadence

- Create a task ledger before delegation: task ID, owner/model, exact scope,
  writable surface (`none` for scouts/reviewers), expected artifact, start time,
  last progress, and disposition.
- Inspect delegate progress every 3-5 minutes without interrupting productive work.
- If a delegated process produces no meaningful progress or exceeds 20 minutes wall
  time, capture its partial result, stop it once, and relaunch a narrower brief in a
  fresh context. Do not repeat the identical prompt.
- If the narrower retry also stalls, reassign it or perform the critical trace in
  Fable. Record the failure in the ledger; never enter an automatic restart loop.
- At the end of every phase, Fable opens the cited source again in fresh context and
  samples at least one claim from every delegate. High-severity and architectural
  claims receive complete Fable verification, not sampling.
- Send the owner a concise checkpoint if the work exceeds roughly 30 minutes without
  advancing the audit decision, or if a probe needs authority beyond this brief.

## Required artifact bundle

Use the actual run date in filenames and give every artifact an evidence/status
header. Point-in-time audit artifacts must say so; they do not become canonical
architecture documentation merely because they are detailed.

1. `docs/audits/fable-current-state-evidence-YYYY-MM-DD.md`
   - Git/deployment baseline, verified system map, production probe ledger, data
     ownership matrix, drift/conflict matrix, and unknowns.
2. `docs/audits/fable-security-audit-YYYY-MM-DD.md`
   - Semantic security findings, route/auth scope statement, end-to-end contract
     traces, severity, exploit/precondition, repair and verification.
3. `docs/audits/fable-performance-refactor-evidence-YYYY-MM-DD.md`
   - User journeys, latency and call-count evidence, candidate scorecard,
     selected/refuted hypothesis, and measurement gaps.
4. A top-level staged refactor plan named for the selected surface, with required
   catalog frontmatter. If no refactor is justified, produce a measurement or repair
   plan instead and explain why.
5. `docs/audits/fable-refactor-plan-opus-review-YYYY-MM-DD.md`
   - Opus findings and verdict.
6. `docs/audits/fable-refactor-plan-disposition-YYYY-MM-DD.md`
   - For every Opus finding: accept, accept in part, reject, or needs owner; evidence;
     exact plan change; residual risk.
7. Final Fable handoff containing the decision, top risks, documents produced,
   commands run, red/green gates, owner decisions, and explicit next authorization.

Do not paste production record contents into these files. Prefer aggregate counts,
schema names, route names, timings, request correlation IDs, and redacted examples.

## Phase 0: establish the control plane

Fable performs this phase personally.

1. Run `/start`; capture branch, HEAD, upstream, cleanliness, and active work.
2. Before creating or editing any audit artifact, fetch `origin`, verify the
   worktree is clean, and create a dedicated non-`main` branch from the current
   `origin/main`. Record the branch name and upstream in the task ledger. All Fable
   audit and planning commits belong on that branch; never commit them directly to
   `main`. If the worktree is dirty or contains unpushed work, stop and coordinate
   instead of stashing, discarding, or building the new branch on uncertain state.
3. Read at minimum:
   - `CLAUDE.md`
   - `SESSION_PROMPT.md`
   - `docs/CURRENT_WORK_QUEUE.md`
   - `docs/CLAUDE_REMEDIATION_PLAN.md`
   - `docs/SYSTEM_MODEL.md`
   - `docs/APPLICATION_STATE_ATLAS.md`
   - relevant `docs/atlas/` pages
   - `docs/SECURITY_OPERATING_PLAN.md`
   - `docs/security-audit/SECURITY_AUDIT_RUNBOOK.md`
   - the most recent security audit and its unresolved items
   - `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`
   - `docs/CI_GATES_REFERENCE.md`
   - `docs/AGENT_COLLABORATION_PLAN.md`
4. Determine the current campaign window and release posture. If unclear, mark it
   `[NEEDS OWNER]` and assume the more restrictive posture.
5. Identify the last genuinely broad audit baseline from both the audit document and
   Git history. Compute changed routes, auth/data/integration surfaces, migrations,
   dependencies, and docs since that baseline. Do not reuse a historical count.
6. Create the task ledger, artifact skeletons, evidence-label legend, and probe
   approval ledger.
7. Run the current relevant inventory gates and their self-tests serially, including
   `check:api-routes` before `check:api-routes:self-test`. Record exactly what each
   proves and does not prove. Do not treat an existing red gate as unrelated.

**Phase 0 exit gate:** Fable is on a clean dedicated branch based on current
`origin/main`; the repository baseline and audit scope are explicit; no delegate has
a writable surface; unresolved authority or campaign constraints are visible.

## Phase 1: delegated repository reconnaissance

Run bounded read-only workstreams in parallel where they do not contend. Fable owns
the fan-in.

### Workstream A: system and change inventory

- Map applications, pages, API routes, shared services, Dataverse adapters/entities,
  Postgres tables/migrations, Blob stores, SharePoint paths, external integrations,
  crons, queues, AI execution, and configuration authorities.
- Compare the current tree with the audit baseline. Rank changed surfaces by
  security relevance, data/side-effect reach, operational criticality, and lack of
  semantic test coverage.
- Identify partially completed migrations, parallel patterns, and documentation
  statements that require live verification.
- Do not infer “dead code” from absence in one import search. Include dynamic calls,
  routes, scripts, jobs, configuration lookup, and operational use.

### Workstream B: semantic security reconnaissance

- Inventory every route's methods, guard, app/role boundary, identity source,
  client-controlled identifiers, service entry point, stores touched, side effects,
  idempotency/concurrency control, and output sensitivity.
- Start with changed and destructive routes, then cover the full route inventory.
  The final report must state whether every route was semantically inspected or only
  a subset.
- Trace external-link tokens, acceptance/decline, invitation/reminder email,
  uploads/downloads, admin/superuser actions, destructive merges, cron/internal
  authentication, AI prompt boundaries, and generic data/query tools.

### Workstream C: performance and UI data-flow reconnaissance

- Choose representative Workbench journeys: initial request load, reviewer tab
  entry, return to an already visited tab, candidate mutation, invitation mutation,
  reviewer response mutation, abstract/grantee load, and one upload flow.
- For each journey, trace browser event -> component state -> fetches -> route shell
  -> service -> adapter -> Dataverse/Postgres/Blob/SharePoint -> response -> render.
- Count sequential network boundaries, duplicate reads, repeated hydration, response
  data discarded by clients, full refreshes after bounded mutations, and remounts
  caused by tab navigation.
- Separate measured server latency, measured client/render latency, and suspected
  external-service latency. Mark uninstrumented boundaries `[UNKNOWN]`.

### Workstream D: controls, tests, and operability reconnaissance

- Map CI gates to actual enforcement locations and self-tests.
- Identify campaign-critical journeys without production-shaped fixtures, integrated
  rehearsal, rollback, or durable-write reconciliation.
- Review observability: correlation IDs, structured errors, per-dependency timing,
  queue/cron health, deployment linkage, and actionable alerts.
- Inventory configuration and secret *names/provenance* against the credential
  contract. Never print values.

**Phase 1 exit gate:** Fable has verified every P0/P1 candidate, sampled every other
workstream, corrected overstatements, and produced a prioritized list of production
questions that source alone cannot answer.

## Phase 2: read-only production-state probe

The purpose is to answer explicit unknowns, not to “look around production.” Only one
agent or Fable may hold the external-probe role at a time.

Before each command, add a ledger row with target, credential source, operation,
expected request count, expected output class, PII redaction, timeout, and proof that
the command cannot write. Inspect every existing script first. Reject any script that
mints a token, updates a timestamp, claims a job, sends/captures email, executes an
action, or creates and later deletes a row.

### Probe matrix

| Surface | Safe questions | Evidence to retain | Forbidden in this phase |
|---|---|---|---|
| Vercel/deployments | Which commit is deployed? Which environment owns each app? Are expected non-secret configuration names present? What crons are configured? What route/runtime errors and durations recur? | Deployment IDs/commits, redacted config-presence matrix, aggregate logs/latencies | Env mutation, deploy/promote/rollback, secret values, invoking cron endpoints |
| Dataverse | Is the target hostname classified correctly? Do expected entities/fields/relationships exist? Are counts and lifecycle distributions plausible? Are interlock/DAL settings observable? | Target classification, metadata results, aggregate counts, redacted anomalies | Create/update/delete/action/batch, token lifecycle calls, write smokes, unrestricted record dumps |
| Postgres | Which migrations are applied? Which live tables/columns/indexes exist? What are aggregate queue/error/orphan distributions? | Migration parity, schema diff, aggregate counts, query plans where safe | Migration application, queue claiming, repair, cleanup, row exports with sensitive content |
| Blob | Are expected stores and privacy modes present? Are object metadata/counts consistent with ownership docs? | Store classification, aggregate object/size counts, redacted missing/orphan indicators | Upload/delete/copy, token rotation, downloading private content unless explicitly needed and authorized |
| SharePoint/Graph | Are named libraries/folders reachable with the app identity? Are aggregate file metadata and failure modes consistent? | Permission outcome and redacted metadata counts | Upload/move/delete/share, content extraction, broad recursive crawls |
| Email/Dynamics activity | Are sender/mailbox/config/template/lifecycle dependencies present? Are failed/pending states accumulating? | Configuration presence and aggregate lifecycle counts | Live or capture send, draft creation, recipient tests, token minting |
| Browser/auth | Can an already authorized session load named read-only journeys? What requests, timings, and errors occur? | HAR/performance timings with cookies/tokens removed, screenshots without sensitive content | Creating users, changing roles, submitting forms, accepting/declining, uploads, destructive actions |

Probe production only when source/local evidence cannot answer the question. Use
sampling and `$select`/aggregation; avoid broad payloads. Stop immediately if an
operation is unexpectedly writable, returns secrets/private content, creates a side
effect, or targets an unknown host.

**Phase 2 exit gate:** every probe maps to a prior unknown; the ledger proves
read-only behavior; outputs are redacted; source/docs/live conflicts are recorded;
no operational state was intentionally changed.

## Phase 3: security audit and immediate-risk triage

Do not limit this audit to the preliminary concerns below. For each security surface,
trace the complete contract and its complement/fan-out: allow and deny, select and
revoke, authenticated and unauthenticated, single and concurrent, partial failure and
retry, foreground and background.

Required domains:

1. Session, app-access, role/superuser, applicant/staff, internal/HMAC, cron, and
   external-token boundaries.
2. Identity derivation. Authenticated identity must come from trusted context, not
   request input. Trace impersonation/attribution separately from authorization.
3. Destructive and cross-record operations: merge, delete/deactivate, bulk update,
   repair, export, maintenance, and migration tooling.
4. Reviewer link lifecycle: selection, exclusion, revocation, expiry, regeneration,
   acceptance/decline, reminders, replay, and concurrency.
5. Background jobs: authentication, claim/lease, idempotency, retry, terminal state,
   stale work, authorization re-check at execution time, and observability.
6. Dataverse: route-service boundary, trusted DAL context, restriction enforcement,
   target/write interlock, OData construction, GUID validation, optimistic
   concurrency, batch partial failure, and audit attribution.
7. Files and content: private Blob token separation, SharePoint access, MIME/content
   validation, filename/path handling, size limits, malware scanning, download
   authorization, and retention/deletion.
8. Secrets and configuration: tracked secret registry, server/client boundary,
   environment parity, rotation evidence, fail-open defaults, webhook/cron secrets,
   and log redaction.
9. AI: shared client/executor compliance, prompt storage, model resolution warming,
   prompt-injection tagging, untrusted multimodal content, audit logging, data
   retention, fallback behavior, and output validation.
10. Dependency, platform, and response hardening: lockfile advisories, supported
    runtimes, proxy/header/cookie behavior, rate/size limits, error disclosure, CORS,
    caching of user-specific data, and denial-of-service amplifiers.

### Preliminary concerns that must be confirmed or refuted

These are routing clues, not accepted findings:

- `[PRELIMINARY; REVERIFY]` `pages/api/reviewer-finder/merge-candidates.js` has
  app-level access and GUID validation but no request-scoped or privileged caller
  authorization for a globally destructive merge. Read
  `.claude-memory/project-merge-candidates-authorization-gap.md`, then re-check the
  route, service, callers, design decision, data predicate, transaction/compensation,
  and UI gate before assigning severity or a fix.
- `[PRELIMINARY; REVERIFY]` reviewer token mint/regeneration paths may not apply the
  same fresh selected/revoked eligibility rules. Trace `lib/external/token-lifecycle.js`,
  `lib/services/review-manager/send-emails-service.js`,
  `lib/services/review-manager/regenerate-token-service.js`, manual reminder paths,
  and `pages/api/cron/reviewer-reminders.js` as one authority graph.
- `[PRELIMINARY; REVERIFY]` existing audit scripts are partial and some Postgres
  assumptions may be historical. Inspect `scripts/audit-dataverse-state.js` and
  `scripts/audit-postgres-state.js`; do not call their output comprehensive.
- `[PRELIMINARY; REVERIFY]` the API-route matrix may have complete inventory coverage
  while still containing semantic authorization gaps. Run its gate and self-test,
  inspect the detector, and separately inspect route behavior.
- `[PRELIMINARY; REVERIFY]` the security operating plan predates substantial later
  work. Reconcile both positive controls and newly discovered gaps; do not write a
  report that says “no recent security work.”

For every verified P0/P1, decide whether it blocks further refactor planning. A
security repair may outrank the large refactor, but do not hide it inside the
refactor. Give it its own smallest safe repair plan, release tier, rollback, and
verification.

**Phase 3 exit gate:** all P0/P1 claims are Fable-verified end to end; semantic audit
scope is honest; immediate repairs are separated from architecture work; conflicting
docs are queued for `/sweep` reconciliation.

## Phase 4: performance diagnosis before refactor selection

The first question is not “How do we cache Dataverse?” It is “Where does the user
wait, and which portion can this codebase control?”

### Baseline metrics

For each representative journey, collect or explicitly mark unavailable:

- click/navigation to usable paint
- browser request waterfall and payload sizes
- server route duration, p50/p95 where production evidence is available
- time and call count by dependency: Dataverse, Postgres, Blob, SharePoint, AI
- number of sequential dependency waves
- duplicate reads of the same entity/record/field set within one user action
- client render/commit count and expensive computation
- time from mutation success to correct visible state
- error/retry/timeout rate and cold-versus-warm behavior

Do not add production instrumentation during the planning authorization. If the
required timing/call-count evidence does not exist, make observability the first
green implementation stage and define the measurement window before selecting a
larger refactor.

### Code hypotheses to inspect

- `shared/components/reviewers/ReviewersTab.js` may perform multiple broad reloads
  after a bounded mutation and may reload on tab remount.
- `lib/services/reviewer-finder/my-candidates-service.js` and
  `lib/services/review-manager/reviewers-service.js` may independently re-read and
  re-hydrate overlapping request, suggestion, and reviewer data.
- `shared/components/reviewers/ReviewerSearchSection.js` and
  `shared/components/reviewers/ReviewerManagePanel.js` are large coupled surfaces,
  but component size is not proof of material runtime cost.
- `shared/components/workbench/AwardeeTab.js` may mix mutation response contracts
  with full reloads.
- Active-tab conditional mounting in `pages/workbench/[requestId].js` may trade
  memory for repeated network and initialization work.
- General staff routes may lack per-dependency timing and call-count evidence,
  leaving “Dataverse is slow” unproven.

Confirm or refute each hypothesis with current source and measurements. Do not solve
large-component maintainability before showing that it affects the chosen user
journey.

**Phase 4 exit gate:** the report separates external latency, application-generated
network work, server computation, and client rendering; every candidate refactor is
tied to a measured or explicitly missing signal.

## Phase 5: Fable architecture synthesis and candidate selection

Fable performs the synthesis personally. Score at least these candidates, plus any
stronger candidate revealed by the audit:

1. Request Workbench Data Plane.
2. Reviewer-domain orchestration and uniform mutation/authorization contracts.
3. Workbench client state and component decomposition.
4. Dataverse transport/query/retry/caching changes.
5. Background-job lifecycle and security consolidation.
6. No broad refactor yet: observability plus targeted security/correctness repairs.

Use a 1-5 score with evidence notes for:

| Criterion | Weight | Required question |
|---|---:|---|
| Verified user/operational impact | 25% | Does measured evidence show this is a meaningful problem? |
| Security/correctness leverage | 20% | Does it reduce real authority, consistency, or partial-failure risk? |
| Breadth of duplicated complexity removed | 15% | How many live paths converge without creating a new god layer? |
| Reversibility and campaign safety | 15% | Can each slice coexist, roll back, and avoid destructive data changes? |
| Verification feasibility | 10% | Can current behavior and improvement be proved with deterministic tests/metrics? |
| Delivery fit | 10% | Can Sonnet implement small stages a cheaper model can follow? |
| Authority simplicity | 5% | Does it avoid inventing durable state or changing who/what is authoritative? |

Also document rejected candidates and the evidence that rejected them. A selected
candidate must have an explicit non-goal boundary.

### Recommended hypothesis: Request Workbench Data Plane

Select or adapt this only if evidence supports it. Its intended shape is:

1. **Observability first:** request correlation plus server/dependency timing and
   Dataverse call counts at stable seams.
2. **Request-scoped read models:** domain-owned snapshots composed behind services,
   not generic client-selected queries and not a second durable source of truth.
3. **In-request deduplication:** coalesce identical reads and hydrate shared records
   once per request/action before considering cross-request caching.
4. **Authoritative mutation responses:** mutations return the server-confirmed
   version/state needed to update the affected UI surface.
5. **Selective invalidation/revalidation:** refresh only dependent slices; retain a
   safe explicit full-reload escape hatch until parity is proven.
6. **Client state stabilization:** keep server-confirmed snapshots visible across tab
   transitions and revalidate deliberately. Never share user-specific cached data
   across users without a reviewed authorization-aware cache key and invalidation
   contract.
7. **Component decomposition last:** split large UI components along the stabilized
   data/mutation contracts, not before those boundaries are known.

Non-goals unless separately approved: a new event-sourcing system, receipts as
authority, a durable client cache, a second database copy of Dataverse records,
random rollout cohorts, or a big-bang Workbench rewrite.

**Phase 5 exit gate:** one candidate is selected with evidence, alternatives and
non-goals; or Fable selects “measure/repair first.” The decision clearly separates
security hotfixes from architectural migration.

## Phase 6: produce the staged refactor plan

Do not implement the migration in this phase. The plan must be executable by Sonnet
or another cheaper model without rediscovering the architecture.

For every stage specify:

1. Objective and user-visible behavior that must remain invariant.
2. Preconditions and characterization tests that must exist before the stage starts.
3. Exact files/symbols to add, move, or edit, in order. Use moves before import
   rewrites where history preservation matters.
4. Caller -> auth -> service -> persistence -> consumer/cleanup contract trace.
5. API/data contracts, including status codes, partial success, retries, stale
   state, concurrency, and complement/fan-out cases.
6. Explicit non-goals and a file/surface denylist.
7. Implementation steps small enough for one focused Sonnet work order.
8. Unit, integration, browser, production-shaped fixture, and observability checks.
9. Relevant repository gate and matching self-test, run serially.
10. Performance acceptance signal compared with baseline; do not use “feels faster.”
11. Security acceptance signal and negative-path tests.
12. Release tier, test mode, cohort/flag if any, last-known-good deployment, rollback,
    and durable-write reconciliation.
13. Documentation/Atlas/security-matrix/credential/runbook updates triggered by the
    stage.
14. Stop conditions and owner decisions.

Every stage must leave the build green and the old production path usable unless an
explicit, rehearsed contract stage removes it after the required observation period.
Prefer branch-by-abstraction and normalized shadow comparison. Do not remove the old
path during the same stage that first proves the new one.

After drafting each stage, use a fresh-context reviewer to challenge its assumptions,
then re-open the current source and revise before drafting the next stage. At the end,
run `/contract-reconcile` Mode A over the entire plan and issue a `ready` or
`needs rework` verdict.

**Phase 6 exit gate:** every stage is independently verifiable, reversible, scoped,
and ordered; no plan intent is described as current state; the artifact can be handed
to a cheaper implementer without hidden architecture decisions.

## Phase 7: Opus adversarial review and Fable correction

Give Opus a fresh context containing the plan, governing docs, current diff/HEAD, and
specific review questions. Do not ask “Does this look good?” Require Opus to:

- confirm or refute the selected bottleneck and refactor choice
- find authority or durable-state changes disguised as performance work
- trace security boundaries and negative/complement cases
- find missing callers, consumers, cleanup paths, and partial-failure behavior
- challenge new cache keys, invalidation, user isolation, concurrency, and stale UI
- verify stage order, test preconditions, rollback, campaign posture, and old/new
  coexistence
- identify claims based only on docs or delegate summaries
- cite every actionable finding and return `approve`, `changes required`, or `reject`

Fable then verifies every material finding in source, fills the disposition matrix,
changes the plan where warranted, and explains any rejection with evidence. If Opus
finds a new structural gap in a mechanical gate, the corrected plan must include the
coverage lesson, failing fixture/self-test, gate change, and relevant docs together.

**Phase 7 exit gate:** no unresolved P0/P1 review finding; every Opus item has a
disposition; plan cross-references and finding IDs are internally consistent; Fable
issues the final architecture verdict.

## Phase 8: optional implementation loop after explicit owner authorization

This phase is dormant until the owner explicitly authorizes implementation and names
the first stage.

For one stage at a time:

1. Fable refreshes current source/production assumptions and writes the exact Sonnet
   work order, including owned files, denied files, tests, gates, and rollback.
2. Sonnet implements on an isolated branch/worktree and commits a green stage.
3. Fable inspects the complete diff and reruns the relevant verification. Delegate
   “tests pass” is not sufficient.
4. Opus reviews the implementation read-only in fresh context against the stage
   contract and the actual diff.
5. Fable adjudicates, then sends bounded fixes back to Sonnet or performs another
   architectural investigation. Do not let the implementer waive review findings.
6. Re-run gates after fixes. A gate and its self-test run serially; the broader
   fixture-writing gate battery is entirely serial.
7. Record performance/security comparison, durable writes, rollback, docs, and the
   exact commit. Stop before promotion.
8. The owner decides whether and when to merge/push `main`, enable any cohort, or
   proceed to the next stage.

If production behavior diverges after a release, revert/disable first when safe,
then reconcile residual durable state. Do not forward-fix a broad architectural
incident merely to preserve the refactor.

## Fable's first delegation briefs

Fable may adapt these after Phase 0, but each task must remain bounded.

### Scout 1: change and system map

“Read-only. Establish the last broad-audit Git baseline and inventory changes since
then in routes, auth, data, integrations, migrations, dependencies, and governing
docs. Use CodeGraph first. Return exact commands, file/symbol citations, categorized
counts, conflicts, unknowns, and five highest-risk changed surfaces. Do not edit or
run external probes.”

### Scout 2: semantic security map

“Read-only. Build a semantic route/side-effect inventory, prioritizing destructive,
token, cron, upload/download, admin, and external-user paths. For each sampled route,
trace guard, identity, client-controlled IDs, service, durable writes, consumer,
retry/concurrency, and negative path. Confirm/refute the preliminary merge and token
concerns. State coverage honestly. Do not edit or access production.”

### Scout 3: Workbench performance trace

“Read-only. Trace named Workbench journeys from event to render and external calls.
Quantify sequential fetches, duplicate data reads/hydration, remount reloads, broad
post-mutation refreshes, and discarded response data. Separate source-proven work
from measured latency and unknowns. Evaluate, but do not assume, the Request
Workbench Data Plane hypothesis. Do not edit or access production.”

### Scout 4: tests, gates, and operating controls

“Read-only. Map relevant checks to actual CI/hook/manual enforcement and self-tests;
inventory production-shaped fixtures, observability, release/rollback controls, and
current security-operating-plan drift. Return false-confidence risks and precise
missing verification. Do not edit or access production.”

Fable owns production probes after these scouts return. It may delegate a single
probe only with the complete command and ledger row already reviewed.

## Definition of done

The planning exercise is complete only when:

- current source, deployed state, docs, memory, and probe evidence are separated and
  reconciled
- the production probe ledger demonstrates read-only, bounded execution
- route inventory coverage is not confused with semantic authorization coverage
- every P0/P1 security claim is personally verified by Fable
- measured evidence distinguishes Dataverse latency from avoidable application work
- the recommended refactor is selected or rejected through a visible scorecard
- immediate security repairs are not smuggled into or deferred behind the refactor
- every migration stage has pre-tests, exact order, verification, rollback, release
  tier, documentation impact, and stop conditions
- Opus has performed a fresh-context adversarial review and Fable has dispositioned
  every finding
- all changed documentation gates and their self-tests are green in the required
  serial order
- the final handoff states clearly that implementation and promotion remain
  unauthorized unless the owner has separately approved them

## Final handoff format

Lead with the decision, not activity:

1. **Architecture verdict:** selected refactor, narrowed alternative, or measure/repair
   first, with the three strongest pieces of evidence.
2. **Immediate risk verdict:** P0/P1 items, mitigations, and owner decisions.
3. **Production truth:** confirmed differences from repository assumptions and
   remaining unknowns.
4. **Plan readiness:** `/contract-reconcile` verdict and Opus verdict.
5. **Artifacts and branch:** exact paths and commit(s), if any.
6. **Verification:** commands and results, including red gates or incomplete probes.
7. **Next authorization requested:** one precise next action; never assume permission
   to implement, deploy, merge, or push.
