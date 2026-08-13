---
title: Initial Assessment Controlled Production Pilot — 2026-07-30
domain: architecture
kind: audit
status: active
summary: Request 1003109 proves the core pilot; version, recycle-bin, and editor-permission evidence is in, while Purview retention and library inheritance remain.
canonical: false
cataloged: 2026-07-30
last_verified: 2026-08-13
owner: product-engineering
related:
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/atlas/dataverse-wmkf-ai-run-and-prompt.md
---

# Initial Assessment controlled production pilot — 2026-07-30

## Verdict

**CANONICAL INPUT, NEW-RUN LINEAGE, INTERRUPTED-FINALIZATION RECOVERY,
ATTRIBUTED HUMAN EDITING, NATIVE VERSION RESTORE, AND FIRST-STAGE RECYCLE
RECOVERY PASS; FULL PILOT STILL PARTIAL.**
The first controlled production rehearsal
on Request `1002788` proved the producer → persistence → consumer mechanics
and same-input idempotency. The source document was later identified as an old
Phase I proposal, not the current Phase II proposal. The generated prose is
therefore not evidence that Initial Assessment works semantically on the
approved input, and the rehearsal did not close the full pilot acceptance
contract.

The follow-up on Request `1003109` closed the canonical-input and
future-run-lineage gaps. PR #103 merged as `84155a5a`; production deployment
`dpl_GiWsUy84mXW9bLDwSXYGoyHehqcW` reached Ready. Signed-in Workbench
generation resolved the exact active
`Reviewer Materials/Proposal_1003109.pdf`, created one Ready/Draft artifact,
set the request pointer, registered the SharePoint item, and linked a completed
AI run whose `wmkf_ai_request` lookup is the same request GUID. A fresh
read-only recomputation from the canonical PDF produced the exact stored input
fingerprint and generation key. An exact-input UI retry preserved the single
row/run/item, attempt count, and modification timestamp. Production route
GET/POST calls returned 200 and the deployment error scan found no runtime
errors.

On 2026-07-30, a second controlled Request `1003109` exercise staged the
existing row as Failed after its SharePoint upload while retaining its
generation key, input fingerprint, governed content hash, AI run, folder, and
filename. The signed-in Workbench displayed that failure and the normal
`Retry draft` action recovered it to Ready/Draft with attempt count `2`.
Readback proved that recovery reused registry row
`3cec63a4-768c-f111-ab0f-6045bd018a07`, AI run
`528b97af-768c-f111-ab0f-7ced8d3d15a6`, and SharePoint item
`01G4GVMS3U3DHMJQ7GERBLB2QA3SYTLNHO`. The SharePoint version remained `1.0`;
its eTag, last-modified timestamp, size, and governed hash were unchanged, and
the request pointer was restored to the same row. The request still had
exactly one Initial Assessment AI run and no cleanup work. This
production-proves recovery without another model call, upload, overwrite, or
duplicate row.

The first-write and recovery runtime logs recorded service-layer fallbacks: the
acting Dataverse user lacked direct permission for the new
`wmkf_requestdocument` create/update and final changeset, so the application
retried those operations as its service principal and completed the request.
This did not affect artifact correctness. **Owner decision 2026-07-30:**
native SharePoint version attribution is the required human-edit audit surface;
system-generated Dataverse registry writes may use application identity.
The fallback is therefore non-blocking, and no registry-role change or custom
version ledger is required now.

Three defects or evidence gaps were found during the rehearsal:

1. the proposal source was an old Phase I document rather than the approved
   Phase II reviewer package;
2. post-upload recovery compares downloaded SharePoint bytes with the
   producer's pre-upload DOCX hash, but SharePoint rewrites the Office package
   during ingestion; and
3. the Initial Assessment Executor call did not pass `requestId`, so the exact
   AI run has prompt lineage but a null `wmkf_ai_request` lookup.

**[VERIFIED DEPLOYED AND CANONICAL-INPUT PROVED 2026-07-30]** Production
commit `9c88a1fa` stores a `gdc1:`-tagged SHA-256 of normalized
governed `word/` package content while canonicalizing only
SharePoint-injected `customXml` relationships, and passes `requestId` to the
Executor with a fail-closed no-persistence requirement. Synthetic complement
tests passed, and a one-off check against the actual pilot packages produced
the same normalized hash for the producer and SharePoint v1 files while
distinguishing the later v2 file. Legacy untagged hashes are recoverable only
when the downloaded package bytes still match exactly; otherwise retry blocks
for operator reconciliation without another model call or upload. Production
deployment `dpl_EVPb3vTWBYSUSABJYdKAPohruyQ1` reached Ready with a clean
initial error scan.

