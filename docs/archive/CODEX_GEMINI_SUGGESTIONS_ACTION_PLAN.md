# Codex Action Plan: Gemini Suggestions Triage

**Status:** Approved implementation plan (reviewed and revised 2026-05-12, Session 147)
**Owner:** Codex implements; Claude reviews via the handoff report (§ "Handoff report" below).
**Source reviewed:** `docs/archive/GEMINI_CODE_REVIEW_SUGGESTIONS.md`
**Goal:** Capture the high-value, low-to-medium-risk refactors from the Gemini review without creating broad churn or conflicts.

## Coordination notes

- Codex should implement phases in the order given. Each phase is a single PR-sized slice.
- Avoid broad import rewrites, service-folder moves, TypeScript migration, or ESM standardization in this workstream — see Non-goals.
- Keep changes small enough to review independently.
- If a concurrent agent is editing `pages/phase-ii-writeup.js`, coordinate before touching it; that file is the main conflict hotspot.
- Preserve unrelated user or agent changes in the worktree.
- **W6 coordination (important):** when Phase 4 touches `lib/services/database-service.js`, it is comment cleanup ONLY. Do not delete or alter any Postgres SQL. The W6 Postgres table-drop is deferred to a post-pilot one-shot DELETE (≥ 2026-07-01) per memory entry `[[project-w6-table-drop-closed]]` and `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` post-pilot row. Stale researcher comments are dead text, not pending work.

## Explicit non-goals

- Do not reorganize `lib/services/` into subfolders.
- Do not convert files to TypeScript.
- Do not standardize all CommonJS `require()` calls to ESM imports.
- Do not delete live `DatabaseService` cache or preference methods.
- Do not refactor all stream consumers in one pass.
- **Do not bump dependency versions** (`marked`, DOMPurify, etc.). Use the versions pinned in `package.json` today.
- Do not modify or remove the `useDataversePrefs()` dispatcher in `database-service.js` — its dead Postgres branch is intentionally retained pending a separate cleanup pass (out of scope here).
- Do not touch `pages/api/cron/*` or the Postgres reviewer tables. They are death-row code on the W6 post-pilot calendar; touching them here would re-litigate that decision.

## Phase 0: Pre-flight

Before any code changes:

1. `git status` shows a clean tree on `main` (or the agreed branch). If anything is uncommitted, stash or commit it first.
2. Run the project CI gates and confirm green:
   - `npm run check:atlas`
   - `npm run check:atlas:self-test`
   - `npm run check:doc-currency`
   - `npm run check:doc-currency:self-test`
   - `npm run check:api-routes`
