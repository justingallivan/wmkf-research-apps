---
name: project-invitation-link-strictness-open-decision
description: Post-reviewer-cycle owner decision pending — tighten invitation-link validation (exactly-one-occurrence) or ratify the current duplicate/punctuation tolerance
status: active
metadata:
  type: project
---

The unified invitation-link validator (`lib/utils/invitation-link-validator.js`,
branch `feature/reviewer-invite-vip`, commit `ff156f3d`, 2026-08-26) tolerates
two legacy inputs on purpose: repeated IDENTICAL reviewer-JWT links (dedupe →
send; only DISTINCT tokens are `external_link_ambiguous`) and trailing prose
punctuation after a token. Codex's rescue had tightened both; Claude reverted
mid-reviewer-cycle because live PD templates could not be probed.

**Why:** the owner wants the strictness question decided deliberately after the
cycle, and explicitly worried it would be forgotten ("test everything again in
6 months").

**How to apply:** when the reviewer cycle ends, surface the queue entry
"Post-reviewer-cycle: decide invitation-link strictness deliberately" in
`docs/CURRENT_WORK_QUEUE.md` (Audit follow-ups). Do not tighten or ratify
silently; flipping the contract means deliberately re-pinning the S2 test in
`tests/unit/send-emails-service.test.js` and the boundary tests in
`tests/unit/invitation-link-validator.test.js`, then re-testing the invite
send flow. Related: [[project-closed-work-archive]].
