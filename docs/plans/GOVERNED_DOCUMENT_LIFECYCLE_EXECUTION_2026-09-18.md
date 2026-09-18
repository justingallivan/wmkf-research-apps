---
title: Governed Document Lifecycle Execution Record
domain: architecture
kind: plan
status: active
summary: All stages 0–8 accepted locally for the document service decomposition; the refactor stages made no deployment or live-data changes. A later controlled rehearsal is recorded below.
owner: product-engineering
related:
  - docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_DECOMPOSITION_PLAN_2026-09-17.md
---

# Governed document lifecycle execution

Authorized locally by the owner on 2026-09-18. Branch:
`codex/document-lifecycle-decomposition`. Luna implements/reconnoiters/builds;
Sol reviews with fresh context for each stage; the orchestrator resolves stalls,
performs final review and owns acceptance. No push, deployment or schema change is authorized by this record. A separate
owner-approved controlled rehearsal may exercise explicitly listed disposable
fixture writes; the plan's stages and gates remain binding.

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
One correction round removed an accidental prefix re-export from the IA facade,
the unused original comparator, and a stale test header. The neutral hash leaf
intentionally still exports `GOVERNED_DOCX_HASH_PREFIX` for internal IA consumers
(now the upload-recovery module). Final verdict READY. Leaf SHA-256:
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


## Stage 6 — accepted (`c76703eb`)

Prerequisite commits `a76e5e3d` and `f21c0a5c` characterize committed-but-lost
activity creation/identity, attachment write/receipt, send intent, lease claim/
renewal and terminal receipt responses. Durable fixture patches preserve saved
state and enforce lease ownership; root tightened this harness to avoid a test
model erasing the very receipts it should recover. Intermediate activity restart
requires the first call to stop before transport, then reuses the external/ledger
identity. Two-attachment recovery preserves the completed prefix. Draft/unavailable
transport status stays uncertain. New material/session cases pass initial freshness
checks and fail after attachment work, before intent, renewal or transport.

All 103 final distribution tests passed against the original `a76e5e3d` facade and
the extracted code; root performed the temporary replay and restored the facade
byte-for-byte. Test SHA-256 is recorded below. Sol inspected the logs but did not
rerun them; those temporary logs do not embed source fingerprints themselves.

Moved five email-recovery helpers, whole prepare/send commands, and two history
functions into four modules. The 45-line original facade retains sixteen public
exports and its template alias. Recovery-before-liveness, final checks-before-intent,
lease renewal and transport uncertainty sequencing remain unchanged. Default
bindings and the Stage 5b writer location/policy remain unchanged.

Fresh Sol `01a0b5a4-3fe5-73f0-a270-8f73c132ee8b` approved runtime preservation and
required intermediate activity restart and final slot/material discriminators.
Fresh correction review `01a0b5ac-ac62-7c63-9c8a-0a2cf3eb37db` returned READY with
all five runtime hashes unchanged. Root checked imports, exact bodies/initializers,
public exports, the fixture semantics and actual command outputs. SHA-256:

- Facade: `d7070b3dcda4e41dc23194ee798ef20bf8ea15251a5960e760f12118f711bfa8`
- Email recovery: `a01fdae2b3a1580f901cdf5571683c227ff763092892dc64a3c4444353db44e4`
- Prepare: `e1adf871e2d13364ac9eb1f351abd7956c403627dd75be31e47fcc2e51fff7ab`
- Send: `1f9866d3a95d48d0a30b93bc32f1983f52f6d4fc9b4e81f0ce80be5c161411ec`
- History: `7d1c1f6a42a02ab70cb0140368d1434e4c16960f4b396cb5ba7860d83d504612`
- Final service tests: `2b01362ce0bfda23fdd478873c2b9451b604c3b86078bc755ef4d03158176b9d`

