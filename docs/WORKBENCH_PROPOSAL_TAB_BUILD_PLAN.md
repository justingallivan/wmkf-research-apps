# Request Workbench — Proposal Tab + Field Primer persistence (build plan)

**Status:** spec / pre-design (S258, 2026-06-14). Input to the Codex design loop.
**Cycle:** D26. Several pieces are deliberately interim (see "J27 / out of scope").
**Owner surfaces:** `pages/workbench/[requestId].js`, `lib/services/field-primer-service.js`, `docs/atlas/dataverse-akoya-request.md`.

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

**Out (J27 / future, do NOT build here):**
- `wmkf_requestdocument` Dataverse table for direct doc references — converging but
  undecided; D26 uses the SharePoint filename-match bridge. See
  `[[project-j27-doc-capture-evolution]]`.
- Un-scaffolding the reviewer hold step (contingent on J27 single-submission).
- Rendering the structured budget (`wmkf_proposalbudgetline`) — show the two scalar
  amounts only.

## 3. Sections (top → bottom)

### 3.1 Top — proposal info (Dataverse, read-only) — all VERIFIED
| Field shown | Dataverse source | Note |
|---|---|---|
| PI | `wmkf_projectleader` (→ contacts) | formatted value |
| Co-PIs | `wmkf_apprequestperson` junction (UNION-read w/ projectleader, per `contact-history.js`) | legacy `wmkf_copi1..5` retired |
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
- **Name map lives in one per-cycle config** — filenames change in J27; never hard-code as permanent.
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
  sections + expert-grounding verdicts + provenance `generatedAt/model/runId/promptVersion`).
  Mirrors `wmkf_ai_dataextract` (Memo-JSON) and the v3 naming convention.
- **Lifecycle:** field null → show "Generate field primer" button; populated → render +
  "Regenerate" (bypasses skip-if-populated overwrite guard).
- **Route gains a `requestId` mode:** pull the proposal (`ProjectDescription.pdf` via the
  shared classifier) from SharePoint, extract, generate, **ground experts**, then write the
  JSON back. The write happens AFTER grounding (so the stored blob carries OpenAlex verdicts)
  → explicit `updateRecord`, not the Executor's raw-output writeback.
- **App-access:** route is gated `reviewer-finder`; Workbench is `reviewers`. Accept `reviewers`.

## 5. Cross-cutting

- **Consolidate `classifyFile`/`pickProposalBestGuess`** — `classifyFile` is defined in 9
  files (8 scripts + the exported canonical copy in `grant-reporting/lookup-grant.js`);
  `load-proposal.js` already imports that canonical copy. Reuse it; do not add another copy.
- **Data load:** extend `pages/api/workbench/resolve-request.js` (or add a sibling
  proposal-tab endpoint) to select the Top + AI fields; Codex to decide one-endpoint-vs-two.
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

## 8. Open questions for the design pass

1. One proposal-tab endpoint vs. extend `resolve-request` + a separate docs endpoint?
2. Primer generate: synchronous request (route `maxDuration` is already 800s) vs. background?
3. Where exactly does the per-cycle filename→label map live (config module shape)?
4. Co-PI display: how much of the junction to surface (names only vs. role/effort)?

## 9. Done = 

Build + lint + relevant `check:*` gates (api-routes, atlas, model-override-warming,
prompt-injection-tagging if the prompt surface changes) green; the four open questions
resolved in the Codex design before implementation; Atlas updated for the new field.
