---
name: project-prompt-legacy-audit-followup
description: "RESOLVED S344: acted on the Fable AI-prompt legacy audit — sunset the 4 PDF-upload apps (extraction retired), wired peer-review to the Executor, removed dead generators. Residual: write-path [ASSUMED] audit."
metadata: 
  node_type: memory
  status: closed
  type: project
  originSessionId: 4eb6d1fe-c277-43b8-977b-92cc18644286
---

**RESOLVED S344 (2026-07-08).** All four prioritized follow-ups were acted on:
- **(1) Dormant admin prompts** — dispositioned. `peer-review-summarizer.*` was
  **wired to the Executor** (`process-peer-reviews.js` now runs the rows via
  `executePrompt`; staff /admin edits take effect; commit `1559e8dc`, hardened
  `4dd5c84b`). `phase-ii.*` rows stay dormant because their apps were sunset (below).
- **(2) `phase-ii.extract-structured` re-scope** — owner chose to **sunset the 4
  PDF-upload apps** (`phase-ii-writeup`, `batch-proposal-summaries`,
  `batch-phase-i-summaries`, `phase-i-writeup`) rather than re-scope in place; code
  retained (not archived) as the reference for a future Dataverse-native migration
  (commit `f9d9a593`). See [[project-nomenclature-and-app-sunset-sweep]].
- **(3) `phase-i-writeup`** — covered by the sunset (it was one of the 4).
- **(4) Dead generators** — `createThemeSynthesisPrompt` + `createActionItemsPrompt`
  removed (`18b7578b`).

**Residual (only open thread):** the full extraction-consumer write-path audit the
report flagged `[ASSUMED]` — confirming no *other* LLM free-text reaches a
length-capped controlled `akoya_request` field. Low priority; the crash class is
contained. See `docs/PROMPT_LEGACY_AUDIT.md` + [[project-peer-review-executor-migration]].

---
Historical (S343 origin): Owner asked (Justin, S343, 2026-07-07) to make acting on
the Fable prompt-legacy audit a next-session action item. Audit at
`docs/PROMPT_LEGACY_AUDIT.md` (committed `efc64175`).

**Prioritized follow-ups (from the report):**
1. **Dormant-but-editable admin prompts (highest-signal, do first).** The live
   `phase-ii.*` and `peer-review-summarizer.*` `wmkf_ai_prompt` rows are editable
   in `/admin` but are **dormant Phase-0 storage** — the live routes (`process.js`,
   `qa.js`, `refine.js`, `process-peer-reviews.js`) still run the CODE generators
   (`proposal-summarizer.js`, `peer-reviewer.js`), so editing those admin rows
   changes nothing. Decide: wire the routes to `executePrompt()` OR hide/label the
   rows in the panel so staff aren't editing theater. (Same "admin panel ≠ source
   of truth" trap as [[project-reviewer-closeout-payability]]'s sibling reviewer-finder
   confusion — see `docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md`.)
2. **`phase-ii.extract-structured` re-scope (biggest real redundancy).** Re-derives
   ~8 `akoya_request`-authoritative fields, guesses institution from the filename,
   and `pages/api/process.js` already runs a corrective PI-name pass (proof it's
   unreliable). Fix shape = mirror the reviewer-finder refactor: give Phase II a
   `requestId` entry path, source metadata from `akoya_request`, then slim. **Gated
   on the entry-path work** — no ground truth without a requestId, so it's a feature,
   not a quick trim.
3. **`phase-i-writeup.js`** — confirm it's still a live surface; if so, its
   anti-abbreviation institution-validation block is a lookup masquerading as
   inference → bind requestId or route to the Executor `phase-i.summary`.
4. **Easy cleanups:** retire dead generators `peer-reviewer.js::createThemeSynthesisPrompt`
   + `createActionItemsPrompt` (never imported); de-dupe the two Phase-I 4-bullet
   contracts (`phase-i.summary` Executor row vs `phase-i-summaries.js`).

**Why:** the audit confirmed the owner's thesis but narrowed it — redundancy only
bites DV-native (requestId-bound) runs; most Dataverse-native prompts are already
slimmed/correct. The crash class (`wmkf_programarea` overflow) is contained. So the
work is reliability/token-cost/UX-honesty, not an urgent bug hunt.

**Confirming follow-up the report flagged:** a full extraction-consumer write-path
audit ([ASSUMED] for paths not exhaustively traced) to be sure no other LLM
free-text reaches a length-capped controlled `akoya_request` field.
