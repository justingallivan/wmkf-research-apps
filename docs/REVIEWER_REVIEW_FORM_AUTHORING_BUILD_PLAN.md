# Reviewer Review-Form — In-Browser Authoring Build Plan

**Status:** **PHASES 0–1 DONE (2026-06-28, S301) — Phase 2 (tiptap editor) is the next action.** Phase 1 shipped the data layer + sanitizer with no UI: `lib/external/sanitize-review-html.js` (+ 36-case bypass suite), migration `021_review_drafts.sql`, `lib/services/review-draft-service.js`, and the draft GET/PUT route `pages/api/external/review/[token]/draft.js` (server-sanitize on write, finality/stage gates, Atlas + API matrix updated). The `review_drafts` migration still needs `node scripts/apply-migrations.js` against the live DB at deploy. See §8 for per-phase detail. The `wmkf_appreviewanswer` child table, its 7 columns + `wmkf_Name` primary, the `wmkf_appreviewanswer_suggestion` N:1 lookup to `wmkf_appreviewersuggestion`, and the `wmkf_appreviewanswer_suggestion_question_key` alternate key on `(wmkf_appreviewersuggestion, wmkf_questionkey)` were created in **prod** via schema-as-code ([VERIFIED via `lib/dataverse/schema/wave8-review-answer-snapshot/01_wmkf_appreviewanswer.json`] + `scripts/apply-dataverse-schema.js --target=prod --wave=8-review-answer-snapshot --execute`). The sandbox could not host it (schema-stale — parent `wmkf_appreviewersuggestion` 404s there; memory `project-dynamics-sandbox-state`), so prod dry-run → execute was the path. Drafted 2026-06-28 (Session 300); revised same session after **three** Codex design-review passes and a data-model pivot to a point-in-time **answer-snapshot child table**. All findings folded in: pass-1 (P0-1/P0-2/P1-1..4/P2-1..3), pass-2 pivot findings (P0-N1/P0-N2/P1-N3/P1-N4), pass-3 (P1-R3 rating validity, P1-R4 explicit token guards, and the §5a-fallback hardening P0-R1/P0-R2). Codex pass-3 verdict: **"Yes with conditions — Phase 0 can start"**; the two open P0s (P0-R1/P0-R2) gate **only the non-atomic fallback**, which is marked do-not-ship until they're designed — the primary changeset path is sound. Key build prerequisite: a Dataverse **changeset helper does not exist and must be built** (§5a, Phase 2.5) — owner chose to build it. No app code written yet — Phase 1 (sanitizer + bypass tests → `review_drafts` migration `021` → `ReviewDraftService` → draft GET/PUT routes) is buildable now with no external dependency.

**Date:** 2026-06-28

