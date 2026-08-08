---
title: ROR and Reviewer Finding Strategic Reset Brief
domain: reviewer-identity
kind: status
status: active
summary: "Fable handoff to separate institution normalization, person identity, and reviewer relevance before any further implementation."
canonical: false
cataloged: 2026-08-08
owner: product-engineering
related:
  - SESSION_PROMPT.md
  - docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md
  - outputs/institution-resolution-handoff-to-codex-2026-08-07.md
---

# ROR and Reviewer Finding Strategic Reset Brief

## Assignment

Fable should take a read-only strategic pass over the reviewer-finding and ROR
work before anyone changes the resolver again. The immediate deliverable is a
short assessment and decision plan, not code.

The goal is to define which capability WMKF is actually trying to improve,
separate the evidence needed to judge each capability, and design a reusable
evaluation that does not require another paid Claude reviewer search.

## What happened

Three related increments were built and deployed to production on 2026-08-08:

- `444bd781` added a request-scoped ROR candidate adapter, local
  veto-before-scoring institution decision, and exact-ROR OpenAlex bridge behind
  the existing Works-first runtime seam.
- `ffab03c6` added a superuser-only comparison panel for Legacy, Works-first,
  and Combined identity outcomes.
- `6935b299` added a superuser-only PubMed pass-through observer so the existing
  PubMed result could be compared with Works-first without changing the search
  decision or writing W2 telemetry.

Production deployment `dpl_8J167uKtsFi5ej5uS9pgmXTxLjKu` reached Ready and an
immediate error scan was clean. Production resolver authority remains
`legacy-default`; the ROR/Works-first path is not authoritative.

The page initially displayed every Legacy and Combined outcome as `Unknown`
because it had been open before the diagnostic UI deployment. The server had
returned the diagnostic payload, but stale client JavaScript did not know how
to render it. The existing payload was recovered from Safari's React state, so
no additional paid search was needed.

That payload contained 15 comparable rows: four PubMed/Works-first consensus
outcomes and 11 differences. The row-level names remain local and are not
recorded in tracked documentation.

## What the follow-up audit showed

A three-case, read-only audit used official public profiles and direct
OpenAlex/ROR resolver replay. It made no Claude calls.

- Two common-name people were real and affiliated with the institutions stated
  by the search, but Works-first abstained because no retrieved work byline
  corroborated the institution. The replay produced dozens of plausible
  namesake candidates without the claimed institution.
- One more distinctive-name person was correctly bound by Works-first to an
  ORCID-backed institutional profile while PubMed abstained.
- The current OpenAlex raw-author-name retrieval takes at most 50 works ordered
  newest first; institution evidence is evaluated only after that bounded
  retrieval. Common names can therefore fill the window before the target
  person's work appears.

That mechanism is a useful observation, but it is not authorization to raise a
query cap, add name-specific rules, or introduce another provider fallback.
Those would be local patches before the product contract is settled.

## The strategic problem

The experiment collapsed three distinct questions into the same
`bind` / `review` / `abstain` vocabulary:

1. **Reviewer finding and relevance:** did the PubMed-backed search surface a
   suitable reviewer for this proposal?
2. **Person identity:** did Works-first identify the intended real person from
   public works and stable identifiers?
3. **Institution normalization:** did ROR map an affiliation string to the
   correct canonical organization?

Agreement or disagreement between PubMed and Works-first does not directly
measure ROR institution-normalization quality. The 11 differences therefore do
not answer whether ROR should be promoted, nor whether reviewer finding is
better overall.

The frozen institution benchmark remains valid evidence about institution
candidate retrieval and veto/scoring behavior. It is not a representative
person-identity or reviewer-relevance benchmark.

## What we want to achieve

Fable should recommend a simpler, explicit strategy that answers:

1. What exact production capability is the next promotion target?
2. What are the independent input, output, abstention, and safety contracts for
   institution normalization, person identity, and reviewer relevance?
3. Which existing or historical labeled records can form a fixed, reusable
   benchmark for each contract without running a new Claude search?
4. What small set of metrics and go/no-go thresholds would justify a change?
5. Which parts of the current ROR/Works-first implementation should be kept,
   reshaped, or stopped?

The preferred output is a concise strategic assessment with owner decision
points and a staged evaluation plan. It should distinguish falsification tests
from representative evidence and identify the smallest experiment that can
change an owner decision.

## Boundaries

Until Justin reviews Fable's strategy:

- Do not change production resolver authority from `legacy-default`.
- Do not tune OpenAlex query caps, introduce per-name heuristics, add provider-
  specific fallbacks, or build another combined outcome patch.
- Do not run another paid Claude reviewer search.
- Do not add schema, persistence, telemetry, deployment, or write-path work.
- Treat the current admin comparison as a request-local diagnostic, not a W2
  promotion gate or durable evaluation dataset.
- Preserve the existing fail-closed identity and invitation safeguards.

If the proposed evaluation cannot distinguish the three contracts, stop and
ask for an owner decision instead of implementing around the ambiguity.

## Evidence to read first

- `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md` — research
  foundation and the four-decision decomposition.
- `outputs/institution-resolution-handoff-to-codex-2026-08-07.md` — historical
  implementation handoff and frozen benchmark trail; its old sequencing is
  superseded by this brief.
- `lib/services/reviewer-works-first.js` — current person-resolution and
  institution-corroboration behavior.
- `lib/services/openalex-service.js` — bounded raw-author-name work retrieval.
- `lib/services/reviewer-identity-runtime.js` — Legacy/Works-first/Combined
  runtime seam and current default behavior.
- `lib/services/ror-institution-identity-resolver.js` — production ROR
  institution-resolution implementation.
- `benchmarks/fuzzy-matching-falsification/` — frozen institution-focused
  falsification evidence.

## Requested deliverable

Return a brief with:

1. the capability and contract decomposition;
2. the reusable benchmark proposal and evidence sources;
3. explicit go/no-go criteria;
4. what to keep, reshape, or stop in the current implementation; and
5. the minimum owner decisions required before any next build.
