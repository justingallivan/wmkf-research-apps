---
name: feedback_reconcile_dont_append_docs
description: When updating a long-lived design/state doc, reconcile the whole doc to one consistent state — never append-patch a new claim while leaving stale contradictory text elsewhere. Registered code-derived scalars are gated by `check:fact-consistency` (run before any fact-level "DONE" claim).
metadata:
  type: feedback
  status: active
  scope: docs
  last_verified: 2026-06-04 (S219) — reinforced with the read-WHOLE-file lesson + PreToolUse hook
---

## Recall Rule

Read this when: updating a long-lived design/state doc, Atlas page, SESSION_PROMPT, or memory entry with a new decision/finding/status.

Do:
- **Read the file IN FULL first** (not a grep-targeted slice — a partial `Read` satisfies the Edit precondition but misses residuals, which is how S219 left contradictions three times). Then edit the whole doc into one internally-consistent state in a single pass; re-grep for every restatement of the changed claim (banner, status lines, lead-ins, tails, summaries).
- Run `npm run check:fact-consistency` (and a cross-repo grep of the changed value) before emitting any "DONE"/"✅" on a fact-level edit.
- When a new drift-prone code-derived scalar appears, add a `CANONICAL_FACTS` entry plus self-test fixtures in the same commit.

Do not:
- Append-patch a new "S### update:" paragraph next to stale contradictory text.
- Trust your own (or an audit doc's) completion markers for cross-doc consistency without the fan-in.

Ground truth: `scripts/check-fact-consistency.js` (`CANONICAL_FACTS`); CLAUDE.md "Ground-truth requirement"; `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`. Related: [[feedback-share-codex-verbatim]], [[feedback-surface-full-review-findings]], [[feedback-red-gates-are-p0]].

When recording a new decision/finding into a long-lived design or state document (e.g. `docs/DATAVERSE_POWER_TOOLS_DESIGN.md`, Atlas pages, SESSION_PROMPT), **edit the document into a single internally-consistent state**. Do not bolt the new claim onto the top/middle and leave the old contradictory wording in the tail, status lines, or summary blocks. After any edit that changes a status/conclusion, re-grep the whole doc for every place that restates that status and bring them all into agreement (AUTHORITATIVE block, Status-of-unknowns, lead-ins, tails, memory pointer).

**Why:** This is a *recurring, named* failure. S157's Codex holistic review found the Power Tools record had gone stale/self-contradictory from incremental append-patching and had to be consolidated. S158 reproduced the exact same failure — even while the session was explicitly watching for it — declaring residuals "all CLOSED / build-plan-ready" at the top while line 393 still read "neither residual is solo-actionable." A self-contradictory doc on `main` is a ground-truth violation (CLAUDE.md), it silently propagates wrong beliefs across session handoffs, and it forces an expensive external review to catch what a self-grep would have.

**How to apply:** (1) Before editing, read the file **in full** — a grep-targeted slice is NOT enough; S219 grepped for restatements and still missed residuals because the wrong keywords were used, then had to be caught by external review. (2) Make the change everywhere in the same pass. (3) After the pass, grep the doc for the old claim's keywords + the residual/section IDs and verify zero divergent restatements remain. (4) Prefer rewriting a stale block over adding a new "S158 update:" paragraph next to it. (5) Treat "the top says X, the tail says not-X" as a P0 to fix immediately, same urgency as a red CI gate. Related: [[project-dataverse-power-tools]], [[feedback-surface-full-review-findings]].

**S166 — bounded mechanical backstop + provisional-completion discipline (this failure recurred ≥3× in ONE session, including after I had explained it; awareness is not the lever):**
- A gate now exists: **`npm run check:fact-consistency`** derives registered code-derived, drift-prone scalars from the live repo (registry: `CANONICAL_FACTS` in `scripts/check-fact-consistency.js` — currently app-definition count and requireAppAccess endpoint count) and fails on known stale-restatement patterns in live docs/`.claude-memory` plus selected root docs. It is a bounded backstop, not the full normalization fix. Point-in-time audit docs are excluded by design; historical mentions require same-line, fact-bound structured markers such as `<!-- fact-consistency:ignore fact=app-definition-count as-of=2026-05-19 -->`.
- **Provisional-completion rule: do NOT emit a "DONE"/"✅" marker for any fact-level doc/memory edit until the fan-in has run** — `check:fact-consistency` for registered scalars, an explicit cross-repo grep of the changed value + its index/header restatements otherwise, and Codex as backstop (not primary net). My completion claims for cross-document consistency work are a known-unreliable surface; they are provisional until verified, and the audit doc's own "DONE" markers are not trustworthy without this pass.
- When a NEW drift-prone code-derived scalar is found: add a `CANONICAL_FACTS` entry **and** self-test fixtures in the same commit (CLAUDE.md mandatory order). Prefer de-specifying non-operational counts; the deferred follow-up is normalization/pointering, not a broad NLP semantic checker.
Codified in `CLAUDE.md` (binding-self-test paragraph). Related: [[feedback-share-codex-verbatim]], [[feedback-surface-full-review-findings]], [[feedback-red-gates-are-p0]].

**S219 — "read the line, not the file" recurred ≥3× in one cleanup session, even with `check:fact-consistency` green.** Fixing the S219 table-drop + ORCID staleness, I repeatedly edited the specific line a grep/audit flagged (a banner, a status row) and left the SAME file's body, frontmatter `description`, or recall rule still asserting the old state. Codex's verification caught residuals across THREE rounds (publications page said "DROPPED" in the banner but "Table exists" / "Schema (live)" in the body; a migration memory corrected items 3/4/67/95 but missed the line-40 restatement). `check:fact-consistency` did not catch these because they were prose-state contradictions, not registered scalars. **The lever that finally worked was reading the WHOLE file before each edit (no offset/limit slice) + an exhaustive grep — and a new PreToolUse hook** (`.claude/hooks/doc-edit-reconcile-reminder.js`) that injects this reminder on every `Edit` of `docs/**`, `.claude-memory/**`, `CLAUDE.md`, `SESSION_PROMPT.md`. Awareness was NOT the lever (it recurred while I was explicitly watching for it); the mechanical hook + full-file reads are. Related: [[feedback-timebox-metawork]] (the same session also had no time-box, so the cleanup ate ~6h).
