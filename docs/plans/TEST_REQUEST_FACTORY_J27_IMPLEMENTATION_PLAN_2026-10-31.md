---
title: "Test Request Factory: J27 implementation plan"
domain: test-request-factory
kind: plan
status: active
summary: "J27 AI-input document handling built and Fable-approved on branch; submitted/peer-review lifecycle presets and live rehearsals remain held for Connor."
owner: product-engineering
related:
  - docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md
  - docs/POWER_AUTOMATE_PROPOSAL_FILE_CONTRACT.md
  - docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md
  - docs/atlas/postgres-test-request-runs.md
  - docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md
---

# Test Request Factory: J27 implementation plan

## Status and authority

**[PLANNED — lifecycle work awaiting owner and Connor review, 2026-10-31.]** Justin requested
read-only research followed by this implementation plan, explicitly covering
both newly submitted and advanced-to-peer-review starting points. The owner subsequently authorized the document-handling slice and a Fable build
review. Status operations and live rehearsals remain on hold until Connor is
available. No test Request creation, email, provider work, deployment, cleanup
or live migration is authorized.

**[VERIFIED via Git/source review]** Research used worktree
`/private/tmp/wmkf-session-657-codex`, branch `codex/session-657-start`, base
`6ce1ec21a2448d38c4afe1e5c0c603d6277d06c1`. The Factory modules, filename helpers,
and CLI entry points reviewed had no differences from the observed `origin/main`
tip `5b84b70e26475b2317520ce1e1eef54cf6d0c689`. The alignment log was also read
from `origin/main` because that document had advanced. Claude owns the main
checkout; this plan is isolated here and does not update Claude's handoff or plans.

Evidence labels: **VERIFIED** means source or offline evidence named below;
**PLANNED** means proposed work; **UNKNOWN** means an unresolved external
contract. Historical deployment/probe claims in older plans are not fresh live
evidence. No live Factory, schema, flow, or deployment probe was run for this task.

## Objective and boundaries

**[PLANNED]** Extend the existing admin Factory so a superuser can create a
marked J27 test Request from an approved source and choose one of two starting
points. Reuse the existing run engine, private artifacts, managed ledger,
synthetic contacts, and scoped write fences. Prefer two presets on the existing
Basic recipe over new recipe tokens unless implementation evidence requires them.

Keep destination cycle, document layout, and starting state explicit and distinct.
A J27 cycle link alone must not imply J27 documents or workflow readiness. Source
cycle/layout and destination cycle/layout may differ; cross-layout conversion
must be explicitly supported or refused, never guessed from the cycle picker.

Out of scope: rebuilding GOApply or Connor's flows, reproducing every historical
AI run, automatically creating reviewers or generated writeups, enabling paid AI
processing, expanding the sandbox-only recipes into production, repairing old
stopped runs, or deleting fixtures. D26 behavior and existing retained runs remain
supported. Test file contents are not anonymized by renaming them.

## Research baseline — before the document implementation

