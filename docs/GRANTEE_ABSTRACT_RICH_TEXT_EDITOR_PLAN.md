---
title: Grantee Abstract Rich-Text Editor Build Plan
domain: grantee-deliverables
kind: plan
status: draft
summary: "Planned Markdown-backed WYSIWYG editing for grantee abstracts in the external portal and staff Awardee tab, without a Dataverse schema change."
canonical: false
cataloged: 2026-08-13
owner: product-engineering
related:
  - docs/GRANTEE_PORTAL_SPEC.md
  - docs/GRANTEE_PORTAL_BUILD_PLAN.md
  - docs/APPLICATION_STATE_ATLAS.md
---

# Grantee Abstract Rich-Text Editor Build Plan

**Status:** Proposed; implementation has not started.  
**Change surface:** Abstract editing in the external grantee portal and the staff Workbench Awardee tab.  
**Persistence:** Existing Dataverse Memo fields `akoya_request.wmkf_abstractformatted` and `akoya_request.wmkf_abstractapproved`.  
**Review owner:** Claude Opus, read-only adversarial plan review.  
**Implementation owner:** Unassigned until this plan is accepted.

## 1. Outcome and decision

[PLANNED] Give grantees and staff a familiar formatting toolbar so scientific names such as *Escherichia coli* can be italicized without typing Markdown syntax.

[PLANNED] Use Tiptap, the same editor framework used by reviewer answers, but give abstracts a narrower formatting profile and keep the existing Markdown persistence contract. The editor will display formatted content and emit canonical Markdown:

| Visible formatting | Persisted Markdown |
|---|---|
| *Escherichia coli* | `*Escherichia coli*` |
| **Important result** | `**Important result**` |
| H₂O | `H~2~O` |
| x² | `x^2^` |

[PLANNED] Do not add or convert Dataverse fields, do not store raw HTML in the existing fields, and do not copy the reviewer answer dual-HTML/plain-text persistence model.

## 2. Current-state evidence

| Claim | Producer / entry point | Persistence | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| Staff-generated and grantee-approved abstracts have separate provenance. | Generation/staff edit; external grantee submit | `wmkf_abstractformatted`; `wmkf_abstractapproved` | Staff UI and publication assembly | `docs/GRANTEE_PORTAL_SPEC.md:66-69`; `lib/services/grantee-upload.js:149-156` | VERIFIED |
| Both live abstract attributes are Memo fields with the expected logical names. | Dataverse metadata | `akoya_request` | All abstract readers/writers | `node scripts/preflight-grantee-deliverables-fields.mjs` returned exact matches on 2026-08-13 | VERIFIED |
| Abstract storage is already a controlled Markdown subset, not raw HTML. | Staff and grantee save payloads | Existing Memo fields | `renderGranteeBody` | `shared/utils/grantee-markdown.js:1-24,105-115` | VERIFIED |
| The renderer supports bold, italic, superscript, and subscript and rejects unsupported/raw HTML. | `renderGranteeBody` | N/A | Portal/site/document HTML | `shared/utils/grantee-markdown.js:35-107`; `tests/unit/grantee-markdown.test.js:17-82` | VERIFIED |
| Publication assembly prefers approved text, falls back to formatted text, and renders Markdown to HTML. | `assembleGranteeDocument` | Both abstract fields | Preview, website, and cycle export consumers | `lib/services/grantee-document-assembly.js:124-154` | VERIFIED |
| Both current abstract editors are plain textareas. | External grantee form; staff Awardee tab | Client string state | Submit/save payload | `shared/components/external/GranteeDeliverableForm.js:51-54,134-143`; `shared/components/workbench/AwardeeTab.js:658-672` | VERIFIED |
| The portal specification called for a lightweight WYSIWYG for occasional scientific formatting. | Product specification | N/A | Planned portal editor | `docs/GRANTEE_PORTAL_SPEC.md:233-258` | VERIFIED |
| Reviewer answers already use a controlled Tiptap editor. | `RichReviewEditor` | Sanitized HTML plus a text mirror | Reviewer and staff review flows | `shared/components/external/RichReviewEditor.js:1-20,59-124`; `lib/external/sanitize-review-html.js:1-24,82-141` | VERIFIED |

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

## 4. Selected design

### 4.1 Abstract-specific editor

