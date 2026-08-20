---
title: Grantee Abstract Rich-Text Editor Build Plan
domain: grantee-deliverables
kind: plan
status: active
summary: "Implemented Markdown-backed rich-text editing for grantee abstracts and the image-caption follow-up."
canonical: false
cataloged: 2026-08-13
owner: product-engineering
related:
  - docs/GRANTEE_PORTAL_SPEC.md
  - docs/GRANTEE_PORTAL_BUILD_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
---

# Grantee Abstract Rich-Text Editor Build Plan

**Status:** Abstract and image-caption editors merged and deployed to production; staff abstract formatting and persistence observed in production on 2026-08-14. The slow-save ambiguous-write reconciliation (§4.5) is implemented and tested.
**Change surface:** Abstract and image-caption editing in the external grantee portal and the staff Workbench Awardee tab.\
**Persistence:** Existing Dataverse Memo fields `akoya_request.wmkf_abstractformatted`, `akoya_request.wmkf_abstractapproved`, and `wmkf_granteedeliverable.wmkf_imagecaption`.\
**Review owner:** Claude Opus, read-only adversarial plan review.\
**Implementation owner:** Codex, following the Claude Opus-reviewed contract below.

## 1. Outcome and decision

[VERIFIED via source/tests] Grantees and staff now have a familiar formatting toolbar so scientific names such as *Escherichia coli* can be italicized without typing Markdown syntax.

[VERIFIED via source/tests] The implementation uses Tiptap, the same editor framework used by reviewer answers, with a narrower formatting profile and the existing Markdown persistence contract. The editor displays formatted content and emits canonical Markdown:

| Visible formatting | Persisted Markdown |
|---|---|
| *Escherichia coli* | `*Escherichia coli*` |
| **Important result** | `**Important result**` |
| H₂O | `H~2~O` |
| x² | `x^2^` |

[VERIFIED via source/search] No Dataverse field was added or converted, raw HTML is not stored in the existing fields, and the reviewer answer dual-HTML/plain-text persistence model was not copied.

## 2. Current-state evidence