On 2026-07-30 local time / 2026-07-31 UTC, Justin Gallivan completed the
authorized substantive edit of Request `1003109`'s canonical Word artifact.
Graph readback showed SharePoint version `2.0`, modified by Justin's user
identity, with the same stable item ID
`01G4GVMS3U3DHMJQ7GERBLB2QA3SYTLNHO`. A read-only DOCX inspection found the
Foundation Opportunity heading followed by one non-empty paragraph, with no
remaining `STAFF INPUT REQUIRED` marker. Both the per-request Workbench and
the D26 pilot locator still opened that exact stable item.

The edit also exposed the remaining readback gap precisely. The Dataverse
registry still carries its upload-time version `1.0`, eTag, size, and
last-modified timestamp, while Graph reports current version `2.0`. Stable
identity and discovery are correct. **[VERIFIED DEPLOYED 2026-07-30 via
production deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`, commit `68bcb4e8`,
and signed-in Request `1003109` checks]** the shared read model now overlays
Graph-current response metadata by stable drive/item ID without modifying the
Dataverse snapshot, and both consumers use one renderer that distinguishes
current, missing, unavailable, and unchecked metadata. Adversarial follow-up
added a ten-second total cycle-read budget including independently bounded
token waits over single-flight cold-token acquisition, rejects
mismatched/non-file Graph items, prevents content tags from being labeled as
versions, and suppresses the Open link after a confirmed 404. Both live
consumers displayed current SharePoint version `2.0` and the same stable
document link. The controlled audit below closes the native version and
first-stage recovery portions; its named administrator and product controls
remain open.

On 2026-07-30 local time / 2026-07-31 UTC, a disposable-file audit exercised
the actual production Request library without modifying Request `1003109`.
Graph created versions `1.0` and `2.0`, downloaded the prior version, restored
`1.0` as new current version `3.0`, and verified exact expected bytes. After
deletion, Justin's signed-in SharePoint session found the probe in the
first-stage recycle bin, restored it, and Graph confirmed the same item and
exact contents were live. The probe was deleted again; both controlled probe
artifacts were removed from the first-stage bin. Justin was denied access to
the second-stage administrator recycle-bin view — an access limit, not evidence
about the bin, as the 2026-08-13 answers went on to show.

Library version limits, second-stage recovery, and ordinary-editor permissions
were subsequently **answered** (2026-08-10 and 2026-08-13; see item 5 and
`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`). Still open, in priority order:
**whether the `Request` library inherits site permissions**, Workbench
history/restore controls, Board milestone snapshots (**scope reduced** — Diligent
already holds the Board record), and **site/library Purview retention** (low
priority; no regulatory obligation applies).

## Evidence matrix

| Contract | Producer/source | Persistence | Consumer/readback | Result |
| --- | --- | --- | --- | --- |
| Generate canonical artifact | Signed-in Workbench generation for Request `1002788` (`feabe26f-dc1b-f111-8341-000d3a306da2`) | Registry row `fb995f0f-628c-f111-ab0f-6045bd018a07`; request pointer set to that row; SharePoint item `01G4GVMS77A2SBVPGA4VFINZFWAFIZGVFG` | Workbench showed `Ready · Draft` and opened the canonical item | PASS for mechanics only |
| Approved proposal input | The runtime loaded an old Phase I proposal rather than `Reviewer Materials/Proposal_1002788.pdf` | The resulting fingerprint and artifact faithfully represent the wrong source | The artifact is reachable but its generated content is not a valid Phase II assessment proof | HISTORICAL FAIL — closed by the Request `1003109` row below |
| Prompt/run/template lineage | `initial-assessment.generate` v1; template `initial-assessment-standard-business-brief` v1.0.0 | Prompt `fc8a4c3b-5e8c-f111-ab0f-7ced8d3d15a6`; run `b7ae9b17-628c-f111-ab0f-000d3a31c468`; generation key and input fingerprint persisted | Registry readback matched the generating prompt, run, template, and request | HISTORICAL PARTIAL — this pilot run lookup is null; the Request `1003109` row below closes future-run proof |
| Shared discovery contract | Same canonical registry row | Stable drive/item identity and request pointer | Per-request Workbench and `/workbench/artifacts` both listed the same artifact and Open link | PASS |
| Exact-input retry | `Refresh from current inputs` on the Ready artifact | Still one registry row; same row, run, SharePoint item, timestamps, and attempt count | UI returned the existing Ready artifact | PASS — no model call, upload, overwrite, or duplicate |
| Editable SharePoint lifecycle | Justin Gallivan edited the canonical Request `1003109` Word file, including Foundation Opportunity | SharePoint created version `2.0` under Justin's user identity; the stable item ID was unchanged; the staff-input marker is absent | Both application consumers still open the same stable item | PASS |
| Current-version readback | Native Word editing advanced the canonical item from version `1.0` to `2.0` | Dataverse remains the upload/finalization snapshot; the deployed read model overlays current Graph values in the response only | Both live consumers display the same current/missing/unavailable/unchecked semantics | PASS — Request `1003109` displayed current SharePoint version `2.0` in both consumers on deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2` |
| Native version inspection/restore | Disposable file in the production Request library was uploaded twice, then prior version `1.0` was downloaded and restored | SharePoint retained `2.0` and `1.0`; restore created `3.0` and exact current bytes matched version one | Graph version list/content/restore operations | PASS — controlled probe only; no Request `1003109` mutation |
| First-stage recycle recovery | Controlled probe was deleted after its version test | SharePoint first-stage bin retained the item and original Request-library location | Justin restored it through the signed-in SharePoint UI; Graph confirmed the same item and exact contents live | PASS — probe then deleted again and both probe artifacts removed from first-stage |
| Administrative library controls | Direct policy/permission probes, signed-in administrator view, Connor's 2026-08-10 replies, and the structured 2026-08-13 audit answered by Connor + Dragonfly IT | Item-level retention-label read returned no label fields; site-permission enumeration returned `403` (app-only `Sites.Selected`) and delegated PnP sign-in was refused at the tenant consent screen, so neither route can read permissions; second-stage admin bin returned Access Denied to an ordinary member | Administrator attestation (IT), operator observation (Connor's signed-in UI), and Microsoft Learn for interpretation — kept as distinct evidence classes | PARTIAL — three of four answered. **Version policy ANSWERED** (signed-in Versioning Settings page 2026-08-10: major only, no time limit, keep 500, drafts unchecked, check-out not required; independently reproduced 2026-08-13 on `Request` + `RequestArchive1`; 500 is the platform default). **Second-stage bin ANSWERED — it EXISTS**, reversing the 2026-08-10 "none"; `dftadmin` can access it, 93-day window shared across both stages, restore is `dftadmin`-only, contents unreported. **Editor least privilege ANSWERED — Members hold `Edit`**, granting Delete Items, Delete Versions, and Manage Lists; ordinary editors can delete documents and purge version history, which refutes H2 and resolves the 2026-08-10 `0x80060728` asymmetry as the transient self-lock (H1). **Purview retention remains unanswered but is LOW PRIORITY** — no regulatory obligation applies (owner, 2026-08-13), so a policy would only be an unclaimed safety net. **NEW open item:** Members includes `Everyone except external users`, so Edit reaches the whole internal directory at site scope — whether it reaches the `Request` library depends on unread `HasUniqueRoleAssignments`. See `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` |
| Workbench version-history display | `View version history` disclosure on the Initial Assessment tab, lazy-fetched per staff click | Read-only. Lists native SharePoint versions for the exact displayed artifact via Graph; a replacement race returns 409 rather than another artifact's editors; no Dataverse write and no snapshot row | Workbench shows editor attribution per version, current-first, with honest truncation reporting | PASS — shipped S413 (2026-08-10) at merge `147d3e49` and **live-verified by signed-in smoke** on Request `1003109`. The tab rendered `Version 2.0 · current · Justin Gallivan · Jul 30, 2026 6:33 PM` over `Version 1.0 · SharePoint App · Jul 30, 2026 5:28 PM`, with no truncation note. Two independent cross-checks passed: those timestamps equal the direct-Graph probe's `2.0@2026-07-31T01:33:55Z` / `1.0@2026-07-31T00:28:08Z` converted to Pacific, so the route→service→Graph chain returns the same versions as a direct Graph call; and the `current` badge agrees with the tab header's `2.0`, which is a genuinely separate read — the header resolves `publication.versionId` through `currentMetadata` at page load [VERIFIED via `lib/services/graph-service.js:410`, `lib/services/initial-assessment/artifact-service.js:286`], while the history path issues its own item read on the disclosure click [VERIFIED via `lib/services/graph-service.js:491`], so this is two requests agreeing rather than one value rendered twice. This retires the mock-coverage gap — until this smoke, all three test files stubbed their outbound boundary [VERIFIED via `tests/unit/graph-service-versions.test.js:45`, `tests/unit/workbench-initial-assessment-versions-route.test.js:11`, `tests/unit/initial-assessment-artifact-versions.test.js:5`] and the chain had never executed end to end |
| Workbench administrator restore and milestone freeze | No current producer/action | No milestone snapshot row/artifact is created; no restore path exists in the app | Workbench has no administrator restore control | PLANNED — restore no longer waits on permission evidence (that is in) but on the product decision about which role may invoke it. The milestone snapshot producer is decided as copy-the-bytes, but its **justification shrank on 2026-08-13**: Diligent timestamps Board-bound documents and exports Board Books, so the institutional-record case is already covered elsewhere and only mid-cycle work loss and version provenance remain. Owner decision pending on whether to build it at all — see `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` |
| Post-upload recovery | Request `1003109` was staged as Failed after upload while retaining generation/run/file/hash identity, then retried through the signed-in Workbench | Same registry row, AI run, request pointer target, and SharePoint item; attempt count advanced `1 → 2`; no cleanup work | Same SharePoint version `1.0`, eTag, last-modified time, size, and governed hash; exactly one request AI run | PASS — no model call, upload, overwrite, or duplicate |
| Approved canonical input follow-up | Signed-in Workbench generation read `Reviewer Materials/Proposal_1003109.pdf` (33,011 extracted characters; text SHA-256 `0fc490d0fc1c635878f36b35376f952e0e35ea8225441c4fe2644f0e3456f36e`) | Row `3cec63a4-768c-f111-ab0f-6045bd018a07`; input fingerprint `df23a4ebfa2661d89dce81ea4c6cbe2937fa9f4607fb3e2a50981a49b1851a1b`; generation key `4803841d396aa1d2563aa36d2135efe6b51cc527183755dfbeca37f1f85f582f` | Workbench showed `Ready · Draft` and the exact recomputation matched both stored identities | PASS |
| New-run request lineage | `initial-assessment.generate` v1 under Request `1003109` | AI run `528b97af-768c-f111-ab0f-7ced8d3d15a6`; `_wmkf_ai_request_value=b2a683cb-ec6f-f111-ab0d-000d3a306d45`; SharePoint item `01G4GVMS3U3DHMJQ7GERBLB2QA3SYTLNHO` | Registry and request pointer both target `3cec63a4-768c-f111-ab0f-6045bd018a07` | PASS |
| Canonical exact-input retry | Workbench `Refresh from current inputs` on Request `1003109` | Still one row, same run/item, attempt count `1`, and unchanged `modifiedon` | UI returned the same Ready/Draft artifact | PASS — no duplicate/model/upload |

