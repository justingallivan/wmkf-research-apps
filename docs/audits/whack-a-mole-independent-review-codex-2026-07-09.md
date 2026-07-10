# Whack-a-Mole Independent Review (Codex) — model the state space before the mechanism

Date: 2026-07-09  
Repo state reviewed: `main` at `2b03e2de`  
Mode: read-only, code- and history-grounded review; no product code changed  
Verdict: **NEEDS REWORK**

## Purpose

This audit is an independent review of the codebase's recurring
patch → review finding → follow-up patch pattern and of the proposed remediation in:

- `docs/audits/whack-a-mole-audit-2026-07-08.md`
- `docs/audits/whack-a-mole-meta-review-fable-2026-07-08.md`
- `docs/WHACK_A_MOLE_REMEDIATION_PLAN.md`

Those documents were read to understand the problem and the prior proposal. Their conclusions
were treated as hypotheses, not accepted premises. This review selected representative cases from
live code and git history, reconstructed the failure sequence, and tested competing explanations.

The review does **not** supersede an owner decision. It records a later independent verdict that the
current remediation plan should not be executed as written until the owner chooses whether to adopt
the named changes below.

## Executive verdict

The whack-a-mole pattern is real, but the Fable meta-review's single-root explanation — unchecked
hand-maintained enumerations — is too narrow.

Across the independently selected cases, the stronger common cause is:

> **A stateful or judgment-heavy change is specified as a positive path while one or more semantic
> dimensions remain implicit — ownership/lifetime, lifecycle transition, uncertainty, concurrency,
> failure, or downstream consumption. Implementation review then discovers those dimensions one at
> a time.**

Hand-maintained enumerations are one manifestation of that problem, especially for lifecycle fields
and bespoke static analyzers. They do not explain the React request-lifetime or identity-evidence
regressions. The existing remediation also adds more rules, hooks, gates, and documentation to a
repository that already encoded the relevant lessons before the sampled July incidents.

The highest-leverage response is therefore not another broad rule set. It is to change the unit of
design and review: define a compact semantic state-space contract before implementation, derive
independent tests from it, review once against that same contract, and stop recursively expanding a
change for adjacent pre-existing issues.

## Review method and coverage

### Independent case selection

Repository churn since 2026-05-01 was used only as a selection aid, not as proof of defect density.
The four review surfaces were:

1. Request-scoped React state in `ReviewersTab` and the dynamic workbench page.
2. Reviewer engagement transitions in `reviewer-suggestion.js`.
3. Reviewer identity judgment in `reviewer-identity-resolver.js` and its tests.
4. Cross-repo enforcement machinery: custom gates, hooks, skills, docs, and memory.

These surfaces exercise different failure modes: async lifetime, durable state, heuristic
classification, and engineering governance.

### Contract-reconcile coverage

- Whole-flow: traced for the React lifetime, lifecycle transitions, and identity classifier cases.
- Partial-success: N/A; no batch API change was under review.
- Async/stale-state: traced through all three `ReviewersTab` loaders and the parent remount boundary.
- Helper extraction: assessed for the proposed engagement registry and transition derivation.
- Durable surface: assessed for CI gates, hooks, audit docs, session handoff, and memory routing.
- Doc reconcile: performed through `/sweep` when preserving this audit.
- Symbol-consumer fan-out: assessed for lifecycle stamp writers; the proposed registry explicitly
  scopes out external transition writers, which prevents its claimed totality.

## Findings

### 1. PARTLY CONFIRMED — the class exists, but unchecked enumerations do not unify it

#### Request-scoped React state

`ReviewersTab` has three request-dependent loaders. Commits `701b15ae` and `0ea8f80e` added
per-loader stale-result guards. A later pass found request-specific state in child components and
fixed the ownership boundary by keying the entire subtree in `f805b5fc`.

