---
name: feedback-behavior-claims-cite-the-producer
description: Any claim about how THIS system behaves — even in conversation, not just docs — gets tagged [verified <file:line>] or [unverified]; trace the value to its PRODUCER (where it is written/returned/decided), not a consumer that reads it; a plan/design doc is NOT evidence the behavior exists. Self-policed (no hook sees chat).
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S275 via owner-flagged failures + claude-code-guide check on hook scope
---

## Recall Rule

Read this when: about to state how this system behaves — what screen a user sees, what a function returns, whether a feature is live, a field's value/semantics, a gate/branch, token/link/email behavior, "the flow is X" — in a USER-FACING MESSAGE or a doc. Not only durable artifacts: **conversation counts.**

Do:
- Tag every material behavior claim inline: `[verified <path:line>]` (I read THAT line this session) or `[unverified — assumption]`. An untagged behavior claim is, by contract, a guess — treat it (and let the owner treat it) as one.
- Trace the value to its **PRODUCER** — the function that returns it, the line that writes the field, the predicate that decides it — not a **consumer** that reads it. Reading the caller is not reading the behavior.
- Treat a plan / design doc / memory / SESSION_PROMPT as **intent, not state.** Verify the live code path before saying the behavior exists. (Operating Rule #1: never present plan intent as built state — applies in chat too.)
- When you don't have the producer line handy: say "let me check" and read it, or state it `[unverified]`. Both beat a confident guess.

Do not:
- Extrapolate from a verified intermediate to an unverified terminal fact (read the consumer, assert the producer's value).
- Quote a build-plan / memory as proof a feature is wired.
- Make a confident behavioral assertion in design discussion just because it "tracks." Confidence is not evidence.

## Why the existing guardrails didn't catch it (verified S275)

- [[feedback-cite-ground-truth]] covers **external** facts (pricing, API, platform). [[feedback-falsify-not-confirm]] covers **scope/quantity** claims and is hook-enforced on `Write|Edit`. Neither covers **internal behavior** claims, and neither fires in **chat**.
- **No hook can fire on chat prose.** Hooks key on tool events (`Bash`, `Edit`, `Write|Edit`, `Task|Agent`, `Stop/SubagentStop`) — confirmed this session via the claude-code-guide agent: hooks gate tool *actions* and can read exit codes/JSON, but cannot read a sentence I type and demand a citation. So this contract is **self-policed**, made enforceable only by visibility: the owner can flag any untagged behavior claim. A "citation-audit" subagent+SubagentStop hook was considered and rejected — it governs subagent output (not the main-loop chat where the failures happen) and can only check citation *presence*, not *correctness*.

## The failures (S275, owner-flagged; eroded trust by repeated reversals)

1. Claimed the reviewer portal shows the "agree-in-principle / hold" view this cycle. WRONG: the old hold/readiness path was later removed (`lib/external/proposal-readiness.js` and `shared/components/external/HoldView.js` no longer exist); the current producer is `lib/external/review-engagement-state.js::computeEngagementState()` (extracted from the context route S301; still called by `pages/api/external/review/[token]/context.js`), which falls through accepted reviewers to `stage2a`. I read a **consumer** and never re-read the current **producer**.
2. Claimed the reviewer magic link "stays valid 90 days throughout the process." WRONG: the current producer is `lib/services/review-manager/send-emails-service.js`, which re-mints the JWT for each dispatched draft carrying an external-review link and overwrites the stored hash — "latest link wins"; prior links stop verifying. Preview rendering became read-only in S404 v4. Never assert permanence without reading the current mint producer.

Both were caught by the owner / Codex, not self-review — because self-review is blind to its own premise. Pattern identical to [[feedback-falsify-not-confirm]], but the surface is internal-behavior-in-conversation.

## The rule (trigger → action)

- **TRIGGER:** about to assert how this system behaves, in any user-facing text.
- **ACTION:** (1) name the PRODUCER and confirm I read that line this session; (2) tag `[verified <file:line>]` or `[unverified]`; (3) if it's described only in a plan/doc, verify it's wired before claiming it exists. If I can't, hedge.

Pair with [[feedback-cite-ground-truth]] (external facts), [[feedback-falsify-not-confirm]] (scope/quantity), [[feedback-self-review-before-delegating-review]] (provenance/lifecycle trace), and Operating Rule #1 (plan ≠ built state).
