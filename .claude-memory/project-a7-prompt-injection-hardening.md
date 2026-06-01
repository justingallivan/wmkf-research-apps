---
name: A7 prompt-injection hardening (SHIPPED S173-S177)
description: All 24 LLM-input surfaces in this repo are hardened against prompt injection via wrapUntrustedContent + buildUntrustedContentPreamble + CI gate. Do NOT build a parallel system.
type: project
---

The codebase has a comprehensive, CI-gated prompt-injection-defense system. It was shipped across Sessions 173-177 (May 2026) as the "A7" initiative — 7 parts, ~30 commits, three Codex review rounds. Before designing or building any prompt-injection / LLM-content / "untrusted document" defense, read the existing plan and check the gate.

**Canonical entry points:**
- `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` — the plan, inventory of all 24 surfaces, part ordering, status. THIS IS THE CANONICAL DOC.
- `lib/utils/ai-payload-boundary.js` — primitives: `wrapUntrustedContent` (nonce-on-both-sides sentinels, sentinel-shape stripping, forge-resistant), `buildUntrustedContentPreamble` (system-prompt clause), `buildBoundedTextPayload` (length cap + metadata).
- `lib/utils/ai-output-schema.js` — `validateAiJson` schema validator for every `JSON.parse` sink (the *output* side of the defense).
- `scripts/check-prompt-injection-tagging.js` — `npm run check:prompt-injection-tagging`. Positive-coverage registry: every prompt file MUST be registered as `migrated` or `multimodal` or the gate fails. Self-test at `:self-test`.
- Tests: `tests/unit/*-a7.test.js` (6 files — email-reviewer, expertise-finder, multi-perspective, part6-prompts, reviewer-finder, virtual-review-panel) + `tests/unit/utils/ai-payload-boundary.test.js` (which also holds the forge-resistance tests; there is no separate `forged-close.test.js`). [verified S209]

**Coverage (verified 2026-05-23, S182):** Gate reports `24 migrated surface(s) carry their markers, 0 pending`. Every LLM input surface in the inventory is hardened — Phase I/II writeups + batches, multi-perspective, virtual review panel, qa/refine, peer reviews, expense reporter (multimodal), literature analyzer (multimodal), funding gap, grant reporting, expertise/reviewer finder, integrity screener, contact enrichment, dynamics explorer (agentic + AI export), Executor (via `untrusted: true` variable declaration on Dataverse-stored prompts), cron/log-analysis. Includes a multimodal preamble for Anthropic vision content blocks (image/document inputs) where there's no string to wrap.

**Why:** S182 spent half a day designing a parallel, weaker injection-defense plan (XML wrappers, canary regex, telemetry) because I did not find A7. The memory had zero entries pointing to A7; `docs/security-audit/` was a subdirectory my `ls docs/` didn't show; my grep used article-jargon terms (white-on-white, OCR, canary) rather than codebase-general terms (untrusted, sentinel). Two Codex rounds reviewed the parallel plan in isolation. The build shipped a double-wrap regression in two routes before live-test inspection caught it. The commit (04706f3) was reverted (abe861e); see [[feedback-grep-general-codebase-terms]] for the root-cause lesson.

**How to apply:**
- Before designing ANY prompt-injection / data-instruction-separation / untrusted-content defense, read `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` end-to-end.
- New LLM input surfaces must be registered in the `check:prompt-injection-tagging` gate and use `wrapUntrustedContent` (text) or the multimodal preamble (image/document blocks). The gate enforces this — adding an unregistered surface will fail CI.
- For Dataverse-stored prompts (Executor), declare untrusted variables via `untrusted: true` in the variable schema; the Executor wraps them automatically.
- "Add prompt injection defense" is not a valid task description in this repo — that work is done. Valid follow-ups are surface-specific (e.g., "add a NEW LLM input surface and register it in A7", or "extend A7 to cover [X new attack class not in the original scope]").
- If a future feature changes the threat model (e.g., open-submission program expansion, AI gaining decision authority, multimodal pipeline adoption beyond what A7 already covers), reopen the A7 plan in place — don't write a parallel plan.
- The plan recorded multimodal as in-scope and shipped a multimodal preamble. Do not propose multimodal as a "future Phase 2" — it's already there.
