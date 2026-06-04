---
name: project-rtk-grep-output-corruption
description: rtk's grep filter fabricated tool output mid-session; now disabled — suspect rtk if grep/cat output looks off
metadata:
  type: project
  status: active
  scope: dev-env
  last_verified: S201 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: grep/cat/recursive-search Bash output looks wrong (placeholder text, duplicated headers, impossible line numbers, repeated/stale content).

Do:
- Suspect the rtk grep filter; do NOT trust that output for verification.
- Cross-check with `git diff` (reliable), the Read tool, or a `node -e` computed marker.
- Rely on the Edit tool's exact-match guarantee to catch silently-failed edits.

Do not:
- Trust a corrupted shell to confirm an Edit applied, or push a commit whose claimed fix wasn't verified independently.

Ground truth: historical-only (lesson, not live state) — rtk grep disabled end of S201; if re-enabled and corruption returns, that's the cause. Related: [[feedback-grep-general-codebase-terms]], [[feedback-real-fix-not-design-note]].

S201 (2026-05-30): rtk's `grep` token-saving filter corrupted Bash output mid-session — fabricated "placeholder" lines, duplicated `diff --git` headers, backwards line numbers, and stale echoes bleeding across calls. It nearly let a **wrong commit stand**: a `review-manager.js` Edit silently failed (string-not-found) but the corrupted shell masked it, and I pushed `e38bf18` with a commit message claiming a fix that hadn't applied. Caught it via the Edit tool's exact-match guarantee + a `git diff` cross-check; corrected in `de6010c`.

**Why:** rtk rewrites bare `grep`/`cat`/compound commands through its hook; the grep summarizer was the corruption source (confirmed S201 — after Justin disabled rtk grep, two A/B tests showed Claude-via-rtk and raw-shell grep output byte-for-byte identical). `git`, `node`, and the Read/Edit tools stayed reliable throughout.

**How to apply:** If grep/cat/recursive-search output looks wrong (placeholder text, dup headers, impossible line numbers, repeated content), suspect the rtk grep filter — do NOT trust it for verification. Cross-check with `git diff` (reliable), the Read tool, or pipe to a `node -e` computed marker. Justin disabled rtk grep at end of S201; if it gets re-enabled and corruption returns, that's the cause. Related: [[feedback-grep-general-codebase-terms]], [[feedback-real-fix-not-design-note]].
