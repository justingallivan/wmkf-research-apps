---
name: J27 document capture & Proposal-tab evolution
description: D26 resolves request docs by SharePoint filename-match — a FRAGILE interim bridge (no evidence it "breaks in J27"; only breaks if names change). Durable direction = Dataverse legibility (structured doc references the apps read back; strongest driver = auto-generated writeups need a structured home). (The reviewer hold step that single-submission might once have un-scaffolded was already RETIRED in S279.) Large near-term planning effort.
type: project
status: active
scope: strategy
last_verified: S258 (2026-06-14) via user (Justin) + source/Atlas grounding; J27 specifics not yet decided
---

## Recall Rule

Read this when: building/maintaining the **Request Workbench → Proposal tab** document section, writing any SharePoint document-resolution for a request, planning **J27** document collection, or considering changes to the reviewer **hold step**. Pairs with [[project-grant-phasing-evolution]] (the phasing mechanics — single-submission, "Phase II" = status flip).

## The decision picture (S258, Justin + Connor)

**D26 document resolution is an INTERIM BRIDGE — do not treat it as permanent.** The Proposal tab (and the field primer / reviewer-finder proposal-text path) locates documents by listing the request's SharePoint **`Phase I` subfolder** and matching **consistent filenames** for this cycle: `ProjectDescription.pdf` (the proposal — same file the primer + reviewer finding ingest, NOT a separate doc), `Biosketches.pdf`, `ProjectBudget.pdf`, `Project Budget spreadsheet.xlsx`; `Application Cover Page.docx` is excluded (it's the Dataverse-derived top panel). The existing `classifyFile()` heuristic already tags `ProjectDescription` as the proposal and budget/biosketch/cover as `other`.

**Filename-match is FRAGILE — but do NOT assert it "will break in J27."** (Corrected S265, Justin: the earlier "J27 will use new naming conventions / a different collection mechanism, so filename-match WILL break" claim was **unsubstantiated** — Connor pushed back on dropping filename-reconciliation on that premise. There is **no evidence** J27 changes naming; filename-match only breaks **if the names actually change**, which isn't established.) The real, durable case for moving OFF filename-match is **fragility + Dataverse legibility**, NOT a J27-will-break prediction: it depends on PDs naming files consistently/correctly, with **no structured fallback** when they don't. **Strongest argument:** if we **auto-generate writeups** in a future cycle, there is **nowhere structured to store them that the apps can read back** — a filename heuristic can't anchor a machine-produced doc that a PD may never (re)name correctly. Keep the D26 name→label map in one small per-cycle config; never hard-code D26 names as permanent (consistent with [[project-grant-phasing-evolution]]).

**Converging target (Justin + Connor discussing — NOT yet decided): associate documents with a Dataverse table on the request** so the app points at each doc **directly** instead of folder-walking + filename heuristics. Shape under consideration: a child table (e.g. `wmkf_requestdocument`) = `request lookup + doc-type picklist + direct reference (SharePoint URL / Graph driveItem id) + filename + content-type`. This **realizes the already-durable S157 intent**: "move doc-resident knowledge onto Dataverse **tables** (structured/legible/searchable); doc-link surfacing is an interim bridge" (Atlas `docs/atlas/dataverse-akoya-request.md` §era; [[project-dataverse-power-tools]]). Precedent for a doc-reference-on-a-row already exists: `wmkf_apprequestperson.wmkf_biosketchurl`. Natural **producer = the intake portal** (machine-legible capture, private Blob via `INTAKE_BLOB_RW_TOKEN`) — see [[project-machine-legible-form-capture]] and the intake-portal memories. Treat this as **strong, accumulating evidence for the table direction**, not a settled build.

**Hold step already RETIRED (S279) — this contingency resolved early, for a different reason.** The reviewer "hold step" ([[project-reviewer-hold-step-decouple]]) was removed in S279 (commit `a8676af1`) when the direction shifted to onboarding at a single final Accept — independent of J27. So the earlier "single-submission may un-scaffold the hold step" note is now moot: there is no hold step left to un-scaffold. (Kept here only so the J27 doc-capture planning doesn't re-raise it.)

## Sequencing / urgency (user, S258)

J27 design is a **large planning effort with many moving parts** that must **start soon after the bulk of the D26 Workbench work lands** — treat it as the next major planning push, not a someday item. J27 specifics (exactly what is collected up front, timing, final table shape) are **not yet decided** — re-confirm with Justin/Connor before building.