| Claim | Entry point / producer | Persistence | Consumer / evidence | Status |
|---|---|---|---|---|
| Admin can select J27 when its destination calendar row has a valid Board date | `admin-run-service.js` export/confirm; `basic-clone-steps.js` destination-cycle resolvers | Grant Cycle bind in create body and manifest | `cloneCycleFromCalendarRow`, clone readback, `test-request-grant-cycle-link.test.js` | VERIFIED; no new cycle picker needed |
| Admin source lookup exports a bundle; Confirm reserves; Advance drives bounded steps | `runs/source.js`, `runs/index.js`, `runs/[runId]/advance.js`; `admin-run-service.js` | Private Factory Blob bundle/manifest; managed Factory run/resource ledger; Dataverse Request; SharePoint files | Run panel/inspect and terminal verifier | VERIFIED; source lookup itself saves a draft, so it is not an entirely read-only operation |
| Discovery and copy planning recognize D26 names, not the J27 aliases | `admin-preview-service.js` `DOCUMENT_SPECS`/`classifyDocument`; `file-plan.js` | Saved bundle document inventory and manifest file plan | Admin and CLI exporter; `planBundleFileCopies` | VERIFIED by source and offline reproduction |
| An empty recognized inventory is accepted | `source-bundle.js` `projectDocuments` | Bundle `documents: []` | File plan and source summary can have no copied files | VERIFIED; absence of discovery errors does not establish completeness |
| Production creation requests `Phase II Pending`, but readback also accepts `Pending` | `policy.js`; `basic-clone-steps.js` `compileBody`; `sandbox-clone.js` | `akoya_requeststatus` | `verifyCloneRequestReadback` | VERIFIED; current ready is not proof of either new preset |
| Existing status operation changes phase picklists only | `status-change-runner.js`, `status-transitions.js` | `test_request_status_changes`; `wmkf_phaseistatus` / `wmkf_phaseiistatus` | Status controls, effects observation, resume/recheck | VERIFIED; SQL field CHECK and integer target cannot simply journal arbitrary request-status text |
| Production permits Basic only; richer built recipe paths are sandbox-bound | `buildCloneManifest`; `run-runner.js` recipe orders | Manifest/ledger recipe | Runner and sandbox dependency builders | VERIFIED; do not widen as an incidental J27 change |
| Saved source and execution plans have compatibility contracts | `source-bundle.js` supported versions 2–5; `basic-clone-steps.js` bundle/plan digest checks | Private artifacts and immutable reservation identity/digests | Resume, inspect, final verification | VERIFIED; preserve original interpretation |

Source paths above are under `lib/services/test-requests/`; route paths are under
`pages/api/admin/test-requests/`. Durable state ownership is documented in
`docs/atlas/postgres-test-request-runs.md`; actual provisioning remains unprobed here.

## Two starting-point contracts

The following are **[PLANNED]** acceptance contracts, based on the owner's choice
of both starting points and alignment decisions D27, D31, D35, D39, and D41.
Phase II remains an internal advancement, not a second applicant submission.

| Requirement | Newly submitted | Advanced to peer review |
|---|---|---|
| Request Status at completion | Exactly `Phase I Pending` | Exactly `Phase II Pending` |
| Phase I Status | Connor must confirm the arrival value; do not invent it | `Invited` (100000003), verified against live metadata before use |
| J27 staff state | Submitted if the new field's contract is established and this preset must populate it; otherwise expose the limitation and block any claim of triage readiness | Use the authoritative derived state where applicable; do not invent a second stored value for Invited for Peer Review |
| Cycle | Exact selected operations Grant Cycle lookup; no inference from source meeting date | Same |
| Files | Agreed J27 processed inputs and staff-readable package; minimum required set settled with Connor | Same single-submission inputs plus the exact reviewer package required by current invitation/materials readers |
| Reviewer records, review history, generated IA | Not automatically created; explicitly absent unless separately scoped | Not automatically created; peer-review-ready means ready for deliberate reviewer setup/invitation, not already reviewed |
| Completion | Exact state, required documents, identity and isolation verified | Same, including reviewer-package readiness; calendar prerequisites reported or required according to the agreed preset contract |

Do not return ready for either preset merely because create returned `Pending`.
Do not create, request, or simulate a second proposal submission to advance it.
Do not set the files-ready flag to claim unperformed processing is complete.

## Decisions and evidence needed from Connor

**[UNKNOWN unless identified as an existing decision.]** Obtain concrete field
names, metadata, paths, and flow evidence; do not substitute guessed identifiers.
The requested output is a recorded answer per row before its dependent slice.

