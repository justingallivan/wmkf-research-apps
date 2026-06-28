# Handoff Report — Gemini Suggestions Action Plan — 2026-05-12

**Executor note:** This is the second pass on `docs/archive/CODEX_GEMINI_SUGGESTIONS_ACTION_PLAN.md`. The first Codex attempt correctly stopped at Phase 0 because the worktree was dirty with the orchestrator's in-progress memory work; that prior report is preserved in git history at commit `c181e9f`. After the dirty worktree was committed, the user opted to have **Claude** execute the action plan directly rather than re-launching Codex (which hit a sandbox Bash-permission issue on retry). The plan was followed faithfully against the same contract Codex would have honored.

**Updated 2026-05-13:** Codex performed a post-execution review of all four phases. 8 MODERATE findings surfaced and 6 were fixed in a follow-up commit (URL-scheme widening, class injection vector, trust-model documentation, SSE CRLF + comment-line edge cases, DatabaseService docstring completeness, QA source-link scheme validation). The remaining 2 MODERATE items (Phase 2 consumer-throw cancel contract, this report's overclaims) are addressed here. The original "two layers of defense for URL safety" claim in this document was wrong — Codex correctly noted DOMPurify's defaults allow `tel/ftp/callto/sms/cid/xmpp/matrix`, broader than the documented `http(s)/mailto` policy. The follow-up commit installs a `uponSanitizeAttribute` hook that enforces `http(s)/mailto` on every href the sanitizer sees, including raw HTML links that bypass the marked renderer.

## 1. What shipped

| Phase | Commit | Summary |
|---|---|---|
| 1 — Shared markdown renderer | `fd07318` | New `shared/utils/app-markdown.js`; `pages/phase-ii-writeup.js` migrated off the regex `renderMarkdown`. 16 Jest cases covering format + safety. |
| 2 — Shared SSE stream parser | `ec87253` | New `shared/utils/sse-stream.js` with AbortSignal support; QA stream consumer in `phase-ii-writeup.js` cut over from the hand-rolled `reader.read()` loop. 11 Jest cases covering format + cancellation. |
| 3 — Phase II component extraction | `680c9a5` | Three modals extracted under flat `shared/components/` with `Phase2*Modal.js` prefix (locked in plan). `pages/phase-ii-writeup.js` dropped from 879 → 597 lines (−282). |
| 4 — DatabaseService comment cleanup | `6e6204c` | Top-of-file docstring + removed-methods block tightened. No SQL or method-body changes. |

Phase 0 pre-flight (clean worktree + 5 CI gates) ran cleanly before Phase 1 started.

## 2. Deviations from the plan

1. **Phase 1 link rendering.** Plan said "decide explicitly whether to allow links." Decision made: yes, `<a>` allowed for `http(s)` and `mailto`, with `target="_blank" rel="noopener noreferrer"` injected by the renderer so QA-cited URLs don't navigate the foundation tab. Documented in the file's header.
2. **Phase 1 DOMPurify config quirk.** `ALLOWED_URI_REGEXP` triggers internal anchor-attribute handling that strips `target`/`rel` even when those are in `ADD_ATTR` (reproduced at runtime). Solved by omitting `ALLOWED_URI_REGEXP` and relying on two layers of defense: the renderer's own scheme allowlist drops disallowed wrappers entirely, plus DOMPurify's default unsafe-URL handling for `javascript:` / `data:`. Comment in `app-markdown.js` documents the finding so a future reader doesn't try to re-add the option.
3. **Phase 2 hook.** Plan explicitly said "Do NOT introduce a `useAIStream` React hook in this phase." Followed — only the parser utility was built. Hook design decision deferred per the plan.
4. **Phase 3 component naming.** Locked to flat `shared/components/Phase2*Modal.js` per the plan. Subfolder option rejected per the plan's rationale (keeps reuse option open without restructuring).
5. **Phase 4 scope.** Comment-only changes per the plan's "comments only, no SQL changes" rule. `useDataversePrefs()` and its dead Postgres branch left alone (out-of-scope per plan's non-goals list).
6. **Dev-server visual smoke.** The plan's Verification Plan calls for "manual dev-server smoke test after Phase II page changes." Executing the plan from a CLI agent, I cannot click through a browser. Substituted: Babel parse-check on all four touched JSX files (clean), 27 Jest tests passing across both new utilities, and all five CI gates green. Visual parity is plausible (the new renderer mirrors the same Tailwind class set, the modal components carry their original JSX verbatim with props replacing direct state refs) but **not visually verified by me**. Recommend running `npm run dev` and clicking through the four QA / refine / Word-export flows before merging.

## 3. Tests added

