---
title: Prompt Caching Audit and Standardized Remediation
domain: llm-platform
kind: plan
status: active
summary: "July 2026 cache audit: R1/R3 and identical-rerun Executor mitigation shipped; cross-document composition and conditional R5 remain."
---

# Prompt Caching Audit and Standardized Remediation

> Produced 2026-07-06 (Session 340) by a 36-site fan-out audit (one Opus auditor per
> Anthropic-reachable call site, census cross-checked against `lib/services/llm-client.js`
> consumers and direct-SDK grep). Trigger: Anthropic flagged this project's cache-hit rate
> as low. Every claim below carries the auditor's `file:line` citation; re-verify against
> live source before implementing (files may have moved).

## 0. Implementation status (updated 2026-07-07 — merged to `main`)

The root shared-helper fix and the two clean high-value consumers shipped in
`35b089f4`, merged as `4fa53c7e`. The A7 review completed before that merge.
The Executor's full cross-document restructure and the conditional R5 items
remain owner decisions.

- **R1 — DONE (shared helper; A7 review completed before merge).**
  `wrapUntrustedContent` (`lib/utils/ai-payload-boundary.js`) now accepts an optional
  stable `nonce`; default behavior is unchanged (fresh `randomBytes` per call). New
  export `deriveStableNonce(...parts)` computes an HMAC keyed by `UNTRUSTED_NONCE_SECRET`
  (falling back to the already-present `NEXTAUTH_SECRET`) over the identity parts, so the
  nonce is deterministic-yet-unpredictable to the untrusted-content author. If NO server
  secret is set it returns `null` and the caller falls back to the random nonce — never a
  predictable unkeyed hash (fail-safe). A malformed caller nonce is likewise ignored.
- **R2 — ALREADY SATISFIED (audit was stale on this point).** `LLMClient._buildBody`
  already passes `opts.system` through verbatim, including a structured block array with
  `cache_control`; the two marked sites already rely on that. No LLMClient change was
  needed.
- **R3 — DONE.** `pages/api/qa.js` now derives per-proposal / per-summary stable nonces
  (`deriveStableNonce`), so repeated turns against unchanged content have a byte-identical
  cached system prefix. Realized reads remain a telemetry question, not an assumed result.
- **R4 — PARTIAL (owner decision on the rest).** The Executor
  (`lib/services/execute-prompt.js` `applyVariableBoundaries`) now derives a stable nonce
  keyed on `(promptName, variableName, value)`, so an *identical* rerun (same prompt
  version + same document) reproduces a byte-identical marked system prompt and can hit —
  strictly no worse than before for unique documents. The full cross-document win still
  needs the Phase 2 prompt-seed template/variable split (`composeMessages` still
  interpolates per-request variables into the system template ahead of the marker); that
  schema work is NOT done here.
- **R5 — NOT DONE (verify-then-fix; left for owner).** `composeScorePrompt` and
  `process-phase-i-writeup` both require confirming the current model-specific prefix floor and
  real repeat-within-TTL usage first.
- **R6 — NOT NEEDED.** R1/R3 and the identical-rerun Executor mitigation shipped, so the
  pre-S341 net-negative-marker removal is no longer the appropriate interim action.

**A7 review completed before merge (R1):** a nonce stable across turns/reruns but keyed by a
server secret does not weaken the A7 injection boundary: the applicant cannot compute the HMAC
or forge a matching close sentinel. `deriveStableNonce` keys on content, so distinct documents
do not share a nonce. The remediation commit recorded full `npm test` (5133 passing) and
`check:prompt-injection-tagging` plus self-test green.

## 1. Executive summary

The July 6 audit found the low hit rate **structural, not incidental**. Its first finding
continues to describe the default wrapper behavior; findings 2 and 3 below are explicitly
the pre-S341 state corrected by the merged remediation.