| Claim | Producer / entry point | Persistence | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| Staff-generated and grantee-approved abstracts have separate provenance. | Generation/staff edit; external grantee submit | `wmkf_abstractformatted`; `wmkf_abstractapproved` | Staff UI and publication assembly | `docs/GRANTEE_PORTAL_SPEC.md:66-69`; `lib/services/grantee-upload.js:149-156` | VERIFIED |
| Both live abstract attributes are Memo fields with the expected logical names. | Dataverse metadata | `akoya_request` | All abstract readers/writers | `node scripts/preflight-grantee-deliverables-fields.mjs` returned exact matches on 2026-08-13 | VERIFIED |
| Abstract storage is already a controlled Markdown subset, not raw HTML. | Staff and grantee save payloads | Existing Memo fields | `renderGranteeBody` | `shared/utils/grantee-markdown.js:1-24,105-115` | VERIFIED |
| The renderer supports bold, italic, superscript, and subscript and rejects unsupported/raw HTML. | `renderGranteeBody` | N/A | Portal/site/document HTML | `shared/utils/grantee-markdown.js:35-107`; `tests/unit/grantee-markdown.test.js:17-82` | VERIFIED |
| The renderer recognizes blank-line paragraphs, two-space hard breaks, backslash-escaped Markdown punctuation, and deterministic nested bold/italic/sub/sup; an ordinary newline is only a soft break. | `renderGranteeBody` | N/A | Editor serializer grammar | `shared/utils/grantee-markdown.js:43-107`; read-only renderer probe on 2026-08-13 | VERIFIED |
| Two unescaped `~` or `^` characters on one line can pair into subscript/superscript even when the user intended approximation text; trailing whitespace inside `*...*` prevents emphasis. | `renderGranteeBody` | N/A | Editor serializer grammar | Read-only renderer probe on 2026-08-13 (`~5 ms rise, ~8 ms fall`; `^5 ms rise, ^8 ms fall`; `*E. coli *`) | VERIFIED |
| Publication assembly prefers approved text, falls back to formatted text, and renders Markdown to HTML. | `assembleGranteeDocument` | Both abstract fields | Preview, website, and cycle export consumers | `lib/services/grantee-document-assembly.js:124-154` | VERIFIED |
| Both abstract authoring surfaces use the restricted Markdown-backed Tiptap editor. | External grantee form; staff Awardee tab | Parent canonical-Markdown state | Existing submit/save payloads | `shared/components/external/GranteeDeliverableForm.js`; `shared/components/workbench/AwardeeTab.js`; `shared/components/external/GranteeAbstractEditor.js` | VERIFIED |
| Both caption authoring surfaces reuse the same restricted editor and keep the existing caption write paths. | External grantee form; staff replacement panel | `wmkf_imagecaption` Markdown | Existing submit/replace payloads and shared export renderer | `GranteeDeliverableForm.js`; `AwardeeTab.js`; `grantee-upload.js`; `replace-submission-service.js` | VERIFIED |
| The portal specification called for a lightweight WYSIWYG for occasional scientific formatting. | Product specification | N/A | Planned portal editor | `docs/GRANTEE_PORTAL_SPEC.md:233-258` | VERIFIED |
| Reviewer answers already use a controlled Tiptap editor. | `RichReviewEditor` | Sanitized HTML plus a text mirror | Reviewer and staff review flows | `shared/components/external/RichReviewEditor.js:1-20,59-124`; `lib/external/sanitize-review-html.js:1-24,82-141` | VERIFIED |
| Both Dataverse Memo attributes have `MaxLength=32000`; both clients and both server write paths now enforce the shared 20000-character serialized-Markdown limit. Busboy's 64 KiB field cap remains a transport backstop. | Shared contract; staff and external clients/routes/services | Both abstract fields | Editor counters and pre-write rejection | `shared/config/granteeAbstract.js`; `lib/services/grantee-upload.js`; `pages/api/workbench/grantee-deliverables/abstract.js`; focused boundary tests | VERIFIED |
| `@tiptap/pm/markdown` is a direct installed dependency surface and exports `MarkdownSerializer`; its default serializer targets CommonMark and does not define the custom sub/sup grammar. | Package runtime | N/A | New serializer | `package.json:98-101`; `node -e` export probe on 2026-08-13 | VERIFIED |

Focused verification on 2026-08-13:

```text
npm test -- --runInBand tests/unit/grantee-markdown.test.js tests/unit/grantee-document-assembly.test.js
Test Suites: 2 passed, 2 total
Tests:       29 passed, 29 total
```

## 3. Guardrail invariants

| Invariant | Files likely touched | Verification |
|---|---|---|
| The persisted abstract remains canonical Markdown, never editor HTML. | New editor/serializer; both client callers | Unit round-trip tests and request-payload assertions |
| Existing plain-text and Markdown abstracts load without migration or data loss. | Context/load services; editor | Fixtures for plain text and every allowed mark |
| The toolbar exposes only formatting the renderer preserves. | New abstract editor | Component test for the exact button set; output sanitizer tests |
| Raw HTML, links, headings, lists, blockquotes, images, code, and pasted unsupported styles do not enter the persistence contract. | Editor paste rules; serializer; existing renderer | Negative tests containing each unsupported form |
| External submission remains one explicit atomic package submission; formatting does not create a second save path. | Grantee form and existing submit route/service | Existing submit tests plus multipart payload assertion |
| Staff save retains server-derived field targeting, status authorization, base-field stale detection, and ETag concurrency. | Awardee tab and existing abstract route/service | Existing route/service tests plus formatted-value cases |
| Approved-versus-formatted provenance and publication precedence remain unchanged. | Existing services and assembly | Assembly and save-target regression tests |
| Preview, website, and cycle export render the same sanitized formatting from the same stored value. | Existing assembly consumers | End-to-end assembly fixtures for italic/bold/sub/sup |
| A disabled or non-editable staff abstract remains visually formatted but cannot mutate client or server state. | Awardee tab/editor | Read-only component and route-gate tests |
| Parent Markdown state always describes the document currently visible in the editor; serialization never rejects and never leaves the parent holding an older value. | Serializer; editor; both callers | Transaction tests with unsupported/degraded inputs |
| Initial editor seeding and server-driven reseeding never emit a user change or create dirty state. | Editor; both callers | Mount/reseed tests asserting no `onChange` and no save enablement |
| Abstract length is enforced against serialized Markdown with the same 20000-character cap in both clients and both server write paths. | Shared limit; both callers; both routes/services | Boundary tests with heavily marked-up and multi-byte content |
| Unsupported pasted structure loses formatting but preserves all text in source order. | Editor paste transform; serializer | Word/Google Docs HTML and drag/drop fixtures with word-for-word assertions |
| A stale staff save never overwrites the unsaved editor document; current server text and the attempted text remain separately available until the user chooses how to reconcile them. | Awardee tab conflict state; staff GET | 409/412 component tests with two distinct values present |
| A Dataverse timeout after an abstract PATCH cannot turn a committed edit into a false failure. | Staff abstract service; Awardee tab | Non-412 throw + exact re-read returns success/fresh ETag; mismatch/read failure stays non-success; error renders beside Save |

