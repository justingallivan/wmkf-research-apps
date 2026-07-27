---
title: Documentation and Memory Hygiene Sweep — 2026-07-27
domain: docs-governance
kind: audit
status: active
summary: "Evidence-first reconciliation of known current-document drift and the complete registered active-memory hygiene queue."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/audits/AUDIT_FULL_DOCUMENTATION_TRUTH_2026-07-26.md
  - docs/audits/memory-health-evidence-triage-2026-07-22.md
  - docs/CI_GATES_REFERENCE.md
  - .claude-memory/MEMORY.md
---

# Documentation and Memory Hygiene Sweep — 2026-07-27

## Sweep contract

**Mode:** `/sweep` Mode B — domain truth audit.

**Domain/change surface:** current durable documentation and active
`.claude-memory` hygiene.

**Claims to verify or falsify:**

1. every current-document residual named by the 2026-07-26 material-claim audit
   is either structurally corrected or explicitly retained as an evidence-bounded
   `UNKNOWN`;
2. every current `check:memory-health` finding is reviewed as a claim, routing,
   evidence, or size issue rather than mechanically silenced;
3. current guidance does not promote historical evidence, planned behavior, or
   unprobed external state as built/live truth;
4. the drain-table documentation gate returns green without weakening its
   registry or scan scope; and
5. current docs, memory, wiki, and session routing agree after the repair.

**Authoritative sources expected:** current source and CodeGraph caller paths;
schema/migrations and Atlas ownership; tests and registered gates within their
bounded scopes; dated read-only probe evidence already retained in the
repository; explicit owner decisions.

**Durable surfaces in scope:**

- current/canonical/draft top-level documents implicated by the 2026-07-26
  audit;
- linked Atlas and active plan/spec surfaces implicated by those claims;
- `SESSION_PROMPT.md`;
- all 223 active-memory leaves scanned by `check:memory-health`, including all
  97 initially flagged files;
- `.claude-memory/MEMORY.md` routing; and
- agent-wiki/current audit routing when a repaired claim requires it.

**Excluded surfaces and reason:**

- archived or explicitly historical documents, except when current routing
  promotes them as authority;
- source-code behavior changes, operational-script quarantine/removal, and
  reconciliation-generator redesign, because this is a durable-document and
  memory repair;
- destructive operations and live writes;
- external-state assertions without a safe dated probe. These remain
  `UNKNOWN` with the required probe named.

## Baseline

Repository baseline: `c2b57d07895c7b8a34537ab0b58ac3996a5ae15f`
on branch `codex/docs-memory-hygiene`.

The startup battery ran all 57 registered `check:*` scripts sequentially.
`check:drain-table-mentions` failed on four unannotated retired-table mentions:
one retired `reviewer_suggestions` mention in `SESSION_PROMPT.md` and three
retired table names on one line of `docs/REVIEWER_ARCHITECTURE.md`. Its
self-test also failed because the live baseline was red. Every other
registered check passed.

The initial active-memory advisory inventory was:

| Signal | Baseline |
|---|---:|
| Files scanned | 223 |
| Unique files flagged | 97 |
| `shadow-atlas` | 33 |
| `weak-basis` | 51 |
| `no-recall-rule` | 46 |
| `oversize-routed` | 2 |
| `stale-routed` | 0 |

These are triage signals, not 132 proven factual defects. A finding is closed
only by meaningful evidence/routing repair, a useful recall rule, structural
compression, or an explicit historical/unknown boundary.

## Parallel ownership

| Workstream | Exclusive edit surface | Closure target |
|---|---|---|
| Current documentation | `SESSION_PROMPT.md`; `docs/**` except audits and agent wiki | Verify and reconcile the open document clusters named by the July 26 audit; clear the drain-table gate. |
| Non-project memory | `MEMORY.md` and non-`project-*`/non-`slice0-*` memory leaves | Review every owned health finding and preserve only evidence-bounded guidance. |
| Project memory | `project-*` and `slice0-*` memory leaves | Review every owned health finding; name probes for live-only unknowns. |
| Integration | This report, cross-surface reconciliation, wiki/audit routing, gates, and adversarial review | Prove the combined tree has no known live stale claim in the declared scope. |

## Contract-reconcile invariants

