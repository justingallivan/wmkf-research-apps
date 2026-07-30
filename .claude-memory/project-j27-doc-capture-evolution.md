---
name: J27 document capture & Proposal-tab evolution
description: D26 proposal inputs still resolve by a fragile SharePoint filename bridge. The governed-artifact pilot now has a live typed wmkf_requestdocument schema, governed prompt, and application; its controlled artifact rehearsal and broader J27 capture remain open. The reviewer hold step is retired.
type: project
status: active
scope: strategy
last_verified: 2026-07-30 via Initial Assessment production schema/prompt/app deployment verification; controlled artifact pilot and broader J27 capture/timing remain open
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

**D26 document resolution is an INTERIM BRIDGE — do not treat it as permanent.** The Proposal tab (and the field primer / reviewer-finder proposal-text path) locates documents by listing the request's SharePoint **`Phase I` subfolder** and matching **consistent filenames** for this cycle: `ProjectDescription.pdf` (the proposal — same file the primer + reviewer finding ingest, NOT a separate doc), `Biosketches.pdf`, `ProjectBudget.pdf`, `Project Budget spreadsheet.xlsx`; `Application Cover Page.docx` is excluded (it's the Dataverse-derived top panel). The existing `classifyFile()` heuristic already tags `ProjectDescription` as the proposal and budget/biosketch/cover as `other`.

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
remain future work. The controlled dummy-request artifact rehearsal has not
yet run.

**Pilot environment decision (owner, 2026-07-29):** do not build the reachable
but incompletely provisioned Dataverse sandbox organization into an integrated
application/file test environment for this pilot. Use a controlled production
rehearsal after colleagues create representative dummy `akoya_request` records.
Their IDs/content shape, named testers, and schedule remain pending. Production
schema apply, prompt seeding, and application promotion were separately
approved and completed on 2026-07-30; artifact generation remains controlled.

**Hold step already RETIRED (S279) — this contingency resolved early, for a different reason.** The reviewer "hold step" ([[project-reviewer-hold-step-decouple]]) was removed in S279 (commit `a8676af1`) when the direction shifted to onboarding at a single final Accept — independent of J27. So the earlier "single-submission may un-scaffold the hold step" note is now moot: there is no hold step left to un-scaffold. (Kept here only so the J27 doc-capture planning doesn't re-raise it.)

## Sequencing / urgency (user, S258)

J27 design is a **large planning effort with many moving parts** that must **start soon after the bulk of the D26 Workbench work lands** — treat it as the next major planning push, not a someday item. J27 specifics (exactly what is collected up front, timing, final table shape) are **not yet decided** — re-confirm with Justin/Connor before building.

Ground truth: [VERIFIED 2026-07-30 via
`shared/config/workbenchProposalDocuments.js`,
`lib/services/grant-reporting/classify-file.js`,
`lib/services/reviewer-finder/load-proposal-service.js`, and
`docs/CURRENT_WORK_QUEUE.md`, production Wave 16 readback, prompt verification,
and deployment inspection]. The typed registry is live; broader J27
applicant-capture producers and the controlled artifact rehearsal remain open.