| ID | Question / evidence requested | Already decided; do not reopen | Blocks |
|---|---|---|---|
| C1 | What exact Request Status, Phase I Status, and Phase II Status values does a freshly submitted J27 request carry? Which API-safe operation establishes that state after the create plug-in returns `Pending`? Is a post-create `akoya_requeststatus` PATCH by the app user permitted, and what does it trigger? | J27 arrival Request Status is `Phase I Pending` (D27) | Submitted preset state establishment and verifier |
| C2 | For a test clone, should advancement set the phase picklist and let the current rule set Request Status, or use another explicitly bounded operation? Supply the current rule/flow behavior, atomicity, and readback expectations. | Post-Chairs approved state is Phase I `Invited` plus Request Status `Phase II Pending` (D35/D39); no second submission | Peer-review preset and partial-success/recovery design |
| C3 | What are the exact filenames, extensions, and locations of the combined staff version and reviewer version? Confirm the reviewer version's compatibility with the apps' current `Reviewer Materials/Proposal_{n}.pdf` reader, and whether renumbering a copied package is sufficient. What input serves Reviewer Finder's narrative-plus-bibliography contract? | Staff-version contents/order decided D22; reviewers receive the staff version, renamed, in Reviewer Materials (D33); narrative and bibliography inputs remain separately retained | File profile and downstream readiness |
| C4 | What is the minimum complete processed file set for each preset? Which documents are optional, and what is the graphical-abstract image format? Must the Factory copy `Submission-Documents` originals, or are processed files sufficient for these tests? | J27 AI names include `Project-Narrative_{n}.pdf` and `Bibliography_{n}.pdf`; all named processed files are PDFs except the graphical-abstract image | Required-document rules, supported MIME types and reviewed count/byte limits |
| C5 | What are the new files-ready field's logical name/type, exact completion semantics, and reset/replacement behavior? May a verified Factory copy set it, or must it remain unset to suppress processing? | D25 replaces the old `wmkf_phistaffversioncompleteflag` trigger; D26 assigns file reprocessing to Connor's flows | Intake triggering, suppression and truthful completeness |
| C6 | What are the new J27 staff-state field's logical name, options, default and provisioning status? Which state is stored versus derived, and how does it interact with formal request/phase status? | D41 specifies a new field, not an extension of D26 `wmkf_triagestatus`; only Triaged writes Phase I `Recommended Do Not Invite` (D31) | Claiming the submitted fixture is ready for the new triage flow |
| C7 | How do current create/status/file-ready flows recognize test markers? Supply evidence for sends/drafts, portal tracking, payments, AI/provider work, and file overwrites for both presets. Which effects are expected and acceptable? | Existing Factory guards remain mandatory; old D26 flow observations and D42's reassurance do not prove every J27 trigger safe | Any live rehearsal or production enablement |
| C8 | Which fields hold J27's total requested budget, program-at-submission, and program assignment, and which must a useful fixture carry? Confirm the existing Research grant-program lookup is distinct from MR/S&E classification. | D24: total budget initially, details later in Dataverse, not a required submission spreadsheet; D30: program-at-submission immutable | Field allowlist, required metadata, fixture fidelity for triage/filter tests |
| C9 | Identify a safe representative J27 source or approved representative file fixture, its preparation stage, and expected outputs. If only D26 sources are available, which transformations are legitimate and which must be refused? | Real contents are not anonymized; no automatic access to or publication of source material | End-to-end acceptance fixture |

Justin owns the acceptable side effects, chosen copy limits, and the decision
whether the first release must exercise the actual automatic intake AI pass.
Connor supplies the platform contracts; Grants Manager/Program Coordinator own
calendar values. No need to reopen the two requested starting points.

## Fable review and authorized first slice — 2026-10-31

**[VERIFIED via OAuth Claude Fable review]** Verdict: APPROVE WITH NAMED
CHANGES. Both starting points and the baseline were accepted. Dispositions:

1. **Receipt grammar:** confirmed J27 source aliases will be copied under the
   existing canonical `ProposalNarrative_{new-number}.pdf` and
   `ProposalBibliography_{new-number}.pdf` destination names. These are accepted
   by downstream readers and the current JS/SQL receipt grammar. This slice
   does not preserve J27 destination spellings, copy Submission-Documents, add
   images, or widen limits. No ledger migration is needed for this choice;
   tests must prove generated destination receipts pass the existing grammar.
   Preserving new destination spellings later requires a forward ledger migration,
   fingerprint and fresh-install parity, never edits to applied migrations.
2. **Request Status writes:** a string-valued post-create Request Status PATCH
   would be a new production fence shape; the existing integer-picklist status
   fence cannot admit it. C1 includes app-user permission and triggered effects.
   Design and implementation stay on hold for Connor.
3. **Preset readiness:** retain Basic run completion as an orchestration fact;
   the proposed later design layers exact preset readiness on verified lifecycle
   evidence rather than adding new pre-ready step enums now. That later status
   journal/DTO contract requires review and any necessary forward migration.
   Existing Invited transition code predicts a draft email and GoApply tracking
   row; no email send is intended, but these effects require fresh verification.
   D42's reassurance about Recommended Do Not Invite does not clear Invited.