| Invariant | Verification |
|---|---|
| A prose behavior claim names the real producer, persistence/source of truth, and consumer, or explicitly marks a hop `N/A`. | CodeGraph/source trace and whole-target read. |
| Historical evidence is not presented as current production state. | Semantic contradiction search plus routing review. |
| Live-only facts are not refreshed from source inference. | Dated probe citation or explicit `UNKNOWN`/probe-required label. |
| Retired-table guidance cannot be mistaken for a runnable/live Postgres contract. | Drain-table gate and self-test, run sequentially. |
| Memory-health findings are not hidden with decorative checker tokens. | Diff review against the actual claim/evidence and before/after JSON inventory. |
| Current routing does not point at stale/superseded leaves as authority. | Memory-router, memory-health, agent-wiki, and symbol-reference gates. |

## Evidence matrix and results

### Edit classifications

The documentation workstream reconciled 17 substantive durable files and one
generated catalogue:

| Primary classification | Files | Result |
|---|---:|---|
| Historical/status correction | 4 | Completed designs and point-in-time reviews no longer present themselves as active implementation guidance. |
| Current-state, ownership, or source-reference correction | 7 | Current adapters/services, retired-table state, propagation behavior, and shipped portal behavior now match the evidence reviewed. |
| Mixed-plan current-boundary restatement | 6 | Shipped repository behavior is separated from unbuilt target behavior and unprobed external state. |
| Generated catalogue refresh | 1 | `docs/DOCS_CATALOG.md` reflects the reconciled frontmatter. |

The active-memory workstream reviewed all 97 files in the initial warning
queue. Three additional same-pattern siblings were corrected during semantic
review, for 100 changed memory leaves in total. The 132 baseline signals
overlapped within those 97 files and therefore are not treated as 132 distinct
claims.

### Material claim-status census

The sweep tracked material claims as contract rows rather than counting every
repeated sentence as a separate claim. Status assignments below are
nonexclusive: a mixed contract can contribute both a shipped `PARTIAL` boundary
and a subsidiary `UNKNOWN` or `PLANNED` boundary.

| Status | Assignments | Meaning in this sweep |
|---|---:|---|
| `VERIFIED` | 6 | Current reviewer-table state; adapter/service ownership; acceptance/enforcement/propagation; shipped contact-lead slices; completed DAL/context migration; historical memory incidents as historical evidence. |
| `PARTIAL` | 7 | Prompt storage/Executor, workflow chaining, grantee/honorarium, synthesis, Q9, intake-admin, and budget each have a verified shipped boundary plus unbuilt or unprobed portions. |
| `PLANNED` | 1 | Broad paid reviewer-contact scouting is an unbuilt option pending owner decisions. |
| `ASSUMED` | 0 | No assumption is used as current truth. |
| `STALE-CONFLICT` | 0 final | Independent review found conflicts during integration; each is listed and closed below rather than hidden by the final zero. |
| `UNKNOWN` | 2 | Current Power Automate operation and current external-platform/live-environment facts require named probes. |

### Contract-reconcile matrix