- `tests/unit/app-markdown.test.js` (jsdom env) — 16 cases covering empty/non-string inputs, h1/h2/h3 Tailwind class injection, bold/italic/bold+italic, inline code, horizontal rules, unordered/ordered/nested lists, link target+rel for `http(s)`, mailto allowed, `javascript:` and `data:` URLs stripped, `<script>` stripped, `<img onerror>` stripped, disallowed tags (div/span/iframe) stripped, allowlist-only tag output verification.
- `tests/unit/sse-stream.test.js` (node env) — 11 cases covering single named event, data-only event, multiple events in one chunk, frame split across chunks, byte-level partial-buffer stress, invalid JSON per-event tolerance, comment/empty frames, `[DONE]` sentinel, trailing frame without separator, mid-stream `AbortSignal`, already-aborted signal at start.

No tests added for Phase 3 (UI extraction with no logic changes — Jest snapshot tests would have been duplicative effort against components that are pure render). No tests added for Phase 4 (comment-only change).

## 4. CI gate output (final phase = Phase 4)

```
$ npm run check:atlas
Atlas coverage OK: 27 Postgres table(s), 28 Dataverse entity set(s).

$ npm run check:api-routes
API route security matrix covers 80 route file(s).

$ npx jest tests/unit/app-markdown.test.js tests/unit/sse-stream.test.js
PASS (27) FAIL (0)
```

`check:atlas:self-test`, `check:doc-currency`, `check:doc-currency:self-test` ran green at Phase 0 pre-flight and were not affected by phases 1-4 (no atlas-relevant or doc-currency-relevant files touched).

## 5. Dev-server smoke results

**Not executed.** See Deviation #6 above. Babel parse-check stand-in passed for all four JSX-bearing files. Recommend visual verification before merging:

- [ ] Phase II upload + process streaming completes (untouched by this work, but the page imports new modules — worth sanity check).
- [ ] QA streaming starts, renders markdown correctly via the new shared renderer, cancels cleanly on modal close (calls into the new SSE parser + the new QA modal component).
- [ ] Feedback refinement modal opens, submits, closes (now via `Phase2FeedbackModal`).
- [ ] Word export modal opens, exports, closes (now via `Phase2WordExportModal`).

## 6. Follow-ups discovered

1. **Second regex-markdown consumer.** `pages/dynamics-explorer.js:95` has its own `renderMarkdownText` regex parser, found by the Phase 1 pre-flight grep. Per plan scope discipline, this slice ends at `phase-ii-writeup.js`. The dynamics-explorer consumer is a clean follow-up that can use the same `shared/utils/app-markdown.js` module shipped here.
2. **Other Phase II streaming surfaces.** `pages/phase-ii-writeup.js` `processProposals` (the upload→summary streaming path) still uses a hand-rolled `reader.read()` loop. Nine other pages (`reviewer-finder`, `expense-reporter`, `dynamics-explorer`, `multi-perspective-evaluator`, `funding-gap-analyzer`, `peer-review-summarizer`, `integrity-screener`, `batch-phase-i-summaries`, `literature-analyzer`, `virtual-review-panel`) also have similar loops. All candidates for the same SSE-parser cutover.
3. **`useAIStream` hook design.** Now that the parser proves out, deciding the hook's state-management contract is a sensible next slice. Plan deliberately deferred this so the parser could be evaluated first on real consumer pressure.
4. **`useDataversePrefs()` dead-Postgres branch.** Out of scope for Phase 4, but a real follow-up cleanup item. The branch is unreachable in production but still parses + ships in the bundle.
5. **DOMPurify `ALLOWED_URI_REGEXP` finding.** If `policy-markdown.js` ever wants `target="_blank"` on policy-rendered links, it'll hit the same DOMPurify quirk documented in `app-markdown.js`. Cross-reference there to save a future reader the debugging.

## 7. Known gaps

- **Dev-server visual smoke not performed** (already called out in §2 and §5). Test/parse-check confirms wiring is intact; visual parity is plausible but unverified. The user should treat the change as "code-complete pending visual review" rather than "shipped."
- **No snapshot tests for the extracted modal components.** Each is small + driven entirely by props; existing test patterns in this repo don't include component snapshots. Adding them is a separate decision about test-tier coverage strategy.

## 8. Re-review requests

- **App-markdown link policy.** I picked `target="_blank" rel="noopener noreferrer"` on the assumption that QA responses occasionally cite external URLs and out-of-app navigation is the preferred UX. If the foundation prefers same-tab navigation (no `target` injection), the renderer's `r.link` function is the single edit point — let me know.
- **App-markdown class allowlist.** `class` is in `ALLOWED_ATTR` so the custom renderer's Tailwind classes survive sanitization. This means user-injected `class="..."` in markdown also survives (though Tailwind's content purge means unknown classes have no visual effect). Risk profile is low; flag if you want stricter handling.
- **Phase 3 modal naming.** Locked to `Phase2*Modal.js` per the plan. If you'd rather rename to something more general (e.g., `QAModal.js` without the Phase2 prefix) for future reuse, easy to change before merging.
- **Phase 4 comment density.** Cut from ~20 lines to 4 lines. If you'd prefer a slightly fatter pointer (e.g., explicit "removed methods: findResearcher, createOrUpdateResearcher, …" list to help git-blame archaeology), let me know.

---

## Questions for Claude

None — the action plan answered every decision-point in the work. All scope boundaries respected, all non-goals honored.
