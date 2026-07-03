---
title: Agent Instruction File Audit (S322)
domain: agent-harness
kind: audit
status: active
summary: Audit of CLAUDE.md, AGENTS.md, and .claude/rules/ for size, duplication, unread content, broken imports, and lint restatement. Findings + outcomes.
---

# Agent Instruction File Audit — Session 322 (2026-07-03)

Audit-only report; no instruction file was modified during the original audit. Subsequent owner decisions are recorded as outcome notes below. Every original claim below is grounded in a tool result from the S322 session, quoted with file:line. Evidence anchor: commit `16185334`. A future LLM applying any remaining recommendation must follow the **Application protocol** at the end.

## Inventory [VERIFIED via ls/wc/readlink this session]

| File | State |
|---|---|
| `CLAUDE.md` | 88 lines |
| `AGENTS.md` | symlink → `CLAUDE.md` (tracked invariant; `check:agent-invariants` green this session) |
| `.claude/CLAUDE.md` | absent |
| `CLAUDE.local.md` | absent |
| `.claude/rules/*.md` | 10 files, 110 lines total, largest 13 lines (`database.md`) |

Rules are loaded by Claude Code's native path-scoped mechanism (`paths:` frontmatter per file); no hook or settings entry references `rules/` [VERIFIED via grep of `.claude/settings*.json` and `.claude/hooks/*.js` — zero matches].

## Findings (ordered by severity)

### F1 — MEDIUM: Universal Safety Invariants restated near-verbatim in path-scoped rules (drift risk)

`CLAUDE.md` is loaded every session; the rules files load *in addition* whenever their paths match. The restatements therefore add no coverage — only a second copy that can drift. Three are clean duplicates; two are partial (they add path-specific detail and should be kept).

Clean duplicates [VERIFIED via grep -n this session]:

1. Identity-from-request invariant
   - `CLAUDE.md:23`: "Never accept user/profile identity from request input when authenticated context supplies it."
   - `.claude/rules/api-routes.md:11`: "…Never accept a profile ID from request input when authenticated context supplies it.…"
2. Migrations invariant
   - `CLAUDE.md:22`: "Existing databases use `node scripts/apply-migrations.js`; `scripts/setup-database.js` is fresh-install-only and refuses populated databases."
   - `.claude/rules/database.md:13`: "`scripts/setup-database.js` bootstraps an empty database only. Existing environments use `node scripts/apply-migrations.js`.…"
3. Intake Blob token invariant
   - `CLAUDE.md:27`: "Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared Blob token."
   - `.claude/rules/intake-uploads.md:11`: "Intake private Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared Blob token.…"

Partial duplicates — **keep, no diff proposed** (each adds unique, path-specific content):

4. `CLAUDE.md:25` (llm-client/execute-prompt) vs `.claude/rules/llm-and-prompts.md:12` — the rule adds the `EXECUTOR_CONTRACT.md` pointer, bundled-fallback note, and gate instruction.
5. `CLAUDE.md:26` (Dynamics restriction context) vs `.claude/rules/dataverse-dynamics.md:11` — the rule adds caller-identity and multi-source-evidence guidance.

**Caveat for the applier:** the restatement at point-of-edit may be deliberate defense-in-depth (CLAUDE.md content can be summarized away in long sessions). This is a **needs-owner-confirmation** consolidation, not a mechanical cleanup. If approved, apply:

**Outcome 2026-07-03:** owner approved F1 only; the three rule edits below were applied in commit `95c0e024`.

```diff
--- a/.claude/rules/api-routes.md
+++ b/.claude/rules/api-routes.md
@@ -9,3 +9,3 @@
 # API Routes And Authentication
 
-Use `requireAppAccess(req, res, ...appKeys)` for app routes, authenticated-context identity for user-scoped operations, and the documented infrastructure/cron/external-token guard for exceptions. Never accept a profile ID from request input when authenticated context supplies it. Register every new route in `docs/API_ROUTE_SECURITY_MATRIX.md`; run `npm run check:api-routes`. Preserve SSE framing for streaming routes.
+Use `requireAppAccess(req, res, ...appKeys)` for app routes, authenticated-context identity for user-scoped operations, and the documented infrastructure/cron/external-token guard for exceptions (identity invariant: CLAUDE.md Universal Safety Invariants). Register every new route in `docs/API_ROUTE_SECURITY_MATRIX.md`; run `npm run check:api-routes`. Preserve SSE framing for streaming routes.
```

```diff
--- a/.claude/rules/database.md
+++ b/.claude/rules/database.md
@@ -11,3 +11,3 @@
 # Database And Migrations
 
-`scripts/setup-database.js` bootstraps an empty database only. Existing environments use `node scripts/apply-migrations.js`. New durable schema needs a numbered migration, regenerated manifest, matching fresh-install shape where applicable, Atlas coverage, tests, and sequential relevant gates. Probe live state before destructive work and label unverified claims.
+New durable schema needs a numbered migration, regenerated manifest, matching fresh-install shape where applicable, Atlas coverage, tests, and sequential relevant gates (migration-vs-fresh-install invariant: CLAUDE.md Universal Safety Invariants). Probe live state before destructive work and label unverified claims.
```