[VERIFIED via local outputs] Scoped nine suites / 256 tests before the two final
drift additions; final full 957 suites / 14,113 tests. All 17 gate/self-test pairs
ran sequentially and passed, plus migrations-manifest/docs-catalog, lint (0 errors /
104 existing warnings), types, canonical build, explicit undefined-name/import
checks and AST comparisons. All 172 original bodies/39 initializers match;
454 named imports resolved. Test-only corrections reran old/new service tests,
scoped lint and full tests; the approved runtime/build inputs did not change.
No live operations/deployment. Rollback: revert `c76703eb`; prior facade reads the
same persisted attempts. Next permitted stage: Stage 7 after Final T2/T8 prerequisites.


## Stage 7 — accepted (`a9d4b0e8`)

Prerequisite `03dd0ab2` adds exact populated Final status DTOs with Failed versus
Generating priority, milestone/superseded distractions, committed-current versus
pending separation, duplicate pending rejection and unknown authoritative states.
Read-purity spies forbid writes, AI, transfers, metadata, downloads and hashing.
The activation test pins the full ordered conditional source/Final/request changeset
and same-item/no-upload/no-copy behavior. All 75 prerequisite tests passed before
extraction; existing leadership actor, race and milestone checks remain intact.

Moved model constants/helpers, the single default dependency object, state reads/
verification and claim/activation helpers into four modules. Both commands remain
in the original facade with the registered REQUIRED actor creation seam and all
five public names. Root took over mechanical import/export cleanup to bound iteration,
removed unused imports and placed both distinct verification tuples in the model.
All 172 original bodies and 39 initializers still match after AST normalization;
516 named/default imports resolve. Explicit undefined/unused-name checks passed
on the five Final transition modules changed in this stage; this was not a
repository-wide unused-import check.

Fresh Sol `01a0b5be-e821-71d3-b395-445cddb26334` returned READY with no substantive
findings. Root inspected source, fixtures, actual logs and matching fingerprints.
Reviewed SHA-256:

- Facade: `89ae3d6e965308a1d230435415e9ff6c2ec568b428b8bc0e6a0c839ad9bbdf52`
- Model: `13e88730a1df9d5ab0a862bd6ef081712768e30179e5ed10cabe10de1c1d37e7`
- Dependencies: `2ddeae125317b4aa3824ba06c2fa1fcfb3ce50a7768a431cc1b145b0bfcdade4`
- State: `1925f0f4d77c04ad6278ce0b1de226bb3052e2b5b5aff3a6c28995fd951525b8`
- Claims: `5f38989bda99bb8d6441c4213709fdfc401ddfb86ad7adbfd479bedc5f81129f`
- Final prerequisite test: `dec49c5aef157a53cec2ddddf2e4115089ccdf5880b432170b1af3151d40b4cf`

[VERIFIED via local outputs] Scoped eight suites / 149 tests and full 957 suites /
14,121 tests passed. All 17 gate/self-test pairs ran sequentially and passed, plus
migrations-manifest/docs-catalog, lint (0 errors / 104 existing warnings), types and
canonical Turbopack build. Existing build tracing warnings remain. No live operations
or deployment. Rollback: revert `a9d4b0e8`; prerequisites remain valid on the old facade.
Next permitted stage: Stage 8 boundary enforcement, source headers and scoped docs.


## Stage 8 — accepted (`588fd382`, `7ed52a45`)

Prior accepted runtime: `a9d4b0e8` (receipt `2fcd405e`). Test prerequisite
`588fd382` adds the permanent AST boundary helper and thirty Jest cases; with
nine frozen public-contract cases, 39 focused tests pass. Root took over the
initial checker draft because its fixtures did not exercise the real checker
and some import/writer forms were missed. The replacement runs in ordinary
`npm test`, uses existing parser dependencies, and checks literal imports,
re-exports, dynamic imports, nested require, named/default exports (including
literal CommonJS objects), relevant transitive cycles, hash isolation and the
agenda-to-composition boundary. Nonliteral dependencies in scoped modules fail.

