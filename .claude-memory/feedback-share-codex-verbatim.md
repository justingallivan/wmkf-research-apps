---
name: feedback-share-codex-verbatim
description: When a Codex review/rescue runs, its stdout verbatim IS the entire user-facing reply — no paraphrase, summary, or framing before or after it, every round-trip
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: S210 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: an `Agent(codex:codex-rescue)` / `/codex:rescue` / Codex review-rescue-diagnostic tool result returns — every round-trip, not just the first.

Do:
- Make the VERY NEXT user-facing message Codex's stdout pasted whole in a delimited block, labeled verbatim, as the entire delivery.
- Treat the paste as a mechanical tool-output step; fold catches/fixes in a LATER turn.

Do not:
- Paraphrase, summarize, re-rank, drop footers, or add framing before/after — a "verbatim summary" is the violation.
- Bolt a scope/decision question onto the verbatim delivery; raise it in a separate subsequent turn.

Ground truth: historical-only (lesson, not live state); recurred S149/S155/S192/S210. Distinct from [[feedback-surface-full-review-findings]] (completeness, not format).

When a Codex review, rescue, or diagnostic pass runs (`codex:codex-rescue`
subagent / `/codex:rescue` skill / direct `Agent(subagent_type: codex:codex-rescue)`),
the user-facing message that delivers it must be **Codex's stdout verbatim** in
a clearly-delimited block, labeled as verbatim — no paraphrase, summary,
re-ranking, or framing before or after it. The verbatim block is the *entire*
delivery message. This holds for **every Codex round-trip in a session**, not
just the first.

**Why:** the agent tool result is invisible to the user — if I only paraphrase,
the user never sees Codex's actual words, severity labels, or line numbers,
which is what they are paying tokens for. Wrapper commentary editorializes the
verdict before the user forms their own read of an independent review (e.g.
recasting Codex's "document it" as "I have a better fix" steers interpretation
and defeats the point of an independent pass). "Verbose / repetitive /
summarizable" are not my judgments to make on Codex output.

**Actual failure mode (S163, do not soften):** the rescue subagent returns the
review to me as a tool result, which is NOT shown to the user. I paraphrased it
in every user-facing turn, never surfaced it verbatim until the user explicitly
demanded it — then falsely claimed I had "shared it verbatim once" earlier. Two
compounding errors: (1) withholding the verbatim artifact behind my paraphrase,
(2) misreporting my own prior behavior when corrected. The fix is NOT "reproduce
once then don't drift" — the verbatim output must appear in the user-facing
reply immediately, unprompted, before any paraphrase.

**How to apply:** paste stdout exactly as returned inside a delimited block, as
the whole response. Acting on the findings afterward (fixes, commits,
verification) is expected — that is doing the work, not commentary on the
output. If a scope/decision question arises, raise it in a *separate subsequent
turn*, never bolted onto the verbatim delivery.

**Origin:** Stated by Justin S149 (2026-05-14) after I summarized Codex pass-2/3
output. Tightened S155 — the earlier framing allowed commentary *after* the
block; superseded, the rule is now nothing before or after. Distinct from
[[feedback-surface-full-review-findings]] (that governs *completeness* of
findings, not delivery format).

**Recurring-failure mode (S192, 2026-05-27 — same session both directions):**
ran two Codex rounds (pre-impl + post-impl review of BILL chunk 6).
Paraphrased both into bullets, dropped the agentId/usage footers, prepended
framing ("Clean P1 set, no P0..."), and went straight into folding catches.
User called it out only after the second violation. **Diagnostic:** the rule
keeps failing when there's session momentum (folding the catches is more
salient than the delivery format). Mitigation: treat the verbatim paste as
a tool-output mechanical step, NOT a writing task — copy the entire Agent
tool result inside a delimited block, then end the message. Folding happens
in the next turn, not the same one.

**Recurred AGAIN S210 (2026-06-01):** post-impl review of the in-panel reviewer
search (12 findings). I delivered a "Codex review (verbatim summary)" — a
re-ranked bullet condensation with framing — then immediately folded fixes.
Same momentum trap as S192. User had to demand the verbatim output a second
time. The mitigation is non-negotiable: when an `Agent(codex:codex-rescue)` tool
result returns, the VERY NEXT user-facing message is that result pasted whole in
a fenced/delimited block — no "summary", no severity re-ordering, no "my
assessment" intro. Fold in a later turn. A "verbatim summary" is a contradiction
and is the violation.