**Owner decisions captured (S300):**
1. **System of record = Dataverse**, but as a **point-in-time snapshot**, not fixed per-question columns: a new child table holds one row per question per review, each storing the **question text as asked** beside the answer. A submitted review is self-contained and reconstructs exactly even after the questions change. (Chosen over a single JSON column because Connor regularly exports Dataverse → Excel and needs answers natively queryable; chosen over per-question parent columns because the question set will grow/change and column sprawl + lost fidelity are unacceptable.)
2. **Ratings stay discrete** (`wmkf_reviewerimpact/risk/overallrating` on the parent suggestion row) for native year-over-year averaging — a small, deliberate denormalization alongside the snapshot.
3. **Editor = full WYSIWYG (tiptap)** → HTML, sanitized server-side with `sanitize-html`. Each narrative answer is stored **twice**: sanitized **HTML** (rich rendering) and a **plain-text** rendition (clean for Connor's Excel exports).
4. **File uploads = keep the infrastructure, hide from the UI**, and enforce finality **server-side** (not just by hiding the input).
5. **Submit is final / read-only**; all free-text required except Q11.
6. **Questions live in code for v1** (simplest-first); the snapshot guarantees fidelity, so a later phase can move authoring into Dataverse (staff-editable, versioned) losslessly. **DECIDED (S301): defer staff-editable questions to a later phase.** Owner design note for that phase: unlike the existing admin-panel editors (which edit a **fixed set** of entries/fields), a staff question-authoring surface must let staff **change the number of questions** — a variable-length, add/remove/reorder editor, not a fixed-field form. That's the twist to design for; the `wmkf_appreviewanswer` snapshot already supports it structurally (more questions = more rows, never new columns), so deferring costs nothing in fidelity.

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

**New child entity `wmkf_appreviewanswer`** (✅ created in prod S301; spec at `lib/dataverse/schema/wave8-review-answer-snapshot/01_wmkf_appreviewanswer.json`). One row **per question per submitted review**:

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

**Alternate key for idempotency (Codex P0-N2):** define a Dataverse **alternate key on `(wmkf_AppReviewerSuggestion, wmkf_questionkey)`** so child-row creation is idempotent — a retry after an uncertain network failure upserts rather than duplicating. The submit write uses this key (create-or-update by alternate key), so a partial-then-retried submit can't produce two rows for the same question.

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
| `/api/external/review/[token]/draft` (new) | GET | token: `verifySuggestionToken` + `checkRateLimit` + `recordTokenOutcome` (Codex P1-R4) | Return saved `draft_json` so the editor rehydrates on return visits. **404/empty if the review is already submitted** (no draft after finality). |
| `/api/external/review/[token]/draft` (new) | PUT | token: `verifySuggestionToken` + `checkRateLimit` + `recordTokenOutcome` | Debounced autosave. Sanitize each rich-text answer (§4) before persisting; `upsertDraftJson`. Gated on materials-sent (same gate as `/upload`). **Refuses with 409 once `wmkf_reviewreceivedat` is set** (submit is final, §9 #C). Explicit `bodyParser.sizeLimit` (P1-3). |
| `/api/external/review/[token]/submit` (new) | POST | token: `verifySuggestionToken` + `checkRateLimit` + `recordTokenOutcome` | Final submit. Validate all fields — **against the current schema's allowed values** (ratings + Q2/Q4–Q9 + affiliation required, Q11 optional; "empty richtext" = no text after tag-strip — §9 #E; rating values must be in the live picklist domain — Codex P1-R3). One mapping fn `buildReviewSubmission(validated) → { parentPatch, answerRows }` (Codex P1-N4). **Finality precheck:** reject with 409 if `wmkf_reviewreceivedat` is already set. **Atomic write via the changeset helper (§5a, Codex P0-N1/P0-N2):** upsert the N `wmkf_appreviewanswer` rows by alternate key + PATCH the parent (3 rating columns, affiliation, `wmkf_reviewreceivedat`) in one changeset, the parent PATCH **guarded by `If-Match: <etag>`** → 412 on concurrent change. **Only after the changeset commits**, delete the Postgres draft and tighten the token window. Explicit `bodyParser.sizeLimit` (P1-3). |
| `context.js` | GET | token | Extend `prefill`: pre-submit from the draft; post-submit reconstruct from the child rows. Expose the new schema. Continues to return `_etag` (consumed by `/submit`). |
| `upload.js` | POST | token | **Hidden from UI but hardened (Codex P0-1):** the reviewer-token path (`opts.source === 'reviewer_self_token'`) **refuses once `wmkf_reviewreceivedat` is set**. Staff path (`staff_upload`) unaffected. |
| `/api/review-manager/reviewers` | GET | session | Extend to return the child answer rows (via the keyed child read, §6) for workbench read-back (Codex P1-1). |

**Consumer fan-out (Codex P1-1) — all in one phase or it reads as data loss:** new schema fields/keys, the keyed child read (§6) added wherever answers are surfaced (`verify-suggestion-token.js` `SUGGESTION_SELECT` needs no per-answer columns since answers are a separate child query, not an expand), the adapter `FIELD_SELECT` (`lib/dataverse/adapters/reviewer-suggestion.js`) if answers surface through it, the `/api/review-manager/reviewers` DTO projection, and `ReviewsTab` rendering.

**Server-side finality (Codex P0-1) is the contract, hiding the UI is not.** Both the draft PUT and the reviewer-token upload must reject post-submission. The `submitted` engagement view renders answers **read-only**.

All new routes register in `docs/API_ROUTE_SECURITY_MATRIX.md` and pass `check:api-routes`. Public token surfaces → preserve expiry, row binding, rate-limit, replay/duplicate guards consistent with `/upload` and `/respond` (`.claude/rules/external-reviewers.md`).

### 5a. The Dataverse changeset helper (Codex P0-N1 — net-new infra, prerequisite for submit)

**[VERIFIED via `lib/services/dynamics-service.js`, S300]** `DynamicsService` exposes only single-row writes — `createRecord` (`:786`), `updateRecord` (`:823`, supports `ifMatch`), `updateIfEmpty` (`:872`), `deleteRecord` (`:928`, supports `ifMatch`). **There is no `$batch`/changeset/multipart method anywhere in `lib/`.** So the "all-or-nothing submit" the snapshot model needs does **not** exist yet and must be built. **[VERIFIED via `pages/api/admin/prompts/[name].js:12`]** the prompt/policy publish flows carry a comment that "Dataverse has no $batch transaction" and deliberately use a non-atomic mirror — so a prior author believed `$batch` was unavailable here. Treat that as a real risk, not settled fact.

Plan (owner chose to **build the helper**, not redesign around non-atomic writes):
1. **Feasibility spike first** — confirm the Dataverse Web API `$batch` endpoint accepts a `multipart/mixed` body with a single atomic changeset in *this* environment (auth, base URL, error surfacing). Time-boxed; if it proves unavailable, fall through to the documented fallback below and re-confirm with the owner.
2. **`DynamicsService.executeChangeset(operations, { actingUserSystemId })`** — builds one `multipart/mixed` `$batch` request wrapping a single changeset of create/PATCH/delete operations (all-or-nothing), supports **per-operation `If-Match`**, parses the multipart response, and surfaces per-operation failures with the same structured-error shape as the single-row helpers. Reuses the existing token/headers/`bypassDynamicsRestrictions` plumbing.
3. **Isolated tests** for the helper (changeset body construction, multipart-response parsing, per-op `If-Match`, all-or-nothing rollback on one failed op) **before** `/submit` consumes it.

**Documented fallback (if the spike fails) — DO NOT SHIP until P0-R1/P0-R2 are designed (Codex):** non-atomic submit — upsert child rows by the `(suggestion, questionkey)` alternate key first, then stamp `wmkf_reviewreceivedat` **last** as the commit marker (a review with rows but no `receivedat` is "not submitted"); idempotent retry via the alternate key. The naïve "stamp-last + orphan sweep" is **not yet safe** and needs two additional controls before use:
- **Orphan-sweep race (Codex P0-R1):** a sweep could delete rows of a slow-but-succeeding submit. Require a per-attempt **in-progress marker / lease** (e.g. a `submit_attempts` row or a timestamp on the suggestion), a **minimum sweep age ≥ the max submit duration**, and a **delete-time parent recheck** (only reap when `receivedat` is still null AND no active lease).
- **Stale child rows (Codex P0-R2):** a retry that submits **fewer** questions than a prior partial attempt leaves orphaned answer rows that the read path would surface. Stamp each answer row with a **submit attempt/version** and read/commit only the current attempt's rows (or delete all child rows for the suggestion before writing the committed set).

This is the same general shape as the prompt/policy publish flows, but those don't have this snapshot's multi-row + retry semantics, so the controls above are net-new. The primary (changeset) path avoids all of this — hence the owner's choice to build it.

---

## 6. Staff read-back (workbench)

`ReviewsTab.js` renders, per submitted reviewer: the existing rating cells (from the discrete parent columns) **plus** the narrative answers from the child rows, each as `question text` → sanitized HTML (re-sanitized before render). The SharePoint download link shows only when a file actually exists (uploads hidden going forward).

**Child read mechanics (Codex P1-N3 — net-new, no 1:N child-expand precedent in `reviewer-suggestion.js`):** read answers with a **separate keyed query**, not `$expand` — `DynamicsService.queryRecords('wmkf_appreviewanswers', { filter: '_wmkf_appreviewersuggestion_value eq <id>', orderby: 'wmkf_questionorder', select: [...] })`. This reuses the existing `queryRecords` primitive (`dynamics-service.js:433`), is trivially testable, and sidesteps `$expand` collection-size limits. Specify at build time: the entity **set name** (`wmkf_appreviewanswers`), the **lookup navigation property** on the child, and the **answer DTO** (`{ questionKey, questionOrder, questionText, questionType, answerHtml, answerText, answerValue }`). The `/api/review-manager/reviewers` response gains an `answers[]` array per reviewer, ordered by `questionOrder`.

**[#B — deferred default]** Panel-prep export/roll-up of the narrative answers stays out of scope; revisit after the authoring surface ships. The future **human-readable review-document assembler** reads the child snapshot — explicitly enabled by this model, built later.

---

## 7. Hiding the upload (decision 4)

- Remove the file-input + "Replace your submission" affordances from `MaterialsView.js` / `UploadCard`; the card becomes the rich-text authoring form + Submit.
- **Keep** `review-upload.js`, `upload.js`, the virus-scan path, `sharepoint-cleanup.js`, and the `wmkf_reviewsharepointfolder`/`wmkf_reviewfilename` columns intact — **plus the new server-side finality guard (P0-1)** so the dormant route can't overwrite a final review.
- Document the dormant capability in `docs/agent-wiki/topics/external-reviewer-portal.md` + a memory entry: hidden-not-deleted, how to re-enable, and the finality guard.

---

## 8. Phasing (lowest-risk first)

- **Phase 0 (blocking inputs) — ✅ DONE (S301, 2026-06-28).** Created the `wmkf_appreviewanswer` child table (§3a), its 7 columns + `wmkf_Name` primary, the `wmkf_appreviewanswer_suggestion` N:1 lookup, and the `wmkf_appreviewanswer_suggestion_question_key` alternate key on `(wmkf_appreviewersuggestion, wmkf_questionkey)` in **prod** via `scripts/apply-dataverse-schema.js --wave=8-review-answer-snapshot --execute`. Column names finalized; question wording resolved (§2); decision #6 = **defer** (see §0 #6). Minor calls: `wmkf_QuestionType` is plain text (not a Choice); `wmkf_Name` primary is optional. Sandbox was unusable (parent entity 404s there), so prod dry-run → execute.
- **Phase 1 (data layer + sanitizer, no UI) — ✅ DONE (S301, 2026-06-28).** `lib/external/sanitize-review-html.js` (enumerated `sanitize-html` allowlist + `htmlToPlainText` + `isEffectivelyEmptyHtml`) with its full bypass suite (`tests/unit/sanitize-review-html.test.js`, 36 cases — every §4 vector); migration `021_review_drafts.sql` + manifest; `lib/services/review-draft-service.js` (`tests/unit/review-draft-service.test.js`); draft GET/PUT route `pages/api/external/review/[token]/draft.js` (server-sanitize on write, schema-key whitelist, finality 409 / materials-not-sent 409 via reused `computeEngagementState`, 2 MB body cap) with `tests/integration/external-review-draft-route.test.js`. Atlas: new PG page `docs/atlas/postgres-review-drafts.md` + master tables; API matrix row added; `CANONICAL_COUNTS` route count refreshed (134→135). **`check:prompt-injection-tagging` DECISION:** does NOT apply to these reviewer answers in v1 — they are stored-and-rendered-to-staff HTML, not an LLM-prompt surface. The untrusted-content markers apply only if/when the future document assembler or VRP feeds these answers to a model (revisit then). **Deploy step still pending:** `node scripts/apply-migrations.js` (creates `review_drafts` in the live DB) — not run by this build.
- **Phase 2 (editor):** **FIRST (Codex S301 P0):** add the 8 rich-text questions (Q2/Q4–Q9/Q11) to `lib/external/review-form-schema.js` with stable `key`/`order`/`required`/`maxLength` and the new `richtext` type — until then the Phase-1 draft route's schema-key whitelist drops them. Add a route test proving a richtext key (e.g. `q2: '<img onerror=…>'`) persists only as sanitized HTML. Update `docs/SERVICE_AND_UTILITY_CATALOG.md` ("4 structured fields" → rich-text source, Codex S301 P2) in the same change. Then `RichReviewEditor` (tiptap); wire the authoring form into `stage2b`, replacing the file UI; autosave wired to the Phase 1 route.
- **Phase 2.5 (changeset helper — Codex P0-N1, prerequisite for Phase 3):** feasibility spike on the Dataverse `$batch` endpoint (§5a); then `DynamicsService.executeChangeset` with per-op `If-Match` + all-or-nothing semantics + isolated tests. If the spike fails, switch to the §5a fallback and re-confirm with the owner before Phase 3.
- **Phase 3 (submit + lifecycle):** the single `buildReviewSubmission()` mapping fn (P1-N4); `/submit` route → finality precheck + `executeChangeset` (child upserts by alternate key + parent ratings/affiliation/receivedat, parent `If-Match`-guarded); draft deleted post-commit; token window tightened; reviewer-token `/upload` finality guard (P0-1); `context.js` prefill (draft pre-submit / child rows post-submit); `submitted` view read-only. **Snapshot-fidelity backstop (Codex S301 P1):** `wmkf_questionorder`/`wmkf_questiontext`/`wmkf_questiontype` were created without a `requiredLevel`, so `buildReviewSubmission()` must hard-assert all three are present/non-empty on every answer row (and test missing/empty), or the columns be promoted to `ApplicationRequired` if a post-create metadata update is feasible.
- **Phase 4 (workbench + fan-out):** keyed child read (§6) in `/api/review-manager/reviewers`; `ReviewsTab` renders the narrative answers; complete the P1-1 fan-out in this phase.
- **Phase 5 (lifecycle integration + cleanup + gates):** delete review draft on token **revoke** and **regenerate** (Codex P1-4 — wired into `revoke-token.js` + `regenerate-token.js`, **not** `mintAndStore`); draft GC in the maintenance cron; hide upload UI + document dormant infra; full gate sweep + the `stage2b` E2E.

---

## 9. Lifecycle decisions

- **[#C — submit is final.]** On submit the form **locks read-only**; no edit/re-submit. **Diverges from today's "replace your submission" grace behavior** (removed with the upload UI). Enforced **server-side** (draft PUT + reviewer-token upload both reject post-submission, P0-1); draft deleted post-commit; `submitted` view renders answers read-only. A reviewer needing a correction contacts staff (staff retain server-side edit/upload paths).
- **[#E — all required except Q11.]** Q2/Q4–Q9 hard-required alongside the 3 ratings + affiliation; Q11 optional. "Empty richtext" = no text content after tag-strip, not merely `<p></p>` — the validator strips tags before the emptiness test.
- **[#C-conc — concurrency + idempotency (Codex P0-2 / P0-N2).]** `If-Match` alone is insufficient — a client can fetch a fresh post-submit etag and re-submit ([VERIFIED via `context.js` returns an etag on every load, incl. submitted state]). So `/submit` uses **both**: a **finality precheck** (reject 409 if `wmkf_reviewreceivedat` is already set) **and** an `If-Match`-guarded parent PATCH inside the changeset (412 on concurrent change). Child rows upsert by the `(suggestion, questionkey)` alternate key so an uncertain-failure retry can't duplicate rows. The Postgres draft is deleted **only after** the changeset commits (never on a write failure).
- **[#snapshot-consistency — parent/child rating invariant + validity (Codex P1-N4 / P1-R3).]** Ratings live both as parent columns and as child snapshot rows. To prevent silent drift, `buildReviewSubmission(validated)` is the **single** producer of `{ parentPatch, answerRows }` from one normalized validated object; before building the changeset, assert the child rating rows' `answerValue` equals the corresponding `parentPatch` column. Beyond *equality*, enforce *validity* (P1-R3): each rating value must be in the **live** picklist domain (so the just-removed "Unable to answer"/99 and any out-of-range value are rejected), and a complete submit must carry **exactly three non-null rating rows**. Unit-tested, including removed/out-of-range values.
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

**Tests:** unit — sanitizer allowlist + every bypass vector (§4), plain-text rendition, `ReviewDraftService` (upsert/get/finality-refusal/GC), `validateReviewForm` with `richtext` + emptiness-after-strip + rating-domain validity (removed "Unable to answer"/99 + out-of-range rejected — P1-R3), `buildReviewSubmission` mapping + parent/child rating equality, exactly-three-rating-rows, and validity (P1-N4/P1-R3), `executeChangeset` (body construction, multipart-response parse, per-op `If-Match`, all-or-nothing rollback). Integration — draft GET/PUT/submit (token gating, materials-sent gate, finality 409, `If-Match` 412, alternate-key retry idempotency, replay). E2E (Codex P2-3) — assert: (a) **no file input** in `stage2b`, (b) autosave **restores the draft on reload** pre-submit, (c) submit transitions UI to **read-only**, (d) a subsequent autosave PUT returns **409/frozen**, (e) a direct reviewer-token POST to `/upload` after final submit is **rejected server-side**.

**Top risks:**
1. **Changeset feasibility (new, gating P0-N1)** — the atomic submit depends on a `$batch` changeset helper that does **not** exist, and prior code believed `$batch` was unavailable here ([prompts/[name].js:12]). Mitigation: feasibility spike **before** committing Phase 3 (§5a); documented non-atomic fallback if it fails.
2. **Stored XSS** — reviewer HTML rendered to staff. Mitigation: the enumerated `sanitize-html` contract (§4) on write *and* render; per-vector tests.
3. **Serverless sanitizer** — `sanitize-html`, never DOMPurify+jsdom.
4. **Submit atomicity/concurrency** — changeset + finality precheck + `If-Match` + alternate-key idempotency + draft-delete-after-commit (P0-2/P0-N2); partial or duplicate child rows must be impossible.
5. **Consumer fan-out (P1-1)** — answers written but not surfaced reads as data loss; complete schema → keyed child read → reviewers DTO → ReviewsTab in Phase 4.
6. **Dataverse dependency** — ✅ resolved: Phase 0 child-table + alternate-key creation is done (S301), so Phases 3–4 are no longer blocked on it.

---

## 11. Reusable infrastructure (verified present, S300)

- Draft/autosave pattern: `lib/services/intake-draft-service.js` + `pages/api/intake/draft.js` (template to mirror).
- Sanitizer: `sanitize-html` already in `package.json` (use server-side); `marked` present if markdown is ever wanted.
- Migration mechanism: `node scripts/apply-migrations.js` + `lib/db/migrations-manifest.json` (manifest currently ends at `020`).
- Token verify + lifecycle: `lib/external/verify-suggestion-token.js`, `lib/external/token-lifecycle.js`; staff token endpoints `pages/api/review-manager/{regenerate-token,revoke-token}.js` (P1-4 integration points).
- Optimistic lock precedent: `context.js` `_etag` + `/respond` `If-Match` (model for `/submit`). Single-row `If-Match` is supported by `DynamicsService.updateRecord`/`deleteRecord` ([dynamics-service.js:823,928]).
- **Changeset helper does NOT exist — must be built (§5a, P0-N1).** No `$batch`/changeset/multipart method in `lib/`; the prompt/policy publish flows ([prompts/[name].js:12]) deliberately use a non-atomic mirror because a prior author believed Dataverse `$batch` was unavailable here. Feasibility spike required.
- Dataverse-authored-content precedent (for the future staff-editable-questions phase): the Stage 2a `wmkf_policy` + `wmkf_policy_version` library.
- Schema single-source: `lib/external/review-form-schema.js`.
