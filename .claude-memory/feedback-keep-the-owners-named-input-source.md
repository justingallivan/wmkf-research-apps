---
name: feedback-keep-the-owners-named-input-source
description: "Owner, S601 (2026-10-13): asked for a sentiment meter over the AI staff-discussion SUMMARIES; I recommended reading the transcripts instead and the build grew (quote verification, attribution, migration). Owner: 'you did more than I expected' — fine to start, but the named input was the ask."
metadata:
  type: feedback
  status: active
---

## Recall Rule
Read when a recommendation would change the input, source or data the owner named in the request.

Do: build on the source the owner named by default; if a different source looks better, present it as a scope choice that states the extra build cost (new checks, tables, reviews) next to the quality gain, and offer the named-source version as the default option.
Do not: mark the switch "(Recommended)" on quality grounds alone, or treat the owner picking it from a list as proof they wanted the larger build.
Ground truth: the owner's request wording; `docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md` §2.

**Historical example (S601):** the ask was "a sentiment meter that reads the AI-generated summaries of the staff discussions and compares them". I argued the summaries were too neutral and recommended transcripts with quoted evidence; the owner chose it from my options. That added transcript integrity checks, structured attribution, quote verification and a sentiment table — PR #475, ~3,900 lines across two build rounds and five reviews. The owner accepted it as a starting point but had expected summary-only.

**How to apply:** same discipline as [[feedback-anchor-multisession-features-to-the-original-ask]] — restate the original ask before recommending; size each alternative in effort, not just quality.
