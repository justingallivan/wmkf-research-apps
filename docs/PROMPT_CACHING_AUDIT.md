---
title: Prompt Caching Audit and Standardized Remediation
domain: llm-platform
kind: plan
status: active
summary: "Project-wide audit of Anthropic prompt-cache usage across all 36 LLM call sites: root causes of the low cache-hit rate and the ordered remediation plan."
---

# Prompt Caching Audit and Standardized Remediation

> Produced 2026-07-06 (Session 340) by a 36-site fan-out audit (one Opus auditor per
> Anthropic-reachable call site, census cross-checked against `lib/services/llm-client.js`
> consumers and direct-SDK grep). Trigger: Anthropic flagged this project's cache-hit rate
> as low. Every claim below carries the auditor's `file:line` citation; re-verify against
> live source before implementing (files may have moved).

## 0. Implementation status (2026-07-07, remediation session — branch, PENDING OWNER REVIEW)

Shipped the root shared-helper fix plus the two clean high-value consumers; the
Executor's full restructure and the conditional R5 items are left for owner decision.

- **R1 — DONE (shared helper; needs the security review below before merge).**
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
  (`deriveStableNonce`), so multi-turn Q&A against one proposal reuses a byte-identical
  cached system prefix and the existing `qa.js` marker starts producing real reads.
- **R4 — PARTIAL (owner decision on the rest).** The Executor
  (`lib/services/execute-prompt.js` `applyVariableBoundaries`) now derives a stable nonce
  keyed on `(promptName, variableName, value)`, so an *identical* rerun (same prompt
  version + same document) reproduces a byte-identical marked system prompt and can hit —
  strictly no worse than before for unique documents. The full cross-document win still
  needs the Phase 2 prompt-seed template/variable split (`composeMessages` still
  interpolates per-request variables into the system template ahead of the marker); that
  schema work is NOT done here.
- **R5 — NOT DONE (verify-then-fix; left for owner).** `composeScorePrompt` and
  `process-phase-i-writeup` both require confirming the ≥4096-token Opus prefix floor and
  real repeat-within-TTL usage first.
- **R6 — MOOT.** R1+R3 shipped and the Executor marker is now stable-nonce-backed
  (net-neutral-to-positive), so neither net-negative marker is removed.

**Security review still required before merge (R1):** confirm that a nonce which is stable
across turns/reruns but keyed by a server secret does not weaken the A7 injection boundary —
the applicant authors the proposal but cannot compute the HMAC without the secret, so they
cannot forge a matching close sentinel even knowing the nonce repeats. `deriveStableNonce`
keys on the content itself, so distinct documents never share a nonce. Verified: full
`npm test` (5133 passing), `check:prompt-injection-tagging` + self-test green.

## 1. Executive summary

The low hit rate is **structural, not incidental**, and has three root causes:

1. **A fresh random nonce at byte 0 of most prompts.** `wrapUntrustedContent` /
   `buildUntrustedContentPreamble` mint `crypto.randomBytes(12)` per call
   (`lib/utils/ai-payload-boundary.js:166`) and the preamble leads the prompt at most
   sites. Cache hits require a byte-exact prefix from position 0, so **any** marker
   downstream of the nonce can never hit across requests.
2. **Two marked sites are net-negative today.** `lib/services/execute-prompt.js:448` (the
   shared Executor — the highest-volume path) and `pages/api/qa.js:156` both place a
   correct-looking `cache_control` marker over a **non-deterministic prefix** (nonce +
   per-request document interpolated ahead of the marker). Result: a 1.25× cache **write**
   on nearly every call, ~zero 0.1× reads. This is the direct signature of what Anthropic
   flagged — heavy cache writes, no hits.
3. **`LLMClient` cannot express caching.** `_buildBody`
   (`lib/services/llm-client.js:210-238`) accepts only a plain content string — no
   `system` block array, no `cache_control` passthrough — so the many sites that route
   through it are uncacheable by construction even where a large stable prefix exists.

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
- `claude-opus-4-8` requires a **4096-token** minimum cacheable prefix (not 1024) — several
  "just add a marker" candidates silently fail this floor. Any Opus-path fix must verify
  prefix size first.

## 3. Standardized remediation (ordered; each step stands alone)

**R1 — Stabilize the injection-boundary nonce (root fix; security-sensitive).**
The nonce must be unpredictable to the *author of the untrusted content*; it does **not**
need to be unique per API call. Change `wrapUntrustedContent` /
`buildUntrustedContentPreamble` (`lib/utils/ai-payload-boundary.js:166`) to accept a
caller-supplied stable nonce, derived per session/document (e.g. keyed HMAC of
document identity + server secret, or one `randomBytes` minted per conversation and
threaded through). Default behavior (fresh nonce) stays for callers that don't opt in —
this is additive, fail-safe. **This is the single change that unblocks caching at every
nonce-led site.** Requires an explicit security review of the "attacker knows the nonce
is stable across turns" scenario before merge.

**R2 — Teach `LLMClient` to express caching.**
Extend `_buildBody` (`lib/services/llm-client.js:210-238`) to accept a structured
`system` block array and pass through `cache_control`. Pure additive plumbing; without it
R3–R5 cannot ship for LLMClient-routed sites.

**R3 — `qa-api`: session-stable nonce (depends on R1; biggest single win).**
Q&A is inherently multi-turn against one ~30k-token proposal+summary prefix
(`ai-payload-boundary.js:41,44`; `pages/api/qa.js:99-117`). With a per-conversation nonce,
the existing marker at `qa.js:156` starts producing real 0.1× reads on every follow-up
question. No restructure needed.

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
  clears the 4096-token Opus floor, and without moving the nonce boundary ahead of stable
  text (prompt-injection defense stays intact).
- `process-phase-i-writeup-1` (`pages/api/process-phase-i-writeup.js:144`): hoist the
  ~1.8k-token static block into a marked system block — **only if** multi-file uploads are
  common (single-file gains nothing; check real usage first).

**R6 — Interim, if R1/R4 are deferred: remove the two net-negative markers**
(`execute-prompt.js:448`, `qa.js:156`) to stop paying the 1.25× write premium for entries
that are never read. Delete this step if R1+R3/R4 ship instead.

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
no marker without a verified ≥1024-token (Sonnet) / ≥4096-token (Opus) stable prefix and a
repeat-within-TTL call pattern.

## 4. Verification for the remediation session

- Before/after: `scripts/audit-system-prompt-sizes.js` for prefix sizes; Anthropic console
  cache metrics (or `usage.cache_read_input_tokens` in responses) for realized hit rate.
- Gates: `check:prompt-injection-tagging` (+ self-test) after any `ai-payload-boundary`
  change; full `npm test`; `/contract-reconcile` for the R1 security review.
