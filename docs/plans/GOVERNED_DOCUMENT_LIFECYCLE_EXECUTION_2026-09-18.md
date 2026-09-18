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


## Stage 3 — accepted (`2f7668b6`)

T3 prerequisite commit `fbede538` added fixed ordered effect traces for Ready reuse,
reactivation, fresh generation and governed-hash recovery; 62 IA tests passed before
extraction. Existing tests cover lost changeset responses, competing Ready/wrong
pointer, newer claimant/412, exact losing-upload cleanup and overflow.

Moved eleven lineage/claim functions and three upload-recovery functions into
`artifact-lineage.js` and `artifact-upload-recovery.js`. Generation remains in the
original facade with the same creation seam, actor policy and ten public exports.
Root caught two missing/incorrect imports during implementation; Luna corrected them
and reran scoped tests. Explicit undefined-name lint now supplements ordinary lint.

Fresh Sol session `01a0b548-8284-7a23-ae86-8fb63b8bb601` returned READY with no
findings. Root read the new modules, checked bindings, matched reviewer fingerprints,
and verified the baseline comparison still preserves all 172 function bodies and
39 declaration initializers. Reviewed SHA-256:

- Facade: `758d555b42ff02901366f1cc9511fee36bd0e0a6156f4504614a844cc9bae945`
- Lineage: `6a5f6ce15c08167caf740e9ca25ea4000be1eb252a418ece02dd170dbbc0bd4d`
- Recovery: `d076600917bbc96a79833f9b9c0aecc42c9a5dc937f91bb5d0cb2e0c1026e3c4`

[VERIFIED via recorded local command outputs] Full 955 suites / 14,078 tests,
all 17 gate/self-test pairs sequentially, migrations-manifest, docs-catalog, types,
lint (0 errors / 104 existing warnings), explicit undefined-name check and canonical
Turbopack build passed. Root inspected actual logs and zero exit codes. No live
operations or deployment. Rollback: revert `2f7668b6`; test prerequisites remain valid.
Next permitted stage: Stage 4 after T2/T4 prerequisite review on the old PSV code.


## Stage 4 — accepted (`569ab797`)

Prerequisite `db533d3d` pinned generation/recovery order and complete Ready-read
purity. Root removed duplicated mock labels before committing. Sol's first fresh
review (`01a0b554-fcc3-7bd3-bb5e-148edb55bd62`) approved runtime preservation but
required populated reader fixtures and genuine paired historical envelopes.
Luna added seven cases in `d7e8fb73`; root replayed all 52 PSV tests against the
original `2f7668b6` facade and restored the extracted facade byte-for-byte.
Root then fixed deterministic fixture dates and omitted the v4-only referee field
from v2/v3 snapshots. Both old and extracted implementations pass all 52 cases.
Fresh final Sol session `01a0b563-2ffc-7052-980b-80cc1f47f152` returned READY for
the exact remaining correction, retaining its prior runtime approval.

Moved model, one dependency-default object, status reader, claim/lineage and upload
recovery into five modules. Generation and nine public exports remain at the old
facade, with the same registered create seam and actor policy. Pre-Site's refusal
of stale Ready replay and correction-cycle/pointer fences remain separate from IA.
Root checked imports, preserved bodies/initializers, error identity and final hashes.
A temporary static named-import audit supplements no-undefined lint because the
scoped happy paths initially missed a cleanup helper imported from the wrong owner.
That binding was corrected before full verification and Sol's runtime fingerprint.

Reviewed runtime SHA-256:

- Facade: `2127dee1d1d8e7d1b8c77553632f74f555b0583da137309e04eee6abff443acb`
- Model: `c8241eb42e6e289e0418c5a9773a1ea7cb10eaefafa8e2a729d7924962bcf7f7`
- Dependencies: `8469964f756dfa32ba0191841d32e4dc5029b7bf91f24185e1b8f3f0736343a0`
- Reader: `bd166f6fbeebed4b081f232b28e47bd337de1d380db80d89271567a65db4a601`
- Lineage: `8bd0325b65becc6c2b4efd8b5ac699acb9a4b9b06d3cde46a1f12fa5bfbf3cff`
- Recovery: `39a7a75a64a790966f7d1183913ea1195e3e89228bb3dedf779ec35f0558f7ed`
- Final prerequisite test: `c382575e054961132e604cb1a590e3b68923dad5cffb5339fbf57f838db53872`

[VERIFIED via local outputs] Scoped eight suites / 179 tests passed before the
seven added cases. Final full suite: 955 suites / 14,085 tests. All 17 gate/self-test
pairs sequentially, migrations-manifest, docs-catalog, types, lint (0 errors /
104 existing warnings), canonical build, explicit undefined-name/import checks and
AST comparisons passed. The final fixture-only corrections were rerun on both old
and new code; runtime did not change after its full gates/build. Root inspected
actual outputs, zero exits and matching fingerprints. No live operations/deployment.
Rollback: revert `569ab797`; prerequisite tests remain valid on the old facade.
Stage 5a route prerequisites are separately committed as `e3d4826f`: six suites /
152 tests, including real history GUID rejection, method/auth/error contracts and
session-derived send identity. Next permitted runtime stage: Stage 5a.


## Stage 5a — accepted (`d673afc6`)