| Material contract | Producer | Persistence / source of truth | Consumer | Classification |
|---|---|---|---|---|
| Reviewer-domain retirement | Migration 018 drops five legacy tables; W3 cutover retains Postgres `grant_cycles` as drain-only | Migration SQL + Postgres/Dataverse Atlas | Current adapters and routes have no reader/writer for the five dropped tables; grant-cycle app reads use Dataverse | `VERIFIED` |
| Grant-request access | Domain services | `grant-request` adapter over Dataverse `akoya_request` | Reviewer, Workbench, Grant Reporting, Phase I, Expertise, and Grantee services | `VERIFIED` |
| Reviewer acceptance | External respond service stages acceptance and a durable job | Dataverse suggestion is lifecycle authority; Postgres `reviewer_acceptance_jobs` is side-effect progress | Acceptance drain performs contact/honorarium/email/quota work | `VERIFIED` |
| Contact leads | Contact enrichment emits quarantined leads; manage-only promotion selects one | Bounded `reviewer_find_roster` representation plus canonical Dataverse person/suggestion on promotion | Reviewer Finder audit expander and invitation confirmation gate | `VERIFIED` for shipped slices; paid broad scout `PLANNED` |
| Prompt publication/execution | Admin publication route and repository seed paths | Dataverse `wmkf_ai_prompt`; append-only Postgres publication audit; `wmkf_ai_run` execution audit is fallible | Vercel Executor callers | `PARTIAL`; universal editor/resolver and PA parity unbuilt or unknown |
| Workflow chaining | Vercel Executor parses declared output and attempts target writes | Declared `akoya_request.wmkf_ai_*` fields; per-output write results must be checked | Downstream PA consumers | `PARTIAL`; downstream PA DAG `UNKNOWN` |
| Grantee/honorarium | Guarded routes/services | Dataverse request/contact entities plus documented Postgres operational state | Workbench/portal/finance flows | `PARTIAL`; current row/config populations require probes |
| Review synthesis | Staff synthesis route after at least one submitted review | `akoya_request.wmkf_reviewsynthesisjson` | Reviews tab and DOCX/PDF exports | `PARTIAL`; no auto trigger and participation set is undecided |
| DAL/context migration | Post-auth entry points establish trusted context; services use entity adapters | Dataverse through the 19 registered adapters; boundary gates enforce exceptions | Route/service consumers | `VERIFIED`; DAL, bypass-strip, and notification push-up plans are completed history |
| Q9 preferences/app access | Preference service uses the DynamicsService adapter; app-access service still uses raw client transport | Dataverse preference and app-access entities | Auth/profile/app-access consumers | `PARTIAL`; preference migration shipped, app-access transport migration deferred, production warn/soak state `UNKNOWN` |
| Intake membership | Applicant landing/submit call membership service | Dataverse `wmkf_portalmembership` | Applicant eligibility and submit guard | `PARTIAL`; applicant reads shipped, intake-admin approval app/page/routes unbuilt |
| Intake budget | Submit freezes flat budget lines; drain writes child rows | Postgres draft/job state → Dataverse `wmkf_proposalbudgetline` | Intake workflow | `PARTIAL`; applicant UI, nested model, parent aggregates/persons, and terminal transition unbuilt |
| Historical memory incidents | N/A — dated decision/incident evidence | Tracked memory leaf | Future agent recall | `VERIFIED` as historical only; fresh incidents require re-verification |
| Live external state | N/A until a read-only probe runs | Vercel, Power Platform, GitHub, tenant, Dataverse/SharePoint live state | Operational decisions | `UNKNOWN`, never inferred from repository source |

### Structural fixes

- Replaced append-only caveats with single structural accounts. In particular,
  stale present-tense platform/runtime assertions were removed rather than left
  below a historical disclaimer.
- Added useful `## Recall Rule` sections and evidence boundaries to routed
  memory instead of inserting checker keywords without guidance.
- Compressed the two oversized routed memories while preserving their
  decisions, evidence, and recall conditions.
- Reclassified completed design records as historical where their remaining
  value is implementation rationale, and added explicit current-boundary
  sections to mixed plans that still carry live decisions.
- Updated the Akoya request Atlas from direct route/transport claims to the
  current adapter/service path and removed false Wave 1 Postgres fallback
  claims.
- Replaced stale reviewer route line anchors with current service/symbol
  references.
- Corrected the retired reviewer-table wording without weakening the
  drain-table registry or scanner.
- Reconciled reviewer acceptance, contact-lead, intake propagation, grantee,
  honorarium, prompt-storage, workflow-chaining, and backend-automation claims.
- Corrected the reviewer-workbench wiki so synthesis readiness is not described
  as “every invited reviewer submitted.”

### Disconfirming checks and restatement search

- A same-pattern semantic pass found and repaired memory entries where a dated
  caveat sat above a contradictory present-tense claim. The repaired set
  included the S164 typeless-module decision, the S272 Turbopack sandbox
  incident, the S271 Sensitive-variable observation, deployment-monitoring
  guidance, and related historical incidents.
- Targeted documentation searches found no remaining instance of the stale
  audited phrases in the current surfaces.
- The reviewer enforcement/retrieval reference audit found no remaining
  out-of-range line anchor in the reconciled surfaces.
