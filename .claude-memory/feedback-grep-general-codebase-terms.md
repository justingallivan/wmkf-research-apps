---
name: When checking for existing infrastructure, grep general terms not domain jargon
description: "Does the codebase have X?" requires grepping general-purpose terms (untrusted, sentinel, scan, guard) NOT terms from the prompting source (article jargon, attacker-specific terminology).
type: feedback
status: active
scope: global
last_verified: 2026-07-27 as a historical S182 search failure and operating lesson
---

## Recall Rule

Read this when: a user asks "does our system handle X?" / "what defenses do we have against Z?" — any question that requires checking the codebase for existing infrastructure.

Do:
- Grep the general-purpose terms a prior infra/security engineer would have used (e.g. prompt-injection → `untrusted`, `sentinel`, `boundary`, `wrap`, `LLM01`, `guard`), NOT the jargon of the source that prompted the question.
- Also check `docs/security-audit/` and `docs/<subdomain>/` subdirectories (top-level `ls docs/` hides them), `package.json` `check:*` gates, and `git log --all`.
- Require multiple empty signals (grep + docs subdirs + gates + git log) before concluding infra doesn't exist.

Do not:
- Grep article/attacker-specific terminology ("white-on-white", "OCR", "canary") and treat one empty grep as proof of absence — that built a parallel weaker A7 system (S182, reverted).

Ground truth: historical-only (S182 burn). Same shape as CLAUDE.md "before claiming 'X has no Y', grep for Y" — in spirit, not just letter. See [[project-a7-prompt-injection-hardening]].

[VERIFIED historically via the S182 revert and owner feedback.] The specific
infrastructure examples below are incident evidence, not a current inventory;
derive current coverage from source, gates, docs, and history.

When a user asks a question that requires checking the codebase for existing infrastructure ("does our system handle X?", "should we add Y?", "what defenses do we have against Z?"), the search has to use **general-purpose terms** the prior implementer would plausibly have used — not the specific terminology of whatever prompted the question.

**Why:** S182, 2026-05-23 — Justin asked about prompt-injection defense and linked a Medium article describing 7 specific attack vectors (white-on-white text, OCR-extracted blocks, microtext, table reordering, etc.). I designed and shipped a parallel injection-defense system because my codebase search grepped for those article-specific terms ("white-on-white", "OCR", "canary", "hidden text", "visual diff"). The codebase had `wrapUntrustedContent`, `buildUntrustedContentPreamble`, `untrusted`, `sentinel`, `prompt-injection-tagging` — all general-purpose terms a security engineer would use. None of my searches hit because the prior implementer (S173-S177 A7 work) wasn't using the Medium article's vocabulary. Result: parallel weaker system built, committed, pushed, then reverted after the user spotted the artifact in production UI. Half a session wasted plus a real risk that the regression had landed silently (double-wrapping in two routes that already had A7).

**How to apply:**
- Step 1 of any "does the codebase have X" question: enumerate the *general-purpose* terms a security/infrastructure engineer would have used for X, regardless of how the current question is framed. Examples:
  - Prompt-injection defense → `untrusted`, `sentinel`, `boundary`, `prompt[-_ ]inject`, `wrap`, `LLM01`, `guard`
  - Rate limiting → `rate.?limit`, `throttle`, `bucket`, `quota`
  - Auth audit → `audit`, `audit.?log`, `who_did_what`, `actor`
  - Cache invalidation → `invalidate`, `bust`, `etag`, `version`, `staleness`
- Step 2: also grep the `docs/security-audit/` and any `docs/<subdomain>/` subdirectories. The top-level `ls docs/` does NOT show subdirectory contents — `ls -R docs/` or targeted `ls docs/security-audit/` is needed.
- Step 3: scan `package.json` scripts for `check:*` gates whose names hint at the domain. A gate that exists is dispositive evidence that the infrastructure exists.
- Step 4: `git log --all --oneline | grep -iE "<general-term>|<general-term-2>"` will surface the originating session(s) even if memory has no entry.
- Step 5: if four signals (grep, docs subdirectories, package.json gates, git log) all come up empty, THEN the infrastructure likely doesn't exist. One empty signal is not enough; my mistake was treating one empty grep as proof.

This is the same shape as the CLAUDE.md "Active doubt on state claims" rule: *"before claiming 'X has no Y', grep for Y."* The rule was followed in letter (I did grep) but not in spirit (I grepped for the wrong Y). The spirit is: search using terms the prior implementer would have used, not terms from your current source material.

Memory cross-reference: see [[project-a7-prompt-injection-hardening]] for the specific infrastructure this lesson came from. Future-me reads that memory entry first whenever the words "prompt injection" appear in a user message.
