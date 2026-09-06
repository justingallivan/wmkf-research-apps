---
name: project-reviewer-lifecycle-autonomy-directive-2026-09-05
description: Owner directive (2026-09-05 evening) to build lifecycle Stages 2, 3, 5, 7 autonomously with the plan→Sonnet→Opus→Codex(≤2) cycle; COMPLETED 2026-09-06 (17 PRs). Owner resolved D0–D5 on 2026-09-06 (D0/D3/D5 taken, D1 preserved, D2/D4 removed, 6D-1 confirmed, 6D-2 parked); PRs #170–#173 merged to Production 2026-09-06 (S491) — Stage 7 plan decisions table is authoritative.
metadata:
  type: project
  status: closed
  last_verified: 2026-09-06 via S491 stack merge
---

On 2026-09-05 (Session 489, evening) Justin granted autonomy for the remaining reviewer
lifecycle work: "Once the current tasks land, keep working on the next items in the queue
(2-5, then 7)." Rationale in his words: two cycles a year, so anything not surfaced now
"will come back to bite us when we've forgotten about it"; the team will be "given more
grace now while we're starting out" than in a few months when colleagues expect a better
experience. "If you are stuck, feel free to stop. Otherwise, I'll check on your progress
in the morning."

**Why:** The architect had pushed back that Stages 2/3/5/7 are internal writer-boundary
moves with no observed defect and that promotion during the D26 review window was risky.
The owner weighed that and chose to build now. Stage 4 remains skipped (audit: benefit not
established).

**How to apply:** Operating cycle per stage: architect plan (with contract-reconcile for
anything touching routes/services/persistence) → Sonnet builds on a fresh branch from main
→ Opus independent review → Codex adversarial, at most two rounds as a stopping rule →
PR. Try `gh pr merge`; if the permission classifier blocks it, leave the PR green for the
owner and cut the next stage so it stacks. Record each stage in its receipt and the
readiness audit. Stop and report if a stage hits the Codex cap without converging or a
decision is genuinely the owner's. Architect took the 6D uniform-enforcement decision
under this grant (both reviewers recommended it); flagged for morning review. See
[[project-accepted-awaiting-materials-is-transient]] and the readiness audit
`docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md`.

**Outcome (2026-09-06, S489 close):** the queue is exhausted. PRs #152–#168 merged (follow-up fix,
6C, 6D, Stage 2, Stage 3A–3K, Stage 5, Stage 7); readiness audit rows all COMPLETE except optional
Stage 4. `gh pr merge` was not blocked this session. Two stages (3K, 7) hit the Codex two-round cap;
both were closed by architect verification rather than a third round, recorded in the Stage 7 plan.
Every tightening surfaced during the campaign (D0–D5, 6D uniform enforcement, 6D accepted limits)
was preserved behavior-for-behavior and tabled for the owner in `SESSION_PROMPT.md`; nothing was
tightened under the grant except the 6D uniform-enforcement call already flagged above. The owner's
morning review (S490, 2026-09-06) took D0, D3 (plus the accept/decline ETag follow-on) and D5,
preserved D1, retired D2 and removed D4 (after first choosing (a), reversed on the orphan finding),
confirmed 6D-1 and parked 6D-2 — the Stage 7 plan table records each; the four-PR stack #170–#173
merged to Production in S491 (`7389e489`). The cycle
itself (delegation-pin rule from slice one, three-dot Codex diffs, worktree sequencing) is the
reusable part; see [[project-closed-work-archive]].
