---
name: feedback-orchestrator-checks-builds-before-review
description: Review rounds exist because builds ship defects; the orchestrator must check each build against an invariant table and required mutations before any Opus/Codex round, and give verifier/comparator/identity code to Opus, not Sonnet.
metadata:
  type: feedback
  status: active
  originSessionId: 335b6af0-cc94-436b-bbf1-a37dffab9839
  created: 2026-09-25
---

## Recall Rule
Read before delegating any build or dispatching any review round on the Test Request Factory or comparable multi-stage work.

## The feedback (owner, 2026-09-25, Session 543)
"The cadence is only needed when the designer and builder make mistakes, which your evidence says happens a lot." Across the four 6c builds that day Opus round 1 found P1s in three of them (v2 bundle digest regression; DOCX census that could never pass; a claimed magic-byte check that did not exist) and Codex found more in every slice. Fifteen plan rounds and eight build rounds on one slice.

**Why:** the reviews were doing first contact with defects the orchestrator could have caught in a ten-minute diff read, briefs listed contracts instead of invariants with required tests, and Opus-grade code (verifiers, comparators, identity) was given to Sonnet.

**How to apply:**
1. Every build brief carries an invariant table and a required mutation list; a hand-back without each mutation reported red-then-green is returned, not reviewed.
2. The orchestrator runs a contract-reconcile pass on the diff against that table BEFORE the first Opus round; Opus reviews residue, not first contact.
3. Opus builds verifier, comparator and identity code; Sonnet builds ledger plumbing, grammars, CLI flags and doc records.
4. Read every fix-round diff before dispatching the next round; never relay a builder's report as verified.
5. When a second finding lands in the same class, stop patching and canonicalize the class (see the URL-guard rounds 3–7 in [[project-closed-work-archive]] context and feedback-corrections-decay-unless-mechanized).

Related: [[feedback-mutation-test-with-the-discriminating-fixture]], [[feedback-read-the-implementation-not-the-callers-docblock]], [[feedback-corrections-decay-unless-mechanized]], [[feedback-latency-plan-scope-accretion-postmortem]].
