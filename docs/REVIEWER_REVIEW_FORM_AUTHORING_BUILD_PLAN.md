# Reviewer Review-Form — In-Browser Authoring Build Plan

**Status:** **PLAN — build-ready, not started.** Drafted 2026-06-28 (Session 300). All scoping inputs and lifecycle decisions resolved: question wording supplied (§2); Justin + Claude create the Dataverse columns (§3a); formatting = standard set (§4 #A); submit is final/read-only (§9 #C); all free-text required except Q11 (§9 #E). Only #D (draft GC interval) is a minor Phase-5 detail. No code written yet — Phase 0 (column creation) is the next action.

**Date:** 2026-06-28

**Owner decision captured (S300):** Justin chose, via the four scoping forks:
1. **System of record = Dataverse columns.** On submit, each answer is written to a multiline-text column on the suggestion row (same pattern as the ratings today). Drafts/autosave live in Postgres.
2. **Editor = full WYSIWYG (tiptap).** Outputs HTML, sanitized server-side with `sanitize-html`.
3. **File uploads = keep the infrastructure, hide from the UI.** Do **not** delete `writeReviewFiles` / the `/upload` route / virus-scan / SharePoint code. Remove the upload UI from the reviewer-facing form and document the dormant capability so we can re-enable it later.
4. **Process = write this plan first**, optional Codex design pass before implementation.

**Predecessors:** `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md` (token lifecycle + the original schema-capture design), `docs/INTAKE_PORTAL_DESIGN.md` + `docs/INTAKE_PORTAL_DRAIN_PLAN.md` (the Postgres draft/autosave pattern we mirror).

---

## 1. What we're changing

**Today** [VERIFIED via source, S300] the reviewer "submit your review" surface (`view === 'stage2b'`) is:
- `shared/components/external/MaterialsView.js` — ProposalCard + FilesCard + an UploadCard that bundles a **file upload** (1–5 files, PDF/DOCX/DOC, ≤25 MB) with the structured form.
- `shared/components/external/ReviewFormFields.js` walks `lib/external/review-form-schema.js`: affiliation (text) + Q1 impact / Q3 risk / Q10 overall (radio picklists). **The substantive narrative (Q2, Q4–Q9, Q11) lives only in the uploaded PDF.**
- `lib/services/review-upload.js::writeReviewFiles` is the single write path (token + staff): validates files + form, virus-scans, uploads to SharePoint, then **one Dataverse PATCH** to `wmkf_appreviewersuggestion` (sharepoint folder, filename, `wmkf_reviewreceivedat`, the three picklists, affiliation, staff flag), then tightens the token expiry.
- `pages/api/external/review/[token]/context.js` GET assembles proposal/reviewer/files/prefill/`formSchema` and computes `engagementState`. There is **no draft/autosave** — one atomic submit.
- Staff read-back: `shared/components/workbench/ReviewsTab.js` → `GET /api/review-manager/reviewers` projects the three ratings + a SharePoint download link.

**Target:** the narrative moves *into the page*. Reviewers answer every question in the browser with a rich-text editor, work is autosaved, and on submit the answers become the system-of-record on Dataverse. The file upload is hidden (infra retained).

---

## 2. Question set

The PDF review template has 11 questions. Canonical wording **[VERIFIED via the reviewer-questions source supplied S300]** — Q1/Q3/Q10 are already-built radios (left here for reference); Q2/Q4–Q9/Q11 are the new in-form rich-text fields:

| PDF Q | Wording | Target | Required |
|---|---|---|---|
| Affiliation | Title & Organization | plain text (unchanged) | yes |
| Q1 | If the proposed project is successful in its entirety, how will it impact the field? | radio (unchanged) | yes |
| Q2 | What specific significant impacts do you foresee? | **rich-text (new)** | yes* |
| Q3 | The Keck Foundation is comfortable funding risky projects. How risky is the project overall? | radio (unchanged) | yes |
| Q4 | What are the risks associated with the project? Are the risks technical (such as the ability to make a molecule, build an instrument, or make a measurement)? Are the risks related to a hypothesis (i.e., the idea could be wrong)? Is the team trying to do too much? | **rich-text (new)** | yes* |
| Q5 | Are the methods, data gathering, and/or analysis appropriate for the project to be successful? | **rich-text (new)** | yes* |
| Q6 | Are there questions or issues that the Foundation should raise with the PI before making an award? | **rich-text (new)** | yes* |
| Q7 | Do you believe the team has the necessary personnel and infrastructure to perform the work? | **rich-text (new)** | yes* |
| Q8 | The Foundation strives to support projects that would not likely be funded elsewhere. Do you think this project in its current form could likely be supported by a traditional funding agency? | **rich-text (new)** | yes* |
| Q9 | Are there any issues with the budget? | **rich-text (new)** | yes* |
| Q10 | Please assign an overall rating to the proposal. | radio (unchanged) | yes |
| Q11 | Is there anything else you'd like to share with the Foundation about the proposal or this review process? | **rich-text (new)** | **optional** |

So the schema grows from 4 fields to 12: 1 plain text + 3 radios (unchanged) + **8 new rich-text fields**. Q11 is explicitly optional; **[DECISION #E, §9]** confirms whether Q2/Q4–Q9 (`yes*`) are all hard-required to submit.

The schema (`review-form-schema.js`) stays the single source of truth. Add a new field `type: 'richtext'` alongside `'string'` and `'picklist'`, each with its `dataverseField`, `required`, and label.

---

## 3. Data model

### 3a. Dataverse (system of record — final answers)

**[INPUT #2 RESOLVED — Justin + Claude create the columns together (not Connor-gated).]** Create one **Multiple Lines of Text** column per new free-text question on `wmkf_appreviewersuggestion`. Proposed names keep the existing `wmkf_reviewer*` family (parallel to `wmkf_revieweraffiliation` / `wmkf_reviewerimpact`) — finalize at creation time:

| Q | Proposed column |
|---|---|
| Q2 | `wmkf_reviewerimpactdetail` |
| Q4 | `wmkf_reviewerriskdetail` |
| Q5 | `wmkf_reviewermethods` |
| Q6 | `wmkf_reviewerpiquestions` |
| Q7 | `wmkf_reviewerteamcapacity` |
| Q8 | `wmkf_reviewerfundingelsewhere` |
| Q9 | `wmkf_reviewerbudgetissues` |
| Q11 | `wmkf_revieweradditionalcomments` |

Settings for each:
- Type: Multiple Lines of Text.
- **Max length generous** (e.g. 100k+; Dataverse supports up to 1,048,576). Stored content is **sanitized HTML**, which is bulkier than plain text.
- These mirror the existing `wmkf_reviewerimpact/risk/overallrating` columns as the durable review record.

We store **sanitized HTML** (tiptap output run through `sanitize-html` — see §5). No new Dataverse picklists, so no `check:status-enum-parity` impact for these.

### 3b. Postgres (drafts / autosave)

New table `review_drafts` via a numbered migration (`lib/db/migrations/021_review_drafts.sql` + manifest). Mirrors `intake_drafts` but **simpler** (no attachments, no async drain — submit is synchronous):

```
review_drafts(
  id            bigserial primary key,
  suggestion_id uuid not null unique,   -- the wmkf_appreviewersuggestion GUID
  draft_json    jsonb not null default '{}'::jsonb,  -- answers keyed by field.key
  updated_at    timestamptz not null default now()
)
```

`ReviewDraftService` (cousin of `IntakeDraftService`): `getBySuggestion`, `upsertDraftJson` (autosave — touches only `draft_json` + `updated_at`, `ON CONFLICT (suggestion_id)`), `delete`, `deleteExpired`. No idempotency-key/UUID dance (no async drain to collide with); no `attachments`/`pending_attachments`.

**Why Postgres for drafts:** autosave fires many times per session; Dataverse is the wrong store for high-frequency partial writes. Same reasoning as intake. The draft is a scratchpad; Dataverse is the commit target.

---

## 4. Editor & sanitization

- **Dependency:** add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`. New component `shared/components/external/RichReviewEditor.js` — a controlled tiptap instance with a small toolbar.
- **[DECISION #A RESOLVED — standard set.]** Allowlist: bold, italic, bullet/numbered lists, H2/H3, blockquote, links. **No images, no tables**, no raw HTML paste (strip on paste).
- **Sanitizer:** `lib/external/sanitize-review-html.js` using **`sanitize-html`** (DOM-free — **must not** use DOMPurify+jsdom; that combination does not load in Vercel/Turbopack serverless, see memory `project-jsdom-serverless-esm-incompat`). Allowlist mirrors the editor's capabilities (tags: `p,br,strong,em,b,i,ul,ol,li,h2,h3,blockquote,a`; `a` keeps `href` only, forced `rel="noopener nofollow"`, `http/https/mailto` only).
- **Trust boundary:** reviewer HTML is **untrusted content rendered to staff** in the workbench → stored-XSS risk. Sanitize **server-side on every write** (autosave PUT and submit) — the client editor is a convenience, not the boundary. Sanitize **again on render** in the workbench (defense in depth) before `dangerouslySetInnerHTML`.

---

## 5. Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/external/review/[token]/draft` (new) | GET | token | Return saved `draft_json` so the editor rehydrates on return visits. |
| `/api/external/review/[token]/draft` (new) | PUT | token | Debounced autosave. Sanitize each rich-text answer, `upsertDraftJson`. Gated on materials-sent (same gate as `/upload`). **Refuses once the suggestion is submitted** (`wmkf_reviewreceivedat` set) — submit is final (§9 #C). |
| `/api/external/review/[token]/submit` (new) | POST | token | Final submit. Validate all fields (ratings + Q2/Q4–Q9 + affiliation required, Q11 optional — §2/§9 #E), sanitize, **PATCH the new Dataverse columns + `wmkf_reviewreceivedat`**, then delete the draft and tighten the token window. Reuses the non-file half of `writeReviewFiles` logic. |
| `/api/external/review/[token]/context.js` | GET | token | Extend `prefill` to include the new fields (from the draft if present, else from Dataverse if already submitted) and expose the new schema. |
| `/api/external/review/[token]/upload.js` | POST | token | **Unchanged but hidden from UI.** Stays wired for staff/future use. |
| `/api/review-manager/reviewers` | GET | session | Extend projection with the new Dataverse columns for workbench read-back. |

All new routes register in `docs/API_ROUTE_SECURITY_MATRIX.md` and pass `check:api-routes`. They're public token surfaces → preserve expiry, row binding, rate-limit, and replay guards (`.claude/rules/external-reviewers.md`).

The shared submit logic (validate → sanitize → Dataverse PATCH → token-window tighten) should be factored so the token submit and a possible staff submit can't drift — same principle as `writeReviewFiles` today.

---

## 6. Staff read-back (workbench)

`ReviewsTab.js` gains, per submitted reviewer, the rendered narrative answers (sanitized HTML) beneath the existing rating cells. The SharePoint download link becomes secondary (shown only when a file actually exists, since uploads are hidden going forward). `/api/review-manager/reviewers` projection extended accordingly.

**[#B — deferred default]** Panel-prep export/roll-up of the narrative answers is out of scope (it already is for ratings). Revisit after the authoring surface ships; not a build blocker.

---

## 7. Hiding the upload (decision 3)

- Remove the file-input + "Replace your submission" file affordances from `MaterialsView.js` / `UploadCard`. The card becomes the rich-text authoring form + Submit.
- **Keep** `lib/services/review-upload.js`, `pages/api/external/review/[token]/upload.js`, the virus-scan path, `sharepoint-cleanup.js`, and the `wmkf_reviewsharepointfolder`/`wmkf_reviewfilename` columns intact.
- Document the dormant capability: a short note in `docs/agent-wiki/topics/external-reviewer-portal.md` + a memory entry so a future session knows the upload path is intentionally hidden-not-deleted and how to re-enable it.

---

## 8. Phasing (lowest-risk first)

- **Phase 0 (blocking inputs):** Justin + Claude create the Dataverse columns (§3a). Question wording + required/optional is resolved (§2). Confirm decisions #A/#B and §9.
- **Phase 1 (data layer, no UI):** migration `021_review_drafts.sql` + manifest; `ReviewDraftService`; draft GET/PUT routes with server-side sanitization; unit tests. Update Atlas (new PG table) + API matrix.
- **Phase 2 (editor):** `RichReviewEditor` (tiptap) + `sanitize-review-html.js`; schema `richtext` type; wire the authoring form into `stage2b`, replacing the file UI; autosave wired to Phase 1.
- **Phase 3 (submit + lifecycle):** `/submit` route → new Dataverse columns; `context.js` prefill from draft (pre-submit) / Dataverse (post-submit); **submit freezes the draft + locks the form read-only** (§9 #C); `submitted` view renders answers read-only.
- **Phase 4 (workbench):** ReviewsTab + reviewers projection render the narrative answers.
- **Phase 5 (cleanup + gates):** hide upload UI + document dormant infra; draft GC in maintenance cron; full gate sweep + a `stage2b` E2E (authoring + autosave + submit, mirroring `tests/e2e/reviewer-return-upload.spec.js`).

---

## 9. Lifecycle decisions

- **[DECISION #C RESOLVED — submit is final.]** Once a reviewer submits, the form **locks to read-only**; there is no edit/re-submit. This **diverges from today's "replace your submission" grace-window behavior** (which is being removed along with the upload UI anyway). Implications:
  - On submit, **freeze the draft** — the autosave PUT must refuse writes once `wmkf_reviewreceivedat` is set (mirrors intake's "draft frozen after submit" guard). Simplest: delete the draft row on successful submit, and have the draft GET/PUT treat a submitted suggestion as locked.
  - The `submitted` view (`engagementState.view === 'submitted'`) renders the reviewer's answers **read-only** (or a confirmation) — no editor.
  - A reviewer who needs to correct a submitted review contacts staff (staff can still use the retained upload/edit paths server-side).
- **[DECISION #E RESOLVED — all required except Q11.]** Q2, Q4, Q5, Q6, Q7, Q8, Q9 are hard-required to submit, alongside the 3 ratings + affiliation. Q11 is optional. Drives `required` flags in the schema and `/submit` validation. (Empty rich-text = no text content after sanitization, not merely an empty `<p></p>` — the validator must strip tags to test emptiness.)
- **[DECISION #D — draft retention/GC]** Mirror intake's `deleteExpired` (90 days) or tie GC to token expiry? Recommended: GC drafts some interval after `wmkf_externaltokenexpires`. (Minor; finalize at Phase 5.)
- **Concurrency:** single reviewer, but two-tab autosave → last-write-wins on `draft_json` is acceptable here (no async drain to corrupt, unlike intake). No idempotency key needed.

---

## 10. Gates, tests, risks

**Gates touched:** `check:migrations-manifest` (new migration), `check:atlas` (new PG table + new Dataverse-owned fields → Atlas + relevant `docs/atlas/` page), `check:api-routes` (new routes), `check:doc-currency`/`check:fact-consistency` (this plan + schema-fact updates), `check:prompt-injection-tagging` (rich text is untrusted content — confirm whether the markers apply to a stored-and-rendered surface vs an LLM-prompt surface).

**Tests:** unit — sanitizer allowlist (XSS payloads stripped), `ReviewDraftService` (upsert/get/GC), `validateReviewForm` with the new `richtext` type, submit-path Dataverse mapping. Integration — draft GET/PUT/submit routes (token gating, materials-sent gate, replay). E2E — `stage2b` authoring + autosave + submit.

**Top risks:**
1. **Stored XSS** (highest) — reviewer HTML rendered to staff. Mitigation: sanitize server-side on write *and* on render; tight allowlist; tests with attack payloads.
2. **Serverless sanitizer** — use `sanitize-html`, never DOMPurify+jsdom (memory `project-jsdom-serverless-esm-incompat`).
3. **Dataverse dependency** — the Phase 0 column creation (Justin + Claude) blocks Phases 3–4.
4. **Blast radius of hiding uploads** — keep infra; only the UI changes; verify staff/download paths still resolve when a file is absent.

---

## 11. Reusable infrastructure (verified present, S300)

- Draft/autosave pattern: `lib/services/intake-draft-service.js` + `pages/api/intake/draft.js` (template to mirror).
- Sanitizer + markdown: `sanitize-html`, `marked`, `dompurify` already in `package.json` (use `sanitize-html` server-side).
- Migration mechanism: `node scripts/apply-migrations.js` + `lib/db/migrations-manifest.json`.
- Token verify + lifecycle: `lib/external/verify-suggestion-token.js`, `lib/external/token-lifecycle.js`.
- Schema single-source: `lib/external/review-form-schema.js` (validator + read-back decoder).