[VERIFIED via `shared/components/reviewers/ReviewersTab.js:58-68`] the child still says it is not
keyed and explains the local guards as the primary mechanism.  
[VERIFIED via `pages/workbench/[requestId].js:148-158`] the live parent now keys `ReviewersTab` by
`requestId`, making remount the structural boundary and the loader guards defense in depth.

This was not an incomplete field enumeration. It was an unexpressed lifetime and state-ownership
contract: request-specific state lived below a component identity that survived request changes.

#### Identity evidence

Commit `d03e09aa` introduced a forename gate using `forenameAgrees !== false`. Commit `b2245d05`
fixed the same-session regression after live probes showed that initial-only OpenAlex names were
being treated like contradictory names.

[VERIFIED via `tests/unit/reviewer-identity-resolver.test.js:220-267`] the durable tests now separate
explicit contradiction, initial-only/no-contradiction, agreement, and an undefined non-spine value.

The failure was a missing semantic state. A boolean framed as “agrees” collapsed at least three
meanings: agrees, contradicts, and lacks enough evidence to decide. The structural correction was
the explicit `forenameContradicts` dimension, not a more complete list.

#### Engagement lifecycle

The engagement history combines real implementation misses with changing product semantics:

- `51ef988a` introduced restore and deliberately preserved invitation state.
- `f75628a5` added disposition scope after review.
- `051b6b42` added optimistic locking after re-review.
- `341e19ad` later redefined restore/re-add as a fresh engagement.
- `c64e30ab` expanded the reset to the full known engagement set and closed a lost-update race.

[VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1183-1264`] `updateLifecycle` maps a
generic write surface and adds excluded-row/complete-transition effects.  
[VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1284-1348`] accept/decline is a named
transition with its own response and policy effects.  
[VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1380-1431`] removal and restoration
have different retention/reset and concurrency semantics.

The missing reset fields were an enumeration problem. The earlier scope and concurrency fixes were
not. The larger issue was that “restore” lacked a settled state-transition contract before the first
implementation: inverse selection toggle versus new engagement were materially different meanings.

### 2. CONFIRMED — the repository already knew the missed lessons

The prevention guidance predates the sampled July incidents:

- [VERIFIED via `.claude/skills/contract-reconcile/SKILL.md:53`] every post-await write on a
  changing context must have a stale-generation guard.
- [VERIFIED via `.claude/skills/contract-reconcile/SKILL.md:62`] state machines must be complete
  across terminal signals and sibling writers.
- [VERIFIED via `.claude/skills/contract-reconcile/SKILL.md:88`] implementations must enumerate
  complement/fall-through behavior and sweep sibling surfaces.
- [VERIFIED via `.claude/hooks/pre-commit-self-review.js:11-76`] the tailored pre-commit reminder
  itself says scattered reminders did not prevent misses, then repeats the React, concurrency,
  sibling-fan-out, and shift-left checks.

The active repository contains 55 `check-*` scripts totaling approximately 14,138 lines, 10 scoped
rule files, 374 Markdown docs under `docs/`, and 225 Markdown memory files [VERIFIED via file census
on 2026-07-09]. The counts do not prove that each artifact is wasteful. They prove that the limiting
factor is no longer absence of written guidance.

The likely failure mode is attention and activation: broad advisory mechanisms know many correct
things, but the active change is not forced to express its particular state space in a compact form.
Adding an eighth audit question to `contract-reconcile` (WS5) repeats the existing response pattern
without changing that activation problem.

### 3. NEEDS CHANGE — WS1 would weaken the test oracle and overclaim totality

The current tests independently state the 12-field fresh-start expectation:

- `tests/unit/reviewer-adapters-writeback.test.js:22-35`
- `tests/unit/reviewer-suggestion-disposition.test.js:41-54`

WS1 step 5 says to point those tests at the new registry — “import, don't restate”
(`docs/WHACK_A_MOLE_REMEDIATION_PLAN.md:126-127`). That would make implementation and expectation
share an oracle. Removing a field from the registry could change both the produced payload and the
test's expected payload together.

WS1's totality check is also bounded to fields already represented in `updateLifecycle`, the
registry, and adapter select/write surfaces. Step 6 explicitly leaves send-email, reminder,
thank-you, and withdraw-sufficient writers outside the refactor. A new stamp introduced by one of
those writers but omitted from `updateLifecycle` would remain outside both sides of the parity and
could leave the gate green.

Required reshape:

1. Model named events (`remove`, `restoreFresh`, `accept`, `decline`) as small pure transitions.
2. Preserve independently authored state/event/outcome expectations in tests.
3. If a field registry remains useful, prove its coverage against an authoritative schema or
   field-family declaration, not only another application map.
4. Preserve transition-specific semantics; do not assume all fields in one phase share the same
   reset/retention rule.

### 4. NEEDS CHANGE — WS2 diagnoses the wrong testing gap

The known identity cases are already durable Jest fixtures:

- Sang/Keller promotion and initial-only behavior:
  `tests/unit/reviewer-identity-resolver.test.js:121-179,220-267`
- Bucksbaum ORCID-name promotion and contradiction:
  `tests/unit/reviewer-identity-resolver.test.js:183-218`
- OpenAlex author fail-closed shapes:
  `tests/unit/reviewer-identity-resolver.test.js:270-371`

The S236 regression occurred because the original partition omitted initial-only uncertainty, not
because the code lacked fixtures. A second `tests/unit/judgment-fixtures/` corpus would duplicate
coverage unless it replaces the positive-path examples with an explicit decision table.

Required reshape: author one compact table covering agreement, contradiction, initial-only/unknown,
absence, hard-key identity, and conflicting hard keys. Review classifier changes against the table
and use selective mutation checks to prove each row is discriminating.

### 5. REJECT/DEFER — WS4 and WS6 add machinery without closing the observed generator

#### Carryover shell probes (WS4)

WS4 proposes embedding a shell command and expected output in each `SESSION_PROMPT` item, then
executing it from a validator (`docs/WHACK_A_MOLE_REMEDIATION_PLAN.md:254-269`). That introduces a
command interpreter for mutable Markdown, output-format coupling, timeout behavior, platform
variance, and command-safety concerns.

The simpler structural move is to stop using `SESSION_PROMPT.md` as a long-lived backlog. It should
carry active/in-flight context only. Durable deferred work should live in one stable backlog surface;
then stale carryover disappears instead of requiring executable prose.

#### Nomenclature rename (WS6)

[VERIFIED via `shared/config/appRegistry.js:334-350`] the current canonical registry deliberately
classifies `/api/reviewer-finder` and `/api/review-manager` as stable borrowed infrastructure,
accepts both legacy and consolidated grants, and says not to rename the paths.

WS6 reverses that decision across both legacy API route trees, their service modules, clients,
authorization, scripts, tests, and hundreds of durable restatements. The plan itself sizes the
build L/high risk.
No reviewed whack-a-mole incident was caused by the legacy URL text. This is a nomenclature cleanup,
not remediation of the dominant defect generator. Defer it outside this program unless a concrete
operational or user-facing failure justifies the migration.

### 6. KEEP NARROWLY — WS0 is the strongest existing item

[VERIFIED via `.github/workflows/test.yml`] these correctness/security gates are absent from CI:

- `check:prompt-injection-tagging`
- `check:trust-boundary-guid`
- `check:status-enum-parity`

Adding each gate and its self-test is bounded, mechanical, and independently falsifiable. Keep the
remaining documentation/memory advisory gates session-time unless a demonstrated push-path escape
requires CI enforcement.

## Recommended operating model

### 1. Make the unit of work a semantic contract

Before code on stateful, heuristic, concurrent, or request-scoped work, write a compact scenario
matrix with these columns:

| Dimension | Required question |
|---|---|
| Owner / identity | What makes this state belong to this request, person, or generation? What invalidates it? |
| Pre-state | Which starting states are valid, invalid, or unknown? |
| Event | What named user/system event is occurring? |
| Post-state | What changes, what is retained, and what is cleared? |
| Uncertainty / failure | What happens for missing evidence, ambiguous evidence, errors, and unknown enum values? |
| Concurrency | What if a sibling writer changes the row between read and write? |
| Consumers | Which UI, cron, filter, bucket, and write/read projection observes the result? |

This is not another permanent mega-document. It belongs beside the focused design or test fixture
for the change and should stay small enough to review in one pass.

### 2. Keep the test oracle independent

Derive implementation structure from the matrix, but author expected behavior independently.
Registries may remove production duplication; tests must not import the registry to decide what the
registry should contain.

### 3. Review against one frozen contract

Use one self-review and one adversarial review against the same matrix. Classify findings as:

1. **Contract violation** — blocks the change.
2. **Same class, same surface** — expand the contract once and close it in this change.
3. **Adjacent/pre-existing** — record separately; do not recursively enlarge the current change.

This preserves full-class reasoning without making every review an unbounded repository audit.

### 4. Put governance on a budget

Add a global instruction, hook, or bespoke gate only when:

- the same class recurred on at least two unrelated surfaces;
- existing enforcement demonstrably could not express it;
- the new control is mechanical rather than advisory;
- it has an owner, an effectiveness signal, and a retirement criterion.

Prefer runtime validation, types, schema constraints, and mature static-analysis rules at true
chokepoints. Treat custom AST/taint analyzers as bounded defense in depth, not proof of whole-program
semantics. Periodically merge or delete reminders whose lesson is already enforced elsewhere.

## Disposition of the current remediation workstreams

| Workstream | Independent verdict | Required action before execution |
|---|---|---|
| WS0 — missing gates in CI | KEEP | Add only the three named correctness/security gates + self-tests. |
| WS1 — engagement registry | REWORK | Use named pure transitions; retain independent expectations; prove real totality. |
| WS2 — fixture corpus | REWORK | Build a decision table around missing semantic states; avoid duplicate fixtures. |
| WS3 — cycle fail-loud + prose sweep | REWORK | Probe actual off-cycle data first; enforce at the authoritative write/data-quality boundary where possible; do not default to a broad caller-by-caller sentinel migration. |
| WS4 — carryover probes | REJECT | Shrink the handoff; do not execute shell commands from Markdown. |
| WS5 — eighth audit question | REJECT | Do not add another advisory sentence to an already comprehensive skill. |
| WS6 — nomenclature rename | DEFER | Move to a separate migration only if a concrete benefit justifies the blast radius. |
| WS7 — checkJs extension | KEEP AS POSTURE | Apply opportunistically to new pure registries/transitions; not a standalone project. |

## Newly observed issues

1. **P2 — stale request-lifetime comment.** `ReviewersTab.js:58-63` says the component is not
   keyed, contradicted by `pages/workbench/[requestId].js:148-158`. Update it when product code is
   next touched so the key is primary and local guards are defense in depth.
2. **P1 — proposed test-oracle collapse.** Do not implement WS1 step 5 as written.
3. **P2 — executable handoff probes.** Do not build WS4 around arbitrary shell commands embedded
   in Markdown.

## Verification record

[VERIFIED 2026-07-09]

- Session-start gate battery: all required `check:*` gates green.
- `npm run check:types`: green.
- Targeted suites:
  `tests/unit/reviewers-tab-stale-request.test.js`,
  `tests/unit/reviewer-suggestion-disposition.test.js`,
  `tests/unit/reviewer-adapters-writeback.test.js`, and
  `tests/unit/reviewer-identity-resolver.test.js` — **4/4 suites, 101/101 tests green**.
- Repository remained clean during the read-only review.

## Final verdict

**NEEDS REWORK**

Keep WS0 narrowly. Reframe WS1–WS3 around explicit semantic state spaces and independent test
oracles. Remove WS4 and WS5 from the program. Defer WS6 outside the whack-a-mole remediation. Treat
this audit as an owner-decision input, not approval to modify or abandon the existing plan.