The scoped AST census preserves six physical create seams and six adapter
bindings across the migrated domains. Separate negative fixtures detect an
unregistered create call with unchanged binding counts and an added binding
with unchanged call counts. The existing global gate still enforces all nine
writers and actor policies. This bounded architecture check is not a general
JavaScript security scanner. Compatibility imports and the frozen public API
manifest remain intact; no package or lockfile changed.

Closure `7ed52a45` reconciles source headers, the service catalog, Application/
Request Document/Postgres Atlases and the historical retention-plan hash note.
Old facade paths remain valid public entry points. Historical release evidence
is retained; new physical-owner claims describe this local branch, not production.
Root's scoped restatement review preserved compatible wiki/actor-plan/site-visit
references rather than rewriting historical evidence. The source pass changes
comments/whitespace and removes two unused IA model import specifiers from a
module that remains imported; executable bodies and initializers are unchanged.

Fresh Sol `01a0b5d4-4e6b-7fa0-b9a0-4c882da46c97` approved the boundary helper,
negative fixtures, preserved contracts and cumulative scope. It required five
missing Pre-Site owner headers and correct IA/Pre-Site stage labels. Root added
the headers; Luna corrected the catalog and qualified Final ownership locally.
Fresh bounded Sol correction review `01a0b5da-1cd9-7710-9483-56a7f19ddcd8`
returned READY with no remaining issue. Root independently checked the actual
source diff, matching fingerprints and verification outputs.

Final reviewed fingerprints:

- Boundary helper: `e401d2a0bb8bfcbf73a57a45efb7db3073f2c8b68cff24b31cba0f0796bb78f9`
- Boundary tests: `c12083bdd012849b9868eac817ffebd27c3350813d952948f50f999d535bc983`
- Catalog: `06d4d5e1ba7e96ff0f3d9b3ffc9a7d325f41f332e7da9e7f554a701a02834e2b`
- Cumulative source/test/gate manifest: `d1685fb85ad2f8962217587d5929c301eb5f6963fd3f13eab17879c13103fae9`

The cumulative fingerprint hashes the UTF-8 concatenation of sorted lines
`<file SHA-256>  <relative path>\n` for the 49 changed files under `lib/`,
`tests/` and `scripts/` from baseline `a7cf2518` through `7ed52a45`.
Documentation and receipt updates are excluded from this source fingerprint.

[VERIFIED via local command outputs and root inspection] Full 958 suites /
14,151 tests passed, plus all 17 sequential gate/self-test pairs,
migrations-manifest, docs-catalog, types, lint (0 errors / 104 existing warnings),
canonical Turbopack build, named-import checks and agent symlink invariants.
The existing two build tracing warnings remain. Final comment/document corrections
reran the 39 focused tests, scoped lint, applicable docs gates and exact baseline
comparisons: all 172 original function bodies and 39 initializers match; 514
named/default imports resolve. The full tests/build preceded only the last
comment/document corrections; no executable behavior changed afterward.

No schema/migration, dependency lockfile, readiness/environment, cron, route,
UI behavior, live-system operation, push or deployment changed. Rollback: revert
`7ed52a45` and `588fd382` independently for closure/tests, then reverse the runtime
stage commits if required on an isolated branch. No persisted-data rollback is
needed for this source decomposition.

## Local completion and release boundary

All planned stages 0–8 are accepted locally. No migration stage remains to build.
User-visible behavior is intended to remain unchanged; the benefit is separated
ownership, smaller service entry points and permanent regression coverage for
future maintenance. Promotion remains a separate owner-authorized release action
under the existing campaign release strategy. No complete production smoke was completed. A separately owner-authorized controlled rehearsal was stopped after two Initial Assessment failures; its evidence is recorded below.

No production milestone entry was required: this branch has not shipped. The
optional claim-evidence pilot report was unavailable because its local state
could not be read; no observation row or inferred result was added. This advisory
report limitation does not replace or invalidate the passing required gates.


## Post-review hardening — 2026-09-18

