# Group B — Writeup Spine: Design Proposal

**Audience:** Justin + Connor  
**Status:** Design — not yet built; pending Connor's input on Dataverse schema and PA flow  
**Date:** 2026-06-16

---

## The Problem We Are Solving

### 1. Dataverse knows folders, not files

When the Workbench apps need a proposal document, they find it by listing the request's
SharePoint folder and matching on a known filename — `ProjectDescription.pdf`,
`Biosketches.pdf`, etc. Dataverse holds the folder location on the request record, but
has no awareness of what specific files are inside it or what role each file plays.

This works today because filenames are consistent within a cycle. It will break for J27,
which will use different file-naming conventions and a different collection mechanism. Any
logic built on filename matching is an explicitly interim bridge, not a durable pattern.

### 2. Staff-produced writeups have the same problem

The Phase I initial writeups that staff produce manually today live in a SharePoint folder.
Dataverse has no reference to the individual writeup files — only to the folder. At the end
of the cycle they get moved back into the request's main SharePoint folder alongside the
other documents, but that move does not create a Dataverse record of them either.

This means:
- The apps cannot reliably locate or display a specific request's writeup
- There is no machine-readable link between a request record and its writeup document
- If we auto-generate writeups in a future cycle, we have nowhere structured to store them
  that the apps can read back

### 3. The single-folder browsing problem

One real advantage of the current system is that leadership (including the President) can
open a single SharePoint folder and see every writeup for a cycle in one place. They can
open any file in Word, make edits, and everyone sees the changes in real time via
Office's co-authoring.

Any new system needs to preserve this capability. Storing writeup text as a plain field
in a Dataverse record would lose it — Dataverse field editing does not support real-time
co-authoring.

---

## The Proposed Architecture

### Core principle: SharePoint holds the document, Dataverse holds the pointer

Rather than storing the writeup text in Dataverse, we store the **direct SharePoint file
URL** in a new field on `akoya_request`. This gives us:

| Capability | Current system | Proposed system |
|---|---|---|
| Dataverse knows where the file is | No (folder only) | Yes (direct URL) |
| Apps can display the writeup | No | Yes (via Graph API) |
| Co-authoring in Word | Yes | Yes (Open in Word link) |
| Single view of all writeups | SharePoint folder | Executive dashboard (see below) |
| Workbench tab can generate + show the writeup | No | Yes |
| PA can auto-generate the draft | No | Yes (write to SharePoint, store URL back) |

### New Dataverse fields

Two new fields on `akoya_request`, one per writeup type:

| Proposed name | Writeup type | Set by | Read by |
|---|---|---|---|
| `wmkf_ai_initialwriteupurl` | Initial Writeup | PA (J27+ auto-generation) or manual paste | Initial Writeup tab, Executive Dashboard |
| `wmkf_ai_presitevisitwriteupurl` | Pre-Site-Visit Writeup | Staff via Workbench tab (D26) or PA (future) | Pre-Site-Visit tab, Executive Dashboard |

Storing a direct SharePoint URL on a request-related record is the same direction as the
planned `wmkf_apprequestperson.wmkf_nurl` biosketch URL field (part of the J27 intake
schema, not yet built) — these two fields would be early instances of the converging
`wmkf_requestdocument` table pattern Connor and Justin are discussing.

### How the Workbench tabs use the fields

The tabs are part of the per-request Workbench (`/workbench/<requestId>`). They receive
the request context, which is already loaded on mount from `/api/workbench/resolve-request`.
That route already returns an `aiContent` block with other `wmkf_ai_*` fields from the
request record (field primer, fit rationale, summary). Both URL fields slot in alongside
those.

Tab behaviour (same pattern for both tabs):
- **URL is set:** fetch and render the document content via Microsoft Graph API; show an
  "Open in Word" button that opens the SharePoint URL directly (preserving co-authoring)
- **URL is null:** show a "Generate draft" button that calls the Executor with the
  appropriate prompt row, writes the output to SharePoint, and stores the URL back

### Generation flow — two modes

**D26 Pre-Site-Visit (staff-triggered from Workbench tab, this cycle):**

1. Staff opens the Pre-Site-Visit tab for a request and clicks "Generate draft"
2. The tab calls the Executor with the `writeup.pre-site-visit` prompt row from `wmkf_ai_prompt`
3. The Executor fetches the proposal document from SharePoint (D26: `ProjectDescription.pdf` — filename convention will change for J27), extracts text, runs the prompt
4. The output Word doc is written to the request's SharePoint folder via Graph API
5. The direct file URL is stored back in `akoya_request.wmkf_ai_presitevisitwriteupurl`
6. The tab renders a preview + "Open in Word" link; staff edits and co-authors in Word

**Graph API write access is CONFIRMED** (probed 2026-06-16 via `scripts/probe-graph-write-access.mjs`
against request 1002788 — upload + delete sentinel succeeded). The manual URL-paste fallback
is not needed for D26.

