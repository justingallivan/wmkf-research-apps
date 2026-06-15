---
name: J27 document capture & Proposal-tab evolution
description: J27 will collect request documents differently (Dataverse-table direct references, converging); D26 filename-match is an interim bridge; single-submission may un-scaffold the reviewer hold step. Large near-term planning effort.
type: project
status: active
scope: strategy
last_verified: S258 (2026-06-14) via user (Justin) + source/Atlas grounding; J27 specifics not yet decided
---

## Recall Rule

Read this when: building/maintaining the **Request Workbench → Proposal tab** document section, writing any SharePoint document-resolution for a request, planning **J27** document collection, or considering changes to the reviewer **hold step**. Pairs with [[project-grant-phasing-evolution]] (the phasing mechanics — single-submission, "Phase II" = status flip).

## The decision picture (S258, Justin + Connor)

**D26 document resolution is an INTERIM BRIDGE — do not treat it as permanent.** The Proposal tab (and the field primer / reviewer-finder proposal-text path) locates documents by listing the request's SharePoint **`Phase I` subfolder** and matching **consistent filenames** for this cycle: `ProjectDescription.pdf` (the proposal — same file the primer + reviewer finding ingest, NOT a separate doc), `Biosketches.pdf`, `ProjectBudget.pdf`, `Project Budget spreadsheet.xlsx`; `Application Cover Page.docx` is excluded (it's the Dataverse-derived top panel). The existing `classifyFile()` heuristic already tags `ProjectDescription` as the proposal and budget/biosketch/cover as `other`.

**J27 will collect this data differently** — at minimum new file-naming conventions, and the collection mechanism itself is in flux. So **filename-match WILL break across the D26→J27 boundary.** Keep the D26 name→label map in one small per-cycle config; never hard-code D26 names as permanent (consistent with [[project-grant-phasing-evolution]]: don't assume "Phase II is a different file than Phase I").

**Converging target (Justin + Connor discussing — NOT yet decided): associate documents with a Dataverse table on the request** so the app points at each doc **directly** instead of folder-walking + filename heuristics. Shape under consideration: a child table (e.g. `wmkf_requestdocument`) = `request lookup + doc-type picklist + direct reference (SharePoint URL / Graph driveItem id) + filename + content-type`. This **realizes the already-durable S157 intent**: "move doc-resident knowledge onto Dataverse **tables** (structured/legible/searchable); doc-link surfacing is an interim bridge" (Atlas `docs/atlas/dataverse-akoya-request.md` §era; [[project-dataverse-power-tools]]). Precedent for a doc-reference-on-a-row already exists: `wmkf_apprequestperson.wmkf_biosketchurl`. Natural **producer = the intake portal** (machine-legible capture, private Blob via `INTAKE_BLOB_RW_TOKEN`) — see [[project-machine-legible-form-capture]] and the intake-portal memories. Treat this as **strong, accumulating evidence for the table direction**, not a settled build.

**Single-submission may un-scaffold the delayed reviewer-invite "hold step."** The hold step ([[project-reviewer-hold-step-decouple]]) exists largely to handle late-arriving Phase II materials; if J27 collects everything up front, that rationale weakens and the scaffolding may simplify or retire. ⚠️ **Contingent FUTURE un-scaffold, NOT a green-lit removal** — verify live callers before acting ([[feedback-verify-before-destructive-carryover]]).

## Sequencing / urgency (user, S258)

J27 design is a **large planning effort with many moving parts** that must **start soon after the bulk of the D26 Workbench work lands** — treat it as the next major planning push, not a someday item. J27 specifics (exactly what is collected up front, timing, final table shape) are **not yet decided** — re-confirm with Justin/Connor before building.
