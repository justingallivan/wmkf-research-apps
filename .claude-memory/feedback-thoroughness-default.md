---
name: thoroughness-is-default-not-optional
description: "Skimming costs the user more than thorough work — both Codex tokens and review time. Banner-only edits, description-only memory edits, and confirmation-frame re-reads are not acceptable shortcuts. Surface incompleteness explicitly when it exists; do not pass partial work as complete."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e2f71cb4-b29c-4510-b8fe-1da4a49ec6ee
  status: active
  scope: docs
  last_verified: 2026-05-12 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: editing docs, memory, or any artifact whose current state I'm about to claim is "done."

Do:
- Pair every banner/description-line edit with a body audit in the same cycle.
- Run an antonym grep after a status change (`grep -rln "<old framing>" docs/ .claude-memory/` for "in progress / pending / not yet flipped").
- Cold-re-read edited docs in a different order/question to fight confirmation bias.
- State partial scope explicitly ("banner updated; body audit pending") rather than passing it as complete.

Do not:
- Update only a banner or only a description line and call the artifact current.
- Treat skimming as a time-saver — it costs the user Codex tokens and review attention.

Ground truth: historical-only (lesson, not live state). Related: [[feedback-surface-full-review-findings]].

**The rule:** When editing docs, memory, or any artifact whose state I'm claiming is current, default to thorough. Skimming saves session time but costs the user Codex tokens and review attention on follow-ups — net negative on every axis.

**Why:** 2026-05-12, Justin called this out directly. After a 5-tier doc-currency sweep I described as "done," Codex's review surfaced 19 findings (4 CRITICAL, 11 MODERATE, 4 MINOR) — many of them within docs/memory I had just touched. The pattern wasn't unusual; it was the same shortcut behavior recurring:

- Updating a top-of-doc status banner without reading the body → banner says SHIPPED, body says "we will build."
- Updating a memory entry's description line without reading the body → description is current, body still has stale paragraph.
- Re-reading my own edits in the same mental frame I made them in → confirmation bias misses contradictions a cold reader would catch instantly.
- Skipping the antonym grep after a status change → docs that say "in progress / pending / not yet flipped" stay un-found.

**How to apply** (these are workflow defaults, not aspirations):

1. **Banner edits include body audit.** If I update a status banner at the top of a doc, the rest of the doc gets read in the same edit cycle. If I genuinely can't do the body audit (budget, scope), I say so explicitly ("banner updated; body audit pending") — never let the user assume the doc is current when only the banner is.

2. **Description-line edits include body audit.** Same for memory entries. Updating only the description line is half-work; flag it as such if I do it.

3. **Antonym grep after status changes.** When something ships, retires, or is renamed, immediately:
   - `grep -rln "<old framing>" docs/ .claude-memory/`
   - Examples: after "Wave 1 closed," grep for "in progress / pending / not yet flipped / will retire." After "Set B deployed," grep for "Set B on hold / Set B pending."
   - Find the antonym, find the drift. 10 seconds, catches half the F-class issues.

4. **Cold re-read pattern.** I cannot simulate Codex's true cold read, but I can reduce confirmation bias: re-read docs I've edited in a different order (bottom-up, or grep-first then re-read), or with a different question in mind ("what would contradict the banner?").

5. **Surface incompleteness explicitly.** If a tier of work is partial, say so in the message to the user. The user can decide to accept the partial scope or push for full. Hiding partial work as complete is the actual failure mode — not the partial work itself.

**What this is NOT:** a demand for perfection or paranoid double-checking. Codex will still occasionally find minor things. The bar is: when external review runs, it should find *minor* drift, not CRITICAL/MODERATE drift in artifacts I just touched. Right now CRITICAL findings are not rare; that's the metric to move.

**Related:** [[feedback-surface-full-review-findings]] (already encoded: surface all reviewer findings unfiltered). This rule is the prevention side — fewer findings to surface because the work was thorough the first time.