4. **Idempotency:** later preset identity must be checked in the existing-run
   branch of `admin-run-service.js` before its early return, or bound into key
   derivation. A later ledger plan-digest check alone cannot enforce it. No
   starting-state selector or lifecycle retry behavior changes in this slice.
5. **Legacy defaults:** an absent document/preset profile on a legacy bundle
   retains Basic/D26 semantics; an unknown explicit profile is refused. Existing
   status receipts may inform C2, but a Request Status digest alone cannot prove
   which raw status value or external rule produced it.

**[PLANNED — authorized implementation boundary]** Recognize the two confirmed
J27 AI-input aliases; require both narrative and bibliography for J27 exports;
carry their original source identities through bundle/copy validation; normalize
only copied destination filenames; test completeness, ambiguity, source integrity,
legacy compatibility and receipt grammar. A new J27-only bundle version carries
an explicit AI-input profile and linked source cycle. Legacy bundles retain their
original projections and digests. Document completeness here means only the two
AI-input PDFs, not complete staff/reviewer packages or triage/preset readiness.
Source cycle is read through its existing Grant Cycle lookup, not meeting date.
A J27 source missing both files must fail rather than silently become legacy.
No new cycle/preset controls, status fields, automatic intake processing, or live
rehearsals are included.

Implementation invariants:

| Invariant | Files likely touched | Verification |
|---|---|---|
| Legacy bundles/plans keep their original byte shape, file policy and destinations | source bundle, file planner, existing version consumers | Golden digests and legacy resume tests |
| Linked J27 source requires exactly one narrative and bibliography; aliases never hide duplicates | discovery, exporters, source bundle | Missing-both, missing-one, duplicate aliases, wrong folder/type tests |
| J27 inputs copy to existing canonical destination names with new Request number | file planner, bundle copy | Plan/receipt grammar and copied-file verification tests |
| New abstract-bearing bundle retains all existing abstract fences | bundle and abstract consumers | Creation/source/final readback regression tests |
| No lifecycle or live action is added | unchanged policy/status/fences | Diff review and Fable build review |

## Implementation sequence

The bounded document slice above is authorized. All remaining work below is
**[PLANNED]** and requires later direction; lifecycle changes await Connor.

### 1. Pin contracts and inventory platform effects

Record C1–C9 answers and a field/file/state matrix. Read current live metadata,
flow definitions and a representative source without invoking the Admin source
lookup (which saves Blob data). Confirm calendar, required document and reader
contracts. Choose the smallest supported copied set. Classify any gap as blocked
or an explicit fidelity limitation; do not promise full triage readiness early.

### 2. Add versioned J27 file profiles and completeness

Change discovery, the file-plan compiler, source bundle, copy policy and final
verification together. Likely surfaces: `admin-preview-service.js`, `file-plan.js`,
`source-bundle.js`, `bundle-file-copy.js`, filename helpers, and both source
export callers (`admin-run-service.js` and `scripts/export-test-request-source-bundle.mjs`).

Accept the established J27 narrative/bibliography aliases with duplicate refusal.
Resolve destinations for the new Request number using the explicit destination
profile. Require exactly one of every mandatory kind; show optional omissions.
Unknown kinds, unsupported MIME/extension combinations, missing mandatory files,
collisions, stale metadata or truncated inventories refuse the preset. Review
the seven-file / 25 MB per file / 50 MB aggregate policy if the chosen set needs
more; do not silently widen it. Add image support only if C4 requires it.

### 3. Establish and verify both states under narrow fences

Likely surfaces: `policy.js`, `basic-clone-steps.js`, `sandbox-clone.js`,
`run-runner.js`, `production-write-fence.js`, and any necessary typed ledger contract.
Bind the selected preset and approved field values into the plan before dispatch.
Characterize the create plug-in, then implement only the selected bounded state
operation. Verify ownership/test marker/run identity, concrete ETag and exact
destination before any update. Journal before dispatch; recover uncertain results
by exact readback without blind replay. If multiple writes are necessary, specify
partial success and hold behavior before implementation; ready requires all
postconditions. Never convert a 412 or absent response into success.

