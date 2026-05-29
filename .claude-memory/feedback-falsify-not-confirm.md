---
name: feedback-falsify-not-confirm
description: For any scope/quantity claim, run the DISCONFIRMING query (complement/counter-instance), not the confirming one — the grammar of the claim picks the query. Hook-enforced.
metadata:
  type: feedback
---

**The failure (recurring, S197):** I search to *confirm*, not to *falsify*. I form a hypothesis ("bundled prompts live in `shared/config/prompts`"), grep for exactly that, get a hit, and treat the hit as verification — but the query was shaped by the assumption, so it can only confirm it. The search launders the assumption into a "fact" and I stop early. This produced a string of wrong claims an outside reviewer (Codex) caught that my self-review could not, because the blind spot lived in my premise.

**Why descriptive memories didn't fix it:** [[feedback-grep-general-codebase-terms]] and [[feedback-thoroughness-default]] already said "do better" and never fired at the moment of the mistake. Self-review is blind to its own premises. So the fix is a forcing function, not willpower.

**The rule (trigger → action):**
- **TRIGGER:** I am about to assert a claim containing a *scope/quantity* signature — **only / all / none / every / never / always / "the rest" / "N of M" / "source of truth"** — especially into a durable artifact (docs/, .claude-memory/, CLAUDE.md).
- **ACTION:** Verify by FALSIFICATION. The grammar of the claim picks the query:
  1. "X is only in Y" / "all/none/the rest" → query the **complement set** (search for X *not* in Y; a counter-instance). A hit falsifies the claim.
  2. "N of M" → derive **M independently of N** (different source). Never let one query produce both numerator and denominator (the "~1 of ~19" error was circular).
  3. "X is the source of truth / X does Y" → search for a **counter-instance** where something else does Y.
  4. If **no falsifying query is constructible**, the claim isn't verifiable → **hedge, don't assert.**

**Enforcement (not willpower):** a PreToolUse(Write|Edit) hook — `.claude/hooks/scope-claim-reminder.js`, wired in `.claude/settings.json` — scans writes to docs/ / .claude-memory/ / CLAUDE.md|SESSION_PROMPT.md|AGENTS.md for those quantifier signatures and injects this reminder at the moment the durable claim lands. It fails open (never blocks edits) and is tunable via `/hooks`. The hook breaks autopilot at the right surface; running the disconfirming query is still mine to do.

**Defense-in-depth:** hook (every durable claim, cheap) → verification workflow (high-stakes claims / broad sweeps; N independent agents prompted to *refute*) → Codex stop-gate (thin backstop). Drives the source error rate down so the backstop catches a trickle. See [[project-system-model]], [[feedback-apply-reconcile-to-fix-work]].
