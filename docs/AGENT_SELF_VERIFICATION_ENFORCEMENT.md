---
title: Agent Self-Verification Enforcement
domain: agent-harness
kind: spec
status: active
summary: "Narrow blockers and fingerprinted review receipts enforce evidence where advisory reminders repeatedly failed."
canonical: false
cataloged: 2026-07-18
owner: product-engineering
---

# Agent Self-Verification Enforcement

This contract converts three recurrent review failures into narrow mechanical
stops. It does not attempt to make every unsupported assertion machine
detectable.

## Enforced Contracts

### Reviewer-email ownership claims

`design-doc-assertion-guard.js` blocks only newly introduced prose that combines:

- a reviewer email address;
- an ownership/identity assertion marker, including strong certainty language
  such as `almost certainly`, or a concrete classification such as `belongs to`
  or `role mailbox`.

The same sentence passes when it contains a first-party URL, a repo `file:line`
reference, an evidence label, or an explicit hedge such as `[ASSUMED]`. Visible
non-claim markers are limited to enumerated quoted examples, hypotheticals, and
templates. Example domains are ignored. Other design and storage assertions
remain advisory.

The configured hook command intentionally preserves exit code 2. Its integration
test reads `.claude/settings.json` and executes the exact configured command, so
a future `|| true` regression fails the test. [VERIFIED via
`.claude/hooks/hook-enforcement.test.js`]

### Consequential-review recommendation evidence

The Mode A output contract in `/contract-reconcile` requires one row per
recommendation recording:

- the recommendation's current prerequisite;
- whether that prerequisite exists at the real execution point;
- what comparison or experiment was actually tested;
- a disconfirming check; and
- the resulting evidence status.

This is the semantic control for recommendations that contradict execution
order, rely on retired paths, overstate an experiment, or conflate allocated
quota with marginal cost. It is an instruction contract rather than a
machine-complete semantic proof.

### Fingerprinted adversarial-review receipts

When `session-lifecycle.js` observes a Markdown artifact under `docs/` with
verdict/findings structure and recommendation or correction language, it stores
a SHA-256 fingerprint of the file and requires a fresh adversarial-review
receipt before Stop.

The delegated prompt must contain:

```text
[ADVERSARIAL-REVIEW-RECEIPT: docs/path/to/artifact.md]
```

The same prompt must request adversarial or refuting review, `file:line`
evidence, and a `disconfirming check` for each recommendation. The pre-review
guard rejects an incomplete receipt prompt. The PostToolUse lifecycle hook
records the receipt against the current fingerprint. Any later artifact edit
makes it stale.

A deliberate human or maintainer exception is visible in the artifact:

```html
<!-- adversarial-review:waived reason=specific reason -->
```

The receipt proves that a sufficiently explicit fresh-agent review prompt ran
against the exact artifact version. It does not prove reviewer quality or that
every conclusion is correct. Hook parse and internal errors continue to fail
open; a session without lifecycle state retains the existing fail-open behavior.

## Failure-to-Control Mapping

| Failure shape | Primary control | Residual |
|---|---|---|
| Confidently assigning an email to the wrong person | Narrow ownership-claim blocker | Novel phrasing outside the matcher |
| Recommending data before it exists in execution order | Recommendation evidence plus fresh review | Reviewer can still misread a path |
| Generalizing from an experiment that did not test the comparison | `Evidence actually tested` field | Fabricated or misunderstood evidence |
| Overstating a partially correct proposal as wholly defective | Disconfirming check plus fresh review | Judgment remains semantic |
| Treating allocated search cost as marginal cost | Explicit prerequisite/evidence row | External pricing can change |
| Recommending a retired or misclassified path | Current-prerequisite and execution-point fields | Source can drift after review |

## Verification

The unit and integration tests cover:

- positive, sourced, hedged, example, and malformed-input email cases;
- the exact configured hook command and blocking exit;
- incomplete and complete receipt prompts;
- current, stale, and waived fingerprints; and
- Stop blocking when a consequential review lacks a current receipt.

Instruction architecture also checks that both the blocking assertion command
and the PostToolUse receipt recorder remain wired.
