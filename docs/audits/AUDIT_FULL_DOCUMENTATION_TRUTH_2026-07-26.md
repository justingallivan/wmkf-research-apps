---
title: Repository-Wide Material-Claim Audit — Partial Reconciliation — 2026-07-26
domain: docs-governance
kind: audit
status: active
summary: "Evidence-first repository-wide material-claim audit and partial reconciliation of current documentation, memory, source comments, gates, and selected live-state assertions against the codebase."
canonical: false
cataloged: 2026-07-26
last_verified: 2026-07-26
owner: product-engineering
related:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/CI_GATES_REFERENCE.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - .claude-memory/MEMORY.md
---

# Repository-Wide Material-Claim Audit — Partial Reconciliation — 2026-07-26

## Verdict

The repository was **not semantically reconciled** at audit start.

The executed structural documentation/gate baseline passed, yet current durable
surfaces still contained false production-auth instructions, a dangerous
expected-red test exemption, false user-facing Integrity Screener features,
incorrect Atlas ownership, stale migration state, overbroad AI/Executor claims,
and runnable scripts aimed at dropped tables.

This audit corrected the highest-risk current claims and records the remaining
work explicitly. A green gate result must not be used as proof that prose claims
match runtime behavior.

## Scope and standard of proof

Inventory at audit start:

- 416 artifacts under `docs/`, including 89 archive files, 22 Atlas pages, and
  14 agent-wiki topics.
- 232 `.claude-memory` artifacts.
- 235 top-level cataloged Markdown documents.
- 149 API route files, 12 active app definitions, 19 Dataverse adapter files,
  10 Workbench tabs (6 live, 4 placeholders), and 18 Vercel cron registrations.

The audit used:

1. current code and CodeGraph call paths;
2. producer → persistence → consumer traces for material behavior claims;
3. current schema/migration artifacts and Atlas ownership;
4. targeted tests and registered repository gates;
5. dated live-probe evidence already present in the repository;
6. explicit `UNKNOWN` classification where current external state was not
   re-probed.

This is a **material-claim audit**, not a claim that every sentence in every
historical artifact received an independent runtime trace. Broad searches were
used to find candidate claims; findings were promoted only after source tracing.
Archives and clearly labeled historical snapshots were not treated as defects
unless a current router, report, or document promoted them as current truth.

## Baseline gates

An earlier startup run reported 55 passing gate/self-test commands, but did not
retain a machine-readable command receipt. The current `/start` list contains
56 commands and `package.json` also exposes the write-mode
`check:memory-drift` variant, so the missing command cannot be named and the
55-command result must not be treated as complete coverage. Notable derived
facts from the executed checks:

- migrations manifest: 26 migrations;
- API matrix: 149 routes;
- Atlas coverage: 33 Postgres tables and 32 Dataverse entity sets;
- agent wiki: 14/12 topics as reported by its checks;
- docs catalog: 235 entries;
- document references: 246 documents / 1,257 references;
- app definitions: 12;
- `requireAppAccess` endpoints: 87;
- Workbench tabs: 10 total / 6 live / 4 placeholders;
- model registry: 43 values / 3 fallbacks / 11 capabilities;
- prompt-injection inventory: 27 surfaces.

The initial attempt to run self-test pairs in parallel produced false failures
because several checks share fixture directories. Serial reruns passed. The CI
runbook now states that fixture-writing checks must run serially.

### What is actually enforced

- `.github/workflows/test.yml` runs only a subset of package checks.
- Blocking commit hooks cover selected documentation/status/trust checks and
  fail open internally.
- Session-stop maps additional gates, but the default stop mode is advisory.
- `/start` runs a broader manual battery.

Package checks absent from GitHub CI include the agent-wiki self-checks, API
self-test, canonical pointers, drain mentions, fact consistency, memory
drift/health checks, model registry, prompt-injection tagging, prompt storage,
status parity, and trust-boundary GUID checks. Memory-router and its self-test
are present in `.github/workflows/test.yml`.

Therefore, calling every `check:*` script a “CI gate” was false. The runbook and
model-change strategy were corrected to name their actual enforcement tier.

## High-risk findings and disposition

