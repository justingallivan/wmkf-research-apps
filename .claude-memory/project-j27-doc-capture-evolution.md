---
name: J27 document capture & Proposal-tab evolution
description: The D26 Proposal tab retains its Phase I display bridge; writeups use the exact narrative PDF, while the bibliography is reserved for next-cycle Reviewer Finder.
type: project
status: active
scope: strategy
last_verified: 2026-08-17 via owner direction, integration source/tests, and prior live read-only Request 1002788 narrative extraction; historical artifact mechanics via production readback
---

## Recall Rule

Read this when: building/maintaining the **Request Workbench → Proposal tab** document section, writing any SharePoint document-resolution for a request, planning **J27** document collection, or considering changes to the reviewer **hold step**. Pairs with [[project-grant-phasing-evolution]] (the phasing mechanics — single-submission, "Phase II" = status flip).

**2026-07-28 clarification (supersedes the older shorthand
“doc-resident knowledge onto Dataverse tables”):** the converging direction is
to move document **identity, type, relationships, workflow state, and structured
decisions** into a typed Dataverse registry. SharePoint Word remains the
canonical editable narrative and Microsoft Search supplies body search. Do not
copy the co-edited Word body into a second editable Dataverse memo.

## The decision picture (S258, Justin + Connor)

**D26 Proposal-tab document display is an INTERIM BRIDGE — do not treat it as
permanent.** The Proposal tab lists the request's SharePoint **`Phase I`
subfolder** and matches the cycle filenames `ProjectDescription.pdf`,
`Biosketches.pdf`, `ProjectBudget.pdf`, and
`Project Budget spreadsheet.xlsx`; `Application Cover Page.docx` is excluded
because its content comes from the Dataverse-derived top panel.

**Governed proposal analysis has a separate internal input as of 2026-08-16.**
Initial Assessment and Workbench Field Primer request mode require the exact
active `AI Materials/ProposalNarrative_{Request#}.pdf` file. They do not use the
outbound reviewer package, Proposal-tab `ProjectDescription.pdf` bridge, a raw
Phase I export, an archive match, or a best-guess classifier. Missing or
ambiguous exact input fails before model/result writes. Request `1002788` is
the live read-only resolver/extraction example; its earlier generated artifact
still proves mechanics only because that run used an old Phase I document.
Reviewer Finder is a separate staff discovery surface: its current-cycle
default prefers the exact outbound reviewer package and falls back only to exactly one active
`Phase I/ProjectDescription.pdf`; neither or ambiguity returns a server-listed
picker before download/Blob write. The fallback does not alter the governed or
external-reviewer contracts.

Power Automate publishes two separate exact files:
`AI Materials/ProposalNarrative_{Request#}.pdf` and
`AI Materials/ProposalBibliography_{Request#}.pdf`. Pre-Site, Initial
Assessment, and Field Primer use and fingerprint only the exact narrative.
The bibliography remains separate for the next-cycle Reviewer Finder, which
will label and fingerprint both sources so cited authors can inform discovery.
Its current-cycle resolver remains unchanged.