[PLANNED] Add `shared/components/external/GranteeAbstractEditor.js` as a controlled Tiptap editor. It may reuse small presentation primitives from `RichReviewEditor` only if doing so does not merge the two persistence contracts.

The abstract toolbar will contain:

- bold;
- italic;
- subscript;
- superscript;
- undo and redo.

StarterKit features outside that list will be disabled. Links, headings, lists, blockquotes, images, code, tables, text color, font choice, and raw HTML will not be offered.

[PLANNED] Add direct dependencies for the matching Tiptap subscript and superscript extensions at the repository's existing Tiptap version. The existing direct `@tiptap/pm` dependency will provide the ProseMirror Markdown serializer base; the application will not rely on an undeclared transitive dependency.

### 4.2 Canonical conversion boundary

[PLANNED] Keep Markdown as the only editable value held by parent forms and sent over APIs.

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

[PLANNED] Add a client-safe serializer helper with an explicit node/mark map for paragraphs, hard breaks, bold, italic, subscript, and superscript. Unknown nodes and marks must fail closed by reducing to their text content or rejecting the conversion; they must never serialize raw HTML.

[PLANNED] The helper will normalize semantically equivalent editor output to one stable convention. Tests, not string identity alone, will define round-trip correctness because insignificant whitespace and delimiter choices can differ.

### 4.3 Safe load values

[PLANNED] Derive editor HTML on the server by calling the existing `renderGranteeBody` renderer:

- External context response: add a derived `abstractHtml` for `abstractApproved || abstractFormatted` while retaining the existing source strings for compatibility.
- Staff abstract GET response: add a derived `effectiveHtml` beside the existing `effective` Markdown value.

These are response-only derived values; they are not new persisted fields. Client code must use the Markdown value for dirty tracking and persistence and use the HTML value only to seed/reseed Tiptap.

### 4.4 External grantee flow

[PLANNED] Replace only the Abstract textarea in `GranteeDeliverableForm` with the new editor. Keep caption, image, waiver, token handling, validation, and the multipart submit boundary unchanged.

The editor's `onChange(markdown)` updates the existing `abstract` state. Submission continues to append that state as `editedAbstract`. `writeGranteeDeliverables` continues trimming and writing it to `wmkf_abstractapproved` inside the existing request-and-package changeset.

No draft autosave will be added. Reviewer autosave depends on a distinct durable draft contract; adding one to the grantee's bundled abstract/image/caption/waiver workflow is outside this formatting change.

### 4.5 Staff Awardee-tab flow

[PLANNED] Replace the effective-abstract textarea in `AwardeeTab` with the new editor. Preserve the existing client capability response, dirty-state behavior, save button, `baseField`, and ETag.

The staff PUT payload remains:

```json
{ "requestId": "...", "text": "canonical Markdown", "etag": "...", "baseField": "formatted|approved" }
```

The route and service keep their current validation, fresh-row target resolution, status allowlists, conditional Dataverse update, stale response, and post-save ETag refresh. No formatting authorization will be inferred solely in the client.

## 5. Implementation sequence and file surface

### Phase 1 — Conversion contract and editor

1. Add the direct subscript/superscript Tiptap dependencies.
2. Add the narrow Markdown serializer with pure unit tests first.
3. Add `GranteeAbstractEditor` with disabled/read-only behavior, accessible pressed states, selection-preserving toolbar actions, and controlled-value synchronization that does not reset the caret after local edits.
4. Add component tests for toolbar-to-Markdown behavior and unsupported pasted formatting.

Likely files:

- `package.json`
- `package-lock.json`
- `shared/utils/grantee-markdown-serializer.js` (new)
- `shared/components/external/GranteeAbstractEditor.js` (new)
- focused unit/component tests

### Phase 2 — Server-derived load HTML

1. Add `abstractHtml` to the external grantee context response using the effective stored Markdown.
2. Add `effectiveHtml` to the staff abstract load response using the same renderer.
3. Update route/service contract comments and response tests.
4. Keep all existing Markdown response properties so the change is additive.

Likely files:

- `pages/api/external/grantee/[token]/context.js`
- `lib/services/workbench/grantee-deliverables/abstract-service.js`
- relevant context and abstract service tests
- `docs/API_ROUTE_SECURITY_MATRIX.md` only if its existing route contract records response fields at this granularity

### Phase 3 — Wire both callers

