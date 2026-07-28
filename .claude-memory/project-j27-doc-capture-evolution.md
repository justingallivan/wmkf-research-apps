---
name: J27 document capture & Proposal-tab evolution
description: D26 resolves request docs by SharePoint filename-match — a FRAGILE interim bridge. Durable direction = typed Dataverse document registry plus canonical SharePoint files; exact schema remains open. The reviewer hold step is already retired.
type: project
status: active
scope: strategy
last_verified: 2026-07-28 via owner document-authority decision and Graph search evidence; exact J27 schema/timing still open
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

**Converging target (registry direction owner-decided 2026-07-28; exact
schema still open): associate documents with a typed Dataverse table on the
request** so the apps point at each doc **directly** instead of folder-walking
and filename heuristics. Shape under consideration: a child table (for example
`wmkf_requestdocument`) with `request lookup + doc-type picklist + stable
SharePoint/Graph identity + filename/content-type + lifecycle/provenance`.
This makes document identity, relationships, workflow, and structured
decisions legible to the apps while the file bytes and editable Word narrative
remain in SharePoint. Precedent for a document reference on a row already
exists in `wmkf_apprequestperson.wmkf_biosketchurl`. The natural producer is
the intake portal (machine-legible capture, private Blob via
`INTAKE_BLOB_RW_TOKEN`)—see [[project-machine-legible-form-capture]] and the
intake-portal memories. Treat the registry direction as settled, but re-confirm
the exact table fields, producer timing, and migration before building.

**Hold step already RETIRED (S279) — this contingency resolved early, for a different reason.** The reviewer "hold step" ([[project-reviewer-hold-step-decouple]]) was removed in S279 (commit `a8676af1`) when the direction shifted to onboarding at a single final Accept — independent of J27. So the earlier "single-submission may un-scaffold the hold step" note is now moot: there is no hold step left to un-scaffold. (Kept here only so the J27 doc-capture planning doesn't re-raise it.)

## Sequencing / urgency (user, S258)

J27 design is a **large planning effort with many moving parts** that must **start soon after the bulk of the D26 Workbench work lands** — treat it as the next major planning push, not a someday item. J27 specifics (exactly what is collected up front, timing, final table shape) are **not yet decided** — re-confirm with Justin/Connor before building.