**Filename-match is FRAGILE — but do NOT assert it "will break in J27."** (Corrected S265, Justin: the earlier "J27 will use new naming conventions / a different collection mechanism, so filename-match WILL break" claim was **unsubstantiated** — Connor pushed back on dropping filename-reconciliation on that premise. There is **no evidence** J27 changes naming; filename-match only breaks **if the names actually change**, which isn't established.) The real, durable case for moving OFF filename-match is **fragility + Dataverse legibility**, NOT a J27-will-break prediction: it depends on PDs naming files consistently/correctly, with **no structured fallback** when they don't. **Strongest argument:** if we **auto-generate writeups** in a future cycle, there is **nowhere structured to store them that the apps can read back** — a filename heuristic can't anchor a machine-produced doc that a PD may never (re)name correctly. Keep the D26 name→label map in one small per-cycle config; never hard-code D26 names as permanent (consistent with [[project-grant-phasing-evolution]]).

**Initial governed-artifact implementation (source-backed 2026-07-29;
production-provisioned and deployed 2026-07-30): associate documents with the typed
`wmkf_requestdocument` Dataverse table on the request** so the apps point at
each registered artifact **directly** instead of filename joins. The schema
includes request/cycle, artifact and lifecycle/status option sets, stable
SharePoint/Graph identity, version/eTag, prompt/run/input/template provenance,
lineage/milestone fields, and a deterministic generation alternate key.
This makes document identity, relationships, workflow, and structured
decisions legible to the apps while the file bytes and editable Word narrative
remain in SharePoint. Production Wave 16 and governed
`initial-assessment.generate` v1 are live; PR #102 deployed Ready as
`dpl_AxxroabhpXLX1pz75MW6486fB4ci`. Precedent for a document reference on a row already
exists in `wmkf_apprequestperson.wmkf_biosketchurl`. The first producer is the
request-bound Initial Assessment service; broader applicant-capture producers
remain future work. The controlled Request `1002788` rehearsal generated the
canonical artifact, populated the registry/pointer, exposed the same item in
both consumers, and proved exact-input retry without another run or upload.
That request's loaded proposal was later identified as an old Phase I
document, so the rehearsal proves artifact mechanics but not semantic
correctness on the approved Phase II input. It also showed that SharePoint
repacks the DOCX so whole-package hashing cannot
support interrupted-finalization recovery, and that the deployed producer
omitted the Executor `requestId`, leaving the run lookup null. Production
commit `9c88a1fa` now hashes normalized governed Word parts and
passes the request GUID; focused tests and the actual pilot packages verify the
hash complement. Request `1003109` production-proved canonical-input
generation, exact-input reuse, and a new AI run with the correct request
lookup. A controlled retry then production-proved interrupted-finalization
recovery using the same registry row, AI run, SharePoint item, and version.

**Pilot environment decision (owner, 2026-07-29):** do not build the reachable
but incompletely provisioned Dataverse sandbox organization into an integrated
application/file test environment for this pilot. Use a controlled production
rehearsal after colleagues create representative dummy `akoya_request` records.
Request `1002788` became the authorized target. Production schema apply, prompt
seeding, application promotion, generation, shared discovery, and exact retry
completed on 2026-07-30. Recovery/run-linkage fixes are deployed; production
run-linkage and interrupted-finalization recovery proof later passed on
Request `1003109`. An attributed substantive edit then passed on the same
stable item through both consumers. Production deployment
`dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2` (`68bcb4e8`) now refreshes response-only
Graph-current version/last-modified metadata, and both signed-in consumers
displayed the same current version `2.0`. The remaining target-library controls
are controlled follow-up work. A disposable production-library audit subsequently
proved native previous-version inspection/restore and signed-in first-stage
recycle recovery. Administrator verification of configured version limits,
second-stage recovery, Purview retention, and editor least privilege remains
open, as do Workbench history/admin restore and immutable milestone snapshots.

**Hold step already RETIRED (S279) — this contingency resolved early, for a different reason.** The reviewer "hold step" ([[project-reviewer-hold-step-decouple]]) was removed in S279 (commit `a8676af1`) when the direction shifted to onboarding at a single final Accept — independent of J27. So the earlier "single-submission may un-scaffold the hold step" note is now moot: there is no hold step left to un-scaffold. (Kept here only so the J27 doc-capture planning doesn't re-raise it.)

## Sequencing / urgency (user, S258)

J27 design is a **large planning effort with many moving parts** that must **start soon after the bulk of the D26 Workbench work lands** — treat it as the next major planning push, not a someday item. J27 specifics (exactly what is collected up front, timing, final table shape) are **not yet decided** — re-confirm with Justin/Connor before building.

Ground truth: [VERIFIED 2026-08-01 via
`shared/config/workbenchProposalDocuments.js`,
`lib/external/reviewer-materials.js`,
`lib/services/workbench-proposal-documents.js`,
`lib/services/reviewer-finder/load-proposal-service.js`, and
`docs/CURRENT_WORK_QUEUE.md`, production Wave 16 readback, prompt verification,
deployment inspection, the Request `1002788` mechanics rehearsal, and the
signed-in Request `1003109` generation/retry/recovery plus live lineage probes,
and focused Reviewer Finder proposal-resolver tests].
The typed registry is live and exercised; broader J27 applicant-capture
producers and the partial-pilot blockers remain open.