Prerequisites `e3d4826f`, `79820911` and `170d9dd0` pin send/history route
contracts, rejection of legacy modes during new preparation, and real saved-calendar
send with exact regenerated bytes, hash/size, Dynamics attachment and ledger receipt.
The final 95 distribution/history cases passed against both the original facade
and extracted code; root restored and verified the extracted facade byte-for-byte.

Moved model, composition, one default dependency object and context into four modules;
agenda imports recipient normalization from composition. Prepare/send/history/retention
remain in the original facade, with all 16 exports and the same creation seam.
Root caught and restored two accidentally shortened catch bindings before acceptance;
all 172 function bodies and 39 declaration initializers remain exact after AST
normalization. Named-import audit checked 410 bindings; explicit no-undefined lint passed.

Fresh Sol runtime review `01a0b579-0839-7042-8464-b88d2a3d54cf` approved preservation,
requiring the two test corrections above. Fresh bounded correction review
`01a0b582-ee13-7242-9d6a-c41099629928` returned READY and verified all six runtime
fingerprints match. One earlier review session drifted into delegation and was stopped;
its incomplete output was not used as approval. Final runtime SHA-256:

- Facade: `75cfedfc77d336289cdd334f111e99b2767a42e7ca540807030d2af17043c2f3`
- Model: `d9a2cb07cb553c47f562a406a67da22b12492952a79bc308d2a7a222fefded13`
- Composition: `022c9b64cd79419cf900bc19e554685fe08f567555f639b3ed0655eb946dec5c`
- Dependencies: `cf8952472d38569a74aeb0a5b83fc7e21533c3f6a8f39b725a81c543688a7058`
- Context: `720d73b4e72580cc91e82ce410428268375e2635af7a1f9ffeeb711372b6ba73`
- Agenda: `273982498364e918d6ee6b6164fd956c4152623c3f48d1dbbfb77547fa4aa744`

[VERIFIED via local outputs] Final full suite: 957 suites / 14,100 tests (includes
one staged Stage 5b real-retention prerequisite). All 17 gate/self-test pairs ran
sequentially and passed; migrations-manifest, docs-catalog, lint (0 errors / 104
existing warnings), types and canonical build passed. After root's catch correction,
scoped tests, types and canonical build passed again; after test additions, old/new
scoped tests, test lint and full tests passed. Root inspected outputs and zero exits.
No live operations/deployment. Rollback: revert `d673afc6` as one unit, including agenda.
Next permitted stage: Stage 5b after committing its real-retention consumer prerequisite.


## Stage 5b — accepted (`555a7bda`)

Prerequisites `cb549a1f` and `9d795a85` exercise the real briefing consumer through
bundle assembly/retention and refuse an unknown divergent item already occupying
the deterministic snapshot path. The latter's 91 service cases passed against
both the original Stage 5a facade and extracted code; root restored the facade
byte-for-byte. No upload, delete, Ready transition or owned identity for the unknown
item is accepted. Existing tests cover normalized DOCX versus exact PDF/ICS bytes
and interrupted upload finalization.

All twelve assigned functions moved into `distribution/retained-snapshot.js`.
The original facade keeps the positional `retainReviewBundle(args, dependencies,
actor)` export. Only the distribution writer registry path moved; the default
adapter binding, REQUIRED policy, bounded actor context and other eight writers
remain unchanged. Added missing/moved writer, duplicate call/binding, wrong-policy
and missing-context self-tests. Root corrected fixture targeting and caught a
missing compatibility export before acceptance. Atlas ownership is local-source
verified, explicitly not a deployment claim.

Fresh Sol `01a0b58c-fa5f-7363-ae55-648980aa01f4` approved exact runtime/gate
preservation and required the unknown-path fixture plus Atlas date correction.
Fresh correction review `01a0b595-c320-7752-bba7-45af3462db23` returned READY,
matching the unchanged runtime/gate fingerprints. Root inspected moved ownership,
imports, tests, writer fixtures and logs. Reviewed SHA-256:

- Facade: `43a6b6ac3da43c1cd592a4d252f6cf5053830c1906632e4fa52e1c9508d565b2`
- Retention: `4b25b714e3b93df4254fe57b4959bd826b865737d093b2806e44a1ca1e543729`
- Writer gate: `a37c67839c21f1a6f627d411c850ad97ebbc179977d64bcc0b68f8fc14893d96`
- Final service tests: `ed375fb1d0beede27bdbb9d6ac70b316467982a4ef39dbe80ff381e20d3811d6`
- Atlas: `9eb6fa0d881ecc357f3ea3b2e64eb1377124da1958741eb5f7ab6103615e6221`

[VERIFIED via local outputs] Scoped 4 suites / 160 tests, separate bundle suite
26 tests, final full 957 suites / 14,101 tests, all 17 gate/self-test pairs
sequentially plus migrations-manifest/docs-catalog, lint, types, canonical build,
explicit undefined-name/import checks and AST comparisons passed. Baseline lint
warnings remain 104; existing build tracing warnings remain. Final fixture/date
correction reran old/new focused tests, test lint, full tests and scoped docs gates;
reviewed runtime/gate/build inputs did not change. No live operations/deployment.
Rollback: revert `555a7bda` as one unit including physical writer registration.
Next permitted stage: Stage 6 after its persistence/transport restart prerequisites.