The owner supplied Claude's independent READY review of `5f069b32` and requested
its three low findings be addressed plus a smoke-test suite. Change surface:
unused imports, test-only static boundary analysis and durable verification docs.
Entry point/consumer: Jest and future smoke operators. Persistence: no runtime
schema/data change; only this receipt, the handoff and smoke runbook are durable.

| Invariant | Changed surface | Verification |
|---|---|---|
| Runtime behavior/public contracts remain unchanged | Four unused import specifiers in three Pre-Site files | Strict unused-variable lint, baseline body/initializer comparison and mocked service/route tests |
| Separate lifecycle internals remain separate | AST edge classification | Cross-domain negative fixtures and same-domain/neutral-leaf positive fixture |
| Counts follow real adapter namespace imports and alternate calls | AST writer/binding census | Renamed namespaces, optional calls, call/apply, computed members, binding-only and unrelated-adapter fixtures |
| Migrated hash consumers retain neutral ownership | Explicit migrated-consumer inventory | In-domain and external-consumer regressions; other IA public API calls remain allowed |
| Local evidence is not a live smoke claim | Smoke runbook and receipt wording | Source-checked routes/side effects, recorded commands, live cases marked not run |

The Stage 1 wording now identifies the removed **facade** prefix re-export;
the hash leaf intentionally exports the prefix for IA recovery. The Stage 7
unused-name claim is explicitly limited to its five Final transition files.
The prior stage fingerprints/counts above remain historical evidence for their
named commits, not assertions about the later hardening diff.

Static-check limits remain explicit: literal imports and the recognized writer
forms are checked; arbitrary alias propagation, reflection, computed runtime
module names or namespace property names are not a general JavaScript proof.
Partial-success, async and enum-consumer production changes are N/A for this
follow-up because no executable function body or persisted contract changed;
the smoke suite exercises their existing contracts with mocked I/O. No new
route, migration, readiness flag or production action was introduced.

[VERIFIED via local command outputs and root inspection] Follow-up verification:
core smoke 18 suites / 478 tests; auth/route smoke 9 suites / 64 tests;
checker/public-contract subset 2 suites / 62 tests; full Jest 958 suites /
14,174 tests. Strict unused-name checks passed for the three runtime import files
and changed test helper/suite. Full lint passed (0 errors / 104 existing warnings),
as did types, the nine-seam Request Document writer gate/self-test, applicable
sequential document gate/self-test pairs, docs-catalog and agent invariants.
Baseline comparison still matches all 172 function bodies and 39 initializers.
No fresh canonical build was run for the earlier hardening follow-up; prior build
evidence above remains attached to the original refactor. The current restore fix
build is recorded in the later reconciliation section. The added
`docs/plans/GOVERNED_DOCUMENT_LIFECYCLE_SMOKE_TESTS_2026-09-18.md` records executable
local commands and staged operator checks, including the write-capable external
review-bundle GET. At hardening acceptance, browser/live checks were NOT RUN.
The subsequent read-only S1 subset, incomplete S2 rehearsal and bounded S2
service reconciliation are recorded in the smoke runbook; S3–S4 remain unrun.

Fresh Sol review `01a0b60a-83f7-74b0-a724-eebb7b1ceb1d` returned **READY** after
one bounded correction round. Its direct analyzer probes confirmed the expanded
cross-domain target check, distribution-only shared-helper allowances, namespace
hash detection and resolved adapter bindings; live source has zero boundary errors.
The smoke instructions now distinguish captured-request replay from another Prepare
click (which creates a new operation ID). Root accepted the corrected implementation,
negative/positive fixtures and actual final test outputs. Review-output SHA-256:
`241bc4c1751aec3e3004c216c2cc38ac27b952cd7fc5f266fd31ec33c9d5aaf0`.
Checker diff SHA-256 (UTF-8 `git diff --` for the helper and its unit suite against
`5f069b32`): `3f9d7f8d4ec60ccfbcb8e408868fc4821680bcd7b0478718a8a4e99dfe74fda2`.