- Fresh independent review disconfirmed several first-pass edits. It found and
  closed: the false claim that migration 018 dropped `grant_cycles`; false
  all-six-drain wording in the gate reference and future-architecture plan;
  current-looking dropped-table Atlas sections; destructive stale
  `search_cache` drop guidance; pending-drop instructions left in the completed
  reviewer migration plan; current-looking unbuilt Prompt Storage sections; an
  infallible Executor audit/write claim; stale Contact Leads and Workbench line
  anchors; stale canonical status on the reviewer-lifecycle proposal;
  production attribution to the isolated expertise-matching demo; inconsistent
  prompt-storage memory; and stale budget/membership Atlas boundaries.
- A second plan-status workstream then reconciled completed DAL,
  bypass-strip, and notification plans as history; kept Q9 active around its
  real deferred app-access stage; and marked intake-admin and the budget
  product as parked drafts with their shipped foundations separated from their
  unbuilt products.

### Focused independent restatement census

Units are material file/claim pairs, not raw matching lines. Duplicate textual
hits in one file for the same claim collapse to one pair; a file participating
in two distinct claim families counts twice. This is a focused independent
census of 48 whole-read/source-checked pairs, not every textual occurrence in
the repository.

| Claim family | Pairs | `AGREE` | `STALE` | `HISTORICAL` | `UNRELATED` |
|---|---:|---:|---:|---:|---:|
| Reviewer-table retirement/retention | 16 | 8 | 0 | 8 | 0 |
| Synthesis readiness semantics | 5 | 4 | 0 | 1 | 0 |
| Prompt / Executor / PA boundary | 8 | 8 | 0 | 0 | 0 |
| Contact-lead contract/evidence | 2 | 1 | 0 | 1 | 0 |
| Acceptance queue flow | 2 | 1 | 0 | 1 | 0 |
| Plan/build-status boundary and Atlas companions | 15 | 5 | 0 | 10 | 0 |
| **Total** | **48** | **27** | **0** | **21** | **0** |

### Explicit remaining unknowns and owner decisions

These are deliberately not converted into “current” facts:

- Power Automate prompt execution, trigger posture, retry behavior, and the
  end-to-end workflow-chaining DAG require a dated Power Platform probe.
- Current production row populations, including honorarium proposal-link
  population, require a new read-only row probe.
- Review-synthesis participation semantics remain an owner decision. The target
  is “all reviews are in,” but declined, withdrawn/released, revoked, duplicate,
  and exception-state participation is not defined.
- Broad paid reviewer-contact scouting remains unbuilt; its value, eligibility
  floor, budget, and enablement policy remain owner decisions.
- Remaining grantee reminder-policy operations and current policy-row/body state
  require external verification.
- Several memory leaves intentionally retain `UNKNOWN` for current Vercel flags
  or environment values, GitHub plan capabilities, tenant operation,
  Dataverse/SharePoint privileges, and live schema metadata until their named
  read-only probes run.

### Mechanical memory result

`check:memory-health -- --json` now reports:

| Signal | Final |
|---|---:|
| Files scanned | 223 |
| Unique files flagged | 0 |
| `shadow-atlas` | 0 |
| `weak-basis` | 0 |
| `no-recall-rule` | 0 |
| `oversize-routed` | 0 |
| `stale-routed` | 0 |

This zero is a structural advisory result. The semantic closure rests on the
claim review and explicit unknowns above, not on the checker alone.

## Final verification and verdict

The independent adversarial review found no unresolved material documentation
or memory-hygiene finding. Its focused census covered 48 material claim/file
pairs: 27 `AGREE`, 21 `HISTORICAL`, 0 `STALE`, and 0 `UNRELATED`.

The root-run verification battery completed sequentially:

- all 57 registered `check:*` scripts passed, including each applicable
  self-test;
- the final anchor-only follow-up passed the agent-wiki, Atlas, doc-currency,
  memory-drift, memory-health, fact-consistency, canonical-pointer,
  drain-table, prompt-storage, document-symbol, docs-catalog,
  build-claim-freshness, memory-router, and status-enum gates and their
  applicable self-tests;
- `git diff --check` passed; and
- memory health remained at 223 files scanned with zero findings in every
  advisory category.

**Verdict: `RECONCILED WITH EXPLICIT UNKNOWNS`.** Within the declared sweep
domain, there is no known live stale claim or unresolved contradiction.
Historical numeric references that remain are confined to clearly dated
historical material rather than current implementation guidance. No live
external write or state-changing probe was performed; the items in “Explicit
remaining unknowns and owner decisions” remain intentionally open pending their
named read-only probes or owner decisions.
