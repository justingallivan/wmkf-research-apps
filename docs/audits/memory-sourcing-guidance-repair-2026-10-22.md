# Current sourcing guidance repair — 2026-10-22

## Scope and invariants

Sweep Mode A (accepted sourcing claim corrections), contract-reconcile Mode B.
Documentation and one source comment only; no runtime behavior, worktree topology,
environment, deployment, external data, or owner policy changes. Source checks
establish repository behavior, not current hosted behavior.

| Claim / invariant | Producer → persistence → consumer evidence | Repair | Status |
|---|---|---|---|
| Claude-assisted origination remains the accepted engine; sparse-tail retrieval is not its replacement. | S246 experiment/owner decision → experiment memory and superseded redesign routing → current origination guidance. | Wiki S231 imperative made historical; multilane routing distinguishes decision from historical probes. | VERIFIED via decision record |
| Track B remains off; one constant is insufficient for normal application reactivation. | discovery/constants.js false → four DiscoveryService search guards also require nonempty queries → analyze parser supplies empty arrays. Persistence N/A. | Wiki, constants comment, flowchart shortcut; preserve reviewed query/prompt/parser requirements. | VERIFIED via source |
| Proposal binding/fallback is implemented on main; deployment is unknown. | load-proposal-service exact canonical/fallback selection and request-scoped fileKey → validated proposalFile navigation binding → ReviewerFindPanel reload. | Memory separates current repository behavior from August branch/probe history; fe30d3b8b and 810e497ac are HEAD ancestors. | VERIFIED via source/Git; hosted state UNKNOWN |
| Display grouping is readiness-based, not provenance-based. | useReviewerSearchProjection partitions selectable candidates → readinessSections → search UI; alpha sort stays inside each section. Persistence unchanged. | Wiki describes Ready to add to Invite / Needs review; provenance remains in Details/counters. | VERIFIED via source |
| Route extraction does not mean all discovery orchestration left the route. | discover.js invokes discovery, exclusion/author/institution filters, referrals and final ranker → result stream. | Wiki names retained route responsibilities while preserving adapter-import boundary. | VERIFIED via source |
| S239 ratios and incomplete-build checklist are historical; shared recency ranking already exists. | Historical probes → original S239 design; current relevance-score uses recent activity, without cumulative citation/h-index terms. | Multilane leaf dates baseline and distinguishes future lane-input work from shipped shared ranking. | VERIFIED via source/history |

No new enums, tables, routes, helpers, async branches, or persistence contracts.
New partial-success/async/helper/symbol fan-out audits are N/A. Existing selection,
projection and guards were read as evidence. Source comment must preserve all
non-comment tokens. Relevant durable-surface and doc checks apply.

## Restatements and preservation

STALE statements are structurally replaced in two active leaves, the origination
wiki, the D26 flowchart shortcut, and the constants comment. Two canonical design
documents (sparse-anchor strategy and prompt decomposition) now explicitly route
current behavior to the wiki and bound their original design/probe bodies as history. Historical June
experiment results and comparative scope remain; the S246 sniff test is not
presented as real accept/decline evidence or as refuting the anchored multilane
proposal. The superseded redesign memory already has a visible historical/current
routing boundary and is left intact.

AGREE: existing default draw remains 15; identity-resolution budget remains 25;
Track B stays false; citation/h-index terms remain absent from relevance ranking;
applicant-exclusion breadth remains an open owner policy question. No activation,
new provider, ranking rule, or owner decision is introduced.

Disconfirming checks: inspect nonempty-query conditions as well as the switch;
inspect actual readiness-section construction rather than provenance counters;
inspect discover route filtering and rank invocation rather than infer from the
boundary gate; inspect exact file selection and main ancestry rather than infer
hosted deployment from a branch name. The A/B profiling script supplies its own
explicit queries, so its switch-only fixture warning is distinct from reactivating
the normal analyze-driven application.

## Verification and limits

All 24 selected check/self-test invocations passed: 10 sequential pairs (atlas,
doc-currency, fact-consistency, doc-symbol-refs, build-claim-freshness,
canonical-pointers, drain-table-mentions, prompt-storage-mentions, agent-wiki,
memory-router), plus agent-invariants, docs-catalog, memory-drift, memory-health.
Catalog regeneration produced no diff. Memory-health retains the previous batch's
eight advisory signals (seven shadow-atlas and one dated-probe weak-basis); no new
signal was introduced by this batch. Babel non-comment token comparison proves
constants.js runtime code unchanged; git diff --check passed. No runtime tests or
build were needed for prose/comment-only changes.

Fresh reviewer sourcing_repair_review whole-read the relevant memories, wiki,
flowchart, sparse strategy and prompt-decomposition design, reviewed the patch,
and found no blockers. It identified and added the two historical routing boundaries;
the original design bodies remain intact. A follow-up wording adjustment leaves
the exact scope of old lane-specific recency work for revalidation rather than
asserting the historical author's intended meaning.

Claims: 6 → VERIFIED 6 within repository/decision-record scope. Repeated targeted
searches leave zero live stale statements for these six corrected claims in the
reviewed surfaces. Historical assertions remain visibly bounded. Verdict:
RECONCILED for this sourcing repair scope only.
No live probes. Current model override, serving deployment, environment values,
proposal-file availability, panel outcomes and population counts are UNKNOWN here.
Historical deployment/alert cleanup and the other deferred identity/engagement
findings remain separate. This is a bounded repair, not a whole-domain certification.