## Controlled rehearsal attempt — 2026-09-18

[VERIFIED via `/tmp/wmkf-document-rehearsal-before.json`, `/tmp/wmkf-document-rehearsal-after.json`, `/tmp/wmkf-restore-readback.json` and sanitized local logs] The owner-authorized loopback rehearsal used request `1003222 / ZZTEST-03` (`e43ae6ea-698f-f111-8076-6045bd018a07`) and was stopped before any downstream stage. IA generation returned HTTP 500 `claude_output_truncated` (`max_tokens=2200`) for run `7d8b647c-abb3-f111-aaac-000d3a361c1f`; it created one Failed row `ea6e4768-abb3-f111-aaac-6045bd04539e` with no SharePoint item. The request and 24 pre-existing Dataverse Request Document rows were unchanged, and the 13 distribution attempts were unchanged; the SharePoint restore effect is recorded separately below.

The second attempt selected IA version 1.0 from current 2.0. Graph restore succeeded, but the API returned HTTP 500 `initial_assessment_restore_bytes_mismatch` before registry metadata persistence. Final readback shows current version 3.0 stable, historical 1.0/2.0 preserved, and matching governed hashes `gdc1:yGi7ISeqZspD0PwIecM9bbGPZQhn7hJpEV_k6Qgv4Yk`; raw package bytes differ only in custom XML/properties and trash parts, with no Word body-part changes. Registry metadata reconciliation was not confirmed and no rollback was attempted.

The backend and proxy were stopped. The process-only proxy used the reviewed interlock-on target and dated ACK; no environment file was changed. No Pre-Site generation/reopen/start-site-visit, distribution prepare/send, email, Final transition or leadership request ran. The earlier S1 read-only smoke is separate historical evidence and is not upgraded by this attempt. No retry was attempted during this stopped run; the later bounded reconciliation below resolved the registry metadata.


## Restore reconciliation — 2026-09-18

[VERIFIED via `/tmp/wmkf-ia-restore-reconcile-applied.json`, `/tmp/wmkf-restore-registry-before.json`, `/tmp/wmkf-restore-registry-after.json`, `/tmp/wmkf-restore-reconciled-graph.json` and process logs] After the initial browser restore mismatch, root invoked the public restore service with the original payload under a five-minute PATCH-only grant. The wrapper prohibited Graph restore and allowed one exact update for artifact `a6876ad6-3b94-f111-8075-70a8a59cded0`. The service returned `restored:false`, `reconciled:true`, target `1.0`, with one registry update and zero Graph restore calls.

Independent readback showed the request projection unchanged, 25 Request Document rows before and after, only the existing IA row's captured version/etag/modified time changed, the other 24 captured rows unchanged, and all 13 distribution attempts unchanged. Graph readback at 22:23:44Z confirmed the same item, stable current version 3.0, preserved 3.0/2.0/1.0 history and the same governed hash as version 1.0. The recovery process and wrapper exited 0. Sol returned READY and root accepted the bounded recovery. This is not a global database audit, and the browser restore was not rerun after the service fix; S2 remains incomplete and S3–S4 remain unrun.

[VERIFIED via local outputs] Restore-focused validation after the fix: 4 suites / 42 tests passed, including controls, governed-hash and restore-route coverage; strict scoped lint, request-document writer gate/self-test, Dataverse access gate/self-test, types and canonical build passed. Logs are `/tmp/wmkf-restore-fix-integration-tests.log`, `/tmp/wmkf-restore-fix-lint-final.log`, `/tmp/wmkf-restore-fix-writer-gate.log`, `/tmp/wmkf-restore-fix-writer-self-test.log`, `/tmp/wmkf-restore-fix-dataverse-gate.log`, `/tmp/wmkf-restore-fix-dataverse-self-test.log`, `/tmp/wmkf-restore-fix-types.log` and `/tmp/wmkf-restore-fix-build.log`; all recorded exit files are 0.