| Priority | Finding | Evidence | Disposition |
|---|---|---|---|
| P1 | Emergency-auth instructions said `AUTH_REQUIRED=false` was sufficient. | `auth-policy.js` requires `EMERGENCY_AUTH_BYPASS=true` whenever `NODE_ENV=production`, including production-mode Vercel Preview and Production runtimes. | **Repaired** in the runbook and source headers. |
| P1 | Public `/api/auth/status` reports `AUTH_REQUIRED && credentials`, not the fail-closed server policy. | With `NODE_ENV=production`, it can return `enabled:false` while `isAuthRequired()` returns `true`; clients consume the public value for redirect/bootstrap behavior. | **Open code divergence**; source header corrected, runtime behavior not changed in this documentation audit. |
| P1 | Memory instructed agents to ignore two “expected-red” suites indefinitely. | Exact suites passed 2/2, 78/78 tests. | **Repaired**: exception closed and removed from always-read routing. |
| P1 | In-app Integrity guide promised durable dismissal suppression and a History tab. | Page dismissal handler is a placeholder; page calls neither dismissal nor history API; screening does not read dismissals. | **Repaired** in both guide surfaces and wiki. |
| P1 | Runnable operational scripts still target dropped `reviewer_suggestions`. | 25 non-archive scripts mention the table; some directly delete/update retired tables. | **Open safety action**; no scripts deleted without owner authorization. |
| P1 | Canonical Executor contract said target-write failure throws and an audit row is always written. | Persistence returns `writeResults.allOk=false`; failure-row logging can itself fail and leave `runId=null`. | **Repaired** in Executor contract. |
| P1 | Prompt-injection memory called the check CI-enforced. | GitHub workflow does not run that check. | **Repaired** in the named memory and CI runbook. |
| P1 | Generated reconciliation report claimed zero live drift while importing old “verified” audit prose. | Current Integrity claims disprove the historical CLEAN label carried into the report. | **Report is unsupported as semantic proof**; generator needs redesign. |

## Authentication, security, credentials, and storage

### Corrected

- Auth overview now distinguishes proxy-matched application routes from static,
  NextAuth, cron, IRS, external-token, applicant, and HMAC boundaries.
- Production-mode emergency access now requires both `AUTH_REQUIRED=false` and
  `EMERGENCY_AUTH_BYPASS=true`, followed by removal/restoration. The docs name
  the actual `NODE_ENV=production` predicate rather than implying a Vercel
  environment-name check.
- API matrix now names `requireSuperuser` as the expected Superuser guard.
- Credentials runbook now lists all three expiring client secrets, includes the
  tracked OpenAlex key, and describes the live intake malware-scan path.
- `uploaded-blob.js` now names `UPLOADS_BLOB_RW_TOKEN`, matching its fail-closed
  implementation.

### Verified

- Dataverse target/write interlock classification and fail-closed invalid-value
  behavior match root instructions.
- Entity writes enforce trusted DAL context.
- Intake, DVX, and shared private uploads use separate Blob tokens.
- `requireAppAccess` rechecks active profiles/roles and reads app grants under
  Dataverse context.

### Remaining classifications

- `DATA_ACCESS_LAYER_MIGRATION_PLAN.md`: completed historical summary; current
  adapter count is 19, not 18.
- `BYPASS_STRIP_PLAN.md`: pages/lib closure is historical, but 44 non-archive
  scripts still mention or call `bypassDynamicsRestrictions`.
- `NOTIFICATION_TRUST_MODEL_PLAN.md`: completed historical plan; ambient trusted
  context is the live contract.
- `Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`: remains active because app-access
  still uses raw client calls.
- `INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md`: draft/parked; schema exists, UI/routes
  remain intentionally unbuilt.
- `BUDGET_FORM_SPEC.md`: draft/parked; schema and draft→submit→drain path exist,
  but the product remains parked.
- `/api/auth/status`: client-bootstrap predicate differs from the server's
  fail-closed `isAuthRequired()` policy and requires a deliberate runtime fix.

These large plans were not status-flipped mechanically; each needs a full-body
historical/current rewrite before its frontmatter changes.

## Persistence and Atlas

### Corrected

- Root Atlas now inventories all 19 adapter files and no longer says grant cycle
  or grant request lacks an adapter.
- `wmkf_potentialreviewers` is now described as the custom canonical reusable
  reviewer-person store, not vendor scratch/history.
- The inherited one-shot person-deletion proposal is marked unsafe and blocked
  pending a new relationship probe and owner retention decision.
- `reviewer_find_roster` is listed as active operational Postgres state.
- Active `review_drafts`, `reviewer_acceptance_jobs`, and identity shadow logging
  are distinguished from dropped legacy reviewer tables.
- `reviewer_suggestions` is documented as dropped by migration 018, not
  drain-only/pending drop.
