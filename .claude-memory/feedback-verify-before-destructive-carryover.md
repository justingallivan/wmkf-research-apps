---
name: Verify before acting on destructive carryover items
description: Any task that drops/removes/retires/archives infrastructure carried over from a prior session must be verified against live state before action. Carryover lists go stale and have already nearly broken a live app once.
type: feedback
status: active
scope: global
last_verified: 2026-05-12 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: a carryover item (SESSION_PROMPT next-steps, TODO, user prompt citing an earlier decision) says drop / remove / retire / archive / delete / deprecate infrastructure (table, column, endpoint, env var, file, dispatch wrapper, dependency, feature flag).

Do:
- Grep for live callers and read the most likely ones before touching anything.
- Stop and report back to the user if anything looks live.
- After confirming dead, proceed and update the originating memory entry to reflect the live check.

Do not:
- Treat a destructive carryover as an approved task — it is unverified-until-checked.
- Apply this to additive work (new features/endpoints/tables) — destructive only.

Ground truth: historical-only (lesson, not live state); CLAUDE.md "Carryover Hygiene". Related: [[feedback-list-and-confirm-before-bulk-deletes]].

**Rule:** Before acting on any carryover task that says **drop**, **remove**, **retire**, **archive**, **delete**, or **deprecate** infrastructure (table, column, endpoint, env var, file, dispatch wrapper, dependency, feature flag, etc.), perform a live-state verification first:

1. Grep for live callers of the thing being removed.
2. Read the most likely callers to confirm they're not actually load-bearing.
3. If anything looks live, **stop and report back to the user** before touching anything. Do not proceed because the carryover said to.
4. If the verification confirms the thing is truly dead, proceed and update the relevant memory entry to reflect the live check.

**Why:** On 2026-05-03 the audit found that "drop dormant Postgres reviewer tables" was sitting in the Session 126 pivot list as a green-lit option. The tables were not dormant at that time — they had 20+ live UPDATE sites in `database-service.js` and `pages/api/reviewer-finder/researchers.js`, plus active reads in `extract-summary.js`, `generate-emails.js`, `grant-cycles.js`, and `my-proposals.js`. Acting on the carryover would have broken the live Reviewer Finder app's browse/email/grant-cycle flows. *(Historical: those tables have since been migrated to Dataverse in W3-W6 (2026-05-12) and are now drain-only; the carryover-verification discipline this feedback enforces remains the same.)* <!-- drain-table:ignore reason=historical-feedback --> <!-- doc-symbol-refs:ignore reason=historical-feedback -->

The failure pattern is propagation: a belief gets written into memory, the belief inherits into SESSION_PROMPT.md "next steps", several sessions inherit it forward without re-verification, and eventually a session executes the task because the carryover said to. The audit broke this chain. Without it, the chain completes.

**How to apply:**
- This rule is not about audits being mandatory; it's about treating any specific destructive carryover item as **unverified-until-checked**, not as an approved task.
- The pre-flight is cheap (~1 min of grepping per item). The cost of skipping it can be a broken production app.
- Applies to items in SESSION_PROMPT.md "next steps", in TODO lists, in user prompts that reference earlier-session decisions, and in anything labeled "scheduled for", "ready to", or "safe to" remove/drop.
- Does NOT apply to additive work (new features, new endpoints, new tables) — only to destructive work.
- After verification, update the originating memory entry so the wrong belief doesn't propagate to a future session.
