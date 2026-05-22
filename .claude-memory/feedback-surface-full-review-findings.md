---
name: Surface every finding from external reviewers, don't filter
description: When Codex or any external reviewer raises issues, list ALL findings to the user using the reviewer's own classifications. Never pre-classify into "defer" or "polish-not-worth-surfacing" without showing the full set first.
type: feedback
originSessionId: b8ea3bce-5eab-46eb-a312-51d2ff4ef77b
---
When another developer or reviewer (Codex, code-reviewer agents, etc.) is asked to review work, the user wants the actual review — not a curated summary that pre-decides what's worth their attention.

**Why:** On 2026-05-09 Codex reviewed Session C UI code and returned 9 numbered findings (1 BLOCKER, 5 POLISH, 3 SOUND). I surfaced the blocker plus 2 polish items I judged "strongest," and tucked the remaining 3 polish items under phrases like "defer the rest" and "the modal-footer mobile concern" without listing them. The user explicitly called this out as a trust issue — they brought Codex in for an outside view, and my filtering partially nullified that. The user said: *"If another developer raises an issue, I want to hear about it, not have it swept under the rug."*

**How to apply:**

1. **List every finding.** When relaying a review, surface each one. Use the reviewer's own labels (BLOCKER / POLISH / SOUND / etc.), not my own re-classification.

2. **Don't bury items via "defer the rest" framing.** Even items I judge low-priority go on the list, with their actual content.

3. **Recommendations come after the full set, not instead of it.** If I think some items should be deferred or some prioritized, present that as a separate "my recommendation" section AFTER showing the complete review. The user makes the call on what to act on.

4. **Apply the same rule to other review surfaces:** code-reviewer subagents, ultrareview output, security-review findings, lint/typecheck failures, CI gate failures, etc. The pattern is: relay first, recommend second.

5. **When in doubt, err on the side of more detail.** A user who wants less detail can ask for a tighter summary. A user who wanted full findings and got my filtered version has lost information they explicitly asked for.

This rule does NOT apply to my own internal thinking ("here are 12 ways this could fail" — most of which the user doesn't need to hear). It applies specifically when an external review surface has produced findings I'm relaying.
