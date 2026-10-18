---
title: Discussion attribution correction and review safeguards
domain: transcription
kind: plan
status: active
summary: "Owner-confirmed discussion corrections are complete; conservative attendance defaults and review-only fragment warnings are released. Broader diagnostic proposals remain unadopted."
owner: product-engineering
related:
  - docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md
  - docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md
  - lib/services/meeting-tracker-transcription/attendance-service.js
  - lib/services/meeting-tracker-transcription/fragment-review.js
  - lib/services/post-presentation-materials/discussion-sentiment-service.js
---

# Discussion attribution correction and review safeguards

## Current disposition — 2026-10-18

**[VERIFIED via owner confirmation and production readback]** The two scoped transcript corrections are complete, including the subsequently confirmed sentence continuation. Regenerated sentiment analyses are accepted and current; the reviewed summaries are published and current. Do not replay those repairs. This public record deliberately omits request identities, speaker identities, transcript text and operational repair instructions.

**[VERIFIED via source, tests and Ready production deployment]** PR #497 (`f669ab40c`) adds conservative attendance defaults for uncertain identities and supported speech-after-departure conflicts, plus bounded review-only warnings for one-word sentence fragments. Existing attendance decisions are preserved. Fragment warnings never change words, timing or speaker assignments. Prompt v1 is published; six live evaluation cases passed through the model client and normal Executor. PR #497 merged as `aaf95e1828eb3c801865e5a969f358fdc3fc782f`; deployment `dpl_DrBHYVUB6whmYZmtyk1qJ2VBRHka` is Ready at that SHA. Release limits and next decisions are in the current session handoff.

## Contract and limits

The original diagnosis concerned recording-wide speaker identity being carried into staff-discussion turns despite conflicting attendance evidence. Sentiment speaker labels are attached from matched transcript turns, so corrections must preserve transcript/derived-artifact consistency. Timing checks require aligned attendance evidence; an attendee connection remaining open is not proof of who spoke.

The release does not add automatic grammatical reassignment, broad name normalization, analysis-time retroactive exclusions or a general per-turn editor. Those were diagnostic possibilities, not an approved implementation backlog. Longer ambiguous turns require human confirmation.

## Historical diagnosis

The dated original brief and probe findings are preserved in existing repository history at `6d6fb0740:docs/plans/DISCUSSION_MISATTRIBUTION_BRIEF_2026-10-17.md`. That historical document describes the pre-correction state and includes proposals beyond the selected scope. It is not a current repair worklist; its old scratchpad artifacts are not portable or required for routine use.