## 4. Selected design

### 4.1 Shared restricted editor

[VERIFIED via source/tests] `shared/components/external/GranteeAbstractEditor.js` is a controlled Tiptap editor shared by grantee abstracts and captions; its Markdown persistence contract remains separate from reviewer answers. Caption callers select the compact presentation and caption-specific toolbar label without changing the extension or serializer set.

The abstract toolbar will contain:

- bold;
- italic;
- subscript;
- superscript;
- undo and redo.

StarterKit features outside that list will be disabled. Links, headings, lists, blockquotes, images, code, tables, text color, font choice, and raw HTML will not be offered.

[VERIFIED via source/package tree] Subscript and superscript are mutually exclusive marks. Their direct extensions are pinned at `2.27.2`, and the resolved Tiptap runtime remains on one version.

[VERIFIED] The direct `@tiptap/pm` dependency exports `MarkdownSerializer`. The implementation may use that class as a traversal primitive, but it must supply the complete node, mark, and escape rules below. It must not inherit `defaultMarkdownSerializer` behavior: that default targets CommonMark and has no contract for this renderer's Pandoc-style subscript/superscript extensions.

[VERIFIED via source/tests] Paste and drag/drop use an explicit transform rather than relying on disabled extensions. Pasted HTML is reduced to paragraphs plus the four allowed marks. Headings, lists, tables, blockquotes, and code are flattened to paragraphs with their text preserved in source order; links become link text. Unsupported content is never silently dropped.

[VERIFIED via source/tests] The editor uses deferred first rendering to avoid a Next.js hydration mismatch. The editable region receives an accessible name through `aria-labelledby` or `aria-label`, required/invalid state, and read-only semantics. The toolbar uses `role="toolbar"`; every button has `aria-label` and `aria-pressed`, works by keyboard, preserves selection, and has visible focus. The toolbar wraps on narrow viewports.

### 4.2 Canonical conversion boundary

[VERIFIED via source/tests] Markdown remains the only editable value held by parent forms and sent over APIs.

#### 4.2.1 Verified renderer capability preflight

The serializer grammar is based on the following current renderer behavior, verified on 2026-08-13 from `shared/utils/grantee-markdown.js` plus read-only execution probes:

- Backslash escaping preserves literal `*`, `_`, `~`, `^`, and backslash characters through rendering.
- Blank lines create paragraphs. Two spaces followed by a newline create `<br>`; a single newline is only a soft break.
- Raw HTML is escaped and displayed as text before sanitization; `&`, `<`, and `>` are encoded once in rendered HTML.
- Sup/sub pairing is single-line and starts with a non-space character, but the content may contain spaces. Consequently, two unescaped approximation markers on one line can pair unexpectedly.
- `***text***` renders nested italic and bold. Sub/sup markers can contain nested bold/italic, and bold/italic spans can contain sub/sup.
- Trailing whitespace inside an emphasis delimiter prevents emphasis. Adjacent independently delimited identical marks can be ambiguous and must be merged before emission.

