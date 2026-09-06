# Archived code

Files in this directory are **deprecated and not built**. The directory sits outside `pages/`, so Next.js does not route anything here, and outside the active import graph, so the bundler does not include it.

Directory layout mirrors the source location:
- `_archived/pages/foo.js` was at `pages/foo.js`
- `_archived/shared/config/prompts/bar.js` was at `shared/config/prompts/bar.js`

This preserves provenance — a future maintainer reading `_archived/pages/concept-evaluator.js` knows it lived at `pages/concept-evaluator.js` historically. Move or delete files freely; the repo has them in git history regardless.

## What's archived and why

| Path | Archived | Reason |
|---|---|---|
| `pages/concept-evaluator.js` | 2026-04-25 (Session 110) | App being deprecated. Concept-stage screening workflow superseded; intake AI work moves to backend automation post-cycle. |
| `pages/api/evaluate-concepts.js` | 2026-04-25 (Session 110) | API counterpart of `concept-evaluator.js` |
| `shared/config/prompts/concept-evaluator.js` | 2026-04-25 (Session 110) | Prompt for the deprecated app. Note: `shared/config/prompts/multi-perspective-evaluator.js` reuses some content from this prompt — that one is **not** archived. |
| `pages/phase-ii-writeup-legacy.js` | 2026-06-26 (Session 291) | Direct-URL legacy variant of the active `phase-ii-writeup` app; not in nav, confirmed not in active use. Successor: `/phase-ii-writeup`. |
| `pages/api/process-legacy.js` | 2026-06-26 (Session 291) | API counterpart of `phase-ii-writeup-legacy.js` (the legacy page was its only caller). |
| `shared/config/prompts/proposal-summarizer-legacy.js` | 2026-06-26 (Session 291) | Prompt for the legacy route; `process-legacy.js` was its only importer. The live `/api/process` uses `proposal-summarizer.js` (**not** archived). |
| `scripts/backfill-j26-stuck-invites-no-response.js` | 2026-09-06 (Session 490, owner decision D5) | One-off J26 backfill, executed 2026-05-20 (`817eb47a` "backfill 27 J26 stuck invites to no_response"). Wrote `wmkf_appreviewersuggestions` via raw `fetch` PATCH outside the adapter and the target interlock. |
| `scripts/fix-walsh-repoint-1003020.mjs` | 2026-09-06 (Session 490, owner decision D5) | S317 data fix for request 1003020, executed 2026-07-02 (`0a324d64` made the post-repoint deactivation runnable standalone, i.e. the repoint had run). Raw `fetch` PATCH outside the interlock. Superseded for recurring cases by `lib/services/reviewer-email-reconciler.js`. |
| `scripts/fix-roster-email-recovery.mjs` | 2026-09-06 (Session 490, owner decision D5) | S317 multi-request roster-email recovery, executed 2026-07-02 (`ade31b0d`); its case file was moved out of the repo in the 2026-07-27 privacy redaction (`1436aefc`). Raw `fetch` PATCH outside the interlock. Superseded by `lib/services/reviewer-email-reconciler.js`. |