## Controlled smoke continuation — 2026-09-18

[VERIFIED via `/tmp/wmkf-smoke2-build.log`, `/tmp/wmkf-smoke2-board.json`, `/tmp/wmkf-smoke2-prepare-blocked.json`, `/tmp/wmkf-smoke2-reopen-blocked.json` and sanitized environment classification] Isolated candidate `f45581ed` built successfully with 269 route rows. Board snapshot returned row `dc7558c4-b2b3-f111-aaac-7ced8d3c3a59` for IA artifact `a6876ad6-3b94-f111-8075-70a8a59cded0`, version `3.0`, governed hash `gdc1:yGi7ISeqZspD0PwIecM9bbGPZQhn7hJpEV_k6Qgv4Yk`, and distinct item `01G4GVMS5XTETQIS3JPNEIXAKRDZPRBY35`; no AI was invoked; the distinct Board snapshot action created the recorded downstream item.

Distribution prepare then returned 503 `distribution_briefing_required` for operation `061f25d7-b0c1-40d7-8c1e-18f1e098d6c6`; no send was attempted, and the 26-document projection plus 13 distribution attempts were byte-identical. Guarded PSV reopen returned 503 because `GUARDED_REOPEN_SCHEMA_READY` was unset; its request/document/attempt readback was unchanged. The distribution dependency requires exact `DELIBERATION_BRIEFING_SCHEMA_READY=on` and migration 038 before its write-capable link minting helper may run; migration 038 is present in source and the manifest, but no live schema probe or flag change occurred. The owner must first verify whether migration 038 is already applied, apply it only if missing and separately authorized, then verify readiness before retrying. These are owner/configuration blockers, not bypass candidates.

The earlier blocked attempt used `NEXTAUTH_URL=http://localhost:3000` before the public-link override; that historical configuration could not produce a usable external rehearsal link. The current supported public-link configuration is recorded in the S3 continuation below. The backend and proxy were stopped cleanly with SIGINT (exit 130); Final and leadership were intentionally deferred to preserve the reopen order.

## S3 controlled email continuation — 2026-09-18

[VERIFIED via `/tmp/wmkf-email-smoke-send-blocked.json`, `/tmp/wmkf-email-smoke-sent.json`, `/tmp/wmkf-email-smoke-before.json`, `/tmp/wmkf-email-smoke-after.json`, browser UI and sanitized process logs] On code `cbad8a8d`, prepare succeeded for operation `871e75b4-e7b1-4fdf-92a7-62c83abc7c3b`, source artifact `c5d81d74-b7b2-f111-aaac-002248086b29`, sole recipient `justingallivan@me.com`, no Cc/Bcc, and calendar disabled. Existing briefing link `63431ae5-7fad-4eab-9e5b-5e6f89e64520` was reused.

The first send failed closed with 503 `distribution_impersonation_required` before ledger claim. After the approved process-only `DYNAMICS_IMPERSONATION_ENABLED=true` setting was present, the same prepared preview was retried once and returned HTTP 200; the UI showed `Sent for delivery`. Ledger readback shows `sent`, attempt count 1, Dynamics email `f78b4b7c-b6b3-f111-aaac-7ced8d3c3a59`, initial status 6 and later status 3 with `senton` (`/tmp/wmkf-email-smoke-delivery-check.json`), one correlation match, approved sole recipient, no Cc/Bcc, and sender `jgallivan@wmkeck.org`. This proves transport acceptance, not inbox delivery; inbox confirmation remains pending.

Request and 26 Request Document rows were unchanged; 13 prior distribution attempts remained unchanged and the total became 14. The public briefing link rendered correctly over HTTPS. Process-only briefing readiness, public-base override, and impersonation settings were used; local `NEXTAUTH_URL` remained unchanged. Migration 038 was already verified and no migration ran. Backend and proxy stopped with SIGINT (exit 130). PSV reopen remains readiness-blocked; Final and leadership remain deferred/unrun.