The existing status-change SQL accepts only two numeric picklists. Decide whether
the preset can use the existing bounded run/resource journal or requires an
additive typed transition. Do not stuff string request statuses into numeric
columns. If schema changes are required, use the dedicated ledger migration
runner/registry and fingerprint contract, plus appropriate fresh-install mirrors;
do not repoint the app migration runner at the Factory ledger or edit applied
migrations. No schema change is presumed necessary merely to add presets.

### 4. Expose the choice in Admin and align owner CLI behavior

Likely surfaces: existing run routes, `admin-run-service.js`,
`TestRequestFactoryIntake.js`, run panel/copy, `shared/config/testRequestFactory.js`,
and `scripts/rehearse-test-request-sandbox.mjs` where applicable. Show source and
destination layout, selected cycle, starting point, copied files and limitations
before Confirm. The server resolves authoritative identifiers and rejects unknown
presets and forbidden preset/cycle combinations. Bind preset identity into
reservation conflict detection; changing a preset cannot reuse an earlier run
under the same key. Preserve authenticated actor ownership and stale-response
guards. Explicitly support or refuse the new profile in CLI modes; keep old
CLI manifests interpretable under their original contract.

### 5. Verify, document and rehearse deliberately

Implement offline coverage below, review the whole caller-to-consumer flow, then
request authorization for exact live fixtures/actions. Do not merge into main,
deploy, change environment settings or create test records as plan closeout.
Update the Factory runbook/Atlas, relevant J27 register sites, service catalog,
and route matrix only where actual changes require them. Reconcile descriptions
of ready, supported documents and presets in the same implementation slice.

## Invariants and acceptance evidence

| Invariant | Required verification |
|---|---|
| Correct state for both presets | Tests where the platform returns `Pending`, wrong phase values or a mismatched staff state; these must not produce ready. Exact desired readback succeeds. |
| Complete J27 files | J27-only names recognized; missing mandatory kind and empty inventory blocked; both aliases present blocked; optional omission explicitly reported; renumbering verified. |
| Preserve D26 and old runs | Golden legacy bundle projections/digests; unchanged resume/inspect; no old run reinterpreted as J27 or silently adopted into a new copy policy. |
| Safe partial outcomes | Lost create/upload/status responses, lease expiry, concurrent workers, stale ETag, completed first write with failed second write, and unchanged retry cannot create duplicates or falsify readiness. |
| Isolation and bounded effects | Existing marker/reminder/cast guards and source-write refusal; test/unknown requests excluded from ordinary automated jobs. Any explicit test execution stays separately authorized. New J27 external triggers need Connor evidence. |
| Truthful UI | Display copied-file/state evidence and unresolved prerequisites; clear stale results after source/preset/run changes; distinguish clone created from preset ready. |

**[VERIFIED offline research evidence]** Six existing suites passed, 230 tests:
`test-request-grant-cycle-link`, `test-request-file-plan`, `test-request-policy`,
`test-request-source-bundle`, `test-request-status-transitions`, and
`test-request-recipe-capabilities` under `tests/unit/`. These establish baseline
behavior, not J27 implementation acceptance. An injected discovery experiment
recognized the two D26 AI filenames, then returned zero documents and no errors
for the two J27 aliases. A separate read-only agent checked the scoping findings
and confirmed the completeness and exact-status gaps.

At implementation time, run focused unit/route suites, meaningful ledger
integration tests if its schema/journal changes, and relevant current gates.
Select from agent invariants, API routes, Atlas, migration manifest/Factory
fingerprint, DAL/context/write boundaries, trust-boundary GUID, status-enum parity,
J27 register, docs/reference/fact/secret checks, types, lint and canonical build
according to touched surfaces. Each gate and its self-test run sequentially.
Do not use old baseline tests as proof that new J27 behavior works.

Live acceptance must separately prove each preset's exact Request/phase/staff
state, cycle link, file locations and downstream intended visibility, plus the
agreed side-effect observation. If ordinary dashboards intentionally hide test
requests, test through the designated test-request surface; do not weaken global
isolation to make them appear. Invitation/calendar readiness and real email
delivery are separate claims. No email send is intended; existing Invited rules
predict a draft email and a portal-tracking row, subject to fresh Connor evidence.

