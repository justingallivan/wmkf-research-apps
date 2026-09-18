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


## Stage 1 — accepted (`8a7060b9`)

Prior accepted stage: `7a2ed504` (receipt `59dd9157`). Test-only prerequisite commit
`c58237c4` froze the base/normalized fixture and two shipped-template digests and
added unknown hash-scheme recovery. Sol approved; root independently ran 3 suites /
70 tests against the old implementation before permitting extraction.

Moved ten hash functions and two constants into
`lib/services/documents/governed-docx-hash.js`; retained the old facade's hash export
and internal prefix import. Ten external production consumers now import the leaf;
the individual-file mock follows its actual dependency. Crypto remains in IA for
non-hash identity/UUID use. Writer registry, routes, schemas and persisted values
are unchanged. New-leaf assertions use the frozen value, not only wrapper parity.

Sol `sol_stage1` reviewed the prerequisite and extraction with fresh stage context.
One correction round removed an accidental public prefix export, the unused original
comparator, and a stale test header. Final verdict READY. Leaf SHA-256:
`576b4c59626b4ee082d190dea9ffc9292fd0767527daad59f27ebe8972d46e8a`;
IA facade SHA-256:
`7c57919dbd8938f94531096b661ee94f27c5d9e6b353ded9f809d53685735a40`.
Root inspected imports/exports and test changes, verified all 172 original function
bodies and 39 declaration initializers match after AST normalization, and checked
command logs/exit codes. These comparisons do not replace binding/behavior review.

Verification: scoped 3 suites / 104 tests; full 955 suites / 14,076 tests; lint
0 errors / 104 existing warnings; types, canonical Turbopack build, all 17 gate/self-test
pairs, migrations-manifest and docs-catalog passed. Gates and self-tests ran sequentially.
An initial prose-only receipt was insufficient; Luna reran with individual outputs
and an exit-code index, all zero. Root inspected the recorded results before acceptance.
No live calls, deployment or data changes. Existing build tracing warnings remain.
Rollback: revert `8a7060b9` as one unit; frozen prerequisite tests remain valid.
Next permitted stage: Stage 2 after its T2 coverage review and any missing prerequisites.

Review transport: the subagent tool reached its task limit after Stage 1. On
2026-09-18 the owner explicitly approved fresh Sol reviews via local Codex CLI,
using ChatGPT login and sending relevant source/plans to ChatGPT/Codex. Subsequent
reviews use fresh read-only sessions with provider API-key variables removed.
The first attempt was rejected by automatic approval review pending this explicit
consent; no fallback review ran before consent.


## Stage 2 — accepted (`e4c10355`)

Prior accepted runtime: `8a7060b9` (receipt `b4507f7c`). Fresh Sol prerequisite
review required a composite exact DTO fixture and complete read-purity assertions.
Luna added these in test-only commit `de875d68`, with populated Ready/newer Failed/
Board/superseded records, malformed cleanup and unknown registry values, metadata
failure/deadline guards, and suite-wide version-history write/AI/folder/upload/delete
assertions. Two suites / 73 tests passed on the old code; broader pre-move regression
scope passed 8 suites / 129 tests. Root inspected the actual fixture and assertions.

Moved 14 functions and eight constant/select declarations into the model and reader.
The original facade retains generation, crypto UUID use, its registered creation seam
and all ten public names. Controls and routes keep their facade imports; direct
adapter/Graph test seams remain effective. No persistence or user-flow change.

Fresh read-only Sol session `01a0b536-fe87-7a52-89a8-46298d155488` returned READY.
It independently verified exact moved declarations, no duplicate definitions or
static import cycles/back-imports, consumer bindings, and the resolved prerequisites.
Root checked matching fingerprints, import bindings, complete function/declaration
comparisons and actual exit logs. Runtime SHA-256:

- Facade: `2256aee106619fadccdaa4e517f9108b6db1f4ad6e372afa90abf8c3485a87b8`
- Model: `59e236c3e2ee75f65e0dfa7ec82f188ad90f6fa32c3f2bbd0993a01dbc7a554b`
- Reader: `58202f73d13f323fd5c22d72c284af3e5455299eada3c356c85a2cc1ae5d77a4`

Verification: full 955 suites / 14,078 tests, all 17 gate/self-test pairs sequentially,
lint (0 errors / 104 existing warnings), types, migrations-manifest, docs-catalog
and canonical build passed with recorded zero exit codes. Parent's comparison still
finds all 172 original function bodies and 39 initializers unchanged. No live-system
operations or deployment. Rollback: revert `e4c10355`; prerequisite tests remain valid.
Next permitted stage: Stage 3 after T3 prerequisite mapping/additions pass.
