---
title: Reviewer Holistic Routed-Memory Reconciliation — 2026-07-22
summary: "Source-backed audit and compression of the routed reviewer holistic-redesign memory."
canonical: false
owner: product-engineering
last_verified: 2026-07-22
---

# Reviewer Holistic Routed-Memory Reconciliation — 2026-07-22

## Contract-reconcile surface

- **Change surface:** agent-facing reviewer identity/finding roadmap only.
- **Entry points:** `.claude-memory/MEMORY.md`, the routed holistic memory, and
  the two active reviewer plans.
- **Persistence:** tracked memory/docs; no Postgres, Dataverse, Blob, or runtime
  write.
- **Consumers:** future agents planning reviewer origination, identity,
  persistence, rollout, or cleanup; memory/documentation CI gates.
- **Prior finding:** the routed memory was the sole remaining
  `oversize-routed` memory-health warning and required a dedicated audit before
  compression.

Whole-flow, durable-surface, and document-reconcile audits apply. Runtime
partial-success, asynchronous client state, and helper extraction are N/A
because this change does not alter executable code, payloads, persistence, or
UI state. Symbol-consumer fan-out was used as evidence: production imports of
the runtime seam, binding writer, evaluation-only pipeline, and reviewer Track
B switch were enumerated before current-state claims were rewritten.

## Findings

1. **REWRITE — the memory was a deployment diary, not an efficient router.**
   It repeated dated schema population, deployment IDs, smoke-run details,
   manifest hashes, and phase history already retained in the 1,084-line
   umbrella plan and audits. That detail made it 12,365 bytes and increased the
   chance that later implementation work would be omitted. Required change:
   retain current contracts, open gates, and source-of-truth routing; leave
   chronology in plans/audits/git.
2. **CURRENT BUT INCOMPLETE — its safety posture remained sound.** The memory
   correctly kept production changes legacy-default, separated confidence from
   provenance, and prohibited cleanup before promotion/observation. It did not,
   however, route readers to the newer W0–W4 identity/contact roadmap or state
   that works-first W2 combined mode and W4.1 evidence persistence had since
   been built behind the legacy-authoritative seam.
3. **VERIFIED — W2 is code-available without an implicit cutover.**
   `reviewer-identity-runtime.js` collapses unset/unknown modes to legacy,
   shadow returns the legacy result after bounded comparisons, and only
   explicit `combined` may adapt W2. Production call seams are
   `discovery/verification.js` and `contact-enrichment/tiers.js`; neither accepts
   a client mode.
4. **VERIFIED — durable binding remains partial.** Repo-wide import search found
   `capture-self-reported-orcid.js` as the binding writer's only production-
   service importer. The writer returns `downstreamEligible:false`; no shared
   action-policy reader exists. Wave 13 deployment therefore does not imply
   broad policy authority.
5. **VERIFIED — finding redesign remains evaluation-only.** The applicant-
   neighborhood pipeline is under `scripts/` and is imported only by evaluation
   tooling. Reviewer Track B remains dormant behind
   `lib/services/discovery/constants.js` `TRACK_B_ENABLED = false`; its retained
   code is not evidence of a live second origination lane.

## Resulting information architecture

- The compact routed memory owns only orientation, current boundaries, open
  gates, and prohibitions.
- `REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` owns live hard gates.
- `REVIEWER_IDENTITY_CONTACT_PLAN.md` owns W0–W4 mechanics and current W2/W3/W4
  status.
- `REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md` owns Wave 13 binding,
  evaluation governance, controlled pilot, and cleanup sequencing.
- Historical artifacts retain exact deployments, hashes, benchmark runs, and
  dated population counts.

## Invariants preserved

| Invariant | Verification |
|---|---|
| Unset/unknown resolver mode cannot enable W2 authority | `normalizeResolverMode` returns `legacy` outside explicit `shadow`/`combined`. |
| Shadow cannot replace the reviewer result | Runtime shadow path returns the already-settled legacy object. |
| Client cannot choose the resolver arm | Production callers invoke the server-owned runtime without a request/client mode. |
| Wave 13 does not imply downstream eligibility | Binding writer result is explicitly `downstreamEligible:false`; only the self-report capture service imports it. |
| Evaluation-only origination cannot leak into production | Applicant-neighborhood implementation and imports remain under `scripts/`. |
| Dormant reviewer Track B is not silently deleted | Code-level switch remains false; cleanup stays owner- and observation-gated. |

## Residual risk

Deployment environment values are external mutable state. This audit verifies
the fail-safe code default and tracked contracts, not the currently configured
Vercel value; re-probe the deployment before asserting whether it runs
`legacy` or non-authoritative `shadow`. The next substantive engineering risk
is not memory size: it is the still-unbuilt Wave 13 policy/backfill migration
and any eventual owner-approved `combined` or controlled-pilot activation.

## Sweep report

> Claim: the current reviewer holistic roadmap is reconciled across the repo,
> originally fixed in
> `.claude-memory/project-reviewer-holistic-redesign-parallel-build.md`.

Terms searched across live memory, docs, source, pages, scripts, and shared code:
`project-reviewer-holistic-redesign-parallel-build`,
`reviewer-holistic-applicant-neighborhood-seeds-v1`,
`REVIEWER_IDENTITY_RESOLVER_MODE`, `downstreamEligible`, and
`TRACK_B_ENABLED`.

Hits: **63 total → AGREE 58 / STALE 0 / HISTORICAL 5 / UNRELATED 0.** The
historical bucket consists of three dated review/audit references to the memory
and two Track B lines in the 2026-07-08 Fable audit. All live restatements agree
that W2 authority requires explicit `combined`, Wave 13 is not downstream-
eligible, applicant-neighborhood origination is evaluation-only, and reviewer
Track B is dormant but retained. Remaining STALE after the fix pass: **0**.

Relevant prior guidance: the durable-doc rule, `/sweep`, and the 2026-07-22
memory-health evidence triage required source verification and whole-repo
reconciliation rather than mechanical compression.

## Verification

- Active v2 manifest: frozen and valid.
- M1 assets: frozen and owner-approved; read-only plan remains 60 runs
  (30 baseline / 30 redesign).
- Focused source contracts: 4 test suites / 109 tests passed for the runtime
  seam, binding writer, active manifest, and M1 assets.
- Memory health: 97 advisory files, `oversize-routed: 0`, `stale-routed: 0`.
- Memory router, doc currency, symbol references, build-claim freshness,
  fact consistency, canonical pointers, agent wiki, docs catalog, and agent
  invariants passed; each available gate self-test also passed sequentially.
- The paid/network W2 evaluator was not rerun; this audit relies on the pinned
  2026-07-19 result and verifies its current frozen inputs/contracts rather than
  spending provider calls to reproduce an unchanged benchmark.
