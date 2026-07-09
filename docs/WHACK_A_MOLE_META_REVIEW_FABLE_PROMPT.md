---
title: Whack-a-Mole Meta-Review — Fable Prompt
domain: engineering-process
kind: draft
status: draft
summary: "Fresh-eyes Fable prompt: given the S349 whack-a-mole audit, propose codebase-wide structural + process changes that prevent the patch-then-re-patch class."
canonical: false
cataloged: 2026-07-08
owner: engineering-process
related:
  - docs/audits/whack-a-mole-audit-2026-07-08.md
  - docs/audits/reviewer-holistic-review-fable-2026-07-08.md
  - docs/CLAUDE_COVERAGE_LESSONS.md
  - docs/TYPESCRIPT_OPTION_ASSESSMENT.md
---

# Whack-a-Mole Meta-Review — Fable Prompt

You are a fresh top-level model with broad latitude. Read this fully, then work
the problem — do not just answer point-by-point.

## The ask (read this before anything else)

A `whack-a-mole` audit of this codebase (`docs/audits/whack-a-mole-audit-2026-07-08.md`)
found many subsystems patched round-after-round instead of redesigned. The
biggest cluster — the reviewer finding/identity/contact/gating engine — already
has its own redesign in flight, so **it is NOT your subject.** Do not re-review
it; treat it as one data point.

Your subject is the **class**, not the instances. The audit (and the review it
cites) diagnosed a recurring behavioral cause and two structural amplifiers:

- Behavioral: "adopt a maximal principle from a vivid single case, encode it
  fully in code and prose, and only then let reality vote" → patch → regression
  → re-patch (`docs/audits/reviewer-holistic-review-fable-2026-07-08.md` §6).
- Amplifier A: a field/enum carrying two orthogonal axes (the identity
  `confirmed` sentinel = confidence AND attestation-source).
- Amplifier B: load-bearing invariants written in prose/comments, not enforced
  in code (they "break without anyone noticing for N sessions").

**Question:** what codebase-wide **structural and process changes** would
prevent this class of debt from re-accruing — cheaply, without a grand rewrite?
The most valuable output is a **prioritized, concrete, actionable list** the
team will actually execute — each item naming the recurring failure it closes,
the change, its rough cost, and how you'd know it worked.

Be adversarial about your own suggestions: this team already has many gates,
skills, and hooks. A new gate/rule that won't fire itself, or that adds
ceremony without closing a class, is not a win — say so. Prefer changes that
"close a class by construction" over changes that add another thing to
remember.

## Reframe-first, full latitude

- Challenge the framing. If the real lever is one or two moves (e.g. a type
  system, an eval-first rule, a single "invariants must be gates" policy) and
  the rest is noise, say that plainly. If the team is over-indexed on gates and
  the actual problem is design-before-build discipline, say that.
- You may conclude some "debt" is fine and should be left alone. Distinguish
  genuine thrash from healthy staged paydown (the audit already flags DAL and
  the service decompositions as healthy — pressure-test that judgment).
- Tell us what we've talked ourselves out of, or what a stronger convention
  from another codebase would do here.

## Worked example to ground the abstract (do this one concretely)

**Engagement-lifecycle stamp state (audit area #8).** The reviewer-suggestion
row carries a set of lifecycle timestamps (invited / reminder / materials /
review-received / response / thank-you / completed / withdrawn) plus
selected/accepted/declined booleans. Over S275→S347 the team repeatedly patched
what to reset when a candidate is removed / restored / re-added / re-invited —
culminating in a shared `ENGAGEMENT_STAMP_RESET` list that keeps growing as new
edge cases surface. Source of truth: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
(the "Candidate removal + restore" and "reviewer-engagement build" sections),
and `lib/dataverse/adapters/reviewer-suggestion.js`.

Show, concretely, what a structural fix looks like here (e.g. an explicit
state machine with transitions that own their own stamp effects, so "what to
reset" is derived, not hand-listed) — and then generalize the lesson into a
reusable rule for the codebase. This is your proof that the abstract
recommendations are real.

## Reading map (curated launch-pads — follow the threads)

Start here:
- `docs/audits/whack-a-mole-audit-2026-07-08.md` — the ranked areas + the
  remediation to-do (next-up + backlog) the team already drafted. Your job is
  to improve/reprioritize this, not restate it.
- `docs/audits/reviewer-holistic-review-fable-2026-07-08.md` §5–§6 — the
  meta-pattern diagnosis (the prior fresh-eyes pass; §6 is the seed of this
  review).

Process / prevention surfaces:
- `docs/CLAUDE_COVERAGE_LESSONS.md` — the team's own "patterns I keep missing"
  meta-doc ("each round is a one-line miss, but they aggregate").
- `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`, `docs/INVARIANT_MAP_ORCHESTRATION_BRIEF.md`,
  `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md` — the "close the class by
  construction" thread + the compile-time-enforcement lever.
- `CLAUDE.md` + `.claude/rules/` + `scripts/check-*.js` — the existing gate/rule
  surface you must NOT merely duplicate.
- `.claude-memory/MEMORY.md` — the router; `feedback-*` files encode the
  recurring mistakes as prose lessons (candidates for "make it a gate").

Structural amplifier evidence (for Amplifiers A/B above):
- `lib/services/reviewer-identity-resolver.js` (`classifySpineEvidence`) and
  `lib/dataverse/adapters/researcher.js` (sticky-`confirmed` guards) — the
  two-axis enum + prose-invariant example.

## Deliverable

Write to `docs/audits/whack-a-mole-meta-review-fable-2026-07-08.md` — a TRACKED
path (mirrors where the reviewer holistic review landed), so the findings
return to the repo via git with no copy-paste step. Commit it at the end of
your session (or the owner will).
Structure suggestion (adapt freely):
1. Verdict on the framing (is the audit's meta-pattern right? what's missing?).
2. Prioritized structural/process changes — each with: the class it closes,
   the change, rough cost (S/M/L), how you'd verify it worked, and whether it
   "closes by construction" or adds ceremony.
3. The engagement-stamp worked example (concrete design + the generalized rule).
4. What to explicitly NOT do (over-engineering / debt that's fine as-is).

## Session hygiene

Run in a NEW top-level `claude-fable-5` session. `git pull` first. Do NOT run
`/start` or `/stop` (skips the gate battery; keeps our session narrative out of
your fresh read). Commit the findings doc (the tracked path above) at the end
so a later Claude working session reads it directly, decides, and reconciles
into the backlog + memory.
