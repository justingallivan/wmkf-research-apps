---
title: "Request Workbench — Proposal Tab + Field Primer persistence (build plan)"
domain: architecture
kind: plan
status: historical
summary: Historical S258 build plan for the Workbench Proposal tab and Field Primer persistence, now shipped.
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - "pages/workbench/[requestId].js"
  - lib/services/field-primer-service.js
  - docs/atlas/dataverse-akoya-request.md
  - docs/mockups/lifecycle-ui-mockup.html
---

# Request Workbench — Proposal Tab + Field Primer persistence (build plan)

> **Current routing:** Historical S258 implementation record. Its statements
> that Field Primer and Reviewer Finder ingest `ProjectDescription.pdf` are
> superseded: Initial Assessment and Field Primer now require
> `AI Materials/ProposalNarrative_{Request#}.pdf`; the current-cycle Reviewer
> Finder independently prefers the outbound reviewer package and has one exact
> Phase I fallback. The Proposal tab itself displays the exact external-reviewer
> `Reviewer Materials/Proposal_{Request#}.pdf` first, followed by the canonical
> AI Materials, D26 Phase I slots, and files beneath the request's `Phase II`
> folder. Use
> `shared/components/workbench/ProposalTab.js` and the current Workbench roadmap
> for live behavior and follow-up work.

**Status at drafting:** spec / pre-design (S258, 2026-06-14). The Proposal tab and Field Primer persistence subsequently shipped.
**Cycle:** D26. Several pieces are deliberately interim (see "J27 / out of scope").
**Owner surfaces:** `pages/workbench/[requestId].js`, `lib/services/field-primer-service.js`, `docs/atlas/dataverse-akoya-request.md`.

**[VERIFIED IN PRODUCTION 2026-08-20]** Signed-in, read-only Request
`1002379` displayed all ten files beneath its SharePoint `Phase II` folder:
`Bibliography.pdf`, `Biographical Sketches.pdf`,
`Collaborative Arrangements.pdf`, `Financial Narrative.pdf`,
`Graphical Abstract.pdf`, `Project Budget.pdf`, `Project Narrative.pdf`,
`Proposal Abstract.docx`, `Proposal Cover Page.docx`, and
`Recognition Statement.docx`. The `Bibliography.pdf` View action opened the
inline Chrome PDF viewer with the correct filename. Its Download action
produced a valid 756,947-byte PDF, while the production proxy returned 200 and
the terminal Graph drive-item read returned 2xx. PDF rows expose View and
Download; Word rows correctly expose Download only. Request `1002788` had no
Phase II files and therefore was not a valid populated display fixture.

## 1. Goal

Light up the **Proposal** tab in the per-request Workbench (today a `This panel is
coming in a later update.` placeholder — `pages/workbench/[requestId].js:150`) as a
read-the-proposal-in-app surface, and give the **Field Primer** (built S248, currently
CLI/route-only with no UI and no persistence) its first staff UI + a persisted home.

Per the mockup role note, the Proposal tab is the "in-app proposal viewer that
replaces the SharePoint read-pain workaround" (`docs/mockups/lifecycle-ui-mockup.html`).

## 2. Scope

**In:** the Proposal tab, three stacked sections (below); Field Primer PD-triggered
generation + persistence + regenerate; the enabling route/app-access/helper work.

**Out (not part of this historical Proposal-tab slice):**
- `wmkf_requestdocument` direct artifact references. The Initial Assessment
  pilot implemented this registry in source on 2026-07-29; live provisioning
  remains gated. D26 proposal-input discovery still uses the SharePoint
  filename-match bridge. See `[[project-j27-doc-capture-evolution]]`.
- ~~Un-scaffolding the reviewer hold step (contingent on J27 single-submission).~~
  Done early — the hold step was RETIRED in S279 (onboarding-at-accept), independent of J27.
- Rendering the structured budget (`wmkf_proposalbudgetline`) — show the two scalar
  amounts only.

## 3. Sections (top → bottom)

### 3.1 Top — proposal info (Dataverse, read-only) — all VERIFIED
| Field shown | Dataverse source | Note |
|---|---|---|
| PI | `wmkf_projectleader` (→ contacts) | formatted value |
| Co-PIs | `wmkf_apprequestperson` junction, `wmkf_role = 100000001` (Co-PI), ordered by `wmkf_authorposition` | **names only** (Justin S258); **junction-only** — UNION applies to PI *history*, NOT co-PI display (Codex S258, corrected). Reusable precedent: `fetchCoPIs()` in `pages/api/external/review/[token]/context.js` — extract to a shared helper, don't re-implement. Legacy `wmkf_copi1..5` retired |
| Abstract | `wmkf_abstract` | |
| Requested Amount | `akoya_request` | NOT `akoya_request_base`; verified $1.3M on 1002836 |
| Total Project Budget | `akoya_expenses` | = `akoya_request` + `wmkf_totalothersources`; verified $1.56M on 1002836 |

Caveat (display only on D26-native rows anyway): `akoya_request`/`akoya_expenses` are a
backfill artifact on *migrated/historical* rows — real for native intake rows.