1. **A fresh random nonce at byte 0 of most prompts.** `wrapUntrustedContent` /
   `buildUntrustedContentPreamble` mint `crypto.randomBytes(12)` per call
   (`lib/utils/ai-payload-boundary.js:166`) and the preamble leads the prompt at most
   sites. Cache hits require a byte-exact prefix from position 0, so **any** marker
   downstream of the nonce can never hit across requests.
2. **[Pre-S341] Two marked sites were net-negative.** `lib/services/execute-prompt.js:448` (the
   shared Executor — the highest-volume path) and `pages/api/qa.js:156` both place a
   correct-looking `cache_control` marker over a **non-deterministic prefix** (nonce +
   per-request document interpolated ahead of the marker). Result: a 1.25× cache **write**
   on nearly every call, ~zero 0.1× reads. This is the direct signature of what Anthropic
   flagged — heavy cache writes, no hits.
3. **[Pre-audit misconception] `LLMClient` cannot express caching.** This was corrected
   during remediation: `_buildBody` already passes `opts.system` through verbatim, including
   structured system blocks with `cache_control`; no LLMClient change was needed.

The correctly-cached sites prove the pattern works here: `pages/api/dynamics-explorer/chat.js:437`
(large stable system+tools prefix, up-to-15-round agentic loop — high realized value) and
`lib/services/expertise-finder/batch-match-service.js:288` (batch loop over a stable
roster prefix, **deliberately built without a nonce** to stay cacheable —
`expertise-finder.js:90`). The remediation standardizes what those two already do.

## 2. Census and value distribution

36 call sites found (census: `llm-client.js` consumers + direct `@anthropic-ai`/SDK grep;
includes routes, services, crons, health probes, and dev scripts). Value of caching per
site as audited:

| Value | Count | Sites |
|---|---|---|
| high (already realized) | 2 | `dynamics-explorer-chat`, `expertise-finder-batch-match` |
| medium (unrealized) | 2 | `qa-api`, `process-phase-i-writeup-1` |
| low (mostly "no change") | 11 | incl. `execute-prompt-executor`, `claude-reviewer-service-analyze` |
| none (no change) | 21 | single-shot, sub-minimum-prefix, non-Messages endpoints; incl. `reviewer-finder-generate-emails` (Haiku tier, ~200-token prompt, below the ~2048-token Haiku cache floor — `shared/config/prompts/email-reviewer.js:35-82`) |

Notable audit corrections to prior beliefs (`.claude-memory/project-cache-hit-rate-review.md`):

- The reviewer-finder analyze repair-retry loop is **not** the big leak. Caching it is
  EV-negative unless the parse-failure rate exceeds ~28% (the 1.25× write is paid on every
  analyze; the 0.1× read is recovered only on the retry fraction). The memory's framing
  ("repair retries re-send the full proposal at full price") is factually right but the
  remedy doesn't pay. Marked stale-in-part in memory.