These behaviors become characterization tests before serializer implementation so a future `marked` change cannot silently alter the persistence grammar.

The boundary will be:

```text
Dataverse Markdown
  -> server renderGranteeBody(...)
  -> sanitized editor HTML
  -> Tiptap document while editing
  -> narrow Markdown serializer on each editor change
  -> existing client state and save/submit payload
  -> existing Dataverse Memo field
```

[VERIFIED via serializer tests] The client-safe serializer helper has an explicit node/mark map for paragraphs, hard breaks, bold, italic, subscript, and superscript. Unknown nodes and marks fail closed by reducing to escaped text content. Serialization never rejects, never throws to the caller, never retains the prior parent value, and never emits raw HTML. Every editor transaction produces exactly one `onChange` value describing the visible document.

#### 4.2.2 Canonical serialization grammar

The serializer emits exactly one canonical form:

- italic: `*text*`;
- bold: `**text**`;
- combined bold/italic: `***text***`;
- subscript: `~text~`;
- superscript: `^text^`;
- paragraph boundary: one blank line;
- hard break: two spaces followed by a newline.

Plain-text Markdown punctuation is escaped before mark delimiters are added. The bespoke escape function must cover the renderer's active delimiters (`*`, `_`, `~`, `^`, and `\`) and every context-sensitive CommonMark trigger that could otherwise create a link, heading, list, quote, code span/block, thematic break, or other structure. Escaping a numbered-list prefix targets the punctuation (`1\.`), not the digit. Raw `<br>` is never emitted.

Adjacent runs carrying the same mark set are merged. Leading and trailing whitespace in a marked range moves outside the delimiters; an all-whitespace or empty range drops its marks. Mark nesting uses a single deterministic order, and the editor prevents simultaneous subscript and superscript on the same range.

[VERIFIED via serializer fixtures] The serializer is a semantic fixed point: after the first intentional edit, render → parse → serialize produces the same canonical Markdown for every supported fixture. Existing Markdown is not normalized merely by loading it.

The initial Tiptap seed and any server-driven `setContent` call must suppress update emission. Parent state begins with the exact loaded Markdown string, and dirty state compares against that original string. Only an intentional editor transaction may replace it with canonical serialized Markdown; normalization caused by that edit is accepted and tested.

### 4.3 Safe load values

[VERIFIED via route/service tests] Editor HTML is derived on the server by calling the existing `renderGranteeBody` renderer:

- External context response: add a derived `abstractHtml` for `abstractApproved || abstractFormatted` while retaining the existing source strings for compatibility.
- Staff abstract GET response: add a derived `effectiveHtml` beside the existing `effective` Markdown value.

These are response-only derived values; they are not new persisted fields. Client code must use the Markdown value for dirty tracking and persistence and use the HTML value only to seed/reseed Tiptap.

Initial seeding must not emit `onChange`. A later server-driven reseed is allowed only when no local edit is pending and the caller's existing request/generation identity still matches.

### 4.4 External grantee flow

[VERIFIED via component tests] The Abstract and Image caption textareas in `GranteeDeliverableForm` use the shared editor. Image, waiver, token handling, and the multipart submit boundary remain unchanged. Abstract Markdown still posts as `editedAbstract`; caption Markdown still posts as `caption`.

The editor's `onChange(markdown)` updates the existing `abstract` state. Submission continues to append that state as `editedAbstract`. `writeGranteeDeliverables` continues trimming and writing it to `wmkf_abstractapproved` inside the existing request-and-package changeset.

[VERIFIED via source/boundary tests] One shared `MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH = 20000` contract governs both flows, preserving the staff route's prior limit and staying below the live 32000-character Dataverse ceiling. The external editor displays remaining/over-limit state, disables submission while over the cap, and the external service rejects an over-limit serialized value before image scanning, upload, or any Dataverse write. Busboy's existing 64 KiB field-size cap remains a transport backstop, not the semantic limit.