### 3.2 Middle — Phase I documents (SharePoint, download links)
List the request's SharePoint files recursively, keep those under the **`Phase I`**
subfolder, map by exact filename to four labeled rows, **excluding `Application Cover
Page.docx`** (redundant — it's the Top section):

| Label | Filename (D26 convention) |
|---|---|
| Project Description (the proposal) | `ProjectDescription.pdf` |
| Biosketches | `Biosketches.pdf` |
| Project Budget | `ProjectBudget.pdf` |
| Project Budget spreadsheet | `Project Budget spreadsheet.xlsx` |

- **Surface-don't-drop:** render the 4 labeled slots (grey if missing) + an "Other
  documents" group for any unmatched Phase I file.
- **Name map lives in one per-cycle config** — filename-match is fragile (names *may* change between cycles; no evidence J27 specifically breaks it); never hard-code as permanent.
- `ProjectDescription.pdf` is the SAME file the primer + reviewer-finder ingest (not a
  separate doc); the existing `classifyFile()` already tags it `proposal`.

### 3.3 Bottom — AI content
| Label | Source | State |
|---|---|---|
| AI Fit Rationale | `wmkf_ai_fitrationale` | existing live field |
| AI Summary | `wmkf_ai_summary` | existing (avoid cruft `wmkf__ai_summary`) |
| AI Extracted Data | `wmkf_ai_dataextract` (JSON) | existing |
| Field Primer | **`wmkf_ai_fieldprimer` (NEW)** | PD-triggered generate → persist → regenerate |

## 4. Field Primer persistence (the one net-new capability)

- **New Dataverse Memo field `wmkf_ai_fieldprimer`** (JSON envelope: the 9 primer
  sections + expert-grounding verdicts + provenance `model/runId/promptName/promptVersion`
  + `generatedAt`). The Executor DOES expose `meta.promptName`/`meta.promptVersion`/
  `meta.modelUsed` (`execute-prompt.js:147-156`, returned in `meta`); the field-primer
  wrapper currently drops promptName/promptVersion (`field-primer-service.js:72`) — surface
  them from the wrapper (or read `result.meta` in the route) and persist REAL values, not null
  (Codex S258, verified). `generatedAt` is NOT from the Executor — stamp it at envelope-write
  time. Mirrors `wmkf_ai_dataextract` (Memo-JSON) and the v3 naming convention.
- **Lifecycle:** field null → show a plain "Generate field primer" button (NO LLM-cost/confirm
  warning — staff know it's an AI call, Justin S258); populated → render + "Regenerate"
  (bypasses skip-if-populated overwrite guard).
- **Route gains a `requestId` mode:** pull the proposal (`ProjectDescription.pdf` via the
  shared classifier) from SharePoint, extract, generate, **ground experts**, then write the
  JSON back. The write happens AFTER grounding (so the stored blob carries OpenAlex verdicts)
  → explicit `updateRecord`, not the Executor's raw-output writeback.
- **Re-check before persist (Codex S258):** unless `regenerate=true`, re-read
  `wmkf_ai_fieldprimer` immediately before the `updateRecord` and skip the write if it's now
  populated — avoids clobbering a primer generated concurrently in another tab.
- **App-access:** route is gated `reviewer-finder`; Workbench is `reviewers`. Accept `reviewers`.

## 5. Cross-cutting

- **Reuse `classifyFile`** — defined in 9 files (8 scripts + the exported canonical copy in
  `grant-reporting/lookup-grant.js`); `load-proposal.js` already imports the canonical copy.
  Reuse it; do not add another copy. **But do NOT blindly collapse `pickProposalBestGuess`
  (Codex S258):** its preference diverges across callers — `lookup-grant` prefers `.docx`,
  while `load-proposal` + the primer CLI prefer `.pdf`. Only centralize the picker if it takes
  an explicit format-preference arg; the proposal/primer path passes PDF preference.
- **Data load:** extend `pages/api/workbench/resolve-request.js` (or add a sibling
  proposal-tab endpoint) to select the Top + AI fields; documents via the separate
  `proposal-documents` endpoint (decided — see §8).
- **Downloads:** record-scoped private proxy via Graph `downloadFile`, gated `reviewers` +
  request scope (model on `dynamics-explorer/download-document.js`).

## 6. Dependencies / prerequisites

- **Schema deploy (external, Justin/Connor):** create `wmkf_ai_fieldprimer` (PUT+publish, not
  PATCH — `[[project-dataverse-schema-deploy-gotchas]]`). Code is written against it; the
  deploy is a separate step. Add to `docs/atlas/dataverse-akoya-request.md` after.

## 7. Reuse inventory (lean on, don't rebuild)

`getRequestSharePointBuckets` + `GraphService.listFiles({recursive:true})` (already used by
`load-proposal.js`, the primer CLI, the Executor) · `classifyFile` (proposal pick) ·
field-primer service + prompt (`field-primer.generate`, live in prod `wmkf_ai_prompts`) ·
the download-document proxy pattern · `ReviewersTab` as the panel-component precedent.

## 8. Design questions — resolved

Resolved (Codex design pass, S258):
1. **Endpoints:** extend `resolve-request` for Dataverse info + AI fields (same authoritative
   context the shell already loads); a SEPARATE `proposal-documents` endpoint (Graph failures
   stay independently tolerable) + a SEPARATE `download-proposal-document` proxy (binary
   streaming + per-request scope verification).
2. **Primer generate: synchronous** (route already `maxDuration:800`). Background deferred —
   it'd need a durable job/status surface, out of D26 scope.
3. **Per-cycle map:** `shared/config/workbenchProposalDocuments.js` —
   `PROPOSAL_DOCUMENT_CONFIG_BY_CYCLE` + `getProposalDocumentConfig(cycleCode)`; D26 entry =
   `phaseFolder:'Phase I'`, `excludeFilenames:['Application Cover Page.docx']`, ordered slots
   `{key,label,filename}`. Route returns resolved slot data so the UI duplicates no matching.

Resolved (Justin, S258):
- **Co-PI display: names only** (not role/effort) — see §3.1.
- **Primer generate UX: plain button, no LLM-cost/confirm warning** — staff know — see §4.

## 9. Done = 

Build + lint + relevant `check:*` gates (api-routes, atlas, model-override-warming,
prompt-injection-tagging if the prompt surface changes) green; the §8 design questions
resolved (done); Atlas updated for the new field.