- **[Historical July-audit observation, superseded for current guidance]** the audit treated
  `claude-opus-4-8` as requiring a 4096-token prefix. Current official guidance lists
  **1024 tokens** for Opus 4.8 and Sonnet 4.6; Opus 4.6/4.5 and Haiku 4.5 require **4096**.
  Verify the concrete configured model before judging a candidate. See Anthropic's
  [prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

## 3. Standardized remediation (ordered; each step stands alone)

**R1 — Stabilize the injection-boundary nonce (DONE; security-sensitive).**
The nonce must be unpredictable to the *author of the untrusted content*; it does **not**
need to be unique per API call. Change `wrapUntrustedContent` /
`buildUntrustedContentPreamble` (`lib/utils/ai-payload-boundary.js:166`) to accept a
caller-supplied stable nonce, derived per session/document (e.g. keyed HMAC of
document identity + server secret, or one `randomBytes` minted per conversation and
threaded through). Default behavior (fresh nonce) stays for callers that don't opt in —
this is additive, fail-safe. **This is the single change that unblocks caching at every
nonce-led site.** The explicit A7 review of the "attacker knows the nonce is stable across
turns" scenario completed before merge.

**R2 — LLMClient structured-system support (ALREADY SATISFIED).**
`_buildBody` already accepts a structured `system` block array and passes `cache_control`
through verbatim. This audit initially misclassified that capability as missing.

**R3 — `qa-api`: session-stable nonce (DONE; realized yield requires telemetry).**
Q&A is inherently multi-turn against one ~30k-token proposal+summary prefix
(`ai-payload-boundary.js:41,44`; `pages/api/qa.js:99-117`). With a per-conversation nonce,
the existing marker at `qa.js:156` has a byte-identical prefix on unchanged follow-up
questions; telemetry determines whether it produces realized reads. No restructure needed.

**R4 — Executor: split stable template from dynamic content (depends on R2; schema work).**
`execute-prompt.js` interpolates per-request variables *into* the system template ahead of
the marker (`execute-prompt.js:403,411,448`), so distinct documents never share a prefix.
Fix: two system blocks — `system[0]` = stable instruction template with the marker at its
end; `system[1]`/user = interpolated variables + nonce-bearing wrappers. Requires the
prompt-seed schema to separate template text from variable slots (the Phase 2
`placement=system` + context-blocks work already referenced at `execute-prompt.js:402`).
Highest-volume path; batch flows pushing many documents through the same prompt within
minutes then hit on the shared template.

**R5 — Conditional, verify-then-fix items.**
- `composeScorePrompt` batch loop (`claude-reviewer-service.js:708`;
  `reviewer-prompt-composer.js:144-149`): reorder stable template + proposal_summary ahead
  of a breakpoint, per-batch nonce+candidates behind it — **only if** the stable prefix
  clears the current configured model's floor (the reviewer-finder default is Opus 4.8,
  currently 1024 tokens), and without moving the nonce boundary ahead of stable
  text (prompt-injection defense stays intact).
- `process-phase-i-writeup-1` (`pages/api/process-phase-i-writeup.js:144`): hoist the
  ~1.8k-token static block into a marked system block — **only if** multi-file uploads are
  common (single-file gains nothing; check real usage first).

**R6 — Historical interim, no longer recommended: remove the two net-negative markers**
(`execute-prompt.js:448`, `qa.js:156`) to stop paying the 1.25× write premium for entries
that are never read. The shipped R1/R3 and identical-rerun mitigation supersede this interim.

**Explicit no-change list:** all 19 "none" sites (single-shot with unique payloads,
sub-minimum prefixes, cron cadence beyond TTL, non-Messages endpoints like the pricing
canary and admin cost report, health probe, dev scripts) and the already-correct
`dynamics-explorer-chat`, `expertise-finder-batch-match`, `expertise-finder-match`,
`compare-phase-i-v1-v2`. Do not add markers there — a marker over an unhittable prefix is
a pure cost.

**Convention to standardize (the rule new call sites follow):** stable content (template,
tools, rules, rosters) leads and is marked at its largest boundary; all dynamic content
(nonce preambles, documents, per-request variables) trails the marker; nonces are
per-conversation/per-document, never per-call, unless the site is genuinely single-shot;
no marker without a verified floor for the concrete model and a repeat-within-TTL call
pattern. Current official guidance: Opus 4.8 and Sonnet 4.6 are 1024; Opus 4.6/4.5 and
Haiku 4.5 are 4096. See [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

## 4. Verification for the remediation session

- Before/after: `scripts/audit-system-prompt-sizes.js` for prefix sizes; Anthropic console
  cache metrics (or `usage.cache_read_input_tokens` in responses) for realized hit rate.
- Gates: `check:prompt-injection-tagging` (+ self-test) after any `ai-payload-boundary`
  change; full `npm test`; `/contract-reconcile` for the R1 security review.