## Compatibility and rollback

**[PLANNED]** Version and bind changed profile/state semantics to the saved plan.
Keep bundle versions 2–5 readable; decide whether additional fields require a
new bundle or manifest version before changing canonical projections. Preserve
old policy/digest behavior rather than changing one global policy and invalidating
every in-flight run. Unknown versions/presets fail closed.

Rollback disables new preset admission while retaining old inspection, artifacts
and receipts. If new in-flight runs cannot safely resume on old code, pause their
advance and require the compatible forward version; never run them under old
semantics, clear dispatch evidence, or delete records as a rollback shortcut.
Keep existing Basic/D26 behavior available where safe. Runtime promotion remains
a separate deliberate action because main deploys to production.

## Document slice build evidence — 2026-10-31

**[VERIFIED via source and offline execution; branch only, not deployed.]**
Implemented J27 alias discovery and ambiguity refusal; both source exporters read
`wmkf_GrantCycle.wmkf_cyclecode` in their source lookup. Linked J27 sources require
both exact AI PDFs before hydration and export v6 with the explicit profile and
cycle. Stored v6 bundles and file planning recheck completeness; unknown profiles
and legacy-version downgrades are refused. Original source metadata and hashes
remain unchanged. Copy planning maps only destination names to the canonical
numbered PDFs; the existing final copy verifier proves the copied bytes.

All abstract-capable consumers (manifest construction, runner/CLI body rebuild,
production source fence and destination Request readback) recognize v5 and v6.
D26 exports stay v5; legacy golden projection/digest and runner tests pass.
There is no status operation, new recipe/step, file policy change, migration,
image/Submission-Documents support, or new endpoint in this slice.

Verification: 70 Factory unit suites / 2,303 tests passed; types passed; touched
source lint had zero errors and two existing unused-disable warnings; all 38
selected gate/self-test runs passed sequentially; canonical `npm run build`
passed. The tests include injected export → JSON reload → copy → final-file
verification, both J27 aliases present, missing-both/missing-one, invalid
folder/MIME, profile downgrade, exact source-byte preservation, v6 abstract drift,
and canonical filename/folder acceptance against JS and SQL receipt grammars.
The default Admin exporter test proves a linked J27 source containing only
legacy Phase I files is refused before saving another draft. SQL grammar tests
exercise the unchanged regular expressions offline; no live database test or
schema apply was performed. Fable's initial OAuth build review found no blocking
code defect and requested two coverage additions (unlinked/D26 alias export
refusal and partial sandbox-preview selection refusal). Both are added; the
focused J27 suite now passes 19 tests, including excluded raw/image fixtures and
a JSON-reload digest check. Fable's final OAuth verdict is APPROVE; both required
conditions are satisfied and runtime source is unchanged from its reviewed diff.
The [review receipt](evidence/FACTORY_J27_DOCUMENT_HANDLING_REVIEW_2026-10-31.json)
retains both verdicts, the review-diff digest, validation and unprobed limits.

Discovery deliberately refuses duplicate narrative/bibliography candidates even
across live/archive buckets. Bundle export already refused duplicate kinds; the
non-executable sandbox preview now also refuses them before selection. This
stricter ambiguity behavior is intentional; no source or archive is preferred.

No Factory live probe, rehearsal, status write, external send, paid app-provider
call, environment edit or deployment was performed. The live platform/field/file
questions C1–C9 remain unresolved and lifecycle work remains held for Connor.

## Review disposition

**[PLANNED — ready for contract decisions, not implementation-ready.]** Whole-flow,
partial-success, async/stale-state, and durable compatibility risks are mapped
above. The bounded implementation uses one pure document-profile helper; it validates
only the AI-input pair/profile and recognizes abstract-bearing bundle versions.
It does not resolve document identity, establish workflow readiness or perform
I/O. New lifecycle enum/field consumer fan-out is a
required build audit once exact identifiers are known. The document slice updates this plan, the Factory runbook, the artifact Atlas,
service catalog and J27 register with explicit branch-only implementation status.

The bounded document slice is source-built, offline-tested and OAuth Fable-approved.
Connor's C1–C9 answers and owner review remain prerequisites for lifecycle
work and separately authorized live rehearsals.
