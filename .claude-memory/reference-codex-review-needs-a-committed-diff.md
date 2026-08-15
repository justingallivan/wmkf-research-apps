---
name: reference-codex-review-needs-a-committed-diff
description: "/codex:review and /codex:adversarial-review target a git diff — to review conversational analysis, write it to a file first; outputs/ is gitignored and needs git add -f."
metadata:
  type: reference
  status: active
---

## Recall Rule

Read before asking Codex to review analysis, plans, or work that is not already
visible in a Git diff. `[VERIFIED via .gitignore:55 and current review-routing
guard tests, 2026-08-15]`

The Codex review commands review a **git diff** (working tree, branch, or
`--base <ref>`). They cannot see reasoning that exists only in the conversation.

To get analysis reviewed:

1. Write it to a file. `outputs/` is the convention for assessments, but it is
   **gitignored** (`.gitignore:55`) while its existing assessment documents are
   tracked — so a new one needs `git add -f <path>` or it stays invisible to git
   and the review sees nothing (a silent no-op: `git status` prints clean).
2. Commit it, then scope the review with `--base <commit-before>` so the diff is
   exactly the document. Work already pushed earlier in the session needs the
   same treatment — a default working-tree review of a clean tree reviews nothing.
3. Put the context *in the document* (verified figures with sources, `file:line`
   evidence, alternatives considered), not only in the prompt — the reviewer
   reads the diff.

Routing and output handling are separate rules:
[[feedback-codex-delegation-review-vs-rescue-routing]] (review vs rescue paths;
the review skills carry `disable-model-invocation`) and
[[feedback-share-codex-verbatim]] (paste stdout whole, next message, no framing).

**Verified S406 (2026-08-07):** two adversarial reviews run this way, both
returning findings that changed published numbers.