- Review-draft row count is marked probe-required; the false “UI not shipped”
  explanation was removed.
- Dead Wave-1 Postgres branches are now described as removed/fail-loud, not live
  dead code.

### Remaining Atlas corrections

- `dataverse-akoya-request.md` and selected entity pages still cite pre-service
  route-to-`DynamicsService` paths.
- `postgres-infra-tables.md` and related catalogue prose retain old caller counts.
- Mutable row counts require new Postgres/Dataverse probes before reuse.
- Whether modern reviewer assignment co-writes all five native request reviewer
  slots remains **UNKNOWN**.

## Reviewer, Workbench, honorarium, and grantee

### Verified current flow

- Workbench has 10 tabs: Overview, Proposal, Reviewers, Reviews, Status, and
  Awardee are live; four writeup/site-visit tabs are placeholders.
- Reviewer Find uses active `reviewer_find_roster`.
- Saving candidates writes canonical person and suggestion entities.
- Identity/COI save enforcement is live.
- Acceptance queue/drain, external review authoring, staff manual entry, answer
  snapshots, comparison/matrix, and DOCX/PDF exports are live.
- Synthesis is partial: manual after at least one submitted review, no automatic
  all-in trigger, hidden at zero submissions, and production execution remains
  red.
- Contact correction propagation is field-specific: name/nickname/title sync,
  separate ORCID/board capture, and alert-only email/affiliation handling.
- Awardee/grantee and honorarium code paths exist; current production record
  distribution/configuration remains probe-required.

### Corrected

- Staff-editable review-question plan is now a completed historical record.
- Reviews build plan labels its read-only-card context as pre-build history.
- ReviewersTab source comment now agrees with parent request keying.
- Reviewer architecture no longer claims all reviewer Postgres is drain-only or
  that native five-slot co-write is proven.
- Potential-reviewer and suggestion Atlas pages no longer retain destructive or
  “never propagated” claims.
- Prior “deep/full Workbench audit complete” wording in the handoff and queue is
  qualified as a bounded pass.

### Remaining current-document drift

- `INTAKE_PORTAL_SCHEMA_CHANGES.md` repeats the false blanket “never propagated”
  statement.
- `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` still labels the superseded blocking
  accept route as the current browser flow; current accept work is queued and
  completed by the acceptance drain.
- `REVIEWER_CONTACT_LEADS_REVIEW.md` remains active although it calls itself a
  point-in-time review.
- `REVIEWER_CONTACT_LEADS_SPEC.md` still says proposed draft and contradicts
  itself about whether durable lead storage shipped.
- `REVIEWER_FINDER_COI_CHUNK2_DESIGN.md` remains active although its body says
  the whole document is historical.
- Grantee and honorarium plans retain “resolve during implementation” prose for
  already shipped work.
- Reviewer enforcement documents have stale line citations after service
  extraction.

## AI, prompts, models, and product surfaces

### Corrected

- In-app and Markdown Integrity guides now describe current source-specific
  summaries, placeholder dismissal, absent History UI, and current-run exports.
- Virtual Review Panel now says one randomly selected provider performs the
  Devil’s Advocate pass.
- Dynamics Explorer guide names the restriction boundary, the exact trimming
  behavior (two synthetic notices plus four recent real messages), and distinct
  count versus 5,000-row retrieval/export behavior.
- Model-change strategy now distinguishes registered static checks from GitHub
  CI; the stale model-loader comment now says 24-hour TTL.
- System model distinguishes Executor-backed declarative tasks from Integrity,
  VRP, and agent/chat paths and labels the thin-adapter rule as target-state.
- Strategy no longer says every AI write creates `wmkf_ai_run` or that
  `prompt-resolver` is the live universal prompt store.
- Service catalogue lists representative Executor consumers and describes the
  legacy-named reviewer service as live.
- Executor contract now includes `actingUserSystemId`,
  `assertSystemIncludes`, payload-boundary/raw-retention metadata, structured
  target-write failure, fallible audit logging, and the omitted `usage`/`meta`
  keys on blocked returns.
- `AI_PROMPTS_DETAILED.md` is now historical/noncanonical with an explicit
  incomplete-snapshot warning.
- The two modified prompt seed scripts are disclosed: peer-review now names its
  live Executor path, while reviewer-finder names live service parsing and
  canonical Dataverse candidate persistence instead of dropped Postgres tables.

### Remaining high-value drift

