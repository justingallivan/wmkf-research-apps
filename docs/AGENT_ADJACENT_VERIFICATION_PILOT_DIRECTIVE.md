---
title: Agent Adjacent-Verification Pilot Directive
domain: agent-harness
kind: plan
status: canonical
summary: "Pilot a narrow, privacy-safe evidence contract for agent claims before adding blocking hooks or broad instruction changes."
canonical: true
cataloged: 2026-07-31
last_verified: 2026-07-31
owner: product-engineering
related:
  - docs/AGENT_HARNESS_STYLE_GUIDE.md
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
  - docs/CI_GATES_REFERENCE.md
  - docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md
---

# Agent Adjacent-Verification Pilot Directive

## Controlling instruction for Session 392

Session 392 must address the agent **adjacent-verification** failure before
resuming reviewer runtime stabilization. Adjacent verification occurs when an
agent inspects genuine evidence but writes a broader claim than that evidence
supports—for example, reading a function body and claiming when every caller
runs it, or finding one detector and concluding no other detector exists.

This is a bounded agent-harness pilot, not a general instruction rewrite. Do
not merge or implement Claude's proposed enforcement plan wholesale. Do not
change reviewer runtime code, reviewer data, or Production state during this
pilot. The existing reviewer stabilization directive remains valid and is the
first application priority after this pilot reaches a documented stop
decision.

## Why this outranks the application work temporarily

The reviewer stabilization stop exposed a verification-method problem, not
only a reviewer-domain problem. Local fixes were often sound in isolation, but
their verification did not always establish the larger lifecycle claims used
to justify the next change. Continuing the application work without first
improving that method risks repeating the same patch/review loop.

The intervention must remain small. Its purpose is to test whether a precise
claim-to-query contract improves agent work without creating noisy blockers,
false assurance, privacy leakage, or another sprawling instruction project.

## Evidence and review basis

The following state was verified on 2026-07-31:

| Claim | Evidence | Status |
| --- | --- | --- |
| Claude documented four instances of genuine evidence being generalized beyond its scope | Read-only review of `codex/claude-ui-followup` commit `848bdb3b`, especially the three `AGENT_ADJACENT_VERIFICATION_*` documents | **VERIFIED via branch source** |
| Current plan-source enforcement proves that a named file was read, not that its content supports a particular claim | `.claude/hooks/plan-named-source-read-guard.js` and `.claude/hooks/lib/document-guards.js` | **VERIFIED via source** |
| Current broad-quantifier handling is mostly advisory, with only narrow blocking cases | `.claude/hooks/scope-claim-reminder.js` and `.claude/hooks/design-doc-assertion-guard.js` | **VERIFIED via source** |
| Claude Code hooks receive a transcript path; Stop hooks also receive the last assistant message and can require continuation | Official Claude Code hook contract reviewed 2026-07-31 | **VERIFIED via primary documentation** |
| A hook can generally determine whether a command ran, but cannot infer that the command enumerated the semantically correct domain | Current hook implementation and contract review | **VERIFIED limitation** |
| The usefulness and false-positive rate of the proposed claim-shape detector are not yet known | No pilot or representative fixture corpus exists | **UNVERIFIED — pilot purpose** |

Claude's source worktree is useful historical evidence but is not a dependency
of this directive. At the point of review it was clean at commit `848bdb3b` on
`codex/claude-ui-followup` and one commit ahead of its remote. Preserve it until
the pilot closes; do not merge it merely to obtain the proposal.

## The failure model

The pilot should recognize four evidence obligations:

| Claim shape | Minimum verification obligation |
| --- | --- |
| Call path or timing: “runs on every…”, “at save time”, “called from”, “before/after” | Trace callers from an entry point and inspect relevant downstream consumers; reading the definition alone is insufficient |
| Universal or negative: “all”, “only”, “never”, “no mechanism”, “impossible” | Define the domain and inspect the complement or enumerate the denominator; one matching mechanism is insufficient |
| Count or coverage: “N sites”, “N of M”, “every route” | Show the enumeration and derive or independently check the denominator |
| Built/current behavior inferred from a plan, memory, or prior session | Inspect the producing source, persisted state owner, or live probe; intent documentation is not implementation evidence |

The obligation applies to descriptive present-state claims. It does not
automatically apply to requirements (“the system must never…”), hypotheses,
historical quotations, examples, or explicitly labeled assumptions.

## Safety constraints

1. **No claim of semantic proof.** A regex or hook can require a useful query
   shape; it cannot generally prove that the selected domain, callers, or
   complement are complete.