No draft autosave will be added. Reviewer autosave depends on a distinct durable draft contract; adding one to the grantee's bundled abstract/image/caption/waiver workflow is outside this formatting change.

[VERIFIED via source/boundary tests] Caption authors receive the same six toolbar controls and a shared `MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH = 2000` counter. The client blocks an over-limit submit and `writeGranteeDeliverables` rejects it before image scanning, SharePoint upload, or Dataverse writes. `captionHtml` is response-only output from `renderGranteeCaption`; `wmkf_imagecaption` remains Markdown.

### 4.5 Staff Awardee-tab flow

[VERIFIED via component tests] The effective-abstract textarea in `AwardeeTab` is replaced by the new editor. The existing client capability response, dirty-state behavior, save button, `baseField`, and ETag remain.

The staff PUT payload remains:

```json
{ "requestId": "...", "text": "canonical Markdown", "etag": "...", "baseField": "formatted|approved" }
```

The route and service keep their current validation, fresh-row target resolution, status allowlists, conditional Dataverse update, stale response, and post-save ETag refresh. No formatting authorization will be inferred solely in the client.

[VERIFIED via component/service tests] The S412 replacement-caption panel uses the same restricted editor in compact mode. Its parent state and multipart `caption` field remain canonical Markdown, the 2000-character client gate mirrors the route, and the existing deliverable ETag/status/rollback contract is unchanged. The read-only submitted-caption display uses server-sanitized `captionHtml` with escaped text fallback.

The former stale path reloaded immediately and overwrote the working textarea. [VERIFIED via component tests] On `code:'stale'`, the rich editor fetches the current server abstract into separate conflict state without reseeding the editor. It displays the current server value while the user's unsaved value remains in the editor, with explicit actions to keep the user's version or replace it with the server version. A successful save updates the ETag, effective field, and dirty baseline without reseeding editor content. Every conflict fetch and resolution remains guarded by the existing request id and abstract load generation.

[VERIFIED via production logs/source/tests, 2026-08-14] A Dataverse PATCH can commit but exceed the 30-second response timeout. The staff save service now re-reads both abstract fields after any non-412 write error. It returns success only when the fresh effective field is unchanged and its exact Markdown equals the attempted value; a target flip remains stale, and a mismatch or unavailable confirmation remains a typed failure. The save-specific message is rendered in the Save-button control row rather than the tab-level error area.

## 5. Implementation sequence and file surface

### Phase 1 — Conversion contract and editor ✅

1. Convert the §4.2.1 probe results into renderer characterization tests before writing the serializer.
2. Add the direct subscript/superscript Tiptap dependencies and verify one resolved Tiptap major.
3. Add the shared 20000-character serialized-Markdown limit and enforce it in both server write paths.
4. Add the narrow Markdown serializer with pure grammar and fixed-point tests first.
5. Add `GranteeAbstractEditor` with non-emitting seed/reseed behavior, state synchronization, explicit paste/drag transforms, complete accessibility semantics, selection-preserving toolbar actions, and the current editor's deferred-render pattern.
6. Add component tests for toolbar-to-Markdown behavior, parent-state synchronization, length state, accessibility, narrow-viewport toolbar wrapping, and unsupported pasted formatting.

Likely files:

- `package.json`
- `package-lock.json`
- a shared abstract-length contract used by clients and servers
- `shared/utils/grantee-markdown-serializer.js` (new)
- `shared/components/external/GranteeAbstractEditor.js` (new)
- focused unit/component tests

### Phase 2 — Server-derived load HTML ✅

1. Add `abstractHtml` to the external grantee context response using the effective stored Markdown.
2. Add `effectiveHtml` to the staff abstract load response using the same renderer.
3. Update route/service contract comments and response tests.
4. Keep all existing Markdown response properties so the change is additive.
5. Update both affected rows in `docs/API_ROUTE_SECURITY_MATRIX.md`; that matrix currently records response fields for these routes at this granularity.

Likely files:

- `pages/api/external/grantee/[token]/context.js`
- `lib/services/workbench/grantee-deliverables/abstract-service.js`
- relevant context and abstract service tests
- `docs/API_ROUTE_SECURITY_MATRIX.md`