- `AI_PROMPTS_DETAILED.md` remains incomplete historical content and should
  eventually be generated from source/live rows; it no longer claims canonical
  or exhaustive status.
- `AI_PROMPTS_OVERVIEW.md` is now explicitly marked stale, but should eventually
  be regenerated from the current registry and prompt surfaces.
- `PROMPT_STORAGE_DESIGN.md` mixes implemented append-only publication with
  unbuilt draft/diff/test/rollback/universal-override features.
- `BACKEND_AUTOMATION_PLAN.md` and `WORKFLOW_CHAINING_DESIGN.md` mix target
  architecture with false current-state examples.
- `CHUNK_CONSOLIDATION_PLAN.md` is completed history but retains “helper does not
  exist” present tense; `lib/utils/chunk.js` currently has 30 callers.
- `modules/expertise_matching` is a reference/demo with no production caller;
  its browser component directly calls Anthropic and must not be presented as
  the production Expertise Finder.

## Reference and audit-engine weaknesses

A source-reference audit found:

- 1,232 `file:line` references across 543 non-archive docs/memory files.
- 193 missing or out-of-range references.
- 71 bad references across 21 active/canonical/draft top-level documents.
- Four real broken references in canonical reviewer enforcement/retrieval docs
  after excluding path-name false positives.

The document-symbol check validates file existence but not line validity. Exact
line anchors are therefore a material unguarded drift class.

`docs/RECONCILIATION_REPORT.json` reports `live_drift_findings: 0`, but imports
historical audit labels without re-proving them. Its zero is an aggregation
result, not evidence that current prose matches source.

## Operational script hazard

Twenty-five non-archive scripts mention the dropped `reviewer_suggestions`
table. Examples include direct delete/update/backfill/restore utilities. The
copy-pasteable obsolete commands were removed from `scripts/README.md` and the
legacy surfaces are now labeled blocked there. The current drain-doc check does
not scan operational scripts.

No destructive cleanup was performed during this audit. Recommended next
action:

1. inventory each script as read-only/current, historical, or dangerous;
2. add a fail-closed retired-table guard to historical/mutating scripts;
3. extend a gate to scan operational scripts for dropped-table literals.

Code quarantine/removal requires owner authorization because it changes
operational capability. The documentation warning did not and was repaired in
this audit.

## Live/external probes still required

Do not upgrade these to verified until probed:

- Vercel environment posture for DAL/interlock/auth/BILL/private-Blob/VRP/model
  flags and provider allowlists.
- Live Postgres migration/table inventory and row/status distributions for
  drafts, roster, acceptance jobs, integrity, expertise, and panel tables.
- Live Dataverse entity/attribute/count spot checks, question-set hash/version,
  prompt inventory, AI-run counts, honorarium linkage, reviewer native-slot
  co-write, and grantee deliverable statuses.
- SharePoint/Graph permissions and document-library paths.
- Blob access modes.
- BILL webhook/subscription state.
- Power Automate Executor progress and external writeup flows.
- Genuine external-reviewer use versus staged tests.
- Current Retraction Watch record count.

## Recommended next actions

1. **Quarantine the stale-script risk** after owner approval.
2. **Redesign the reconciliation generator** so it re-evaluates claims or reports
   “unverified,” rather than carrying historical labels forward.
3. **Add line-reference validation** for current/canonical documents.
4. **Promote the security/model/prompt/trust checks that matter to GitHub CI**
   and keep fixture-writing self-tests serial.
5. **Run a read-only live-state probe pack** and update Atlas counts/statuses in
   one dated reconciliation.
6. **Reclassify the large mixed plans** only after full-body edits move current
   obligations to the queue and label chronology historical.

## Verification after reconciliation

- Documentation, Atlas, API-route, instruction, memory, model, prompt-injection,
  Dataverse boundary, route-boundary, trust-boundary, and secret checks passed
  in their relevant serial runs; paired self-tests passed where defined.
- The two formerly “expected-red” suites passed 78/78 tests.
- The full Jest suite passed 517/517 suites and 6,150/6,150 tests after updating
  the reconciliation test's canonical Atlas count from 710 to 724.
- ESLint exited successfully with 0 errors and 50 pre-existing warnings.

## Completion boundary

This audit establishes and repairs code-verifiable material truth. It does not
claim current knowledge of external services that were not probed, and it does
not silently convert planned architecture into built state. Remaining
stale/conflicting documents are named above so they cannot be mistaken for an
unknown clean bill of health.