**J27+ Initial Writeup (PA auto-triggered on triage = Advancing):**

1. PA calls the Executor with the `writeup.initial` prompt row from `wmkf_ai_prompt`
2. Executor fetches the proposal document from SharePoint, extracts text, runs the prompt
3. PA writes the output as a Word document to the request's SharePoint folder
4. PA writes the direct file URL back to `akoya_request.wmkf_ai_initialwriteupurl`

In both modes, the same prompt row drives generation — PA-triggered or staff-triggered,
the text the President reads is always produced by the same instruction set.

### The Executive Dashboard

A separate lightweight app (proposed key: `executive-review`) that gives leadership a
single view across all requests in a cycle:

- Queries `akoya_request` filtered to the current cycle + triage = Advancing
- For each request, shows title, PI, institution, and either:
  - An inline preview of the writeup content (via Graph API), or
  - A prominent "Open in Word" link
- Shows both the Initial Writeup and Pre-Site-Visit Writeup where available
- Filterable by program type, cycle, PD
- Does not replace the PD-facing Workbench; it is an editorial/review surface, not a
  task-management one

This replaces the "open the SharePoint folder" workflow for leadership while preserving
Word co-authoring for edits. The President gets a URL she can bookmark; she does not need
to know what the Workbench is.

---

## Current Cycle (D26) — Posture

| Writeup type | D26 status | Plan |
|---|---|---|
| Initial Writeup | Done manually; files in SharePoint | No backfill — effort not worth it for a nearly-complete cycle. Initial Writeup tab shows empty state for D26. |
| Pre-Site-Visit Writeup | Not yet started | **Build and use the new system for D26.** Staff generates via the Workbench tab; output stored in SharePoint with URL in Dataverse. |

The Pre-Site-Visit tab is the first live use of this architecture. D26 is the pilot cycle.

---

## What Needs to Happen Before Building

### Connor's inputs needed

1. **Confirm both field names** (`wmkf_ai_initialwriteupurl`, `wmkf_ai_presitevisitwriteupurl`)
   on `akoya_request` and add them in Dataverse (same process as the other `wmkf_ai_*` fields)
2. ~~**Graph API read + write access**~~ — **CONFIRMED 2026-06-16** (`scripts/probe-graph-write-access.mjs`
   against request 1002788; upload + delete sentinel succeeded). No additional permissions needed.
3. **PA flow design** — how the J27 auto-generation flow writes the Word doc to SharePoint
   and writes the URL back to the request record; whether this is a child flow or standalone
4. **Prompt rows** — author `writeup.initial` and `writeup.pre-site-visit` rows in
   `wmkf_ai_prompt` before building begins (see Prompt migration below)

### Prompt migration

Both writeup prompts currently live as hardcoded JavaScript modules:
- `shared/config/prompts/phase-i-writeup.js` → migrate to `wmkf_ai_prompt` as `writeup.initial`
- `shared/config/prompts/proposal-summarizer.js` → migrate to `wmkf_ai_prompt` as `writeup.pre-site-visit`

Per the established architectural direction (`project-dynamics-as-prompt-ground-truth`),
staff-facing prompts belong in Dataverse so any staff member can read and edit them without
touching the codebase, and so PA and the Workbench call the same prompt row. This migration
should happen before the D26 Pre-Site-Visit build begins.

### App suite changes (Vercel side, after Dataverse fields and prompt rows exist)

1. Update `pages/api/workbench/resolve-request.js` to select and return both URL fields
   in the `aiContent` block
2. Build `shared/components/workbench/InitialWriteupTab.js` — reads URL from context,
   fetches content via Graph, shows preview + Open in Word button (empty state for D26)
3. Build `shared/components/workbench/PreSiteVisitWriteupTab.js` — same pattern, plus
   "Generate draft" button calling the Executor; writes output to SharePoint via Graph API
   (write access confirmed 2026-06-16) and stores URL back in Dataverse
4. Wire both tabs into `pages/workbench/[requestId].js` (slots already exist as placeholders)
5. Build the Executive Dashboard (separate page, separate app key, `executive-review` grant)

---

## Open Questions for Connor

1. Are `wmkf_ai_initialwriteupurl` and `wmkf_ai_presitevisitwriteupurl` the right field
   names, or does he prefer a different convention?
2. ~~Does the existing app registration support Graph API write access to SharePoint folders?~~
   **CONFIRMED 2026-06-16** — write access verified via probe; no manual URL-paste fallback needed.
3. Is the PA write → SharePoint → URL writeback pattern straightforward in the PA
   toolset, or are there constraints we should know about?
4. Should the executive dashboard be a separate Dataverse app access key, or can
   leadership get `reviewers` access (which would give them the full Workbench too)?
