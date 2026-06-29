# Reviewer Review-Form — In-Browser Authoring Build Plan

**Status:** **PLAN — build-ready, not started.** Drafted 2026-06-28 (Session 300); revised same session after a Codex design review (all P0/P1/P2 folded in) and a data-model pivot to a point-in-time **answer-snapshot child table**. No code written yet — Phase 0 (Dataverse schema: one new child table, zero new parent columns) is the next action.

**Date:** 2026-06-28

**Owner decisions captured (S300):**
1. **System of record = Dataverse**, but as a **point-in-time snapshot**, not fixed per-question columns: a new child table holds one row per question per review, each storing the **question text as asked** beside the answer. A submitted review is self-contained and reconstructs exactly even after the questions change. (Chosen over a single JSON column because Connor regularly exports Dataverse → Excel and needs answers natively queryable; chosen over per-question parent columns because the question set will grow/change and column sprawl + lost fidelity are unacceptable.)
2. **Ratings stay discrete** (`wmkf_reviewerimpact/risk/overallrating` on the parent suggestion row) for native year-over-year averaging — a small, deliberate denormalization alongside the snapshot.
3. **Editor = full WYSIWYG (tiptap)** → HTML, sanitized server-side with `sanitize-html`. Each narrative answer is stored **twice**: sanitized **HTML** (rich rendering) and a **plain-text** rendition (clean for Connor's Excel exports).
4. **File uploads = keep the infrastructure, hide from the UI**, and enforce finality **server-side** (not just by hiding the input).
5. **Submit is final / read-only**; all free-text required except Q11.
6. **Questions live in code for v1** (simplest-first); the snapshot guarantees fidelity, so a later phase can move authoring into Dataverse (staff-editable, versioned) losslessly. **[CONFIRM: build staff-editable questions now, or defer to a later phase? Plan assumes defer.]**

**Predecessors:** `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md` (token lifecycle + original schema-capture design), `docs/INTAKE_PORTAL_DESIGN.md` + `docs/INTAKE_PORTAL_DRAIN_PLAN.md` (the Postgres draft/autosave pattern we mirror), `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md` (the etag optimistic-lock + Dataverse-authored-content patterns).

---

## 1. What we're changing

**Today** [VERIFIED via source, S300] the reviewer "submit your review" surface (`view === 'stage2b'`) is:
- `shared/components/external/MaterialsView.js` — ProposalCard + FilesCard + an UploadCard bundling a **file upload** (1–5 files, PDF/DOCX/DOC, ≤25 MB) with the structured form.
- `shared/components/external/ReviewFormFields.js` walks `lib/external/review-form-schema.js`: affiliation (text) + Q1 impact / Q3 risk / Q10 overall (radios). **The narrative (Q2, Q4–Q9, Q11) lives only in the uploaded PDF.**
- `lib/services/review-upload.js::writeReviewFiles` is the single write path (token + staff): validates files + form, virus-scans, uploads to SharePoint, then **one Dataverse PATCH** to `wmkf_appreviewersuggestion` (folder, filename, `wmkf_reviewreceivedat`, the three picklists, affiliation, staff flag), then tightens the token expiry. **The PATCH is unconditional** [VERIFIED via `review-upload.js:230`] — no submitted-state or concurrency guard.
- `pages/api/external/review/[token]/context.js` GET assembles proposal/reviewer/files/prefill/`formSchema`, computes `engagementState`, and returns an `_etag` for optimistic locking (round-tripped as `If-Match` by `/respond`). **No draft/autosave** — one atomic submit.
- Staff read-back: `shared/components/workbench/ReviewsTab.js` → `GET /api/review-manager/reviewers` projects the three ratings + a SharePoint download link.

**Target:** the narrative moves *into the page*. Reviewers answer every question in a rich-text editor; work autosaves; on submit the answers become a self-contained Dataverse snapshot. The file upload is hidden (infra retained, finality enforced server-side).

---

## 2. Question set

11 questions. Canonical wording **[VERIFIED via the reviewer-questions source supplied S300]** — Q1/Q3/Q10 are already-built radios; Q2/Q4–Q9/Q11 are new in-form rich-text fields:

| PDF Q | Wording | Target | Required |
|---|---|---|---|
| Affiliation | Title & Organization | plain text (unchanged) | yes |
| Q1 | If the proposed project is successful in its entirety, how will it impact the field? | radio (unchanged) | yes |
| Q2 | What specific significant impacts do you foresee? | **rich-text (new)** | yes |
| Q3 | The Keck Foundation is comfortable funding risky projects. How risky is the project overall? | radio (unchanged) | yes |
| Q4 | What are the risks associated with the project? Are the risks technical (such as the ability to make a molecule, build an instrument, or make a measurement)? Are the risks related to a hypothesis (i.e., the idea could be wrong)? Is the team trying to do too much? | **rich-text (new)** | yes |
| Q5 | Are the methods, data gathering, and/or analysis appropriate for the project to be successful? | **rich-text (new)** | yes |
| Q6 | Are there questions or issues that the Foundation should raise with the PI before making an award? | **rich-text (new)** | yes |
| Q7 | Do you believe the team has the necessary personnel and infrastructure to perform the work? | **rich-text (new)** | yes |
| Q8 | The Foundation strives to support projects that would not likely be funded elsewhere. Do you think this project in its current form could likely be supported by a traditional funding agency? | **rich-text (new)** | yes |
| Q9 | Are there any issues with the budget? | **rich-text (new)** | yes |
| Q10 | Please assign an overall rating to the proposal. | radio (unchanged) | yes |
| Q11 | Is there anything else you'd like to share with the Foundation about the proposal or this review process? | **rich-text (new)** | **optional** |

`review-form-schema.js` stays the single source of truth: add `type: 'richtext'` alongside `'string'`/`'picklist'`, each field carrying a **stable `key`** (the snapshot's question id — `impact`, `risk`, `overallRating`, `q2`, `q4`…`q11`), `order`, `label` (question text), `required`, and a per-field `maxLength` (§5, P1-3). The `key` must never be reused for a different question — it's how answers map back to questions across question-set changes.

---

## 3. Data model

### 3a. Dataverse — answer-snapshot child table (system of record)

**New child entity `wmkf_appreviewanswer`** (names final at creation; Justin + Claude build it together — **not Connor-gated**). One row **per question per submitted review**:

| Column | Type | Holds |
|---|---|---|
| (lookup) `wmkf_AppReviewerSuggestion` | Lookup → `wmkf_appreviewersuggestion` | parent review (1 suggestion → many answers) |
| `wmkf_questionkey` | Text | stable question id (`impact`, `q2`, …) |
| `wmkf_questionorder` | Whole Number | display order at submission |
| `wmkf_questiontext` | Multiline Text | **question text as asked** (fidelity) |
| `wmkf_questiontype` | Text/Choice | `picklist` \| `richtext` \| `string` |
| `wmkf_answerhtml` | Multiline Text | sanitized HTML (narrative answers) |
| `wmkf_answertext` | Multiline Text | plain-text rendition (clean Excel export; for ratings = the chosen label) |
| `wmkf_answervalue` | Whole Number | picklist numeric value (ratings); null for narrative |

This holds **all 11 questions** (ratings included) so the snapshot — and the future document assembler — is complete and self-contained. Adding questions later = more rows, **never new columns**. `wmkf_questiontext` denormalizes the question into each answer, so historical reviews survive any future question edit/move/delete.

**Parent suggestion row — no new columns.** Keep the existing discrete ratings (`wmkf_reviewerimpact/risk/overallrating`), `wmkf_revieweraffiliation`, and `wmkf_reviewreceivedat`. Ratings are denormalized to the parent for native aggregation (year-over-year averages); they *also* appear in the child snapshot for document fidelity. This is a deliberate, documented duplication.

### 3b. Postgres — drafts / autosave

New table via numbered migration (`lib/db/migrations/021_review_drafts.sql` + manifest):

```
review_drafts(
  id            bigserial primary key,
  suggestion_id uuid not null unique,                 -- the wmkf_appreviewersuggestion GUID
  draft_json    jsonb not null default '{}'::jsonb,   -- answers keyed by field.key (sanitized HTML for richtext, ints for picklist)
  updated_at    timestamptz not null default now()
)
```

`ReviewDraftService` (cousin of `IntakeDraftService`): `getBySuggestion`, `upsertDraftJson` (autosave — touches only `draft_json` + `updated_at`, `ON CONFLICT (suggestion_id)`), `delete`, `deleteExpired`. No attachments, no idempotency-key dance, no async drain — submit writes Dataverse synchronously. **Draft GET/PUT refuse once the review is submitted** (§5, P0-1/P0-2) and the draft is **deleted only after the submit changeset commits** (§5, P0-2).

**Why Postgres for drafts:** autosave fires many times per session; Dataverse is the wrong store for high-frequency partial writes (same reasoning as intake). The draft is a scratchpad; the Dataverse child table is the commit target.

---

## 4. Editor & sanitization

- **Dependency:** add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`. New `shared/components/external/RichReviewEditor.js` — controlled tiptap with a small toolbar, raw-HTML paste stripped.
- **Formatting allowlist [DECISION #A, standard set]:** bold, italic, bullet/numbered lists, H2/H3, blockquote, links. **No images, no tables.**
- **Sanitizer — executable contract, not prose (Codex P1-2).** `lib/external/sanitize-review-html.js` exporting `sanitizeReviewHtml(html)` using **`sanitize-html`** (DOM-free — **never** DOMPurify+jsdom, which does not load in Vercel/Turbopack serverless; memory `project-jsdom-serverless-esm-incompat`). Enumerated config:
  - `allowedTags`: `p, br, strong, b, em, i, ul, ol, li, h2, h3, blockquote, a` (nothing else).
  - `allowedAttributes`: `{ a: ['href', 'rel', 'target'] }` — no attributes on any other tag (kills `style`, `class`, `on*`).
  - `allowedSchemes`: `['https', 'mailto']` only; `allowedSchemesAppliedToAttributes: ['href']`; `allowProtocolRelative: false`.
  - Link `transformTags.a`: force `rel="noopener noreferrer nofollow"` and `target="_blank"`; drop the tag's text-less/href-less variants.
  - **Derive a plain-text rendition** (`htmlToPlainText`) for `wmkf_answertext` — strip tags, collapse whitespace, preserve list/paragraph breaks as newlines.
- **Trust boundary:** reviewer HTML is **untrusted content rendered to staff** → stored-XSS risk. Sanitize **server-side on every write** (autosave PUT *and* submit) — the client editor is convenience, not the boundary. Sanitize **again immediately before** `dangerouslySetInnerHTML` on the workbench render (defense in depth).
- **Tests (in Phase 1, before any route uses it — Codex P2-1):** each bypass vector is a case — `javascript:` href, `data:` href, protocol-relative `//evil`, encoded scheme (`&#106;avascript:`), `<img onerror>`, `<script>`, `style="…"`, pasted raw HTML with event attrs — asserting it's stripped; plus plain-text-rendition correctness.

---

## 5. Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/external/review/[token]/draft` (new) | GET | token | Return saved `draft_json` so the editor rehydrates on return visits. **404/empty if the review is already submitted** (no draft after finality). |
| `/api/external/review/[token]/draft` (new) | PUT | token | Debounced autosave. Sanitize each rich-text answer (§4) before persisting; `upsertDraftJson`. Gated on materials-sent (same gate as `/upload`). **Refuses with 409 once `wmkf_reviewreceivedat` is set** (submit is final, §9 #C). Explicit `bodyParser.sizeLimit` (P1-3). |
| `/api/external/review/[token]/submit` (new) | POST | token | Final submit. Validate all fields (ratings + Q2/Q4–Q9 + affiliation required, Q11 optional; "empty richtext" = no text after tag-strip — §9 #E). Sanitize → derive plain text → build the snapshot. **Single Dataverse `$batch` changeset (all-or-nothing, Codex P0-2):** create the N `wmkf_appreviewanswer` rows + PATCH the parent (3 rating columns, affiliation, `wmkf_reviewreceivedat`) **guarded by `If-Match: <etag>`** (or a `wmkf_reviewreceivedat eq null` precondition) → 412/409 on conflict. **Only after the changeset commits**, delete the Postgres draft and tighten the token window. Explicit `bodyParser.sizeLimit` (P1-3). |
| `context.js` | GET | token | Extend `prefill`: pre-submit from the draft; post-submit reconstruct from the child rows. Expose the new schema. Continues to return `_etag` (consumed by `/submit`). |
| `upload.js` | POST | token | **Hidden from UI but hardened (Codex P0-1):** the reviewer-token path (`opts.source === 'reviewer_self_token'`) **refuses once `wmkf_reviewreceivedat` is set**. Staff path (`staff_upload`) unaffected. |
| `/api/review-manager/reviewers` | GET | session | Extend to expand/return the child answer rows for workbench read-back (Codex P1-1). |

**Consumer fan-out (Codex P1-1) — all in one phase or it reads as data loss:** new schema fields/keys, the child entity in any read `$select`/expand path (`verify-suggestion-token.js` `SUGGESTION_SELECT` needs no per-answer columns since answers are a child read, but the child expand must be added wherever answers are surfaced), the adapter `FIELD_SELECT` (`lib/dataverse/adapters/reviewer-suggestion.js`) if answers surface through it, the `/api/review-manager/reviewers` DTO projection, and `ReviewsTab` rendering.

**Server-side finality (Codex P0-1) is the contract, hiding the UI is not.** Both the draft PUT and the reviewer-token upload must reject post-submission. The `submitted` engagement view renders answers **read-only**.

All new routes register in `docs/API_ROUTE_SECURITY_MATRIX.md` and pass `check:api-routes`. Public token surfaces → preserve expiry, row binding, rate-limit, replay/duplicate guards consistent with `/upload` and `/respond` (`.claude/rules/external-reviewers.md`).

---

## 6. Staff read-back (workbench)

`ReviewsTab.js` renders, per submitted reviewer: the existing rating cells (from the discrete parent columns) **plus** the narrative answers from the child rows, each as `question text` → sanitized HTML (re-sanitized before render). The SharePoint download link shows only when a file actually exists (uploads hidden going forward). `/api/review-manager/reviewers` extended to expand the child rows.

**[#B — deferred default]** Panel-prep export/roll-up of the narrative answers stays out of scope; revisit after the authoring surface ships. The future **human-readable review-document assembler** reads the child snapshot — explicitly enabled by this model, built later.

---

## 7. Hiding the upload (decision 4)

- Remove the file-input + "Replace your submission" affordances from `MaterialsView.js` / `UploadCard`; the card becomes the rich-text authoring form + Submit.
- **Keep** `review-upload.js`, `upload.js`, the virus-scan path, `sharepoint-cleanup.js`, and the `wmkf_reviewsharepointfolder`/`wmkf_reviewfilename` columns intact — **plus the new server-side finality guard (P0-1)** so the dormant route can't overwrite a final review.
- Document the dormant capability in `docs/agent-wiki/topics/external-reviewer-portal.md` + a memory entry: hidden-not-deleted, how to re-enable, and the finality guard.

---

## 8. Phasing (lowest-risk first)

- **Phase 0 (blocking inputs):** Justin + Claude create the `wmkf_appreviewanswer` child table (§3a) and finalize its column names. Question wording resolved (§2). Confirm decision #6 (defer staff-editable questions?).
- **Phase 1 (data layer + sanitizer, no UI):** `sanitize-review-html.js` + its full bypass test suite **first**; migration `021_review_drafts.sql` + manifest; `ReviewDraftService`; draft GET/PUT routes (sanitize on write, finality refusal, size limits); unit tests. Update Atlas (new PG table + new Dataverse entity) + API matrix.
- **Phase 2 (editor):** `RichReviewEditor` (tiptap); schema `richtext` type; wire the authoring form into `stage2b`, replacing the file UI; autosave wired to Phase 1.
- **Phase 3 (submit + lifecycle):** `/submit` route → `$batch` changeset (child rows + parent ratings + receivedat, `If-Match`-guarded); draft deleted post-commit; token window tightened; reviewer-token `/upload` finality guard (P0-1); `context.js` prefill (draft pre-submit / child rows post-submit); `submitted` view read-only.
- **Phase 4 (workbench + fan-out):** child-row expand in `/api/review-manager/reviewers`; `ReviewsTab` renders the narrative answers; complete the P1-1 fan-out in this phase.
- **Phase 5 (lifecycle integration + cleanup + gates):** delete review draft on token **revoke** and **regenerate** (Codex P1-4 — wired into `revoke-token.js` + `regenerate-token.js`, **not** `mintAndStore`); draft GC in the maintenance cron; hide upload UI + document dormant infra; full gate sweep + the `stage2b` E2E.

---

## 9. Lifecycle decisions

- **[#C — submit is final.]** On submit the form **locks read-only**; no edit/re-submit. **Diverges from today's "replace your submission" grace behavior** (removed with the upload UI). Enforced **server-side** (draft PUT + reviewer-token upload both reject post-submission, P0-1); draft deleted post-commit; `submitted` view renders answers read-only. A reviewer needing a correction contacts staff (staff retain server-side edit/upload paths).
- **[#E — all required except Q11.]** Q2/Q4–Q9 hard-required alongside the 3 ratings + affiliation; Q11 optional. "Empty richtext" = no text content after tag-strip, not merely `<p></p>` — the validator strips tags before the emptiness test.
- **[#C-conc — concurrency (Codex P0-2).]** `/submit` is guarded by the context `_etag` via `If-Match` (or a `wmkf_reviewreceivedat eq null` precondition) inside the `$batch` changeset; a second concurrent submit gets 412/409, not a silent clobber. The Postgres draft is deleted **only after** the changeset commits (never on a PATCH failure).
- **[#draft-token — token revoke/regenerate (Codex P1-4, TRACED S300).]** Drafts key on `suggestion_id`, which is **stable across token regeneration** (`mintAndStore` rewrites only the hash/expiry — [VERIFIED via `token-lifecycle.js:42`]), so a stale/tampered draft *would* resurface under a regenerated link. **Resolution:** delete the review draft in the staff **revoke-token** and **regenerate-token** endpoints (the leak/compromise actions per `token-lifecycle.js:5`), **not** in `mintAndStore` — that primitive is also called on every benign email (re)send ([render-emails.js:165], [reviewer-reminder-sweep.js:272]), where the draft must survive. Accepted edge: regenerating for a benign "lost email" also clears the draft (rare; reviewer re-enters) — documented, not silent.
- **[#D — draft retention/GC]** Mirror intake's `deleteExpired` (90 days) or tie GC to `wmkf_externaltokenexpires`. Recommended: GC some interval after token expiry. Minor; finalize at Phase 5.
- **Concurrency (autosave):** single reviewer; two-tab autosave → last-write-wins on `draft_json` is acceptable (no async drain to corrupt). No idempotency key.

---

## 10. Gates, tests, risks

**Gates (run each gate and its self-test sequentially, never in parallel — Codex P2-2):**
```
npm run check:migrations-manifest                                                  # new 021 migration
npm run check:atlas && npm run check:atlas:self-test                               # new PG table + new Dataverse entity ownership
npm run check:api-routes && npm run check:api-routes:self-test                     # new draft/submit routes
npm run check:fact-consistency && npm run check:fact-consistency:self-test         # plan + schema facts
npm run check:doc-currency && npm run check:doc-currency:self-test
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test  # decide applicability to stored-and-rendered reviewer HTML (vs LLM-prompt surfaces) — confirm in Phase 1
```
**[Decide in Phase 1]** whether `check:prompt-injection-tagging` applies to reviewer-authored HTML that is stored and later rendered to staff (not fed to an LLM). If the eventual document assembler or VRP ever feeds these answers to a model, the untrusted-content markers apply then.

**Tests:** unit — sanitizer allowlist + every bypass vector (§4), plain-text rendition, `ReviewDraftService` (upsert/get/finality-refusal/GC), `validateReviewForm` with `richtext` + emptiness-after-strip, submit-path snapshot/changeset mapping. Integration — draft GET/PUT/submit (token gating, materials-sent gate, post-submit 409, `If-Match` 412, replay). E2E (Codex P2-3) — assert: (a) **no file input** present in `stage2b`, (b) autosave **restores the draft on reload** pre-submit, (c) submit transitions UI to **read-only**, (d) a subsequent autosave PUT returns **409/frozen**, (e) a direct reviewer-token POST to `/upload` after final submit is **rejected server-side**.

**Top risks:**
1. **Stored XSS** (highest) — reviewer HTML rendered to staff. Mitigation: the enumerated `sanitize-html` contract (§4) applied on write *and* render; per-vector tests.
2. **Serverless sanitizer** — `sanitize-html`, never DOMPurify+jsdom.
3. **Submit atomicity/concurrency** — the single `$batch` changeset + `If-Match` + draft-delete-after-commit (P0-2) is the crux; partial child-row writes must not be possible.
4. **Consumer fan-out (P1-1)** — answers written but not surfaced reads as data loss; complete schema → child-expand → reviewers DTO → ReviewsTab in Phase 4.
5. **Dataverse dependency** — Phase 0 child-table creation (Justin + Claude) blocks Phases 3–4.

---

## 11. Reusable infrastructure (verified present, S300)

- Draft/autosave pattern: `lib/services/intake-draft-service.js` + `pages/api/intake/draft.js` (template to mirror).
- Sanitizer: `sanitize-html` already in `package.json` (use server-side); `marked` present if markdown is ever wanted.
- Migration mechanism: `node scripts/apply-migrations.js` + `lib/db/migrations-manifest.json` (manifest currently ends at `020`).
- Token verify + lifecycle: `lib/external/verify-suggestion-token.js`, `lib/external/token-lifecycle.js`; staff token endpoints `pages/api/review-manager/{regenerate-token,revoke-token}.js` (P1-4 integration points).
- Optimistic lock precedent: `context.js` `_etag` + `/respond` `If-Match` (model for `/submit`).
- Dataverse-authored-content precedent (for the future staff-editable-questions phase): the Stage 2a `wmkf_policy` + `wmkf_policy_version` library.
- Schema single-source: `lib/external/review-form-schema.js`.
