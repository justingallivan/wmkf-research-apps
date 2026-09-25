---
name: feedback-reviewer-differs-from-author
description: "Cross-model review rule: the reviewer of a change must differ from its author. Codex-rescue-written code is checked by Claude review; Claude/Sonnet-written code goes to Codex adversarial review. Also: when the owner says 'bring findings to me first', report every review finding with a verified reading and options, and fix nothing until they decide."
status: active
metadata:
  type: feedback
---

## Recall Rule

Read before routing a fix to Codex rescue or a Claude build agent, and before
choosing who reviews the result.

**Rule 1: the reviewer differs from the author.** Session 538 (2026-09-24): a
three-line fix written by Codex rescue was then swept into a Codex adversarial
review of the whole slice. Owner: "Why is codex reviewing its own work that you
approved of?" A fresh Codex session is still the same model, so it shares the
author's blind spots. The independent check on Codex-written code is a Claude
review (read the diff, trace callers, mutation-check the test); Claude- or
Sonnet-written code goes to Codex adversarial review. A slice-wide Codex round
that happens to include a small Codex-authored fix may still run (owner chose
that option), but weigh its comments on Codex's own lines lightly and say so.

**Rule 2: discuss-before-fix when the owner asks.** In the same session, after
several Codex rounds each producing one narrower finding, the owner said: "If it
comes back with another bug, do not fix it. We'll talk about it first." From then
on every finding (Codex or my own review) was reported with: whether it holds
against source (file:line), the concrete failure, a proposed fix, and a
recommendation, then the owner chose ("fix with codex review", "use codex
rescue to fix, you review"). Keep honoring that until the owner lifts it; it
applies to review findings, not to mechanical gate fixes the owner already
approved.

**How to apply:** when delegating a fix, name the reviewer in the plan
(author Codex → reviewer Claude; author Claude/Sonnet → reviewer Codex). Related:
[[feedback-codex-delegation-review-vs-rescue-routing]],
[[feedback-codex-model-gpt56-sol]].
