---
title: Agent Adjacent-Verification Pilot Directive
domain: agent-harness
kind: plan
status: canonical
summary: "Implemented advisory-only adjacent-verification contract, local observation window, and evidence required before any future narrow blocking proposal."
canonical: true
cataloged: 2026-07-31
last_verified: 2026-08-01
owner: product-engineering
related:
  - docs/AGENT_HARNESS_STYLE_GUIDE.md
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
  - docs/CI_GATES_REFERENCE.md
  - docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md
---

# Agent Adjacent-Verification Pilot Directive

## Historical Session 392 mandate and current status

Session 392 addressed the agent **adjacent-verification** failure before
reviewer runtime stabilization resumed. Adjacent verification occurs when an
agent inspects genuine evidence but writes a broader claim than that evidence
supports—for example, reading a function body and claiming when every caller
runs it, or finding one detector and concluding no other detector exists.

The bounded pilot is now implemented on `main`, its owner disposition is
**Keep advisory**, and metadata-only normal-session observation remains open.
It did not change reviewer runtime code or reviewer data and does not authorize
blocking behavior. The current application handoff is the independent Fable
challenge pass in `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` and
`docs/REVIEWER_HOLISTIC_REVIEW_FABLE_PROMPT.md`.

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
| The detector's usefulness and false-positive rate in normal documentation sessions are not yet known | The Session 392 branch has a 35-case replay corpus and green focused tests, but no normal-session observation window yet | **PARTIAL — replay evidence only** |

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

### Session 392 implementation and replay observation

The bounded pilot is implemented on `codex/adjacent-verification-pilot` and
remains advisory-only. The implementation surface is limited to:

- `.claude/rules/claim-evidence.md` — the canonical four-row rule, normative /
  descriptive distinction, bounded-redacted evidence contract, and honest
  escapes;
- `.claude/hooks/fixtures/claim-evidence.json` — 35 replay cases;
- `.claude/hooks/lib/claim-evidence.js` and
  `.claude/hooks/claim-evidence-advisory.js` — claim/query-shape matching and
  the Claude Code PreToolUse advisory;
- `.claude/hooks/lib/claim-evidence-observations.js` — metadata-only local
  occurrence records, bounded retention, validation, and aggregation;
- `.claude/hooks/hook-enforcement.test.js` — fixture replay, delta-only plus
  touched-line qualifier/tag edits, fail-open, privacy-language, and
  configured-hook coverage; and
- `.claude/hooks/lib/claim-evidence-observations.test.js` — schema allowlist,
  privacy boundary, permissions, concurrent writers, retention, malformed
  records, reporter, and storage-failure coverage;
- `.claude/settings.json` — one `Write|Edit` registration with no blocker or
  shell exit wrapper;
- `scripts/report-claim-evidence-pilot.js`, `package.json`, and
  `.claude/skills/stop/SKILL.md` — a local report run by the session-closing
  workflow;
- this directive — bounded replay results and limitations; and
- `SESSION_PROMPT.md` — corrected standalone Node commands for the existing
  hook test harnesses.

Replay observation on 2026-07-31:

| Observation | Replay result | Status / limitation |
| --- | --- | --- |
| Seeded adjacent-verification cases detected | 19 of 19: definition-only and symbol-free caller evidence, wrong-domain/unrelated/partial/subdirectory/file-only universal evidence, suggested/echoed but unexecuted query text, scope text confined to a regex pattern, exact and generic wrong-scope CodeGraph evidence, missing/mismatched/subdirectory/comment-only count denominators, a mixed `[ASSUMED]` sibling, and an unsupported sensitive negative claim produced advisories | **VERIFIED via fixture replay** |
| Known cases missed | 1 of 1 recorded regex-boundary case: “applies whenever the roster is loaded” does not match the deliberately narrow v1 call-path signature | **KNOWN MISS** |
| False positives on normative, conditional, future, hypothetical, historical, worked-example, and generic-example text | 0 of 7 isolated exclusion fixtures produced an advisory | **VERIFIED in replay only** |
| Remedies understandable and executable | Advice names CodeGraph/repo-scoped caller search, complement search, independent denominator, and the detected domain; human understandability has not been observed in normal work | **PARTIAL** |
| `[ASSUMED]` used as avoidance | The explicit escape is accepted by one fixture; replay cannot establish whether an agent will misuse it | **UNKNOWN pending normal sessions** |
| Sensitive/raw output requested for retention | 0 cases; the privacy fixture asserts bounded/redacted guidance, redacts its secret-like placeholder, and rejects prohibited raw-output/access-token requests | **VERIFIED in replay only** |
| Internal hook failure behavior | Malformed input exits successfully and emits a bounded fail-open diagnostic | **VERIFIED via focused test** |

The v1 matcher recognizes a structured tool invocation and parses direct
`rg`/`grep` commands (including glob and common type filters) into search
pattern, path arguments, and filter universe before checking coarse claim terms
and every named repository domain. It does not establish that those terms model
the claim's true predicate, that a CodeGraph invocation returned a complete
trace, that two count queries are logically independent beyond their separate
invocations and matching path/filter universe, or that the result supports the
sentence. Shell wrappers, command chains, and unrecognized value-bearing
options may remain advisory even when the underlying search is valid. Those
limits remain review obligations and are why this pilot is advisory rather
than proof or enforcement.

Focused verification command:

```bash
rtk node .claude/hooks/lib/claim-evidence-observations.test.js
rtk node .claude/hooks/hook-enforcement.test.js
rtk node .claude/hooks/lib/document-guards.test.js
rtk npm run report:claim-evidence-pilot -- --current
```