## Exact persisted lineage

- Request: `1002788`, cycle `D26`
- Registry row: `fb995f0f-628c-f111-ab0f-6045bd018a07`
- Generation key:
  `39b8d76afee2d691d58372c440752b191405afb0d10c03ec3ea69e65bb8fb623`
- Input fingerprint:
  `ae7081370021beabb27655ef2edb9183b83f1bb92bc672b272b2535119424e7c`
- AI run: `b7ae9b17-628c-f111-ab0f-000d3a31c468`
  (`2026-30-07-1359`, completed, `claude-sonnet-5`)
- SharePoint drive:
  `b!GQ6TSC-650adweD3-K3oUiroCicDaexCmdFAeYY_AC0LfwP99I31QY_tw5hNNRkY`
- SharePoint item: `01G4GVMS77A2SBVPGA4VFINZFWAFIZGVFG`
- Request-relative folder:
  `1002788_FEABE26FDC1BF1118341000D3A306DA2/Artifacts/Initial Assessment`
- Initial filename:
  `1002788 Initial Assessment 39b8d76a-aeaa41e1.docx`

The upload-time registry hash was
`66d665daf8f7e2102986b90823312405d2e02875ecd5c162cd381fc08a2b6933`.
It is an untagged legacy whole-package digest; the historical Ready row does
not enter recovery, and the candidate does not misinterpret that value as a
`gdc1:` digest.
The canonical SharePoint version `1.0` download hashed to
`41717302c77229923cfdf688955720e6a5944e869f72bbec5ccaaea7ed563b34`.
Inspection of the DOCX packages showed SharePoint-added/repacked Office parts,
not an intervening staff edit. Version `2.0` later hashed to
`38cfd72648110df93629f3f6ddbe7e172dedbaa12bb0868b82925f2bb10661c1`.

