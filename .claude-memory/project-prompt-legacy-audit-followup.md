---
name: project-prompt-legacy-audit-followup
description: "Action item (S343 → next session): act on the Fable AI-prompt legacy audit (docs/PROMPT_LEGACY_AUDIT.md) — dormant admin prompts, phase-ii extraction re-scope, dead-prompt cleanup."
metadata: 
  node_type: memory
  status: active
  type: project
  originSessionId: 4eb6d1fe-c277-43b8-977b-92cc18644286
---

Owner asked (Justin, S343, 2026-07-07) to make acting on the Fable prompt-legacy
audit a **next-session action item**. The audit report is durable at
`docs/PROMPT_LEGACY_AUDIT.md` (committed `efc64175`; full per-prompt table +
`[VERIFIED]`/`[ASSUMED]` labels). Read it first before acting.

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
