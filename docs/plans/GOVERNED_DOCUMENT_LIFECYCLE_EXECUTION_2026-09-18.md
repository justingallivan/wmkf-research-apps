---
title: Governed Document Lifecycle Execution Record
domain: architecture
kind: plan
status: active
summary: Local execution receipts for the authorized document service decomposition; no deployment or live-data changes.
owner: product-engineering
related:
  - docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_DECOMPOSITION_PLAN_2026-09-17.md
---

# Governed document lifecycle execution

Authorized locally by the owner on 2026-09-18. Branch:
`codex/document-lifecycle-decomposition`. Luna implements/reconnoiters/builds;
Sol reviews with fresh context for each stage; the orchestrator resolves stalls,
performs final review and owns acceptance. No push, deployment, schema or live-data
write is authorized. The plan's stages and gates remain binding.

## Contract and invariants

Change surface: four document lifecycle services and their existing hash consumers.
Entry points: existing Workbench artifact, distribution and Final routes; internal
Brief/Meeting Tracker consumers. Persistence remains existing Dataverse registry and
pointers, SharePoint files, Postgres distribution ledger and Dynamics email activity.
Consumers remain existing routes, UI, service callers and enforcement gates.
Prior findings: P1/P2/P3 planning corrections recorded in the linked plan.

| Invariant | Owned surface | Verification |
|---|---|---|
| Existing public API and route projections unchanged | Four facades, internal extractions | Frozen export census, real-route contracts, existing regression suites |
| DOCX identity and error semantics unchanged | Neutral hash leaf and ten consumers | Frozen digest fixtures, malformed-package tests, normalized function-body comparison |
| Separate replay/claim/recovery semantics preserved | IA, Pre-Site, distribution, Final | Domain-specific prerequisites before moves; ordered effects and failure cases |
| Same actor policies and nine create seams | Existing writer registry plus one planned path move | Writer gate and negative self-tests at every stage |
| No hidden behavior or deployment changes | Entire branch | Diff review, full tests/types/lint/canonical build, fresh Sol review |

## Stage 0 — accepted (`7a2ed504`)

Base: `f5633ae4`; runtime baseline `a7cf2518`, unchanged by the preceding two docs
commits. No runtime file or symbol moved. The new public-contract suite pins IA's
10 exports, Pre-Site's 9, distribution's 16 and Final's 5; preserves error-class
identity and explicit dependency overrides. Four nonempty real route/default-service
cases cover IA failed-artifact retry projection, Pre-Site staff correction stripping,
Final source/pending projection with session-based PD authorization, and history's
trimmed query/legacy sent-attempt projection. External I/O is mocked; facades are real.

Sol `sol_stage0` round 1 required real-route and default dependency coverage. Root
completed those tests to bound iteration; round 2 returned READY for the test contract.
Reviewed test SHA-256:
`c2724f52a7b4878e222517eb129bef1eb9b259375258c2ba8adae97c7958a279`.
Root independently inspected routes/services/mocks, ran the 9-test suite and scoped
ESLint, and confirmed no runtime diff against `a7cf2518`.

Baseline source SHA-256 (four service files in plan order):

- IA: `b1a7d80cbe7058f7f312ba34489bad1276526e72ad9c7573cd3260c098eff9ae`
- Pre-Site: `1fc99284af4cdeb2ed6e1a9f192fb9d7f9675b2886c3c2d95cba9763cc57a3da`
- Distribution: `1f18df35c47c5a88631981ea0d2bed3e99757f9674f879bbf37ac969d6ed53d4`
- Final: `a264bbfef0563dbaf93d6ba91508992cee5f570872c4dc4193edc5f0ec52951b`

Writer census: nine rows in the gate's WRITERS array. IA artifact, Pre-Site artifact,
applicant-material contributor, consultant-feedback attachment and Pre-RP Brief use
ALLOW_UNATTRIBUTED; IA controls, Pre-Site reopen/distribution and Final use REQUIRED.
The physical create paths are unchanged. The header's older count is not authoritative.
Hash census: the IA definition plus ten external consumers listed in plan Stage 1.
Agenda is the sole external recipient-normalizer importer. Existing core inventory is
the 12 suites in plan §12; all were included in the full baseline run.

Deferred prerequisite obligations: T1 frozen expected hash values before Stage 1;
T2–T8 additional read/failure/recovery/transport characterization before their assigned
stages. Existing suite names alone do not discharge these cases. T9 export half is
implemented here; AST import/cycle enforcement and its negative fixtures remain Stage 8.
The new send/history route-specific suites remain required before distribution moves.

Verification so far: core 6 suites/249 tests, initial full 955 suites/14,070 tests;
lint 0 errors/104 existing warnings; types and canonical Turbopack build passed.
All 17 plan runtime gate/self-test pairs passed sequentially, plus migrations-manifest
and docs-catalog. Root inspected gate logs. Build had existing dynamic filesystem
tracing warnings; no fallback used. Final full suite after corrected tests passed:
955 suites / 14,075 tests, exit 0. Pre-Site source checks accept persisted envelope
versions 2/3/4 and write version 4; no serialization changes were made.
Logs are local temporary evidence; this receipt retains conclusions and fingerprints.
Rollback: revert Stage 0's test-only commit; no runtime/data rollback required.
Next permitted stage: Stage 1, after T1 prerequisites are added and pass on old code.