1. Replace the external Abstract textarea and keep `editedAbstract` unchanged.
2. Replace the staff effective-abstract textarea and keep `text`, ETag, `baseField`, error handling, and capability gates unchanged.
3. Verify external initial values prefer approved text exactly as today.
4. Verify a staff context switch or load race cannot install an old editor value into a newly selected request; preserve the Awardee tab's existing request-generation guards at every post-await state write.

Likely files:

- `shared/components/external/GranteeDeliverableForm.js`
- `shared/components/workbench/AwardeeTab.js`
- focused component/integration tests

### Phase 4 — Downstream regression and documentation

1. Extend renderer and assembly tests with scientific-name italics and combined bold/sub/sup examples.
2. Prove the same formatting reaches portal preview, website HTML, and cycle export through canonical document assembly.
3. Update `GRANTEE_PORTAL_SPEC.md` and `GRANTEE_PORTAL_BUILD_PLAN.md` from planned to implemented only after the UI ships.
4. Reconcile the relevant Atlas/API/wiki restatements with `/sweep`; do not claim a schema change because none is planned.

## 6. Tests and gates

### Required focused tests

- Markdown → safe editor HTML → Markdown semantic round trips for plain paragraphs, italic species names, bold, subscript, superscript, and combinations.
- Existing user-authored Markdown loads with formatting and remains semantically equivalent after an edit.
- Literal tildes such as `pH 7 ~ 8` remain literal rather than becoming subscript.
- Raw `<script>`, `<img onerror>`, links, headings, lists, blockquotes, code, and unsupported pasted styling are present in negative-test setup and are removed/flattened.
- Empty-document behavior cannot bypass either server's existing non-empty validation.
- External multipart submission contains canonical Markdown in `editedAbstract` and preserves the rest of the package.
- Staff PUT contains canonical Markdown in `text` and preserves ETag/base-field behavior.
- Staff stale ETag, field flip, and non-editable status cases still fail without a write.
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

## 7. Compatibility, rollout, and rollback

- [VERIFIED] No bulk migration is required: plain text is valid Markdown, and existing allowed Markdown already renders through the canonical helper.
- [PLANNED] The API response additions are backward-compatible; existing fields and write payloads remain.
- [ASSUMED] External Power Automate or direct Dataverse readers may exist outside this repository. Keeping the exact persisted field meanings and syntax minimizes that risk; no external-consumer claim is treated as proven.
- [PLANNED] This is runtime UI work and therefore follows the repository's deliberate feature-branch promotion process rather than landing directly on auto-deploying `main`.
- [PLANNED] Rollback reverts the editor and derived response fields. Stored values remain readable Markdown, so rollback does not require data repair.

## 8. Explicit non-goals

- Dataverse Rich Text column conversion or new parallel HTML fields.
- Reviewer-style HTML plus plain-text mirror persistence.
- Automatic scientific-name detection or AI-driven auto-italics.
- Draft autosave for the external grantee submission.
- Formatting controls for the image caption in this first slice.
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
8. Relevant documentation and gates are current and green.

## 10. Contract-reconciliation audit

- **Whole-flow:** Covered from both editors through payloads, routes/services, Dataverse fields, canonical assembly, and output consumers.
- **Partial success:** No new batch boundary. External submission remains the existing atomic request/package changeset; staff save remains one conditional field update.
- **Async/stale state:** No autosave is added. Staff request-generation, base-field, status, and ETag guards must be preserved; controlled editor synchronization must not reset the caret or install stale request content.
- **Helper extraction:** Reviewer and abstract editors may share presentation-only primitives, but their allowed formatting and persistence semantics must remain separate.
- **Durable surface:** No new table, field, migration, or route. Additive response fields and durable documentation still require route/doc checks.
- **Documentation reconciliation:** Required after implementation through `/sweep`; implementation status must not be changed early.
- **Symbol/consumer fan-out:** The meanings of `wmkf_abstractformatted` and `wmkf_abstractapproved` remain unchanged; implementation must rerun literal-symbol searches to confirm all readers still receive Markdown.

## 11. Independent review record

**Status:** Pending. Claude Code reported `Not logged in` on 2026-08-13, so no
review result was produced or accepted. Resume the read-only Claude Opus review
only after Claude Code has an interactive OAuth session; do not substitute an
Anthropic API key.