The previously suggested Jest path is not included by this repository's Jest
patterns and returns “No tests found”; the hook suites are executable Node test
harnesses.

### Owner disposition and campaign observation

On 2026-07-31, the owner selected **Keep advisory** and authorized merging the
bounded pilot. This is the explicit Phase 3 disposition for the replay-backed
pilot. It does not authorize any blocking behavior. Normal-session evidence is
required before a later proposal to block even a named narrow pattern, but it
does not gate use of the current advisory.

The owner approved metadata-only local observation on 2026-07-31 after noting
that a manual table alone was not reliable monitoring. SessionStart exports a
hashed current-session key into Claude's session environment; it does not add an
all-session telemetry record. On each eligible plan/design documentation edit,
the hook atomically publishes or replaces one mode-`0600` per-session marker
containing only the schema version, hashed session key, and last eligible-edit
timestamp. When
an advisory fires, it atomically publishes one mode-`0600` JSON event beneath the same
OS-temporary, repository-hashed state root used by the existing Claude session
lifecycle by default. The containing directory is mode `0700`. Cleanup runs
after each successful record and before each report, retaining the newest 100
eligible-session markers and 500 events that are no more than 60 days old;
stale crash-pending files are removed after ten minutes. There is no background
expiry daemon.
Each event has an exact schema: version, event ID,
timestamp, hashed Claude session identifier, repository-relative documentation
path, `Write`/`Edit`, claim count, and fixed counts for call-path, universal, and
count shapes. It does not retain claim text or fingerprints, transcript paths or
content, commands or output, environment values, secrets, reviewer data, or
other live-record content. It has no network, database, application-runtime, or
Production path.

Observation-storage failure is visible to the agent and user but remains
fail-open: it cannot block the edit or suppress an applicable advisory. Records
are written completely to an unlisted temporary file, flushed, and atomically
published, so concurrent readers cannot observe partial JSON. The reporter
validates canonical IDs, timestamps, filenames, paths, and count bounds;
malformed files cannot displace valid retained events. Unreadable stores and
retention-cleanup failures produce a nonzero, visible report rather than a clean
zero. The reporter infers only occurrence counts. It cannot infer usefulness, false positives, repetition,
resolution, `[ASSUMED]` avoidance, owner interruption, or sensitive-evidence
requests.

Observe the next three to five normal Claude Code documentation sessions without
adding mid-session owner check-ins. At `/stop`, the session-closing agent runs
`rtk npm run report:claim-evidence-pilot -- --current`; the exact hashed session key
prevents a concurrent session from being selected. The agent classifies the
advisories it actually received and appends one bounded row, including a
zero-advisory row, when the eligible session key is not already present. A
session with no eligible plan/design documentation edit produces no row. Do not
copy claim text or raw evidence into the table. Codex
and other non-Claude-Code edits are outside this hook's enforcement boundary and
do not count as observation.

| Session/date | Advisory instances / unique claims | Useful / false positive / repeated | Resolution: query / narrow / `[ASSUMED]` / ignored | Owner interrupted? | Sensitive evidence requested? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-09 (S409 close) | 1 / 1 (universal shape) | Useful 1 / false positive 0 / repeated 0 | Query | No | No | Recorded event fired on a delegated plan-doc edit. The session-closing agent separately received scope/quantity and design-doc-assertion guards on an agent-wiki edit and resolved both by running disconfirming searches and re-reading the producing source before writing the claim. No `[ASSUMED]` label was needed; no owner check-in occurred. |
| 2026-08-10 (S413 close) | 3 / 3 recorded (all universal shape) | Useful 3 / false positive 0 / repeated 0 | Query 2 / narrow 1 | No | No | Recorded events fired on one plan-doc edit early in the session. The session also received many additional scope/quantity and design-doc-assertion guards on file-model, pilot-evidence, and handoff edits; those are counted separately from the recorded three. Classification of the guarded claims: two universal claims were resolved by running the disconfirming search rather than asserting (each changed the wording that shipped — one gained per-file citations, one was demoted after the complement query showed the generalization was unsupported by the single case tested). One quantity claim was narrowed from a population generalization to the single tested instance. Two further claims were labeled `[ASSUMED]` with the limiting n stated inline; reviewed for avoidance and judged legitimate — the underlying evidence is n=1 by nature and no available query would upgrade it. No guard produced a false positive. No owner check-in occurred; all resolutions were autonomous. No sensitive evidence was requested or retained. |

Promotion remains pattern-specific, not detector-wide. A future blocking
proposal must identify the exact claim shape, include observed examples from at
least three normal sessions, show no known false positive for that shape, make
every remedy executable without owner interpretation, review every
`[ASSUMED]` resolution for avoidance, request no sensitive evidence, and add
fixtures for the observed syntax. Unobserved forms and all other claim shapes
must remain advisory. A new explicit owner decision and adversarial review are
required before implementation.

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
the pilot's documented stop decision has been reached. The owner inserted a
fresh Claude Fable challenge pass before implementation so the July 31
observations, authority boundaries, five proposed golden workflows, and phase
order are independently tested rather than accepted. Justin will decide
whether to retain, revise, or replace the proposed stabilization sequence after
reviewing Fable's findings.

Do not interpret this temporary reprioritization as evidence that the reviewer
regressions are resolved. They remain unresolved stabilization work whose
current observations, causal account, and proposed remedies are now assigned to
the Fable challenge pass.