2. **No raw-output mandate.** Do not require unbounded command output in durable
   documents. Output can contain reviewer emails, live Dataverse identifiers,
   secrets, personal information, or large source excerpts.
3. **Bound and redact evidence.** Evidence retained in a document must be the
   minimum redacted excerpt or structured result needed for review. Never
   retain environment values, credentials, access tokens, or unrelated live
   records.
4. **No fabricated assurance.** Model-authored pasted output is not
   “incorruptible.” Unless a future helper produces a transcript-bound receipt,
   treat command/excerpt text as reviewable provenance, not cryptographic
   proof.
5. **Name the enforcement boundary.** `.claude/hooks` assists Claude Code. It
   does not govern Codex file edits or every chat surface. Durable cross-agent
   guarantees require repository gates or review.
6. **No broad chat-enforcement claim.** No current hook prevents an inaccurate
   chat response from first being rendered. A Stop hook may audit the last
   assistant message and require a correction, but whether that is sufficiently
   precise and quiet is unproven.
7. **Fail visibly, not mysteriously.** Any advisory or blocker must name the
   claim it detected, the missing evidence shape, and an executable remedy or
   narrowing escape such as `[ASSUMED]`.

## Bounded pilot

### Phase 1 — canonical rule and fixture corpus

1. Draft one short `.claude/rules/claim-evidence.md` containing:
   - the four-row claim-shape table above;
   - the descriptive-versus-normative distinction;
   - the redaction and bounded-evidence requirements;
   - honest escapes: narrow the claim, run the missing query, or label it
     `[ASSUMED]`.
2. Before wiring a hook, add representative fixtures for:
   - a correct caller trace;
   - a definition read incorrectly offered as caller evidence;
   - a universal claim with a real complement enumeration;
   - a universal claim supported by the wrong search domain;
   - a correct count with an independent denominator;
   - normative “must never” language that must not trigger;
   - a historical quotation or worked example that must not trigger;
   - sensitive/raw output that must not be requested for retention; and
   - CodeGraph caller evidence that must be accepted.

### Phase 2 — advisory-only detector

Add the smallest possible advisory detector for newly introduced text in plan
and design documents. In the first version:

- scope it to descriptive present-state claims carrying `[VERIFIED]` plus a
  temporal, positional, universal, negative, or count qualifier;
- inspect only newly introduced text using the existing document-guard helpers;
- identify the required query shape and provide a concrete remedy;
- accept CodeGraph traces as well as suitably scoped shell searches;
- never demand raw live output in the document; and
- fail open on internal hook errors while reporting the failure during tests.

Do not add blocking behavior, rewrite memory, modify the Stop skill, or repoint
multiple hooks during this phase.

### Phase 3 — observation and decision

Observe the advisory detector across three to five normal documentation
sessions or an equivalent representative replay corpus. Record:

- seeded adjacent-verification cases detected;
- known cases missed;
- false positives on normative, historical, and hypothetical text;
- whether remedies were understandable and executable;
- whether `[ASSUMED]` became an avoidance mechanism; and
- whether the detector requested evidence that would expose sensitive data.

After observation, make an explicit decision:

1. **Retire** the detector if it is noisy or creates false assurance.
2. **Keep advisory** if useful but not sufficiently precise for blocking.
3. **Promote narrow patterns to blocking** only when fixtures and observation
   establish low false-positive behavior and every block has a direct remedy.

Broad memory consolidation, hook-message repointing, wiki changes, and Stop-hook
auditing require a separate approved phase after this decision. Use `/sweep`
before any durable-memory consolidation.

## Acceptance and stop rules

The pilot is complete when:

1. the canonical rule and fixture corpus exist;
2. the advisory detector passes its focused tests and relevant instruction /
   documentation gates;
3. observation results and limitations are recorded;
4. an explicit retire/advisory/narrow-block decision is documented; and
5. an independent adversarial review confirms that the implementation does not
   claim more enforcement than it provides.

Stop and ask the owner before:

- turning any detector into a blocker;
- changing cross-agent repository gates;
- consolidating or deleting memory entries;
- adding persistent transcript storage or evidence receipts;
- retaining live command output in durable artifacts; or
- expanding the work beyond claim-evidence verification.

Independent review remains required for high-risk plans. The pilot may reduce
avoidable review findings; it does not replace adversarial review.

## Parked application priority

`docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` remains canonical and
unchanged. Once this pilot reaches its documented stop decision, resume that
directive from its first step: build the read-only diagnostic harness and make
the five golden workflows fail for their expected current reasons before any
reviewer runtime change or Production repair.

Do not interpret this temporary reprioritization as evidence that the reviewer
regressions are resolved. They remain verified open work.