## Required follow-up

1. The canonical proposal-source deployment, generation, identity
   recomputation, new-run request lineage, and exact-input reuse are complete
   on Request `1003109`.
2. The interrupted-finalization recovery branch is production-proved on
   Request `1003109`: it restored the same row and request pointer while
   preserving the single AI run and SharePoint item/version.
3. The recovery/run-linkage runtime fix is deployed. The schema-as-code field description is
   corrected on `main`, but the
   creation-only schema applicator does not update an existing Dataverse
   attribute description; that optional live metadata cleanup is separate and
   does not block the runtime fix.
4. The substantive authorized staff review/edit is complete on Request
   `1003109`: SharePoint version `2.0` is attributed to Justin Gallivan,
   Foundation Opportunity no longer contains the staff-input marker, and both
   consumers resolve the same stable item.
5. **Partially completed 2026-07-30; administrator evidence gathered in two
   rounds, 2026-08-10 (S413) and 2026-08-13 (S425).** Response-only current
   SharePoint metadata display, native version inspection/restore, and signed-in
   first-stage recycle recovery are production-proved.

   The 2026-08-10 round was Connor's four verbatim replies — **"Major versioning
   is on" / "No second-stage recycle bin" / "Not familiar with purview" / "Site
   members have 'limited control'"**. The 2026-08-13 round was a structured
   six-question audit, with the parts beyond Connor's own rights escalated to
   Dragonfly IT. **It reversed two of the four 2026-08-10 replies**; the caveats
   recorded at the time are what stopped both from hardening into fact. Standing
   state:
   - **Version limits — ANSWERED, and re-verified.** Major versions only, no
     time limit, keep 500, drafts unchecked, check-out not required — read from
     the signed-in Versioning Settings page 2026-08-10 and independently
     reproduced by Connor 2026-08-13 on `Request` and `RequestArchive1`.
     500 is the platform default, so this is untouched configuration rather than
     a deliberate retention decision. `RequestArchive2`/`3` not read (n=2 of 4).
   - **Second-stage recovery — ANSWERED, and the 2026-08-10 reply was WRONG.**
     A second-stage bin **exists**; Dragonfly IT: *"Yes, the dftadmin account can
     access the secondary recycle bin."* The recovery window is 93 days from the
     original deletion, shared across both stages, `dftadmin`-only to restore,
     and can end early via quota purge or a manual empty. Contents unreported, so
     whether anything has already been lost is unknown.
   - **Purview retention — unanswered, LOW PRIORITY, not a gate.** Dragonfly IT
     was not asked (the question to them covered permissions and the recycle bin
     only). **No regulatory retention obligation applies to these documents**
     (owner, 2026-08-13), so a Purview policy would only be a protective
     mechanism nobody is counting on — its absence costs nothing. Needs an M365
     compliance/Purview administrator if ever wanted; do not spend a round-trip
     on it ahead of library inheritance.
   - **Editor least privilege — ANSWERED, unfavourably.** "Limited control" was a
     pane caption, not a permission level. The Members group holds **Edit**,
     which grants **Delete Items, Delete Versions, and Manage Lists** and
     excludes Manage Permissions. Ordinary editors **can** delete a document and
     purge its version history. The 2026-08-10 edit-yes/delete-no asymmetry was
     the transient self-lock (H1), not a custom level (H2, refuted).
   - **NEW and open — library inheritance.** Members contains `akoyaGO Members`
     **and `Everyone except external users`**, so Edit reaches every licensed
     internal account at *site* scope. Whether that reaches the `Request` library
     depends on `HasUniqueRoleAssignments`, which nobody has read. This bounds
     the finding above and must be carried with it.

   Three of the four original checks are therefore answered and one remains, with
   one new question opened. Add Workbench version-history/admin
   restore before calling the artifact system production-ready. The milestone
   pointer-vs-copy question is decided (copy), and these replies do make a
   pointer-only milestone materially less safe — but the **Diligent** context
   received 2026-08-13 shrank what a milestone snapshot is for, so confirm with
   the owner that it is still worth building before scheduling it
   (`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, Board milestone freeze).
6. Attribution policy is settled: SharePoint native version history is the
   required human-edit audit surface, while system-generated Dataverse
   registry writes may use service-principal attribution.

No source proposal text or applicant-sensitive content is reproduced in this
report.
