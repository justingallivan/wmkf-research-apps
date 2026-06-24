---
name: Verify additive carryover ("do X") against ground truth, not just destructive carryover
description: A SESSION_PROMPT/TODO "next step" that says BUILD/migrate/add X is a carryover claim, not a confirmed worklist — check it against memory/source/Atlas before surfacing or acting, because additive items go stale by getting DONE (or owner-blocked) and ride forward as phantom todos.
type: feedback
status: active
scope: global
last_verified: 2026-06-23 via source trace (token-lifecycle.js) + vercel env ls
---

## Recall Rule

Read this when: reading SESSION_PROMPT "next steps" / a TODO / a user prompt that says **build / migrate / add / wire / implement X** — i.e. additive carryover, not drop/remove (that's [[feedback-verify-before-destructive-carryover]]).

Do:
- Before listing the item as open OR acting on it, verify it against memory (`.claude-memory/`), source/Atlas, or a probe.
- If it's already shipped / owner-blocked / parked, say so with the evidence — mark it DONE/blocked/parked rather than carrying it forward as live.
- When surfacing a next-steps summary, present each item as a *claim to verify*, not a confirmed task.

Do not:
- Trust the "next steps" list as a worklist. It's inherited carryover and goes stale.
- Present an additive carryover item as actionable twice without checking the ground truth you already have in memory.

Ground truth: historical-only (lesson). Enforced at `.claude/skills/stop/SKILL.md` Step 3 (verify next-steps before writing them) and mirrors `/start` Step 5 (destructive carryover unverified-until-checked). Related: [[feedback-verify-before-destructive-carryover]] · [[feedback-falsify-not-confirm]] · [[feedback-behavior-claims-cite-the-producer]].

**Why:** S282 — "migrate reviewer invitations to `reviews.wmkeck.org`" sat in SESSION_PROMPT as an open "next step" and I surfaced it as actionable *twice* before checking. It was already live: `project-branded-domains.md` recorded `REVIEWER_PORTAL_BASE_URL=https://reviews.wmkeck.org` set in Production, and the link's single producer (`lib/external/token-lifecycle.js` → `buildExternalUrl`/`getReviewerPortalBaseUrl`) reads exactly that var. The answer was in memory the whole time; trusting the carryover list cost a verification round-trip. The previous session was *itself* about memory/wiki hygiene — yet the hygiene gates (`doc-symbol-refs`, `build-claim-freshness`) guard code/memory drift, NOT stale handoff next-steps, so the phantom todo had no automated guard and I supplied no skepticism.

**How to apply:** The destructive-carryover rule guards against *breaking live infra*; this one guards against *wasting effort on a phantom/already-done task* and misleading the user. Both treat carryover as unverified-until-checked — the difference is the failure mode (breakage vs. already-done/blocked). The check is cheap (grep the producer, read the relevant memory). Do it before the item reaches the user as a task, not after they say "do it."