### Phase 3 — Wire both callers ✅

1. Replace the external Abstract textarea and keep `editedAbstract` unchanged.
2. Replace the staff effective-abstract textarea and keep `text`, ETag, `baseField`, error handling, and capability gates unchanged.
3. Verify external initial values prefer approved text exactly as today.
4. Verify a staff context switch or load race cannot install an old editor value into a newly selected request; preserve the Awardee tab's existing request-generation guards at every post-await state write.
5. Replace the staff stale-save auto-reload with the two-value conflict state from §4.5 so unsaved editor content is never overwritten.

Likely files:

- `shared/components/external/GranteeDeliverableForm.js`
- `shared/components/workbench/AwardeeTab.js`
- focused component/integration tests

### Phase 4 — Downstream regression and documentation (abstract slice complete)

1. Extend renderer and assembly tests with scientific-name italics and combined bold/sub/sup examples.
2. Prove the same formatting reaches portal preview, website HTML, and cycle export through canonical document assembly.
3. `GRANTEE_PORTAL_SPEC.md` now records the as-built contract. `GRANTEE_PORTAL_BUILD_PLAN.md` remains an explicitly historical implementation chronology and was not rewritten as current guidance.
4. The API matrix, plan, canonical portal spec, and catalog were reconciled with `/sweep`; no schema change is claimed because none occurred.
5. Run a Preview smoke with one test grantee edit and one staff edit before deliberate production promotion; verify Dataverse stores Markdown while rendered output shows formatting.

### Phase 5 — Caption follow-up ✅

1. Reuse the restricted editor for both caption entry points with a compact presentation and caption-specific toolbar label.
2. Add response-only `captionHtml` to the external context and staff abstract GET via `renderGranteeCaption`.
3. Render the submitted caption from that sanitized value with escaped-text fallback.
4. Share the 2000-character caption limit across both clients and both server writers.
5. Preserve the existing `wmkf_imagecaption` Markdown field, external atomic changeset, staff deliverable ETag, and publication assembly path.

## 6. Tests and gates

### Required focused tests