```diff
--- a/.claude/rules/intake-uploads.md
+++ b/.claude/rules/intake-uploads.md
@@ -9,3 +9,3 @@
 # Intake And Upload Safety
 
-Intake private Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared Blob token. Preserve the three-call attachment contract, server-managed pending attachments, fail-closed virus scanning when enabled, and maintenance cleanup. Consult `docs/INTAKE_PORTAL_DRAIN_PLAN.md` and the relevant attach design before changing these paths.
+Preserve the three-call attachment contract, server-managed pending attachments, fail-closed virus scanning when enabled, and maintenance cleanup (Blob token invariant: CLAUDE.md Universal Safety Invariants). Consult `docs/INTAKE_PORTAL_DRAIN_PLAN.md` and the relevant attach design before changing these paths.
```

### F2 — LOW: `llm-and-prompts.md` path glob over-triggers on every API route

`.claude/rules/llm-and-prompts.md:7` includes `- "pages/api/**"`, so the LLM-surface rule loads for **all 138** API route files, though only **18** import `execute-prompt` or `llm-client` [VERIFIED via `grep -rln "execute-prompt\|llm-client" pages/api` → 18 files; `find pages/api -name '*.js'` → 138]. It also fully overlaps `.claude/rules/api-routes.md:3` (same glob), so every API-file read loads both rules.

**Outcome 2026-07-03:** owner rejected the removal path after review. This finding is **deprecated / do not apply**: keep the broad `pages/api/**` glob unless a future instruction-loader mechanism can match import dependencies or another guard proves the LLM/prompt rule still loads for all API routes that call `execute-prompt` or `llm-client`. The rejected option was to remove the `pages/api/**` path and rely on service/prompt-file matches; that is unsafe for route-local edits because path rules match the file being read, not its imports. Explicitly enumerating the current import-matching route set remains brittle as routes are added.

### Checks with no findings (verified clean)

- **(1) Size:** No instruction file approaches the ~200-line guidance. `CLAUDE.md` = 88 lines; the 10 rules files total 110 lines, max 13 [VERIFIED via wc -l this session].
- **(2) Contradictions:** None found between `CLAUDE.md` and any rules file — all overlaps are restatements (F1), semantically consistent (e.g. both intake statements name `INTAKE_BLOB_RW_TOKEN`; both migration statements agree on fresh-install-only). [VERIFIED via full read of all 10 rules files + CLAUDE.md this session]
- **(3) AGENTS.md unread content:** Not applicable by construction — `AGENTS.md` is a tracked symlink to `CLAUDE.md` (`readlink` → `CLAUDE.md` [VERIFIED this session]; invariant enforced by `check:agent-invariants`/`check:agent-invariants:ci`, both green this session). **Do not "fix" this by materializing AGENTS.md as a real file** — CLAUDE.md's header and `docs/CLAUDE_INSTRUCTION_AUTHORITY.md` require the symlink.
- **(4) @path imports:** Zero `@`-imports exist in `CLAUDE.md` or any rules file [VERIFIED via grep — no matches], so no >4-hop chains and no dangling import targets. Additionally, 27 plain-path references enumerated from the instruction files (docs, scripts, lib files) all exist on disk [VERIFIED via existence loop this session — zero MISSING; enumeration was manual, so treat as a strong sample rather than proof of zero dangling refs — `check:doc-symbol-refs` (green this session) covers the rest of the docs/memory surface].
- **(5) Lint/type-checker restatement:** `eslint.config.mjs` enforces React/react-hooks correctness rules and demoted stylistic rules to warnings [VERIFIED via read of eslint.config.mjs:8-30]; no instruction file restates any of them — the rules files are behavioral/architectural only. The repo is plain JS (no tsconfig-driven type checking to restate).

## Application protocol (for the LLM applying fixes)

1. F1 is already applied (commit `95c0e024`). F2 is **closed rejected / do not apply**; do not remove `pages/api/**` from `.claude/rules/llm-and-prompts.md` unless the owner reopens it with new evidence that route-local LLM guidance still loads.
2. Re-verify each quoted line against the live file first (`grep -n`) — this report is a snapshot at commit `16185334`.
3. After any edit to `CLAUDE.md` or `.claude/rules/`: run `npm run check:agent-invariants`, `npm run check:instruction-architecture`, and `npm run check:harness-framing && npm run check:harness-framing:self-test` sequentially (CLAUDE.md "Development" + gate list in `.claude/skills/start`).
4. Never sever the `AGENTS.md` → `CLAUDE.md` symlink or run `migrate-to-codex` (CLAUDE.md header).