3. Read `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` post-pilot row + memory entry `[[project-w6-table-drop-closed]]` so you understand why the database-service comments matter (and why they're not pending work).

A red gate is a P0 blocker — do not start a phase on a red gate.

## Phase 1: Shared markdown renderer

**Why:** `pages/phase-ii-writeup.js:11-40` contains a local regex-based `renderMarkdown()` helper. The output is already sanitized via DOMPurify at render time (line 656), so this is not an XSS emergency — but the regex parser is brittle, fails on nested markdown, and duplicates logic that already exists in a tested shared utility.

**Pre-flight grep (do this first):**

```bash
grep -rn "function renderMarkdown\|const renderMarkdown" pages/ shared/
```

If other regex-markdown consumers turn up, do NOT scope-creep — this slice ends at `phase-ii-writeup.js`. File a follow-up for the rest in the handoff report.

**Likely files:**

- `shared/utils/app-markdown.js` (new — naming intentionally mirrors `shared/utils/policy-markdown.js` to flag the different sanitization scope)
- `pages/phase-ii-writeup.js`
- `tests/unit/app-markdown.test.js` (new)

**Implementation steps:**

1. Create `shared/utils/app-markdown.js` based on the `marked` + DOMPurify pattern in `shared/utils/policy-markdown.js`. Use the version of `marked` already in `package.json`; do not bump.
2. The app renderer's allowlist is more permissive than the policy renderer:
   - Allow the same block tags as `policy-markdown.js` (`p`, `h1-h6`, `ul`, `ol`, `li`, `blockquote`, `code`, `pre`, `strong`, `em`, `a`, `hr`, `br`).
   - Decide explicitly whether to allow links. If yes: `href` only, schemes `http|https|mailto`, `target="_blank" rel="noopener noreferrer"` on rendered anchors (Phase II QA content occasionally cites URLs). Document the decision in the file's header comment.
3. Replace the local `renderMarkdown()` function in `pages/phase-ii-writeup.js` with an import from the new utility.
4. Visual parity: the current output uses Tailwind classes inline (`font-semibold text-sm mt-3 mb-1`, `bg-gray-200 px-1 py-0.5 rounded text-xs`, etc.). Reproduce or replace via a small wrapper/className strategy so QA messages don't visually regress.
5. Add focused tests:
   - headings (h1–h3)
   - bold, italic, bold+italic
   - inline code
   - unordered + numbered lists, including nested
   - malicious HTML/script stripping (e.g. `<script>`, `<img onerror>`, `javascript:` URLs)
   - link behavior matches the §2 decision

**Acceptance criteria:**

- `pages/phase-ii-writeup.js` no longer contains a regex markdown parser.
- All markdown output is sanitized through DOMPurify.
- Tests cover normal formatting and unsafe input.
- Phase II QA message rendering is visually unchanged on the dev server (verify the dev-server smoke in the Verification Plan).

## Phase 2: Shared SSE stream parser

**Why:** Ten page files manually parse `ReadableStream` chunks with hand-rolled `data: ` parsing. A parser utility should come *before* a `useAIStream` React hook so the on-wire format can be standardized without coupling every page to a single state model.

**Pre-flight (do this first):**

Before writing tests, read the producer endpoint for whichever Phase II stream you're cutting over (likely `pages/api/process.js` or the QA endpoint) and confirm the actual on-wire format. The plan assumes SSE-style `data:` frames; some endpoints in this codebase emit raw JSON deltas without SSE framing. Tests must match the real format.

**Stream formats to support:**

```text
data: {"progress":50,"message":"Working"}
```

```text
event: thinking
data: {"message":"Analyzing..."}
```

If the producer endpoint emits neither (raw JSON deltas), do not retro-fit SSE framing onto it in this slice — scope the parser to SSE format only and file a follow-up to standardize the producer side.

**Likely files:**

- `shared/utils/sse-stream.js` (new)
- `pages/phase-ii-writeup.js` (first consumer)
- `tests/unit/sse-stream.test.js` (new)

**Implementation requirements:**

1. Reads a `ReadableStream`, yields parsed events via async iterator OR callback (pick one and document why).
2. Supports plain `data:` events.
3. Supports named `event:` plus `data:` events.
4. **Cancellation:** parser accepts an `AbortSignal`. When the signal aborts, the parser stops yielding cleanly and releases the stream reader (current consumers — e.g. `phase-ii-writeup.js:606` — already use `AbortController` to cancel mid-stream; parser must honor that).
5. Tolerates invalid JSON on a per-event basis: skip + log, don't crash the whole stream.
6. Preserves partial-buffer handling for events split across chunks.
7. Refactor exactly one Phase II stream path first (suggest QA, since it has the clearest abort path). Do not refactor both `processProposals` and QA in this slice unless the change is trivially small.
8. **Do NOT** introduce a `useAIStream` React hook in this phase. Evaluate hook design after the parser utility proves useful in production for at least one slice.

**Test cases:**

- Partial event split across multiple reads.
- Multiple events in one chunk.
- Named events.
- Plain data-only events.
- Invalid JSON in a single event (parser continues).
- Empty events.
- `[DONE]` sentinel handling if the producer emits one.
- `AbortSignal` mid-stream: parser stops cleanly, reader released.

**Acceptance criteria:**

- At least one Phase II stream path uses the shared parser.
- Parser tests pass.
- Existing stream behavior, progress updates, and cancel-on-close UX are preserved.

## Phase 3: Phase II component extraction

**Why:** `pages/phase-ii-writeup.js` is large and owns upload flow, streaming, QA, feedback refinement, Word export, and modal rendering. Extracting modals/UI components reduces review burden without changing data flow.

**Folder/naming decision (locked):**

- Place new components at the top of `shared/components/` (flat, not in a subfolder).
- Prefix filenames with `Phase2` to mark app-specificity: `Phase2FeedbackModal.js`, `Phase2WordExportModal.js`, `Phase2QAModal.js`.
- Rationale: `shared/components/` is currently flat (`Layout.js`, `FileUploaderSimple.js`, …). A `phase-ii/` subfolder commits to "these are phase-ii-only" and creates a folder-name-vs-content mismatch if QA modals later get reused in Phase I or Multi-Perspective Evaluator. The `Phase2` prefix keeps the option open without restructuring.

**Likely files:**

- `shared/components/Phase2FeedbackModal.js` (new)
- `shared/components/Phase2WordExportModal.js` (new)
- `shared/components/Phase2QAModal.js` (new)
- Optional follow-up: `shared/components/Phase2QAPanel.js` if QA rendering remains large after `Phase2QAModal` extraction.
- `pages/phase-ii-writeup.js` (consumer)

**Implementation steps:**

1. Extract `Phase2FeedbackModal` first. Keep state in the page; pass values + callbacks via props. No business logic moves.
2. Extract `Phase2WordExportModal` next. Same pattern — form state stays in the page initially.
3. Extract `Phase2QAModal`. If the message-list + scroll-behavior block is still large after the modal extraction, follow up with `Phase2QAPanel`.
4. Do not move business logic during this first extraction pass. UI-local state (e.g. local form `isDirty` flags) is fine to relocate; data-flow state stays on the page.
5. After the three extractions, evaluate whether a QA-specific hook is worthwhile. Note the answer in the handoff report; do not build it in this slice.

**Acceptance criteria:**

- `pages/phase-ii-writeup.js` line count drops materially (target: −300+ lines).
- Modal open/close, focus, escape-key, and abort behavior unchanged.
- State ownership is easy to trace from the page down to each modal.
- Each extracted component renders + closes cleanly in the dev-server smoke test.

## Phase 4: `DatabaseService` comment cleanup

**Why:** `lib/services/database-service.js:1-10` advertises features that were gutted in W5 step 2 ("Researcher profile management, Publication tracking, Keyword/expertise associations, Reviewer suggestion history"). The header docstring is now inaccurate, and the inline removed-methods block at lines 117+ is large enough to be noise. This phase tightens both without changing runtime behavior.

**Scope reminder:** comment cleanup ONLY. See "W6 coordination" in the Coordination notes — Postgres tables are *not* being dropped here. `useDataversePrefs()` and its dead Postgres branch are also out of scope (separate cleanup pass).

**Likely file:**

- `lib/services/database-service.js`

**Implementation steps:**

1. Grep-confirm no live callers depend on removed researcher methods (W5 already did this; reconfirm there's been no regression):
   ```bash
   grep -rn "DatabaseService\.\(findResearcher\|createOrUpdateResearcher\|getResearchersByKeywords\|addPublication\|getRecentPublications\|addKeywords\|recordSuggestion\|getSuggestionsForProposal\)" pages/ lib/ scripts/ shared/ tests/
   ```
   Expected: zero matches. If any turn up, **stop and report** — that's a regression that has to be fixed before any comment editing.
2. Rewrite the top-of-file feature comment so it accurately reflects what `DatabaseService` actually owns today (cache, user profiles, user preferences dispatcher, health check — confirm via reading the class). Drop the researcher/publication/keyword/suggestion claims.
3. Replace the large removed-researcher-operations block with a short note (≤ 5 lines) pointing to:
   - `lib/utils/name-normalization.js`
   - `lib/dataverse/adapters/potential-reviewer`
   - `lib/dataverse/adapters/researcher`
   - `lib/dataverse/adapters/reviewer-suggestion`
   - `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` for the why
4. Leave cache, preference, and health-check code untouched. Leave `useDataversePrefs()` untouched.

**Acceptance criteria:**

- Stale comments are shorter and accurate.
- Header docstring matches the class's actual surface.
- Zero runtime behavior changes (no method bodies edited).
- Zero live methods removed.

## Verification plan

After each phase, run the smallest useful verification:

1. **Phase-specific tests:** renderer tests (P1), parser tests (P2), component-level Jest if added (P3). No new tests for P4 (comment-only).
2. **Project CI gates** (run after each phase regardless of which files touched):
   - `npm run check:atlas`
   - `npm run check:atlas:self-test`
   - `npm run check:doc-currency`
   - `npm run check:doc-currency:self-test`
   - `npm run check:api-routes` (only required if `pages/api/**` was touched — it won't be in this workstream, but run it as a sanity check anyway)
3. **Dev-server smoke after P1, P2, P3:**
   - Phase II upload + process streaming completes.
   - QA streaming starts, renders markdown correctly, cancels cleanly on modal close.
   - Feedback refinement modal opens, submits, closes.
   - Word export modal opens, exports, closes.
4. **No smoke required after P4** (comment-only change).

A red CI gate or a regression in the smoke flow is a P0 blocker — fix or revert before continuing.

## Recommended implementation order

1. Phase 1 — shared markdown renderer
2. Phase 2 — shared SSE stream parser
3. Phase 3 — Phase II component extraction
4. Phase 4 — `DatabaseService` comment cleanup

This order front-loads small, testable utilities before touching larger UI structure, and leaves the no-behavior-change cleanup for last.

**Optional bundling:** Phase 1 and Phase 2 are both "create a shared utility + refactor one consumer." They could ship as one PR if Codex is confident the diff stays reviewable; default is separate PRs.

## Handoff report

When all four phases are complete (or when work stops for any reason), Codex must write a handoff report at:

```
docs/CODEX_HANDOFF_REPORT_<YYYY-MM-DD>.md
```

The report is how Claude reviews the work without re-reading every diff. Keep it terse and factual.

**Required sections:**

1. **What shipped.** One line per phase, with commit SHA(s) and short summary. If a phase didn't ship, say so explicitly with the reason.
2. **Deviations from the plan.** Anything that wasn't done exactly as specified above — folder names, file names, library choices, test scope, scope expansions or contractions. One bullet per deviation, with the reason.
3. **Tests added.** File paths + brief description of what each test covers. Note any tests considered but not written.
4. **CI gate results.** Output (or summarized output) of the gate commands from the Verification Plan after the final phase.
5. **Dev-server smoke results.** Pass/fail per flow listed in §3 of the Verification Plan.
6. **Follow-ups discovered.** Anything found mid-implementation that's out of scope for this workstream but worth filing — for example, other regex-markdown consumers found by the Phase 1 grep, additional SSE-format producers found during Phase 2, ESM/CJS oddities in extracted components.
7. **Known gaps.** Anything intentionally left undone (e.g. "Phase 3 stopped after `Phase2FeedbackModal`; the other two modals are queued for follow-up because the diff was getting too large").
8. **Re-review requests.** Specific things you want Claude to look at before sign-off (e.g. "I expanded the allowlist in `app-markdown.js` to include `table` tags because Phase II QA renders comparison tables — flag if I went too permissive").

If Codex has questions during implementation that can't be answered from this document, write them into the handoff report under a "Questions for Claude" heading rather than guessing. It's better to ship 2 phases with clear questions than 4 phases with quiet assumptions.