- Markdown → safe editor HTML → Markdown semantic round trips for plain paragraphs, italic species names, bold, subscript, superscript, and combinations.
- Existing user-authored Markdown loads with formatting and remains semantically equivalent after an edit.
- Initial load and a non-user reseed emit no `onChange`, do not alter the exact loaded Markdown string, and do not create dirty state.
- Literal `*`, `_`, `~`, `^`, and `\` typed as plain text survive save → reload → save without becoming markup or accumulating escape characters.
- Literal tildes such as `pH 7 ~ 8` remain literal; two approximation tildes or two approximation carets on one line do not pair into subscript/superscript.
- Adjacent identical mark runs merge, leading/trailing mark whitespace moves outside delimiters, and nested bold/italic/sub/sup uses the verified canonical order.
- `&`, `<`, and `>` survive load → edit → save → reload without loss or double escaping.
- Multiple paragraphs and hard breaks round-trip using the verified blank-line and two-space syntax; ordinary soft breaks have an explicit tested normalization.
- The serializer is a fixed point over every grammar fixture.
- Raw `<script>`, `<img onerror>`, links, headings, lists, blockquotes, code, and unsupported pasted styling are present in negative-test setup and are removed/flattened.
- Representative Word and Google Docs HTML containing headings, lists, links, and a table preserves every word in source order while producing only allowed marks.
- Every editor transaction, including an unsupported/degraded paste, updates parent state to the serialization of the visible document and never retains an older value.
- Empty-document behavior cannot bypass either server's existing non-empty validation.
- Serialized length is accepted at 20000 characters and rejected at 20001 in both routes; markup expansion and multi-byte input are covered.
- External JSON finalization contains canonical Markdown in `editedAbstract`; any image bytes travel browser→private Blob under a separate actor-bound staging contract, and the rest of the package is preserved.
- Staff PUT contains canonical Markdown in `text` and preserves ETag/base-field behavior.
- Staff stale ETag and field-flip cases preserve the unsaved editor value while separately displaying current server text; non-editable status still fails without a write.
- The editable region has an accessible name plus required/invalid state; all toolbar actions are keyboard-operable; disabled/read-only mode exposes read-only semantics and accepts no input.
- Approved text still wins over formatted text in assembly; formatted remains the fallback.
- Output assembly produces `<em>`, `<strong>`, `<sub>`, and `<sup>` and no unsupported tags.

### Required gates

Run the smallest relevant registered gates, each followed sequentially by its self-test when one exists. At minimum:

```text
npm test -- --runInBand <focused test files>
npm run check:api-routes
npm run check:api-routes:self-test
npm run check:docs-catalog
npm run build
```

Before implementation completion, inspect `docs/CI_GATES_REFERENCE.md` and `package.json` for any additional current gates triggered by the exact file set. A green gate is evidence only for its documented scan surface.

### Local verification record (2026-08-13)

- Serializer/editor/server-boundary suite: 70 tests passed across five suites.
- Response-contract suite: 57 tests passed across three suites.
- Caller/editor/stale-conflict suite: 102 tests passed across three suites.
- Final combined serializer → callers → persistence-boundary → document-assembly run: 230 tests passed across 11 suites.
- `npm run check:types`: passed.
- `npm run check:api-routes` followed by `npm run check:api-routes:self-test`: passed.
- Canonical Turbopack `npm run build`: not proven in this host because Turbopack failed twice while attempting to create a process/bind a port (`Operation not permitted`), including the approved out-of-sandbox retry. The documented `next build --webpack` fallback passed against the final file set; only the repository's existing dynamic-dependency warnings were emitted.
- Signed-in production observation: the owner confirmed staff rich-text formatting and persistence on 2026-08-14. The observed save exceeded the client timeout but committed, which led to the ambiguous-write reconciliation follow-up documented in §4.5.

## 7. Compatibility, rollout, and rollback

- [VERIFIED] No bulk migration is required: plain text is valid Markdown, and existing allowed Markdown already renders through the canonical helper.
- [VERIFIED via route/service tests] The API response additions are backward-compatible; existing fields and write payloads remain.
- [ASSUMED] External Power Automate or direct Dataverse readers may exist outside this repository. Keeping the exact persisted field meanings and syntax minimizes that risk; no external-consumer claim is treated as proven.
- [VERIFIED via git and owner production observation] Abstract and caption runtime UI work is merged to auto-deploying `main`; the separate slow-save reconciliation remains isolated on `codex/fix-abstract-save-timeout` pending deliberate promotion.
- [VERIFIED by unchanged persistence contract] Rollback can revert the editor and derived response fields without data repair because stored values remain readable Markdown.
- [VERIFIED by unchanged renderer] After rollback, allowed formatting markers may again appear visibly in a plain textarea, but publication output remains formatted because the canonical renderer is unchanged.

## 8. Explicit non-goals

- Dataverse Rich Text column conversion or new parallel HTML fields.
- Reviewer-style HTML plus plain-text mirror persistence.
- Automatic scientific-name detection or AI-driven auto-italics.
- Draft autosave for the external grantee submission.
- Automatic formatting or conversion beyond the explicit caption toolbar.
- Changes to abstract generation prompts.
- Changes to publication precedence, lifecycle status, email invitation content, or document-export architecture.

## 9. Acceptance criteria

The feature is acceptable when all of the following are true:

1. A grantee can select an organism name, press Italic, submit, reopen/read the result, and see the name italicized.
2. A staff user can do the same in the Awardee tab and save through the existing conditional-write contract.
3. Dataverse contains canonical Markdown rather than HTML for both paths.
4. Existing plain-text abstracts require no migration and remain unchanged unless edited.
5. Portal preview, website output, and cycle export preserve the allowed formatting.
6. Unsupported formatting is absent from both persisted Markdown and rendered HTML.
7. Existing grantee atomic submission and staff stale-write protections still pass their tests.
8. The value submitted always matches the document visible in the editor, including after paste and serialization degradation.
9. Initialization does not rewrite existing content; 20000-character serialized-Markdown limits and accessible editor semantics are enforced in both surfaces.
10. Relevant documentation and gates are current and green.
11. Both caption editors expose the same formatting options, persist only Markdown, and render the saved formatting in the staff display and existing exports.

## 10. Contract-reconciliation audit

- **Whole-flow:** Covered from both abstract and caption editors through payloads, routes/services, Dataverse fields, canonical assembly, and output consumers.
- **Partial success:** No new batch boundary. External submission remains the existing atomic request/package changeset; staff save remains one conditional field update.
- **Async/stale state:** No autosave is added. Staff request-generation, base-field, status, and ETag guards must be preserved; controlled editor synchronization must not reset the caret or install stale request content. The current stale-save auto-reload is intentionally replaced because it overwrites the user's working copy.
- **Helper extraction:** Reviewer and abstract editors may share presentation-only primitives, but their allowed formatting and persistence semantics must remain separate.
- **Durable surface:** No new table, field, migration, or route. Additive response fields and durable documentation still require route/doc checks.
- **Documentation reconciliation:** Required after implementation through `/sweep`; implementation status must not be changed early.
- **Symbol/consumer fan-out:** The meanings of `wmkf_abstractformatted` and `wmkf_abstractapproved` remain unchanged; implementation must rerun literal-symbol searches to confirm all readers still receive Markdown.

## 11. Independent review record

**Status:** Completed 2026-08-13 by Claude Opus under a verified interactive
`claude.ai` OAuth session (`authMethod: claude.ai`, Max subscription). Host policy
limited the review payload to this plan artifact and disabled all Claude tools;
Codex independently verified source-dependent recommendations locally before
editing the plan.

**Reviewer verdict:** `READY WITH NAMED CHANGES`.

| Finding | Disposition and evidence |
|---|---|
| P0 — serialization/escaping grammar was underspecified | Accepted. §4.2.1 records actual renderer behavior; §4.2.2 defines delimiters, escaping, whitespace, nesting, paragraph/break, degradation, and fixed-point rules. |
| P0 — rejected serialization could leave visible editor state ahead of submitted parent state | Accepted. Serialization now always degrades to text and emits; rejection/last-good-value behavior is forbidden and tested. |
| P1 — load-time normalization could create a no-op rewrite | Accepted. Seed/reseed update emission is suppressed and dirty state starts from the exact loaded Markdown. |
| P1 — default ProseMirror Markdown behavior does not match custom sub/sup syntax | Accepted with correction. `@tiptap/pm/markdown` availability was locally verified, but only its serializer class may be used with a complete custom grammar; the default serializer is excluded. |
| P1 — persisted and UI length contracts were incomplete | Accepted with corrected current state. Live Memo length is 32000, staff currently enforces 20000, and external submission has only a 64 KiB transport cap. The plan standardizes both write paths on 20000 serialized characters. |
| P1 — paste behavior was tested but not designed | Accepted. Explicit text-preserving paste/drag transformation is now part of §4.1. |
| P1 — contenteditable accessibility was incomplete | Accepted. §4.1 and §6 now require naming, state, toolbar semantics, keyboard operation, focus, and read-only behavior. |
| P1 — staff stale response could overwrite the working document | Accepted and source-confirmed at `AwardeeTab.js:349-360`. §4.5 replaces auto-reload with distinct server/unsaved conflict state. |

Optional reviewer suggestions incorporated: reuse the existing editor's
SSR/hydration pattern, make the toolbar responsive, update both API matrix rows
unconditionally, add a Preview smoke, and document rollback display behavior.
A runtime kill switch and a new shared abstract-precedence helper remain out of
scope: rollback is data-safe, and the three precedence call sites carry different
field-target/editability semantics that should not be collapsed without a separate
helper-semantics review.

**Final plan verdict after reconciliation:** `IMPLEMENTED AND PRODUCTION-LIVE`.
No schema or data migration was required. The separate slow-save reconciliation
is implemented and verified on its feature branch but is not part of this verdict
until deliberately promoted.
